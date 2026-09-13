import { describe, expect, it } from 'vitest'
import { DEFAULT_INPUTS } from '../../store'
import { applyEstimate, changeAccountPresence, changeIntent, editField, reconcileDirectFields, type PlanFieldSnapshot } from '../planCommands'
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
    expect(parseField('annualSavings', '3333.33', 'monthly')).toEqual({ status: 'valid', value: 39999.96 })
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

  it('resolves a direct scalar patch without confirming unchanged sibling balances', () => {
    const state = { ...initial(), ...editField(initial(), 'retirementSpending', '') } as PlanFieldSnapshot
    state.answerMeta['balances.rrsp'] = { status: 'estimated', origin: 'default', updatedAt: '2026-01-01' }
    const inputs = { ...state.inputs, retirementSpending: 2000, balances: { ...state.inputs.balances, tfsa: 10 } }
    const reconciled = reconcileDirectFields(state, { retirementSpending: 2000, balances: inputs.balances }, inputs)
    expect(reconciled.draftByField).not.toHaveProperty('retirementSpending')
    expect(reconciled.answerMeta.retirementSpending.status).toBe('confirmed')
    expect(reconciled.answerMeta['balances.tfsa'].status).toBe('confirmed')
    expect(reconciled.answerMeta['balances.rrsp'].status).toBe('estimated')
  })

  it('marks explicit account absence usable while clearing its draft in one revision', () => {
    const initialState = initial()
    initialState.inputs.balances.tfsa = 0
    const unknown = { ...initialState, ...editField(initialState, 'balances.tfsa', ''), questionAnswers: { 'assets.identify': ['tfsa'] } } as PlanFieldSnapshot & { questionAnswers: Record<string, string[]> }
    const change = changeAccountPresence(unknown, 'tfsa', false)
    const state = { ...unknown, ...change } as typeof unknown
    expect(state.inputRevision).toBe(unknown.inputRevision + 1)
    expect(Object.hasOwn(state.draftByField, 'balances.tfsa')).toBe(false)
    expect(fieldState(state, 'balances.tfsa')).toMatchObject({ lastValid: 0, usable: true, meta: { status: 'notApplicable' } })
    expect(state.questionAnswers['assets.identify']).toEqual([])
  })

  it('keeps a newly selected planned-home payment as an estimate, not a confirmation', () => {
    const state = initial()
    const principalResidence = { mode: 'planned' as const, buyAtAge: 40, price: 800000, downPayment: 200000, appreciation: 0.02, annualMortgagePayment: 42000, mortgageYears: 25, netHoldingCostChange: 0, sellAtAge: null }
    const next = { ...state.inputs, principalResidence }
    const reconciled = reconcileDirectFields(state, { principalResidence }, next)
    expect(reconciled.answerMeta['principalResidence.annualMortgagePayment']).toMatchObject({ status: 'estimated', origin: 'default' })
  })

  it('restores a zero planned-home payment from not-applicable after rent', () => {
    const state = initial()
    state.answerMeta['principalResidence.annualMortgagePayment'] = { status: 'notApplicable', origin: 'user', updatedAt: '2026-01-01' }
    const principalResidence = { mode: 'planned' as const, buyAtAge: 40, price: 100000, downPayment: 100000, appreciation: 0.02, annualMortgagePayment: 0, mortgageYears: 25, netHoldingCostChange: 0, sellAtAge: null }
    const reconciled = reconcileDirectFields(state, { principalResidence }, { ...state.inputs, principalResidence })
    expect(reconciled.answerMeta['principalResidence.annualMortgagePayment']).toMatchObject({ status: 'estimated', origin: 'default' })
  })

  it.each(['tfsa', 'rrsp', 'nonReg'] as const)('reveals %s on positive edits and direct patches', (account) => {
    const state = { ...initial(), questionAnswers: { 'assets.identify': [] } }
    state.inputs.balances[account] = 0
    const edit = editField(state, `balances.${account}`, '100000')
    expect(edit.questionAnswers?.['assets.identify']).toContain(account)
    const balances = { ...state.inputs.balances, [account]: 100000 }
    const direct = reconcileDirectFields(state, { balances }, { ...state.inputs, balances })
    expect(direct.questionAnswers?.['assets.identify']).toContain(account)
    expect(state.questionAnswers['assets.identify']).toEqual([])
  })
})
