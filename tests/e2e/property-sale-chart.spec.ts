import { prepareProfessionalTarget } from './fixtures/professional'
import { chooseMode } from './fixtures/app-bar'
import { expect, test } from '@playwright/test'

test('a rental sale before FIRE is marked at its actual sale age', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await chooseMode(page, 'professional')
  const field = (label: string) => page.locator('label.field').filter({ hasText: label }).locator('input').first()
  await (await prepareProfessionalTarget(field('Current age'))).fill('50')
  await (await prepareProfessionalTarget(field('Target FIRE age'))).fill('52')
  await (await prepareProfessionalTarget(field('Life expectancy'))).fill('55')
  await (await prepareProfessionalTarget(page.getByRole('button', { name: '+ Investment property' }))).click()
  const rental = page.locator('.property-card').first()
  const saleAge = rental.locator('label.field').filter({ hasText: 'Sell at age' }).locator('input')
  await (await prepareProfessionalTarget(saleAge)).fill('50')
  await (await prepareProfessionalTarget(saleAge)).blur()
  await expect((await prepareProfessionalTarget(saleAge))).toHaveValue('50')
  const chart = page.locator('.chart-card').filter({ has: page.getByRole('heading', { name: 'Account balances by age' }) })
  const saleLine = chart.locator('g.recharts-reference-line').filter({ hasText: 'Sale' })
  const fireLine = chart.locator('g.recharts-reference-line').filter({ hasText: 'FIRE' })
  await expect((await prepareProfessionalTarget(saleLine))).toBeVisible()
  const x = async (line: typeof saleLine) => Number(await line.locator('line').getAttribute('x1'))
  expect(await x(saleLine)).toBeLessThan(await x(fireLine))
})
