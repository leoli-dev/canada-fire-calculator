import { readFileSync } from 'node:fs'
import { prepareProfessionalTarget } from './fixtures/professional'
import { chooseMode, chooseLanguage } from './fixtures/app-bar'
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

  await chooseMode(page, 'professional')
  await expect((await prepareProfessionalTarget(page.locator('.input-form .professional-group')))).toHaveCount(7)
  expect(await page.locator('.input-form .professional-group').evaluateAll(groups => groups.map(group => (group as HTMLElement).dataset.group))).toEqual(['profile', 'saving', 'accounts', 'housing', 'benefits', 'tax', 'advanced'])
  // Preserve the parent revision's complete initial control multiset, including hidden optional editors.
  const expectedControls = JSON.parse(readFileSync(new URL('./fixtures/professional-controls.json', import.meta.url), 'utf8'))
  const controls = await page.locator('.input-form').evaluate(form => [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:not([type=hidden]), select, textarea')].map(element => {
    const label = element.labels?.[0]?.cloneNode(true) as HTMLElement | undefined
    label?.querySelectorAll('input, select, textarea, .selected-value').forEach(node => node.remove())
    return { type: element.type, label: (label?.textContent ?? element.getAttribute('aria-label') ?? '').trim().replace(/\s+/g, ' '), testId: element.dataset.testid ?? '', options: element instanceof HTMLSelectElement ? [...element.options].map(option => option.value) : [] }
  }))
  expect(controls).toHaveLength(66)
  const remaining = [...controls]
  for (const expected of expectedControls) {
    const index = remaining.findIndex(control => JSON.stringify(control) === JSON.stringify(expected))
    expect(index, JSON.stringify(expected)).toBeGreaterThanOrEqual(0)
    remaining.splice(index, 1)
  }

  await expect((await prepareProfessionalTarget(page.locator('.results-column')))).toBeVisible()
  await expect((await prepareProfessionalTarget(page.locator('.results-column')))).toContainText('adds remaining registered balances')

  await (await prepareProfessionalTarget(field(page, 'Current age'))).fill('36')
  await (await prepareProfessionalTarget(field(page, 'Target FIRE age'))).fill('46')
  await (await prepareProfessionalTarget(field(page, 'Household'))).selectOption('couple')
  await (await prepareProfessionalTarget(field(page, "Partner's current age"))).fill('34')

  await (await prepareProfessionalTarget(field(page, /^TFSA$/).first())).fill('125000')
  await (await prepareProfessionalTarget(field(page, 'Use a locked DC pension / LIRA account'))).check()
  await (await prepareProfessionalTarget(field(page, 'Current locked balance'))).fill('80000')
  await (await prepareProfessionalTarget(field(page, 'Use an FHSA (First Home Savings Account)'))).check()
  await (await prepareProfessionalTarget(field(page, 'Current balance (combined)'))).fill('20000')

  await (await prepareProfessionalTarget(page.getByRole('button', { name: '+ Principal residence' }))).click()
  await (await prepareProfessionalTarget(field(page, 'Current value'))).fill('900000')

  await (await prepareProfessionalTarget(field(page, /CPP.*start age/).nth(1))).fill('66')
  await (await prepareProfessionalTarget(field(page, /OAS.*start age/).nth(1))).fill('67')
  await expect(page.locator('.validation-banner')).toHaveCount(0)
  await expect((await prepareProfessionalTarget(page.locator('.results-column')))).toBeVisible()

  const scenario = page.locator('details:not(.professional-group)').filter({ hasText: 'Scenario comparison' })
  await (await prepareProfessionalTarget(scenario.locator('summary'))).press('Enter')
  await (await prepareProfessionalTarget(scenario.getByRole('button', { name: 'Save current as A' }))).click()
  await (await prepareProfessionalTarget(field(page, 'Desired after-tax annual spending in retirement'))).fill('54000')
  await expect((await prepareProfessionalTarget(scenario.getByRole('cell', { name: 'Scenario A' })))).toBeVisible()
  await expect((await prepareProfessionalTarget(scenario.getByRole('cell', { name: 'Current', exact: true })))).toBeVisible()
  await (await prepareProfessionalTarget(scenario.getByRole('button', { name: 'Restore A as current inputs' }))).click()
  await expect((await prepareProfessionalTarget(field(page, 'Desired after-tax annual spending in retirement')))).toHaveValue('50,000')
})

test('scenario final-net-worth heading aligns with its amounts', async ({ page }) => {
  await chooseMode(page, 'professional')
  const scenario = page.locator('details:not(.professional-group)').filter({ hasText: 'Scenario comparison' })
  await (await prepareProfessionalTarget(scenario.locator('summary'))).press('Enter')
  await (await prepareProfessionalTarget(scenario.getByRole('button', { name: 'Save current as A' }))).click()
  await chooseLanguage(page, '中文')

  const localizedScenario = page.locator('details:not(.professional-group)').filter({ hasText: '场景对比' })
  const heading = localizedScenario.getByRole('columnheader', { name: '最终净资产' })
  const amount = localizedScenario.locator('tbody tr').first().locator('td.num')
  const textRight = async (locator: typeof heading) => locator.evaluate((cell) => {
    const range = document.createRange()
    range.selectNodeContents(cell)
    return range.getBoundingClientRect().right
  })
  expect(Math.abs(await textRight(heading) - await textRight(amount))).toBeLessThan(2)
})

test('timing comparison preserves unsupported spending-solver status for a funded planned home', async ({ page }) => {
  // Real spending-solver run (~18s locally for TFSA 5M + dieWithZero on a planned purchase); CI runners are slower than the 30s default.
  test.setTimeout(90_000)
  await chooseMode(page, 'professional')
  await (await prepareProfessionalTarget(field(page, 'TFSA').first())).fill('5000000')
  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: 'Goal' }).locator('select'))).selectOption('dieWithZero')
  await (await prepareProfessionalTarget(page.getByRole('button', { name: '+ Principal residence' }))).click()
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'Planned purchase' }))).check()
  await expect((await prepareProfessionalTarget(page.locator('.results-column')))).toBeVisible()
  const timing = page.locator('details:not(.professional-group)').filter({ hasText: 'CPP/OAS timing suggestion' })
  await (await prepareProfessionalTarget(timing.locator('summary'))).press('Enter')
  await expect((await prepareProfessionalTarget(timing))).toContainText('A future home purchase is not supported')
  await expect((await prepareProfessionalTarget(timing.locator('.combo')))).toContainText('funds the planned spending')
  await expect((await prepareProfessionalTarget(timing.locator('.combo')))).toContainText('A future home purchase is not supported')
  await expect((await prepareProfessionalTarget(timing.locator('.combo')))).not.toContainText('shortfall')
})

test('French solver boundary keeps the checked age and reports the FIRE-number search limit', async ({ page }) => {
  await chooseMode(page, 'professional')
  await (await prepareProfessionalTarget(field(page, 'Life expectancy').first())).fill('61')
  await (await prepareProfessionalTarget(field(page, 'Desired after-tax annual spending in retirement').first())).fill('20000000')
  await chooseLanguage(page, 'FR')
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: 'Quand puis-je me retirer ?' }))).click()
  await expect((await prepareProfessionalTarget(page.locator('.summary')))).toContainText("jusqu'à 60 ans")
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: 'Mon chiffre FIRE ?' }))).click()
  // BE-42: the working plan is now priced from its projected basis; at 20M a
  // year the search runs out, and the French copy says no amount is shown.
  await expect((await prepareProfessionalTarget(page.locator('.summary')))).toContainText('La limite de recherche a été atteinte')
  await expect((await prepareProfessionalTarget(page.locator('.summary')))).toContainText("Aucun montant FIRE n'est affiché")
})

test('timing comparison keeps search-limit status in rows and combined result', async ({ page }) => {
  await chooseMode(page, 'professional')
  await (await prepareProfessionalTarget(field(page, 'TFSA').first())).fill('10000000000')
  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: 'Goal' }).locator('select'))).selectOption('dieWithZero')
  const timing = page.locator('details:not(.professional-group)').filter({ hasText: 'CPP/OAS timing suggestion' })
  await (await prepareProfessionalTarget(timing.locator('summary'))).press('Enter')
  await expect((await prepareProfessionalTarget(timing.locator('tbody tr').first()))).toContainText('search limit was reached')
  await expect((await prepareProfessionalTarget(timing.locator('.combo')))).toContainText('funds the planned spending')
  await expect((await prepareProfessionalTarget(timing.locator('.combo')))).not.toContainText('shortfall')
})
