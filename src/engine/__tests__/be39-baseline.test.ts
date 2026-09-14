// Baseline evidence for BE-39 A. The same three probes were run against a
// clean e32dd4c worktree, where they failed for the reasons recorded in the PR:
// the FIRE-age change left the estimator amount stale, an amount already stated
// at its claim age was reduced a second time, and no source was recorded.
import { describe, expect, it } from 'vitest'
import { runProjection } from '../projection'
import { refreshCanonicalFromLegacy } from '../migration'
import { estimateCppAt65 } from '../benefits'
import { cppEstimatorProvenance, refreshPensionProvenance } from '../pensionProvenance'
import { statementProvenance } from '../pensionProvenance'
import { DEFAULT_INPUTS } from '../../store'
import type { Inputs } from '../types'

describe('BE-39 A baseline gaps', () => {
  it('a retirement-age change reprices an estimator CPP amount', () => {
    const at45: Inputs = {
      ...structuredClone(DEFAULT_INPUTS), fireAge: 45,
      cppAnnualAt65: Math.round(estimateCppAt65(25, 45, 1)),
      cppAmountSource: cppEstimatorProvenance({ retirementAge: 45, startWorkAge: 25, avgEarningsRatio: 1 }, 2026),
    }
    const at55 = refreshPensionProvenance({ ...at45, fireAge: 55 })
    expect(at55.cppAnnualAt65).toBe(Math.round(estimateCppAt65(25, 55, 1)))
    // and the plan still records that this is an estimate, now premised on 55
    expect(at55.cppAmountSource?.source).toBe('estimator')
    expect(at55.cppAmountSource?.premises?.retirementAge).toBe(55)
  })

  it('an already-early-claim amount is not reduced a second time', () => {
    const inputs: Inputs = {
      ...structuredClone(DEFAULT_INPUTS), cppStartAge: 60, cppAnnualAt65: 7_680,
      cppAmountSource: statementProvenance(2026, { basis: 'annual', ageBasis: 60, dollarBasis: 'today' }, 60),
      cppWork: { startWorkAge: 25, retireAge: 60 },
    }
    const row = runProjection(inputs).rows.find(r => r.age === 60)!
    // 7,680 is the statement's amount AT 60; the engine keeps it at 60 and does
    // not multiply by the 0.64 claiming factor again. Only the early-claim
    // dilution relief applies (1.1187608 at a retirement age of 60).
    expect(row.cpp).toBeCloseTo(7_680 * 1.1187608, 0)
  })

  it('records where a CPP amount came from', () => {
    const inputs: Inputs = {
      ...structuredClone(DEFAULT_INPUTS),
      cppAmountSource: cppEstimatorProvenance({ retirementAge: 45, startWorkAge: 25, avgEarningsRatio: 1 }, 2026),
    }
    const plan = refreshCanonicalFromLegacy(null, inputs)
    expect(plan.legacyProjection.cppAmountSource?.source).toBe('estimator')
    expect(plan.people[0].cppAmountSource?.source).toBe('estimator')
  })
})
