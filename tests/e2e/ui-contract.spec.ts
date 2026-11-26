import { prepareProfessionalTarget, revealProfessionalEditor, showProfessionalResults } from './fixtures/professional'
import { chooseMode, chooseLanguage, expectSelectedLanguage } from './fixtures/app-bar'
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

// Match the established capture.mjs metric, including native inputs inside labels.
async function phoneContract(page: Page) {
  const metrics = await page.evaluate(() => {
    const visible = (element: HTMLElement) => !!element.offsetParent && element.getBoundingClientRect().width > 0
    const targets = [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, summary, [role="tab"], label:has(input[type=radio]), label:has(input[type=checkbox])')].filter(visible)
    const small = targets.filter(element => { const box = element.getBoundingClientRect(); return box.bottom > 0 && box.top < innerHeight && box.height < 44 })
    const inputs = [...document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]), select, textarea')].filter(visible)
    return {
      firstScreenTargetsUnder44: small.map(element => ({ tag: element.tagName, text: element.textContent?.trim().slice(0, 60), height: element.getBoundingClientRect().height })),
      inputsUnder16px: inputs.filter(element => parseFloat(getComputedStyle(element).fontSize) < 16).map(element => element.id),
    }
  })
  expect(metrics.firstScreenTargetsUnder44, 'Raw first-screen targets are at least 44px tall').toEqual([])
  expect(metrics.inputsUnder16px, 'Phone field fonts prevent focus zoom').toEqual([])
  for (const input of await page.locator('.question-page input:not([type=checkbox]):not([type=radio]), .question-page select').all()) {
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(48)
  }
  for (const choice of await page.locator('.question-page .ui-choice').all()) {
    expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(56)
  }
  await expect(page.locator('.question-pager button').last()).toBeInViewport({ ratio: 1 })
  await expect(page.locator('.question-pager button').last()).toBeEnabled()
}

for (const language of ['EN', 'FR', '中文']) {
  test(`UI foundation contract in ${language}`, async ({ page }, testInfo) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await chooseLanguage(page, language)
    await expect(page.locator('html')).toHaveAttribute('lang', language === 'FR' ? 'fr' : language === '中文' ? 'zh-Hans' : 'en')
    await expectSelectedLanguage(page, language)
    await expect(page.locator('.question-page')).toBeVisible()
    await checkContract(page)
    if (testInfo.project.name === 'mobile-320') {
      await phoneContract(page)
      await page.goto('/#/guided/family/family.ages')
      await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'family.ages')
      await expect(page.locator('.question-number').first()).toBeVisible()
      await phoneContract(page)
    }
    await chooseMode(page, 'professional')
    await expect(page.locator('.input-form')).toBeVisible()
    // Inspect every input group through its native disclosures, including on one-open phones.
    for (const group of await page.locator('.professional-group').all()) {
      await revealProfessionalEditor(page, group)
      for (const summary of await group.locator('details:not([open]) > summary').all()) {
        if (await summary.isVisible()) await summary.press('Enter')
      }
      await checkContract(page)
    }
    await showProfessionalResults(page)
    // Inspect the original Results disclosure surfaces as contract targets, never as a search for an input.
    for (const summary of await page.locator('.results-column details:not([open]) > summary').all()) {
      if (await summary.isVisible()) await summary.press('Enter')
    }
    await checkContract(page)
    const display = page.locator('.ui-segmented[aria-labelledby="display-mode-label"]')
    await (await prepareProfessionalTarget(display.getByRole('button').nth(1), display.getByRole('button', { includeHidden: true }).nth(1))).click()
    await expect(display.getByRole('button').nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.displayMode)).toBe('nominal')
    await (await prepareProfessionalTarget(display.getByRole('button').first(), display.getByRole('button', { includeHidden: true }).first())).click()
    await expect(display.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.displayMode)).toBe('real')
  })
}

for (const consent of ['default', 'eligible', 'granted', 'denied'] as const) {
  test(`phone first visit keeps Next actionable with ${consent} privacy`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    if (consent !== 'default') await page.addInitScript(value => {
      Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '0' })
      Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => false })
      if (value !== 'eligible') localStorage.setItem('fire-analytics-consent', value)
    }, consent)
    await page.goto('/')
    expect((await page.locator('#question-title').boundingBox())!.y).toBeLessThanOrEqual(200)
    if (consent === 'eligible') await expect(page.getByTestId('analytics-prompt')).toBeVisible()
    await phoneContract(page)
    expect(await page.evaluate(() => scrollY)).toBe(0)
    await (await prepareProfessionalTarget(page.locator('.question-pager button').last())).click()
    await expect(page.locator('#question-title')).toBeFocused()
  })
}

test('phone Contents uses one Sheet, traps focus and restores it on close and navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const trigger = page.locator('.mobile-directory-trigger')
  await (await prepareProfessionalTarget(trigger)).focus()
  await page.keyboard.press('Enter')
  const sheet = page.getByRole('dialog', { name: 'Contents' })
  await expect(page.getByRole('dialog')).toHaveCount(1)
  const close = sheet.getByRole('button', { name: 'Close directory' })
  await expect(close).toBeFocused()
  await expect(close).toBeInViewport({ ratio: 1 })
  await expect(sheet.locator('details[open]')).toHaveCount(1)
  await page.keyboard.press('Shift+Tab')
  await expect(sheet.getByRole('button', { name: 'Review answers' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await (await prepareProfessionalTarget(trigger)).click()
  await (await prepareProfessionalTarget(sheet.locator('details[open] button').nth(1))).click()
  await expect(sheet).toHaveCount(0)
  await expect(page.locator('#question-title')).toBeFocused()
  await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'family.ages')
  await (await prepareProfessionalTarget(trigger)).click()
  await (await prepareProfessionalTarget(close)).click()
  await expect(trigger).toBeFocused()
})

test('phone progress stays below the app bar and final content clears the fixed pager', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/#/guided/family/time.work')
  await (await prepareProfessionalTarget(page.locator('.question-help summary'))).press('Enter')
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  expect((await page.locator('.app-bar').boundingBox())!.y).toBe(0)
  expect((await page.locator('.mobile-question-progress').boundingBox())!.y).toBe(52)
  const pager = (await (await prepareProfessionalTarget(page.locator('.question-pager'))).boundingBox())!
  expect(pager.y + pager.height).toBe(740)
  const question = (await (await prepareProfessionalTarget(page.locator('.question-page'))).boundingBox())!
  expect(question.y + question.height).toBeLessThanOrEqual(pager.y)
  await expect(page.locator('.question-pager button').last()).toBeEnabled()
})
