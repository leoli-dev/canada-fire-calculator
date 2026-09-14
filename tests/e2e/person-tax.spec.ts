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

test('QC unknown/public coverage stays visibly limited in EN, FR and ZH; private facts work in both modes', async ({ page }) => {
  await seed(page, { province: 'QC' })
  for (const [language, fragment] of [
    ['EN', 'Schedule K'], ['FR', 'annexe K'], ['中文', '附表K'],
  ] as const) {
    await page.getByRole('button', { name: language, exact: true }).click()
    await expect(page.getByTestId('person-tax-limit')).toContainText(fragment)
    await expect(page.getByTestId('person-tax-table')).toHaveCount(0)
  }
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await page.getByTestId('qc-coverage-all-self').selectOption('private')
  await expect(page.getByTestId('person-tax-limit')).toHaveCount(0)
  await expect(page.getByTestId('person-tax-table')).toBeVisible()
  await page.getByTestId('person-tax-table').locator('summary').click()
  await expect(page.getByTestId('person-tax-table')).toContainText('FSS contribution')
  await expect(page.getByTestId('person-tax-table')).toContainText('RAMQ premium')
  await page.getByRole('button', { name: 'FR', exact: true }).click()
  await expect(page.getByTestId('person-tax-table')).toContainText('Cotisation FSS')
  await page.getByRole('button', { name: '中文' }).click()
  await expect(page.getByTestId('person-tax-table')).toContainText('FSS缴费')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/income/income.taxFacts')
  await expect(page.getByTestId('qc-coverage-all-self')).toHaveValue('private')
  await page.getByTestId('qc-coverage-self-7').selectOption('public')
  await page.reload()
  await expect(page.getByTestId('qc-coverage-self-7')).toHaveValue('public')
  await expect(page.getByTestId('qc-coverage-self-6')).toHaveValue('private')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(saved.canonical.taxProfile.qcDrugCoverage['legacy:person:self'][6]).toBe('public')
  expect(saved.resultRevision).toBeNull()
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId('person-tax-limit')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})

test('QC spouse coverage is independent and the Quebec election is separate from federal', async ({ page }) => {
  await seed(page, { couple: true, pension: true, province: 'QC' })
  await page.getByTestId('qc-coverage-all-self').selectOption('private')
  await page.getByTestId('qc-coverage-all-partner').selectOption('waived')
  await expect(page.getByTestId('qc-coverage-all-self')).toHaveValue('private')
  await expect(page.getByTestId('qc-coverage-all-partner')).toHaveValue('waived')
  await page.getByTestId('split-transferor').selectOption('legacy:person:self')
  await page.getByTestId('split-amount').fill('10000')
  await page.getByTestId('split-amount').blur()
  await expect(page.getByTestId('qc-split-transferor')).toHaveValue('')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/income/income.taxFacts')
  await expect(page.getByTestId('qc-coverage-all-partner')).toHaveValue('waived')
  await expect(page.getByTestId('qc-split-transferor')).toHaveValue('')
})

test('current and Scenario A keep independent Quebec coverage facts', async ({ page }) => {
  await seed(page, { province: 'QC' })
  await page.getByTestId('qc-coverage-all-self').selectOption('private')
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('fire-inputs')!)
    saved.state.scenarioA = structuredClone(saved.state.inputs)
    saved.state.scenarioACanonical = structuredClone(saved.state.canonical)
    saved.state.scenarioACanonical.taxProfile.qcDrugCoverage['legacy:person:self'][6] = 'public'
    localStorage.setItem('fire-inputs', JSON.stringify(saved))
  })
  await page.reload()
  await expect(page.getByTestId('person-tax-table')).toBeVisible()
  const scenario = page.getByTestId('scenario-comparison')
  await scenario.locator('summary').click()
  await expect(scenario.getByText('Comparison unavailable')).toHaveCount(2)
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('fire-inputs')!)
    const currentCoverage = saved.state.canonical.taxProfile.qcDrugCoverage['legacy:person:self']
    const scenarioCoverage = saved.state.scenarioACanonical.taxProfile.qcDrugCoverage['legacy:person:self']
    saved.state.canonical.taxProfile.qcDrugCoverage['legacy:person:self'] = scenarioCoverage
    saved.state.scenarioACanonical.taxProfile.qcDrugCoverage['legacy:person:self'] = currentCoverage
    localStorage.setItem('fire-inputs', JSON.stringify(saved))
  })
  await page.reload()
  await expect(page.getByTestId('person-tax-table')).toHaveCount(0)
  await expect(page.getByTestId('person-tax-limit')).toBeVisible()
  await expect(page.getByTestId('qc-coverage-self-7')).toHaveValue('public')
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
  await expect(comparison).toContainText('After-tax estate comparison is unavailable')
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
  await expect(page.getByTestId('scenario-comparison')).toContainText('After-tax estate comparison is unavailable')
})

test('couple terminal tax cannot masquerade as final net worth in Scenario A comparison', async ({ page }) => {
  await page.goto('/')
  const values = await page.evaluate(async () => {
    localStorage.clear()
    const { DEFAULT_INPUTS, DEFAULT_PARTNER } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const { runProjection } = await import('/src/engine/projection.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 68, fireAge: 68, lifeExpectancy: 68,
      retirementSpending: 0, annualSavings: 0, fees: 0,
      balances: { tfsa: 0, rrsp: 100_000, nonReg: 0 }, nonRegBook: 0,
      returns: { tfsa: 0, rrsp: 0, nonReg: 0 },
      cppAnnualAt65: 0, oasAnnualAt65: 0,
      partner: { ...DEFAULT_PARTNER, currentAge: 68, cppAnnualAt65: 0, oasAnnualAt65: 0 } }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    canonical.accounts.forEach(account => { account.ownerId = canonical.people[0].id;
      account.taxableOwnerShares = { status: 'known', shares: { [canonical.people[0].id]: 1 } } })
    canonical.migration = { sourcePersistVersion: 11, ownershipNeedsConfirmation: false,
      ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
    canonical.taxProfile = { spouseSupported: { status: 'known', value: false }, pensionSplit: null }
    const result = runProjection(inputs, undefined, canonical)
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: { inputs, canonical,
      scenarioA: structuredClone(inputs), scenarioACanonical: structuredClone(canonical),
      entryMode: 'professional', inputRevision: 0, resultRevision: null } }))
    return { tax: result.taxCapability?.status, terminal: result.terminalTaxStatus,
      netWorth: result.finalNetWorth, estate: result.estateValue }
  })
  expect(values.tax).toBe('person')
  expect(values.terminal).toBe('unsupported')
  expect(values.netWorth).toBeGreaterThan(values.estate)
  await page.reload()
  const scenario = page.getByTestId('scenario-comparison')
  await scenario.locator('summary').click()
  await expect(scenario).toContainText('After-tax estate comparison is unavailable')
  await expect(scenario.locator('tbody td.num')).toHaveText(['—', '—'])
  await expect(scenario).not.toContainText(Math.round(values.estate).toLocaleString('en-CA'))
  await page.getByRole('button', { name: 'FR', exact: true }).click()
  await expect(scenario).toContainText('La comparaison des successions après impôt est indisponible')
  await page.getByRole('button', { name: '中文' }).click()
  await expect(scenario).toContainText('税后遗产比较不可用')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await page.evaluate(async () => {
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const saved = JSON.parse(localStorage.getItem('fire-inputs')!)
    const inputs = { ...saved.state.inputs, partner: null }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    saved.state.inputs = inputs
    saved.state.canonical = canonical
    saved.state.scenarioA = structuredClone(inputs)
    saved.state.scenarioACanonical = structuredClone(canonical)
    localStorage.setItem('fire-inputs', JSON.stringify(saved))
  })
  await page.reload()
  const singleScenario = page.getByTestId('scenario-comparison')
  await singleScenario.locator('summary').click()
  await expect(singleScenario.getByRole('columnheader', { name: 'Final net worth' })).toBeVisible()
  await expect(singleScenario.locator('tbody td.num')).toHaveText([/100,000/, /100,000/])
})

test('RRIF age-71 category is explicit and shared across Professional and Guided', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 72, fireAge: 72, lifeExpectancy: 72,
      retirementSpending: 0, balances: { tfsa: 0, rrsp: 1_000_000, nonReg: 0 },
      returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, cppAnnualAt65: 0, oasAnnualAt65: 0,
      partner: null }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    const rrif = canonical.accounts.find(account => account.kind === 'rrsp')!
    rrif.kind = 'rrif'
    rrif.openedYear = { status: 'known', value: 1990 }
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: { inputs, canonical,
      entryMode: 'professional', inputRevision: 0, resultRevision: null } }))
  })
  await page.reload()
  await expect(page.getByTestId('person-tax-limit')).toBeVisible()
  await expect(page.getByTestId('person-tax-table')).toHaveCount(0)
  const panel = page.getByTestId('person-tax-facts')
  await expect(panel).toContainText('Opening year alone does not prove qualification')
  await expect(panel.getByRole('link', { name: 'CRA prescribed-factor chart' }))
    .toHaveAttribute('href', /canada\.ca\/.*chart-prescribed-factors/)
  await page.getByRole('button', { name: 'FR', exact: true }).click()
  await expect(panel).toContainText('L’année d’ouverture ne prouve pas la catégorie')
  await page.getByRole('button', { name: '中文' }).click()
  await expect(panel).toContainText('仅凭开户年份不能确认资格')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  const category = page.getByTestId('rrif-factor-category-legacy:account:rrsp')
  await category.selectOption('qualifying')
  await expect(page.getByTestId('person-tax-table')).toBeVisible()
  await expect(page.getByTestId('person-tax-limit')).toHaveCount(0)
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/income/income.taxFacts')
  await expect(category).toHaveValue('qualifying')
  await page.reload()
  await expect(category).toHaveValue('qualifying')
})

test('each spouse records their own registered balance; the household total is conserved and results stay honest', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    const { DEFAULT_INPUTS, DEFAULT_PARTNER } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 65, fireAge: 65, lifeExpectancy: 70,
      retirementSpending: 20000, province: 'ON', annualSavings: 0,
      balances: { tfsa: 100000, rrsp: 500000, nonReg: 200000 }, nonRegBook: 100000,
      cppAnnualAt65: 0, oasAnnualAt65: 0, cppStartAge: 70, oasStartAge: 70,
      partner: { ...DEFAULT_PARTNER, currentAge: 63, cppAnnualAt65: 0, oasAnnualAt65: 0 } }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    canonical.accounts.forEach(account => { account.ownerId = canonical.people[0].id
      account.taxableOwnerShares = { status: 'known', shares: { [canonical.people[0].id]: 1 } } })
    canonical.migration.ownershipNeedsConfirmation = false
    canonical.taxProfile = { spouseSupported: { status: 'known', value: false }, pensionSplit: null }
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: 'professional', guidedView: 'questionnaire',
      inputRevision: 0, resultRevision: null,
    } }))
  })
  await page.reload()
  const panel = page.getByTestId('person-tax-facts')
  await expect(panel).toBeVisible()
  // 100/0 ownership is a verified single-owner plan: precise person tax shows.
  await expect(page.getByTestId('person-tax-table')).toBeVisible()
  await expect(page.getByTestId('person-tax-limit')).toHaveCount(0)
  await page.getByTestId('account-self-amount-legacy:account:rrsp').fill('300000')
  await page.getByTestId('account-partner-amount-legacy:account:rrsp').fill('200000')
  await page.getByTestId('account-partner-amount-legacy:account:rrsp').blur()
  await expect(page.getByTestId('ownership-sum-legacy:account:rrsp')).toContainText('500,000')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  const rrspAccounts = saved.canonical.accounts.filter((account: { kind: string }) => account.kind === 'rrsp')
  expect(rrspAccounts.map((account: { balance: number }) => account.balance).sort((x: number, y: number) => x - y)).toEqual([200000, 300000])
  expect(rrspAccounts.reduce((sum: number, account: { balance: number }) => sum + account.balance, 0)).toBe(500000)
  expect(rrspAccounts.map((account: { ownerId: string }) => account.ownerId).sort())
    .toEqual(['legacy:person:partner', 'legacy:person:self'])
  // a genuine two-owner registered split is BE-14 B: results stay labelled estimates
  await expect(page.getByTestId('person-tax-limit')).toBeVisible()
  await expect(page.getByTestId('person-tax-table')).toHaveCount(0)
  // a mismatch is visible and refuses to write a partial split
  await page.getByTestId('account-self-amount-legacy:account:rrsp').fill('100000')
  await page.getByTestId('account-partner-amount-legacy:account:rrsp').blur()
  await expect(page.getByTestId('ownership-mismatch-legacy:account:rrsp')).toBeVisible()
  const afterMismatch = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(afterMismatch.canonical.accounts.filter((account: { kind: string }) => account.kind === 'rrsp')
    .map((account: { balance: number }) => account.balance).sort((x: number, y: number) => x - y)).toEqual([200000, 300000])
  await page.getByTestId('account-self-amount-legacy:account:rrsp').fill('300000')
  await page.getByTestId('account-self-amount-legacy:account:rrsp').blur()
  await expect(page.getByTestId('ownership-mismatch-legacy:account:rrsp')).toHaveCount(0)
  // non-registered amounts become proportional shares
  await page.getByTestId('account-self-amount-legacy:account:nonReg').fill('150000')
  await page.getByTestId('account-partner-amount-legacy:account:nonReg').fill('50000')
  await page.getByTestId('account-partner-amount-legacy:account:nonReg').blur()
  const shares = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('fire-inputs')!).state
    return state.canonical.accounts.find((account: { kind: string }) => account.kind === 'nonReg').taxableOwnerShares.shares
  })
  expect(shares['legacy:person:self']).toBeCloseTo(.75, 12)
  expect(shares['legacy:person:partner']).toBeCloseTo(.25, 12)
  // the 100/0 select path still works and the records survive a reload
  await page.getByTestId('owner-legacy:account:tfsa').selectOption('legacy:person:partner')
  await page.reload()
  await expect(page.getByTestId('person-tax-limit')).toBeVisible()
  await expect(page.getByTestId('account-self-amount-legacy:account:rrsp')).toHaveValue('300000')
  await expect(page.getByTestId('account-partner-amount-legacy:account:rrsp')).toHaveValue('200000')
  await expect(page.getByTestId('account-self-amount-legacy:account:nonReg')).toHaveValue('150000')
  await expect(page.getByTestId('account-partner-amount-legacy:account:nonReg')).toHaveValue('50000')
  // guided mode shows the same recorded facts
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/income/income.taxFacts')
  await expect(page.getByTestId('account-self-amount-legacy:account:rrsp')).toHaveValue('300000')
  await expect(page.getByTestId('account-partner-amount-legacy:account:rrsp')).toHaveValue('200000')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})
