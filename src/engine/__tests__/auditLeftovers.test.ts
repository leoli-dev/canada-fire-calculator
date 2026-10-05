import { describe, expect, it } from 'vitest'
import { DEFAULT_INPUTS } from '../../store'
import { runProjection, targetReport } from '..'
import { runMonteCarlo } from '../monteCarlo'
import type { Inputs } from '../types'

const base: Inputs = { ...DEFAULT_INPUTS }
const row = (result: ReturnType<typeof runProjection>, age: number) => result.rows.find(item => item.age === age)!

describe('September audit leftovers (review §5)', () => {
  it('P05: a 72-year-old holder with a 62-year-old spouse withdraws the elected-age minimum', () => {
    const p05 = runProjection({ ...base, currentAge: 72, fireAge: 72, lifeExpectancy: 75, annualSavings: 0, retirementSpending: 0,
      balances: { tfsa: 0, rrsp: 1_000_000, nonReg: 0 }, nonRegBook: 0, strategy: 'tfsaFirst', cppAnnualAt65: 0, oasAnnualAt65: 0,
      partner: { currentAge: 62, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 } })
    // The spouse is 61 on January 1: 1 / (90 - 61) of the opening balance.
    expect(row(p05, 72).withdrawals.rrsp).toBeCloseTo(1_000_000 / 29, 0)
  })

  it('P05: nothing is forced before the holder reaches 72', () => {
    const young = runProjection({ ...base, currentAge: 70, fireAge: 70, lifeExpectancy: 71, annualSavings: 0, retirementSpending: 0,
      balances: { tfsa: 0, rrsp: 1_000_000, nonReg: 0 }, nonRegBook: 0, strategy: 'tfsaFirst', cppAnnualAt65: 0, oasAnnualAt65: 0,
      partner: { currentAge: 62, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 } })
    expect(row(young, 70).withdrawals.rrsp).toBe(0)
  })

  it('P08: the target report holds what the projection holds entering FIRE with a locked DC plan', () => {
    const p08: Inputs = { ...base, currentAge: 40, fireAge: 42, annualSavings: 10_000, savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 },
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0, returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, fees: 0,
      nonRegDistributionYield: 0, cppAnnualAt65: 0, oasAnnualAt65: 0,
      lockedRetirement: { balance: 100_000, employeeContribution: 3_000, employerContribution: 2_000, accessibleAge: 41, jurisdiction: 'ON', owner: 'self' } }
    const entering = row(runProjection(p08), 41)
    const projected = entering.balances.tfsa + entering.balances.rrsp + entering.balances.nonReg + entering.lockedRetirementBalance
    // Hand count: 100,000 locked + two years of 10,000 budget (3,000 of it the
    // employee contribution) + 2,000 employer each year = 124,000.
    expect(projected).toBeCloseTo(124_000, 6)
    expect(targetReport(p08, 1e9).assetsAtFire).toBeCloseTo(projected, 6)
  })

  it('P11: with no volatility the Monte Carlo median is the deterministic net worth, FHSA and locked included', () => {
    const side: Inputs = { ...base, currentAge: 40, fireAge: 41, lifeExpectancy: 45, annualSavings: 0, retirementSpending: 0,
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0, volatilities: { tfsa: 0, rrsp: 0, nonReg: 0 },
      fhsa: { balance: 40_000, annualContribution: 0, openedYearsAgo: 1 },
      lockedRetirement: { balance: 100_000, employeeContribution: 0, employerContribution: 0, accessibleAge: 60, jurisdiction: 'ON', owner: 'self' } }
    const deterministic = runProjection(side).finalNetWorth
    expect(deterministic).toBeGreaterThan(100_000)
    const mc = runMonteCarlo(side, 20, () => 0.5)
    expect(mc.bands.at(-1)!.p50).toBeCloseTo(deterministic, 0)
  })
})
