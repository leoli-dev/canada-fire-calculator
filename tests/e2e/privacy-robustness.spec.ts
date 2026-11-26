import { prepareProfessionalTarget } from './fixtures/professional'
import { showProfessionalResults } from './fixtures/professional'
import { chooseMode } from './fixtures/app-bar'
import { expect, test } from '@playwright/test'

async function fresh(page: import('@playwright/test').Page, globalPrivacyControl = false) {
  // Thorium enables DNT and GPC by default. Exercise each intended signal explicitly.
  await page.addInitScript(gpc => {
    Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '0' })
    Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => gpc })
  }, globalPrivacyControl)
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
}

test('usage statistics stay off until allowed, and the answer can be changed', async ({ page }) => {
  await fresh(page)
  const prompt = page.getByTestId('analytics-prompt')
  const footer = page.getByTestId('analytics-footer')
  await expect((await prepareProfessionalTarget(prompt))).toBeVisible()
  await expect((await prepareProfessionalTarget(footer))).toContainText('Anonymous usage statistics are off.')
  expect(await page.evaluate(() => typeof window.gtag)).toBe('undefined')
  await (await prepareProfessionalTarget(prompt.getByRole('button', { name: 'No thanks' }))).click()
  await expect(prompt).toHaveCount(0)
  await page.reload()
  await expect(prompt).toHaveCount(0)
  await (await prepareProfessionalTarget(footer.getByRole('button', { name: 'Allow them' }))).click()
  await expect((await prepareProfessionalTarget(footer))).toContainText('Anonymous usage statistics are on.')
  await (await prepareProfessionalTarget(footer.getByRole('button', { name: 'Turn them off' }))).click()
  await expect((await prepareProfessionalTarget(footer))).toContainText('Anonymous usage statistics are off.')
})

test('a Global Privacy Control signal is a refusal that is never asked about', async ({ page }) => {
  await fresh(page, true)
  await expect(page.getByTestId('analytics-prompt')).toHaveCount(0)
  await expect((await prepareProfessionalTarget(page.getByTestId('analytics-footer')))).toContainText('usage statistics stay off')
})

test('blocked site storage still starts the calculator and says the plan is not saved', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '0' })
    Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => false })
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Access is denied', 'SecurityError') } })
  })
  await page.goto('/')
  await expect((await prepareProfessionalTarget(page.getByTestId('storage-unavailable')))).toBeVisible()
  await chooseMode(page, 'professional')
  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: 'Current age' }).locator('input'))).fill('40')
  await showProfessionalResults(page)
  await expect((await prepareProfessionalTarget(page.locator('.results-column')))).toBeVisible()
  // The consent answer holds for the session even though it cannot be stored.
  await (await prepareProfessionalTarget(page.getByTestId('analytics-prompt').getByRole('button', { name: 'No thanks' }))).click()
  await expect(page.getByTestId('analytics-prompt')).toHaveCount(0)
})

test('the page carries a description and share preview', async ({ page }) => {
  await page.goto('/')
  await expect((await prepareProfessionalTarget(page.locator('meta[name="description"]')))).toHaveAttribute('content', /FIRE/)
  await expect((await prepareProfessionalTarget(page.locator('meta[property="og:title"]')))).toHaveAttribute('content', 'Canada FIRE Calculator')
  await expect((await prepareProfessionalTarget(page.locator('meta[property="og:description"]')))).toHaveAttribute('content', /TFSA/)
  await expect((await prepareProfessionalTarget(page.locator('meta[name="twitter:card"]')))).toHaveAttribute('content', 'summary')
})

test('on a phone the headline sits above the form and every result question fits', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-320')
  await fresh(page)
  await chooseMode(page, 'professional')
  const peek = page.getByTestId('result-peek')
  await expect((await prepareProfessionalTarget(peek))).toBeInViewport()
  const verdict = (await (await prepareProfessionalTarget(page.locator('.summary .verdict').first())).innerText()).trim()
  await expect((await prepareProfessionalTarget(peek))).toContainText(verdict)
  await (await prepareProfessionalTarget(peek.getByRole('button', { name: 'See the full results' }))).click()
  await expect(page.locator('#results')).toBeFocused()
  const tabs = page.locator('.summary').getByRole('tab')
  await expect((await prepareProfessionalTarget(tabs))).toHaveCount(4)
  const width = page.viewportSize()!.width
  for (const box of await tabs.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON())))
    expect(box.right).toBeLessThanOrEqual(width)
})

test('the peek is hidden where results sit beside the form', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await fresh(page)
  await chooseMode(page, 'professional')
  await expect((await prepareProfessionalTarget(page.locator('.results-column')))).toBeVisible()
  await expect(page.getByTestId('result-peek')).toBeHidden()
})
