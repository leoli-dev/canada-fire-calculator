import { describe, expect, it } from 'vitest'
import { runProjection } from '../projection'
import { runMonteCarlo } from '../monteCarlo'
import households from './fixtures/households.json'
import type { MoneyFixture } from './fixtures/types'
import { expectCad } from './fixtures/types'

describe('QA-30 A: deterministic year boundary', () => {
  it('continues from a simple FIRE opening balance without an extra work year', () => {
    const fixture = households.households[1] as MoneyFixture
    const full = runProjection(fixture.inputs)
    const entering = fixture.expected.rowBalances[1].tfsa // hand-derived 5,000 + 2 × 10,000
    const resumed = runProjection({ ...fixture.inputs, currentAge: 42, fireAge: 42,
      balances: { tfsa: entering, rrsp: 0, nonReg: 0 }, annualSavings: 0 })
    expectCad(entering, 25000, fixture.toleranceCad)
    expectCad(full.rows[2].balances.tfsa, resumed.rows[0].balances.tfsa, fixture.toleranceCad)
    expectCad(resumed.finalNetWorth, 25000, fixture.toleranceCad)
  })

  it('zero-volatility MC equals the independent simple retirement path', () => {
    const fixture = households.households[2] as MoneyFixture
    const inputs = { ...fixture.inputs, volatilities: { tfsa: 0, rrsp: 0, nonReg: 0 } }
    const mc = runMonteCarlo(inputs, 5, () => 0.5)
    expect(mc.successRate).toBe(1)
    mc.bands.forEach((band, index) => {
      expectCad(band.p10, fixture.expected.rowBalances[index].tfsa, fixture.toleranceCad)
      expectCad(band.p50, fixture.expected.rowBalances[index].tfsa, fixture.toleranceCad)
      expectCad(band.p90, fixture.expected.rowBalances[index].tfsa, fixture.toleranceCad)
    })
  })
})
