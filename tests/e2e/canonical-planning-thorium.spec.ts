import { prepareProfessionalTarget, showProfessionalResults } from './fixtures/professional'
import { chooseMode, chooseLanguage } from './fixtures/app-bar'
import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { canonicalSheetId } from '../../src/canonicalAnnualSheet'
import { heldHomeEstateIds as ids } from '../../src/engine/__tests__/fixtures/annualIntegratedHeldHomeEstate'
import { known, recorded, retirementPlan } from '../../src/engine/__tests__/fixtures/retirementSettlement'
import { canonicalAppPlan } from './fixtures/canonical-app-plan'

const executablePath = process.env.THORIUM_EXECUTABLE_PATH ?? '/Applications/Thorium.app/Contents/MacOS/Thorium'
test.use({ browserName: 'chromium', launchOptions: { executablePath } })
test.skip(!existsSync(executablePath), 'This suite requires the Thorium executable')

type Envelope = ReturnType<typeof canonicalAppPlan>
const planning = (page: Page) => page.getByTestId('canonical-planning')
const age = (page: Page) => planning(page).getByTestId('planning-retirement-age')
const spending = (page: Page) => planning(page).getByTestId('planning-retirement-spending')
const replay = (page: Page) => planning(page).getByTestId('planning-evaluate')
const outcomes = (page: Page) => planning(page).getByTestId('planning-outcome')
const source = (page: Page) => page.locator('#results > [data-testid="canonical-results"]')
const sourceSheet = (page: Page) => page.getByRole('button', { name: 'Annual financial details', exact: true })
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Canonical annual ledger' })
const cad = (amount: number, decimals = 2) => new Intl.NumberFormat('en', {
  style: 'currency', currency: 'CAD', minimumFractionDigits: decimals, maximumFractionDigits: decimals,
}).format(amount)

async function seed(page: Page, envelope = canonicalAppPlan()) {
  await page.goto('/')
  await page.evaluate(value => localStorage.setItem('fire-inputs', JSON.stringify(value)), envelope)
  await page.reload()
  await showProfessionalResults(page)
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const { inputs, canonical, inputRevision, resultRevision, scenarioA, scenarioACanonical } = JSON.parse(localStorage.getItem('fire-inputs')!).state
    return { inputs, canonical, inputRevision, resultRevision, scenarioA, scenarioACanonical }
  })
}

function cell(page: Page, year: number, ...parts: string[]) {
  return dialog(page).locator(`th[id$="-row-${canonicalSheetId(...parts)}"]`).locator('..').locator(`td[headers$="-year-${year}"]`)
}

async function assertStatus(page: Page, status: string) {
  await expect(outcomes(page).last()).toHaveAttribute('data-status', status)
  return outcomes(page).last()
}

function soloAppPlan(amount: number, statement = false): Envelope {
  const envelope = canonicalAppPlan()
  const plan = retirementPlan({ age: 58, tfsa: 190_000, rrsp: 0, spending: amount, strategy: 'tfsaFirst' })
  plan.lifeExpectancy = 85
  plan.people[0].retirementAge = 59
  plan.people[0].earnedIncome = known(12_000)
  if (statement) plan.people[0].cppAmountSource = { source: 'statement', sourceYear: 2026, basis: 'annual',
    ageBasis: 65, dollarBasis: 'today', premises: { retirementAge: 59 } }
  plan.budget = { kind: 'incomeBudget', workingSpending: 11_298.65, retirementSpending: amount }
  Object.assign(plan.legacyProjection, { fireAge: 59, lifeExpectancy: 85 })
  plan.deterministicProjection = { mode: 'canonical', provenance: recorded,
    spending: { workingSpending: known(11_298.65), retirementSpending: known(amount) } }
  return { ...envelope, state: { ...envelope.state, inputs: plan.legacyProjection, canonical: plan } }
}

test('baseline summary and owner ledgers match unchanged replay in real and nominal CAD', async ({ page }) => {
  await seed(page, canonicalAppPlan('inflation'))
  const overview = (target: ReturnType<typeof source>) => target.getByTestId('canonical-coverage-table')
  await expect(overview(source(page)).locator('tbody tr')).toHaveCount(3)
  // The display action persists hydrated defaults before the mutation check.
  await (await prepareProfessionalTarget(source(page).getByRole('button', { name: /^Real/ }), source(page).getByRole('button', { name: /^Real/, includeHidden: true }))).click()
  const before = await snapshot(page)
  await (await prepareProfessionalTarget(replay(page))).click()
  const candidate = outcomes(page).last()
  const candidateResults = candidate.getByTestId('canonical-results')
  const candidateSheet = candidate.getByTestId('planning-sheet')
  for (const currency of ['Real', 'Nominal']) {
    await (await prepareProfessionalTarget(candidateResults.getByRole('button', { name: new RegExp(`^${currency}`) }), candidateResults.getByRole('button', { name: new RegExp(`^${currency}`), includeHidden: true }))).click()
    await expect(source(page).getByRole('button', { name: new RegExp(`^${currency}`) })).toHaveAttribute('aria-pressed', 'true')
    await expect(candidateResults).toHaveText(await source(page).innerText(), { useInnerText: true })
    const cpi = 1.02 ** 3
    const estate = (480_000 * 1.1 ** 3 * cpi / 4 - 1_800) / (currency === 'Real' ? cpi : 1)
    await expect(source(page).getByTestId('canonical-estate')).toContainText(cad(estate))
    await expect(candidateResults.getByTestId('canonical-estate')).toHaveText(await source(page).getByTestId('canonical-estate').innerText())

    await (await prepareProfessionalTarget(sourceSheet(page))).click()
    const values = [
      cell(page, 2028, 'value', 'estate'), cell(page, 2028, 'value', 'netWorth'),
      cell(page, 2027, 'value', 'account', ids.partnerTfsa, 'withdrawal'),
      cell(page, 2028, 'value', 'event', ids.expense, 'expenseUnmet'),
    ]
    await expect(values[0]).toContainText(cad(estate, 0))
    const sourceValues = await Promise.all(values.map(value => value.innerText()))
    await page.keyboard.press('Escape')
    await (await prepareProfessionalTarget(candidateSheet)).focus()
    await page.keyboard.press('Enter')
    await expect(dialog(page)).toHaveAccessibleDescription(currency === 'Real' ? /Base-year CAD \(2026\)/ : /Nominal CAD/)
    expect(await Promise.all(values.map(value => value.innerText()))).toEqual(sourceValues)
    await page.keyboard.press('Escape')
    await expect(candidateSheet).toBeFocused()
  }
  expect(await snapshot(page)).toEqual(before)
})

test('Pro shows explicit event, living and zero gaps, invalid input, and the comparison limit without plan edits', async ({ page }) => {
  await seed(page)
  const scenario = page.locator('details:not(.professional-group)').filter({ has: page.getByText('Scenario comparison', { exact: true }) })
  await (await prepareProfessionalTarget(scenario.locator('summary'))).press('Enter')
  await (await prepareProfessionalTarget(scenario.getByRole('button', { name: 'Save current as A' }), scenario.getByRole('button', { name: 'Save current as A', includeHidden: true }))).click()
  const before = await snapshot(page)
  const coverage = source(page).getByTestId('canonical-coverage-table')
  const baselineText = await (await prepareProfessionalTarget(coverage)).innerText()

  await (await prepareProfessionalTarget(replay(page))).click()
  const original = await assertStatus(page, 'complete-with-gaps')
  await expect(original).toContainText('Recorded event gaps in: 2028')
  await expect(original).not.toContainText('Recorded living gaps')
  await expect(original.getByRole('row').filter({ has: page.getByRole('rowheader', { name: '2028', exact: true }) }).getByRole('cell').nth(7)).toHaveText(cad(31))

  await (await prepareProfessionalTarget(spending(page))).fill('0')
  await (await prepareProfessionalTarget(replay(page))).click()
  await assertStatus(page, 'complete-zero-gaps')
  await (await prepareProfessionalTarget(spending(page))).fill('500')
  await (await prepareProfessionalTarget(replay(page))).click()
  const gaps = await assertStatus(page, 'complete-with-gaps')
  await expect(gaps).toContainText('Recorded living gaps in: 2028')
  await expect(gaps).toContainText('Recorded event gaps in: 2028')

  await (await prepareProfessionalTarget(age(page))).fill('58.5')
  await (await prepareProfessionalTarget(replay(page))).click()
  const invalid = await assertStatus(page, 'invalid')
  await expect(invalid.getByRole('alert')).toContainText('Enter a whole retirement age')
  await expect(invalid.getByTestId('planning-sheet')).toHaveCount(0)
  for (let i = 0; i < 5; i++) await (await prepareProfessionalTarget(replay(page))).click()
  await expect(outcomes(page)).toHaveCount(8)
  await expect(planning(page).getByTestId('planning-limit')).toContainText('further candidates not computed')
  await (await prepareProfessionalTarget(planning(page).getByTestId('planning-reset'))).click()
  await expect(outcomes(page)).toHaveCount(0)
  await expect(planning(page).getByTestId('planning-limit')).toHaveCount(0)
  await expect(coverage).toHaveText(baselineText, { useInnerText: true })
  expect(await snapshot(page)).toEqual(before)
})

test('partial candidate retains blocked and uncomputed years in the replay and actual annual detail', async ({ page }) => {
  await seed(page, canonicalAppPlan('partial'))
  await (await prepareProfessionalTarget(replay(page))).click()
  const candidate = await assertStatus(page, 'partial')
  await expect(candidate.getByTestId('canonical-blocked-year')).toContainText('2028')
  await expect(candidate.getByTestId('canonical-uncomputed')).toContainText(/2029.*2030/)
  await expect(candidate.getByTestId('canonical-coverage-table').locator('tbody tr')).toHaveCount(2)
  await expect(candidate).not.toContainText('Completed horizon')
  await (await prepareProfessionalTarget(candidate.getByTestId('planning-sheet'))).click()
  await expect(cell(page, 2027, 'value', 'netWorth')).toContainText(cad(581_290, 0))
  await expect(cell(page, 2030, 'value', 'netWorth')).toContainText('Not computed')
})

test('Guide uses generated current results and clears candidate state on mode and revision changes', async ({ page }) => {
  await seed(page)
  await (await prepareProfessionalTarget(replay(page))).click()
  await chooseMode(page, 'guided')
  await page.goto('/#/guided/results')
  await expect(planning(page)).toHaveCount(0)
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Generate my results' }), page.getByRole('button', { name: 'Generate my results', includeHidden: true }))).click()
  await expect(outcomes(page)).toHaveCount(0)
  const before = await snapshot(page)
  await (await prepareProfessionalTarget(age(page))).fill('59')
  await (await prepareProfessionalTarget(age(page))).press('Enter')
  const candidate = await assertStatus(page, 'partial')
  await expect(candidate).toContainText('calendar year 2028')
  await expect(candidate.getByTestId('canonical-blocked-year')).toContainText('2027')
  await expect(candidate.getByTestId('canonical-uncomputed')).toContainText('2028')
  expect(await snapshot(page)).toEqual(before)

  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Modify answers' }), page.getByRole('button', { name: 'Modify answers', includeHidden: true }))).click()
  await page.goto('/#/guided/family/family.ages')
  await (await prepareProfessionalTarget(page.getByLabel('Current age', { exact: true }))).fill('56')
  await (await prepareProfessionalTarget(page.getByLabel('Current age', { exact: true }))).blur()
  await page.goto('/#/guided/results')
  await expect(planning(page)).toHaveCount(0)
  expect((await snapshot(page)).resultRevision).toBeNull()
  await chooseMode(page, 'professional')
  await expect(planning(page)).toBeVisible()
  await expect(outcomes(page)).toHaveCount(0)
})

test('snapshot identity replacement at the same revision resets drafts and blocks stale submission', async ({ page }) => {
  await seed(page)
  await (await prepareProfessionalTarget(replay(page))).click()
  await assertStatus(page, 'complete-with-gaps')
  await (await prepareProfessionalTarget(age(page))).fill('59')
  await (await prepareProfessionalTarget(spending(page))).fill('999')
  const before = await snapshot(page)
  // Exercise a replacement the ordinary form cannot produce without bumping
  // the revision. The actual App and its event handlers remain mounted.
  await page.evaluate(async () => {
    const storePath = '/src/store.ts'
    const { useStore } = await import(storePath)
    const staleSubmit = document.querySelector<HTMLButtonElement>('[data-testid="planning-evaluate"]')!
    const plan = structuredClone(useStore.getState().canonical)
    const inputs = structuredClone(useStore.getState().inputs)
    plan.budget.retirementSpending = inputs.retirementSpending = plan.legacyProjection.retirementSpending = 250
    plan.deterministicProjection.spending.retirementSpending = { status: 'known', value: 250 }
    useStore.setState({ canonical: plan, inputs })
    staleSubmit.click()
  })
  await expect(outcomes(page)).toHaveCount(0)
  await expect(age(page)).toHaveValue('58')
  await expect(spending(page)).toHaveValue('250')
  expect((await snapshot(page)).inputRevision).toBe(before.inputRevision)
  await (await prepareProfessionalTarget(replay(page))).click()
  await expect(outcomes(page).last()).toContainText('250 CAD per year')
  await expect(outcomes(page).last().getByTestId('canonical-coverage-table')).toHaveText(
    await source(page).getByTestId('canonical-coverage-table').innerText(), { useInnerText: true },
  )
})

test('invalid legacy age stays invalid on an unchanged or spending-only replay in the App', async ({ page }) => {
  const envelope = canonicalAppPlan()
  envelope.state.inputs = { ...envelope.state.inputs, fireAge: 56 }
  await seed(page, envelope)
  const baselineError = source(page).getByTestId('canonical-validation-errors')
  await expect(baselineError).toBeVisible()
  await expect(age(page)).toHaveValue('58')
  for (const amount of ['300', '0']) {
    await (await prepareProfessionalTarget(spending(page))).fill(amount)
    await (await prepareProfessionalTarget(replay(page))).click()
    const candidate = await assertStatus(page, 'invalid')
    await expect(candidate.getByTestId('canonical-validation-errors')).toHaveText(await baselineError.innerText(), { useInnerText: true })
    await expect(candidate.getByTestId('planning-sheet')).toHaveCount(0)
  }
})

test('changing age cannot reuse a recorded zero CPP statement premised on the baseline retirement age', async ({ page }) => {
  await seed(page, soloAppPlan(1_000, true))
  await expect(source(page).getByTestId('canonical-coverage-table').locator('tbody tr')).toHaveCount(28)
  const before = await snapshot(page)
  await (await prepareProfessionalTarget(replay(page))).click()
  await assertStatus(page, 'complete-zero-gaps')
  await (await prepareProfessionalTarget(age(page))).fill('60')
  await (await prepareProfessionalTarget(replay(page))).click()
  const refused = await assertStatus(page, 'unsupported')
  await expect(refused.getByRole('alert')).toContainText('recorded CPP/OAS statement premise')
  await expect(refused.getByTestId('planning-sheet')).toHaveCount(0)
  expect(await snapshot(page)).toEqual(before)
})

test('FR and ZH round-trip a tiny prefill using the keyboard at 320px', async ({ page }) => {
  const tiny = '0.000000000000000000001'
  await page.setViewportSize({ width: 320, height: 740 })
  await seed(page, soloAppPlan(Number(tiny)))
  for (const locale of [
    { button: 'FR', replay: 'Rejouer le scénario', amount: tiny.replace('.', ','), facts: /Budget courant du ménage/, scope: /120 ans maximum/ },
    { button: '中文', replay: '重放候选方案', amount: tiny, facts: /家庭退休生活预算/, scope: /最多 120 年/ },
  ]) {
    await chooseLanguage(page, locale.button)
    await expect(replay(page)).toHaveAccessibleName(locale.replay)
    await expect(planning(page)).toContainText(locale.scope)
    await expect(outcomes(page)).toHaveCount(0)
    await expect(spending(page)).toHaveValue(locale.amount)
    await (await prepareProfessionalTarget(spending(page))).focus()
    await page.keyboard.press('Tab')
    await expect(replay(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(outcomes(page).last()).toContainText(locale.facts)
    await expect(outcomes(page).last()).toContainText(locale.amount)
    await expect(outcomes(page).last()).toHaveAttribute('data-status', 'complete-zero-gaps')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  }
})

test('without a canonical election the real App keeps the legacy summary and annual sheet', async ({ page }) => {
  await seed(page, canonicalAppPlan('no-opt-in'))
  await expect(planning(page)).toHaveCount(0)
  await expect(page.locator('#results .summary').first()).toContainText('Final net worth: CA$638,880')
  await (await prepareProfessionalTarget(sourceSheet(page))).click()
  await expect(page.getByRole('dialog', { name: 'Household annual estimate' })).toBeVisible()
})
