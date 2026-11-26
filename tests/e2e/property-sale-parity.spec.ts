import { prepareProfessionalTarget, showProfessionalResults } from './fixtures/professional'
import { chooseMode, chooseLanguage } from './fixtures/app-bar'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('owned-home sale and mortgage survive both mode edits, with localized shortfall', async ({ page }) => {
  await page.goto('/#/guided/housing/home.situation')
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'Already own' }), page.getByRole('radio', { name: 'Already own', includeHidden: true }))).check()
  await page.goto('/#/guided/housing/home.value')
  await (await prepareProfessionalTarget(page.locator('[data-field="principalResidence.value"] input'))).fill('500000')
  const guidedSale = page.locator('[data-field="principalResidence.sellAtAge"] input')
  // FE-40: keeping the home is an explicit answer; a sale age follows "sell".
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'Sell it at a certain age' }), page.getByRole('radio', { name: 'Sell it at a certain age', includeHidden: true }))).check()
  await (await prepareProfessionalTarget(guidedSale)).fill('35')
  await page.goto('/#/guided/housing/home.mortgage')
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'Yes' }), page.getByRole('radio', { name: 'Yes', includeHidden: true }))).check()
  await page.goto('/#/guided/housing/mortgage.balance')
  await (await prepareProfessionalTarget(page.locator('[data-field="principalResidence.mortgage.balance"] input'))).fill('400000')
  await page.goto('/#/guided/housing/mortgage.payment')
  await (await prepareProfessionalTarget(page.locator('[data-field="principalResidence.mortgage.annualPayment"] input'))).fill('40000')
  await (await prepareProfessionalTarget(page.locator('[data-field="principalResidence.mortgage.yearsRemaining"] input'))).fill('10')
  await expect(page.locator('.question-page')).toContainText('Annual savings is after existing mortgage payments')

  await chooseMode(page, 'professional')
  await expect(page.locator('.input-form')).toContainText('Annual savings is after existing mortgage payments')
  const field = (label: string) => page.locator('label.field').filter({ hasText: label }).locator('input').last()
  await expect(field('Current value')).toHaveValue('500,000')
  await expect(field('Sell at age')).toHaveValue('35')
  await expect(field('Current balance')).toHaveValue('400,000')
  await expect(field('Payment ($/yr)')).toHaveValue('40,000')
  await showProfessionalResults(page)
  const netWorth = page.locator('.summary').filter({ hasText: 'Final net worth' }).first()
  await expect(netWorth).toBeVisible()
  const soldValue = await netWorth.textContent()
  await (await prepareProfessionalTarget(field('Sell at age'))).fill('')
  await (await prepareProfessionalTarget(field('Sell at age'))).blur()
  await expect.poll(() => netWorth.textContent()).not.toBe(soldValue)
  await (await prepareProfessionalTarget(field('Sell at age'))).fill('35')
  await (await prepareProfessionalTarget(field('Sell at age'))).blur()
  await expect(field('Sell at age')).toHaveValue('35')
  await expect.poll(() => netWorth.textContent()).toBe(soldValue)
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: "What's my FIRE number?" }), page.getByRole('tab', { name: "What's my FIRE number?", includeHidden: true }))).click()
  await expect(page.locator('.summary')).toContainText('cannot replay a property sale before FIRE')
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: 'Will my money last?' }), page.getByRole('tab', { name: 'Will my money last?', includeHidden: true }))).click()

  await (await prepareProfessionalTarget(field('Current value'))).fill('300000')
  const accounts = page.locator('[data-group="accounts"]')
  for (const index of [0, 1, 2]) await (await prepareProfessionalTarget(accounts.locator(':scope > .professional-group-body > .professional-number-field > label.field').nth(index).locator('input'))).fill('0')
  await expect(page.locator('.input-form')).toContainText('100000')
  await expect(page.locator('.input-form')).toContainText('remains a debt')
  await chooseMode(page, 'guided')
  await page.goto('/#/guided/housing/home.value')
  await expect(guidedSale).toHaveValue('35')
  await expect(page.locator('[data-field="principalResidence.sellAtAge"]')).toContainText('100000')
  for (const [language, phrase, savingsHint] of [
    ['FR', 'reste une dette', 'L’épargne annuelle'],
    ['中文', '仍计为债务', '年储蓄已扣除'],
    ['EN', 'remains a debt', 'Annual savings is after'],
  ]) {
    await chooseLanguage(page, language)
    await expect(page.locator('[data-field="principalResidence.sellAtAge"]')).toContainText(phrase)
    await expect(page.locator('.question-page')).toContainText(savingsHint)
  }
  const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }))
  expect(width.content).toBeLessThanOrEqual(width.viewport)
})
