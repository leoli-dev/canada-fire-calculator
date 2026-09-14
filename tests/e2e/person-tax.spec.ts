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

/** Seeds a professional couple with a locked retirement account, a LIF-kind
 * option, and optionally an investment property. Every account starts owned
 * by self with confirmed ownership so the panel's amount inputs are prefilled. */
async function seedCouple(page: import('@playwright/test').Page, options: { lif?: boolean; property?: boolean }) {
  await page.goto('/')
  await page.evaluate(async ({ lif, property }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS, DEFAULT_PARTNER } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 65, fireAge: 65, lifeExpectancy: 80,
      retirementSpending: 20000, province: 'ON', annualSavings: 0,
      balances: { tfsa: 100000, rrsp: 500000, nonReg: 200000 }, nonRegBook: 100000,
      cppAnnualAt65: 0, oasAnnualAt65: 0, cppStartAge: 70, oasStartAge: 70,
      lockedRetirement: { balance: 400000, owner: 'self', employeeContribution: 0,
        employerContribution: 0, jurisdiction: 'ON', accessibleAge: 65 },
      investmentProperties: property ? [{ value: 400000, acb: 200000, appreciation: 0, sellAtAge: null, annualRent: 10000 }] : [],
      partner: { ...DEFAULT_PARTNER, currentAge: 63, cppAnnualAt65: 0, oasAnnualAt65: 0 } }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    canonical.accounts.forEach(account => {
      account.ownerId = canonical.people[0].id
      account.taxableOwnerShares = { status: 'known', shares: { [canonical.people[0].id]: 1 } }
    })
    if (lif) canonical.accounts.find((account: { id: string }) => account.id === 'legacy:account:locked')!.kind = 'lif'
    canonical.migration.ownershipNeedsConfirmation = false
    canonical.taxProfile = { spouseSupported: { status: 'known', value: false }, pensionSplit: null }
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: 'professional', guidedView: 'questionnaire',
      inputRevision: 0, resultRevision: null,
    } }))
  }, options)
  await page.reload()
}

test('a recorded locked split survives partner removal and re-add instead of being rewritten', async ({ page }) => {
  await seedCouple(page, {})
  await expect(page.getByTestId('person-tax-facts')).toBeVisible()
  const savedState = () => page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.getByTestId('account-self-amount-legacy:account:locked').fill('250000')
  await page.getByTestId('account-partner-amount-legacy:account:locked').fill('150000')
  await page.getByTestId('account-partner-amount-legacy:account:locked').blur()
  let saved = await savedState()
  expect(saved.canonical.ownershipAmounts['legacy:account:locked']).toEqual(
    { 'legacy:person:self': 250000, 'legacy:person:partner': 150000 })
  // Partner removal and re-add, never touching the legacy lockedRetirement.owner field.
  await page.getByLabel('Household').selectOption('single')
  await page.getByLabel('Household').selectOption('couple')
  saved = await savedState()
  expect(saved.canonical.ownershipAmounts['legacy:account:locked']).toEqual(
    { 'legacy:person:self': 250000, 'legacy:person:partner': 150000 })
  const lockedAccounts = saved.canonical.accounts.filter((account: { id: string }) => account.id.startsWith('legacy:account:locked'))
  expect(lockedAccounts).toHaveLength(1)
  expect(lockedAccounts[0]).toMatchObject({ id: 'legacy:account:locked', balance: 400000, ownerId: null })
  expect(lockedAccounts[0].taxableOwnerShares.status).toBe('unknown')
  expect(saved.canonical.migration.ownershipNeedsConfirmation).toBe(true)
  await expect(page.getByTestId('account-self-amount-legacy:account:locked')).toHaveValue('250000')
  await expect(page.getByTestId('account-partner-amount-legacy:account:locked')).toHaveValue('150000')
  await expect(page.getByTestId('owner-legacy:account:locked')).toHaveValue('')
  await expect(page.getByTestId('ownership-mismatch-legacy:account:locked')).toHaveCount(0)
  // Reload is clean and the scenario save works.
  await page.reload()
  await expect(page.getByText('could not be read safely')).toHaveCount(0)
  await expect(page.getByTestId('account-self-amount-legacy:account:locked')).toHaveValue('250000')
  const comparison = page.getByTestId('scenario-comparison')
  await comparison.locator('summary').click()
  await page.getByRole('button', { name: 'Save current as A' }).click()
  saved = await savedState()
  expect(saved.scenarioACanonical).toBeTruthy()
  expect(saved.scenarioACanonical.ownershipAmounts['legacy:account:locked']).toEqual(
    { 'legacy:person:self': 250000, 'legacy:person:partner': 150000 })
  // Only an explicit legacy owner change may re-record the split to 100%.
  await page.getByLabel('Account owner').selectOption('partner')
  saved = await savedState()
  expect(saved.canonical.ownershipAmounts['legacy:account:locked']).toEqual(
    { 'legacy:person:self': 0, 'legacy:person:partner': 400000 })
  expect(saved.canonical.accounts.filter((account: { id: string }) => account.id.startsWith('legacy:account:locked')))
    .toMatchObject([{ id: 'legacy:account:locked', balance: 400000, ownerId: 'legacy:person:partner' }])
  expect(pageErrors).toEqual([])
})

test('the registered-type control is present in every ownership state in both entry modes', async ({ page }) => {
  await seedCouple(page, { lif: true })
  const rrspType = page.getByTestId('registered-type-legacy:account:rrsp')
  const lifType = page.getByTestId('registered-type-legacy:account:locked')
  // 100% self: both controls present with the current kind.
  await expect(rrspType).toBeVisible()
  await expect(rrspType).toHaveValue('rrsp')
  await expect(lifType).toBeVisible()
  await expect(lifType).toHaveValue('lif')
  // 100% partner: the collapse keeps the base id, so the control stays.
  await page.getByTestId('owner-legacy:account:rrsp').selectOption('legacy:person:partner')
  await expect(page.getByTestId('registered-type-legacy:account:rrsp')).toBeVisible()
  const collapsed = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(collapsed.canonical.accounts.filter((account: { kind: string }) => account.kind === 'rrsp'))
    .toMatchObject([{ id: 'legacy:account:rrsp', ownerId: 'legacy:person:partner' }])
  await page.getByTestId('owner-legacy:account:locked').selectOption('legacy:person:partner')
  await expect(page.getByTestId('registered-type-legacy:account:locked')).toBeVisible()
  // Two-way split: exactly one control per row, and it edits both accounts.
  await page.getByTestId('account-self-amount-legacy:account:rrsp').fill('300000')
  await page.getByTestId('account-partner-amount-legacy:account:rrsp').fill('200000')
  await page.getByTestId('account-partner-amount-legacy:account:rrsp').blur()
  await expect(page.getByTestId('registered-type-legacy:account:rrsp')).toBeVisible()
  expect(await page.locator('[data-testid^="registered-type-"]').count()).toBe(2)
  await page.getByTestId('registered-type-legacy:account:rrsp').selectOption('spousalRrsp')
  const kinds = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.canonical.accounts
    .filter((account: { id: string }) => ['legacy:account:rrsp', 'legacy:account:rrsp:partner'].includes(account.id))
    .map((account: { kind: string }) => account.kind))
  expect(kinds.sort()).toEqual(['spousalRrsp', 'spousalRrsp'])
  // Guided mode shows the same controls in every state.
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/income/income.taxFacts')
  await expect(page.getByTestId('registered-type-legacy:account:rrsp')).toBeVisible()
  await expect(page.getByTestId('registered-type-legacy:account:rrsp')).toHaveValue('spousalRrsp')
  await page.getByTestId('owner-legacy:account:rrsp').selectOption('legacy:person:partner')
  await expect(page.getByTestId('registered-type-legacy:account:rrsp')).toBeVisible()
  await expect(page.getByTestId('registered-type-legacy:account:locked')).toBeVisible()
})

test('an investment property split records both amounts, conserves the value and survives reload', async ({ page }) => {
  await seedCouple(page, { property: true })
  await expect(page.getByTestId('ownership-row-legacy:property:investment:0')).toBeVisible()
  await page.getByTestId('property-self-amount-legacy:property:investment:0').fill('250000')
  await page.getByTestId('property-partner-amount-legacy:property:investment:0').fill('150000')
  await page.getByTestId('property-partner-amount-legacy:property:investment:0').blur()
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  const property = () => saved.canonical.properties.find((item: { id: string }) => item.id === 'legacy:property:investment:0')
  expect(property().value).toBe(400000)
  expect(property().taxableOwnerShares.status).toBe('known')
  expect(property().taxableOwnerShares.shares['legacy:person:self']).toBeCloseTo(0.625, 12)
  expect(property().taxableOwnerShares.shares['legacy:person:partner']).toBeCloseTo(0.375, 12)
  // A mismatch refuses to write a partial split.
  await page.getByTestId('property-self-amount-legacy:property:investment:0').fill('100000')
  await page.getByTestId('property-self-amount-legacy:property:investment:0').blur()
  await expect(page.getByTestId('ownership-mismatch-legacy:property:investment:0')).toBeVisible()
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(property().taxableOwnerShares.shares['legacy:person:self']).toBeCloseTo(0.625, 12)
  await page.getByTestId('property-self-amount-legacy:property:investment:0').fill('250000')
  await page.getByTestId('property-self-amount-legacy:property:investment:0').blur()
  await expect(page.getByTestId('ownership-mismatch-legacy:property:investment:0')).toHaveCount(0)
  // The recorded amounts survive a reload and appear in guided mode too.
  await page.reload()
  await expect(page.getByTestId('property-self-amount-legacy:property:investment:0')).toHaveValue('250000')
  await expect(page.getByTestId('property-partner-amount-legacy:property:investment:0')).toHaveValue('150000')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/income/income.taxFacts')
  await expect(page.getByTestId('property-self-amount-legacy:property:investment:0')).toHaveValue('250000')
  await expect(page.getByTestId('property-partner-amount-legacy:property:investment:0')).toHaveValue('150000')
})

test('every ownership row keeps its recorded facts through partner removal and re-add', async ({ page }) => {
  await seedCouple(page, { lif: true, property: true })
  // Record a split on each row.
  await page.getByTestId('account-self-amount-legacy:account:tfsa').fill('60000')
  await page.getByTestId('account-partner-amount-legacy:account:tfsa').fill('40000')
  await page.getByTestId('account-partner-amount-legacy:account:tfsa').blur()
  await page.getByTestId('account-self-amount-legacy:account:rrsp').fill('300000')
  await page.getByTestId('account-partner-amount-legacy:account:rrsp').fill('200000')
  await page.getByTestId('account-partner-amount-legacy:account:rrsp').blur()
  await page.getByTestId('registered-type-legacy:account:rrsp').selectOption('spousalRrsp')
  await page.getByTestId('registered-type-legacy:account:rrsp').selectOption('rrif')
  await page.getByTestId('account-self-amount-legacy:account:locked').fill('250000')
  await page.getByTestId('account-partner-amount-legacy:account:locked').fill('150000')
  await page.getByTestId('account-partner-amount-legacy:account:locked').blur()
  await page.getByTestId('account-self-amount-legacy:account:nonReg').fill('150000')
  await page.getByTestId('account-partner-amount-legacy:account:nonReg').fill('50000')
  await page.getByTestId('account-partner-amount-legacy:account:nonReg').blur()
  await page.getByTestId('property-self-amount-legacy:property:investment:0').fill('250000')
  await page.getByTestId('property-partner-amount-legacy:property:investment:0').fill('150000')
  await page.getByTestId('property-partner-amount-legacy:property:investment:0').blur()
  // Removal and re-add.
  await page.getByLabel('Household').selectOption('single')
  await page.getByLabel('Household').selectOption('couple')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  const row = (id: string) => saved.canonical.accounts.filter((account: { id: string }) => account.id === id || account.id === `${id}:partner`)
  // Registered rows: recorded amounts survive exactly, totals conserved, ownership suspended.
  expect(saved.canonical.ownershipAmounts['legacy:account:tfsa']).toEqual(
    { 'legacy:person:self': 60000, 'legacy:person:partner': 40000 })
  expect(saved.canonical.ownershipAmounts['legacy:account:rrsp']).toEqual(
    { 'legacy:person:self': 300000, 'legacy:person:partner': 200000 })
  expect(saved.canonical.ownershipAmounts['legacy:account:locked']).toEqual(
    { 'legacy:person:self': 250000, 'legacy:person:partner': 150000 })
  expect(row('legacy:account:tfsa')).toMatchObject([{ id: 'legacy:account:tfsa', balance: 100000, ownerId: null }])
  expect(row('legacy:account:rrsp')).toMatchObject([{ id: 'legacy:account:rrsp', balance: 500000, ownerId: null, kind: 'rrif' }])
  expect(row('legacy:account:locked')).toMatchObject([{ id: 'legacy:account:locked', balance: 400000, ownerId: null, kind: 'lif' }])
  for (const account of row('legacy:account:tfsa').concat(row('legacy:account:rrsp'), row('legacy:account:locked')))
    expect(account.taxableOwnerShares.status).toBe('unknown')
  // The non-registered account and the property keep the conserved total and
  // reset to unknown instead of fabricating an attribution.
  const nonReg = saved.canonical.accounts.find((account: { kind: string }) => account.kind === 'nonReg')
  expect(nonReg.balance).toBe(200000)
  expect(nonReg.taxableOwnerShares.status).toBe('unknown')
  expect(nonReg.ownerId).toBeNull()
  const property = saved.canonical.properties.find((item: { id: string }) => item.id === 'legacy:property:investment:0')
  expect(property.value).toBe(400000)
  expect(property.taxableOwnerShares.status).toBe('unknown')
  expect(saved.canonical.migration.ownershipNeedsConfirmation).toBe(true)
  // Reload is clean and the amounts the UI shows match the recorded facts.
  await page.reload()
  await expect(page.getByText('could not be read safely')).toHaveCount(0)
  await expect(page.getByTestId('account-self-amount-legacy:account:tfsa')).toHaveValue('60000')
  await expect(page.getByTestId('account-partner-amount-legacy:account:tfsa')).toHaveValue('40000')
  await expect(page.getByTestId('account-self-amount-legacy:account:rrsp')).toHaveValue('300000')
  await expect(page.getByTestId('account-partner-amount-legacy:account:rrsp')).toHaveValue('200000')
  await expect(page.getByTestId('account-self-amount-legacy:account:locked')).toHaveValue('250000')
  await expect(page.getByTestId('account-partner-amount-legacy:account:locked')).toHaveValue('150000')
  await expect(page.getByTestId('owner-legacy:account:tfsa')).toHaveValue('')
  await expect(page.getByTestId('owner-legacy:account:rrsp')).toHaveValue('')
  await expect(page.getByTestId('account-self-amount-legacy:account:nonReg')).toHaveValue('')
  await expect(page.getByTestId('property-self-amount-legacy:property:investment:0')).toHaveValue('')
  // Save current as A succeeds and keeps the same facts.
  const comparison = page.getByTestId('scenario-comparison')
  await comparison.locator('summary').click()
  await page.getByRole('button', { name: 'Save current as A' }).click()
  const afterSave = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(afterSave.scenarioACanonical).toBeTruthy()
  expect(afterSave.scenarioACanonical.ownershipAmounts['legacy:account:locked']).toEqual(
    { 'legacy:person:self': 250000, 'legacy:person:partner': 150000 })
  expect(afterSave.scenarioACanonical.ownershipAmounts['legacy:account:rrsp']).toEqual(
    { 'legacy:person:self': 300000, 'legacy:person:partner': 200000 })
})
