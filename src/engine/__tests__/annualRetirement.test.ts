import { describe, expect, it, vi } from 'vitest'
import { annualSheetText } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { annualRetirementStep, projectRetirementCoverage } from '../annualRetirement'
import { annualStep, initializeState, type KernelResult, type ReturnProvider } from '../annualState'
import type { InputsV2 } from '../model'
import { BASE_YEAR, RETIREE, RRSP, TFSA, known, recorded, retirementPlan } from './fixtures/retirementSettlement'

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(`${result.status}: ${result.issues.map(issue => issue.detail).join(', ')}`)
  return result.value
}

// Hand-calculated from the 2026 Federal/ON bracket and BPA snapshots in
// rules/tax2026Snapshot.ts and the ON health premium schedule in taxData.ts.
// At age 57 there is no age credit, and an ordinary RRSP withdrawal has no
// pension credit. Ontario tax after the BPA is below the $5,818 surtax trigger.
const taxOn60k = (58_523 - 16_452) * 0.14 + (60_000 - 58_523) * 0.205
  + (53_891 - 12_989) * 0.0505 + (60_000 - 53_891) * 0.0915 + 600
const taxOn30k = (30_000 - 16_452) * 0.14 + (30_000 - 12_989) * 0.0505 + 300

describe('canonical solo retirement settlement', () => {
  it('solves for an RRSP withdrawal including its own tax across both bracket boundaries', () => {
    const spending = 60_000 - taxOn60k
    const plan = retirementPlan({ spending, inflation: 0.02, rrsp: 140_000 })
    const opening = ok(initializeState(plan))
    const { row, state } = ok(annualRetirementStep(plan, opening))

    expect(row.byAccount[RRSP].withdrawal).toBeCloseTo(60_000, 2)
    expect(row.byAccount[RRSP].closing).toBeCloseTo(81_600, 2)
    expect(row.byAccount[TFSA]).toMatchObject({ opening: 40_000, withdrawal: 0, closing: 40_800 })
    expect(row.taxLedger[RETIREE].taxableIncome).toBeCloseTo(60_000, 2)
    expect(row.taxLedger[RETIREE].tax).toBeCloseTo(taxOn60k, 2)
    expect(row.cashLedger.tax).toBeCloseTo(taxOn60k, 2)
    expect(row.byPerson[RETIREE]).toMatchObject({ earnedIncome: 0, benefits: 0 })
    expect(row.retirementSettlement).toMatchObject({
      evaluationBasis: 'canonical-retirement', spendingDue: spending, spendingUnmet: 0,
      taxRules: { ruleYear: 2026, rulePackId: 'CA-ON-tax-2026-legacy-v1', assumedFutureRule: false, coverage: 'estimated' },
    })
    expect(row.retirementSettlement?.spendingFunded).toBeCloseTo(spending, 2)
    expect(state.byAccount[RRSP].balance).toBe(row.byAccount[RRSP].closing)

    // The next year's nominal draw and tax both scale from their anchor-dollar values.
    const next = ok(annualRetirementStep(plan, state)).row
    expect(next.byAccount[RRSP].opening).toBe(row.byAccount[RRSP].closing)
    expect(next.byAccount[RRSP].withdrawal).toBeCloseTo(61_200, 2)
    expect(next.taxLedger[RETIREE].tax).toBeCloseTo(taxOn60k * 1.02, 2)
    expect(next.retirementSettlement?.taxRules).toEqual(row.retirementSettlement?.taxRules)
  })

  it('uses the TFSA for the remainder when tax reduces the net cash from an exhausted RRSP', () => {
    const plan = retirementPlan({ rrsp: 30_000, tfsa: 10_000, spending: 30_000 })
    const { row } = ok(annualRetirementStep(plan, ok(initializeState(plan))))

    expect(row.byAccount[RRSP]).toMatchObject({ withdrawal: 30_000, closing: 0 })
    expect(row.byAccount[TFSA].withdrawal).toBeCloseTo(taxOn30k, 2)
    expect(row.taxLedger[RETIREE].tax).toBeCloseTo(taxOn30k, 2)
    expect(row.retirementSettlement?.spendingFunded).toBeCloseTo(30_000, 2)
    expect(row.retirementSettlement?.spendingUnmet).toBeCloseTo(0, 2)
  })

  it('uses an ordinary RRSP after a TFSA-first drain and applies only age credits at 65', () => {
    // Income of $30,000 is below both age-credit phaseouts in taxData.ts.
    const taxAt65 = taxOn30k - 9_208 * 0.14 - 6_342 * 0.0505
    const spending = 32_500 - taxAt65
    const plan = retirementPlan({ age: 65, strategy: 'tfsaFirst', tfsa: 2_500, spending })
    const { row } = ok(annualRetirementStep(plan, ok(initializeState(plan))))

    expect(row.byAccount[TFSA]).toMatchObject({ withdrawal: 2_500, closing: 0 })
    expect(row.byAccount[RRSP].withdrawal).toBeCloseTo(30_000, 2)
    expect(row.taxLedger[RETIREE].taxableIncome).toBeCloseTo(30_000, 2)
    expect(row.taxLedger[RETIREE].tax).toBeCloseTo(taxAt65, 2)
    expect(row.retirementSettlement?.spendingUnmet).toBeCloseTo(0, 2)
  })

  it('reports the unmet spending after both balances have been exhausted', () => {
    const plan = retirementPlan({ age: 64, rrsp: 40_000, tfsa: 10_000, spending: 55_000 })
    const opening = ok(initializeState(plan))
    const { row, state } = ok(annualRetirementStep(plan, opening))

    expect(row.byAccount[RRSP]).toMatchObject({ withdrawal: 40_000, closing: 0 })
    expect(row.byAccount[TFSA]).toMatchObject({ withdrawal: 10_000, closing: 0 })
    expect(state.byAccount[RRSP].balance).toBe(0)
    expect(state.byAccount[TFSA].balance).toBe(0)
    const taxOn40k = (40_000 - 16_452) * 0.14 + (40_000 - 12_989) * 0.0505 + 450
    expect(row.cashLedger.tax).toBeCloseTo(taxOn40k, 2)
    expect(row.retirementSettlement?.spendingDue).toBe(55_000)
    const funded = 50_000 - taxOn40k
    expect(row.retirementSettlement?.spendingFunded).toBeCloseTo(funded, 2)
    expect(row.retirementSettlement?.spendingUnmet).toBeCloseTo(55_000 - funded, 2)

    const next = ok(annualRetirementStep(plan, state)).row
    expect(next.retirementSettlement).toMatchObject({ spendingFunded: 0, spendingUnmet: 55_000 })
    expect(next.cashLedger.tax).toBe(0)
  })

  it('settles TFSA-first tax-free and carries nominal balances and withdrawal room into the next year', () => {
    const plan = retirementPlan({ strategy: 'tfsaFirst', spending: 10_000, inflation: 0.02,
      tfsaReturn: 0.05, rrspReturn: 0.02, fee: 0.01 })
    const opening = ok(initializeState(plan))
    const originalPlan = structuredClone(plan)
    const originalOpening = structuredClone(opening)
    const coverage = ok(projectRetirementCoverage(plan, opening, 3))
    const [first, second, third] = coverage.rows

    expect(coverage).toMatchObject({ evaluationBasis: 'canonical-retirement', blocked: null })
    expect([first.year, second.year, third.year]).toEqual([2026, 2027, 2028])
    for (const row of coverage.rows) {
      expect(row.taxLedger[RETIREE]).toEqual({ taxableIncome: 0, tax: 0 })
      expect(row.byAccount[RRSP].withdrawal).toBe(0)
      expect(row.retirementSettlement?.spendingUnmet).toBeCloseTo(0, 2)
    }
    expect(first.retirementSettlement).toMatchObject({ spendingDue: 10_000, startCpi: 1 })
    expect(second.retirementSettlement).toMatchObject({ spendingDue: 10_200, startCpi: 1.02 })
    expect(first.byAccount[TFSA].withdrawal).toBeCloseTo(10_000, 2)
    expect(second.byAccount[TFSA].withdrawal).toBeCloseTo(10_200, 2)
    // Withdraw first, then grow the remaining principal at (1 + real - fee) × (1 + CPI).
    expect(first.byAccount[TFSA].closing).toBeCloseTo(31_824, 7)
    expect(first.byAccount[RRSP].closing).toBeCloseTo(103_020, 7)
    expect(second.byAccount[TFSA].closing).toBeCloseTo(22_938.7392, 7)
    for (const account of [TFSA, RRSP]) {
      expect(second.byAccount[account].opening).toBe(first.byAccount[account].closing)
      expect(third.byAccount[account].opening).toBe(second.byAccount[account].closing)
      expect(coverage.state.byAccount[account].balance).toBe(third.byAccount[account].closing)
    }
    expect(first.tfsaLedger[RETIREE]).toMatchObject({ applied: 0, restored: known(0), closingRoom: known(8_000) })
    expect(second.tfsaLedger[RETIREE]).toMatchObject({
      applied: 0, openingRoom: known(8_000), restored: known(10_000), closingRoom: { status: 'unknown' },
    })
    expect(third.tfsaLedger[RETIREE].restored).toEqual(known(10_200))
    expect(coverage.state.tfsaWithdrawalHistory?.map(({ calendarYear, amount, personId }) => ({ calendarYear, amount, personId })))
      .toEqual(coverage.rows.map((row, index) => ({ calendarYear: row.year, amount: [10_000, 10_200, 10_404][index], personId: RETIREE })))
    const firstStep = ok(annualRetirementStep(plan, opening))
    expect(ok(projectRetirementCoverage(plan, firstStep.state, 2)).rows).toEqual([second, third])
    expect(plan).toEqual(originalPlan)
    expect(opening).toEqual(originalOpening)
  })

  it('gives each return request an isolated copy of the post-withdrawal state', () => {
    const plan = retirementPlan({ strategy: 'tfsaFirst', spending: 10_000 })
    const opening = ok(initializeState(plan))
    const originalPlan = structuredClone(plan)
    const originalOpening = structuredClone(opening)
    const observed: number[] = []
    const returns = vi.fn<ReturnProvider>(({ plan, state }) => {
      observed.push(state.byAccount[TFSA].balance)
      state.byAccount[TFSA].balance = 1
      plan.accounts[0].balance = 1
      return 0.1
    })
    const { row, state } = ok(annualRetirementStep(plan, opening, returns))

    expect(returns.mock.calls.map(([, accountId]) => accountId)).toEqual([TFSA, RRSP])
    expect(observed).toEqual([30_000, 30_000])
    expect(row.byAccount[TFSA]).toMatchObject({ opening: 40_000, withdrawal: 10_000, returnAmount: 3_000, closing: 33_000 })
    expect(state.byAccount[RRSP].balance).toBe(110_000)
    expect(plan).toEqual(originalPlan)
    expect(opening).toEqual(originalOpening)
  })

  it.each(['benefit activation', 'age-71 RRSP conversion'])('stops coverage at %s and retains the priced prefix', (boundary) => {
    const plan = retirementPlan({ age: boundary === 'benefit activation' ? 64 : 70 })
    if (boundary === 'benefit activation') {
      plan.incomeSources.push({ id: 'later-benefit', kind: 'oas', fromAge: 60, startAge: 65,
        annualAmount: known(8_000), recipientId: RETIREE, provenance: recorded })
    }
    const opening = ok(initializeState(plan))
    const first = ok(annualRetirementStep(plan, opening))
    const coverage = ok(projectRetirementCoverage(plan, opening, 3))

    expect(coverage.rows).toEqual([first.row])
    expect(coverage.state).toEqual(first.state)
    expect(coverage.blocked).toMatchObject({ year: 2027, status: 'unsupported', issues: [{
      detail: expect.stringMatching(boundary === 'benefit activation' ? /active retirement income/ : /age-71/),
    }] })
    expect(coverage.uncomputedYears).toEqual([2028])
    expect(coverage.overallConclusionAvailable).toBe(false)
  })

  it('drains fractional RRSP principal exactly and prices age 71 with both accounts exhausted', () => {
    const plan = retirementPlan({ age: 70, strategy: 'tfsaFirst', tfsa: 1_000_000, rrsp: 100.07, spending: 1_100_000 })
    const opening = ok(initializeState(plan))
    const coverage = ok(projectRetirementCoverage(plan, opening, 2))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows).toHaveLength(2)
    const [age70, age71] = coverage.rows
    expect(age70.byAccount[TFSA]).toMatchObject({ withdrawal: 1_000_000, closing: 0 })
    expect(age70.byAccount[RRSP]).toMatchObject({ withdrawal: 100.07, closing: 0 })
    expect(age70.cashLedger.tax).toBe(0)
    expect(age70.retirementSettlement?.spendingUnmet).toBeCloseTo(99_899.93, 2)
    expect(age71.byPerson[RETIREE].age).toBe(71)
    expect(age71.byAccount[RRSP].opening).toBe(0)
    expect(age71.retirementSettlement).toMatchObject({ spendingFunded: 0, spendingUnmet: 1_100_000 })
  })

  it.each(['duplicate account-year', 'unsafe amount'])('rejects simulated TFSA history with %s even for an empty request', (problem) => {
    const plan = retirementPlan({ strategy: 'tfsaFirst', spending: 10_000 })
    const opening = ok(initializeState(plan))
    const { state } = ok(annualRetirementStep(plan, opening))
    const history = state.tfsaWithdrawalHistory!
    const saved = { ...history[0] }
    if (problem === 'duplicate account-year') history.push({ ...saved, id: 'different-id-for-the-same-year' })
    else history[0] = { ...saved, amount: Number.MAX_VALUE }
    const returns = vi.fn(() => 0)

    expect(annualRetirementStep(plan, state, returns)).toMatchObject({ status: 'invalid' })
    expect(projectRetirementCoverage(plan, state, 0, returns)).toMatchObject({ status: 'invalid' })
    expect(projectRetirementCoverage(plan, state, 1, returns)).toMatchObject({ status: 'invalid' })
    expect(returns).not.toHaveBeenCalled()
  })

  it('accepts the editor’s zero withdrawal row as an explicit record with no cash or room effect', () => {
    const plan = retirementPlan({ strategy: 'tfsaFirst', spending: 10_000 })
    const statement = plan.tfsaStatement![RETIREE]
    statement.withdrawals = [{ id: `be27:withdrawal:${RETIREE}:0`, calendarYear: BASE_YEAR, amount: 0 }]
    const opening = ok(initializeState(plan))
    const { rows, state } = ok(projectRetirementCoverage(plan, opening, 2))
    expect(rows[0].tfsaLedger[RETIREE].restored).toEqual(known(0))
    expect(rows[1].tfsaLedger[RETIREE].restored).toEqual(known(10_000))
    expect(state.tfsaWithdrawalHistory?.map(item => item.amount)).toEqual([10_000, 10_000])
    expect(state.tfsaWithdrawalHistory?.some(item => item.id === statement.withdrawals[0].id)).toBe(false)

    statement.provenance = { origin: 'unknown', sourceYear: null }
    expect(annualRetirementStep(plan, opening)).toMatchObject({ status: 'unsupported' })
  })

  it('rejects a working-provider snapshot even after its age advances to retirement', () => {
    const plan = retirementPlan({ age: 54 })
    plan.accounts = plan.accounts.filter(account => account.id === RRSP)
    const opening = ok(initializeState(plan))
    const worker = { income: 0, earnedIncome: 0, tax: 0, benefits: 0, spending: 0, taxableIncome: 0, benefitIncomeForNextYear: known(0) }
    const worked = ok(annualStep(plan, opening, { evaluate: () => ({ byPerson: { [RETIREE]: worker } }), returns: () => 0 }))
    expect(worked.state.byPerson[RETIREE].age).toBe(55)
    expect(worked.state.byPerson[RETIREE].retirementAge).toBe(55)

    const returns = vi.fn(() => 0)
    expect(annualRetirementStep(plan, worked.state, returns)).toMatchObject({ status: 'unsupported' })
    expect(returns).not.toHaveBeenCalled()
  })

  it('rejects a collapsed CPI index before computing or sampling the base year', () => {
    const plan = retirementPlan({ inflation: -1 })
    const opening = ok(initializeState(plan))
    const returns = vi.fn(() => 0)
    expect(annualRetirementStep(plan, opening, returns)).toMatchObject({ status: 'invalid' })
    expect(projectRetirementCoverage(plan, opening, 1, returns)).toMatchObject({ status: 'invalid' })
    expect(returns).not.toHaveBeenCalled()
  })

  it.each([0, 1])('refuses an unclonable opening snapshot for a %i-year request', (years) => {
    const plan = retirementPlan()
    const opening = Object.assign(ok(initializeState(plan)), { injectedCallback: () => 0 })
    const returns = vi.fn(() => 0)
    expect(projectRetirementCoverage(plan, opening, years, returns)).toMatchObject({ status: 'invalid' })
    expect(returns).not.toHaveBeenCalled()
  })

  it('presents tax as an estimate and reconciles displayed retirement spending', () => {
    const plan = retirementPlan({ age: 64, rrsp: 40_000, tfsa: 10_000, spending: 55_000 })
    const coverage = ok(projectRetirementCoverage(plan, ok(initializeState(plan)), 2))
    const sheet = canonicalAnnualSheet(coverage, { scenarioId: 'retirement-oracle', revision: 1 })
    const household = sheet.rows.find(row => row.id === canonicalSheetId('group', 'household'))!
    const cell = (domain: string, field: string, year = BASE_YEAR) =>
      household.children!.find(row => row.id === canonicalSheetId('value', domain, field))!.cells![year]
    const explain = (item: ReturnType<typeof cell>) => sheet.resolveExplanation!(item.explanationRefs![0])!
    const tax = cell('cash', 'tax')
    expect(tax.status).toBe('estimated')
    expect(tax.value).toBeCloseTo(5_110.7755, 4)
    expect(explain(tax)).toMatchObject({ rulePackage: 'CA-ON-tax-2026-legacy-v1', taxYear: 2026, projectionYear: 2026 })
    expect(explain(cell('cash', 'tax', 2027))).toMatchObject({
      rulePackage: 'CA-ON-tax-2026-legacy-v1', taxYear: 2026, projectionYear: 2027,
    })
    expect(annualSheetText(explain(tax).formulaBasis!, 'en')).toMatch(/CPI/i)

    const due = cell('retirement', 'spendingDue')
    const funded = cell('retirement', 'spendingFunded')
    const unmet = cell('retirement', 'spendingUnmet')
    expect(due.value).toBe(55_000)
    expect(funded.value).toBeCloseTo(44_889.2245, 4)
    expect(unmet.value).toBeCloseTo(10_110.7755, 4)
    for (const item of [funded, unmet]) {
      const formula = explain(item).formula!
      expect(formula).toEqual(expect.arrayContaining([expect.objectContaining({ direction: 'subtract' })]))
      expect(formula.reduce((total, term) => total + (term.direction === 'add' ? term.value : -term.value), 0))
        .toBeCloseTo(item.value!, 4)
    }
  })

  const excluded: [string, (plan: InputsV2) => void][] = [
    ['salary', plan => { plan.people[0].earnedIncome = known(12_000) }],
    ['active employment source', plan => { plan.incomeSources.push({ id: 'employment', kind: 'employment',
      annualAmount: known(12_000), recipientId: RETIREE, fromAge: 57, toAge: 58, provenance: recorded }) }],
    ['CPP', plan => { plan.people[0].cppAnnualAt65 = 10_000 }],
    ['OAS', plan => { plan.people[0].oasAnnualAt65 = 8_000 }],
    ['RRIF', plan => { plan.accounts.find(account => account.id === RRSP)!.kind = 'rrif' }],
  ]

  it.each(excluded)('refuses %s before calling the return provider', (_name, enterExcludedFact) => {
    const plan = retirementPlan()
    enterExcludedFact(plan)
    const opening = ok(initializeState(plan))
    const returns = vi.fn(() => 0)
    expect(annualRetirementStep(plan, opening, returns)).toMatchObject({ status: 'unsupported' })
    expect(returns).not.toHaveBeenCalled()
  })

  it('keeps retirement outside the provider-supplied working kernel', () => {
    const plan = retirementPlan()
    const evaluate = vi.fn(() => ({ byPerson: {} }))
    const returns = vi.fn(() => 0)
    expect(annualStep(plan, ok(initializeState(plan)), { evaluate, returns })).toMatchObject({
      status: 'unsupported', issues: [{ detail: 'retirement withdrawals and benefit rules not yet wired' }],
    })
    expect(evaluate).not.toHaveBeenCalled()
    expect(returns).not.toHaveBeenCalled()
  })
})
