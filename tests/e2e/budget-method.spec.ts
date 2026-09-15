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
  // leaves the figure untouched. Review fix B1: the click must record what its
  // own sentence says, so assert the copy and the recorded flags together.
  await expect(page.getByTestId('budget-method')).toContainText('already net of the listed loan payments')
  await expect(page.getByTestId('budget-method')).toContainText('without the tax difference')
  await page.getByTestId('budget-basis-legacy').check()
  await expect(page.getByTestId('budget-debt-yes')).toBeChecked()
  await expect(page.getByTestId('budget-tax-no')).toBeChecked()
  await expect(page.getByTestId('budget-state')).toContainText('cannot yet add it as refund cash')
  expect(await canonicalBudget(page)).toMatchObject({ annualNetSavings: 24_000, debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: false } })
  await page.reload()
  await expect(page.getByTestId('budget-debt-yes')).toBeChecked()
  await expect(page.getByTestId('budget-tax-no')).toBeChecked()
  await expect(savingsField).toHaveValue('24,000')
  expect(await insideViewport(page)).toBe(true)
})

test('an answered-excluded budget basis labels the headline result as an estimate', async ({ page }) => {
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  // Review fix B2. Unknown facts are an unanswered question, not a
  // contradiction: the default plan keeps its precise summary.
  await expect(page.getByTestId('legacy-estimate')).toHaveCount(0)
  await page.getByTestId('budget-debt-no').check()
  await page.getByTestId('budget-tax-no').check()
  await expect(page.getByTestId('budget-state')).toContainText('cannot yet add them back to a cash budget')
  // Once a fact is recorded as excluded, the caveat sits where the number does.
  const estimate = page.getByTestId('legacy-estimate')
  await expect(estimate).toHaveCount(1)
  await expect(estimate).toContainText('estimate rather than a precise number')
  await expect(estimate).toContainText('Final net worth:')
  // Only the shape the projection actually prices loses the label: answering the
  // same two facts "Yes" is the basis the projection already assumes.
  await page.getByTestId('budget-debt-yes').check()
  await page.getByTestId('budget-tax-yes').check()
  await expect(page.getByTestId('legacy-estimate')).toHaveCount(0)
  expect(await canonicalBudget(page)).toMatchObject({ debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } })
  await expect(page.locator('.results-column')).not.toContainText('estimate rather than a precise number')
  expect(await insideViewport(page)).toBe(true)
})
