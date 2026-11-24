import { existsSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'

// Run locally with: npm run test:e2e -- tests/e2e/annual-sheet-thorium.spec.ts
const executablePath = '/Applications/Thorium.app/Contents/MacOS/Thorium'
test.use({ browserName: 'chromium', launchOptions: { executablePath } })
test.skip(!existsSync(executablePath), 'This suite requires /Applications/Thorium.app')

async function openSheet(page: Page, query = '') {
  await page.goto(`/tests/e2e/fixtures/annual-sheet-harness.html${query}`)
  const opener = page.getByRole('button', { name: 'Open fixture', includeHidden: true })
  await expect(opener).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 760))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(760)
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return { dialog, opener }
}

function cell(dialog: Locator, rowName: string, year: number) {
  const column = year - 2030
  const label = dialog.page().getByRole('rowheader').getByText(rowName, { exact: true })
  return dialog.getByRole('row').filter({ has: label }).getByRole('cell').nth(column)
}

test('StrictMode dialog traps focus and restores scroll and opener after either close path', async ({ page }) => {
  const { dialog, opener } = await openSheet(page)
  const close = dialog.getByRole('button', { name: 'Close', exact: true })
  await expect(close).toBeFocused()
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  // The focus cycle may pass through browser chrome, but never the page behind the modal.
  for (const key of ['Shift+Tab', 'Tab', 'Tab']) {
    await page.keyboard.press(key)
    expect(await page.evaluate(() => [document.body, ...document.querySelectorAll('dialog *')].includes(document.activeElement!))).toBe(true)
  }

  for (const method of ['escape', 'button']) {
    const inspect = dialog.getByRole('button', { name: 'Inspect row: Alex pension, 2030' })
    await inspect.focus()
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('complementary', { name: 'Cell details' })).toBeFocused()
    if (method === 'escape') await page.keyboard.press('Escape')
    else await close.click()
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(760)
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('')
    if (method === 'escape') {
      await page.keyboard.press('Enter')
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('complementary')).toHaveCount(0)
    }
  }
})

test('hiding pointer-opened details returns focus to the row without adding cell Tab stops', async ({ page }) => {
  const { dialog } = await openSheet(page)
  const pension = cell(dialog, 'Alex pension', 2030)
  const inspect = dialog.getByRole('button', { name: 'Inspect row: Alex pension, 2030' })
  await pension.click()
  const details = dialog.getByRole('complementary', { name: 'Cell details' })
  await expect(details.getByRole('heading')).toContainText('Alex pension · 2030')
  await expect(details).toBeFocused()
  await details.getByRole('button', { name: 'Hide details' }).click()
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
  await dialog.getByRole('button', { name: 'Dernière année (2033)' }).click()
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
  await dialog.getByRole('button', { name: 'First living expense gap (2032)' }).click()
  await expect(dialog.getByRole('status')).toContainText('2032 — Unpaid living costs')
  await expect(cell(dialog, 'Living expense gap', 2032)).toContainText('CA$3,940')
  await expect(cell(dialog, 'Event funding gap', 2032)).toContainText('Not applicable')
  await dialog.getByRole('button', { name: 'First event funding gap (2033)' }).click()
  await expect(dialog.getByRole('status')).toContainText('2033 — Roof repair')
  await expect(cell(dialog, 'Living expense gap', 2033)).toContainText('CA$0')
  await cell(dialog, 'Event funding gap', 2033).click()
  const details = dialog.getByRole('complementary')
  await expect(details.getByRole('heading')).toContainText('CA$1,340.00')
  await expect(details).toContainText('roof-repair')
  await expect(details).toContainText('Repair due CA$3,000.00 (Normalized nominal CAD)')
})

test('details retain cents, apply the real factor once, and preserve nominal tax basis', async ({ page }) => {
  const { dialog } = await openSheet(page, '?mode=real')
  await dialog.getByRole('button', { name: 'Alex TFSA', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Jump to year' }).selectOption('2031')
  const inspect = dialog.getByRole('button', { name: 'Inspect row: Alex TFSA Closing, 2031' })
  await inspect.focus()
  await page.keyboard.press('Enter')
  const details = dialog.getByRole('complementary')
  await expect(details.getByRole('heading')).toContainText('CA$7,255.39')
  await expect(details.getByText('CA$7,400.50', { exact: true })).toBeVisible()
  await details.getByRole('button', { name: 'Hide details' }).click()
  await expect(inspect).toBeFocused()
  await cell(dialog, 'Property tax basis', 2033).click()
  await expect(details.getByRole('heading')).toContainText('CA$150,250.50')
  await expect(details).toContainText('Nominal tax basis (not inflation-adjusted)')
  await expect(details).toContainText('Adjusted cost CA$150,250.50 (Nominal tax basis (not inflation-adjusted))')
})

test('a short 320px viewport keeps Close and the table reachable with many jumps and details open', async ({ page }) => {
  // An effective CSS viewport of 320×360 also covers the layout pressure from browser zoom.
  await page.setViewportSize({ width: 320, height: 360 })
  const { dialog } = await openSheet(page, '?wrapped-jumps')
  const details = dialog.getByRole('complementary')
  await dialog.getByRole('button', { name: 'Inspect row: Alex pension, 2030' }).focus()
  await page.keyboard.press('Enter')
  await expect(details).toBeFocused()
  const close = dialog.getByRole('button', { name: 'Close', exact: true })
  const port = dialog.getByRole('region', { name: 'Annual financial details' })
  await expect(close).toBeInViewport({ ratio: 1 })
  await expect(port).toBeInViewport({ ratio: 1 })
  expect(await dialog.evaluate(node => ({
    horizontalOverflow: node.scrollWidth - node.clientWidth,
    verticalOverflow: node.scrollHeight - node.clientHeight,
  }))).toEqual({ horizontalOverflow: 0, verticalOverflow: 0 })
  const portBounds = (await port.boundingBox())!
  const headerBounds = (await dialog.getByRole('columnheader', { name: '2030', exact: true }).boundingBox())!
  expect(portBounds.height, 'the scrollport must expose data below the sticky header').toBeGreaterThan(headerBounds.height + 16)
  await port.focus()
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => port.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => port.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
  await dialog.getByRole('button', { name: 'Household milestone 18 (2031)' }).click()
  await expect(dialog.getByRole('combobox', { name: 'Jump to year' })).toHaveValue('2031')
  await expect(details).toBeVisible()
  await expect(close).toBeInViewport({ ratio: 1 })
  await close.click()
  await expect(dialog).toBeHidden()
})

test('details preserve unit labels and suppress stale raw values from unavailable cells', async ({ page }) => {
  const { dialog } = await openSheet(page, '?mode=real')
  const details = dialog.getByRole('complementary')
  await cell(dialog, 'Alex age', 2031).click()
  await expect(details.getByRole('heading')).toHaveText('Alex age · 2031: 65')
  await expect(details).toContainText('Previous age 64')
  await expect(details).not.toContainText(/CAD|CA\$|annual real factor/)
  await details.getByRole('button', { name: 'Hide details' }).click()

  await cell(dialog, 'Payroll tax breakdown', 2031).click()
  await expect(details.getByRole('heading')).toHaveText('Payroll tax breakdown · 2031: Unknown')
  await expect(details).toContainText('Only aggregate cash tax was supplied')
  await expect(details).not.toContainText(/999,999\.99|annual real factor/)
})

test('an invalid conversion factor leaves raw CAD available and the converted value unknown', async ({ page }) => {
  const { dialog } = await openSheet(page, '?mode=real&bad-factor')
  await cell(dialog, 'Alex pension', 2031).click()
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
  await dialog.getByRole('combobox', { name: '跳转年份' }).selectOption('2033')
  await dialog.getByRole('button', { name: '查看行详情: 净遗产, 2033' }).focus()
  await page.keyboard.press('Enter')
  const details = dialog.getByRole('complementary', { name: '单元格详情' })
  await expect(details.getByRole('heading')).toContainText('净遗产 · 2033')
  await expect(details).toContainText('已计算')
  await expect(details.getByRole('button', { name: '收起详情' })).toBeVisible()
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(opener).toBeFocused()
})

test('a new revision resets dialog state and cleanup tolerates a removed opener', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', error => pageErrors.push(error))
  const { dialog, opener } = await openSheet(page)
  const year = dialog.getByRole('combobox', { name: 'Jump to year' })
  await year.selectOption('2033')
  await dialog.getByRole('button', { name: 'Alex TFSA', exact: true }).click()
  await dialog.getByRole('button', { name: 'Inspect row: Alex TFSA Closing, 2033' }).click()
  await expect(dialog.getByRole('complementary')).toBeFocused()
  await page.evaluate(() => window.dispatchEvent(new Event('fixture:revise')))
  await expect(dialog.getByRole('complementary')).toHaveCount(0)
  await expect(year).toHaveValue('2030')
  await expect(dialog.getByRole('button', { name: 'Alex TFSA', exact: true })).toHaveAttribute('aria-expanded', 'false')
  const close = dialog.getByRole('button', { name: 'Close', exact: true })
  await expect(close).toBeFocused()
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  await close.click()
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
  await backgroundControl.focus()
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
    await last.click()
    await expect(dialog.getByRole('complementary').getByRole('heading')).toHaveText(`Pressure row 120 · ${terminalYear}: CA$12,000.${yearCount - 1}`)
    const summary = `${testInfo.project.name} ${yearCount}×120 open ${openMs.toFixed(1)} ms and terminal jump ${jumpMs.toFixed(1)} ms (through two animation frames)`
    console.log(summary)
    await testInfo.attach('pressure timing', { body: summary, contentType: 'text/plain' })
  })
}
