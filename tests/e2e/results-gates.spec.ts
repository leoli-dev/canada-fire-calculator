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

test('a failing single Quebec plan gets the full results as disclosed estimates', async ({ page }) => {
  await seed(page, { province: 'QC' })
  // BE-43: one Quebec owner is no longer reduced to an estimate summary.
  const summary = page.locator('.summary')
  await expect(summary.locator('.verdict')).toContainText('Money runs out at age')
  await expect(summary).toHaveClass(/uncertain/)
  await expect(summary).toHaveClass(/bad/)
  await expect(page.getByTestId('person-tax-limit')).toContainText('simplified Quebec rules')
  await expect(page.locator('.results-column .recharts-wrapper').first()).toBeVisible()
  await expect(page.locator('details').filter({ hasText: 'Withdrawal-order comparison' })).toHaveCount(1)
})

test('a couple with unconfirmed ownership sees an estimate verdict and the charts', async ({ page }) => {
  await seed(page, { province: 'ON', couple: true })
  await expect(page.getByTestId('legacy-estimate')).toBeVisible()
  await expect(page.getByTestId('estimate-verdict')).toContainText('runs out at age')
  await expect(page.getByTestId('estimate-charts-note')).toBeVisible()
  await expect(page.locator('.results-column .recharts-wrapper').first()).toBeVisible()
})

/** FE-44: a failure is prominent and comes with next steps. */
test('a failing plan offers next steps and shades the uncovered spending', async ({ page }) => {
  await seed(page, { province: 'ON' })
  const summary = page.locator('.summary')
  await expect(summary).toHaveClass(/bad/)
  const next = page.getByTestId('next-steps')
  await expect(next).toBeVisible()
  await page.getByTestId('next-step-sustainable').click()
  await expect(page.getByTestId('next-step-sustainable-answer')).toContainText('CA$')
  await expect(page.locator('.results-column')).toContainText('Not covered')
  await expect(page.locator('.results-column')).toContainText('Needed (spending plus tax)')
  // A single plan never sees the note about which partner dies first.
  await expect(summary).not.toContainText('which partner dies first')
  await next.getByRole('button', { name: 'See the earliest age this plan works' }).click()
  await expect(page.getByRole('tab', { name: 'When can I retire?' })).toHaveAttribute('aria-selected', 'true')
})
