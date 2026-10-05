import { expect, test, type Page } from '@playwright/test'

/** FE-39 / FE-40: following the guided prompts never leaves a wrong or stuck state. */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
const status = (page: Page) =>
  page.locator('.category-navigation button[aria-current="page"] small')

test('the category path ends on its total and applies it to the plan', async ({ page }) => {
  await page.goto('/#/guided/spending/spending.method')
  await page.getByRole('radio', { name: /Help me build it from categories/ }).check()
  await page.goto('/#/guided/spending/spending.homeFood')
  await page.locator('[data-field="worksheet.wsHousing"] input').fill('24000')
  await page.locator('[data-field="worksheet.wsGroceries"] input').fill('9000')
  await page.goto('/#/guided/spending/spending.travelHealth')
  await page.locator('[data-field="worksheet.wsTravel"] input').fill('12000')
  // The last category page leads to the total, not back to it.
  await page.goto('/#/guided/spending/spending.funOther')
  await page.locator('.question-pager button').last().click()
  await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'spending.total')
  const summary = page.getByTestId('guided-worksheet-summary')
  await expect(summary).toContainText('45,000')
  await page.getByTestId('guided-worksheet-apply').click()
  await expect(summary).toContainText('uses your category total')
  expect((await saved(page)).inputs.retirementSpending).toBe(45_000)
  await expect(page.locator('[data-field="retirementSpending"] input')).toHaveValue('45,000')
  // A later category change shows the gap again instead of silently diverging.
  await page.goto('/#/guided/spending/spending.travelHealth')
  await page.locator('[data-field="worksheet.wsTravel"] input').fill('15000')
  await page.goto('/#/guided/spending/spending.total')
  await expect(page.getByTestId('guided-worksheet-apply')).toContainText('48,000')
})

test('a ticked account keeps its sample balance unanswered until the real amount is entered', async ({ page }) => {
  await page.goto('/#/guided/assets/assets.identify')
  await page.getByRole('checkbox', { name: 'TFSA' }).check()
  await page.goto('/#/guided/assets/account.tfsa.balance')
  const answer = page.locator('[data-field="balances.tfsa"]')
  await expect(answer).toContainText('sample')
  await expect(status(page)).toContainText('to do')
  await answer.locator('input').fill('42000')
  await expect(answer).toContainText('confirmed')
  await expect(status(page)).toContainText('answered')
})

test('keeping a home is an answer, not a field marked to revisit', async ({ page }) => {
  await page.goto('/#/guided/housing/home.situation')
  await page.getByRole('radio', { name: 'Already own' }).check()
  await page.goto('/#/guided/housing/home.value')
  await page.locator('[data-field="principalResidence.value"] input').fill('600000')
  await page.getByRole('radio', { name: 'Keep it, no sale planned' }).check()
  await expect(page.locator('[data-field="principalResidence.sellAtAge"]')).toHaveCount(0)
  const state = await saved(page)
  expect(state.inputs.principalResidence.sellAtAge).toBeNull()
  expect(state.answerMeta['principalResidence.sellAtAge'].status).toBe('confirmed')
  await expect(page.locator('.question-page')).not.toContainText('revisit')
  // Choosing to sell asks an age that is a sample until entered.
  await page.getByRole('radio', { name: 'Sell it at a certain age' }).check()
  await expect(page.locator('[data-field="principalResidence.sellAtAge"]')).toContainText('sample')
  await page.locator('[data-field="principalResidence.sellAtAge"] input').fill('70')
  expect((await saved(page)).inputs.principalResidence.sellAtAge).toBe(70)
})

test('the example province is a prompt, so Ontario can be chosen and confirmed', async ({ page }) => {
  await page.goto('/#/guided/family/family.province')
  const province = page.getByLabel('Province')
  await expect(province).toHaveValue('')
  await expect(province.locator('option[value="ON"]')).toHaveText('Ontario (ON)')
  await province.selectOption('ON')
  await expect(province).toHaveValue('ON')
  expect((await saved(page)).answerMeta.province).toMatchObject({ status: 'confirmed' })
})
