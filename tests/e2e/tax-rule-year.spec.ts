import { expect, test } from '@playwright/test'

/**
 * BE-38 B1: the selected tax rule pack, its year and its projection policy must
 * be visible and identical in both entry modes. A mode switch is a presentation
 * change and may not change which pack priced the numbers.
 */
test('the tax rule pack and year are visible and identical in both modes', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const pack = page.getByTestId('rule-tax-pack')
  const read = async () => ({
    id: await pack.getAttribute('data-rule-pack-id'),
    year: await pack.getAttribute('data-rule-year'),
    assumed: await pack.getAttribute('data-rule-assumed'),
    text: await pack.innerText(),
  })

  const onProfessional = await read()
  expect(onProfessional.id).toBe('CA-ON-tax-2026-legacy-v1')
  expect(onProfessional.year).toBe('2026')
  expect(onProfessional.assumed).toBe('false')
  expect(onProfessional.text).toContain('Selected tax rule year: 2026')
  expect(onProfessional.text).toContain('published figures')

  // A different jurisdiction selects that jurisdiction's own pack, same year.
  await page.getByLabel('Province').selectOption('AB')
  const alberta = await read()
  expect(alberta.id).toBe('CA-AB-tax-2026-legacy-v1')
  expect(alberta.year).toBe('2026')
  expect(alberta.assumed).toBe('false')

  // Guided mode shows the very same pack, year and policy — not a second copy.
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  const onGuided = await read()
  expect(onGuided).toEqual(alberta)
  await expect(page.getByTestId('rule-tax-not-modelled')).toContainText('GST/HST credit')
  // Alberta charges neither the Ontario nor the Quebec premiums, so neither is
  // declared for it; the shared federal gaps still are.
  await expect(page.getByTestId('rule-tax-not-modelled')).not.toContainText('Ontario surtax')
  await expect(page.getByTestId('rule-tax-not-modelled')).not.toContainText('RAMQ premium')

  // Switching modes back and forth leaves the selection untouched.
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  expect(await read()).toEqual(alberta)
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  expect(await read()).toEqual(alberta)

  // Ontario's own premiums and levies are declared only for Ontario.
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await page.getByLabel('Province').selectOption('ON')
  await expect(page.getByTestId('rule-tax-not-modelled')).toContainText('Ontario surtax')
  await page.getByLabel('Province').selectOption('SK')
  await expect(page.getByTestId('rule-tax-not-modelled')).not.toContainText('Ontario surtax')
  await expect(page.getByTestId('rule-tax-not-modelled')).toContainText('GST/HST credit')
})
