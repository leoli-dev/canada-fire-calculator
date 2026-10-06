import { describe, expect, it } from 'vitest'
import type { Inputs } from '../../engine'
import { refreshCanonicalFromLegacy } from '../../engine/migration'
import { DEFAULT_INPUTS } from '../../store'
import { earnedIncomeComplete, hasRecordedRegisteredType, registeredTypeAccounts, rrifDetailsComplete } from '../accountFacts'
import { pageIsComplete, type PageState } from '../pageState'
import { pageById, QUESTION_CATALOG, visibleQuestionPages } from '../questionCatalog'

const partner = { currentAge: 35, cppStartAge: 65, cppAnnualAt65: 10_000, oasStartAge: 65, oasAnnualAt65: 8_700 }
const couple: Inputs = { ...DEFAULT_INPUTS, partner }
const state = (inputs: Inputs, canonical: PageState['canonical'], questionAnswers: PageState['questionAnswers'] = {}): PageState => ({
  inputs, answerMeta: {}, questionAnswers, canonical,
})

describe('FE-43 B guided income and account-type pages', () => {
  it('place the account type and RRIF facts right after the RRSP balance', () => {
    const assets = QUESTION_CATALOG.filter(page => page.categoryId === 'assets').map(page => page.id)
    const at = assets.indexOf('account.rrsp.balance')
    expect(assets.slice(at, at + 3)).toEqual(['account.rrsp.balance', 'account.rrsp.type', 'account.rrif.details'])
  })

  it('are optional and never bind a legacy field', () => {
    for (const id of ['saving.earned', 'account.rrsp.type', 'account.rrif.details']) {
      expect(pageById(id)?.optional, id).toBe(true)
      expect(pageById(id)?.fieldBindings, id).toEqual([])
    }
  })

  it('show the type page for a selected RRSP and the RRIF page only for a recorded RRIF', () => {
    const plan = refreshCanonicalFromLegacy(null, DEFAULT_INPUTS)
    const ids = (answers: Record<string, string[]>, canonical = plan) => visibleQuestionPages(DEFAULT_INPUTS, answers, canonical).map(page => page.id)
    expect(ids({})).not.toContain('account.rrsp.type')
    expect(ids({ 'assets.identify': ['rrsp'] })).toContain('account.rrsp.type')
    expect(ids({ 'assets.identify': ['rrsp'] })).not.toContain('account.rrif.details')
    const rrif = structuredClone(plan)
    rrif.accounts.find(account => account.kind === 'rrsp')!.kind = 'rrif'
    // A type recorded in professional mode stays visible even with no guided answers.
    expect(ids({}, rrif)).toEqual(expect.arrayContaining(['account.rrsp.type', 'account.rrif.details']))
    expect(hasRecordedRegisteredType(rrif)).toBe(true)
    expect(hasRecordedRegisteredType(plan)).toBe(false)
    expect(hasRecordedRegisteredType(null)).toBe(false)
  })

  it('list one type row per account, never the partner half of a split', () => {
    const plan = refreshCanonicalFromLegacy(null, couple)
    plan.accounts.push({ ...structuredClone(plan.accounts.find(account => account.id === 'legacy:account:rrsp')!), id: 'legacy:account:rrsp:partner' })
    expect(registeredTypeAccounts(plan).map(account => account.id)).toEqual(['legacy:account:rrsp'])
  })

  it('read employment income as answered only when every person has an amount', () => {
    const plan = refreshCanonicalFromLegacy(null, couple)
    expect(earnedIncomeComplete(plan)).toBe(false)
    plan.people[0].earnedIncome = { status: 'known', value: 92_000 }
    expect(earnedIncomeComplete(plan)).toBe(false)
    plan.people[1].earnedIncome = { status: 'known', value: 0 }
    expect(earnedIncomeComplete(plan)).toBe(true)
    expect(pageIsComplete(pageById('saving.earned')!, state(couple, plan))).toBe(true)
  })

  it('read RRIF facts as answered once the opening year and factor category are known', () => {
    const plan = refreshCanonicalFromLegacy(null, DEFAULT_INPUTS)
    const rrif = plan.accounts.find(account => account.kind === 'rrsp')!
    rrif.kind = 'rrif'
    expect(rrifDetailsComplete(plan)).toBe(false)
    rrif.openedYear = { status: 'known', value: 2024 }
    expect(rrifDetailsComplete(plan)).toBe(false)
    rrif.rrifFactorCategory = { status: 'known', value: 'allOther' }
    expect(rrifDetailsComplete(plan)).toBe(true)
    expect(pageIsComplete(pageById('account.rrif.details')!, state(DEFAULT_INPUTS, plan))).toBe(true)
  })

  it('treat an untouched plain-RRSP default as unanswered, a pick or a recorded type as answered', () => {
    const plan = refreshCanonicalFromLegacy(null, DEFAULT_INPUTS)
    const type = pageById('account.rrsp.type')!
    expect(pageIsComplete(type, state(DEFAULT_INPUTS, plan))).toBe(false)
    expect(pageIsComplete(type, state(DEFAULT_INPUTS, plan, { 'account.rrsp.type': 'confirmed' }))).toBe(true)
    const spousal = structuredClone(plan)
    spousal.accounts.find(account => account.kind === 'rrsp')!.kind = 'spousalRrsp'
    expect(pageIsComplete(type, state(DEFAULT_INPUTS, spousal))).toBe(true)
  })
})
