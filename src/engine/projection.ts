import {
  ACCOUNT_TYPES,
  type AccountType,
  type Inputs,
  type Phase,
  type ProjectionResult,
  type Strategy,
  type YearRow,
} from './types'
import { incomeTax } from './tax'
import { CAPITAL_GAINS_INCLUSION, FEDERAL, PROVINCIAL } from './taxData'
import {
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
  cashIncome: number,
  workIncome: number,
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
  // sale gains whose proceeds land in non-registered); cashIncome is both
  // taxable and spendable (rent, part-time income)
  const baseTaxable =
    cpp + extraTaxable + cashIncome + w.rrsp + w.nonReg * gainFraction * CAPITAL_GAINS_INCLUSION
  const share = baseTaxable / persons
  let oasNet = 0
  let tax = 0
  for (let i = 0; i < persons; i++) {
    const personOas = oasAfterClawback(oasGrossPerPerson[i], share)
    oasNet += personOas
    // RRIF withdrawals at 65+ qualify as eligible pension income
    const pensionIncome = agesPerPerson[i] >= 65 ? w.rrsp / persons : 0
    tax += incomeTax(share + personOas, inputs.province, {
      age: agesPerPerson[i],
      pensionIncome,
    })
  }
  // GIS: requires receiving OAS; income test on taxable income excl. OAS
  // (TFSA withdrawals are invisible to it; work income gets an exemption)
  const gis = gisAnnual(
    oasGrossPerPerson.map((o) => o > 0),
    baseTaxable,
    workIncome,
  )
  const netCash = cpp + oasNet + gis + cashIncome + w.tfsa + w.rrsp + w.nonReg - tax
  const totalTaxable = baseTaxable + oasNet
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
  cashIncome: number,
  workIncome: number,
  steps: Step[],
  inputs: Inputs,
): WithdrawalOutcome {
  const total = balances.tfsa + balances.rrsp + balances.nonReg
  const run = (G: number) =>
    evaluate(G, balances, forcedRrsp, gainFraction, cpp, oasGrossPerPerson, agesPerPerson, extraTaxable, cashIncome, workIncome, steps, inputs)

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
  const debtStream = buildDebtStream(
    inputs.debts ?? [],
    inputs.lifeExpectancy - inputs.currentAge + 1,
    inputs.inflation ?? 0.021,
  )

  let prValue = inputs.principalResidence?.value ?? 0
  const ips = (inputs.investmentProperties ?? []).map((p) => ({
    value: p.value,
    acb: Math.min(p.acb, p.value),
    appreciation: p.appreciation,
    sellAtAge: p.sellAtAge,
    rent: p.annualRent ?? 0,
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
    let taxablePerPerson = 0
    const yearIdx = age - inputs.currentAge
    const debtPayment = debtStream.payments[yearIdx] ?? 0
    const debtBalance = debtStream.balances[yearIdx] ?? 0

    // principal residence sale: tax-free, proceeds become investable
    const pr = inputs.principalResidence
    if (pr && pr.sellAtAge !== null && age >= pr.sellAtAge && prValue > 0) {
      bal.nonReg += prValue
      nonRegBook += prValue
      prValue = 0
    }
    // investment property sales: gain is 50% taxable; clamped to retirement
    for (const p of ips) {
      if (p.sellAtAge !== null && age >= Math.max(p.sellAtAge, inputs.fireAge) && p.value > 0) {
        extraTaxable += Math.max(0, p.value - p.acb) * CAPITAL_GAINS_INCLUSION
        bal.nonReg += p.value
        nonRegBook += p.value
        p.value = 0
      }
    }
    // net rent from properties still held (stops the year a property sells)
    const rent = ips.reduce((s, p) => s + (p.value > 0 ? p.rent : 0), 0)
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
      // net rent, taxed at the same marginal rate, is saved on top of
      // annualSavings (whose hint tells the user to exclude rent)
      const rentTax = rent * marginal
      bal.nonReg += rent - rentTax
      nonRegBook += rent - rentTax
      // benefits already being collected pre-FIRE are saved after tax at the
      // working marginal rate (no clawback/GIS modelling here — employment
      // income is unknown, so this leans simple; high earners drawing OAS
      // while working would really face the recovery tax)
      const oasGross = oasGrossPerPerson.reduce((s, x) => s + x, 0)
      const benefitTax = (cpp + oasGross) * marginal
      bal.nonReg += cpp + oasGross - benefitTax
      nonRegBook += cpp + oasGross - benefitTax
      oas = oasGross
      tax = dragTax + rentTax + benefitTax
    } else {
      extraTaxable += dist

      const rrifMin = bal.rrsp * rrifMinFactor(age)
      const forcedRrsp = Math.min(bal.rrsp, rrifMin)
      // bracket-capped meltdown: the RRSP funds spending first, but only as
      // much as spending needs and never beyond the room left in the lowest
      // tax bracket (per person) after CPP/OAS. Nothing is withdrawn just to
      // prepay tax; the remainder rides past 71 and exits via RRIF minimums
      // (which also stay far below the OAS clawback threshold). If the other
      // accounts run dry, the RRSP is the uncapped last resort.
      let steps: Step[]
      if (inputs.strategy === 'meltdownPaced') {
        const bracketTop = Math.min(
          FEDERAL.brackets[0].upTo,
          PROVINCIAL[inputs.province].brackets[0].upTo,
        )
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
        oasGrossPerPerson, agesPerPerson, extraTaxable, rent + extraIncome,
        extraIncome, steps, inputs,
      )
      withdrawals = out.withdrawals
      tax = out.tax
      rrspTaxTotal += out.rrspTax
      oas = out.oasNet
      gis = out.gis
      netCash = out.netCash
      taxablePerPerson = out.taxablePerPerson ?? 0

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
      taxablePerPerson,
    })
  }

  const ipTotal = ips.reduce((s, p) => s + p.value, 0)
  const finalDebt = debtStream.balances[inputs.lifeExpectancy - inputs.currentAge] ?? 0
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
  return {
    rows,
    success: depletedAge === null,
    depletedAge,
    finalNetWorth,
    estateTax,
    estateValue: finalNetWorth - estateTax,
    rrspTax: rrspTaxTotal + rrspEstateTax,
  }
}
