import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

async function acceptEstimateAndContinue(page: import('@playwright/test').Page) {
  const estimate = page.getByRole('button', { name: 'Use shown values as estimates' })
  if (await estimate.isVisible()) await estimate.click()
  const next = page.getByRole('button', { name: /^(Next|Review plan)$/ })
  await next.click()
}

test('fresh users complete seven steps without changing calculation data', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Guided', exact: true })).toHaveClass(/active/)
  await expect(page.getByRole('heading', { name: 'Household and goal' })).toBeVisible()
  await expect(page.locator('.results-column')).toHaveCount(0)
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('heading', { name: 'Household and goal' })).toBeVisible()
  await expect(page.getByText(/Review these 6 sample value/)).toBeVisible()

  for (const heading of [
    'Income and savings',
    'Accounts and contributions',
    'Property and debt',
    'Retirement spending',
    'Benefits and assumptions',
  ]) {
    await acceptEstimateAndContinue(page)
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  }

  await acceptEstimateAndContinue(page)
  await expect(page.getByRole('heading', { name: 'Review and read results' })).toBeVisible()
  await expect(page.locator('.review-card')).toBeVisible()
  await expect(page.locator('.results-column')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Review and read results' })).toBeVisible()
})

test('legacy v6 stores retain professional mode', async ({ page }) => {
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('fire-inputs')!)
    delete saved.state.entryMode
    delete saved.state.activeStep
    delete saved.state.visitedSteps
    delete saved.state.answerMeta
    delete saved.state.scenarioAAnswerMeta
    saved.version = 6
    localStorage.setItem('fire-inputs', JSON.stringify(saved))
  })
  await page.reload()

  await expect(page.getByRole('button', { name: 'Professional', exact: true })).toHaveClass(/active/)
  await expect(page.locator('.input-form fieldset')).toHaveCount(6)
  await expect(page.locator('.results-column')).toBeVisible()
})

test('partner benefit errors stay on Benefits and can be corrected', async ({ page }) => {
  await page.getByLabel('Household').selectOption('couple')
  for (let step = 1; step <= 5; step++) await acceptEstimateAndContinue(page)

  const cppAges = page.getByLabel(/CPP.*start age/)
  await cppAges.nth(1).fill('59')
  await acceptEstimateAndContinue(page)
  await expect(page.getByRole('heading', { name: 'Benefits and assumptions' })).toBeVisible()
  await expect(page.getByText(/Fix 1 required field/)).toBeVisible()

  await cppAges.nth(1).fill('65')
  await page.getByRole('button', { name: 'Review plan' }).click()
  await expect(page.getByRole('heading', { name: 'Review and read results' })).toBeVisible()
})

test('invalidating a visited chapter hides deterministic results', async ({ page }) => {
  for (let step = 1; step <= 6; step++) await acceptEstimateAndContinue(page)
  await expect(page.locator('.results-column')).toBeVisible()

  await page.getByRole('button', { name: 'Edit' }).first().click()
  await page.getByLabel('Target FIRE age').fill('20')
  await page.getByRole('button', { name: 'Return to review' }).click()
  await expect(page.locator('.results-column')).toHaveCount(0)
  await expect(page.getByText(/item.*need attention/i)).toBeVisible()
})

test('guided flow does not overflow at 320px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-320')
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }))
  expect(widths.document).toBeLessThanOrEqual(widths.viewport)
})
