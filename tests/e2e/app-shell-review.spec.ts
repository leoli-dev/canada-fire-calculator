import { expect, test, type Page, type Locator } from '@playwright/test'
import { chooseLanguage, chooseMode } from './fixtures/app-bar'
import { canonicalAppPlan } from './fixtures/canonical-app-plan'

async function eligible(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '0' })
    Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => false })
  })
}
async function checkGlossary(page: Page, trigger: Locator, returnTo: Locator) {
  await trigger.focus()
  await page.keyboard.press('Enter')
  const drawer = page.locator('.drawer')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(drawer.locator('.drawer-close')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  expect(await drawer.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Tab')
  expect(await drawer.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(returnTo).toBeFocused()
}

test('new glossary activators hand focus to one modal and restore their originating controls', async ({ page }) => {
  await page.goto('/')
  await page.setViewportSize({ width: 320, height: 740 })
  const menu = page.getByTestId('app-menu')
  for (const name of ['Open glossary', "See what's simplified"]) {
    await menu.click()
    await checkGlossary(page, page.getByRole('dialog').getByRole('button', { name, exact: true }), menu)
  }
  await page.setViewportSize({ width: 1440, height: 844 })
  for (const trigger of [page.locator('.app-bar').getByRole('button', { name: 'Open glossary' }), page.locator('.question-help-rail').getByRole('button'), page.locator('.desktop-disclaimer button')]) {
    await checkGlossary(page, trigger, trigger)
  }
})

test('app-bar money basis follows rendered legacy and canonical result branches', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 844 })
  await page.goto('/')
  await expect(page.locator('.app-display-basis')).toHaveCount(0)
  await chooseMode(page, 'professional')
  await expect(page.locator('.results-column')).toBeVisible()
  await expect(page.locator('.app-display-basis')).toBeVisible()
  const age = page.locator('label.field').filter({ hasText: 'Target FIRE age' }).locator('input')
  await age.fill('20'); await age.blur()
  await expect(page.locator('.results-column')).toHaveCount(0)
  await expect(page.locator('.app-display-basis')).toHaveCount(0)
  await page.evaluate(envelope => localStorage.setItem('fire-inputs', JSON.stringify(envelope)), canonicalAppPlan())
  await page.reload()
  await expect(page.getByTestId('canonical-results')).toBeVisible()
  await expect(page.locator('.app-display-basis')).toBeVisible()
  await chooseMode(page, 'guided')
  await page.goto('/#/guided/review')
  await expect(page.locator('.app-display-basis')).toHaveCount(0)
})

test('eligible visitors see full first-visit disclosure above the fold and menu grants use the same disclosure', async ({ page }, testInfo) => {
  await eligible(page)
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/')
  const prompt = page.getByTestId('analytics-prompt')
  await expect(prompt).toContainText('Google Analytics')
  const allow = prompt.getByRole('button', { name: 'Allow', exact: true })
  await expect(allow).toBeInViewport({ ratio: 1 })
  const withConsent = await page.locator('#question-title').boundingBox()
  await page.getByTestId('app-menu').click()
  const menuPrompt = page.getByTestId('analytics-menu-prompt')
  await expect(menuPrompt.locator('p')).toHaveText(await prompt.locator('p').innerText())
  await expect(page.getByTestId('analytics-footer')).toHaveCount(1)
  await expect(page.getByTestId('analytics-menu-footer')).toHaveCount(1)
  await menuPrompt.getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(prompt).toHaveCount(0)
  await expect(menuPrompt).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('fire-analytics-consent'))).toBe('granted')
  await page.getByTestId('analytics-menu-footer').getByRole('button', { name: 'Turn them off' }).click()
  await expect(menuPrompt).toContainText('Google Analytics')
  await expect(menuPrompt.getByRole('button', { name: 'Allow', exact: true })).toBeVisible()
  await expect(page.getByTestId('analytics-menu-footer').getByRole('button')).toHaveCount(0)
  await page.keyboard.press('Escape')
  const withoutConsent = await page.locator('#question-title').boundingBox()
  await testInfo.attach('consent-metrics.json', { body: JSON.stringify({ withConsent, withoutConsent }), contentType: 'application/json' })
})

for (const language of ['EN', 'FR', '中文']) {
  test(`new mobile menu and picker targets meet 44px in ${language}`, async ({ page }, testInfo) => {
    await eligible(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 320, height: 740 })
    await page.goto('/')
    await chooseLanguage(page, language)
    await expect(page.getByTestId('analytics-prompt').getByRole('button').first()).toBeInViewport({ ratio: 1 })
    const languageTrigger = page.getByTestId('app-language')
    await expect(languageTrigger).toHaveAccessibleName(new RegExp(language))
    const measurements = []
    for (const trigger of [languageTrigger, page.getByTestId('app-menu')]) {
      await trigger.click()
      for (const target of await page.getByRole('dialog').locator('button, a[href]').all()) {
        if (!await target.isVisible()) continue
        const box = (await target.boundingBox())!
        expect(box.width).toBeGreaterThanOrEqual(44)
        expect(box.height).toBeGreaterThanOrEqual(44)
        measurements.push({ text: await target.innerText(), ...box })
      }
      await page.keyboard.press('Escape')
    }
    await testInfo.attach('menu-targets.json', { body: JSON.stringify(measurements), contentType: 'application/json' })
  })
}
