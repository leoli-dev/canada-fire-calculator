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
  else if (pageId === 'invest.mix') await page.getByRole('radio', { name: /Balanced 60\/40/ }).check()
  else if (pageId === 'invest.strategy') await page.getByRole('radio', { name: /Bracket-capped/ }).check()
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
    if (await next.innerText() === 'Review answers') { await next.click(); break }
    await next.click()
  }
  expect(visited.size).toBeGreaterThan(20)
  expect(visited.has('assumptions.review')).toBe(false)
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

test('non-registered value and cost base share one page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await page.goto('/#/guided/assets/assets.identify')
  await page.getByRole('checkbox', { name: 'Non-registered account', exact: true }).check()
  await page.goto('/#/guided/assets/account.nonReg.balance')
  await page.getByRole('button', { name: '中文' }).click()

  await expect(page.getByRole('heading', { name: '非注册投资现在值多少，成本基础是多少？' })).toBeVisible()
  await expect(page.locator('[data-field="balances.nonReg"]')).toBeVisible()
  await expect(page.locator('[data-field="nonRegBook"]')).toBeVisible()
  await page.locator('[data-field="balances.nonReg"] input').fill('100000')
  await page.locator('[data-field="nonRegBook"] input').fill('80000')
  await expect(page.locator('.answer-feedback')).toContainText('账面增值为 CA$20,000')
  await expect(page.locator('.answer-feedback')).toContainText('这不是税额')
})

test('intent recommendation updates inline without a confirmation page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await page.goto('/#/guided/preferences/intent.legacy')
  await page.getByRole('radio', { name: /do not need to reserve/ }).check()
  await page.goto('/#/guided/preferences/intent.spending')
  await page.getByRole('button', { name: '中文' }).click()

  await page.getByRole('radio', { name: '查看理论支出上限' }).check()
  await expect(page.locator('.intent-recommendation')).toContainText('根据你的选择，结果会这样比较')
  await expect(page.locator('.intent-recommendation')).toContainText('不改变当前预算，另行查看理论支出上限')
  await expect(page.getByRole('button', { name: /确认|返回修改偏好/ })).toHaveCount(0)

  await page.goto('/#/guided/preferences/intent.confirm')
  await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'intent.spending')
})

test('investment mix explains annual real return percentages', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await page.goto('/#/guided/preferences/invest.mix')
  await page.getByRole('button', { name: '中文' }).click()

  const explanation = page.locator('.mix-return-explanation')
  await expect(explanation).toContainText('长期预计的年均实际收益率')
  await expect(explanation).toContainText('已经扣除通胀影响')
  await expect(explanation).toContainText('投资费用（MER）尚未扣除')
  await expect(page.locator('.choice-group small')).toHaveCount(5)
  await expect(page.getByText('预计年均实际收益：3.7%')).toBeVisible()
  await expect(page.getByText('预计年均实际收益：2.4%')).toBeVisible()
})

test('fee and inflation presets are sourced examples, independently editable and persisted', async ({ page }) => {
  await page.goto('/#/guided/preferences/invest.fees')
  await page.getByRole('button', { name: '中文' }).click()

  const fee = page.locator('[data-field="fees"] input')
  const inflation = page.locator('[data-field="inflation"] input')
  const managed = page.getByRole('button', { name: '代管 ETF 组合 · 0.65%' })
  const fpCanada = page.getByRole('button', { name: 'FP Canada 2026 · 2.1%' })
  await expect(managed).toHaveAttribute('aria-pressed', 'false')
  await managed.click()
  await expect(fee).toHaveValue('0.65')
  await expect(inflation).toHaveValue('2.1')
  await expect(managed).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-field="fees"] small')).toContainText('估算')
  await expect(fpCanada).toHaveAttribute('aria-pressed', 'false')

  await page.getByRole('button', { name: '偏高通胀情景 · 3.0%' }).click()
  await expect(inflation).toHaveValue('3')
  await fee.fill('0.8')
  await expect(managed).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-field="fees"] small')).toContainText('已确认')
  await page.reload()
  await expect(fee).toHaveValue('0.8')
  await expect(inflation).toHaveValue('3')
  await expect(page.locator('.assumption-source a')).toHaveCount(6)
})

test('tax assumptions explain both inputs and update the worked example', async ({ page }) => {
  await page.goto('/#/guided/preferences/invest.tax')
  await page.getByRole('button', { name: '中文' }).click()

  await expect(page.getByRole('heading', { name: '非注册投资每年产生多少应税收入？按什么税率估算？' })).toBeVisible()
  await expect(page.getByText('未卖出的市值上涨不算在这里。', { exact: false })).toBeVisible()
  await expect(page.getByText('不是你全年收入的平均税率。', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: '加拿大税务局的基金税务说明' })).toHaveAttribute('href', /canada\.ca/)
  await expect(page.getByRole('link', { name: '加拿大税务局税档' })).toHaveAttribute('href', /canada\.ca/)

  const example = page.locator('.tax-worked-example')
  await expect(example).toContainText('CA$2,000')
  await expect(example).toContainText('CA$700')
  await page.locator('[data-field="nonRegDistributionYield"] input').fill('3')
  await page.locator('[data-field="accumulationMarginalRate"] input').fill('40')
  await expect(example).toContainText('CA$3,000')
  await expect(example).toContainText('CA$1,200')
  await page.reload()
  await expect(example).toContainText('CA$1,200')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})

test('applying the CPP work-history estimate confirms the planning input and age choices explain the trade-off', async ({ page }) => {
  await page.goto('/#/guided/income/cpp.self')
  await page.getByRole('button', { name: '中文' }).click()

  const amount = page.locator('[data-field="cppAnnualAt65"]')
  const age = page.locator('[data-field="cppStartAge"]')
  await expect(amount.locator('small')).toHaveText('示例')
  await expect(age.locator('small')).toHaveText('示例')
  await expect(page.getByRole('heading', { name: '不知道选几岁？先比较这三种情形' })).toBeVisible()
  await expect(page.getByRole('radio', { name: /65 岁 · 先用作比较基准/ })).not.toBeChecked()
  await expect(page.getByRole('radio', { name: /72 岁/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '查看官方开领说明' })).toHaveAttribute('href', /canada\.ca/)

  await page.locator('.estimator summary').click()
  await page.locator('.estimator').getByRole('button', { name: '应用' }).click()
  await expect(amount.locator('small')).toHaveText('已确认')
  await expect(amount.locator('input')).not.toHaveValue('10000')
  await expect(page.locator('.cpp-estimate-note')).toContainText('不代表政府核定')
  await expect(age.locator('small')).toHaveText('示例')

  await page.getByRole('radio', { name: /70 岁 · 延后领取/ }).check()
  await expect(age.locator('input')).toHaveValue('70')
  await expect(age.locator('small')).toHaveText('已确认')
  await age.locator('input').fill('68')
  await expect(page.getByRole('radio', { name: /70 岁 · 延后领取/ })).not.toBeChecked()
  await page.reload()
  await expect(amount.locator('small')).toHaveText('已确认')
  await expect(age.locator('input')).toHaveValue('68')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
})

test('Québec QPP offers age 72 guidance for both household members', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await page.goto('/#/guided/family/family.people')
  await page.getByRole('radio', { name: /Plan with my partner/ }).check()
  await page.goto('/#/guided/family/family.province')
  await page.getByLabel('Province').selectOption('QC')
  await page.goto('/#/guided/income/cpp.partner')
  await page.getByRole('button', { name: '中文' }).click()

  await expect(page.getByRole('heading', { name: '不知道选几岁？先比较这四种情形' })).toBeVisible()
  await expect(page.getByRole('radio', { name: /72 岁 · 魁省 QPP/ })).toBeVisible()
  await expect(page.getByRole('link', { name: '查看官方开领说明' })).toHaveAttribute('href', /retraitequebec\.gouv\.qc\.ca/)
  await page.getByRole('radio', { name: /72 岁 · 魁省 QPP/ }).check()
  await expect(page.locator('[data-field="partner.cppStartAge"] input')).toHaveValue('72')
  await expect(page.locator('[data-field="partner.cppStartAge"] small')).toHaveText('已确认')
  await page.locator('.estimator summary').click()
  await page.locator('.estimator').getByRole('button', { name: '应用' }).click()
  await expect(page.locator('[data-field="partner.cppAnnualAt65"] small')).toHaveText('已确认')
})

test('final review replaces the redundant assumption page without overwriting confirmed answers', async ({ page }) => {
  await page.goto('/#/guided/preferences/invest.fees')
  await page.getByRole('button', { name: '中文' }).click()
  await page.locator('[data-field="fees"] input').fill('0.8')
  await page.getByRole('button', { name: '加拿大央行目标 · 2.0%' }).click()
  await page.goto('/#/guided/preferences/invest.strategy')
  await page.getByRole('radio', { name: /RRSP 压税/ }).check()
  await page.locator('.question-pager').getByRole('button', { name: '核对答案' }).click()

  await expect(page.getByRole('heading', { name: '核对你的答案' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '这次计算会用到的假设' })).toBeVisible()
  await expect(page.locator('.review-assumption-row')).toHaveCount(4)
  const feeRow = page.locator('.review-assumption-row').filter({ hasText: '费用与通胀' })
  await expect(feeRow).toContainText('0.8%')
  await expect(feeRow).toContainText('2%')
  await expect(feeRow).toContainText('含估算')
  await expect(page.getByRole('button', { name: '采用这些已披露假设' })).toHaveCount(0)
  const savedFee = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.answerMeta.fees)
  expect(savedFee.status).toBe('confirmed')
  expect(savedFee.origin).toBe('user')

  await page.getByRole('button', { name: '修改费用与通胀' }).click()
  await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'invest.fees')
  await page.goto('/#/guided/preferences/assumptions.review')
  await expect(page.getByRole('heading', { name: '核对你的答案' })).toBeVisible()
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
