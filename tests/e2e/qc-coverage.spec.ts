import { expect, test } from '@playwright/test'

/** FE-36 A: the QC coverage block is annual-first — one whole-year status per
 * person, month detail only after the user says coverage changed. Seeds a QC
 * couple with a confirmed 40k pension so person-level Quebec tax is available
 * once coverage is confirmed. */
async function seed(page: import('@playwright/test').Page, options: { guided?: boolean }) {
  await page.goto('/')
  await page.evaluate(async ({ guided }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS, DEFAULT_PARTNER } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 62, fireAge: 62, lifeExpectancy: 64,
      retirementSpending: 20_000, province: 'QC',
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
      cppAnnualAt65: 0, oasAnnualAt65: 0, cppStartAge: 70, oasStartAge: 70,
      pension: { annualAmount: 40_000, startAge: 62, indexation: 1, bridgeAnnual: 0 },
      partner: { ...DEFAULT_PARTNER, currentAge: 62, cppAnnualAt65: 0, oasAnnualAt65: 0 } }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    canonical.accounts.forEach(account => {
      account.ownerId = canonical.people[0].id
      account.taxableOwnerShares = { status: 'known', shares: { [canonical.people[0].id]: 1 } }
    })
    canonical.migration.ownershipNeedsConfirmation = false
    canonical.taxProfile = { spouseSupported: { status: 'known', value: false }, pensionSplit: null }
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: guided ? 'guided' : 'professional', guidedView: guided ? 'results' : 'questionnaire',
      inputRevision: 0, resultRevision: guided ? 0 : null,
    } }))
  }, options)
  await page.reload()
}

test('QC couple confirms a whole-year status with no month-by-month work in professional mode', async ({ page }) => {
  await seed(page, {})
  await expect(page.getByTestId('qc-drug-coverage')).toBeVisible()
  // Default: one annual status per person, no month grid, no change toggle.
  await expect(page.getByTestId('qc-coverage-self-1')).toHaveCount(0)
  await expect(page.getByTestId('qc-coverage-changed-self')).not.toBeChecked()
  await expect(page.getByTestId('person-tax-limit')).toBeVisible()
  // Two annual picks confirm the whole year for both people.
  await page.getByTestId('qc-coverage-all-self').selectOption('private')
  await page.getByTestId('qc-coverage-all-partner').selectOption('waived')
  await expect(page.getByTestId('qc-coverage-self-1')).toHaveCount(0)
  await expect(page.getByTestId('qc-coverage-changed-self')).not.toBeChecked()
  await expect(page.getByTestId('person-tax-table')).toBeVisible()
  await expect(page.getByTestId('person-tax-limit')).toHaveCount(0)
  // The whole-year status is recorded as twelve identical months per person.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(saved.canonical.taxProfile.qcDrugCoverage['legacy:person:self']).toEqual(Array(12).fill('private'))
  expect(saved.canonical.taxProfile.qcDrugCoverage['legacy:person:partner']).toEqual(Array(12).fill('waived'))
  // Reload keeps the confirmation and the compact layout inside the viewport.
  await page.reload()
  await expect(page.getByTestId('qc-coverage-all-self')).toHaveValue('private')
  await expect(page.getByTestId('qc-coverage-all-partner')).toHaveValue('waived')
  await expect(page.getByTestId('qc-coverage-self-1')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})

test('guided mode records a genuine mid-year change that survives reload and mode switch', async ({ page }) => {
  await seed(page, { guided: true })
  await page.goto('/#/guided/income/income.taxFacts')
  await expect(page.getByTestId('qc-drug-coverage')).toBeVisible()
  await expect(page.getByTestId('qc-coverage-self-1')).toHaveCount(0)
  await page.getByTestId('qc-coverage-all-self').selectOption('private')
  await page.getByTestId('qc-coverage-all-partner').selectOption('private')
  await expect(page.getByTestId('qc-coverage-self-1')).toHaveCount(0)
  // A genuine mid-year change: reveal the month detail, then edit one month.
  await page.getByTestId('qc-coverage-changed-self').check()
  await expect(page.getByTestId('qc-coverage-self-7')).toBeVisible()
  await page.getByTestId('qc-coverage-self-7').selectOption('public')
  await expect(page.getByTestId('qc-coverage-all-self')).toHaveValue('mixed')
  // Guided never auto-regenerates results on an edit: generate stays explicit.
  const stale = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(stale.resultRevision).toBeNull()
  // Reload keeps the mixed pattern and re-reveals the month detail.
  await page.reload()
  await expect(page.getByTestId('qc-coverage-changed-self')).toBeChecked()
  await expect(page.getByTestId('qc-coverage-self-7')).toHaveValue('public')
  await expect(page.getByTestId('qc-coverage-self-6')).toHaveValue('private')
  // Professional shows the same recorded facts; the public month stays a
  // labelled estimate and the 320px layout stays inside the viewport.
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId('person-tax-limit')).toBeVisible()
  await expect(page.getByTestId('person-tax-table')).toHaveCount(0)
  await expect(page.getByTestId('qc-coverage-changed-self')).toBeChecked()
  await expect(page.getByTestId('qc-coverage-self-7')).toHaveValue('public')
  await expect(page.getByTestId('qc-coverage-self-6')).toHaveValue('private')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})

test('the QC coverage block explains its purpose in EN, FR and ZH', async ({ page }) => {
  await seed(page, {})
  const panel = page.getByTestId('qc-drug-coverage')
  await expect(panel).toContainText('TP-1 line 447')
  await expect(panel).toContainText('Coverage for the whole year')
  await page.getByRole('button', { name: 'FR', exact: true }).click()
  await expect(panel).toContainText('ligne 447')
  await expect(panel).toContainText('Couverture pour toute l’année')
  await page.getByRole('button', { name: '中文' }).click()
  await expect(panel).toContainText('第447行')
  await expect(panel).toContainText('全年保险状态')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await page.getByTestId('qc-coverage-changed-self').check()
  await expect(panel).toContainText('Only needed when coverage changed mid-year')
})
