import type { InputsV2, Provenance } from './model'
import type { AnnualState } from './annualState'
import { annualTfsaAdditionFor } from './tfsaRoom'
import { mortgageAdd, mortgageDecimal, mortgageNegative, mortgageSubtract, type MortgageDecimal } from './mortgageDecimal'

export interface HouseholdWorkingTfsaContribution { accountId: string; ownerId: string; amountNominal: number }
export interface HouseholdWorkingTfsaEvidence {
  authorized: true
  purpose: 'household-held-mortgage-working-tfsa'
  provenance: Provenance
  /** Explicit nominal CAD by reached year; no recurring or inflation-indexed election. */
  years: Record<number, [HouseholdWorkingTfsaContribution, HouseholdWorkingTfsaContribution]>
}
export interface HouseholdWorkingTfsaReceipt {
  evidence: HouseholdWorkingTfsaEvidence
  contributions: [HouseholdWorkingTfsaContribution, HouseholdWorkingTfsaContribution]
  arithmetic: Record<'income' | 'payroll' | 'tax' | 'living' | 'debtPayments' | 'surplus' | 'allocated', MortgageDecimal>
}
const own = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k)
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const fields = (v: unknown, keys: string[]): v is Record<string, unknown> => record(v) && keys.every(k => own(v, k))
const refusal = (reason: string) => `household working TFSA: ${reason}`

/** Only callers holding the live generated-state identity may activate this election. */
export function reachedHouseholdWorkingTfsa(plan: InputsV2, year: number): boolean {
  const e = own(plan, 'annualHouseholdWorkingTfsaEvidence') ? plan.annualHouseholdWorkingTfsaEvidence : undefined
  return e !== undefined && (!fields(e, ['years']) || !record(e.years) || own(e.years, String(year)))
}

export function householdWorkingTfsaProblem(plan: InputsV2, opening: AnnualState, bothWorking: boolean): string | null {
  const e = plan.annualHouseholdWorkingTfsaEvidence
  if (!fields(e, ['authorized', 'purpose', 'provenance', 'years']) || e.authorized !== true || e.purpose !== 'household-held-mortgage-working-tfsa' ||
      !fields(e.provenance, ['origin', 'sourceYear']) || e.provenance.origin !== 'user' || typeof e.provenance.sourceYear !== 'number' ||
      !Number.isInteger(e.provenance.sourceYear) || e.provenance.sourceYear < 0 || e.provenance.sourceYear > plan.baseYear ||
      e.provenance.note !== undefined && (!own(e.provenance, 'note') || typeof e.provenance.note !== 'string') || !record(e.years))
    return refusal('dated explicit user authorization required')
  if (!bothWorking || plan.people.length !== 2 || plan.accounts.length !== 2 || plan.accounts.some(a => a.kind !== 'tfsa' || a.balance <= 0) ||
      plan.debts.length !== 1 || plan.debts[0].kind !== 'mortgage' || plan.properties.length !== 1 ||
      plan.properties[0].sellAtAge !== null || plan.properties[0].plannedPurchaseAge !== null ||
      opening.primaryHomeSaleCash || opening.primaryHomePurchase)
    return refusal('authenticated both-working household with one held mortgage and two ordinary owner TFSAs required')
  const lines = e.years[opening.year]
  if (!Array.isArray(lines) || lines.length !== 2 || !own(lines, '0') || !own(lines, '1')) return refusal('two explicit owner contributions required')
  for (const line of lines) {
    if (!fields(line, ['accountId', 'ownerId', 'amountNominal']) || typeof line.accountId !== 'string' || typeof line.ownerId !== 'string' ||
        typeof line.amountNominal !== 'number' || !Number.isFinite(line.amountNominal) || line.amountNominal <= 0 ||
        line.amountNominal > Number.MAX_SAFE_INTEGER / 100 || mortgageDecimal(line.amountNominal).scale > 2)
      return refusal('contributions must be positive safe exact nominal CAD cents')
    const account = plan.accounts.find(a => a.id === line.accountId && a.ownerId === line.ownerId)
    if (!account || !plan.people.some(p => p.id === line.ownerId) || !own(opening.byAccount, line.accountId) || opening.byAccount[line.accountId].ownerId !== line.ownerId)
      return refusal('account and actual owner must match')
    const title = account.taxableOwnerShares
    if (!fields(title, ['status', 'shares']) || title.status !== 'known' || !record(title.shares) || !own(title.shares, line.ownerId) ||
        title.shares[line.ownerId] !== 1 || Object.entries(title.shares).some(([id, share]) => typeof share !== 'number' || (id !== line.ownerId && share !== 0)))
      return refusal('each TFSA must have confirmed sole actual owner title')
    const room = opening.byPerson[line.ownerId].tfsaRoom
    const addition = annualTfsaAdditionFor(opening.year, plan.baseYear)
    // Compare raw confirmed room BEFORE the shared ledger rounds to cents.
    // Later additions remain unsourced; this election supplies no room rule.
    if (room.status !== 'known' || addition.status !== 'known' || mortgageNegative(mortgageSubtract(mortgageAdd(mortgageDecimal(room.value), mortgageDecimal(addition.value)), mortgageDecimal(line.amountNominal))))
      return refusal('each owner needs independently confirmed sufficient unrounded room; future additions are not invented')
  }
  if (new Set(lines.map(l => l.accountId)).size !== 2 || new Set(lines.map(l => l.ownerId)).size !== 2) return refusal('distinct owner accounts required')
  return null
}
