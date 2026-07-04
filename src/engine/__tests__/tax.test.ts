import { describe, expect, it } from 'vitest'
import { incomeTax } from '../tax'
import {
  CPP_MAX_AT_65,
  OAS_FULL_AT_65,
  cppAnnual,
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

  it('matches a hand-computed ON value at $60k', () => {
    // fed: 57375*0.14 + 2625*0.205 - 16129*0.14 = 6312.44
    // ON:  52886*0.0505 + 7114*0.0915 - 12747*0.0505 = 2677.65
    expect(incomeTax(60000, 'ON')).toBeCloseTo(6312.44 + 2677.65, 0)
  })

  it('is monotonically increasing', () => {
    expect(incomeTax(100000, 'BC')).toBeGreaterThan(incomeTax(50000, 'BC'))
  })

  it('QC total exceeds ON at the same income despite the abatement', () => {
    expect(incomeTax(80000, 'QC')).toBeGreaterThan(incomeTax(80000, 'ON'))
  })
})

describe('CPP/OAS adjustments', () => {
  it('CPP at 60 is 64% of the age-65 amount', () => {
    expect(cppAnnual(10000, 60)).toBeCloseTo(6400)
  })

  it('CPP at 70 is 142% of the age-65 amount', () => {
    expect(cppAnnual(10000, 70)).toBeCloseTo(14200)
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
  it('is zero before 72, tabulated after, capped at 20%', () => {
    expect(rrifMinFactor(65)).toBe(0)
    expect(rrifMinFactor(72)).toBeCloseTo(0.054)
    expect(rrifMinFactor(100)).toBe(0.2)
  })
})
