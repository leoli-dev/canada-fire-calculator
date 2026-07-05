import { describe, expect, it } from 'vitest'
import { buildDebtStream, impliedRate, rollDebtsForward } from '../debts'
import { runProjection } from '../projection'
import { requiredFireAssets, targetReport } from '../solvers'
import type { Debt, Inputs, Mortgage } from '../types'

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
  it('implied rate reproduces a textbook amortization', () => {
    // $300k over 20 years at exactly 5%: payment = 300000*0.05/(1-1.05^-20)
    const payment = (300000 * 0.05) / (1 - Math.pow(1.05, -20))
    expect(impliedRate(300000, payment, 20)).toBeCloseTo(0.05, 4)
    // zero-interest loan
    expect(impliedRate(100000, 10000, 10)).toBeCloseTo(0, 6)
  })

  it('the stream amortizes to zero exactly at the end of the term', () => {
    const s = buildDebtStream([mortgage], 30, 0.02)
    expect(s.balances[18]).toBeGreaterThan(0)
    expect(s.balances[19]).toBe(0)
    expect(s.payments[19]).toBeGreaterThan(0)
    expect(s.payments[20]).toBe(0)
  })

  it('inflation erodes the real payment year after year', () => {
    const s = buildDebtStream([mortgage], 30, 0.02)
    expect(s.payments[0]).toBeCloseTo(24000 / 1.02, 0)
    expect(s.payments[10]).toBeCloseTo(24000 / Math.pow(1.02, 11), 0)
    expect(s.payments[10]).toBeLessThan(s.payments[0])
  })

  it('interest + principal repayment equals the payment each year', () => {
    const s = buildDebtStream([mortgage], 30, 0.02)
    // nominal-dollar identity survives the shared deflation factor:
    // this year's interest is exactly rate * last year's nominal balance
    expect(s.interest[0]).toBeCloseTo(300000 * impliedRate(300000, 24000, 20) / 1.02, 0)
    expect(s.interest[0]).toBeLessThan(s.payments[0])
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
    expect(tail.payments[0]).toBeCloseTo(original.payments[10], 0)
    expect(tail.balances[0]).toBeCloseTo(original.balances[10], 0)
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
    expect(buildDebtStream([mortgage], -9, 0.02)).toEqual({ payments: [], balances: [], interest: [] })
    expect(buildDebtStream([mortgage], NaN, 0.02)).toEqual({ payments: [], balances: [], interest: [] })
  })
})

// long enough to still be outstanding well past the test ages below (35 + 15 = 50)
const propMortgage: Mortgage = { balance: 400000, annualPayment: 26000, yearsRemaining: 30 }

describe('property-linked mortgages', () => {
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
