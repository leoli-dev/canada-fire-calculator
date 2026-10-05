import { expect, test, type Page } from '@playwright/test'

/** FE-43 A: the household tax facts that used to sit on one long guided page
 * are now short pages next to the answer they depend on. Seeds a guided couple
 * with a home and a rental and no recorded ownership. */
async function seed(page: Page, options: { province?: 'ON' | 'QC'; fhsa?: boolean } = {}) {
  await page.goto('/')
  await page.evaluate(async ({ province, fhsa }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS, DEFAULT_PARTNER } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, province: province ?? 'ON', partner: { ...DEFAULT_PARTNER },
      principalResidence: { value: 800_000, appreciation: 0.01, sellAtAge: null },
      investmentProperties: [{ value: 500_000, acb: 400_000, appreciation: 0.02, sellAtAge: null, annualRent: 20_000 }],
      fhsa: fhsa ? { balance: 0, annualContribution: 8000, openedYearsAgo: 0 } : null }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: 'guided', guidedView: 'questionnaire', inputRevision: 0, resultRevision: null,
    } }))
  }, options)
  await page.reload()
}

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)

test('a couple clears the ownership gate with one choice per row, shared with professional mode', async ({ page }) => {
  await seed(page)
  await page.goto('/#/guided/assets/assets.ownership')
  for (const kind of ['tfsa', 'rrsp', 'nonReg']) await expect(page.getByTestId(`guided-ownership-row-legacy:account:${kind}`)).toBeVisible()
  // Nothing asks for amounts until a row is held by both people.
  await expect(page.getByTestId('account-self-amount-legacy:account:tfsa')).toHaveCount(0)
  await page.getByTestId('owner-choice-legacy:account:tfsa-split').check()
  await page.getByTestId('account-self-amount-legacy:account:tfsa').fill('60000')
  await page.getByTestId('account-partner-amount-legacy:account:tfsa').fill('40000')
  await page.getByTestId('account-partner-amount-legacy:account:tfsa').blur()
  await page.getByTestId('owner-choice-legacy:account:rrsp-partner').check()
  await page.getByTestId('owner-choice-legacy:account:nonReg-split').check()
  await page.getByTestId('account-self-share-legacy:account:nonReg').fill('50')
  await page.getByTestId('account-self-share-legacy:account:nonReg').blur()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)

  let state = await saved(page)
  const tfsa = state.canonical.accounts.filter((account: { kind: string }) => account.kind === 'tfsa')
  expect(tfsa.map((account: { ownerId: string; balance: number }) => [account.ownerId, account.balance]).sort()).toEqual([
    ['legacy:person:partner', 40_000], ['legacy:person:self', 60_000],
  ])
  expect(state.canonical.accounts.find((account: { kind: string }) => account.kind === 'rrsp').ownerId).toBe('legacy:person:partner')
  expect(state.canonical.accounts.find((account: { kind: string }) => account.kind === 'nonReg').taxableOwnerShares.shares)
    .toEqual({ 'legacy:person:self': 0.5, 'legacy:person:partner': 0.5 })
  // The home and the rental are still unanswered.
  expect(state.canonical.migration.ownershipNeedsConfirmation).toBe(true)

  await page.goto('/#/guided/housing/housing.ownership')
  await expect(page.getByTestId('guided-ownership-row-legacy:property:principal')).toBeVisible()
  await page.getByTestId('owner-choice-legacy:property:principal-split').check()
  await page.getByTestId('property-self-share-legacy:property:principal').fill('50')
  await page.getByTestId('property-self-share-legacy:property:principal').blur()
  await page.getByTestId('owner-choice-legacy:property:investment:0-self').check()
  state = await saved(page)
  expect(state.canonical.migration.ownershipNeedsConfirmation).toBe(false)

  // Professional mode reads the very same facts.
  await page.reload()
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId('person-tax-facts')).toBeVisible()
  await expect(page.getByTestId('owner-legacy:account:rrsp')).toHaveValue('legacy:person:partner')
  await expect(page.getByTestId('account-self-share-legacy:account:nonReg')).toHaveValue('50')
  await expect(page.getByTestId('property-self-amount-legacy:property:principal')).toHaveValue('400,000')
  await expect(page.getByTestId('property-owner-legacy:property:investment:0')).toHaveValue('legacy:person:self')
})

test('a zero-balance registered account is answered by naming its owner', async ({ page }) => {
  await seed(page, { fhsa: true })
  await page.goto('/#/guided/assets/assets.ownership')
  const fhsa = page.getByTestId('guided-ownership-row-legacy:account:fhsa')
  await expect(fhsa).toBeVisible()
  // An empty account has no amounts to split, so "each has one" is not offered.
  await expect(page.getByTestId('owner-choice-legacy:account:fhsa-split')).toHaveCount(0)
  await page.getByTestId('owner-choice-legacy:account:fhsa-partner').check()
  const state = await saved(page)
  expect(state.canonical.accounts.find((account: { kind: string }) => account.kind === 'fhsa').ownerId).toBe('legacy:person:partner')
})

test('spouse support is one question with an explicit "not sure", recorded for both modes', async ({ page }) => {
  await seed(page)
  await page.goto('/#/guided/family/family.spouseSupport')
  const question = page.getByTestId('guided-spouse-support')
  await expect(question).toBeVisible()
  await question.getByRole('radio', { name: /Yes/ }).check()
  expect((await saved(page)).canonical.taxProfile.spouseSupported).toEqual({ status: 'known', value: true })
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId('spouse-support')).toHaveValue('true')
  await page.getByTestId('spouse-support').selectOption('unknown')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/family/family.spouseSupport')
  await expect(page.getByTestId('guided-spouse-support').getByRole('radio', { name: /Yes/ })).not.toBeChecked()
  await page.getByTestId('guided-spouse-support').getByRole('radio', { name: /come back/i }).check()
  const state = await saved(page)
  expect(state.canonical.taxProfile.spouseSupported.status).toBe('unknown')
  expect(state.questionAnswers['family.spouseSupport']).toBe('unknown')
})

test('Quebec drug coverage is asked right after the province, one whole-year answer per person', async ({ page }) => {
  await seed(page, { province: 'QC' })
  await page.goto('/#/guided/family/family.province')
  await page.goto('/#/guided/family/family.qcDrug')
  await expect(page.getByTestId('guided-qc-drug')).toBeVisible()
  await page.getByTestId('qc-coverage-all-self-private').check()
  await page.getByTestId('qc-coverage-all-partner-public').check()
  await expect(page.getByTestId('qc-coverage-self-1')).toHaveCount(0)
  // Picking a whole-year status again after opening the month detail closes it.
  await page.getByTestId('qc-coverage-changed-self').check()
  await expect(page.getByTestId('qc-coverage-self-1')).toBeVisible()
  await page.getByTestId('qc-coverage-all-self-private').check()
  await expect(page.getByTestId('qc-coverage-self-1')).toHaveCount(0)
  const coverage = (await saved(page)).canonical.taxProfile.qcDrugCoverage
  expect(coverage['legacy:person:self']).toEqual(Array(12).fill('private'))
  expect(coverage['legacy:person:partner']).toEqual(Array(12).fill('public'))
})

test('the new pages are translated in EN, FR and ZH', async ({ page }) => {
  await seed(page, { province: 'QC' })
  const titles: Record<string, string[]> = {}
  for (const language of ['EN', 'FR', '中文']) {
    await page.getByRole('button', { name: language, exact: true }).click()
    titles[language] = []
    for (const path of ['family/family.spouseSupport', 'family/family.qcDrug', 'assets/assets.ownership', 'housing/housing.ownership']) {
      await page.goto(`/#/guided/${path}`)
      const title = (await page.locator('.question-page h2').first().textContent())?.trim() ?? ''
      expect(title.length, `${language} ${path}`).toBeGreaterThan(5)
      expect(title, `${language} ${path}`).not.toContain('questionnaire.')
      titles[language].push(title)
    }
  }
  expect(titles.FR).not.toEqual(titles.EN)
  expect(titles['中文']).not.toEqual(titles.EN)
})
