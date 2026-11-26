import type { Locator, Page } from '@playwright/test'

/** Reveal the same editor through its disclosure; do not bypass form handlers or draft commits. */
export async function revealProfessionalEditor(page: Page, editor: Locator) {
  const inputs = page.locator('.phone-result-tabs [aria-controls="inputs"]')
  if (await inputs.isVisible() && await inputs.getAttribute('aria-selected') !== 'true') await inputs.click()
  const group = editor.locator('xpath=ancestor-or-self::details[contains(@class,"professional-group")]')
  if (await group.count() && !await group.evaluate(element => (element as HTMLDetailsElement).open)) await group.locator(':scope > summary').press('Enter')
}

export async function showProfessionalResults(page: Page) {
  const results = page.locator('.phone-result-tabs [aria-controls="results"]')
  if (await results.isVisible() && await results.getAttribute('aria-selected') !== 'true') await results.click()
}

/** Layout migration only: use public pane and disclosure controls before the original locator. */
export async function prepareProfessionalTarget(target: Locator): Promise<Locator> {
  const page = target.page()
  if (await target.count() === 1 && await target.isVisible()) return target
  if (!await page.locator('.professional-layout').count()) return target
  // Role queries intentionally exclude closed content. Reveal it through the same UI a person uses.
  if (!await target.count() && target.toString().includes('getByRole') && !await page.locator('[role="dialog"]:visible').count()) {
    await showProfessionalResults(page)
    if (!await target.count()) {
      for (const summary of await page.locator('.results-column details:not([open]) > summary').all()) {
        if (await summary.isVisible()) await summary.press('Enter')
        if (await target.count()) break
      }
    }
    if (!await target.count()) {
      const inputs = page.locator('.phone-result-tabs [aria-controls="inputs"]')
      if (await inputs.isVisible() && await inputs.getAttribute('aria-selected') !== 'true') await inputs.click()
      for (const summary of await page.locator('.professional-group > summary').all()) {
        const details = summary.locator('..')
        if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await summary.press('Enter')
        if (await target.count()) break
        for (const nested of await details.locator('details:not([open]) > summary').all()) {
          if (await nested.isVisible()) await nested.press('Enter')
          if (await target.count()) break
        }
        if (await target.count()) break
      }
    }
  }
  if (!await target.count()) return target
  const first = target.first()
  const location = await first.evaluate(element => ({ input: !!element.closest('.professional-input-pane'), result: !!element.closest('.results-column') }))
  if (location.input) await revealProfessionalEditor(page, first)
  if (location.result) await showProfessionalResults(page)
  if (location.input || location.result) {
    const ancestors = first.locator('xpath=ancestor::details')
    for (let index = 0; index < await ancestors.count(); index++) {
      const details = ancestors.nth(index)
      if (await first.evaluate((element, parent) => element.tagName === 'SUMMARY' && element.parentElement === parent, await details.elementHandle())) continue
      if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await details.locator(':scope > summary').press('Enter')
    }
  }
  return target
}
