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
  // Four tax sources, two CCB sources, and the three GIS/Allowance ones the
  // panel now discloses: the quarterly page and the two tables its fitted
  // reduction is measured against.
  expect(links).toHaveLength(9)
  expect(links[0]).toContain('/2026/')
  expect(links[2]).toContain('t4032bc-july')
  expect(links[4]).toContain('/2026/')
  expect(links[6]).toContain('2026-quarterly-july-september')
  expect(links[7]).toContain('table1_gis_for_single')
  expect(links[8]).toContain('allowance/benefit-amount')
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
  await expect(guided).toContainText('BE-38 B')
  expect(await guided.locator('a').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))).toEqual(links)
  expect(text).toBe(await guided.innerText())

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await page.getByLabel('Province').selectOption('MB')
  await expect(professional).toContainText('Manitoba\'s dedicated 2026 CRA guide')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  await expect(guided).toContainText('Manitoba\'s dedicated 2026 CRA guide')
  await expect(guided.locator('a')).toHaveCount(10)

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await page.getByLabel('Province').selectOption('NL')
  const nlLinks = await professional.locator('a').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))
  expect(nlLinks[3]).toContain('t4008nl-july')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  expect(await guided.locator('a').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))).toEqual(nlLinks)

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await page.getByLabel('Province').selectOption('PE')
  await expect(professional).toContainText('$142,250 threshold')
  await expect(professional).toContainText('$142,520')
  await expect(professional).toContainText('January CRA')
  const peLinks = await professional.locator('a').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))
  expect(peLinks[2]).toContain('/2026/t4032-pe-1-26e.pdf')
  expect(peLinks).toContain('https://www.princeedwardisland.ca/en/information/finance-and-affordability/provincial-personal-income-tax')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  await expect(guided).toContainText('$142,250 threshold')
  expect(await guided.locator('a').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))).toEqual(peLinks)
})
