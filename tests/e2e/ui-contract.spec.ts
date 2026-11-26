import { expect, test, type Page } from '@playwright/test'

async function checkContract(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const buttonIssues = await page.locator('button').evaluateAll(buttons => buttons.filter(button => {
    if (!button.getClientRects().length) return false
    const style = getComputedStyle(button)
    return !button.matches('.ui-button, .ui-choice') || !style.fontFamily.includes('Inter') || parseFloat(style.borderRadius) === 0
  }).map(button => button.textContent?.trim()))
  expect(buttonIssues, 'Every visible button uses the shared styled controls').toEqual([])

  const failures = await page.evaluate(() => {
    type RGB = [number, number, number, number]
    const parse = (value: string): RGB => {
      const values = value.match(/[\d.]+/g)?.map(Number) ?? []
      return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1]
    }
    const blend = (front: RGB, back: RGB): RGB => [0, 1, 2].map(i => front[i] * front[3] + back[i] * (1 - front[3])).concat(1) as RGB
    const background = (element: Element | null): RGB => {
      if (!element) return [255, 255, 255, 1]
      const color = parse(getComputedStyle(element).backgroundColor)
      return color[3] === 1 ? color : blend(color, background(element.parentElement))
    }
    const luminance = (color: RGB) => color.slice(0, 3).map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4 }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0)
    return [...document.querySelectorAll('.app *')].filter(element => {
      if (element.closest('svg, .sr-only, .annual-sheet-sr, [aria-hidden="true"], :disabled')) return false
      const style = getComputedStyle(element)
      return element.getClientRects().length > 0 && style.visibility === 'visible' && [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
    }).flatMap(element => {
      const style = getComputedStyle(element), bg = background(element)
      const foreground = blend(parse(style.color), bg)
      const a = luminance(foreground), b = luminance(bg), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
      const large = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.66 && parseFloat(style.fontWeight) >= 700
      return ratio + .01 < (large ? 3 : 4.5) ? [{ text: element.textContent?.trim().slice(0, 100), ratio, color: style.color, background: bg }] : []
    })
  })
  expect(failures, 'Normal text meets 4.5:1 and large text meets 3:1').toEqual([])
}

for (const language of ['EN', 'FR', '中文']) {
  test(`UI foundation contract in ${language}`, async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.locator('.langs').getByRole('button', { name: language, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', language === 'FR' ? 'fr' : language === '中文' ? 'zh-Hans' : 'en')
    await expect(page.locator('.langs').getByRole('button', { name: language, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.langs').getByRole('button', { name: language, exact: true })).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(page.locator('.question-page')).toBeVisible()
    await checkContract(page)
    await page.locator('.entry-mode button').nth(1).click()
    await expect(page.locator('.input-form')).toBeVisible()
    await page.evaluate(() => document.querySelectorAll('details').forEach(details => { details.open = true }))
    await checkContract(page)
    const display = page.locator('.ui-segmented[aria-labelledby="display-mode-label"]')
    await display.getByRole('button').nth(1).click()
    await expect(display.getByRole('button').nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.displayMode)).toBe('nominal')
    await display.getByRole('button').first().click()
    await expect(display.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.displayMode)).toBe('real')
  })
}
