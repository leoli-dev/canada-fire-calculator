import { describe, expect, it } from 'vitest'
import { DEFAULT_INPUTS } from '../../store'
import { applyEstimate, changeIntent, editField, type PlanFieldSnapshot } from '../planCommands'
import { fieldState } from '../fieldState'
import { parseField } from '../fieldRegistry'

const initial = (): PlanFieldSnapshot => ({
  inputs: structuredClone(DEFAULT_INPUTS), canonical: null, draftByField: {}, answerMeta: {}, inputRevision: 4, resultRevision: 4,
})

describe('shared field commands', () => {
  it('keeps clear, minus, and invalid age as unknown drafts over the last valid value', () => {
    const saved = { ...initial(), ...editField(initial(), 'annualSavings', '24000') } as PlanFieldSnapshot
    const cleared = { ...saved, ...editField(saved, 'annualSavings', '') } as PlanFieldSnapshot
    expect(fieldState(cleared, 'annualSavings')).toMatchObject({ draft: '', lastValid: 24000, usable: false })
    expect(cleared.inputRevision).toBe(saved.inputRevision + 1)
    expect(cleared.resultRevision).toBeNull()
    const minus = { ...cleared, ...editField(cleared, 'annualSavings', '-') } as PlanFieldSnapshot
    expect(fieldState(minus, 'annualSavings')).toMatchObject({ draft: '-', lastValid: 24000, usable: false })
    const invalidAge = { ...minus, ...editField(minus, 'currentAge', '250') } as PlanFieldSnapshot
    expect(fieldState(invalidAge, 'currentAge')).toMatchObject({ draft: '250', lastValid: 35, usable: false })
    expect(parseField('annualSavings', '0')).toEqual({ status: 'valid', value: 0 })
  })

  it('converts monthly to annual once, without drift across repeated display switches', () => {
    let state = initial()
    for (let i = 0; i < 5; i++) {
      state = { ...state, ...editField(state, 'annualSavings', '2000', 'monthly') } as PlanFieldSnapshot
      expect(state.inputs.annualSavings).toBe(24000)
      state = { ...state, ...editField(state, 'annualSavings', '24000') } as PlanFieldSnapshot
      expect(state.inputs.annualSavings).toBe(24000)
    }
  })

  it('changes advice revision for an intent-only edit', () => {
    const state = { ...initial(), planningIntent: { beneficiaries: ['self'], legacyPreference: 'undecided' as const, spendingPreference: 'maintain' as const, understandingAcknowledged: false, confirmedIntentRevision: null }, questionAnswers: {} }
    const next = changeIntent(state, { legacyPreference: 'maxRemaining' })
    expect(next.inputs?.annualSavings).toBe(state.inputs.annualSavings)
    expect(next.planningIntent.legacyPreference).toBe('maxRemaining')
    expect(next.inputRevision).toBe(state.inputRevision + 1)
    expect(next.resultRevision).toBeNull()
  })

  it('keeps estimated provenance separate from a confirmed manual edit', () => {
    const estimated = { ...initial(), ...applyEstimate(initial(), 'annualSavings', 24000) } as PlanFieldSnapshot
    expect(estimated.answerMeta.annualSavings).toMatchObject({ status: 'estimated', origin: 'default', assumptionValue: 24000 })
    const confirmed = { ...estimated, ...editField(estimated, 'annualSavings', '24000') } as PlanFieldSnapshot
    expect(confirmed.answerMeta.annualSavings).toMatchObject({ status: 'confirmed', origin: 'user' })
  })
})
