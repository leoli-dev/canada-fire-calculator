import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('owned-home sale and mortgage survive both mode edits, with localized shortfall', async ({ page }) => {
  await page.goto('/#/guided/housing/home.situation')
  await page.getByRole('radio', { name: 'Already own' }).check()
  await page.goto('/#/guided/housing/home.value')
  await page.locator('[data-field="principalResidence.value"] input').fill('500000')
  const guidedSale = page.locator('[data-field="principalResidence.sellAtAge"] input')
  await guidedSale.fill('35')
  await page.goto('/#/guided/housing/home.mortgage')
  await page.getByRole('radio', { name: 'Yes' }).check()
  await page.goto('/#/guided/housing/mortgage.balance')
  await page.locator('[data-field="principalResidence.mortgage.balance"] input').fill('400000')
  await page.goto('/#/guided/housing/mortgage.payment')
  await page.locator('[data-field="principalResidence.mortgage.annualPayment"] input').fill('40000')
  await page.locator('[data-field="principalResidence.mortgage.yearsRemaining"] input').fill('10')
  await expect(page.locator('.question-page')).toContainText('Annual savings is after existing mortgage payments')

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.locator('.input-form')).toContainText('Annual savings is after existing mortgage payments')
  const field = (label: string) => page.locator('label.field').filter({ hasText: label }).locator('input').last()
  await expect(field('Current value')).toHaveValue('500,000')
  await expect(field('Sell at age')).toHaveValue('35')
  await expect(field('Current balance')).toHaveValue('400,000')
  await expect(field('Payment ($/yr)')).toHaveValue('40,000')
  const netWorth = page.locator('.summary').filter({ hasText: 'Final net worth' }).first()
  await expect(netWorth).toBeVisible()
  const soldValue = await netWorth.textContent()
  await field('Sell at age').fill('')
  await field('Sell at age').blur()
  await expect.poll(() => netWorth.textContent()).not.toBe(soldValue)
  await field('Sell at age').fill('35')
  await field('Sell at age').blur()
  await expect(field('Sell at age')).toHaveValue('35')
  await expect.poll(() => netWorth.textContent()).toBe(soldValue)
  await page.getByRole('tab', { name: "What's my FIRE number?" }).click()
  await expect(page.locator('.summary')).toContainText('cannot replay a property sale before FIRE')
  await page.getByRole('tab', { name: 'Will my money last?' }).click()

  await field('Current value').fill('300000')
  const accounts = page.locator('fieldset').filter({ has: page.locator('legend').filter({ hasText: 'Accounts' }) }).first()
  for (const index of [0, 1, 2]) await accounts.locator(':scope > label.field').nth(index).locator('input').fill('0')
  await expect(page.locator('.input-form')).toContainText('100000')
  await expect(page.locator('.input-form')).toContainText('remains a debt')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/housing/home.value')
  await expect(guidedSale).toHaveValue('35')
  await expect(page.locator('[data-field="principalResidence.sellAtAge"]')).toContainText('100000')
  for (const [language, phrase, savingsHint] of [
    ['FR', 'reste une dette', 'L’épargne annuelle'],
    ['中文', '仍计为债务', '年储蓄已扣除'],
    ['EN', 'remains a debt', 'Annual savings is after'],
  ]) {
    await page.locator('.langs').getByRole('button', { name: language }).click()
    await expect(page.locator('[data-field="principalResidence.sellAtAge"]')).toContainText(phrase)
    await expect(page.locator('.question-page')).toContainText(savingsHint)
  }
  const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }))
  expect(width.content).toBeLessThanOrEqual(width.viewport)
})
