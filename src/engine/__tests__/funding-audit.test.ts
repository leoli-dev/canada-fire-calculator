import { describe, expect, it } from 'vitest'
import { runProjection } from '../projection'
import type { Inputs } from '../types'
import { allocateContributions, planPurchaseFunding } from '../funding'
import { validateInputs } from '../validate'
import { compareStrategies, findEarliestFireAge, maxSustainableSpending, requiredFireAssets, targetReport } from '../solvers'
import audit from './fixtures/pending-audit.json'

const fixture = (id: string) => audit.cases.find((entry) => entry.id === id)!.inputs as Inputs

describe('BE-30 independently derived funding identities', () => {
  it('retirement mortgage delinquency keeps principal outstanding while the home is held', () => {
    const base = fixture('P03')
    const input = {
      ...base, fireAge: 51, lifeExpectancy: 52, annualSavings: 0, extraIncome: null,
      balances: { tfsa: 140_000, rrsp: 0, nonReg: 0 },
    } as Inputs
    const result = runProjection(input)
    expect(result.rows[0].debtBalance).toBeCloseTo(360_000, 2)
    expect(result.rows[1].shortfall).toBeCloseTo(40_000, 2)
    expect(result.rows[1].debtPayment).toBe(0)
    expect(result.rows[1].debtBalance).toBeCloseTo(360_000, 2)
    expect(result.rows[1].unfundedObligations).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'purchase:51', amount: 40_000, reason: 'purchaseCost' }),
    ]))
    expect(result.rows[2].debtBalance).toBeCloseTo(360_000, 2)
    expect(result.finalNetWorth).toBeCloseTo(140_000, 2)
    expect(result.success).toBe(false)
    expect(validateInputs(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'purchase:51', amount: 40_000 }),
    ]))
  })

  it('retirement mortgage delinquency is discharged from the next year-start sale', () => {
    const base = fixture('P03')
    const result = runProjection({
      ...base, fireAge: 51, lifeExpectancy: 52, annualSavings: 0, extraIncome: null,
      balances: { tfsa: 140_000, rrsp: 0, nonReg: 0 },
      principalResidence: { ...base.principalResidence!, sellAtAge: 52 },
    } as Inputs)
    expect(result.rows[1].debtBalance).toBeCloseTo(360_000, 2)
    expect(result.rows[2].debtPayment).toBe(0)
    expect(result.rows[2].balances.nonReg).toBeCloseTo(140_000, 2)
    expect(result.finalNetWorth).toBeCloseTo(140_000, 2)
  })

  it('retirement mortgage pays only the cash available and records the partial unpaid amount', () => {
    const base = fixture('P03')
    const result = runProjection({
      ...base, fireAge: 51, lifeExpectancy: 51, annualSavings: 0, extraIncome: null,
      balances: { tfsa: 160_000, rrsp: 0, nonReg: 0 },
    } as Inputs)
    const row = result.rows[1]
    expect(row.debtPayment).toBeCloseTo(20_000, 2)
    expect(row.debtBalance).toBeCloseTo(340_000, 2)
    expect(row.unfundedObligations).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'purchase:51', amount: 20_000 }),
    ]))
    expect(result.finalNetWorth).toBeCloseTo(160_000, 2)
  })

  it('retirement RRSP withdrawals cover the full installment and its tax without an arrears event', () => {
    const base = fixture('P03')
    const result = runProjection({
      ...base, fireAge: 51, lifeExpectancy: 51, annualSavings: 0, extraIncome: null,
      balances: { tfsa: 140_000, rrsp: 100_000, nonReg: 0 },
    } as Inputs)
    const row = result.rows[1]
    expect(row.unfundedObligations).toEqual([])
    expect(row.debtPayment).toBeCloseTo(40_000, 2)
    expect(row.debtBalance).toBeCloseTo(320_000, 2)
    expect(row.withdrawals.rrsp).toBeGreaterThan(40_000)
    expect(row.taxBySource.rrsp).toBeGreaterThan(0)
    expect(Object.values(row.taxBySource).reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(row.tax, 2)
    expect(row.balances.rrsp).toBeGreaterThanOrEqual(0)
  })

  it('retirement-year purchase with only the down payment reports an unpaid first installment', () => {
    const base = fixture('P03')
    const input = {
      ...base, fireAge: 50, lifeExpectancy: 50, annualSavings: 0, extraIncome: null,
      balances: { tfsa: 100_000, rrsp: 0, nonReg: 0 },
    } as Inputs
    const result = runProjection(input)
    expect(result.rows[0].debtPayment).toBe(0)
    expect(result.rows[0].debtBalance).toBeCloseTo(400_000, 2)
    expect(result.rows[0].unfundedObligations).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'purchase:50', amount: 40_000 }),
    ]))
    expect(validateInputs(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'purchase:50', amount: 40_000 }),
    ]))
    expect(result.success).toBe(false)
  })
  it.each([
    { savings: 0, opening: 220_000, age51: 40_000 },
    { savings: 20_000, opening: 160_000, age51: 20_000 },
  ])('uses remaining assets and savings for later mortgage installments ($savings savings)', ({ savings, opening, age51 }) => {
    const base = fixture('P03')
    const result = runProjection({
      ...base, fireAge: 53, lifeExpectancy: 52, annualSavings: savings,
      balances: { tfsa: opening, rrsp: 0, nonReg: 0 }, extraIncome: null,
    } as Inputs)
    expect(result.rows.map((row) => row.unfundedObligations)).toEqual([[], [], []])
    expect(result.rows[1].balances.tfsa).toBeCloseTo(age51, 2)
    expect(result.rows[2].balances.tfsa).toBeCloseTo(0, 2)
    expect(result.rows[1].housingFunding).toMatchObject({
      eventId: 'purchase:51', cost: 40_000, fromSavings: savings,
      fromOpening: 40_000 - savings,
    })
    expect(result.rows.map((row) => row.debtBalance)).toEqual([360_000, 320_000, 280_000])
    expect(result.finalNetWorth).toBeCloseTo(opening + 3 * savings, 2)
    expect(result.success).toBe(true)
  })

  it('keeps unpaid principal in debt rather than creating equity when a later installment cannot be funded', () => {
    const base = fixture('P03')
    const result = runProjection({
      ...base, fireAge: 53, lifeExpectancy: 52, annualSavings: 0,
      balances: { tfsa: 140_000, rrsp: 0, nonReg: 0 }, extraIncome: null,
    } as Inputs)
    expect(result.rows[1].unfundedObligations).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'purchase:51', amount: 40_000 }),
    ]))
    expect(result.rows[1].debtBalance).toBeCloseTo(360_000, 2)
    expect(result.rows[1].debtPayment).toBe(0)
    expect(result.rows[2].debtBalance).toBeCloseTo(360_000, 2)
    expect(result.finalNetWorth).toBeCloseTo(140_000, 2)
    expect(result.success).toBe(false)
  })

  it('discharges unpaid installments from sale proceeds without a sale-year phantom payment', () => {
    const base = fixture('P03')
    const result = runProjection({
      ...base, fireAge: 54, lifeExpectancy: 53, annualSavings: 0,
      balances: { tfsa: 140_000, rrsp: 0, nonReg: 0 }, extraIncome: null,
      principalResidence: { ...base.principalResidence!, sellAtAge: 53 },
    } as Inputs)
    expect(result.rows[3].propertyValue).toBe(0)
    expect(result.rows[3].debtPayment).toBe(0)
    expect(result.rows[3].debtBalance).toBe(0)
    expect(result.rows[3].balances.nonReg).toBeCloseTo(140_000, 2)
    expect(result.finalNetWorth).toBeCloseTo(140_000, 2)
  })

  it('attributes a working-year RRSP-financed cash purchase to RRSP tax exactly once', () => {
    const base = fixture('P02')
    const result = runProjection({
      ...base, fireAge: 51, lifeExpectancy: 50,
      balances: { tfsa: 0, rrsp: 100_000, nonReg: 0 },
      principalResidence: { ...base.principalResidence!, price: 50_000, downPayment: 50_000 },
    } as Inputs)
    const row = result.rows[0]
    expect(row.purchaseFunding?.grossWithdrawals.rrsp).toBeCloseTo(50_000 / 0.65, 2)
    expect(row.tax).toBeCloseTo(50_000 / 0.65 * 0.35, 2)
    expect(row.taxBySource.rrsp).toBeCloseTo(row.tax, 2)
    expect(row.taxableBySource.rrsp).toBeCloseTo(50_000 / 0.65, 2)
    expect(row.taxBySource.property).toBe(0)
    expect(row.taxableBySource.property).toBe(0)
    expect(result.rrspTax - result.estateTax).toBeCloseTo(row.tax, 2)
  })

  it('attributes non-registered purchase gains to their account and not property', () => {
    const base = fixture('P02')
    const result = runProjection({
      ...base, fireAge: 51, lifeExpectancy: 50,
      balances: { tfsa: 0, rrsp: 0, nonReg: 100_000 }, nonRegBook: 0,
      principalResidence: { ...base.principalResidence!, price: 50_000, downPayment: 50_000 },
    } as Inputs)
    const row = result.rows[0]
    const gross = 50_000 / (1 - 0.5 * 0.35)
    expect(row.purchaseFunding?.grossWithdrawals.nonReg).toBeCloseTo(gross, 2)
    expect(row.taxableBySource.nonReg).toBeCloseTo(gross * 0.5, 2)
    expect(row.taxBySource.nonReg).toBeCloseTo(gross * 0.5 * 0.35, 2)
    expect(row.taxBySource.property).toBe(0)
    expect(row.taxableBySource.property).toBe(0)
    expect(Object.values(row.taxBySource).reduce((sum, value) => sum + value, 0)).toBeCloseTo(row.tax, 2)
  })

  it('grosses up a later mortgage installment funded from RRSP and reconciles the tax source', () => {
    const base = fixture('P03')
    const result = runProjection({
      ...base, fireAge: 52, lifeExpectancy: 51, annualSavings: 0,
      balances: { tfsa: 140_000, rrsp: 100_000, nonReg: 0 }, extraIncome: null,
    } as Inputs)
    const row = result.rows[1]
    expect(row.unfundedObligations).toEqual([])
    expect(row.housingFunding?.grossWithdrawals.rrsp).toBeCloseTo(40_000 / 0.65, 2)
    expect(row.taxBySource.rrsp).toBeCloseTo(40_000 / 0.65 * 0.35, 2)
    expect(row.taxableBySource.rrsp).toBeCloseTo(40_000 / 0.65, 2)
    expect(row.taxBySource.property).toBe(0)
    expect(row.debtBalance).toBeCloseTo(320_000, 2)
  })
  it('year-start purchase cannot use a pension received later in that year', () => {
    const base = fixture('P02')
    const result = runProjection({
      ...base,
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 },
      principalResidence: { ...base.principalResidence!, price: 50_000, downPayment: 50_000 },
      pension: { annualAmount: 100_000, startAge: 50, indexation: 1, bridgeAnnual: 0 },
    } as Inputs)
    expect(result.success).toBe(false)
    expect(result.rows[0].propertyValue).toBe(0)
    expect(result.rows[0].unfundedObligations).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'purchase:50', amount: 50_000 }),
    ]))
  })

  it.each([50, 65])('uses only opening RRSP funds at age %i and does not charge purchase tax twice', (age) => {
    const base = fixture('P02')
    const result = runProjection({
      ...base, currentAge: age, fireAge: age, lifeExpectancy: age,
      balances: { tfsa: 0, rrsp: 100_000, nonReg: 0 },
      principalResidence: { ...base.principalResidence!, buyAtAge: age, price: 50_000, downPayment: 50_000 },
    } as Inputs)
    const row = result.rows[0]
    const funding = row.purchaseFunding!
    expect(funding.grossWithdrawals.rrsp).toBeGreaterThan(50_000)
    expect(funding.grossWithdrawals.rrsp - funding.withdrawalTax).toBeCloseTo(50_000, 2)
    expect(row.tax).toBeCloseTo(funding.withdrawalTax, 2)
    expect(row.netCash).toBeCloseTo(0, 2)
    expect(Object.values(row.taxBySource).reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(row.tax, 2)
    expect(result.finalNetWorth).toBeCloseTo(100_000 - row.tax, 2)
  })

  it('records unmet FHSA contribution instead of silently shrinking it', () => {
    const base = fixture('P04')
    const input = { ...base, annualSavings: 5_000, lockedRetirement: null } as Inputs
    const result = runProjection(input)
    expect(result.success).toBe(false)
    expect(result.rows[0].fhsaBalance).toBe(5_000)
    expect(result.rows[0].unfundedObligations).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'contributions:50', amount: 3_000, reason: 'fhsaContribution' }),
    ]))
    expect(validateInputs(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'contributions:50', amount: 3_000 }),
    ]))
    expect(targetReport(input, 100_000).status).toBe('unsupported')
    expect(Number.isNaN(requiredFireAssets(input))).toBe(true)
    expect(Number.isNaN(maxSustainableSpending(input))).toBe(true)
  })

  it.each([
    { savings: 0, opening: 140_000 },
    { savings: 20_000, opening: 120_000 },
  ])('can pay a first mortgage installment with leftover opening TFSA plus $savings savings', ({ savings, opening }) => {
    const base = fixture('P03')
    const result = runProjection({
      ...base, annualSavings: savings, extraIncome: null,
      balances: { tfsa: opening, rrsp: 0, nonReg: 0 },
    } as Inputs)
    expect(result.rows[0].unfundedObligations).toEqual([])
    expect(result.rows[0].propertyValue).toBe(500_000)
    expect(result.rows[0].debtBalance).toBeCloseTo(360_000, 2)
    expect(result.rows[0].balances.tfsa).toBeCloseTo(0, 2)
    expect(result.rows[0].purchaseFunding).toMatchObject({
      eventId: 'purchase:50', price: 500_000, mortgagePrincipal: 400_000,
      downPaymentFromAccounts: 100_000, firstYearCostFromSavings: savings,
      firstYearCostFromOpening: 40_000 - savings,
      grossWithdrawals: { tfsa: opening, rrsp: 0, nonReg: 0 },
    })
    expect(result.rows[0].propertyValue - result.rows[0].debtBalance + result.rows[0].balances.tfsa)
      .toBeCloseTo(opening + savings, 2)
  })
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
