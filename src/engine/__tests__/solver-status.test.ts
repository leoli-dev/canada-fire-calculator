import { describe, expect, it } from 'vitest'
import { maxSustainableSpending, requiredFireAssets } from '../solvers'
import { runProjection } from '../projection'
import type { Inputs } from '../types'

const base: Inputs = {
  currentAge: 50, fireAge: 50, lifeExpectancy: 85, province: 'ON',
  annualSavings: 0, savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 },
  retirementSpending: 0, returns: { tfsa: 0, rrsp: 0, nonReg: 0 },
  balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
  cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0,
  strategy: 'tfsaFirst',
}

describe('explicit solver outcomes', () => {
  it('solves zero assets and zero spending at the verified zero bound', () => {
    const result = requiredFireAssets(base)
    expect(result).toMatchObject({ status: 'solved', value: 0, lastVerifiedBound: 0 })
    expect(maxSustainableSpending(base)).toMatchObject({ status: 'solved', value: 0 })
  })

  it('reports zero-spending failure from a locked-only bridge as infeasible', () => {
    const input: Inputs = { ...base, retirementSpending: 1, lockedRetirement: {
      balance: 1_000_000, accessibleAge: 65, owner: 'self', jurisdiction: 'ON',
      employeeContribution: 0, employerContribution: 0,
    } }
    expect(runProjection({ ...input, retirementSpending: 0 }).success).toBe(true)
    const result = requiredFireAssets(input)
    expect(result).toMatchObject({ status: 'unsupported', value: null, reason: 'lockedOnlyBridge' })
  })

  it('does not return a fabricated 128m threshold after exhausting the bound', () => {
    const input: Inputs = { ...base, retirementSpending: 20_000_000 }
    const result = requiredFireAssets(input)
    expect(result).toMatchObject({ status: 'searchLimit', value: null, lastVerifiedBound: 128_000_000 })
    expect(result.iterations).toBeGreaterThan(1)
    expect(result.residual!).toBeLessThan(0)
    expect(result.assumptions).toContain('proportionalCurrentAccountAllocation')
  })

  it('reports infeasible when zero spending cannot fund obligations', () => {
    const input: Inputs = { ...base, debts: [{ kind: 'other', balance: 100_000, annualPayment: 10_000, yearsRemaining: 10 }] }
    expect(maxSustainableSpending(input)).toMatchObject({ status: 'infeasible', value: null, lastVerifiedBound: 0 })
  })

  it('does not turn an unfunded future zero-spending purchase into a spending ceiling', () => {
    const input: Inputs = { ...base, principalResidence: {
      mode: 'planned', buyAtAge: 60, price: 500_000, downPayment: 500_000,
      appreciation: 0, netHoldingCostChange: 0, sellAtAge: null,
    } }
    expect(runProjection({ ...input, retirementSpending: 0 }).success).toBe(false)
    expect(maxSustainableSpending(input)).toMatchObject({ status: 'unsupported', value: null })
  })

  it('reports invalid for death before retirement and unsupported for future purchase', () => {
    expect(requiredFireAssets({ ...base, fireAge: 86 }).status).toBe('invalid')
    expect(maxSustainableSpending({ ...base, fireAge: 86 }).status).toBe('invalid')
    expect(requiredFireAssets({ ...base, principalResidence: {
      mode: 'planned', buyAtAge: 60, price: 500_000, downPayment: 500_000,
      appreciation: 0, netHoldingCostChange: 0, sellAtAge: null,
    } }).status).toBe('unsupported')
  })
})
