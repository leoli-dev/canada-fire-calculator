import { describe, expect, it } from 'vitest'
import { incomeTax } from '../tax'
import {
  CPP_MAX_AT_65,
  OAS_FULL_AT_65,
  cppAnnual,
  earlyClaimDilutionRelief,
  estimateCppAt65,
  estimateOasAt65,
  oasAfterClawback,
  oasAnnual,
} from '../benefits'
import { rrifMinFactor } from '../rrif'

describe('incomeTax', () => {
  it('is zero at or below zero income', () => {
    expect(incomeTax(0, 'ON')).toBe(0)
    expect(incomeTax(-100, 'ON')).toBe(0)
  })

  it('is zero below the basic personal amounts', () => {
    expect(incomeTax(12000, 'ON')).toBe(0)
  })

  it('matches a hand-computed ON value at $60k (2026 table)', () => {
    // fed: 58523*0.14 + 1477*0.205 - 16452*0.14 = 6192.73
    // ON:  53891*0.0505 + 6109*0.0915 - 12989*0.0505 = 2624.52 (below surtax)
    // Ontario Health Premium at $60k taxable = $600
    expect(incomeTax(60000, 'ON')).toBeCloseTo(6192.73 + 2624.52 + 600, 0)
  })

  it('applies the ON surtax on provincial tax at high income', () => {
    // BC has no surtax; the same taxable income must cost ON extra beyond
    // the bracket difference at $250k (ON basic tax far above both tiers)
    const on = incomeTax(250000, 'ON')
    const onNoSurtaxApprox = incomeTax(250000, 'AB')
    expect(on).toBeGreaterThan(onNoSurtaxApprox) // sanity: surtax makes ON heavy
  })

  it('phases the federal BPA down to the floor at very high income', () => {
    // at $300k the enhanced BPA is fully phased out: credit uses $14,829
    // fed: 8193.22 + 11997.01 + 16742.70 + 22342.18 + 41518*0.33 - 14829*0.14
    const fed = 8193.22 + 11997.01 + 16742.7 + 22342.18 + 41518 * 0.33 - 14829 * 0.14
    // AB: 61200*0.08 + 93059*0.10 + 30852*0.12 + 61702*0.13 + 53187*0.14 - 22769*0.08
    const ab = 4896 + 9305.9 + 3702.24 + 8021.26 + 7446.18 - 1821.52
    expect(incomeTax(300000, 'AB')).toBeCloseTo(fed + ab, 0)
  })

  it('is monotonically increasing', () => {
    expect(incomeTax(100000, 'BC')).toBeGreaterThan(incomeTax(50000, 'BC'))
  })

  it('QC total exceeds ON at the same income despite the abatement', () => {
    expect(incomeTax(80000, 'QC')).toBeGreaterThan(incomeTax(80000, 'ON'))
  })

  it('the age amount lowers tax for 65+ at modest income and phases out at high income', () => {
    const under65 = incomeTax(40000, 'ON', { age: 60 })
    const senior = incomeTax(40000, 'ON', { age: 70 })
    // full amounts: federal 9,208*14% + ON 6,342*5.05% = 1,609.39
    expect(under65 - senior).toBeCloseTo(9208 * 0.14 + 6342 * 0.0505, 0)
    // fully phased out well above every zero-point ($107,819 fed / $89,490 ON)
    expect(incomeTax(150000, 'ON', { age: 70 })).toBeCloseTo(incomeTax(150000, 'ON'), 1)
  })

  it('the pension income credit applies to RRIF income at 65+', () => {
    const without = incomeTax(40000, 'ON', { age: 70 })
    const withPension = incomeTax(40000, 'ON', { age: 70, pensionIncome: 5000 })
    // capped at $2,000 federal (14%) and $1,796 ON (5.05%)
    expect(without - withPension).toBeCloseTo(2000 * 0.14 + 1796 * 0.0505, 0)
  })

  it('QC combines age and retirement-income amounts with an 18.75% family test', () => {
    const low = incomeTax(30000, 'QC', { age: 70, pensionIncome: 5000 })
    const base = incomeTax(30000, 'QC', { age: 60 })
    // QC block: (3,986 + 3,541) * 14%; federal age+pension credits also
    // apply, discounted by the 16.5% abatement
    const qcPart = (3986 + 3541) * 0.14
    const fedPart = (9208 * 0.14 + 2000 * 0.14) * (1 - 0.165)
    expect(base - low).toBeCloseTo(qcPart + fedPart, 0)
  })
})

describe('CPP/OAS adjustments', () => {
  it('CPP at 60 is 64% of the age-65 amount', () => {
    expect(cppAnnual(10000, 60)).toBeCloseTo(6400)
  })

  it('CPP at 70 is 142% of the age-65 amount', () => {
    expect(cppAnnual(10000, 70)).toBeCloseTo(14200)
  })

  it('QPP can defer to 72 (+58.8%); CPP stays capped at 70', () => {
    expect(cppAnnual(10000, 72, 72)).toBeCloseTo(15880)
    expect(cppAnnual(10000, 72)).toBeCloseTo(14200)
  })

  it('claiming at 60 shrinks the dropout divisor: FIRE careers dilute less', () => {
    // 20 credited years: 20/34.86 at 60 vs 20/39 at 65 -> ~11.9% relief
    expect(earlyClaimDilutionRelief(25, 45, 60)).toBeCloseTo(39 / (0.83 * 42), 3)
    // a full career is capped at 100% either way - no relief
    expect(earlyClaimDilutionRelief(18, 65, 60)).toBeCloseTo(1)
    // at 65+ the standard divisor applies
    expect(earlyClaimDilutionRelief(25, 45, 65)).toBe(1)
  })

  it('OAS deferred to 70 is 136%', () => {
    expect(oasAnnual(8700, 70)).toBeCloseTo(8700 * 1.36)
  })

  it('OAS has no early start below 65', () => {
    expect(oasAnnual(8700, 63)).toBeCloseTo(8700)
  })

  it('clawback leaves OAS intact at low income and eliminates it at high income', () => {
    expect(oasAfterClawback(8700, 40000)).toBeCloseTo(8700)
    expect(oasAfterClawback(8700, 300000)).toBe(0)
  })
})

describe('benefit estimators', () => {
  it('a full max-earnings career yields the CPP maximum', () => {
    expect(estimateCppAt65(18, 65, 1)).toBeCloseTo(CPP_MAX_AT_65)
    expect(estimateCppAt65(25, 64, 1)).toBeCloseTo(CPP_MAX_AT_65)
  })

  it('FIRE at 45 after starting at 25 credits 20 of 39 years', () => {
    expect(estimateCppAt65(25, 45, 1)).toBeCloseTo(CPP_MAX_AT_65 * (20 / 39))
  })

  it('earnings ratio scales linearly and clamps at 1', () => {
    expect(estimateCppAt65(25, 45, 0.5)).toBeCloseTo(CPP_MAX_AT_65 * (20 / 39) * 0.5)
    expect(estimateCppAt65(18, 65, 1.5)).toBeCloseTo(CPP_MAX_AT_65)
  })

  it('OAS prorates residence years over 40', () => {
    expect(estimateOasAt65(40)).toBeCloseTo(OAS_FULL_AT_65)
    expect(estimateOasAt65(20)).toBeCloseTo(OAS_FULL_AT_65 / 2)
    expect(estimateOasAt65(50)).toBeCloseTo(OAS_FULL_AT_65)
  })
})

describe('rrifMinFactor', () => {
  it('is zero before 72, keyed to the Jan-1 age after, capped at 20%', () => {
    expect(rrifMinFactor(65)).toBe(0)
    // first mandatory year (turning 72): CRA factor for age 71 at Jan 1
    expect(rrifMinFactor(72)).toBeCloseTo(0.0528)
    expect(rrifMinFactor(95)).toBeCloseTo(0.1879)
    expect(rrifMinFactor(100)).toBe(0.2)
  })
})
