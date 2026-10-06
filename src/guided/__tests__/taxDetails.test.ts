import { describe, expect, it } from 'vitest'
import type { Inputs } from '../../engine'
import { refreshCanonicalFromLegacy } from '../../engine/migration'
import { DEFAULT_FHSA, DEFAULT_INPUTS } from '../../store'
import { pageIsComplete, type PageState } from '../pageState'
import { pageById, QUESTION_CATALOG, visibleQuestionPages } from '../questionCatalog'
import { fhsaHoldings, fhsaRoomComplete, rrspRoomComplete, spousalHistoryComplete, spousalPlanAccounts, tfsaRoomComplete } from '../taxDetails'

const partner = { currentAge: 35, cppStartAge: 65, cppAnnualAt65: 10_000, oasStartAge: 65, oasAnnualAt65: 8_700 }
const couple: Inputs = { ...DEFAULT_INPUTS, partner }
const state = (inputs: Inputs, canonical: PageState['canonical'], questionAnswers: PageState['questionAnswers'] = {}): PageState => ({
  inputs, answerMeta: {}, questionAnswers, canonical,
})
const taxPages = (inputs: Inputs, answers: Record<string, string> = {}, plan = refreshCanonicalFromLegacy(null, inputs)) =>
  visibleQuestionPages(inputs, answers, plan).filter(page => page.categoryId === 'taxDetails').map(page => page.id)

describe('FE-43 C optional tax-details category', () => {
  it('replaces the all-in-one tax page and keeps its old link working', () => {
    expect(QUESTION_CATALOG.some(page => page.id === 'income.taxFacts')).toBe(false)
    expect(pageById('income.taxFacts')?.id).toBe('tax.intro')
  })

  it('is optional throughout, so it never blocks results', () => {
    const pages = QUESTION_CATALOG.filter(page => page.categoryId === 'taxDetails')
    expect(pages.map(page => page.id)).toEqual(['tax.intro', 'tax.tfsaRoom', 'tax.rrspRoom', 'tax.fhsaRoom', 'tax.pensionSplit', 'tax.spousalHistory'])
    expect(pages.every(page => page.optional && page.fieldBindings.length === 0)).toBe(true)
  })

  it('collapses to its first page once skipped', () => {
    expect(taxPages(couple)).toEqual(['tax.intro', 'tax.tfsaRoom', 'tax.rrspRoom', 'tax.pensionSplit'])
    expect(taxPages(couple, { 'tax.intro': 'skip' })).toEqual(['tax.intro'])
    expect(taxPages(couple, { 'tax.intro': 'add' })).toEqual(['tax.intro', 'tax.tfsaRoom', 'tax.rrspRoom', 'tax.pensionSplit'])
  })

  it('asks FHSA room only with an FHSA, pension splitting only for a couple, history only for a spousal plan', () => {
    expect(taxPages(DEFAULT_INPUTS)).toEqual(['tax.intro', 'tax.tfsaRoom', 'tax.rrspRoom'])
    expect(taxPages({ ...DEFAULT_INPUTS, fhsa: DEFAULT_FHSA })).toContain('tax.fhsaRoom')
    const plan = refreshCanonicalFromLegacy(null, couple)
    plan.accounts.find(account => account.kind === 'rrsp')!.kind = 'spousalRrsp'
    expect(spousalPlanAccounts(plan).map(account => account.id)).toEqual(['legacy:account:rrsp'])
    expect(taxPages(couple, {}, plan)).toContain('tax.spousalHistory')
  })

  it('reads each room page as answered only when every person has the figure', () => {
    const plan = refreshCanonicalFromLegacy(null, couple)
    expect(tfsaRoomComplete(plan)).toBe(false)
    expect(rrspRoomComplete(plan)).toBe(false)
    plan.people.forEach(person => { person.tfsaAvailableRoom = { status: 'known', value: 7_000 } })
    plan.people[0].rrspAvailableRoom = { status: 'known', value: 18_000 }
    expect(tfsaRoomComplete(plan)).toBe(true)
    expect(rrspRoomComplete(plan)).toBe(false)
    plan.people[1].rrspAvailableRoom = { status: 'known', value: 0 }
    expect(rrspRoomComplete(plan)).toBe(true)
    expect(pageIsComplete(pageById('tax.rrspRoom')!, state(couple, plan))).toBe(true)
  })

  it('needs a named holder before FHSA room can be answered', () => {
    const inputs = { ...couple, fhsa: DEFAULT_FHSA }
    const plan = refreshCanonicalFromLegacy(null, inputs)
    expect(fhsaHoldings(plan)).toEqual([])
    expect(fhsaRoomComplete(plan)).toBe(false)
    const fhsa = plan.accounts.find(account => account.kind === 'fhsa')!
    fhsa.ownerId = plan.people[1].id
    expect(fhsaHoldings(plan).map(holding => holding.personId)).toEqual([plan.people[1].id])
    expect(fhsaRoomComplete(plan)).toBe(false)
    fhsa.contributionRoom = { status: 'known', value: 8_000 }
    expect(fhsaRoomComplete(plan)).toBe(true)
  })

  it('reads pension splitting and spousal history from an answer or a recorded fact', () => {
    const plan = refreshCanonicalFromLegacy(null, couple)
    const split = pageById('tax.pensionSplit')!
    expect(pageIsComplete(split, state(couple, plan))).toBe(false)
    expect(pageIsComplete(split, state(couple, plan, { 'tax.pensionSplit': 'no' }))).toBe(true)
    const elected = structuredClone(plan)
    elected.taxProfile = { ...elected.taxProfile!, pensionSplit: { transferorId: plan.people[0].id, recipientId: plan.people[1].id, amount: 20_000 } }
    expect(pageIsComplete(split, state(couple, elected))).toBe(true)
    plan.accounts.find(account => account.kind === 'rrsp')!.kind = 'spousalRrsp'
    expect(spousalHistoryComplete(plan)).toBe(false)
    plan.spousalHistory = { 'legacy:account:rrsp': { status: 'complete' } }
    expect(spousalHistoryComplete(plan)).toBe(true)
  })
})
