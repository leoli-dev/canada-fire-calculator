import type { Locator, Page } from '@playwright/test'

/** Open only the editor's own pane and group; all controls remain native and mounted. */
export async function revealProfessionalEditor(page: Page, editor: Locator) {
  if (await editor.count() !== 1) return
  const inputs = page.locator('.phone-result-tabs [aria-controls="inputs"]')
  if (await inputs.isVisible() && await inputs.getAttribute('aria-selected') !== 'true') await inputs.click()
  const group = editor.locator('xpath=ancestor-or-self::details[contains(@class,"professional-group")]')
  if (await group.count() && !await group.evaluate(element => (element as HTMLDetailsElement).open)) await group.locator(':scope > summary').press('Enter')
}

export async function showProfessionalResults(page: Page) {
  const results = page.locator('.phone-result-tabs [aria-controls="results"]')
  if (await results.isVisible() && await results.getAttribute('aria-selected') !== 'true') await results.click()
}

/**
 * Prepare an action's exact target, never search the application by opening content.
 * A visible-only role query can supply its identical includeHidden locator as a
 * read-only owner probe. Missing or ambiguous probes make no UI changes.
 * Assertions deliberately do not call this helper.
 */
export async function prepareProfessionalTarget(target: Locator, ownerProbe: Locator = target): Promise<Locator> {
  const page = target.page()
  if (await target.count() === 1 && await target.isVisible()) return target
  if (!await page.locator('.professional-layout').count() || await page.locator('[role="dialog"]:visible').count()) return target
  if (await ownerProbe.count() !== 1) return target
  const location = await ownerProbe.evaluate(element => ({ input: !!element.closest('.professional-input-pane'), result: !!element.closest('.results-column') }))
  if (location.input) await revealProfessionalEditor(page, ownerProbe)
  if (location.result) await showProfessionalResults(page)
  if (location.input || location.result) {
    const ancestors = ownerProbe.locator('xpath=ancestor::details')
    for (let index = 0; index < await ancestors.count(); index++) {
      const details = ancestors.nth(index)
      if (await ownerProbe.evaluate((element, parent) => element.tagName === 'SUMMARY' && element.parentElement === parent, await details.elementHandle())) continue
      if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await details.locator(':scope > summary').press('Enter')
    }
  }
  return target
}
