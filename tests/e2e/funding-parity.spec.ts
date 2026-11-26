import { prepareProfessionalTarget, showProfessionalResults } from './fixtures/professional'
import { chooseMode } from './fixtures/app-bar'
import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('planned-home financing gap follows guided and professional edits in both directions', async ({ page }) => {
  await page.goto('/#/guided/housing/home.situation')
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'Planned purchase' }), page.getByRole('radio', { name: 'Planned purchase', includeHidden: true }))).check()
  await page.goto('/#/guided/housing/purchase.loan')
  const guidedLoan = page.locator('[data-field="principalResidence.annualMortgagePayment"]')
  await expect(guidedLoan).toContainText('missing financing')
  await (await prepareProfessionalTarget(guidedLoan.locator('input'))).fill('40000')
  await expect(guidedLoan).not.toContainText('missing financing')

  await chooseMode(page, 'professional')
  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: 'TFSA' }).locator('input').first())).fill('5000000')
  const professionalLoan = page.locator('label.field').filter({ hasText: 'Payment ($/yr)' })
  await expect(page.locator('.input-form')).toContainText('Planned purchase')
  await expect(professionalLoan).not.toContainText('missing financing')
  const payment = page.locator('label.field').filter({ hasText: 'Payment ($/yr)' }).locator('input').last()
  await (await prepareProfessionalTarget(payment)).fill('')
  await (await prepareProfessionalTarget(payment)).blur()
  await expect(page.locator('.input-form')).toContainText('missing financing')
  await (await prepareProfessionalTarget(payment)).fill('40000')
  await expect(page.locator('.input-form')).not.toContainText('missing financing')
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: "What's my FIRE number?" }), page.getByRole('tab', { name: "What's my FIRE number?", includeHidden: true }))).click()
  await expect(page.locator('.summary')).toContainText('does not support a planned home purchase')

  await (await prepareProfessionalTarget(payment)).fill('')
  await (await prepareProfessionalTarget(payment)).blur()

  await chooseMode(page, 'guided')
  await page.goto('/#/guided/housing/purchase.loan')
  await expect(guidedLoan).toContainText('missing financing')
})

test('FHSA plus employee DC uses one budget in both modes', async ({ page }) => {
  await page.goto('/#/guided/saving/saving.method')
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: /yearly amount/i }), page.getByRole('radio', { name: /yearly amount/i, includeHidden: true }))).check()
  await page.goto('/#/guided/saving/saving.amount')
  await (await prepareProfessionalTarget(page.locator('[data-field="annualSavings"] input'))).fill('10000')
  await page.goto('/#/guided/assets/assets.identify')
  await (await prepareProfessionalTarget(page.getByRole('checkbox', { name: 'FHSA' }), page.getByRole('checkbox', { name: 'FHSA', includeHidden: true }))).check()
  await (await prepareProfessionalTarget(page.getByRole('checkbox', { name: 'Locked' }), page.getByRole('checkbox', { name: 'Locked', includeHidden: true }))).check()
  await page.goto('/#/guided/assets/locked.contributions')
  const employee = page.locator('[data-field="lockedRetirement.employeeContribution"]')
  await (await prepareProfessionalTarget(employee.locator('input'))).fill('8000')
  await expect(employee).toContainText('6000')

  await chooseMode(page, 'professional')
  await expect(page.locator('.input-form')).toContainText('6000')
  await (await prepareProfessionalTarget(page.getByLabel('Annual after-tax savings'))).fill('16000')
  await expect(page.locator('.input-form')).not.toContainText('shared savings budget')

  await chooseMode(page, 'guided')
  await page.goto('/#/guided/assets/locked.contributions')
  await expect(employee.locator('input')).toHaveValue('8,000')
  await expect(employee).not.toContainText('shared savings budget')
})

test('FHSA-only unmet contribution is visible with the same amount in both modes', async ({ page }) => {
  await page.goto('/#/guided/saving/saving.method')
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: /yearly amount/i }), page.getByRole('radio', { name: /yearly amount/i, includeHidden: true }))).check()
  await page.goto('/#/guided/saving/saving.amount')
  await (await prepareProfessionalTarget(page.locator('[data-field="annualSavings"] input'))).fill('5000')
  await page.goto('/#/guided/assets/assets.identify')
  await (await prepareProfessionalTarget(page.getByRole('checkbox', { name: 'FHSA' }), page.getByRole('checkbox', { name: 'FHSA', includeHidden: true }))).check()
  await page.goto('/#/guided/assets/fhsa.details')
  const fhsa = page.locator('[data-field="fhsa.annualContribution"]')
  await expect(fhsa).toContainText('3000')

  await chooseMode(page, 'professional')
  await expect(page.locator('.input-form')).toContainText('3000')
  await expect(page.locator('.results-column')).toHaveCount(0)
  await (await prepareProfessionalTarget(page.getByLabel('Annual after-tax savings'))).fill('8000')
  await expect(page.locator('.input-form')).not.toContainText('3000')
  await chooseMode(page, 'guided')
  await page.goto('/#/guided/assets/fhsa.details')
  await expect(fhsa).not.toContainText('3000')
})

test('later pension cannot close a year-start cash purchase in professional mode', async ({ page }) => {
  await chooseMode(page, 'professional')
  const field = (label: string) => page.locator('label.field').filter({ hasText: label }).locator('input').first()
  await (await prepareProfessionalTarget(field('Current age'))).fill('50')
  await (await prepareProfessionalTarget(field('Target FIRE age'))).fill('50')
  await (await prepareProfessionalTarget(field('Life expectancy'))).fill('50')
  await (await prepareProfessionalTarget(field('Annual after-tax savings'))).fill('0')
  await (await prepareProfessionalTarget(field('TFSA'))).fill('0')
  await (await prepareProfessionalTarget(field('RRSP'))).fill('0')
  await (await prepareProfessionalTarget(field('Non-registered'))).fill('0')
  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: 'Employer pension (DB)' }).locator('input[type="checkbox"]'))).check()
  await (await prepareProfessionalTarget(field('Annual pension at start age'))).fill('100000')
  await (await prepareProfessionalTarget(field('Pension start age'))).fill('50')
  await (await prepareProfessionalTarget(page.getByRole('button', { name: '+ Principal residence' }), page.getByRole('button', { name: '+ Principal residence', includeHidden: true }))).click()
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'Planned purchase' }), page.getByRole('radio', { name: 'Planned purchase', includeHidden: true }))).check()
  await (await prepareProfessionalTarget(field('Purchase age'))).fill('50')
  await (await prepareProfessionalTarget(field('Purchase price'))).fill('50000')
  await (await prepareProfessionalTarget(field('Down payment'))).fill('50000')
  await expect(page.locator('.input-form')).toContainText('50000')
  await expect(page.locator('.input-form')).toContainText('down payment')
  await expect(page.locator('.results-column')).toHaveCount(0)
  await (await prepareProfessionalTarget(field('TFSA'))).fill('50000')
  await expect(page.locator('.input-form')).not.toContainText('short $50000')
})

async function confirmNumbers(page: Page) {
  const numbers = page.locator('.question-page .question-number:visible')
  for (let i = 0; i < await numbers.count(); i++) {
    const current = numbers.nth(i)
    const value = await current.inputValue()
    await (await prepareProfessionalTarget(current)).fill('')
    await (await prepareProfessionalTarget(current)).fill(value)
  }
}

test('the same funded purchase yields the same result after guided generation and professional switch', async ({ page }) => {
  test.setTimeout(60_000)
  const visited = new Set<string>()
  while (true) {
    const id = await page.locator('.question-page').getAttribute('data-page-id')
    if (!id || visited.has(id)) throw new Error(`Questionnaire stalled at ${id}`)
    visited.add(id)
    if (id === 'family.people') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /Plan for me/ }), page.getByRole('radio', { name: /Plan for me/, includeHidden: true }))).check()
    else if (id === 'family.children') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /No children/ }), page.getByRole('radio', { name: /No children/, includeHidden: true }))).check()
    else if (id === 'family.province') await (await prepareProfessionalTarget(page.getByLabel('Province'))).selectOption('BC')
    else if (id === 'time.work') {
      await confirmNumbers(page)
      await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'I do not have a target yet' }), page.getByRole('radio', { name: 'I do not have a target yet', includeHidden: true }))).check()
    } else if (id === 'saving.method') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /monthly amount/ }), page.getByRole('radio', { name: /monthly amount/, includeHidden: true }))).check()
    else if (id === 'budget.method') {
      await (await prepareProfessionalTarget(page.getByTestId('budget-debt-yes'))).check()
      await (await prepareProfessionalTarget(page.getByTestId('budget-tax-yes'))).check()
    }
    else if (id === 'saving.amount') await (await prepareProfessionalTarget(page.locator('[data-field="annualSavings"] input'))).fill('5000')
    else if (id === 'account.tfsa.balance') await (await prepareProfessionalTarget(page.locator('[data-field="balances.tfsa"] input'))).fill('5000000')
    else if (id === 'account.rrsp.balance') await (await prepareProfessionalTarget(page.locator('[data-field="balances.rrsp"] input'))).fill('1000000')
    else if (id === 'work.after') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /No work income/ }), page.getByRole('radio', { name: /No work income/, includeHidden: true }))).check()
    else if (id === 'assets.identify') {
      await (await prepareProfessionalTarget(page.getByRole('checkbox', { name: 'TFSA' }), page.getByRole('checkbox', { name: 'TFSA', includeHidden: true }))).check()
      await (await prepareProfessionalTarget(page.getByRole('checkbox', { name: 'RRSP' }), page.getByRole('checkbox', { name: 'RRSP', includeHidden: true }))).check()
      await (await prepareProfessionalTarget(page.getByRole('checkbox', { name: /Non-registered/ }), page.getByRole('checkbox', { name: /Non-registered/, includeHidden: true }))).check()
    } else if (id === 'home.situation') await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'Planned purchase' }), page.getByRole('radio', { name: 'Planned purchase', includeHidden: true }))).check()
    else if (id === 'purchase.loan') {
      await (await prepareProfessionalTarget(page.locator('[data-field="principalResidence.annualMortgagePayment"] input'))).fill('40000')
      await confirmNumbers(page)
    }
    else if (id === 'housing.other') {
      await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'No rental property' }), page.getByRole('radio', { name: 'No rental property', includeHidden: true }))).check()
      await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'No other loans' }), page.getByRole('radio', { name: 'No other loans', includeHidden: true }))).check()
    } else if (id === 'spending.method') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /overall budget/ }), page.getByRole('radio', { name: /overall budget/, includeHidden: true }))).check()
    else if (id === 'pension.self') await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'No employer pension' }), page.getByRole('radio', { name: 'No employer pension', includeHidden: true }))).check()
    else if (id === 'intent.legacy') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /do not need to reserve/ }), page.getByRole('radio', { name: /do not need to reserve/, includeHidden: true }))).check()
    else if (id === 'intent.spending') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /Keep my current/ }), page.getByRole('radio', { name: /Keep my current/, includeHidden: true }))).check()
    else if (id === 'invest.mix') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /Balanced 60\/40/ }), page.getByRole('radio', { name: /Balanced 60\/40/, includeHidden: true }))).check()
    else if (id === 'invest.strategy') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /Paced RRSP withdrawals/ }), page.getByRole('radio', { name: /Paced RRSP withdrawals/, includeHidden: true }))).check()
    else await confirmNumbers(page)
    const next = page.locator('.question-pager button').last()
    if (await (await prepareProfessionalTarget(next)).innerText() === 'Review answers') { await (await prepareProfessionalTarget(next)).click(); break }
    await (await prepareProfessionalTarget(next)).click()
  }
  const generate = page.getByRole('button', { name: 'Generate my results' })
  if (await generate.isDisabled()) throw new Error(await (await prepareProfessionalTarget(page.locator('.review-blockers'))).innerText())
  await (await prepareProfessionalTarget(generate)).click()
  await (await prepareProfessionalTarget(page.locator('.conclusion-estate > summary'))).press('Enter')
  const guidedSummary = await (await prepareProfessionalTarget(page.locator('.summary'))).innerText()
  expect(guidedSummary).toContain('Final-year taxable addition')
  expect(guidedSummary).toContain('adds remaining registered balances')
  expect(guidedSummary).toMatch(/Added final-return tax and repayment (?!CA\$0\b)/)
  await chooseMode(page, 'professional')
  await showProfessionalResults(page)
  const estate = page.locator('.conclusion-estate')
  if (!(await estate.evaluate(details => (details as HTMLDetailsElement).open))) await (await prepareProfessionalTarget(estate.locator('summary'))).press('Enter')
  expect(await page.locator('.summary').innerText()).toBe(guidedSummary)
})
