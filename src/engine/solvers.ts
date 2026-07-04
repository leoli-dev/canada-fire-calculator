import { runProjection } from './projection'
import { incomeTax } from './tax'
import {
  ACCOUNT_TYPES,
  STRATEGIES,
  type Inputs,
  type ProjectionResult,
  type Strategy,
} from './types'

/** Mode "when can I retire": earliest FIRE age whose plan succeeds. */
export function findEarliestFireAge(inputs: Inputs): number | null {
  const cap = Math.min(inputs.lifeExpectancy - 1, 75)
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
  if (hi >= 50_000_000) return hi
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
 * taxed); unsold real estate does not. All values are end-of-year, matching
 * the chart rows. Whether the money then lasts for life is a separate
 * question (the other modes).
 */
export function targetReport(inputs: Inputs, target: number): TargetReport {
  const bal = { ...inputs.balances }
  const pr = inputs.principalResidence
  const ip = inputs.investmentProperty
  let prValue = pr?.value ?? 0
  let ipValue = ip?.value ?? 0
  const ipAcb = ip ? Math.min(ip.acb, ipValue) : 0
  const persons = inputs.partner ? 2 : 1

  let total = bal.tfsa + bal.rrsp + bal.nonReg
  let assetsAtFire = total
  let reachedAge: number | null = total >= target ? inputs.currentAge : null

  for (let age = inputs.currentAge; age <= 100; age++) {
    if (pr && pr.sellAtAge !== null && age >= pr.sellAtAge && prValue > 0) {
      bal.nonReg += prValue
      prValue = 0
    }
    if (ip && ip.sellAtAge !== null && age >= Math.max(ip.sellAtAge, inputs.fireAge) && ipValue > 0) {
      const gainTax =
        incomeTax((Math.max(0, ipValue - ipAcb) * 0.5) / persons, inputs.province) * persons
      bal.nonReg += ipValue - gainTax
      ipValue = 0
    }
    for (const t of ACCOUNT_TYPES) {
      bal[t] += inputs.annualSavings * (inputs.savingsSplit[t] ?? 0)
      bal[t] *= 1 + inputs.returns[t]
    }
    if (prValue > 0 && pr) prValue *= 1 + pr.appreciation
    if (ipValue > 0 && ip) ipValue *= 1 + ip.appreciation

    total = bal.tfsa + bal.rrsp + bal.nonReg
    if (age === inputs.fireAge) assetsAtFire = total
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
  for (let cppAge = 60; cppAge <= 70; cppAge++) {
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
