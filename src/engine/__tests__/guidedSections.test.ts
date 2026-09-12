import { describe, expect, it } from 'vitest'
import { GUIDED_SECTIONS, issueBelongsToStep, stepForField } from '../../guidedSections'
import { accountSummary, GUIDED_REQUIRED_FIELDS, guidedPlanReady, guidedResultSummary } from '../../guidedReview'
import { DEFAULT_INPUTS } from '../../store'
import { runProjection } from '..'

describe('guided section registry', () => {
  it('keeps seven stable, ordered steps ending in review', () => {
    expect(GUIDED_SECTIONS.map((section) => section.id)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(GUIDED_SECTIONS.at(-1)?.key).toBe('review')
  })

  it('routes nested validation fields to the editing step', () => {
    expect(issueBelongsToStep('partner.currentAge', 1)).toBe(true)
    expect(issueBelongsToStep('lockedRetirement.accessibleAge', 3)).toBe(true)
    expect(issueBelongsToStep('investmentProperties.0.mortgage.balance', 4)).toBe(true)
    expect(issueBelongsToStep('partner.pension.startAge', 6)).toBe(true)
    expect(issueBelongsToStep('partner.cppStartAge', 6)).toBe(true)
    expect(issueBelongsToStep('partner.oasAnnualAt65', 6)).toBe(true)
    expect(stepForField('partner.cppStartAge')).toBe(6)
    expect(issueBelongsToStep('retirementSpending', 2)).toBe(false)
  })

  it('includes side accounts while keeping current liquidity separate', () => {
    const inputs = {
      ...DEFAULT_INPUTS,
      fhsa: { balance: 20_000, annualContribution: 0, openedYearsAgo: 1 },
      lockedRetirement: {
        balance: 80_000, employeeContribution: 0, employerContribution: 0,
        accessibleAge: 55, jurisdiction: 'ON' as const, owner: 'self' as const,
      },
    }
    expect(accountSummary(inputs)).toMatchObject({
      mainAccounts: 400_000,
      totalAccounts: 500_000,
      accessibleNow: 400_000,
    })
  })

  it('derives a failed-plan explanation from the depleted row', () => {
    const result = runProjection({ ...DEFAULT_INPUTS, balances: { tfsa: 0, rrsp: 0, nonReg: 0 } })
    const summary = guidedResultSummary(result)
    expect(summary.depletedAge).not.toBeNull()
    expect(summary.shortfall).toBeGreaterThan(0)
    expect(summary.need).toBeCloseTo(summary.available + summary.shortfall)
  })

  it('does not treat untouched examples or unknown answers as a ready plan', () => {
    expect(guidedPlanReady({}, DEFAULT_INPUTS)).toBe(false)
    const confirmed = Object.fromEntries(GUIDED_REQUIRED_FIELDS.map((field) => [field, {
      status: 'confirmed' as const,
      origin: 'user' as const,
      updatedAt: '2026-09-11T00:00:00Z',
    }]))
    expect(guidedPlanReady(confirmed, DEFAULT_INPUTS)).toBe(true)
    expect(guidedPlanReady({ ...confirmed, fireAge: { ...confirmed.fireAge, status: 'unknown' } }, DEFAULT_INPUTS)).toBe(false)
  })
})
