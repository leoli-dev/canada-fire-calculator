import { describe, expect, it } from 'vitest'
import { pageById, QUESTION_CATALOG, QUESTION_CATEGORIES, visibleQuestionPages } from '../questionCatalog'
import { DEFAULT_INPUTS } from '../../store'
import { guidanceForPage, hasLocalizedGuidance, type GuidanceLanguage } from '../pageGuidance'

describe('question catalog', () => {
  it('uses unique stable string IDs and at most two main questions per page', () => {
    const ids = QUESTION_CATALOG.map((page) => page.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.includes('.') && !/^\d+$/.test(id))).toBe(true)
    expect(QUESTION_CATALOG.every((page) => page.questions.length >= 1 && page.questions.length <= 2)).toBe(true)
  })

  it('keeps all seven categories in the directory', () => {
    expect(QUESTION_CATEGORIES.map((category) => category.id)).toEqual([
      'family', 'saving', 'assets', 'housing', 'spending', 'income', 'preferences',
    ])
  })

  it('keeps future account allocation on one page and resolves old page links', () => {
    const allocationPages = QUESTION_CATALOG.filter((page) => page.fieldBindings.some((field) => field.startsWith('savingsSplit.')))
    expect(allocationPages.map((page) => page.id)).toEqual(['allocation.tfsa'])
    expect(allocationPages[0].fieldBindings).toEqual(['savingsSplit.tfsa', 'savingsSplit.rrsp', 'savingsSplit.nonReg'])
    expect(pageById('allocation.rrsp')?.id).toBe('allocation.tfsa')
    expect(pageById('allocation.nonReg')?.id).toBe('allocation.tfsa')
  })

  it('keeps non-registered market value and cost base on one page', () => {
    const page = pageById('account.nonReg.balance')
    expect(page?.fieldBindings).toEqual(['balances.nonReg', 'nonRegBook'])
    expect(pageById('assets.cost')?.id).toBe('account.nonReg.balance')
    expect(QUESTION_CATALOG.some((definition) => definition.id === 'assets.cost')).toBe(false)
  })

  it('asks for the optional personal asset target alongside the work-stop age', () => {
    expect(pageById('time.work')?.fieldBindings).toEqual(['fireAge', 'fireTargetAssets'])
    expect(QUESTION_CATALOG.some((page) => page.id === 'time.target')).toBe(false)
  })

  it('keeps intent recommendation inline and resolves the old confirmation link', () => {
    expect(QUESTION_CATALOG.some((definition) => definition.id === 'intent.confirm')).toBe(false)
    expect(pageById('intent.confirm')?.id).toBe('intent.spending')
    expect(pageById('intent.spending')?.fieldBindings).toContain('goal')
  })

  it('uses the final answer review instead of a separate assumption-acceptance page', () => {
    expect(QUESTION_CATALOG.some((definition) => definition.id === 'assumptions.review')).toBe(false)
    expect(pageById('assumptions.review')?.id).toBe('invest.strategy')
    expect(QUESTION_CATALOG.at(-1)?.id).toBe('invest.strategy')
  })

  it('provides distinct page-level guidance in every supported language', () => {
    const languages: GuidanceLanguage[] = ['en', 'fr', 'zh']

    for (const definition of QUESTION_CATALOG) {
      for (const language of languages) {
        expect(hasLocalizedGuidance(definition.guidanceKey, language), `${definition.id} (${language})`).toBe(true)
        const guidance = guidanceForPage(definition.guidanceKey, language)
        expect(guidance.why.trim().length, `${definition.id} why (${language})`).toBeGreaterThan(10)
        expect(guidance.find.trim().length, `${definition.id} find (${language})`).toBeGreaterThan(10)
        expect(guidance.example.trim().length, `${definition.id} example (${language})`).toBeGreaterThan(10)
      }

      expect(guidanceForPage(definition.guidanceKey, 'fr')).not.toEqual(guidanceForPage(definition.guidanceKey, 'en'))
      expect(guidanceForPage(definition.guidanceKey, 'zh')).not.toEqual(guidanceForPage(definition.guidanceKey, 'en'))
    }

    for (const language of languages) {
      for (const category of QUESTION_CATEGORIES) {
        const pages = QUESTION_CATALOG.filter((definition) => definition.categoryId === category.id)
        const signatures = pages.map(({ guidanceKey }) => JSON.stringify(guidanceForPage(guidanceKey, language)))
        expect(new Set(signatures).size, `${category.id} (${language})`).toBe(pages.length)
      }
    }
  })

  it('adds conditional household and property branches without hiding unrelated pages', () => {
    const base = visibleQuestionPages(DEFAULT_INPUTS, {})
    const expanded = visibleQuestionPages({
      ...DEFAULT_INPUTS,
      partner: { currentAge: 35, cppStartAge: 65, cppAnnualAt65: 10_000, oasStartAge: 65, oasAnnualAt65: 8_700 },
      investmentProperties: [{ value: 500_000, acb: 400_000, appreciation: 0.02, sellAtAge: null, annualRent: 20_000 }],
      debts: [{ kind: 'other', balance: 10_000, annualPayment: 2_400, yearsRemaining: 5 }],
    }, {})
    expect(expanded.length).toBeGreaterThan(base.length)
    expect(expanded.some((page) => page.id === 'cpp.partner')).toBe(true)
    expect(expanded.some((page) => page.id === 'rental.0.value')).toBe(true)
    expect(expanded.some((page) => page.id === 'debt.0.balance')).toBe(true)
  })
})
