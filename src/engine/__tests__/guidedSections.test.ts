import { describe, expect, it } from 'vitest'
import { GUIDED_SECTIONS, issueBelongsToStep } from '../../guidedSections'

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
    expect(issueBelongsToStep('retirementSpending', 2)).toBe(false)
  })
})
