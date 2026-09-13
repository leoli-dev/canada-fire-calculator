import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('planned-home financing gap follows guided and professional edits in both directions', async ({ page }) => {
  await page.goto('/#/guided/housing/home.situation')
  await page.getByRole('radio', { name: 'Planned purchase' }).check()
  await page.goto('/#/guided/housing/purchase.loan')
  const guidedLoan = page.locator('[data-field="principalResidence.annualMortgagePayment"]')
  await expect(guidedLoan).toContainText('missing financing')
  await guidedLoan.locator('input').fill('40000')
  await expect(guidedLoan).not.toContainText('missing financing')

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const professionalLoan = page.locator('label.field').filter({ hasText: 'Payment ($/yr)' }).filter({ has: page.locator('em.field-issue.error') })
  await expect(page.locator('.input-form')).toContainText('Planned purchase')
  await expect(professionalLoan).toHaveCount(0)
  const payment = page.locator('label.field').filter({ hasText: 'Payment ($/yr)' }).locator('input').last()
  await payment.fill('')
  await payment.blur()
  await expect(page.locator('.input-form')).toContainText('missing financing')
  await payment.fill('40000')
  await expect(page.locator('.input-form')).not.toContainText('missing financing')
  await page.getByRole('tab', { name: "What's my FIRE number?" }).click()
  await expect(page.locator('.summary')).toContainText('does not support a planned home purchase')

  await payment.fill('')
  await payment.blur()

  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/housing/purchase.loan')
  await expect(guidedLoan).toContainText('missing financing')
})

test('FHSA plus employee DC uses one budget in both modes', async ({ page }) => {
  await page.goto('/#/guided/saving/saving.method')
  await page.getByRole('radio', { name: /yearly amount/i }).check()
  await page.goto('/#/guided/saving/saving.amount')
  await page.locator('[data-field="annualSavings"] input').fill('10000')
  await page.goto('/#/guided/assets/assets.identify')
  await page.getByRole('checkbox', { name: 'FHSA' }).check()
  await page.getByRole('checkbox', { name: 'Locked' }).check()
  await page.goto('/#/guided/assets/locked.contributions')
  const employee = page.locator('[data-field="lockedRetirement.employeeContribution"]')
  await employee.locator('input').fill('8000')
  await expect(employee).toContainText('6000')

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.locator('.input-form')).toContainText('6000')
  await page.getByLabel('Annual after-tax savings').fill('16000')
  await expect(page.locator('.input-form')).not.toContainText('shared savings budget')

  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/assets/locked.contributions')
  await expect(employee.locator('input')).toHaveValue('8,000')
  await expect(employee).not.toContainText('shared savings budget')
})

test('FHSA-only unmet contribution is visible with the same amount in both modes', async ({ page }) => {
  await page.goto('/#/guided/saving/saving.method')
  await page.getByRole('radio', { name: /yearly amount/i }).check()
  await page.goto('/#/guided/saving/saving.amount')
  await page.locator('[data-field="annualSavings"] input').fill('5000')
  await page.goto('/#/guided/assets/assets.identify')
  await page.getByRole('checkbox', { name: 'FHSA' }).check()
  await page.goto('/#/guided/assets/fhsa.details')
  const fhsa = page.locator('[data-field="fhsa.annualContribution"]')
  await expect(fhsa).toContainText('3000')

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.locator('.input-form')).toContainText('3000')
  await expect(page.locator('.results-column')).toHaveCount(0)
  await page.getByLabel('Annual after-tax savings').fill('8000')
  await expect(page.locator('.input-form')).not.toContainText('3000')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/assets/fhsa.details')
  await expect(fhsa).not.toContainText('3000')
})

test('later pension cannot close a year-start cash purchase in professional mode', async ({ page }) => {
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const field = (label: string) => page.locator('label.field').filter({ hasText: label }).locator('input').first()
  await field('Current age').fill('50')
  await field('Target FIRE age').fill('50')
  await field('Life expectancy').fill('50')
  await field('Annual after-tax savings').fill('0')
  await field('TFSA').fill('0')
  await field('RRSP').fill('0')
  await field('Non-registered').fill('0')
  await page.locator('label.field').filter({ hasText: 'Employer pension (DB)' }).locator('input[type="checkbox"]').check()
  await field('Annual pension at start age').fill('100000')
  await field('Pension start age').fill('50')
  await page.getByRole('button', { name: '+ Principal residence' }).click()
  await page.getByRole('radio', { name: 'Planned purchase' }).check()
  await field('Purchase age').fill('50')
  await field('Purchase price').fill('50000')
  await field('Down payment').fill('50000')
  await expect(page.locator('.input-form')).toContainText('50000')
  await expect(page.locator('.input-form')).toContainText('down payment')
  await expect(page.locator('.results-column')).toHaveCount(0)
  await field('TFSA').fill('50000')
  await expect(page.locator('.input-form')).not.toContainText('short $50000')
})

async function confirmNumbers(page: Page) {
  const numbers = page.locator('.question-page .question-number:visible')
  for (let i = 0; i < await numbers.count(); i++) {
    const current = numbers.nth(i)
    const value = await current.inputValue()
    await current.fill('')
    await current.fill(value)
  }
}

test('the same funded purchase yields the same result after guided generation and professional switch', async ({ page }) => {
  test.setTimeout(60_000)
  const visited = new Set<string>()
  while (true) {
    const id = await page.locator('.question-page').getAttribute('data-page-id')
    if (!id || visited.has(id)) throw new Error(`Questionnaire stalled at ${id}`)
    visited.add(id)
    if (id === 'family.people') await page.getByRole('radio', { name: /Plan for me/ }).check()
    else if (id === 'family.children') await page.getByRole('radio', { name: /No children/ }).check()
    else if (id === 'family.province') await page.getByLabel('Province').selectOption('BC')
    else if (id === 'time.work') {
      await confirmNumbers(page)
      await page.getByRole('radio', { name: 'I do not have a target yet' }).check()
    } else if (id === 'saving.method') await page.getByRole('radio', { name: /monthly amount/ }).check()
    else if (id === 'work.after') await page.getByRole('radio', { name: /No work income/ }).check()
    else if (id === 'assets.identify') {
      await page.getByRole('checkbox', { name: 'TFSA' }).check()
      await page.getByRole('checkbox', { name: 'RRSP' }).check()
      await page.getByRole('checkbox', { name: /Non-registered/ }).check()
    } else if (id === 'home.situation') await page.getByRole('radio', { name: 'Planned purchase' }).check()
    else if (id === 'purchase.loan') {
      await page.locator('[data-field="principalResidence.annualMortgagePayment"] input').fill('40000')
      await confirmNumbers(page)
    }
    else if (id === 'housing.other') {
      await page.getByRole('radio', { name: 'No rental property' }).check()
      await page.getByRole('radio', { name: 'No other loans' }).check()
    } else if (id === 'spending.method') await page.getByRole('radio', { name: /overall budget/ }).check()
    else if (id === 'pension.self') await page.getByRole('radio', { name: 'No employer pension' }).check()
    else if (id === 'intent.legacy') await page.getByRole('radio', { name: /do not need to reserve/ }).check()
    else if (id === 'intent.spending') await page.getByRole('radio', { name: /Keep my current/ }).check()
    else if (id === 'invest.mix') await page.getByRole('radio', { name: /Balanced 60\/40/ }).check()
    else if (id === 'invest.strategy') await page.getByRole('radio', { name: /Paced RRSP withdrawals/ }).check()
    else await confirmNumbers(page)
    const next = page.locator('.question-pager button').last()
    if (await next.innerText() === 'Review answers') { await next.click(); break }
    await next.click()
  }
  const generate = page.getByRole('button', { name: 'Generate my results' })
  if (await generate.isDisabled()) throw new Error(await page.locator('.review-blockers').innerText())
  await generate.click()
  const guidedSummary = await page.locator('.summary').innerText()
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  expect(await page.locator('.summary').innerText()).toBe(guidedSummary)
})
