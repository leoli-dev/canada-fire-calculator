import { runProjection } from './projection'
import { buildDebtStream, rollDebtsForward } from './debts'
import { cppAnnual, earlyClaimDilutionRelief, oasAnnual } from './benefits'
import { incomeTax } from './tax'
import {
  ACCOUNT_TYPES,
  STRATEGIES,
  type Inputs,
  type Mortgage,
  type ProjectionResult,
  type Strategy,
} from './types'

/** Mode "when can I retire": earliest FIRE age whose plan succeeds. */
export function findEarliestFireAge(inputs: Inputs): number | null {
  const cap = inputs.lifeExpectancy - 1
  for (let age = inputs.currentAge; age <= cap; age++) {
    if (runProjection({ ...inputs, fireAge: age }).success) return age
  }
  return null
}

/**
 * Mode "what's my FIRE number": total portfolio needed at the FIRE age
 * (allocated in the same proportions as today's balances) for the plan to
 * succeed with no further savings.
 */
export function requiredFireAssets(inputs: Inputs): number {
  const b = inputs.balances
  const total = b.tfsa + b.rrsp + b.nonReg
  const prop =
    total > 0
      ? { tfsa: b.tfsa / total, rrsp: b.rrsp / total, nonReg: b.nonReg / total }
      : { tfsa: 1 / 3, rrsp: 1 / 3, nonReg: 1 / 3 }
  const bookRatio = b.nonReg > 0 ? inputs.nonRegBook / b.nonReg : 1
  const yearsToFire = inputs.fireAge - inputs.currentAge

  // real estate will have appreciated (and debts amortized) by the FIRE year
  const grow = (v: number, rate: number) => v * Math.pow(1 + rate, Math.max(0, yearsToFire))
  const inflation = inputs.inflation ?? 0.021
  const rollMortgage = (m?: Mortgage): Mortgage | undefined => {
    if (!m) return undefined
    const [rolled] = rollDebtsForward([{ kind: 'mortgage', ...m }], yearsToFire, inflation)
    return rolled
      ? { balance: rolled.balance, annualPayment: rolled.annualPayment, yearsRemaining: rolled.yearsRemaining }
      : undefined
  }
  // a principal residence sold BEFORE the FIRE age is already cash inside the
  // investable balances the user compares this number against — passing it
  // through would count the house twice (IP sales are clamped to FIRE, so
  // they can't double up the same way)
  const pr =
    inputs.principalResidence &&
    (inputs.principalResidence.sellAtAge === null ||
      inputs.principalResidence.sellAtAge >= inputs.fireAge)
      ? inputs.principalResidence
      : null
  const succeeds = (T: number) =>
    runProjection({
      ...inputs,
      currentAge: inputs.fireAge,
      fireAge: inputs.fireAge,
      annualSavings: 0,
      balances: { tfsa: T * prop.tfsa, rrsp: T * prop.rrsp, nonReg: T * prop.nonReg },
      nonRegBook: T * prop.nonReg * bookRatio,
      partner: inputs.partner
        ? { ...inputs.partner, currentAge: inputs.partner.currentAge + yearsToFire }
        : inputs.partner,
      principalResidence: pr
        ? { ...pr, value: grow(pr.value, pr.appreciation), mortgage: rollMortgage(pr.mortgage) }
        : null,
      investmentProperties: (inputs.investmentProperties ?? []).map((p) => ({
        ...p,
        value: grow(p.value, p.appreciation),
        mortgage: rollMortgage(p.mortgage),
      })),
      debts: rollDebtsForward(inputs.debts ?? [], yearsToFire, inflation),
    }).success

  let lo = 0
  let hi = 1_000_000
  while (!succeeds(hi) && hi < 100_000_000) hi *= 2
  if (!succeeds(hi)) return hi
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (succeeds(mid)) hi = mid
    else lo = mid
  }
  return hi
}

export interface StrategyResult {
  strategy: Strategy
  result: ProjectionResult
  /** lifetime income tax plus the deemed-disposition tax at death */
  totalTax: number
  /** die-with-zero metric; present when requested */
  maxSpending?: number
}

/**
 * Die with Zero: the highest stable real annual spending the plan sustains
 * to life expectancy. Real dollars — constant spending already keeps pace
 * with inflation because returns are inflation-adjusted.
 */
export function maxSustainableSpending(inputs: Inputs): number {
  const ok = (s: number) => runProjection({ ...inputs, retirementSpending: s }).success
  let lo = 0
  let hi = 50000
  while (ok(hi) && hi < 50_000_000) {
    lo = hi
    hi *= 2
  }
  // absurd-portfolio exit: return the last level known to succeed, not the
  // untested (or failing) doubled value
  if (hi >= 50_000_000) return lo
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (ok(mid)) lo = mid
    else hi = mid
  }
  return lo
}

/** Deterministic comparison of the withdrawal strategies. */
export function compareStrategies(
  inputs: Inputs,
  opts?: { maxSpending?: boolean },
): StrategyResult[] {
  return STRATEGIES.map((strategy) => {
    const variant = { ...inputs, strategy }
    const result = runProjection(variant)
    return {
      strategy,
      result,
      totalTax: result.rows.reduce((s, r) => s + r.tax, 0) + result.estateTax,
      maxSpending: opts?.maxSpending ? maxSustainableSpending(variant) : undefined,
    }
  })
}

export interface TargetReport {
  /** investable assets entering the FIRE year */
  assetsAtFire: number
  /** age at which the target is first reached if savings continue; null = never */
  reachedAge: number | null
}

/**
 * Goal check: does accumulation alone reach the target? Savings are assumed
 * to continue past the planned FIRE age until the target is hit (delayed
 * FIRE). Planned property sales count toward investable assets (mirroring
 * the projection: principal residence tax-free, investment-property gain
 * taxed); unsold real estate does not. `assetsAtFire` is the total entering
 * the FIRE year (plus any sale landing that year), before any further
 * savings or growth. Whether the money then lasts for life is a separate
 * question (the other modes).
 */
export function targetReport(inputs: Inputs, target: number): TargetReport {
  const bal = { ...inputs.balances }
  const pr = inputs.principalResidence
  let prValue = pr?.value ?? 0
  const horizon = 100 - inputs.currentAge + 1
  const inflation = inputs.inflation ?? 0.021
  const prMortgage = pr?.mortgage
    ? buildDebtStream([{ kind: 'mortgage', ...pr.mortgage }], horizon, inflation)
    : null
  const ips = (inputs.investmentProperties ?? []).map((p) => ({
    value: p.value,
    acb: Math.min(p.acb, p.value),
    appreciation: p.appreciation,
    sellAtAge: p.sellAtAge,
    rent: p.annualRent ?? 0,
    mortgage: p.mortgage
      ? buildDebtStream([{ kind: 'mortgage', ...p.mortgage }], horizon, inflation)
      : null,
  }))
  const persons = inputs.partner ? 2 : 1
  const marginal = inputs.accumulationMarginalRate ?? 0.35

  let total = bal.tfsa + bal.rrsp + bal.nonReg
  let assetsAtFire = total
  let reachedAge: number | null = total >= target ? inputs.currentAge : null

  for (let age = inputs.currentAge; age <= 100; age++) {
    const yearIdx = age - inputs.currentAge
    if (pr && pr.sellAtAge !== null && age >= pr.sellAtAge && prValue > 0) {
      const owed = prMortgage?.balances[yearIdx] ?? 0
      bal.nonReg += prValue - owed
      prValue = 0
    }
    for (const p of ips) {
      if (p.sellAtAge !== null && age >= Math.max(p.sellAtAge, inputs.fireAge) && p.value > 0) {
        const owed = p.mortgage?.balances[yearIdx] ?? 0
        const gainTax =
          incomeTax((Math.max(0, p.value - p.acb) * 0.5) / persons, inputs.province) * persons
        bal.nonReg += p.value - owed - gainTax
        p.value = 0
      }
    }
    // assets entering FIRE plus any sale landing that year — snapshot before
    // this iteration adds a further year of savings and growth (recording at
    // year-end wrongly credited a whole extra working year)
    if (age === inputs.fireAge) assetsAtFire = bal.tfsa + bal.rrsp + bal.nonReg
    // mirror the projection's accumulation-phase tax drag on distributions,
    // and save the after-tax rent from properties still held (a linked
    // mortgage's interest, capped at the rent, is deductible against it)
    bal.nonReg -= bal.nonReg * (inputs.nonRegDistributionYield ?? 0) * marginal
    const rent = ips.reduce((s, p) => s + (p.value > 0 ? p.rent : 0), 0)
    const rentInterest = Math.min(
      rent,
      ips.reduce((s, p) => s + (p.value > 0 ? (p.mortgage?.interest[yearIdx] ?? 0) : 0), 0),
    )
    bal.nonReg += rent - (rent - rentInterest) * marginal
    // ...and benefits already being collected while still working
    const cppMaxAge = inputs.province === 'QC' ? 72 : 70
    let benefits = 0
    if (age >= inputs.cppStartAge) {
      const relief = inputs.cppWork
        ? earlyClaimDilutionRelief(
            inputs.cppWork.startWorkAge, inputs.cppWork.retireAge, inputs.cppStartAge,
          )
        : 1
      benefits += cppAnnual(inputs.cppAnnualAt65, inputs.cppStartAge, cppMaxAge) * relief
    }
    if (age >= inputs.oasStartAge)
      benefits += oasAnnual(inputs.oasAnnualAt65, inputs.oasStartAge) * (age >= 75 ? 1.1 : 1)
    const p2 = inputs.partner
    if (p2) {
      const pAge = p2.currentAge + (age - inputs.currentAge)
      if (pAge >= p2.cppStartAge) {
        const relief = p2.cppWork
          ? earlyClaimDilutionRelief(p2.cppWork.startWorkAge, p2.cppWork.retireAge, p2.cppStartAge)
          : 1
        benefits += cppAnnual(p2.cppAnnualAt65, p2.cppStartAge, cppMaxAge) * relief
      }
      if (pAge >= p2.oasStartAge)
        benefits += oasAnnual(p2.oasAnnualAt65, p2.oasStartAge) * (pAge >= 75 ? 1.1 : 1)
    }
    bal.nonReg += benefits * (1 - marginal)
    for (const t of ACCOUNT_TYPES) {
      bal[t] += inputs.annualSavings * (inputs.savingsSplit[t] ?? 0)
      bal[t] *= 1 + inputs.returns[t] - (inputs.fees ?? 0)
    }
    if (prValue > 0 && pr) prValue *= 1 + pr.appreciation
    for (const p of ips) {
      if (p.value > 0) p.value *= 1 + p.appreciation
    }

    total = bal.tfsa + bal.rrsp + bal.nonReg
    if (reachedAge === null && total >= target) reachedAge = age
    if (age >= inputs.fireAge && reachedAge !== null) break
  }
  return { assetsAtFire, reachedAge }
}

export interface TimingResult {
  cppStartAge: number
  oasStartAge: number
  result: ProjectionResult
}

const better = (a: ProjectionResult, b: ProjectionResult) =>
  a.success !== b.success
    ? a.success
    : a.success
      ? a.estateValue > b.estateValue
      : (a.depletedAge ?? 0) > (b.depletedAge ?? 0)

/** Scan the primary person's CPP and OAS start ages for the best outcome. */
export function scanBenefitTiming(inputs: Inputs): { best: TimingResult; current: TimingResult } {
  let best: TimingResult | null = null
  const cppCap = inputs.province === 'QC' ? 72 : 70 // QPP defers to 72
  for (let cppAge = 60; cppAge <= cppCap; cppAge++) {
    for (const oasAge of [65, 66, 67, 68, 69, 70]) {
      const result = runProjection({ ...inputs, cppStartAge: cppAge, oasStartAge: oasAge })
      if (!best || better(result, best.result)) {
        best = { cppStartAge: cppAge, oasStartAge: oasAge, result }
      }
    }
  }
  return {
    best: best!,
    current: {
      cppStartAge: inputs.cppStartAge,
      oasStartAge: inputs.oasStartAge,
      result: runProjection(inputs),
    },
  }
}
