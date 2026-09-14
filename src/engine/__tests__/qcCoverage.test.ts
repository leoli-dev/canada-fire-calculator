import { describe, expect, it } from 'vitest'
import type { Inputs } from '../types'
import type { InputsV2, QcDrugCoverage } from '../model'
import { migratePersistedPlan, refreshCanonicalFromLegacy } from '../migration'
import { calculateHouseholdTax } from '../householdTax'
import { applyQcAnnualCoverage, qcCoverageAnnualStatus, qcCoverageUniform, ramqPremium2026 } from '../quebecTax'

/** FE-36 A: the annual-first coverage editor records one status for all twelve
 * months through these helpers. Expected values here come from the FE-36
 * contract itself (a year with no change is twelve identical months; a mixed
 * year is only flattened by an explicit annual edit), not from the helpers. */

const base: Inputs = {
  currentAge: 66, fireAge: 66, lifeExpectancy: 67, province: 'QC', annualSavings: 0,
  savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 }, retirementSpending: 0,
  returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
  cppStartAge: 70, cppAnnualAt65: 0, oasStartAge: 70, oasAnnualAt65: 0, strategy: 'tfsaFirst',
}
const months = (value: QcDrugCoverage) => Array<QcDrugCoverage>(12).fill(value)
const mixedAt = (value: QcDrugCoverage, index: number, other: QcDrugCoverage = 'private'): QcDrugCoverage[] => {
  const list = months(other)
  list[index] = value
  return list
}

/** Single-person QC plan whose only variable is the recorded coverage. */
function plan(coverage: QcDrugCoverage[] | undefined): InputsV2 {
  const p = migratePersistedPlan({ inputs: base }, 10, 2026)
  p.migration = { sourcePersistVersion: 11, ownershipNeedsConfirmation: false, ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
  p.accounts.forEach(account => {
    account.ownerId = p.people[0].id
    account.taxableOwnerShares = { status: 'known', shares: { [p.people[0].id]: 1 } }
  })
  p.taxProfile = { spouseSupported: { status: 'known', value: false }, pensionSplit: null,
    qcPensionSplit: null, qcDrugCoverage: coverage ? { [p.people[0].id]: coverage } : undefined }
  return p
}

describe('FE-36 A annual coverage status', () => {
  it('maps one annual status to twelve identical months and back for all four values', () => {
    for (const status of ['private', 'waived', 'public', 'unknown'] as const) {
      const uniform = qcCoverageUniform(status)
      expect(uniform).toHaveLength(12)
      expect(uniform.every(month => month === status)).toBe(true)
      expect(qcCoverageAnnualStatus(uniform)).toBe(status)
    }
  })

  it('treats missing coverage as unknown and detects any single-month difference as mixed', () => {
    expect(qcCoverageAnnualStatus(undefined)).toBe('unknown')
    expect(qcCoverageAnnualStatus(months('unknown'))).toBe('unknown')
    expect(qcCoverageAnnualStatus(mixedAt('public', 0))).toBe('mixed')
    expect(qcCoverageAnnualStatus(mixedAt('waived', 11))).toBe('mixed')
    expect(qcCoverageAnnualStatus(mixedAt('unknown', 6))).toBe('mixed')
  })

  it('applies an annual status per person, is idempotent, and never touches other people or a mixed pattern without an explicit apply', () => {
    const selfId = 'self', partnerId = 'partner'
    const once = applyQcAnnualCoverage(undefined, selfId, 'private')
    expect(once).toEqual({ [selfId]: months('private') })
    const twice = applyQcAnnualCoverage(once, selfId, 'private')
    expect(twice).toEqual(once)
    // The partner record keeps its mixed pattern while self is edited.
    const withMixedPartner = applyQcAnnualCoverage(once, partnerId, 'waived')
    withMixedPartner[partnerId] = mixedAt('public', 6, 'waived')
    const afterSelfEdit = applyQcAnnualCoverage(withMixedPartner, selfId, 'waived')
    expect(afterSelfEdit[selfId]).toEqual(months('waived'))
    expect(qcCoverageAnnualStatus(afterSelfEdit[partnerId])).toBe('mixed')
    // Reading the status never mutates the recorded pattern.
    const frozen = mixedAt('public', 3)
    qcCoverageAnnualStatus(frozen)
    expect(frozen[3]).toBe('public')
    expect(frozen.filter(month => month === 'public')).toHaveLength(1)
  })

  it('never derives private/waived from unknown or mixed records', () => {
    expect(qcCoverageAnnualStatus(undefined)).not.toBe('private')
    expect(qcCoverageAnnualStatus(months('unknown'))).not.toBe('private')
    expect(qcCoverageAnnualStatus(mixedAt('public', 6))).not.toBe('waived')
    expect(ramqPremium2026(months('unknown'))).toEqual({
      status: 'unsupported', reason: 'Quebec prescription coverage has unknown months' })
    const fresh = refreshCanonicalFromLegacy(null, base)
    expect(fresh.taxProfile?.qcDrugCoverage).toBeUndefined()
    expect(calculateHouseholdTax(plan(undefined), 2026, []).status).toBe('unsupported')
    expect(calculateHouseholdTax(plan(months('unknown')), 2026, []).status).toBe('unsupported')
  })

  it('keeps the three ramqPremium2026 outcomes exactly as before the simplification', () => {
    expect(ramqPremium2026(months('private'))).toEqual({ status: 'ok', premium: 0 })
    expect(ramqPremium2026(months('waived'))).toEqual({ status: 'ok', premium: 0 })
    expect(ramqPremium2026(undefined)).toEqual({
      status: 'unsupported', reason: 'Quebec prescription coverage not confirmed for all calendar months' })
    expect(ramqPremium2026(mixedAt('public', 6))).toEqual({
      status: 'unsupported', reason: '2026 Quebec Schedule K public premium worksheet not published' })
    expect(ramqPremium2026(months('public'))).toEqual({
      status: 'unsupported', reason: '2026 Quebec Schedule K public premium worksheet not published' })
  })

  it('produces identical Quebec tax outcomes for identical coverage scenarios before and after the annual-first entry', () => {
    const selfId = () => migratePersistedPlan({ inputs: base }, 10, 2026).people[0].id
    const id = selfId()
    const scenarios: { name: string; before: QcDrugCoverage[] | undefined; after: QcDrugCoverage[] | undefined }[] = [
      { name: 'no coverage recorded', before: undefined, after: undefined },
      { name: 'all-private', before: months('private'), after: qcCoverageUniform('private') },
      { name: 'all-waived', before: months('waived'), after: qcCoverageUniform('waived') },
      { name: 'all-public', before: months('public'), after: qcCoverageUniform('public') },
      { name: 'one-public-month', before: mixedAt('public', 6), after: (() => { const list = qcCoverageUniform('private'); list[6] = 'public'; return list })() },
    ]
    for (const scenario of scenarios) {
      const before = calculateHouseholdTax(plan(scenario.before), 2026, [])
      const after = calculateHouseholdTax(plan(scenario.after), 2026, [])
      expect(after, scenario.name).toEqual(before)
      if (scenario.name === 'all-private' || scenario.name === 'all-waived') {
        expect(before.status, scenario.name).toBe('ok')
        if (before.status === 'ok') expect(before.total).toBeGreaterThanOrEqual(0)
      }
      if (scenario.name === 'all-public' || scenario.name === 'one-public-month') {
        expect(before.status).toBe('unsupported')
        if (before.status !== 'ok') expect(before.reason).toBe('2026 Quebec Schedule K public premium worksheet not published')
      }
    }
    // private and waived stay distinct recorded facts even though both compute a zero premium.
    const recorded = { [id]: applyQcAnnualCoverage(undefined, id, 'waived')[id] }
    expect(recorded[id][0]).toBe('waived')
    expect(recorded[id][0]).not.toBe('private')
  })

  it('round-trips through refreshCanonicalFromLegacy, save/reload and a Scenario A clone without loss', () => {
    const p = plan(undefined)
    const id = p.people[0].id
    p.taxProfile!.qcDrugCoverage = applyQcAnnualCoverage(undefined, id, 'private')
    p.taxProfile!.qcDrugCoverage[id] = mixedAt('public', 6)
    // Legacy-form refresh keeps the mixed pattern (identical object).
    const refreshed = refreshCanonicalFromLegacy(p, base)
    expect(refreshed.taxProfile?.qcDrugCoverage?.[id]).toEqual(mixedAt('public', 6))
    // Save/reload (persist serialize/deserialize) is lossless.
    const reloaded = JSON.parse(JSON.stringify(p)) as InputsV2
    expect(reloaded.taxProfile?.qcDrugCoverage?.[id]).toEqual(p.taxProfile!.qcDrugCoverage[id])
    // Scenario A is an independent clone: editing it never touches the current plan.
    const scenarioA = structuredClone(p)
    scenarioA.taxProfile!.qcDrugCoverage![id] = months('waived')
    expect(p.taxProfile!.qcDrugCoverage[id]).toEqual(mixedAt('public', 6))
    expect(scenarioA.taxProfile!.qcDrugCoverage[id]).toEqual(months('waived'))
    expect(qcCoverageAnnualStatus(p.taxProfile!.qcDrugCoverage[id])).toBe('mixed')
    expect(qcCoverageAnnualStatus(scenarioA.taxProfile!.qcDrugCoverage[id])).toBe('waived')
  })
})
