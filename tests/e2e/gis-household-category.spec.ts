import { expect, test } from '@playwright/test'

/**
 * BE-26 A: a 65/60 couple whose only income is TFSA withdrawals. The GIS
 * income test excludes OAS and cannot see TFSA money, so the household sees
 * zero countable income: at 65 the primary receives the allowance-category GIS
 * (676.09/month) plus the Allowance (1,428.06/month), which the year table
 * shows as one 25,249.80 tax-free line. The same recorded plan must price the
 * same figure in both entry modes, survive a reload and a mode switch, and
 * stay inside a 320px viewport.
 *
 * The expected number is annualized from the published July-September 2026
 * table, not read back from this calculator's engine.
 */
const YEARLY_GIS_PLUS_ALLOWANCE = 25249.8

async function seed(page: import('@playwright/test').Page, options: { guided?: boolean } = {}) {
  await page.goto('/')
  await page.evaluate(async ({ guided }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = {
      ...DEFAULT_INPUTS, currentAge: 65, fireAge: 65, lifeExpectancy: 80,
      province: 'ON', annualSavings: 0, retirementSpending: 30_000, inflation: 0,
      returns: { tfsa: 0.03, rrsp: 0.03, nonReg: 0.03 },
      savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 },
      balances: { tfsa: 500_000, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
      strategy: 'tfsaFirst', cppStartAge: 70, cppAnnualAt65: 0,
      oasStartAge: 65, oasAnnualAt65: 9024,
      partner: { currentAge: 60, cppStartAge: 70, cppAnnualAt65: 0,
        oasStartAge: 65, oasAnnualAt65: 9024 },
    }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    // A named owner for every account, so the shared results gate can price the
    // plan person-by-person instead of falling back to a household estimate.
    const self = canonical.people.find((person: { role: string }) => person.role === 'self')!
    canonical.accounts.forEach((account: {
      ownerId: string | null
      taxableOwnerShares: unknown
    }) => {
      account.ownerId = self.id
      account.taxableOwnerShares = { status: 'known', shares: { [self.id]: 1 } }
    })
    canonical.migration.ownershipNeedsConfirmation = false
    // The seeded CPP/OAS amounts are the legacy plan's own fields, not
    // canonical income sources with a named recipient; a recipient-less source
    // would hold the household at the precision gate.
    canonical.incomeSources = canonical.incomeSources.filter(
      (source: { recipientId: string | null }) => source.recipientId !== null)
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: guided ? 'guided' : 'professional',
      guidedView: guided ? 'results' : 'questionnaire',
      inputRevision: 0, resultRevision: guided ? 0 : null,
    } }))
  }, options)
  await page.reload()
}

const inViewport = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

test('professional mode states the allowance-category row for a 65/60 zero-income couple', async ({ page }) => {
  await seed(page)
  const panel = page.getByTestId('benefit-category-panel')
  await panel.locator('summary').click()
  await expect(page.getByTestId('benefit-category-name'))
    .toHaveText('Couple, one pensioner + Allowance spouse')
  await expect(page.getByTestId('benefit-category-cutoff')).toHaveText('CA$42,144')
  // 676.09/month GIS and 1,428.06/month Allowance, annualized from the
  // published July-September 2026 table (the panel shows rounded dollars).
  await expect(page.getByTestId('benefit-gis-65')).toHaveText('CA$8,113')
  await expect(page.getByTestId('benefit-allowance-65')).toHaveText('CA$17,137')
  await expect(page.getByTestId('benefit-total-65')).toHaveText('CA$25,250')
  // Once the spouse turns 65 the household moves to the both-pensioners row
  // with its own 30,096 cut-off (the primary is 70 that year).
  await page.getByTestId('benefit-category-year').selectOption('70')
  await expect(page.getByTestId('benefit-category-name')).toHaveText('Couple, both receive OAS')
  await expect(page.getByTestId('benefit-category-cutoff')).toHaveText('CA$30,096')
  // The published both-pensioners maximum is 2 x 676.09 x 12 = 16,226.16 at
  // zero countable income. This plan's modelled year carries about 450 of
  // countable income, where published Table 2 pays 2 x 667.09 x 12 = 16,010.16;
  // the fitted row is 0.77/month below that, inside the pack's recorded $2.00
  // bound, and the panel shows its own modelled figure.
  await expect(page.getByTestId('benefit-total-70')).toHaveText('CA$16,001')
  // Reload keeps the same plan and the same priced row.
  await page.reload()
  await panel.locator('summary').click()
  await expect(page.getByTestId('benefit-category-name')).toHaveText('Couple, one pensioner + Allowance spouse')
  await expect(page.getByTestId('benefit-total-65')).toHaveText('CA$25,250')
  // The same recorded plan prices identically in guided mode. Entering guided
  // mode leaves the questionnaire; viewing its results is the flow's explicit
  // confirmation step, so record that confirmation and open the results in a
  // fresh page load of the same persisted plan.
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await expect(page.locator('.questionnaire-layout, .answer-review').first()).toBeVisible()
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    localStorage.setItem('fire-inputs', JSON.stringify({
      ...stored,
      state: { ...stored.state, guidedView: 'results', resultRevision: stored.state.inputRevision },
    }))
  })
  const guidedPage = await page.context().newPage()
  await guidedPage.goto('/#/guided/results')
  const guidedPanel = guidedPage.getByTestId('benefit-category-panel')
  await guidedPanel.locator('summary').click()
  await expect(guidedPage.getByTestId('benefit-category-name'))
    .toHaveText('Couple, one pensioner + Allowance spouse')
  await expect(guidedPage.getByTestId('benefit-total-65')).toHaveText('CA$25,250')
  await guidedPage.close()
  // A mode switch changes navigation only: the same plan, the same row.
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId('benefit-total-65')).toHaveText('CA$25,250')
})

test('guided mode agrees with professional and the panel stays inside a 320px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await seed(page, { guided: true })
  await page.goto('/#/guided/results')
  await page.getByTestId('benefit-category-panel').locator('summary').click()
  await expect(page.getByTestId('benefit-total-65')).toHaveText('CA$25,250')
  expect(await inViewport(page)).toBe(true)
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId('benefit-total-65')).toHaveText('CA$25,250')
  expect(await inViewport(page)).toBe(true)
})
