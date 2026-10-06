import { describe, expect, it } from 'vitest'
import { sideIncomeDeductions } from '../payroll'
import { benefitIncomeBasis } from '../benefits'
import { DEFAULT_INPUTS } from '../../store'
import { refreshCanonicalFromLegacy } from '../migration'
import { runProjection } from '../projection'
import type { Inputs } from '../types'

describe('BE-46 payroll on side income (2026)', () => {
  it('withholds employee CPP, CPP2 and EI outside Quebec', () => {
    // 80,000: CPP 5.95% × (74,600 − 3,500) = 4,230.45; CPP2 4% × 5,400 = 216;
    // EI 1.63% × 68,900 = 1,123.07.
    const d = sideIncomeDeductions(80_000, 'employment', 'ON')
    expect(d.contributions).toBeCloseTo(4_230.45 + 216 + 1_123.07, 2)
    expect(d.taxDeduction).toBeCloseTo(711 + 216, 2) // 1% of 71,100 + CPP2
    expect(d.creditAmount).toBeCloseTo(3_519.45 + 1_123.07, 2) // 4.95% of 71,100 + EI
    expect(d.employmentAmount).toBe(1_501)
  })

  it('uses QPP, Quebec EI and QPIP in Quebec', () => {
    // 40,000: QPP 6.30% × 36,500 = 2,299.50; EI 1.30% × 40,000 = 520; QPIP 0.430% × 40,000 = 172.
    const d = sideIncomeDeductions(40_000, 'employment', 'QC')
    expect(d.contributions).toBeCloseTo(2_299.5 + 520 + 172, 2)
    expect(d.creditAmount).toBeCloseTo(1_934.5 + 520 + 172, 2) // 5.30% of 36,500
  })

  it('charges both halves to the self-employed, with no EI or employment amount', () => {
    // 30,000: CPP 11.9% × 26,500 = 3,153.50; deduct the employer half 1,576.75
    // plus the enhanced 1% (265); credit the base 4.95% (1,311.75).
    const d = sideIncomeDeductions(30_000, 'selfEmployment', 'BC')
    expect(d.contributions).toBeCloseTo(3_153.5, 2)
    expect(d.taxDeduction).toBeCloseTo(1_576.75 + 265, 2)
    expect(d.creditAmount).toBeCloseTo(1_311.75, 2)
    expect(d.employmentAmount).toBe(0)
  })

  it('leaves other income and zero earnings alone', () => {
    expect(sideIncomeDeductions(50_000, 'other', 'ON').contributions).toBe(0)
    expect(sideIncomeDeductions(0, 'employment', 'ON').contributions).toBe(0)
  })

  it('exempts each earner’s work income separately for GIS (review R7)', () => {
    // Two earners of 10,000 each: 5,000 + half of 5,000 = 7,500 each, 15,000 in all.
    const twoEarners = benefitIncomeBasis([true, true], [67, 66], 20_000, { workIncome: [10_000, 10_000] })
    const pooled = benefitIncomeBasis([true, true], [67, 66], 20_000, { workIncome: 20_000 })
    if (twoEarners.status !== 'modeled' || pooled.status !== 'modeled') throw new Error('unsupported')
    expect(twoEarners.workExemption).toBe(15_000)
    expect(pooled.workExemption).toBe(10_000)
  })
})

describe('BE-46 review fixes', () => {
  it('stops CPP at 70 and QPP in the year the worker turns 73, keeping EI and QPIP', () => {
    const at69 = sideIncomeDeductions(40_000, 'employment', 'ON', 69)
    const at70 = sideIncomeDeductions(40_000, 'employment', 'ON', 70)
    expect(at69.contributions).toBeCloseTo(0.0595 * 36_500 + 0.0163 * 40_000, 2)
    expect(at70.contributions).toBeCloseTo(0.0163 * 40_000, 2) // EI only
    expect(at70.taxDeduction).toBe(0)
    expect(at70.creditAmount).toBeCloseTo(0.0163 * 40_000, 2)
    // QPP continues at 71 and 72 and ends in the year of 73.
    expect(sideIncomeDeductions(40_000, 'employment', 'QC', 72).contributions).toBeCloseTo(2_299.5 + 520 + 172, 2)
    expect(sideIncomeDeductions(40_000, 'employment', 'QC', 73).contributions).toBeCloseTo(520 + 172, 2)
  })

  const retiree: Inputs = { ...DEFAULT_INPUTS, province: 'ON', currentAge: 60, fireAge: 60, lifeExpectancy: 62,
    partner: undefined, pension: undefined, children: [], debts: [], investmentProperties: [], principalResidence: null,
    returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, fees: 0, nonRegDistributionYield: 0, inflation: 0,
    balances: { tfsa: 2_000_000, rrsp: 0, nonReg: 0 }, nonRegBook: 0, strategy: 'tfsaFirst',
    cppStartAge: 70, oasStartAge: 70, retirementSpending: 30_000,
    extraIncome: { annual: 40_000, fromAge: 60, toAge: 65, kind: 'employment' } }

  it('the person ledger deducts and credits the payroll exactly like the household estimate', () => {
    const legacy = runProjection(retiree).rows[0]
    const person = runProjection(retiree, undefined, refreshCanonicalFromLegacy(null, retiree)).rows[0]
    expect(person.taxCapability).toBe('person')
    expect(person.tax).toBeCloseTo(legacy.tax, 6)
    expect(person.netCash).toBeCloseTo(legacy.netCash, 6)
  })

  it('gives no GIS work exemption to side income that is not earnings, in either tax path', () => {
    const pensioner: Inputs = { ...retiree, currentAge: 67, fireAge: 67, lifeExpectancy: 68, oasStartAge: 65,
      extraIncome: { annual: 10_000, fromAge: 67, toAge: 90, kind: 'other' } }
    const legacy = runProjection(pensioner).rows[0]
    const person = runProjection(pensioner, undefined, refreshCanonicalFromLegacy(null, pensioner)).rows[0]
    const earned = runProjection({ ...pensioner, extraIncome: { ...pensioner.extraIncome!, kind: 'employment' } }).rows[0]
    expect(legacy.gis).toBeCloseTo(person.gis, 6)
    expect(earned.gis).toBeGreaterThan(legacy.gis + 4_000)
  })
})
