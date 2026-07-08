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
      investmentProperties: [
        { value: 400000, acb: 500000, appreciation: 0.02, sellAtAge: 40 },
      ],
    }
    const w = fields(bad, 'warning')
    expect(w).toContain('principalResidence.sellAtAge')
    expect(w).toContain('investmentProperties.0.acb')
    expect(w).toContain('investmentProperties.0.sellAtAge')
  })

  it('flags FHSA inconsistencies', () => {
    const expired = { ...base, fhsa: { balance: 10000, annualContribution: 0, openedYearsAgo: 15 } }
    expect(fields(expired, 'error')).toContain('fhsa.openedYearsAgo')

    const negative = { ...base, fhsa: { balance: -1, annualContribution: -1, openedYearsAgo: -1 } }
    const negErrors = fields(negative, 'error')
    expect(negErrors).toContain('fhsa.balance')
    expect(negErrors).toContain('fhsa.annualContribution')
    expect(negErrors).toContain('fhsa.openedYearsAgo')

    const overSavings = {
      ...base,
      annualSavings: 5000,
      fhsa: { balance: 0, annualContribution: 8000, openedYearsAgo: 0 },
    }
    expect(fields(overSavings, 'error')).toContain('fhsa.annualContribution')

    const overLimit = { ...base, fhsa: { balance: 0, annualContribution: 20000, openedYearsAgo: 0 } }
    expect(fields(overLimit, 'warning')).toContain('fhsa.annualContribution')

    const ok = { ...base, fhsa: { balance: 10000, annualContribution: 8000, openedYearsAgo: 3 } }
    expect(validateInputs(ok)).toEqual([])
  })

  it('flags planned-home-purchase inconsistencies', () => {
    const planned = {
      mode: 'planned' as const,
      buyAtAge: 30,
      price: 500000,
      downPayment: 100000,
      appreciation: 0.02,
      annualMortgagePayment: 24000,
      mortgageYears: 20,
      netHoldingCostChange: 0,
      sellAtAge: null,
    }

    expect(fields({ ...base, principalResidence: { ...planned, buyAtAge: 30 } }, 'error')).toContain(
      'principalResidence.buyAtAge',
    )
    expect(
      fields({ ...base, principalResidence: { ...planned, downPayment: 600000 } }, 'warning'),
    ).toContain('principalResidence.downPayment')
    expect(
      fields({ ...base, principalResidence: { ...planned, buyAtAge: 40, sellAtAge: 35 } }, 'warning'),
    ).toContain('principalResidence.sellAtAge')
    expect(
      fields(
        { ...base, principalResidence: { ...planned, buyAtAge: 40, downPayment: 490000, annualMortgagePayment: 100 } },
        'error',
      ),
    ).toContain('principalResidence.annualMortgagePayment')
    expect(
      fields({ ...base, principalResidence: { ...planned, buyAtAge: 40, downPayment: 999999 } }, 'warning'),
    ).toContain('principalResidence.downPayment')
    expect(
      fields({ ...base, principalResidence: { ...planned, buyAtAge: 40, netHoldingCostChange: 100000 } }, 'warning'),
    ).toContain('principalResidence.netHoldingCostChange')

    const ok = { ...base, principalResidence: { ...planned, buyAtAge: 40 } }
    expect(validateInputs(ok)).toEqual([])
  })
})
