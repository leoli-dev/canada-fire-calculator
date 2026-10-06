import { describe, expect, it } from 'vitest'
import type { Inputs } from '../../engine'
import type { InputsV2 } from '../../engine/model'
import { applyAccountSplit, refreshCanonicalFromLegacy } from '../../engine/migration'
import { ownershipNeedsConfirmation } from '../../forms/canonicalEdit'
import { DEFAULT_INPUTS } from '../../store'
import { accountOwnershipComplete, propertyOwnershipComplete, qcCoverageComplete } from '../householdFacts'
import { pageIsComplete, type PageState } from '../pageState'
import { pageById, QUESTION_CATALOG, visibleQuestionPages } from '../questionCatalog'

const partner = { currentAge: 35, cppStartAge: 65, cppAnnualAt65: 10_000, oasStartAge: 65, oasAnnualAt65: 8_700 }
const couple: Inputs = { ...DEFAULT_INPUTS, partner }
const coupleWithHome: Inputs = {
  ...couple,
  principalResidence: { value: 800_000, appreciation: 0.01, sellAtAge: null },
  investmentProperties: [{ value: 500_000, acb: 400_000, appreciation: 0.02, sellAtAge: null, annualRent: 20_000 }],
}

const recordOwner = (plan: InputsV2, baseId: string, role: 'self' | 'partner') => {
  const ownerId = plan.people.find(person => person.role === role)!.id
  const account = plan.accounts.find(item => item.id === baseId)!
  if (account.kind === 'nonReg') {
    account.ownerId = ownerId
    account.taxableOwnerShares = { status: 'known', shares: { [ownerId]: 1 } }
    return
  }
  applyAccountSplit(plan, baseId, role === 'self' ? account.balance : 0, role === 'partner' ? account.balance : 0, { zeroOwnerId: ownerId })
}

const state = (inputs: Inputs, canonical: InputsV2 | null, questionAnswers: PageState['questionAnswers'] = {}): PageState => ({
  inputs, answerMeta: {}, questionAnswers, canonical,
})

describe('FE-43 A guided household-fact pages', () => {
  it('sit next to the answer they depend on', () => {
    const ids = QUESTION_CATALOG.map(page => page.id)
    expect(ids.indexOf('family.spouseSupport')).toBe(ids.indexOf('family.ages') + 1)
    expect(ids.indexOf('family.qcDrug')).toBe(ids.indexOf('family.province') + 1)
    const assets = QUESTION_CATALOG.filter(page => page.categoryId === 'assets').map(page => page.id)
    const housing = QUESTION_CATALOG.filter(page => page.categoryId === 'housing').map(page => page.id)
    expect(assets.at(-1)).toBe('assets.ownership')
    expect(housing.at(-1)).toBe('housing.ownership')
  })

  it('appear only for the households they apply to', () => {
    const ids = (inputs: Inputs) => visibleQuestionPages(inputs, {}).map(page => page.id)
    const single = ids(DEFAULT_INPUTS)
    for (const id of ['family.spouseSupport', 'family.qcDrug', 'assets.ownership', 'housing.ownership']) expect(single).not.toContain(id)
    expect(ids(couple)).toEqual(expect.arrayContaining(['family.spouseSupport', 'assets.ownership']))
    // A couple with nothing to own has no property question.
    expect(ids(couple)).not.toContain('housing.ownership')
    expect(ids(coupleWithHome)).toContain('housing.ownership')
    expect(ids({ ...DEFAULT_INPUTS, province: 'QC' })).toContain('family.qcDrug')
  })

  it('block results only for ownership, which decides whether a couple sees results at all', () => {
    expect(pageById('family.spouseSupport')?.optional).toBe(true)
    expect(pageById('family.qcDrug')?.optional).toBe(true)
    expect(pageById('assets.ownership')?.optional).toBeFalsy()
    expect(pageById('housing.ownership')?.optional).toBeFalsy()
  })

  it('never bind a legacy numeric field, so they cannot be filled with an example', () => {
    for (const id of ['family.spouseSupport', 'family.qcDrug', 'assets.ownership', 'housing.ownership']) {
      expect(pageById(id)?.fieldBindings).toEqual([])
      expect(pageById(id)?.estimatePolicy).toBe('none')
    }
  })

  it('clears the ownership gate once every account row has one of the three answers', () => {
    const plan = refreshCanonicalFromLegacy(null, couple)
    expect(accountOwnershipComplete(plan)).toBe(false)
    expect(ownershipNeedsConfirmation(plan)).toBe(true)
    recordOwner(plan, 'legacy:account:tfsa', 'self')
    recordOwner(plan, 'legacy:account:rrsp', 'partner')
    expect(accountOwnershipComplete(plan)).toBe(false)
    recordOwner(plan, 'legacy:account:nonReg', 'self')
    expect(accountOwnershipComplete(plan)).toBe(true)
    expect(ownershipNeedsConfirmation(plan)).toBe(false)
    // "Each has one" keeps the household total across the two rows.
    applyAccountSplit(plan, 'legacy:account:tfsa', 60_000, 40_000)
    expect(accountOwnershipComplete(plan)).toBe(true)
    expect(plan.accounts.filter(account => account.kind === 'tfsa').reduce((sum, account) => sum + account.balance, 0)).toBe(100_000)
  })

  it('treats the principal residence as an ownership fact a couple can answer', () => {
    // Regression: the editor used to list rentals only, so a couple with a home
    // could never clear the ownership gate.
    const plan = refreshCanonicalFromLegacy(null, coupleWithHome)
    for (const id of ['legacy:account:tfsa', 'legacy:account:rrsp', 'legacy:account:nonReg']) recordOwner(plan, id, 'self')
    const selfId = plan.people.find(person => person.role === 'self')!.id
    const partnerId = plan.people.find(person => person.role === 'partner')!.id
    const rental = plan.properties.find(property => property.kind === 'investment')!
    rental.taxableOwnerShares = { status: 'known', shares: { [selfId]: 1 } }
    expect(propertyOwnershipComplete(plan)).toBe(false)
    expect(ownershipNeedsConfirmation(plan)).toBe(true)
    const home = plan.properties.find(property => property.kind === 'principal')!
    home.taxableOwnerShares = { status: 'known', shares: { [selfId]: 0.5, [partnerId]: 0.5 } }
    expect(propertyOwnershipComplete(plan)).toBe(true)
    expect(ownershipNeedsConfirmation(plan)).toBe(false)
  })

  it('reads Quebec drug coverage as complete only when all twelve months are known for everyone', () => {
    const plan = refreshCanonicalFromLegacy(null, { ...couple, province: 'QC' })
    expect(qcCoverageComplete(plan)).toBe(false)
    const [self, other] = plan.people
    plan.taxProfile = { ...plan.taxProfile!, qcDrugCoverage: { [self.id]: Array(12).fill('private') } }
    expect(qcCoverageComplete(plan)).toBe(false)
    plan.taxProfile.qcDrugCoverage![other.id] = [...Array(11).fill('public'), 'unknown']
    expect(qcCoverageComplete(plan)).toBe(false)
    plan.taxProfile.qcDrugCoverage![other.id] = [...Array(6).fill('public'), ...Array(6).fill('private')]
    expect(qcCoverageComplete(plan)).toBe(true)
  })

  it('complete from the recorded plan or an explicit "not sure yet"', () => {
    const plan = refreshCanonicalFromLegacy(null, { ...coupleWithHome, province: 'QC' })
    const support = pageById('family.spouseSupport')!
    const drug = pageById('family.qcDrug')!
    const accounts = pageById('assets.ownership')!
    const homes = pageById('housing.ownership')!
    expect(pageIsComplete(support, state(coupleWithHome, plan))).toBe(false)
    expect(pageIsComplete(support, state(coupleWithHome, plan, { 'family.spouseSupport': 'unknown' }))).toBe(true)
    expect(pageIsComplete(support, state(coupleWithHome, { ...plan, taxProfile: { ...plan.taxProfile!, spouseSupported: { status: 'known', value: true } } }))).toBe(true)
    expect(pageIsComplete(drug, state(coupleWithHome, plan))).toBe(false)
    expect(pageIsComplete(drug, state(coupleWithHome, plan, { 'family.qcDrug': 'unknown' }))).toBe(true)
    // Ownership has no "not sure" exit: it decides whether a couple sees results at all.
    expect(pageIsComplete(accounts, state(coupleWithHome, plan, { 'assets.ownership': 'unknown' }))).toBe(false)
    expect(pageIsComplete(homes, state(coupleWithHome, plan))).toBe(false)
    const selfId = plan.people.find(person => person.role === 'self')!.id
    for (const id of ['legacy:account:tfsa', 'legacy:account:rrsp', 'legacy:account:nonReg']) recordOwner(plan, id, 'self')
    for (const property of plan.properties) property.taxableOwnerShares = { status: 'known', shares: { [selfId]: 1 } }
    expect(pageIsComplete(accounts, state(coupleWithHome, plan))).toBe(true)
    expect(pageIsComplete(homes, state(coupleWithHome, plan))).toBe(true)
  })

  it('fall back to the plan the form would migrate to before anything is recorded', () => {
    const accounts = pageById('assets.ownership')!
    expect(pageIsComplete(accounts, state(couple, null))).toBe(false)
    expect(pageIsComplete(accounts, state(DEFAULT_INPUTS, null))).toBe(true)
  })
})
