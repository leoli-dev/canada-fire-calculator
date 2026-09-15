import { expect, test } from '@playwright/test'

test('guided and professional expose the same pinned rule versions, policy and sources', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const professional = page.getByTestId('rule-assumptions')
  await expect(professional).toContainText('CA-ON-tax-2026-legacy-v1')
  await expect(professional).toContainText('CA-CCB-2026-07-v1')
  await page.getByLabel('Province').selectOption('BC')
  await expect(professional).toContainText('CA-BC-tax-2026-legacy-v1')
  const text = await professional.innerText()
  const links = await professional.locator('a').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))
  // Four tax sources, three CCB sources (amounts, thresholds and, since BE-38
  // B2, the statutory rates the computation applies), and the three
  // GIS/Allowance ones the panel discloses: the quarterly page and the two
  // tables its fitted reduction is measured against.
  expect(links).toHaveLength(10)
  expect(links[0]).toContain('/2026/')
  expect(links[2]).toContain('t4032bc-july')
  expect(links[4]).toContain('/2026/')
  expect(links[6]).toContain('laws-lois.justice.gc.ca')
  expect(links[7]).toContain('2026-quarterly-july-september')
  expect(links[8]).toContain('table1_gis_for_single')
  expect(links[9]).toContain('allowance/benefit-amount')
  // The paths the pack does not price are named, not buried in a limitation
  // string nothing rendered.
  await expect(professional.getByTestId('rule-gis-not-modelled')).toContainText('prior-year base period')
  await expect(professional.getByTestId('rule-gis-not-modelled')).toContainText('provincial GIS or Allowance top-ups')
  // BE-38 B1: the tax figures the pack does not year-switch are named too.
  await expect(professional.getByTestId('rule-tax-not-modelled')).toContainText('GST/HST credit')
  await expect(professional.getByTestId('rule-tax-not-modelled')).toContainText('low-income tax reductions')

  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  const guided = page.getByTestId('rule-assumptions')
  await expect(guided).toContainText('CA-BC-tax-2026-legacy-v1')
  await expect(guided).toContainText('CA-CCB-2026-07-v1')
  // The pack that priced the numbers, stated in both modes.
  await expect(guided).toContainText('Selected tax rule year: 2026')
  // BE-38 B3: the panel states the current coverage position rather than the
  // placeholder the earlier slices carried.
  await expect(guided).toContainText('per-jurisdiction credit coverage list')
  expect(await guided.locator('a').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))).toEqual(links)
  expect(text).toBe(await guided.innerText())

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await page.getByLabel('Province').selectOption('MB')
  await expect(professional).toContainText('Manitoba\'s dedicated 2026 CRA guide')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  await expect(guided).toContainText('Manitoba\'s dedicated 2026 CRA guide')
  await expect(guided.locator('a')).toHaveCount(11)

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await page.getByLabel('Province').selectOption('NL')
  const nlLinks = await professional.locator('a').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))
  expect(nlLinks[3]).toContain('t4008nl-july')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  expect(await guided.locator('a').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))).toEqual(nlLinks)

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await page.getByLabel('Province').selectOption('PE')
  // BE-38 B3 resolved the PE conflict against the dedicated July 2026 guide:
  // the retained $142,250 is gone and the resolution is what the panel states.
  await expect(professional).toContainText('Resolved 2026-09-15')
  await expect(professional).toContainText('$142,520')
  await expect(professional).toContainText('$3.726')
  // The old value may appear only inside the resolution sentence that says it
  // was replaced, never as a live threshold.
  await expect(professional).toContainText("replacing January's $142,250")
  const peLinks = await professional.locator('a').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))
  expect(peLinks[2]).toContain('/2026/t4032-pe-7-26e.pdf')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  await expect(guided).toContainText('$142,520')
  expect(await guided.locator('a').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))).toEqual(peLinks)
})

test('the credit coverage matrix is visible in both modes and claims no completeness', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const professional = page.getByTestId('rule-assumptions')
  const coverage = professional.getByTestId('rule-coverage')
  await expect(coverage).toBeVisible()
  // The matrix names the rows that are inside the numbers and the rows that are
  // not, and it never asserts a complete return.
  await expect(coverage).toHaveAttribute('data-coverage-jurisdiction', 'ON')
  await expect(professional.getByTestId('rule-coverage-implemented-federal-income-tax-brackets')).toBeVisible()
  await expect(professional.getByTestId('rule-coverage-implemented-ontario-health-premium')).toBeVisible()
  await expect(professional.getByTestId('rule-coverage-implemented-ontario-surtax')).toBeVisible()
  await expect(professional.getByTestId('rule-coverage-unsupported-provincial-low-income-reduction')).toBeVisible()
  await expect(professional.getByTestId('rule-coverage-unsupported-provincial-refundable-benefits')).toContainText('GST/HST')
  // The negative statement travels with the matrix rather than being implied by
  // a summary label.
  await expect(professional.getByTestId('rule-coverage-caveat'))
    .toContainText('does not model the GST/HST credit')

  // Every province must render the matrix with both directions populated.
  for (const province of ['BC', 'MB', 'PE', 'QC', 'NL', 'NU']) {
    await page.getByLabel('Province').selectOption(province)
    await expect(coverage, province).toHaveAttribute('data-coverage-jurisdiction', province)
    expect(Number(await coverage.getAttribute('data-coverage-implemented')), `${province} implemented`).toBeGreaterThan(5)
    expect(Number(await coverage.getAttribute('data-coverage-unsupported')), `${province} unsupported`).toBeGreaterThan(3)
    await expect(professional.getByTestId('rule-coverage-unsupported-provincial-refundable-benefits'), province).toBeVisible()
  }

  // Same matrix, same caveat, in guided mode.
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  const guided = page.getByTestId('rule-assumptions')
  const guidedCoverage = guided.getByTestId('rule-coverage')
  await expect(guidedCoverage).toBeVisible()
  await expect(guided.getByTestId('rule-coverage-caveat')).toContainText('does not model the GST/HST credit')
  await expect(guided.getByTestId('rule-coverage-unsupported-provincial-low-income-reduction')).toBeVisible()
  expect(await guidedCoverage.getAttribute('data-coverage-implemented'))
    .toBe(await coverage.getAttribute('data-coverage-implemented'))
})
