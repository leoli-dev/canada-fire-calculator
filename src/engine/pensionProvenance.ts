// BE-39 A: CPP/QPP and OAS amount provenance, and the retirement-age
// dependency invalidation that a FIRE-age change must trigger. The four sources
// fail differently:
//   manual    — a typed fact. Never changed, never flagged.
//   statement — a statement figure. Never changed; moves only its
//               `premisesNeedReview` flag.
//   estimator — this app's own work/residence estimate. Re-priced from the
//               same shared estimator, or flagged when the estimator has no
//               retirement-age input to re-price with (OAS residence).
//   unknown   — no source ever recorded (an older saved plan). Never treated
//               as an estimate.

import type { Inputs, PensionAmountProvenance, Province } from './types'
import type { Person } from './model'
import {
  cppAnnualAtBasis,
  earlyClaimDilutionRelief,
  estimateCppAt65,
  oasAnnualAtBasis,
} from './benefits'

/**
 * A recorded amount read into the engine's units: annual, age-65-basis,
 * today's dollars.
 */
export interface PensionAmountReading {
  annual: number
  /** The age the recorded figure is stated at; null = the 65 basis. */
  ageBasis: number | null
  fromMonthly: boolean
  source: PensionAmountProvenance['source']
}

/**
 * Read one recorded amount into the engine's units. The stored contract is
 * annual dollars: a monthly entry is multiplied by 12 exactly once, when it is
 * written. `basis` is kept as provenance — what the user typed — so the display
 * reverse and the audit trail are exact, and nothing multiplies again.
 */
export function normalizePensionAmount(
  amount: number,
  provenance: PensionAmountProvenance | undefined,
): PensionAmountReading {
  return {
    annual: amount,
    ageBasis: provenance?.ageBasis ?? null,
    fromMonthly: provenance?.basis === 'monthly',
    source: provenance?.source ?? 'unknown',
  }
}

/** The figure to show for an amount that is stored in annual dollars. */
export function pensionAmountDisplay(
  amount: number,
  provenance: PensionAmountProvenance | undefined,
): number {
  return provenance?.basis === 'monthly' ? amount / 12 : amount
}

/** The annual value to store for a figure entered in the recorded basis. */
export function pensionAmountFromDisplay(
  entered: number,
  provenance: PensionAmountProvenance | undefined,
): number {
  return provenance?.basis === 'monthly' ? entered * 12 : entered
}

/** What one recorded amount looks like once the current plan is applied. */
export interface PensionAmountDerivation {
  value: number
  provenance: PensionAmountProvenance
  /** The recorded premise no longer matched the plan when this was derived. */
  stale: boolean
}

/** A number read off a saved plan without inventing a source for it. */
function recordedProvenance(
  provenance: PensionAmountProvenance | undefined,
): PensionAmountProvenance {
  return provenance ?? { source: 'unknown', sourceYear: null, basis: 'annual', ageBasis: null, dollarBasis: 'today' }
}

/** Premises that an estimator actually assumed, if it recorded any. */
function estimatorPremises(
  provenance: PensionAmountProvenance,
): NonNullable<PensionAmountProvenance['premises']> | null {
  return provenance.source === 'estimator' && provenance.premises ? provenance.premises : null
}

/**
 * CPP/QPP dependency invalidation. An estimator amount is re-priced with the
 * same shared estimator and the recorded premises, with only the retirement age
 * advanced — the dependency the audit found broken, where `cppWork.retireAge`
 * captured at apply time drove a relief factor forever after. A statement or
 * manual amount is returned untouched; only the statement is flagged.
 */
export function deriveCppAmount(
  current: number,
  provenance: PensionAmountProvenance | undefined,
  retirementAge: number,
): PensionAmountDerivation {
  const recorded = recordedProvenance(provenance)
  const premises = estimatorPremises(recorded)
  if (!premises) {
    const needsReview = recorded.source === 'statement' &&
      !!recorded.premises && recorded.premises.retirementAge !== retirementAge
    return {
      value: current,
      provenance: { ...recorded, premisesNeedReview: needsReview || undefined },
      stale: needsReview,
    }
  }
  // A work-history estimate is defined at 65 and today's dollars, so the
  // recomputed figure stays on the same basis the estimator produced.
  const value = Math.round(estimateCppAt65(
    premises.startWorkAge ?? 25,
    retirementAge,
    premises.avgEarningsRatio ?? 1,
  ))
  // "Stale" is exactly "the premise the amount was *recorded* under no longer
  // matches the plan" — not merely "the arithmetic moved". It is read before
  // the recorded premise is advanced, so returning to the originally recorded
  // age clears the flag again rather than latching it.
  const stale = premises.retirementAge !== retirementAge
  return {
    value,
    provenance: {
      ...recorded,
      premises: { ...premises, retirementAge },
      premisesNeedReview: undefined,
    },
    stale,
  }
}

/**
 * OAS dependency invalidation. The OAS estimator is residence-based and takes
 * no retirement age, so there is nothing to re-price: rather than silently
 * assert residence years a different retirement age may contradict, the amount
 * is kept and the premise is flagged for re-confirmation — the "explicitly
 * flagged" arm of the requirement.
 */
export function deriveOasAmount(
  current: number,
  provenance: PensionAmountProvenance | undefined,
  retirementAge: number,
): PensionAmountDerivation {
  const recorded = recordedProvenance(provenance)
  const premises = estimatorPremises(recorded)
  if (premises) {
    const stale = premises.retirementAge !== retirementAge
    return {
      value: current,
      provenance: { ...recorded, premisesNeedReview: stale || undefined },
      stale,
    }
  }
  const needsReview = statementPremiseNeedsReview(recorded, retirementAge)
  return {
    value: current,
    provenance: { ...recorded, premisesNeedReview: needsReview || undefined },
    stale: needsReview,
  }
}

/**
 * A statement amount keeps its number; only its assumed retirement age can
 * drift. An entry with no recorded premise is re-confirmed once, then recorded.
 */
function statementPremiseNeedsReview(
  recorded: PensionAmountProvenance,
  retirementAge: number,
): boolean {
  if (recorded.source !== 'statement') return false
  const assumed = recorded.premises?.retirementAge
  return assumed === undefined ? true : assumed !== retirementAge
}

/** What one field's provenance says about the plan as it stands now. */
export type PensionAmountWarning =
  /** An estimator OAS value has no retirement-age input to recompute; re-confirm. */
  | { kind: 'estimatorNeedsReview' }
  /** A statement amount's retirement-age premise needs re-confirmation. */
  | { kind: 'premisesNeedReview' }

/**
 * The visible consequence of the invalidation rules, in one place so the
 * professional panel, the guided page and the tests agree. A `manual` value and
 * one with no recorded source are never flagged: neither has a premise a
 * retirement-age change could invalidate.
 */
export function pensionAmountWarning(
  provenance: PensionAmountProvenance | undefined,
  kind: 'cpp' | 'oas',
  retirementAge: number,
): PensionAmountWarning | null {
  if (!provenance) return null
  if (provenance.source === 'unknown' || provenance.source === 'manual') return null
  if (provenance.source === 'statement') {
    return provenance.premisesNeedReview ? { kind: 'premisesNeedReview' } : null
  }
  const premises = provenance.premises
  if (!premises) return null
  // A CPP estimator amount has already been re-priced from the same estimator
  // with the current retirement age, so there is nothing left to warn about —
  // the recorded premise and the amount both match the plan (`kind` is kept in
  // the signature because OAS fails differently).
  if (kind === 'cpp') return null
  // OAS residence cannot be re-priced from a retirement age at all, so drift
  // there is a real open question and must ask for confirmation.
  return premises.retirementAge === retirementAge ? null : { kind: 'estimatorNeedsReview' }
}

/**
 * Apply the dependency rules to one person's CPP/QPP and OAS figures.
 * `retirementAge` is that person's current retirement age, so a FIRE-age change
 * is the trigger. Only estimator CPP amounts change value.
 */
export function syncPensionAmounts(person: {
  cppAnnualAt65: number
  oasAnnualAt65: number
  cppAmountSource?: PensionAmountProvenance
  oasAmountSource?: PensionAmountProvenance
}, retirementAge: number): {
  cppAnnualAt65: number
  oasAnnualAt65: number
  cppAmountSource?: PensionAmountProvenance
  oasAmountSource?: PensionAmountProvenance
} {
  // A plan that never recorded a source stays that way: this function must not
  // manufacture an `unknown` record just because it ran. A record is written
  // only where one already existed (or where the amount was re-priced).
  const cpp = person.cppAmountSource === undefined
    ? { value: person.cppAnnualAt65, provenance: undefined }
    : deriveCppAmount(person.cppAnnualAt65, person.cppAmountSource, retirementAge)
  const oas = person.oasAmountSource === undefined
    ? { value: person.oasAnnualAt65, provenance: undefined }
    : deriveOasAmount(person.oasAnnualAt65, person.oasAmountSource, retirementAge)
  return {
    cppAnnualAt65: cpp.value,
    oasAnnualAt65: oas.value,
    cppAmountSource: cpp.provenance,
    oasAmountSource: oas.provenance,
  }
}

/**
 * Invalidate the estimator-derived component of a retirement-age change. A pure
 * function over `Inputs`, run by the store on every edit, so a stale
 * `cppWork`-style snapshot cannot survive a `fireAge` change. It only *writes*
 * an `estimator`-sourced amount; manual and statement values pass through with
 * their flag recomputed.
 */
export function refreshPensionProvenance(inputs: Inputs): Inputs {
  const self = syncPensionAmounts(inputs, inputs.fireAge)
  // The engine keeps only one FIRE age for the household, so a partner's
  // retirement age is the age they have reached when the primary retires —
  // the same relation the canonical migration records.
  const partnerRetirementAge = inputs.partner
    ? inputs.partner.currentAge + (inputs.fireAge - inputs.currentAge)
    : 0
  const partner = inputs.partner
    ? syncPensionAmounts(inputs.partner, partnerRetirementAge)
    : null
  return {
    ...inputs,
    cppAnnualAt65: self.cppAnnualAt65,
    oasAnnualAt65: self.oasAnnualAt65,
    cppAmountSource: self.cppAmountSource ?? inputs.cppAmountSource,
    oasAmountSource: self.oasAmountSource ?? inputs.oasAmountSource,
    partner: inputs.partner && partner
      ? {
          ...inputs.partner,
          cppAnnualAt65: partner.cppAnnualAt65,
          oasAnnualAt65: partner.oasAnnualAt65,
          cppAmountSource: partner.cppAmountSource ?? inputs.partner.cppAmountSource,
          oasAmountSource: partner.oasAmountSource ?? inputs.partner.oasAmountSource,
        }
      : inputs.partner,
  }
}

/** The provenance that an `Apply` from the CPP estimator records. */
export function cppEstimatorProvenance(
  premises: { retirementAge: number; startWorkAge: number; avgEarningsRatio: number },
  sourceYear: number,
): PensionAmountProvenance {
  return {
    source: 'estimator',
    sourceYear,
    basis: 'annual',
    ageBasis: null,
    dollarBasis: 'today',
    premises,
  }
}

/** The provenance that an `Apply` from the OAS estimator records. */
export function oasEstimatorProvenance(
  premises: { retirementAge: number; residenceYearsBy65: number },
  sourceYear: number,
): PensionAmountProvenance {
  return {
    source: 'estimator',
    sourceYear,
    basis: 'annual',
    ageBasis: null,
    dollarBasis: 'today',
    premises,
  }
}

/** A value typed by hand: a fact, never recalculated, never flagged. */
export function manualProvenance(sourceYear: number): PensionAmountProvenance {
  return { source: 'manual', sourceYear, basis: 'annual', ageBasis: null, dollarBasis: 'today' }
}

/**
 * A statement value entered as monthly or annual at its own stated age. The
 * retirement age assumed at entry is recorded so a later change can raise the
 * review flag instead of silently re-pricing the statement.
 */
export function statementProvenance(
  sourceYear: number,
  unit: { basis: 'monthly' | 'annual'; ageBasis: number | null; dollarBasis: 'today' | 'nominal' },
  retirementAge: number,
): PensionAmountProvenance {
  return { source: 'statement', sourceYear, ...unit, premises: { retirementAge } }
}

/**
 * Re-confirm a statement amount against the plan as it stands: the value is
 * kept, the recorded premise is adopted, and the review flag clears. This is
 * the only thing that clears it — nothing clears it silently.
 */
export function reconfirmStatementAmount(
  amount: number,
  provenance: PensionAmountProvenance | undefined,
  retirementAge: number,
): { cppAnnualAt65: number; cppAmountSource: PensionAmountProvenance } {
  const recorded = recordedProvenance(provenance)
  return {
    cppAnnualAt65: amount,
    cppAmountSource: {
      ...recorded,
      source: recorded.source === 'unknown' ? 'statement' : recorded.source,
      premises: { ...recorded.premises, retirementAge },
      premisesNeedReview: undefined,
    },
  }
}

/**
 * The annual CPP/QPP a person receives at a claim age, on the shared formula.
 * This is the one entry point the projection, the candidate scan and the timing
 * card all call, so a candidate row cannot disagree with the projection it
 * ranks. Two independent pieces, each applied at most once: the start-age
 * factor relative to the amount's own recorded basis (so an amount already
 * stated at its claim age is not reduced twice), and the dilution relief from
 * the *current* retirement age. OAS's 75+ top-up is OAS and stays with its
 * caller.
 */
export function personCppAnnual(
  person: Pick<Person, 'retirementAge' | 'cppWork'>,
  claimAge: number,
  province: Province | undefined,
  amount: number,
  basisAge: number | null = null,
): number {
  if (claimAge < 60) return 0
  const maxAge = province === 'QC' ? 72 : 70
  const work = person.cppWork
  const relief = work
    ? earlyClaimDilutionRelief(work.startWorkAge, person.retirementAge, claimAge)
    : 1
  return cppAnnualAtBasis(amount, basisAge, claimAge, maxAge) * relief
}

/**
 * The CPP/QPP amount for one `Inputs`-shaped person at a claim age. `claimAge`
 * is the age claimed at (normally `cppStartAge`), not the projection row's
 * calendar age: the caller owns the "reached the start age" gate.
 */
export function inputsCppAnnual(
  input: Pick<Inputs, 'cppStartAge' | 'cppAnnualAt65' | 'cppWork' | 'cppAmountSource'>,
  claimAge: number,
  province: Province | undefined,
  retirementAge: number,
): number {
  const reading = normalizePensionAmount(input.cppAnnualAt65, input.cppAmountSource)
  return personCppAnnual(
    { retirementAge, cppWork: input.cppWork ?? null },
    claimAge,
    province,
    reading.annual,
    reading.ageBasis,
  )
}

/** The annual OAS for one canonical person at a given claim age. */
export function personOasAnnual(
  amount: number,
  claimAge: number,
  basisAge: number | null = null,
): number {
  if (claimAge < 65) return 0
  return oasAnnualAtBasis(amount, basisAge, claimAge)
}

/**
 * The OAS amount shown for one `Inputs`-shaped person at a given claim age.
 * Like `inputsCppAnnual`, the caller owns the "reached the start age" gate.
 */
export function inputsOasAnnual(
  input: Pick<Inputs, 'oasStartAge' | 'oasAnnualAt65' | 'oasAmountSource'>,
  claimAge: number,
): number {
  const reading = normalizePensionAmount(input.oasAnnualAt65, input.oasAmountSource)
  return personOasAnnual(reading.annual, claimAge, reading.ageBasis)
}
