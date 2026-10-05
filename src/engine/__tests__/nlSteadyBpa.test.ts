import { describe, expect, it } from 'vitest'
import { DEFAULT_INPUTS } from '../../store'
import { anchorTaxRules, incomeTax, rulesForCalendarYear } from '../tax'
import { runProjection } from '../projection'

describe('BE-45 Newfoundland basic personal amount after 2026', () => {
  const nl = anchorTaxRules('NL')
  it('keeps the prorated 2026 figure and uses 15,000 from 2027', () => {
    expect(nl.pack.provincial.bpa).toBe(13_094)
    expect(rulesForCalendarYear(nl, 2026)).toBe(nl)
    expect(rulesForCalendarYear(nl, 2027).pack.provincial.bpa).toBe(15_000)
    // Other provinces are untouched.
    const on = anchorTaxRules('ON')
    expect(rulesForCalendarYear(on, 2040)).toBe(on)
  })

  it('saves (15,000 − 13,094) × 8.7% ≈ 166 a person in a later year (review R5)', () => {
    const t2026 = incomeTax(40_000, 'NL', undefined, nl)
    const t2027 = incomeTax(40_000, 'NL', undefined, rulesForCalendarYear(nl, 2027))
    expect(t2026 - t2027).toBeCloseTo((15_000 - 13_094) * 0.087, 6)
  })

  it('reaches the projection: the second year of a retired NL plan is priced at 15,000', () => {
    const plan = { ...DEFAULT_INPUTS, province: 'NL' as const, currentAge: 60, fireAge: 60, lifeExpectancy: 62,
      retirementSpending: 40_000, balances: { tfsa: 0, rrsp: 900_000, nonReg: 0 }, nonRegBook: 0,
      returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, fees: 0, cppAnnualAt65: 0, oasAnnualAt65: 0, strategy: 'rrspFirst' as const }
    const rows = runProjection(plan).rows
    // Same withdrawal need both years, so the tax drop is the BPA change.
    expect(rows[0].tax - rows[1].tax).toBeGreaterThan(150)
  })
})
