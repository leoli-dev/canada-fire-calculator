import { expect, test, type Page } from '@playwright/test'

/** FE-37: gates lower the wording to an estimate; they never hide the verdict or the charts. */
async function seed(page: Page, options: { province: 'ON' | 'QC'; couple?: boolean }) {
  await page.goto('/')
  await page.evaluate(async ({ province, couple }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS, DEFAULT_PARTNER } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    // A plan that clearly fails: spending far above what the savings support.
    const inputs = { ...DEFAULT_INPUTS, province, retirementSpending: 160_000, partner: couple ? { ...DEFAULT_PARTNER } : null }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: 'professional', inputRevision: 0, resultRevision: null,
    } }))
  }, options)
  await page.reload()
}

test('a failing Quebec plan still says it fails, where, and shows the charts', async ({ page }) => {
  await seed(page, { province: 'QC' })
  const summary = page.getByTestId('person-tax-estimate')
  await expect(summary).toBeVisible()
  await expect(page.getByTestId('estimate-verdict')).toContainText('runs out at age')
  await expect(page.getByTestId('estimate-shortfall')).toContainText('First shortfall at age')
  await expect(summary).toHaveClass(/bad/)
  await expect(page.locator('.results-column .recharts-wrapper').first()).toBeVisible()
  // Precise tax tools stay withheld.
  await expect(page.locator('details').filter({ hasText: 'Withdrawal-order comparison' })).toHaveCount(0)
})

test('a couple with unconfirmed ownership sees an estimate verdict and the charts', async ({ page }) => {
  await seed(page, { province: 'ON', couple: true })
  await expect(page.getByTestId('legacy-estimate')).toBeVisible()
  await expect(page.getByTestId('estimate-verdict')).toContainText('runs out at age')
  await expect(page.getByTestId('estimate-charts-note')).toBeVisible()
  await expect(page.locator('.results-column .recharts-wrapper').first()).toBeVisible()
})
