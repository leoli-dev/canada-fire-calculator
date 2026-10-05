import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('comparison scans start only when their card opens, off the main thread', async ({ page }) => {
  const workers: string[] = []
  page.on('worker', (worker) => workers.push(worker.url()))
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await page.locator('label.field').filter({ hasText: 'Goal' }).locator('select').selectOption('dieWithZero')
  await page.locator('label.field').filter({ hasText: 'Current age' }).locator('input').fill('41')
  await expect(page.locator('.results-column')).toBeVisible()
  expect(workers.filter((url) => url.includes('analysis.worker'))).toEqual([])

  const timing = page.locator('details').filter({ hasText: 'CPP/OAS timing suggestion' })
  await timing.locator('summary').click()
  await expect(timing.locator('.combo')).toBeVisible({ timeout: 15_000 })
  expect(workers.some((url) => url.includes('analysis.worker'))).toBe(true)

  // A later edit keeps the older table visible while the new one computes.
  await page.locator('label.field').filter({ hasText: 'Current age' }).locator('input').fill('42')
  await page.locator('label.field').filter({ hasText: 'Current age' }).locator('input').press('Tab')
  await expect(timing.locator('.compare-table').first()).toBeVisible()
  await expect(timing.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 })

  // Reopening an unchanged plan uses the cached result straight away.
  await timing.locator('summary').click()
  await timing.locator('summary').click()
  await expect(timing.getByTestId('analysis-pending')).toHaveCount(0)
  await expect(timing.locator('.combo')).toBeVisible()
})

test('only the chosen translation is downloaded', async ({ page }) => {
  const locales: string[] = []
  page.on('request', (request) => {
    const match = request.url().match(/\/i18n\/(fr|zh)\.json/)
    if (match) locales.push(match[1])
  })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Professional', exact: true })).toBeVisible()
  expect(locales).toEqual([])
  await page.getByRole('button', { name: 'FR', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Professionnel', exact: true })).toBeVisible()
  expect(locales).toEqual(['fr'])
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  await expect(page.getByRole('button', { name: 'Professionnel', exact: true })).toBeVisible()
  expect(locales).not.toContain('zh')
})
