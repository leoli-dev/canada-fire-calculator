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
import { cppAnnual, oasAnnual, oasAfterClawback } from './benefits'
import { rrifMinFactor } from './rrif'

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
  const baseTaxable =
    cpp + extraTaxable + w.rrsp + w.nonReg * gainFraction * CAPITAL_GAINS_INCLUSION
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
  const netCash = cpp + oasNet + w.tfsa + w.rrsp + w.nonReg - tax
  const totalTaxable = baseTaxable + oasNet
  const rrspTax = totalTaxable > 0 ? tax * (w.rrsp / totalTaxable) : 0
  const taxablePerPerson = totalTaxable / oasGrossPerPerson.length
  return { withdrawals: w, tax, rrspTax, oasNet, netCash, taxablePerPerson }
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
  steps: Step[],
  inputs: Inputs,
): WithdrawalOutcome {
  const total = balances.tfsa + balances.rrsp + balances.nonReg
  const run = (G: number) =>
    evaluate(G, balances, forcedRrsp, gainFraction, cpp, oasGrossPerPerson, agesPerPerson, extraTaxable, steps, inputs)

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

  let prValue = inputs.principalResidence?.value ?? 0
  let ipValue = inputs.investmentProperty?.value ?? 0
  let ipAcb = inputs.investmentProperty ? Math.min(inputs.investmentProperty.acb, ipValue) : 0

  for (let age = inputs.currentAge; age <= inputs.lifeExpectancy; age++) {
    const phase: Phase =
      age < inputs.fireAge ? 'accumulation' : age < pensionAge ? 'bridge' : 'pension'

    let withdrawals: Record<AccountType, number> = { tfsa: 0, rrsp: 0, nonReg: 0 }
    let cpp = 0
    let oas = 0
    let tax = 0
    let netCash = 0
    let shortfall = 0
    let extraTaxable = 0
    let taxablePerPerson = 0

    // principal residence sale: tax-free, proceeds become investable
    const pr = inputs.principalResidence
    if (pr && pr.sellAtAge !== null && age >= pr.sellAtAge && prValue > 0) {
      bal.nonReg += prValue
      nonRegBook += prValue
      prValue = 0
    }
    // investment property sale: gain is 50% taxable; clamped to retirement
    const ip = inputs.investmentProperty
    if (ip && ip.sellAtAge !== null && age >= Math.max(ip.sellAtAge, inputs.fireAge) && ipValue > 0) {
      extraTaxable = Math.max(0, ipValue - ipAcb) * CAPITAL_GAINS_INCLUSION
      bal.nonReg += ipValue
      nonRegBook += ipValue
      ipValue = 0
    }

    // non-registered tax drag: yearly distributions are taxable when paid,
    // then reinvest (raising the ACB so they aren't taxed again at sale)
    const dist = bal.nonReg * (inputs.nonRegDistributionYield ?? 0)

    if (phase === 'accumulation') {
      for (const t of ACCOUNT_TYPES) {
        const c = inputs.annualSavings * (inputs.savingsSplit[t] ?? 0)
        bal[t] += c
        if (t === 'nonReg') nonRegBook += c
      }
      // working years: distributions taxed at the assumed marginal rate,
      // with the tax paid out of the account
      const dragTax = dist * (inputs.accumulationMarginalRate ?? 0.35)
      bal.nonReg -= dragTax
      nonRegBook += dist - dragTax
      tax = dragTax
    } else {
      extraTaxable += dist
      const partnerAge = partner ? partner.currentAge + (age - inputs.currentAge) : null

      if (age >= inputs.cppStartAge) cpp += cppAnnual(inputs.cppAnnualAt65, inputs.cppStartAge)
      if (partner && partnerAge! >= partner.cppStartAge) {
        cpp += cppAnnual(partner.cppAnnualAt65, partner.cppStartAge)
      }

      const oasGrossPerPerson = [
        age >= inputs.oasStartAge ? oasAnnual(inputs.oasAnnualAt65, inputs.oasStartAge) : 0,
      ]
      const agesPerPerson = [age]
      if (partner) {
        oasGrossPerPerson.push(
          partnerAge! >= partner.oasStartAge
            ? oasAnnual(partner.oasAnnualAt65, partner.oasStartAge)
            : 0,
        )
        agesPerPerson.push(partnerAge!)
      }

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
          cpp + extraTaxable + oasGrossPerPerson.reduce((s, x) => s + x, 0)
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

      const out = solveWithdrawals(
        inputs.retirementSpending, bal, forcedRrsp, gainFraction, cpp,
        oasGrossPerPerson, agesPerPerson, extraTaxable, steps, inputs,
      )
      withdrawals = out.withdrawals
      tax = out.tax
      rrspTaxTotal += out.rrspTax
      oas = out.oasNet
      netCash = out.netCash
      taxablePerPerson = out.taxablePerPerson ?? 0

      if (netCash < inputs.retirementSpending - 0.01) {
        shortfall = inputs.retirementSpending - netCash
        if (depletedAge === null) depletedAge = age
      }

      // reduce ACB proportionally to the non-registered withdrawal
      if (withdrawals.nonReg > 0 && bal.nonReg > 0) {
        nonRegBook -= (withdrawals.nonReg / bal.nonReg) * nonRegBook
      }
      for (const t of ACCOUNT_TYPES) bal[t] -= withdrawals[t]

      // surplus cash (e.g. forced RRIF minimum above spending) reinvests taxed
      const surplus = netCash - inputs.retirementSpending
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
    if (ipValue > 0 && ip) ipValue *= 1 + ip.appreciation

    rows.push({
      age, phase,
      balances: { ...bal },
      withdrawals, cpp, oas, tax, netCash, shortfall,
      propertyValue: prValue + ipValue,
      taxablePerPerson,
    })
  }

  const finalNetWorth = bal.tfsa + bal.rrsp + bal.nonReg + prValue + ipValue
  // deemed disposition at death: RRSP/RRIF fully taxable, gains half taxable;
  // TFSA and the principal residence pass tax-free
  const persons = partner ? 2 : 1
  const nonRegGain = Math.max(0, bal.nonReg - nonRegBook)
  const ipGain = ipValue > 0 ? Math.max(0, ipValue - ipAcb) : 0
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
