import { expect, it } from 'vitest'
import en from '../en.json'
import fr from '../fr.json'
import zh from '../zh.json'
import { FHSA_BLOCKING } from '../../engine/fhsa'
import { TFSA_BLOCKING } from '../../engine/tfsaRoom'
import type { BudgetFacts } from '../../engine/budgetSemantics'
import type { SpousalRefusalCode } from '../../engine/spousalAttribution'

// Every component, read as source, so a new leak is caught where it is written.
const sources = import.meta.glob('../../components/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const lookup = (catalogue: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue)

type BudgetCode = Extract<BudgetFacts, { code: string }>['code']
const BUDGET_CODES: Record<BudgetCode, true> = { debtExcluded: true, taxBenefitExcluded: true, incomeBudget: true, invalidAmount: true }
const SPOUSAL_CODES: Record<SpousalRefusalCode, true> = {
  lifUnsupported: true, liraUnsupported: true, ordinaryRrspWithHistory: true, holderUnknown: true, spouseMissing: true,
  historyMissing: true, invalidPayment: true, invalidPaymentYear: true, invalidIncomeBefore: true, contributorUnknown: true,
  annuitantUnknown: true, invalidHistory: true, invalidPremium: true, rrifMinimumUnknown: true, invalidRrifMinimum: true,
  premiumContributorUnknown: true,
}

it('gives every engine refusal code a native sentence in all three languages', () => {
  const keys = [
    ...Object.keys(BUDGET_CODES).map(code => `budget.reason.${code}`),
    ...Object.keys(SPOUSAL_CODES).map(code => `be12.spousalReason.${code}`),
    ...[...FHSA_BLOCKING].map(code => `be36.reason.${code}`),
    ...[...TFSA_BLOCKING].map(code => `be27.reason.${code}`),
  ]
  for (const key of keys) {
    const english = lookup(en, key)
    expect(english, key).toBeTruthy()
    for (const catalogue of [fr, zh]) {
      const native = lookup(catalogue, key)
      expect(native, key).toBeTruthy()
      expect(native, key).not.toBe(english)
    }
  }
})

it('never interpolates an engine diagnostic into a translated sentence', () => {
  // `reason` and `detail` on engine results are English diagnostics. A surface
  // translates the matching code instead of passing the sentence through.
  expect(Object.keys(sources).length).toBeGreaterThan(20)
  for (const [path, source] of Object.entries(sources)) {
    expect(source, path).not.toMatch(/\{\s*(?:reason|detail):\s*[\w?.]+\.(?:reason|detail)\b/)
    expect(source, path).not.toMatch(/\b(?:aria-label|title|placeholder)="[A-Za-z][^"]*"/)
  }
})
