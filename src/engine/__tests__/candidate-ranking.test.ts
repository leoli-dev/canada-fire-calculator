import { describe, expect, it } from 'vitest'
import { compareStrategies, rankCandidates, scanBenefitTiming } from '../solvers'
import { runProjection } from '../projection'
import type { Inputs } from '../types'
import { DEFAULT_INPUTS } from '../../store'
import pending from './fixtures/pending-audit.json'

const p17 = pending.cases.find((item) => item.id === 'P17')!
const inputs = p17.inputs as Inputs

describe('P17 independent funding oracle', () => {
  it('excludes the unpaid 70/70 bridge and recommends a funded path', () => {
    const failed = runProjection({ ...inputs, cppStartAge: 70, oasStartAge: 70 })
    const age62 = failed.rows.find((row) => row.age === 62)!
    expect(age62.shortfall).toBeCloseTo(10_000, 2)
    expect(failed.success).toBe(false)
    const funded = runProjection({ ...inputs, cppStartAge: 61, oasStartAge: 65 })
    // Independent bridge arithmetic: CPP at 61 is 71.2% of the age-65 amount.
    // With zero returns/inflation and income below the basic exemption through 64,
    // $50,000 - $20,000 - 4 × ($20,000 - $18,092 × 0.712) = $1,526.016.
    expect(funded.rows.find((row) => row.age === 64)?.balances.tfsa).toBeCloseTo(1_526.016, 2)
    expect(funded.success).toBe(true)
    const ranking = scanBenefitTiming(inputs)
    expect(ranking.status).toBe('ranked')
    expect(ranking.best?.result.success).toBe(true)
    expect([ranking.best?.cppStartAge, ranking.best?.oasStartAge]).not.toEqual([70, 70])
    expect(ranking.best?.result.rows).toEqual(runProjection({ ...inputs,
      cppStartAge: ranking.best!.cppStartAge, oasStartAge: ranking.best!.oasStartAge }).rows)
  })
})

describe('shared candidate ranking', () => {
  it('returns no best when every timing fails, while retaining measured gaps', () => {
    const empty: Inputs = { ...inputs, cppAnnualAt65: 0, oasAnnualAt65: 0, balances: { tfsa: 0, rrsp: 0, nonReg: 0 } }
    const ranking = scanBenefitTiming(empty)
    expect(ranking.status).toBe('noFeasibleCandidate')
    expect(ranking.best).toBeNull()
    expect(ranking.candidates.every((row) => row.status !== 'feasible')).toBe(true)
    expect(ranking.candidates.some((row) => row.gap === 20_000)).toBe(true)
  })

  it('retains the current plan when it ties for the objective', () => {
    const tied: Inputs = { ...inputs, cppStartAge: 68, oasStartAge: 68,
      retirementSpending: 0, cppAnnualAt65: 0, oasAnnualAt65: 0 }
    const ranking = scanBenefitTiming(tied)
    expect(ranking.status).toBe('ranked')
    expect(ranking.best?.result.success).toBe(true)
    expect(ranking.best?.result.estateValue).toBe(ranking.current.result.estateValue)
    expect([ranking.best?.cppStartAge, ranking.best?.oasStartAge]).toEqual([68, 68])
  })

  it('does not recommend an unsupported purchased-home projection', () => {
    const planned: Inputs = { ...inputs, principalResidence: { mode: 'planned', buyAtAge: 60, price: 500_000,
      downPayment: 0, appreciation: 0, netHoldingCostChange: 0, sellAtAge: null } }
    const ranking = scanBenefitTiming(planned)
    expect(ranking.status).toBe('noFeasibleCandidate')
    expect(ranking.best).toBeNull()
    expect(ranking.candidates.some((row) => row.status === 'unsupported')).toBe(true)
  })

  it('only enumerates 71 and 72 for Quebec QPP', () => {
    const ontario = scanBenefitTiming(inputs)
    const quebec = scanBenefitTiming({ ...inputs, province: 'QC' })
    expect(ontario.candidates.some((row) => row.value.cppStartAge > 70)).toBe(false)
    expect(quebec.candidates.some((row) => row.value.cppStartAge === 71)).toBe(true)
    expect(quebec.candidates.some((row) => row.value.cppStartAge === 72)).toBe(true)
  })

  it('uses the same feasibility rule for withdrawal strategy previews', () => {
    const rows = compareStrategies(inputs)
    const ranking = rankCandidates(rows.map((row) => ({ value: row.strategy,
      inputs: { ...inputs, strategy: row.strategy }, result: row.result })), 'estate')
    for (const row of ranking.candidates) {
      expect(row.status === 'feasible').toBe(row.result?.success === true && row.result.unfundedObligations.length === 0)
    }
    expect(ranking.best?.result?.success).toBe(true)
    expect(ranking.best?.result?.rows).toEqual(runProjection({ ...inputs,
      strategy: ranking.best!.value }).rows)
  })

  it('keeps a funded plan distinct when every spending search reaches its limit', () => {
    const rich: Inputs = { ...DEFAULT_INPUTS, goal: 'dieWithZero',
      balances: { ...DEFAULT_INPUTS.balances, tfsa: 10_000_000_000 } }
    const projection = runProjection(rich)
    expect(projection.success).toBe(true)
    expect(projection.unfundedObligations).toHaveLength(0)
    const ranking = scanBenefitTiming(rich)
    expect(ranking.candidates).toHaveLength(66)
    expect(ranking.candidates.every((row) => row.result?.success && row.result.unfundedObligations.length === 0)).toBe(true)
    expect(ranking.candidates.every((row) => row.solver?.status === 'searchLimit')).toBe(true)
    expect(ranking.status).toBe('unrankedObjective')
    expect(ranking.best).toBeNull()
  })

  it('keeps funded planned purchases distinct when only the quick spending solver is unsupported', () => {
    const funded: Inputs = { ...DEFAULT_INPUTS, goal: 'dieWithZero',
      balances: { ...DEFAULT_INPUTS.balances, tfsa: 5_000_000 },
      principalResidence: { mode: 'planned', buyAtAge: 45, price: 500_000, downPayment: 500_000,
        appreciation: 0, netHoldingCostChange: 0, sellAtAge: null } }
    expect(runProjection(funded).success).toBe(true)
    const ranking = scanBenefitTiming(funded)
    expect(ranking.status).toBe('unrankedObjective')
    expect(ranking.best).toBeNull()
    expect(ranking.candidates.some((row) => row.result?.success && row.solver?.status === 'unsupported')).toBe(true)
  })
})

describe('known unsupported recommendation boundary', () => {
  it('keeps a funded locked balance as an unranked model path', () => {
    const plan: Inputs = { ...DEFAULT_INPUTS,
      balances: { tfsa: 2_000_000, rrsp: 0, nonReg: 0 },
      lockedRetirement: { balance: 500_000, employeeContribution: 0,
        employerContribution: 0, accessibleAge: 55, jurisdiction: 'ON', owner: 'self' } }
    expect(runProjection(plan).success).toBe(true)
    const ranking = scanBenefitTiming(plan)
    expect(ranking.status).toBe('unrankedObjective')
    expect(ranking.best).toBeNull()
    expect(ranking.candidates.some((row) => row.reason === 'lockedWithdrawalLimits')).toBe(true)
  })
})
