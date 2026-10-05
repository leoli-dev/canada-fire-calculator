import { describe, expect, it } from 'vitest'
import { DEFAULT_INPUTS } from '../../store'
import { HBP_LIMIT_PER_BUYER, planPurchaseFunding } from '../funding'
import { runProjection } from '../projection'
import type { Inputs, PlannedResidence } from '../types'

const home = (downPayment: number, extra: Partial<PlannedResidence> = {}): PlannedResidence => ({
  mode: 'planned', buyAtAge: 41, price: downPayment, downPayment, appreciation: 0,
  netHoldingCostChange: 0, sellAtAge: null, ...extra,
})
const funds = (rrsp: number, hbpLimit: number) => ({
  balances: { tfsa: 0, rrsp, nonReg: 0 }, fhsaBalance: 0, nonRegBook: 0, marginalRate: 0.35,
  annualSavings: 0, firstYearCost: 0, hbpLimit,
})

describe("BE-47 Home Buyers' Plan", () => {
  it('takes the RRSP part of a down payment tax-free up to the limit', () => {
    expect(HBP_LIMIT_PER_BUYER).toBe(60_000)
    const plan = planPurchaseFunding(home(50_000), 41, funds(100_000, 60_000))
    expect(plan.allocation).toMatchObject({ hbpWithdrawal: 50_000, rrspWithdrawal: 0, withdrawalTax: 0 })
    expect(plan.allocation!.balances.rrsp).toBe(50_000)
  })

  it('taxes only what goes past the limit, grossed up at the marginal rate', () => {
    // 80,000 down: 60,000 under the HBP, then 20,000 net needs 20,000 / 0.65 gross.
    const plan = planPurchaseFunding(home(80_000), 41, funds(200_000, 60_000))
    expect(plan.allocation!.hbpWithdrawal).toBe(60_000)
    expect(plan.allocation!.rrspWithdrawal).toBeCloseTo(20_000 / 0.65, 2)
    expect(plan.allocation!.withdrawalTax).toBeCloseTo(20_000 / 0.65 * 0.35, 2)
  })

  it('repays 1/15 a year into the RRSP from savings, from the second year after the purchase', () => {
    const inputs: Inputs = { ...DEFAULT_INPUTS, currentAge: 40, fireAge: 60, lifeExpectancy: 62,
      annualSavings: 10_000, savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 },
      balances: { tfsa: 0, rrsp: 100_000, nonReg: 0 }, nonRegBook: 0,
      returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, fees: 0, nonRegDistributionYield: 0,
      principalResidence: home(50_000) }
    const rows = runProjection(inputs).rows
    const at = (age: number) => rows.find(row => row.age === age)!
    // Bought at 41: the 10,000 saved at 40 in the TFSA goes first (fixed
    // order), then 40,000 of HBP money from the RRSP, with no tax on it.
    expect(at(41).purchaseFunding?.grossWithdrawals).toEqual({ tfsa: 10_000, nonReg: 0, rrsp: 40_000 })
    expect(at(41).balances.rrsp).toBeCloseTo(60_000, 6)
    expect(at(42).balances.rrsp).toBeCloseTo(60_000, 6)
    // From 43: 40,000 / 15 goes back each year, out of the 10,000 of savings.
    expect(at(43).balances.rrsp).toBeCloseTo(60_000 + 40_000 / 15, 6)
    expect(at(43).balances.tfsa - at(42).balances.tfsa).toBeCloseTo(10_000 - 40_000 / 15, 6)
    // Without the plan the same purchase pays tax on a grossed-up withdrawal.
    const taxed = runProjection({ ...inputs, principalResidence: home(50_000, { hbp: false }) }).rows
    expect(taxed.find(row => row.age === 41)!.balances.rrsp).toBeLessThan(60_000)
  })
})
