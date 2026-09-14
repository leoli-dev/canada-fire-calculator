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
