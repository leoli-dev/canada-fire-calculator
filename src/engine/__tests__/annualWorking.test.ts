import { describe, expect, it } from 'vitest'
import { evaluateCanonicalWorkingYear } from '../annualWorking'
import type { InputsV2 } from '../model'
import { phaseReference as reference, phaseTransitionPlan } from './fixtures/phaseTransition'
import { BASE_YEAR, RETIREE, TFSA, known, recorded } from './fixtures/retirementSettlement'

const spendingEvidence = () => ({
  workingSpending: known(reference.workingSpending), retirementSpending: known(reference.retirementSpending),
})

describe('canonical Ontario working evaluation', () => {
  it.each([
    [BASE_YEAR, reference.age, 1],
    [BASE_YEAR + 1, reference.age + 1, reference.cpi],
  ])('prices projection year %i at age %i using start CPI %s', (year, age, cpi) => {
    const plan = phaseTransitionPlan()
    plan.people[0].retirementAge = reference.retirementAge + 1
    const evidence = spendingEvidence()
    const originalPlan = structuredClone(plan)
    const originalEvidence = structuredClone(evidence)
    const result = evaluateCanonicalWorkingYear(plan, evidence, year)
    expect(result).toMatchObject({
      status: 'ok',
      value: {
        evaluationBasis: 'canonical-working', year, personId: RETIREE, age, startCpi: cpi,
        overallConclusionAvailable: false,
        taxRules: { ruleYear: 2026, rulePackId: 'CA-ON-tax-2026-legacy-v1', assumedFutureRule: false, coverage: 'estimated' },
        payrollReal: {
          contributions: expect.closeTo(reference.payroll, 8),
          taxDeduction: expect.closeTo(reference.taxDeduction, 8),
          creditAmount: expect.closeTo(reference.creditAmount, 8),
          employmentAmount: reference.employmentAmount,
        },
        payrollContributions: expect.closeTo(reference.payroll * cpi, 8),
        netCash: expect.closeTo(reference.netSavings * cpi, 8),
        evaluation: { byPerson: { [RETIREE]: {
          income: expect.closeTo(reference.wage * cpi, 8),
          earnedIncome: expect.closeTo(reference.wage * cpi, 8),
          benefits: 0,
          tax: expect.closeTo(reference.workingTax * cpi, 8),
          spending: expect.closeTo(reference.workingSpending * cpi, 8),
          taxableIncome: expect.closeTo(reference.taxableWage * cpi, 8),
          benefitIncomeForNextYear: { status: 'known', value: expect.closeTo(reference.taxableWage * cpi, 8) },
        } } },
      },
    })
    expect(plan).toEqual(originalPlan)
    expect(evidence).toEqual(originalEvidence)
  })

  it('refuses the reached retirement year even with valid working evidence', () => {
    const result = evaluateCanonicalWorkingYear(phaseTransitionPlan(), spendingEvidence(), BASE_YEAR + 1)
    expect(result).toMatchObject({ status: 'unsupported', issues: [{ detail: expect.stringMatching(/retirement/) }] })
  })

  it('requires an income budget and the Ontario 2026 payroll anchor', () => {
    const plan = phaseTransitionPlan()
    expect(evaluateCanonicalWorkingYear({ ...plan, province: 'BC' }, spendingEvidence())).toMatchObject({
      status: 'unsupported', issues: [{ detail: expect.stringMatching(/Ontario/) }],
    })
    expect(evaluateCanonicalWorkingYear({ ...plan, baseYear: BASE_YEAR + 1 }, spendingEvidence())).toMatchObject({
      status: 'unsupported', issues: [{ detail: expect.stringMatching(/anchor year/) }],
    })
    plan.budget = {
      kind: 'savingsBudget', annualNetSavings: 4_000, retirementSpending: reference.retirementSpending,
      debtIncluded: known(true), taxBenefitIncluded: known(true),
    }
    expect(evaluateCanonicalWorkingYear(plan, spendingEvidence())).toMatchObject({
      status: 'unsupported', issues: [{ detail: expect.stringMatching(/requires incomeBudget/) }],
    })
  })

  it.each([17, 70])('refuses payroll outside the supported age range at age %i', (age) => {
    const plan = phaseTransitionPlan()
    Object.assign(plan.people[0], { ageInBaseYear: age, retirementAge: age + 1 })
    plan.lifeExpectancy = age + 2
    expect(evaluateCanonicalWorkingYear(plan, spendingEvidence())).toMatchObject({
      status: 'unsupported', issues: [{ detail: expect.stringMatching(/ages 18 through 69/) }],
    })
  })

  it('refuses unknown wages and missing benefit evidence separately', () => {
    const plan = phaseTransitionPlan()
    plan.people[0].earnedIncome = { status: 'unknown', reason: 'Wage has not been supplied' }
    expect(evaluateCanonicalWorkingYear(plan, spendingEvidence())).toMatchObject({
      status: 'unsupported', issues: [{ detail: expect.stringMatching(/wage.*unknown/) }],
    })
    plan.people[0].earnedIncome = known(reference.wage)
    delete plan.people[0].cppAmountSource
    expect(evaluateCanonicalWorkingYear(plan, spendingEvidence())).toMatchObject({
      status: 'unsupported', issues: [{ detail: expect.stringMatching(/benefit.*explicit/) }],
    })
  })

  it.each(['workingSpending', 'retirementSpending'] as const)('requires matching supplied %s evidence', (field) => {
    const plan = phaseTransitionPlan()
    const evidence = spendingEvidence()
    expect(evaluateCanonicalWorkingYear(plan, { ...evidence, [field]: { status: 'unknown', reason: 'Amount missing' } }))
      .toMatchObject({ status: 'unsupported', issues: [{ detail: expect.stringContaining(field) }] })
    expect(evaluateCanonicalWorkingYear(plan, { ...evidence, [field]: known(reference[field] + 1) }))
      .toMatchObject({ status: 'invalid', issues: [{ detail: expect.stringContaining(field) }] })
  })

  it.each([known(1_000), { status: 'unknown', reason: 'Source amount missing' } as const])(
    'refuses a $status extra source in its first active working year',
    (annualAmount) => {
      const plan = phaseTransitionPlan()
      plan.people[0].retirementAge++
      plan.incomeSources.push({
        id: 'extra-wage', kind: 'employment', recipientId: RETIREE, startAge: reference.age + 1, annualAmount, provenance: recorded,
      })
      expect(evaluateCanonicalWorkingYear(plan, spendingEvidence()).status).toBe('ok')
      expect(evaluateCanonicalWorkingYear(plan, spendingEvidence(), BASE_YEAR + 1)).toMatchObject({
        status: 'unsupported', issues: [{ detail: expect.stringMatching(/active working income source/) }],
      })
    },
  )

  it('quotes cash when TFSA room is unknown and refuses a scheduled TFSA posting', () => {
    const plan = phaseTransitionPlan()
    plan.people[0].tfsaAvailableRoom = { status: 'unknown', reason: 'CRA room not supplied' }
    expect(evaluateCanonicalWorkingYear(plan, spendingEvidence())).toMatchObject({
      status: 'ok', value: { netCash: expect.closeTo(reference.netSavings, 8) },
    })
    plan.contributions.push({
      id: 'scheduled-tfsa', accountId: TFSA, contributorId: RETIREE, amount: 100,
      calendarYear: BASE_YEAR, deductionYear: null, provenance: recorded,
    })
    expect(evaluateCanonicalWorkingYear(plan, spendingEvidence())).toMatchObject({
      status: 'unsupported', issues: [{ detail: expect.stringMatching(/registered contributions/) }],
    })
  })

  it('accepts explicit break-even spending and refuses negative net cash', () => {
    const plan = phaseTransitionPlan()
    plan.people[0].earnedIncome = known(0)
    plan.budget = { kind: 'incomeBudget', workingSpending: 0, retirementSpending: reference.retirementSpending }
    expect(evaluateCanonicalWorkingYear(plan, { ...spendingEvidence(), workingSpending: known(0) })).toMatchObject({
      status: 'ok', value: { startCpi: 1, payrollContributions: 0, netCash: 0 },
    })
    plan.budget.workingSpending = 1
    expect(evaluateCanonicalWorkingYear(plan, { ...spendingEvidence(), workingSpending: known(1) })).toMatchObject({
      status: 'unsupported', issues: [{ detail: expect.stringMatching(/negative working cash/) }],
    })
  })

  it('accepts exact break-even after indexing and refuses a one-cent deficit', () => {
    const plan = phaseTransitionPlan()
    plan.people[0].retirementAge++
    const wage = 10_000
    // payroll.ts: CPP on $6,500 and EI on $10,000. Tax is zero below both basic personal amounts
    // and the Ontario health premium threshold. The anchor-dollar spending leaves exactly zero.
    const payroll = 6_500 * 0.0595 + 10_000 * 0.0163
    const breakEvenSpending = 9_450.25
    plan.people[0].earnedIncome = known(wage)
    plan.budget = {
      kind: 'incomeBudget', workingSpending: breakEvenSpending, retirementSpending: reference.retirementSpending,
    }
    expect(evaluateCanonicalWorkingYear(plan, { ...spendingEvidence(), workingSpending: known(breakEvenSpending) }, BASE_YEAR + 1))
      .toMatchObject({
        status: 'ok',
        value: {
          startCpi: 1.02, netCash: 0, payrollContributions: expect.closeTo(payroll * 1.02, 8),
          evaluation: { byPerson: { [RETIREE]: { income: 10_200, spending: expect.closeTo(9_639.255, 8), tax: 0 } } },
        },
      })

    plan.budget.workingSpending = 9_450.26
    expect(evaluateCanonicalWorkingYear(plan, { ...spendingEvidence(), workingSpending: known(9_450.26) }, BASE_YEAR + 1))
      .toMatchObject({ status: 'unsupported', issues: [{ detail: expect.stringMatching(/negative working cash/) }] })
  })

  it.each([null, undefined, {}])('returns a validation failure for malformed plan %j with no year argument', (plan) => {
    expect(evaluateCanonicalWorkingYear(plan as InputsV2, spendingEvidence())).toMatchObject({
      status: 'invalid', issues: [{ code: 'invalid' }],
    })
  })
})
