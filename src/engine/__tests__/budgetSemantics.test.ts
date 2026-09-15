import { describe, expect, it } from 'vitest'
import { budgetFacts, canonicalBudgetForChoice, cashBudget, listedAnnualDebtPayments, reconciledBudget } from '../budgetSemantics'
import { precisionGate, pricingGate, type BudgetMode, type InputsV2 } from '../model'
import { migratePersistedPlan } from '../migration'
import { DEFAULT_INPUTS } from '../../store'
import type { Inputs } from '../types'
import en from '../../i18n/en.json'
import fr from '../../i18n/fr.json'
import zh from '../../i18n/zh.json'

/**
 * BE-13 A. Independent expected values for "what does the recorded saving
 * figure mean". The three refusal situations used to share one generic message;
 * these tests pin a distinct outcome and a distinct reason to each.
 */

const savings = (overrides: Partial<Extract<BudgetMode, { kind: 'savingsBudget' }>> = {}): BudgetMode => ({
  kind: 'savingsBudget', annualNetSavings: 40_000, retirementSpending: 50_000,
  debtIncluded: { status: 'unknown', reason: 'legacy savings/debt treatment needs confirmation' },
  taxBenefitIncluded: { status: 'unknown', reason: 'legacy tax benefit treatment needs confirmation' },
  ...overrides,
})

const legacy = (overrides: Partial<Inputs> = {}): Pick<Inputs, 'annualSavings' | 'retirementSpending' | 'budgetWorkingSpending'> => ({
  annualSavings: 24_000, retirementSpending: 50_000, budgetWorkingSpending: null, ...overrides,
})

describe('BE-13 A budget facts', () => {
  it('reports an unanswered flag as a fact the user must supply, naming each one', () => {
    const both = budgetFacts(savings())
    expect(both).toMatchObject({ status: 'needs-facts', unconfirmed: ['budget.debtIncluded', 'budget.taxBenefitIncluded'] })

    const debtOnly = budgetFacts(savings({ debtIncluded: { status: 'known', value: true } }))
    expect(debtOnly).toMatchObject({ status: 'needs-facts', unconfirmed: ['budget.taxBenefitIncluded'] })

    const taxOnly = budgetFacts(savings({ taxBenefitIncluded: { status: 'known', value: true } }))
    expect(taxOnly).toMatchObject({ status: 'needs-facts', unconfirmed: ['budget.debtIncluded'] })
  })

  it('never turns an unknown flag into a confirmed one, and never turns a confirmed one back into unknown', () => {
    const unanswered = budgetFacts(savings())
    expect(unanswered.status).toBe('needs-facts')
    // An unknown flag is not a false one: the two answered-false shapes below
    // are a different outcome, with their own reason.
    const debtFalse = budgetFacts(savings({ debtIncluded: { status: 'known', value: false }, taxBenefitIncluded: { status: 'known', value: true } }))
    const taxFalse = budgetFacts(savings({ debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: false } }))
    expect(debtFalse).toMatchObject({ status: 'unsupported' })
    expect(taxFalse).toMatchObject({ status: 'unsupported' })
    expect(debtFalse.status === 'unsupported' && debtFalse.detail).toContain('separately listed debt payments')
    expect(taxFalse.status === 'unsupported' && taxFalse.detail).toContain('registered-contribution tax benefit')
    expect(debtFalse.status === 'unsupported' && debtFalse.detail).not.toBe(taxFalse.status === 'unsupported' && taxFalse.detail)
  })

  it('names incomeBudget as its own out-of-scope reason rather than a savings-budget failure', () => {
    const facts = budgetFacts({ kind: 'incomeBudget', workingSpending: 60_000, retirementSpending: 50_000 })
    expect(facts.status).toBe('income-budget')
    expect(facts.status === 'income-budget' && facts.detail).toContain('out of scope for BE-13 A')
    expect(facts.status === 'income-budget' && facts.detail).not.toContain('savings budget')
  })

  it('prices only the fully answered savings shape, keeping a real zero as zero', () => {
    const ready = budgetFacts(savings({ debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } }))
    expect(ready).toEqual({ status: 'ready', annualNetSavings: 40_000 })
    const zero = budgetFacts(savings({ annualNetSavings: 0, debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } }))
    expect(zero).toEqual({ status: 'ready', annualNetSavings: 0 })
    // An unanswered plan is never priced at zero.
    expect(cashBudget(savings(), 2027, 2026, 0.021)).toBeNull()
    expect(cashBudget({ kind: 'incomeBudget', workingSpending: 1, retirementSpending: 1 }, 2027, 2026, 0.021)).toBeNull()
    const priced = cashBudget(savings({ debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } }), 2027, 2026, 0.021)
    expect(priced).toBeCloseTo(40_000 * 1.021, 10)
    // The reconciliation baseline is the sum of the listed debt rows, nothing more.
    expect(listedAnnualDebtPayments({ debts: [{ annualPayment: 6_000 }, { annualPayment: 1_500.5 }] } as Pick<InputsV2, 'debts'>)).toBeCloseTo(7_500.5, 10)
    // An unpriceable amount is reported as invalid, never substituted with a number.
    expect(budgetFacts(savings({ annualNetSavings: Number.NaN, debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } }))).toMatchObject({ status: 'invalid' })
  })
})

describe('BE-13 A canonical budget construction', () => {
  it('writes only the answers the user gave and keeps the recorded amount verbatim', () => {
    expect(canonicalBudgetForChoice(legacy(), { mode: 'savingsBudget', debtIncluded: true, taxBenefitIncluded: false })).toEqual({
      kind: 'savingsBudget', annualNetSavings: 24_000, retirementSpending: 50_000,
      debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: false },
    })
  })

  it('keeps an unrecorded working spending at zero instead of borrowing the retirement figure', () => {
    const income = canonicalBudgetForChoice(legacy({ budgetWorkingSpending: null }), { mode: 'incomeBudget' })
    expect(income).toEqual({ kind: 'incomeBudget', workingSpending: 0, retirementSpending: 50_000 })
    const recorded = canonicalBudgetForChoice(legacy({ budgetWorkingSpending: 62_000 }), { mode: 'incomeBudget' })
    expect(recorded).toEqual({ kind: 'incomeBudget', workingSpending: 62_000, retirementSpending: 50_000 })
  })

  it('keeps the legacy approximation explicit while an unanswered plan asserts nothing', () => {
    expect(reconciledBudget(legacy(), { keepLegacy: false })).toEqual({
      kind: 'savingsBudget', annualNetSavings: 24_000, retirementSpending: 50_000,
      debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true },
    })
    // Keeping the legacy approximation means the number stays net of the debt
    // and without the tax benefit: the v10 meaning, stated explicitly.
    expect(reconciledBudget(legacy(), { keepLegacy: true })).toEqual({
      kind: 'savingsBudget', annualNetSavings: 24_000, retirementSpending: 50_000,
      debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: false },
    })
    // Nothing here writes a fact for the plan that has not answered.
    expect(budgetFacts(savings()).status).toBe('needs-facts')
  })

})

type PackCode = 'en' | 'fr' | 'zh'
const packs: { code: PackCode; budget: Record<string, string> }[] = [
  { code: 'en', budget: en.budget as Record<string, string> },
  { code: 'fr', budget: fr.budget as Record<string, string> },
  { code: 'zh', budget: zh.budget as Record<string, string> },
]

/** The inclusion fact an option's click records, read off the built budget. */
function recordedFact(budget: Extract<BudgetMode, { kind: 'savingsBudget' }>, fact: 'debtIncluded' | 'taxBenefitIncluded'): boolean {
  const flag = fact === 'debtIncluded' ? budget.debtIncluded : budget.taxBenefitIncluded
  if (flag.status !== 'known') throw new Error(`${fact} was not recorded`)
  return flag.value
}

/**
 * Review fix B1. Every option the panel offers records exactly what the sentence
 * next to it tells the user. This is the guard against the drift that recorded
 * `debtIncluded: false` under copy saying "already net of the listed loan
 * payments": the copy is read from the shipped packs, and each claim it makes is
 * tied to the flag the click writes in every language.
 */
describe('BE-13 A copy agrees with the fact each option records', () => {
  const optionCopy = (budget: Record<string, string>, parts: string[]): string => parts.map(part => budget[part]).join(' ')
  const copy = {
    debtNet: { en: /net of .*listed loan payments/i, fr: /net d(es|u) .*remboursements de prêts inscrits/i, zh: /单列贷款还款/ },
    noTax: { en: /without the tax difference/i, fr: /sans l’économie d’impôt/i, zh: /不含抵税差额/ },
    withTax: { en: /no separate tax refund/i, fr: /sans remboursement d’impôt distinct/i, zh: /不含单独退税/ },
    included: { en: /already included/i, fr: /déjà inclus/i, zh: /已经包含/ },
    excluded: { en: /not included yet/i, fr: /pas encore inclus/i, zh: /还没有包含/ },
  } satisfies Record<string, Record<PackCode, RegExp>>

  const options: {
    testId: string
    parts: string[]
    build: () => BudgetMode
    claims: { fact: 'debtIncluded' | 'taxBenefitIncluded'; states: boolean; markers: Record<PackCode, RegExp> }[]
  }[] = [
    // Keeping the v10 approximation: net of the listed debt, without the tax benefit.
    { testId: 'budget-basis-legacy', parts: ['legacyKeep', 'legacyKeepDetail'], build: () => reconciledBudget(legacy(), { keepLegacy: true }),
      claims: [{ fact: 'debtIncluded', states: true, markers: copy.debtNet }, { fact: 'taxBenefitIncluded', states: false, markers: copy.noTax }] },
    // Adopting the new definition asserts both facts about the same number.
    { testId: 'budget-basis-adopt', parts: ['legacyAdopt', 'legacyAdoptDetail'], build: () => reconciledBudget(legacy(), { keepLegacy: false }),
      claims: [{ fact: 'debtIncluded', states: true, markers: copy.debtNet }, { fact: 'taxBenefitIncluded', states: true, markers: copy.withTax }] },
    // The trace questions: the answer option's own wording matches the flag.
    { testId: 'budget-debt-yes', parts: ['yes'], build: () => canonicalBudgetForChoice(legacy(), { mode: 'savingsBudget', debtIncluded: true, taxBenefitIncluded: true }),
      claims: [{ fact: 'debtIncluded', states: true, markers: copy.included }] },
    { testId: 'budget-debt-no', parts: ['no'], build: () => canonicalBudgetForChoice(legacy(), { mode: 'savingsBudget', debtIncluded: false, taxBenefitIncluded: true }),
      claims: [{ fact: 'debtIncluded', states: false, markers: copy.excluded }] },
    { testId: 'budget-tax-yes', parts: ['yes'], build: () => canonicalBudgetForChoice(legacy(), { mode: 'savingsBudget', debtIncluded: true, taxBenefitIncluded: true }),
      claims: [{ fact: 'taxBenefitIncluded', states: true, markers: copy.included }] },
    { testId: 'budget-tax-no', parts: ['no'], build: () => canonicalBudgetForChoice(legacy(), { mode: 'savingsBudget', debtIncluded: true, taxBenefitIncluded: false }),
      claims: [{ fact: 'taxBenefitIncluded', states: false, markers: copy.excluded }] },
  ]

  for (const option of options) {
    it(`${option.testId} records the fact its copy claims`, () => {
      const budget = option.build()
      if (budget.kind !== 'savingsBudget') throw new Error('expected a savings budget')
      for (const claim of option.claims) {
        // The click writes the fact its own sentence states…
        expect(recordedFact(budget, claim.fact)).toBe(claim.states)
        // …and every language states it, so fr/zh cannot drift from en.
        for (const pack of packs) {
          expect(claim.markers[pack.code].test(optionCopy(pack.budget, option.parts)), `${pack.code}:${option.testId}:${claim.fact}`).toBe(true)
        }
      }
    })
  }

  it('keeps the three packs keyed alike for the budget block', () => {
    const keys = (pack: Record<string, string>) => Object.keys(pack).sort()
    expect(keys(packs[1].budget)).toEqual(keys(packs[0].budget))
    expect(keys(packs[2].budget)).toEqual(keys(packs[0].budget))
    // The new estimate label is translated, never an English placeholder.
    expect(fr.budget.estimateExcluded).not.toBe(en.budget.estimateExcluded)
    expect(zh.budget.estimateExcluded).not.toBe(en.budget.estimateExcluded)
  })
})

/**
 * Review fix B2. A budget fact the user explicitly recorded as `false` must make
 * the headline result a labelled estimate — and nothing else. `unknown` is an
 * unanswered fact and both-`known:true` agrees with the priced figure, so the
 * kernel's pricing gate and every priced number stay exactly where they were.
 */
describe('BE-13 A recorded-excluded basis is presented as an estimate', () => {
  const gatePlan = (budget: BudgetMode): InputsV2 => ({
    ...migratePersistedPlan({ inputs: { ...structuredClone(DEFAULT_INPUTS), annualSavings: 24_000, retirementSpending: 50_000, debts: [] } }, 10, 2026),
    migration: { sourcePersistVersion: 11, ownershipNeedsConfirmation: false, ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false },
    budget,
  })

  it('gates exactly the recorded-false shapes, for presentation only', () => {
    const unknown = gatePlan(savings())
    const ready = gatePlan(savings({ debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } }))
    const debtFalse = gatePlan(savings({ debtIncluded: { status: 'known', value: false } }))
    const taxFalse = gatePlan(savings({ taxBenefitIncluded: { status: 'known', value: false } }))
    const keptLegacy = gatePlan(reconciledBudget(legacy(), { keepLegacy: true }))
    const adopted = gatePlan(reconciledBudget(legacy(), { keepLegacy: false }))

    // An unanswered plan and the shape the projection actually prices are not gated.
    expect(precisionGate(unknown)).toEqual({ allowed: true, reasons: [] })
    expect(precisionGate(ready).allowed).toBe(true)
    expect(precisionGate(adopted).allowed).toBe(true)
    // A recorded "not included" is: the headline may only be the labelled estimate.
    for (const plan of [debtFalse, taxFalse, keptLegacy]) {
      expect(precisionGate(plan)).toEqual({ allowed: false, reasons: ['budgetBasisExcluded'] })
      // The kernel's own gate is untouched, so its flag-specific refusal — and
      // every priced number and tax capability — stays exactly as it was.
      expect(pricingGate(plan)).toEqual({ allowed: true, reasons: [] })
    }
    // Keeping the legacy approximation excludes the tax benefit, not the debt.
    expect(keptLegacy.budget).toMatchObject({ debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: false } })
  })
})
