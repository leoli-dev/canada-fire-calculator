import { prepareProfessionalTarget } from './fixtures/professional'
import { chooseMode, chooseLanguage } from './fixtures/app-bar'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('guided and professional keep a high ACB and an unresolved draft across modes and refresh', async ({ page }) => {
  await page.goto('/#/guided/assets/assets.identify')
  await (await prepareProfessionalTarget(page.getByRole('checkbox', { name: 'Non-registered account', exact: true }), page.getByRole('checkbox', { name: 'Non-registered account', exact: true, includeHidden: true }))).check()
  await page.goto('/#/guided/assets/account.nonReg.balance')
  await (await prepareProfessionalTarget(page.locator('[data-field="balances.nonReg"] input'))).fill('100000')
  await (await prepareProfessionalTarget(page.locator('[data-field="nonRegBook"] input'))).fill('140000')
  await expect(page.locator('.answer-feedback')).toContainText('loss')
  await chooseMode(page, 'professional')
  const basis = page.locator('label.field').filter({ hasText: 'Non-registered cost base (ACB)' }).locator('input')
  await expect(basis).toHaveValue('140,000')
  await (await prepareProfessionalTarget(basis)).fill('')
  await (await prepareProfessionalTarget(basis)).blur()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(saved.inputs.nonRegBook).toBe(140000)
  expect(saved.draftByField.nonRegBook).toBe('')
  expect(saved.answerMeta.nonRegBook.status).toBe('unknown')
  await page.reload()
  await expect(basis).toHaveValue('')
  await chooseMode(page, 'guided')
  await page.goto('/#/guided/assets/account.nonReg.balance')
  await expect(page.locator('[data-field="nonRegBook"] input')).toHaveValue('')
  await (await prepareProfessionalTarget(page.locator('[data-field="nonRegBook"] input'))).fill('140000')
  await expect(page.locator('.answer-feedback')).toContainText('loss')
})

test('ACB explanation rejects guessed percentages in EN, FR and ZH on both entry surfaces', async ({ page }) => {
  await page.goto('/#/guided/assets/assets.identify')
  await (await prepareProfessionalTarget(page.getByRole('checkbox', { name: 'Non-registered account', exact: true }), page.getByRole('checkbox', { name: 'Non-registered account', exact: true, includeHidden: true }))).check()
  await page.goto('/#/guided/assets/account.nonReg.balance')
  for (const [language, phrase] of [
    ['EN', 'guessed percentage'], ['FR', 'pourcentage deviné'], ['中文', '猜测比例'],
  ]) {
    await chooseLanguage(page, language)
    await expect(page.locator('.question-page')).toContainText(phrase)
    await chooseMode(page, 'professional')
    await expect(page.locator('.input-form')).toContainText(phrase)
    await chooseMode(page, 'guided')
  }
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }))
  expect(widths.document).toBeLessThanOrEqual(widths.viewport)
})

test('investment-property selling expenses are one shared fact in both entry modes', async ({ page }) => {
  await chooseMode(page, 'professional')
  await (await prepareProfessionalTarget(page.getByRole('button', { name: '+ Investment property' }), page.getByRole('button', { name: '+ Investment property', includeHidden: true }))).click()
  const fee = page.locator('label.field').filter({ hasText: "Selling expenses (today's dollars)" }).locator('input')
  await (await prepareProfessionalTarget(fee)).fill('12000')
  await (await prepareProfessionalTarget(fee)).blur()
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect((await saved()).inputs.investmentProperties[0].saleExpenses).toBe(12000)
  await chooseMode(page, 'guided')
  await page.goto('/#/guided/housing/rental.0.income')
  // FE-40: sale costs belong to a planned sale, so guided asks keep-or-sell first.
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'Sell it at a certain age' }), page.getByRole('radio', { name: 'Sell it at a certain age', includeHidden: true }))).check()
  await expect(page.locator('[data-field="investmentProperties.0.saleExpenses"] input')).toHaveValue('12,000')
  await (await prepareProfessionalTarget(page.locator('[data-field="investmentProperties.0.saleExpenses"] input'))).fill('15000')
  await page.reload()
  await chooseMode(page, 'professional')
  await expect(fee).toHaveValue('15,000')
})
