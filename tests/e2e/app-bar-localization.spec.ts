import { expect, test } from '@playwright/test'
import { chooseLanguage } from './fixtures/app-bar'

test('app-bar heading retains localized desktop and tablet titles and compact phone names without overflow', async ({ page }, testInfo) => {
  await page.goto('/')
  const measurements = []
  for (const locale of [
    { button: 'EN', title: 'Canada FIRE Calculator', mobile: 'FIRE Calculator' },
    { button: 'FR', title: 'Calculateur FIRE Canada', mobile: 'Calculateur FIRE' },
    { button: '中文', title: '加拿大 FIRE 计算器', mobile: 'FIRE 计算器' },
  ]) {
    await chooseLanguage(page, locale.button)
    for (const width of [1440, 1280, 1100, 1099, 768, 641, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      await page.evaluate(async () => {
        await document.fonts.ready
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      })
      const heading = page.locator('.app-bar').getByRole('heading', { level: 1 })
      await expect(heading).toHaveAccessibleName(width <= 640 ? locale.mobile : locale.title)
      const metric = await heading.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        const bar = element.closest('.app-bar')!.getBoundingClientRect()
        return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, heading: bounds.toJSON(), bar: bar.toJSON(), textWidth: element.scrollWidth, availableWidth: element.clientWidth }
      })
      expect(metric.width).toBe(width)
      expect(metric.documentWidth).toBe(metric.clientWidth)
      expect(metric.heading.left).toBeGreaterThanOrEqual(0)
      expect(metric.heading.right).toBeLessThanOrEqual(width)
      expect(metric.textWidth).toBeLessThanOrEqual(metric.availableWidth)
      expect(metric.heading.top).toBeGreaterThanOrEqual(metric.bar.top)
      expect(metric.heading.bottom).toBeLessThanOrEqual(metric.bar.bottom)
      if (width <= 640) expect(metric.bar.height).toBe(52)
      else if (width >= 1100) expect(metric.bar.height).toBe(56)
      measurements.push({ language: locale.button, ...metric })
      if (locale.button === 'FR' && [1440, 1099, 768, 641, 390].includes(width)) {
        await testInfo.attach(`fr-heading-${width}.png`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
      }
    }
  }
  await testInfo.attach('heading-localization-metrics.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
})
