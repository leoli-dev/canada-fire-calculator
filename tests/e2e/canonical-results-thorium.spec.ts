import { existsSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canonicalSheetId } from '../../src/canonicalAnnualSheet'
import { heldHomeEstateIds as ids } from '../../src/engine/__tests__/fixtures/annualIntegratedHeldHomeEstate'
import { canonicalAppPlan, type AppPlanVariant } from './fixtures/canonical-app-plan'

const executablePath = process.env.THORIUM_EXECUTABLE_PATH ?? '/Applications/Thorium.app/Contents/MacOS/Thorium'
test.use({ browserName: 'chromium', launchOptions: { executablePath } })
test.skip(!existsSync(executablePath), 'This suite requires the Thorium executable')

const cad = (amount: number, locale = 'en', decimals = 0) => new Intl.NumberFormat(locale, {
  style: 'currency', currency: 'CAD', minimumFractionDigits: decimals, maximumFractionDigits: decimals,
}).format(amount)
const moneyText = (amount: number) => cad(amount).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const summaryCad = (amount: number) => new RegExp(`${moneyText(amount)}(?:\\.\\d{2})?(?![\\d,])`)

async function seed(page: Page, variant: AppPlanVariant = 'settled') {
  await page.goto('/')
  await page.evaluate(envelope => {
    localStorage.setItem('fire-inputs', JSON.stringify(envelope))
  }, canonicalAppPlan(variant))
  await page.reload()
}

const results = (page: Page) => page.getByTestId('canonical-results')
const overview = (page: Page) => page.getByTestId('canonical-coverage-table')
const opener = (page: Page) => page.getByRole('button', { name: 'Annual financial details', exact: true })
const yearPicker = (sheet: Locator) => sheet.getByRole('combobox', { name: 'Jump to year' })
const evidence = (page: Page) => page.getByTestId('canonical-evidence')
const working = (page: Page) => page.getByTestId('canonical-working-spending')
const retired = (page: Page) => page.getByTestId('canonical-retirement-spending')
const record = (page: Page) => page.getByTestId('canonical-enable')
const disable = (page: Page) => page.getByTestId('canonical-disable')

async function showEvidence(page: Page) {
  if (!(await evidence(page).locator('summary').evaluate(summary => (summary.parentElement as HTMLDetailsElement).open)))
    await evidence(page).locator('summary').click()
}

async function storeState(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
}

async function openSheet(page: Page) {
  await opener(page).click()
  const sheet = page.getByRole('dialog', { name: 'Canonical annual ledger' })
  await expect(sheet).toBeVisible()
  return sheet
}

function row(sheet: Locator, ...parts: string[]) {
  return sheet.locator(`th[id$="-row-${canonicalSheetId(...parts)}"]`).locator('..')
}

function cell(sheet: Locator, year: number, ...parts: string[]) {
  return row(sheet, ...parts).locator(`td[headers$="-year-${year}"]`)
}

async function inspectAmount(sheet: Locator, year: number, expected: number, ...parts: string[]) {
  await yearPicker(sheet).selectOption(String(year))
  await row(sheet, ...parts).getByRole('button', { name: /^Inspect row:/ }).click()
  const detail = sheet.getByRole('complementary', { name: 'Cell details' })
  await expect(detail.getByRole('heading')).toContainText(cad(expected, 'en', 2))
  await detail.getByRole('button', { name: 'Hide details' }).click()
}

async function expectNoLegacyResults(page: Page) {
  const column = page.locator('.results-column')
  await expect(column.locator('.recharts-wrapper, .summary')).toHaveCount(0)
  await expect(column.getByRole('tablist')).toHaveCount(0)
  await expect(column.getByRole('heading', { name: /Monte Carlo|Withdrawal order|Timing/i })).toHaveCount(0)
  await expect(column.getByText(/Estimate: the money runs out|modeled balance lasts/i)).toHaveCount(0)
}

test('persisted #78 settles each S0 year and agrees with the visible App summary and owner ledger', async ({ page }) => {
  await seed(page)
  await expect(overview(page)).toBeVisible()
  await expect(results(page)).toContainText(summaryCad(638_880))
  await expect(results(page)).toContainText(summaryCad(158_070))
  await expectNoLegacyResults(page)

  const sheet = await openSheet(page)
  await expect(sheet.getByRole('columnheader')).toHaveText(['Item', '2026', '2027', '2028'])
  for (const [year, netWorth, spending] of [[2026, 528_579.15, 1_520.10], [2027, 581_290, 350], [2028, 638_880, 300]]) {
    const summaryRow = overview(page).getByRole('row').filter({ has: page.getByRole('rowheader', { name: String(year), exact: true }) })
    await expect(summaryRow).toContainText(cad(netWorth, 'en', 2))
    await expect(cell(sheet, year, 'value', 'netWorth')).toContainText(cad(netWorth))
    await expect(cell(sheet, year, 'value', 'retirement', 'spendingDue')).toContainText(cad(spending))
  }
  await expect(cell(sheet, 2026, 'value', 'estate')).toContainText('Not applicable')
  await expect(cell(sheet, 2028, 'value', 'estate')).toContainText(cad(158_070))
  await expect(cell(sheet, 2028, 'terminalEstate', 'estateAdministrationTax')).toContainText(cad(1_650))
  await expect(cell(sheet, 2028, 'terminalEstate', 'heldHome', 'excludedSurvivorFairMarketValue')).toContainText(cad(479_160))
  await expect(cell(sheet, 2028, 'value', 'retirement', 'spendingUnmet')).toContainText(cad(0))
  await expect(cell(sheet, 2028, 'value', 'event', ids.expense, 'expenseUnmet')).toContainText(cad(31))

  for (const [person, holding, initialAge, contribution, withdrawal] of [
    [ids.self, ids.selfTfsa, 57, 25.04, 675.04], [ids.partner, ids.partnerTfsa, 55, 74.96, 514.11],
  ] as const) {
    for (const year of [2026, 2027, 2028]) {
      const age = initialAge + year - 2026
      await expect(cell(sheet, year, 'value', 'person', person, 'age').locator('span').first()).toHaveText(new RegExp(`^(?:≈ )?${age}$`))
    }
    await inspectAmount(sheet, 2026, contribution, 'value', 'person', person, 'contributed')
    await inspectAmount(sheet, 2027, withdrawal, 'value', 'account', holding, 'withdrawal')
  }
})

test('nominal display and base-year display use the same #78 ledger with closing CPI and nominal estate tax', async ({ page }) => {
  await seed(page, 'inflation')
  // Independent home calculation from the fixture: three 10% real
  // increases, with annual CPI 1.02. Estate holds a quarter before charges.
  const realHome = 480_000 * 1.1 ** 3
  const closingCpi = 1.02 ** 3
  const nominalHome = realHome * closingCpi
  const nominalEstate = nominalHome / 4 - 1_800
  for (const mode of ['real', 'nominal'] as const) {
    await results(page).getByRole('button', { name: mode === 'real' ? /^Real/ : /^Nominal/ }).click()
    const factor = mode === 'real' ? 1 / closingCpi : 1
    await expect(results(page)).toContainText(cad(nominalEstate * factor, 'en', 2))
    const sheet = await openSheet(page)
    await expect(sheet).toHaveAccessibleDescription(mode === 'real' ? /Base-year CAD \(2026\)/ : /Nominal CAD/)
    await expect(cell(sheet, 2028, 'value', 'estate')).toContainText(cad(nominalEstate * factor))
    await inspectAmount(sheet, 2028, nominalEstate * factor, 'value', 'estate')
    await inspectAmount(sheet, 2028, nominalHome / 4 * factor, 'terminalEstate', 'heldHome', 'estateIncludedFairMarketValue')
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
  }
})

test('partial #78 keeps the committed prefix, the stop and suffix, with no legacy conclusion', async ({ page }) => {
  await seed(page, 'partial')
  await expect(page.getByTestId('canonical-blocked-year')).toContainText('2028')
  await expect(page.getByTestId('canonical-uncomputed')).toContainText('2029')
  await expect(page.getByTestId('canonical-uncomputed')).toContainText('2030')
  await expect(overview(page)).toContainText(cad(528_579.15, 'en', 2))
  await expect(overview(page)).toContainText(summaryCad(581_290))
  await expect(results(page)).not.toContainText(cad(638_880))
  await expect(results(page)).not.toContainText(cad(158_070))
  await expectNoLegacyResults(page)

  const sheet = await openSheet(page)
  await expect(sheet.getByRole('columnheader')).toHaveText(['Item', '2026', '2027', '2028', '2029', '2030'])
  await expect(cell(sheet, 2027, 'value', 'netWorth')).toContainText(cad(581_290))
  for (const year of [2028, 2029, 2030]) {
    await expect(cell(sheet, year, 'value', 'netWorth')).toContainText(/Unsupported|Not computed/)
    await expect(cell(sheet, year, 'value', 'estate')).toContainText(/Unsupported|Not computed/)
  }
  await yearPicker(sheet).selectOption('2030')
  await row(sheet, 'value', 'netWorth').getByRole('button', { name: /^Inspect row:/ }).click()
  await expect(sheet.getByRole('complementary')).toContainText('Not computed after the first blocked year')
})

test('legacy sale funding cannot suppress the separate selected canonical stop', async ({ page }) => {
  await seed(page, 'legacy-funding')
  // Pro's ordinary input validation must not erase a valid diagnostic from
  // the selected deterministic route.
  await expect(page.getByTestId('canonical-blocked-year')).toContainText('2026')
  await expect(results(page)).toContainText('2028')
  await expectNoLegacyResults(page)
  await showEvidence(page)
  await disable(page).click()
  await expect(page.getByText(/needs .+ more at the start of that year to clear the mortgage/)).toBeVisible()
  await expect(page.locator('.results-column')).toHaveCount(0)
})

test('preflight refusal keeps the selected route and reports the first year and entire uncomputed suffix', async ({ page }) => {
  await seed(page, 'unsupported-province')
  await expect(page.getByTestId('canonical-blocked-year')).toContainText('2026')
  await expect(page.getByTestId('canonical-uncomputed')).toContainText(/2027.*2028/)
  await expect(overview(page)).toHaveCount(0)
  await expect(opener(page)).toHaveCount(0)
  await expectNoLegacyResults(page)
})

test('an invalid empty horizon has no reversed interval, blocked year or result amounts', async ({ page }) => {
  await seed(page)
  await expect(results(page)).toContainText(summaryCad(158_070))
  await page.locator('label.field').filter({ hasText: /^Life expectancy/ }).locator('input').fill('56')
  await expect(results(page)).toContainText('The requested horizon is invalid or empty.')
  await expect(results(page)).not.toContainText(/2026\s*[–-]\s*2025/)
  await expect(page.getByTestId('canonical-blocked-year')).toHaveCount(0)
  await expect(page.getByTestId('canonical-uncomputed')).toHaveCount(0)
  await expect(overview(page)).toHaveCount(0)
  await expect(page.getByTestId('canonical-estate')).toHaveCount(0)
  await expect(opener(page)).toHaveCount(0)
})

test('Guide regenerates the persisted household ledger after revision and restores evidence with Scenario A', async ({ page }) => {
  await seed(page)
  const scenario = page.locator('details').filter({ has: page.getByText('Scenario comparison', { exact: true }) })
  await scenario.locator('summary').click()
  await scenario.getByRole('button', { name: 'Save current as A' }).click()
  expect((await storeState(page)).scenarioACanonical.deterministicProjection).toMatchObject({
    mode: 'canonical', spending: { transitionSpending: { status: 'known', value: 350 } },
  })

  const guide = page.getByRole('button', { name: 'Guided', exact: true })
  const pro = page.getByRole('button', { name: 'Professional', exact: true })
  const generate = page.getByRole('button', { name: 'Generate my results' })
  await guide.click()
  await page.goto('/#/guided/review')
  await expect(results(page)).toHaveCount(0)
  await expect(generate, 'recorded Guide answers make this household ready for review').toBeEnabled()
  await generate.click()
  await expect(results(page)).toContainText(summaryCad(158_070))
  let sheet = await openSheet(page)
  await expect(cell(sheet, 2028, 'value', 'estate')).toContainText(cad(158_070))
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Modify answers' }).click()
  await page.goto('/#/guided/family/family.ages')
  await page.getByLabel('Current age', { exact: true }).fill('56')
  await page.getByLabel('Current age', { exact: true }).blur()
  await page.goto('/#/guided/results')
  await expect(results(page)).toHaveCount(0)
  await expect(opener(page)).toHaveCount(0)
  expect((await storeState(page)).resultRevision).toBeNull()
  // A legacy-facing edit to the restored household asks the user to review
  // ownership rather than silently reassigning the persisted owner IDs.
  await expect(generate).toBeDisabled()
  await pro.click()
  await expect(page.getByTestId('canonical-blocked-year')).toBeVisible()
  await expect(results(page)).not.toContainText(summaryCad(158_070))
  await expectNoLegacyResults(page)
  if (!(await scenario.locator('summary').evaluate(summary => (summary.parentElement as HTMLDetailsElement).open))) await scenario.locator('summary').click()
  await scenario.getByRole('button', { name: 'Restore A as current inputs' }).click()
  await expect(results(page)).toContainText(summaryCad(158_070))
  await guide.click()
  await page.goto('/#/guided/results')
  await expect(opener(page)).toHaveCount(0)
  await generate.click()
  sheet = await openSheet(page)
  await expect(cell(sheet, 2026, 'value', 'person', ids.self, 'age')).toContainText('57')
  await expect(cell(sheet, 2028, 'value', 'estate')).toContainText(cad(158_070))
  await page.keyboard.press('Escape')
})

test('restoring A drops an unrecorded other-plan budget draft', async ({ page }) => {
  await seed(page)
  const scenario = page.locator('details').filter({ has: page.getByText('Scenario comparison', { exact: true }) })
  await scenario.locator('summary').click()
  await scenario.getByRole('button', { name: 'Save current as A' }).click()
  await page.locator('label.field').filter({ hasText: /^Current age/ }).locator('input').fill('56')
  await expect(page.getByTestId('canonical-blocked-year')).toBeVisible()
  await showEvidence(page)
  await working(page).fill('1234')
  await retired(page).fill('5678')
  await page.getByTestId('canonical-transition-spending').fill('9012')
  await page.getByTestId('canonical-mortgage-excluded').check()
  await expect(record(page)).toBeEnabled()
  await scenario.getByRole('button', { name: 'Restore A as current inputs' }).click()
  await showEvidence(page)
  await expect(working(page)).toHaveValue('')
  await expect(retired(page)).toHaveValue('')
  await expect(record(page)).toBeDisabled()
  await expect(results(page)).toContainText(summaryCad(158_070))
  expect((await storeState(page)).canonical.deterministicProjection.spending.workingSpending).toEqual({ status: 'known', value: 1_520.10 })
})

test('an incomplete Guide cannot generate by recording or disabling canonical evidence', async ({ page }) => {
  await page.goto('/#/guided/review')
  const generate = page.getByRole('button', { name: 'Generate my results' })
  await expect(generate).toBeDisabled()
  await showEvidence(page)
  await working(page).fill('30200')
  await retired(page).fill('26400')
  await record(page).click()
  await expect(generate).toBeDisabled()
  await expect(opener(page)).toHaveCount(0)
  expect((await storeState(page)).resultRevision).toBeNull()
  expect((await storeState(page)).canonical.deterministicProjection.spending.retirementSpending).toEqual({ status: 'known', value: 26_400 })

  await showEvidence(page)
  await disable(page).click()
  await expect(generate).toBeDisabled()
  await expect(page.locator('.results-column')).toHaveCount(0)
  expect((await storeState(page)).canonical.deterministicProjection).toBeUndefined()
})

test('Pro authors a 28-year Ontario ledger with ordinary inputs and explicitly records its budget', async ({ page }) => {
  test.setTimeout(60_000)
  await page.clock.setFixedTime(new Date('2026-11-25T12:00:00Z'))
  await page.goto('/')
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const fields = page.locator('label.field')
  const edits = [
    [ /^Current age/, '58' ], [ /^Target FIRE age/, '59' ], [ /^Life expectancy/, '85' ],
    [ /^Annual after-tax savings/, '0' ], [ /^TFSA$/, '190000' ], [ /^RRSP \/ RRIF$/, '0' ],
    [ /^Non-registered$/, '0' ], [ /^Non-registered cost base/, '0' ],
    [ /Estimated CPP\/QPP per year at 65/, '0' ], [ /OAS per year at 65/, '0' ],
  ] as const
  for (const [name, value] of edits) {
    const input = fields.filter({ hasText: name }).locator('input:visible')
    await expect(input, String(name)).toBeVisible()
    await input.fill(value)
    await input.blur()
  }
  for (const [id, value] of [['earned-self', '12000'], ['rrsp-unused-undeducted-self', '0'], ['tfsa-available-room-self', '0']]) {
    const input = page.getByTestId(id)
    await input.fill(value)
    await input.blur()
  }
  await page.getByTestId('tfsa-withdrawal-add-self').click()
  await page.getByTestId(/^tfsa-withdrawal-remove-/).click()
  await showEvidence(page)
  await evidence(page).locator('select').filter({ has: page.locator('option[value="tfsaFirst"]') }).selectOption('tfsaFirst')
  await showEvidence(page)
  await expect(working(page)).toHaveValue('')
  await expect(retired(page)).toHaveValue('')
  await expect(record(page)).toBeDisabled()
  await expect(results(page)).toHaveCount(0)

  const fillBudgets = async () => {
    await working(page).fill('11298.65')
    await retired(page).fill('12000')
    await record(page).click()
  }
  // A numeric zero before the separate absence affirmation remains unknown
  // for this calculation. Ordinary legacy inputs do not establish that fact.
  await fillBudgets()
  await expect(page.getByTestId('canonical-blocked-year')).toContainText('2026')
  await expect(overview(page)).toHaveCount(0)
  await showEvidence(page)
  await page.getByTestId('canonical-no-nonreg').click()
  await showEvidence(page)
  await fillBudgets()

  await expect(overview(page).locator('tbody tr')).toHaveCount(28)
  await expect(results(page)).toContainText('2053')
  const firstYear = overview(page).getByRole('row').filter({ has: page.getByRole('rowheader', { name: '2026', exact: true }) })
  await expect(firstYear).toContainText(cad(12_000, 'en', 2))
  await expect(firstYear).toContainText(cad(701.35, 'en', 2))
  await expect(firstYear).toContainText(cad(11_298.65, 'en', 2))
  await expectNoLegacyResults(page)
  const saved = await storeState(page)
  expect(saved.answerMeta['balances.nonReg']).toMatchObject({ status: 'notApplicable', origin: 'user' })
  expect(saved.canonical.deterministicProjection).toMatchObject({
    mode: 'canonical', provenance: { origin: 'user', sourceYear: 2026 },
    spending: { workingSpending: { status: 'known', value: 11_298.65 }, retirementSpending: { status: 'known', value: 12_000 } },
  })
  expect(saved.canonical.deterministicProjection.spending).not.toHaveProperty('transitionSpending')
  expect(saved.canonical.annualBenefitsEvidence).toBeUndefined()
  expect(Object.values(saved.canonical.tfsaStatement)).toEqual([
    { withdrawals: [], provenance: { origin: 'user', sourceYear: 2026 } },
  ])
  await page.reload()
  await expect(overview(page).locator('tbody tr')).toHaveCount(28)
  const sheet = await openSheet(page)
  await expect(yearPicker(sheet).locator('option')).toHaveCount(28)
  await expect(cell(sheet, 2053, 'value', 'netWorth')).toContainText(cad(0))
  // Net return is 4.3% less 0.2% fees. After the working year and 26
  // fully funded retirement years, the residual pays part of the 27th.
  let finalFundedReal = 190_000 * 1.041
  for (let year = 0; year < 26; year++) finalFundedReal = (finalFundedReal - 12_000) * 1.041
  await inspectAmount(sheet, 2053, finalFundedReal, 'value', 'retirement', 'spendingFunded')
})

for (const locale of [
  { switcher: 'FR', language: 'fr', opener: 'Détails financiers annuels', title: 'Registre annuel canonique', close: 'Fermer', item: 'Poste', deterministic: /Projection déterministe/ },
  { switcher: '中文', language: 'zh', opener: '逐年财务明细', title: '标准年度账本', close: '关闭', item: '项目', deterministic: /确定性投影/ },
] as const) {
  test(`canonical results and the actual dialog share ${locale.language} at 320px and restore keyboard focus`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 })
    await seed(page)
    await page.getByRole('button', { name: locale.switcher, exact: true }).click()
    await expect(results(page)).toContainText(cad(158_070, locale.language, 2))
    const trigger = page.getByRole('button', { name: locale.opener, exact: true })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const sheet = page.getByRole('dialog', { name: locale.title })
    const close = sheet.getByRole('button', { name: locale.close, exact: true })
    await expect(sheet).toHaveAccessibleDescription(locale.deterministic)
    await expect(close).toBeFocused()
    await expect(close).toBeInViewport({ ratio: 1 })
    await expect(sheet.getByRole('columnheader')).toHaveText([locale.item, '2026', '2027', '2028'])
    await expect(cell(sheet, 2028, 'value', 'estate')).toContainText(cad(158_070, locale.language))
    for (const key of ['Shift+Tab', 'Tab', 'Tab']) {
      await page.keyboard.press(key)
      expect(await sheet.evaluate(node => document.activeElement === document.body || node.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect(trigger).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  })
}

test('S1 uses its pinned stored-plan values and known annual limitations with no opt-in', async ({ page }) => {
  await seed(page, 'no-opt-in')
  await expect(results(page)).toHaveCount(0)
  const summary = page.locator('.results-column .summary').first()
  await expect(summary).toContainText('Final net worth: CA$638,880')
  await expect(summary).toContainText("First shortfall at age 59: CA$473")
  await opener(page).click()
  const sheet = page.getByRole('dialog', { name: 'Household annual estimate' })
  await expect(sheet).toHaveAccessibleDescription(/Salary, working-year living expenses and working-year tax are not modeled/)
  const netWorth = sheet.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Closing net worth', exact: true }) })
  await expect(netWorth.getByRole('cell')).toHaveText(['≈ CA$528,479Estimated', '≈ CA$580,748Estimated', '≈ CA$638,880Estimated'])
})

test('a pre-v11 default plan migrates without opt-in and keeps the same S1 summary and sheet', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-25T12:00:00Z'))
  await page.goto('/')
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const summary = page.locator('.results-column .summary').first()
  await expect(summary).toContainText('Final net worth: CA$601,940')
  await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('fire-inputs')!)
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 10, state: {
      inputs: current.state.inputs, entryMode: 'professional',
    } }))
  })
  await page.reload()
  await expect(summary).toContainText('Final net worth: CA$601,940')
  await expect(results(page)).toHaveCount(0)
  const migrated = await storeState(page)
  expect(migrated.canonical.deterministicProjection).toBeUndefined()
  await opener(page).click()
  const sheet = page.getByRole('dialog', { name: 'Household annual estimate' })
  await expect(sheet).toHaveAccessibleDescription(/Salary, working-year living expenses and working-year tax are not modeled/)
  const netWorth = sheet.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Closing net worth', exact: true }) })
  await expect(netWorth.getByRole('cell').last()).toContainText(cad(601_940))
})
