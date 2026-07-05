import { describe, expect, it } from 'vitest'
import { validateInputs } from '../validate'
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

const fields = (inputs: Inputs, severity?: 'error' | 'warning') =>
  validateInputs(inputs)
    .filter((i) => !severity || i.severity === severity)
    .map((i) => i.field)

describe('validateInputs', () => {
  it('accepts the default-shaped inputs', () => {
    expect(validateInputs(base)).toEqual([])
  })

  it('rejects FIRE age below current age', () => {
    expect(fields({ ...base, fireAge: 30 }, 'error')).toContain('fireAge')
  })

  it('rejects life expectancy below FIRE age', () => {
    expect(fields({ ...base, lifeExpectancy: 40 }, 'error')).toContain('lifeExpectancy')
  })

  it('rejects negative amounts', () => {
    const bad = {
      ...base,
      annualSavings: -1,
      retirementSpending: -50000,
      balances: { tfsa: -5, rrsp: 200000, nonReg: 100000 },
      nonRegBook: -1,
    }
    const f = fields(bad, 'error')
    expect(f).toContain('annualSavings')
    expect(f).toContain('retirementSpending')
    expect(f).toContain('balances.tfsa')
    expect(f).toContain('nonRegBook')
  })

  it('enforces CPP claim window, honouring the QPP 72 cap', () => {
    expect(fields({ ...base, cppStartAge: 59 }, 'error')).toContain('cppStartAge')
    expect(fields({ ...base, cppStartAge: 71 }, 'error')).toContain('cppStartAge')
    expect(fields({ ...base, province: 'QC', cppStartAge: 71 }, 'error')).not.toContain(
      'cppStartAge',
    )
    expect(fields({ ...base, oasStartAge: 63 }, 'error')).toContain('oasStartAge')
  })

  it('warns when the savings split does not add to 100%', () => {
    const bad = { ...base, savingsSplit: { tfsa: 0.3, rrsp: 0.5, nonReg: 0.1 } }
    expect(fields(bad, 'warning')).toContain('savingsSplit')
    // irrelevant when nothing is being saved
    expect(fields({ ...bad, annualSavings: 0 }, 'warning')).not.toContain('savingsSplit')
  })

  it('warns on benefit amounts above the official maximums', () => {
    expect(fields({ ...base, cppAnnualAt65: 20000 }, 'warning')).toContain('cppAnnualAt65')
    expect(fields({ ...base, oasAnnualAt65: 9500 }, 'warning')).toContain('oasAnnualAt65')
  })

  it('warns when the book value exceeds the non-registered balance', () => {
    expect(fields({ ...base, nonRegBook: 150000 }, 'warning')).toContain('nonRegBook')
  })

  it('validates partner fields', () => {
    const bad = {
      ...base,
      partner: {
        currentAge: 12,
        cppStartAge: 58,
        cppAnnualAt65: -1,
        oasStartAge: 72,
        oasAnnualAt65: 8700,
      },
    }
    const f = fields(bad, 'error')
    expect(f).toContain('partner.currentAge')
    expect(f).toContain('partner.cppStartAge')
    expect(f).toContain('partner.cppAnnualAt65')
    expect(f).toContain('partner.oasStartAge')
  })

  it('flags property inconsistencies', () => {
    const bad = {
      ...base,
      principalResidence: { value: 800000, appreciation: 0.02, sellAtAge: 30 },
      investmentProperty: { value: 400000, acb: 500000, appreciation: 0.02, sellAtAge: 40 },
    }
    const w = fields(bad, 'warning')
    expect(w).toContain('principalResidence.sellAtAge')
    expect(w).toContain('investmentProperty.acb')
    expect(w).toContain('investmentProperty.sellAtAge')
  })
})
