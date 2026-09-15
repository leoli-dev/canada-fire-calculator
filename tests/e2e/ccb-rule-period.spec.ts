import { expect, test } from '@playwright/test'

/**
 * BE-38 B2: the selected CCB rule pack and its July-June payment period must be
 * visible and identical in both entry modes. A mode switch is a presentation
 * change and may not change which pack priced the child-benefit numbers. CCB is
 * federal, so the province may change the tax pack but never the CCB pack.
 */
test('the CCB rule pack and payment period are visible and identical in both modes', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const pack = page.getByTestId('rule-ccb-pack')
  const read = async () => ({
    id: await pack.getAttribute('data-rule-pack-id'),
    period: await pack.getAttribute('data-rule-period'),
    assumed: await pack.getAttribute('data-rule-assumed'),
    text: await pack.innerText(),
  })

  const onProfessional = await read()
  expect(onProfessional.id).toBe('CA-CCB-2026-07-v1')
  expect(onProfessional.period).toBe('2026-07/2027-06')
  expect(onProfessional.assumed).toBe('false')
  expect(onProfessional.text).toContain('Selected CCB payment period: 2026-07/2027-06')
  expect(onProfessional.text).toContain('published figures')

  // The CCB pack is federal: a different jurisdiction may change the tax pack
  // but must not change which CCB pack or period priced the child benefit.
  await page.getByLabel('Province').selectOption('AB')
  const alberta = await read()
  expect(alberta).toEqual(onProfessional)
  await expect(page.getByTestId('rule-tax-pack')).toHaveAttribute('data-rule-pack-id', 'CA-AB-tax-2026-legacy-v1')

  // Guided mode shows the very same pack and period — not a second copy.
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  const onGuided = await read()
  expect(onGuided).toEqual(alberta)
  // The gaps the pack refuses to model travel with it.
  await expect(page.getByTestId('rule-ccb-not-modelled')).toContainText('prior-year adjusted family net income')
  await expect(page.getByTestId('rule-ccb-not-modelled')).toContainText('Child Disability Benefit')
  await expect(page.getByTestId('rule-ccb-not-modelled')).toContainText('provincial child benefits')

  // Switching modes back and forth leaves the selection untouched.
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  expect(await read()).toEqual(alberta)
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  expect(await read()).toEqual(alberta)

  // The version line names the pack and its period in both modes, and the
  // statutory rate source is linked so the rates are traceable too.
  await expect(page.getByTestId('rule-assumptions')).toContainText('CA-CCB-2026-07-v1 (2026-07/2027-06)')
  const links = await page.getByTestId('rule-assumptions').locator('a')
    .evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))
  expect(links.some(href => href?.includes('laws-lois.justice.gc.ca'))).toBe(true)
})
