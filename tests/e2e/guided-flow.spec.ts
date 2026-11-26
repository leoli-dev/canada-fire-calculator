import { prepareProfessionalTarget } from './fixtures/professional'
import { revealProfessionalEditor, showProfessionalResults } from './fixtures/professional'
import { chooseMode, chooseLanguage, openLanguages, expectMode } from './fixtures/app-bar'
import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'

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
    await (await prepareProfessionalTarget(input)).fill('')
    await (await prepareProfessionalTarget(input)).fill(value)
  }
}

async function answerCurrentPage(page: Page, pageId: string, targetChoice: 'yes' | 'no', budgetFacts: 'yes' | 'no' = 'yes') {
  if (pageId === 'family.people') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /Plan for me/ }), page.getByRole('radio', { name: /Plan for me/, includeHidden: true }))).check()
  else if (pageId === 'family.children') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /No children/ }), page.getByRole('radio', { name: /No children/, includeHidden: true }))).check()
  else if (pageId === 'family.province') await (await prepareProfessionalTarget(page.getByLabel('Province'))).selectOption('BC')
  else if (pageId === 'time.work') {
    await confirmVisibleNumbers(page)
    if (targetChoice === 'yes') {
      await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'I have my own asset target' }), page.getByRole('radio', { name: 'I have my own asset target', includeHidden: true }))).check()
      await (await prepareProfessionalTarget(page.locator('[data-field="fireTargetAssets"] input'))).fill('750000')
    } else await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'I do not have a target yet' }), page.getByRole('radio', { name: 'I do not have a target yet', includeHidden: true }))).check()
    const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }))
    expect(widths.document).toBeLessThanOrEqual(widths.viewport)
  }
  else if (pageId === 'saving.method') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /monthly amount/ }), page.getByRole('radio', { name: /monthly amount/, includeHidden: true }))).check()
  // BE-13 A: the basis question sits next to the amount and needs an answer.
  else if (pageId === 'budget.method') {
    await (await prepareProfessionalTarget(page.getByTestId(`budget-debt-${budgetFacts}`))).check()
    await (await prepareProfessionalTarget(page.getByTestId(`budget-tax-${budgetFacts}`))).check()
  }
  else if (pageId === 'work.after') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /No work income/ }), page.getByRole('radio', { name: /No work income/, includeHidden: true }))).check()
  else if (pageId === 'assets.identify') {
    await (await prepareProfessionalTarget(page.getByRole('checkbox', { name: 'TFSA' }), page.getByRole('checkbox', { name: 'TFSA', includeHidden: true }))).check()
    await (await prepareProfessionalTarget(page.getByRole('checkbox', { name: 'RRSP' }), page.getByRole('checkbox', { name: 'RRSP', includeHidden: true }))).check()
    await (await prepareProfessionalTarget(page.getByRole('checkbox', { name: /Non-registered/ }), page.getByRole('checkbox', { name: /Non-registered/, includeHidden: true }))).check()
  } else if (pageId === 'home.situation') await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'Rent' }), page.getByRole('radio', { name: 'Rent', includeHidden: true }))).check()
  else if (pageId === 'housing.other') {
    await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'No rental property' }), page.getByRole('radio', { name: 'No rental property', includeHidden: true }))).check()
    await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'No other loans' }), page.getByRole('radio', { name: 'No other loans', includeHidden: true }))).check()
  } else if (pageId === 'spending.method') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /overall budget/ }), page.getByRole('radio', { name: /overall budget/, includeHidden: true }))).check()
  else if (pageId === 'pension.self') await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'No employer pension' }), page.getByRole('radio', { name: 'No employer pension', includeHidden: true }))).check()
  else if (pageId === 'intent.legacy') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /do not need to reserve/ }), page.getByRole('radio', { name: /do not need to reserve/, includeHidden: true }))).check()
  else if (pageId === 'intent.spending') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /Keep my current/ }), page.getByRole('radio', { name: /Keep my current/, includeHidden: true }))).check()
  else if (pageId === 'invest.mix') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /Balanced 60\/40/ }), page.getByRole('radio', { name: /Balanced 60\/40/, includeHidden: true }))).check()
  else if (pageId === 'invest.strategy') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /Paced RRSP withdrawals/ }), page.getByRole('radio', { name: /Paced RRSP withdrawals/, includeHidden: true }))).check()
  else await confirmVisibleNumbers(page)
}

async function completeGuidedQuestionnaire(page: Page, targetChoice: 'yes' | 'no' = 'yes', budgetFacts: 'yes' | 'no' = 'yes') {
  const visited = new Set<string>()
  while (true) {
    const article = page.locator('.question-page')
    await expect(article).toBeVisible()
    const pageId = await article.getAttribute('data-page-id')
    if (!pageId) throw new Error('Question page is missing its stable ID')
    if (visited.has(pageId)) throw new Error(`Questionnaire loop detected at ${pageId}`)
    visited.add(pageId)
    await answerCurrentPage(page, pageId, targetChoice, budgetFacts)
    const next = page.locator('.question-pager button').last()
    if (await (await prepareProfessionalTarget(next)).innerText() === 'Review answers') { await (await prepareProfessionalTarget(next)).click(); break }
    await (await prepareProfessionalTarget(next)).click()
  }
  expect(visited.size).toBeGreaterThan(20)
  expect(visited.has('assumptions.review')).toBe(false)
}

test('guided mode completes a full UI flow and invalidates a stale result', async ({ page }) => {
  test.setTimeout(60_000)
  await expectMode(page, 'guided')
  await expect(page.locator('.results-column')).toHaveCount(0)
  await completeGuidedQuestionnaire(page)
  await expect(page.getByRole('heading', { name: 'Review your answers' })).toBeVisible()
  await expect(page.locator('.results-column')).toHaveCount(0)
  const generate = page.getByRole('button', { name: 'Generate my results' })
  if (await generate.isDisabled()) throw new Error(await (await prepareProfessionalTarget(page.locator('.review-blockers'))).innerText())
  await expect(generate).toBeEnabled()
  await (await prepareProfessionalTarget(generate)).click()
  await expect(page.getByRole('heading', { name: 'Your retirement projection' })).toBeVisible()
  await expect(page.locator('.results-column')).toBeVisible()
  await (await prepareProfessionalTarget(page.locator('.conclusion-estate > summary'))).press('Enter')
  await expect(page.locator('.conclusion-estate p').filter({ hasText: 'adds remaining registered balances' })).toBeVisible()
  const annual = page.getByRole('button', { name: 'Annual financial details' })
  await (await prepareProfessionalTarget(annual)).click()
  const annualDialog = page.getByRole('dialog', { name: 'Household annual estimate' })
  await expect(annualDialog).toBeVisible()
  const primaryAge = annualDialog.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Primary age/ }) })
  await expect(primaryAge.getByRole('cell').first()).toContainText('35')
  await page.keyboard.press('Escape')
  await expect(annualDialog).toBeHidden()
  await expect(annual).toBeFocused()
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: 'Will I hit my target?' }), page.getByRole('tab', { name: 'Will I hit my target?', includeHidden: true }))).click()
  await expect(page.locator('.target-field input')).toHaveValue('750,000')

  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Modify answers' }), page.getByRole('button', { name: 'Modify answers', includeHidden: true }))).click()
  await page.goto('/#/guided/family/family.ages')
  const age = page.getByLabel('Current age')
  await (await prepareProfessionalTarget(age)).fill('36')
  await expect(page.locator('.results-column')).toHaveCount(0)
  await page.goto('/#/guided/results')
  await expect(page.getByRole('heading', { name: 'Review your answers' })).toBeVisible()
  await expect(page.locator('.results-column')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Annual financial details', includeHidden: true })).toHaveCount(0)
  await (await prepareProfessionalTarget(generate)).click()
  await (await prepareProfessionalTarget(annual)).click()
  await expect(primaryAge.getByRole('cell').first()).toContainText('36')
})

test('PR-4 review controls, focus clearance and localized conclusions in both modes', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const evidence: unknown[] = []
  await completeGuidedQuestionnaire(page)
  for (const view of [
    { width: 1440, height: 1000, language: 'EN' },
    { width: 390, height: 844, language: 'EN' },
    { width: 320, height: 740, language: 'EN' },
    { width: 320, height: 740, language: 'FR' },
    { width: 390, height: 844, language: 'FR' },
    { width: 320, height: 740, language: '中文' },
    { width: 390, height: 844, language: '中文' },
  ]) {
    await page.setViewportSize({ width: view.width, height: view.height })
    await chooseMode(page, 'guided')
    await page.goto('/#/guided/review')
    await chooseLanguage(page, view.language)
    const generate = page.locator('.generate-results')
    await expect(generate).toBeEnabled()
    await page.evaluate(() => scrollTo(0, 0))
    await expect(generate).toBeInViewport({ ratio: 1 })
    evidence.push({ view, review: await page.locator('.generate-results').evaluate(button => ({ rect: button.getBoundingClientRect().toJSON(), disabled: (button as HTMLButtonElement).disabled, viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth })) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(view.width)
    const ledger = page.getByTestId('canonical-evidence')
    const ledgerTitle = { EN: 'Canonical annual ledger', FR: 'Registre annuel canonique', 中文: '标准年度账本' }[view.language]!
    await expect(ledger.locator('summary')).toHaveAccessibleName(ledgerTitle)
    await expect(ledger.locator('.canonical-optional')).toHaveText({ EN: 'Optional', FR: 'Facultatif', 中文: '可选' }[view.language]!)
    await expect(ledger.locator('.canonical-optional')).toBeVisible()
    await expect(ledger).not.toHaveAttribute('open')
    // The side date is a factual caption; the full source instruction remains in the rules disclosure.
    const date = await (await prepareProfessionalTarget(page.locator('.review-rule-date'))).innerText()
    expect(date).not.toMatch(/Open|Ouvrez|展开/)
    await expect(page.getByTestId('rule-assumptions-details').locator('summary')).toContainText({ EN: 'Open for the sources', FR: 'Ouvrez pour les sources', 中文: '展开查看来源' }[view.language]!)
    if (view.width <= 640) {
      expect((await generate.boundingBox())!.height).toBe(48)
      await expect(page.locator('.review-phone-summary')).toBeVisible()
      const edits = await page.locator('.review-category-list button, .review-assumption-row button').evaluateAll(buttons => buttons.map(button => {
        const rect = button.getBoundingClientRect(), row = button.parentElement!.getBoundingClientRect()
        const siblings = [...button.parentElement!.children].filter(el => el !== button).map(el => el.getBoundingClientRect())
        return { width: rect.width, height: rect.height, insideRow: rect.left >= row.left && rect.right <= row.right, overlaps: siblings.some(other => Math.min(rect.right, other.right) > Math.max(rect.left, other.left) && Math.min(rect.bottom, other.bottom) > Math.max(rect.top, other.top)) }
      }))
      for (const edit of edits) { expect(edit.width).toBeGreaterThanOrEqual(44); expect(edit.height).toBeGreaterThanOrEqual(44); expect(edit.insideRow).toBe(true); expect(edit.overlaps).toBe(false) }
      evidence.push({ view, edits })
      // Native focus must scroll the page-end Reset above the fixed action bar.
      await (await prepareProfessionalTarget(page.getByTestId('reset-plan'))).focus()
      const reset = (await (await prepareProfessionalTarget(page.getByTestId('reset-plan'))).boundingBox())!
      const bar = (await (await prepareProfessionalTarget(page.locator('.review-generate-bar'))).boundingBox())!
      expect(reset.y + reset.height).toBeLessThanOrEqual(bar.y)
      await (await prepareProfessionalTarget(page.getByTestId('reset-plan'))).click()
      await (await prepareProfessionalTarget(page.getByTestId('reset-cancel'))).click()
      await expect(page.getByTestId('reset-plan')).toBeFocused()
      await page.evaluate(() => scrollTo(0, 0))
    }
    await page.screenshot({ path: testInfo.outputPath(`review-${view.width}-${view.language}.png`) })
    await (await prepareProfessionalTarget(generate)).click()
    const intro = (await (await prepareProfessionalTarget(page.locator('.results-intro'))).boundingBox())!
    const card = (await (await prepareProfessionalTarget(page.locator('.summary'))).boundingBox())!
    expect(intro.x).toBe(card.x)
    expect(intro.width).toBe(card.width)
    await expect(page.locator('.results-intro h2')).toBeFocused()
    for (const mode of ['guided', 'professional'] as const) {
      if (mode === 'professional') await chooseMode(page, mode)
      if (mode === 'professional') {
        await expect(page.getByTestId('canonical-evidence').locator('.canonical-optional')).toHaveCount(0)
        await expect(page.getByTestId('canonical-evidence').locator('summary')).toHaveText(ledgerTitle)
      }
      if (mode === 'professional') await showProfessionalResults(page)
      const summary = page.locator('.summary')
      await (await prepareProfessionalTarget(summary)).scrollIntoViewIfNeeded()
      await expect(summary.locator('[role="tab"]')).toHaveCount(4)
      await expect(summary.locator('.conclusion-metrics dd')).toHaveCount(3)
      await (await prepareProfessionalTarget(summary.locator('[role="tab"]').first())).focus()
      await page.keyboard.press('End')
      await expect(summary.locator('[role="tab"]').last()).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Home')
      await expect(summary.locator('[role="tab"]').first()).toHaveAttribute('tabindex', '0')
      await page.keyboard.press('ArrowLeft')
      await expect(summary.locator('[role="tab"]').last()).toBeFocused()
      await page.keyboard.press('ArrowRight')
      await expect(summary.locator('[role="tab"]').first()).toBeFocused()
      const tabStyles = await summary.locator('[role="tab"]').evaluateAll(tabs => tabs.map(tab => {
        const css = getComputedStyle(tab)
        return { overflowWrap: css.overflowWrap, wordBreak: css.wordBreak, hyphens: css.hyphens, clipped: tab.scrollWidth > tab.clientWidth }
      }))
      expect(tabStyles).toEqual(Array(4).fill({ overflowWrap: 'normal', wordBreak: 'normal', hyphens: 'manual', clipped: false }))
      if (view.language === 'FR') {
        const splitWords = await summary.locator('[role="tab"]').evaluateAll(tabs => tabs.flatMap(tab => {
          const walker = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT)
          const split: string[] = []
          while (walker.nextNode()) {
            const node = walker.currentNode
            for (const match of (node.textContent ?? '').matchAll(/\p{L}[\p{L}\p{M}]*/gu)) {
              const range = document.createRange(); range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length)
              if (new Set(Array.from(range.getClientRects()).map(rect => rect.top)).size > 1) split.push(match[0])
            }
          }
          return split
        }))
        expect(splitWords, 'French alphabetic words remain whole within each tab').toEqual([])
      }
      if (view.width <= 640) {
        const boxes = await summary.locator('[role="tab"]').evaluateAll(tabs => tabs.map(tab => tab.getBoundingClientRect().top))
        expect(boxes[0]).toBe(boxes[1]); expect(boxes[2]).toBe(boxes[3]); expect(boxes[2]).toBeGreaterThan(boxes[0])
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(view.width)
      evidence.push({ view, mode, summary: await (await prepareProfessionalTarget(summary)).boundingBox(), tabStyles })
      await page.screenshot({ path: testInfo.outputPath(`results-${mode}-${view.width}-${view.language}.png`) })
    }
    await chooseLanguage(page, 'EN')
  }
  writeFileSync(testInfo.outputPath('metrics.json'), JSON.stringify(evidence, null, 2))
})

test('PR-4 blocked review keeps Generate visible and links every blocker to its question', async ({ page }) => {
  await page.goto('/#/guided/review')
  const generate = page.locator('.generate-results')
  await expect(generate).toBeDisabled()
  await expect(generate).toBeInViewport({ ratio: 1 })
  const items = page.locator('.review-blockers li')
  const count = await items.count()
  expect(count).toBeGreaterThan(0)
  await expect(page.locator('.review-counts dd').last()).toHaveText(String(count))
  await expect(generate).toHaveAttribute('aria-describedby', 'review-generate-blocked')
  await expect(page.locator('#review-generate-blocked')).toContainText(String(count))
  await (await prepareProfessionalTarget(items.first().getByRole('button'), items.first().getByRole('button', { includeHidden: true }))).click()
  await expect(page.locator('#question-title')).toBeFocused()
  await expect(page).toHaveURL(/#\/guided\/family\//)
})

test('an answered-excluded budget basis labels the guided result as an estimate', async ({ page }) => {
  test.setTimeout(60_000)
  // Review fix B2. Answering both basis facts "No" records a figure the
  // projection still prices as net of the debt, so the guided result must be
  // the labelled estimate rather than a precise summary.
  await completeGuidedQuestionnaire(page, 'no', 'no')
  const generate = page.getByRole('button', { name: 'Generate my results' })
  if (await generate.isDisabled()) throw new Error(await (await prepareProfessionalTarget(page.locator('.review-blockers'))).innerText())
  await (await prepareProfessionalTarget(generate)).click()
  await expect(page.getByRole('heading', { name: 'Your retirement projection' })).toBeVisible()
  const estimate = page.getByTestId('legacy-estimate')
  await expect(estimate).toHaveCount(1)
  await expect(estimate).toContainText('estimate rather than a precise number')
  await expect(estimate).toContainText('Final net worth:')
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Annual financial details' }), page.getByRole('button', { name: 'Annual financial details', includeHidden: true }))).click()
  const annual = page.getByRole('dialog', { name: 'Household annual estimate' })
  await expect(annual).toHaveAccessibleDescription(/saving basis you recorded leaves out a component this projection still treats as included/i)
  await expect(annual).not.toHaveAccessibleDescription(/budgetBasisExcluded|debtExcluded|taxBenefitExcluded|ownershipNeedsConfirmation/)
  await page.keyboard.press('Escape')
  await expect(annual).toBeHidden()
  // The recorded basis is what the user answered, and it stays on the plan.
  await expect(page.locator('.summary')).not.toContainText('modeled balance lasts')
})

test('guided users may leave the personal target unset and add it from results', async ({ page }) => {
  test.setTimeout(60_000)
  await completeGuidedQuestionnaire(page, 'no')
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Generate my results' }), page.getByRole('button', { name: 'Generate my results', includeHidden: true }))).click()
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: 'Will I hit my target?' }), page.getByRole('tab', { name: 'Will I hit my target?', includeHidden: true }))).click()
  await expect(page.locator('.target-field input')).toBeEmpty()
  await expect(page.getByText('You did not set a personal asset target')).toBeVisible()
  await (await prepareProfessionalTarget(page.locator('.target-field input'))).fill('900000')
  await expect(page.locator('.results-column')).toBeVisible()
  await expect(page.locator('.target-field input')).toHaveValue('900,000')
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Modify answers' }), page.getByRole('button', { name: 'Modify answers', includeHidden: true }))).click()
  await page.goto('/#/guided/family/time.work')
  await expect(page.getByRole('radio', { name: 'I have my own asset target' })).toBeChecked()
  await expect(page.locator('[data-field="fireTargetAssets"] input')).toHaveValue('900,000')
})

test('a working plan with non-registered money gets a labelled FIRE-number estimate, never a false one, in both modes', async ({ page }) => {
  test.setTimeout(60_000)
  await completeGuidedQuestionnaire(page, 'no')
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Generate my results' }), page.getByRole('button', { name: 'Generate my results', includeHidden: true }))).click()
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Modify answers' }), page.getByRole('button', { name: 'Modify answers', includeHidden: true }))).click()
  await page.goto('/#/guided/spending/spending.total')
  await (await prepareProfessionalTarget(page.locator('[data-field="retirementSpending"] input'))).fill('20000000')
  await page.goto('/#/guided/review')
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Generate my results' }), page.getByRole('button', { name: 'Generate my results', includeHidden: true }))).click()
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: "What's my FIRE number?" }), page.getByRole('tab', { name: "What's my FIRE number?", includeHidden: true }))).click()
  // BE-42: the answer, if any, is labelled as priced from the projected
  // FIRE-year basis and the summary is never styled as a verified success.
  const summary = page.locator('.summary')
  await expect(summary).not.toHaveClass(/\bok\b/)
  if (await summary.getByText('Your FIRE number:').count()) await expect(page.getByTestId('fire-number-projected')).toBeVisible()

  await chooseMode(page, 'professional')
  await showProfessionalResults(page)
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: "What's my FIRE number?" }), page.getByRole('tab', { name: "What's my FIRE number?", includeHidden: true }))).click()
  await expect(page.locator('.summary')).not.toHaveClass(/\bok\b/)
  if (await page.locator('.summary').getByText('Your FIRE number:').count()) await expect(page.getByTestId('fire-number-projected')).toBeVisible()
  await expect(page.locator('.results-column')).not.toContainText('NaN')
  await expect(page.locator('.results-column')).not.toContainText('Infinity')
})

test('language choices are unobstructed through the responsive app bar', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  for (const width of [320, 640, 760, 761, 800, 900, 1100, 1280, 1320, 1440]) {
    await page.setViewportSize({ width, height: 800 })
    await chooseLanguage(page, 'EN')
    const languages = await openLanguages(page)
    const chinese = languages.getByRole('button', { name: '中文' })
    const exposed = await chinese.evaluate((button) => {
      const bounds = button.getBoundingClientRect()
      const hit = document.elementFromPoint(bounds.right - 6, bounds.top + 6)
      return button === hit || button.contains(hit)
    })
    expect(exposed, `Chinese button is covered at ${width}px`).toBe(true)
    await (await prepareProfessionalTarget(chinese)).click({ position: { x: (await (await prepareProfessionalTarget(chinese)).boundingBox())!.width - 6, y: 6 } })
    const selectedLanguages = await openLanguages(page)
    await expect(selectedLanguages.getByRole('button', { name: '中文' })).toHaveAttribute('aria-pressed', 'true')
    if (await page.getByTestId('app-language').isVisible()) await page.keyboard.press('Escape')
  }
})

test('question help follows the current page within one category', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  // Locale bundles load asynchronously. Exercise a slow bundle without treating a completed click as a completed switch.
  await page.route('**/src/i18n/zh.json*', async route => {
    await new Promise(resolve => setTimeout(resolve, 200))
    await route.continue()
  })
  await chooseLanguage(page, '中文')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans')
  await expect(page.getByRole('button', { name: '中文' })).toHaveAttribute('aria-pressed', 'true')

  const help = page.locator('.question-help')
  await (await prepareProfessionalTarget(help.locator('summary'))).press('Enter')
  await expect(help).toContainText('家庭人数')
  const householdHelp = await (await prepareProfessionalTarget(help)).innerText()
  expect(householdHelp).toContain('家庭人数')

  await (await prepareProfessionalTarget(page.locator('.question-pager button').last())).click()
  await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'family.ages')
  if (!(await help.evaluate((element) => element.hasAttribute('open')))) await (await prepareProfessionalTarget(help.locator('summary'))).press('Enter')
  const agesHelp = await (await prepareProfessionalTarget(help)).innerText()
  expect(agesHelp).toContain('出生日期')
  expect(agesHelp).not.toBe(householdHelp)

  await (await prepareProfessionalTarget(page.locator('.question-pager button').last())).click()
  await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'family.children')
  if (!(await help.evaluate((element) => element.hasAttribute('open')))) await (await prepareProfessionalTarget(help.locator('summary'))).press('Enter')
  const childrenHelp = await (await prepareProfessionalTarget(help)).innerText()
  expect(childrenHelp).toContain('18岁')
  expect(childrenHelp).not.toBe(agesHelp)
})

test('account selection explains the role of every account', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await page.goto('/#/guided/assets/assets.identify')
  await chooseLanguage(page, '中文')

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
  await chooseLanguage(page, '中文')

  await expect(page.getByRole('heading', { name: '未来新增储蓄准备如何分配到各账户？' })).toBeVisible()
  await expect(page.locator('[data-field^="savingsSplit."]')).toHaveCount(3)
  await expect(page.locator('.allocation-total')).toContainText('合计 100%')
  await expect(page.locator('.allocation-total')).toContainText('三个比例合计为100%')

  // The example split is 15/45/40 (FE-40: the example TFSA stays under the 2026 limit).
  await (await prepareProfessionalTarget(page.locator('[data-field="savingsSplit.nonReg"] input'))).fill('30')
  await expect(page.locator('.allocation-total')).toContainText('合计 90%')
  await expect(page.locator('.allocation-total')).toContainText('还需要分配 10 个百分点')

  await (await prepareProfessionalTarget(page.locator('[data-field="savingsSplit.nonReg"] input'))).fill('40')
  await expect(page.locator('.allocation-total')).toHaveClass(/complete/)
})

test('non-registered value and cost base share one page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await page.goto('/#/guided/assets/assets.identify')
  await (await prepareProfessionalTarget(page.getByRole('checkbox', { name: 'Non-registered account', exact: true }), page.getByRole('checkbox', { name: 'Non-registered account', exact: true, includeHidden: true }))).check()
  await page.goto('/#/guided/assets/account.nonReg.balance')
  await chooseLanguage(page, '中文')

  await expect(page.getByRole('heading', { name: '非注册投资现在值多少，成本基础是多少？' })).toBeVisible()
  await expect(page.locator('[data-field="balances.nonReg"]')).toBeVisible()
  await expect(page.locator('[data-field="nonRegBook"]')).toBeVisible()
  await (await prepareProfessionalTarget(page.locator('[data-field="balances.nonReg"] input'))).fill('100000')
  await (await prepareProfessionalTarget(page.locator('[data-field="nonRegBook"] input'))).fill('80000')
  await expect(page.locator('.answer-feedback')).toContainText('账面变动为 CA$20,000')
  await expect(page.locator('.answer-feedback')).toContainText('都不是税额')
})

test('intent recommendation updates inline without a confirmation page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await page.goto('/#/guided/preferences/intent.legacy')
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: /do not need to reserve/ }), page.getByRole('radio', { name: /do not need to reserve/, includeHidden: true }))).check()
  await page.goto('/#/guided/preferences/intent.spending')
  await chooseLanguage(page, '中文')

  await (await prepareProfessionalTarget(page.getByRole('radio', { name: '查看理论支出上限' }), page.getByRole('radio', { name: '查看理论支出上限', includeHidden: true }))).check()
  await expect(page.locator('.intent-recommendation')).toContainText('根据你的选择，结果会这样比较')
  await expect(page.locator('.intent-recommendation')).toContainText('不改变当前预算，另行查看理论支出上限')
  await expect(page.getByRole('button', { name: /确认|返回修改偏好/ })).toHaveCount(0)

  await page.goto('/#/guided/preferences/intent.confirm')
  await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'intent.spending')
})

test('investment mix explains annual real return percentages', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await page.goto('/#/guided/preferences/invest.mix')
  await chooseLanguage(page, '中文')

  const explanation = page.locator('.mix-return-explanation')
  await expect(explanation).toContainText('长期预计的年均实际收益率')
  await expect(explanation).toContainText('已经扣除通胀影响')
  await expect(explanation).toContainText('投资费用（MER）尚未扣除')
  await expect(page.locator('.choice-group small')).toHaveCount(5)
  await expect(page.getByText('预计年均实际收益：3.7%')).toBeVisible()
  await expect(page.getByText('预计年均实际收益：2.4%')).toBeVisible()
})

test('each withdrawal order explains its account sequence and trade-off', async ({ page }) => {
  await page.goto('/#/guided/preferences/invest.strategy')
  await chooseLanguage(page, '中文')

  const cards = page.locator('.strategy-question .choice-group label')
  await expect(cards).toHaveCount(4)
  await expect(cards.nth(0)).toContainText('不足依次用非注册→TFSA，仍不够再取 RRSP')
  await expect(cards.nth(0)).toContainText('当前：最低税阶')
  await expect(cards.nth(1)).toContainText('非注册→RRSP→TFSA')
  await expect(cards.nth(2)).toContainText('TFSA→非注册→RRSP')
  await expect(cards.nth(3)).toContainText('之后才用非注册→TFSA')
  await expect(page.locator('.strategy-source a')).toHaveCount(5)
  await expect(page.getByText('没有适合所有人的固定最优顺序', { exact: false })).toBeVisible()

  for (const card of await cards.all()) {
    await (await prepareProfessionalTarget(card)).click()
    await expect(card.locator('input')).toBeChecked()
  }
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }))
  expect(widths.document).toBeLessThanOrEqual(widths.viewport)
})

test('fee and inflation presets are sourced examples, independently editable and persisted', async ({ page }) => {
  await page.goto('/#/guided/preferences/invest.fees')
  await chooseLanguage(page, '中文')

  const fee = page.locator('[data-field="fees"] input')
  const inflation = page.locator('[data-field="inflation"] input')
  const managed = page.getByRole('button', { name: '代管 ETF 组合 · 0.65%' })
  const fpCanada = page.getByRole('button', { name: 'FP Canada 2026 · 2.1%' })
  await expect(managed).toHaveAttribute('aria-pressed', 'false')
  await (await prepareProfessionalTarget(managed)).click()
  await expect(fee).toHaveValue('0.65')
  await expect(inflation).toHaveValue('2.1')
  await expect(managed).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-field="fees"] small')).toContainText('估算')
  await expect(fpCanada).toHaveAttribute('aria-pressed', 'false')

  await (await prepareProfessionalTarget(page.getByRole('button', { name: '偏高通胀情景 · 3.0%' }), page.getByRole('button', { name: '偏高通胀情景 · 3.0%', includeHidden: true }))).click()
  await expect(inflation).toHaveValue('3')
  await (await prepareProfessionalTarget(fee)).fill('0.8')
  await expect(managed).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-field="fees"] small')).toContainText('已确认')
  await page.reload()
  await expect(fee).toHaveValue('0.8')
  await expect(inflation).toHaveValue('3')
  await expect(page.locator('.assumption-source a')).toHaveCount(6)
})

test('tax assumptions explain both inputs and update the worked example', async ({ page }) => {
  await page.goto('/#/guided/preferences/invest.tax')
  await chooseLanguage(page, '中文')

  await expect(page.getByRole('heading', { name: '非注册投资每年产生多少应税收入？按什么税率估算？' })).toBeVisible()
  await expect(page.getByText('未卖出的市值上涨不算在这里。', { exact: false })).toBeVisible()
  await expect(page.getByText('不是你全年收入的平均税率。', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: '加拿大税务局的基金税务说明' })).toHaveAttribute('href', /canada\.ca/)
  await expect(page.getByRole('link', { name: '加拿大税务局税档' })).toHaveAttribute('href', /canada\.ca/)

  const example = page.locator('.tax-worked-example')
  await expect(example).toContainText('CA$2,000')
  await expect(example).toContainText('CA$700')
  await (await prepareProfessionalTarget(page.locator('[data-field="nonRegDistributionYield"] input'))).fill('3')
  await (await prepareProfessionalTarget(page.locator('[data-field="accumulationMarginalRate"] input'))).fill('40')
  await expect(example).toContainText('CA$3,000')
  await expect(example).toContainText('CA$1,200')
  await page.reload()
  await expect(example).toContainText('CA$1,200')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})

test('applying the CPP work-history estimate records an estimate, and age choices explain the trade-off', async ({ page }) => {
  await page.goto('/#/guided/income/cpp.self')
  await chooseLanguage(page, '中文')

  const amount = page.locator('[data-field="cppAnnualAt65"]')
  const age = page.locator('[data-field="cppStartAge"]')
  await expect(amount.locator('small')).toHaveText('示例')
  await expect(age.locator('small')).toHaveText('示例')
  await expect(page.getByRole('heading', { name: '不知道选几岁？先比较这三种情形' })).toBeVisible()
  await expect(page.getByRole('radio', { name: /65 岁 · 先用作比较基准/ })).not.toBeChecked()
  await expect(page.getByRole('radio', { name: /72 岁/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '查看官方开领说明' })).toHaveAttribute('href', /canada\.ca/)

  await (await prepareProfessionalTarget(page.locator('.estimator summary'))).press('Enter')
  await (await prepareProfessionalTarget(page.locator('.estimator').getByRole('button', { name: '应用' }), page.locator('.estimator').getByRole('button', { name: '应用', includeHidden: true }))).click()
  // round 3 / BL1: applying an estimator invokes a computation, so the amount
  // reads 估算 (estimate), not 已确认 (confirmed)
  await expect(amount.locator('small')).toHaveText('估算')
  await expect(amount.locator('input')).not.toHaveValue('10000')
  await expect(page.locator('.benefit-estimate-note')).toContainText('不代表政府核定')
  await expect(age.locator('small')).toHaveText('示例')

  await (await prepareProfessionalTarget(page.getByRole('radio', { name: /70 岁 · 延后领取/ }), page.getByRole('radio', { name: /70 岁 · 延后领取/, includeHidden: true }))).check()
  await expect(age.locator('input')).toHaveValue('70')
  await expect(age.locator('small')).toHaveText('已确认')
  await (await prepareProfessionalTarget(age.locator('input'))).fill('68')
  await expect(page.getByRole('radio', { name: /70 岁 · 延后领取/ })).not.toBeChecked()
  await page.reload()
  await expect(amount.locator('small')).toHaveText('估算')
  await expect(age.locator('input')).toHaveValue('68')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
})

test('the OAS estimate is recorded as an estimate while claim-age options confirm the planning inputs', async ({ page }) => {
  await page.goto('/#/guided/income/oas.self')
  await chooseLanguage(page, '中文')

  const amount = page.locator('[data-field="oasAnnualAt65"]')
  const age = page.locator('[data-field="oasStartAge"]')
  await expect(amount.locator('small')).toHaveText('示例')
  await expect(age.locator('small')).toHaveText('示例')
  await (await prepareProfessionalTarget(page.locator('.estimator summary'))).press('Enter')
  await (await prepareProfessionalTarget(page.locator('.estimator input'))).fill('32')
  await (await prepareProfessionalTarget(page.locator('.estimator').getByRole('button', { name: '应用' }), page.locator('.estimator').getByRole('button', { name: '应用', includeHidden: true }))).click()
  await expect(amount.locator('input')).toHaveValue('7,320')
  await expect(amount.locator('small')).toHaveText('估算')
  await expect(age.locator('small')).toHaveText('示例')
  await expect(page.locator('.benefit-estimate-note')).toContainText('不代表政府核定')
  await expect(page.getByRole('heading', { name: '不知道选几岁？先比较这三种情形' })).toBeVisible()
  await expect(page.getByRole('radio', { name: /65 岁 · 尽早领取/ })).not.toBeChecked()
  await expect(page.getByRole('radio', { name: /60 岁/ })).toHaveCount(0)
  await expect(page.locator('.benefit-age-guide')).toContainText('延后 OAS 期间不能领 GIS')
  await expect(page.locator('.benefit-age-guide')).toContainText('不自动计入额外居住年数')
  await expect(page.getByRole('link', { name: '查看加拿大政府开领说明' })).toHaveAttribute('href', /canada\.ca\/en\/services\/benefits\/publicpensions\/old-age-security\/when-start/)
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: /65 岁 · 尽早领取/ }), page.getByRole('radio', { name: /65 岁 · 尽早领取/, includeHidden: true }))).check()
  await expect(age.locator('small')).toHaveText('已确认')
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: /67 岁 · 延后两年/ }), page.getByRole('radio', { name: /67 岁 · 延后两年/, includeHidden: true }))).check()
  await expect(age.locator('input')).toHaveValue('67')
  await (await prepareProfessionalTarget(age.locator('input'))).fill('68')
  await expect(page.getByRole('radio', { name: /67 岁 · 延后两年/ })).not.toBeChecked()
  await page.reload()
  await expect(amount.locator('small')).toHaveText('估算')
  await expect(amount.locator('input')).toHaveValue('7,320')
  await expect(age.locator('input')).toHaveValue('68')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
})

test('partner OAS estimate and claim-age options update partner fields', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await page.goto('/#/guided/family/family.people')
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: /Plan with my partner/ }), page.getByRole('radio', { name: /Plan with my partner/, includeHidden: true }))).check()
  await page.goto('/#/guided/income/oas.partner')
  await chooseLanguage(page, '中文')

  const amount = page.locator('[data-field="partner.oasAnnualAt65"]')
  await (await prepareProfessionalTarget(page.locator('.estimator summary'))).press('Enter')
  await (await prepareProfessionalTarget(page.locator('.estimator input'))).fill('32')
  await (await prepareProfessionalTarget(page.locator('.estimator').getByRole('button', { name: '应用' }), page.locator('.estimator').getByRole('button', { name: '应用', includeHidden: true }))).click()
  await expect(amount.locator('input')).toHaveValue('7,320')
  await expect(amount.locator('small')).toHaveText('估算')
  const age = page.locator('[data-field="partner.oasStartAge"]')
  await expect(age.locator('small')).toHaveText('示例')
  await expect(page.getByRole('radio', { name: /70 岁 · 延后五年/ })).toBeVisible()
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: /70 岁 · 延后五年/ }), page.getByRole('radio', { name: /70 岁 · 延后五年/, includeHidden: true }))).check()
  await expect(age.locator('input')).toHaveValue('70')
  await expect(age.locator('small')).toHaveText('已确认')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(saved.inputs.partner.oasStartAge).toBe(70)
  expect(saved.inputs.oasStartAge).toBe(65)
})

test('Québec QPP offers age 72 guidance for both household members', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await page.goto('/#/guided/family/family.people')
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: /Plan with my partner/ }), page.getByRole('radio', { name: /Plan with my partner/, includeHidden: true }))).check()
  await page.goto('/#/guided/family/family.province')
  await (await prepareProfessionalTarget(page.getByLabel('Province'))).selectOption('QC')
  await page.goto('/#/guided/income/cpp.partner')
  await chooseLanguage(page, '中文')

  await expect(page.getByRole('heading', { name: '不知道选几岁？先比较这四种情形' })).toBeVisible()
  await expect(page.getByRole('radio', { name: /72 岁 · 魁省 QPP/ })).toBeVisible()
  await expect(page.getByRole('link', { name: '查看官方开领说明' })).toHaveAttribute('href', /retraitequebec\.gouv\.qc\.ca/)
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: /72 岁 · 魁省 QPP/ }), page.getByRole('radio', { name: /72 岁 · 魁省 QPP/, includeHidden: true }))).check()
  await expect(page.locator('[data-field="partner.cppStartAge"] input')).toHaveValue('72')
  await expect(page.locator('[data-field="partner.cppStartAge"] small')).toHaveText('已确认')
  await (await prepareProfessionalTarget(page.locator('.estimator summary'))).press('Enter')
  await (await prepareProfessionalTarget(page.locator('.estimator').getByRole('button', { name: '应用' }), page.locator('.estimator').getByRole('button', { name: '应用', includeHidden: true }))).click()
  await expect(page.locator('[data-field="partner.cppAnnualAt65"] small')).toHaveText('估算')
})

test('final review replaces the redundant assumption page without overwriting confirmed answers', async ({ page }) => {
  await page.goto('/#/guided/preferences/invest.fees')
  await chooseLanguage(page, '中文')
  await (await prepareProfessionalTarget(page.locator('[data-field="fees"] input'))).fill('0.8')
  await (await prepareProfessionalTarget(page.getByRole('button', { name: '加拿大央行目标 · 2.0%' }), page.getByRole('button', { name: '加拿大央行目标 · 2.0%', includeHidden: true }))).click()
  await page.goto('/#/guided/preferences/invest.strategy')
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: /RRSP 分段提取/ }), page.getByRole('radio', { name: /RRSP 分段提取/, includeHidden: true }))).check()
  // FE-43 C: an optional tax-details category follows; skipping it goes straight to the review.
  await (await prepareProfessionalTarget(page.locator('.question-pager button').last())).click()
  await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'tax.intro')
  await (await prepareProfessionalTarget(page.getByTestId('guided-tax-intro-choice-skip'))).check()
  await (await prepareProfessionalTarget(page.locator('.question-pager').getByRole('button', { name: '核对答案' }), page.locator('.question-pager').getByRole('button', { name: '核对答案', includeHidden: true }))).click()

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

  await (await prepareProfessionalTarget(page.getByRole('button', { name: '修改费用与通胀' }), page.getByRole('button', { name: '修改费用与通胀', includeHidden: true }))).click()
  await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'invest.fees')
  await page.goto('/#/guided/preferences/assumptions.review')
  await expect(page.getByRole('heading', { name: '核对你的答案' })).toBeVisible()
})

test('professional mode runs its full immediate-results UI flow', async ({ page }) => {
  await chooseMode(page, 'professional')
  await expect(page.locator('.input-form .professional-group')).toHaveCount(7)
  const field = (label: string) => page.locator('label.field').filter({ hasText: label }).locator('input, select').first()
  await (await prepareProfessionalTarget(field('Current age'))).fill('40')
  await (await prepareProfessionalTarget(field('Target FIRE age'))).fill('55')
  await revealProfessionalEditor(page, field('Desired after-tax annual spending in retirement'))
  await (await prepareProfessionalTarget(field('Desired after-tax annual spending in retirement'))).fill('60000')
  await showProfessionalResults(page)
  await expect(page.locator('.results-column')).toBeVisible()
  await expect(page.locator('.results-column .summary')).toBeVisible()
  await expect(page.locator('.recharts-responsive-container').first()).toBeVisible()
})

test('legacy v6 stores retain professional mode', async ({ page }) => {
  await chooseMode(page, 'professional')
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
  await expectMode(page, 'professional')
  await showProfessionalResults(page)
  await expect(page.locator('.results-column')).toBeVisible()
})

test('guided flow does not overflow at 320px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-320')
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }))
  expect(widths.document).toBeLessThanOrEqual(widths.viewport)
})
