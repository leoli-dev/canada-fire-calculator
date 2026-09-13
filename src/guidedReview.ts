import type { Inputs, ProjectionResult } from './engine'
import type { AnswerMeta } from './store'

export const GUIDED_REQUIRED_FIELDS = [
  'goal', 'currentAge', 'fireAge', 'lifeExpectancy', 'province', 'household',
  'annualSavings', 'balances.tfsa', 'balances.rrsp', 'balances.nonReg',
  'nonRegBook', 'housingMode', 'retirementSpending',
  'cppStartAge', 'cppAnnualAt65', 'oasStartAge', 'oasAnnualAt65',
]

export function answerIsUsable(meta: AnswerMeta | undefined): boolean {
  return !!meta && meta.status !== 'unknown' && meta.origin !== 'example'
}

export function guidedRequiredFields(inputs?: Inputs): string[] {
  const conditional = [
    ...(inputs?.partner ? [
      'partner.currentAge', 'partner.cppStartAge', 'partner.cppAnnualAt65',
      'partner.oasStartAge', 'partner.oasAnnualAt65',
    ] : []),
    ...(inputs?.fhsa ? ['fhsa.balance', 'fhsa.annualContribution', 'fhsa.openedYearsAgo'] : []),
    ...(inputs?.lockedRetirement ? ['lockedRetirement.balance', 'lockedRetirement.accessibleAge',
      ...(inputs.partner ? ['lockedRetirement.owner'] : [])] : []),
  ]
  return [...GUIDED_REQUIRED_FIELDS, ...conditional]
}

export function guidedPlanReady(answerMeta: Record<string, AnswerMeta>, inputs?: Inputs): boolean {
  return guidedRequiredFields(inputs).every((field) => answerIsUsable(answerMeta[field]) &&
    (field !== 'lockedRetirement.owner' || answerMeta[field]?.status === 'confirmed'))
}

export interface AccountSummary {
  mainAccounts: number
  fhsa: number
  locked: number
  totalAccounts: number
  accessibleNow: number
}

export function accountSummary(inputs: Inputs): AccountSummary {
  const mainAccounts = inputs.balances.tfsa + inputs.balances.rrsp + inputs.balances.nonReg
  const fhsa = inputs.fhsa?.balance ?? 0
  const locked = inputs.lockedRetirement?.balance ?? 0
  return {
    mainAccounts,
    fhsa,
    locked,
    totalAccounts: mainAccounts + fhsa + locked,
    // FHSA is purpose-restricted and locked funds are unavailable before
    // accessibleAge. Keep the conservative current-liquidity label separate.
    accessibleNow: mainAccounts,
  }
}

export interface GuidedResultSummary {
  success: boolean
  depletedAge: number | null
  need: number
  available: number
  shortfall: number
}

export function guidedResultSummary(result: ProjectionResult): GuidedResultSummary {
  const row = result.depletedAge == null
    ? result.rows.at(-1)
    : result.rows.find((candidate) => candidate.age === result.depletedAge)
  return {
    success: result.success,
    depletedAge: result.depletedAge,
    need: row ? row.netCash + row.shortfall : 0,
    available: row?.netCash ?? 0,
    shortfall: row?.shortfall ?? 0,
  }
}
