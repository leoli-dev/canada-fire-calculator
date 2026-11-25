import type { Inputs } from './engine'
import type { InputsV2 } from './engine/model'
import { fixedReturnProvider, sampledReturnProvider, SAMPLED_RETURN_SCOPE_UNAVAILABLE, sumNetWorth, type ReturnProvider } from './engine/annualState'
import { canonicalProjectionSnapshot, selectDeterministicResult, type CanonicalDeterministicResult } from './deterministicResult'
import { seededRandom } from './mcProtocol'
import { CANONICAL_MC_VERSION, type CanonicalMcRequest } from './canonicalMcProtocol'

export const CANONICAL_MC_MAX_TRIALS = 200
export const CANONICAL_MC_BUDGET_MS = 8000
export type CanonicalTrialStatus = 'completeZeroGaps' | 'completeWithGaps' | 'partial' | 'blocked' | 'invalid' | 'uncomputed'
export interface CanonicalTrialSummary {
  status: CanonicalTrialStatus
  terminalNetWorth: number | null
  livingGapYears: number[]
  eventGapYears: number[]
  computedYears: number
  blockedYear: number | null
}
export interface CanonicalMonteCarloResult {
  trials: number
  completed: number
  counts: Record<CanonicalTrialStatus, number>
  /** Only available when all requested trials complete; zero actual gaps / completed. Not a FIRE conclusion. */
  successRate: number | null
  outcomes: CanonicalTrialSummary[]
  /** Committed rows only, including partial paths. The cohort can shrink each year. Nominal closing CAD. */
  bands: { year: number; n: number; p10: number; p50: number; p90: number }[]
  stopReason: 'budget' | 'assumptions' | 'scope' | null
  elapsedMs: number
}

/** Calendar-year-major Box-Muller cosine; exactly two nonzero uniform draws per year.
 * Precomputation keeps account enumeration and the reached stop independent of draw order.
 * The fee is subtracted once in real units, then inflation converts to nominal.
 * Truncation at -100% nominal prevents negative account values; it is not a lognormal model.
 */
export function createSampledReturnProvider(plan: InputsV2, volatilityByAccount: Record<string, number | null>, rand: () => number): ReturnProvider {
  volatilityByAccount = { ...volatilityByAccount }
  if (!plan.accounts.every(a => Object.hasOwn(volatilityByAccount, a.id) && typeof volatilityByAccount[a.id] === 'number' &&
    Number.isFinite(volatilityByAccount[a.id]) && volatilityByAccount[a.id]! >= 0 && volatilityByAccount[a.id]! <= 1)) throw new Error('volatility')
  if (!Number.isFinite(plan.inflation) || plan.inflation <= -1 || plan.accounts.some(a => !Number.isFinite(a.realReturn) || !Number.isFinite(a.annualFee) || a.annualFee < 0 || !Number.isFinite((1 + a.realReturn - a.annualFee) * (1 + plan.inflation) - 1) || (1 + a.realReturn - a.annualFee) * (1 + plan.inflation) - 1 < -1)) throw new Error("return assumptions")
  const self = plan.people.find(p => p.role === 'self')
  const years = self ? plan.lifeExpectancy - self.ageInBaseYear + 1 : 0
  if (!Number.isInteger(years) || years < 1 || years > 120) throw new Error('horizon')
  const shocks = new Map<number, number>()
  const uniform = () => {
    // Bound bad injected random sources too; never spin indefinitely on zeros.
    for (let i = 0; i < 64; i++) {
      const value = rand()
      if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('random')
      if (value > 0) return value
    }
    throw new Error('random')
  }
  for (let i = 0; i < years; i++) {
    const u = uniform(), v = uniform()
    shocks.set(plan.baseYear + i, Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v))
  }
  if (plan.accounts.every(a => volatilityByAccount[a.id] === 0)) return fixedReturnProvider
  return sampledReturnProvider((context, id) => {
    const account = context.plan.accounts.find(a => a.id === id)
    const vol = volatilityByAccount[id]
    const z = shocks.get(context.state.year)
    if (!account || typeof vol !== 'number' || z === undefined) return NaN
    // Preserve deterministic floating-point and exact-decimal behavior verbatim.
    if (vol === 0) return fixedReturnProvider(context, id)
    return Math.max(-1, (1 + account.realReturn - account.annualFee + vol * z) * (1 + context.plan.inflation) - 1)
  })
}

/** Sole admission and authenticated annual chain, with only returns injected. */
export function runCanonicalMonteCarloTrial(inputs: Inputs, plan: InputsV2, evidence: { nonRegAbsent: boolean }, provider?: ReturnProvider): CanonicalDeterministicResult {
  if (!plan.deterministicProjection) throw new Error('canonical election required')
  const result = selectDeterministicResult(inputs, plan, evidence, provider)
  if (result.route !== 'canonical') throw new Error('canonical election required')
  return result
}

export function runCanonicalMonteCarlo(request: CanonicalMcRequest): CanonicalMonteCarloResult {
  const start = performance.now()
  if (request.ruleVersion !== CANONICAL_MC_VERSION || !Number.isInteger(request.trials) || request.trials < 1 || request.trials > CANONICAL_MC_MAX_TRIALS ||
    !Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffffffff || !Number.isSafeInteger(request.inputRevision) || request.inputRevision < 0 ||
    typeof request.requestId !== 'string' || !request.requestId || typeof request.sourceId !== 'string' || !request.sourceId || !request.plan?.deterministicProjection) throw new Error('request')
  const plan = canonicalProjectionSnapshot(request.plan, request.evidence)
  const counts: CanonicalMonteCarloResult['counts'] = { completeZeroGaps: 0, completeWithGaps: 0, partial: 0, blocked: 0, invalid: 0, uncomputed: 0 }
  const outcomes: CanonicalTrialSummary[] = []
  const totals = new Map<number, number[]>()
  const rand = seededRandom(request.seed)
  let stopReason: CanonicalMonteCarloResult['stopReason'] = null
  for (let t = 0; t < request.trials; t++) {
    let status: CanonicalTrialStatus
    let result: CanonicalDeterministicResult | null = null
    if (t > 0 && performance.now() - start >= CANONICAL_MC_BUDGET_MS) { status = 'uncomputed'; stopReason = 'budget' }
    else {
      try {
        const provider = createSampledReturnProvider(plan, request.volatilityByAccount, rand)
        result = runCanonicalMonteCarloTrial(request.inputs, request.plan, request.evidence, provider)
        status = result.status === 'complete' ? 'completeZeroGaps' : result.status
        if (result.issues.some(issue => issue.detail === SAMPLED_RETURN_SCOPE_UNAVAILABLE)) stopReason = 'scope'
      } catch { status = 'invalid'; stopReason = 'assumptions' }
    }
    const coverage = result?.coverage
    const livingGapYears = coverage?.rows.filter(row => ((row.householdWithdrawalSettlement ?? row.retirementSettlement)?.spendingUnmet ?? 0) > 0).map(row => row.year) ?? []
    const eventGapYears = coverage?.rows.filter(row => (row.householdExpense?.unmet ?? 0) > 0).map(row => row.year) ?? []
    if (status === 'completeZeroGaps' && (livingGapYears.length || eventGapYears.length || coverage?.state.unfundedEvents.some(e => e.amount > 0))) status = 'completeWithGaps'
    if (coverage) for (const row of coverage.rows) {
      const value = Object.values(row.byAccount).reduce((s, a) => s + a.closing, 0) +
        Object.values(row.byProperty).reduce((s, p) => s + (p.held ? p.closing : 0), 0) -
        Object.values(row.byDebt).reduce((s, d) => s + d.closing, 0) + (row.retirementSettlement?.primaryHomeSaleCash?.closing ?? 0)
      const cohort = totals.get(row.year) ?? []
      cohort.push(value); totals.set(row.year, cohort)
    }
    counts[status]++
    outcomes.push({ status, computedYears: coverage?.rows.length ?? 0, livingGapYears, eventGapYears,
      terminalNetWorth: result?.status === 'complete' && coverage ? sumNetWorth(coverage.state) : null,
      blockedYear: coverage?.blocked?.year ?? (status === 'blocked' || status === 'invalid' ? request.plan.baseYear : null) })
  }
  const completed = counts.completeZeroGaps + counts.completeWithGaps
  const bands = [...totals].map(([year, values]) => {
    values.sort((a, b) => a - b)
    const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))]
    return { year, n: values.length, p10: q(.1), p50: q(.5), p90: q(.9) }
  })
  return { trials: request.trials, completed, counts, successRate: completed === request.trials ? counts.completeZeroGaps / completed : null,
    outcomes, bands, stopReason, elapsedMs: performance.now() - start }
}
