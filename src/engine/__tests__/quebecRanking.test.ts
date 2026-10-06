import { describe, expect, it } from 'vitest'
import { DEFAULT_INPUTS } from '../../store'
import { maxSustainableSpending, rankCandidates, runProjection, scanBenefitTiming } from '..'
import type { Inputs } from '../types'

// Review repro R1: a funded 60-year-old single Quebec retiree.
const qc: Inputs = { ...DEFAULT_INPUTS, province: 'QC', currentAge: 60, fireAge: 60, annualSavings: 0, retirementSpending: 40_000,
  balances: { tfsa: 300_000, rrsp: 600_000, nonReg: 0 }, nonRegBook: 0, cppAnnualAt65: 12_000, oasAnnualAt65: 9_024 }

describe('BE-43 Quebec plans can be ranked', () => {
  it('gives one Quebec owner a disclosed closing-tax estimate instead of nothing', () => {
    const result = runProjection(qc)
    expect(result.success).toBe(true)
    expect(result.terminalTaxStatus).toBe('estimated')
    expect(result.terminalTaxDisclosure).toBe('quebecSimplified')
    expect(Number.isFinite(result.estateValue)).toBe(true)
    expect(runProjection({ ...qc, province: 'ON' }).terminalTaxDisclosure).toBeUndefined()
  })

  it('ranks timing like the same plan in Ontario', () => {
    expect(scanBenefitTiming(qc).status).toBe('ranked')
    expect(scanBenefitTiming({ ...qc, province: 'ON' }).status).toBe('ranked')
  })

  it('ranks die-with-zero by sustainable spending without waiting for closing tax', () => {
    const dwz = { ...qc, goal: 'dieWithZero' as const }
    const ranking = rankCandidates([{ value: 'current', inputs: dwz, solver: maxSustainableSpending(dwz) }], 'maxSpending')
    expect(ranking.status).toBe('ranked')
  })
})
