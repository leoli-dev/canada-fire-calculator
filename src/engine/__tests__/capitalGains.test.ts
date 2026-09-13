import { describe, expect, it } from 'vitest'
import { buyHolding, disposeHolding, nominalFactor, settleHouseholdCapitalYear,
  settlePersonCapitalYear, toNominal, toReal } from '../capitalGains'
import { runProjection } from '../projection'
import { requiredFireAssets } from '../solvers'
import { incomeTax } from '../tax'
import { refreshCanonicalFromLegacy } from '../migration'
import type { Inputs } from '../types'

describe('BE-23 nominal average-cost and capital-loss ledger', () => {
  it('P06 keeps a nominal gain after 20 years of zero real return and 2% inflation', () => {
    const factor = nominalFactor(.02, 20)
    const market = toNominal(500_000, factor)
    expect(market).toBeCloseTo(742_973.697989, 5)
    expect(toReal(market, factor)).toBeCloseTo(500_000, 8)
    const sale = disposeHolding({ marketValue: market, acb: 500_000 }, market)
    expect(sale.status).toBe('ok')
    if (sale.status !== 'ok') return
    expect(sale.value.gain).toBeCloseTo(242_973.697989, 5)
    const tax = settlePersonCapitalYear(sale.value.gain, 0)
    expect(tax.status).toBe('ok')
    if (tax.status === 'ok') expect(tax.value.netTaxableGain).toBeCloseTo(121_486.848995, 5)
    expect(nominalFactor(0, 20)).toBe(1)
  })

  it('preserves high ACB and requires superficial-loss confirmation before using a loss', () => {
    const opening = { marketValue: 100_000, acb: 140_000 }
    expect(disposeHolding(opening, 50_000)).toMatchObject({ status: 'unsupported' })
    const sale = disposeHolding(opening, 50_000, 1_000, 'confirmedNotSuperficial')
    expect(sale).toMatchObject({ status: 'ok', value: { allocatedAcb: 70_000, gain: -21_000,
      closing: { marketValue: 50_000, acb: 70_000 } } })
    expect(opening).toEqual({ marketValue: 100_000, acb: 140_000 })
  })

  it('averages partial sale then rebuy and reinvested distributions without subtracting tax from ACB twice', () => {
    const first = disposeHolding({ marketValue: 100_000, acb: 80_000 }, 25_000, 500)
    expect(first).toMatchObject({ status: 'ok', value: { allocatedAcb: 20_000, gain: 4_500,
      closing: { marketValue: 75_000, acb: 60_000 } } })
    if (first.status !== 'ok') return
    const rebuy = buyHolding(first.value.closing, 10_000, 100)
    expect(rebuy).toMatchObject({ status: 'ok', value: { marketValue: 85_000, acb: 70_100 } })
    if (rebuy.status !== 'ok') return
    expect(buyHolding(rebuy.value, 2_000)).toMatchObject({ status: 'ok', value: {
      marketValue: 87_000, acb: 72_100,
    } })
  })

  it('allocates an 80/20 gain and carries each owner loss only against later capital gains', () => {
    const first = settleHouseholdCapitalYear([{ gain: -10_000, shares: { a: .8, b: .2 } }], {})
    expect(first).toMatchObject({ status: 'ok', value: {
      a: { netTaxableGain: 0, closingLossCarry: 8_000 },
      b: { netTaxableGain: 0, closingLossCarry: 2_000 },
    } })
    const later = settleHouseholdCapitalYear([{ gain: 20_000, shares: { a: .8, b: .2 } }], { a: 8_000, b: 2_000 })
    expect(later).toMatchObject({ status: 'ok', value: {
      a: { netTaxableGain: 4_000, closingLossCarry: 0 },
      b: { netTaxableGain: 1_000, closingLossCarry: 0 },
    } })
  })

  it('charges property sale expenses once and does not hide a larger loss', () => {
    expect(disposeHolding({ marketValue: 500_000, acb: 400_000 }, 500_000, 20_000))
      .toMatchObject({ status: 'ok', value: { netProceeds: 480_000, gain: 80_000 } })
    expect(disposeHolding({ marketValue: 400_000, acb: 500_000 }, 400_000, 20_000, 'confirmedNotSuperficial'))
      .toMatchObject({ status: 'ok', value: { netProceeds: 380_000, gain: -120_000 } })
  })

  it('P06 normal projection taxes the inflation-only nominal gain, not zero', () => {
    const input: Inputs = {
      currentAge: 40, fireAge: 60, lifeExpectancy: 60, province: 'ON', inflation: .02,
      annualSavings: 0, savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 }, retirementSpending: 500_000,
      returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, balances: { tfsa: 0, rrsp: 0, nonReg: 500_000 },
      nonRegBook: 500_000, nonRegDistributionYield: 0, fees: 0,
      cppStartAge: 70, cppAnnualAt65: 0, oasStartAge: 70, oasAnnualAt65: 0,
      strategy: 'nonRegFirst',
    }
    const final = runProjection(input).rows.at(-1)!
    const taxableReal = .5 * (500_000 - 500_000 / 1.02 ** 20)
    expect(final.taxableBySource.nonReg).toBeCloseTo(taxableReal, 2)
    expect(final.tax).toBeCloseTo(incomeTax(taxableReal, 'ON'), 0)
    expect(final.tax).toBeGreaterThan(15_000)
    expect(final.shortfall).toBeGreaterThan(15_000)
    const canonical = refreshCanonicalFromLegacy(null, input)
    const person = runProjection(input, undefined, canonical)
    expect(person.rows.at(-1)?.taxCapability).toBe('person')
    expect(person.rows.at(-1)?.taxableBySource.nonReg).toBeCloseTo(taxableReal, 2)
  })

  it('labels a high-ACB withdrawal preview and terminal result unsupported until loss facts are known', () => {
    const input: Inputs = {
      currentAge: 65, fireAge: 65, lifeExpectancy: 65, province: 'ON', inflation: 0,
      annualSavings: 0, savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 }, retirementSpending: 30_000,
      returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, balances: { tfsa: 0, rrsp: 0, nonReg: 100_000 },
      nonRegBook: 140_000, cppStartAge: 70, cppAnnualAt65: 0, oasStartAge: 70,
      oasAnnualAt65: 0, strategy: 'nonRegFirst',
    }
    const result = runProjection(input, undefined, refreshCanonicalFromLegacy(null, input))
    expect(result.taxCapability?.status).toBe('legacyEstimate')
    expect(result.taxCapability?.reason).toContain('capital loss')
    expect(result.terminalTaxStatus).toBe('unsupported')
  })

  it('subtracts an investment-property selling expense from cash and nominal gain once', () => {
    const input: Inputs = {
      currentAge: 50, fireAge: 50, lifeExpectancy: 50, province: 'ON', inflation: 0,
      annualSavings: 0, savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 }, retirementSpending: 0,
      returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, balances: { tfsa: 0, rrsp: 0, nonReg: 0 },
      nonRegBook: 0, cppStartAge: 70, cppAnnualAt65: 0, oasStartAge: 70,
      oasAnnualAt65: 0, strategy: 'nonRegFirst',
      investmentProperties: [{ value: 100_000, acb: 80_000, appreciation: 0,
        sellAtAge: 50, annualRent: 0, saleExpenses: 10_000 }],
    }
    const withFee = runProjection(input)
    const withoutFee = runProjection({ ...input, investmentProperties: [{ ...input.investmentProperties![0], saleExpenses: 0 }] })
    expect(withFee.rows[0].balances.nonReg).toBeCloseTo(90_000)
    expect(withFee.rows[0].taxableBySource.property).toBeCloseTo(5_000)
    expect(withoutFee.rows[0].balances.nonReg).toBeCloseTo(100_000)
    expect(withoutFee.rows[0].taxableBySource.property).toBeCloseTo(10_000)
    expect(withFee.taxCapability?.status).toBe('legacyEstimate')
  })

  it('a zero-gain investment-property disposition still cannot claim person-level tax precision', () => {
    const input: Inputs = { currentAge: 60, fireAge: 60, lifeExpectancy: 60,
      province: 'ON', inflation: 0, annualSavings: 0,
      savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 }, retirementSpending: 0,
      returns: { tfsa: 0, rrsp: 0, nonReg: 0 },
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
      cppStartAge: 70, cppAnnualAt65: 0, oasStartAge: 70, oasAnnualAt65: 0,
      strategy: 'nonRegFirst', investmentProperties: [{ value: 500_000, acb: 500_000,
        appreciation: 0, sellAtAge: 60, annualRent: 0, saleExpenses: 0 }] }
    const result = runProjection(input, undefined, refreshCanonicalFromLegacy(null, input))
    expect(result.rows[0].taxableBySource.property).toBe(0)
    expect(result.taxCapability?.status).toBe('legacyEstimate')
    expect(requiredFireAssets(input)).toMatchObject({ status: 'unsupported', value: null,
      reason: 'investmentPropertySale' })
  })
})
