import { expect, test } from '@playwright/test'
import { chooseLanguage, chooseMode } from './fixtures/app-bar'
import { canonicalAppPlan } from './fixtures/canonical-app-plan'

test('Professional panes retain drafts, expose results in one tap and keep the conclusion after edits', async ({ page }, info) => {
  await page.goto('/')
  await chooseMode(page, 'professional')
  const phone = info.project.name === 'mobile-320'
  const pane = page.locator('.professional-input-pane')
  const age = page.locator('label.field').filter({ hasText: /^Current age/ }).locator('input')
  await age.fill('36')
  await expect(age).toHaveValue('36')
  if (phone) {
    const tabs = page.getByRole('tablist', { name: 'Plan views' })
    await pane.evaluate(element => { element.scrollTop = 220 })
    const inputScroll = await pane.evaluate(element => element.scrollTop)
    await tabs.getByRole('tab', { name: 'Results', exact: true }).click()
    await expect(page.locator('.results-column')).toBeVisible()
    await expect(page.locator('.summary')).toBeInViewport()
    await page.locator('.results-column').evaluate(element => { element.scrollTop = 500 })
    const resultScroll = await page.locator('.results-column').evaluate(element => element.scrollTop)
    await tabs.getByRole('tab', { name: 'Inputs', exact: true }).click()
    await expect.poll(() => pane.evaluate(element => element.scrollTop)).toBe(inputScroll)
    await tabs.getByRole('tab', { name: 'Results', exact: true }).click()
    await expect.poll(() => page.locator('.results-column').evaluate(element => element.scrollTop)).toBe(resultScroll)
    await tabs.getByRole('tab', { name: 'Inputs', exact: true }).click()
    await pane.evaluate(element => { element.scrollTop = 0 })
    await page.getByRole('button', { name: 'See the full results' }).click()
    await expect(page.locator('#results')).toBeFocused()
    await expect.poll(() => page.locator('#results').evaluate(element => element.scrollTop)).toBe(0)
    await tabs.getByRole('tab', { name: 'Inputs', exact: true }).click()
  } else {
    expect((await pane.boundingBox())!.width).toBe(400)
    await page.locator('.results-column').evaluate(element => { element.scrollTop = 700 })
    await age.fill('37')
    await expect(page.locator('.summary .verdict')).toBeInViewport()
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  }
  await age.fill('-')
  await page.reload()
  await expect(age).toHaveValue('-')
})

test('search, collapse, named groups, source help and phone field dimensions', async ({ page }, info) => {
  await page.goto('/')
  await chooseMode(page, 'professional')
  await page.getByRole('searchbox', { name: 'Find a field' }).fill('Annual savings')
  const saving = page.locator('[data-group="saving"]')
  await expect(saving).toHaveAttribute('open', '')
  await expect(page.getByRole('group', { name: 'Saving and spending', exact: true })).toBeVisible()
  const help = page.getByTestId('professional-help-annualSavings').locator('.ui-field-help')
  await help.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  await page.keyboard.press('Escape')
  await expect(help).toBeFocused()
  await page.getByRole('button', { name: 'Collapse all' }).click()
  await expect(page.locator('.professional-group[open]')).toHaveCount(0)
  await expect(page.locator('.professional-group')).toHaveCount(7)
  for (const group of await page.locator('.professional-group').all()) {
    await group.locator(':scope > summary').click()
    if (info.project.name === 'mobile-320') {
      await expect(page.locator('.professional-group[open]')).toHaveCount(1)
      const issues = await group.locator('input:visible, select:visible, textarea:visible').evaluateAll(fields => fields.filter(field => parseFloat(getComputedStyle(field).fontSize) < 16 || field.getBoundingClientRect().height < 48).map(field => field.outerHTML))
      expect(issues).toEqual([])
    }
  }
  const profile = page.locator('[data-group="profile"]')
  if (!(await profile.evaluate(element => (element as HTMLDetailsElement).open))) await profile.locator(':scope > summary').click()
  const choices = profile.getByRole('button', { name: 'All choices', exact: true }).first()
  await choices.click()
  await page.getByRole('dialog').getByRole('button', { name: /NL.*Newfoundland/ }).click()
  await expect(profile.locator('select').first()).toHaveValue('NL')
  await expect(choices).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const language of ['FR', '中文']) test(`Professional ${language} has no overflow and styled controls`, async ({ page }) => {
  await page.goto('/')
  await chooseLanguage(page, language)
  await chooseMode(page, 'professional')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator('button:visible').evaluateAll(buttons => buttons.filter(button => !button.matches('.ui-button, .ui-choice')).map(button => button.textContent))).toEqual([])
})

for (const variant of ['settled', 'partial', 'unsupported-province'] as const) test(`canonical ${variant} keeps its distinct result and phone conclusion entry`, async ({ page }, info) => {
  await page.addInitScript(plan => localStorage.setItem('fire-inputs', JSON.stringify(plan)), canonicalAppPlan(variant))
  await page.goto('/')
  if (info.project.name === 'mobile-320') {
    await page.getByRole('button', { name: 'See the full results' }).click()
    await expect(page.locator('#results')).toBeFocused()
  }
  await expect(page.getByTestId('canonical-results')).toBeVisible()
  await expect(page.locator('.summary')).toHaveCount(0)
  await expect(page.getByTestId('canonical-status')).toBeVisible()
})

test('phone Guided Answers returns to review and Results reuses the current plan', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const plan = canonicalAppPlan()
  Object.assign(plan.state, { entryMode: 'guided', guidedView: 'results', resultRevision: 23 })
  await page.addInitScript(value => localStorage.setItem('fire-inputs', JSON.stringify(value)), plan)
  await page.goto('/#/guided/results')
  const before = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('fire-inputs')!).state; return { inputs: s.inputs, canonical: s.canonical, inputRevision: s.inputRevision, resultRevision: s.resultRevision } })
  await page.getByRole('tab', { name: 'Answers', exact: true }).click()
  await expect(page.locator('.answer-review')).toBeVisible()
  await expect(page.locator('.answer-review h2')).toBeFocused()
  await page.getByRole('tab', { name: 'Results', exact: true }).click()
  await expect(page.getByTestId('canonical-results')).toBeVisible()
  const after = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('fire-inputs')!).state; return { inputs: s.inputs, canonical: s.canonical, inputRevision: s.inputRevision, resultRevision: s.resultRevision } })
  expect(after).toEqual(before)
})

test('read-only plans keep the original notice, download and privacy entry with an unavailable result', async ({ page }, info) => {
  const original = JSON.stringify({ version: 999, state: { original: 'Keep this saved plan' } })
  await page.addInitScript(value => localStorage.setItem('fire-inputs', value), original)
  await page.goto('/')
  await chooseMode(page, 'professional')
  await expect(page.getByRole('alert')).toContainText('It is read-only here')
  await expect(page.getByRole('button', { name: 'Download original saved plan' })).toBeVisible()
  await expect(page.getByTestId('analytics-footer')).toBeVisible()
  if (info.project.name === 'mobile-320') await page.getByRole('tab', { name: 'Results', exact: true }).click()
  await expect(page.locator('.professional-results-unavailable')).toContainText('Results are unavailable')
  await expect(page.locator('.results-column')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('fire-inputs'))).toBe(original)
})
