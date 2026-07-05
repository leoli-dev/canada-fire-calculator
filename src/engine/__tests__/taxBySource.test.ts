import { describe, expect, it } from 'vitest'
import { runProjection } from '../projection'
import type { Inputs, Province, Strategy, TaxBySource } from '../types'

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
}

function sumSources(s: TaxBySource): number {
  return s.rrsp + s.nonReg + s.cpp + s.oas + s.property + s.extraIncome
}

const STRATEGIES: Strategy[] = ['meltdownPaced', 'rrspFirst', 'nonRegFirst', 'tfsaFirst']
const PROVINCES: Province[] = ['ON', 'QC']

describe('taxBySource', () => {
  it('sums to the total tax every year, across strategies and provinces, with rent/debt/Barista/properties all active', () => {
    for (const strategy of STRATEGIES) {
      for (const province of PROVINCES) {
        const r = runProjection({
          ...base,
          strategy,
          province,
          nonRegDistributionYield: 0.02,
          extraIncome: { annual: 15000, fromAge: 45, toAge: 60 },
          debts: [{ kind: 'mortgage', balance: 100000, annualPayment: 12000, yearsRemaining: 15 }],
          investmentProperties: [
            { value: 400000, acb: 250000, appreciation: 0.01, sellAtAge: 60, annualRent: 18000 },
          ],
        })
        for (const row of r.rows) {
          expect(sumSources(row.taxBySource)).toBeCloseTo(row.tax, 4)
        }
      }
    }
  })

  it('every field is zero when there is no tax', () => {
    const r = runProjection({
      ...base,
      strategy: 'tfsaFirst' as const,
      balances: { tfsa: 3_000_000, rrsp: 0, nonReg: 0 },
      nonRegBook: 0,
      cppAnnualAt65: 0,
      oasAnnualAt65: 0,
    })
    const bridgeRow = r.rows.find((x) => x.phase === 'bridge')!
    expect(bridgeRow.tax).toBe(0)
    const s = bridgeRow.taxBySource
    expect(s.rrsp).toBe(0)
    expect(s.nonReg).toBe(0)
    expect(s.cpp).toBe(0)
    expect(s.oas).toBe(0)
    expect(s.property).toBe(0)
    expect(s.extraIncome).toBe(0)
  })

  it('Barista income slice is positive only within its age window', () => {
    const r = runProjection({
      ...base,
      extraIncome: { annual: 20000, fromAge: 45, toAge: 55 },
    })
    const within = r.rows.find((x) => x.age === 50)!
    const after = r.rows.find((x) => x.age === 56)!
    expect(within.taxBySource.extraIncome).toBeGreaterThan(0)
    expect(after.taxBySource.extraIncome).toBe(0)
  })

  it('an all-book non-registered balance (no unrealized gain) attributes only the distribution to nonReg', () => {
    const r = runProjection({
      ...base,
      strategy: 'nonRegFirst' as const,
      balances: { tfsa: 0, rrsp: 0, nonReg: 1_000_000 },
      nonRegBook: 1_000_000,
      nonRegDistributionYield: 0.02,
      cppAnnualAt65: 0,
      oasAnnualAt65: 0,
    })
    const row = r.rows.find((x) => x.phase === 'bridge')!
    // no capital gain realized (book == balance), so the nonReg tax slice
    // comes entirely from the yearly distribution, not the withdrawal itself
    expect(row.taxBySource.nonReg).toBeGreaterThan(0)
    expect(sumSources(row.taxBySource)).toBeCloseTo(row.tax, 4)
  })

  it('rent and property-sale gains attribute to the property slice', () => {
    const r = runProjection({
      ...base,
      strategy: 'tfsaFirst' as const,
      balances: { tfsa: 2_000_000, rrsp: 0, nonReg: 0 },
      nonRegBook: 0,
      cppAnnualAt65: 0,
      oasAnnualAt65: 0,
      investmentProperties: [
        { value: 400000, acb: 100000, appreciation: 0, sellAtAge: 60, annualRent: 20000 },
      ],
    })
    const rentingRow = r.rows.find((x) => x.age === 50)!
    expect(rentingRow.taxBySource.property).toBeGreaterThan(0)
    const saleYear = r.rows.find((x) => x.age === 60)!
    expect(saleYear.taxBySource.property).toBeGreaterThan(0)
  })

  it('accumulation-phase pre-FIRE benefits split the benefit tax between cpp and oas', () => {
    const late = {
      ...base,
      currentAge: 60,
      fireAge: 68,
      lifeExpectancy: 80,
      cppStartAge: 65,
      oasStartAge: 66,
    }
    const r = runProjection(late)
    const at66 = r.rows.find((x) => x.age === 66)!
    expect(at66.phase).toBe('accumulation')
    expect(at66.taxBySource.cpp).toBeGreaterThan(0)
    expect(at66.taxBySource.oas).toBeGreaterThan(0)
    expect(sumSources(at66.taxBySource)).toBeCloseTo(at66.tax, 4)
  })
})
