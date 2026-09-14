import { describe, expect, it } from 'vitest'
import {
  CPP_MAX_AT_65,
  CPP_OAS_UNSUPPORTED_PATHS,
  OAS_FULL_AT_65,
  cppAnnual,
  cppEstimatorProvenance,
  deriveCppAmount,
  deriveOasAmount,
  earlyClaimDilutionRelief,
  estimateCppAt65,
  estimateOasAt65,
  inputsCppAnnual,
  inputsOasAnnual,
  manualProvenance,
  normalizePensionAmount,
  oasEstimatorProvenance,
  pensionAmountDisplay,
  pensionAmountFromDisplay,
  pensionAmountWarning,
  provenanceForTypedAmount,
  reconfirmStatementAmount,
  refreshPensionProvenance,
  refreshPensionProvenanceReport,
  statementProvenance,
} from '../index'
import { refreshCanonicalFromLegacy } from '../migration'
import { DEFAULT_INPUTS } from '../../store'
import type { Inputs, PensionAmountProvenance } from '../types'

const base = (): Inputs => structuredClone(DEFAULT_INPUTS)

/** The estimator's own premise record, as the Apply button writes it. */
const cppEstimate = (retirementAge: number, startWorkAge: number, ratio: number) =>
  cppEstimatorProvenance({ retirementAge, startWorkAge, avgEarningsRatio: ratio }, 2026)

const oasEstimate = (retirementAge: number, residenceYearsBy65: number) =>
  oasEstimatorProvenance({ retirementAge, residenceYearsBy65 }, 2026)

describe('BE-39 A: CPP/QPP amount provenance', () => {
  it('recomputes an estimator amount from the same estimator when the retirement age moves', () => {
    const at45 = cppEstimate(45, 25, 1)
    const applied = deriveCppAmount(0, at45, 45)
    // independent literal, not a re-derivation: `estimateCppAt65(25, 45, 1)`
    expect(applied.value).toBe(9_278)
    expect(applied.provenance.premises?.retirementAge).toBe(45)

    const moved = deriveCppAmount(applied.value, applied.provenance, 55)
    expect(moved.value).toBe(13_917)
    // 30 credited years of 39 instead of 20 — the estimate must move, not rot.
    expect(moved.value).toBeGreaterThan(applied.value)
    expect(moved.provenance.premises?.retirementAge).toBe(55)
    expect(moved.stale).toBe(true)
  })

  it('does not touch a manual amount and never flags it', () => {
    const manual = manualProvenance(2026)
    const derived = deriveCppAmount(12_345, manual, 55)
    expect(derived.value).toBe(12_345)
    expect(derived.provenance.source).toBe('manual')
    expect(derived.stale).toBe(false)
    expect(pensionAmountWarning(derived.provenance, 'cpp', 55)).toBeNull()
  })

  it('reverting the retirement age restores the original estimator amount and source', () => {
    const applied = deriveCppAmount(0, cppEstimate(45, 25, 1), 45)
    const moved = deriveCppAmount(applied.value, applied.provenance, 55)
    const reverted = deriveCppAmount(moved.value, moved.provenance, 45)
    expect(reverted.value).toBe(applied.value)
    expect(reverted.provenance.source).toBe('estimator')
    // the re-priced amount is the originally applied one, and the premise it
    // was last recorded under (55) is what the revert had to undo
    expect(reverted.stale).toBe(true)
    expect(reverted.provenance.premises?.retirementAge).toBe(45)
    const settled = deriveCppAmount(reverted.value, reverted.provenance, 45)
    expect(settled.stale).toBe(false)
  })

  it('never overwrites a statement amount: it keeps the number and raises the flag', () => {
    const statement = statementProvenance(2026, { basis: 'annual', ageBasis: 65, dollarBasis: 'today' }, 45)
    const derived = deriveCppAmount(14_000, statement, 55)
    expect(derived.value).toBe(14_000)
    expect(derived.provenance.source).toBe('statement')
    expect(derived.provenance.premisesNeedReview).toBe(true)
    expect(pensionAmountWarning(derived.provenance, 'cpp', 55)).toEqual({ kind: 'premisesNeedReview' })
    // and the flag clears only when the plan agrees with the recorded premise
    const sameAge = deriveCppAmount(14_000, statement, 45)
    expect(sameAge.provenance.premisesNeedReview).toBeUndefined()
    expect(pensionAmountWarning(sameAge.provenance, 'cpp', 45)).toBeNull()
  })

  it('re-confirming a statement adopts the current age without changing the amount', () => {
    const stale = deriveCppAmount(14_000,
      statementProvenance(2026, { basis: 'annual', ageBasis: 65, dollarBasis: 'today' }, 45), 55).provenance
    const reconfirmed = reconfirmStatementAmount(14_000, stale, 55)
    expect(reconfirmed.cppAnnualAt65).toBe(14_000)
    expect(reconfirmed.cppAmountSource.premises?.retirementAge).toBe(55)
    expect(reconfirmed.cppAmountSource.premisesNeedReview).toBeUndefined()
  })

  it('leaves an OAS estimator amount alone and flags the residence premise instead', () => {
    const at45 = deriveOasAmount(9_024, oasEstimate(45, 40), 45)
    expect(at45.stale).toBe(false)
    const moved = deriveOasAmount(9_024, at45.provenance, 55)
    // OAS is residence-based: no arithmetic to do, so it must ask, not invent.
    expect(moved.value).toBe(9_024)
    expect(moved.stale).toBe(true)
    expect(pensionAmountWarning(moved.provenance, 'oas', 55)).toEqual({ kind: 'estimatorNeedsReview' })
  })

  it('treats a saved plan with no recorded source as unknown, not estimated', () => {
    const inputs = base()
    delete inputs.cppAmountSource
    delete inputs.oasAmountSource
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    expect(canonical.legacyProjection.cppAmountSource).toBeUndefined()
    expect(canonical.people[0].cppAmountSource).toBeUndefined()
    const synced = refreshPensionProvenance(inputs)
    expect(synced.cppAmountSource).toBeUndefined()
    expect(pensionAmountWarning(undefined, 'cpp', inputs.fireAge)).toBeNull()
    expect(normalizePensionAmount(inputs.cppAnnualAt65, undefined).source).toBe('unknown')
  })
})

describe('BE-39 A: early/late factors are applied exactly once', () => {
  it('prices CPP at 60/65/70 from the age-65 basis', () => {
    const inputs: Inputs = { ...base(), cppStartAge: 60, cppAnnualAt65: 12_000 }
    expect(inputsCppAnnual(inputs, 60, 'ON', inputs.fireAge)).toBeCloseTo(12_000 * 0.64, 6)
    const at65 = { ...inputs, cppStartAge: 65 }
    expect(inputsCppAnnual(at65, 65, 'ON', at65.fireAge)).toBeCloseTo(12_000, 6)
    const at70 = { ...inputs, cppStartAge: 70 }
    expect(inputsCppAnnual(at70, 70, 'ON', at70.fireAge)).toBeCloseTo(12_000 * 1.42, 6)
  })

  it('does not reduce an amount already stated at the claim age a second time', () => {
    const alreadyAt60: Inputs = {
      ...base(), cppStartAge: 60, cppAnnualAt65: 7_680,
      cppAmountSource: statementProvenance(2026, { basis: 'annual', ageBasis: 60, dollarBasis: 'today' }, 45),
    }
    expect(inputsCppAnnual(alreadyAt60, 60, 'ON', alreadyAt60.fireAge)).toBeCloseTo(7_680, 6)
    // the same number read as an age-65 basis would be re-reduced; the basis is
    // what distinguishes "already claimed early" from "at 65".
    const asBasis65: Inputs = { ...alreadyAt60, cppAmountSource: undefined }
    expect(inputsCppAnnual(asBasis65, 60, 'ON', asBasis65.fireAge)).toBeCloseTo(7_680 * 0.64, 6)
  })

  it('keeps the QPP deferral boundary at 72 in Quebec and 70 elsewhere', () => {
    const inputs: Inputs = { ...base(), province: 'QC', cppStartAge: 72, cppAnnualAt65: 12_000 }
    expect(inputsCppAnnual(inputs, 72, 'QC', inputs.fireAge)).toBeCloseTo(12_000 * 1.588, 6)
    // the same plan under CPP rules caps deferral at 70
    expect(inputsCppAnnual(inputs, 72, 'ON', inputs.fireAge)).toBeCloseTo(12_000 * 1.42, 6)
  })

  it('prices OAS at 65 and 70, and pays nothing before 65', () => {
    const inputs: Inputs = { ...base(), oasStartAge: 65, oasAnnualAt65: 9_024 }
    expect(inputsOasAnnual(inputs, 65)).toBeCloseTo(9_024, 6)
    expect(inputsOasAnnual(inputs, 70)).toBeCloseTo(9_024 * 1.36, 6)
    // no OAS is payable below 65; the caller owns the start-age gate
    expect(inputsOasAnnual(inputs, 64)).toBe(0)
    expect(inputsOasAnnual(inputs, 65)).toBeCloseTo(9_024, 6)
  })

  it('applies the early-claim dilution relief from the current retirement age', () => {
    // The estimator captured `retireAge: 30` at apply time; the plan now retires
    // at 60 and claims at 60. The two reliefs genuinely disagree (1.1188 from
    // the snapshot vs 1.1143 from the plan), so the actual annual amount tells
    // which age drove it.
    const inputs: Inputs = { ...base(), cppStartAge: 60, cppAnnualAt65: 12_000, fireAge: 60,
      cppWork: { startWorkAge: 25, retireAge: 30 } }
    const reliefNow = earlyClaimDilutionRelief(25, 60, 60)
    const reliefStale = earlyClaimDilutionRelief(25, 30, 60)
    expect(reliefNow).not.toBeCloseTo(reliefStale, 4)
    // Literal, not re-derived from the helpers under test: 12,000 × 0.64 ×
    // 1.1142857142857143 = 8,557.714285714286.
    expect(inputsCppAnnual(inputs, 60, 'ON', inputs.fireAge)).toBeCloseTo(8_557.714285714286, 6)
    // and the stale snapshot would have produced a different number
    expect(12_000 * cppAnnual(1, 60) * reliefStale).not.toBeCloseTo(
      12_000 * cppAnnual(1, 60) * reliefNow, 2)
  })

  it('does not reduce an OAS amount already stated at its claim age a second time', () => {
    const alreadyAt70: Inputs = {
      ...base(), oasStartAge: 70, oasAnnualAt65: 12_272.64,
      oasAmountSource: statementProvenance(2026, { basis: 'annual', ageBasis: 70, dollarBasis: 'today' }, 45),
    }
    // the statement already states the 70 figure: the ratio to its own basis is 1
    expect(inputsOasAnnual(alreadyAt70, 70)).toBeCloseTo(12_272.64, 6)
    // the same number read as an age-65 basis would be increased again
    const asBasis65: Inputs = { ...alreadyAt70, oasAmountSource: undefined }
    expect(inputsOasAnnual(asBasis65, 70)).toBeCloseTo(12_272.64 * 1.36, 6)
  })
})

describe('BE-39 A: recorded units convert exactly once', () => {
  it('stores an annual value for a monthly statement amount', () => {
    const statement = statementProvenance(2026, { basis: 'monthly', ageBasis: 65, dollarBasis: 'today' }, 45)
    expect(pensionAmountFromDisplay(1_000, statement)).toBe(12_000)
    expect(pensionAmountDisplay(12_000, statement)).toBe(1_000)
    // reading it back is not another multiplication
    expect(normalizePensionAmount(12_000, statement).annual).toBe(12_000)
    const inputs: Inputs = { ...base(), cppStartAge: 65, cppAnnualAt65: 12_000, cppAmountSource: statement }
    expect(inputsCppAnnual(inputs, 65, 'ON', inputs.fireAge)).toBeCloseTo(12_000, 6)
  })

  it('leaves an annual amount unconverted', () => {
    const annual = manualProvenance(2026)
    expect(pensionAmountFromDisplay(12_000, annual)).toBe(12_000)
    expect(pensionAmountDisplay(12_000, annual)).toBe(12_000)
    expect(normalizePensionAmount(12_000, annual).annual).toBe(12_000)
  })
})

describe('BE-39 A: the whole plan is made coherent on a retirement-age change', () => {
  it('rewrites only the estimator amount and keeps a statement amount put', () => {
    const inputs: Inputs = {
      ...base(),
      fireAge: 55,
      cppAnnualAt65: 9_278,
      cppAmountSource: cppEstimate(45, 25, 1),
      oasAnnualAt65: 14_000,
      oasAmountSource: statementProvenance(2026, { basis: 'annual', ageBasis: 65, dollarBasis: 'today' }, 45),
      partner: {
        currentAge: 40, cppStartAge: 65, cppAnnualAt65: 6_000, oasStartAge: 65, oasAnnualAt65: 8_000,
        cppAmountSource: cppEstimate(40, 25, 0.8),
      },
    }
    const synced = refreshPensionProvenance(inputs)
    expect(synced.cppAnnualAt65).toBe(13_917)
    expect(synced.cppAmountSource?.premises?.retirementAge).toBe(55)
    // a statement is a recorded fact: number and source both survive
    expect(synced.oasAnnualAt65).toBe(14_000)
    expect(synced.oasAmountSource?.source).toBe('statement')
    expect(synced.oasAmountSource?.premisesNeedReview).toBe(true)
    // the partner retires when the primary does (age 60); literal
    // `estimateCppAt65(25, 60, 0.8)` = 12,989
    expect(synced.partner?.cppAnnualAt65).toBe(12_989)
    expect(synced.partner?.cppAmountSource?.premises?.retirementAge).toBe(60)
  })

  it('is idempotent: a second pass changes nothing', () => {
    const inputs: Inputs = { ...base(), fireAge: 55, cppAnnualAt65: 9_278, cppAmountSource: cppEstimate(45, 25, 1) }
    const once = refreshPensionProvenance(inputs)
    const twice = refreshPensionProvenance(once)
    expect(twice.cppAnnualAt65).toBe(once.cppAnnualAt65)
    expect(twice.cppAmountSource).toEqual(once.cppAmountSource)
  })
})

describe('BE-39 A: a typed figure is never silently reverted', () => {
  it('adopts manual provenance for a figure typed over an estimator amount', () => {
    const typed = provenanceForTypedAmount(cppEstimate(45, 25, 1))
    expect(typed?.source).toBe('manual')
    // and the dependency pass then leaves the typed number exactly as it is
    const inputs: Inputs = {
      ...base(), fireAge: 55, cppAnnualAt65: 15_000, cppAmountSource: typed ?? undefined,
    }
    const synced = refreshPensionProvenance(inputs)
    expect(synced.cppAnnualAt65).toBe(15_000)
    expect(synced.cppAmountSource?.source).toBe('manual')
    expect(pensionAmountWarning(synced.cppAmountSource, 'cpp', 55)).toBeNull()
  })

  it('keeps a recorded statement source, whose amount box is its entry channel', () => {
    const statement = statementProvenance(2026, { basis: 'monthly', ageBasis: 60, dollarBasis: 'today' }, 45)
    expect(provenanceForTypedAmount(statement)).toBeNull()
    const manual = manualProvenance(2026)
    expect(provenanceForTypedAmount(manual)).toBeNull()
    // no recorded source at all is still "the user typed this"
    expect(provenanceForTypedAmount(undefined)?.source).toBe('manual')
    const unknown: PensionAmountProvenance = { source: 'unknown', sourceYear: null, basis: 'annual', ageBasis: null, dollarBasis: 'today' }
    expect(provenanceForTypedAmount(unknown)?.source).toBe('manual')
  })
})

describe('BE-39 A / B3: the pass reports its own rewrites, never a value diff', () => {
  it('flags a rewrite when the retirement-age premise moved, even if the amount is unchanged', () => {
    // `startWorkAge` 25 credits at most 39 years, so the estimator returns the
    // same number at 64 and at 70 while the premise genuinely moved. A value
    // diff cannot see this rewrite; the pass's own premise-based signal must.
    const at64 = deriveCppAmount(0, cppEstimate(64, 25, 1), 64)
    const at70 = deriveCppAmount(at64.value, at64.provenance, 70)
    expect(estimateCppAt65(25, 64, 1)).toBe(18_092)
    expect(estimateCppAt65(25, 70, 1)).toBe(18_092)
    expect(at70.value).toBe(at64.value)
    expect(at70.stale).toBe(true)
    expect(at70.rewritten).toBe(true)
  })

  it('does not report a rewrite when the premise did not move', () => {
    const applied = deriveCppAmount(0, cppEstimate(45, 25, 1), 45)
    expect(applied.rewritten).toBe(false)
    const settled = deriveCppAmount(applied.value, applied.provenance, 45)
    expect(settled.rewritten).toBe(false)
  })

  it('never reports a rewrite for a manual, statement or unrecorded amount', () => {
    expect(deriveCppAmount(12_345, manualProvenance(2026), 55).rewritten).toBe(false)
    const statement = statementProvenance(2026, { basis: 'annual', ageBasis: 65, dollarBasis: 'today' }, 45)
    expect(deriveCppAmount(14_000, statement, 55).rewritten).toBe(false)
    const unknown: PensionAmountProvenance = { source: 'unknown', sourceYear: null, basis: 'annual', ageBasis: null, dollarBasis: 'today' }
    expect(deriveCppAmount(12_000, unknown, 55).rewritten).toBe(false)
    // OAS residence cannot be re-priced from an age: it is flagged, not rewritten
    expect(deriveOasAmount(9_024, oasEstimate(45, 40), 55).rewritten).toBe(false)
  })

  it('reports exactly the amounts the plan-level pass re-derived', () => {
    const inputs: Inputs = { ...base(), fireAge: 55, cppAnnualAt65: 9_278, cppAmountSource: cppEstimate(45, 25, 1) }
    expect(refreshPensionProvenanceReport(inputs).rewritten)
      .toEqual([{ field: 'cppAnnualAt65', assumptionValue: 13_917 }])
    // an edit that moves no premise reports nothing: the settled plan is stable
    const settled = refreshPensionProvenance(inputs)
    expect(refreshPensionProvenanceReport(settled).rewritten).toEqual([])
  })
})

describe('BE-39 A: statutory reference points', () => {
  it('keeps the published 2026 maximums separate from an estimate', () => {
    // CPP/QPP and OAS figures the plan is measured against; an estimator value
    // is never presented as one of these.
    expect(cppAnnual(CPP_MAX_AT_65, 65)).toBe(CPP_MAX_AT_65)
    expect(OAS_FULL_AT_65).toBeGreaterThan(0)
    const inputs: Inputs = { ...base(), cppAnnualAt65: CPP_MAX_AT_65 }
    expect(inputsCppAnnual(inputs, 65, 'ON', inputs.fireAge)).toBeCloseTo(CPP_MAX_AT_65, 6)
  })

  it('declares every out-of-scope rule surface with a concrete reason', () => {
    // Not half-implemented: named, with the reason, and never read to compute.
    expect(CPP_OAS_UNSUPPORTED_PATHS.length).toBeGreaterThanOrEqual(4)
    const ids = CPP_OAS_UNSUPPORTED_PATHS.map(path => path.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const path of CPP_OAS_UNSUPPORTED_PATHS) {
      expect(path.id.trim().length).toBeGreaterThan(0)
      expect(path.reason.trim().length).toBeGreaterThan(40)
    }
    expect(ids).toEqual(expect.arrayContaining([
      'cpp-qpp-separate-dropout', 'oas-residence-eligibility',
      'db-indexation-start', 'provincial-benefit-interactions',
    ]))
  })

  it('does not price an amount whose source is unknown as zero or as an estimate', () => {
    const unknown: PensionAmountProvenance = { source: 'unknown', sourceYear: null, basis: 'annual', ageBasis: null, dollarBasis: 'today' }
    const inputs: Inputs = { ...base(), cppAnnualAt65: 12_000, cppAmountSource: unknown }
    expect(inputsCppAnnual(inputs, 65, 'ON', inputs.fireAge)).toBeCloseTo(12_000, 6)
    expect(refreshPensionProvenance(inputs).cppAmountSource?.source).toBe('unknown')
  })

  // N1 / round 3: the declared `oas-residence-eligibility` reason must describe
  // what the code does. Residence below the 10-year minimum is *priced* by the
  // prorated 0-40 scale, not refused, so the copy says so and this pins both the
  // behaviour and the absence of the false refusal clause.
  it('prices sub-minimum residence by the prorated scale, and says so', () => {
    expect(estimateOasAt65(3)).toBeCloseTo(676.8, 6)
    expect(estimateOasAt65(9)).toBeCloseTo(2_030.4, 6)
    expect(estimateOasAt65(40)).toBeCloseTo(9_024, 6)
    const reason = CPP_OAS_UNSUPPORTED_PATHS.find(path => path.id === 'oas-residence-eligibility')?.reason ?? ''
    expect(reason).not.toContain('refused')
    expect(reason).toContain('prorated')
  })
})
