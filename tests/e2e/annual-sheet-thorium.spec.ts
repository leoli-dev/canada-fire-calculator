import { showAnnualTable } from './fixtures/annual-sheet'
import { prepareProfessionalTarget, showProfessionalResults } from './fixtures/professional'
import { chooseMode, chooseLanguage } from './fixtures/app-bar'
import { existsSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'

// Run locally with: npm run test:e2e -- tests/e2e/annual-sheet-thorium.spec.ts
const executablePath = '/Applications/Thorium.app/Contents/MacOS/Thorium'
test.use({ browserName: 'chromium', launchOptions: { executablePath } })
test.skip(!existsSync(executablePath), 'This suite requires /Applications/Thorium.app')

test('professional household results open the current annual estimate and follow scenario restore', async ({ page }) => {
  await page.goto('/')
  await chooseMode(page, 'professional')
  const fields = page.locator('label.field')
  await (await prepareProfessionalTarget(fields.filter({ hasText: 'Target FIRE age' }).locator('input'))).fill('44')
  await (await prepareProfessionalTarget(fields.filter({ hasText: /^Household/ }).locator('select'))).selectOption('couple')
  const partnerAge = fields.filter({ hasText: "Partner's current age" }).locator('input')
  await (await prepareProfessionalTarget(partnerAge)).fill('34')
  const results = page.locator('.results-column')
  const mainSummary = results.locator('.summary').first()
  await expect(mainSummary).toContainText('Final net worth')
  const mainNetWorth = mainSummary.getByText('Final net worth:', { exact: false }).locator('strong')
  const expectedNetWorth = await (await prepareProfessionalTarget(mainNetWorth)).innerText()
  const scenario = page.locator('details:not(.professional-group)').filter({ hasText: 'Scenario comparison' })
  await (await prepareProfessionalTarget(scenario.locator('summary'))).press('Enter')
  await (await prepareProfessionalTarget(scenario.getByRole('button', { name: 'Save current as A' }), scenario.getByRole('button', { name: 'Save current as A', includeHidden: true }))).click()
  const opener = results.getByRole('button', { name: 'Annual financial details' })
  const dialog = page.getByRole('dialog', { name: 'Household annual estimate' })
  const row = (name: RegExp) => dialog.getByRole('row').filter({ has: page.getByRole('rowheader', { name }) })
  const partner = row(/Partner age/).getByRole('cell').first()
  await showProfessionalResults(page)
  await (await prepareProfessionalTarget(opener)).focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveAccessibleDescription(/Household estimate/)
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await showAnnualTable(page)
  await expect(row(/Salary/).getByRole('cell').first()).toContainText(/Unknown|Not computed/)
  await expect(partner).toContainText('34')
  await expect(row(/Closing net worth/).getByRole('cell').last()).toContainText(expectedNetWorth.replace(/^[^\d−-]+/, ''))
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
  await expect(mainNetWorth).toHaveText(expectedNetWorth)

  await (await prepareProfessionalTarget(partnerAge)).fill('38')
  await showProfessionalResults(page)
  await (await prepareProfessionalTarget(opener)).click()
  await showAnnualTable(page)
  await expect(partner).toContainText('38')
  await (await prepareProfessionalTarget(dialog.getByRole('button', { name: 'Close', exact: true }), dialog.getByRole('button', { name: 'Close', exact: true, includeHidden: true }))).click()
  await (await prepareProfessionalTarget(scenario.getByRole('button', { name: 'Restore A as current inputs' }), scenario.getByRole('button', { name: 'Restore A as current inputs', includeHidden: true }))).click()
  await showProfessionalResults(page)
  await (await prepareProfessionalTarget(opener)).click()
  await showAnnualTable(page)
  await expect(partner).toContainText('34')
  const detail = dialog.getByRole('complementary', { name: 'Cell details' })
  await (await prepareProfessionalTarget(dialog.getByRole('combobox', { name: 'Jump to year' }), dialog.getByRole('combobox', { name: 'Jump to year', includeHidden: true }))).selectOption('2033')
  await (await prepareProfessionalTarget(dialog.getByRole('button', { name: /^Inspect row: Modeled tax.+2033$/ }), dialog.getByRole('button', { name: /^Inspect row: Modeled tax.+2033$/, includeHidden: true }))).click()
  await expect(detail).toContainText(/flat marginal-rate estimate/i)
  await expect(detail).not.toContainText(/Rule package:|Source rule tax year:/)
  await (await prepareProfessionalTarget(detail.getByRole('button', { name: 'Hide details' }), detail.getByRole('button', { name: 'Hide details', includeHidden: true }))).click()
  await (await prepareProfessionalTarget(dialog.getByRole('button', { name: /^Inspect row: Spending shortfall, 2033$/ }), dialog.getByRole('button', { name: /^Inspect row: Spending shortfall, 2033$/, includeHidden: true }))).click()
  await expect(detail.getByRole('heading')).toHaveText('Spending shortfall · 2033: Not computed')
  await expect(detail).toContainText(/uses net savings and has no modeled living-cost target/i)
  await expect(detail).not.toContainText('Formula components')
  await (await prepareProfessionalTarget(detail.getByRole('button', { name: 'Hide details' }), detail.getByRole('button', { name: 'Hide details', includeHidden: true }))).click()
  await (await prepareProfessionalTarget(dialog.getByRole('button', { name: 'Retirement (2035)' }), dialog.getByRole('button', { name: 'Retirement (2035)', includeHidden: true }))).click()
  await (await prepareProfessionalTarget(dialog.getByRole('button', { name: /^Inspect row: After-tax cash available,/ }), dialog.getByRole('button', { name: /^Inspect row: After-tax cash available,/, includeHidden: true }))).click()
  await expect(detail).toBeFocused()
  await expect(detail).toContainText('Formula components')
  await expect(detail).toContainText(/Rule package: CA-ON-tax-/)
  await expect(detail).toContainText('Source rule tax year: 2026')
  await expect(detail).toContainText('Projection calculation year: 2035')
})

for (const locale of [
  { button: 'FR', opener: 'Détails financiers annuels', dialog: 'Estimation annuelle du ménage',
    retirement: 'Retraite', inspect: /Examiner la ligne/, tax: /impôt modélisé/i,
    details: 'Détails de la cellule', limit: /^Limites:.*attribution fiscale par personne/i },
  { button: '中文', opener: '逐年财务明细', dialog: '家庭汇总年度估算',
    retirement: '退休', inspect: /查看行详情/, tax: /模型税额/,
    details: '单元格详情', limit: /^已知限制:.*逐人税务归属/ },
]) {
  test(`professional annual tax limitations are localized in ${locale.button}`, async ({ page }) => {
    await page.goto('/')
    await chooseMode(page, 'professional')
    await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: /^Household/ }).locator('select'))).selectOption('couple')
    await chooseLanguage(page, locale.button)
    await (await prepareProfessionalTarget(page.getByRole('button', { name: locale.opener, exact: true }), page.getByRole('button', { name: locale.opener, exact: true, includeHidden: true }))).click()
    await showAnnualTable(page)
    const dialog = page.getByRole('dialog', { name: locale.dialog })
    await (await prepareProfessionalTarget(dialog.getByRole('button', { name: new RegExp(`^${locale.retirement} \\(\\d{4}\\)$`) }), dialog.getByRole('button', { name: new RegExp(`^${locale.retirement} \\(\\d{4}\\)$`), includeHidden: true }))).click()
    const inspectTax = dialog.getByRole('button', { name: locale.inspect }).and(dialog.getByRole('button', { name: locale.tax }))
    await (await prepareProfessionalTarget(inspectTax)).click()
    const detail = dialog.getByRole('complementary', { name: locale.details })
    await expect(detail.getByText(locale.limit)).toBeVisible()
    await expect(detail).not.toContainText(/registered account owner unknown|working-year tax uses|BE-\d+|budgetBasisExcluded|debtExcluded|taxBenefitExcluded|ownershipNeedsConfirmation/i)
  })
}

test('French underwater-sale details show the event label without its technical ID', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const { annualSheetUnderwaterSale: inputs } = await import('/src/engine/__tests__/fixtures/annualSheetUnderwaterSale.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: { inputs, canonical, entryMode: 'professional' } }))
  })
  await page.reload()
  await chooseLanguage(page, 'FR')
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Détails financiers annuels', exact: true }), page.getByRole('button', { name: 'Détails financiers annuels', exact: true, includeHidden: true }))).click()
  await showAnnualTable(page)
  const dialog = page.getByRole('dialog', { name: 'Estimation annuelle du ménage' })
  const technicalId = 'sale:60:principalResidence.sellAtAge'
  const event = dialog.getByRole('button', { name: /Résidence principale.*Financement d’événement enregistré/ })
  await expect(event).toHaveAttribute('aria-expanded', 'false')
  await expect(event).toHaveAccessibleName('Résidence principale: Financement d’événement enregistré: Année 2026')
  await (await prepareProfessionalTarget(event)).click()
  await (await prepareProfessionalTarget(dialog.getByRole('button', { name: /Examiner la ligne:.*Financement de libération à la vente.*Impôt sur retraits/ }), dialog.getByRole('button', { name: /Examiner la ligne:.*Financement de libération à la vente.*Impôt sur retraits/, includeHidden: true }))).click()
  const detail = dialog.getByRole('complementary', { name: 'Détails de la cellule' })
  await expect(detail.getByText(/^Sources:/)).toContainText('Résidence principale (Événement)')
  await expect(detail.getByText(/^Limites:.*financement de libération.*estimation fiscale héritée/i)).toBeVisible()
  await expect(dialog).not.toContainText(technicalId)
  await expect(dialog.locator(`[title*="${technicalId}"]`)).toHaveCount(0)
})

for (const locale of [
  { button: 'FR', opener: 'Détails financiers annuels', dialog: 'Estimation annuelle du ménage',
    year: 'Aller à une année', tax: 'Examiner la ligne: Impôt modélisé', details: 'Détails de la cellule',
    hide: 'Masquer les détails', caveat: /^Limites:.*(?:bâtiment|terrain|DPA)/i },
  { button: '中文', opener: '逐年财务明细', dialog: '家庭汇总年度估算',
    year: '跳转年份', tax: '查看行详情: 模型税额', details: '单元格详情',
    hide: '收起详情', caveat: /^已知限制:.*(?:土地|建筑|CCA)/ },
]) {
  test(`zero-gain property sale caveat applies only to the sale year in ${locale.button}`, async ({ page }) => {
    await page.goto('/')
    await page.evaluate(async () => {
      const { annualSheetZeroGainPropertySale: inputs } = await import('/src/engine/__tests__/fixtures/annualSheetCapitalLimits.ts')
      const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
      const canonical = refreshCanonicalFromLegacy(null, inputs)
      localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: { inputs, canonical, entryMode: 'professional' } }))
    })
    await page.reload()
    await chooseLanguage(page, locale.button)
    await (await prepareProfessionalTarget(page.getByRole('button', { name: locale.opener, exact: true }), page.getByRole('button', { name: locale.opener, exact: true, includeHidden: true }))).click()
    await showAnnualTable(page)
    const dialog = page.getByRole('dialog', { name: locale.dialog })
    const year = dialog.getByRole('combobox', { name: locale.year })
    const detail = dialog.getByRole('complementary', { name: locale.details })
    await (await prepareProfessionalTarget(year)).selectOption('2027')
    await (await prepareProfessionalTarget(dialog.getByRole('button', { name: new RegExp(`^${locale.tax}.*2027$`) }), dialog.getByRole('button', { name: new RegExp(`^${locale.tax}.*2027$`), includeHidden: true }))).click()
    await expect(detail.getByText(locale.caveat)).toBeVisible()
    await expect(detail).not.toContainText(/investment-property sale requires|investmentPropertySale|BE-\d+/)
    await (await prepareProfessionalTarget(detail.getByRole('button', { name: locale.hide, exact: true }), detail.getByRole('button', { name: locale.hide, exact: true, includeHidden: true }))).click()
    await (await prepareProfessionalTarget(year)).selectOption('2028')
    await (await prepareProfessionalTarget(dialog.getByRole('button', { name: new RegExp(`^${locale.tax}.*2028$`) }), dialog.getByRole('button', { name: new RegExp(`^${locale.tax}.*2028$`), includeHidden: true }))).click()
    await expect(detail.getByText(locale.caveat)).toHaveCount(0)
  })
}

async function openSheet(page: Page, query = '', table = true) {
  await page.goto(`/tests/e2e/fixtures/annual-sheet-harness.html${query}`)
  const opener = page.getByRole('button', { name: 'Open fixture', includeHidden: true })
  await expect(opener).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 760))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(760)
  await showProfessionalResults(page)
  await (await prepareProfessionalTarget(opener)).focus()
  await page.keyboard.press('Enter')
  const dialog = page.locator('dialog.annual-sheet-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: /^(Close|Fermer|关闭)$/ })).toBeFocused()
  if (table) await showAnnualTable(page)
  return { dialog, opener }
}

function cell(dialog: Locator, rowName: string, year: number) {
  const column = year - 2030
  const label = dialog.page().getByRole('rowheader').getByText(rowName, { exact: true })
  return dialog.getByRole('row').filter({ has: label }).getByRole('cell').nth(column)
}

test('StrictMode dialog traps focus and restores scroll and opener after either close path', async ({ page }) => {
  const { dialog, opener } = await openSheet(page, '', false)
  const close = dialog.getByRole('button', { name: 'Close', exact: true })
  await expect(close).toBeFocused()
  await showAnnualTable(page)
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  // The focus cycle may pass through browser chrome, but never the page behind the modal.
  for (const key of ['Shift+Tab', 'Tab', 'Tab']) {
    await page.keyboard.press(key)
    expect(await page.evaluate(() => [document.body, ...document.querySelectorAll('dialog *')].includes(document.activeElement!))).toBe(true)
  }

  for (const method of ['escape', 'button']) {
    const inspect = dialog.getByRole('button', { name: 'Inspect row: Alex pension, 2030' })
    await (await prepareProfessionalTarget(inspect)).focus()
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('complementary', { name: 'Cell details' })).toBeFocused()
    if (await dialog.locator('.ui-sheet').isVisible()) {
      await page.keyboard.press('Escape')
      await expect(dialog.getByRole('complementary')).toHaveCount(0)
      await expect(inspect).toBeFocused()
    }
    if (method === 'escape') await page.keyboard.press('Escape')
    else await (await prepareProfessionalTarget(close)).click()
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(760)
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('')
    if (method === 'escape') {
      await page.keyboard.press('Enter')
      await expect(dialog).toBeVisible()
      await showAnnualTable(page)
      await expect(dialog.getByRole('complementary')).toHaveCount(0)
    }
  }
})

test('hiding pointer-opened details returns focus to the row without adding cell Tab stops', async ({ page }) => {
  const { dialog } = await openSheet(page)
  const pension = cell(dialog, 'Alex pension', 2030)
  const inspect = dialog.getByRole('button', { name: 'Inspect row: Alex pension, 2030' })
  await (await prepareProfessionalTarget(pension)).click()
  const details = dialog.getByRole('complementary', { name: 'Cell details' })
  await expect(details.getByRole('heading')).toContainText('Alex pension · 2030')
  await expect(details).toBeFocused()
  await (await prepareProfessionalTarget(details.getByRole('button', { name: 'Hide details' }), details.getByRole('button', { name: 'Hide details', includeHidden: true }))).click()
  await expect(details).toBeHidden()
  await expect(pension.or(inspect).and(dialog.locator(':focus'))).toHaveCount(1)

  // Programmatic focus on a cell is allowed, but cells and their contents stay out of the Tab order.
  const cellTabStops = await dialog.locator('td, td *').evaluateAll(nodes =>
    nodes.filter(node => (node as HTMLElement).tabIndex >= 0).length,
  )
  expect(cellTabStops).toBe(0)
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Inspect row: Sam pension, 2030' })).toBeFocused()
})

test('French last-year jump aligns the native headers in a single sticky scrollport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  const { dialog } = await openSheet(page, '?lang=fr')
  const table = dialog.getByRole('table')
  await expect(table.getByRole('columnheader')).toHaveText(['Poste', '2030', '2031', '2032', '2033'])
  await expect(table.getByRole('rowheader', { name: /Succession nette/ })).toHaveAttribute('scope', 'row')
  const port = dialog.getByRole('region', { name: 'Détails financiers annuels' })
  await expect(port).toHaveCount(1)
  await (await prepareProfessionalTarget(dialog.getByRole('button', { name: 'Dernière année (2033)' }), dialog.getByRole('button', { name: 'Dernière année (2033)', includeHidden: true }))).click()
  await expect(dialog.getByRole('combobox', { name: 'Aller à une année' })).toHaveValue('2033')
  await expect.poll(() => port.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
  const geometry = await port.evaluate(node => {
    const bounds = node.getBoundingClientRect()
    const sticky = node.querySelector('thead th')!.getBoundingClientRect()
    const last = node.querySelector('thead th:last-child')!.getBoundingClientRect()
    const rowHeader = node.querySelector('tbody th')!.getBoundingClientRect()
    return {
      scrollLeft: node.scrollLeft,
      stickyTopDelta: Math.abs(sticky.top - bounds.top),
      stickyLeftDelta: Math.abs(rowHeader.left - bounds.left),
      lastStartsAfterLabel: last.left >= sticky.right - 1,
      lastEndsInsidePort: last.right <= bounds.right + 1,
      documentWidth: document.documentElement.scrollWidth,
    }
  })
  expect(geometry.scrollLeft).toBeGreaterThan(0)
  expect(geometry.stickyTopDelta).toBeLessThanOrEqual(2)
  expect(geometry.stickyLeftDelta).toBeLessThanOrEqual(2)
  expect(geometry.lastStartsAfterLabel && geometry.lastEndsInsidePort).toBe(true)
  expect(geometry.documentWidth).toBe(320)

  const estateCell = cell(dialog, 'Succession nette', 2033)
  const headerRefs = await estateCell.evaluate((node: HTMLTableCellElement) => ({
    headers: node.headers.split(' ').map(id => document.getElementById(id)?.getAttribute('scope')),
    exposedAtCenter: document.elementFromPoint(
      node.getBoundingClientRect().left + node.clientWidth / 2,
      node.getBoundingClientRect().top + node.clientHeight / 2,
    )?.closest('td') === node,
  }))
  expect(headerRefs).toEqual({ headers: ['row', 'col'], exposedAtCenter: true })
  expect(await table.getByRole('cell').evaluateAll(nodes => nodes.every(node => (node as HTMLElement).tabIndex === -1))).toBe(true)
})

test('distinguishes computed zero and missing states and shows expense and event gaps independently', async ({ page }) => {
  const { dialog } = await openSheet(page)
  await expect(cell(dialog, 'Alex pension', 2030)).toHaveText('CA$0Calculated')
  await expect(cell(dialog, 'Payroll tax breakdown', 2031)).toContainText('Unknown')
  await expect(cell(dialog, 'Survivor income', 2033)).toContainText('Not computed')
  await expect(cell(dialog, 'Net estate', 2030)).toContainText('Not applicable')
  await expect(cell(dialog, 'Property appraisal', 2033)).toHaveText('≈ CA$200,000Estimated')
  await (await prepareProfessionalTarget(dialog.getByRole('button', { name: 'First living expense gap (2032)' }), dialog.getByRole('button', { name: 'First living expense gap (2032)', includeHidden: true }))).click()
  await expect(dialog.getByRole('status')).toContainText('2032 — Unpaid living costs')
  await expect(cell(dialog, 'Living expense gap', 2032)).toContainText('CA$3,940')
  await expect(cell(dialog, 'Event funding gap', 2032)).toContainText('Not applicable')
  await (await prepareProfessionalTarget(dialog.getByRole('button', { name: 'First event funding gap (2033)' }), dialog.getByRole('button', { name: 'First event funding gap (2033)', includeHidden: true }))).click()
  await expect(dialog.getByRole('status')).toContainText('2033 — Roof repair')
  await expect(cell(dialog, 'Living expense gap', 2033)).toContainText('CA$0')
  await (await prepareProfessionalTarget(cell(dialog, 'Event funding gap', 2033))).click()
  const details = dialog.getByRole('complementary')
  await expect(details.getByRole('heading')).toContainText('CA$1,340.00')
  await expect(details.getByText(/^Sources:/)).toContainText('Roof repair (Event)')
  await expect(details).not.toContainText('roof-repair')
  await expect(details).toContainText('Repair due CA$3,000.00 (Normalized nominal CAD)')
})

test('details retain cents, apply the real factor once, and preserve nominal tax basis', async ({ page }) => {
  const { dialog } = await openSheet(page, '?mode=real')
  await (await prepareProfessionalTarget(dialog.getByRole('button', { name: 'Alex TFSA', exact: true }), dialog.getByRole('button', { name: 'Alex TFSA', exact: true, includeHidden: true }))).click()
  await (await prepareProfessionalTarget(dialog.getByRole('combobox', { name: 'Jump to year' }), dialog.getByRole('combobox', { name: 'Jump to year', includeHidden: true }))).selectOption('2031')
  const inspect = dialog.getByRole('button', { name: 'Inspect row: Alex TFSA Closing, 2031' })
  await (await prepareProfessionalTarget(inspect)).focus()
  await page.keyboard.press('Enter')
  const details = dialog.getByRole('complementary')
  await expect(details.getByRole('heading')).toContainText('CA$7,255.39')
  await expect(details.getByText('CA$7,400.50', { exact: true })).toBeVisible()
  await (await prepareProfessionalTarget(details.getByRole('button', { name: 'Hide details' }), details.getByRole('button', { name: 'Hide details', includeHidden: true }))).click()
  await expect(inspect).toBeFocused()
  await (await prepareProfessionalTarget(cell(dialog, 'Property tax basis', 2033))).click()
  await expect(details.getByRole('heading')).toContainText('CA$150,250.50')
  await expect(details).toContainText('Nominal tax basis (not inflation-adjusted)')
  await expect(details).toContainText('Adjusted cost CA$150,250.50 (Nominal tax basis (not inflation-adjusted))')
})

test('a short 320px viewport keeps Close and the table reachable with many jumps and details open', async ({ page }) => {
  // An effective CSS viewport of 320×360 also covers the layout pressure from browser zoom.
  await page.setViewportSize({ width: 320, height: 360 })
  const { dialog } = await openSheet(page, '?wrapped-jumps')
  const details = dialog.getByRole('complementary')
  await (await prepareProfessionalTarget(dialog.getByRole('button', { name: 'Inspect row: Alex pension, 2030' }), dialog.getByRole('button', { name: 'Inspect row: Alex pension, 2030', includeHidden: true }))).focus()
  await page.keyboard.press('Enter')
  await expect(details).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(details).toBeHidden()
  const close = dialog.getByRole('button', { name: 'Close', exact: true })
  const port = dialog.getByRole('region', { name: 'Annual financial details' })
  await expect(close).toBeInViewport({ ratio: 1 })
  await expect(port).toBeInViewport({ ratio: 1 })
  expect(await dialog.evaluate(node => ({
    horizontalOverflow: node.scrollWidth - node.clientWidth,
    verticalOverflow: node.scrollHeight - node.clientHeight,
  }))).toEqual({ horizontalOverflow: 0, verticalOverflow: 0 })
  const portBounds = (await (await prepareProfessionalTarget(port)).boundingBox())!
  const headerBounds = (await (await prepareProfessionalTarget(dialog.getByRole('columnheader', { name: '2030', exact: true }), dialog.getByRole('columnheader', { name: '2030', exact: true, includeHidden: true }))).boundingBox())!
  expect(portBounds.height, 'the scrollport must expose data below the sticky header').toBeGreaterThan(headerBounds.height + 16)
  await (await prepareProfessionalTarget(port)).focus()
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => port.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => port.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
  await expect(port).toBeFocused()
  const corner = dialog.getByRole('columnheader').first()
  await expect.poll(async () => {
    const [header, bounds] = await Promise.all([corner.boundingBox(), port.boundingBox()])
    return header && bounds ? Math.abs(header.y - bounds.y) + Math.abs(header.x - bounds.x) : Infinity
  }).toBeLessThanOrEqual(3)
  await (await prepareProfessionalTarget(dialog.getByRole('button', { name: 'Household milestone 18 (2031)' }), dialog.getByRole('button', { name: 'Household milestone 18 (2031)', includeHidden: true }))).click()
  await expect(dialog.getByRole('combobox', { name: 'Jump to year' })).toHaveValue('2031')
  await dialog.getByRole('button', { name: 'Inspect row: Alex pension, 2031' }).click()
  await expect(details).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(details).toBeHidden()
  await expect(close).toBeInViewport({ ratio: 1 })
  await (await prepareProfessionalTarget(close)).click()
  await expect(dialog).toBeHidden()
})

test('details preserve unit labels and suppress stale raw values from unavailable cells', async ({ page }) => {
  const { dialog } = await openSheet(page, '?mode=real')
  const details = dialog.getByRole('complementary')
  await (await prepareProfessionalTarget(cell(dialog, 'Alex age', 2031))).click()
  await expect(details.getByRole('heading')).toHaveText('Alex age · 2031: 65')
  await expect(details).toContainText('Previous age 64')
  await expect(details).not.toContainText(/CAD|CA\$|annual real factor/)
  await (await prepareProfessionalTarget(details.getByRole('button', { name: 'Hide details' }), details.getByRole('button', { name: 'Hide details', includeHidden: true }))).click()

  await (await prepareProfessionalTarget(cell(dialog, 'Payroll tax breakdown', 2031))).click()
  await expect(details.getByRole('heading')).toHaveText('Payroll tax breakdown · 2031: Unknown')
  await expect(details).toContainText('Only aggregate cash tax was supplied')
  await expect(details).not.toContainText(/999,999\.99|annual real factor/)
})

test('an invalid conversion factor leaves raw CAD available and the converted value unknown', async ({ page }) => {
  const { dialog } = await openSheet(page, '?mode=real&bad-factor')
  await (await prepareProfessionalTarget(cell(dialog, 'Alex pension', 2031))).click()
  const details = dialog.getByRole('complementary')
  await expect(details.getByRole('heading')).toHaveText('Alex pension · 2031: Unknown')
  await expect(details).toContainText('CA$8,000.00')
  await expect(details).not.toContainText(/NaN|Infinity/)
})

test('Chinese copy labels the viewer, keyboard inspection, status, and close controls', async ({ page }) => {
  const { dialog, opener } = await openSheet(page, '?lang=zh')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans')
  await expect(dialog).toHaveAccessibleName('家庭账本')
  await expect(dialog).toHaveAccessibleDescription(/确定性投影.*名义加元/)
  await (await prepareProfessionalTarget(dialog.getByRole('combobox', { name: '跳转年份' }), dialog.getByRole('combobox', { name: '跳转年份', includeHidden: true }))).selectOption('2033')
  await (await prepareProfessionalTarget(dialog.getByRole('button', { name: '查看行详情: 净遗产, 2033' }), dialog.getByRole('button', { name: '查看行详情: 净遗产, 2033', includeHidden: true }))).focus()
  await page.keyboard.press('Enter')
  const details = dialog.getByRole('complementary', { name: '单元格详情' })
  await expect(details.getByRole('heading')).toContainText('净遗产 · 2033')
  await expect(details).toContainText('已计算')
  await expect(details.getByRole('button', { name: '收起详情' })).toBeVisible()
  if (await dialog.locator('.ui-sheet').isVisible()) await details.getByRole('button', { name: '收起详情' }).click()
  await (await prepareProfessionalTarget(dialog.getByRole('button', { name: '关闭', exact: true }), dialog.getByRole('button', { name: '关闭', exact: true, includeHidden: true }))).click()
  await expect(opener).toBeFocused()
})

test('a new revision resets dialog state and cleanup tolerates a removed opener', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', error => pageErrors.push(error))
  const { dialog, opener } = await openSheet(page)
  const year = dialog.getByRole('combobox', { name: 'Jump to year' })
  await (await prepareProfessionalTarget(year)).selectOption('2033')
  await (await prepareProfessionalTarget(dialog.getByRole('button', { name: 'Alex TFSA', exact: true }), dialog.getByRole('button', { name: 'Alex TFSA', exact: true, includeHidden: true }))).click()
  await (await prepareProfessionalTarget(dialog.getByRole('button', { name: 'Inspect row: Alex TFSA Closing, 2033' }), dialog.getByRole('button', { name: 'Inspect row: Alex TFSA Closing, 2033', includeHidden: true }))).click()
  await expect(dialog.getByRole('complementary')).toBeFocused()
  await page.evaluate(() => window.dispatchEvent(new Event('fixture:revise')))
  await expect(dialog.getByRole('complementary')).toHaveCount(0)
  await expect(year).toHaveValue('2030')
  const close = dialog.getByRole('button', { name: 'Close', exact: true })
  await expect(close).toBeFocused()
  await showAnnualTable(page)
  await expect(dialog.getByRole('button', { name: 'Alex TFSA', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  await (await prepareProfessionalTarget(close)).click()
  await expect(opener).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(close).toBeFocused()
  await page.evaluate(() => window.dispatchEvent(new Event('fixture:remove-opener')))
  await expect(opener).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(760)
  const backgroundControl = page.getByRole('button', { name: 'Background control' })
  await (await prepareProfessionalTarget(backgroundControl)).focus()
  await expect(backgroundControl).toBeFocused()
  expect(pageErrors).toEqual([])
})

for (const yearCount of [76, 88]) {
  test(`measures a ${yearCount}×120 sheet and reaches its final cell`, async ({ page }, testInfo) => {
    const { dialog } = await openSheet(page, `?pressure=${yearCount}`)
    const terminalYear = 2029 + yearCount
    const table = dialog.getByRole('table')
    const port = dialog.getByRole('region', { name: 'Annual financial details' })
    await expect(table.getByRole('columnheader')).toHaveCount(yearCount + 1)
    await expect(table.getByRole('rowheader')).toHaveCount(120)
    await expect.poll(() => page.evaluate(() => performance.getEntriesByName('sheet-open-to-painted-frame').length)).toBe(1)
    const openMs = await page.evaluate(() => performance.getEntriesByName('sheet-open-to-painted-frame')[0].duration)
    const jumpMs = await dialog.getByRole('button', { name: `Pressure terminal year (${terminalYear})` }).evaluate(button => {
      const start = performance.now()
      const jump = button as HTMLButtonElement
      jump.click()
      return new Promise<number>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start))))
    })
    await expect.poll(() => port.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
    await expect.poll(() => port.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
    const last = cell(dialog, 'Pressure row 120', terminalYear)
    await expect(last).toBeInViewport({ ratio: 0.9 })
    await (await prepareProfessionalTarget(last)).click()
    await expect(dialog.getByRole('complementary').getByRole('heading')).toHaveText(`Pressure row 120 · ${terminalYear}: CA$12,000.${yearCount - 1}`)
    const summary = `${testInfo.project.name} ${yearCount}×120 open ${openMs.toFixed(1)} ms and terminal jump ${jumpMs.toFixed(1)} ms (through two animation frames)`
    console.log(summary)
    await testInfo.attach('pressure timing', { body: summary, contentType: 'text/plain' })
  })
}

for (const locale of [
  { lang: 'en', width: 390, year: 'Year', table: 'Table', next: 'Next year', previous: 'Previous year', details: 'Cell details', close: 'Close' },
  { lang: 'fr', width: 320, year: 'Année', table: 'Tableau', next: 'Année suivante', previous: 'Année précédente', details: 'Détails de la cellule', close: 'Fermer' },
  { lang: 'zh', width: 390, year: '按年', table: '表格', next: '下一年', previous: '上一年', details: '单元格详情', close: '关闭' },
]) {
  test(`phone Year and detail Sheet retain ledger data and focus in ${locale.lang}`, async ({ page }) => {
    await page.setViewportSize({ width: locale.width, height: 844 })
    await page.goto(`/tests/e2e/fixtures/annual-sheet-harness.html?lang=${locale.lang}&mode=real`)
    const opener = page.getByRole('button', { name: 'Open fixture' })
    await opener.click()
    const dialog = page.locator('dialog.annual-sheet-dialog')
    await expect(dialog.getByRole('button', { name: locale.year, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.getByRole('table')).toBeHidden()
    await expect(dialog.getByRole('button', { name: locale.previous, exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: locale.next, exact: true }).click()
    const row = dialog.locator('.annual-year-row').filter({ hasText: 'Alex pension' })
    await expect(row).toHaveAccessibleName(/2031$/)
    await row.click()
    const sheet = dialog.getByRole('dialog', { name: locale.details, exact: true })
    const detail = sheet.getByRole('complementary', { name: locale.details })
    await expect(detail).toBeFocused()
    await expect(detail.getByRole('heading')).toContainText('Alex pension · 2031')
    await expect(sheet).toHaveAttribute('aria-modal', 'true')
    for (let index = 0; index < 5; index++) {
      await page.keyboard.press('Tab')
      expect(await sheet.evaluate(node => node.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect(dialog).toBeVisible()
    await expect(row).toBeFocused()
    const rowCount = await dialog.locator('.annual-year-row').count()
    await dialog.getByRole('button', { name: locale.table, exact: true }).click()
    await expect(dialog.getByRole('table')).toBeVisible()
    await expect(dialog.locator('.annual-sheet-inspect')).toHaveCount(rowCount)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(locale.width)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })
}

test('glossary phone Sheet keeps term history, focus trapping and restoration', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const trigger = page.getByTestId('app-menu')
  await trigger.click()
  await page.getByRole('button', { name: 'Open glossary', exact: true }).click()
  const drawer = page.locator('.drawer')
  await expect(drawer).toHaveAttribute('aria-modal', 'true')
  const geometry = await drawer.boundingBox()
  expect(geometry!.width).toBe(390)
  expect(geometry!.height).toBeCloseTo(844 * .85, 0)
  await page.evaluate(async () => { const { useGlossary } = await import('/src/glossary.ts'); useGlossary.getState().open('rrsp') })
  const back = drawer.locator('.drawer-back')
  await expect(back).toBeVisible()
  await back.click()
  await expect(drawer.getByRole('heading')).toContainText('FIRE')
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('Tab')
    expect(await drawer.evaluate(node => node.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('desktop details reserve 340px without reducing table height and use the shared header surface', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { dialog } = await openSheet(page)
  const column = dialog.locator('.annual-sheet-detail-column')
  expect((await column.boundingBox())!.width).toBe(340)
  const port = dialog.locator('.annual-sheet-scroll')
  const before = (await port.boundingBox())!
  const header = dialog.getByRole('columnheader').first()
  expect(await header.evaluate(node => ({ background: getComputedStyle(node).backgroundColor, token: getComputedStyle(document.documentElement).getPropertyValue('--surface-2').trim() }))).toEqual({ background: 'rgb(233, 237, 242)', token: '#e9edf2' })
  const firstColumn = dialog.getByRole('rowheader').first()
  expect((await firstColumn.boundingBox())!.width).toBe(210)
  await dialog.getByRole('button', { name: 'Inspect row: Alex pension, 2030' }).click()
  await expect(column.getByRole('complementary', { name: 'Cell details' })).toBeFocused()
  expect((await port.boundingBox())!.height).toBe(before.height)
  await expect(dialog.locator('.annual-sheet-selected')).toHaveCount(1)
  await column.getByRole('button', { name: 'Hide details' }).click()
  expect((await column.boundingBox())!.width).toBe(340)
  expect((await port.boundingBox())!.height).toBe(before.height)
})

for (const locale of [
  { language: 'EN', width: 390, scope: 'Scope and limitations', opener: 'Annual financial details', retirement: 'Retirement (2036)', next: 'Next year' },
  { language: 'FR', width: 320, scope: 'Portée et limites', opener: 'Détails financiers annuels', retirement: 'Retraite (2036)', next: 'Année suivante' },
  { language: '中文', width: 390, scope: '口径与限制', opener: '逐年财务明细', retirement: '退休 (2036)', next: '下一年' },
]) {
  test(`review fixes expose scope, wrap jumps and align the selected year in ${locale.language}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: locale.width, height: locale.width === 320 ? 740 : 844 })
    await page.goto('/')
    await chooseMode(page, 'professional')
    await chooseLanguage(page, locale.language)
    await showProfessionalResults(page)
    const opener = page.getByRole('button', { name: locale.opener, exact: true })
    await (await prepareProfessionalTarget(opener)).click()
    const dialog = page.locator('dialog.annual-sheet-dialog')
    await expect(dialog.locator('.annual-sheet-header > button')).toBeFocused()
    const scope = dialog.locator('.annual-sheet-scope')
    const description = await dialog.evaluate(node => document.getElementById(node.getAttribute('aria-describedby')!)!.textContent!)
    await expect(dialog).toHaveAccessibleDescription(description)
    await expect(scope.locator('summary')).toContainText(locale.scope)
    await expect(scope.locator('.annual-scope-chevron')).toBeVisible()
    await scope.locator('summary').click()
    await expect(scope).toHaveAttribute('open', '')
    await expect(dialog).toHaveAccessibleDescription(description)
    await scope.locator('summary').click()
    const controls = dialog.locator('.annual-sheet-controls')
    expect(await controls.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    for (const jump of await controls.getByRole('button').all()) await expect(jump).toBeInViewport({ ratio: 1 })
    const touch = await dialog.locator('button, select, summary').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => {
      const rect = node.getBoundingClientRect()
      return { name: node.getAttribute('aria-label') ?? node.textContent, width: rect.width, height: rect.height }
    }))
    expect(touch.filter(target => target.width < 44 || target.height < 44)).toEqual([])
    const row = dialog.locator('.annual-year-row').first()
    await row.focus()
    await expect(row).toHaveAccessibleDescription(/35\s*(Calculated|Calculé|已计算)/)
    await controls.getByRole('button', { name: locale.retirement, exact: true }).click()
    const table = dialog.locator('.annual-sheet-view button').last()
    const year = dialog.locator('.annual-sheet-view button').first()
    const port = dialog.locator('.annual-sheet-scroll')
    const aligned = async (selected: string) => {
      const geometry = await port.evaluate((node, selected) => {
        const bounds = node.getBoundingClientRect()
        const sticky = node.querySelector('thead th')!.getBoundingClientRect()
        const header = [...node.querySelectorAll('thead th')].find(header => header.textContent === selected)!.getBoundingClientRect()
        return { left: header.left, right: header.right, stickyRight: sticky.right, portRight: bounds.right, scrollLeft: node.scrollLeft }
      }, selected)
      expect(geometry.scrollLeft).toBeGreaterThan(0)
      expect(geometry.left).toBeGreaterThanOrEqual(geometry.stickyRight - 1)
      expect(geometry.right).toBeLessThanOrEqual(geometry.portRight + 1)
      await expect(table).toBeFocused()
      return geometry
    }
    await table.click()
    const retirement = await aligned('2036')
    await year.click()
    await dialog.getByRole('button', { name: locale.next, exact: true }).click()
    await table.click()
    const stepped = await aligned('2037')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(locale.width)
    await testInfo.attach('review geometry', { body: JSON.stringify({ locale, touch, retirement, stepped }), contentType: 'application/json' })
  })
}

test('320px Table inspect and group controls meet both touch dimensions and focused Year exposes zero', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  const { dialog } = await openSheet(page, '', false)
  const row = dialog.getByRole('button', { name: 'Inspect row: Alex pension, 2030' })
  await row.focus()
  await expect(row).toHaveAccessibleName('Inspect row: Alex pension, 2030')
  await expect(row).toHaveAccessibleDescription(/CA\$0\s*Calculated/)
  await showAnnualTable(page)
  const controls = dialog.locator('th button')
  expect(await controls.count()).toBeGreaterThan(10)
  const sizes = await controls.evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })))
  expect(sizes.filter(size => size.width < 44 || size.height < 44)).toEqual([])
})

for (const width of [1440, 390]) {
  test(`inspecting a fully visible later column preserves Table scroll at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const { dialog } = await openSheet(page, '?pressure=76')
    const port = dialog.locator('.annual-sheet-scroll')
    const year = width === 1440 ? 2033 : 2031
    const target = cell(dialog, 'Pressure row 1', year)
    await expect(target).toBeInViewport({ ratio: 1 })
    const geometry = await target.evaluate(node => {
      const bounds = node.getBoundingClientRect()
      const label = node.parentElement!.querySelector('th')!.getBoundingClientRect()
      return { left: bounds.left, right: bounds.right, stickyRight: label.right }
    })
    expect(geometry.left).toBeGreaterThanOrEqual(geometry.stickyRight)
    const before = await port.evaluate(node => node.scrollLeft)
    expect(before).toBe(0)
    await target.click()
    const details = dialog.getByRole('complementary', { name: 'Cell details' })
    await expect(details).toBeFocused()
    await expect(details.getByRole('heading')).toContainText(`Pressure row 1 · ${year}`)
    const opened = await port.evaluate(node => node.scrollLeft)
    expect(opened).toBe(before)
    await details.getByRole('button', { name: 'Hide details', exact: true }).click()
    await expect(details).toBeHidden()
    await expect(dialog.getByRole('button', { name: `Inspect row: Pressure row 1, ${year}`, exact: true })).toBeFocused()
    const closed = await port.evaluate(node => node.scrollLeft)
    expect(closed).toBe(before)
    await expect(target).toBeInViewport({ ratio: 1 })
    // Direct jumps while Table is visible retain their independent alignment.
    await dialog.getByRole('combobox', { name: 'Jump to year' }).selectOption('2040')
    const jumped = await port.evaluate(node => node.scrollLeft)
    expect(jumped).toBeGreaterThan(before)
    await expect(dialog.getByRole('columnheader', { name: '2040', exact: true })).toBeInViewport({ ratio: 1 })
    const later = cell(dialog, 'Pressure row 1', 2041)
    await expect(later).toBeInViewport({ ratio: 1 })
    await later.click()
    await expect(details).toBeFocused()
    await expect(details.getByRole('heading')).toContainText('Pressure row 1 · 2041')
    expect(await port.evaluate(node => node.scrollLeft)).toBe(jumped)
    await details.getByRole('button', { name: 'Hide details', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Inspect row: Pressure row 1, 2041', exact: true })).toBeFocused()
    expect(await port.evaluate(node => node.scrollLeft)).toBe(jumped)
    await testInfo.attach('inspection scroll', { body: JSON.stringify({ width, year, before, opened, closed, jumped }), contentType: 'application/json' })
  })
}

test('repeated tab and responsive Table reveals align the year at the CSS phone breakpoint', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { dialog } = await openSheet(page, '?pressure=76', false)
  const port = dialog.locator('.annual-sheet-scroll')
  const picker = dialog.getByRole('combobox', { name: 'Jump to year' })
  const close = dialog.getByRole('button', { name: 'Close', exact: true })
  const measurements = []
  const aligned = async (year: string) => {
    const position = await port.evaluate((node, year) => {
      const sticky = node.querySelector('thead th')!.getBoundingClientRect()
      const selected = [...node.querySelectorAll('thead th')].find(header => header.textContent === year)!.getBoundingClientRect()
      return { scrollLeft: node.scrollLeft, labelRight: sticky.right, selectedLeft: selected.left }
    }, year)
    expect(position.scrollLeft).toBeGreaterThan(0)
    expect(Math.abs(position.selectedLeft - position.labelRight)).toBeLessThanOrEqual(1)
    return position
  }
  for (const [width, year] of [[844, '2036'], [1440, '2037'], [641, '2038']] as const) {
    await expect(dialog.locator('.annual-year-list')).toBeVisible()
    await expect(port).toBeHidden()
    await picker.selectOption(year)
    await close.focus()
    await page.setViewportSize({ width, height: width === 844 ? 390 : 900 })
    await expect(port).toBeVisible()
    await expect(dialog.locator('.annual-sheet-layout')).toHaveAttribute('data-view', 'table')
    await expect(dialog.locator('.annual-sheet-view')).toBeHidden()
    await expect(picker).toHaveValue(year)
    measurements.push({ width, year, ...await aligned(year) })
    await expect(close).toBeFocused()
    await page.setViewportSize({ width: 640, height: 844 })
    await expect(port).toBeHidden()
    await expect(dialog.locator('.annual-year-list')).toBeVisible()
    await expect(dialog.locator('.annual-sheet-view')).toBeVisible()
  }
  // The ordinary tab uses the same hidden-to-visible transition.
  await picker.selectOption('2039')
  const table = dialog.getByRole('button', { name: 'Table', exact: true })
  await table.click()
  await expect(port).toBeVisible()
  measurements.push({ width: 640, year: '2039', ...await aligned('2039') })
  await expect(table).toBeFocused()
  // Crossing the breakpoint while Table remains visible must not realign it.
  await port.evaluate(node => { node.scrollLeft = 275 })
  await close.focus()
  for (const width of [641, 844, 640, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(port).toBeVisible()
    await expect.poll(() => port.evaluate(node => node.scrollLeft)).toBe(275)
    await expect(close).toBeFocused()
  }
  await testInfo.attach('responsive reveal alignment', { body: JSON.stringify(measurements), contentType: 'application/json' })
})

for (const safeArea of [
  { width: 844, height: 390, left: 0, right: 0, bottom: 0 },
  { width: 844, height: 390, left: 47, right: 47, bottom: 21 },
  { width: 390, height: 844, left: 0, right: 0, bottom: 0 },
  { width: 390, height: 844, left: 0, right: 0, bottom: 34 },
]) {
  test(`annual safe area ${safeArea.width}x${safeArea.height} sides ${safeArea.left} bottom ${safeArea.bottom}`, async ({ page }, testInfo) => {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: safeArea.left, right: safeArea.right, bottom: safeArea.bottom } })
    await page.setViewportSize({ width: 390, height: 844 })
    const { dialog, opener } = await openSheet(page, '?pressure=76', false)
    const picker = dialog.getByRole('combobox', { name: 'Jump to year' })
    await picker.selectOption('2036')
    const close = dialog.getByRole('button', { name: 'Close', exact: true })
    await close.focus()
    await page.setViewportSize({ width: safeArea.width, height: safeArea.height })
    if (safeArea.width <= 640) await showAnnualTable(page)
    else await expect(close).toBeFocused()
    const port = dialog.locator('.annual-sheet-scroll')
    await expect(port).toBeVisible()
    const geometry = await dialog.evaluate(node => {
      const bounds = (selector: string) => node.querySelector(selector)!.getBoundingClientRect().toJSON()
      const style = getComputedStyle(node.querySelector('.annual-sheet-layout')!)
      return {
        padding: { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight), bottom: parseFloat(style.paddingBottom) },
        title: bounds('.annual-sheet-title h2'), close: bounds('.annual-sheet-header > button'),
        item: bounds('thead th:first-child'), table: bounds('.annual-sheet-scroll'),
        body: bounds('.annual-sheet-body'), overflow: { x: node.scrollWidth - node.clientWidth, y: node.scrollHeight - node.clientHeight },
      }
    })
    expect(geometry.padding).toEqual({ left: safeArea.left, right: safeArea.right, bottom: safeArea.bottom })
    for (const bounds of [geometry.title, geometry.close, geometry.item, geometry.table, geometry.body]) {
      expect(bounds.left).toBeGreaterThanOrEqual(safeArea.left)
      expect(bounds.right).toBeLessThanOrEqual(safeArea.width - safeArea.right)
      expect(bounds.bottom).toBeLessThanOrEqual(safeArea.height - safeArea.bottom)
    }
    expect(geometry.overflow).toEqual({ x: 0, y: 0 })
    await expect(close).toBeInViewport({ ratio: 1 })
    await expect(port).toBeInViewport({ ratio: 1 })
    await expect(dialog.getByRole('columnheader', { name: '2036', exact: true })).toBeInViewport({ ratio: 1 })
    const before = await port.evaluate(node => ({ left: node.scrollLeft, height: node.clientHeight }))
    const target = cell(dialog, 'Pressure row 1', 2036)
    await expect(target).toBeInViewport({ ratio: 1 })
    await target.click()
    const detail = dialog.getByRole('complementary', { name: 'Cell details' })
    await expect(detail).toBeFocused()
    if (safeArea.width <= 640) {
      await expect(dialog.locator('.ui-sheet')).toBeVisible()
      const bodyBottom = await dialog.locator('.ui-sheet-body').evaluate(node => node.getBoundingClientRect().bottom)
      expect(bodyBottom).toBeLessThanOrEqual(safeArea.height - safeArea.bottom)
      await page.keyboard.press('Escape')
    } else await detail.getByRole('button', { name: 'Hide details', exact: true }).click()
    await expect(detail).toBeHidden()
    await expect(dialog.getByRole('button', { name: 'Inspect row: Pressure row 1, 2036', exact: true })).toBeFocused()
    expect(await port.evaluate(node => ({ left: node.scrollLeft, height: node.clientHeight }))).toEqual(before)
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')
    await page.screenshot({ path: testInfo.outputPath('safe-area.png'), animations: 'disabled' })
    await testInfo.attach('safe-area geometry', { body: JSON.stringify({ safeArea, geometry, node: process.version, browser: page.context().browser()!.version(), executablePath }), contentType: 'application/json' })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('')
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(760)
  })
}
