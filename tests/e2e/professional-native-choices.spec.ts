import { expect, test, type Locator } from '@playwright/test'
import { chooseLanguage, chooseMode } from './fixtures/app-bar'
import { revealProfessionalEditor } from './fixtures/professional'
import { readFileSync } from 'node:fs'
const [en, fr, zh] = ['en', 'fr', 'zh'].map(language => JSON.parse(readFileSync(new URL(`../../src/i18n/${language}.json`, import.meta.url), 'utf8')))

/** Exercise the native control itself: a clickable surrounding label must not hide a zero-width input. */
async function nativeHitTarget(control: Locator, phone: boolean) {
  await control.evaluate(element => element.scrollIntoView({ block: 'center' }))
  const measured = await control.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height,
      hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element }
  })
  expect(measured.width).toBeGreaterThanOrEqual(phone ? 48 : 13)
  expect(measured.height).toBeGreaterThanOrEqual(phone ? 48 : 13)
  expect(measured.hit, 'The native input center receives the pointer').toBe(true)
  await control.check()
  await expect(control).toBeChecked()
  return measured
}

for (const [language, copy] of [['EN', en], ['FR', fr], ['中文', zh]] as const) {
  test(`Professional native radio and checkbox targets in ${language}`, async ({ page }, info) => {
    const phone = (page.viewportSize()?.width ?? 1440) <= 640
    await page.goto('/')
    await chooseLanguage(page, language)
    await chooseMode(page, 'professional')
    const housing = page.locator('[data-group="housing"]')
    await revealProfessionalEditor(page, housing)
    await housing.getByRole('button', { name: copy.addPrincipalResidence }).click()
    const planned = housing.getByRole('radio', { name: copy.prModePlanned, exact: true })
    const owned = housing.getByRole('radio', { name: copy.prModeOwned, exact: true })
    const measures = []
    measures.push({ name: 'planned', ...await nativeHitTarget(planned, phone) })
    measures.push({ name: 'owned', ...await nativeHitTarget(owned, phone) })
    measures.push({ name: 'linked mortgage', ...await nativeHitTarget(housing.getByRole('checkbox', { name: copy.hasMortgage, exact: true }), phone) })
    const saving = page.locator('[data-group="saving"]')
    await revealProfessionalEditor(page, saving)
    measures.push({ name: 'savings basis', ...await nativeHitTarget(page.getByTestId('budget-mode-savings'), phone) })
    measures.push({ name: 'debt basis', ...await nativeHitTarget(page.getByTestId('budget-debt-yes'), phone) })
    measures.push({ name: 'tax basis', ...await nativeHitTarget(page.getByTestId('budget-tax-yes'), phone) })
    const tax = page.locator('[data-group="tax"]')
    await revealProfessionalEditor(page, tax)
    await page.getByTestId('rrsp-planned-self').fill('1000')
    await page.getByTestId('rrsp-planned-self').blur()
    measures.push({ name: 'deferred deduction', ...await nativeHitTarget(page.getByTestId('rrsp-deduct-later-self'), phone) })
    const overflow = await page.locator('.professional-input-pane').evaluate(element => element.scrollWidth - element.clientWidth)
    expect(overflow).toBe(0)
    await info.attach(`native-targets-${language}`, { body: JSON.stringify({ viewport: page.viewportSize(), measures, overflow }), contentType: 'application/json' })
  })
}
