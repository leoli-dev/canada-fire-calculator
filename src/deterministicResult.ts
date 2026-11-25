import { runProjection, type Inputs, type ProjectionResult } from './engine'
import type { InputsV2 } from './engine/model'
import { projectCanonicalCoverage, projectCanonicalCoverageWithReturns, type AnnualCoverage, type AnnualIssue, type ReturnProvider } from './engine/annualState'
import { validateInputs, type ValidationIssue } from './engine/validate'

export type CanonicalDeterministicResult = {
  route: 'canonical'
  status: 'complete' | 'partial' | 'blocked' | 'invalid'
  coverage: AnnualCoverage | null
  issues: AnnualIssue[]
  requestedStartYear: number
  requestedYears: number
  /** Ordinary input errors are distinct from a reached canonical coverage stop. */
  validationIssues?: ValidationIssue[]
}
export type DeterministicResult = { route: 'legacy'; result: ProjectionResult } | CanonicalDeterministicResult

/** Sole deterministic routing point. A selected canonical stop never falls back. */
export function selectDeterministicResult(inputs: Inputs, plan: InputsV2 | null, evidence: { nonRegAbsent: boolean }, returns?: ReturnProvider): DeterministicResult {
  if (!plan?.deterministicProjection) return { route: 'legacy', result: runProjection(inputs, undefined, plan ?? undefined, { captureAnnualDetails: true }) }
  const self = plan.people.find(person => person.role === 'self')
  const years = self ? plan.lifeExpectancy - self.ageInBaseYear + 1 : NaN
  const requestedYears = Number.isInteger(years) && years > 0 && years <= 120 ? years : 0
  const base = { route: 'canonical' as const, requestedStartYear: plan.baseYear, requestedYears }
  const validationIssues = validateInputs(inputs, { canonical: true }).filter(issue => issue.severity === 'error')
  if (validationIssues.length) return { ...base, status: 'invalid', coverage: null, issues: [], validationIssues }
  if (plan.deterministicProjection.invalidated || !requestedYears) return { ...base, status: 'invalid', coverage: null,
    issues: [{ code: 'invalid', detail: plan.deterministicProjection.invalidated ? 'deterministic-spending-reconfirmation-required' : 'projection-horizon-invalid' }] }
  const snapshot = canonicalProjectionSnapshot(plan, evidence)
  const projected = returns ? projectCanonicalCoverageWithReturns(snapshot, snapshot.deterministicProjection!.spending, requestedYears, returns)
    : projectCanonicalCoverage(snapshot, snapshot.deterministicProjection!.spending, requestedYears)
  if (projected.status !== 'ok') return { ...base, status: projected.status === 'invalid' ? 'invalid' : 'blocked', coverage: null, issues: projected.issues }
  const coverage = projected.value
  return { ...base, status: coverage.blocked ? (coverage.rows.length ? 'partial' : coverage.blocked.status === 'invalid' ? 'invalid' : 'blocked') : 'complete',
    coverage, issues: coverage.blocked?.issues ?? [] }
}

/** Shared exact admission scope; this never edits the persisted plan. */
export function canonicalProjectionSnapshot(plan: InputsV2, evidence: { nonRegAbsent: boolean }): InputsV2 {
  // Omit only the migration placeholder after an explicit absence answer.
  // This scoped snapshot never removes recorded assets from the persisted plan.
  const snapshot = structuredClone(plan)
  if (evidence.nonRegAbsent && !plan.annualNonRegEvidence) snapshot.accounts = snapshot.accounts.filter(account =>
    !(account.id === 'legacy:account:nonReg' && account.kind === 'nonReg' && account.balance === 0 &&
      account.acb.status === 'known' && account.acb.value === 0 &&
      !plan.contributions.some(item => item.accountId === account.id) &&
      !plan.recurringContributions.some(item => item.accountId === account.id)))
  return snapshot
}
