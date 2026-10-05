import { expect, test } from '@playwright/test'

/** FE-38: a single user who tries "couple" and goes back is not stuck in the household estimate. */
test('single, couple, single settles in one step without resetting the plan', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const household = page.locator('label.field').filter({ hasText: 'Household' }).locator('select')
  await household.selectOption('couple')
  await household.selectOption('single')
  const gate = page.getByTestId('migration-gate')
  await expect(gate).toBeVisible()
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.inputs.balances)
  await page.getByTestId('migration-settle-single').click()
  await expect(gate).toHaveCount(0)
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(state.inputs.balances).toEqual(before)
  expect(state.canonical.orphanedPeople ?? []).toEqual([])
  expect(state.canonical.accounts.every((account: { ownerId: string }) => account.ownerId === 'legacy:person:self')).toBe(true)
  // The next ordinary edit keeps the plan settled.
  await page.locator('label.field').filter({ hasText: 'Annual after-tax savings' }).locator('input').fill('41000')
  await expect(gate).toHaveCount(0)
})
