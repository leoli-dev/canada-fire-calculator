import { expect, test, type Page, type Locator } from '@playwright/test'
import en from '../../src/i18n/en.json' with { type: 'json' }
import fr from '../../src/i18n/fr.json' with { type: 'json' }
import zh from '../../src/i18n/zh.json' with { type: 'json' }

async function setup(page: Page, language: string) {
  await page.addInitScript(lang => {
    const state = new URLSearchParams(location.search).get('consent')
    localStorage.setItem('fire-lang', lang)
    localStorage.removeItem('fire-analytics-consent')
    if (state === 'settled') localStorage.setItem('fire-analytics-consent', 'denied')
    Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '0' })
    Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => state === 'suppressed' })
  }, language)
}

async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 20; index++) {
    if (await target.evaluate(element => element === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  await expect(target).toBeFocused()
}

for (const [language, copy] of [['en', en], ['fr', fr], ['zh', zh]] as const) {
  test(`390px ${language} heading and full disclosure meet acceptance in every consent state`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await setup(page, language)
    const measurements = []
    for (const state of ['undecided', 'settled', 'suppressed']) {
      await page.goto(`/?consent=${state}`)
      await expect(page.locator('html')).toHaveAttribute('lang', language === 'zh' ? 'zh-Hans' : language)
      const title = page.locator('#question-title')
      await expect(title).toBeFocused()
      await expect(title).toHaveCSS('box-shadow', 'none')
      const heading = (await title.boundingBox())!
      expect(heading.y).toBeLessThanOrEqual(200)
      const prompt = page.getByTestId('analytics-prompt')
      const actions = []
      if (state === 'undecided') {
        await expect(prompt).toHaveCount(1)
        await expect(prompt.locator('p')).toHaveText(copy.analyticsPrompt)
        const bounds = (await prompt.boundingBox())!
        expect(bounds.y).toBeGreaterThanOrEqual(heading.y + heading.height)
        for (const name of [copy.analyticsAllow, copy.analyticsDecline]) {
          const action = prompt.getByRole('button', { name, exact: true })
          await expect(action).toBeInViewport({ ratio: 1 })
          actions.push({ name, ...(await action.boundingBox())! })
        }
        const firstChoice = (await page.locator('.choice-group label').first().boundingBox())!
        expect(firstChoice.y).toBeGreaterThanOrEqual(bounds.y + bounds.height)
      } else await expect(prompt).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
      measurements.push({ language, state, heading, actions })
      await testInfo.attach(`${language}-${state}.png`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
    }
    await testInfo.attach('consent-acceptance-metrics.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
  })

  test(`320px ${language} keyboard consent transitions retain focus inside the open menu`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 })
    await setup(page, language)
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', language === 'zh' ? 'zh-Hans' : language)
    const opener = page.getByTestId('app-menu')
    await opener.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    const privacy = dialog.getByRole('heading', { name: copy.ui.privacy })
    const prompt = page.getByTestId('analytics-menu-prompt')
    const allow = prompt.getByRole('button', { name: copy.analyticsAllow, exact: true })
    const deny = prompt.getByRole('button', { name: copy.analyticsDecline, exact: true })
    await tabTo(page, allow)
    await page.keyboard.press('Enter')
    await expect(privacy).toBeFocused()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('fire-analytics-consent'))).toBe('granted')
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('link', { name: copy.githubSource })).toBeFocused()
    await page.keyboard.press('Tab')
    const revoke = page.getByTestId('analytics-menu-footer').getByRole('button', { name: copy.analyticsTurnOff })
    await expect(revoke).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(privacy).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(allow).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(deny).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(deny).toBeFocused()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('fire-analytics-consent'))).toBe('denied')
    await page.keyboard.press('Shift+Tab')
    await expect(allow).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
  })
}
