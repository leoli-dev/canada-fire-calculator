import { describe, expect, it } from 'vitest'
import { runProjection } from '../projection'
import households from './fixtures/households.json'
import pendingAudit from './fixtures/pending-audit.json'
import type { Inputs } from '../types'
import type { MoneyFixture } from './fixtures/types'
import { expectCad } from './fixtures/types'

describe('QA-30 A: invented household cash baselines', () => {
  it('keeps pending audit inputs and independently derived expectations reviewable', () => {
    const cases = pendingAudit.cases
    expect(cases.map((fixture) => fixture.id)).toEqual(['P01', 'P02', 'P03', 'P04', 'P10', 'P17'])
    for (const fixture of cases) {
      expect(fixture.inputVersion).toBe('legacy-inputs-v1')
      expect(fixture.taxPeriod).toMatch(/2026/)
      expect(fixture.toleranceCad).toBe(0.01)
      expect(fixture.pendingFix).toMatch(/^BE-/)
      expect(fixture.source.derivation.length).toBeGreaterThan(40)
      expect(Object.keys(fixture)).not.toContain('observedFinalNetWorth')
      expect(Object.keys(fixture.expected).some((key) => key.startsWith('observed'))).toBe(false)
    }
    const sale = (cases[0].inputs as Inputs).principalResidence
    if (!sale || sale.mode === 'planned' || !sale.mortgage) throw new Error('P01 requires owned home and mortgage')
    expectCad(sale.value - sale.mortgage.balance,
      (cases[0].expected as { finalNetWorth: number }).finalNetWorth, 0.01)
    const purchase = (cases[1].inputs as Inputs).principalResidence
    if (!purchase || purchase.mode !== 'planned') throw new Error('P02 requires planned home')
    expectCad(purchase.price - cases[1].inputs.balances.tfsa,
      (cases[1].expected as { unfundedPurchasePrice: number }).unfundedPurchasePrice, 0.01)
  })
  for (const fixture of households.households as MoneyFixture[]) {
    it(`${fixture.id}: ${fixture.source.derivation}`, () => {
      expect(fixture.inputVersion).toBe('legacy-inputs-v1')
      expect(fixture.taxPeriod).toMatch(/2026/)
      const result = runProjection(fixture.inputs)
      expect(result.success).toBe(true)
      expect(result.rows).toHaveLength(fixture.expected.rowBalances.length)
      expectCad(result.finalNetWorth, fixture.expected.finalNetWorth, fixture.toleranceCad)
      result.rows.forEach((row, index) => {
        const balances = fixture.expected.rowBalances[index]
        for (const account of ['tfsa', 'rrsp', 'nonReg'] as const) {
          expectCad(row.balances[account], balances[account], fixture.toleranceCad)
        }
        expectCad(row.netCash, fixture.expected.rowNetCash[index], fixture.toleranceCad)
        expectCad(row.shortfall, fixture.expected.rowShortfall[index], fixture.toleranceCad)
      })
    })
  }

  it('preserves household cash when the zero-benefit partner labels are exchanged', () => {
    const source = (households.households[0] as MoneyFixture).inputs
    const withPartner = { ...source, partner: {
      currentAge: 47, cppStartAge: 65, cppAnnualAt65: 0,
      oasStartAge: 65, oasAnnualAt65: 0,
    } }
    const exchanged = { ...withPartner, currentAge: 47, fireAge: 47, lifeExpectancy: 47,
      partner: { ...withPartner.partner, currentAge: 50 } }
    const a = runProjection(withPartner)
    const b = runProjection(exchanged)
    expectCad(a.finalNetWorth, 12000, 0.01)
    expectCad(b.finalNetWorth, 12000, 0.01)
  })
})
