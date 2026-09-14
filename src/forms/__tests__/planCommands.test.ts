import { describe, expect, it } from 'vitest'
import { DEFAULT_INPUTS } from '../../store'
import { cppEstimatorProvenance } from '../../engine'
import { applyEstimate, changeAccountPresence, changeIntent, editField, reconcileDirectFields, type PlanFieldSnapshot } from '../planCommands'
import { fieldState } from '../fieldState'
import { parseField } from '../fieldRegistry'

const initial = (): PlanFieldSnapshot => ({
  inputs: structuredClone(DEFAULT_INPUTS), canonical: null, draftByField: {}, answerMeta: {}, inputRevision: 4, resultRevision: 4,
})

describe('shared field commands', () => {
  it('does not promote an unknown migrated ACB from a stale numeric backup on unrelated edits', () => {
    const starting = { ...initial(), ...editField(initial(), 'nonRegBook', '80000') } as PlanFieldSnapshot
    const unresolved = structuredClone(starting)
    unresolved.canonical!.accounts.find(account => account.kind === 'nonReg')!.acb = {
      status: 'unknown', reason: 'original purchase records missing',
    }
    const savingsEdit = { ...unresolved, ...editField(unresolved, 'annualSavings', '45000') } as PlanFieldSnapshot
    expect(savingsEdit.canonical!.accounts.find(account => account.kind === 'nonReg')!.acb.status).toBe('unknown')
    const confirmed = { ...savingsEdit, ...editField(savingsEdit, 'nonRegBook', '80000') } as PlanFieldSnapshot
    expect(confirmed.canonical!.accounts.find(account => account.kind === 'nonReg')!.acb)
      .toEqual({ status: 'known', value: 80000 })
  })
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

  it.each(['tfsa', 'rrsp', 'nonReg'] as const)('marks explicit %s absence usable while clearing its draft in one revision', (account) => {
    const initialState = initial()
    initialState.inputs.balances[account] = 0
    const id = `balances.${account}` as const
    const unknown = { ...initialState, ...editField(initialState, id, ''), questionAnswers: { 'assets.identify': [account] } } as PlanFieldSnapshot & { questionAnswers: Record<string, string[]> }
    const change = changeAccountPresence(unknown, account, false)
    const state = { ...unknown, ...change } as typeof unknown
    expect(state.inputRevision).toBe(unknown.inputRevision + 1)
    expect(Object.hasOwn(state.draftByField, id)).toBe(false)
    expect(fieldState(state, id)).toMatchObject({ lastValid: 0, usable: true, meta: { status: 'notApplicable' } })
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

  it.each(['tfsa', 'rrsp', 'nonReg'] as const)('keeps unresolved %s amount unknown when selecting presence', (account) => {
    const initialState = { ...initial(), questionAnswers: { 'assets.identify': [] } }
    const unknown = { ...initialState, ...editField(initialState, `balances.${account}`, '') }
    const selection = changeAccountPresence(unknown, account, true)
    const state = { ...unknown, ...selection }
    expect(state.inputs.balances[account]).toBe(initialState.inputs.balances[account])
    expect(state.draftByField[`balances.${account}`]).toBe('')
    expect(state.answerMeta[`balances.${account}`].status).toBe('unknown')
    expect(fieldState(state, `balances.${account}`).usable).toBe(false)
    expect(state.questionAnswers['assets.identify']).toContain(account)
    expect(state.inputRevision).toBe(unknown.inputRevision + 1)
  })

  it.each(['tfsa', 'rrsp', 'nonReg'] as const)('does not promote an invalid %s draft or unknown meta-only amount on presence selection', (account) => {
    const id = `balances.${account}` as const
    const initialState = { ...initial(), questionAnswers: { 'assets.identify': [] } }
    for (const unresolved of [
      { ...initialState, ...editField(initialState, id, 'invalid') },
      { ...initialState, answerMeta: { [id]: { status: 'unknown' as const, origin: 'user' as const, updatedAt: '2026-01-01' } } },
    ]) {
      const state = { ...unresolved, ...changeAccountPresence(unresolved, account, true) }
      expect(state.inputs.balances[account]).toBe(initialState.inputs.balances[account])
      expect(state.draftByField[id]).toBe(unresolved.draftByField[id])
      expect(state.answerMeta[id].status).toBe('unknown')
      expect(fieldState(state, id).usable).toBe(false)
      expect(state.inputRevision).toBe(unresolved.inputRevision + 1)
    }
  })

  // BE-39 A / B2. Both entry modes write the FIRE age through this registry
  // path, never through `store.set`, so the rewritten-amount bookkeeping has to
  // run here too. This pins the metadata the guided review page reads.
  const estimatorPlan = (): PlanFieldSnapshot => {
    const state = initial()
    return {
      ...state,
      inputs: {
        ...state.inputs,
        cppAnnualAt65: 9_278,
        cppAmountSource: cppEstimatorProvenance({ retirementAge: 45, startWorkAge: 25, avgEarningsRatio: 1 }, 2026),
      },
      answerMeta: { cppAnnualAt65: { status: 'confirmed', origin: 'user', updatedAt: '2026-01-01' } },
    }
  }

  it('labels an engine-replaced CPP amount as estimated, not user-confirmed, after a FIRE-age edit', () => {
    const state = estimatorPlan()
    const next = { ...state, ...editField(state, 'fireAge', '55') } as PlanFieldSnapshot
    // the value was replaced by the estimator under the new retirement age
    expect(next.inputs.cppAnnualAt65).toBe(13_917)
    expect(next.inputs.cppAmountSource?.premises?.retirementAge).toBe(55)
    // and the metadata no longer claims the user confirmed that number
    expect(next.answerMeta.cppAnnualAt65).toMatchObject({ status: 'estimated', origin: 'default', assumptionValue: 13_917 })
    expect(next.answerMeta.fireAge).toMatchObject({ status: 'confirmed', origin: 'user' })
  })

  it('leaves a confirmed answer alone when the edit moves no benefit amount', () => {
    const state = estimatorPlan()
    const next = { ...state, ...editField(state, 'lifeExpectancy', '92') } as PlanFieldSnapshot
    expect(next.inputs.cppAnnualAt65).toBe(9_278)
    expect(next.answerMeta.cppAnnualAt65).toMatchObject({ status: 'confirmed', origin: 'user' })
  })
})
