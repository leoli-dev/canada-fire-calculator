import { expect, test, type Page } from '@playwright/test'

// BE-39 A: the visible provenance of a CPP/QPP amount, and what a
// retirement-age change does to it. Runs in both entry modes; the viewport
// project (desktop / mobile-320) is supplied by the Playwright config.

const CPP_AT_45 = 9_278
const CPP_AT_55 = 13_917

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

const storedPlan = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)

/** Apply the CPP work-history estimator on the guided income page. */
async function applyCppEstimator(page: Page) {
  await page.goto('/#/guided/income/cpp.self')
  const panel = page.locator('[data-pension-kind="cpp"]')
  await expect(panel).toBeVisible()
  await page.locator('details.estimator', { hasText: 'Estimate from work history' }).locator('summary').click()
  await page.getByRole('button', { name: 'Apply' }).click()
  return panel
}

test('guided: an estimator amount is repriced when the retirement age changes, and survives reload and mode switch', async ({ page }) => {
  const panel = await applyCppEstimator(page)

  // the estimator recorded its source and premise
  await expect(panel).toHaveAttribute('data-pension-source', 'estimator')
  await expect(page.locator('[data-field="cppAnnualAt65"] input')).toHaveValue('9,278')
  let saved = await storedPlan(page)
  expect(saved.inputs.cppAnnualAt65).toBe(CPP_AT_45)
  expect(saved.inputs.cppAmountSource.source).toBe('estimator')
  expect(saved.inputs.cppAmountSource.premises.retirementAge).toBe(45)
  // BL1: the applied estimate is recorded as the app's estimate, not as a fact
  expect(saved.answerMeta.cppAnnualAt65.status).toBe('estimated')
  expect(saved.answerMeta.cppAnnualAt65.origin).toBe('default')

  // change the retirement age through the normal professional field
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const fireAge = page.locator('label.field').filter({ hasText: 'Target FIRE age' }).locator('input')
  await fireAge.fill('55')
  await fireAge.blur()
  // the amount was re-priced from the same estimator, not left stale
  await expect(page.locator('label.field').filter({ hasText: 'Estimated CPP/QPP per year at 65' }).locator('input')).toHaveValue('13,917')
  saved = await storedPlan(page)
  expect(saved.inputs.cppAnnualAt65).toBe(CPP_AT_55)
  expect(saved.inputs.cppAmountSource.source).toBe('estimator')
  expect(saved.inputs.cppAmountSource.premises.retirementAge).toBe(55)

  // survives a reload
  await page.reload()
  await expect(page.locator('label.field').filter({ hasText: 'Estimated CPP/QPP per year at 65' }).locator('input')).toHaveValue('13,917')
  // and a mode switch back to guided shows the same figure and provenance
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/income/cpp.self')
  await expect(page.locator('[data-pension-kind="cpp"]')).toHaveAttribute('data-pension-source', 'estimator')
  await expect(page.locator('[data-field="cppAnnualAt65"] input')).toHaveValue('13,917')
})

test('professional: an estimator Apply is recorded as an estimate, not a user-confirmed fact', async ({ page }) => {
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const estimator = page.locator('details.estimator', { hasText: 'Estimate from work history' })
  await estimator.locator('summary').click()
  await estimator.getByRole('button', { name: 'Apply' }).click()

  await expect(page.locator('label.field').filter({ hasText: 'Estimated CPP/QPP per year at 65' }).locator('input')).toHaveValue('9,278')
  const saved = await storedPlan(page)
  expect(saved.inputs.cppAnnualAt65).toBe(CPP_AT_45)
  expect(saved.inputs.cppAmountSource.source).toBe('estimator')
  // BL1: the app computed this number, so it is `estimated`/`default` — never
  // the user's confirmed fact
  expect(saved.answerMeta.cppAnnualAt65.status).toBe('estimated')
  expect(saved.answerMeta.cppAnnualAt65.origin).toBe('default')
})

test('guided: a statement amount is never overwritten and asks for review instead', async ({ page }) => {
  await page.goto('/#/guided/income/cpp.self')
  const panel = page.locator('[data-pension-kind="cpp"]')
  await panel.locator('[data-pension-source-select="cpp"]').selectOption('statement')

  // a statement value already stated at the claim age: 1,000/month at 60
  await panel.locator('[data-pension-basis-select="cpp"]').selectOption('monthly')
  await page.locator('[data-field="cppAnnualAt65"] input').fill('1000')
  await page.locator('[data-field="cppAnnualAt65"] input').blur()
  await page.locator('[data-field="cppStartAge"] input').fill('60')
  await page.locator('[data-field="cppStartAge"] input').blur()
  const ageBasis = panel.locator('[data-pension-age-basis="cpp"] input')
  await ageBasis.fill('60')
  await ageBasis.blur()

  let saved = await storedPlan(page)
  // monthly 1,000 stored as an annual 12,000, exactly once
  expect(saved.inputs.cppAnnualAt65).toBe(12_000)
  expect(saved.inputs.cppAmountSource.basis).toBe('monthly')
  expect(saved.inputs.cppAmountSource.ageBasis).toBe(60)
  expect(saved.inputs.cppAmountSource.source).toBe('statement')
  await expect(panel.locator('[data-pension-warning]')).toHaveCount(0)

  // change the retirement age: the number must not move, the flag must appear
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const fireAge = page.locator('label.field').filter({ hasText: 'Target FIRE age' }).locator('input')
  await fireAge.fill('55')
  await fireAge.blur()
  await expect(page.locator('label.field').filter({ hasText: 'Estimated CPP/QPP per year at 65' }).locator('input')).toHaveValue('1,000')
  saved = await storedPlan(page)
  expect(saved.inputs.cppAnnualAt65).toBe(12_000)
  await expect(page.locator('[data-pension-warning="premisesNeedReview"]')).toBeVisible()

  // the flag survives a reload and a mode switch
  await page.reload()
  await expect(page.locator('[data-pension-warning="premisesNeedReview"]')).toBeVisible()
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/income/cpp.self')
  await expect(page.locator('[data-pension-warning="premisesNeedReview"]')).toBeVisible()
  await expect(page.locator('[data-field="cppAnnualAt65"] input')).toHaveValue('1,000')

  // re-confirming adopts the new age premise without changing the number
  await page.locator('[data-pension-reconfirm="cpp"]').click()
  await expect(page.locator('[data-pension-warning="premisesNeedReview"]')).toHaveCount(0)
  saved = await storedPlan(page)
  expect(saved.inputs.cppAnnualAt65).toBe(12_000)
  expect(saved.inputs.cppAmountSource.premisesNeedReview).toBeUndefined()
})

test('professional: a manual amount is a fact that a retirement-age change does not touch', async ({ page }) => {
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const cpp = page.locator('label.field').filter({ hasText: 'Estimated CPP/QPP per year at 65' }).locator('input')
  await cpp.fill('11000')
  await cpp.blur()
  const fireAge = page.locator('label.field').filter({ hasText: 'Target FIRE age' }).locator('input')
  await fireAge.fill('58')
  await fireAge.blur()
  await expect(cpp).toHaveValue('11,000')
  await expect(page.locator('[data-pension-kind="cpp"][data-pension-warning]')).toHaveCount(0)
  const saved = await storedPlan(page)
  expect(saved.inputs.cppAnnualAt65).toBe(11_000)
})

// Review finding B1: the amount box is a live input. Typing a replacement over
// an estimator figure must adopt the typed number as a manual fact, never let
// the dependency pass re-derive the estimate and silently discard the edit.
test('guided: a figure typed over an estimator amount is kept and recorded as manual', async ({ page }) => {
  const panel = await applyCppEstimator(page)
  const amount = page.locator('[data-field="cppAnnualAt65"] input')
  await expect(amount).toHaveValue('9,278')

  await amount.fill('15000')
  await expect(amount).toHaveValue('15,000')
  await amount.blur()
  // the typed figure survives the blur: it is not silently reverted
  await expect(amount).toHaveValue('15,000')
  let saved = await storedPlan(page)
  expect(saved.inputs.cppAnnualAt65).toBe(15_000)
  expect(saved.inputs.cppAmountSource.source).toBe('manual')
  await expect(panel).toHaveAttribute('data-pension-source', 'manual')
  await expect(page.locator('[data-pension-source-select="cpp"]')).toHaveValue('manual')

  // and it is now a fact: a later retirement-age change leaves it alone
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const fireAge = page.locator('label.field').filter({ hasText: 'Target FIRE age' }).locator('input')
  await fireAge.fill('55')
  await fireAge.blur()
  await expect(page.locator('label.field').filter({ hasText: 'Estimated CPP/QPP per year at 65' }).locator('input')).toHaveValue('15,000')
  saved = await storedPlan(page)
  expect(saved.inputs.cppAnnualAt65).toBe(15_000)
  expect(saved.inputs.cppAmountSource.source).toBe('manual')
})

test('professional: a figure typed over an estimator amount is kept and recorded as manual', async ({ page }) => {
  await page.goto('/#/guided/income/cpp.self')
  await page.locator('details.estimator', { hasText: 'Estimate from work history' }).locator('summary').click()
  await page.getByRole('button', { name: 'Apply' }).click()
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const amount = page.locator('label.field').filter({ hasText: 'Estimated CPP/QPP per year at 65' }).locator('input')
  await expect(amount).toHaveValue('9,278')
  await amount.fill('15000')
  await amount.blur()
  await expect(amount).toHaveValue('15,000')
  const saved = await storedPlan(page)
  expect(saved.inputs.cppAnnualAt65).toBe(15_000)
  expect(saved.inputs.cppAmountSource.source).toBe('manual')
})

// Review finding B2: both entry modes write the FIRE age through the field
// registry, not `store.set`, so the registry path has to relabel an
// engine-replaced amount. Both the guided page's status line and the guided
// review page derive from `answerMeta`, so the metadata is the contract.
test('a FIRE-age change relabels an engine-replaced amount as an estimate, not a confirmed fact', async ({ page }) => {
  await applyCppEstimator(page)
  // round 3 / BL1: applying the estimator invokes a computation, so the recorded
  // answer is the app's estimate — the same label every other applied engine
  // value carries — and the provenance select above it agrees
  await page.goto('/#/guided/income/cpp.self')
  await expect(page.locator('[data-field="cppAnnualAt65"] small')).toHaveText('estimate')
  await expect(page.locator('[data-field="cppAnnualAt65"] small')).not.toHaveText('confirmed')
  const applied = await storedPlan(page)
  expect(applied.answerMeta.cppAnnualAt65.status).toBe('estimated')
  expect(applied.answerMeta.cppAnnualAt65.origin).toBe('default')
  expect(applied.inputs.cppAmountSource.source).toBe('estimator')

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const fireAge = page.locator('label.field').filter({ hasText: 'Target FIRE age' }).locator('input')
  await fireAge.fill('55')
  await fireAge.blur()
  await expect(page.locator('label.field').filter({ hasText: 'Estimated CPP/QPP per year at 65' }).locator('input')).toHaveValue('13,917')

  // the guided page's own status line stops claiming a user-confirmed number
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/income/cpp.self')
  await expect(page.locator('[data-field="cppAnnualAt65"] small')).toHaveText('estimate')
  await expect(page.locator('[data-field="cppAnnualAt65"] small')).not.toHaveText('confirmed')

  // the stored metadata no longer claims the user confirmed the replaced number
  const saved = await storedPlan(page)
  expect(saved.inputs.cppAnnualAt65).toBe(CPP_AT_55)
  expect(saved.answerMeta.cppAnnualAt65.status).toBe('estimated')
  expect(saved.answerMeta.cppAnnualAt65.assumptionValue).toBe(CPP_AT_55)

  // the guided review page renders from that metadata and still shows the plan
  // (on the narrow viewport the review link lives behind the directory toggle)
  const directory = page.locator('button.mobile-directory-trigger')
  if (await directory.isVisible()) await directory.click()
  await page.locator('button.review-link').click()
  await expect(page.locator('.answer-review')).toBeVisible()
  await expect(page.locator('.review-category-list article', { hasText: 'Other retirement income' })).toBeVisible()
  // the FIRE-age field itself is still a user-confirmed answer
  expect(saved.answerMeta.fireAge.status).toBe('confirmed')
  expect(saved.answerMeta.fireAge.origin).toBe('user')
})

test('mobile: the provenance controls stay inside the viewport', async ({ page }) => {
  await page.goto('/#/guided/income/cpp.self')
  const panel = page.locator('[data-pension-kind="cpp"]')
  await expect(panel).toBeVisible()
  await panel.locator('[data-pension-source-select="cpp"]').selectOption('statement')
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth, document: document.documentElement.scrollWidth,
  }))
  expect(widths.document).toBeLessThanOrEqual(widths.viewport)
})
