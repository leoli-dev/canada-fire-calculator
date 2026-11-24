import type { WorkingSpendingEvidence } from './annualWorking'
import type { InputsV2 } from './model'
import type { AnnualState, YearRow } from './annualState'

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

/** Narrow generated mortgage extension; a linked primary home is personal use.
 * CRA personal borrowing interest is not deductible (verified 2026-11-24):
 * https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/sole-proprietorships-partnerships/report-business-income-expenses/completing-form-t2125/line-8710-interest.html
 */
export function heldMortgageProblem(plan: InputsV2, evidence?: WorkingSpendingEvidence): string | null {
  if (!plan.debts.length && plan.annualPrimaryHomePurchaseEvidence && plan.properties.length === 1 && plan.properties[0].plannedPurchaseAge !== null) {
    const p = plan.properties[0]
    return passiveHomeProblem({ ...plan, properties: [{ ...p, plannedPurchaseAge: null, plannedDownPayment: null, plannedMortgage: null }] })
  }
  if (!plan.debts.length) return passiveHomeProblem(plan)
  const p = plan.properties[0], d = plan.debts[0]
  if (!p || plan.properties.length !== 1 || plan.debts.length !== 1 || d.kind !== 'mortgage' || d.propertyId !== p.id || p.mortgageDebtId !== d.id)
    return 'mortgage requires one bidirectionally linked held primary home'
  const source = d.provenance
  if (!source || typeof source !== 'object' || Array.isArray(source) || !Object.prototype.hasOwnProperty.call(source, 'origin') || !Object.prototype.hasOwnProperty.call(source, 'sourceYear') || !['user', 'legacy'].includes(source.origin) || !(source.sourceYear === null || Number.isInteger(source.sourceYear)) || !(source.note === undefined || typeof source.note === 'string'))
    return 'mortgage requires recorded debt provenance'
  const homeProblem = passiveHomeProblem({ ...plan, debts: [], properties: [{ ...p, mortgageDebtId: null }] })
  if (homeProblem) return homeProblem
  const fact = evidence?.scheduledMortgagePaymentsExcluded
  if (!fact || typeof fact !== 'object' || Array.isArray(fact) || !Object.prototype.hasOwnProperty.call(fact, 'status') || !Object.prototype.hasOwnProperty.call(fact, 'value') || fact.status !== 'known' || fact.value !== true)
    return 'mortgage spending evidence must explicitly exclude scheduled payments'
  if (plan.people.some(p => p.cppAnnualAt65 !== 0 || p.oasAnnualAt65 !== 0) || plan.annualBenefitsEvidence || plan.annualNonRegEvidence || plan.accounts.some(a => !['tfsa', 'rrsp'].includes(a.kind) || a.jurisdiction || a.accessibleAge !== undefined))
    return 'mortgage supports ordinary TFSA/RRSP accounts and explicitly excluded benefits only'
  return null
}
