import { prepareProfessionalTarget } from './fixtures/professional'
import { revealProfessionalEditor } from './fixtures/professional'
import { chooseMode, chooseLanguage } from './fixtures/app-bar'
import { expect, test, type Page } from '@playwright/test'

const languages = ['EN', 'FR', '中文'] as const

async function compareGuidedAndProfessionalHelp(page: Page, fieldId: string) {
  const guided = page.locator('.question-help')
  await (await prepareProfessionalTarget(guided.locator('summary'))).press('Enter')
  const why = await (await prepareProfessionalTarget(guided.locator('p').first())).innerText()
  const find = await guided.locator('p').nth(1).evaluate(element => element.textContent?.replace(element.querySelector('strong')?.textContent ?? '', '').trim() ?? '')
  const facts = await (await prepareProfessionalTarget(guided.locator(`[data-content-field="${fieldId}"]`))).innerText()
  await chooseMode(page, 'professional')
  const professional = page.getByTestId(`professional-help-${fieldId}`)
  await revealProfessionalEditor(page, professional)
  await (await prepareProfessionalTarget(professional.locator('.ui-field-help'))).click()
  await expect(professional.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  await page.keyboard.press('Shift+Tab')
  await expect(professional.getByRole('dialog').getByRole('button')).toBeFocused()
  await expect(professional.locator('p').first()).toHaveText(why)
  await expect(professional.locator('p').nth(1)).toHaveText(find)
  await expect(professional.locator(`[data-content-field="${fieldId}"]`)).toHaveText(facts)
  await page.keyboard.press('Escape')
  await expect(professional.getByRole('dialog')).toHaveCount(0)
  await expect(professional.locator('.ui-field-help')).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await chooseMode(page, 'guided')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('savings question and Professional field share source, unit and unknown meaning in EN/FR/ZH', async ({ page }) => {
  const initialRevision = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs') ?? '{"state":{"inputRevision":0}}').state.inputRevision)
  for (const language of languages) {
    await chooseLanguage(page, language)
    await page.goto('/#/guided/saving/saving.amount')
    await compareGuidedAndProfessionalHelp(page, 'annualSavings')
  }
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.inputRevision)).toBe(initialRevision)
})

test('planned mortgage content appears only when applicable and stays shared in EN/FR/ZH', async ({ page }) => {
  await page.goto('/#/guided/housing/home.situation')
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'Planned purchase' }), page.getByRole('radio', { name: 'Planned purchase', includeHidden: true }))).check()
  for (const language of languages) {
    await chooseLanguage(page, language)
    await page.goto('/#/guided/housing/purchase.loan')
    await compareGuidedAndProfessionalHelp(page, 'principalResidence.annualMortgagePayment')
  }
})
