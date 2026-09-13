import { describe, expect, it } from 'vitest'
import { buildDebtStream, impliedRate, rollDebtsForward, yearStartSale } from '../debts'
import { runProjection } from '../projection'
import { requiredFireAssets, targetReport } from '../solvers'
import type { Debt, Inputs, Mortgage } from '../types'
import propertySales from './fixtures/property-sales.json'
import { expectCad } from './fixtures/types'

const base: Inputs = {
  currentAge: 35,
  fireAge: 45,
  lifeExpectancy: 90,
  province: 'ON',
  annualSavings: 40000,
  savingsSplit: { tfsa: 0.3, rrsp: 0.5, nonReg: 0.2 },
  retirementSpending: 50000,
  returns: { tfsa: 0.05, rrsp: 0.05, nonReg: 0.05 },
  balances: { tfsa: 100000, rrsp: 200000, nonReg: 100000 },
  nonRegBook: 80000,
  cppStartAge: 65,
  cppAnnualAt65: 10000,
  oasStartAge: 65,
  oasAnnualAt65: 8700,
  strategy: 'rrspFirst' as const,
  inflation: 0.02,
}

const mortgage: Debt = {
  kind: 'mortgage',
  balance: 300000,
  annualPayment: 24000,
  yearsRemaining: 20,
}

describe('debt math', () => {
  it('labels opening, interest, payment and closing at a 2% inflation boundary', () => {
    // 400k at 0%, 40k nominal installments: first close is 360k/1.02;
    // second opening is the same instant, before another installment.
    const s = buildDebtStream([{ kind: 'mortgage', balance: 400_000, annualPayment: 40_000, yearsRemaining: 10 }], 3, 0.02)
    expect(s.openingBalance[0]).toBeCloseTo(400_000, 2)
    expect(s.interest[0]).toBe(0)
    expect(s.payment[0]).toBeCloseTo(40_000 / 1.02, 2)
    expect(s.closingBalance[0]).toBeCloseTo(360_000 / 1.02, 2)
    expect(s.openingBalance[1]).toBeCloseTo(s.closingBalance[0], 2)
  })

  it('distinguishes the supported opening sale from a hypothetical year-end sale', () => {
    // At 0% and no appreciation, a year-end sale would leave $140k only
    // after paying the $40k installment. Inputs.sellAtAge means year start.
    const s = buildDebtStream([{ kind: 'mortgage', balance: 400_000, annualPayment: 40_000, yearsRemaining: 10 }], 1, 0)
    expect(yearStartSale(500_000, s, 0)).toEqual({ owed: 400_000, proceeds: 100_000, cashNeeded: 0 })
    expect(500_000 - s.closingBalance[0]).toBe(140_000)
    expect(s.payment[0]).toBe(40_000)
  })

  it('retains first-year interest and caps a final small installment', () => {
    // Two $100k years at 10%: P = 100k × .1 / (1 - 1.1^-2).
    const payment = 100_000 * .1 / (1 - 1.1 ** -2)
    const s = buildDebtStream([{ kind: 'mortgage', balance: 100_000, annualPayment: payment, yearsRemaining: 2 }], 3, 0)
    expect(s.interest[0]).toBeCloseTo(10_000, 2)
    expect(s.closingBalance[0]).toBeCloseTo(110_000 - payment, 2)
    expect(s.openingBalance[1]).toBeCloseTo(s.closingBalance[0], 2)
    expect(s.closingBalance[1]).toBeCloseTo(0, 2)
    expect(s.openingBalance[2]).toBe(0)
  })
  it('implied rate reproduces a textbook amortization', () => {
    // $300k over 20 years at exactly 5%: payment = 300000*0.05/(1-1.05^-20)
    const payment = (300000 * 0.05) / (1 - Math.pow(1.05, -20))
    expect(impliedRate(300000, payment, 20)).toBeCloseTo(0.05, 4)
    // zero-interest loan
    expect(impliedRate(100000, 10000, 10)).toBeCloseTo(0, 6)
  })

  it('the stream amortizes to zero exactly at the end of the term', () => {
    const s = buildDebtStream([mortgage], 30, 0.02)
    expect(s.closingBalance[18]).toBeGreaterThan(0)
    expect(s.closingBalance[19]).toBe(0)
    expect(s.payment[19]).toBeGreaterThan(0)
    expect(s.payment[20]).toBe(0)
  })

  it('inflation erodes the real payment year after year', () => {
    const s = buildDebtStream([mortgage], 30, 0.02)
    expect(s.payment[0]).toBeCloseTo(24000 / 1.02, 0)
    expect(s.payment[10]).toBeCloseTo(24000 / Math.pow(1.02, 11), 0)
    expect(s.payment[10]).toBeLessThan(s.payment[0])
  })

  it('interest + principal repayment equals the payment each year', () => {
    const s = buildDebtStream([mortgage], 30, 0.02)
    // nominal-dollar identity survives the shared deflation factor:
    // this year's interest is exactly rate * last year's nominal balance
    expect(s.interest[0]).toBeCloseTo(300000 * impliedRate(300000, 24000, 20) / 1.02, 0)
    expect(s.interest[0]).toBeLessThan(s.payment[0])
    expect(s.interest[19]).toBeGreaterThan(0)
    expect(s.interest[20]).toBe(0)
  })

  it('rollDebtsForward matches the tail of the original stream', () => {
    const rolled = rollDebtsForward([mortgage], 10, 0.02)
    expect(rolled).toHaveLength(1)
    expect(rolled[0].yearsRemaining).toBe(10)
    const original = buildDebtStream([mortgage], 30, 0.02)
    const tail = buildDebtStream(rolled, 20, 0.02)
    // rolled debts stay in the original today's-dollar frame, so year 0 of
    // the tail must equal year 10 of the original with no conversion
    expect(tail.payment[0]).toBeCloseTo(original.payment[10], 0)
    expect(tail.closingBalance[0]).toBeCloseTo(original.closingBalance[10], 0)
    // fully-amortized loans drop out
    expect(rollDebtsForward([mortgage], 20, 0.02)).toHaveLength(0)
  })
})

describe('debts in the projection', () => {
  it('debt payments raise withdrawals until the loan is paid off', () => {
    const withDebt = runProjection({ ...base, debts: [mortgage] })
    const without = runProjection(base)
    const total = (r: ReturnType<typeof runProjection>, age: number) => {
      const row = r.rows.find((x) => x.age === age)!
      return row.withdrawals.tfsa + row.withdrawals.rrsp + row.withdrawals.nonReg
    }
    // age 50: 15 years in, 5 payment years left
    expect(total(withDebt, 50)).toBeGreaterThan(total(without, 50))
    // age 60: mortgage finished at 55, spending back to base
    expect(total(withDebt, 60)).toBeCloseTo(total(without, 60), -2)
    const row50 = withDebt.rows.find((x) => x.age === 50)!
    expect(row50.debtPayment).toBeGreaterThan(0)
    expect(row50.debtBalance).toBeGreaterThan(0)
    const row60 = withDebt.rows.find((x) => x.age === 60)!
    expect(row60.debtPayment).toBe(0)
    expect(row60.debtBalance).toBe(0)
  })

  it('outstanding debt at death reduces net worth and the estate', () => {
    const longLoan: Debt = {
      kind: 'other',
      balance: 500000,
      annualPayment: 500000 / 60,
      yearsRemaining: 60,
    }
    const withDebt = runProjection({ ...base, debts: [longLoan] })
    const without = runProjection(base)
    expect(withDebt.finalNetWorth).toBeLessThan(without.finalNetWorth)
    expect(withDebt.estateValue).toBeLessThan(without.estateValue)
  })

  it('a mortgage outstanding at FIRE raises the FIRE number', () => {
    const withDebt = requiredFireAssets({ ...base, debts: [mortgage] })
    const without = requiredFireAssets(base)
    expect(withDebt).toBeGreaterThan(without)
  })

  it('FIRE-number solver appreciates real estate to the FIRE year like it rolls debts', () => {
    // a property sold at FIRE is worth 10 years of appreciation more than today,
    // so the required portfolio must be smaller than if it never grew
    const appreciating = requiredFireAssets({
      ...base,
      investmentProperties: [
        { value: 500000, acb: 300000, appreciation: 0.03, sellAtAge: base.fireAge },
      ],
    })
    const flat = requiredFireAssets({
      ...base,
      investmentProperties: [
        { value: 500000, acb: 300000, appreciation: 0, sellAtAge: base.fireAge },
      ],
    })
    expect(appreciating).toBeLessThan(flat)
  })

  it('never throws on transient invalid ages (FIRE age above life expectancy)', () => {
    // typing "100" into the FIRE age field passes through here before
    // validation flags it — the engine must stay a total function
    const bad = { ...base, fireAge: 100, debts: [mortgage] }
    expect(() => runProjection(bad)).not.toThrow()
    expect(() => requiredFireAssets(bad)).not.toThrow()
    expect(() => runProjection({ ...base, fireAge: 45.5, debts: [mortgage] })).not.toThrow()
    expect(buildDebtStream([mortgage], -9, 0.02)).toMatchObject({ payment: [], openingBalance: [], closingBalance: [], interest: [] })
    expect(buildDebtStream([mortgage], NaN, 0.02)).toMatchObject({ payment: [], openingBalance: [], closingBalance: [], interest: [] })
  })
})

// long enough to still be outstanding well past the test ages below (35 + 15 = 50)
const propMortgage: Mortgage = { balance: 400000, annualPayment: 26000, yearsRemaining: 30 }

describe('property-linked mortgages', () => {
  it('P01: a year-start sale discharges the opening $400k, without a $40k payment', () => {
    const fixture = propertySales.cases.find((entry) => entry.id === 'P01')!
    const result = runProjection(fixture.inputs as Inputs)
    expectCad(result.finalNetWorth, fixture.expected.finalNetWorth, fixture.toleranceCad)
    expect(result.rows[0].debtPayment).toBe(fixture.expected.debtPaymentAtSale)
  })

  const isolated: Inputs = {
    ...base, currentAge: 50, fireAge: 50, lifeExpectancy: 51,
    annualSavings: 0, retirementSpending: 0,
    returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, fees: 0, inflation: 0,
    balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
    cppAnnualAt65: 0, oasAnnualAt65: 0, nonRegDistributionYield: 0,
  }

  it('uses the second-year opening balance, after only the first installment and 2% inflation', () => {
    const r = runProjection({ ...isolated, inflation: .02,
      balances: { tfsa: 50_000, rrsp: 0, nonReg: 0 },
      principalResidence: { value: 500_000, appreciation: 0, sellAtAge: 51,
        mortgage: { balance: 400_000, annualPayment: 40_000, yearsRemaining: 10 } },
    })
    expect(r.rows[0].debtPayment).toBeCloseTo(40_000 / 1.02, 2)
    expect(r.rows[1].debtPayment).toBe(0)
    expect(r.rows[1].balances.nonReg).toBeCloseTo(500_000 - 360_000 / 1.02, 2)
    expect(r.finalNetWorth).toBeCloseTo(50_000 - 40_000 / 1.02 + 500_000 - 360_000 / 1.02, 2)
  })

  it('uses the full opening principal on a sale in the final installment year', () => {
    const r = runProjection({ ...isolated, lifeExpectancy: 50,
      principalResidence: { value: 120_000, appreciation: 0, sellAtAge: 50,
        mortgage: { balance: 100_000, annualPayment: 100_000, yearsRemaining: 1 } },
    })
    expect(r.rows[0].balances.nonReg).toBeCloseTo(20_000, 2)
    expect(r.rows[0].debtPayment).toBe(0)
  })

  it('nonzero mortgage interest is charged only while the home is held', () => {
    const payment = 100_000 * .1 / (1 - 1.1 ** -2)
    const mortgage = { balance: 100_000, annualPayment: payment, yearsRemaining: 2 }
    const sold = runProjection({ ...isolated, lifeExpectancy: 50,
      principalResidence: { value: 120_000, appreciation: 0, sellAtAge: 50, mortgage } })
    const held = runProjection({ ...isolated, lifeExpectancy: 50,
      balances: { tfsa: payment, rrsp: 0, nonReg: 0 },
      principalResidence: { value: 120_000, appreciation: 0, sellAtAge: null, mortgage } })
    expect(sold.rows[0].balances.nonReg).toBeCloseTo(20_000, 2)
    expect(sold.rows[0].debtPayment).toBe(0)
    expect(held.rows[0].debtPayment).toBeCloseTo(payment, 2)
    expect(held.rows[0].debtBalance).toBeCloseTo(110_000 - payment, 2)
  })

  it('funds negative equity from opening assets or retains an explicit debt gap', () => {
    const home = { value: 300_000, appreciation: 0, sellAtAge: 50,
      mortgage: { balance: 400_000, annualPayment: 40_000, yearsRemaining: 10 } }
    const funded = runProjection({ ...isolated, lifeExpectancy: 50,
      balances: { tfsa: 100_000, rrsp: 0, nonReg: 0 }, principalResidence: home })
    expect(funded.success).toBe(true)
    expect(funded.finalNetWorth).toBeCloseTo(0, 2)
    expect(funded.rows[0].debtBalance).toBe(0)
    const short = runProjection({ ...isolated, lifeExpectancy: 50,
      balances: { tfsa: 30_000, rrsp: 0, nonReg: 0 }, principalResidence: home })
    expect(short.success).toBe(false)
    expect(short.rows[0].debtBalance).toBeCloseTo(70_000, 2)
    expect(short.rows[0].unfundedObligations).toEqual([expect.objectContaining({ reason: 'saleDischarge', amount: 70_000 })])
    expect(short.finalNetWorth).toBeCloseTo(-70_000, 2)
  })

  it('sells one mortgaged property without touching the other loan, rent or payment', () => {
    const r = runProjection({ ...isolated, lifeExpectancy: 50,
      investmentProperties: [
        { value: 400_000, acb: 400_000, appreciation: 0, annualRent: 20_000, sellAtAge: 50,
          mortgage: { balance: 300_000, annualPayment: 30_000, yearsRemaining: 10 } },
        { value: 250_000, acb: 250_000, appreciation: 0, annualRent: 10_000, sellAtAge: null,
          mortgage: { balance: 100_000, annualPayment: 10_000, yearsRemaining: 10 } },
      ],
    })
    const row = r.rows[0]
    expect(row.balances.nonReg).toBeGreaterThanOrEqual(100_000)
    expect(row.rent).toBe(10_000)
    expect(row.debtPayment).toBe(10_000)
    expect(row.debtBalance).toBe(90_000)
  })

  it('a mortgaged rental sold now earns no full-year rent, interest deduction or installment', () => {
    const r = runProjection({ ...isolated, lifeExpectancy: 50,
      investmentProperties: [{ value: 500_000, acb: 500_000, appreciation: .05,
        annualRent: 30_000, sellAtAge: 50,
        mortgage: { balance: 400_000, annualPayment: 50_000, yearsRemaining: 10 } }],
    })
    expect(r.rows[0].rent).toBe(0)
    expect(r.rows[0].debtPayment).toBe(0)
    expect(r.rows[0].propertyValue).toBe(0)
    expect(r.rows[0].balances.nonReg).toBeCloseTo(100_000, 2)
    expect(r.rows[0].taxableBySource.property).toBe(0)
  })

  it('a planned purchase sold the next working year has no later mortgage cost', () => {
    const r = runProjection({ ...isolated, currentAge: 50, fireAge: 53, lifeExpectancy: 52,
      annualSavings: 40_000, inflation: 0,
      balances: { tfsa: 100_000, rrsp: 0, nonReg: 0 },
      principalResidence: { mode: 'planned', buyAtAge: 50, price: 500_000,
        downPayment: 100_000, annualMortgagePayment: 40_000, mortgageYears: 10,
        appreciation: 0, netHoldingCostChange: 0, sellAtAge: 51 },
    })
    expect(r.rows[0].purchaseFunding).not.toBeNull()
    expect(r.rows[0].debtPayment).toBe(40_000)
    expect(r.rows[1].debtPayment).toBe(0)
    expect(r.rows[1].housingFunding).toBeNull()
    expect(r.rows[1].balances.nonReg).toBeCloseTo(148_000, 2) // 500k - 360k, plus 20% of $40k savings
    expect(r.rows[2].debtPayment).toBe(0)
    expect(r.rows[2].housingFunding).toBeNull()
  })

  it('target report and full projection receive the same opening sale proceeds', () => {
    const input: Inputs = { ...isolated, lifeExpectancy: 50,
      principalResidence: { value: 500_000, appreciation: 0, sellAtAge: 50,
        mortgage: { balance: 400_000, annualPayment: 40_000, yearsRemaining: 10 } } }
    const report = targetReport(input, 1_000_000)
    expect(report.status).toBe('supported')
    expect(report.assetsAtFire).toBeCloseTo(100_000, 2)
    expect(runProjection(input).rows[0].balances.nonReg).toBeCloseTo(100_000, 2)
  })

  it('a pre-FIRE rental sale stops future installments and reaches the same target cash', () => {
    const input: Inputs = { ...isolated, fireAge: 52, lifeExpectancy: 52, annualSavings: 40_000,
      investmentProperties: [{ value: 500_000, acb: 500_000, appreciation: 0,
        annualRent: 20_000, sellAtAge: 50,
        mortgage: { balance: 400_000, annualPayment: 40_000, yearsRemaining: 10 } }] }
    const projection = runProjection(input)
    expect(projection.rows.map((row) => row.debtPayment)).toEqual([0, 0, 0])
    expect(projection.rows.map((row) => row.rent)).toEqual([0, 0, 0])
    expect(projection.rows[0].balances.nonReg).toBeCloseTo(108_000, 2) // $100k sale + $8k saved
    const report = targetReport(input, 1_000_000)
    expect(report.status).toBe('supported')
    expect(report.assetsAtFire).toBeCloseTo(projection.rows[1].balances.tfsa +
      projection.rows[1].balances.rrsp + projection.rows[1].balances.nonReg, 2)
  })

  it('a funded negative-equity sale is explicit unsupported in the legacy target shortcut', () => {
    const input: Inputs = { ...isolated, lifeExpectancy: 50,
      balances: { tfsa: 100_000, rrsp: 0, nonReg: 0 },
      principalResidence: { value: 300_000, appreciation: 0, sellAtAge: 50,
        mortgage: { balance: 400_000, annualPayment: 40_000, yearsRemaining: 10 } } }
    expect(runProjection(input).success).toBe(true)
    expect(targetReport(input, 10_000).status).toBe('unsupported')
  })
  it('a mortgaged rental nets less cash at sale than an identical unmortgaged one', () => {
    const mortgaged = runProjection({
      ...base,
      investmentProperties: [
        { value: 600000, acb: 400000, appreciation: 0, sellAtAge: 50, mortgage: propMortgage },
      ],
    })
    const unmortgaged = runProjection({
      ...base,
      investmentProperties: [{ value: 600000, acb: 400000, appreciation: 0, sellAtAge: 50 }],
    })
    expect(mortgaged.finalNetWorth).toBeLessThan(unmortgaged.finalNetWorth)
  })

  it("the mortgage's payment and balance show up while held and vanish once the property sells", () => {
    const r = runProjection({
      ...base,
      investmentProperties: [
        { value: 600000, acb: 400000, appreciation: 0, sellAtAge: 50, mortgage: propMortgage },
      ],
    })
    const at49 = r.rows.find((x) => x.age === 49)!
    const at50 = r.rows.find((x) => x.age === 50)!
    expect(at49.debtPayment).toBeGreaterThan(0)
    expect(at49.debtBalance).toBeGreaterThan(0)
    expect(at50.debtPayment).toBe(0)
    expect(at50.debtBalance).toBe(0)
  })

  it("the mortgage's interest, not principal, is deductible against rent", () => {
    // TFSA covers spending and any debt-payment shortfall tax-free, isolating
    // the interest deduction's effect on tax from the mortgage payment's
    // effect on how much needs to be withdrawn
    const isolated = {
      ...base,
      currentAge: 50,
      fireAge: 50,
      lifeExpectancy: 55,
      cppAnnualAt65: 0,
      oasAnnualAt65: 0,
      retirementSpending: 5000,
      strategy: 'tfsaFirst' as const,
      balances: { tfsa: 2_000_000, rrsp: 0, nonReg: 0 },
      nonRegBook: 0,
    }
    const withMortgage = runProjection({
      ...isolated,
      investmentProperties: [
        {
          value: 600000, acb: 400000, appreciation: 0, sellAtAge: null,
          annualRent: 30000, mortgage: propMortgage,
        },
      ],
    })
    const withoutMortgage = runProjection({
      ...isolated,
      investmentProperties: [
        { value: 600000, acb: 400000, appreciation: 0, sellAtAge: null, annualRent: 30000 },
      ],
    })
    const at50 = (r: typeof withMortgage) => r.rows.find((x) => x.age === 50)!
    expect(at50(withMortgage).tax).toBeLessThan(at50(withoutMortgage).tax)
    expect(at50(withoutMortgage).tax).toBeGreaterThan(0)
  })

  it('a principal-residence mortgage is discharged from the (still tax-free) sale proceeds', () => {
    const mortgaged = runProjection({
      ...base,
      principalResidence: {
        value: 700000, appreciation: 0, sellAtAge: 50, mortgage: propMortgage,
      },
    })
    const unmortgaged = runProjection({
      ...base,
      principalResidence: { value: 700000, appreciation: 0, sellAtAge: 50 },
    })
    // the discharged mortgage balance is a real, substantial hit to net worth
    // (not just the ongoing payments, which both scenarios' spending already covers)
    expect(unmortgaged.finalNetWorth - mortgaged.finalNetWorth).toBeGreaterThan(50000)
  })

  it('requiredFireAssets and targetReport roll a property mortgage forward consistently', () => {
    const withMortgage = requiredFireAssets({
      ...base,
      investmentProperties: [
        { value: 600000, acb: 400000, appreciation: 0, sellAtAge: base.fireAge, mortgage: propMortgage },
      ],
    })
    const withoutMortgage = requiredFireAssets({
      ...base,
      investmentProperties: [
        { value: 600000, acb: 400000, appreciation: 0, sellAtAge: base.fireAge },
      ],
    })
    expect(withMortgage).toBeGreaterThan(withoutMortgage)

    const report = targetReport(
      {
        ...base,
        investmentProperties: [
          { value: 600000, acb: 400000, appreciation: 0, sellAtAge: base.fireAge, mortgage: propMortgage },
        ],
      },
      99_999_999,
    )
    const reportWithout = targetReport(
      {
        ...base,
        investmentProperties: [
          { value: 600000, acb: 400000, appreciation: 0, sellAtAge: base.fireAge },
        ],
      },
      99_999_999,
    )
    expect(report.assetsAtFire).toBeLessThan(reportWithout.assetsAtFire)
  })
})
