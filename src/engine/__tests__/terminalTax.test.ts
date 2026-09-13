import { describe, expect, it } from 'vitest'
import { runProjection } from '../projection'
import { compareStrategies } from '../solvers'
import { terminalTax } from '../terminalTax'
import type { Inputs } from '../types'

// P07, 2026 ON tables: tax at $50k is $7,165.7755; tax at $150k is
// $41,625.64176. Difference = $34,459.86626. The $100k is the *closing*
// RRSP balance; it has not been taxed as an annual withdrawal.
const p07: Inputs = {
  currentAge: 50, fireAge: 50, lifeExpectancy: 50, province: 'ON',
  annualSavings: 0, savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 },
  retirementSpending: 42_834.2245,
  returns: { tfsa: 0, rrsp: 0, nonReg: 0 },
  balances: { tfsa: 0, rrsp: 100_000, nonReg: 0 }, nonRegBook: 0,
  cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0,
  strategy: 'tfsaFirst', inflation: 0, fees: 0, nonRegDistributionYield: 0,
  extraIncome: { annual: 50_000, fromAge: 50, toAge: 50 },
}

describe('terminal-year tax', () => {
  it('P07 adds the remaining RRSP to already taxed ordinary income', () => {
    const result = runProjection(p07)
    expect(result.rows[0].tax).toBeCloseTo(7_165.7755, 4)
    expect(result.rows[0].balances.rrsp).toBeCloseTo(100_000, 2)
    expect(result.estateTax).toBeCloseTo(34_459.86626, 2)
    expect(result.rrspTax).toBeCloseTo(result.estateTax, 2)
    expect(result.rows[0].taxBySource.extraIncome).toBeCloseTo(result.rows[0].tax, 2)
    expect(result.rows[0].taxBySource.rrsp).toBe(0)
    expect(result.estateValue).toBeCloseTo(100_000 - 34_459.86626, 2)
    expect(compareStrategies(p07).find((entry) => entry.strategy === 'tfsaFirst')!.totalTax)
      .toBeCloseTo(41_625.64176, 2)
  })

  it('retains the no-other-income control and taxes only the closing RRSP', () => {
    const control = terminalTax({
      province: 'ON', people: [{ taxableIncome: 0, credits: { age: 50 } }],
      remainingRegistered: 100_000, nonRegisteredGain: 0, investmentPropertyGain: 0,
    })
    // 2026 ON: tax on $100k with one BPA, including ON surtax/health premium.
    expect(control.incrementalTax).toBeCloseTo(21_520.5544, 2)
    expect(control.registeredTaxShare).toBeCloseTo(control.incrementalTax, 2)

    const withdrawn = runProjection({
      ...p07, extraIncome: undefined, strategy: 'rrspFirst',
      retirementSpending: 200_000,
    })
    expect(withdrawn.rows[0].withdrawals.rrsp).toBeCloseTo(100_000, 2)
    expect(withdrawn.rows[0].balances.rrsp).toBe(0)
    expect(withdrawn.rows[0].tax).toBeGreaterThan(0)
    expect(withdrawn.estateTax).toBe(0)
    expect(withdrawn.rrspTax).toBeCloseTo(withdrawn.rows[0].tax, 2)
  })

  it('adds only net positive unrealized gains, including investment property', () => {
    const context = { province: 'ON' as const,
      people: [{ taxableIncome: 50_000, credits: { age: 50 } }],
      remainingRegistered: 0 }
    const nonReg = terminalTax({ ...context, nonRegisteredGain: 100_000, investmentPropertyGain: 0 })
    const property = terminalTax({ ...context, nonRegisteredGain: 0, investmentPropertyGain: 100_000 })
    const offset = terminalTax({ ...context, nonRegisteredGain: -40_000, investmentPropertyGain: 100_000 })
    const lossOnly = terminalTax({ ...context, nonRegisteredGain: -40_000, investmentPropertyGain: 0 })
    expect(nonReg.taxableDisposition).toBe(50_000)
    expect(property.incrementalTax).toBeCloseTo(nonReg.incrementalTax, 6)
    expect(offset.taxableDisposition).toBe(30_000)
    expect(offset.incrementalTax).toBeGreaterThan(0)
    expect(offset.incrementalTax).toBeLessThan(property.incrementalTax)
    expect(lossOnly.incrementalTax).toBe(0)
    expect(nonReg.registeredTaxShare).toBe(0)
  })

  it('passes closing non-registered, investment-property and locked balances into the estimate', () => {
    const nonReg = runProjection({
      ...p07, balances: { tfsa: 0, rrsp: 0, nonReg: 100_000 }, nonRegBook: 0,
    })
    const property = runProjection({
      ...p07, balances: { tfsa: 0, rrsp: 0, nonReg: 0 },
      investmentProperties: [{ value: 100_000, acb: 0, appreciation: 0,
        sellAtAge: null, annualRent: 0 }],
    })
    const locked = runProjection({
      ...p07, balances: { tfsa: 0, rrsp: 0, nonReg: 0 },
      lockedRetirement: { balance: 100_000, employeeContribution: 0,
        employerContribution: 0, accessibleAge: 60, jurisdiction: 'ON', owner: 'self' },
    })
    expect(nonReg.terminalCapitalGainsIncome).toBe(50_000)
    expect(property.terminalCapitalGainsIncome).toBe(50_000)
    expect(nonReg.estateTax).toBeCloseTo(property.estateTax, 2)
    expect(locked.terminalRegisteredIncome).toBe(100_000)
    expect(locked.estateTax).toBeCloseTo(34_459.86626, 2)
  })

  it('uses each current person’s age and pension context in the shared-endpoint approximation', () => {
    const common = { province: 'ON' as const, remainingRegistered: 100_000,
      nonRegisteredGain: 0, investmentPropertyGain: 0 }
    const couple = terminalTax({ ...common, people: [
      { taxableIncome: 50_000, credits: { age: 50, pensionIncome: 0 } },
      { taxableIncome: 0, credits: { age: 70, pensionIncome: 2_000 } },
    ] })
    const equalIncome = terminalTax({ ...common, people: [
      { taxableIncome: 25_000, credits: { age: 50 } },
      { taxableIncome: 25_000, credits: { age: 50 } },
    ] })
    expect(couple.incrementalTax).toBeGreaterThan(0)
    expect(couple.incrementalTax).not.toBeCloseTo(equalIncome.incrementalTax, 2)
  })

  it('leaves probate separate and deducts debt and terminal tax once', () => {
    const result = runProjection({
      ...p07, balances: { tfsa: 0, rrsp: 100_000, nonReg: 100_000 },
      nonRegBook: 100_000,
      principalResidence: { value: 200_000, appreciation: 0, sellAtAge: null,
        mortgage: { balance: 40_000, annualPayment: 0, yearsRemaining: 10 } },
    })
    const last = result.rows.at(-1)!
    const assets = last.balances.tfsa + last.balances.rrsp + last.balances.nonReg + last.propertyValue
    expect(result.finalNetWorth).toBeCloseTo(assets - last.debtBalance, 2)
    expect(result.estateValue).toBeCloseTo(assets - last.debtBalance - result.estateTax - result.probateFee, 2)
    expect(result.probateFee).toBeGreaterThan(0)
  })

  it('does not turn a zero or negative net estate into a tax credit', () => {
    const zero = runProjection({
      ...p07, extraIncome: undefined, retirementSpending: 0,
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 },
    })
    expect(zero.finalNetWorth).toBe(0)
    expect(zero.estateTax).toBe(0)
    expect(zero.probateFee).toBe(0)
    expect(zero.estateValue).toBe(0)

    const indebted = runProjection({
      ...p07, extraIncome: undefined, retirementSpending: 0,
      balances: { tfsa: 0, rrsp: 20_000, nonReg: 0 },
      debts: [{ kind: 'other', balance: 50_000, annualPayment: 0, yearsRemaining: 10 }],
    })
    expect(indebted.finalNetWorth).toBeLessThan(0)
    expect(indebted.estateTax).toBeGreaterThanOrEqual(0)
    expect(indebted.estateValue).toBeCloseTo(indebted.finalNetWorth - indebted.estateTax, 2)
  })

  it('strategy totals include the incremental terminal bill once', () => {
    const comparison = compareStrategies({
      ...p07, extraIncome: undefined, retirementSpending: 20_000,
      balances: { tfsa: 100_000, rrsp: 100_000, nonReg: 0 },
    })
    const first = comparison.find((entry) => entry.strategy === 'rrspFirst')!
    const tfsa = comparison.find((entry) => entry.strategy === 'tfsaFirst')!
    for (const entry of comparison) {
      const annualTax = entry.result.rows.reduce((sum, row) => sum + row.tax, 0)
      expect(entry.totalTax).toBeCloseTo(annualTax + entry.result.estateTax, 2)
      expect(entry.result.rrspTax).toBeLessThanOrEqual(entry.totalTax + 0.01)
    }
    expect(first.result.rows[0].withdrawals.rrsp).toBeGreaterThan(0)
    expect(tfsa.result.rows[0].withdrawals.rrsp).toBe(0)
    expect(first.result.estateTax).toBeLessThan(tfsa.result.estateTax)
  })
})
