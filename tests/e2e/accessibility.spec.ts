import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

/** Controls with no name from a label, aria-label or aria-labelledby. */
async function unnamedControls(page: import('@playwright/test').Page) {
  return page.evaluate(() => [...document.querySelectorAll('input, select, textarea')]
    .filter((el) => (el as HTMLInputElement).type !== 'hidden')
    .filter((el) => {
      const e = el as HTMLInputElement
      return !([...(e.labels ?? [])].some((l) => l.textContent?.trim()) || e.getAttribute('aria-label') || e.getAttribute('aria-labelledby'))
    })
    .map((el) => (el.closest('label, div')?.textContent ?? '').trim().slice(0, 60)))
}

test('every professional-mode control keeps its label when a glossary term sits inside it', async ({ page }) => {
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await page.locator('label.field').filter({ hasText: 'Household' }).locator('select').selectOption('couple')
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true }))
  await expect(page.locator('label.field').filter({ hasText: 'Target FIRE age' }).locator('input')).toBeVisible()
  expect(await unnamedControls(page)).toEqual([])
  // The label names the input, and the glossary term inside it still opens the glossary.
  await expect(page.getByRole('textbox', { name: 'Target FIRE age' })).toBeVisible()
  const term = page.locator('label.field').filter({ hasText: 'Target FIRE age' }).getByRole('button', { name: 'FIRE' })
  await term.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.drawer-backdrop')).toBeVisible()
})

test('the page language follows the selected language', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByRole('button', { name: 'FR', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  await page.getByRole('button', { name: '中文' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans')
})

test('result questions are tabs that control one labelled panel', async ({ page }) => {
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const tabs = page.getByRole('tablist', { name: 'Result question' })
  const first = tabs.getByRole('tab', { name: 'Will my money last?' })
  await expect(first).toHaveAttribute('aria-selected', 'true')
  await expect(first).toHaveAttribute('aria-controls', 'mode-panel')
  await expect(page.getByRole('tabpanel', { name: 'Will my money last?' })).toBeVisible()
  await first.focus()
  await page.keyboard.press('ArrowRight')
  const when = tabs.getByRole('tab', { name: 'When can I retire?' })
  await expect(when).toBeFocused()
  await expect(when).toHaveAttribute('aria-selected', 'true')
  await expect(first).toHaveAttribute('tabindex', '-1')
  await expect(page.getByRole('tabpanel', { name: 'When can I retire?' })).toBeVisible()
  await page.keyboard.press('End')
  await expect(tabs.getByRole('tab', { name: "Will I hit my target?" })).toBeFocused()
})

test('charts are described in words', async ({ page }) => {
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const chart = page.getByRole('img', { name: 'Account balances by age' })
  await expect(chart).toHaveCount(1)
  const summaryId = await chart.getAttribute('aria-describedby')
  await expect(page.locator(`[id="${summaryId}"]`)).toContainText(/Net worth is .* at FIRE age/)
  await expect(page.getByRole('img', { name: 'Retirement income by source' }).first()).toHaveAttribute('aria-describedby', /.+/)
})

test('a guided answer is described by its sample or confirmed status', async ({ page }) => {
  await page.goto('/#/guided/family/family.ages')
  const input = page.locator('.question-answer input').first()
  const describedBy = (await input.getAttribute('aria-describedby')) ?? ''
  expect(describedBy).toContain('-status')
  await expect(page.locator(`[id="${describedBy.split(' ')[0]}"]`)).not.toBeEmpty()
})
