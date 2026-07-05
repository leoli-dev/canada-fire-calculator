import { describe, expect, it } from 'vitest'
import { buildDebtStream, impliedRate, rollDebtsForward } from '../debts'
import { runProjection } from '../projection'
import { requiredFireAssets } from '../solvers'
import type { Debt, Inputs } from '../types'

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
})
