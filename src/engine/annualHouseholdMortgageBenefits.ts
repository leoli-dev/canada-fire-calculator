import type { InputsV2 } from './model'
import type { MortgageDecimal } from './mortgageDecimal'

export const HOUSEHOLD_MORTGAGE_BENEFITS_REFUSAL = 'household mortgage benefits require explicit dated composition authorization and existing verified claims'
export interface HouseholdMortgageBenefitsCash {
  evidence: NonNullable<InputsV2['annualHouseholdMortgageBenefitsEvidence']>
  basis: 'anchor-real-quote-times-serialized-start-CPI'
  startCpi: MortgageDecimal
  byPerson: Record<string, { cppReal: MortgageDecimal; oasNetReal: MortgageDecimal; cpp: MortgageDecimal; oasNet: MortgageDecimal; postedIncome: number; postedBenefits: number; postedTax: number }>
  cpp: MortgageDecimal
  oasNet: MortgageDecimal
  /** Exact cash left after the mandatory mortgage, before living/event. */
  afterDebt: MortgageDecimal
  beforeDrawsAfterDebt: MortgageDecimal
  livingDue: MortgageDecimal
  expenseDue: MortgageDecimal
  netCashBeforeWithdrawals: MortgageDecimal
}

/** Authorization composes existing models; it supplies neither entitlement nor tax. */
export function householdMortgageBenefitsProblem(plan: InputsV2): string | null {
  const own = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k)
  const fields = (v: unknown, keys: string[]): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && keys.every(k => own(v, k))
  const e = plan.annualHouseholdMortgageBenefitsEvidence
  if (!own(plan, 'annualHouseholdMortgageBenefitsEvidence') || !fields(e, ['authorized', 'purpose', 'provenance']) ||
      e.authorized !== true || e.purpose !== 'household-held-mortgage-with-verified-public-benefits' ||
      !fields(e.provenance, ['origin', 'sourceYear']) || e.provenance.origin !== 'user' ||
      typeof e.provenance.sourceYear !== 'number' || !Number.isInteger(e.provenance.sourceYear) || e.provenance.sourceYear < 0 || e.provenance.sourceYear > plan.baseYear ||
      e.provenance.note !== undefined && (!own(e.provenance, 'note') || typeof e.provenance.note !== 'string') ||
      plan.people.length !== 2 || plan.province !== 'ON' || plan.baseYear !== 2026 || plan.debts.length !== 1 || plan.properties.length !== 1 ||
      plan.properties[0].sellAtAge !== null || plan.annualPrimaryHomeSaleEvidence !== undefined || plan.annualPrimaryHomePurchaseEvidence !== undefined ||
      plan.annualTerminalEstateEvidence !== undefined || plan.annualGisEvidence !== undefined || plan.annualNonRegEvidence !== undefined ||
      !plan.annualBenefitsEvidence || plan.accounts.filter(a => a.kind === 'tfsa').length < 1 || plan.accounts.filter(a => a.kind === 'tfsa').length > 2 ||
      plan.accounts.some(a => a.kind !== 'tfsa' && a.balance > 0) ||
      plan.incomeSources.some(s => !['cpp', 'oas'].includes(s.kind) && (s.annualAmount.status !== 'known' || s.annualAmount.value !== 0)))
    return HOUSEHOLD_MORTGAGE_BENEFITS_REFUSAL
  return null
}
