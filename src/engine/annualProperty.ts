import { mortgageDecimal, mortgageMultiply, mortgageSubtract, mortgageNegative } from './mortgageDecimal'
import { householdMortgageBenefitsProblem } from './annualHouseholdMortgageBenefits'
import type { WorkingSpendingEvidence } from './annualWorking'
import type { InputsV2 } from './model'
import { isCanonicalGeneratedState, type AnnualState, type YearRow } from './annualState'

/** Only the authenticated household runner calls this guard. Title shares are
 * recorded facts; no ownership is inferred from array order or account owners. */
export function householdPassiveHomeProblem(plan: InputsV2): string | null {
  if (!plan.properties.length) return null
  const p = plan.properties[0]
  const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  const source = own(p, 'provenance') && record(p.provenance) && own(p.provenance, 'value') ? p.provenance.value : undefined
  if (!record(source) || !own(source, 'origin') || !['user', 'legacy'].includes(source.origin as string) ||
      !own(source, 'sourceYear') || !(source.sourceYear === null || typeof source.sourceYear === 'number' && Number.isInteger(source.sourceYear)) ||
      !(source.note === undefined || own(source, 'note') && typeof source.note === 'string'))
    return 'household passive home requires recorded property value provenance'
  const title = p.taxableOwnerShares
  const owners = plan.people.map(person => person.id)
  const shares = record(title) && own(p, 'taxableOwnerShares') && own(title, 'status') && title.status === 'known' && own(title, 'shares') && record(title.shares)
    ? Object.entries(title.shares) : []
  // The split form divides each recorded amount independently. Permit only
  // floating-point roundoff around a normalized two-person split; retain the
  // recorded shares unchanged. A whole owner cannot have a positive co-owner,
  // even if their combined share rounds back to one.
  const total = shares.reduce((sum, [, share]) => sum + (share as number), 0)
  const soleOwner = shares.filter(([, share]) => share === 1).length === 1 && shares.every(([, share]) => share === 0 || share === 1)
  const splitOwners = shares.length === 2 && shares.every(([, share]) => typeof share === 'number' && share > 0 && share < 1) && Math.abs(total - 1) <= Number.EPSILON
  if (plan.people.length !== 2 || plan.people.filter(person => person.role === 'self').length !== 1 ||
      plan.people.filter(person => person.role === 'partner').length !== 1 || plan.province !== 'ON' ||
      plan.properties.length !== 1 || plan.debts.length || p.kind !== 'principal' ||
      p.plannedPurchaseAge !== null || p.plannedDownPayment !== null || p.plannedMortgage !== null || p.mortgageDebtId !== null ||
      p.annualHoldingCostChange !== 0 || !own(p, 'annualRent') || !record(p.annualRent) ||
      !own(p.annualRent, 'status') || !own(p.annualRent, 'value') || p.annualRent.status !== 'known' || p.annualRent.value !== 0 ||
      !shares.length || shares.some(([id, share]) => !owners.includes(id) || typeof share !== 'number' || !Number.isFinite(share) || share < 0 || share > 1) ||
      !(soleOwner || splitOwners))
    return 'household passive home requires one wholly household-owned held primary residence without debt, rent, purchase or holding cost changes'
  return null
}

/** Passive home only. Current housing costs remain in verified total spending. */
export function passiveHomeProblem(plan: InputsV2): string | null {
  if (!plan.properties.length) return null
  const p = plan.properties[0]
  const owner = plan.people[0]
  // Match the model's provenance shape, but admit only recorded values.
  // Ownership remains the canonical known shares fact, not another receipt.
  const valueSource = Object.prototype.hasOwnProperty.call(p.provenance, 'value') ? p.provenance.value : undefined
  if (!valueSource || typeof valueSource !== 'object' || Array.isArray(valueSource) ||
      !Object.prototype.hasOwnProperty.call(valueSource, 'origin') || !['user', 'legacy'].includes(valueSource.origin) ||
      !Object.prototype.hasOwnProperty.call(valueSource, 'sourceYear') ||
      !(valueSource.sourceYear === null || Number.isFinite(valueSource.sourceYear) && Number.isInteger(valueSource.sourceYear)) ||
      !(valueSource.note === undefined || typeof valueSource.note === 'string'))
    return 'passive home requires recorded property value provenance'
  if (plan.people.length !== 1 || owner.role !== 'self' || plan.province !== 'ON' || plan.properties.length !== 1 || plan.debts.length ||
      p.kind !== 'principal' || p.plannedPurchaseAge !== null || p.plannedDownPayment !== null || p.plannedMortgage !== null || p.mortgageDebtId !== null ||
      p.annualHoldingCostChange !== 0 || p.annualRent.status !== 'known' || p.annualRent.value !== 0 ||
      p.taxableOwnerShares.status !== 'known' || Object.keys(p.taxableOwnerShares.shares).length !== 1 || p.taxableOwnerShares.shares[owner.id] !== 1)
    return 'passive home requires one wholly owned held primary residence without debt, rent, purchase or holding cost changes'
  return null
}

/** Same nominal opening × real appreciation × CPI calculation in both phases.
 * ACB is carried unchanged; the value supplies no cash or taxable receipt. */
export function growHeldProperties(plan: InputsV2, state: AnnualState): YearRow['byProperty'] {
  const rows: YearRow['byProperty'] = {}
  for (const p of plan.properties) {
    const current = state.byProperty[p.id]
    const opening = current.value
    const factor = current.held ? (1 + p.appreciation) * (1 + plan.inflation) : 1
    if (!Number.isFinite(factor)) throw { status: 'invalid', reason: `property growth is not finite: ${p.id}` }
    if (current.held && (p.appreciation < -1 || plan.inflation < -1 || factor < 0)) throw { status: 'unsupported', reason: `property growth outside nonnegative value model: ${p.id}` }
    const closing = current.held ? opening * factor : opening
    // The committing year-end snapshot guards closing values atomically.
    // Keep its existing provider status, detail and validation precedence.
    Object.defineProperty(rows, p.id, { value: { held: current.held, opening, growth: closing - opening, closing }, enumerable: true, configurable: true, writable: true })
    current.value = closing
  }
  return rows
}

/** Additive two-owner consent. Every reference is an own recorded field. */
export const HOUSEHOLD_MORTGAGE_ORDER_REFUSAL = "household mortgage requires dated explicit exhaustive two-owner TFSA funding authorization"
export function householdMortgageOrderProblem(plan: InputsV2, opening?: AnnualState): string | null {
  const own = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k)
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
  const fields = (v: unknown, keys: string[]): v is Record<string, unknown> => record(v) && keys.every(k => own(v, k))
  const e = plan.annualHouseholdMortgageFundingEvidence
  const accounts = plan.accounts.filter(a => a.kind === "tfsa" && a.balance > 0)
  if (!own(plan, "annualHouseholdMortgageFundingEvidence") || !fields(e, ["orderedAccounts", "authorized", "purpose", "provenance"]) ||
      e.authorized !== true || e.purpose !== "household-held-mortgage-and-living" ||
      !fields(e.provenance, ["origin", "sourceYear"]) || e.provenance.origin !== "user" ||
      !Number.isInteger(e.provenance.sourceYear) || typeof e.provenance.sourceYear !== "number" || e.provenance.sourceYear < 0 || e.provenance.sourceYear > plan.baseYear ||
      e.provenance.note !== undefined && (!own(e.provenance, "note") || typeof e.provenance.note !== "string") ||
      !Array.isArray(e.orderedAccounts) || e.orderedAccounts.length !== 2 || !own(e.orderedAccounts, "0") || !own(e.orderedAccounts, "1") ||
      accounts.length !== 2 || new Set(accounts.map(a => a.ownerId)).size !== 2 ||
      e.orderedAccounts.some(ref => !fields(ref, ["accountId", "ownerId"]) || typeof ref.accountId !== "string" || typeof ref.ownerId !== "string" ||
        !accounts.some(a => a.id === ref.accountId && a.ownerId === ref.ownerId) || !plan.people.some(p => p.id === ref.ownerId) ||
        opening && (!own(opening.byAccount, ref.accountId) || opening.byAccount[ref.accountId].ownerId !== ref.ownerId)) ||
      new Set(e.orderedAccounts.map(ref => ref.accountId)).size !== 2 || new Set(e.orderedAccounts.map(ref => ref.ownerId)).size !== 2)
    return HOUSEHOLD_MORTGAGE_ORDER_REFUSAL
  for (const account of accounts) {
    const title = own(account, "taxableOwnerShares") ? account.taxableOwnerShares : undefined
    if (title?.status === "known" && (!fields(title, ["status", "shares"]) || !record(title.shares) ||
        Object.entries(title.shares).some(([id, share]) => id !== account.ownerId && share !== 0 || typeof share !== "number" || !Number.isFinite(share) || share < 0 || share > 1) ||
        !own(title.shares, account.ownerId!) || title.shares[account.ownerId!] !== 1)) return HOUSEHOLD_MORTGAGE_ORDER_REFUSAL
  }
  return null
}

/** Narrow generated mortgage extension; a linked primary home is personal use.
 * CRA personal borrowing interest is not deductible (verified 2026-11-24):
 * https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/sole-proprietorships-partnerships/report-business-income-expenses/completing-form-t2125/line-8710-interest.html
 */
export function heldMortgageProblem(plan: InputsV2, evidence?: WorkingSpendingEvidence, opening?: AnnualState): string | null {
  const composedBenefits = plan.annualHouseholdMortgageBenefitsEvidence !== undefined
  if (composedBenefits) {
    const problem = householdMortgageBenefitsProblem(plan)
    if (problem) return problem
  }
  if (!plan.debts.length && plan.annualPrimaryHomePurchaseEvidence && plan.properties.length === 1 && plan.properties[0].plannedPurchaseAge !== null) {
    const p = plan.properties[0]
    return (plan.people.length === 2 ? householdPassiveHomeProblem : passiveHomeProblem)({ ...plan, properties: [{ ...p, plannedPurchaseAge: null, plannedDownPayment: null, plannedMortgage: null }] })
  }
  if (!plan.debts.length) return plan.people.length === 2 ? householdPassiveHomeProblem(plan) : passiveHomeProblem(plan)
  const p = plan.properties[0], d = plan.debts[0]
  if (!p || plan.properties.length !== 1 || plan.debts.length !== 1 || d.kind !== 'mortgage' || d.propertyId !== p.id || p.mortgageDebtId !== d.id)
    return plan.people.length === 2 ? 'household passive home mortgage requires one bidirectionally linked held primary home' : 'mortgage requires one bidirectionally linked held primary home'
  if (plan.people.length === 2 && mortgageNegative(mortgageSubtract(mortgageMultiply(mortgageDecimal(d.annualPayment), mortgageDecimal(d.yearsRemaining)), mortgageDecimal(d.principal))))
    return 'household mortgage recorded principal exceeds scheduled payments'
  const source = d.provenance
  if (!source || typeof source !== 'object' || Array.isArray(source) || !Object.prototype.hasOwnProperty.call(source, 'origin') || !Object.prototype.hasOwnProperty.call(source, 'sourceYear') || !['user', 'legacy'].includes(source.origin) || !(source.sourceYear === null || Number.isInteger(source.sourceYear)) || !(source.note === undefined || typeof source.note === 'string'))
    return 'mortgage requires recorded debt provenance'
  const homeProblem = (plan.people.length === 2 ? householdPassiveHomeProblem : passiveHomeProblem)({ ...plan, debts: [], properties: [{ ...p, mortgageDebtId: null }] })
  if (homeProblem) return homeProblem
  const ordered = plan.people.length === 2 && (plan.accounts.filter(a => a.kind === "tfsa" && a.balance > 0).length > 1 || plan.annualHouseholdMortgageFundingEvidence !== undefined)
  if (ordered && plan.annualHouseholdMortgageFundingEvidence === undefined) return "household mortgage requires ordinary single funded TFSA and no special slice evidence"
  if (ordered) {
    const problem = householdMortgageOrderProblem(plan, opening)
    if (problem) return problem
  }
  if (plan.people.length === 2 && (plan.accounts.some(a => a.kind !== "tfsa" && a.balance > 0) || !ordered && plan.accounts.filter(a => a.kind === "tfsa" && a.balance > 0).length > 1 || plan.annualPrimaryHomePurchaseEvidence || plan.annualTerminalEstateEvidence && !(opening && isCanonicalGeneratedState(plan, opening)) || plan.annualGisEvidence))
    return "household mortgage requires ordinary single funded TFSA and no special slice evidence"
  const fact = evidence?.scheduledMortgagePaymentsExcluded
  if (!fact || typeof fact !== 'object' || Array.isArray(fact) || !Object.prototype.hasOwnProperty.call(fact, 'status') || !Object.prototype.hasOwnProperty.call(fact, 'value') || fact.status !== 'known' || fact.value !== true)
    return 'mortgage spending evidence must explicitly exclude scheduled payments'
  if ((!composedBenefits && (plan.people.some(p => p.cppAnnualAt65 !== 0 || p.oasAnnualAt65 !== 0) || plan.annualBenefitsEvidence)) || plan.annualNonRegEvidence || plan.accounts.some(a => !['tfsa', 'rrsp'].includes(a.kind) || a.jurisdiction || a.accessibleAge !== undefined))
    return plan.people.length === 2 ? 'household passive home mortgage supports ordinary TFSA accounts and explicit zero public benefits only' : 'mortgage supports ordinary TFSA/RRSP accounts and explicitly excluded benefits only'
  return null
}
