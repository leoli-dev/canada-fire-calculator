import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_INPUTS, useStore } from '../store'
import {
  cppEstimatorProvenance,
  estimateCppAt65,
  statementProvenance,
} from '../engine'

// BE-39 A. The store is the one place every edit funnels through, so it is
// where "an estimator amount follows the retirement age, a manual or statement
// amount does not" has to hold end to end.

const original = useStore.getState()
afterEach(() => {
  useStore.setState(original, true)
  vi.unstubAllGlobals()
})

const reset = () => {
  vi.stubGlobal('window', {})
  useStore.setState({ ...original, inputs: structuredClone(DEFAULT_INPUTS), canonical: null, answerMeta: {} })
  return useStore.getState()
}

describe('BE-39 A: store-level retirement-age invalidation', () => {
  it('re-prices an applied estimator amount when the FIRE age changes', () => {
    reset()
    useStore.getState().set({
      cppAnnualAt65: estimateCppAt65(25, 45, 1),
      cppAmountSource: cppEstimatorProvenance({ retirementAge: 45, startWorkAge: 25, avgEarningsRatio: 1 }, 2026),
      cppWork: { startWorkAge: 25, retireAge: 45 },
    })
    expect(useStore.getState().inputs.cppAnnualAt65).toBe(9_278)
    useStore.getState().set({ fireAge: 55 })
    const inputs = useStore.getState().inputs
    expect(inputs.cppAnnualAt65).toBe(13_917)
    expect(inputs.cppAmountSource?.source).toBe('estimator')
    expect(inputs.cppAmountSource?.premises?.retirementAge).toBe(55)
    // the canonical record carries the same answer, so the projection agrees
    expect(useStore.getState().canonical?.legacyProjection.cppAnnualAt65).toBe(13_917)
    expect(useStore.getState().canonical?.people[0].retirementAge).toBe(55)
  })

  it('does not touch a manual amount when the FIRE age changes', () => {
    reset()
    useStore.getState().set({ cppAnnualAt65: 11_000 })
    expect(useStore.getState().inputs.cppAmountSource?.source).toBe('manual')
    useStore.getState().set({ fireAge: 58 })
    expect(useStore.getState().inputs.cppAnnualAt65).toBe(11_000)
    expect(useStore.getState().inputs.cppAmountSource?.source).toBe('manual')
  })

  it('keeps a statement amount put and flags it, and typing over it does not relabel the source', () => {
    reset()
    useStore.getState().set({ cppAmountSource: statementProvenance(2026, { basis: 'monthly', ageBasis: 60, dollarBasis: 'today' }, 45) })
    // typing the statement's monthly figure must not turn it into a manual value
    useStore.getState().set({ cppAnnualAt65: 12_000 })
    expect(useStore.getState().inputs.cppAmountSource?.source).toBe('statement')
    expect(useStore.getState().inputs.cppAmountSource?.basis).toBe('monthly')
    useStore.getState().set({ fireAge: 55 })
    expect(useStore.getState().inputs.cppAnnualAt65).toBe(12_000)
    expect(useStore.getState().inputs.cppAmountSource?.premisesNeedReview).toBe(true)
    // re-confirming adopts the new age premise and clears the flag, value intact
    useStore.getState().set({
      oasAnnualAt65: 9_024,
      oasAmountSource: statementProvenance(2026, { basis: 'annual', ageBasis: 65, dollarBasis: 'today' }, 55),
    })
    expect(useStore.getState().inputs.oasAnnualAt65).toBe(9_024)
    expect(useStore.getState().inputs.oasAmountSource?.premisesNeedReview).toBeUndefined()
  })

  it('records an estimate-derived amount as estimated, not as a confirmed number', () => {
    reset()
    useStore.getState().set({
      cppAnnualAt65: estimateCppAt65(25, 45, 1),
      cppAmountSource: cppEstimatorProvenance({ retirementAge: 45, startWorkAge: 25, avgEarningsRatio: 1 }, 2026),
    })
    useStore.getState().markAnswers(['cppAnnualAt65'], 'confirmed')
    expect(useStore.getState().answerMeta.cppAnnualAt65?.status).toBe('confirmed')
    useStore.getState().set({ fireAge: 55 })
    // the engine replaced the number, so it is no longer a user-confirmed one
    expect(useStore.getState().answerMeta.cppAnnualAt65?.status).toBe('estimated')
    expect(useStore.getState().answerMeta.cppAnnualAt65?.assumptionValue).toBe(13_917)
  })
})
