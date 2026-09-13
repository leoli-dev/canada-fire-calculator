import { describe, expect, it } from 'vitest'
import { runProjection } from '../projection'
import type { Inputs } from '../types'
import { allocateContributions, planPurchaseFunding } from '../funding'
import { validateInputs } from '../validate'
import { compareStrategies, findEarliestFireAge, maxSustainableSpending, requiredFireAssets, targetReport } from '../solvers'
import audit from './fixtures/pending-audit.json'

const fixture = (id: string) => audit.cases.find((entry) => entry.id === id)!.inputs as Inputs

describe('BE-30 independently derived funding identities', () => {
  it('P02: cannot buy a 500,000 home with only 100,000 and no mortgage', () => {
    const result = runProjection(fixture('P02'))
    expect(result.success).toBe(false)
    expect(result.rows[0].propertyValue).toBe(0)
    expect(result.rows[0].unfundedObligations).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'purchase:50', amount: 400_000 }),
    ]))
  })

  it('P03: later income cannot finance an earlier missing 100,000 down payment', () => {
    const result = runProjection(fixture('P03'))
    expect(result.success).toBe(false)
    expect(result.rows[0].propertyValue).toBe(0)
    expect(result.rows[0].unfundedObligations).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'purchase:50', amount: 100_000 }),
    ]))
  })

  it('P04: 10,000 cannot fund 8,000 FHSA plus 8,000 employee DC', () => {
    const result = runProjection(fixture('P04'))
    expect(result.success).toBe(false)
    expect(Math.min(...Object.values(result.rows[0].balances))).toBeGreaterThanOrEqual(0)
    expect(result.rows[0].unfundedObligations).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'contributions:50', amount: 6_000 }),
    ]))
  })

  it('shares the annual budget: employer match is an external inflow, zero-opening DC works, and exact funding has no gap', () => {
    const base = fixture('P04')
    const exact = runProjection({
      ...base, annualSavings: 16_000,
      lockedRetirement: { ...base.lockedRetirement!, employerContribution: 4_000 },
    })
    expect(exact.rows[0].unfundedObligations).toEqual([])
    expect(exact.rows[0].fhsaBalance).toBe(8_000)
    expect(exact.rows[0].lockedRetirementBalance).toBe(12_000)
    expect(exact.rows[0].balances.tfsa).toBe(0)
    const allocated = allocateContributions({
      age: 50, budget: 20_000, fhsa: 8_000, employee: 8_000, employer: 4_000,
      split: { tfsa: 1, rrsp: 0, nonReg: 0 },
    })
    expect(allocated.voluntary.tfsa).toBe(4_000)
    expect(allocated.employer).toBe(4_000)
    const overSplit = allocateContributions({
      age: 50, budget: 100, fhsa: 0, employee: 0, employer: 0,
      split: { tfsa: 0.7, rrsp: 0.7, nonReg: 0 },
    })
    expect(Object.values(overSplit.voluntary).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 8)
    const underSplit = allocateContributions({
      age: 50, budget: 100, fhsa: 0, employee: 0, employer: 0,
      split: { tfsa: 0.3, rrsp: 0.3, nonReg: 0 },
    })
    expect(underSplit.voluntary.nonReg).toBeCloseTo(40, 8)
  })

  it('accepts an exact all-cash purchase without a mortgage and conserves net worth at zero tax/return', () => {
    const input = {
      ...fixture('P02'), balances: { tfsa: 500_000, rrsp: 0, nonReg: 0 },
      principalResidence: { ...fixture('P02').principalResidence!, downPayment: 500_000 },
    } as Inputs
    expect(planPurchaseFunding(input.principalResidence as Extract<Inputs['principalResidence'], { mode: 'planned' }>, 50).gap).toBeNull()
    const result = runProjection(input)
    expect(result.success).toBe(true)
    expect(result.rows[0].propertyValue).toBe(500_000)
    expect(result.rows[0].balances.tfsa).toBe(0)
    expect(result.finalNetWorth).toBeCloseTo(500_000, 2)
  })

  it('books only a fully financed mortgage purchase and conserves cash plus home less debt', () => {
    const home = { ...fixture('P02').principalResidence!, annualMortgagePayment: 40_000, mortgageYears: 10 }
    const input = { ...fixture('P02'), balances: { tfsa: 140_000, rrsp: 0, nonReg: 0 }, principalResidence: home } as Inputs
    const result = runProjection(input)
    expect(result.success).toBe(true)
    expect(result.rows[0].propertyValue).toBe(500_000)
    expect(result.rows[0].debtBalance).toBeCloseTo(360_000, 2)
    expect(result.rows[0].balances.tfsa).toBeCloseTo(0, 2)
    expect(result.finalNetWorth).toBeCloseTo(140_000, 2)
  })

  it('grosses up an RRSP-funded retirement purchase for tax, and does not acquire when tax cash is missing', () => {
    const base = fixture('P02')
    const home = { ...base.principalResidence!, price: 50_000, downPayment: 50_000 }
    const insufficient = runProjection({
      ...base, balances: { tfsa: 0, rrsp: 50_000, nonReg: 0 }, principalResidence: home,
    } as Inputs)
    expect(insufficient.success).toBe(false)
    expect(insufficient.rows[0].propertyValue).toBe(0)
    expect(insufficient.rows[0].unfundedObligations[0].amount).toBeGreaterThan(0)
    const funded = runProjection({
      ...base, balances: { tfsa: 0, rrsp: 100_000, nonReg: 0 }, principalResidence: home,
    } as Inputs)
    expect(funded.rows[0].propertyValue).toBe(50_000)
    expect(funded.rows[0].tax).toBeGreaterThan(0)
    expect(funded.rows[0].balances.rrsp).toBeLessThan(50_000)
  })

  it('exits FHSA on purchase before any same-year contribution', () => {
    const base = fixture('P04')
    const result = runProjection({
      ...base, balances: { tfsa: 10_000, rrsp: 0, nonReg: 0 },
      fhsa: { balance: 40_000, annualContribution: 8_000, openedYearsAgo: 0 },
      lockedRetirement: null,
      principalResidence: {
        mode: 'planned', buyAtAge: 50, price: 50_000, downPayment: 50_000,
        appreciation: 0, netHoldingCostChange: 0, sellAtAge: null,
      },
    } as Inputs)
    expect(result.rows[0].fhsaBalance).toBe(0)
    expect(result.rows[0].propertyValue).toBe(50_000)
    expect(result.rows[0].balances.tfsa).toBe(10_000)
  })

  it('surfaces the same event and amount in input validation and marks quick estimators unsupported', () => {
    const input = fixture('P02')
    const issue = validateInputs(input).find((x) => x.eventId === 'purchase:50')!
    expect(issue.severity).toBe('error')
    expect(issue.amount).toBe(400_000)
    expect(targetReport(input, 100_000).status).toBe('unsupported')
    expect(Number.isNaN(requiredFireAssets(input))).toBe(true)
    expect(Number.isNaN(maxSustainableSpending(input))).toBe(true)
    expect(compareStrategies(input).every((candidate) => !candidate.result.success)).toBe(true)
    expect(findEarliestFireAge(fixture('P03'))).toBeNull()
  })

  it('does not book an accumulation-year mortgage payment that the savings budget cannot fund', () => {
    const input = {
      ...fixture('P03'),
      annualSavings: 10_000,
      balances: { tfsa: 100_000, rrsp: 0, nonReg: 0 },
    } as Inputs
    const result = runProjection(input)
    expect(result.success).toBe(false)
    expect(result.rows[0].propertyValue).toBe(0)
    expect(result.rows[0].debtBalance).toBe(0)
    expect(result.rows[0].unfundedObligations[0]).toMatchObject({
      eventId: 'purchase:50', reason: 'purchaseCost',
    })
  })

  it('rejects a down payment above price before moving funds', () => {
    const base = fixture('P02')
    const result = runProjection({
      ...base,
      principalResidence: { ...base.principalResidence!, downPayment: 600_000 },
    } as Inputs)
    expect(result.rows[0].propertyValue).toBe(0)
    expect(result.rows[0].unfundedObligations[0].reason).toBe('invalidPurchase')
  })
})
