import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

async function confirmVisibleNumbers(page: Page) {
  const inputs = page.locator('.question-page .question-number:visible')
  for (let index = 0; index < await inputs.count(); index++) {
    const input = inputs.nth(index)
    const value = await input.inputValue()
    await input.fill('')
    await input.fill(value)
  }
}

async function answerCurrentPage(page: Page, pageId: string) {
  if (pageId === 'family.people') await page.getByRole('radio', { name: /Plan for me/ }).check()
  else if (pageId === 'family.children') await page.getByRole('radio', { name: /No children/ }).check()
  else if (pageId === 'family.province') await page.getByLabel('Province').selectOption('BC')
  else if (pageId === 'saving.method') await page.getByRole('radio', { name: /monthly amount/ }).check()
  else if (pageId === 'work.after') await page.getByRole('radio', { name: /No work income/ }).check()
  else if (pageId === 'assets.identify') {
    await page.getByRole('checkbox', { name: 'TFSA' }).check()
    await page.getByRole('checkbox', { name: 'RRSP' }).check()
    await page.getByRole('checkbox', { name: /Non-registered/ }).check()
  } else if (pageId === 'home.situation') await page.getByRole('radio', { name: 'Rent' }).check()
  else if (pageId === 'housing.other') {
    await page.getByRole('radio', { name: 'No rental property' }).check()
    await page.getByRole('radio', { name: 'No other loans' }).check()
  } else if (pageId === 'spending.method') await page.getByRole('radio', { name: /overall budget/ }).check()
  else if (pageId === 'pension.self') await page.getByRole('radio', { name: 'No employer pension' }).check()
  else if (pageId === 'intent.legacy') await page.getByRole('radio', { name: /do not need to reserve/ }).check()
  else if (pageId === 'intent.spending') await page.getByRole('radio', { name: /Keep my current/ }).check()
  else if (pageId === 'intent.confirm') await page.getByRole('button', { name: /compare in this direction/ }).click()
  else if (pageId === 'invest.mix') await page.getByRole('radio', { name: /Balanced 60\/40/ }).check()
  else if (pageId === 'invest.strategy') await page.getByRole('radio', { name: /Bracket-capped/ }).check()
  else if (pageId === 'assumptions.review') await page.getByRole('button', { name: /Use these disclosed assumptions/ }).click()
  else await confirmVisibleNumbers(page)
}

async function completeGuidedQuestionnaire(page: Page) {
  const visited = new Set<string>()
  while (true) {
    const article = page.locator('.question-page')
    await expect(article).toBeVisible()
    const pageId = await article.getAttribute('data-page-id')
    if (!pageId) throw new Error('Question page is missing its stable ID')
    if (visited.has(pageId)) throw new Error(`Questionnaire loop detected at ${pageId}`)
    visited.add(pageId)
    await answerCurrentPage(page, pageId)
    const next = page.locator('.question-pager button').last()
    if (await next.isDisabled()) break
    await next.click()
  }
  expect(visited.size).toBeGreaterThan(20)

  const mobileDirectory = page.getByRole('button', { name: /Questionnaire directory/ })
  if (await mobileDirectory.isVisible()) await mobileDirectory.click()
  await page.getByRole('button', { name: 'Review answers' }).click()
}

test('guided mode completes a full UI flow and invalidates a stale result', async ({ page }) => {
  test.setTimeout(60_000)
  await expect(page.getByRole('button', { name: 'Guided', exact: true })).toHaveClass(/active/)
  await expect(page.locator('.results-column')).toHaveCount(0)
  await completeGuidedQuestionnaire(page)
  await expect(page.getByRole('heading', { name: 'Review your answers' })).toBeVisible()
  await expect(page.locator('.results-column')).toHaveCount(0)
  const generate = page.getByRole('button', { name: 'Generate my results' })
  if (await generate.isDisabled()) throw new Error(await page.locator('.review-blockers').innerText())
  await expect(generate).toBeEnabled()
  await generate.click()
  await expect(page.getByRole('heading', { name: 'Your retirement projection' })).toBeVisible()
  await expect(page.locator('.results-column')).toBeVisible()

  await page.getByRole('button', { name: 'Modify answers' }).click()
  await page.goto('/#/guided/family/family.ages')
  const age = page.getByLabel('Current age')
  await age.fill('36')
  await expect(page.locator('.results-column')).toHaveCount(0)
  await page.goto('/#/guided/results')
  await expect(page.getByRole('heading', { name: 'Review your answers' })).toBeVisible()
  await expect(page.locator('.results-column')).toHaveCount(0)
})

test('question help follows the current page within one category', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await page.getByRole('button', { name: '中文' }).click()

  const help = page.locator('.question-help')
  await help.locator('summary').click()
  const householdHelp = await help.innerText()
  expect(householdHelp).toContain('家庭人数')

  await page.locator('.question-pager button').last().click()
  await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'family.ages')
  if (!(await help.evaluate((element) => element.hasAttribute('open')))) await help.locator('summary').click()
  const agesHelp = await help.innerText()
  expect(agesHelp).toContain('出生日期')
  expect(agesHelp).not.toBe(householdHelp)

  await page.locator('.question-pager button').last().click()
  await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'family.children')
  if (!(await help.evaluate((element) => element.hasAttribute('open')))) await help.locator('summary').click()
  const childrenHelp = await help.innerText()
  expect(childrenHelp).toContain('18岁')
  expect(childrenHelp).not.toBe(agesHelp)
})

test('account selection explains the role of every account', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await page.goto('/#/guided/assets/assets.identify')
  await page.getByRole('button', { name: '中文' }).click()

  const roles = page.locator('.check-group small')
  await expect(roles).toHaveCount(5)
  await expect(roles.nth(0)).toContainText('免税增长')
  await expect(roles.nth(1)).toContainText('提款时计入应税收入')
  await expect(roles.nth(2)).toContainText('已实现资本增值')
  await expect(roles.nth(3)).toContainText('首次购房')
  await expect(roles.nth(4)).toContainText('达到规定年龄前不能自由提款')
})

test('future savings allocation is one page with a live 100 percent total', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await page.goto('/#/guided/assets/allocation.tfsa')
  await page.getByRole('button', { name: '中文' }).click()

  await expect(page.getByRole('heading', { name: '未来新增储蓄准备如何分配到各账户？' })).toBeVisible()
  await expect(page.locator('[data-field^="savingsSplit."]')).toHaveCount(3)
  await expect(page.locator('.allocation-total')).toContainText('合计 100%')
  await expect(page.locator('.allocation-total')).toContainText('三个比例合计为100%')

  await page.locator('[data-field="savingsSplit.nonReg"] input').fill('10')
  await expect(page.locator('.allocation-total')).toContainText('合计 90%')
  await expect(page.locator('.allocation-total')).toContainText('还需要分配 10 个百分点')

  await page.locator('[data-field="savingsSplit.nonReg"] input').fill('20')
  await expect(page.locator('.allocation-total')).toHaveClass(/complete/)
})

test('professional mode runs its full immediate-results UI flow', async ({ page }) => {
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.locator('.input-form fieldset')).toHaveCount(6)
  const field = (label: string) => page.locator('label.field').filter({ hasText: label }).locator('input, select').first()
  await field('Current age').fill('40')
  await field('Target FIRE age').fill('55')
  await field('Desired after-tax annual spending in retirement').fill('60000')
  await expect(page.locator('.results-column')).toBeVisible()
  await expect(page.locator('.results-column .summary')).toBeVisible()
  await expect(page.locator('.recharts-responsive-container').first()).toBeVisible()
})

test('legacy v6 stores retain professional mode', async ({ page }) => {
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('fire-inputs')!)
    delete saved.state.entryMode
    delete saved.state.activeStep
    delete saved.state.visitedSteps
    delete saved.state.answerMeta
    delete saved.state.scenarioAAnswerMeta
    saved.version = 6
    localStorage.setItem('fire-inputs', JSON.stringify(saved))
  })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Professional', exact: true })).toHaveClass(/active/)
  await expect(page.locator('.results-column')).toBeVisible()
})

test('guided flow does not overflow at 320px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-320')
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }))
  expect(widths.document).toBeLessThanOrEqual(widths.viewport)
})
