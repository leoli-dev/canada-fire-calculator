import type { Locator, Page } from '@playwright/test'

/** Reveal the same editor through its disclosure; do not bypass form handlers or draft commits. */
export async function revealProfessionalEditor(page: Page, editor: Locator) {
  const inputs = page.locator('.phone-result-tabs [aria-controls="inputs"]')
  if (await inputs.isVisible() && await inputs.getAttribute('aria-selected') !== 'true') await inputs.click()
  const group = editor.locator('xpath=ancestor-or-self::details[contains(@class,"professional-group")]')
  if (await group.count() && !await group.evaluate(element => (element as HTMLDetailsElement).open)) await group.locator(':scope > summary').click()
}

export async function showProfessionalResults(page: Page) {
  const results = page.locator('.phone-result-tabs [aria-controls="results"]')
  if (await results.isVisible() && await results.getAttribute('aria-selected') !== 'true') await results.click()
}
