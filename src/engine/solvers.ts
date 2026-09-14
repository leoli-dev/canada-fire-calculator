import { pensionPaid, runProjection } from './projection'
import { buildDebtStream, releasedMortgagePayment, rollDebtsForward, yearStartSale } from './debts'
import { cppAnnual, earlyClaimDilutionRelief, oasAnnual } from './benefits'
import { validateInputs } from './validate'
import { hasUnverifiedLockedWithdrawals } from './capabilities'
import type { InputsV2 } from './model'
import {
  ACCOUNT_TYPES,
  STRATEGIES,
  type Inputs,
  type Mortgage,
  type ProjectionResult,
  type Strategy,
} from './types'

export type SolverStatus = 'solved' | 'infeasible' | 'invalid' | 'unsupported' | 'searchLimit'

type SolverEvidence = {
  assumptions: string[]
  /** Last candidate actually evaluated, in the same units as value. */
  lastVerifiedBound: number | null
  iterations: number
  /** Feasible closing net worth, or negative largest annual cash shortfall when failed. */
  residual: number | null
  reason?: string
}

export type SolverResult<T> = SolverEvidence & (
  | { status: 'solved'; value: T }
  | { status: Exclude<SolverStatus, 'solved'>; value: null }
)

function outcome(status: 'solved', value: number, assumptions: string[],
  lastVerifiedBound: number | null, iterations: number, residual: number | null, reason?: string): SolverResult<number>
function outcome(status: Exclude<SolverStatus, 'solved'>, value: null, assumptions: string[],
  lastVerifiedBound: number | null, iterations: number, residual: number | null, reason?: string): SolverResult<number>
function outcome(status: SolverStatus, value: number | null, assumptions: string[],
  lastVerifiedBound: number | null, iterations: number, residual: number | null, reason?: string): SolverResult<number> {
  const finiteBound = lastVerifiedBound !== null && Number.isFinite(lastVerifiedBound) ? lastVerifiedBound : null
  const finiteResidual = residual !== null && Number.isFinite(residual) ? residual : null
  if (status === 'solved' && (value === null || !Number.isFinite(value)))
    return { status: 'invalid', value: null, assumptions, lastVerifiedBound: finiteBound,
      iterations, residual: finiteResidual, reason: 'nonFiniteResult' }
  return { status, value, assumptions, lastVerifiedBound: finiteBound,
    iterations, residual: finiteResidual, reason } as SolverResult<number>
}

const cashResidual = (result: ProjectionResult): number | null => {
  if (result.success) return Number.isFinite(result.finalNetWorth) ? result.finalNetWorth : null
  const gap = Math.max(0, ...result.rows.map((row) => row.shortfall),
    ...result.unfundedObligations.map((item) => item.amount))
  return Number.isFinite(gap) && gap > 0 ? -gap : null
}

/**
 * A positive funding or age claim is only as verified as the disposal tax it
 * depends on. `nonRegisteredLoss` is reported by the projection only once a
 * withdrawal settles an unrealized loss (superficial-loss and carry facts are
 * not modeled), and `investmentPropertySale` once any modeled property
 * disposition runs without a land/building split or CCA history.
 */
const capitalTaxReason = (result: ProjectionResult): 'investmentPropertySale' | 'nominalCapitalBasis' | null =>
  result.capitalTaxLimit === 'investmentPropertySale' ? 'investmentPropertySale'
    : result.capitalTaxLimit === 'nonRegisteredLoss' ? 'nominalCapitalBasis' : null

/**
 * The legacy `nonRegBook` scalar is a last-valid value, not a tax fact. It is
 * usable only when no canonical plan exists, or when exactly one
 * non-registered account carries a known basis matching both the visible
 * balance and the scalar.
 */
const nonRegScalarUnverified = (inputs: Inputs, canonical?: InputsV2 | null): boolean => {
  if (inputs.balances.nonReg <= 0 || !canonical) return false
  const [account, ...rest] = canonical.accounts.filter(
    item => item.kind === 'nonReg' && item.balance > 0)
  return !account || rest.length > 0 || account.acb.status !== 'known' ||
    account.balance !== inputs.balances.nonReg || account.acb.value !== inputs.nonRegBook
}

/** Cost above value is an unrealized loss; its eligibility and carry are unmodeled. */
const nonRegLossUnverified = (inputs: Inputs): boolean =>
  inputs.balances.nonReg > 0 && inputs.nonRegBook > inputs.balances.nonReg + 1e-8

const hasNonFiniteNumber = (value: unknown): boolean => {
  if (typeof value === 'number') return !Number.isFinite(value)
  if (Array.isArray(value)) return value.some(hasNonFiniteNumber)
  if (value !== null && typeof value === 'object') return Object.values(value).some(hasNonFiniteNumber)
  return false
}

const checkedProjection = (inputs: Inputs): ProjectionResult => {
  const result = runProjection(inputs)
  if (hasNonFiniteNumber(result)) throw new RangeError('nonFiniteProjection')
  return result
}

/** Validate the complete numeric input tree before validation or projection can derive NaN/Infinity. */
const numericInputIssue = (inputs: Inputs): string | null => {
  const check = (value: unknown, path: string, required: string[], optional: string[] = []): string | null => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return path
    const record = value as Record<string, unknown>
    for (const key of required) {
      if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) return `${path}.${key}`
    }
    for (const key of optional) {
      if (record[key] != null && (typeof record[key] !== 'number' || !Number.isFinite(record[key])))
        return `${path}.${key}`
    }
    return null
  }
  const array = (value: unknown, path: string, validate: (item: unknown, path: string) => string | null): string | null => {
    if (value == null) return null
    if (!Array.isArray(value)) return path
    for (let i = 0; i < value.length; i++) {
      const issue = validate(value[i], `${path}.${i}`)
      if (issue) return issue
    }
    return null
  }
  const mortgage = (value: unknown, path: string) => check(value, path, ['balance', 'annualPayment', 'yearsRemaining'])
  const pension = (value: unknown, path: string) => check(value, path, ['annualAmount', 'startAge', 'indexation', 'bridgeAnnual'])
  const cppWork = (value: unknown, path: string) => check(value, path, ['startWorkAge', 'retireAge'])
  const root = check(inputs, 'inputs', [
    'currentAge', 'fireAge', 'lifeExpectancy', 'annualSavings', 'retirementSpending',
    'nonRegBook', 'cppStartAge', 'cppAnnualAt65', 'oasStartAge', 'oasAnnualAt65',
  ], ['fees', 'nonRegDistributionYield', 'accumulationMarginalRate', 'inflation', 'fireTargetAssets'])
  if (root) return root
  for (const field of ['balances', 'returns', 'savingsSplit'] as const) {
    const issue = check(inputs[field], field, ['tfsa', 'rrsp', 'nonReg'])
    if (issue) return issue
  }
  if (inputs.volatilities != null) {
    const issue = check(inputs.volatilities, 'volatilities', ['tfsa', 'rrsp', 'nonReg'])
    if (issue) return issue
  }
  if (inputs.cppWork != null) { const issue = cppWork(inputs.cppWork, 'cppWork'); if (issue) return issue }
  if (inputs.pension != null) { const issue = pension(inputs.pension, 'pension'); if (issue) return issue }
  if (inputs.partner != null) {
    const issue = check(inputs.partner, 'partner', ['currentAge', 'cppStartAge', 'cppAnnualAt65', 'oasStartAge', 'oasAnnualAt65'])
    if (issue) return issue
    if (inputs.partner.cppWork != null) { const nested = cppWork(inputs.partner.cppWork, 'partner.cppWork'); if (nested) return nested }
    if (inputs.partner.pension != null) { const nested = pension(inputs.partner.pension, 'partner.pension'); if (nested) return nested }
  }
  if (inputs.extraIncome != null) {
    const issue = check(inputs.extraIncome, 'extraIncome', ['annual', 'fromAge', 'toAge'])
    if (issue) return issue
  }
  const residence = inputs.principalResidence
  if (residence != null) {
    const issue = residence.mode === 'planned'
      ? check(residence, 'principalResidence', ['buyAtAge', 'price', 'downPayment', 'appreciation', 'netHoldingCostChange'], ['annualMortgagePayment', 'mortgageYears', 'sellAtAge'])
      : check(residence, 'principalResidence', ['value', 'appreciation'], ['sellAtAge'])
    if (issue) return issue
    if (residence.mode !== 'planned' && residence.mortgage != null) {
      const nested = mortgage(residence.mortgage, 'principalResidence.mortgage')
      if (nested) return nested
    }
  }
  const properties = array(inputs.investmentProperties, 'investmentProperties', (item, path) => {
    const issue = check(item, path, ['value', 'acb', 'appreciation'], ['sellAtAge', 'annualRent', 'saleExpenses'])
    if (issue) return issue
    const property = item as NonNullable<Inputs['investmentProperties']>[number]
    return property.mortgage != null ? mortgage(property.mortgage, `${path}.mortgage`) : null
  })
  if (properties) return properties
  const debts = array(inputs.debts, 'debts', mortgage)
  if (debts) return debts
  if (inputs.fhsa != null) { const issue = check(inputs.fhsa, 'fhsa', ['balance', 'annualContribution', 'openedYearsAgo']); if (issue) return issue }
  if (inputs.lockedRetirement != null) {
    const issue = check(inputs.lockedRetirement, 'lockedRetirement', ['balance', 'employeeContribution', 'employerContribution', 'accessibleAge'])
    if (issue) return issue
  }
  return array(inputs.children, 'children', (item, path) => check(item, path, ['age']))
}

const invalidReason = (inputs: Inputs): string | null => {
  const numeric = numericInputIssue(inputs)
  if (numeric) return numeric
  const issue = validateInputs(inputs).find((x) => x.severity === 'error' && !x.eventId)
  if (issue) return issue.field
  return null
}

/** Mode "when can I retire": calendar-year linear scan, with fixed benefit estimates. */
function findEarliestFireAgeImpl(inputs: Inputs, canonical?: InputsV2 | null): SolverResult<number> {
  const assumptions = ['fixedBenefitEstimates', 'currentSavingsPlan', 'calendarYearScan']
  const invalid = invalidReason(inputs)
  if (invalid) return outcome('invalid', null, assumptions, null, 0, null, invalid)
  const cap = inputs.lifeExpectancy - 1
  let iterations = 0
  let lastProjection: ProjectionResult | null = null
  let unsupportedProjection: ProjectionResult | null = null
  for (let age = inputs.currentAge; age <= cap; age++) {
    const projection = checkedProjection({ ...inputs, fireAge: age })
    lastProjection = projection
    iterations++
    if (projection.unfundedObligations.length > 0) {
      unsupportedProjection ??= projection
      continue
    }
    if (projection.success) {
      if (hasUnverifiedLockedWithdrawals(inputs))
        return outcome('unsupported', null, assumptions, null, iterations, null, 'lockedWithdrawalLimits')
      // Only a positive age claim needs withholding: if no age can fund the
      // plan, a failing verdict is not made more optimistic by missing tax.
      if (nonRegScalarUnverified(inputs, canonical))
        return outcome('unsupported', null, assumptions, age, iterations, cashResidual(projection), 'nominalCapitalBasis')
      const capitalReason = capitalTaxReason(projection)
      if (capitalReason)
        return outcome('unsupported', null, assumptions, age, iterations, cashResidual(projection), capitalReason)
      return outcome('solved', age, assumptions, age, iterations, projection.finalNetWorth)
    }
  }
  if (unsupportedProjection)
    return outcome('unsupported', null, assumptions, iterations ? cap : null, iterations,
      cashResidual(unsupportedProjection), 'unfundedTransaction')
  return outcome('infeasible', null, assumptions, iterations ? cap : null, iterations,
    lastProjection ? cashResidual(lastProjection) : null, 'noFeasibleAge')
}

export function findEarliestFireAge(inputs: Inputs, canonical?: InputsV2 | null): SolverResult<number> {
  try { return findEarliestFireAgeImpl(inputs, canonical) }
  catch { return outcome('invalid', null, ['fixedBenefitEstimates', 'currentSavingsPlan', 'calendarYearScan'], null, 0, null, 'projectionError') }
}

/**
 * Mode "what's my FIRE number": total portfolio needed at the FIRE age
 * (allocated in the same proportions as today's balances, including an
 * optional locked DC/LIRA side account) for the plan to
 * succeed with no further savings.
 */
function requiredFireAssetsImpl(inputs: Inputs, canonical?: InputsV2 | null): SolverResult<number> {
  const assumptions = ['fireYearSnapshot', 'proportionalCurrentAccountAllocation', 'fixedBenefits', 'noFurtherSavings']
  const invalid = invalidReason(inputs)
  if (invalid) return outcome('invalid', null, assumptions, null, 0, null, invalid)
  // This quick FIRE-year estimator does not replay a future purchase. A
  // numeric answer would omit its cash outflow while keeping the rest of the
  // plan, so expose unsupported instead of a fabricated threshold.
  if (inputs.principalResidence?.mode === 'planned')
    return outcome('unsupported', null, assumptions, null, 0, null, 'plannedPurchase')
  // A FIRE-year snapshot cannot infer how earlier sale proceeds were invested.
  if ((inputs.principalResidence?.sellAtAge ?? Infinity) < inputs.fireAge ||
      (inputs.investmentProperties ?? []).some((p) => (p.sellAtAge ?? Infinity) < inputs.fireAge))
    return outcome('unsupported', null, assumptions, null, 0, null, 'preFireSale')
  if ((inputs.investmentProperties ?? []).some(property => property.sellAtAge != null))
    return outcome('unsupported', null, assumptions, null, 0, null, 'investmentPropertySale')
  if ((inputs.lockedRetirement?.balance ?? 0) > 0 &&
      inputs.balances.tfsa + inputs.balances.rrsp + inputs.balances.nonReg === 0 &&
      inputs.fireAge < inputs.lockedRetirement!.accessibleAge)
    return outcome('unsupported', null, assumptions, 0, 0, null, 'lockedOnlyBridge')
  if (hasUnverifiedLockedWithdrawals(inputs))
    return outcome('unsupported', null, assumptions, null, 0, null, 'lockedWithdrawalLimits')
  // Re-basing currentAge to FIRE discards the real path of nominal ACB.
  // Candidate T is a hypothetical FIRE-year portfolio, so neither a present
  // holding nor future buys/reinvestments can be assigned a verified basis.
  // The same limitation applies to an investment property carried forward.
  if (inputs.fireAge > inputs.currentAge && (
    inputs.balances.nonReg > 0 || inputs.annualSavings > 0 && inputs.savingsSplit.nonReg > 0 ||
    (inputs.investmentProperties?.length ?? 0) > 0))
    return outcome('unsupported', null, assumptions, null, 0, null, 'nominalCapitalBasis')
  // A same-year snapshot can reuse a verified basis, but the scalar legacy
  // adapter is only a last-valid value. Unknown canonical ACB is not a tax
  // fact, and an unrealized loss needs unmodeled eligibility/carry treatment.
  if (nonRegLossUnverified(inputs) || nonRegScalarUnverified(inputs, canonical))
    return outcome('unsupported', null, assumptions, null, 0, null, 'nominalCapitalBasis')
  if (checkedProjection(inputs).unfundedObligations.length > 0)
    return outcome('unsupported', null, assumptions, null, 0, null, 'unfundedTransaction')
  // With the snapshot's own basis verified, the plan can still realize a loss
  // while it runs (reinvested distributions against a flat market), and a
  // modeled property sale still lacks land/building and CCA facts. Either way
  // the threshold itself is not verified.
  const planCapitalReason = capitalTaxReason(checkedProjection(inputs))
  if (planCapitalReason)
    return outcome('unsupported', null, assumptions, null, 0, null, planCapitalReason)
  const b = inputs.balances
  const lockedBalance = inputs.lockedRetirement?.balance ?? 0
  const total = b.tfsa + b.rrsp + b.nonReg + lockedBalance
  const prop =
    total > 0
      ? { tfsa: b.tfsa / total, rrsp: b.rrsp / total, nonReg: b.nonReg / total, locked: lockedBalance / total }
      : { tfsa: 1 / 3, rrsp: 1 / 3, nonReg: 1 / 3, locked: 0 }
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
  // through would count the house twice. Earlier sales of either property
  // type and planned purchases returned unsupported above because this
  // snapshot estimator cannot replay their earlier cash flows.
  const pr =
    inputs.principalResidence &&
    (inputs.principalResidence.sellAtAge === null ||
      inputs.principalResidence.sellAtAge >= inputs.fireAge)
      ? inputs.principalResidence
      : null
  const project = (T: number) =>
    checkedProjection({
      ...inputs,
      currentAge: inputs.fireAge,
      fireAge: inputs.fireAge,
      annualSavings: 0,
      balances: { tfsa: T * prop.tfsa, rrsp: T * prop.rrsp, nonReg: T * prop.nonReg },
      nonRegBook: T * prop.nonReg * bookRatio,
      lockedRetirement: inputs.lockedRetirement
        ? { ...inputs.lockedRetirement, balance: T * prop.locked, employeeContribution: 0, employerContribution: 0 }
        : null,
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
    })

  let lo = 0
  let hi = 1_000_000
  let iterations = 0
  const evaluate = (candidate: number) => { iterations++; return project(candidate) }
  const zero = evaluate(0)
  if (zero.unfundedObligations.length > 0)
    return outcome('unsupported', null, assumptions, 0, iterations, cashResidual(zero), 'unfundedTransaction')
  if (zero.success) return outcome('solved', 0, assumptions, 0, iterations, zero.finalNetWorth)
  let upper = evaluate(hi)
  if (upper.unfundedObligations.length > 0)
    return outcome('unsupported', null, assumptions, hi, iterations, cashResidual(upper), 'unfundedTransaction')
  while (!upper.success && hi < 100_000_000) {
    hi *= 2
    upper = evaluate(hi)
    if (upper.unfundedObligations.length > 0)
      return outcome('unsupported', null, assumptions, hi, iterations, cashResidual(upper), 'unfundedTransaction')
  }
  if (!upper.success)
    return outcome('searchLimit', null, assumptions, hi, iterations, cashResidual(upper), 'noFeasibleUpperBound')
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    const result = evaluate(mid)
    if (result.unfundedObligations.length > 0)
      return outcome('unsupported', null, assumptions, mid, iterations, cashResidual(result), 'unfundedTransaction')
    if (result.success) { hi = mid; upper = result }
    else lo = mid
  }
  return outcome('solved', hi, assumptions, hi, iterations, upper.finalNetWorth)
}

export function requiredFireAssets(inputs: Inputs, canonical?: InputsV2 | null): SolverResult<number> {
  try { return requiredFireAssetsImpl(inputs, canonical) }
  catch { return outcome('invalid', null, ['fireYearSnapshot', 'proportionalCurrentAccountAllocation', 'fixedBenefits', 'noFurtherSavings'], null, 0, null, 'projectionError') }
}

export interface StrategyResult {
  strategy: Strategy
  result: ProjectionResult
  /** lifetime income tax plus the deemed-disposition tax at death */
  totalTax: number
  /** die-with-zero metric; present when requested */
  maxSpending?: SolverResult<number>
}

export type CandidateStatus = 'feasible' | 'infeasible' | 'invalid' | 'unsupported' | 'searchLimit'
export type CandidateRankingStatus = 'ranked' | 'noFeasibleCandidate' | 'unrankedObjective'
export interface RankedCandidate<T> {
  value: T
  inputs: Inputs
  result: ProjectionResult | null
  solver?: SolverResult<number>
  status: CandidateStatus
  metric: number | null
  /** Largest unpaid annual amount; useful for comparing failures, never a ranking score. */
  gap: number | null
  reason?: string
}

/** Assess obligations and support before an objective is allowed to rank a candidate. */
export function rankCandidates<T>(
  candidates: { value: T; inputs: Inputs; result?: ProjectionResult; solver?: SolverResult<number> }[],
  objective: 'estate' | 'maxSpending',
): { status: CandidateRankingStatus; best: RankedCandidate<T> | null; candidates: RankedCandidate<T>[] } {
  const assessed = candidates.map((candidate): RankedCandidate<T> => {
    const { value, inputs, solver } = candidate
    const base = { value, inputs, result: null as ProjectionResult | null, solver, metric: null as number | null,
      gap: null as number | null }
    const invalid = invalidReason(inputs)
    if (invalid) return { ...base, status: 'invalid', reason: invalid }
    try {
      const result = candidate.result ?? checkedProjection(inputs)
      const gap = Math.max(0, ...result.rows.map((row) => row.shortfall),
        ...result.unfundedObligations.map((item) => item.amount))
      const common = { ...base, result, gap: Number.isFinite(gap) && gap > 0 ? gap : null }
      if (result.unfundedObligations.length > 0)
        return { ...common, status: 'unsupported', reason: 'unfundedTransaction' }
      if (!result.success) return { ...common, status: 'infeasible' }
      // The projection releases locked DC/LIRA funds at an age boundary but
      // does not check jurisdiction-specific LIF withdrawal ceilings. A
      // funded modeled path is therefore not a verified recommendation.
      if (hasUnverifiedLockedWithdrawals(inputs))
        return { ...common, status: 'unsupported', reason: 'lockedWithdrawalLimits' }
      if (result.terminalTaxStatus === 'unsupported')
        return { ...common, status: 'unsupported', reason: 'terminalTax' }
      // A recommended strategy or start age is also a positive funding claim,
      // so it needs the same verified disposal tax as the quick answers.
      const capitalReason = capitalTaxReason(result)
      if (capitalReason)
        return { ...common, status: 'unsupported', reason: capitalReason }
      if (objective === 'maxSpending' && solver?.status !== 'solved')
        return { ...common, status: solver?.status ?? 'unsupported', reason: solver?.reason }
      const metric = objective === 'maxSpending' ? solver!.value : result.estateValue
      if (metric === null || !Number.isFinite(metric))
        return { ...common, status: 'invalid', reason: 'nonFiniteResult' }
      return { ...common, status: 'feasible', metric }
    } catch {
      return { ...base, status: 'invalid', reason: 'projectionError' }
    }
  })
  // Stable tie: preserve the caller's candidate order.
  const best = assessed.reduce<RankedCandidate<T> | null>((winner, row) =>
    row.status === 'feasible' && (!winner || row.metric! > winner.metric!) ? row : winner, null)
  const funded = assessed.some((row) => row.result?.success && row.result.unfundedObligations.length === 0)
  return { status: best ? 'ranked' : funded ? 'unrankedObjective' : 'noFeasibleCandidate', best, candidates: assessed }
}

/**
 * Die with Zero: the highest stable real annual spending the plan sustains
 * to life expectancy. Real dollars — constant spending already keeps pace
 * with inflation because returns are inflation-adjusted.
 */
function maxSustainableSpendingImpl(inputs: Inputs, canonical?: InputsV2 | null): SolverResult<number> {
  const assumptions = ['constantRealSpending', 'fixedBenefits', 'currentAccountAllocation']
  const invalid = invalidReason(inputs)
  if (invalid) return outcome('invalid', null, assumptions, null, 0, null, invalid)
  if (inputs.principalResidence?.mode === 'planned')
    return outcome('unsupported', null, assumptions, null, 0, null, 'plannedPurchase')
  let iterations = 0
  const evaluate = (spending: number) => {
    iterations++
    return checkedProjection({ ...inputs, retirementSpending: spending })
  }
  const zero = evaluate(0)
  if (zero.unfundedObligations.length > 0)
    return outcome('unsupported', null, assumptions, 0, iterations, cashResidual(zero), 'unfundedTransaction')
  if (!zero.success) return outcome('infeasible', null, assumptions, 0, iterations, cashResidual(zero), 'zeroSpendingFails')
  if (hasUnverifiedLockedWithdrawals(inputs))
    return outcome('unsupported', null, assumptions, null, iterations, null, 'lockedWithdrawalLimits')
  // A positive ceiling or a funded zero bound needs the same withheld limits.
  if (nonRegScalarUnverified(inputs, canonical))
    return outcome('unsupported', null, assumptions, 0, iterations, cashResidual(zero), 'nominalCapitalBasis')
  const zeroCapitalReason = capitalTaxReason(zero)
  if (zeroCapitalReason)
    return outcome('unsupported', null, assumptions, 0, iterations, cashResidual(zero), zeroCapitalReason)
  let lo = 0
  let hi = 50000
  let lower = zero
  let upper = evaluate(hi)
  if (upper.unfundedObligations.length > 0)
    return outcome('unsupported', null, assumptions, hi, iterations, cashResidual(upper), 'unfundedTransaction')
  while (upper.success && hi < 50_000_000) {
    lo = hi
    lower = upper
    hi *= 2
    upper = evaluate(hi)
    if (upper.unfundedObligations.length > 0)
      return outcome('unsupported', null, assumptions, hi, iterations, cashResidual(upper), 'unfundedTransaction')
  }
  if (upper.success)
    return outcome('searchLimit', null, assumptions, hi, iterations, upper.finalNetWorth, 'noFailingUpperBound')
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    const result = evaluate(mid)
    if (result.unfundedObligations.length > 0)
      return outcome('unsupported', null, assumptions, mid, iterations, cashResidual(result), 'unfundedTransaction')
    if (result.success) { lo = mid; lower = result }
    else hi = mid
  }
  // The annual withdrawal loop treats sub-cent shortfalls as zero. Preserve
  // the exact, already-verified zero candidate at that numerical floor.
  if (lo < 0.01) return outcome('solved', 0, assumptions, 0, iterations, zero.finalNetWorth)
  // The ceiling's own plan must not depend on an unverified disposal tax.
  const winnerCapitalReason = capitalTaxReason(lower)
  if (winnerCapitalReason)
    return outcome('unsupported', null, assumptions, lo, iterations, cashResidual(lower), winnerCapitalReason)
  return outcome('solved', lo, assumptions, lo, iterations, lower.finalNetWorth)
}

export function maxSustainableSpending(inputs: Inputs, canonical?: InputsV2 | null): SolverResult<number> {
  try { return maxSustainableSpendingImpl(inputs, canonical) }
  catch { return outcome('invalid', null, ['constantRealSpending', 'fixedBenefits', 'currentAccountAllocation'], null, 0, null, 'projectionError') }
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
  status: 'supported' | 'unsupported'
  reason?: 'investmentPropertySale'
  /** investable assets entering the FIRE year */
  assetsAtFire: number
  /** age at which the target is first reached if savings continue; null = never */
  reachedAge: number | null
}

/**
 * Goal check: does accumulation alone reach the target? Savings are assumed
 * to continue past the planned FIRE age until the target is hit (delayed
 * FIRE). Planned principal-residence sales count toward investable assets;
 * investment-property sales need a verified tax event and are unsupported.
 * Unsold real estate does not count. `assetsAtFire` is the total entering
 * the FIRE year (plus any sale landing that year), before any further
 * savings or growth. Whether the money then lasts for life is a separate
 * question (the other modes).
 */
export function targetReport(inputs: Inputs, target: number): TargetReport {
  if (inputs.principalResidence?.mode === 'planned')
    return { status: 'unsupported', assetsAtFire: Number.NaN, reachedAge: null }
  // This shortcut has no CCA/land-building history or a nominal owner tax
  // settlement for investment-property dispositions. Withhold *all* target
  // numbers rather than reusing its stale real-value ACB/fee approximation.
  if ((inputs.investmentProperties ?? []).some(property => property.sellAtAge != null))
    return { status: 'unsupported', reason: 'investmentPropertySale', assetsAtFire: Number.NaN, reachedAge: null }
  if (runProjection(inputs).unfundedObligations.length > 0)
    return { status: 'unsupported', assetsAtFire: Number.NaN, reachedAge: null }
  // This shortcut has no source/use ledger for a negative-equity discharge.
  // The event checks below suppress it only when the actual sale-year value
  // cannot clear the opening lien (today's negative equity may recover).
  const bal = { ...inputs.balances }
  // Planned purchases returned unsupported above.
  const pr = inputs.principalResidence
  let prValue = pr?.value ?? 0
  let prSold = false
  const horizon = 100 - inputs.currentAge + 1
  const inflation = inputs.inflation ?? 0.021
  const prMortgage = pr?.mortgage
    ? buildDebtStream([{ kind: 'mortgage', ...pr.mortgage }], horizon, inflation)
    : null
  const ips = (inputs.investmentProperties ?? []).map((p) => ({
    value: p.value,
    appreciation: p.appreciation,
    rent: p.annualRent ?? 0,
    mortgage: p.mortgage
      ? buildDebtStream([{ kind: 'mortgage', ...p.mortgage }], horizon, inflation)
      : null,
  }))
  const marginal = inputs.accumulationMarginalRate ?? 0.35

  let lockedBal = inputs.lockedRetirement?.balance ?? 0
  let total = bal.tfsa + bal.rrsp + bal.nonReg + lockedBal
  let assetsAtFire = total
  let reachedAge: number | null = total >= target ? inputs.currentAge : null

  for (let age = inputs.currentAge; age <= 100; age++) {
    const yearIdx = age - inputs.currentAge
    if (pr && pr.sellAtAge !== null && age >= pr.sellAtAge && prValue > 0) {
      const sale = yearStartSale(prValue, prMortgage, yearIdx)
      if (sale.cashNeeded > 0)
        return { status: 'unsupported', assetsAtFire: Number.NaN, reachedAge: null }
      bal.nonReg += sale.proceeds
      prValue = 0
      prSold = true
    }
    // assets entering FIRE plus any sale landing that year — snapshot before
    // this iteration adds a further year of savings and growth (recording at
    // year-end wrongly credited a whole extra working year)
    if (inputs.lockedRetirement && lockedBal > 0 && age >= inputs.lockedRetirement.accessibleAge) {
      bal.rrsp += lockedBal
      lockedBal = 0
    }
    if (age === inputs.fireAge) assetsAtFire = bal.tfsa + bal.rrsp + bal.nonReg + lockedBal
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
    let benefits = pensionPaid(inputs.pension, age, inflation)
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
      benefits += pensionPaid(p2.pension, pAge, inflation)
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
    const releasedPayments = releasedMortgagePayment(prMortgage, prSold, yearIdx)
    for (const t of ACCOUNT_TYPES) {
      bal[t] += (inputs.annualSavings + releasedPayments) * (inputs.savingsSplit[t] ?? 0)
      bal[t] *= 1 + inputs.returns[t] - (inputs.fees ?? 0)
    }
    if (lockedBal > 0) {
      lockedBal += inputs.lockedRetirement?.employeeContribution ?? 0
      lockedBal += inputs.lockedRetirement?.employerContribution ?? 0
      lockedBal *= 1 + inputs.returns.rrsp - (inputs.fees ?? 0)
    }
    if (prValue > 0 && pr) prValue *= 1 + pr.appreciation
    for (const p of ips) {
      if (p.value > 0) p.value *= 1 + p.appreciation
    }

    total = bal.tfsa + bal.rrsp + bal.nonReg + lockedBal
    if (reachedAge === null && total >= target) reachedAge = age
    if (age >= inputs.fireAge && reachedAge !== null) break
  }
  return { status: 'supported', assetsAtFire, reachedAge }
}

export interface TimingResult {
  cppStartAge: number
  oasStartAge: number
  result: ProjectionResult
}

/** Scan the primary person's CPP and OAS start ages for the best outcome. */
export function scanBenefitTiming(inputs: Inputs): {
  status: CandidateRankingStatus
  best: TimingResult | null
  current: TimingResult
  candidates: RankedCandidate<{ cppStartAge: number; oasStartAge: number }>[]
} {
  const cppCap = inputs.province === 'QC' ? 72 : 70 // QPP defers to 72
  const objective = (inputs.goal ?? 'legacy') === 'dieWithZero' ? 'maxSpending' : 'estate'
  const candidates: { value: { cppStartAge: number; oasStartAge: number }; inputs: Inputs; result: ProjectionResult; solver?: SolverResult<number> }[] = []
  for (let cppAge = 60; cppAge <= cppCap; cppAge++) {
    for (const oasAge of [65, 66, 67, 68, 69, 70]) {
      const variant = { ...inputs, cppStartAge: cppAge, oasStartAge: oasAge }
      const result = runProjection(variant)
      candidates.push({ value: { cppStartAge: cppAge, oasStartAge: oasAge }, inputs: variant, result,
        solver: objective === 'maxSpending' && result.success && result.unfundedObligations.length === 0
          ? maxSustainableSpending(variant) : undefined })
    }
  }
  const current = { cppStartAge: inputs.cppStartAge, oasStartAge: inputs.oasStartAge, result: runProjection(inputs) }
  const currentIndex = candidates.findIndex((candidate) => candidate.value.cppStartAge === current.cppStartAge && candidate.value.oasStartAge === current.oasStartAge)
  if (currentIndex >= 0) candidates.unshift(candidates.splice(currentIndex, 1)[0])
  else
    candidates.push({ value: { cppStartAge: current.cppStartAge, oasStartAge: current.oasStartAge }, inputs,
      result: current.result, solver: objective === 'maxSpending' && current.result.success
        ? maxSustainableSpending(inputs) : undefined })
  const ranked = rankCandidates(candidates, objective)
  return {
    status: ranked.status,
    best: ranked.best?.result ? { ...ranked.best.value, result: ranked.best.result } : null,
    current,
    candidates: ranked.candidates,
  }
}
