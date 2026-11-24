import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { annualSheetText, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { annualRetirementContinuation, annualRetirementStep } from '../annualRetirement'
import { annualStep, initializeState, projectAnnualCoverage, projectCanonicalCoverage, projectFromState, type KernelResult } from '../annualState'
import type { WorkingSpendingEvidence } from '../annualWorking'
import type { InputsV2 } from '../model'
import { runProjection } from '../projection'
import {
  deferredSourceId, phaseReference as ref, phaseTransitionPlan, phaseTransitionSpending, phaseTransitionWithDeferredSource,
} from './fixtures/phaseTransition'
import { BASE_YEAR, RETIREE, RRSP, TFSA, known } from './fixtures/retirementSettlement'

const rulePackId = 'CA-ON-tax-2026-legacy-v1'
const retirementYear = BASE_YEAR + 1
const terminalYear = BASE_YEAR + 2
const roundCents = (value: number) => Math.round(value * 100) / 100
const close = (value: number) => expect.closeTo(value, 8)

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

describe('continuous canonical working-to-retirement coverage', () => {
  it('settles the pinned working and retirement oracle in one owned chain', () => {
    const plan = phaseTransitionPlan()
    plan.people[0].previousYearEarnedIncome = known(12_000)
    const evidence = freeze(phaseTransitionSpending())
    const originalPlan = structuredClone(plan)
    const working = ok(projectCanonicalCoverage(freeze(plan), evidence, 1))
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(coverage).toMatchObject({
      baseYear: BASE_YEAR, requestedStartYear: BASE_YEAR, terminalYear, requestedYears: 2,
      blocked: null, uncomputedYears: [], overallConclusionAvailable: false, evaluationBasis: 'canonical-continuous',
    })
    expect(coverage.rows).toHaveLength(2)
    const [work, retired] = coverage.rows
    expect(work).toEqual(working.rows[0])
    expect(work).toMatchObject({
      year: BASE_YEAR,
      payrollContributions: close(ref.payroll), contributionRounding: close(ref.contribution - ref.netSavings),
      workingSettlement: { evaluationBasis: 'canonical-working', startCpi: 1, payrollRuleId: 'PAYROLL_2026',
        netCash: close(ref.netSavings), taxRules: { rulePackId, ruleYear: BASE_YEAR, coverage: 'estimated' },
        payrollReal: { taxDeduction: close(ref.taxDeduction), creditAmount: close(ref.creditAmount), employmentAmount: ref.employmentAmount } },
      byPerson: { [RETIREE]: {
        age: ref.age, income: ref.wage, earnedIncome: ref.wage, benefits: 0,
        tax: close(ref.workingTax), spending: ref.workingSpending, taxableIncome: close(ref.taxableWage),
      } },
      cashLedger: { income: ref.wage, benefits: 0, tax: close(ref.workingTax), spending: ref.workingSpending,
        voluntaryContributions: close(ref.netSavings), employeeContributions: 0, debtPayments: 0, retainedContributions: 0, unallocated: 0 },
      contributionLedger: { allocationCashBasis: close(ref.netSavings), appliedTotal: ref.contribution,
        postings: [{ id: `annual:${BASE_YEAR}:tfsa`, accountId: TFSA, ownerId: RETIREE, contributorId: RETIREE, amount: ref.contribution }] },
      byAccount: {
        [TFSA]: { opening: ref.tfsaOpening, contribution: ref.contribution, withdrawal: 0,
          returnAmount: close(ref.tfsaClosing - ref.tfsaOpening - ref.contribution), closing: close(ref.tfsaClosing) },
        [RRSP]: { opening: ref.rrspOpening, contribution: 0, withdrawal: 0, closing: close(ref.rrspClosing) },
      },
      tfsaLedger: { [RETIREE]: {
        openingRoom: known(ref.tfsaRoom), annualAddition: known(0), restored: known(0),
        applied: ref.contribution, retained: 0, closingRoom: known(roundCents(ref.tfsaClosingRoom)),
      } },
    })
    expect(work.retirementSettlement).toBeUndefined()
    expect(work.cashLedger.income - work.cashLedger.tax - work.cashLedger.spending - work.payrollContributions! + work.contributionRounding!)
      .toBeCloseTo(ref.contribution, 8)
    expect(working.state).toMatchObject({
      year: retirementYear,
      byPerson: { [RETIREE]: { age: ref.retirementAge, previousYearEarnedIncome: known(ref.wage),
        tfsaRoom: known(roundCents(ref.tfsaClosingRoom)) } },
      benefitIncomeLag: { [RETIREE]: { status: 'known', value: close(ref.taxableWage) } },
      contributionHistory: [{ id: `annual:${BASE_YEAR}:tfsa`, contributorId: RETIREE, calendarYear: BASE_YEAR,
        accountId: TFSA, amount: ref.contribution, deductionYear: null }],
      tfsaWithdrawalHistory: [],
    })

    expect(retired).toMatchObject({
      year: retirementYear,
      byPerson: { [RETIREE]: { age: ref.retirementAge, income: 0, earnedIncome: 0, benefits: 0,
        tax: close(ref.retirementTax), spending: close(ref.spendingFunded), taxableIncome: close(ref.rrspClosing) } },
      cashLedger: { income: 0, benefits: 0, tax: close(ref.retirementTax), spending: close(ref.spendingFunded),
        employeeContributions: 0, voluntaryContributions: 0, unallocated: 0 },
      byAccount: {
        [TFSA]: { opening: work.byAccount[TFSA].closing, contribution: 0, withdrawal: close(ref.tfsaClosing), closing: 0 },
        [RRSP]: { opening: work.byAccount[RRSP].closing, contribution: 0, withdrawal: close(ref.rrspClosing), closing: 0 },
      },
      retirementSettlement: { evaluationBasis: 'canonical-retirement', startCpi: ref.cpi,
        spendingDue: ref.spendingDue, spendingFunded: close(ref.spendingFunded), spendingUnmet: close(ref.deficit),
        taxRules: { rulePackId, ruleYear: BASE_YEAR, coverage: 'estimated' } },
      tfsaLedger: { [RETIREE]: { openingRoom: known(roundCents(ref.tfsaClosingRoom)), annualAddition: { status: 'unknown' },
        restored: known(0), applied: 0, retained: 0, closingRoom: { status: 'unknown' } } },
    })
    expect(retired).not.toHaveProperty('workingSettlement')
    expect(retired.payrollContributions ?? 0).toBe(0)
    expect(coverage.state).toMatchObject({
      year: terminalYear,
      byPerson: { [RETIREE]: { previousYearEarnedIncome: known(0), tfsaRoom: { status: 'unknown' } } },
      benefitIncomeLag: { [RETIREE]: { status: 'known', value: close(ref.rrspClosing) } },
      contributionHistory: working.state.contributionHistory,
      tfsaWithdrawalHistory: [{ id: `annual:${retirementYear}:withdrawal:${TFSA}`, personId: RETIREE,
        calendarYear: retirementYear, amount: close(ref.tfsaClosing) }],
    })
    expect(plan).toEqual(originalPlan)

    const throughTerminal = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(throughTerminal.rows.slice(0, 2)).toEqual(coverage.rows)
    expect(throughTerminal.rows[2]).toMatchObject({
      year: terminalYear,
      retirementSettlement: { startCpi: ref.cpi ** 2, spendingDue: close(ref.retirementSpending * ref.cpi ** 2),
        spendingFunded: 0, spendingUnmet: close(ref.retirementSpending * ref.cpi ** 2) },
      tfsaLedger: { [RETIREE]: { restored: known(roundCents(ref.tfsaClosing)), applied: 0,
        closingRoom: { status: 'unknown' } } },
    })
    expect(throughTerminal.state.tfsaWithdrawalHistory).toEqual(coverage.state.tfsaWithdrawalHistory)
    expect(throughTerminal.overallConclusionAvailable).toBe(false)
  })

  it('applies end CPI to the remaining investments after fully funded retirement spending', () => {
    const plan = phaseTransitionPlan()
    const retirementSpending = 5_000
    plan.budget = { kind: 'incomeBudget', workingSpending: ref.workingSpending, retirementSpending }
    const evidence = { ...phaseTransitionSpending(), retirementSpending: known(retirementSpending) }
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(coverage.blocked).toBeNull()
    const [, retired, terminal] = coverage.rows
    // The RRSP-first withdrawal is below both basic personal amounts and
    // the Ontario health premium threshold, so all of it pays spending.
    const due = retirementSpending * ref.cpi
    expect(retired).toMatchObject({
      retirementSettlement: { startCpi: ref.cpi, spendingDue: due, spendingFunded: due, spendingUnmet: 0 },
      cashLedger: { tax: 0, spending: due },
      byAccount: {
        [RRSP]: { opening: close(ref.rrspClosing), withdrawal: close(due), closing: close((ref.rrspClosing - due) * ref.cpi) },
        [TFSA]: { opening: close(ref.tfsaClosing), withdrawal: 0, closing: close((ref.tfsaOpening + ref.contribution) * ref.cpi ** 2) },
      },
    })
    expect(terminal.byAccount[RRSP].opening).toBe(retired.byAccount[RRSP].closing)
    expect(terminal.byAccount[TFSA].opening).toBe(retired.byAccount[TFSA].closing)
    expect(coverage.state.tfsaWithdrawalHistory).toEqual([])
  })

  it.each([known(800), { status: 'unknown', reason: 'private source evidence missing' } as const])(
    'keeps exact state after the first active retirement source is $status', (amount) => {
      const plan = freeze(phaseTransitionWithDeferredSource(amount))
      const evidence = freeze(phaseTransitionSpending())
      const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
      const result = ok(projectCanonicalCoverage(plan, evidence, 3))
      expect(result).toMatchObject({
        blocked: { status: 'unsupported', year: retirementYear, issues: [{ detail: expect.stringMatching(/active retirement income source/) }] },
        uncomputedYears: [terminalYear], overallConclusionAvailable: false,
      })
      expect(result.rows).toEqual(prefix.rows)
      expect(result.state).toEqual(prefix.state)
      expect(result.state).not.toBe(prefix.state)
      expect(result.state.tfsaWithdrawalHistory).toEqual([])
    },
  )

  it('holds the same working prefix when a source starts before the retirement phase', () => {
    const plan = phaseTransitionWithDeferredSource(known(800))
    plan.people[0].retirementAge++
    const evidence = freeze(phaseTransitionSpending())
    const prefix = ok(projectCanonicalCoverage(freeze(plan), evidence, 1))
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result).toMatchObject({
      rows: prefix.rows, state: prefix.state,
      blocked: { status: 'unsupported', year: retirementYear, issues: [{ detail: expect.stringMatching(/active working income source/) }] },
      uncomputedYears: [terminalYear], overallConclusionAvailable: false,
    })
  })

  it.each([
    { label: 'unknown', room: { status: 'unknown', reason: 'private room evidence missing' } as const },
    { label: 'clipped by one cent', room: known(roundCents(ref.contribution - 0.01)) },
  ])('holds the untouched canonical base when TFSA funding is $label', ({ room }) => {
    const plan = phaseTransitionPlan()
    plan.people[0].tfsaAvailableRoom = room
    const evidence = phaseTransitionSpending()
    const cold = ok(projectCanonicalCoverage(plan, evidence, 0))
    const result = ok(projectCanonicalCoverage(freeze(plan), freeze(evidence), 3))
    expect(result).toMatchObject({
      rows: [], blocked: { year: BASE_YEAR, status: 'unsupported', issues: [{ detail: expect.stringMatching(/TFSA room/) }] },
      uncomputedYears: [retirementYear, terminalYear], overallConclusionAvailable: false,
    })
    expect(result.state).toEqual(cold.state)
    expect(result.state).toMatchObject({ year: BASE_YEAR, contributionHistory: [],
      byAccount: { [TFSA]: { balance: ref.tfsaOpening }, [RRSP]: { balance: ref.rrspOpening } },
      byPerson: { [RETIREE]: { age: ref.age, tfsaRoom: room } } })
  })

  it('records negative cent rounding when the same TFSA posting rounds down', () => {
    const plan = phaseTransitionPlan()
    const extraWage = 0.01
    plan.people[0].earnedIncome = known(ref.wage + extraWage)
    // The extra cent is above YMPE and below YAMPE. CPP2 costs 4%, and the
    // remaining taxable wage is in the same federal and Ontario brackets.
    const extraPayroll = extraWage * 0.04
    const extraTax = (extraWage - extraPayroll) * (0.205 + 0.0915)
    const netCash = ref.netSavings + extraWage - extraPayroll - extraTax
    const result = ok(projectCanonicalCoverage(plan, phaseTransitionSpending(), 2))
    expect(result.blocked).toBeNull()
    expect(result.rows[0]).toMatchObject({
      contributionRounding: close(ref.contribution - netCash),
      contributionLedger: { allocationCashBasis: close(netCash), appliedTotal: ref.contribution },
      byAccount: { [TFSA]: { contribution: ref.contribution, closing: close(ref.tfsaClosing) } },
    })
    expect(result.rows[0].contributionRounding).toBeLessThan(0)
    expect(result.rows[1].byAccount[TFSA].opening).toBe(result.rows[0].byAccount[TFSA].closing)
  })

  it('settles large-dollar break-even and still refuses a one-cent shortfall', () => {
    const plan = phaseTransitionPlan()
    const wage = 800_000_000
    const workingSpending = 371_803_925.6073576
    plan.people[0].earnedIncome = known(wage)
    // Pinned at the working quote's break-even point. Reordering the cash
    // deductions can introduce a negative residual of one floating-point step.
    const run = (spending: number) => {
      plan.budget = { kind: 'incomeBudget', workingSpending: spending, retirementSpending: ref.retirementSpending }
      return ok(projectCanonicalCoverage(plan, { ...phaseTransitionSpending(), workingSpending: known(spending) }, 1))
    }
    const covered = run(workingSpending)
    expect(covered.blocked).toBeNull()
    expect(covered.rows[0]).toMatchObject({
      year: BASE_YEAR, contributionRounding: 0,
      workingSettlement: { netCash: 0 },
      contributionLedger: { postings: [], allocationCashBasis: 0 },
      cashLedger: { income: wage, spending: workingSpending },
      byAccount: { [TFSA]: { opening: ref.tfsaOpening, contribution: 0, closing: close(ref.tfsaOpening * ref.cpi) } },
    })
    const blocked = run(workingSpending + 0.01)
    expect(blocked).toMatchObject({ rows: [], blocked: { status: 'unsupported', year: BASE_YEAR }, state: { year: BASE_YEAR } })
  })

  it.each([
    { label: 'valid evidence and zero wages', wage: known(0), evidence: phaseTransitionSpending() },
    { label: 'valid evidence and positive wages', wage: known(ref.wage), evidence: phaseTransitionSpending() },
    { label: 'missing evidence and positive wages', wage: known(ref.wage), evidence: undefined },
    { label: 'missing evidence and unknown wages', wage: { status: 'unknown', reason: 'Wage not recorded' } as const, evidence: undefined },
  ])('requires an initial working year despite $label', ({ wage, evidence }) => {
    const plan = phaseTransitionPlan()
    plan.people[0].ageInBaseYear = ref.retirementAge
    plan.people[0].earnedIncome = wage
    expect(projectCanonicalCoverage(freeze(plan), evidence as WorkingSpendingEvidence, 2)).toMatchObject({
      status: 'unsupported', issues: [{ detail: expect.stringMatching(/initial working year/) }],
    })
  })

  it('keeps provider, standalone retirement and legacy entry points independent', () => {
    const plan = freeze(phaseTransitionPlan())
    const oldProjection = runProjection(plan.legacyProjection, undefined, plan)
    const opening = freeze(ok(initializeState(plan)))
    const prefix = ok(projectCanonicalCoverage(plan, phaseTransitionSpending(), 1))
    const resumed = freeze(prefix.state)
    const saved = structuredClone(resumed)
    const providers = { evaluate: vi.fn(), returns: vi.fn() }
    const legacyIssue = { code: 'unsupported', detail: 'income budget (per-person wages, payroll deductions and staged retirement) is out of scope for BE-13 A' }
    expect(annualStep(plan, opening, providers)).toEqual({ status: 'unsupported', issues: [legacyIssue] })
    expect(projectFromState(plan, resumed, 2, providers)).toEqual({ status: 'unsupported', issues: [legacyIssue] })
    expect(ok(projectAnnualCoverage(plan, resumed, 2, providers))).toMatchObject({
      evaluationBasis: 'provider-supplied', rows: [], state: saved, requestedStartYear: retirementYear,
      blocked: { year: retirementYear, issues: [legacyIssue] }, uncomputedYears: [terminalYear],
    })
    expect(annualRetirementStep(plan, resumed, providers.returns)).toMatchObject({ status: 'unsupported' })
    expect(annualRetirementContinuation(plan, resumed)).toMatchObject({ status: 'invalid' })
    expect(providers.evaluate).not.toHaveBeenCalled()
    expect(providers.returns).not.toHaveBeenCalled()
    expect(resumed).toEqual(saved)
    const fresh = ok(projectCanonicalCoverage(plan, phaseTransitionSpending(), 2))
    expect(fresh.requestedStartYear).toBe(BASE_YEAR)
    expect(fresh.rows[0].byAccount[TFSA].opening).toBe(ref.tfsaOpening)
    expect(runProjection(plan.legacyProjection, undefined, plan)).toEqual(oldProjection)
  })

  it('prices cold from the plan and guards against an authentic provider-produced snapshot', () => {
    expectTypeOf(projectCanonicalCoverage).parameters.toEqualTypeOf<[InputsV2, WorkingSpendingEvidence, number]>()
    const plan = phaseTransitionPlan()
    const providerPlan = freeze({ ...plan, budget: { kind: 'savingsBudget' as const, annualNetSavings: 0,
      retirementSpending: ref.retirementSpending, debtIncluded: known(true), taxBenefitIncluded: known(true) } })
    const opening = freeze(ok(initializeState(providerPlan)))
    const providers = { evaluate: () => ({ byPerson: { [RETIREE]: {
      income: 200, earnedIncome: 100, tax: 20, spending: 180, taxableIncome: 150,
      benefits: 0, benefitIncomeForNextYear: known(145),
    } } }), returns: () => 0.15 }
    const provider = ok(projectFromState(providerPlan, opening, 1, providers))
    expect(provider.rows[0]).not.toHaveProperty('workingSettlement')
    expect(provider.rows[0]).not.toHaveProperty('payrollContributions')
    expect(provider.rows[0]).not.toHaveProperty('contributionRounding')
    const sheet = canonicalAnnualSheet(ok(projectAnnualCoverage(providerPlan, opening, 1, providers)), { scenarioId: 'provider', revision: 1 })
    const cashRows = sheet.rows.find(row => row.id === canonicalSheetId('group', 'household'))!.children!
    expect(cashRows).toHaveLength(30)
    expect(cashRows.find(row => row.id === canonicalSheetId('value', 'cash', 'suppliedNetCash'))!.cells![BASE_YEAR].value).toBe(0)
    expect(annualSheetText(cashRows.find(row => row.id === canonicalSheetId('value', 'cash', 'tax'))!.label, 'en')).toBe('Supplied tax')
    expect(provider.state).toMatchObject({ year: retirementYear,
      byAccount: { [TFSA]: { balance: 1150 } }, benefitIncomeLag: { [RETIREE]: known(145) } })
    const snapshot = freeze(provider.state)
    const saved = structuredClone(snapshot)
    expect(annualRetirementContinuation(plan, snapshot)).toMatchObject({ status: 'invalid',
      issues: [{ detail: expect.stringMatching(/internally generated/) }] })
    const result = ok(projectCanonicalCoverage(freeze(plan), freeze(phaseTransitionSpending()), 2))
    expect(result.rows.map(row => row.byAccount[TFSA].opening)).toEqual([ref.tfsaOpening, close(ref.tfsaClosing)])
    expect(snapshot).toEqual(saved)
    expect(opening).toEqual(ok(initializeState(providerPlan)))
  })

  it('shows the two phases and the nominal-to-real bridge on the same sheet', () => {
    const plan = phaseTransitionPlan()
    const coverage = ok(projectCanonicalCoverage(plan, phaseTransitionSpending(), 3))
    const sheet = canonicalAnnualSheet(coverage, { scenarioId: 'pinned-transition', revision: 1 })
    const select = (rows: AnnualSheetRow[], id: string): AnnualSheetRow | undefined => {
      for (const row of rows) {
        if (row.id === id) return row
        const child = row.children && select(row.children, id)
        if (child) return child
      }
    }
    const cell = (year: number, ...parts: string[]) => select(sheet.rows, canonicalSheetId('value', ...parts))!.cells![year]
    const explain = (item: ReturnType<typeof cell>) => sheet.resolveExplanation!(item.explanationRefs![0])!

    const workingTax = cell(BASE_YEAR, 'cash', 'tax')
    const retirementTax = cell(retirementYear, 'cash', 'tax')
    expect(annualSheetText(select(sheet.rows, canonicalSheetId('value', 'cash', 'tax'))!.label, 'en')).toBe('Modeled tax')
    expect(workingTax).toMatchObject({ status: 'estimated', value: close(ref.workingTax), realFactor: 1 })
    expect(retirementTax).toMatchObject({ status: 'estimated', value: close(ref.retirementTax), realFactor: close(1 / ref.cpi) })
    expect(explain(workingTax)).toMatchObject({ rulePackage: rulePackId, taxYear: BASE_YEAR, projectionYear: BASE_YEAR })
    expect(explain(retirementTax)).toMatchObject({ rulePackage: rulePackId, taxYear: BASE_YEAR, projectionYear: retirementYear })
    expect(explain(workingTax).sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'workingSettlement.taxRules', id: rulePackId }),
      expect.objectContaining({ field: 'workingSettlement.payrollPolicy', id: 'PAYROLL_2026' }),
    ]))
    expect(explain(retirementTax).sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'retirementSettlement.taxRules', id: rulePackId }),
    ]))
    expect(explain(retirementTax).sources).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'PAYROLL_2026' })]))
    expect(cell(BASE_YEAR, 'cash', 'payrollContributions').value).toBeCloseTo(ref.payroll, 8)
    expect(cell(retirementYear, 'cash', 'payrollContributions')).toMatchObject({ status: 'not-applicable', value: null })
    expect(cell(BASE_YEAR, 'cash', 'suppliedNetCash')).toMatchObject({ status: 'not-applicable', value: null })
    const net = cell(BASE_YEAR, 'cash', 'canonicalNetCash')
    expect(net.value).toBeCloseTo(ref.netSavings, 8)
    const formula = explain(net).formula!
    expect(formula.filter(term => term.field === 'payrollContributions')).toMatchObject([
      { direction: 'subtract', value: close(ref.payroll), basis: 'nominal-CAD' },
    ])
    expect(formula.map(term => annualSheetText(term.label, 'en').toLowerCase()).join(' ')).not.toMatch(/supplied|provider/)
    expect(formula.reduce((sum, term) => sum + (term.direction === 'add' ? term.value : -term.value), 0)).toBeCloseTo(net.value!, 8)
    const rounding = cell(BASE_YEAR, 'cash', 'contributionRounding')
    expect(rounding.value).toBeCloseTo(ref.contribution - ref.netSavings, 8)
    expect(annualSheetText(explain(rounding).summary!, 'en')).toMatch(/half a cent/i)
    expect(annualSheetText(explain(retirementTax).forwardAssumption!, 'en')).toMatch(/2026.*2027/)
    expect(cell(BASE_YEAR, 'account', TFSA, 'closing')).toMatchObject({ value: close(ref.tfsaClosing), realFactor: close(1 / ref.cpi) })
    expect(cell(retirementYear, 'account', TFSA, 'opening')).toMatchObject({ value: close(ref.tfsaClosing), realFactor: close(1 / ref.cpi) })
    expect(cell(retirementYear, 'account', TFSA, 'closing')).toMatchObject({ value: 0, realFactor: close(1 / ref.cpi ** 2) })
    expect(cell(BASE_YEAR, 'retirement', 'spendingDue')).toMatchObject({ value: null, status: 'not-applicable' })
    expect(cell(retirementYear, 'retirement', 'spendingDue').value).toBe(ref.spendingDue)
    expect(cell(retirementYear, 'retirement', 'spendingFunded').value).toBeCloseTo(ref.spendingFunded, 8)
    const unmet = cell(retirementYear, 'retirement', 'spendingUnmet')
    expect(unmet.value).toBeCloseTo(ref.deficit, 8)
    expect(explain(unmet).formula).toMatchObject([
      { field: 'spendingDue', value: ref.spendingDue, direction: 'add', basis: 'nominal-CAD' },
      { field: 'spendingFunded', value: close(ref.spendingFunded), direction: 'subtract', basis: 'nominal-CAD' },
    ])
    expect(cell(terminalYear, 'estate')).toMatchObject({ value: null, status: 'unknown' })
    expect(annualSheetText(sheet.scope!, 'en')).toMatch(/FIRE/i)
  })

  it('renders a blocked retirement year and its suffix without leaking source details', () => {
    const plan = phaseTransitionWithDeferredSource({ status: 'unknown', reason: 'private source evidence missing' })
    const coverage = ok(projectCanonicalCoverage(plan, phaseTransitionSpending(), 3))
    const sheet = canonicalAnnualSheet(coverage, { scenarioId: 'blocked-transition', revision: 1 })
    const household = sheet.rows.find(row => row.id === canonicalSheetId('group', 'household'))!
    const tax = household.children!.find(row => row.id === canonicalSheetId('value', 'cash', 'tax'))!
    const blocked = tax.cells![retirementYear]
    const suffix = tax.cells![terminalYear]
    expect(blocked).toMatchObject({ value: null, status: 'not-computed' })
    expect(suffix).toMatchObject({ value: null, status: 'not-computed' })
    expect(annualSheetText(blocked.reason!, 'en')).not.toBe(annualSheetText(suffix.reason!, 'en'))
    const explanations = [blocked, suffix].map(item => sheet.resolveExplanation!(item.explanationRefs![0])!)
    for (const [index, item] of [blocked, suffix].entries()) {
      const explanation = explanations[index]
      const sources = [item.nativeBasis, explanation.summary, ...explanation.sources!.map(source => source.label)]
      expect(sources.filter(source => source !== undefined).map(source => annualSheetText(source, 'en')).join(' ')).not.toMatch(/supplied|provider/i)
      expect(explanation.rulePackage).toBeUndefined()
      expect(explanation.formula).toBeUndefined()
    }
    const displayed = JSON.stringify([sheet, ...explanations])
    expect(displayed).not.toContain(coverage.blocked!.issues[0].detail)
    expect(displayed).not.toContain(deferredSourceId)
    expect(displayed).not.toContain('private source evidence missing')
  })
})
