import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_INPUTS, DEFAULT_PARTNER, useStore } from '../store'
import {
  cppEstimatorProvenance,
  estimateCppAt65,
  estimateOasAt65,
  oasEstimatorProvenance as estimatorProvenance,
  pensionAmountWarning,
  statementProvenance,
  typedAmountSource,
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

  // B1: the amount box is a live input, so typing a replacement over an
  // estimator value must adopt the typed figure rather than let the dependency
  // pass re-derive the estimate and silently discard it.
  it('keeps a figure typed over an estimator amount and records it as manual', () => {
    reset()
    useStore.getState().set({
      cppAnnualAt65: estimateCppAt65(25, 45, 1),
      cppAmountSource: cppEstimatorProvenance({ retirementAge: 45, startWorkAge: 25, avgEarningsRatio: 1 }, 2026),
    })
    useStore.getState().set({ cppAnnualAt65: 15_000 })
    expect(useStore.getState().inputs.cppAnnualAt65).toBe(15_000)
    expect(useStore.getState().inputs.cppAmountSource?.source).toBe('manual')
    // and a later age change leaves the typed fact alone
    useStore.getState().set({ fireAge: 55 })
    expect(useStore.getState().inputs.cppAnnualAt65).toBe(15_000)
    expect(useStore.getState().inputs.cppAmountSource?.source).toBe('manual')
  })

  it('keeps a typed OAS figure over an estimator amount, and the partner path too', () => {
    reset()
    useStore.getState().set({
      oasAnnualAt65: 9_278,
      oasAmountSource: estimatorProvenance({ retirementAge: 45, residenceYearsBy65: 40 }, 2026),
    })
    useStore.getState().set({ oasAnnualAt65: 10_500 })
    expect(useStore.getState().inputs.oasAnnualAt65).toBe(10_500)
    expect(useStore.getState().inputs.oasAmountSource?.source).toBe('manual')

    useStore.getState().set({
      partner: {
        currentAge: 40, cppStartAge: 65, cppAnnualAt65: estimateCppAt65(25, 50, 0.8),
        oasStartAge: 65, oasAnnualAt65: 8_000,
        cppAmountSource: cppEstimatorProvenance({ retirementAge: 50, startWorkAge: 25, avgEarningsRatio: 0.8 }, 2026),
      },
    })
    const before = useStore.getState().inputs.partner!.cppAnnualAt65
    useStore.getState().set({ partner: { ...useStore.getState().inputs.partner!, cppAnnualAt65: before + 2_000 } })
    expect(useStore.getState().inputs.partner?.cppAnnualAt65).toBe(before + 2_000)
    expect(useStore.getState().inputs.partner?.cppAmountSource?.source).toBe('manual')
  })
})

// B3: a hand-typed benefit amount was persisted as `estimated`/`default` because
// the store inferred an engine rewrite from `next !== previous`, and the two
// entry modes disagreed on the metadata for the identical estimator Apply.
// Round 3 / BL1: the metadata must follow the amount's *provenance* — identically
// in both modes — never the last action and never a value diff, so an applied
// estimator stays `estimated`/`default` and only a typed fact or a re-confirmed
// statement is `confirmed`/`user`. The pass's own rewrite report is what labels
// an engine-replaced amount.
type Mode = 'guided' | 'professional'
type BenefitField = 'cppAnnualAt65' | 'oasAnnualAt65' | 'partner.cppAnnualAt65' | 'partner.oasAnnualAt65'
const BENEFIT_FIELDS: BenefitField[] = ['cppAnnualAt65', 'oasAnnualAt65', 'partner.cppAnnualAt65', 'partner.oasAnnualAt65']

const metaOf = (field: BenefitField) => {
  const meta = useStore.getState().answerMeta[field]
  return meta && { status: meta.status, origin: meta.origin, assumptionValue: meta.assumptionValue }
}
const amountOf = (field: BenefitField) => {
  const inputs = useStore.getState().inputs
  if (field === 'cppAnnualAt65') return inputs.cppAnnualAt65
  if (field === 'oasAnnualAt65') return inputs.oasAnnualAt65
  return field === 'partner.cppAnnualAt65' ? inputs.partner!.cppAnnualAt65 : inputs.partner!.oasAnnualAt65
}
const sourceOf = (field: BenefitField) => {
  const inputs = useStore.getState().inputs
  if (field === 'cppAnnualAt65') return inputs.cppAmountSource
  if (field === 'oasAnnualAt65') return inputs.oasAmountSource
  return field === 'partner.cppAnnualAt65' ? inputs.partner!.cppAmountSource : inputs.partner!.oasAmountSource
}

/** The whole difference between the two UIs for a typed amount: guided's
 * `FactNumber` confirms the answer after the write, professional's `Num` has no
 * such call. Both commit through `store.set`, and both amount boxes send the
 * source typing implies (`typedAmountSource`), so neither relies on a value
 * diff to say "the user typed this". */
const typeAmount = (mode: Mode, field: BenefitField, value = field.endsWith('cppAnnualAt65') ? 11_000 : 9_000) => {
  const inputs = useStore.getState().inputs
  const partner = inputs.partner
  useStore.getState().set(
    field === 'cppAnnualAt65' ? { cppAnnualAt65: value, cppAmountSource: typedAmountSource(inputs.cppAmountSource) }
      : field === 'oasAnnualAt65' ? { oasAnnualAt65: value, oasAmountSource: typedAmountSource(inputs.oasAmountSource) }
      : field === 'partner.cppAnnualAt65' ? { partner: { ...partner!, cppAnnualAt65: value, cppAmountSource: typedAmountSource(partner!.cppAmountSource) } }
      : { partner: { ...partner!, oasAnnualAt65: value, oasAmountSource: typedAmountSource(partner!.oasAmountSource) } },
  )
  if (mode === 'guided') useStore.getState().markAnswers([field], 'confirmed')
}

/** An `Apply` from the work-history / residence estimator. The handler is
 * identical in both modes (the guided-only `markAnswers` repair was removed),
 * so the mode changes nothing here — which is the point. The estimator is
 * handed the plan's own retirement age, exactly as the panels pass it, so an
 * Apply is itself never a premise rewrite. */
const applyEstimator = (mode: Mode, field: BenefitField) => {
  void mode
  const inputs = useStore.getState().inputs
  const partner = inputs.partner
  // The partner retires when the primary does: age 35 + (45 - 35) = 45.
  const retireAge = field.startsWith('partner.')
    ? partner!.currentAge + (inputs.fireAge - inputs.currentAge)
    : inputs.fireAge
  if (field === 'cppAnnualAt65')
    useStore.getState().set({ cppAnnualAt65: estimateCppAt65(25, retireAge, 1), cppAmountSource: cppEstimatorProvenance({ retirementAge: retireAge, startWorkAge: 25, avgEarningsRatio: 1 }, 2026) })
  else if (field === 'oasAnnualAt65')
    useStore.getState().set({ oasAnnualAt65: estimateOasAt65(40), oasAmountSource: estimatorProvenance({ retirementAge: retireAge, residenceYearsBy65: 40 }, 2026) })
  else if (field === 'partner.cppAnnualAt65')
    useStore.getState().set({ partner: { ...partner!, cppAnnualAt65: estimateCppAt65(25, retireAge, 0.8), cppAmountSource: cppEstimatorProvenance({ retirementAge: retireAge, startWorkAge: 25, avgEarningsRatio: 0.8 }, 2026) } })
  else
    useStore.getState().set({ partner: { ...partner!, oasAnnualAt65: estimateOasAt65(40), oasAmountSource: estimatorProvenance({ retirementAge: retireAge, residenceYearsBy65: 40 }, 2026) } })
}

/** Both modes write the FIRE age through the shared field registry. */
const changeFireAge = (mode: Mode, field: BenefitField, age: string) => {
  void mode; void field
  useStore.getState().editSharedField('fireAge', age)
}

/** Run one action on a fresh plan in one mode and return the field's metadata,
 * with the value/origin/timestamp reduced to the recorded contract. */
const metaAfter = (mode: Mode, field: BenefitField, act: (mode: Mode, field: BenefitField) => void) => {
  reset()
  if (field.startsWith('partner.')) useStore.getState().set({ partner: structuredClone(DEFAULT_PARTNER) })
  act(mode, field)
  return metaOf(field)
}

describe('BE-39 A / B3 / BL1: benefit-amount metadata follows the provenance, identically in both modes', () => {
  it.each(BENEFIT_FIELDS)('records a hand-typed %s as user-confirmed in both modes', (field) => {
    const guided = metaAfter('guided', field, typeAmount)
    const professional = metaAfter('professional', field, typeAmount)
    expect(guided).toEqual({ status: 'confirmed', origin: 'user' })
    // the figure is stored as the user's, and the source is a manual fact
    expect(amountOf(field)).toBe(field.endsWith('cppAnnualAt65') ? 11_000 : 9_000)
    expect(sourceOf(field)?.source).toBe('manual')
    expect(professional).toEqual(guided)
    // and a later FIRE-age change leaves the typed fact alone
    changeFireAge('professional', field, '55')
    expect(amountOf(field)).toBe(field.endsWith('cppAnnualAt65') ? 11_000 : 9_000)
    expect(sourceOf(field)?.source).toBe('manual')
    expect(metaOf(field)).toEqual({ status: 'confirmed', origin: 'user' })
  })

  it.each(BENEFIT_FIELDS)('records an estimator Apply to %s identically in both modes', (field) => {
    const guided = metaAfter('guided', field, applyEstimator)
    const professional = metaAfter('professional', field, applyEstimator)
    // BL1 / round 3: applying the estimator is invoking a computation, not
    // asserting a fact, so the answer is `estimated`/`default` — the same label
    // every other applied engine value in this questionnaire carries (mix, fee
    // and inflation presets, the DB-pension default, `applyEstimate`).
    expect(guided).toEqual({ status: 'estimated', origin: 'default' })
    expect(professional).toEqual(guided)
    // while the number and its recorded source are the estimator's
    expect(sourceOf(field)?.source).toBe('estimator')
    // independent literals: `estimateCppAt65(25, 45, 1)` = 9,278 and
    // `estimateCppAt65(25, 45, 0.8)` = 7,422, `estimateOasAt65(40)` = 9,024
    expect(amountOf(field)).toBe(
      field === 'cppAnnualAt65' ? 9_278 : field === 'partner.cppAnnualAt65' ? 7_422 : 9_024,
    )
  })

  // BL1 pin: an estimator Apply must never be recorded as a user-confirmed
  // fact. The label is a function of the amount's provenance, not of which
  // control wrote it last, so this holds for every field in both modes.
  it.each(BENEFIT_FIELDS)('never records an estimator Apply to %s as a user-confirmed fact', (field) => {
    for (const mode of ['guided', 'professional'] as Mode[]) {
      const meta = metaAfter(mode, field, applyEstimator)
      expect(sourceOf(field)?.source).toBe('estimator')
      expect(meta).not.toEqual({ status: 'confirmed', origin: 'user' })
      // and the invariant: estimator provenance can only ever read `estimated`
      expect(meta?.status).toBe('estimated')
      expect(meta?.origin).toBe('default')
    }
  })

  it.each(BENEFIT_FIELDS)('adopts a %s re-typed at exactly the recorded estimator figure', (field) => {
    const recorded = metaAfter('professional', field, applyEstimator)
    expect(recorded?.status).toBe('estimated')
    const applied = amountOf(field)
    // typing the *same* number is still the user's own answer: the amount box
    // sends the source typing implies, so nothing has to diff values
    typeAmount('professional', field, applied)
    expect(metaOf(field)).toEqual({ status: 'confirmed', origin: 'user' })
    expect(sourceOf(field)?.source).toBe('manual')
    // and a later FIRE-age change leaves the typed fact alone
    changeFireAge('professional', field, '55')
    expect(amountOf(field)).toBe(applied)
    expect(sourceOf(field)?.source).toBe('manual')
    expect(metaOf(field)).toEqual({ status: 'confirmed', origin: 'user' })
  })

  // The store's own fallback for a caller that writes the amount alone, with no
  // source directive: the decision is the *presence* of the amount, never a
  // before/after value diff, so re-typing the recorded number is still the
  // user's answer rather than a silent re-adoption of the estimate.
  it('adopts a raw amount-only patch even when the number is unchanged', () => {
    reset()
    applyEstimator('professional', 'cppAnnualAt65')
    expect(useStore.getState().inputs.cppAnnualAt65).toBe(9_278)
    useStore.getState().set({ cppAnnualAt65: 9_278 })
    expect(useStore.getState().inputs.cppAmountSource?.source).toBe('manual')
    useStore.getState().set({ fireAge: 55 })
    expect(useStore.getState().inputs.cppAnnualAt65).toBe(9_278)
    expect(useStore.getState().inputs.cppAmountSource?.source).toBe('manual')
  })

  it.each(['cppAnnualAt65', 'partner.cppAnnualAt65'] as BenefitField[])(
    'keeps the B2 behaviour: a FIRE-age rewrite of %s is estimated in both modes', (field) => {
      const act = (mode: Mode, f: BenefitField) => { applyEstimator(mode, f); changeFireAge(mode, f, '55') }
      const guided = metaAfter('guided', field, act)
      const professional = metaAfter('professional', field, act)
      expect(guided.status).toBe('estimated')
      expect(guided.origin).toBe('default')
      expect(guided.assumptionValue).toBe(amountOf(field))
      expect(professional).toEqual(guided)
    })

  it.each(['oasAnnualAt65', 'partner.oasAnnualAt65'] as BenefitField[])(
    'keeps an applied OAS estimate flagged, with its estimate label (%s)', (field) => {
      const act = (mode: Mode, f: BenefitField) => { applyEstimator(mode, f); changeFireAge(mode, f, '55') }
      const guided = metaAfter('guided', field, act)
      const professional = metaAfter('professional', field, act)
      // the pass never re-prices an OAS amount (residence is not an age), so the
      // amount stands, stays the estimator's, and the premise is flagged
      expect(guided).toEqual({ status: 'estimated', origin: 'default' })
      expect(professional).toEqual(guided)
      expect(amountOf(field)).toBe(9_024)
      const provenance = sourceOf(field)
      // the household retires at 55, so the partner's retirement age is 55 too
      expect(pensionAmountWarning(provenance, 'oas', 55)).toEqual({ kind: 'estimatorNeedsReview' })
    })

  // The explicit rewrite signal, pinned: the capped estimator returns the same
  // number at retirement 64 and 70, so a value-diff heuristic sees no rewrite
  // and would leave the amount labelled user-confirmed. The pass reports the
  // moved premise, which is the fact the metadata must record. The Apply itself
  // uses the plan's own retirement age, so it is not a rewrite of its own.
  it('relabels a moved premise even when the capped estimate is numerically unchanged', () => {
    expect(estimateCppAt65(25, 64, 1)).toBe(18_092)
    expect(estimateCppAt65(25, 70, 1)).toBe(18_092)
    for (const mode of ['guided', 'professional'] as Mode[]) {
      reset()
      useStore.getState().editSharedField('fireAge', '64')
      applyEstimator(mode, 'cppAnnualAt65')
      const applied = amountOf('cppAnnualAt65')
      expect(applied).toBe(18_092)
      expect(metaOf('cppAnnualAt65')).toEqual({ status: 'estimated', origin: 'default' })
      changeFireAge(mode, 'cppAnnualAt65', '70')
      expect(amountOf('cppAnnualAt65')).toBe(applied)
      expect(metaOf('cppAnnualAt65')).toEqual({ status: 'estimated', origin: 'default', assumptionValue: applied })
    }
  })

  it('does not relabel when the edit moves no benefit premise', () => {
    for (const mode of ['guided', 'professional'] as Mode[]) {
      reset()
      applyEstimator(mode, 'cppAnnualAt65')
      useStore.getState().set({ lifeExpectancy: 92 })
      expect(metaOf('cppAnnualAt65')).toEqual({ status: 'estimated', origin: 'default' })
      expect(amountOf('cppAnnualAt65')).toBe(9_278)
    }
  })
})
