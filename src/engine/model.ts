import type { AccountType, CppWork, Goal, Inputs, MeltdownCap, Pension, Province, Strategy } from './types'

export type EntityId = string
export type Known<T> = { status: 'known'; value: T } | { status: 'unknown'; reason: string }
export type Provenance = { origin: 'user' | 'legacy' | 'estimated' | 'unknown'; sourceYear: number | null; note?: string }
export type TaxShares = { status: 'known'; shares: Record<EntityId, number> } | { status: 'unknown'; reason: string }
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
  tfsaAvailableRoom: Known<number>
  cppAnnualAt65: number
  oasAnnualAt65: number
  pensionAnnual: number
  pension: Pension | null
  cppWork: CppWork | null
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
  dependents: Dependent[]
  strategy: Strategy
  goal: Goal
  lifeExpectancy: number
  targetAssets: Known<number>
  /** Old projection adapter is retained until BE-14 switches all consumers. */
  legacyProjection: Inputs
  migration: { sourcePersistVersion: number; ownershipNeedsConfirmation: boolean; ageBasisNeedsConfirmation: boolean; savingsBasisNeedsConfirmation: boolean }
}
export type PrecisionGate = { allowed: boolean; reasons: string[] }
export function precisionGate(plan: InputsV2): PrecisionGate {
  const reasons: string[] = []
  if (plan.migration.ownershipNeedsConfirmation || plan.accounts.some(a => a.ownerId === null || a.taxableOwnerShares.status === 'unknown') || plan.properties.some(p => p.taxableOwnerShares.status === 'unknown')) reasons.push('ownershipUnknown')
  if (plan.orphanedPeople?.length || plan.incomeSources.some(source => source.recipientId === null && source.annualAmount.status === 'known' && source.annualAmount.value !== 0)) reasons.push('recipientUnknown')
  if (plan.migration.ageBasisNeedsConfirmation) reasons.push('ageBasisUnknown')
  if (plan.budget.kind === 'savingsBudget' && (plan.budget.debtIncluded.status === 'unknown' || plan.budget.taxBenefitIncluded.status === 'unknown')) reasons.push('savingsBasisUnknown')
  return { allowed: reasons.length === 0, reasons }
}
