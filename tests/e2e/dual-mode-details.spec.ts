import { expect, test } from '@playwright/test'

/** FE-46: dual-mode consistency and guided dead ends. */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('a guided inflation rate is shown and editable in professional mode', async ({ page }) => {
  await page.goto('/#/guided/preferences/invest.fees')
  await page.locator('[data-field="inflation"] input').fill('2.5')
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const select = page.getByLabel('Inflation assumption (avg/yr)')
  await expect(select).toHaveValue('custom')
  await expect(select.locator('option[value="custom"]')).toHaveText('Custom (2.5%)')
  const custom = page.locator('label.field').filter({ hasText: 'Inflation (% per year)' }).locator('input')
  await custom.fill('2.7')
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)).inputs.inflation).toBeCloseTo(0.027, 10)
  await select.selectOption('0.021')
  await expect(custom).toHaveCount(0)
})

test('choosing a DC pension balance creates the locked account and links to it', async ({ page }) => {
  await page.goto('/#/guided/income/pension.self')
  await page.getByRole('radio', { name: /I have an account balance/ }).check()
  await expect(page.getByTestId('guided-locked-created')).toBeVisible()
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(state.inputs.lockedRetirement).toMatchObject({ owner: 'self' })
  expect(state.questionAnswers['assets.identify']).toContain('locked')
  await page.getByTestId('guided-locked-created').getByRole('button').click()
  await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'locked.balance')
})

test('recorded employment income offers the working tax rate it implies', async ({ page }) => {
  await page.goto('/#/guided/saving/saving.earned')
  await page.getByTestId('earned-self').fill('95000')
  await page.getByTestId('earned-self').blur()
  await page.goto('/#/guided/preferences/invest.tax')
  const suggestion = page.getByTestId('guided-rate-suggestion')
  await expect(suggestion).toContainText('95,000')
  await suggestion.getByRole('button').click()
  const rate = (await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)).inputs.accumulationMarginalRate
  expect(rate).toBeGreaterThan(0.25)
  expect(rate).toBeLessThan(0.5)
})

test('the savings amount page carries its own monthly or yearly choice', async ({ page }) => {
  await page.goto('/#/guided/saving/saving.method')
  await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'saving.amount')
  await page.getByRole('radio', { name: /yearly amount/i }).check()
  await page.locator('[data-field="annualSavings"] input').fill('30000')
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)).inputs.annualSavings).toBe(30_000)
  await expect(page.getByTestId('guided-progress')).toContainText('1 of')
})

test('BE-46: how side income is paid is one fact in both modes', async ({ page }) => {
  await page.goto('/#/guided/saving/work.after')
  await page.getByRole('radio', { name: /I expect some work income/ }).check()
  await page.goto('/#/guided/saving/work.amount')
  await page.getByRole('radio', { name: /Self-employed/ }).check()
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)).inputs.extraIncome.kind).toBe('selfEmployment')
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId('side-income-kind')).toHaveValue('selfEmployment')
})

test("BE-47: the Home Buyers' Plan is on for a planned first home and can be turned off in either mode", async ({ page }) => {
  await page.goto('/#/guided/housing/home.situation')
  await page.getByRole('radio', { name: 'Planned purchase' }).check()
  await page.goto('/#/guided/housing/purchase.price')
  const guided = page.getByTestId('guided-hbp-use')
  await expect(guided).toBeChecked()
  await guided.uncheck()
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)).inputs.principalResidence.hbp).toBe(false)
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId('hbp-use')).not.toBeChecked()
})

test('FE-41: the rule sources are one collapsed line, so the form starts near the top', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId('rule-assumptions-details')).not.toHaveAttribute('open', '')
  const box = await page.locator('label.field').filter({ hasText: 'Current age' }).locator('input').first().boundingBox()
  expect(box!.y).toBeLessThan(1_200)
})
