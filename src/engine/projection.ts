import {
  ACCOUNT_TYPES,
  type AccountType,
  type Inputs,
  type Pension,
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

/**
 * Employer pension paid at a given age: the lifetime annuity plus the bridge
 * benefit (which ends at 65), in today's dollars. A partially-indexed pension
 * loses real value every payment year: its nominal amount grows at only
 * indexation × CPI, so in this real-dollar frame it shrinks by the gap.
 */
export function pensionPaid(
  p: Pension | null | undefined,
  personAge: number,
  inflation: number,
): number {
  if (!p || personAge < p.startAge) return 0
  const erosion = Math.pow(
    (1 + inflation * p.indexation) / (1 + inflation),
    personAge - p.startAge,
  )
  const bridge = personAge < 65 ? p.bridgeAnnual : 0
  return (p.annualAmount + bridge) * erosion
}

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
  pension: number,
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
  // employer pension pools like the rest: RPP annuities are splittable at
  // any age federally (Quebec's provincial 65+ rule is a known simplification)
  const pooledTaxable =
    cpp + pension + extraTaxable + rent + w.rrsp +
    w.nonReg * gainFraction * CAPITAL_GAINS_INCLUSION
  const share = pooledTaxable / persons
  let oasNet = 0
  let tax = 0
  for (let i = 0; i < persons; i++) {
    const personExtra = i === 0 ? extraIncome : 0
    const personTaxable = share + personExtra
    const personOas = oasAfterClawback(oasGrossPerPerson[i], personTaxable)
    oasNet += personOas
    // eligible pension income: employer RPP annuities at any age; RRIF
    // withdrawals only at 65+
    const pensionIncome =
      pension / persons + (agesPerPerson[i] >= 65 ? w.rrsp / persons : 0)
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
  const netCash =
    cpp + pension + oasNet + gis + rent + extraIncome + w.tfsa + w.rrsp + w.nonReg - tax
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
  pension: number,
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
    evaluate(G, balances, forcedRrsp, gainFraction, cpp, pension, oasGrossPerPerson, agesPerPerson, extraTaxable, rent, extraIncome, steps, inputs)

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

  const pr = inputs.principalResidence
  const plannedPurchase = pr && pr.mode === 'planned' ? pr : null
  // clamp for safety; validation flags a buy age before currentAge
  const buyYearIdx = plannedPurchase
    ? Math.max(0, plannedPurchase.buyAtAge - inputs.currentAge)
    : null

  // a property-linked mortgage amortizes on its own precomputed stream (same
  // math as the household debts array) so it can be discharged in full from
  // sale proceeds instead of continuing forever. A future purchase's mortgage
  // is built the same way but starting from buyYearIdx: since the engine
  // works entirely in today's-dollar real terms, a fixed real payment at a
  // future origination decays from *that* year exactly like an existing
  // mortgage decays from year 0 — so the stream is just time-shifted, no
  // extra deflation math needed. Zero-padding the front makes every existing
  // per-year access (`prMortgage?.balances[yearIdx]`) work unchanged.
  const prMortgage = (() => {
    if (plannedPurchase) {
      const principal = plannedPurchase.price - plannedPurchase.downPayment
      const payment = plannedPurchase.annualMortgagePayment ?? 0
      if (principal <= 0 || payment <= 0 || !plannedPurchase.mortgageYears) return null
      const startIdx = buyYearIdx!
      const stream = buildDebtStream(
        [{ kind: 'mortgage', balance: principal, annualPayment: payment, yearsRemaining: plannedPurchase.mortgageYears }],
        Math.max(0, years - startIdx),
        inflation,
      )
      const zeros = new Array(Math.min(startIdx, years)).fill(0)
      return {
        payments: [...zeros, ...stream.payments].slice(0, years),
        balances: [...zeros, ...stream.balances].slice(0, years),
        interest: [...zeros, ...stream.interest].slice(0, years),
      }
    }
    return pr && pr.mode !== 'planned' && pr.mortgage
      ? buildDebtStream([{ kind: 'mortgage', ...pr.mortgage }], years, inflation)
      : null
  })()

  let fhsaBal = inputs.fhsa?.balance ?? 0
  let fhsaActive = !!inputs.fhsa

  // a planned purchase doesn't exist until buyAtAge
  let prValue = plannedPurchase ? 0 : pr && pr.mode !== 'planned' ? pr.value : 0
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
    let taxBySource: TaxBySource = { rrsp: 0, nonReg: 0, cpp: 0, oas: 0, property: 0, extraIncome: 0, pension: 0 }
    let taxableBySource: TaxBySource = { rrsp: 0, nonReg: 0, cpp: 0, oas: 0, property: 0, extraIncome: 0, pension: 0 }
    let downPaymentSpend = 0
    let dpAccumTax = 0
    let dpAccumTaxable = 0
    const yearIdx = age - inputs.currentAge

    // future home purchase: the down payment is funded FHSA → TFSA →
    // non-registered → RRSP (fixed order, not configurable). FHSA collapses
    // in full (a qualifying withdrawal); any leftover funding need is taxed
    // at the working marginal rate pre-FIRE (no withdrawal solver runs yet),
    // or folded into this year's spendTarget so the normal solver — and its
    // strategy-driven account order — funds and taxes it precisely, exactly
    // like any other one-off retirement expense.
    if (plannedPurchase && yearIdx === buyYearIdx) {
      let remaining = plannedPurchase.downPayment
      if (fhsaActive) {
        const used = Math.min(fhsaBal, remaining)
        remaining -= used
        const excess = fhsaBal - used
        bal.nonReg += excess
        nonRegBook += excess
        fhsaBal = 0
        fhsaActive = false
      }
      const fromTfsa = Math.min(remaining, bal.tfsa)
      bal.tfsa -= fromTfsa
      remaining -= fromTfsa
      if (remaining > 0.01) {
        if (phase === 'accumulation') {
          const fromNonReg = Math.min(remaining, bal.nonReg)
          const gainFraction = bal.nonReg > 0 ? Math.max(0, (bal.nonReg - nonRegBook) / bal.nonReg) : 0
          const nonRegGainTaxable = fromNonReg * gainFraction * CAPITAL_GAINS_INCLUSION
          if (bal.nonReg > 0) nonRegBook -= (fromNonReg / bal.nonReg) * nonRegBook
          bal.nonReg -= fromNonReg
          remaining -= fromNonReg
          const fromRrsp = Math.min(remaining, bal.rrsp)
          bal.rrsp -= fromRrsp
          remaining -= fromRrsp
          dpAccumTaxable = nonRegGainTaxable + fromRrsp
          dpAccumTax = dpAccumTaxable * (inputs.accumulationMarginalRate ?? 0.35)
          bal.nonReg -= dpAccumTax
        } else {
          downPaymentSpend = remaining
        }
      }
      prValue = plannedPurchase.price
    }

    // FHSA matures into the RRSP (tax-free, no room impact) the moment it
    // hits its 15-year clock or age 71, whichever comes first — from then on
    // it's ordinary RRSP money, so no separate withdrawal/tax path is needed.
    if (fhsaActive && inputs.fhsa) {
      const yearsOpen = inputs.fhsa.openedYearsAgo + yearIdx
      if (yearsOpen >= 15 || age >= 71) {
        bal.rrsp += fhsaBal
        fhsaBal = 0
        fhsaActive = false
      }
    }

    // principal residence sale: tax-free; any linked mortgage is discharged
    // from the proceeds (a plain cash-flow cost until then — its interest
    // isn't deductible, unlike a rental's)
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
    // net change in living costs from a future purchase (rent saved, property
    // tax/insurance/maintenance added, etc. — excludes the mortgage payment
    // itself, already in debtPayment above); stops once sold like the mortgage
    const netHoldingCost = plannedPurchase && prValue > 0 ? plannedPurchase.netHoldingCostChange : 0
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

    // employer pension runs on each person's own timeline, like CPP/OAS
    const pension =
      pensionPaid(inputs.pension, age, inflation) +
      (partner ? pensionPaid(partner.pension, partnerAge!, inflation) : 0)

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
      // FHSA contribution is carved out of annualSavings before the
      // remainder is split across the three accounts
      const fhsaContribution =
        fhsaActive && inputs.fhsa ? Math.min(inputs.annualSavings, inputs.fhsa.annualContribution) : 0
      fhsaBal += fhsaContribution
      // a future mortgage/holding-cost change isn't already netted out of
      // annualSavings the way existing debts are assumed to be (the user set
      // that figure before this purchase existed)
      const futureMortgagePayment = plannedPurchase ? prMortgage?.payments[yearIdx] ?? 0 : 0
      const remainingSavings =
        inputs.annualSavings - fhsaContribution - futureMortgagePayment - netHoldingCost
      for (const t of ACCOUNT_TYPES) {
        const c = remainingSavings * (inputs.savingsSplit[t] ?? 0)
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
      const benefitBase = cpp + oasGross + pension
      const benefitTax = benefitBase * marginal
      bal.nonReg += benefitBase - benefitTax
      nonRegBook += benefitBase - benefitTax
      oas = oasGross
      tax = dragTax + rentTax + benefitTax + dpAccumTax
      const cppTax = benefitBase > 0 ? benefitTax * (cpp / benefitBase) : 0
      const pensionTax = benefitBase > 0 ? benefitTax * (pension / benefitBase) : 0
      taxBySource = {
        rrsp: 0, nonReg: dragTax, cpp: cppTax, oas: benefitTax - cppTax - pensionTax,
        property: rentTax + dpAccumTax, extraIncome: 0, pension: pensionTax,
      }
      taxableBySource = {
        rrsp: 0, nonReg: dist, cpp, oas: oasGross,
        property: rent - rentMortgageInterest + dpAccumTaxable, extraIncome: 0, pension,
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
          cpp + pension + extraTaxable + rent + extraIncome +
          oasGrossPerPerson.reduce((s, x) => s + x, 0)
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

      // debt payments come on top of living expenses until paid off; a
      // future purchase's down payment (net of FHSA/TFSA) and net holding
      // cost change are one-off/ongoing additions the solver funds like any
      // other spending, taxing whatever it draws per the chosen strategy
      const spendTarget = inputs.retirementSpending + debtPayment + downPaymentSpend + netHoldingCost
      const out = solveWithdrawals(
        spendTarget, bal, forcedRrsp, gainFraction, cpp, pension,
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
        pension: taxShare(pension),
      }
      taxableBySource = {
        rrsp: withdrawals.rrsp,
        nonReg: dist + nonRegGainTaxable,
        cpp,
        oas,
        property: propertyTaxable,
        extraIncome,
        pension,
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
    // FHSA piggybacks on the RRSP return/volatility assumption (same asset mix)
    if (fhsaActive) {
      fhsaBal *= 1 + (sample ? sample(age, 'rrsp') : inputs.returns.rrsp) - (inputs.fees ?? 0)
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
      pension,
      tax, netCash, shortfall,
      propertyValue: prValue + ipTotal,
      fhsaBalance: fhsaBal,
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
  // in the rare case life expectancy is reached before the FHSA's 15-year
  // clock or age 71 (it must mature by one of those), its balance is still
  // tax-free like an on-time rollover would have been
  const finalNetWorth = bal.tfsa + bal.rrsp + bal.nonReg + fhsaBal + prValue + ipTotal - finalDebt
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
