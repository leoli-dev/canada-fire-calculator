import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { chooseMode } from './fixtures/app-bar'
import { revealProfessionalEditor } from './fixtures/professional'
const copy = JSON.parse(readFileSync(new URL('../../src/i18n/en.json', import.meta.url), 'utf8'))
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
const field = async (page: Page, path: string, key: string, value: string) => {
  await page.goto(`/#/guided/${path}`)
  const input = page.locator(`[data-field="${key}"] input`)
  await input.fill(value)
  await input.blur()
}
async function couple(page: Page) {
  await page.goto('/#/guided/family/family.people')
  await page.getByRole('radio', { name: 'Couple (combined) Plan with my partner', exact: true }).check()
}
async function owned(page: Page) {
  await page.goto('/#/guided/housing/home.situation')
  await page.getByRole('radio', { name: 'Already own', exact: true }).check()
  await field(page, 'housing/home.value', 'principalResidence.value', '975000')
}
async function toggle(page: Page, group: string, label: string, index = 0) {
  const root = page.locator(`[data-group="${group}"]`)
  await revealProfessionalEditor(page, root)
  const control = root.getByRole('checkbox', { name: label, exact: true }).nth(index)
  await control.uncheck()
  await control.check()
}
const cases = [
  { name: 'owned residence 975k to default 800k', group: 'housing', meta: 'principalResidence.value',
    setup: owned,
    replace: async (page: Page) => {
      const root = page.locator('[data-group="housing"]')
      await root.getByRole('button', { name: 'Remove', exact: true }).click()
      await root.getByRole('button', { name: '+ Principal residence', exact: true }).click()
    }, value: (s: any) => s.inputs.principalResidence.value, expected: 800000 },
  { name: 'planned residence 975k to a new default planned 800k', group: 'housing', meta: 'principalResidence.price',
    setup: async (page: Page) => {
      await page.goto('/#/guided/housing/home.situation')
      await page.getByRole('radio', { name: 'Planned purchase', exact: true }).check()
      await field(page, 'housing/purchase.price', 'principalResidence.price', '975000')
    }, replace: async (page: Page) => {
      const root = page.locator('[data-group="housing"]')
      await root.getByRole('button', { name: 'Remove', exact: true }).click()
      await root.getByRole('button', { name: '+ Principal residence', exact: true }).click()
      await root.getByRole('radio', { name: 'Planned purchase', exact: true }).check()
    }, value: (s: any) => s.inputs.principalResidence.price, expected: 800000 },
  { name: 'owned and planned mode replacements do not inherit a home confirmation', group: 'housing', meta: 'principalResidence.value',
    setup: owned,
    replace: async (page: Page) => {
      const root = page.locator('[data-group="housing"]')
      await root.getByRole('radio', { name: 'Planned purchase', exact: true }).check()
      await root.getByRole('radio', { name: 'Already own', exact: true }).check()
    }, value: (s: any) => s.inputs.principalResidence.value, expected: 800000 },
  { name: 'linked mortgage 725k to default 300k', group: 'housing', meta: 'principalResidence.mortgage.balance',
    setup: async (page: Page) => {
      await owned(page)
      await page.goto('/#/guided/housing/home.mortgage')
      await page.getByRole('radio', { name: 'Yes', exact: true }).check()
      await field(page, 'housing/mortgage.balance', 'principalResidence.mortgage.balance', '725000')
    }, replace: (page: Page) => toggle(page, 'housing', copy.hasMortgage),
    value: (s: any) => s.inputs.principalResidence.mortgage.balance, expected: 300000 },
  { name: 'FHSA 97500 to default zero', group: 'accounts', meta: 'fhsa.balance',
    setup: async (page: Page) => {
      await page.goto('/#/guided/assets/assets.identify')
      await page.getByRole('checkbox', { name: 'FHSA', exact: true }).check()
      await field(page, 'assets/fhsa.details', 'fhsa.balance', '97500')
    }, replace: (page: Page) => toggle(page, 'accounts', copy.fhsaToggle),
    value: (s: any) => s.inputs.fhsa.balance, expected: 0 },
  { name: 'locked account 97500 to default zero', group: 'accounts', meta: 'lockedRetirement.balance',
    setup: async (page: Page) => {
      await page.goto('/#/guided/assets/assets.identify')
      await page.getByRole('checkbox', { name: 'Locked retirement account', exact: true }).check()
      await field(page, 'assets/locked.balance', 'lockedRetirement.balance', '97500')
    }, replace: (page: Page) => toggle(page, 'accounts', copy.lockedRetirementToggle),
    value: (s: any) => s.inputs.lockedRetirement.balance, expected: 0 },
  { name: 'side income 97500 to default 20000', group: 'benefits', meta: 'extraIncome.annual',
    setup: async (page: Page) => {
      await page.goto('/#/guided/saving/work.after')
      await page.getByRole('radio', { name: 'I expect some work income', exact: true }).check()
      await field(page, 'saving/work.amount', 'extraIncome.annual', '97500')
    }, replace: (page: Page) => toggle(page, 'benefits', copy.extraIncomeToggle),
    value: (s: any) => s.inputs.extraIncome.annual, expected: 20000 },
  { name: 'self DB pension 97500 to default 30000', group: 'benefits', meta: 'pension.annualAmount',
    setup: async (page: Page) => {
      await page.goto('/#/guided/income/pension.self')
      await page.getByRole('radio', { name: /^My employer will pay me regularly/ }).check()
      await field(page, 'income/pension.self.details', 'pension.annualAmount', '97500')
    }, replace: (page: Page) => toggle(page, 'benefits', copy.pensionToggle),
    value: (s: any) => s.inputs.pension.annualAmount, expected: 30000 },
  { name: 'partner DB pension 97500 to default 30000', group: 'benefits', meta: 'partner.pension.annualAmount',
    setup: async (page: Page) => {
      await couple(page)
      await page.goto('/#/guided/income/pension.partner')
      await page.getByRole('radio', { name: /^My employer will pay me regularly/ }).check()
      await field(page, 'income/pension.partner.details', 'partner.pension.annualAmount', '97500')
    }, replace: (page: Page) => toggle(page, 'benefits', copy.pensionToggle, 1),
    value: (s: any) => s.inputs.partner.pension.annualAmount, expected: 30000 },
  { name: 'partner identity and age survive removal and re-add', group: 'profile', meta: 'partner.currentAge',
    setup: async (page: Page) => {
      await couple(page)
      await field(page, 'family/family.ages', 'partner.currentAge', '52')
      await field(page, 'income/cpp.partner', 'partner.cppAnnualAt65', '975')
      await field(page, 'income/oas.partner', 'partner.oasAnnualAt65', '875')
    }, replace: async (page: Page) => {
      const household = page.locator('[data-group="profile"] select').last()
      await household.selectOption('single')
      await household.selectOption('couple')
    }, value: (s: any) => s.inputs.partner.currentAge, expected: 52, identityRetained: true },
  { name: 'child age 12 to a new default child age 5', group: 'profile', meta: 'children',
    setup: async (page: Page) => {
      await page.goto('/#/guided/family/family.children')
      await page.getByRole('radio', { name: 'Include children', exact: true }).check()
      await field(page, 'family/family.children', 'children.0.age', '12')
    }, replace: (page: Page) => toggle(page, 'profile', copy.childrenToggle),
    value: (s: any) => s.inputs.children[0].age, expected: 5 },
]

// Count only permanent plan/self/aggregate-account answers; optional entity slots have no persisted identity binding.
function safeFields(group: string, state: any): string[] {
  if (group === 'profile') return ['currentAge', 'fireAge', 'lifeExpectancy', 'province', 'household', ...(state.inputs.partner ? ['partner.currentAge'] : [])]
  if (group === 'accounts') return ['balances.tfsa', 'balances.rrsp', 'balances.nonReg', ...(state.inputs.balances.nonReg > 0 ? ['nonRegBook'] : [])]
  return ['cppStartAge', 'cppAnnualAt65', 'oasStartAge', 'oasAnnualAt65', ...(state.inputs.partner ? ['partner.cppStartAge', 'partner.cppAnnualAt65', 'partner.oasStartAge', 'partner.oasAnnualAt65'] : [])]
}
for (const scenario of cases) test(`replaceable status: ${scenario.name} preserves facts through reload`, async ({ page }, info) => {
  await scenario.setup(page)
  const original = await saved(page)
  expect(original.answerMeta[scenario.meta]).toMatchObject({ status: 'confirmed', origin: 'user' })
  await chooseMode(page, 'professional')
  const root = page.locator(`[data-group="${scenario.group}"]`)
  await revealProfessionalEditor(page, root)
  const summary = root.locator(':scope > summary small')
  const beforeSummary = await summary.textContent()
  await scenario.replace(page)
  const replacement = await saved(page)
  const afterSummary = await summary.textContent()
  expect(scenario.value(replacement)).toBe(scenario.expected)
  expect(replacement.answerMeta[scenario.meta]).toEqual(original.answerMeta[scenario.meta])
  await page.reload()
  const restored = await saved(page)
  const restoredSummary = await summary.textContent()
  expect(restored.inputs).toEqual(replacement.inputs)
  expect(restored.canonical).toEqual(replacement.canonical)
  expect(restored.answerMeta).toEqual(replacement.answerMeta)
  await info.attach('replacement-evidence', { body: JSON.stringify({ scenario: scenario.name, confirmedMetadata: original.answerMeta[scenario.meta], originalValue: scenario.value(original), replacementValue: scenario.value(replacement), beforeSummary, afterSummary, restoredSummary, originalPartner: original.inputs.partner, replacementPartner: replacement.inputs.partner, originalCanonical: original.canonical, replacementCanonical: replacement.canonical, confirmedMetadataUnchanged: true, canonicalAndInputsUnchangedOnReload: true }), contentType: 'application/json' })
  if ('identityRetained' in scenario && scenario.identityRetained) {
    expect(restored.canonical.people.find((person: any) => person.role === 'partner')).toEqual(original.canonical.people.find((person: any) => person.role === 'partner'))
    for (const key of ['currentAge', 'cppStartAge', 'cppAnnualAt65', 'oasStartAge', 'oasAnnualAt65', 'cppAmountSource', 'oasAmountSource']) expect(restored.inputs.partner[key]).toEqual(original.inputs.partner[key])
    await expect(summary).not.toContainText('Needs review')
    const benefits = page.locator('[data-group="benefits"] > summary small')
    await expect(benefits).toContainText('2 of 8 tracked answers confirmed')
  } else if (scenario.group === 'housing') await expect(summary).toHaveText('Needs review')
  else {
    await expect(summary).toContainText('Needs review')
    const eligible = safeFields(scenario.group, restored).filter(key => restored.answerMeta[key]?.status !== 'notApplicable')
    if (eligible.some(key => restored.answerMeta[key])) {
      const confirmed = eligible.filter(key => restored.answerMeta[key]?.status === 'confirmed' && restored.answerMeta[key]?.origin === 'user').length
      await expect(summary).toContainText(`${confirmed} of ${eligible.length} tracked answers confirmed`)
      const estimated = eligible.filter(key => restored.answerMeta[key]?.status === 'estimated').length
      if (!estimated) expect(await summary.textContent()).not.toMatch(/\d+ estimates?/)
    } else await expect(summary).toHaveText('Needs review')
  }
})
