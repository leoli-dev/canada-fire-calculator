// Baseline evidence for BE-39 A. This file is a *head* regression test: it
// imports `cppEstimatorProvenance` / `refreshPensionProvenance` /
// `statementProvenance` and the `cppAmountSource` field, none of which exist at
// base `e32dd4c`, so it cannot execute there. The semantic gap it guards is
// stated as a literal in each case. Only the third case is a genuine semantic
// baseline failure at `e32dd4c` (the first two are unmatched because the
// concept did not exist there); the reviewer independently reproduced it with
// base-only APIs and measured `5_476.94` for the reduce-twice path.
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
    // 7,680 is the statement's amount AT 60, so nothing may apply the 0.64
    // early-claim factor a second time. At base the row was
    // 7,680 × 0.64 × 1.1142857142857143 (the `cppWork.retireAge` of 60 drove the
    // relief then) = 5,476.94. Only the dilution relief for the *current*
    // retirement age applies now. `DEFAULT_INPUTS.fireAge` is 45, and
    // `earlyClaimDilutionRelief(25, 45, 60) = 1.1187607573149743`, so the row
    // is 7,680 × 1.1187607573149743 = 8,592.082616179003. The relief is read
    // from the plan's retirement age, so `cppWork.retireAge` no longer changes
    // the result (30, 45 and 60 all give this value).
    expect(row.cpp).toBeCloseTo(8_592.082616179003, 6)
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
