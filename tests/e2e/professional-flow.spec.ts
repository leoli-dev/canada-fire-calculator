import { expect, test } from '@playwright/test'

function field(page: import('@playwright/test').Page, label: string | RegExp) {
  return page.locator('label.field').filter({ hasText: label }).locator('input, select')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('professional mode completes a representative household plan and scenario round trip', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.locator('.input-form fieldset')).toHaveCount(6)
  await expect(page.locator('.results-column')).toBeVisible()
  await expect(page.locator('.results-column')).toContainText('shared projected endpoint')

  await field(page, 'Current age').fill('36')
  await field(page, 'Target FIRE age').fill('46')
  await field(page, 'Household').selectOption('couple')
  await field(page, "Partner's current age").fill('34')

  await field(page, /^TFSA$/).first().fill('125000')
  await field(page, 'Use a locked DC pension / LIRA account').check()
  await field(page, 'Current locked balance').fill('80000')
  await field(page, 'Use an FHSA (First Home Savings Account)').check()
  await field(page, 'Current balance (combined)').fill('20000')

  await page.getByRole('button', { name: '+ Principal residence' }).click()
  await field(page, 'Current value').fill('900000')

  await field(page, /CPP.*start age/).nth(1).fill('66')
  await field(page, /OAS.*start age/).nth(1).fill('67')
  await expect(page.locator('.validation-banner')).toHaveCount(0)
  await expect(page.locator('.results-column')).toBeVisible()

  const scenario = page.locator('details').filter({ hasText: 'Scenario comparison' })
  await scenario.locator('summary').click()
  await scenario.getByRole('button', { name: 'Save current as A' }).click()
  await field(page, 'Desired after-tax annual spending in retirement').fill('54000')
  await expect(scenario.getByRole('cell', { name: 'Scenario A' })).toBeVisible()
  await expect(scenario.getByRole('cell', { name: 'Current', exact: true })).toBeVisible()
  await scenario.getByRole('button', { name: 'Restore A as current inputs' }).click()
  await expect(field(page, 'Desired after-tax annual spending in retirement')).toHaveValue('50,000')
})

test('scenario final-net-worth heading aligns with its amounts', async ({ page }) => {
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const scenario = page.locator('details').filter({ hasText: 'Scenario comparison' })
  await scenario.locator('summary').click()
  await scenario.getByRole('button', { name: 'Save current as A' }).click()
  await page.getByRole('button', { name: '中文' }).click()

  const localizedScenario = page.locator('details').filter({ hasText: '场景对比' })
  const heading = localizedScenario.getByRole('columnheader', { name: '最终净资产' })
  const amount = localizedScenario.locator('tbody tr').first().locator('td.num')
  const textRight = async (locator: typeof heading) => locator.evaluate((cell) => {
    const range = document.createRange()
    range.selectNodeContents(cell)
    return range.getBoundingClientRect().right
  })
  expect(Math.abs(await textRight(heading) - await textRight(amount))).toBeLessThan(2)
})
