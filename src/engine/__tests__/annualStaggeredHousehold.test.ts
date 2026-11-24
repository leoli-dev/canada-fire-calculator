import { describe, expect, it, vi } from 'vitest'
import { annualSheetText, type AnnualSheetModel } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { annualRetirementContinuation, annualRetirementStep, projectRetirementCoverage } from '../annualRetirement'
import { annualStep, initializeState, projectAnnualCoverage, projectCanonicalCoverage, projectFromState, type KernelResult } from '../annualState'
import { runProjection } from '../projection'
import { phaseTransitionPlan, phaseTransitionSpending } from './fixtures/phaseTransition'
import { BASE_YEAR, known, retirementPlan, RETIREE, RRSP, TFSA } from './fixtures/retirementSettlement'
import { fullyRetiredYear, PARTNER, staggeredHouseholdPlan, staggeredOwners, staggeredReference as ref, staggeredSpending } from './fixtures/staggeredHousehold'

const close = (value: number) => expect.closeTo(value, 8)
const unknown = { status: 'unknown', reason: 'Evidence has not been recorded' } as const

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function setZeroRetirementSpending(plan: ReturnType<typeof staggeredHouseholdPlan>) {
  if (plan.budget.kind !== 'incomeBudget') throw new Error('Expected the income budget fixture')
  plan.budget.retirementSpending = 0
  plan.legacyProjection.retirementSpending = 0
  return { ...staggeredSpending(), retirementSpending: known(0) }
}

function spendingCell(sheet: AnnualSheetModel, year: number, personId?: string) {
  const group = personId ? canonicalSheetId('group', 'person', personId) : canonicalSheetId('group', 'household')
  const id = personId ? canonicalSheetId('value', 'person', personId, 'spending') : canonicalSheetId('value', 'cash', 'spending')
  const row = sheet.rows.find(row => row.id === group)?.children?.find(row => row.id === id)
  const cell = row?.cells?.[year]
  const reference = cell?.explanationRefs?.[0]
  const explanation = reference && sheet.resolveExplanation?.(reference)
  if (!cell || !explanation) throw new Error(`Missing spending explanation for ${group} in ${year}`)
  return { cell, explanation }
}

describe('canonical staggered Ontario household', () => {
  it.each([ref.working, ref.mixed])('reconciles the hand calculation at start CPI $startCpi', ({ self, partner, spending }) => {
    expect(self.wage + partner.wage - self.payroll - partner.payroll - self.tax - partner.tax - spending).toBeCloseTo(0, 8)
    expect(spending).not.toBe(ref.retirementSpending)
  })

  it('posts household spending once and carries separate payroll, tax, wages and balances across the two phases', () => {
    const plan = staggeredHouseholdPlan()
    const evidence = staggeredSpending()
    const originalPlan = structuredClone(plan)
    const originalEvidence = structuredClone(evidence)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result).toMatchObject({
      evaluationBasis: 'canonical-continuous', overallConclusionAvailable: false,
      blocked: null, uncomputedYears: [],
      state: { year: fullyRetiredYear },
    })
    expect(result.rows.map(row => row.year)).toEqual([BASE_YEAR, BASE_YEAR + 1])
    expect(result.rows[0]).toEqual(prefix.rows[0])

    for (const [index, expected] of [ref.working, ref.mixed].entries()) {
      const row = result.rows[index]
      const { self, partner, startCpi } = expected
      const people = { [RETIREE]: self, [PARTNER]: partner }
      expect(Object.keys(row.byPerson).sort()).toEqual(Object.keys(people).sort())
      for (const [id, person] of Object.entries(people)) {
        expect(row.byPerson[id]).toMatchObject({
          age: person.age, income: close(person.wage * startCpi), earnedIncome: close(person.wage * startCpi),
          tax: close(person.tax * startCpi), taxableIncome: close(person.taxable * startCpi), benefits: 0,
        })
        expect(row.taxLedger[id]).toEqual({ tax: close(person.tax * startCpi), taxableIncome: close(person.taxable * startCpi) })
      }
      expect(Object.values(row.byPerson).map(person => person.spending)).toEqual([0, 0])
      expect(row).toMatchObject({
        payrollContributions: close((self.payroll + partner.payroll) * startCpi),
        workingSettlement: {
          evaluationBasis: 'canonical-working', startCpi, payrollRuleId: 'PAYROLL_2026', netCash: 0,
          taxRules: { rulePackId: 'CA-ON-tax-2026-legacy-v1', ruleYear: BASE_YEAR },
          household: {
            phase: index === 0 ? 'both-working' : 'mixed',
            spendingSource: index === 0 ? 'workingSpending' : 'transitionSpending',
            spending: close(expected.spending * startCpi), spendingReal: expected.spending,
            byPerson: {
              [RETIREE]: { phase: index === 0 ? 'working' : 'retired', grossWagesReal: self.wage,
                payrollReal: index === 0 ? {
                  contributions: close(self.payroll), taxDeduction: close(self.wage - self.taxable),
                } : null },
              [PARTNER]: { phase: 'working', grossWagesReal: partner.wage, payrollReal: {
                contributions: close(partner.payroll), taxDeduction: close(partner.wage - partner.taxable),
              } },
            },
          },
        },
      })
      expect(row.cashLedger).toMatchObject({
        income: close((self.wage + partner.wage) * startCpi), tax: close((self.tax + partner.tax) * startCpi),
        spending: close(expected.spending * startCpi), benefits: 0, debtPayments: 0,
        employeeContributions: 0, voluntaryContributions: 0, retainedContributions: 0, unallocated: 0,
      })
      const { income, tax, spending } = row.cashLedger
      expect(income - tax - row.payrollContributions! - spending).toBeCloseTo(0, 8)
      expect(row.contributionLedger).toMatchObject({ allocationCashBasis: 0, appliedTotal: 0, postings: [] })
      expect(row.retirementSettlement).toBeUndefined()

      for (const [id, balance] of [[TFSA, ref.tfsaOpening], [RRSP, ref.rrspOpening]] as const) {
        const opening = balance * (1 + ref.inflation) ** index
        expect(row.byAccount[id]).toMatchObject({
          ownerId: staggeredOwners[id], opening: close(opening), closing: close(opening * (1 + ref.inflation)),
          returnAmount: close(opening * ref.inflation), contribution: 0, withdrawal: 0,
        })
      }
    }

    for (const [state, expected] of [[prefix.state, ref.working], [result.state, ref.mixed]] as const) {
      expect(state.contributionHistory).toEqual([])
      expect(state.tfsaWithdrawalHistory).toEqual([])
      for (const [id, person] of [[RETIREE, expected.self], [PARTNER, expected.partner]] as const) {
        expect(state.byPerson[id]).toMatchObject({
          age: person.age + 1, previousYearEarnedIncome: known(close(person.wage * expected.startCpi)),
        })
        expect(state.benefitIncomeLag[id]).toEqual(known(close(person.taxable * expected.startCpi)))
      }
    }
    expect(result.state.byAccount).toMatchObject({
      [TFSA]: { ownerId: RETIREE, balance: close(ref.tfsaOpening * 1.02 ** 2) },
      [RRSP]: { ownerId: PARTNER, balance: close(ref.rrspOpening * 1.02 ** 2) },
    })
    expect(plan).toEqual(originalPlan)
    expect(evidence).toEqual(originalEvidence)
  })

  it('uses the self terminal horizon when the younger partner is listed first', () => {
    const plan = staggeredHouseholdPlan()
    plan.people.reverse()
    expect(plan.people.map(({ role, ageInBaseYear }) => [role, ageInBaseYear]))
      .toEqual([['partner', 54], ['self', 56]])
    expect(plan.lifeExpectancy).toBe(60)

    const result = ok(projectCanonicalCoverage(plan, setZeroRetirementSpending(plan), 5))
    // At the 2026 anchor, self reaches 60 in 2030 and the partner reaches 60 in 2032.
    expect(result).toMatchObject({
      terminalYear: 2030,
      blocked: { year: 2030, status: 'unsupported', issues: [{ detail: expect.stringMatching(/end.life/i) }] },
      uncomputedYears: [],
    })
    expect(result.rows.map(row => row.year)).toEqual([2026, 2027, 2028, 2029])
    expect(result.rows[1].byPerson).toMatchObject({
      [RETIREE]: { age: 57, earnedIncome: 0 },
      [PARTNER]: { age: 55, earnedIncome: 81_600 },
    })
    expect(result.rows[2]).toMatchObject({
      workingSettlement: { household: { phase: 'both-retired' } },
      cashLedger: { spending: 0 },
      byAccount: { [TFSA]: { withdrawal: 0, closing: close(1_061.208) }, [RRSP]: { withdrawal: 0, closing: close(21_224.16) } },
    })
  })

  it('keeps projecting when the older partner already exceeds the self life expectancy', () => {
    const plan = staggeredHouseholdPlan()
    const [self, partner] = plan.people
    Object.assign(self, { ageInBaseYear: 49, retirementAge: 52, earnedIncome: known(ref.working.partner.wage) })
    Object.assign(partner, { ageInBaseYear: 56, retirementAge: 57, earnedIncome: known(ref.working.self.wage) })
    plan.lifeExpectancy = 53
    Object.assign(plan.legacyProjection, { currentAge: 49, fireAge: 52, lifeExpectancy: 53 })
    plan.legacyProjection.partner!.currentAge = 56

    const result = ok(projectCanonicalCoverage(plan, setZeroRetirementSpending(plan), 5))
    expect(result).toMatchObject({
      terminalYear: 2030,
      blocked: { year: 2030, status: 'unsupported', issues: [{ detail: expect.stringMatching(/end.life/i) }] },
      state: { year: 2030 },
      uncomputedYears: [],
    })
    expect(result.rows.map(row => row.year)).toEqual([2026, 2027, 2028, 2029])
    for (const [offset, row] of result.rows.slice(0, 3).entries()) {
      const cpi = 1.02 ** offset
      const bothWorking = offset === 0
      expect(row.byPerson).toMatchObject({
        [RETIREE]: { age: 49 + offset, earnedIncome: close(80_000 * cpi) },
        [PARTNER]: { age: 56 + offset, earnedIncome: bothWorking ? 40_000 : 0 },
      })
      expect(row.cashLedger.spending).toBeCloseTo((bothWorking ? ref.working.spending : ref.mixed.spending) * cpi, 8)
    }
    expect(result.rows[3]).toMatchObject({
      workingSettlement: { household: { phase: 'both-retired' } },
      byPerson: { [RETIREE]: { age: 52, earnedIncome: 0 }, [PARTNER]: { age: 59, earnedIncome: 0 } },
      cashLedger: { spending: 0 },
      byAccount: { [TFSA]: { withdrawal: 0, closing: close(1_082.43216) }, [RRSP]: { withdrawal: 0, closing: close(21_648.6432) } },
    })
  })

  it('explains the transition budget only for genuine household working settlement', () => {
    const plan = staggeredHouseholdPlan()
    const context = { scenarioId: 'spending-explanations', revision: 1 }
    const mixedSheet = canonicalAnnualSheet(ok(projectCanonicalCoverage(plan, staggeredSpending(), 2)), context)
    const mixedHousehold = spendingCell(mixedSheet, BASE_YEAR + 1)
    expect(mixedHousehold.cell.value).toBeCloseTo(ref.mixed.spending * ref.mixed.startCpi, 8)
    expect(mixedHousehold.explanation.sources).toContainEqual(expect.objectContaining({
      field: 'transitionSpending', granularity: 'input',
      label: expect.objectContaining({ en: expect.stringMatching(/spending recorded once/i) }),
    }))
    for (const personId of [RETIREE, PARTNER]) {
      const mixedPerson = spendingCell(mixedSheet, BASE_YEAR + 1, personId)
      expect(mixedPerson.cell.value).toBeNull()
      expect(annualSheetText(mixedPerson.explanation.summary!, 'en')).toMatch(/household|personal allocation/i)
    }

    plan.budget = {
      kind: 'savingsBudget', annualNetSavings: 0, retirementSpending: ref.retirementSpending,
      debtIncluded: known(true), taxBenefitIncluded: known(true),
    }
    const provider = (income: number, tax: number, spending: number) => ({
      income, earnedIncome: income, benefits: 0, tax, spending, taxableIncome: income, benefitIncomeForNextYear: known(income),
    })
    const providedSheet = canonicalAnnualSheet(ok(projectAnnualCoverage(plan, ok(initializeState(plan)), 1, {
      evaluate: () => ({ byPerson: { [RETIREE]: provider(200, 20, 180), [PARTNER]: provider(400, 40, 360) } }),
      returns: () => 0,
    })), context)
    const providedHousehold = spendingCell(providedSheet, BASE_YEAR)
    expect(providedHousehold.cell.value).toBe(540)
    expect(annualSheetText(providedHousehold.explanation.summary!, 'en')).toMatch(/supplied/i)
    for (const [personId, spending] of [[RETIREE, 180], [PARTNER, 360]] as const) {
      const provided = spendingCell(providedSheet, BASE_YEAR, personId)
      expect(provided.cell.value).toBe(spending)
      expect(annualSheetText(provided.explanation.summary!, 'en')).toMatch(/supplied/i)
    }

    const solo = retirementPlan()
    const soloSheet = canonicalAnnualSheet(ok(projectRetirementCoverage(solo, ok(initializeState(solo)), 1)), context)
    expect(spendingCell(soloSheet, BASE_YEAR).cell.value).toBe(25_000)
    const retired = spendingCell(soloSheet, BASE_YEAR, RETIREE)
    expect(retired.cell.value).toBe(25_000)
    expect(annualSheetText(retired.cell.nativeBasis!, 'en')).toMatch(/canonical retirement/i)
    for (const sheet of [providedSheet, soloSheet]) {
      for (const personId of [undefined, RETIREE]) {
        const { explanation } = spendingCell(sheet, BASE_YEAR, personId)
        expect(explanation.sources).not.toContainEqual(expect.objectContaining({ field: 'transitionSpending' }))
        expect(annualSheetText(explanation.summary!, 'en')).not.toMatch(/household total|personal allocation|recorded budget evidence/i)
      }
    }
  })

  it.each([
    [0, -0.01, 'contributionAttribution'], [1, -0.01, 'contributionAttribution'], [0, 0.01, 'withdrawalFunding'],
  ])('leaves year offset %i uncommitted when spending changes by %s', (offset, change, cause) => {
    const plan = staggeredHouseholdPlan()
    const evidence = staggeredSpending()
    const prefix = ok(projectCanonicalCoverage(plan, evidence, offset))
    if (offset === 0) {
      if (plan.budget.kind !== 'incomeBudget') throw new Error('Expected the income budget fixture')
      plan.budget.workingSpending += change
      evidence.workingSpending = known(plan.budget.workingSpending)
    } else {
      evidence.transitionSpending = known(ref.mixed.spending + change)
    }
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.rows).toEqual(prefix.rows)
    expect(result.state).toEqual(prefix.state)
    expect(result.blocked).toMatchObject({
      status: 'unsupported', year: BASE_YEAR + offset,
      causes: [cause],
    })
    expect(result.blocked?.issues.map(issue => issue.detail).join(' ')).toMatch(
      change > 0 ? /negative|deficit|withdrawal/i : /positive|surplus|attribution|allocation/i,
    )
    expect(result.uncomputedYears).toEqual(Array.from({ length: 3 - offset }, (_, index) => BASE_YEAR + offset + index + 1))
  })

  it('funds a one-cent real deficit in the mixed year', () => {
    const plan = staggeredHouseholdPlan()
    plan.strategy = 'tfsaFirst'
    plan.legacyProjection.strategy = 'tfsaFirst'
    const evidence = { ...staggeredSpending(), transitionSpending: known(ref.mixed.spending + 0.01) }
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    expect(result.rows[1].householdWithdrawalSettlement).toMatchObject({ accountId: TFSA, ownerId: RETIREE,
      withdrawal: close(0.0102), spendingUnmet: 0 })
  })

  it('keeps legacy, solo and strict entry points independent of the household run', () => {
    const plan = staggeredHouseholdPlan()
    const evidence = staggeredSpending()
    const originalLegacy = runProjection(plan.legacyProjection, undefined, plan)
    const solo = phaseTransitionPlan()
    const originalSolo = projectCanonicalCoverage(solo, phaseTransitionSpending(), 2)
    expect(originalSolo.status).toBe('ok')

    const opening = ok(initializeState(plan))
    const providers = { evaluate: vi.fn(), returns: vi.fn() }
    const strict = annualStep(plan, opening, providers)
    expect(strict).toMatchObject({ status: 'unsupported' })
    const canonical = ok(projectCanonicalCoverage(plan, evidence, 2))
    const saved = structuredClone(canonical.state)
    expect(projectFromState(plan, opening, 2, providers)).toEqual(strict)
    expect(ok(projectAnnualCoverage(plan, opening, 2, providers))).toMatchObject({
      evaluationBasis: 'provider-supplied', rows: [], state: opening,
      blocked: { year: BASE_YEAR, status: 'unsupported' }, uncomputedYears: [BASE_YEAR + 1],
    })
    expect(annualRetirementStep(plan, canonical.state, providers.returns)).toMatchObject({ status: 'unsupported' })
    expect(annualRetirementContinuation(plan, canonical.state)).toMatchObject({ status: 'invalid' })
    expect(canonical.state).toEqual(saved)
    expect(providers.evaluate).not.toHaveBeenCalled()
    expect(providers.returns).not.toHaveBeenCalled()
    expect(runProjection(plan.legacyProjection, undefined, plan)).toEqual(originalLegacy)
    expect(projectCanonicalCoverage(solo, phaseTransitionSpending(), 2)).toEqual(originalSolo)
  })

  it('stops in the first year on unknown working spending or wages', () => {
    const evidence = staggeredSpending()
    const unknownSpending = staggeredHouseholdPlan()
    const unknownWages = staggeredHouseholdPlan()
    unknownWages.people[1].earnedIncome = unknown

    for (const [plan, facts, reason] of [
      [unknownSpending, { ...evidence, workingSpending: unknown }, /workingSpending|working spending/i],
      [unknownWages, evidence, /wage/i],
    ] as const) {
      const result = ok(projectCanonicalCoverage(plan, facts, 4))
      expect(result).toMatchObject({
        rows: [], state: ok(initializeState(plan)), uncomputedYears: [BASE_YEAR + 1, fullyRetiredYear, fullyRetiredYear + 1],
        blocked: { year: BASE_YEAR, status: 'unsupported', issues: [{ detail: expect.stringMatching(reason) }] },
      })
    }
  })

  it('keeps both working tax returns when unknown spouse support blocks the mixed year', () => {
    const plan = staggeredHouseholdPlan()
    const evidence = staggeredSpending()
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    plan.taxProfile!.spouseSupported = unknown
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.rows).toEqual(prefix.rows)
    expect(result.state).toEqual(prefix.state)
    expect(result.blocked).toMatchObject({
      year: BASE_YEAR + 1, status: 'unsupported',
      issues: [{ detail: expect.stringMatching(/spouse/i) }],
    })
  })

  it('prices the mixed year without spouse credits when the household records no support', () => {
    const plan = staggeredHouseholdPlan()
    plan.taxProfile!.spouseSupported = known(false)
    const expected = ref.mixed.withoutSpouseSupport
    const evidence = { ...staggeredSpending(), transitionSpending: known(expected.spending) }
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    expect(result.rows[1]).toMatchObject({
      cashLedger: { spending: close(expected.spending * ref.mixed.startCpi), tax: close(expected.partnerTax * ref.mixed.startCpi) },
      byPerson: { [RETIREE]: { tax: 0 }, [PARTNER]: { tax: close(expected.partnerTax * ref.mixed.startCpi) } },
    })
  })

  it('rejects a malformed known spouse support value', () => {
    const plan = staggeredHouseholdPlan()
    plan.taxProfile!.spouseSupported = known('true' as unknown as boolean)
    const result = projectCanonicalCoverage(plan, staggeredSpending(), 2)
    if (result.status === 'ok') {
      expect(result.value.rows.length).toBeLessThan(2)
      expect(result.value.blocked).toMatchObject({ status: 'invalid' })
    } else {
      expect(result.status).toBe('invalid')
    }
  })

  it('preserves the working prefix without recorded transition spending', () => {
    const plan = staggeredHouseholdPlan()
    const evidence = staggeredSpending()
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    const result = ok(projectCanonicalCoverage(plan, { ...evidence, transitionSpending: unknown }, 4))
    expect(result.rows).toEqual(prefix.rows)
    expect(result.state).toEqual(prefix.state)
    expect(result.blocked).toMatchObject({
      year: BASE_YEAR + 1, status: 'unsupported',
      issues: [{ detail: expect.stringMatching(/transitionSpending|transition spending/i) }],
    })
  })
})
