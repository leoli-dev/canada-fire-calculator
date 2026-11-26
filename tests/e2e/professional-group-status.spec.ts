import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { canonicalAppPlan } from './fixtures/canonical-app-plan'
import { chooseLanguage } from './fixtures/app-bar'
import { prepareProfessionalTarget } from './fixtures/professional'

for (const [language, locale] of [['EN', 'en'], ['FR', 'fr'], ['中文', 'zh']]) test(`Professional ${language} summaries follow applicable metadata and nested editor visibility`, async ({ page }) => {
  const copy = JSON.parse(readFileSync(new URL(`../../src/i18n/${locale}.json`, import.meta.url), 'utf8'))
  const plan = canonicalAppPlan()
  Object.assign(plan.state.answerMeta.fireAge, { status: 'estimated' })
  Object.assign(plan.state.answerMeta.lifeExpectancy, { status: 'unknown' })
  Object.assign(plan.state.answerMeta.returns, { status: 'estimated' })
  Object.assign(plan.state.answerMeta.fees, { status: 'estimated' })
  await page.addInitScript(value => localStorage.setItem('fire-inputs', JSON.stringify(value)), plan)
  await page.goto('/')
  await chooseLanguage(page, language)
  const labels = [copy.profile, copy.ui.professional.saving, copy.accounts, copy.ui.professional.housing, copy.ui.professional.benefits, copy.ui.professional.tax, copy.ui.professional.advanced]
  for (const [index, label] of labels.entries()) {
    const group = page.locator('.professional-group').nth(index)
    await expect(group.locator(':scope > summary > span')).toHaveText(label)
    await expect(group.locator(':scope > .professional-group-body')).toHaveAttribute('aria-label', label)
  }
  const confirmed = (count: number, total: number) => copy.ui.professional.confirmed.replace('{{count}}', String(count)).replace('{{total}}', String(total))
  const profile = page.locator('[data-group="profile"]')
  await expect(profile.locator(':scope > summary small')).toContainText(confirmed(5, 7))
  await (await prepareProfessionalTarget(profile.locator('select').last())).selectOption('single')
  await expect(profile.locator(':scope > summary small')).toContainText(confirmed(4, 6))
  const accounts = page.locator('[data-group="accounts"]')
  const nested = accounts.locator('details[data-status-fields="returns volatilities fees"] > summary')
  const before = await accounts.locator(':scope > summary small').textContent()
  const estimates = copy.ui.professional.estimates_other.replace('{{count}}', '2')
  expect(before).not.toContain(estimates)
  const metaBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.answerMeta)
  await (await prepareProfessionalTarget(nested)).press('Enter')
  await expect(accounts.locator(':scope > summary small')).toContainText(estimates)
  await (await prepareProfessionalTarget(nested)).press('Enter')
  await expect(accounts.locator(':scope > summary small')).toHaveText(before!)
  const metaAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.answerMeta)
  expect(metaAfter).toEqual(metaBefore)
  const housing = page.locator('[data-group="housing"]')
  await (await prepareProfessionalTarget(housing.getByRole('button', { name: copy.addProperty, exact: true }), housing.getByRole('button', { name: copy.addProperty, exact: true, includeHidden: true }))).click()
  const rental = housing.locator('.property-card').filter({ hasText: copy.investmentProperty })
  const mortgage = rental.getByRole('checkbox', { name: copy.hasMortgage, exact: true })
  await (await prepareProfessionalTarget(mortgage)).uncheck()
  // Positional rental facts have no reliable entity binding, even when metadata exists.
  const housingSummary = housing.locator(':scope > summary small')
  await expect(housingSummary).toContainText(confirmed(7, 7))
  await expect(housingSummary).toContainText(copy.ui.professional.needsReview)
  await (await prepareProfessionalTarget(mortgage)).check()
  await expect(housingSummary).toContainText(confirmed(7, 7))
  await expect(housingSummary).toContainText(copy.ui.professional.needsReview)
  await (await prepareProfessionalTarget(mortgage)).uncheck()
  await expect(housingSummary).toContainText(confirmed(7, 7))
  await expect(housingSummary).toContainText(copy.ui.professional.needsReview)
  expect(await page.locator('.professional-input-pane').evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0)
})
