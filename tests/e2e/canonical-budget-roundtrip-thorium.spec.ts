import { prepareProfessionalTarget, revealProfessionalEditor, showProfessionalResults } from './fixtures/professional'
import { chooseMode, chooseLanguage } from './fixtures/app-bar'
import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { phaseTransitionPlan, phaseTransitionSpending } from '../../src/engine/__tests__/fixtures/phaseTransition'
import { canonicalAppPlan } from './fixtures/canonical-app-plan'

const executablePath = process.env.THORIUM_EXECUTABLE_PATH ?? '/Applications/Thorium.app/Contents/MacOS/Thorium'
test.use({ browserName: 'chromium', launchOptions: { executablePath } })
test.skip(!existsSync(executablePath), 'This suite requires the Thorium executable')

const state = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
const results = (page: Page) => page.locator('#results-overview').getByTestId('canonical-results')
const budget = (page: Page) => page.getByTestId('budget-method')
const priorWorking = (page: Page) => budget(page).getByTestId('budget-working-spending').locator('input')
const annual = (page: Page) => page.locator('#results-overview').getByRole('button', { name: 'Annual financial details', exact: true })
const scenario = (page: Page) => page.locator('details:not(.professional-group)').filter({ has: page.getByRole('heading', { name: 'Scenario comparison', includeHidden: true }) })

async function openEvidence(page: Page) {
  await revealProfessionalEditor(page, page.locator('[data-group="advanced"]'))
  const section = page.getByTestId('canonical-evidence')
  if (!await section.evaluate(element => (element as HTMLDetailsElement).open)) await (await prepareProfessionalTarget(section.locator('summary'))).press('Enter')
}

async function record(page: Page, working: string, retirement: string) {
  await openEvidence(page)
  await (await prepareProfessionalTarget(page.getByTestId('canonical-working-spending'))).fill(working)
  await (await prepareProfessionalTarget(page.getByTestId('canonical-retirement-spending'))).fill(retirement)
  await (await prepareProfessionalTarget(page.getByTestId('canonical-enable'))).click()
  await showProfessionalResults(page)
  await expect(results(page)).toBeVisible()
}

async function disable(page: Page) {
  await openEvidence(page)
  await (await prepareProfessionalTarget(page.getByTestId('canonical-disable'))).click()
  await expect(results(page)).toHaveCount(0)
}

async function professional(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-25T12:00:00Z'))
  await page.goto('/')
  await chooseMode(page, 'professional')
}

async function expectExcludedEstimate(page: Page) {
  await expect(budget(page).getByTestId('budget-mode-savings')).toBeChecked()
  await expect(budget(page).getByTestId('budget-debt-yes')).toBeChecked()
  await expect(budget(page).getByTestId('budget-tax-no')).toBeChecked()
  await expect(budget(page).getByTestId('budget-state')).toContainText('cannot add that refund as cash yet')
  const estimate = page.getByTestId('legacy-estimate')
  await expect(estimate).toContainText('estimate rather than a precise number')
  await expect(estimate).toContainText('Final net worth:')
  await expect(page.getByTestId('estimate-charts-note')).toBeVisible()
  await expect(page.locator('.results-column').getByRole('heading', { name: /Monte Carlo|Withdrawal-order comparison|CPP\/OAS timing suggestion/, includeHidden: true })).toHaveCount(0)
}

for (const start of ['fresh', 'migrated v10']) {
  test(`${start} savings assertions and estimate disclosures survive opt-in, scenario and reload`, async ({ page }) => {
    await professional(page)
    if (start === 'migrated v10') {
      await page.evaluate(() => {
        const inputs = JSON.parse(localStorage.getItem('fire-inputs')!).state.inputs
        const debts = [{ kind: 'carLoan', balance: 12_000, annualPayment: 6_000, yearsRemaining: 2 }]
        localStorage.setItem('fire-inputs', JSON.stringify({ version: 10, state: { inputs: { ...inputs, debts }, entryMode: 'professional' } }))
      })
      await page.reload()
      await expect(budget(page)).toContainText('CA$6,000 of listed loan payments')
      await (await prepareProfessionalTarget(page.getByTestId('budget-basis-legacy'))).check()
    } else {
      await (await prepareProfessionalTarget(page.getByTestId('budget-debt-yes'))).check()
      await (await prepareProfessionalTarget(page.getByTestId('budget-tax-no'))).check()
    }
    await showProfessionalResults(page)
    await expectExcludedEstimate(page)
    const before = (await state(page)).canonical
    const notice = await (await prepareProfessionalTarget(page.getByTestId('legacy-estimate'))).innerText()
    await record(page, '43125', String(before.budget.retirementSpending))
    await expect(budget(page).getByTestId('budget-mode-income')).toBeChecked()
    await expect(page.getByTestId('legacy-estimate')).toHaveCount(0)
    await record(page, '43250', String(before.budget.retirementSpending))

    await (await prepareProfessionalTarget(scenario(page).locator('summary'))).press('Enter')
    await (await prepareProfessionalTarget(scenario(page).getByRole('button', { name: 'Save current as A' }), scenario(page).getByRole('button', { name: 'Save current as A', includeHidden: true }))).click()
    await disable(page)
    await showProfessionalResults(page)
    await expectExcludedEstimate(page)
    expect(await page.getByTestId('legacy-estimate').innerText()).toBe(notice)
    expect((await state(page)).canonical.budget).toEqual(before.budget)

    if (!await scenario(page).evaluate(element => (element as HTMLDetailsElement).open)) await (await prepareProfessionalTarget(scenario(page).locator('summary'))).press('Enter')
    await (await prepareProfessionalTarget(scenario(page).getByRole('button', { name: 'Restore A as current inputs' }), scenario(page).getByRole('button', { name: 'Restore A as current inputs', includeHidden: true }))).click()
    await showProfessionalResults(page)
    await expect(results(page)).toBeVisible()
    await page.reload()
    await showProfessionalResults(page)
    await expect(results(page)).toBeVisible()
    await disable(page)
    await showProfessionalResults(page)
    await expectExcludedEstimate(page)
    const restored = (await state(page)).canonical
    expect(restored.budget).toEqual(before.budget)
    expect(restored.migration.budgetReconciliation).toMatchObject({
      ...before.migration.budgetReconciliation,
      savingsBasis: { debtIncluded: before.budget.debtIncluded, taxBenefitIncluded: before.budget.taxBenefitIncluded },
    })
    await (await prepareProfessionalTarget(annual(page))).click()
    await expect(page.getByRole('dialog', { name: 'Household annual estimate' })).toHaveAccessibleDescription(/saving basis you recorded leaves out a component/i)
  })
}

test('unknown savings answers stay unanswered after a round trip', async ({ page }) => {
  await professional(page)
  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: /^Annual after-tax savings/ }).locator('input'))).fill('41000')
  const before = (await state(page)).canonical.budget
  const notice = await (await prepareProfessionalTarget(budget(page).getByTestId('budget-state'))).innerText()
  expect(before.debtIncluded).toMatchObject({ status: 'unknown' })
  expect(before.taxBenefitIncluded).toMatchObject({ status: 'unknown' })
  await record(page, '41000', '50000')
  await page.reload()
  await disable(page)
  await expect(budget(page).getByTestId('budget-mode-savings')).toBeChecked()
  await expect(budget(page).getByTestId('budget-state')).toHaveText(notice)
  expect((await state(page)).canonical.budget).toEqual(before)
})

test('income origin and later explicit mode, amount and basis edits survive opt-out', async ({ page }) => {
  await professional(page)
  await (await prepareProfessionalTarget(budget(page).getByTestId('budget-mode-income'))).check()
  await (await prepareProfessionalTarget(priorWorking(page))).fill('61000')
  await record(page, '42000', '50000')
  await (await prepareProfessionalTarget(priorWorking(page))).fill('51000')
  await expect(results(page)).toContainText(/plan changed|record.*budget/i)
  await expect(page.getByTestId('canonical-coverage-table')).toHaveCount(0)
  await disable(page)
  await expect(budget(page).getByTestId('budget-mode-income')).toBeChecked()
  expect((await state(page)).canonical.budget).toMatchObject({ kind: 'incomeBudget', workingSpending: 51_000 })
  await expect(priorWorking(page)).toHaveValue('51,000')

  await record(page, '62000', '46000')
  await (await prepareProfessionalTarget(budget(page).getByTestId('budget-mode-savings'))).check()
  await (await prepareProfessionalTarget(budget(page).getByTestId('budget-debt-no'))).check()
  await (await prepareProfessionalTarget(budget(page).getByTestId('budget-tax-yes'))).check()
  await record(page, '63000', '47000')
  await page.reload()
  await disable(page)
  await expect(budget(page).getByTestId('budget-mode-savings')).toBeChecked()
  await expect(budget(page).getByTestId('budget-debt-no')).toBeChecked()
  await expect(budget(page).getByTestId('budget-tax-yes')).toBeChecked()
  await showProfessionalResults(page)
  await expect(page.getByTestId('legacy-estimate')).toBeVisible()
  expect((await state(page)).canonical.budget).toMatchObject({ kind: 'savingsBudget', retirementSpending: 47_000 })
})

for (const activation of ['click', 'keyboard']) {
  test(`a deliberate return to income via ${activation} is independent of the active income budget`, async ({ page }) => {
    await professional(page)
    await (await prepareProfessionalTarget(page.getByTestId('budget-debt-yes'))).check()
    await (await prepareProfessionalTarget(page.getByTestId('budget-tax-no'))).check()
    await record(page, '41500', '50000')
    const activeIncome = budget(page).getByTestId('budget-mode-income')
    await expect(activeIncome).toBeChecked()
    await disable(page)
    await showProfessionalResults(page)
    await expectExcludedEstimate(page)

    await record(page, '41500', '50000')
    await expect(activeIncome).toBeChecked()
    const before = await state(page)
    const returnBudget = page.getByTestId('canonical-return-budget')
    const explicitIncome = returnBudget.getByTestId('canonical-return-income')
    // F3 exposed only the already-checked current Income radio. Use that
    // observable path in the red run and the explicit return choice once present.
    const hasReturnChoice = await returnBudget.count() > 0
    if (hasReturnChoice) {
      await openEvidence(page)
      await expect(returnBudget).toHaveAccessibleName('Budget mode when returning to the planning estimate')
      await expect(returnBudget.getByTestId('canonical-return-savings')).toHaveAttribute('aria-pressed', 'true')
      await expect(explicitIncome).toHaveAccessibleName(/Income and spending/)
      await expect(explicitIncome).toHaveAttribute('aria-pressed', 'false')
    }
    const control = hasReturnChoice ? explicitIncome : activeIncome
    const activate = async () => {
      if (activation === 'click') await (await prepareProfessionalTarget(control)).click()
      else {
        await (await prepareProfessionalTarget(control)).focus()
        await expect(control).toBeFocused()
        await page.keyboard.press('Space')
      }
    }
    await activate()
    await expect.poll(async () => (await state(page)).inputRevision).toBe(before.inputRevision + 1)
    const changed = await state(page)
    expect(changed.canonical.budget).toEqual(before.canonical.budget)
    expect(changed.canonical.deterministicProjection.spending).toEqual(before.canonical.deterministicProjection.spending)
    expect(changed.questionAnswers['budget.method']).toBe(before.questionAnswers['budget.method'])
    await expect(activeIncome).toBeChecked()
    await openEvidence(page)
    await expect(control).toHaveAttribute('aria-pressed', 'true')
    await activate()
    expect((await state(page)).inputRevision).toBe(changed.inputRevision)
    await page.reload()
    await disable(page)
    await expect(activeIncome).toBeChecked()
    await expect(priorWorking(page)).toHaveValue('41,500')
    await expect(budget(page).getByTestId('budget-state')).toContainText('cannot price an income budget yet')
  })
}

test('a saved canonical plan with no return preference shows localized choices without guessing a basis', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(envelope => {
    localStorage.setItem('fire-inputs', JSON.stringify(envelope))
  }, canonicalAppPlan())
  await page.reload()
  const returnBudget = page.getByTestId('canonical-return-budget')
  for (const locale of [
    { button: 'EN', lang: 'en', ledger: 'Canonical annual ledger', legend: 'Budget mode when returning to the planning estimate' },
    { button: 'FR', lang: 'fr', ledger: 'Registre annuel canonique', legend: 'Mode budgétaire au retour à l’estimation' },
    { button: '中文', lang: 'zh-Hans', ledger: '标准年度账本', legend: '返回规划估算时的预算模式' },
  ]) {
    await chooseLanguage(page, locale.button)
    await expect(page.locator('html')).toHaveAttribute('lang', locale.lang)
    await expect(page.getByTestId('canonical-evidence').locator('summary')).toHaveText(locale.ledger)
    await openEvidence(page)
    await expect(returnBudget).toHaveAccessibleName(locale.legend)
    await expect(returnBudget.getByTestId('canonical-return-savings')).toHaveAttribute('aria-pressed', 'false')
    await expect(returnBudget.getByTestId('canonical-return-income')).toHaveAttribute('aria-pressed', 'false')
  }
})

test('a selected plan with invalid life expectancy shows the error without a completed ledger', async ({ page }) => {
  await page.goto('/')
  const plan = phaseTransitionPlan()
  plan.lifeExpectancy = 110
  plan.legacyProjection.lifeExpectancy = 110
  plan.deterministicProjection = { mode: 'canonical', spending: phaseTransitionSpending(), provenance: { origin: 'user', sourceYear: 2026 } }
  await page.evaluate(canonical => {
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      canonical, inputs: canonical.legacyProjection, entryMode: 'professional',
    } }))
  }, plan)
  await page.reload()
  await showProfessionalResults(page)
  await expect(results(page)).toBeVisible()
  await expect(page.getByTestId('canonical-status')).not.toContainText(/completed|coverage computed|ledger computed/i)
  await expect(page.getByTestId('canonical-validation-errors')).toContainText(/between.+105/i)
  await expect(page.getByTestId('canonical-coverage-table')).toHaveCount(0)
  await expect(page.getByTestId('canonical-estate')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Annual financial details', exact: true, includeHidden: true })).toHaveCount(0)
})
