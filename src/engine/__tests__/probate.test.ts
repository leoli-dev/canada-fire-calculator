import { describe, expect, it } from 'vitest'
import { probateTax } from '../tax'
import { runProjection } from '../projection'
import type { Inputs } from '../types'

const base: Inputs = {
  currentAge: 80,
  fireAge: 80,
  lifeExpectancy: 82,
  province: 'ON',
  annualSavings: 0,
  savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 0 },
  retirementSpending: 1,
  returns: { tfsa: 0, rrsp: 0, nonReg: 0 },
  balances: { tfsa: 0, rrsp: 0, nonReg: 1_000_000 },
  nonRegBook: 1_000_000,
  cppStartAge: 65,
  cppAnnualAt65: 0,
  oasStartAge: 65,
  oasAnnualAt65: 0,
  strategy: 'nonRegFirst' as const,
}

describe('probateTax', () => {
  it('matches the hand-computed ON Estate Administration Tax at $1M', () => {
    // exempt first $50,000, then 1.5% of the rest
    expect(probateTax(1_000_000, 'ON')).toBeCloseTo((1_000_000 - 50000) * 0.015, 0)
  })

  it('Alberta is a flat fee regardless of value above the threshold', () => {
    expect(probateTax(300000, 'AB')).toBeCloseTo(525, 0)
    expect(probateTax(30_000_000, 'AB')).toBeCloseTo(525, 0)
  })

  it('Quebec is a flat court fee', () => {
    expect(probateTax(2_000_000, 'QC')).toBeCloseTo(243, 0)
  })

  it('Manitoba charges nothing (abolished 2020)', () => {
    expect(probateTax(2_000_000, 'MB')).toBe(0)
  })

  it('is zero for a zero or negative estate', () => {
    expect(probateTax(0, 'ON')).toBe(0)
    expect(probateTax(-100, 'ON')).toBe(0)
  })

  it('Nova Scotia is the most expensive of the compared provinces at $1M', () => {
    const on = probateTax(1_000_000, 'ON')
    const ns = probateTax(1_000_000, 'NS')
    const ab = probateTax(1_000_000, 'AB')
    expect(ns).toBeGreaterThan(on)
    expect(on).toBeGreaterThan(ab)
  })
})

describe('probate in the projection estate value', () => {
  it('deducts the probate fee from a non-registered estate', () => {
    const r = runProjection(base)
    const expectedFee = probateTax(1_000_000, 'ON')
    expect(r.probateFee).toBeCloseTo(expectedFee, 0)
    expect(r.estateValue).toBeCloseTo(r.finalNetWorth - r.estateTax - expectedFee, 0)
  })

  it('registered accounts bypass probate entirely (TFSA vs non-reg, same value)', () => {
    const tfsaHeavy = runProjection({
      ...base,
      balances: { tfsa: 1_000_000, rrsp: 0, nonReg: 0 },
      nonRegBook: 0,
      strategy: 'tfsaFirst' as const,
    })
    expect(tfsaHeavy.probateFee).toBe(0)
  })

  it('unsold real estate is also subject to probate', () => {
    const withHouse = runProjection({
      ...base,
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 },
      nonRegBook: 0,
      principalResidence: { value: 1_000_000, appreciation: 0, sellAtAge: null },
    })
    expect(withHouse.probateFee).toBeCloseTo(probateTax(1_000_000, 'ON'), 0)
  })
})
