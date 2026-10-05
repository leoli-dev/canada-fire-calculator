import { describe, expect, it } from 'vitest'
import { sideIncomeDeductions } from '../payroll'
import { benefitIncomeBasis } from '../benefits'

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
