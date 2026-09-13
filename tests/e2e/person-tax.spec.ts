import { expect, test } from '@playwright/test'

async function seed(page: import('@playwright/test').Page, options: { couple?: boolean; province?: 'ON' | 'QC'; pension?: boolean; guided?: boolean }) {
  await page.goto('/')
  await page.evaluate(async ({ couple, province, pension, guided }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS, DEFAULT_PARTNER } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 62, fireAge: 62, lifeExpectancy: 64,
      retirementSpending: 20_000, province: province ?? 'ON',
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
      cppAnnualAt65: 0, oasAnnualAt65: 0, cppStartAge: 70, oasStartAge: 70,
      partner: couple ? { ...DEFAULT_PARTNER, currentAge: 62, cppAnnualAt65: 0, oasAnnualAt65: 0 } : null,
      pension: pension ? { annualAmount: 40_000, startAge: 62, indexation: 1, bridgeAnnual: 0 } : null }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    if (couple && pension) {
      canonical.accounts.forEach(account => {
        account.ownerId = canonical.people[0].id
        account.taxableOwnerShares = { status: 'known', shares: { [canonical.people[0].id]: 1 } }
      })
      canonical.migration.ownershipNeedsConfirmation = false
      canonical.taxProfile = { spouseSupported: { status: 'known', value: false }, pensionSplit: null }
    }
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: guided ? 'guided' : 'professional', guidedView: guided ? 'results' : 'questionnaire',
      inputRevision: 0, resultRevision: guided ? 0 : null,
    } }))
  }, options)
  await page.reload()
}

test('shared tax ownership survives Guided/Professional switch and refresh without stale guided results', async ({ page }) => {
  await seed(page, { couple: true, guided: true })
  await expect(page.locator('.results-column')).toBeVisible()
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const panel = page.getByTestId('person-tax-facts')
  await expect(panel).toBeVisible()
  await page.getByTestId('owner-legacy:account:tfsa').selectOption('legacy:person:self')
  await page.getByTestId('owner-legacy:account:rrsp').selectOption('legacy:person:partner')
  await page.getByTestId('owner-legacy:account:nonReg').selectOption('legacy:person:self')
  await page.getByTestId('account-self-share-legacy:account:nonReg').fill('80')
  await page.getByTestId('account-self-share-legacy:account:nonReg').blur()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  const shares = saved.canonical.accounts.find((account: { kind: string }) => account.kind === 'nonReg').taxableOwnerShares.shares
  expect(shares['legacy:person:self']).toBeCloseTo(.8, 12)
  expect(shares['legacy:person:partner']).toBeCloseTo(.2, 12)
  expect(saved.resultRevision).toBeNull()
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/income/income.taxFacts')
  await expect(page.getByTestId('person-tax-facts')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await expect(page.getByTestId('account-self-share-legacy:account:nonReg')).toHaveValue('80')
  await page.reload()
  await expect(page.getByTestId('account-self-share-legacy:account:nonReg')).toHaveValue('80')
  await expect(page.locator('.results-column')).toHaveCount(0)
})

test('explicit DB pension election changes the normal person tax ledger in both modes', async ({ page }) => {
  await seed(page, { couple: true, pension: true })
  await expect(page.getByTestId('person-tax-table')).toBeVisible()
  await page.getByTestId('split-transferor').selectOption('legacy:person:self')
  await page.getByTestId('split-amount').fill('20000')
  await page.getByTestId('split-amount').blur()
  const table = page.getByTestId('person-tax-table')
  await table.locator('summary').click()
  await expect(table.locator('tbody tr').first()).toContainText('20,000')
  await expect(table.locator('tbody tr').nth(1)).toContainText('20,000')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/income/income.taxFacts')
  await expect(page.getByTestId('split-amount')).toHaveValue('20000')
  await page.reload()
  await expect(page.getByTestId('split-amount')).toHaveValue('20000')
})

test('QC family/FSS/RAMQ tax capability stays visibly limited in EN, FR and ZH', async ({ page }) => {
  await seed(page, { province: 'QC' })
  for (const [language, fragment] of [
    ['EN', 'person-level tax'], ['FR', 'impôt individuel'], ['中文', '魁省逐人税务'],
  ] as const) {
    await page.getByRole('button', { name: language, exact: true }).click()
    await expect(page.getByTestId('person-tax-limit')).toContainText(fragment)
    await expect(page.getByTestId('person-tax-table')).toHaveCount(0)
  }
})

test('current and Scenario A each retain their own person-tax capability', async ({ page }) => {
  await seed(page, { province: 'ON' })
  await page.evaluate(async () => {
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const saved = JSON.parse(localStorage.getItem('fire-inputs')!)
    const on = saved.state.inputs
    const qc = { ...on, province: 'QC' }
    saved.state.scenarioA = qc
    saved.state.scenarioACanonical = refreshCanonicalFromLegacy(null, qc)
    localStorage.setItem('fire-inputs', JSON.stringify(saved))
  })
  await page.reload()
  const comparison = page.getByTestId('scenario-comparison')
  await comparison.locator('summary').click()
  await expect(comparison).toContainText('Exact current versus Scenario A comparison requires')
  await expect(comparison.getByText('Comparison unavailable')).toHaveCount(2)
  await page.evaluate(async () => {
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const saved = JSON.parse(localStorage.getItem('fire-inputs')!)
    const on = saved.state.inputs
    const qc = { ...on, province: 'QC' }
    saved.state.inputs = qc
    saved.state.canonical = refreshCanonicalFromLegacy(null, qc)
    saved.state.scenarioA = on
    saved.state.scenarioACanonical = refreshCanonicalFromLegacy(null, on)
    localStorage.setItem('fire-inputs', JSON.stringify(saved))
  })
  await page.reload()
  await expect(page.getByTestId('scenario-comparison')).toContainText('Exact current versus Scenario A comparison requires')
})
