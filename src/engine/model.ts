import type { AccountType, CppWork, Goal, Inputs, MeltdownCap, Pension, PensionAmountProvenance, Province, Strategy } from './types'

export type EntityId = string
export type Known<T> = { status: 'known'; value: T } | { status: 'unknown'; reason: string }
/** Calendar-month prescription coverage. A confirmed waiver is a tax fact, not an inferred low-income exemption. */
export type QcDrugCoverage = 'public' | 'private' | 'waived' | 'unknown'
export type Provenance = { origin: 'user' | 'legacy' | 'estimated' | 'unknown'; sourceYear: number | null; note?: string }
export type TaxShares = { status: 'known'; shares: Record<EntityId, number> } | { status: 'unknown'; reason: string }
/**
 * Whether the contributions recorded for one spousal plan are its complete
 * premium history. `unknown` is never "no premiums": attribution stays
 * unsupported until the history is confirmed, and a `complete` entry with no
 * rows is a real zero-premium history.
 */
export type SpousalHistoryStatus = { status: 'complete' } | { status: 'unknown'; reason: string }
export interface Person {
  id: EntityId
  role: 'self' | 'partner'
  /** Age reached during baseYear, not age on January 1. */
  ageInBaseYear: number
  retirementAge: number
  earnedIncome: Known<number>
  previousYearEarnedIncome: Known<number>
  rrspDeductionLimit: Known<number>
  rrspAvailableRoom: Known<number>
  /** Contributions already made but not yet deducted; separate from room. */
  rrspUnusedUndeducted: Known<number>
  /** Pension adjustment from the prior year's T4. */
  rrspPensionAdjustment: Known<number>
  /** Past service pension adjustment. */
  rrspPspa: Known<number>
  /** Pension adjustment reversal. */
  rrspPar: Known<number>
  tfsaAvailableRoom: Known<number>
  cppAnnualAt65: number
  oasAnnualAt65: number
  pensionAnnual: number
  pension: Pension | null
  cppWork: CppWork | null
  /** BE-39 A: where this person's CPP/QPP and OAS figures came from. */
  cppAmountSource?: PensionAmountProvenance
  oasAmountSource?: PensionAmountProvenance
  provenance: Record<string, Provenance>
}
export const ageReachedInYear = (person: Person, baseYear: number, year: number) => person.ageInBaseYear + year - baseYear
export type AccountKind = 'tfsa' | 'rrsp' | 'spousalRrsp' | 'rrif' | 'nonReg' | 'fhsa' | 'lira' | 'lif'
export interface Account {
  id: EntityId
  kind: AccountKind
  ownerId: EntityId | null
  balance: number
  realReturn: number
  volatility: number | null
  annualFee: number
  /** Nominal CAD tax basis; unknown is distinct from zero. */
  acb: Known<number>
  taxableOwnerShares: TaxShares
  contributionRoom: Known<number>
  openedYear: Known<number>
  /** CRA factor chart category; only a verified qualification history selects age-71 .0526/.0528. */
  rrifFactorCategory?: Known<'qualifying' | 'allOther'>
  openedYearsAgoAtBaseYear: number | null
  jurisdiction?: Province | 'federal'
  accessibleAge?: number
  accessibleAgeConfirmed?: boolean
  rrifAgeElection?: { personId: EntityId; electedAtOpening: boolean } | null
  provenance: Record<string, Provenance>
}
export interface Contribution {
  id: EntityId
  accountId: EntityId
  contributorId: EntityId | null
  calendarYear: number
  amount: number
  deductionYear: number | null
  provenance: Provenance
}
export interface RecurringContribution {
  id: EntityId
  accountId: EntityId
  contributorId: EntityId | null
  annualAmount: number
  funding: 'fromSavings' | 'employerAdditional'
  provenance: Provenance
}
export interface Property {
  id: EntityId
  kind: 'principal' | 'investment'
  value: number
  acb: Known<number>
  saleExpenses?: Known<number>
  annualRent: Known<number>
  appreciation: number
  sellAtAge: number | null
  plannedPurchaseAge: number | null
  plannedDownPayment: number | null
  plannedMortgage: { principal: number; annualPayment: number | null; yearsRemaining: number | null } | null
  annualHoldingCostChange: number
  taxableOwnerShares: TaxShares
  mortgageDebtId: EntityId | null
  provenance: Record<string, Provenance>
}
export interface Debt {
  id: EntityId
  kind: 'mortgage' | 'carLoan' | 'other'
  propertyId: EntityId | null
  principal: number
  annualPayment: number
  yearsRemaining: number
  provenance: Provenance
}
export interface IncomeSource {
  id: EntityId
  kind: 'cpp' | 'oas' | 'pension' | 'employment' | 'other' | 'rent'
  recipientId: EntityId | null
  annualAmount: Known<number>
  startAge?: number
  fromAge?: number
  toAge?: number
  provenance: Provenance
}
export interface Dependent {
  id: EntityId
  ageInBaseYear: number
  provenance: Provenance
}
export type BudgetMode =
  | { kind: 'incomeBudget'; workingSpending: number; retirementSpending: number }
  | { kind: 'savingsBudget'; annualNetSavings: number; retirementSpending: number; debtIncluded: Known<boolean>; taxBenefitIncluded: Known<boolean> }
export interface InputsV2 {
  schemaVersion: 2
  baseYear: number
  province: Province
  inflation: number
  budget: BudgetMode
  people: Person[]
  /** Removed people retained for review so their pensions are not discarded. */
  orphanedPeople?: Person[]
  accounts: Account[]
  contributions: Contribution[]
  recurringContributions: RecurringContribution[]
  savingsAllocation: { shares: Record<AccountType, number>; provenance: Provenance }
  projectionAssumptions: { nonRegDistributionYield: number; accumulationMarginalRate: number; meltdownBracketCap: MeltdownCap }
  properties: Property[]
  debts: Debt[]
  incomeSources: IncomeSource[]
  /** Explicit tax elections; absence never implies a split or spouse support. */
  taxProfile?: {
    spouseSupported: Known<boolean>
    pensionSplit: { transferorId: EntityId; recipientId: EntityId; amount: number } | null
    /** Québec line 245 is a separate election from federal T1032. */
    qcPensionSplit?: { transferorId: EntityId; recipientId: EntityId; amount: number } | null
    /** Missing months are unknown; indices 0–11 mean January–December of the projected tax year. */
    qcDrugCoverage?: Record<EntityId, QcDrugCoverage[]>
  }
  dependents: Dependent[]
  strategy: Strategy
  goal: Goal
  lifeExpectancy: number
  targetAssets: Known<number>
  /** Old projection adapter is retained until BE-14 switches all consumers. */
  legacyProjection: Inputs
  /**
   * Per-person amounts of one household account total, keyed by the base
   * account id (e.g. `legacy:account:rrsp`), mapping each person id to their
   * recorded balance. This is the recorded fact behind a two-owner split of a
   * registered/locked account. It survives later household-total edits so the
   * panel can show a visible mismatch instead of silently rewriting or
   * dropping the split; it is absent for non-registered accounts and
   * properties, whose `taxableOwnerShares` are the durable fact.
   */
  ownershipAmounts?: Record<string, Record<EntityId, number>>
  /**
   * Per spousal-plan account, whether the rows in `contributions` are the
   * plan's complete premium history. Absent means not confirmed, so the T2205
   * attribution is explicitly unsupported rather than assuming the annuitant
   * paid every premium. See BE-12 B.
   */
  spousalHistory?: Record<EntityId, SpousalHistoryStatus>
  /**
   * Per FHSA account, the CRA statement facts that the participation-room
   * ledger needs and that no other field can supply: every contribution and
   * RRSP transfer made before the base year. Absent means the history is not
   * confirmed, so no FHSA contribution is priced and a balance is never
   * treated as evidence of room. See BE-36 A.
   */
  fhsaStatementHistory?: Record<EntityId, { cumulativePriorContributions: Known<number>; provenance: Provenance }>
  /**
   * Per person, the CRA TFSA statement facts the per-person room ledger needs
   * and that the room figure alone cannot supply: the withdrawals made since it,
   * which are the only thing that restores room. Absent means the history is not
   * confirmed, so no withdrawal is treated as restoring room and no room
   * addition is assumed. See BE-27 A.
   */
  tfsaStatement?: Record<EntityId, { withdrawals: { id: string; calendarYear: number; amount: number }[]; provenance: Provenance }>
  migration: { sourcePersistVersion: number; ownershipNeedsConfirmation: boolean; ageBasisNeedsConfirmation: boolean; savingsBasisNeedsConfirmation: boolean }
}
export type PrecisionGate = { allowed: boolean; reasons: string[] }
export function precisionGate(plan: InputsV2): PrecisionGate {
  const reasons: string[] = []
  if (plan.migration.ownershipNeedsConfirmation || plan.accounts.some(a => a.kind !== 'nonReg' && a.ownerId === null || a.taxableOwnerShares.status === 'unknown') || plan.properties.some(p => p.taxableOwnerShares.status === 'unknown')) reasons.push('ownershipUnknown')
  if (plan.orphanedPeople?.length || plan.incomeSources.some(source => source.recipientId === null && source.annualAmount.status === 'known' && source.annualAmount.value !== 0)) reasons.push('recipientUnknown')
  if (plan.migration.ageBasisNeedsConfirmation) reasons.push('ageBasisUnknown')
  if (plan.migration.savingsBasisNeedsConfirmation || (plan.migration.sourcePersistVersion <= 10 && plan.budget.kind === 'savingsBudget' && (plan.budget.debtIncluded.status === 'unknown' || plan.budget.taxBenefitIncluded.status === 'unknown'))) reasons.push('savingsBasisUnknown')
  return { allowed: reasons.length === 0, reasons }
}
