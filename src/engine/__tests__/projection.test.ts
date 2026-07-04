import { describe, expect, it } from 'vitest'
import { runProjection } from '../projection'
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

describe('runProjection', () => {
  it('produces one row per year of life', () => {
    const r = runProjection(base)
    expect(r.rows).toHaveLength(90 - 35 + 1)
    expect(r.rows[0].age).toBe(35)
    expect(r.rows.at(-1)!.age).toBe(90)
  })

  it('labels the three phases correctly', () => {
    const r = runProjection(base)
    expect(r.rows.find((x) => x.age === 44)!.phase).toBe('accumulation')
    expect(r.rows.find((x) => x.age === 55)!.phase).toBe('bridge')
    expect(r.rows.find((x) => x.age === 70)!.phase).toBe('pension')
  })

  it('succeeds with ample assets', () => {
    const r = runProjection(base)
    expect(r.success).toBe(true)
    expect(r.depletedAge).toBeNull()
  })

  it('detects depletion with tiny assets and huge spending', () => {
    const r = runProjection({
      ...base,
      balances: { tfsa: 10000, rrsp: 20000, nonReg: 0 },
      nonRegBook: 0,
      annualSavings: 0,
      retirementSpending: 80000,
    })
    expect(r.success).toBe(false)
    expect(r.depletedAge).not.toBeNull()
    expect(r.depletedAge!).toBeLessThan(90)
  })

  it('fees reduce growth: final net worth drops when an MER is charged', () => {
    const noFees = runProjection(base)
    const withFees = runProjection({ ...base, fees: 0.02 })
    expect(withFees.finalNetWorth).toBeLessThan(noFees.finalNetWorth)
  })

  it('never lets balances go negative', () => {
    const r = runProjection({ ...base, retirementSpending: 200000 })
    for (const row of r.rows) {
      expect(row.balances.tfsa).toBeGreaterThanOrEqual(-1e-6)
      expect(row.balances.rrsp).toBeGreaterThanOrEqual(-1e-6)
      expect(row.balances.nonReg).toBeGreaterThanOrEqual(-1e-6)
    }
  })

  it('meets the spending target after tax in funded years', () => {
    const r = runProjection(base)
    for (const row of r.rows) {
      if (row.phase === 'accumulation') continue
      expect(row.netCash).toBeGreaterThanOrEqual(base.retirementSpending - 1)
    }
  })

  it('withdrawal order changes the outcome (meltdown vs TFSA-first)', () => {
    const meltdown = runProjection(base)
    const tfsaFirst = runProjection({
      ...base,
      strategy: 'tfsaFirst' as const,
    })
    expect(meltdown.finalNetWorth).not.toBeCloseTo(tfsaFirst.finalNetWorth, 0)
  })

  it('forces RRIF minimums: RRSP is drawn after 72 even with TFSA-first order', () => {
    const r = runProjection({
      ...base,
      strategy: 'tfsaFirst' as const,
      balances: { tfsa: 2000000, rrsp: 500000, nonReg: 500000 },
      nonRegBook: 400000,
    })
    const row75 = r.rows.find((x) => x.age === 75)!
    expect(row75.withdrawals.rrsp).toBeGreaterThan(0)
  })

  it('couple mode pays less tax than single for the same household withdrawals', () => {
    const single = runProjection(base)
    const couple = runProjection({
      ...base,
      partner: {
        currentAge: 35,
        cppStartAge: 65,
        cppAnnualAt65: 0,
        oasStartAge: 71,
        oasAnnualAt65: 0,
      },
    })
    // identical benefits, but taxable income splits across two bracket sets
    expect(couple.finalNetWorth).toBeGreaterThan(single.finalNetWorth)
  })

  it("partner benefits start on the partner's own timeline", () => {
    const r = runProjection({
      ...base,
      cppAnnualAt65: 10000,
      partner: {
        currentAge: 30, // 5 years younger; their CPP at 65 = primary age 70
        cppStartAge: 65,
        cppAnnualAt65: 6000,
        oasStartAge: 65,
        oasAnnualAt65: 8700,
      },
    })
    const at69 = r.rows.find((x) => x.age === 69)!
    const at70 = r.rows.find((x) => x.age === 70)!
    expect(at69.cpp).toBeCloseTo(10000)
    expect(at70.cpp).toBeCloseTo(16000)
  })

  it('tax drag: distributions are taxed yearly and lower the final net worth', () => {
    const noDrag = runProjection(base)
    const dragged = runProjection({ ...base, nonRegDistributionYield: 0.03 })
    expect(dragged.finalNetWorth).toBeLessThan(noDrag.finalNetWorth)
    // even a TFSA-first bridge year shows tax once distributions exist
    const bridge = runProjection({
      ...base,
      strategy: 'tfsaFirst' as const,
      balances: { tfsa: 1500000, rrsp: 0, nonReg: 1500000 },
      nonRegBook: 1500000,
      nonRegDistributionYield: 0.03,
    })
    const bridgeRow = bridge.rows.find((x) => x.phase === 'bridge')!
    expect(bridgeRow.tax).toBeGreaterThan(0)
  })

  it('tax drag raises the ACB: reinvested distributions are not taxed twice', () => {
    // all-interest portfolio never sold until death: with the yield fully
    // distributed and reinvested, book value tracks the balance and the
    // estate has no unrealized gain left to tax
    const r = runProjection({
      ...base,
      strategy: 'tfsaFirst' as const,
      savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 },
      returns: { tfsa: 0.05, rrsp: 0.05, nonReg: 0.03 },
      balances: { tfsa: 3000000, rrsp: 0, nonReg: 500000 },
      nonRegBook: 500000,
      nonRegDistributionYield: 0.03,
      cppAnnualAt65: 0,
      oasAnnualAt65: 0,
    })
    expect(r.estateTax).toBeCloseTo(0, -2)
  })

  it('GIS: a TFSA-funded retiree receives it from 65; RRSP income claws it back', () => {
    const tfsaLiving = runProjection({
      ...base,
      strategy: 'tfsaFirst' as const,
      savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 },
      balances: { tfsa: 3000000, rrsp: 0, nonReg: 0 },
      nonRegBook: 0,
      cppAnnualAt65: 0,
      oasAnnualAt65: 9024,
    })
    const at64 = tfsaLiving.rows.find((r) => r.age === 64)!
    const at70 = tfsaLiving.rows.find((r) => r.age === 70)!
    expect(at64.gis).toBe(0) // GIS requires OAS
    expect(at70.gis).toBeCloseTo(13478, -1) // zero taxable income -> full single GIS

    const rrspLiving = runProjection({
      ...base,
      strategy: 'rrspFirst' as const,
      balances: { tfsa: 0, rrsp: 3000000, nonReg: 0 },
      nonRegBook: 0,
      savingsSplit: { tfsa: 0, rrsp: 1, nonReg: 0 },
      oasAnnualAt65: 9024,
    })
    const rrsp70 = rrspLiving.rows.find((r) => r.age === 70)!
    expect(rrsp70.gis).toBe(0) // ~$60k taxable income is far past the cutoff
  })

  it('TFSA-only withdrawals pay no tax in the bridge with no other income', () => {
    const r = runProjection({
      ...base,
      strategy: 'tfsaFirst' as const,
      balances: { tfsa: 3000000, rrsp: 0, nonReg: 0 },
      nonRegBook: 0,
    })
    const bridgeRow = r.rows.find((x) => x.phase === 'bridge')!
    expect(bridgeRow.tax).toBe(0)
    expect(bridgeRow.withdrawals.tfsa).toBeCloseTo(base.retirementSpending, 0)
  })
})
