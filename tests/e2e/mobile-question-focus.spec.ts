import { expect, test, type Page } from '@playwright/test'

async function expectFocusUncovered(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement as HTMLElement
    const target = active.closest<HTMLElement>('.ui-choice, .owner-choices label') ?? active
    const rect = target.getBoundingClientRect()
    const top = Math.max(document.querySelector('.app-bar')!.getBoundingClientRect().bottom, document.querySelector('.mobile-question-progress')!.getBoundingClientRect().bottom)
    const bottom = document.querySelector('.question-pager')!.getBoundingClientRect().top
    return rect.top >= top && rect.bottom <= bottom
  }), 'The entire focused field, choice or heading clears both fixed bars').toBe(true)
}

for (const [locale, width, height] of [['fr', 320, 740], ['en', 390, 844], ['zh', 390, 844]] as const) {
  test(`${locale} phone paging, Contents and both keyboard directions reveal focus between the bars`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.addInitScript(language => {
      localStorage.setItem('fire-lang', language)
      Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' })
    }, locale)
    const work = '/#/guided/family/time.work'
    const title = page.locator('#question-title')
    for (const scroll of [100, 'bottom'] as const) {
      await page.goto(work)
      await page.locator('.question-help summary').press('Enter')
      await page.evaluate(position => scrollTo(0, position === 'bottom' ? document.documentElement.scrollHeight : position), scroll)
      await page.locator('.question-pager button').last().click()
      await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'time.horizon')
      await expect(title).toBeFocused()
      await expectFocusUncovered(page)
      await expect(title).toHaveCSS('box-shadow', 'none')
      await page.evaluate(() => scrollTo(0, 100))
      await page.locator('.question-pager button').first().click()
      await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'time.work')
      await expect(title).toBeFocused()
      await expectFocusUncovered(page)
    }
    await page.locator('.question-help summary').press('Enter')
    await page.evaluate(() => scrollTo(0, 100))
    const trigger = page.locator('.mobile-directory-trigger')
    await trigger.click()
    await page.getByRole('dialog').locator('details[open] button').last().click()
    await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'time.horizon')
    await expect(title).toBeFocused()
    await expectFocusUncovered(page)

    await page.goto(work)
    await trigger.focus()
    for (const key of ['Tab', 'Shift+Tab']) {
      const kinds = new Set<string>()
      for (let step = 0; step < 12; step++) {
        await page.keyboard.press(key)
        const kind = await page.evaluate(() => {
          const active = document.activeElement as HTMLInputElement
          return active.closest('.question-page') && active.matches('input, select, button, summary, a[href]') ? active.type || active.tagName : null
        })
        if (kind) { kinds.add(kind); await expectFocusUncovered(page) }
      }
      expect(kinds.has('radio')).toBe(true)
      expect(kinds.has('text')).toBe(true)
    }
    // Focusing a field that already fits must neither scroll it nor change focus.
    const input = page.locator('.question-number').first()
    await input.focus()
    await expectFocusUncovered(page)
    const before = await page.evaluate(() => scrollY)
    await input.evaluate(element => { element.blur(); element.focus({ preventScroll: true }) })
    await page.evaluate(() => new Promise(requestAnimationFrame))
    await expect(input).toBeFocused()
    expect(await page.evaluate(() => scrollY)).toBe(before)
  })

  test(`${locale} phone button ChoiceCards all meet 56px and retain preset behavior`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.addInitScript(language => localStorage.setItem('fire-lang', language), locale)
    await page.goto('/#/guided/preferences/invest.fees')
    const presets = page.locator('.question-page button.ui-choice')
    await expect(presets).toHaveCount(6)
    for (const preset of await presets.all()) {
      expect((await preset.boundingBox())!.height).toBeGreaterThanOrEqual(56)
      expect((await preset.boundingBox())!.width).toBeGreaterThanOrEqual(44)
    }
    await presets.first().click()
    await expect(presets.first()).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-field="fees"] input')).toHaveValue(new Intl.NumberFormat(locale).format(0.2))
    const widths = await page.evaluate(() => ({ viewport: innerWidth, available: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(widths.viewport).toBe(width)
    expect(widths.content).toBe(widths.available)
  })
}
