import { PAYROLL_2026 } from './payroll'
import { annualTerminalEstate } from './annualTerminalEstate'
import { carryProspectivePurchaseBalance } from "./annualPrimaryHomePurchase"
import { MortgagePrecisionError, mortgageDecimal, mortgageSubtract, mortgageAdd, mortgageMultiply, mortgageClosing, mortgageNumber, validMortgageDecimal, mortgageNegative, type MortgageDecimal } from "./mortgageDecimal"
import { growHeldProperties } from './annualProperty'
import { nonRegProblem } from "./annualNonReg"
import { gisAssessmentReceipt, validGisBasis, type GisAssessmentFact } from './annualGis'
import { settleHouseholdOas } from './annualOas'
import { cppInputProblem } from './annualCpp'
import { searchWithdrawalTarget } from './withdrawalSearch'
import { evaluateCanonicalWorkingYear, evaluateCanonicalHouseholdWorkingYear, type ContinuousWorkingEvaluation, type WorkingSpendingEvidence } from './annualWorking'
import { annualRetirementContinuation } from './annualRetirement'
import type { InputsV2, Known, AccountKind } from './model'
import { ageReachedInYear, pricingGate } from './model'
import { assertCanonicalPlan } from './modelValidation'
import { allocateContributions, resolveYearAllocation, type FundingGap } from './funding'
import { settleAnnualDebt } from './annualDebt'
import {
  RRSP_ADDITION_RULE_MISSING, plannedRrspSlices, rrspRoomYear, statementOpeningRoom,
  type RrspRoomLimitation, type RrspRoomYear,
} from './rrspRoom'
import {
  FHSA_BLOCKING, FHSA_MATURITY_UNSUPPORTED, FHSA_MONEY_TOLERANCE, FHSA_MULTIPLE_ACTIVE_ACCOUNTS, FHSA_OPENING_YEAR_MISSING,
  activeFhsaAccounts, fhsaOpeningRoom, fhsaPlannedYearRequestWithOrigins, fhsaRoomYear,
  fhsaStatementHistory, type FhsaRoomYear,
} from './fhsa'
import { plannedFhsaContribution } from './fhsaPlan'
import { budgetFacts, cashBudget } from './budgetSemantics'
import { annualTfsaAdditionFor, plannedTfsaLines, tfsaRoomYear, tfsaStatement, type TfsaRoomYear } from './tfsaRoom'

/** Nominal CAD throughout. A snapshot is an owned value; evaluators receive copies. */
export interface RrifConversion { year: number; ownerId: string; amount: number; factorCategory: "allOther"; ageBasis: "owner"; provenance: "generated-owner-rrsp-rollover" }
export interface RrifSettlement { accountId: string; conversion: RrifConversion; openingBalance: number; ageAtYearStart: number; factor: number; minimum: number; withdrawal: number; discretionary: number; incomeKind: "rrspWithdrawal" | "rrifWithdrawal" }
export const rrifConversionFor = (state: AnnualState, id: string): RrifConversion | undefined =>
  state.rrifConversions && Object.prototype.hasOwnProperty.call(state.rrifConversions, id) ? state.rrifConversions[id] : undefined
export interface PrimaryHomeSaleReceipt {
  valuation?: { recordedOpeningValue: number; modeledGrossProceeds: MortgageDecimal; reconciliation: number };
  mortgagePayoff?: { recordedOpeningPrincipal: number; principalReconciliation: number; debtId: string; openingPrincipal: number; additionalAccruedInterest: number; prepaymentPenalty: number; dischargeFees: number; totalPayoff: number; residualCash: number; terms: NonNullable<NonNullable<InputsV2['annualPrimaryHomeSaleEvidence']>[string]['mortgagePayoff']> };
  propertyId: string; year: number; grossProceeds: number; sellingCosts: number;
  netProceeds: number; acb: number; realizedGain: number; taxableGain: 0;
}
export interface PrimaryHomePurchaseReceipt { propertyId: string; year: number; priceBasis: "purchase-year-nominal" | "base-year-real-indexed"; price: number; qualifyingAcquisitionCosts: number; totalCost: number; acb: number; tax: 0 }
export interface PrimaryHomePurchaseState { exactPrice: MortgageDecimal; receipt: PrimaryHomePurchaseReceipt; evidence: NonNullable<InputsV2["annualPrimaryHomePurchaseEvidence"]>[string]; exactAccountBalances: Record<string, MortgageDecimal> }
export interface AnnualState {
  prospectivePurchaseExactBalances?: Record<string, MortgageDecimal>
  primaryHomePurchase?: PrimaryHomePurchaseState

  primaryHomeSaleCash?: { exactBalance: MortgageDecimal; exactReceipt: import('./annualPrimaryHomeSale').HomeSaleExactReceipt; exactAccountBalances: Record<string, MortgageDecimal>; balance: number; receipt: Readonly<PrimaryHomeSaleReceipt>; evidence: NonNullable<InputsV2['annualPrimaryHomeSaleEvidence']>[string] }
  /** Exact decimal-CAD balances for the authenticated mortgage model only. */
  mortgageExactBalances?: Record<string, MortgageDecimal>
  rrifConversions?: Record<string, RrifConversion>
  year: number
  baseYear: number
  byPerson: Record<string, { age: number; retirementAge: number; previousYearEarnedIncome: Known<number>; rrspRoom: Known<number>; tfsaRoom: Known<number>
    rrspDeductionLimit: Known<number>; rrspUnusedUndeducted: Known<number>
    rrspPensionAdjustment: Known<number>; rrspPspa: Known<number>; rrspPar: Known<number> }>
  byAccount: Record<string, { nonRegPool?: { holdingId: string; units: number }; kind: AccountKind; ownerId: string; balance: number; acb: Known<number>; room: Known<number>; openedYear: Known<number> }>
  byDependent: Record<string, { age: number }>
  byDebt: Record<string, { principal: number; annualPayment: number; yearsRemaining: number; propertyId: string | null }>
  byProperty: Record<string, { value: number; held: boolean; acb: Known<number> }>
  contributionHistory: { id: string; accountId: string; contributorId: string | null; calendarYear: number; amount: number; deductionYear: number | null }[]
  /** Additive canonical receipt; provider/legacy snapshots do not imply work evidence. */
  gisAssessmentLag?: Record<string, GisAssessmentFact>
  benefitIncomeLag: Record<string, Known<number>>
  /**
   * BE-36 A: the most recent priced FHSA participation-room row per person.
   * Optional so a snapshot written before this ledger still loads; a missing
   * entry means the room is not yet established for that person, never zero.
   */
  fhsaLedgers?: Record<string, FhsaRoomYear>
  tfsaWithdrawalHistory?: { id: string; calendarYear: number; amount: number; personId: string }[]
  unfundedEvents: FundingGap[]
}

export interface AnnualEvaluation {
  /** Explicit external cash/tax facts for this year. No legacy household tax split is inferred here. */
  byPerson: Record<string, { income: number; earnedIncome: number; cpp?: number; benefits: number; tax: number; spending: number; taxableIncome: number; benefitIncomeForNextYear: Known<number> }>
}
export interface AnnualContext { plan: InputsV2; state: AnnualState }
export type TaxBenefitEvaluator = (context: AnnualContext) => AnnualEvaluation
export type ReturnProvider = (context: AnnualContext, accountId: string) => number
export interface AnnualProviders { evaluate: TaxBenefitEvaluator; returns: ReturnProvider }
/** Deterministic nominal return from the canonical real-return and fee assumptions. */
export const fixedReturnProvider: ReturnProvider = ({ plan }, accountId) => {
  const account = plan.accounts.find(item => item.id === accountId)
  if (!account) return Number.NaN
  return (1 + account.realReturn - account.annualFee) * (1 + plan.inflation) - 1
}
/** Exact mortgage carry contains only explicitly written account IDs. */
function ownMortgageBalance(balances: Record<string, MortgageDecimal> | undefined, id: string): MortgageDecimal | undefined {
  return balances && Object.prototype.hasOwnProperty.call(balances, id) ? balances[id] : undefined
}

export interface AnnualIssue { code: 'invalid' | 'unsupported' | 'unfunded'; detail: string; eventId?: string }
export interface YearRow {
  terminalEstateEstimate?: import('./annualTerminalEstate').TerminalEstateEstimate
  householdWithdrawalSettlement?: { mortgageCashReconciliation?: number; /** Actual nominal receipts before and after the accepted draw; memo amounts only. */ baselineBenefits?: number; settledBenefits?: number; postings?: { accountId: string; ownerId: string; kind: 'tfsa' | 'rrsp'; amount: number }[]; taxIncrement?: number; taxTotal?: number; accountId: string | null; ownerId: string | null; withdrawal: number; spendingDue: number; spendingFunded: number; spendingUnmet: number; startCpi: number }
  workingSettlement?: ContinuousWorkingEvaluation & { payrollRuleId: string; payrollPolicy: string }
  payrollContributions?: number
  contributionRounding?: number
  retirementSettlement?: { primaryHomePurchase?: PrimaryHomePurchaseReceipt; primaryHomePurchaseEvidence?: PrimaryHomePurchaseState["evidence"]; primaryHomePurchaseArithmetic?: { price: MortgageDecimal; qualifyingAcquisitionCosts: MortgageDecimal; totalCost: MortgageDecimal; withdrawals: Record<string, MortgageDecimal>; spendingDue: MortgageDecimal; spendingFunded: MortgageDecimal; spendingUnmet: MortgageDecimal }; primaryHomeSaleAcbSource?: { propertyId: string; acb: Known<number>; provenance?: import('./model').Provenance }; primaryHomeSaleArithmetic?: { spendingDue: MortgageDecimal; spendingFunded: MortgageDecimal; spendingUnmet: MortgageDecimal; cash: Record<'opening' | 'proceedsAdded' | 'spendingUsed' | 'closing', MortgageDecimal>; withdrawals: Record<string, MortgageDecimal>; receipt: import('./annualPrimaryHomeSale').HomeSaleExactReceipt }; primaryHomeSaleEvidence?: NonNullable<InputsV2['annualPrimaryHomeSaleEvidence']>[string]; primaryHomeSale?: PrimaryHomeSaleReceipt; primaryHomeSaleCash?: { opening: number; proceedsAdded: number; spendingUsed: number; closing: number }; mortgageCashReconciliation?: { amount: number; basis: "decimal-CAD" }; cashBridge?: { method: 'compensated-signed-cash'; netCash: number }; rrif?: RrifSettlement; gisAgeAmountNetIncomeReal?: number; gis?: import('./annualGis').AnnualGis; oas?: import('./annualOas').AnnualOas; cpp?: import('./annualCpp').AnnualCpp; evaluationBasis: 'canonical-retirement'; spendingDue: number; spendingFunded: number; spendingUnmet: number; startCpi: number; taxRules: import('./tax').TaxRuleProvenance }
  year: number
  byPerson: Record<string, { age: number; income: number; earnedIncome: number; cpp?: number; oasGross?: number; oasRecovery?: number; oasNet?: number; gis?: number; benefits: number; tax: number; spending: number; taxableIncome: number }>
  byAccount: Record<string, { primaryHomePurchaseReconciliation?: number; primaryHomePurchaseExactWithdrawal?: MortgageDecimal; primaryHomePurchaseWithdrawalReconciliation?: number; mortgageArithmeticReconciliation?: number; mortgageExactWithdrawal?: MortgageDecimal; nonRegSale?: import("./annualNonReg").NonRegSale; openingKind?: AccountKind; closingKind?: AccountKind; opening: number; contribution: number; withdrawal: number; returnAmount: number; closing: number; acb: Known<number>; ownerId: string }>
  /** Recorded at settlement, never reconstructed from rounded presentation values. */
  byDebt: Record<string, { payoffPrincipalReconciliation?: number; salePayoff?: number; opening: number; interest: number; principal: number; payment: number; closing: number; propertyId: string | null }>
  byProperty: Record<string, { held: boolean; opening: number; growth: number; closing: number }>
  cashLedger: { income: number; benefits: number; tax: number; spending: number; debtPayments: number; fhsaContributions: number; employeeContributions: number; employerContributions: number; voluntaryContributions: number; retainedContributions: number; unallocated: number }
  /** Budget reservation and final-posting bridge. Final postings and retained
   * amounts are memo facts, not additional budget uses. Ownership and
   * contributor attribution are intentionally separate. */
  contributionLedger: {
    /** Exact canonical net-savings budget used by the allocator, not supplied net cash. */
    allocationCashBasis: number
    /** Allocation-time RRSP/spousal cash reservation only; scheduled FHSA is
     * already reserved in cashLedger.fhsaContributions. This is requested,
     * not the room-clipped amount eventually posted to registered accounts. */
    scheduledRrspBudgeted: number
    scheduledPlanned: number; scheduledApplied: number; scheduledRetained: number; appliedTotal: number
    postings: { id: string; accountId: string; ownerId: string; contributorId: string | null; amount: number }[]
    retained: { personId: string; kind: 'rrsp' | 'fhsa' | 'tfsa'; amount: number }[]
  }
  taxLedger: Record<string, { taxableIncome: number; tax: number }>
  /** BE-12 A per-person room ledger; every year is recomputable from its parts. */
  rrspLedger: Record<string, RrspRoomYear>
  /** BE-36 A per-person FHSA participation-room ledger. */
  fhsaLedger: Record<string, FhsaRoomYear>
  /** BE-27 A per-person TFSA contribution-room ledger. */
  tfsaLedger: Record<string, TfsaRoomYear>
  issues: AnnualIssue[]
}
export type KernelResult<T> = { status: 'ok'; value: T } | { status: 'invalid' | 'unsupported'; issues: AnnualIssue[] }
export interface AnnualStepValue { state: AnnualState; row: YearRow }
const clone = <T>(value: T): T => structuredClone(value)
const fail = (status: 'invalid' | 'unsupported', detail: string): KernelResult<never> => ({ status, issues: [{ code: status, detail }] })
const finiteNonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const validKnownAmount = (value: unknown, nonnegative = false): value is Known<number> => {
  if (!value || typeof value !== 'object') return false
  const fact = value as Known<number>
  return fact.status === 'unknown' ? typeof fact.reason === 'string' && fact.reason.length > 0
    : fact.status === 'known' && typeof fact.value === 'number' && Number.isFinite(fact.value) && (!nonnegative || fact.value >= 0)
}
const sameKnown = (left: Known<number>, right: Known<number>) => left.status === right.status &&
  (left.status === 'known' && right.status === 'known' ? left.value === right.value :
    left.status === 'unknown' && right.status === 'unknown' && left.reason === right.reason)
const sameContribution = (left: AnnualState['contributionHistory'][number], right: InputsV2['contributions'][number]) =>
  left.id === right.id && left.accountId === right.accountId && left.contributorId === right.contributorId &&
  left.calendarYear === right.calendarYear && left.amount === right.amount && left.deductionYear === right.deductionYear
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const roundCents = (value: number) => Math.round(value * 100) / 100

export function initializeState(plan: InputsV2): KernelResult<AnnualState> {
  try { assertCanonicalPlan(plan) } catch { return fail('invalid', 'canonical plan shape') }
  const gate = pricingGate(plan)
  if (!gate.allowed) return fail('unsupported', `pricing gate: ${gate.reasons.join(', ')}`)
  if (plan.accounts.some(account => account.ownerId === null)) return fail('unsupported', 'account ownership unknown')
  if (plan.accounts.some(account => !finiteNonnegative(account.balance)) || plan.debts.some(debt => !finiteNonnegative(debt.principal))) return fail('invalid', 'negative or nonfinite opening balance')
  const byPerson = Object.fromEntries(plan.people.map(person => [person.id, {
    age: ageReachedInYear(person, plan.baseYear, plan.baseYear), retirementAge: person.retirementAge,
    previousYearEarnedIncome: clone(person.previousYearEarnedIncome), rrspRoom: clone(person.rrspAvailableRoom), tfsaRoom: clone(person.tfsaAvailableRoom),
    rrspDeductionLimit: clone(person.rrspDeductionLimit), rrspUnusedUndeducted: clone(person.rrspUnusedUndeducted),
    rrspPensionAdjustment: clone(person.rrspPensionAdjustment), rrspPspa: clone(person.rrspPspa), rrspPar: clone(person.rrspPar),
  }]))
  const byAccount = Object.fromEntries(plan.accounts.map(account => [account.id, {
    kind: account.kind, ownerId: account.ownerId!, balance: account.balance, acb: clone(account.acb), room: clone(account.contributionRoom), openedYear: clone(account.openedYear),
  }]))
  const byDebt = Object.fromEntries(plan.debts.map(debt => [debt.id, { principal: debt.principal, annualPayment: debt.annualPayment, yearsRemaining: debt.yearsRemaining, propertyId: debt.propertyId }]))
  const byDependent = Object.fromEntries(plan.dependents.map(dependent => [dependent.id, { age: dependent.ageInBaseYear }]))
  const byProperty = Object.fromEntries(plan.properties.map(property => [property.id, { value: property.value, held: property.plannedPurchaseAge === null, acb: clone(property.acb) }]))
  const state: AnnualState = { year: plan.baseYear, baseYear: plan.baseYear, byPerson, byAccount, byDependent, byDebt, byProperty,
    contributionHistory: plan.contributions.filter(c => c.calendarYear < plan.baseYear).map(c => ({ id: c.id, accountId: c.accountId, contributorId: c.contributorId, calendarYear: c.calendarYear, amount: c.amount, deductionYear: c.deductionYear })),
    benefitIncomeLag: Object.fromEntries(plan.people.map(person => [person.id, { status: 'unknown', reason: 'benefit income basis not supplied' }])),
    fhsaLedgers: {}, unfundedEvents: [] }
  const problem = snapshotProblem(plan, state)
  return problem ? fail('invalid', problem) : { status: 'ok', value: state }
}

/** Only supported, settled events commit. No trial may mutate the caller's state. */
export function snapshotProblem(plan: InputsV2, opening: AnnualState, generatedBasis?: AnnualState): string | null {
  try {
    if (Object.values(opening.byAccount).some(a => 'nonRegPool' in a)) {
      if (!generatedBasis || !isCanonicalGeneratedState(plan, generatedBasis)) return 'nonReg: pool metadata requires authenticated generated state'
      const problem = nonRegProblem(plan, opening)
      if (problem) return problem
    }
    if (opening.prospectivePurchaseExactBalances !== undefined && (!generatedBasis || !isCanonicalGeneratedState(plan, generatedBasis) || !plan.annualPrimaryHomePurchaseEvidence || Object.entries(opening.prospectivePurchaseExactBalances).some(([id, exact]) => !opening.byAccount[id] || !validMortgageDecimal(exact) || mortgageNegative(exact) || mortgageNumber(exact) !== opening.byAccount[id].balance))) return "purchase balances require authenticated generated state"
    if (opening.primaryHomePurchase && (!generatedBasis || !isCanonicalGeneratedState(plan, generatedBasis))) return "purchase requires authenticated generated state"
    if (opening.primaryHomeSaleCash !== undefined) {
      const cash = opening.primaryHomeSaleCash, r = cash.receipt
      const p = plan.properties.find(p => p.id === r?.propertyId)
      const exact = cash.exactReceipt
      if (!generatedBasis || !isCanonicalGeneratedState(plan, generatedBasis) || !p ||
          !finiteNonnegative(cash.balance) || !r || !exact || r.year >= opening.year || r.year !== plan.baseYear + p.sellAtAge! - plan.people[0].ageInBaseYear ||
          !validMortgageDecimal(cash.exactBalance) || mortgageNegative(cash.exactBalance) || mortgageNumber(cash.exactBalance) !== cash.balance ||
          Object.entries(exact).some(([key, value]) => !validMortgageDecimal(value) || (!key.endsWith('Reconciliation') && mortgageNegative(value)) || mortgageNumber(value) !== ({ mortgagePrincipalPaid: r.mortgagePayoff?.openingPrincipal, residualCash: r.mortgagePayoff?.residualCash, recordedOpeningValue: r.valuation?.recordedOpeningValue, saleValueReconciliation: r.valuation?.reconciliation, recordedOpeningPrincipal: r.mortgagePayoff?.recordedOpeningPrincipal, mortgagePrincipalReconciliation: r.mortgagePayoff?.principalReconciliation }[key] ?? r[key as keyof PrimaryHomeSaleReceipt])) ||
          mortgageSubtract(mortgageSubtract(exact.grossProceeds, exact.sellingCosts), exact.netProceeds).coefficient !== '0' ||
          mortgageSubtract(mortgageSubtract(exact.netProceeds, exact.acb), exact.realizedGain).coefficient !== '0' || r.taxableGain !== 0 ||
          mortgageNegative(mortgageSubtract(exact.residualCash ?? exact.netProceeds, cash.exactBalance)) ||
          (r.mortgagePayoff !== undefined && (!exact.mortgagePrincipalPaid || !exact.residualCash || mortgageSubtract(mortgageSubtract(exact.netProceeds, exact.mortgagePrincipalPaid), exact.residualCash).coefficient !== "0" || opening.byDebt[r.mortgagePayoff.debtId]?.principal !== 0 || opening.byDebt[r.mortgagePayoff.debtId]?.yearsRemaining !== 0)) ||
          !cash.exactAccountBalances || Object.entries(cash.exactAccountBalances).some(([id, value]) => !opening.byAccount[id] || !validMortgageDecimal(value) || mortgageNegative(value) || mortgageNumber(value) !== opening.byAccount[id].balance) ||
          opening.byProperty[p.id]?.held || opening.byProperty[p.id]?.value !== 0)
        return 'primary home sale cash requires authenticated generated settlement'
    }
    if (opening.mortgageExactBalances !== undefined && (!generatedBasis || !isCanonicalGeneratedState(plan, generatedBasis) || !plan.debts.length || Object.entries(opening.mortgageExactBalances).some(([id, d]) => !opening.byAccount[id] || !validMortgageDecimal(d) || mortgageNegative(d) || mortgageNumber(d) !== opening.byAccount[id].balance))) return "mortgage decimal balances require authenticated generated state"
    if (opening.gisAssessmentLag && (Object.keys(opening.gisAssessmentLag).some(id => !plan.people.some(p => p.id === id)) || Object.values(opening.gisAssessmentLag).some(fact => !validGisBasis(fact, opening.year)))) return 'GIS assessment snapshot year or evidence'
    if (opening.year === plan.baseYear && opening.gisAssessmentLag && Object.keys(opening.gisAssessmentLag).length) return 'GIS initial historical assessment unsupported'
    if (opening.rrifConversions !== undefined && (!generatedBasis || !isCanonicalGeneratedState(plan, generatedBasis))) return 'RRIF conversion receipts require authenticated generated retirement'
    for (const [id, receipt] of Object.entries(opening.rrifConversions ?? {})) {
      const account = plan.accounts.find(a => a.id === id)
      const owner = plan.people.find(p => p.id === receipt.ownerId)
      if (!account || account.kind !== "rrsp" || account.ownerId !== receipt.ownerId || !owner || receipt.year !== plan.baseYear + 71 - owner.ageInBaseYear || receipt.year >= opening.year || receipt.year < plan.baseYear || !finiteNonnegative(receipt.amount) || receipt.factorCategory !== "allOther" || receipt.ageBasis !== "owner" || receipt.provenance !== "generated-owner-rrsp-rollover") return "RRIF conversion receipt"
    }
    const self = plan.people.find(person => person.role === 'self')!
    if (!Number.isInteger(opening.year) || opening.year < plan.baseYear || opening.baseYear !== plan.baseYear) return 'snapshot year/base mismatch'
    if (opening.year > plan.baseYear + plan.lifeExpectancy - self.ageInBaseYear + 1) return 'year beyond plan horizon'
    if (Object.keys(opening.byPerson ?? {}).sort().join('|') !== plan.people.map(p => p.id).sort().join('|') ||
        Object.keys(opening.byAccount ?? {}).sort().join('|') !== plan.accounts.map(a => a.id).sort().join('|') ||
        Object.keys(opening.byDependent ?? {}).sort().join('|') !== plan.dependents.map(d => d.id).sort().join('|') ||
        Object.keys(opening.byDebt ?? {}).sort().join('|') !== plan.debts.map(d => d.id).sort().join('|') ||
        Object.keys(opening.byProperty ?? {}).sort().join('|') !== plan.properties.map(p => p.id).sort().join('|')) return 'snapshot entity IDs'
    if (Object.values(opening.byAccount).some(a => !finiteNonnegative(a.balance)) ||
        Object.values(opening.byDebt).some(d => !finiteNonnegative(d.principal) || !finiteNonnegative(d.annualPayment) || !Number.isInteger(d.yearsRemaining) || d.yearsRemaining < 0 || (d.principal > 0 && d.yearsRemaining === 0))) return 'snapshot balance or debt term'
    if (Object.values(opening.byPerson).some(p => !validKnownAmount(p.previousYearEarnedIncome) || !validKnownAmount(p.rrspRoom, true) || !validKnownAmount(p.tfsaRoom, true) ||
        !validKnownAmount(p.rrspDeductionLimit, true) || !validKnownAmount(p.rrspUnusedUndeducted, true) ||
        !validKnownAmount(p.rrspPensionAdjustment, true) || !validKnownAmount(p.rrspPspa, true) || !validKnownAmount(p.rrspPar, true)) ||
        Object.values(opening.byAccount).some(a => !validKnownAmount(a.acb, true) || !validKnownAmount(a.room, true) || !validKnownAmount(a.openedYear) || (a.openedYear.status === 'known' && !Number.isInteger(a.openedYear.value))) ||
        Object.values(opening.byProperty).some(p => !finiteNonnegative(p.value) || !validKnownAmount(p.acb, true)) ||
        Object.values(opening.benefitIncomeLag ?? {}).some(v => !validKnownAmount(v)) ||
        Object.keys(opening.benefitIncomeLag ?? {}).sort().join('|') !== plan.people.map(p => p.id).sort().join('|') ||
        !Array.isArray(opening.contributionHistory) || opening.contributionHistory.some(c => !finiteNonnegative(c.amount) || !Number.isInteger(c.calendarYear)) ||
        !Array.isArray(opening.unfundedEvents) || opening.unfundedEvents.some(gap => !finiteNonnegative(gap.amount))) return 'snapshot nested amount'
    if (plan.people.some(person => opening.byPerson[person.id].age !== ageReachedInYear(person, plan.baseYear, opening.year) ||
        opening.byPerson[person.id].retirementAge !== person.retirementAge) ||
        plan.dependents.some(dependent => opening.byDependent[dependent.id].age !== dependent.ageInBaseYear + opening.year - plan.baseYear) ||
        plan.accounts.some(account => opening.byAccount[account.id].kind !== (rrifConversionFor(opening, account.id) ? "rrif" : account.kind) || opening.byAccount[account.id].ownerId !== account.ownerId)) return 'snapshot identity or age'
    // A never executes purchase/sale or changes opening-year facts. A candidate
    // cannot claim the property was acquired or a missing statement was verified.
    if (plan.properties.some(property => opening.byProperty[property.id].held !== (opening.primaryHomeSaleCash?.receipt.propertyId === property.id ? false : (opening.primaryHomePurchase?.receipt.propertyId === property.id ? true : property.plannedPurchaseAge === null)) ||
        !sameKnown(opening.byProperty[property.id].acb, opening.primaryHomePurchase?.receipt.propertyId === property.id ? { status: "known", value: opening.primaryHomePurchase.receipt.acb } : property.acb)) ||
        plan.debts.some(debt => opening.byDebt[debt.id].annualPayment !== debt.annualPayment ||
          opening.byDebt[debt.id].propertyId !== debt.propertyId) ||
        plan.accounts.some(account => !sameKnown(opening.byAccount[account.id].openedYear, rrifConversionFor(opening, account.id) ? { status: "known", value: rrifConversionFor(opening, account.id)!.year } : account.openedYear))) return 'snapshot event or opening fact'
    const priorContributions = plan.contributions.filter(contribution => contribution.calendarYear < plan.baseYear)
    if (opening.year === plan.baseYear && (
      plan.accounts.some(account => opening.byAccount[account.id].balance !== account.balance ||
        !sameKnown(opening.byAccount[account.id].acb, account.acb) ||
        !sameKnown(opening.byAccount[account.id].room, account.contributionRoom)) ||
      plan.properties.some(property => opening.byProperty[property.id].value !== property.value) ||
      plan.debts.some(debt => opening.byDebt[debt.id].principal !== debt.principal ||
        opening.byDebt[debt.id].yearsRemaining !== debt.yearsRemaining) ||
      plan.people.some(person => !sameKnown(opening.byPerson[person.id].rrspRoom, person.rrspAvailableRoom) ||
        !sameKnown(opening.byPerson[person.id].tfsaRoom, person.tfsaAvailableRoom) ||
        !sameKnown(opening.byPerson[person.id].rrspDeductionLimit, person.rrspDeductionLimit) ||
        !sameKnown(opening.byPerson[person.id].rrspUnusedUndeducted, person.rrspUnusedUndeducted) ||
        !sameKnown(opening.byPerson[person.id].rrspPensionAdjustment, person.rrspPensionAdjustment) ||
        !sameKnown(opening.byPerson[person.id].rrspPspa, person.rrspPspa) ||
        !sameKnown(opening.byPerson[person.id].rrspPar, person.rrspPar) ||
        !sameKnown(opening.byPerson[person.id].previousYearEarnedIncome, person.previousYearEarnedIncome)) ||
      plan.people.some(person => !sameKnown(opening.benefitIncomeLag[person.id], { status: 'unknown', reason: 'benefit income basis not supplied' })) ||
      opening.unfundedEvents.length !== 0 ||
      priorContributions.length !== opening.contributionHistory.length ||
      priorContributions.some((contribution, index) => !sameContribution(opening.contributionHistory[index], contribution))
    )) return 'snapshot base-year facts'
    return null
  } catch { return 'damaged annual snapshot' }
}

function annualStepUnchecked(plan: InputsV2, opening: AnnualState, providers: AnnualProviders, working?: ContinuousWorkingEvaluation): KernelResult<AnnualStepValue> {
  try { assertCanonicalPlan(plan) } catch { return fail('invalid', 'canonical plan shape') }
  const gate = pricingGate(plan)
  if (!gate.allowed) return fail('unsupported', `pricing gate: ${gate.reasons.join(', ')}`)
  const self = plan.people.find(person => person.role === 'self')!
  const problem = snapshotProblem(plan, opening, working && isCanonicalGeneratedState(plan, opening) ? opening : undefined)
  if (problem) return fail('invalid', problem)
  if (opening.year >= plan.baseYear + plan.lifeExpectancy - self.ageInBaseYear + 1) return fail('invalid', 'year beyond plan horizon')
  const state = clone(opening)
  const year = opening.year
  // A snapshot written before BE-36 A has no ledger map; an absent entry means
  // the prior year's FHSA room is not established, not that it was zero.
  const fhsaLedgerByPerson: Record<string, FhsaRoomYear> = state.fhsaLedgers ?? (state.fhsaLedgers = {})
  // A savings budget is already net of living costs, tax/benefits and separately
  // listed debt, and the rules below read it. Every reason this kernel cannot
  // price one is reported on its own, before any of them use it as a fact: a
  // fact the user has not answered is not the same outcome as an answered flag
  // whose component is not modelled, and neither is `incomeBudget`.
  const facts = budgetFacts(plan.budget)
  if (!working && facts.status !== 'ready') return fail(facts.status === 'invalid' ? 'invalid' : 'unsupported', facts.detail)
  // Rules not yet supplied by BE-11/12/23/38 must not masquerade as exact advice.
  // These obligations follow the account holder's age, even when they remain
  // employed. A does not compute minimums, conversions, or FHSA closure tax.
  for (const account of plan.accounts) {
    const current = state.byAccount[account.id]
    const ownerAge = state.byPerson[account.ownerId!].age
    // An FHSA recurring plan is read through the one accessor the panel and the
    // kernel share, so a stale duplicate row can never look like a plan.
    const recurringPlan = account.kind === 'fhsa'
      ? plannedFhsaContribution(plan, account.id)
      : plan.recurringContributions.filter(item => item.accountId === account.id).reduce((total, item) => total + item.annualAmount, 0)
    const plannedContribution = recurringPlan > 0 ||
      plan.contributions.some(item => item.accountId === account.id && item.calendarYear === year && item.amount > 0) ||
      (account.kind === 'rrsp' && plan.budget.kind === 'savingsBudget' && plan.budget.annualNetSavings > 0 && plan.savingsAllocation.shares.rrsp > 0)
    if (current.balance <= 0 && !plannedContribution) continue
    if (account.kind === 'rrif' || account.kind === 'lif') return fail('unsupported', `${account.kind.toUpperCase()} minimum withdrawal rule not yet wired: ${account.id}`)
    if (ownerAge >= 71 && ['rrsp', 'spousalRrsp', 'lira'].includes(account.kind)) return fail('unsupported', `${account.kind === 'lira' ? 'LIRA' : 'RRSP'} age-71 conversion rule not yet wired: ${account.id}`)
    if (ownerAge >= 71 && account.kind === 'fhsa') return fail('unsupported', `FHSA age-71 closure rule not yet wired: ${account.id}`)
  }
  if (!working && plan.people.some(person => state.byPerson[person.id]?.age >= person.retirementAge)) return fail('unsupported', 'retirement withdrawals and benefit rules not yet wired')
  if (plan.properties.some(property => property.plannedPurchaseAge !== null && state.byPerson[self.id].age >= property.plannedPurchaseAge && !state.byProperty[property.id]?.held)) return fail('unsupported', 'planned purchase funding and tax integration not yet wired')
  if (plan.properties.some(property => property.sellAtAge !== null && state.byPerson[self.id].age >= property.sellAtAge && state.byProperty[property.id]?.held)) return fail('unsupported', 'property sale funding and tax integration not yet wired')
  // A held balance, a recorded plan, or a scheduled row all make an FHSA active
  // for the year, measured by the one function the panel also uses.
  const activeFhsa = activeFhsaAccounts(plan, year, accountId => state.byAccount[accountId].balance)
  // More than one active FHSA has no single participation-room ledger, and the
  // money must not simply vanish from the account rows into a conservation
  // failure. Refuse it explicitly instead.
  if (activeFhsa.length > 1) return fail('unsupported', `${FHSA_MULTIPLE_ACTIVE_ACCOUNTS}: ${activeFhsa.map(account => account.id).join(', ')}`)
  for (const account of activeFhsa) {
    const opened = state.byAccount[account.id].openedYear
    if (opened.status === 'unknown') return fail('unsupported', `${FHSA_OPENING_YEAR_MISSING}: ${account.id}`)
    if (year < opened.value) return fail('unsupported', `FHSA opening year is in the future: the FHSA is not open until ${opened.value}: ${account.id}`)
  }
  if (activeFhsa.some(account => {
    const opened = state.byAccount[account.id].openedYear
    return opened.status === 'known' && year - opened.value >= 15
  })) return fail('unsupported', `FHSA statutory rollover not yet wired (BE-36 B): ${activeFhsa[0].id}`)
  // BE-36 A: an owned FHSA with a confirmed statement is priced by its own
  // per-person participation-room ledger below. Anything that cannot be
  // attributed to the account holder still stops here rather than borrowing a
  // household total.
  /** The single owned FHSA that this year's ordinary savings share funds. */
  const activeFhsaId = activeFhsa.length === 1 ? activeFhsa[0].id : null
  const fhsaAccount = activeFhsaId ? state.byAccount[activeFhsaId] : null
  if (fhsaAccount && !plan.people.some(person => person.id === fhsaAccount.ownerId)) return fail('unsupported', 'FHSA holder not identified')
  // BE-12 A/B: a scheduled contribution is priced by the person's own RRSP
  // room ledger. BE-12 B adds the spousal plan: a premium to a `spousalRrsp`
  // account consumes the recorded contributor's room whether or not that
  // contributor is the plan holder, and the account kind is what makes a later
  // withdrawal attributable. A contributor recorded against a plain RRSP
  // account stays unsupported: that account is not recorded as a spousal plan.
  const scheduled = plan.contributions.filter(contribution => contribution.calendarYear === year && contribution.amount > 0)
  const scheduledByPerson: Record<string, { accountId: string; planned: number }> = {}
  for (const contribution of scheduled) {
    if (!finiteNonnegative(contribution.amount) || (contribution.deductionYear !== null && !Number.isInteger(contribution.deductionYear))) return fail('invalid', `scheduled contribution facts: ${contribution.id}`)
    const account = state.byAccount[contribution.accountId]
    if (!account) return fail('invalid', `scheduled contribution account missing: ${contribution.id}`)
    if (account.kind === 'fhsa') {
      // BE-36 A: only the holder can participate, no one else can contribute to
      // their FHSA, and the row is priced by the holder's own participation-room
      // ledger below. It must never enter `scheduledByPerson`: that map is the
      // RRSP ledger's line source *and* its destination, so parking an FHSA row
      // there would spend RRSP room and pay the same contribution twice.
      if (contribution.contributorId === null) return fail('unsupported', `scheduled FHSA contributor not recorded: ${contribution.id}`)
      if (contribution.contributorId !== account.ownerId) return fail('unsupported', `only the FHSA holder can contribute to their own account: ${contribution.id}`)
      continue
    }
    if (!['rrsp', 'spousalRrsp'].includes(account.kind)) return fail('unsupported', `scheduled ${account.kind} contribution rule not yet wired: ${contribution.id}`)
    if (contribution.contributorId === null) return fail('unsupported', `scheduled RRSP contributor not recorded: ${contribution.id}`)
    if (contribution.contributorId !== account.ownerId && account.kind !== 'spousalRrsp')
      return fail('unsupported', `RRSP contributor differs from the account owner and the account is not recorded as a spousal plan: ${contribution.id}`)
    if (account.kind === 'spousalRrsp' && account.ownerId === null) return fail('unsupported', `spousal RRSP holder not identified: ${contribution.id}`)
    const bucket = scheduledByPerson[contribution.contributorId] ??= { accountId: contribution.accountId, planned: 0 }
    if (bucket.accountId !== contribution.accountId) return fail('unsupported', `one person has scheduled RRSP contributions to more than one account: ${contribution.contributorId}`)
    bucket.planned += contribution.amount
  }
  const view = (): AnnualContext => ({ plan: clone(plan), state: clone(state) })
  let evaluation: AnnualEvaluation
  try { evaluation = providers.evaluate(view()) } catch { return fail('invalid', 'tax/benefit evaluator failed') }
  if (!evaluation || Object.keys(evaluation.byPerson ?? {}).sort().join('|') !== Object.keys(state.byPerson).sort().join('|')) return fail('invalid', 'evaluator person IDs')
  const personRows: YearRow['byPerson'] = {}
  for (const [id, person] of Object.entries(state.byPerson)) {
    const entry = evaluation.byPerson[id]
    if (!entry || ![entry.income, entry.earnedIncome, entry.benefits, entry.tax, entry.spending, entry.taxableIncome].every(finiteNonnegative) ||
        !validKnownAmount(entry.benefitIncomeForNextYear)) return fail('invalid', `evaluator amounts: ${id}`)
    const oas = working && ('household' in working ? working.household.byPerson[id].oas : working.oas)
    const oasColumns = oas && working ? { oasGross: oas.grossReal * working.startCpi, oasRecovery: oas.recoveryReal * working.startCpi, oasNet: oas.netReal * working.startCpi } : {}
    personRows[id] = { ...(working && plan.people.length === 1 && plan.annualBenefitsEvidence?.[id]?.gis?.status === 'annual-estimate' ? { gis: 0 } : {}), ...oasColumns, age: person.age, income: entry.income, earnedIncome: entry.earnedIncome, ...(working && entry.cpp !== undefined ? { cpp: entry.cpp } : {}), benefits: entry.benefits, tax: entry.tax, spending: entry.spending, taxableIncome: entry.taxableIncome }
  }
  for (const dependent of Object.values(state.byDependent)) dependent.age += 1
  const income = sum(Object.values(personRows).map(p => p.income))
  let benefits = sum(Object.values(personRows).map(p => p.benefits))
  let tax = sum(Object.values(personRows).map(p => p.tax))
  const spending = working && 'household' in working ? working.household.spending : sum(Object.values(personRows).map(p => p.spending))
  let householdWithdrawalSettlement: YearRow['householdWithdrawalSettlement']
  const householdMortgage = !!working && "household" in working && isCanonicalGeneratedState(plan, opening) && plan.debts.length > 0
  // Account IDs are opaque; an absent draw must never resolve through
  // Object.prototype (including on the existing no-debt household path).
  const mortgageDraws = new Map<string, MortgageDecimal>()
  const householdDebt = householdMortgage ? settleAnnualDebt(state, plan.debts) : undefined
  if (householdDebt && householdDebt.status !== "ok") return fail(householdDebt.status, householdDebt.reason)
  if (householdMortgage && working && "household" in working) {
    const debtPayments = householdDebt!.status === "ok" ? householdDebt!.value.debtPayments : 0
    // Reproduce computed Ontario employment CPP/CPP2/EI from the pinned
    // rates and caps, rather than treating a serialized multiplication ULP
    // as supplied cash debt. The ordinary payroll and tax postings stay intact.
    const rules = PAYROLL_2026
    // The existing annual start-CPI Number is a serialized decimal factor.
    // Index each recorded wage and living fact with that same factor before
    // summing; never serialize an already rounded household aggregate.
    const exactCpi = mortgageDecimal(working.startCpi)
    let exactIncome = mortgageDecimal(0)
    let exactBenefits = mortgageDecimal(0)
    let exactTax = mortgageDecimal(0)
    let exactPayroll = mortgageDecimal(0)
    for (const [id, person] of Object.entries(working.household.byPerson)) {
      exactIncome = mortgageAdd(exactIncome, mortgageMultiply(mortgageDecimal(person.grossWagesReal), exactCpi))
      exactBenefits = mortgageAdd(exactBenefits, mortgageDecimal(personRows[id].benefits))
      // Ordinary nominal per-person tax is the supported tax-engine boundary:
      // preserve its posted Number as a decimal atom, then sum atoms exactly.
      // This proof does not reconstruct or round tax, or change its postings.
      exactTax = mortgageAdd(exactTax, mortgageDecimal(personRows[id].tax))
      if (person.phase !== "working") continue
      const wages = person.grossWagesReal
      const pensionable = mortgageSubtract(mortgageDecimal(Math.max(rules.basicExemption, Math.min(wages, rules.ympe))), mortgageDecimal(rules.basicExemption))
      const second = mortgageSubtract(mortgageDecimal(Math.max(rules.ympe, Math.min(wages, rules.yampe))), mortgageDecimal(rules.ympe))
      const ei = mortgageMultiply(mortgageDecimal(Math.min(wages, rules.ei.insurable)), mortgageDecimal(rules.ei.rate))
      exactPayroll = mortgageAdd(exactPayroll, mortgageAdd(mortgageAdd(mortgageMultiply(pensionable, mortgageDecimal(rules.cpp.employee)), mortgageMultiply(second, mortgageDecimal(rules.cpp.secondEmployee))), ei))
    }
    exactPayroll = mortgageMultiply(exactPayroll, exactCpi)
    const exactLiving = mortgageMultiply(mortgageDecimal(working.household.spendingReal), exactCpi)
    let available = mortgageSubtract(mortgageSubtract(mortgageAdd(exactIncome, exactBenefits), exactTax), exactPayroll)
    // The admitted contract has exactly one fixed nominal installment.
    const due = mortgageAdd(exactLiving, mortgageDecimal(debtPayments))
    const shortage = mortgageSubtract(due, available)
    const candidates = plan.accounts.filter(a => a.kind === "tfsa" && state.byAccount[a.id].balance > 0)
    const postings: NonNullable<NonNullable<YearRow["householdWithdrawalSettlement"]>["postings"]> = []
    if (working.household.phase !== "both-working" && !mortgageNegative(shortage) && shortage.coefficient !== "0" && candidates.length) {
      if (plan.strategy === "meltdownPaced") return fail("unsupported", "household mortgage withdrawal strategy unsupported")
      const account = candidates[0]
      const statement = tfsaStatement(plan, account.ownerId!)
      if (!statement || statement.provenance.origin === "unknown") return fail("unsupported", "TFSA withdrawal statement evidence missing")
      const capacity = ownMortgageBalance(opening.mortgageExactBalances, account.id) ?? mortgageDecimal(state.byAccount[account.id].balance)
      const draw = mortgageNegative(mortgageSubtract(capacity, shortage)) ? capacity : shortage
      mortgageDraws.set(account.id, draw)
      const amount = mortgageNumber(draw)
      const nominalOpening = state.byAccount[account.id].balance
      const nominalClosing = mortgageNumber(mortgageSubtract(capacity, draw))
      const debit = nominalOpening - nominalClosing
      if (amount > 0 && (debit <= 0 || Math.abs(debit - amount) > Math.min(0.0001, 0.0001 * working.startCpi, amount * 1e-8, 4 * Number.EPSILON * (nominalOpening + amount))))
        return fail("unsupported", "household mortgage withdrawal debit precision cannot be upheld")
      if (amount > 0) postings.push({ accountId: account.id, ownerId: account.ownerId!, kind: "tfsa", amount })
      available = mortgageAdd(available, draw)
    }
    const afterDebt = mortgageSubtract(available, mortgageDecimal(debtPayments))
    if (mortgageNegative(afterDebt)) return fail("unsupported", "mortgage scheduled payment cannot be fully funded")
    const living = mortgageNegative(mortgageSubtract(afterDebt, exactLiving)) ? afterDebt : exactLiving
    const unmet = mortgageSubtract(exactLiving, living)
    if (working.household.phase === "both-working" && unmet.coefficient !== "0") return fail("unsupported", "mortgage working cash cannot be fully funded")
    const nominalAvailable = income + benefits - tax - working.payrollContributions + sum(postings.map(p => p.amount))
    const postedCash = mortgageAdd(mortgageSubtract(mortgageSubtract(mortgageAdd(mortgageDecimal(income), mortgageDecimal(benefits)), mortgageDecimal(tax)), mortgageDecimal(working.payrollContributions)), mortgageDecimal(sum(postings.map(p => p.amount))))
    const reconciliation = mortgageNumber(available) - nominalAvailable ||
      mortgageNumber(mortgageSubtract(available, postedCash))
    householdWithdrawalSettlement = { ...(reconciliation !== 0 ? { mortgageCashReconciliation: reconciliation } : {}), postings, accountId: postings[0]?.accountId ?? null, ownerId: postings[0]?.ownerId ?? null, withdrawal: sum(postings.map(p => p.amount)), taxIncrement: 0, taxTotal: tax, spendingDue: mortgageNumber(exactLiving), spendingFunded: mortgageNumber(living), spendingUnmet: mortgageNumber(unmet), startCpi: working.startCpi }
  }
  // A live taxable alternative prevents a claim of verified exhaustion. Never
  // skip an earlier account in the selected order to manufacture TFSA funding.
  if (!householdMortgage && working && 'household' in working && working.household.phase !== 'both-working' && working.netCash <= 0) {
    const deficit = Math.max(0, -working.netCash)
    const funded = (kind: string) => plan.accounts.filter(a => a.kind === kind && state.byAccount[a.id].balance > 0)
    const rrsps = funded('rrsp')
    const tfsas = funded('tfsa')
    if (deficit > 0 && plan.strategy === 'meltdownPaced') return fail('unsupported', 'household withdrawal order requires unsupported registered funding')
    const order = plan.strategy === 'tfsaFirst' ? ['tfsa', 'rrsp'] as const : ['rrsp', 'tfsa'] as const
    const events: import('./personIncome').IncomeEvent[] = Object.entries(working.household.byPerson).filter(([, p]) => p.phase === 'working').map(([id, p]) => ({ id: `annual:${year}:wage:${id}`, personId: id, kind: 'employment', amount: p.grossWagesReal }))
    for (const [id, p] of Object.entries(working.household.byPerson)) if (p.cpp) events.push({ id: `annual:${year}:cpp:${id}`, personId: id, kind: 'cpp', amount: p.cpp.amountReal })
    const payroll = Object.fromEntries(Object.entries(working.household.byPerson).flatMap(([id, p]) => p.payrollReal ? [[id, p.payrollReal]] : []))
    const oasBenefits = Object.fromEntries(Object.entries(working.household.byPerson).flatMap(([id, p]) => p.oas ? [[id, p.oas]] : []))
    const baselineBenefits = benefits
    const baselineTax = tax
    const cpi = working.startCpi
    const postings: NonNullable<NonNullable<YearRow['householdWithdrawalSettlement']>['postings']> = []
    let remaining = deficit
    let fundedCash = Math.max(0, spending - deficit)
    // Every tolerance is below half a cent in BOTH the cash and tax bases.
    const bound = (...amounts: number[]) => Math.min(0.004, 0.004 * cpi, 4 * Number.EPSILON * sum(amounts.map(Math.abs)))
    const cashScale = income + benefits + tax + working.payrollContributions + spending
    for (const kind of order) {
      if (remaining <= 0) break
      const candidates = kind === 'tfsa' ? tfsas : rrsps
      if (candidates.length > 1) return fail('unsupported', `ambiguous household ${kind === 'tfsa' ? 'TFSA' : 'RRSP'} withdrawal funding order`)
      const account = candidates[0]
      if (!account) continue
      const capacity = state.byAccount[account.id].balance
      let amount: number
      let net: number
      if (kind === 'tfsa') {
        const statement = tfsaStatement(plan, account.ownerId!)
        if (!statement || statement.provenance.origin === 'unknown') return fail('unsupported', 'TFSA withdrawal statement evidence missing')
        // Tax-free cash is direct arithmetic, never a gross-target search.
        amount = Math.min(remaining, capacity)
        net = amount
      } else {
        const run = (gross: number) => {
          const settled = settleHouseholdOas(plan, year, [...events, { id: `annual:${year}:withdrawal:${account.id}`, kind: 'rrspWithdrawal', accountId: account.id, amount: gross / cpi }], payroll, oasBenefits)
          const priced = settled.priced
          const netBenefits = sum(Object.values(settled.oas).map(b => b.netReal)) * cpi
          if (priced.status !== 'ok') throw priced
          const nominalTax = priced.total * cpi
          const amounts = [netBenefits, ...Object.values(settled.oas).flatMap(b => [b.grossReal, b.netReal, b.recoveryReal, b.recoveryIncomeReal, b.grossReal * cpi, b.netReal * cpi, b.recoveryReal * cpi]), gross, gross / cpi, priced.total, nominalTax, baselineTax, baselineTax / cpi,
            ...events.map(e => e.amount), ...events.map(e => e.amount * cpi),
            ...Object.values(priced.byPerson).flatMap(p => [p.tax, p.grossIncome, p.taxableIncome, p.netIncome, p.tax * cpi, p.grossIncome * cpi, p.taxableIncome * cpi, p.netIncome * cpi])]
          // Bound accumulated arithmetic error to a small fraction of a cent.
          // The monetary ceiling alone does not guarantee accurate tax deltas.
          if (amounts.some(n => !finiteNonnegative(n) || n > Number.MAX_SAFE_INTEGER / 100) ||
              64 * Number.EPSILON * sum(amounts) > 0.0001 * Math.min(1, cpi))
            throw { status: 'unsupported', reason: 'household withdrawal tax precision cannot be upheld' }
          return { gross, priced, nominalTax, oas: settled.oas, netBenefits, netCash: gross - (nominalTax - baselineTax) + netBenefits - baselineBenefits }
        }
        try {
          // Test the actual endpoint before any search or later-source gate.
          const endpoint = run(capacity)
          const residue = remaining - endpoint.netCash
          const endpointBound = bound(cashScale, remaining, capacity, endpoint.nominalTax)
          const accepted = residue >= -endpointBound ? endpoint : searchWithdrawalTarget(remaining, 0, capacity, run)
          amount = accepted.gross
          net = accepted.netCash
          tax = accepted.nominalTax
          benefits = accepted.netBenefits
          for (const [id, oas] of Object.entries(accepted.oas)) {
            working.household.byPerson[id].oas = oas
            personRows[id].oasGross = oas.grossReal * cpi
            personRows[id].oasRecovery = oas.recoveryReal * cpi
            personRows[id].oasNet = oas.netReal * cpi
            personRows[id].benefits = oas.netReal * cpi
          }
          for (const [id, priced] of Object.entries(accepted.priced.byPerson)) {
            personRows[id].tax = priced.tax * cpi
            personRows[id].taxableIncome = priced.taxableIncome * cpi
            evaluation.byPerson[id].benefitIncomeForNextYear = { status: 'known', value: (priced.netIncome - (accepted.oas[id]?.netReal ?? 0)) * cpi }
          }
        } catch (error) {
          const problem = error as { status?: string; reason?: string }
          return fail(problem.status === 'invalid' ? 'invalid' : 'unsupported', problem.reason ?? 'household withdrawal tax trial failed')
        }
      }
      if (amount > 0) {
        // A positive cash receipt must correspond to a real account debit.
        // Permit only ULP-scale noise, capped in both money bases and relative
        // to the actual draw; a large opening balance cannot mint tiny cash.
        const debit = capacity - (capacity - amount)
        const debitTolerance = Math.min(0.0001, 0.0001 * cpi, amount * 1e-8,
          4 * Number.EPSILON * (capacity + amount))
        if (debit <= 0 || Math.abs(debit - amount) > debitTolerance)
          return fail('unsupported', 'household withdrawal debit precision cannot be upheld')
        postings.push({ accountId: account.id, ownerId: account.ownerId!, kind, amount })
      }
      fundedCash += net
      const residue = remaining - net
      remaining = Math.abs(residue) <= bound(cashScale, remaining, net, tax) ? 0 : Math.max(0, residue)
    }
    const withdrawal = sum(postings.map(p => p.amount))
    // Carry the accepted quote deficit and each accepted net cash tranche.
    // Re-subtracting gross wages/tax/spending can change a small shortage;
    // subtracting a huge bill from itself can erase a tiny actual payment.
    const spendingFunded = remaining === 0 ? spending : Math.min(spending, Math.max(0, fundedCash))
    const spendingUnmet = remaining
    if (Math.abs(spending - (spendingFunded + spendingUnmet)) > bound(spending, spendingFunded, spendingUnmet))
      return fail('unsupported', 'household withdrawal cash precision cannot be upheld')
    householdWithdrawalSettlement = { ...(Object.keys(oasBenefits).length ? { baselineBenefits, settledBenefits: benefits } : {}), accountId: postings.length === 1 ? postings[0].accountId : null, ownerId: postings.length === 1 ? postings[0].ownerId : null, postings, taxIncrement: tax - baselineTax, taxTotal: tax, withdrawal, spendingDue: spending, spendingFunded, spendingUnmet, startCpi: working.startCpi }
  }
  const cash = working ? Math.max(0, working.netCash) : cashBudget(plan.budget, year, plan.baseYear, plan.inflation)
  if (cash === null || !Number.isFinite(cash)) return fail('invalid', 'nominal savings budget')
  if (cash < 0) return fail('unsupported', 'negative net savings needs withdrawal funding rule')
  const debtSettlement = householdDebt ?? settleAnnualDebt(state, working && isCanonicalGeneratedState(plan, opening) && plan.debts.length ? plan.debts : undefined)
  if (debtSettlement.status !== "ok") return fail(debtSettlement.status, debtSettlement.reason)
  const { debtRows, debtPayments } = debtSettlement.value
  // The private working quote already validated and normalized its cash in
  // the common anchor basis. Reordering those operands can invent a deficit.
  const evaluatedCash = householdWithdrawalSettlement ? 0 : working ? working.netCash : income + benefits - tax - spending - debtPayments
  if (!Number.isFinite(evaluatedCash)) return fail('invalid', 'evaluated cash')
  if (evaluatedCash < -1e-8) return fail('unsupported', 'taxable withdrawal funding not yet wired')
  if (Math.abs(evaluatedCash - cash) > 0.01) return fail('unsupported', 'evaluated cash disagrees with canonical net savings budget')
  const recurring = plan.recurringContributions.filter(c => state.byAccount[c.accountId])
  if (recurring.length !== plan.recurringContributions.length) return fail('invalid', 'recurring contribution account missing')
  if (recurring.some(c => !finiteNonnegative(c.annualAmount) || !['fhsa', 'lira'].includes(state.byAccount[c.accountId].kind) || (state.byAccount[c.accountId].kind === 'fhsa' && c.funding !== 'fromSavings'))) return fail('unsupported', 'recurring contribution rule not yet wired')
  const scheduledPlanned = sum(Object.values(scheduledByPerson).map(bucket => bucket.planned))
  // A scheduled contribution is funded from the year's net savings, like the
  // configured voluntary split; it is never extra money the plan does not have.
  if (scheduledPlanned > cash + 1e-8) return fail('unsupported', 'scheduled RRSP contribution exceeds the year net savings')
  // One allocation resolver serves the kernel and the panel preview, so the
  // voluntary RRSP share priced here is the same number the panel shows.
  const allocation = working ? allocateContributions({ age: opening.byPerson[self.id].age, budget: cash, fhsa: 0, employee: 0, employer: 0, split: plan.savingsAllocation.shares }) : resolveYearAllocation(plan, year)
  if (allocation.gaps.length) return { status: 'unsupported', issues: allocation.gaps.map(gap => ({ code: 'unfunded', detail: gap.reason, eventId: gap.eventId })) }
  if (plan.people.length > 1 && allocation.voluntary.rrsp > 0) return fail('unsupported', 'couple RRSP contributor and room attribution not yet wired')
  // TFSA room belongs to one person, so a couple's contribution cannot be
  // attributed to a room ledger. It is refused rather than parked on an
  // unidentified owner, exactly as the RRSP share above is.
  if (plan.people.length > 1 && allocation.voluntary.tfsa > 0) return fail('unsupported', 'couple TFSA contributor and room attribution not yet wired')
  const rrspDestinations = Object.entries(state.byAccount).filter(([, account]) => account.kind === 'rrsp')
  if (allocation.voluntary.rrsp > 0 && rrspDestinations.length !== 1) return fail('unsupported', 'ambiguous rrsp contribution destination')
  const nonRegDestinations = Object.entries(state.byAccount).filter(([, account]) => account.kind === 'nonReg')
  const accountRows: YearRow['byAccount'] = Object.fromEntries(Object.entries(state.byAccount).map(([id, account]) => [id, {
    opening: account.balance, contribution: 0, withdrawal: 0, returnAmount: 0, closing: account.balance, acb: clone(account.acb), ownerId: account.ownerId,
  }]))
  for (const contribution of recurring) {
    // An FHSA recurring row is not paid here: `resolveYearAllocation` already
    // carved it out of the year's savings, and the participation-room ledger
    // below decides how much of it may execute. Paying it here would pay the
    // same money twice.
    if (state.byAccount[contribution.accountId].kind === 'fhsa') continue
    const amount = contribution.annualAmount
    accountRows[contribution.accountId].contribution += amount
    state.contributionHistory.push({ id: `${contribution.id}:${year}`, accountId: contribution.accountId, contributorId: contribution.contributorId, calendarYear: year, amount, deductionYear: null })
  }
  // BE-36 A: the ordinary FHSA contribution priced against the holder's own
  // participation room — the recorded rows for this account plus the FHSA share
  // of the resolved savings split. RRSP transfers stay out until the plan can
  // verify them.
  // Origin accompanies the exact request slice through pricing; result arrays
  // preserve input order. IDs are source facts and need not be disjoint from
  // generated voluntary IDs, so they must never select memo amounts.
  const scheduledResults: { applied: number; retained: number }[] = []
  const fhsaLedger: Record<string, FhsaRoomYear> = {}
  if (fhsaAccount) {
    const owner = plan.people.find(person => person.id === fhsaAccount.ownerId)!
    const account = plan.accounts.find(item => item.id === activeFhsaId)!
    // The opening-year account column holds the statement's unused room from
    // earlier years. Every later year carries the prior year's closing room, so
    // `opening(y) == closing(y-1)` and a rerun changes nothing. The lifetime
    // basis follows the same rule: once a year has been priced, the prior row's
    // cumulative total is authoritative, so a projected contribution can never
    // be forgotten and counted again next year.
    const prior = fhsaLedgerByPerson[owner.id]
    const statement = fhsaStatementHistory(plan, activeFhsaId!)
    // Once a year has been priced, the prior row's cumulative total is
    // authoritative, so a projected contribution can never be forgotten and
    // counted again next year. A prior row whose room was never established (a
    // held account with nothing priced) carries no cumulative, so the plan's own
    // statement is used instead of inheriting a permanent unknown.
    const priorCumulative = prior?.cumulativeContributions
    const history = priorCumulative?.status === 'known'
      ? {
        cumulativePriorContributions: priorCumulative,
        provenance: statement?.provenance ?? account.provenance.balance ?? { origin: 'estimated' as const, sourceYear: plan.baseYear },
      }
      : statement
    // One request builder serves the kernel and the panel preview, so both price
    // the same recorded plan and the same line set. A second, stale row for the
    // account is never priced on top of the recorded row.
    const { planned, origins } = fhsaPlannedYearRequestWithOrigins({ plan, account, year })
    const ledger = fhsaRoomYear({
      personId: owner.id,
      accountId: activeFhsaId!,
      year,
      // A legacy plan that only recorded "years ago" keeps its unknown calendar
      // year, and an unknown opening year is refused rather than assumed. A
      // prior row, known or not, owns the carry: falling back to the opening
      // room would turn an unestablished prior room into a real zero.
      openedYear: state.byAccount[activeFhsaId!].openedYear,
      openingRoom: prior ? prior.closingRoom : fhsaOpeningRoom(plan, account),
      history,
      lines: planned.request.lines,
    })
    // Persisted for the next year's opening room, and returned for the panel.
    fhsaLedgerByPerson[owner.id] = ledger
    fhsaLedger[owner.id] = ledger
    ledger.lines.forEach((line, index) => { if (origins[index] === 'scheduled') scheduledResults.push(line) })
    const blocking = ledger.limitations.filter(limitation => FHSA_BLOCKING.has(limitation.code))
    // An unconfirmed statement with nothing planned prices nothing, so it does
    // not have to stop the whole year: the panel says the same thing. A year
    // that would actually move money into the unknown room is still refused.
    if (ledger.planned > 0 && blocking.length) return fail('unsupported', `FHSA participation room not verified for ${owner.id}: ${blocking.map(item => item.detail).join('; ')}`)
    if (ledger.retained > FHSA_MONEY_TOLERANCE &&
        !ledger.limitations.some(limitation => limitation.code === 'annualCapped' || limitation.code === 'lifetimeCapped' || limitation.code === 'carryForwardCapped'))
      return fail('invalid', `FHSA clipped without a reason: ${activeFhsaId}`)
    // The maturity clock is refused even when the year still has room: BE-36 B
    // owns the rollover, so a reached maturity may never silently keep saving.
    const maturity = ledger.limitations.find(limitation => limitation.code === 'maturityUnsupported')
    if (maturity && ledger.planned > 0) return fail('unsupported', maturity.detail)
    for (const line of ledger.lines) {
      if (line.applied <= 0) continue
      accountRows[activeFhsaId!].contribution += line.applied
      state.contributionHistory.push({
        id: line.id, accountId: activeFhsaId!, contributorId: owner.id,
        calendarYear: line.calendarYear, amount: line.applied, deductionYear: null,
      })
    }
  }
  // BE-27 A: the TFSA share of the year's savings is priced against the
  // person's own room ledger. TFSA room belongs to the person, so it is never
  // read from — or written back to — an account's own `contributionRoom`
  // column, and an unconfirmed room is never a refusal: the contribution is
  // clipped and the money is retained visibly in the non-registered account.
  // The statement year drives the addition and the restoration, and both come
  // from the same functions the panel uses, so the two cannot drift.
  const tfsaDestinations = Object.entries(state.byAccount).filter(([, account]) => account.kind === 'tfsa')
  if (allocation.voluntary.tfsa > 0 && tfsaDestinations.length !== 1) return fail('unsupported', 'ambiguous tfsa contribution destination')
  const tfsaAccountId = tfsaDestinations.length === 1 ? tfsaDestinations[0][0] : null
  const tfsaLedger: Record<string, TfsaRoomYear> = {}
  for (const person of plan.people) {
    const facts = state.byPerson[person.id]
    const statement = tfsaStatement(plan, person.id)
    const row = tfsaRoomYear({
      personId: person.id, year,
      // The recorded CRA figure is the plan year's own room, exactly as the RRSP
      // statement is read; every later year carries the prior row's closing
      // room, so `opening(y) == closing(y-1)`.
      statementYear: plan.baseYear,
      openingRoom: facts.tfsaRoom,
      annualAddition: annualTfsaAdditionFor(year, plan.baseYear),
      withdrawals: [...(statement?.withdrawals ?? []), ...(working && 'household' in working ? (state.tfsaWithdrawalHistory ?? []).filter(h => h.personId === person.id) : [])],
      lines: plannedTfsaLines({ personId: person.id, year, savingsShare: plan.people.length === 1 ? allocation.voluntary.tfsa : 0 }),
    })
    tfsaLedger[person.id] = row
    facts.tfsaRoom = row.closingRoom
    for (const line of row.lines) {
      if (line.applied <= 0) continue
      if (!tfsaAccountId) return fail('unsupported', `TFSA contribution has no account: ${person.id}`)
      accountRows[tfsaAccountId].contribution += line.applied
      state.contributionHistory.push({ id: line.id, accountId: tfsaAccountId, contributorId: person.id, calendarYear: line.calendarYear, amount: line.applied, deductionYear: null })
    }
  }
  const rrspLedger: Record<string, RrspRoomYear> = {}
  for (const person of plan.people) {
    const facts = state.byPerson[person.id]
    const bucket = scheduledByPerson[person.id]
    const voluntary = plan.people.length === 1 ? allocation.voluntary.rrsp : 0
    // The same line set `previewRrspRoomYear` prices for the panel: recorded
    // rows plus the resolved savings-split RRSP share.
    const slices = plannedRrspSlices({ accounts: plan.accounts, contributions: plan.contributions, personId: person.id, year, savingsShare: voluntary })
    const lines = slices.map(slice => slice.line)
    const statementYear = year === plan.baseYear
    let openingRoom = facts.rrspRoom
    let mismatch: RrspRoomLimitation | null = null
    if (statementYear) {
      const derived = statementOpeningRoom({
        rrspDeductionLimit: facts.rrspDeductionLimit, rrspAvailableRoom: facts.rrspRoom, rrspUnusedUndeducted: facts.rrspUnusedUndeducted,
        rrspPensionAdjustment: facts.rrspPensionAdjustment, rrspPspa: facts.rrspPspa, rrspPar: facts.rrspPar,
      })
      openingRoom = derived.room
      mismatch = derived.mismatch
    }
    const row = rrspRoomYear({
      personId: person.id, year, openingRoom,
      // The statement's available room already includes the statement year's
      // addition. A later year would need the missing sourced cap/18% rule.
      additions: statementYear ? { status: 'known', value: 0 } : { status: 'unknown', reason: RRSP_ADDITION_RULE_MISSING },
      adjustments: { pensionAdjustment: facts.rrspPensionAdjustment, pspa: facts.rrspPspa, par: facts.rrspPar },
      adjustmentBasis: statementYear ? 'includedInStatement' : 'appliedHere',
      unusedUndeducted: facts.rrspUnusedUndeducted, deductionLimit: facts.rrspDeductionLimit, mismatch, lines,
    })
    rrspLedger[person.id] = row
    row.lines.forEach((line, index) => { if (slices[index].origin === 'scheduled') scheduledResults.push(line) })
    const blocking = row.limitations.filter(limitation => limitation.code !== 'deductionYearBeforeContribution')
    if (row.planned > 0 && blocking.length) return fail('unsupported', `RRSP room not verified for ${person.id}: ${blocking.map(item => item.detail).join('; ')}`)
    const backdated = row.limitations.find(limitation => limitation.code === 'deductionYearBeforeContribution')
    if (backdated) return fail('unsupported', backdated.detail)
    facts.rrspRoom = row.closingRoom
    for (const line of row.lines) {
      if (line.applied <= 0) continue
      const accountId = bucket?.accountId ?? rrspDestinations[0]?.[0]
      if (!accountId) return fail('unsupported', `RRSP contribution has no account: ${person.id}`)
      accountRows[accountId].contribution += line.applied
      state.contributionHistory.push({ id: line.id, accountId, contributorId: person.id, calendarYear: line.calendarYear, amount: line.applied, deductionYear: line.deductionYear })
    }
  }
  // Money an RRSP, FHSA or TFSA plan could not legally execute is retained,
  // visibly, in the non-registered account instead of being deleted or rerouted
  // to registered room.
  const retainedContributions = roundCents(
    sum(Object.values(rrspLedger).map(row => row.retained)) +
    sum(Object.values(fhsaLedger).map(row => row.retained)) +
    sum(Object.values(tfsaLedger).map(row => row.retained)))
  if (working && Object.values(tfsaLedger).some(row => row.retained > 0 || (cash > 0 && row.closingRoom.status !== 'known'))) return fail('unsupported', 'canonical working TFSA room unknown or clipped; no taxable contribution sink')
  const nonRegAmount = allocation.voluntary.nonReg + retainedContributions
  if (nonRegAmount > 0) {
    if (nonRegDestinations.length !== 1) return fail('unsupported', 'ambiguous nonReg contribution destination')
    accountRows[nonRegDestinations[0][0]].contribution += nonRegAmount
    state.contributionHistory.push({ id: `annual:${year}:nonReg`, accountId: nonRegDestinations[0][0], contributorId: plan.people.length === 1 ? self.id : null, calendarYear: year, amount: nonRegAmount, deductionYear: null })
  }
  const totalContributions = sum(Object.values(accountRows).map(row => row.contribution))
  if (working) {
    const bound = 0.005 + Math.min(1e-9, 4 * Number.EPSILON * (totalContributions + cash))
    if (Math.abs(totalContributions - cash) > bound) return fail('unsupported', 'canonical TFSA cash requires representable cent contribution; no rounding sink')
  }
  if (Math.abs(totalContributions - cash - allocation.employer) > 0.01) return fail('invalid', 'cash/contribution conservation')
  // Every provider evaluates the same settled, pre-growth portfolio. Neither
  // account order nor a provider mutating its own context may affect peers.
  for (const [id, account] of Object.entries(state.byAccount)) {
    if (working && isCanonicalGeneratedState(plan, opening) && plan.annualNonRegEvidence?.accountId === id && accountRows[id].contribution !== 0) return fail("unsupported", "nonReg: working taxable contributions not supported")
    account.balance += accountRows[id].contribution
    if (account.kind === 'nonReg' && account.acb.status === 'known') account.acb.value += accountRows[id].contribution
  }
  if (householdWithdrawalSettlement) {
    for (const { accountId, ownerId, kind, amount } of householdWithdrawalSettlement.postings ?? []) {
      state.byAccount[accountId].balance = mortgageDraws.has(accountId) ? mortgageNumber(mortgageSubtract(ownMortgageBalance(opening.mortgageExactBalances, accountId) ?? mortgageDecimal(opening.byAccount[accountId].balance), mortgageDraws.get(accountId)!)) : state.byAccount[accountId].balance - amount
      if (mortgageDraws.has(accountId)) accountRows[accountId].mortgageExactWithdrawal = mortgageDraws.get(accountId)!
      accountRows[accountId].withdrawal = amount
      if (kind === 'tfsa') state.tfsaWithdrawalHistory = [...(state.tfsaWithdrawalHistory ?? []), { id: `annual:${year}:withdrawal:${accountId}`, personId: ownerId, calendarYear: year, amount }]
    }
  }
  const settled = clone(state)
  if (Object.values(settled.byAccount).some(account => !finiteNonnegative(account.balance))) return fail('invalid', 'pre-growth account balance')
  const rates: Record<string, number> = {}
  for (const id of Object.keys(settled.byAccount)) {
    let rate: number
    try { rate = providers.returns({ plan: clone(plan), state: clone(settled) }, id) } catch { return fail('invalid', `return provider failed: ${id}`) }
    if (!Number.isFinite(rate) || rate < -1) return fail('invalid', `return rate: ${id}`)
    if (householdMortgage || working && isCanonicalGeneratedState(plan, opening) && plan.annualNonRegEvidence && settled.byAccount[plan.annualNonRegEvidence.accountId]?.nonRegPool)
      Object.defineProperty(rates, id, { value: rate, enumerable: true, writable: true, configurable: true })
    else rates[id] = rate
  }
  for (const [id, account] of Object.entries(state.byAccount)) {
    accountRows[id].returnAmount = account.balance * rates[id]
    account.balance += accountRows[id].returnAmount
    if (working && isCanonicalGeneratedState(plan, opening) && plan.debts.length) {
      const exact = mortgageDraws.has(id) ? mortgageMultiply(mortgageSubtract(ownMortgageBalance(opening.mortgageExactBalances, id) ?? mortgageDecimal(opening.byAccount[id].balance), mortgageDraws.get(id)!), mortgageAdd(mortgageDecimal(1), mortgageDecimal(rates[id]))) : mortgageClosing(ownMortgageBalance(opening.mortgageExactBalances, id) ?? mortgageDecimal(opening.byAccount[id].balance), accountRows[id].contribution, accountRows[id].withdrawal, rates[id])
      const precise = mortgageNumber(exact)
      const correction = precise - account.balance
      if (!Number.isFinite(precise) || mortgageNegative(exact) || Math.abs(correction) >= Math.min(0.005, 0.005 * working.startCpi)) return fail("unsupported", "mortgage decimal balance precision boundary")
      // Keep the published ordinary-object shape, but write an own data key.
      Object.defineProperty(state.mortgageExactBalances ??= {}, id, { value: exact, enumerable: true, writable: true, configurable: true })
      if (correction !== 0) accountRows[id].mortgageArithmeticReconciliation = correction
      account.balance = precise
    }
    accountRows[id].closing = account.balance
    accountRows[id].acb = clone(account.acb)
  }
  if (working && isCanonicalGeneratedState(plan, opening)) {
    try { carryProspectivePurchaseBalance(plan, opening, state, accountRows) }
    catch { return fail("unsupported", "primary home purchase: prospective decimal precision boundary") }
  }
  let propertyRows: YearRow['byProperty']
  try { propertyRows = growHeldProperties(plan, state) } catch (error) {
    const issue = error as { status: 'invalid' | 'unsupported'; reason: string }
    return fail(issue.status, issue.reason)
  }
  for (const [id, person] of Object.entries(state.byPerson)) {
    person.age += 1
    person.previousYearEarnedIncome = { status: 'known', value: personRows[id].earnedIncome }
    state.benefitIncomeLag[id] = clone(evaluation.byPerson[id].benefitIncomeForNextYear)
    if (working) {
      const income = evaluation.byPerson[id].benefitIncomeForNextYear
      const payroll = 'household' in working ? working.household.byPerson[id].payrollReal : working.payrollReal
      // Tax net already deducted enhanced CPP. Reverse that deduction before
      // subtracting full employee CPP/EI under the GIS income definition.
      const fullPayroll = (payroll?.contributions ?? 0) * working.startCpi
      const enhancedAlreadyDeducted = (payroll?.taxDeduction ?? 0) * working.startCpi
      ;(state.gisAssessmentLag ??= {})[id] = income.status === 'known'
        ? gisAssessmentReceipt(year, income.value + enhancedAlreadyDeducted - fullPayroll, personRows[id].earnedIncome - fullPayroll)
        : { status: 'unknown', reason: income.reason }
    } else if (state.gisAssessmentLag) delete state.gisAssessmentLag[id]
  }
  state.fhsaLedgers = { ...fhsaLedgerByPerson }
  state.year += 1
  const committedProblem = snapshotProblem(plan, state, working && isCanonicalGeneratedState(plan, opening) ? opening : undefined)
  if (committedProblem) return fail('invalid', `year-end state: ${committedProblem}`)
  const contributionLedger: YearRow['contributionLedger'] = {
    allocationCashBasis: cash,
    scheduledRrspBudgeted: scheduledPlanned,
    scheduledPlanned: sum(scheduled.map(line => line.amount)),
    scheduledApplied: sum(scheduledResults.map(line => line.applied)),
    scheduledRetained: sum(scheduledResults.map(line => line.retained)),
    appliedTotal: totalContributions,
    postings: state.contributionHistory.slice(opening.contributionHistory.length).map(line => ({
      id: line.id, accountId: line.accountId, ownerId: state.byAccount[line.accountId].ownerId,
      contributorId: line.contributorId, amount: line.amount,
    })),
    retained: ([['rrsp', rrspLedger], ['fhsa', fhsaLedger], ['tfsa', tfsaLedger]] as const).flatMap(([kind, ledger]) =>
      Object.entries(ledger).filter(([, row]) => row.retained > 0).map(([personId, row]) => ({ personId, kind, amount: row.retained }))),
  }
  const row: YearRow = { ...(working ? { workingSettlement: { ...working, payrollRuleId: 'PAYROLL_2026', payrollPolicy: 'Pinned 2026 Ontario employment CPP/EI rules in anchor-real dollars; ages 19–69 only; no future statutory promise' }, payrollContributions: working.payrollContributions, contributionRounding: totalContributions - cash } : {}), year, byPerson: personRows, byAccount: accountRows, byDebt: debtRows, byProperty: propertyRows, contributionLedger,
    cashLedger: { income, benefits, tax, spending, debtPayments, fhsaContributions: allocation.fhsa, employeeContributions: allocation.employee,
      employerContributions: allocation.employer, voluntaryContributions: sum(Object.values(allocation.voluntary)), retainedContributions, unallocated: 0 },
    taxLedger: Object.fromEntries(Object.entries(personRows).map(([id, p]) => [id, { taxableIncome: p.taxableIncome, tax: p.tax }])), rrspLedger, fhsaLedger, tfsaLedger, issues: [] }
  if (householdWithdrawalSettlement) {
    row.householdWithdrawalSettlement = householdWithdrawalSettlement
    row.cashLedger.spending = householdWithdrawalSettlement.spendingFunded
  }
  if (working && 'household' in working && working.household.phase === 'both-retired') delete row.contributionRounding
  if (working) {
    const safeMoney = (n: number) => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER / 100
    if (Object.values(state.byAccount).some(a => !safeMoney(a.balance)) || !safeMoney(sum(Object.values(state.byAccount).map(a => a.balance))) ||
        Object.values(tfsaLedger).some(r => [r.availableRoom, r.closingRoom].some(f => f.status === 'known' && !safeMoney(f.value)))) return fail('invalid', 'working unsafe closing balance or TFSA room')
  }
  return { status: 'ok', value: { state, row } }
}

export function annualStep(plan: InputsV2, opening: AnnualState, providers: AnnualProviders): KernelResult<AnnualStepValue> {
  try { return annualStepUnchecked(plan, opening, providers) }
  catch (error) { if (error instanceof MortgagePrecisionError) return fail(error.status, error.reason); return fail('invalid', 'damaged annual snapshot or provider result') }
}

/** An internal canonical run, with provider-supplied evaluation, not production tax pricing.
 * Only rows successfully returned by annualStep are settled. state is never advanced
 * through a blocked year; its year is the first year that remains to be evaluated.
 */
export type AnnualStopCause = 'nonRegSale' | 'retirement' | 'propertyPurchase' | 'propertySale' | 'registeredWithdrawal' | 'registeredConversion'
  | 'withdrawalOwnership' | 'tfsaWithdrawalEvidence'
  | 'fhsaRules' | 'rrspRoom' | 'withdrawalFunding' | 'cashMismatch' | 'contributionAttribution'
  | 'contributionFunding' | 'invalidEvaluation' | 'invalidReturn' | 'invalidState' | 'unsupported'

/** Diagnostic classification stays internal: detail strings never become display text.
 * The strict API returns its original issue objects, without extra fields. */
export function annualStopCause(issue: AnnualIssue): AnnualStopCause {
  const detail = issue.detail
  if (detail.startsWith("nonReg:")) return "nonRegSale"
  if (issue.code === 'unfunded') return 'contributionFunding'
  if (detail === 'retirement withdrawals and benefit rules not yet wired') return 'retirement'
  if (detail.startsWith('primary home purchase:') || detail.startsWith('planned purchase funding')) return 'propertyPurchase'
  if (detail.startsWith('property sale funding') || detail.startsWith('primary home sale:')) return 'propertySale'
  if (/^(RRIF|LIF) minimum withdrawal/.test(detail)) return 'registeredWithdrawal'
  if (/^(RRSP|LIRA|FHSA) age-71/.test(detail)) return 'registeredConversion'
  if ([FHSA_OPENING_YEAR_MISSING, FHSA_MULTIPLE_ACTIVE_ACCOUNTS, FHSA_MATURITY_UNSUPPORTED].some(message => detail === message || detail.startsWith(`${message}: `))) return 'fhsaRules'
  if (/^fhsa/i.test(detail) || detail.startsWith('scheduled FHSA') || detail.startsWith('only the FHSA')) return 'fhsaRules'
  if (detail.startsWith('RRSP room not verified')) return 'rrspRoom'
  if (/^ambiguous household (TFSA|RRSP) withdrawal funding order$/.test(detail)) return 'withdrawalOwnership'
  if (detail === 'TFSA withdrawal statement evidence missing') return 'tfsaWithdrawalEvidence'
  if (detail.startsWith('household withdrawal order requires') || detail.startsWith('household remaining spending requires')) return 'withdrawalFunding'
  if (detail === 'taxable withdrawal funding not yet wired' || detail === 'negative net savings needs withdrawal funding rule' || detail === 'negative working cash requires withdrawal funding rule') return 'withdrawalFunding'
  if (detail === 'evaluated cash disagrees with canonical net savings budget') return 'cashMismatch'
  if (detail.startsWith('scheduled RRSP contribution exceeds')) return 'contributionFunding'
  if (/^(couple |ambiguous |scheduled RRSP contributor|RRSP contributor differs|one person has scheduled)/.test(detail)) return 'contributionAttribution'
  if (/^(tax\/benefit evaluator|evaluator )/.test(detail)) return 'invalidEvaluation'
  if (/^(return provider|return rate)/.test(detail)) return 'invalidReturn'
  return issue.code === 'invalid' ? 'invalidState' : 'unsupported'
}

export interface AnnualCoverage {
  baseYear: number
  inflation: number
  terminalYear: number
  requestedStartYear: number
  requestedYears: number
  state: AnnualState
  rows: YearRow[]
  blocked: { year: number; status: 'invalid' | 'unsupported'; issues: AnnualIssue[]; causes: AnnualStopCause[] } | null
  /** Requested years strictly after the first blocked year. */
  uncomputedYears: number[]
  overallConclusionAvailable: boolean
  gisOptInPersonIds?: string[]
  evaluationBasis: 'provider-supplied' | 'canonical-retirement' | 'canonical-continuous'
}

export function projectAnnualCoverage(plan: InputsV2, opening: AnnualState, years: number, providers: AnnualProviders): KernelResult<AnnualCoverage> {
  if (!Number.isInteger(years) || years < 0 || years > 120) return fail('invalid', 'projection years')
  try { assertCanonicalPlan(plan) } catch { return fail('invalid', 'canonical plan shape') }
  const gate = pricingGate(plan)
  if (!gate.allowed) return fail('unsupported', `pricing gate: ${gate.reasons.join(', ')}`)
  const problem = snapshotProblem(plan, opening)
  if (problem) return fail('invalid', problem)
  let state: AnnualState
  try { state = clone(opening) } catch { return fail('invalid', 'snapshot cannot be cloned') }
  const rows: YearRow[] = []
  let blocked: AnnualCoverage['blocked'] = null
  for (let index = 0; index < years; index++) {
    const next = annualStep(plan, state, providers)
    if (next.status !== 'ok') {
      blocked = { year: state.year, status: next.status, issues: next.issues, causes: [...new Set(next.issues.map(annualStopCause))] }
      break
    }
    state = next.value.state
    rows.push(next.value.row)
  }
  return { status: 'ok', value: {
    baseYear: plan.baseYear, inflation: plan.inflation, terminalYear: plan.baseYear + plan.lifeExpectancy - plan.people.find(person => person.role === 'self')!.ageInBaseYear, requestedStartYear: opening.year,
    requestedYears: years, state, rows, blocked,
    uncomputedYears: blocked ? Array.from({ length: years - rows.length - 1 }, (_, i) => blocked!.year + i + 1) : [],
    // A completed requested window is not a verified retirement/estate conclusion.
    overallConclusionAvailable: false, evaluationBasis: 'provider-supplied',
  } }
}

/** Strict compatibility API: a blocked step still fails the entire requested run. */
export function projectFromState(plan: InputsV2, opening: AnnualState, years: number, providers: AnnualProviders): KernelResult<{ state: AnnualState; rows: YearRow[] }> {
  const result = projectAnnualCoverage(plan, opening, years, providers)
  if (result.status !== 'ok') return result
  const { state, rows, blocked } = result.value
  if (blocked) return { status: blocked.status, issues: blocked.issues }
  return { status: 'ok', value: { state, rows } }
}

export const sumInvestableAssets = (state: AnnualState) => sum(Object.values(state.byAccount).map(account => account.balance))
export const sumNetWorth = (state: AnnualState) => sumInvestableAssets(state) + (state.primaryHomeSaleCash?.balance ?? 0) + sum(Object.values(state.byProperty).filter(p => p.held).map(p => p.value)) - sum(Object.values(state.byDebt).map(d => d.principal))
export const sumWithdrawals = (row: YearRow) => sum(Object.values(row.byAccount).map(account => account.withdrawal))

// Only identities emitted inside this synchronous run are authorized. The map
// is never exposed and returned states are not reusable continuation tokens.
const generatedStates = new WeakMap<AnnualState, InputsV2>()
export const isCanonicalGeneratedState = (plan: InputsV2, state: AnnualState): boolean => generatedStates.get(state) === plan

/** Internal continuous slice: no supplied snapshots, evaluators, or state splice. */
export function projectCanonicalCoverage(plan: InputsV2, evidence: WorkingSpendingEvidence, years: number): KernelResult<AnnualCoverage> {
  try {
    if (!Number.isInteger(years) || years < 0 || years > 120) return fail('invalid', 'projection years')
    plan = clone(plan)
    const initialized = initializeState(plan)
    if (initialized.status !== 'ok') return initialized
    for (const person of plan.people) {
      const problem = cppInputProblem(person)
      if (problem) return fail('invalid', problem)
    }
    if (plan.baseYear !== 2026 || ![1, 2].includes(plan.people.length) || plan.province !== 'ON' || plan.budget.kind !== 'incomeBudget') return fail('unsupported', 'continuous projection requires one or two Ontario people with incomeBudget at 2026 anchor')
    if (plan.people.some(p => p.ageInBaseYear >= p.retirementAge)) return fail('unsupported', 'continuous projection requires an initial working year for each person; use strict standalone retirement')
    evidence = clone(evidence)
    let state = initialized.value
    if (plan.annualNonRegEvidence) {
      const problem = nonRegProblem(plan, state, true)
      if (problem) return fail("unsupported", problem)
      const e = plan.annualNonRegEvidence
      state.byAccount[e.accountId].nonRegPool = { holdingId: e.holdingId, units: e.units }
    }
    let committedWorking = false
    const rows: YearRow[] = []
    let blocked: AnnualCoverage['blocked'] = null
    for (let i = 0; i < years; i++) {
      let result: KernelResult<AnnualStepValue>
      const person = plan.people.find(p => p.role === 'self')!
      if (plan.people.length === 2 || state.byPerson[person.id].age < person.retirementAge) {
        const safeMoney = (n: number) => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER / 100
        const unsafe = Object.values(state.byAccount).some(a => !safeMoney(a.balance)) || !safeMoney(sum(Object.values(state.byAccount).map(a => a.balance))) || Object.values(state.byPerson).some(p => p.tfsaRoom.status === 'known' && !safeMoney(p.tfsaRoom.value))
        generatedStates.set(state, plan)
        const quote = unsafe ? fail('invalid', 'working unsafe monetary amount or TFSA room') : plan.people.length === 2 ? evaluateCanonicalHouseholdWorkingYear(plan, evidence, state.year, state) : evaluateCanonicalWorkingYear(plan, evidence, state.year, state)
        generatedStates.delete(state)
        if (quote.status !== 'ok') result = quote
        else if ('age' in quote.value && quote.value.age === 18) result = fail('unsupported', 'age-18 partial-year CPP eligibility not modeled')
        else if (plan.people.some(p => tfsaStatement(plan, p.id)?.withdrawals.some(h => h.amount > 0 && h.calendarYear >= plan.baseYear))) result = fail('unsupported', 'recorded active TFSA withdrawal events not modeled in working chain')
        else if (quote.value.netCash > 0 && Object.entries(plan.savingsAllocation.shares).some(([kind, share]) => share !== (kind === 'tfsa' ? 1 : 0))) result = fail('unsupported', 'continuous working allocation supports TFSA only')
        else {
          generatedStates.set(state, plan)
          try { result = annualStepUnchecked(plan, state, { evaluate: () => clone(quote.value.evaluation), returns: fixedReturnProvider }, quote.value) }
          finally { generatedStates.delete(state) }
        }
        if (result.status === 'ok') { result.value.state.tfsaWithdrawalHistory ??= []; committedWorking = true }
      } else {
        if (!committedWorking) return fail('unsupported', 'retirement handoff requires a committed canonical working prefix')
        generatedStates.set(state, plan)
        result = annualRetirementContinuation(plan, state, evidence)
        generatedStates.delete(state)
      }
      if (result.status !== 'ok') { blocked = { year: state.year, status: result.status, issues: result.issues, causes: [...new Set(result.issues.map(annualStopCause))] }; break }
      state = result.value.state
      if (committedWorking && plan.annualTerminalEstateEvidence !== undefined && result.value.row.retirementSettlement &&
          result.value.row.year === plan.baseYear + plan.lifeExpectancy - person.ageInBaseYear) {
        generatedStates.set(state, plan)
        try { result.value.row.terminalEstateEstimate = annualTerminalEstate(plan, state, result.value.row) }
        finally { generatedStates.delete(state) }
      }
      rows.push(result.value.row)
    }
    return { status: 'ok', value: { baseYear: plan.baseYear, inflation: plan.inflation, terminalYear: plan.baseYear + plan.lifeExpectancy - plan.people.find(p => p.role === 'self')!.ageInBaseYear, requestedStartYear: plan.baseYear, requestedYears: years, rows, state, blocked, uncomputedYears: blocked ? Array.from({ length: years - rows.length - 1 }, (_, i) => blocked!.year + i + 1) : [], overallConclusionAvailable: false, ...(plan.people.length === 1 && plan.annualBenefitsEvidence?.[plan.people[0].id]?.gis?.status === 'annual-estimate' ? { gisOptInPersonIds: [plan.people[0].id] } : {}), evaluationBasis: 'canonical-continuous' } }
  } catch (error) { if (error instanceof MortgagePrecisionError) return fail(error.status, error.reason); return fail('invalid', 'damaged canonical continuous plan') }
}
