import { describe, expect, it } from 'vitest'
import { runProjection } from '../projection'
import households from './fixtures/households.json'
import type { MoneyFixture } from './fixtures/types'
import { expectCad } from './fixtures/types'

// Independent double-entry reference, deliberately unaware of projection.ts.
// A housing-event test should bind the production event ledger here with BE-30/31.
interface Entry { cash: number; financial: number; property: number; debt: number; external: number }
const netWorth = (e: Entry) => e.cash + e.financial + e.property - e.debt

describe('QA-30 A: money identities', () => {
  it('internal transfers, financed purchase and principal settlement cannot create net worth', () => {
    const opening: Entry = { cash: 100000, financial: 0, property: 0, debt: 0, external: 0 }
    const transfer: Entry = { ...opening, cash: 60000, financial: 40000 }
    const purchase: Entry = { ...transfer, cash: 0, financial: 0, property: 500000, debt: 400000 }
    const settlement: Entry = { ...purchase, cash: 100000, property: 0, debt: 0 }
    for (const state of [transfer, purchase, settlement]) {
      expectCad(netWorth(state), netWorth(opening) + state.external, 0.01)
      expect(Math.min(state.cash, state.financial, state.property, state.debt)).toBeGreaterThanOrEqual(0)
    }
    // Deliberately corrupted mortgage principal is rejected by the same identity.
    expect(() => expectCad(netWorth({ ...purchase, debt: 360000 }), 100000, 0.01)).toThrow('CAD mismatch')
  })

  it('live no-tax accumulation and withdrawals satisfy sources = uses to one cent', () => {
    for (const fixture of households.households as MoneyFixture[]) {
      expect(fixture.toleranceCad).toBeLessThanOrEqual(0.01)
      const projection = runProjection(fixture.inputs)
      let opening = Object.values(fixture.inputs.balances).reduce((sum, amount) => sum + amount, 0)
      for (const row of projection.rows) {
        const closing = Object.values(row.balances).reduce((sum, amount) => sum + amount, 0)
        const externalSavings = row.phase === 'accumulation' ? fixture.inputs.annualSavings : 0
        const consumption = row.phase === 'accumulation' ? 0 : fixture.inputs.retirementSpending - row.shortfall
        expectCad(closing - opening, externalSavings - consumption, fixture.toleranceCad)
        for (const balance of Object.values(row.balances)) expect(balance).toBeGreaterThanOrEqual(-fixture.toleranceCad)
        opening = closing
      }
    }
  })
})
