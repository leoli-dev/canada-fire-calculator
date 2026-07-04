import { describe, expect, it } from 'vitest'
import {
  compareStrategies,
  findEarliestFireAge,
  maxSustainableSpending,
  requiredFireAssets,
  scanBenefitTiming,
  targetReport,
} from '../solvers'
import { runMonteCarlo } from '../monteCarlo'
import { runProjection } from '../projection'
import { blendedReturn, blendedVolatility } from '../assets'
import type { Inputs } from '../types'

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

describe('findEarliestFireAge', () => {
  it('finds an age no later than a known-successful fireAge', () => {
    const earliest = findEarliestFireAge(base)
    expect(earliest).not.toBeNull()
    expect(earliest!).toBeLessThanOrEqual(45)
    expect(runProjection({ ...base, fireAge: earliest! }).success).toBe(true)
  })

  it('returns null when retirement is impossible', () => {
    expect(
      findEarliestFireAge({
        ...base,
        annualSavings: 0,
        balances: { tfsa: 1000, rrsp: 0, nonReg: 0 },
        nonRegBook: 0,
        retirementSpending: 100000,
        cppAnnualAt65: 0,
        oasAnnualAt65: 0,
      }),
    ).toBeNull()
  })
})

describe('requiredFireAssets', () => {
  it('returns a number that succeeds and whose 90% fails', () => {
    const T = requiredFireAssets(base)
    expect(T).toBeGreaterThan(0)
    const total = base.balances.tfsa + base.balances.rrsp + base.balances.nonReg
    const scale = (k: number) => ({
      ...base,
      currentAge: base.fireAge,
      annualSavings: 0,
      balances: {
        tfsa: (k * base.balances.tfsa) / total,
        rrsp: (k * base.balances.rrsp) / total,
        nonReg: (k * base.balances.nonReg) / total,
      },
      nonRegBook: ((k * base.balances.nonReg) / total) * (base.nonRegBook / base.balances.nonReg),
    })
    expect(runProjection(scale(T * 1.01)).success).toBe(true)
    expect(runProjection(scale(T * 0.9)).success).toBe(false)
  })
})

describe('compareStrategies / scanBenefitTiming', () => {
  it('returns all four strategies with results', () => {
    const rs = compareStrategies(base)
    expect(rs).toHaveLength(4)
    for (const r of rs) expect(r.result.rows.length).toBeGreaterThan(0)
  })

  it('bracket-capped meltdown keeps yearly taxable RRSP income within the lowest bracket', () => {
    const rs = compareStrategies(base)
    const paced = rs.find((r) => r.strategy === 'meltdownPaced')!
    const aggressive = rs.find((r) => r.strategy === 'rrspFirst')!
    // ON lowest bracket top is $52,886; RRSP draw + CPP + OAS never exceeds it
    for (const row of paced.result.rows) {
      if (row.phase === 'accumulation') continue
      expect(row.withdrawals.rrsp + row.cpp + row.oas).toBeLessThanOrEqual(52886 + 1)
    }
    expect(paced.result.estateValue).toBeGreaterThan(aggressive.result.estateValue)
  })

  it('does not force the RRSP empty by 71: the remainder exits via RRIF minimums', () => {
    const rich = {
      ...base,
      strategy: 'meltdownPaced' as const,
      balances: { tfsa: 100000, rrsp: 1500000, nonReg: 300000 },
      nonRegBook: 250000,
    }
    const r = runProjection(rich)
    const at71 = r.rows.find((x) => x.age === 71)!
    const at75 = r.rows.find((x) => x.age === 75)!
    expect(at71.balances.rrsp).toBeGreaterThan(0)
    expect(at75.withdrawals.rrsp).toBeGreaterThan(0)
  })

  it('attributes RRSP tax sensibly across strategies', () => {
    const rs = compareStrategies(base)
    for (const r of rs) {
      expect(r.result.rrspTax).toBeGreaterThan(0)
      expect(r.result.rrspTax).toBeLessThanOrEqual(r.totalTax + 1)
    }
    // capped meltdown pays less tax on RRSP dollars than the aggressive dump
    const paced = rs.find((r) => r.strategy === 'meltdownPaced')!
    const aggressive = rs.find((r) => r.strategy === 'rrspFirst')!
    expect(paced.result.rrspTax).toBeLessThan(aggressive.result.rrspTax)
  })

  it('estate value penalizes strategies that park a large RRSP to the end', () => {
    const rs = compareStrategies(base)
    const tfsaFirst = rs.find((r) => r.strategy === 'tfsaFirst')!
    const paced = rs.find((r) => r.strategy === 'meltdownPaced')!
    // tfsaFirst leaves the RRSP mostly untouched → big deemed-disposition tax
    expect(tfsaFirst.result.estateTax).toBeGreaterThan(paced.result.estateTax)
    expect(tfsaFirst.result.estateValue).toBeLessThan(tfsaFirst.result.finalNetWorth)
  })

  it('best timing is at least as good as the current timing', () => {
    const { best, current } = scanBenefitTiming(base)
    if (current.result.success) {
      expect(best.result.estateValue).toBeGreaterThanOrEqual(current.result.estateValue)
    } else {
      expect(best.result.success || (best.result.depletedAge ?? 0) >= (current.result.depletedAge ?? 0)).toBe(true)
    }
  })
})

describe('maxSustainableSpending (die with zero)', () => {
  it('returns a spending level that succeeds while 5% more fails', () => {
    const s = maxSustainableSpending(base)
    expect(s).toBeGreaterThan(base.retirementSpending)
    expect(runProjection({ ...base, retirementSpending: s * 0.99 }).success).toBe(true)
    expect(runProjection({ ...base, retirementSpending: s * 1.05 }).success).toBe(false)
  })

  it('ends near zero: spending at the maximum leaves little estate', () => {
    const s = maxSustainableSpending(base)
    const capped = runProjection({ ...base, retirementSpending: s * 0.999 })
    const asPlanned = runProjection(base)
    expect(capped.finalNetWorth).toBeLessThan(asPlanned.finalNetWorth / 4)
  })

  it('tax-efficient paced meltdown sustains at least as much spending as TFSA-first', () => {
    const paced = maxSustainableSpending({ ...base, strategy: 'meltdownPaced' })
    const tfsaFirst = maxSustainableSpending({ ...base, strategy: 'tfsaFirst' })
    expect(paced).toBeGreaterThanOrEqual(tfsaFirst)
  })
})

describe('targetReport', () => {
  it('reports assets at FIRE and an early reach age when the target is low', () => {
    const g = targetReport(base, 500000)
    expect(g.assetsAtFire).toBeGreaterThan(500000)
    expect(g.reachedAge).not.toBeNull()
    expect(g.reachedAge!).toBeLessThan(base.fireAge)
  })

  it('reports a late reach age when the target exceeds assets at FIRE', () => {
    const g = targetReport(base, 2000000)
    expect(g.assetsAtFire).toBeLessThan(2000000)
    expect(g.reachedAge).toBeGreaterThan(base.fireAge)
  })

  it('returns null when the target is unreachable', () => {
    const g = targetReport(
      { ...base, annualSavings: 0, returns: { tfsa: 0, rrsp: 0, nonReg: 0 } },
      10_000_000,
    )
    expect(g.reachedAge).toBeNull()
  })

  it('counts a planned principal-residence sale, consistently with the chart', () => {
    const target = 1_500_000
    const withSale = targetReport(
      {
        ...base,
        principalResidence: { value: 900000, appreciation: 0.02, sellAtAge: base.fireAge },
      },
      target,
    )
    const withoutSale = targetReport(
      {
        ...base,
        principalResidence: { value: 900000, appreciation: 0.02, sellAtAge: null },
      },
      target,
    )
    expect(withSale.assetsAtFire).toBeGreaterThan(withoutSale.assetsAtFire + 800000)
    expect(withSale.reachedAge).not.toBeNull()
    expect(withSale.reachedAge!).toBeLessThanOrEqual(base.fireAge)
    // unsold real estate never counts toward the investable target
    expect(withoutSale.assetsAtFire).toBeLessThan(target)
  })

  it('taxes the investment-property gain on sale in target mode', () => {
    const ipSale = targetReport(
      {
        ...base,
        investmentProperty: { value: 900000, acb: 300000, appreciation: 0, sellAtAge: base.fireAge },
      },
      99_999_999,
    )
    const prSale = targetReport(
      {
        ...base,
        principalResidence: { value: 900000, appreciation: 0, sellAtAge: base.fireAge },
      },
      99_999_999,
    )
    expect(prSale.assetsAtFire).toBeGreaterThan(ipSale.assetsAtFire)
  })
})

describe('property events', () => {
  it('principal residence sale is tax-free and boosts final net worth', () => {
    const withHome = runProjection({
      ...base,
      principalResidence: { value: 800000, appreciation: 0.02, sellAtAge: 65 },
    })
    const without = runProjection(base)
    expect(withHome.finalNetWorth).toBeGreaterThan(without.finalNetWorth + 500000)
    const at64 = withHome.rows.find((r) => r.age === 64)!
    const at65 = withHome.rows.find((r) => r.age === 65)!
    expect(at64.propertyValue).toBeGreaterThan(0)
    expect(at65.propertyValue).toBe(0)
  })

  it('investment property sale is taxed on half the gain', () => {
    const taxedSale = runProjection({
      ...base,
      investmentProperty: { value: 500000, acb: 200000, appreciation: 0, sellAtAge: 50 },
    })
    const freeSale = runProjection({
      ...base,
      principalResidence: { value: 500000, appreciation: 0, sellAtAge: 50 },
    })
    expect(freeSale.finalNetWorth).toBeGreaterThan(taxedSale.finalNetWorth)
  })
})

describe('monte carlo & asset blending', () => {
  it('zero volatility reproduces the deterministic result', () => {
    const mc = runMonteCarlo(
      { ...base, volatilities: { tfsa: 0, rrsp: 0, nonReg: 0 } },
      10,
      () => 0.5,
    )
    const det = runProjection(base)
    expect(mc.successRate).toBe(det.success ? 1 : 0)
    expect(mc.bands.at(-1)!.p50).toBeCloseTo(
      det.rows.at(-1)!.balances.tfsa + det.rows.at(-1)!.balances.rrsp + det.rows.at(-1)!.balances.nonReg,
      0,
    )
  })

  it('percentile bands are ordered', () => {
    const mc = runMonteCarlo(base, 100)
    for (const b of mc.bands) {
      expect(b.p10).toBeLessThanOrEqual(b.p50)
      expect(b.p50).toBeLessThanOrEqual(b.p90)
    }
  })

  it('blended return/volatility interpolate between asset classes', () => {
    const allStocks = { stocks: 1, bonds: 0, gic: 0, cash: 0 }
    const mixed = { stocks: 0.5, bonds: 0.5, gic: 0, cash: 0 }
    expect(blendedReturn(allStocks)).toBeGreaterThan(blendedReturn(mixed))
    expect(blendedVolatility(allStocks)).toBeGreaterThan(blendedVolatility(mixed))
  })
})
