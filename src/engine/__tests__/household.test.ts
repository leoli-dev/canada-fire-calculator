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
    expect(cases.map((fixture) => fixture.id)).toEqual(['P02', 'P03', 'P04', 'P10', 'P17'])
    for (const fixture of cases) {
      expect(fixture.inputVersion).toBe('legacy-inputs-v1')
      expect(fixture.baselineRevision).toBe('9017dc4d73854160ff0bdad4603699c5f0c4902a')
      expect(fixture.provenanceRef).toContain('diagnostics.json#')
      expect(fixture.taxPeriod).toMatch(/2026/)
      expect(fixture.toleranceCad).toBe(0.01)
      expect(fixture.pendingFix).toMatch(/^BE-/)
      expect(fixture.source.derivation.length).toBeGreaterThan(40)
      expect(Object.keys(fixture)).not.toContain('observedFinalNetWorth')
      expect(Object.keys(fixture.expected).some((key) => key.startsWith('observed'))).toBe(false)
    }
    const purchase = (cases[0].inputs as Inputs).principalResidence
    if (!purchase || purchase.mode !== 'planned') throw new Error('P02 requires planned home')
    expectCad(purchase.price - cases[0].inputs.balances.tfsa,
      (cases[0].expected as { unfundedPurchasePrice: number }).unfundedPurchasePrice, 0.01)
    const p17 = cases.find((fixture) => fixture.id === 'P17')!
    const timingExpected = p17.expected as { firstUnfundedAge: number; unfundedAtAge62: number }
    expect(Object.keys(p17.expected)).not.toContain('knownFeasible')
    expect(timingExpected.firstUnfundedAge).toBe(62)
    expectCad(3 * p17.inputs.retirementSpending - p17.inputs.balances.tfsa,
      timingExpected.unfundedAtAge62, 0.01)
  })
  for (const fixture of households.households as MoneyFixture[]) {
    it(`${fixture.id}: ${fixture.source.derivation}`, () => {
      expect(fixture.inputVersion).toBe('legacy-inputs-v1')
      expect(fixture.baselineRevision).toBe('718a6297d7a972de557525d7d5f3ed6337bcd877')
      expect(fixture.provenanceRef).toBe(`QA-30-A/independent-hand-calculation/${fixture.id}`)
      expect(fixture.taxPeriod).toMatch(/2026/)
      expect(fixture.toleranceCad).toBeGreaterThan(0)
      expect(fixture.toleranceCad).toBeLessThanOrEqual(0.01)
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

  it('keeps a nonzero CPP stream when its recipient switches between primary and partner', () => {
    const source = (households.households[0] as MoneyFixture).inputs
    const person = { currentAge: 64, cppStartAge: 65, cppAnnualAt65: 1000,
      oasStartAge: 65, oasAnnualAt65: 0 }
    const zero = { ...person, cppAnnualAt65: 0 }
    const shared = { ...source, currentAge: 64, fireAge: 64, lifeExpectancy: 65,
      balances: { tfsa: 12000, rrsp: 0, nonReg: 0 }, retirementSpending: 0 }
    const primaryReceives = runProjection({ ...shared, ...person, partner: zero })
    const partnerReceives = runProjection({ ...shared, ...zero, partner: person })
    // CPP begins at 65: year 64 receives 0; year 65 receives exactly the
    // stated 1,000. No OAS/GIS is enabled and 1,000 is below the tax-free
    // personal amount. This checks a benefit-source swap, not full T17.
    for (const result of [primaryReceives, partnerReceives]) {
      expect(result.rows.map((row) => row.age)).toEqual([64, 65])
      expectCad(result.rows[0].cpp, 0, 0.01)
      expectCad(result.rows[1].cpp, 1000, 0.01)
      expectCad(result.rows[0].tax, 0, 0.01)
      expectCad(result.rows[1].tax, 0, 0.01)
      expectCad(result.rows[0].netCash, 0, 0.01)
      expectCad(result.rows[1].netCash, 1000, 0.01)
    }
  })
})
