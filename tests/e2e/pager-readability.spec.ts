import { expect, test } from '@playwright/test'
import en from '../../src/i18n/en.json' with { type: 'json' }
import fr from '../../src/i18n/fr.json' with { type: 'json' }

for (const language of ['EN', 'FR'] as const) {
  test(`allocation pager keeps ${language} words intact without shrinking navigation targets`, async ({ page }, testInfo) => {
    await page.goto('/#/guided/assets/assets.identify')
    for (const name of ['TFSA', 'RRSP / RRIF', 'Non-registered account']) {
      await page.getByRole('checkbox', { name, exact: true }).check()
    }
    await page.goto('/#/guided/assets/allocation.tfsa')
    await page.locator('.langs').getByRole('button', { name: language, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', language === 'FR' ? 'fr' : 'en')
    const copy = language === 'FR' ? fr : en
    const pager = page.locator('.question-pager')
    const progress = page.getByTestId('guided-progress')
    await expect(progress).toContainText(copy.questionnaire.categories.assets)
    await expect(pager.locator('button').last()).toHaveText(copy.questionnaire.nextCategory)
    const measurements = []

    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      await pager.scrollIntoViewIfNeeded()
      const measured = await pager.evaluate(element => {
        const progress = element.querySelector('span')!
        const style = getComputedStyle(progress)
        const text = progress.textContent!
        const range = document.createRange()
        range.selectNodeContents(progress)
        const lineCount = new Set([...range.getClientRects()].map(rect => rect.top)).size
        const splitWords: string[] = []
        const walker = document.createTreeWalker(progress, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          for (const match of node.textContent!.matchAll(/[\p{L}\p{M}]+/gu)) {
            range.setStart(node, match.index!)
            range.setEnd(node, match.index! + match[0].length)
            if (new Set([...range.getClientRects()].map(rect => rect.top)).size > 1) splitWords.push(match[0])
          }
        }
        return {
          text, lineCount, wordCount: text.trim().split(/\s+/).length, splitWords,
          columns: getComputedStyle(element).gridTemplateColumns.split(' '), overflowWrap: style.overflowWrap,
          pager: element.getBoundingClientRect().toJSON(), progress: progress.getBoundingClientRect().toJSON(),
          buttons: [...element.querySelectorAll('button')].map(button => ({ text: button.textContent, ...button.getBoundingClientRect().toJSON() })),
          documentOverflow: document.documentElement.scrollWidth > innerWidth,
        }
      })
      expect(measured.splitWords, `${language} words split at ${width}px`).toEqual([])
      expect(measured.lineCount).toBeLessThanOrEqual(measured.wordCount)
      expect(measured.documentOverflow).toBe(false)
      expect(measured.buttons).toHaveLength(2)
      const [back, next] = measured.buttons
      expect(back.text).toBe(copy.guidedBack)
      expect(back.width).toBeGreaterThanOrEqual(44)
      expect(next.width).toBeGreaterThanOrEqual(44)
      expect(back.height).toBeGreaterThanOrEqual(width <= 640 ? 44 : 40)
      expect(next.height).toBeGreaterThanOrEqual(width <= 640 ? 48 : 40)
      expect(back.right).toBeLessThanOrEqual(next.left)
      expect(back.left).toBeGreaterThanOrEqual(measured.pager.left)
      expect(next.right).toBeLessThanOrEqual(measured.pager.right)
      if (width <= 640) {
        expect(measured.columns).toHaveLength(2)
        expect(measured.progress.width).toBe(measured.pager.width)
        expect(measured.progress.bottom).toBeLessThanOrEqual(Math.min(back.top, next.top))
      } else {
        expect(measured.columns).toHaveLength(3)
        expect(measured.pager.width).toBe(720)
        expect(measured.progress.left).toBeGreaterThan(back.right)
        expect(measured.progress.right).toBeLessThan(next.left)
        expect(measured.progress.top + measured.progress.height / 2).toBe(back.top + back.height / 2)
      }
      measurements.push({ width, ...measured })
      await testInfo.attach(`pager-${language}-${width}.png`, { body: await pager.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
    }
    await testInfo.attach('pager-measurements.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
  })
}
