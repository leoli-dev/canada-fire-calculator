import { describe, expect, it } from 'vitest'
import { changeAccountPresence } from '../../forms/planCommands'
import { DEFAULT_INPUTS, WORKSHEET_KEYS } from '../../store'
import { pageIsComplete, type PageState } from '../pageState'
import { pageById, QUESTION_CATALOG } from '../questionCatalog'
import { worksheetTotal } from '../spending'

const confirmed = { status: 'confirmed' as const, origin: 'user' as const, updatedAt: '2026-01-01T00:00:00.000Z' }
const state = (overrides: Partial<PageState> = {}): PageState => ({
  inputs: DEFAULT_INPUTS, answerMeta: {}, questionAnswers: {}, canonical: null, ...overrides,
})
const worksheet = (values: Partial<Record<typeof WORKSHEET_KEYS[number], number>>) =>
  Object.fromEntries(WORKSHEET_KEYS.map(key => [key, values[key] ?? 0]))

describe('FE-39 category spending reaches the plan', () => {
  it('asks the categories before the total on the estimate path', () => {
    const ids = QUESTION_CATALOG.filter(page => page.categoryId === 'spending').map(page => page.id)
    expect(ids.at(-1)).toBe('spending.total')
    expect(ids.indexOf('spending.funOther')).toBeLessThan(ids.indexOf('spending.total'))
  })

  it('keeps the total pending until the category sum is the recorded spending', () => {
    const total = pageById('spending.total')!
    const categories = worksheet({ wsHousing: 24_000, wsGroceries: 9_000, wsTravel: 12_000 })
    expect(worksheetTotal(categories)).toBe(45_000)
    const base = { questionAnswers: { 'spending.method': 'estimate' }, worksheet: categories, answerMeta: { retirementSpending: confirmed } }
    // 50,000 is the example figure, not the categories' 45,000.
    expect(pageIsComplete(total, state(base))).toBe(false)
    expect(pageIsComplete(total, state({ ...base, inputs: { ...DEFAULT_INPUTS, retirementSpending: 45_000 } }))).toBe(true)
    // A known total on the other path stands on its own.
    expect(pageIsComplete(total, state({ answerMeta: { retirementSpending: confirmed }, questionAnswers: { 'spending.method': 'known' } }))).toBe(true)
  })
})

describe('FE-40 sample values are not answers', () => {
  it('shows a ticked account with a sample balance that still needs the real amount', () => {
    const snapshot = { inputs: DEFAULT_INPUTS, answerMeta: {}, draftByField: {}, inputRevision: 0, resultRevision: null,
      questionAnswers: { 'assets.identify': [] as string[] } }
    const next = changeAccountPresence(snapshot as never, 'tfsa', true)
    expect(next.answerMeta!['balances.tfsa']).toMatchObject({ status: 'estimated', origin: 'example' })
    expect(pageIsComplete(pageById('account.tfsa.balance')!, state({ answerMeta: next.answerMeta! }))).toBe(false)
    expect(pageIsComplete(pageById('account.tfsa.balance')!, state({ answerMeta: { 'balances.tfsa': confirmed } }))).toBe(true)
  })
})
