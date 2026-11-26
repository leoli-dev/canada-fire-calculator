import { chromium } from 'playwright'
import { expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const executablePath = '/Applications/Thorium.app/Contents/MacOS/Thorium'
const output = new URL('../artifacts/ui-unify/pr-02/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath, headless: true })
const metrics = { executablePath, browserVersion: browser.version(), screens: [] }
try {
  for (const [id, width, language] of [['desktop', 1440, 'EN'], ['desktop-1280', 1280, 'EN'], ['mobile', 390, 'EN'], ['fr320', 320, 'FR'], ['zh390', 390, '中文']]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } })
    await page.goto(process.env.CAPTURE_URL ?? 'http://127.0.0.1:4173')
    if (width <= 640) await page.getByTestId('app-language').click()
    await page.locator('.langs:visible').getByRole('button', { name: language, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', language === 'FR' ? 'fr' : language === '中文' ? 'zh-Hans' : 'en')
    const locale = language === 'FR' ? 'fr' : language === '中文' ? 'zh' : 'en'
    const copy = JSON.parse(await readFile(new URL(`../src/i18n/${locale}.json`, import.meta.url), 'utf8'))
    await expect(page.getByRole('radio', { name: `${copy.couple} ${copy.questionnaire.choice.couple}`, exact: true })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const measures = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON()
      const title = document.querySelector('#question-title')
      const targets = [...document.querySelectorAll('button, a[href], input, select, summary')].filter(element => {
        const box = element.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0 && getComputedStyle(element).visibility !== 'hidden'
      })
      return {
        width: innerWidth, documentWidth: document.documentElement.scrollWidth,
        header: rect('.app-bar'), title: rect('#question-title'), directory: rect('.directory-shell'), main: rect('.questionnaire-main'), help: rect('.question-help-rail'), pager: rect('.question-pager'),
        focusedTitle: document.activeElement === title, titleShadow: getComputedStyle(title).boxShadow,
        firstScreenTargetsUnder44: targets.filter(element => { const box = element.getBoundingClientRect(); return box.width < 44 || box.height < 44 }).map(element => ({ text: element.textContent?.trim().slice(0, 80), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })),
      }
    })
    metrics.screens.push({ id, language, ...measures })
    await page.screenshot({ path: new URL(`${id}.png`, output).pathname, animations: 'disabled' })
    await page.close()
  }
  await writeFile(new URL('metrics.json', output), `${JSON.stringify(metrics, null, 2)}\n`)
  console.log(JSON.stringify(metrics.screens.map(({ id, width, documentWidth, title, header, focusedTitle, titleShadow, firstScreenTargetsUnder44 }) => ({ id, width, documentWidth, titleTop: title.y, headerHeight: header.height, focusedTitle, titleShadow, firstScreenTargetsUnder44: firstScreenTargetsUnder44.length })), null, 2))
} finally {
  await browser.close()
}
