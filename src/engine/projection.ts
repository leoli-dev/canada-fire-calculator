import {
  ACCOUNT_TYPES,
  type AccountType,
  type Inputs,
  type Phase,
  type ProjectionResult,
  type Strategy,
  type TaxBySource,
  type YearRow,
} from './types'
import { incomeTax, probateTax } from './tax'
import { CAPITAL_GAINS_INCLUSION, FEDERAL, PROVINCIAL } from './taxData'
import {
  OAS_CLAWBACK_THRESHOLD,
  allowanceAnnual,
  cppAnnual,
  earlyClaimDilutionRelief,
  gisAnnual,
  oasAnnual,
  oasAfterClawback,
} from './benefits'
import { rrifMinFactor } from './rrif'
import { buildDebtStream } from './debts'

/** Per-year, per-account return override; default uses inputs.returns. */
export type ReturnSampler = (age: number, account: AccountType) => number

/** Fallback funding order once the strategy's planned RRSP draw is taken. */
const STRATEGY_ORDER: Record<Strategy, AccountType[]> = {
  meltdownPaced: ['nonReg', 'tfsa', 'rrsp'],
  rrspFirst: ['rrsp', 'nonReg', 'tfsa'],
  nonRegFirst: ['nonReg', 'rrsp', 'tfsa'],
  tfsaFirst: ['tfsa', 'nonReg', 'rrsp'],
}

interface WithdrawalOutcome {
  withdrawals: Record<AccountType, number>
  tax: number
  taxablePerPerson?: number
  /** portion of the year's tax attributable to RRSP/RRIF withdrawals */
  rrspTax: number
  oasNet: number
  /** GIS received (tax-free, income-tested on taxable income excl. OAS) */
  gis: number
  netCash: number
}

/**
 * Distribute a total gross withdrawal G across accounts (RRIF minimum first,
 * then along the configured order) and compute the resulting after-tax cash.
 *
 * Household mode splits taxable income equally between spouses (approximates
 * ideal income splitting via spousal RRSPs / pension splitting); OAS clawback
 * is applied per person on their share.
 */
export interface Step {
  account: AccountType
  /** cumulative ceiling on this account's withdrawal for the year */
  cap?: number
}

function evaluate(
  G: number,
  balances: Record<AccountType, number>,
  forcedRrsp: number,
  gainFraction: number,
  cpp: number,
  oasGrossPerPerson: number[],
  agesPerPerson: number[],
  extraTaxable: number,
  rent: number,
  extraIncome: number,
  steps: Step[],
  inputs: Inputs,
): WithdrawalOutcome {
  const w: Record<AccountType, number> = { tfsa: 0, rrsp: 0, nonReg: 0 }
  let remaining = G

  const fromRrif = Math.min(remaining, forcedRrsp)
  w.rrsp += fromRrif
  remaining -= fromRrif

  for (const s of steps) {
    let capacity = balances[s.account] - w[s.account]
    if (s.cap !== undefined) capacity = Math.min(capacity, Math.max(0, s.cap - w[s.account]))
    const take = Math.min(remaining, capacity)
    w[s.account] += take
    remaining -= take
    if (remaining <= 0) break
  }

  const persons = oasGrossPerPerson.length
  // extraTaxable is taxable but not cash-in-hand (reinvested distributions,
  // sale gains whose proceeds land in non-registered); rent is both taxable
  // and spendable, and splits like any jointly-held asset. extraIncome
  // (Barista/side income) cannot: employment-type income is taxed entirely
  // on whoever earned it — pension splitting and spousal RRSPs don't apply
  // to it — so it's attributed in full to person 0 instead of pooled.
  const pooledTaxable =
    cpp + extraTaxable + rent + w.rrsp + w.nonReg * gainFraction * CAPITAL_GAINS_INCLUSION
  const share = pooledTaxable / persons
  let oasNet = 0
  let tax = 0
  for (let i = 0; i < persons; i++) {
    const personExtra = i === 0 ? extraIncome : 0
    const personTaxable = share + personExtra
    const personOas = oasAfterClawback(oasGrossPerPerson[i], personTaxable)
    oasNet += personOas
    // RRIF withdrawals at 65+ qualify as eligible pension income
    const pensionIncome = agesPerPerson[i] >= 65 ? w.rrsp / persons : 0
    tax += incomeTax(personTaxable + personOas, inputs.province, {
      age: agesPerPerson[i],
      pensionIncome,
    })
  }
  // GIS: requires receiving OAS; income test is on combined household income
  // excl. OAS (TFSA withdrawals are invisible to it; work income gets an
  // exemption) — a couple's GIS eligibility is assessed on family income
  // regardless of which spouse earned what
  const receivingOas = oasGrossPerPerson.map((o) => o > 0)
  const gisIncome = pooledTaxable + extraIncome
  const gis =
    gisAnnual(receivingOas, gisIncome, extraIncome) +
    allowanceAnnual(receivingOas, agesPerPerson, gisIncome)
  const netCash = cpp + oasNet + gis + rent + extraIncome + w.tfsa + w.rrsp + w.nonReg - tax
  const totalTaxable = pooledTaxable + extraIncome + oasNet
  const rrspTax = totalTaxable > 0 ? tax * (w.rrsp / totalTaxable) : 0
  const taxablePerPerson = totalTaxable / persons
  return { withdrawals: w, tax, rrspTax, oasNet, gis, netCash, taxablePerPerson }
}

/** Binary-search the gross withdrawal needed to hit the spending target. */
function solveWithdrawals(
  target: number,
  balances: Record<AccountType, number>,
  forcedRrsp: number,
  gainFraction: number,
  cpp: number,
  oasGrossPerPerson: number[],
  agesPerPerson: number[],
  extraTaxable: number,
  rent: number,
  extraIncome: number,
  steps: Step[],
  inputs: Inputs,
): WithdrawalOutcome {
  const total = balances.tfsa + balances.rrsp + balances.nonReg
  const run = (G: number) =>
    evaluate(G, balances, forcedRrsp, gainFraction, cpp, oasGrossPerPerson, agesPerPerson, extraTaxable, rent, extraIncome, steps, inputs)

  const atMin = run(forcedRrsp)
  if (atMin.netCash >= target) return atMin

  const atMax = run(total)
  if (atMax.netCash < target) return atMax

  let lo = forcedRrsp
  let hi = total
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (run(mid).netCash < target) lo = mid
    else hi = mid
  }
  return run(hi)
}

/** Primary-timeline age at which the first government benefit begins. */
export function pensionStartAge(inputs: Inputs): number {
  let start = Math.min(inputs.cppStartAge, inputs.oasStartAge)
  if (inputs.partner) {
    const offset = inputs.currentAge - inputs.partner.currentAge
    start = Math.min(
      start,
      inputs.partner.cppStartAge + offset,
      inputs.partner.oasStartAge + offset,
    )
  }
  return start
}

export function runProjection(inputs: Inputs, sample?: ReturnSampler): ProjectionResult {
  const bal: Record<AccountType, number> = { ...inputs.balances }
  let nonRegBook = Math.min(inputs.nonRegBook, bal.nonReg)
  const pensionAge = pensionStartAge(inputs)
  const partner = inputs.partner ?? null
  const rows: YearRow[] = []
  let depletedAge: number | null = null
  let rrspTaxTotal = 0

  // debt payments are fixed in nominal dollars — inflation erodes them in
  // this real-dollar frame. During accumulation they're assumed already
  // netted out of annualSavings; in retirement they add to the spending
  // target until each loan is paid off.
  const years = inputs.lifeExpectancy - inputs.currentAge + 1
  const inflation = inputs.inflation ?? 0.021
  const debtStream = buildDebtStream(inputs.debts ?? [], years, inflation)

  // a property-linked mortgage amortizes on its own precomputed stream (same
  // math as the household debts array) so it can be discharged in full from
  // sale proceeds instead of continuing forever
  const prMortgage = inputs.principalResidence?.mortgage
    ? buildDebtStream([{ kind: 'mortgage', ...inputs.principalResidence.mortgage }], years, inflation)
    : null

  let prValue = inputs.principalResidence?.value ?? 0
  const ips = (inputs.investmentProperties ?? []).map((p) => ({
    value: p.value,
    acb: Math.min(p.acb, p.value),
    appreciation: p.appreciation,
    sellAtAge: p.sellAtAge,
    rent: p.annualRent ?? 0,
    mortgage: p.mortgage
      ? buildDebtStream([{ kind: 'mortgage', ...p.mortgage }], years, inflation)
      : null,
  }))

  for (let age = inputs.currentAge; age <= inputs.lifeExpectancy; age++) {
    const phase: Phase =
      age < inputs.fireAge ? 'accumulation' : age < pensionAge ? 'bridge' : 'pension'

    let withdrawals: Record<AccountType, number> = { tfsa: 0, rrsp: 0, nonReg: 0 }
    let cpp = 0
    let oas = 0
    let gis = 0
    let tax = 0
    let netCash = 0
    let shortfall = 0
    let extraTaxable = 0
    let saleGainsTaxable = 0
    let taxablePerPerson = 0
    let taxBySource: TaxBySource = { rrsp: 0, nonReg: 0, cpp: 0, oas: 0, property: 0, extraIncome: 0 }
    let taxableBySource: TaxBySource = { rrsp: 0, nonReg: 0, cpp: 0, oas: 0, property: 0, extraIncome: 0 }
    const yearIdx = age - inputs.currentAge

    // principal residence sale: tax-free; any linked mortgage is discharged
    // from the proceeds (a plain cash-flow cost until then — its interest
    // isn't deductible, unlike a rental's)
    const pr = inputs.principalResidence
    if (pr && pr.sellAtAge !== null && age >= pr.sellAtAge && prValue > 0) {
      const owed = prMortgage?.balances[yearIdx] ?? 0
      bal.nonReg += prValue - owed
      nonRegBook += prValue - owed
      prValue = 0
    }
    // investment property sales: gain is 50% taxable; clamped to retirement;
    // a linked mortgage is discharged from the proceeds the same way
    for (const p of ips) {
      if (p.sellAtAge !== null && age >= Math.max(p.sellAtAge, inputs.fireAge) && p.value > 0) {
        const owed = p.mortgage?.balances[yearIdx] ?? 0
        const gain = Math.max(0, p.value - p.acb) * CAPITAL_GAINS_INCLUSION
        extraTaxable += gain
        saleGainsTaxable += gain
        bal.nonReg += p.value - owed
        nonRegBook += p.value - owed
        p.value = 0
      }
    }
    // net rent from properties still held (stops the year a property sells);
    // a linked mortgage's interest (not principal) is deductible against it,
    // capped at the rent itself — this model doesn't carry forward a rental
    // loss to shelter other income
    const rent = ips.reduce((s, p) => s + (p.value > 0 ? p.rent : 0), 0)
    const rentMortgageInterest = Math.min(
      rent,
      ips.reduce((s, p) => s + (p.value > 0 ? (p.mortgage?.interest[yearIdx] ?? 0) : 0), 0),
    )
    extraTaxable -= rentMortgageInterest

    // debt payments/balances shown and charged against spending: the
    // household's general debts plus any property-linked mortgage still
    // outstanding (properties already sold this year stop contributing —
    // their mortgage was just discharged from the sale proceeds above)
    const debtPayment =
      (debtStream.payments[yearIdx] ?? 0) +
      (prValue > 0 ? prMortgage?.payments[yearIdx] ?? 0 : 0) +
      ips.reduce((s, p) => s + (p.value > 0 ? p.mortgage?.payments[yearIdx] ?? 0 : 0), 0)
    const debtBalance =
      (debtStream.balances[yearIdx] ?? 0) +
      (prValue > 0 ? prMortgage?.balances[yearIdx] ?? 0 : 0) +
      ips.reduce((s, p) => s + (p.value > 0 ? p.mortgage?.balances[yearIdx] ?? 0 : 0), 0)
    // Barista FIRE: side income between fromAge (no earlier than FIRE) and toAge
    const ei = inputs.extraIncome
    const extraIncome =
      ei && age >= Math.max(ei.fromAge, inputs.fireAge) && age <= ei.toAge ? ei.annual : 0

    // non-registered tax drag: yearly distributions are taxable when paid,
    // then reinvest (raising the ACB so they aren't taxed again at sale)
    const dist = bal.nonReg * (inputs.nonRegDistributionYield ?? 0)

    // government benefits accrue on each person's own timeline, whether or
    // not the household has FIRE'd yet (an older partner can be collecting
    // CPP/OAS during the primary's accumulation years)
    const partnerAge = partner ? partner.currentAge + (age - inputs.currentAge) : null
    // QPP can be deferred to 72 (since 2024); CPP caps at 70
    const cppMaxAge = inputs.province === 'QC' ? 72 : 70
    if (age >= inputs.cppStartAge) {
      const relief = inputs.cppWork
        ? earlyClaimDilutionRelief(
            inputs.cppWork.startWorkAge, inputs.cppWork.retireAge, inputs.cppStartAge,
          )
        : 1
      cpp += cppAnnual(inputs.cppAnnualAt65, inputs.cppStartAge, cppMaxAge) * relief
    }
    if (partner && partnerAge! >= partner.cppStartAge) {
      const relief = partner.cppWork
        ? earlyClaimDilutionRelief(
            partner.cppWork.startWorkAge, partner.cppWork.retireAge, partner.cppStartAge,
          )
        : 1
      cpp += cppAnnual(partner.cppAnnualAt65, partner.cppStartAge, cppMaxAge) * relief
    }

    // OAS rises 10% automatically at 75
    const oasGrossPerPerson = [
      age >= inputs.oasStartAge
        ? oasAnnual(inputs.oasAnnualAt65, inputs.oasStartAge) * (age >= 75 ? 1.1 : 1)
        : 0,
    ]
    const agesPerPerson = [age]
    if (partner) {
      oasGrossPerPerson.push(
        partnerAge! >= partner.oasStartAge
          ? oasAnnual(partner.oasAnnualAt65, partner.oasStartAge) * (partnerAge! >= 75 ? 1.1 : 1)
          : 0,
      )
      agesPerPerson.push(partnerAge!)
    }

    if (phase === 'accumulation') {
      for (const t of ACCOUNT_TYPES) {
        const c = inputs.annualSavings * (inputs.savingsSplit[t] ?? 0)
        bal[t] += c
        if (t === 'nonReg') nonRegBook += c
      }
      const marginal = inputs.accumulationMarginalRate ?? 0.35
      // working years: distributions taxed at the assumed marginal rate,
      // with the tax paid out of the account
      const dragTax = dist * marginal
      bal.nonReg -= dragTax
      nonRegBook += dist - dragTax
      // net rent, taxed at the same marginal rate (after any mortgage
      // interest deduction), is saved on top of annualSavings (whose hint
      // tells the user to exclude rent)
      const rentTax = (rent - rentMortgageInterest) * marginal
      bal.nonReg += rent - rentTax
      nonRegBook += rent - rentTax
      // benefits already being collected pre-FIRE are saved after tax at the
      // working marginal rate (no clawback/GIS modelling here — employment
      // income is unknown, so this leans simple; high earners drawing OAS
      // while working would really face the recovery tax)
      const oasGross = oasGrossPerPerson.reduce((s, x) => s + x, 0)
      const benefitBase = cpp + oasGross
      const benefitTax = benefitBase * marginal
      bal.nonReg += cpp + oasGross - benefitTax
      nonRegBook += cpp + oasGross - benefitTax
      oas = oasGross
      tax = dragTax + rentTax + benefitTax
      const cppTax = benefitBase > 0 ? benefitTax * (cpp / benefitBase) : 0
      taxBySource = {
        rrsp: 0, nonReg: dragTax, cpp: cppTax, oas: benefitTax - cppTax,
        property: rentTax, extraIncome: 0,
      }
      taxableBySource = {
        rrsp: 0, nonReg: dist, cpp, oas: oasGross,
        property: rent - rentMortgageInterest, extraIncome: 0,
      }
    } else {
      extraTaxable += dist

      // spousal age election: RRIF minimums may be computed from the younger
      // spouse's age — always optimal (lower forced withdrawals, more tax
      // deferral), so auto-applied rather than exposed as an input
      const rrifAge = Math.min(...agesPerPerson)
      const rrifMin = bal.rrsp * rrifMinFactor(rrifAge)
      const forcedRrsp = Math.min(bal.rrsp, rrifMin)
      // bracket-capped meltdown: the RRSP funds spending first, but only as
      // much as spending needs and never beyond the room left in the chosen
      // ceiling (per person) after CPP/OAS — the first bracket by default,
      // or the second bracket / OAS clawback threshold for large RRSPs where
      // staying in bracket 1 forever just strands money into RRIF-forced
      // withdrawals and a fully-taxable estate. Nothing is withdrawn just to
      // prepay tax; the remainder rides past 71 and exits via RRIF minimums.
      // If the other accounts run dry, the RRSP is the uncapped last resort.
      let steps: Step[]
      if (inputs.strategy === 'meltdownPaced') {
        const capMode = inputs.meltdownBracketCap ?? 'bracket1'
        const bIdx = capMode === 'bracket2' ? 1 : 0
        const bracketTop =
          capMode === 'oasClawback'
            ? OAS_CLAWBACK_THRESHOLD
            : Math.min(FEDERAL.brackets[bIdx].upTo, PROVINCIAL[inputs.province].brackets[bIdx].upTo)
        const persons = partner ? 2 : 1
        const committedTaxable =
          cpp + extraTaxable + rent + extraIncome + oasGrossPerPerson.reduce((s, x) => s + x, 0)
        const rrspCap = Math.max(rrifMin, bracketTop * persons - committedTaxable)
        steps = [
          { account: 'rrsp', cap: rrspCap },
          { account: 'nonReg' },
          { account: 'tfsa' },
          { account: 'rrsp' },
        ]
      } else {
        steps = STRATEGY_ORDER[inputs.strategy].map((account) => ({ account }))
      }
      const gainFraction = bal.nonReg > 0 ? Math.max(0, (bal.nonReg - nonRegBook) / bal.nonReg) : 0

      // debt payments come on top of living expenses until paid off
      const spendTarget = inputs.retirementSpending + debtPayment
      const out = solveWithdrawals(
        spendTarget, bal, forcedRrsp, gainFraction, cpp,
        oasGrossPerPerson, agesPerPerson, extraTaxable, rent,
        extraIncome, steps, inputs,
      )
      withdrawals = out.withdrawals
      tax = out.tax
      rrspTaxTotal += out.rrspTax
      oas = out.oasNet
      gis = out.gis
      netCash = out.netCash
      taxablePerPerson = out.taxablePerPerson ?? 0

      // proportional allocation of this year's tax across taxable
      // components (each component's share of total taxable income) —
      // sums exactly to `tax`; see TaxBySource
      const persons = partner ? 2 : 1
      const totalTaxable = taxablePerPerson * persons
      const nonRegGainTaxable = withdrawals.nonReg * gainFraction * CAPITAL_GAINS_INCLUSION
      const propertyTaxable = saleGainsTaxable + rent - rentMortgageInterest
      const taxShare = (component: number) => (totalTaxable > 0 ? tax * (component / totalTaxable) : 0)
      taxBySource = {
        rrsp: taxShare(withdrawals.rrsp),
        nonReg: taxShare(dist + nonRegGainTaxable),
        cpp: taxShare(cpp),
        oas: taxShare(oas),
        property: taxShare(propertyTaxable),
        extraIncome: taxShare(extraIncome),
      }
      taxableBySource = {
        rrsp: withdrawals.rrsp,
        nonReg: dist + nonRegGainTaxable,
        cpp,
        oas,
        property: propertyTaxable,
        extraIncome,
      }

      if (netCash < spendTarget - 0.01) {
        shortfall = spendTarget - netCash
        if (depletedAge === null) depletedAge = age
      }

      // reduce ACB proportionally to the non-registered withdrawal
      if (withdrawals.nonReg > 0 && bal.nonReg > 0) {
        nonRegBook -= (withdrawals.nonReg / bal.nonReg) * nonRegBook
      }
      for (const t of ACCOUNT_TYPES) bal[t] -= withdrawals[t]

      // surplus cash (e.g. forced RRIF minimum above spending) reinvests taxed
      const surplus = netCash - spendTarget
      if (surplus > 0) {
        bal.nonReg += surplus
        nonRegBook += surplus
      }
      // reinvested distributions raise the ACB (already taxed this year)
      nonRegBook += dist
    }

    for (const t of ACCOUNT_TYPES) {
      bal[t] *= 1 + (sample ? sample(age, t) : inputs.returns[t]) - (inputs.fees ?? 0)
    }
    if (prValue > 0 && pr) prValue *= 1 + pr.appreciation
    for (const p of ips) {
      if (p.value > 0) p.value *= 1 + p.appreciation
    }
    const ipTotal = ips.reduce((s, p) => s + p.value, 0)

    rows.push({
      age, phase,
      balances: { ...bal },
      withdrawals, cpp, oas, gis, rent,
      extraIncome: phase === 'accumulation' ? 0 : extraIncome,
      tax, netCash, shortfall,
      propertyValue: prValue + ipTotal,
      debtPayment, debtBalance,
      taxablePerPerson, taxBySource, taxableBySource,
    })
  }

  const ipTotal = ips.reduce((s, p) => s + p.value, 0)
  const lastYearIdx = inputs.lifeExpectancy - inputs.currentAge
  // any property-linked mortgage still outstanding on a held property at
  // life expectancy — same components as the per-row debtBalance above,
  // which the generic debtStream-only figure used to omit (estate looked
  // richer than the balances/Monte Carlo charts, which do subtract it)
  const finalPropertyDebt =
    (prValue > 0 ? prMortgage?.balances[lastYearIdx] ?? 0 : 0) +
    ips.reduce((s, p) => s + (p.value > 0 ? p.mortgage?.balances[lastYearIdx] ?? 0 : 0), 0)
  const finalDebt = (debtStream.balances[lastYearIdx] ?? 0) + finalPropertyDebt
  const finalNetWorth = bal.tfsa + bal.rrsp + bal.nonReg + prValue + ipTotal - finalDebt
  // deemed disposition at death: RRSP/RRIF fully taxable, gains half taxable;
  // TFSA and the principal residence pass tax-free
  const persons = partner ? 2 : 1
  const nonRegGain = Math.max(0, bal.nonReg - nonRegBook)
  const ipGain = ips.reduce((s, p) => s + (p.value > 0 ? Math.max(0, p.value - p.acb) : 0), 0)
  const deemedTaxable =
    (bal.rrsp + CAPITAL_GAINS_INCLUSION * (nonRegGain + ipGain)) / persons
  const estateTax = incomeTax(deemedTaxable, inputs.province) * persons
  const deemedTotal = bal.rrsp + CAPITAL_GAINS_INCLUSION * (nonRegGain + ipGain)
  const rrspEstateTax = deemedTotal > 0 ? estateTax * (bal.rrsp / deemedTotal) : 0
  // probate applies to the net value of non-registered holdings and unsold
  // real estate (a registered mortgage against the property reduces the
  // probatable estate); RRSP/RRIF/TFSA bypass it via named beneficiaries
  const probateFee = probateTax(
    bal.nonReg + Math.max(0, prValue + ipTotal - finalPropertyDebt),
    inputs.province,
  )
  return {
    rows,
    success: depletedAge === null,
    depletedAge,
    finalNetWorth,
    estateTax,
    probateFee,
    estateValue: finalNetWorth - estateTax - probateFee,
    rrspTax: rrspTaxTotal + rrspEstateTax,
  }
}
