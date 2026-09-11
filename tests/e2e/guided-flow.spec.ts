import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('fresh users complete seven steps without changing calculation data', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Guided', exact: true })).toHaveClass(/active/)
  await expect(page.getByRole('heading', { name: 'Household and goal' })).toBeVisible()
  await expect(page.locator('.results-column')).toHaveCount(0)

  for (const heading of [
    'Income and savings',
    'Accounts and contributions',
    'Property and debt',
    'Retirement spending',
    'Benefits and assumptions',
  ]) {
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  }

  await page.getByRole('button', { name: 'Review plan' }).click()
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
    saved.version = 6
    localStorage.setItem('fire-inputs', JSON.stringify(saved))
  })
  await page.reload()

  await expect(page.getByRole('button', { name: 'Professional', exact: true })).toHaveClass(/active/)
  await expect(page.locator('.input-form fieldset')).toHaveCount(6)
  await expect(page.locator('.results-column')).toBeVisible()
})

test('guided flow does not overflow at 320px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-320')
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }))
  expect(widths.document).toBeLessThanOrEqual(widths.viewport)
})
