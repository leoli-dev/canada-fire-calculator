import { describe, expect, it, vi } from 'vitest'
import { annualRetirementStep } from '../annualRetirement'
import { annualStep, initializeState, projectAnnualCoverage, projectFromState } from '../annualState'
import { calculateHouseholdTax } from '../householdTax'
import { sideIncomeDeductions } from '../payroll'
import { incomeEventsFromPlan } from '../personIncome'
import { runProjection } from '../projection'
import { phaseReference as reference, phaseTransitionPlan } from './fixtures/phaseTransition'
import { BASE_YEAR, RETIREE, RRSP, TFSA, retirementPlan } from './fixtures/retirementSettlement'

describe('phase transition reference at 589742895cb351b817caa2feea1475d15e4b3193', () => {
  it('checks the hand arithmetic against the pre-existing payroll and tax components', () => {
    const plan = phaseTransitionPlan()
    const payroll = sideIncomeDeductions(reference.wage, 'employment', 'ON', reference.age)
    expect(payroll.contributions).toBeCloseTo(reference.payroll, 8)
    expect(payroll.taxDeduction).toBeCloseTo(reference.taxDeduction, 8)
    expect(payroll.creditAmount).toBeCloseTo(reference.creditAmount, 8)
    expect(payroll.employmentAmount).toBe(reference.employmentAmount)

    const event = { id: 'reference-wage', kind: 'employment' as const, personId: RETIREE, amount: reference.wage }
    const tax = calculateHouseholdTax(plan, BASE_YEAR, [event], { payroll: { [RETIREE]: {
      taxDeduction: reference.taxDeduction, creditAmount: reference.creditAmount, employmentAmount: reference.employmentAmount,
    } } })
    expect(tax).toMatchObject({ status: 'ok', byPerson: { [RETIREE]: {
      grossIncome: reference.wage, taxableIncome: reference.taxableWage, tax: expect.closeTo(reference.workingTax, 8),
    } } })

    expect(incomeEventsFromPlan(plan, BASE_YEAR + 1)).toEqual({ status: 'ok', events: [] })
    const retirementTax = calculateHouseholdTax(plan, BASE_YEAR + 1, [
      { id: 'reference-retirement-draw', kind: 'rrspWithdrawal', accountId: RRSP, amount: reference.rrspOpening },
    ])
    expect(retirementTax).toMatchObject({
      status: 'ok', total: expect.closeTo(reference.retirementTax / reference.cpi, 8),
      rulePackId: 'CA-ON-tax-2026-legacy-v1',
    })
  })

  it('requires static retirement evidence on the standalone retirement entry point', () => {
    const plan = phaseTransitionPlan()
    const opening = initializeState(plan)
    if (opening.status !== 'ok') throw new Error(JSON.stringify(opening))
    const adjusted = structuredClone(opening.value)
    adjusted.year++
    adjusted.byPerson[RETIREE].age++
    const returns = vi.fn(() => 0)
    expect(annualRetirementStep(plan, adjusted, returns)).toMatchObject({ status: 'unsupported' })
    expect(returns).not.toHaveBeenCalled()

    const alreadyRetired = retirementPlan({
      age: reference.retirementAge, spending: reference.retirementSpending,
      rrsp: reference.rrspOpening, tfsa: reference.tfsaOpening + reference.contribution,
    })
    const retiredOpening = initializeState(alreadyRetired)
    if (retiredOpening.status !== 'ok') throw new Error(JSON.stringify(retiredOpening))
    expect(annualRetirementStep(alreadyRetired, retiredOpening.value)).toMatchObject({
      status: 'ok', value: { row: {
        year: BASE_YEAR,
        byAccount: {
          [RRSP]: { withdrawal: reference.rrspOpening, closing: 0 },
          [TFSA]: { withdrawal: reference.tfsaOpening + reference.contribution, closing: 0 },
        },
        cashLedger: { tax: expect.closeTo(reference.retirementTax / reference.cpi, 8) },
        retirementSettlement: {
          evaluationBasis: 'canonical-retirement', spendingDue: reference.retirementSpending,
          spendingFunded: expect.closeTo(reference.spendingFunded / reference.cpi, 8),
          spendingUnmet: expect.closeTo(reference.deficit / reference.cpi, 8),
        },
      } },
    })
  })

  it('preserves the existing provider path refusal before calling either provider', () => {
    const plan = phaseTransitionPlan()
    const opening = initializeState(plan)
    if (opening.status !== 'ok') throw new Error(JSON.stringify(opening))
    const providers = { evaluate: vi.fn(), returns: vi.fn() }
    const issue = { code: 'unsupported', detail: 'income budget (per-person wages, payroll deductions and staged retirement) is out of scope for BE-13 A' }
    const expected = { status: 'unsupported', issues: [issue] }
    expect(annualStep(plan, opening.value, providers)).toEqual(expected)
    expect(projectFromState(plan, opening.value, 2, providers)).toEqual(expected)
    expect(projectAnnualCoverage(plan, opening.value, 2, providers)).toMatchObject({
      status: 'ok', value: {
        rows: [], state: opening.value, uncomputedYears: [BASE_YEAR + 1], evaluationBasis: 'provider-supplied',
        blocked: { year: BASE_YEAR, status: 'unsupported', issues: [issue] },
      },
    })
    expect(providers.evaluate).not.toHaveBeenCalled()
    expect(providers.returns).not.toHaveBeenCalled()
  })

  it('keeps legacy projection output for the same working-to-retirement plan', () => {
    const plan = phaseTransitionPlan()
    const result = runProjection(plan.legacyProjection, undefined, plan)
    // FNV-1a over the complete result, captured on the pinned base.
    let hash = 0xcbf29ce484222325n
    for (const character of JSON.stringify(result)) {
      hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0)!)) * 0x100000001b3n)
    }
    expect(hash.toString(16).padStart(16, '0')).toMatchInlineSnapshot(`"33d2fb1f6ee304f2"`)
    expect(plan.accounts.find(account => account.id === TFSA)?.balance).toBe(reference.tfsaOpening)
  })
})
