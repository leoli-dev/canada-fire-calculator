import { expect, test, type Page } from '@playwright/test'

/** BE-12 B: the spousal-plan premium history and the T2205 attribution are
 * entered in the shared tax panel, so guided and professional show the same
 * recorded facts and the same split. `legacy:account:rrsp` is the seeded
 * household RRSP; it becomes the spousal plan owned by `self`. */
const ACCOUNT = 'legacy:account:rrsp'
const ROW0 = `be12:spousal:${ACCOUNT}:0`
const ROW1 = `be12:spousal:${ACCOUNT}:1`
const SELF = 'legacy:person:self'
const PARTNER = 'legacy:person:partner'

async function seed(page: Page, options: { guided?: boolean } = {}) {
  await page.goto('/')
  await page.evaluate(async ({ guided }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 40, fireAge: 60, lifeExpectancy: 90,
      annualSavings: 40_000, retirementSpending: 40_000,
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
      cppAnnualAt65: 0, oasAnnualAt65: 0,
      partner: { currentAge: 38, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 } }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: guided ? 'guided' : 'professional', guidedView: guided ? 'results' : 'questionnaire',
      inputRevision: 0, resultRevision: guided ? 0 : null,
    } }))
  }, options)
  await page.reload()
}

const baseYear = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.canonical.baseYear as number)

/** Turn the seeded household RRSP into a spousal plan owned by `self`. */
async function makeSpousal(page: Page) {
  await page.getByTestId(`owner-${ACCOUNT}`).selectOption(SELF)
  await page.getByTestId(`registered-type-${ACCOUNT}`).selectOption('spousalRrsp')
  await expect(page.getByTestId(`spousal-attribution-${ACCOUNT}`)).toBeVisible()
}

async function addPremium(page: Page, rowId: string, values: { year: number; contributor: string; amount: number }) {
  await page.getByTestId(`spousal-add-${ACCOUNT}`).click()
  await page.getByTestId(`spousal-year-${rowId}`).fill(String(values.year))
  await page.getByTestId(`spousal-year-${rowId}`).blur()
  await page.getByTestId(`spousal-contributor-${rowId}`).selectOption(values.contributor)
  await page.getByTestId(`spousal-amount-${rowId}`).fill(String(values.amount))
  await page.getByTestId(`spousal-amount-${rowId}`).blur()
}

async function previewPayment(page: Page, amount: number) {
  await page.getByTestId(`spousal-payment-${ACCOUNT}`).fill(String(amount))
}

const inViewport = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

test('professional records premiums, prices the contributor room and previews the T2205 split', async ({ page }) => {
  await seed(page)
  const year = await baseYear(page)
  await makeSpousal(page)
  // An unrecorded history is an explicit state, and no payment may be previewed.
  await expect(page.getByTestId(`spousal-unknown-${ACCOUNT}`)).toBeVisible()
  await expect(page.getByTestId(`spousal-payment-${ACCOUNT}`)).toHaveCount(0)
  await page.getByTestId(`spousal-history-${ACCOUNT}`).selectOption('complete')
  await expect(page.getByTestId(`spousal-unknown-${ACCOUNT}`)).toHaveCount(0)
  // A prior-year premium drives the attribution window; a current-year premium
  // drives the contributor's room ledger.
  await addPremium(page, ROW0, { year: year - 2, contributor: PARTNER, amount: 4_000 })
  await addPremium(page, ROW1, { year, contributor: PARTNER, amount: 6_000 })
  await page.getByTestId('rrsp-available-room-partner').fill('15000')
  await page.getByTestId('rrsp-available-room-partner').blur()
  // Hand calculation: 15,000 of room less the 6,000 current-year premium leaves
  // 9,000, and only the current-year premium is priced in this year's ledger.
  const ledger = page.getByTestId('rrsp-ledger-partner')
  await expect(ledger).toContainText('15,000')
  await expect(ledger).toContainText('6,000')
  await expect(ledger).toContainText('9,000')
  await expect(page.getByTestId('rrsp-retained-partner')).toContainText('0 CAD')
  // Hand calculation: a 12,000 payment is attributed up to the 10,000 of
  // premiums inside {year-2, year-1, year}; the remaining 2,000 is the
  // annuitant's.
  await previewPayment(page, 12_000)
  await expect(page.getByTestId(`spousal-split-${ACCOUNT}`)).toContainText('10,000')
  await expect(page.getByTestId(`spousal-split-${ACCOUNT}`)).toContainText('2,000')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.canonical)
  expect(saved.accounts.find((account: { id: string }) => account.id === ACCOUNT).kind).toBe('spousalRrsp')
  expect(saved.spousalHistory[ACCOUNT]).toEqual({ status: 'complete' })
  expect(saved.contributions.map((contribution: { calendarYear: number; amount: number; contributorId: string }) =>
    [contribution.calendarYear, contribution.amount, contribution.contributorId]))
    .toEqual([[year - 2, 4_000, PARTNER], [year, 6_000, PARTNER]])
  // Reload keeps every recorded fact; the transient preview is re-entered.
  await page.reload()
  await expect(page.getByTestId(`spousal-history-${ACCOUNT}`)).toHaveValue('complete')
  await expect(page.getByTestId(`spousal-year-${ROW0}`)).toHaveValue(String(year - 2))
  await expect(page.getByTestId(`spousal-amount-${ROW1}`)).toHaveValue('6000')
  await expect(page.getByTestId(`spousal-contributor-${ROW0}`)).toHaveValue(PARTNER)
  await expect(page.getByTestId('rrsp-ledger-partner')).toContainText('6,000')
  await previewPayment(page, 12_000)
  await expect(page.getByTestId(`spousal-split-${ACCOUNT}`)).toContainText('10,000')
  // The same recorded facts and split show in guided mode.
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/income/income.taxFacts')
  await expect(page.getByTestId(`spousal-history-${ACCOUNT}`)).toHaveValue('complete')
  await expect(page.getByTestId(`spousal-amount-${ROW0}`)).toHaveValue('4000')
  await expect(page.getByTestId(`spousal-amount-${ROW1}`)).toHaveValue('6000')
  await previewPayment(page, 12_000)
  await expect(page.getByTestId(`spousal-split-${ACCOUNT}`)).toContainText('10,000')
  await expect(page.getByTestId(`spousal-split-${ACCOUNT}`)).toContainText('2,000')
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)).resultRevision).toBeNull()
  expect(await inViewport(page)).toBe(true)
})

test('guided records the premium history and keeps it through reload and a mode switch', async ({ page }) => {
  await seed(page, { guided: true })
  await page.goto('/#/guided/income/income.taxFacts')
  const year = await baseYear(page)
  await makeSpousal(page)
  await page.getByTestId(`spousal-history-${ACCOUNT}`).selectOption('complete')
  await addPremium(page, ROW0, { year, contributor: PARTNER, amount: 5_000 })
  await page.getByTestId('rrsp-available-room-partner').fill('8000')
  await page.getByTestId('rrsp-available-room-partner').blur()
  await expect(page.getByTestId('rrsp-ledger-partner')).toContainText('5,000')
  // Guided does not auto-run: recorded facts change but results stay stale.
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)).resultRevision).toBeNull()
  await page.reload()
  await expect(page.getByTestId(`spousal-history-${ACCOUNT}`)).toHaveValue('complete')
  await expect(page.getByTestId(`spousal-amount-${ROW0}`)).toHaveValue('5000')
  await expect(page.getByTestId('rrsp-ledger-partner')).toContainText('5,000')
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId(`spousal-amount-${ROW0}`)).toHaveValue('5000')
  await previewPayment(page, 7_000)
  await expect(page.getByTestId(`spousal-split-${ACCOUNT}`)).toContainText('5,000')
  await expect(page.getByTestId(`spousal-split-${ACCOUNT}`)).toContainText('2,000')
  expect(await inViewport(page)).toBe(true)
})

test('an unrecorded history stays unsupported while a confirmed empty history is a real zero', async ({ page }) => {
  await seed(page)
  await makeSpousal(page)
  // Unknown history: no split is produced and no other person is assumed.
  await expect(page.getByTestId(`spousal-unknown-${ACCOUNT}`)).toBeVisible()
  await expect(page.getByTestId(`spousal-split-${ACCOUNT}`)).toHaveCount(0)
  await expect(page.getByTestId(`spousal-payment-${ACCOUNT}`)).toHaveCount(0)
  // Confirmed empty history: the payment is entirely the annuitant's, and that
  // zero is a real answer rather than an unconfirmed one.
  await page.getByTestId(`spousal-history-${ACCOUNT}`).selectOption('complete')
  await previewPayment(page, 5_000)
  await expect(page.getByTestId(`spousal-split-${ACCOUNT}`)).toContainText('0 CAD')
  await expect(page.getByTestId(`spousal-split-${ACCOUNT}`)).toContainText('5,000')
  // A premium with no recorded contributor is refused with a reason.
  await addPremium(page, ROW0, { year: await baseYear(page), contributor: '', amount: 3_000 })
  await expect(page.getByTestId(`spousal-unsupported-${ACCOUNT}`)).toBeVisible()
  await expect(page.getByTestId(`spousal-unsupported-${ACCOUNT}`)).toContainText('no recorded contributor')
  expect(await inViewport(page)).toBe(true)
})

test('the spousal attribution block explains itself in EN, FR and ZH', async ({ page }) => {
  await seed(page)
  await makeSpousal(page)
  const editor = page.getByTestId(`spousal-attribution-${ACCOUNT}`)
  await expect(editor).toContainText('Spousal RRSP attribution (T2205)')
  await expect(editor).toContainText('first-in-first-out')
  await page.getByRole('button', { name: 'FR', exact: true }).click()
  await expect(editor).toContainText('Attribution REER de conjoint (T2205)')
  await expect(editor).toContainText('premier entré, premier sorti')
  await page.getByRole('button', { name: '中文' }).click()
  await expect(editor).toContainText('配偶 RRSP 归属（T2205）')
  await expect(editor).toContainText('先进先出')
  expect(await inViewport(page)).toBe(true)
})
