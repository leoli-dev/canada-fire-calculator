import { expect, test } from '@playwright/test'

/**
 * FE-52: couples see the withdrawal-order, timing and Monte Carlo tools as
 * pooled-tax estimates. The pooled approximation ignores who owns an account,
 * so unconfirmed ownership does not withhold them; a savings figure that
 * excludes debt payments does, because the pooled run would invest money the
 * household spends on debt.
 */
async function seedCouple(page: import('@playwright/test').Page, debtIncluded: boolean) {
  await page.goto('/')
  await page.evaluate(async (debtIncluded) => {
    localStorage.clear()
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 45, fireAge: 55, annualSavings: 30_000,
      partner: { currentAge: 43, cppStartAge: 65, cppAnnualAt65: 12000, oasStartAge: 65, oasAnnualAt65: 9024 } }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    canonical.budget = { ...canonical.budget, kind: 'savingsBudget',
      debtIncluded: { status: 'known', value: debtIncluded },
      taxBenefitIncluded: { status: 'known', value: true } }
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: 'professional', guidedView: 'questionnaire',
      inputRevision: 0, resultRevision: null } }))
  }, debtIncluded)
  await page.reload()
}

test('a couple with unconfirmed ownership gets the planning tools, labelled as estimates', async ({ page }) => {
  await seedCouple(page, true)
  await expect(page.getByTestId('estimate-charts-note')).toBeVisible()
  await expect(page.getByTestId('couple-tools-estimate')).toBeVisible()
  await expect(page.getByText('Monte Carlo simulation', { exact: true })).toBeVisible()
  await expect(page.locator('.withdrawal-order-card')).toBeVisible()
})

test('a couple whose savings exclude debt payments does not get the planning tools', async ({ page }) => {
  await seedCouple(page, false)
  await expect(page.getByTestId('estimate-charts-note')).toBeVisible()
  await expect(page.getByTestId('couple-tools-estimate')).toHaveCount(0)
  await expect(page.getByText('Monte Carlo simulation', { exact: true })).toHaveCount(0)
  await expect(page.locator('.withdrawal-order-card')).toHaveCount(0)
})
