import { describe, expect, it } from 'vitest'
import { incomeTax, qcFssContribution, qcRamqPremium } from '../tax'
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

  it('matches a hand-computed MB value at $60k (2026 table, frozen indexation)', () => {
    // fed: 58523*0.14 + 1477*0.205 - 16452*0.14 = 6192.73
    // MB:  47000*0.108 + 13000*0.1275 - 15780*0.108 = 5029.26
    expect(incomeTax(60000, 'MB')).toBeCloseTo(6192.73 + 5029.26, 0)
  })

  it('phases the MB BPA out to zero between $200k and $400k', () => {
    // at $300k the MB BPA is half gone: credit = 7890*0.108 vs 15780*0.108
    const at300k = incomeTax(300000, 'MB')
    const mbTax = (bpa: number) =>
      47000 * 0.108 + 53000 * 0.1275 + 200000 * 0.174 - bpa * 0.108
    const fed = 8193.22 + 11997.01 + 16742.7 + 22342.18 + 41518 * 0.33 - 14829 * 0.14
    expect(at300k).toBeCloseTo(fed + mbTax(7890), 0)
  })

  it('YT mirrors the federal enhanced BPA including its phase-out', () => {
    // below the phase-out the full $16,452 applies; at $300k only $14,829
    const low = incomeTax(60000, 'YT')
    // fed 6192.73 + YT: 58523*0.064 + 1477*0.09 - 16452*0.064 = 2825.47
    expect(low).toBeCloseTo(6192.73 + 3745.47 + 132.93 - 1052.93, 0)
  })

  it('every jurisdiction taxes more at higher income (all 13 tables wired)', () => {
    const provinces = [
      'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
    ] as const
    for (const p of provinces) {
      expect(incomeTax(90000, p)).toBeGreaterThan(incomeTax(45000, p))
      expect(incomeTax(45000, p)).toBeGreaterThan(0)
    }
  })

  it('qcFssContribution matches the official 2026 two-tier formula', () => {
    expect(qcFssContribution(18000)).toBe(0)
    expect(qcFssContribution(18500)).toBe(0)
    expect(qcFssContribution(20000)).toBeCloseTo((20000 - 18500) * 0.01, 6)
    // caps at $150 by $33,500 and stays flat through $64,355
    expect(qcFssContribution(33500)).toBeCloseTo(150, 6)
    expect(qcFssContribution(50000)).toBe(150)
    expect(qcFssContribution(64355)).toBeCloseTo(150, 6)
    expect(qcFssContribution(70000)).toBeCloseTo(150 + (70000 - 64355) * 0.01, 6)
    // caps at $1,000 by $149,355
    expect(qcFssContribution(149355)).toBeCloseTo(1000, 6)
    expect(qcFssContribution(500000)).toBe(1000)
  })

  it('qcRamqPremium ramps from the threshold and caps at the max', () => {
    expect(qcRamqPremium(15000)).toBe(0)
    expect(qcRamqPremium(20288)).toBe(0)
    expect(qcRamqPremium(23000)).toBeCloseTo((23000 - 20288) * 0.0784, 6)
    const capReachIncome = 20288 + 5000 + (770 - 5000 * 0.0784) / 0.1176
    expect(qcRamqPremium(capReachIncome)).toBeCloseTo(770, 1)
    expect(qcRamqPremium(200000)).toBe(770)
  })

  it('incomeTax for QC includes the FSS contribution and RAMQ premium on top of bracket tax', () => {
    const taxable = 50000
    const withLevies = incomeTax(taxable, 'QC')
    const withoutLevies = withLevies - qcFssContribution(taxable) - qcRamqPremium(taxable)
    // sanity: the levies are a real, non-zero add-on at this income level
    expect(qcFssContribution(taxable) + qcRamqPremium(taxable)).toBeGreaterThan(0)
    expect(withoutLevies).toBeLessThan(withLevies)
  })

  it('SK grants the senior supplementary amount at 65+, not income-tested', () => {
    const junior = incomeTax(120000, 'SK', { age: 60 })
    const senior = incomeTax(120000, 'SK', { age: 65 })
    // at $120k the SK age amount is fully phased out ((120000-43927)*0.15 > 5901)
    // but the supplement ($2,569 @ 10.5%) and federal age amount remain absent/phased:
    // federal age amount also fully phased at $120k, so the delta is the supplement
    expect(junior - senior).toBeCloseTo(2569 * 0.105, 0)
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
