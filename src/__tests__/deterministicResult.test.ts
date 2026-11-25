import { describe, expect, it } from 'vitest'
import { selectDeterministicResult } from '../deterministicResult'
import { projectCanonicalCoverage } from '../engine/annualState'
import { integratedHeldHomeEstateFixture } from '../engine/__tests__/fixtures/annualIntegratedHeldHomeEstate'
import { assertCanonicalPlan } from '../engine/modelValidation'
import { refreshCanonicalFromLegacy } from '../engine/migration'
import { runProjection } from '../engine'

function selected() {
  const { plan, spending } = integratedHeldHomeEstateFixture()
  plan.deterministicProjection = { mode: 'canonical', spending, provenance: { origin: 'user', sourceYear: 2026 } }
  return plan
}

describe('production deterministic routing and persisted evidence', () => {
  it('consumes the actual #78 plan and exactly preserves the canonical chain', () => {
    const plan = selected()
    const projected = projectCanonicalCoverage(plan, plan.deterministicProjection!.spending, 3)
    expect(projected.status).toBe('ok')
    const result = selectDeterministicResult(plan.legacyProjection, plan, { nonRegAbsent: false })
    expect(result).toMatchObject({ route: 'canonical', status: 'complete', requestedStartYear: 2026, requestedYears: 3 })
    if (result.route === 'canonical' && projected.status === 'ok') expect(result.coverage).toEqual(projected.value)
  })

  it('retains a stopped prefix without a legacy success or estate substitute', () => {
    const plan = selected()
    plan.lifeExpectancy += 2
    plan.deterministicProjection!.spending.retirementSpending = { status: 'unknown', reason: 'not supplied' }
    const result = selectDeterministicResult(plan.legacyProjection, plan, { nonRegAbsent: false })
    expect(result).toMatchObject({ route: 'canonical', status: 'blocked', coverage: { rows: [], blocked: { year: 2026 }, uncomputedYears: [2027, 2028, 2029, 2030] } })
    expect(result).not.toHaveProperty('result')
  })

  it('keeps ordinary S1 outputs unchanged without opt-in', () => {
    const plan = selected()
    delete plan.deterministicProjection
    expect(selectDeterministicResult(plan.legacyProjection, plan, { nonRegAbsent: false })).toEqual({ route: 'legacy', result: runProjection(plan.legacyProjection, undefined, plan, { captureAnnualDetails: true }) })
  })

  it('round-trips evidence structurally and rejects damaged persisted selection', () => {
    const plan = JSON.parse(JSON.stringify(selected()))
    expect(() => assertCanonicalPlan(plan)).not.toThrow()
    plan.deterministicProjection.spending.workingSpending.value = -1
    expect(() => assertCanonicalPlan(plan)).toThrow(/deterministicProjection/)
  })

  it('preserves selection as invalid after a form reconstruction and does not transfer advanced authorizations', () => {
    const plan = selected()
    const refreshed = refreshCanonicalFromLegacy(plan, { ...plan.legacyProjection, fireAge: 60 })
    expect(refreshed.deterministicProjection).toMatchObject({ mode: 'canonical', invalidated: true })
    expect(refreshed.annualHouseholdWorkingTfsaEvidence).toBeUndefined()
    expect(refreshed.annualTerminalEstateEvidence).toBeUndefined()
    expect(selectDeterministicResult(refreshed.legacyProjection, refreshed, { nonRegAbsent: false })).toMatchObject({ route: 'canonical', status: 'invalid', coverage: null })
  })

  it('represents an empty horizon as zero requested years', () => {
    const plan = selected()
    plan.lifeExpectancy = 56
    expect(selectDeterministicResult(plan.legacyProjection, plan, { nonRegAbsent: false })).toMatchObject({ route: 'canonical', status: 'invalid', requestedYears: 0, coverage: null })
  })
})
