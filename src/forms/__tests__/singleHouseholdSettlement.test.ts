import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_INPUTS, DEFAULT_PARTNER, useStore, type AnswerMeta } from '../../store'
import { refreshCanonicalFromLegacy, settleSingleHousehold } from '../../engine/migration'
import { commitCanonicalEdit, commitSingleHouseholdSettlement } from '../canonicalEdit'
const startingStore = useStore.getState()
afterEach(() => useStore.setState(startingStore, true))
const answer = (status: AnswerMeta['status'], origin: AnswerMeta['origin'] = 'user'): AnswerMeta => ({ status, origin, updatedAt: '2026-01-01', ...(status === 'estimated' ? { assumptionValue: 875 } : {}) })
function setup() {
  const inputs = structuredClone({ ...DEFAULT_INPUTS, partner: { ...DEFAULT_PARTNER, currentAge: 52, cppAnnualAt65: 975, oasAnnualAt65: 875 } })
  const couple = refreshCanonicalFromLegacy(null, inputs)
  const singleInputs = { ...inputs, partner: null }
  const single = refreshCanonicalFromLegacy(couple, singleInputs)
  const answerMeta = { currentAge: answer('confirmed'), household: answer('confirmed'), 'balances.tfsa': answer('confirmed'), 'pension.annualAmount': answer('estimated'),
    'partner.currentAge': answer('confirmed'), 'partner.cppAnnualAt65': answer('confirmed'), 'partner.oasAnnualAt65': answer('estimated', 'default'), 'partner.pension.annualAmount': answer('estimated', 'legacy'),
    'partner.cppStartAge': answer('unknown'), 'partner.pension': answer('notApplicable') }
  useStore.setState({ inputs: singleInputs, canonical: single, answerMeta, draftByField: { annualSavings: '-', nonRegBook: '' }, inputRevision: 7, resultRevision: 7,
    scenarioA: inputs, scenarioACanonical: couple, scenarioAAnswerMeta: structuredClone(answerMeta), questionAnswers: { 'family.people': 'couple' } })
  return { single, couple, answerMeta }
}
describe('single-person settlement answer ownership', () => {
  it('atomically discards only confirmations/estimates for the removed partner and preserves the original transaction effects', () => {
    const { single, answerMeta } = setup()
    const before = useStore.getState()
    const observed: ReturnType<typeof useStore.getState>[] = []
    const unsubscribe = useStore.subscribe(state => observed.push(state))
    commitSingleHouseholdSettlement()
    unsubscribe()
    const after = useStore.getState()
    expect(observed).toHaveLength(1)
    expect(after.canonical).toEqual(settleSingleHousehold(single))
    expect(after.inputs).toEqual(before.inputs)
    expect(after.draftByField).toBe(before.draftByField)
    expect(after.questionAnswers).toBe(before.questionAnswers)
    expect(after.scenarioA).toBe(before.scenarioA)
    expect(after.scenarioACanonical).toBe(before.scenarioACanonical)
    expect(after.scenarioAAnswerMeta).toBe(before.scenarioAAnswerMeta)
    expect(after.inputRevision).toBe(8)
    expect(after.resultRevision).toBeNull()
    for (const key of ['partner.currentAge', 'partner.cppAnnualAt65', 'partner.oasAnnualAt65', 'partner.pension.annualAmount']) expect(after.answerMeta).not.toHaveProperty(key)
    for (const key of ['currentAge', 'household', 'balances.tfsa', 'pension.annualAmount', 'partner.cppStartAge', 'partner.pension']) expect(after.answerMeta[key]).toBe(answerMeta[key as keyof typeof answerMeta])
    expect(observed[0].answerMeta).toBe(after.answerMeta)
    expect(observed[0].canonical?.orphanedPeople).toBeUndefined()
    // Restoring A restores the actual original person and that snapshot's own answers.
    after.restoreScenarioA()
    expect(useStore.getState().canonical).toEqual(before.scenarioACanonical)
    expect(useStore.getState().answerMeta).toEqual(before.scenarioAAnswerMeta)
  })
  it('leaves ordinary canonical edits and the retained-person path untouched', () => {
    const { answerMeta } = setup()
    const before = useStore.getState().canonical
    commitCanonicalEdit(() => {})
    expect(useStore.getState().answerMeta).toBe(answerMeta)
    expect(useStore.getState().canonical?.orphanedPeople).toEqual(before?.orphanedPeople)
  })
  it('refuses settlement of a couple without a state transaction', () => {
    const { couple } = setup()
    useStore.setState({ canonical: couple })
    const before = useStore.getState()
    commitSingleHouseholdSettlement()
    expect(useStore.getState()).toBe(before)
  })
  it('does not guess a discarded counterpart from old metadata when no orphan record exists', () => {
    setup()
    useStore.setState({ canonical: refreshCanonicalFromLegacy(null, DEFAULT_INPUTS) })
    const before = useStore.getState().answerMeta
    commitSingleHouseholdSettlement()
    expect(useStore.getState().answerMeta).toBe(before)
  })
  for (const recorded of [true, false]) it(`invalidates unbound positive answers atomically when a new partner is created (${recorded ? 'canonical' : 'legacy-only'} single)`, () => {
    const { single } = setup()
    useStore.setState({ canonical: recorded ? settleSingleHousehold(single) : null })
    const before = useStore.getState()
    const observed: ReturnType<typeof useStore.getState>[] = []
    const unsubscribe = useStore.subscribe(state => observed.push(state))
    before.set({ partner: DEFAULT_PARTNER })
    unsubscribe()
    const after = useStore.getState()
    expect(observed).toHaveLength(1)
    expect(after.canonical).toEqual(refreshCanonicalFromLegacy(before.canonical, { ...before.inputs, partner: DEFAULT_PARTNER }))
    expect(after.inputs.partner).toEqual(DEFAULT_PARTNER)
    for (const key of ['partner.currentAge', 'partner.cppAnnualAt65', 'partner.oasAnnualAt65', 'partner.pension.annualAmount']) expect(after.answerMeta).not.toHaveProperty(key)
    for (const [key, meta] of Object.entries(before.answerMeta)) {
      if (!key.startsWith('partner.') || ['unknown', 'notApplicable'].includes(meta.status)) expect(after.answerMeta[key]).toBe(meta)
    }
    expect(after.draftByField).toEqual(before.draftByField)
    expect(after.questionAnswers).toEqual(before.questionAnswers)
    expect(after.scenarioA).toBe(before.scenarioA)
    expect(after.scenarioACanonical).toBe(before.scenarioACanonical)
    expect(after.scenarioAAnswerMeta).toBe(before.scenarioAAnswerMeta)
    expect(after.inputRevision).toBe(8)
    expect(after.resultRevision).toBeNull()
  })
  it('restores an actual retained orphan and its answers without treating it as new', () => {
    const { answerMeta, couple } = setup()
    useStore.getState().set({ partner: DEFAULT_PARTNER })
    const after = useStore.getState()
    expect(after.answerMeta).toEqual(answerMeta)
    expect(after.canonical?.people.find(person => person.role === 'partner')).toEqual(couple.people.find(person => person.role === 'partner'))
    expect(after.inputs.partner).toMatchObject({ currentAge: 52, cppAnnualAt65: 975, oasAnnualAt65: 875 })
  })
  it('does not sanitize an already-active untraceable couple or an unrelated single edit', () => {
    const { single, answerMeta } = setup()
    const settled = settleSingleHousehold(single)
    useStore.setState({ canonical: settled })
    useStore.getState().set({ province: 'BC' })
    expect(useStore.getState().answerMeta).toEqual(answerMeta)
    const inputs = { ...useStore.getState().inputs, partner: DEFAULT_PARTNER }
    useStore.setState({ inputs, canonical: refreshCanonicalFromLegacy(settled, inputs), answerMeta })
    useStore.getState().set({ province: 'ON' })
    expect(useStore.getState().answerMeta).toEqual(answerMeta)
  })
})
