import { expect, test, type Page } from '@playwright/test'

const languages = ['EN', 'FR', '中文'] as const

async function compareGuidedAndProfessionalHelp(page: Page, fieldId: string) {
  const guided = page.locator('.question-help')
  await guided.locator('summary').click()
  const why = await guided.locator('p').first().innerText()
  const find = await guided.locator('p').nth(1).evaluate(element => element.textContent?.replace(element.querySelector('strong')?.textContent ?? '', '').trim() ?? '')
  const facts = await guided.locator(`[data-content-field="${fieldId}"]`).innerText()
  await page.locator('.entry-mode button').nth(1).click()
  const professional = page.getByTestId(`professional-help-${fieldId}`)
  await professional.locator('summary').click()
  await expect(professional.locator('p').first()).toHaveText(why)
  await expect(professional.locator('p').nth(1)).toHaveText(find)
  await expect(professional.locator(`[data-content-field="${fieldId}"]`)).toHaveText(facts)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.locator('.entry-mode button').first().click()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('savings question and Professional field share source, unit and unknown meaning in EN/FR/ZH', async ({ page }) => {
  const initialRevision = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs') ?? '{"state":{"inputRevision":0}}').state.inputRevision)
  for (const language of languages) {
    await page.getByRole('button', { name: language, exact: true }).click()
    await page.goto('/#/guided/saving/saving.amount')
    await compareGuidedAndProfessionalHelp(page, 'annualSavings')
  }
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.inputRevision)).toBe(initialRevision)
})

test('planned mortgage content appears only when applicable and stays shared in EN/FR/ZH', async ({ page }) => {
  await page.goto('/#/guided/housing/home.situation')
  await page.getByRole('radio', { name: 'Planned purchase' }).check()
  for (const language of languages) {
    await page.getByRole('button', { name: language, exact: true }).click()
    await page.goto('/#/guided/housing/purchase.loan')
    await compareGuidedAndProfessionalHelp(page, 'principalResidence.annualMortgagePayment')
  }
})
