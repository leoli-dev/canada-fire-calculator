import { expect, test } from '@playwright/test'
import { coverageFor } from '../../src/engine/rules/coverageMatrix'

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
  const links = await professional.getByTestId('rule-sources').locator('a')
    .evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))
  // Four tax sources, three CCB sources (amounts, thresholds and, since BE-38
  // B2, the statutory rates the computation applies), and the three
  // GIS/Allowance ones the panel discloses: the quarterly page and the two
  // tables its fitted reduction is measured against. The per-entry coverage
  // links are a separate list and are asserted in the coverage test below.
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
  expect(await guided.getByTestId('rule-sources').locator('a')
    .evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))).toEqual(links)
  expect(text).toBe(await guided.innerText())

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await page.getByLabel('Province').selectOption('MB')
  await expect(professional).toContainText('Manitoba\'s dedicated 2026 CRA guide')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  await expect(guided).toContainText('Manitoba\'s dedicated 2026 CRA guide')
  await expect(guided.getByTestId('rule-sources').locator('a')).toHaveCount(11)

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

  // BE-38 B3 review (BL2): the panel tells the reader that each implemented
  // entry links to the authority its figures were read from. Tie that claim to
  // the DOM: every implemented row must carry exactly one real anchor, and it
  // must point at the authority the matrix row names — the same URL the BL1
  // assertion forces to be the one the pack prices from.
  const implementedOn = coverageFor('ON').implemented
  expect(Object.keys(implementedOn).length).toBeGreaterThan(5)
  const implementedAnchors = await coverage.locator('ul').first().locator('li a')
    .evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))
  expect(implementedAnchors).toHaveLength(Object.keys(implementedOn).length)
  expect(implementedAnchors.every(href => href?.startsWith('https://'))).toBe(true)
  for (const [id, credit] of Object.entries(implementedOn))
    await expect(professional.getByTestId(`rule-coverage-implemented-${id}`).locator('a'), id)
      .toHaveAttribute('href', credit.sourceURL)
  // No implemented row may render as bare text: an unlinked row would make the
  // claim false for that row even if the others were linked.
  expect(await coverage.locator('ul').first().locator('li').count()).toBe(implementedAnchors.length)

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

test('the coverage caveat is native in French and Chinese, not English copy', async ({ page }) => {
  // BE-38 B3 review (NB4): the panel rendered the English artifact string in
  // every language. It now reads the catalogue, so each language must render
  // its own copy of the same caveat.
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.locator('.entry-mode button').nth(1).click()
  const caveatEn = await page.getByTestId('rule-coverage-caveat').innerText()
  expect(caveatEn).toContain('does not model the GST/HST credit')
  for (const [lang, marker] of [['fr', 'TPS/TVH'], ['zh', 'GST/HST']] as const) {
    await page.evaluate(l => localStorage.setItem('fire-lang', l), lang)
    await page.reload()
    await page.locator('.entry-mode button').nth(1).click()
    const caveat = await page.getByTestId('rule-coverage-caveat')
    await expect(caveat, lang).toContainText(marker)
    await expect(caveat, lang).not.toHaveText(caveatEn)
  }
})
