import type { InputsV2 } from './model'
import type { AnnualState } from './annualState'
export interface NonRegSale { accountId: string; openingMarket: number; openingAcb: number; openingUnits: number; soldFraction: number; closingUnits: number; holdingId: string; unitsSold: number; proceeds: number; allocatedAcb: number; closingAcb: number; realizedGain: number; taxableGain: number; inclusionRate: 0.5 }
const money = (n: number) => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER / 100
/** Explicit evidence describes the entire identical-property pool, never an aggregate inference.
 * Verified 2026-11-24: CRA T4037 identical properties (average unit cost), ITA 38(a).
 * https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4037/capital-gains.html
 * https://laws-lois.justice.gc.ca/eng/acts/I-3.3/section-38.html
 */
export function nonRegProblem(plan: InputsV2, state: AnnualState, initial = false): string | null {
  const e = plan.annualNonRegEvidence
  if (!e || typeof e !== 'object') return 'nonReg: explicit pool evidence required'
  const account = plan.accounts.find(a => a.id === e.accountId)
  const owner = plan.people[0]?.id
  if (plan.people.length !== 1 || plan.province !== 'ON' || !account || account.kind !== 'nonReg' || account.ownerId !== owner || account.taxableOwnerShares.status !== 'known' || Object.keys(account.taxableOwnerShares.shares).length !== 1 || account.taxableOwnerShares.shares[owner] !== 1 || plan.accounts.filter(a => a.kind === 'nonReg').length !== 1) return 'nonReg: one wholly owned solo Ontario pool required'
  if (account.accessibleAge !== undefined || account.jurisdiction !== undefined) return 'nonReg: restricted accessibility or jurisdiction not supported'
  if (e.ownership !== 'individual-whole' || e.propertyKind !== 'capital-identical-pool' || e.provenance !== 'user-supplied' || typeof e.holdingId !== 'string' || !e.holdingId.trim() || !Number.isFinite(e.units) || e.units <= 0 || !money(e.pooledAcbNominal)) return 'nonReg: invalid pool evidence'
  if ([e.distributions, e.interest, e.returnOfCapital, e.saleFees, plan.projectionAssumptions.nonRegDistributionYield].some(n => n !== 0)) return 'nonReg: distributions interest ROC and sale fees require explicit zero'
  if (plan.people.some(p => p.cppAnnualAt65 !== 0 || p.oasAnnualAt65 !== 0) || plan.annualBenefitsEvidence) return 'nonReg: public benefits interaction outside this slice'
  const a = state.byAccount[e.accountId]
  if (!a || a.acb.status !== 'known' || !money(a.acb.value)) return 'nonReg: known nominal pooled ACB required'
  if (initial) return account.acb.status !== 'known' || account.acb.value !== e.pooledAcbNominal || a.balance <= 0 ? 'nonReg: initial pool ACB or units inconsistent' : null
  const pool = a.nonRegPool
  if (!pool || pool.holdingId !== e.holdingId || !Number.isFinite(pool.units) || pool.units < 0 || pool.units > e.units || (pool.units === 0 && (a.balance !== 0 || a.acb.value !== 0)) || (pool.units > 0 && a.balance <= 0)) return 'nonReg: carried pool state inconsistent'
  return null
}
export function quoteNonRegSale(plan: InputsV2, state: AnnualState, proceeds: number): NonRegSale | undefined {
  const e = plan.annualNonRegEvidence
  if (!e || proceeds === 0) return undefined
  const a = state.byAccount[e.accountId], pool = a.nonRegPool!
  const acb = a.acb.status === 'known' ? a.acb.value : NaN
  const fraction = a.balance > 0 ? proceeds / a.balance : 0
  const full = proceeds === a.balance && proceeds > 0
  const allocatedAcb = full ? acb : acb === a.balance ? proceeds : acb * fraction
  const realizedGain = proceeds - allocatedAcb
  return { accountId: e.accountId, openingMarket: a.balance, openingAcb: acb, openingUnits: pool.units, soldFraction: full ? 1 : fraction, closingUnits: full ? 0 : pool.units - pool.units * fraction, holdingId: e.holdingId, unitsSold: full ? pool.units : pool.units * fraction, proceeds, allocatedAcb, closingAcb: full ? 0 : acb - allocatedAcb, realizedGain, taxableGain: realizedGain * 0.5, inclusionRate: 0.5 }
}

/** Acceptance checks never run on speculative search probes; reject rather than quantize a real sale. */
export function acceptedNonRegProblem(s: NonRegSale, startCpi: number): string | null {
  if (s.openingMarket < s.openingAcb) return 'nonReg: reached sale requires unsupported loss treatment'
  const close = s.openingMarket - s.proceeds
  const debit = s.openingMarket - close
  const reconciles = (actual: number, expected: number, opening: number, closing: number) =>
    Math.abs(actual - expected) <= Math.min(0.004, 0.004 * startCpi, 4 * Number.EPSILON * (Math.abs(opening) + Math.abs(closing) + Math.abs(expected)))
  if (!money(s.proceeds) || !(s.proceeds > 0) || !(debit > 0) || close < 0 || !reconciles(debit, s.proceeds, s.openingMarket, close)) return 'nonReg: accepted cash debit is not representable'
  if (!(s.unitsSold > 0) || !Number.isFinite(s.unitsSold) || s.unitsSold > s.openingUnits) return 'nonReg: accepted sold units are not representable'
  if (s.proceeds === s.openingMarket) {
    if (s.closingUnits !== 0 || s.closingAcb !== 0 || s.unitsSold !== s.openingUnits || s.allocatedAcb !== s.openingAcb) return 'nonReg: full liquidation must exhaust units and ACB exactly'
  } else {
    if (!(s.closingUnits > 0 && s.closingUnits < s.openingUnits) || s.unitsSold >= s.openingUnits) return 'nonReg: accepted partial unit decrement is not representable'
    // Unit rounding must preserve the priced financial fraction, for both the
    // reported sold units and the actual representable state decrement.
    for (const units of [s.unitsSold, s.openingUnits - s.closingUnits]) {
      const fraction = units / s.openingUnits
      if (!Number.isFinite(fraction) || !reconciles(s.openingMarket * fraction, s.proceeds, s.openingMarket, close) || !reconciles(s.openingAcb * fraction, s.allocatedAcb, s.openingAcb, s.closingAcb)) return 'nonReg: accepted unit fraction does not reconcile to proceeds and ACB'
    }
    if (s.openingAcb > 0 && (!(s.allocatedAcb > 0) || !(s.closingAcb > 0 && s.closingAcb < s.openingAcb) || !reconciles(s.openingAcb - s.closingAcb, s.allocatedAcb, s.openingAcb, s.closingAcb))) return 'nonReg: accepted partial ACB decrement is not representable'
  }
  if (s.openingMarket > s.openingAcb && (!(s.realizedGain > 0) || !(s.realizedGain / startCpi > 0) || !(s.taxableGain > 0))) return 'nonReg: accepted gain is not representable'
  return null
}
