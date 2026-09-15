import { expect, test, type Page } from '@playwright/test'

/**
 * BE-13 A end to end. Both entry modes must let a user answer what their saving
 * figure means, the recorded basis must survive a reload and an entry-mode
 * switch, and a migrated v10 figure must be presented for review rather than
 * silently reinterpreted.
 */

const LEGACY_INPUTS = {
  currentAge: 40, fireAge: 55, lifeExpectancy: 90, province: 'ON',
  annualSavings: 24_000, savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 }, retirementSpending: 50_000,
  returns: { tfsa: 0.043, rrsp: 0.043, nonReg: 0.043 }, fees: 0.002, nonRegDistributionYield: 0.02,
  accumulationMarginalRate: 0.35, balances: { tfsa: 100_000, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
  cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0, strategy: 'tfsaFirst',
  goal: 'legacy', inflation: 0.021, fireTargetAssets: null, partner: null, principalResidence: null,
  investmentProperties: [], fhsa: null,
  debts: [{ kind: 'carLoan', balance: 12_000, annualPayment: 6_000, yearsRemaining: 2 }],
}

/** The canonical budget the app persisted, read back out of the same envelope. */
const canonicalBudget = (page: Page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem('fire-inputs') ?? '{}')?.state?.canonical?.budget)

const insideViewport = (page: Page) => page.evaluate(() => {
  const root = document.documentElement
  return root.scrollWidth <= root.clientWidth
})

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('both entry modes record the saving basis, which survives a reload and a mode switch', async ({ page }) => {
  // Guided: the same shared panel is the budget question.
  await page.goto('/#/guided/saving/budget.method')
  await expect(page.getByTestId('budget-state')).toContainText('Still to answer')
  await expect(page.getByTestId('budget-state')).toContainText('whether the listed loan payments are already subtracted')
  // A plan first entered here has no earlier figure to reconcile, so it is
  // never told that its own amount came from "an earlier plan".
  await expect(page.getByTestId('budget-method')).not.toContainText('earlier plan')
  await page.getByTestId('budget-debt-yes').check()
  await page.getByTestId('budget-tax-yes').check()
  await expect(page.getByTestId('budget-state')).toContainText('Ready')
  expect(await canonicalBudget(page)).toMatchObject({ kind: 'savingsBudget', debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } })
  expect(await insideViewport(page)).toBe(true)

  // The answers survive a reload and switching to professional, which must not
  // flip the mode or rewrite a recorded fact.
  await page.reload()
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId('budget-debt-yes')).toBeChecked()
  await expect(page.getByTestId('budget-state')).toContainText('Ready')
  expect(await canonicalBudget(page)).toMatchObject({ kind: 'savingsBudget', debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } })
  expect(await insideViewport(page)).toBe(true)

  // A recorded "no" is a fact, not a gap, and it stays recorded across a reload.
  await page.getByTestId('budget-tax-no').check()
  await expect(page.getByTestId('budget-state')).toContainText('cannot yet add it as refund cash')
  await page.reload()
  await expect(page.getByTestId('budget-tax-no')).toBeChecked()
  expect(await canonicalBudget(page)).toMatchObject({ taxBenefitIncluded: { status: 'known', value: false } })

  // The income budget is a different decision with its own reason, and its
  // working spending round-trips through the reload.
  await page.getByTestId('budget-mode-income').check()
  await expect(page.getByTestId('budget-state')).toContainText('out of scope for BE-13 A')
  await page.getByTestId('budget-working-spending').locator('input').fill('61000')
  expect(await canonicalBudget(page)).toMatchObject({ kind: 'incomeBudget', workingSpending: 61_000 })
  await page.reload()
  await expect(page.getByTestId('budget-mode-income')).toBeChecked()
  await expect(page.getByTestId('budget-working-spending').locator('input')).toHaveValue('61,000')
  expect(await insideViewport(page)).toBe(true)
})

test('a migrated v10 plan presents its legacy figure for review instead of reinterpreting it', async ({ page }) => {
  await page.evaluate((inputs) => localStorage.setItem('fire-inputs', JSON.stringify({
    state: { inputs, canonical: null, scenarioA: null, answerMeta: {}, questionAnswers: {}, entryMode: 'professional', inputRevision: 0 },
    version: 10,
  })), LEGACY_INPUTS)
  await page.reload()
  const savingsField = page.locator('label.field').filter({ hasText: 'Annual after-tax savings' }).locator('input')
  // The old figure is shown unchanged, next to the debt it was already net of.
  await expect(page.getByTestId('budget-method')).toContainText('CA$6,000 of listed loan payments')
  await expect(savingsField).toHaveValue('24,000')
  expect(await canonicalBudget(page)).toMatchObject({ annualNetSavings: 24_000, debtIncluded: { status: 'unknown' }, taxBenefitIncluded: { status: 'unknown' } })

  // Keeping the legacy approximation records the old meaning explicitly and
  // leaves the figure untouched.
  await page.getByTestId('budget-basis-legacy').check()
  await expect(page.getByTestId('budget-debt-no')).toBeChecked()
  await expect(page.getByTestId('budget-state')).toContainText('Recorded as not included')
  expect(await canonicalBudget(page)).toMatchObject({ annualNetSavings: 24_000, debtIncluded: { status: 'known', value: false }, taxBenefitIncluded: { status: 'known', value: false } })
  await page.reload()
  await expect(page.getByTestId('budget-debt-no')).toBeChecked()
  await expect(savingsField).toHaveValue('24,000')
  expect(await insideViewport(page)).toBe(true)
})
