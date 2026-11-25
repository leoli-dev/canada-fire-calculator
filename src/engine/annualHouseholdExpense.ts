import type { InputsV2, Known, Provenance } from './model'
import type { AnnualState } from './annualState'
import { mortgageSubtract, mortgageNumber, validMortgageDecimal, mortgageNegative, type MortgageDecimal } from './mortgageDecimal'

/** One explicitly authorized, noncapital household bill; never a recurring liability. */
export interface HouseholdExpenseEvidence {
  id: string; effectiveYear: number; timing: 'after-mortgage-and-living'
  amountNominal: Known<number>; amountBasis: 'event-year-nominal-CAD'
  noncapital: true; nonDeductible: true; allowPartialPayment: true
  excludesFromLivingBudget: true; useExistingFundingOrder: true; provenance: Provenance
}
export interface HouseholdExpenseReceipt {
  eventId: string; year: number; due: number; paid: number; unmet: number
  evidence: HouseholdExpenseEvidence
  arithmetic: { due: MortgageDecimal; paid: MortgageDecimal; unmet: MortgageDecimal }
  postings: { accountId: string; ownerId: string; amount: number }[]
}
const own = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k)
export function expenseEvidenceProblem(plan: InputsV2, e: HouseholdExpenseEvidence, year: number): string | null {
  const accounts = plan.accounts.filter(a => a.kind === 'tfsa')
  if (accounts.length < 1 || accounts.length > 2 || accounts.some(a => !plan.people.some(p => p.id === a.ownerId)))
    return 'household expense: one or two recorded ordinary owner TFSAs required'
  if (!e || typeof e !== 'object' || Array.isArray(e) ||
      !['id','effectiveYear','timing','amountNominal','amountBasis','noncapital','nonDeductible','allowPartialPayment','excludesFromLivingBudget','useExistingFundingOrder','provenance'].every(k => own(e, k)) ||
      typeof e.id !== 'string' || !e.id.trim() || e.id !== e.id.trim() ||
      !Number.isInteger(e.effectiveYear) || e.effectiveYear !== year || year < plan.baseYear ||
      e.timing !== 'after-mortgage-and-living' || e.amountBasis !== 'event-year-nominal-CAD' ||
      !e.amountNominal || typeof e.amountNominal !== 'object' || Array.isArray(e.amountNominal) || !own(e.amountNominal, 'status') || !own(e.amountNominal, 'value') || e.amountNominal.status !== 'known' ||
      !Number.isFinite(e.amountNominal.value) || e.amountNominal.value <= 0 || e.amountNominal.value > Number.MAX_SAFE_INTEGER / 100 ||
      e.noncapital !== true || e.nonDeductible !== true || e.allowPartialPayment !== true || e.excludesFromLivingBudget !== true || e.useExistingFundingOrder !== true ||
      !e.provenance || typeof e.provenance !== 'object' || Array.isArray(e.provenance) || !own(e.provenance, 'origin') || !own(e.provenance, 'sourceYear') || e.provenance.origin !== 'user' ||
      e.provenance.note !== undefined && (!own(e.provenance, 'note') || typeof e.provenance.note !== 'string') ||
      typeof e.provenance.sourceYear !== 'number' || !Number.isInteger(e.provenance.sourceYear) || e.provenance.sourceYear < 0 || e.provenance.sourceYear > Math.min(plan.baseYear, year))
    return 'household expense: explicit dated noncapital nominal expense evidence required'
  return null
}
export function expenseSnapshotProblem(plan: InputsV2, state: AnnualState, authenticated: boolean): string | null {
  const r = state.householdExpenseReceipt
  const gaps = state.unfundedEvents?.filter(g => g.reason === 'householdExpense') ?? []
  if (!r && !gaps.length) return null
  if (!authenticated || !r || !plan.annualHouseholdExpenseEvidence ||
      expenseEvidenceProblem(plan, r.evidence, r.year) || JSON.stringify(r.evidence) !== JSON.stringify(plan.annualHouseholdExpenseEvidence) ||
      r.eventId !== r.evidence.id || r.year >= state.year || !r.arithmetic ||
      (['due','paid','unmet'] as const).some(k => !validMortgageDecimal(r.arithmetic[k]) || mortgageNegative(r.arithmetic[k]) || mortgageNumber(r.arithmetic[k]) !== r[k]) ||
      r.due !== (r.evidence.amountNominal.status === 'known' ? r.evidence.amountNominal.value : NaN) ||
      mortgageSubtract(mortgageSubtract(r.arithmetic.due, r.arithmetic.paid), r.arithmetic.unmet).coefficient !== '0' ||
      !Array.isArray(r.postings) || new Set(r.postings.map(p => p.accountId)).size !== r.postings.length ||
      r.postings.some(p => !state.byAccount[p.accountId] || state.byAccount[p.accountId].kind !== 'tfsa' || state.byAccount[p.accountId].ownerId !== p.ownerId || !Number.isFinite(p.amount) || p.amount <= 0) ||
      gaps.length !== (state.year === r.year + 1 && r.unmet > 0 ? 1 : 0) ||
      gaps.some(g => g.eventId !== r.eventId || g.field !== 'annualHouseholdExpenseEvidence.amountNominal' || g.amount !== r.unmet))
    return 'household expense: receipt and gap require authenticated generated settlement'
  return null
}
