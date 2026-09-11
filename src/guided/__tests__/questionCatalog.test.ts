import { describe, expect, it } from 'vitest'
import { QUESTION_CATALOG, QUESTION_CATEGORIES, visibleQuestionPages } from '../questionCatalog'
import { DEFAULT_INPUTS } from '../../store'

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
