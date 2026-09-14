import type { Contribution, InputsV2, Known, Person } from './model'
import { resolveYearAllocation } from './funding'

/**
 * BE-12 A: a recomputable RRSP room ledger for one person and one calendar
 * year. Every figure is either a recorded CRA statement fact or the result of
 * the identity `closing = opening + additions + adjustments - applied`, so the
 * row can be re-derived from its parts and carried into the next year without
 * drift.
 *
 * Nothing here invents a room addition. The published rule package (BE-38 A)
 * has no RRSP dollar cap and no 18%-of-earned-income rate, so an addition that
 * would need them is passed in as an explicit `Known` and stays `unknown` until
 * a sourced value exists.
 */

export const RRSP_ADDITION_RULE_MISSING =
  'RRSP room additions need a sourced annual dollar cap and 18% of prior-year earned income; the published rule package has neither, so no addition is invented'

/** PA, PSPA and PAR are separate CRA statement lines and are never merged. */
export interface RrspAdjustments {
  /** Pension adjustment (T4 box 52). Reduces room. */
  pensionAdjustment: Known<number>
  /** Past service pension adjustment. Reduces room. */
  pspa: Known<number>
  /** Pension adjustment reversal. Restores room. */
  par: Known<number>
}

/**
 * `includedInStatement` records the adjustment lines for transparency while
 * leaving them out of the arithmetic, because a CRA statement's available room
 * already nets PA/PSPA/PAR. `appliedHere` is used only when the caller has an
 * addition rule that has not yet folded them in.
 */
export type RrspAdjustmentBasis = 'includedInStatement' | 'appliedHere'

export type RrspRoomLimitationCode =
  | 'roomUnknown'
  | 'additionUnsourced'
  | 'adjustmentUnknown'
  | 'statementMismatch'
  | 'deductionYearBeforeContribution'

export interface RrspRoomLimitation {
  code: RrspRoomLimitationCode
  detail: string
}

/** Contribution timing is stored per line; the contribution year is when the
 * room is used, the deduction year is when the deduction is claimed. */
export interface RrspContributionLine {
  id: string
  calendarYear: number
  /** `null` means "deduct in the contribution year" — a changeable policy. */
  deductionYear: number | null
  amount: number
}

export interface RrspRoomRequest {
  personId: string
  year: number
  openingRoom: Known<number>
  additions: Known<number>
  adjustments: RrspAdjustments
  adjustmentBasis: RrspAdjustmentBasis
  unusedUndeducted: Known<number>
  deductionLimit: Known<number>
  /** Statement-line disagreement carried in from `statementOpeningRoom`. */
  mismatch?: RrspRoomLimitation | null
  lines: RrspContributionLine[]
}

export interface RrspLineResult {
  id: string
  calendarYear: number
  deductionYear: number | null
  /** `deductionYear` when recorded, otherwise the contribution year (policy). */
  effectiveDeductionYear: number
  planned: number
  applied: number
  retained: number
}

export interface RrspRoomYear {
  personId: string
  year: number
  openingRoom: Known<number>
  additions: Known<number>
  /** Net adjustment actually applied to the arithmetic (see `adjustmentBasis`). */
  adjustments: Known<number>
  adjustmentBasis: RrspAdjustmentBasis
  pensionAdjustment: Known<number>
  pspa: Known<number>
  par: Known<number>
  unusedUndeducted: Known<number>
  deductionLimit: Known<number>
  planned: number
  applied: number
  /** Money that could not legally execute; retained, never deleted. */
  retained: number
  deductedThisYear: number
  deferredDeduction: number
  lines: RrspLineResult[]
  closingRoom: Known<number>
  /** True when a negative net room was clamped at zero. */
  clampedAtZero: boolean
  limitations: RrspRoomLimitation[]
}

export const RRSP_DEDUCTION_YEAR_POLICY =
  'A contribution with no recorded deduction year is deducted in its contribution year. That default is the plan policy choice, not a CRA fact; a later deduction year is recorded explicitly.'

export interface RrspStatementFacts {
  rrspDeductionLimit: Known<number>
  rrspAvailableRoom: Known<number>
  rrspUnusedUndeducted: Known<number>
  rrspPensionAdjustment: Known<number>
  rrspPspa: Known<number>
  rrspPar: Known<number>
}

/** Cents-scale money tolerance shared with the rest of the engine. */
export const RRSP_MONEY_TOLERANCE = 0.01

const roundCents = (value: number) => Math.round(value * 100) / 100
const nonnegativeKnown = (value: Known<number>): Known<number> =>
  value.status === 'known' && (value.value < 0 || !Number.isFinite(value.value))
    ? { status: 'unknown', reason: 'a recorded RRSP amount must be a finite nonnegative figure' }
    : value

/**
 * The one definition of the CRA statement's own arithmetic: deduction limit
 * less contributions already made but not deducted, floored at zero, plus the
 * over-contribution that a negative raw figure implies. A statement never shows
 * negative available room — an over-contributor's room line reads zero — so
 * every consistency check compares against the floored figure. `null` means a
 * required line is unknown, which is not the same as a real zero.
 */
export function derivedStatementRoom(limitValue: number | null, unusedValue: number | null):
  { room: number | null; overContribution: number } {
  if (limitValue === null || unusedValue === null) return { room: null, overContribution: 0 }
  const raw = roundCents(limitValue - unusedValue)
  return { room: Math.max(0, raw), overContribution: raw < 0 ? roundCents(-raw) : 0 }
}

/**
 * The statement's "available contribution room" line when it is present,
 * otherwise its own arithmetic: deduction limit less contributions already made
 * but not deducted, floored at zero. Two known lines that disagree are refused
 * rather than silently preferring one; a statement that shows the floored zero
 * while unused contributions exceed the deduction limit is a real
 * over-contribution, reported as such instead of as a contradiction.
 */
export function statementOpeningRoom(facts: RrspStatementFacts): { room: Known<number>; mismatch: RrspRoomLimitation | null; overContribution: number } {
  const limit = nonnegativeKnown(facts.rrspDeductionLimit)
  const unused = nonnegativeKnown(facts.rrspUnusedUndeducted)
  const explicit = nonnegativeKnown(facts.rrspAvailableRoom)
  const limitValue = limit.status === 'known' ? limit.value : null
  const unusedValue = unused.status === 'known' ? unused.value : null
  const { room: derived, overContribution } = derivedStatementRoom(limitValue, unusedValue)
  if (explicit.status === 'known' && derived !== null && Math.abs(explicit.value - derived) > RRSP_MONEY_TOLERANCE) {
    return {
      room: { status: 'unknown', reason: 'CRA statement available room disagrees with deduction limit less unused contributions' },
      mismatch: {
        code: 'statementMismatch',
        detail: `statement available room ${explicit.value} does not equal deduction limit ${limitValue} less unused contributions ${unusedValue}`,
      },
      overContribution: 0,
    }
  }
  if (explicit.status === 'known') return { room: explicit, mismatch: null, overContribution }
  if (derived !== null) return { room: { status: 'known', value: derived }, mismatch: null, overContribution }
  const reason = explicit.status === 'unknown' && limit.status === 'unknown' && unused.status === 'unknown'
    ? 'CRA statement room, deduction limit and unused contributions are all missing'
    : 'CRA statement available room is incomplete'
  return { room: { status: 'unknown', reason }, mismatch: null, overContribution: 0 }
}

/** Net adjustment applied to room when the caller still has to apply it. */
export function netAdjustments(adjustments: RrspAdjustments, basis: RrspAdjustmentBasis): Known<number> {
  if (basis === 'includedInStatement') return { status: 'known', value: 0 }
  const missing = [
    adjustments.pensionAdjustment.status === 'unknown' ? adjustments.pensionAdjustment.reason : null,
    adjustments.pspa.status === 'unknown' ? adjustments.pspa.reason : null,
    adjustments.par.status === 'unknown' ? adjustments.par.reason : null,
  ].filter((reason): reason is string => reason !== null)
  if (missing.length) return { status: 'unknown', reason: `PA/PSPA/PAR not confirmed: ${missing.join('; ')}` }
  const pa = (adjustments.pensionAdjustment as { value: number }).value
  const pspa = (adjustments.pspa as { value: number }).value
  const par = (adjustments.par as { value: number }).value
  return { status: 'known', value: roundCents(par - pspa - pa) }
}

const BLOCKING: ReadonlySet<RrspRoomLimitationCode> = new Set([
  'roomUnknown', 'additionUnsourced', 'adjustmentUnknown', 'statementMismatch',
])

/**
 * Price one person-year. Clipping happens line by line so each retained amount
 * stays attached to the contribution that could not execute, and the deduction
 * timing split follows the clipped amounts (only applied money is deducted).
 */
export function rrspRoomYear(request: RrspRoomRequest): RrspRoomYear {
  const openingRoom = nonnegativeKnown(request.openingRoom)
  const additions = nonnegativeKnown(request.additions)
  const unusedUndeducted = nonnegativeKnown(request.unusedUndeducted)
  const deductionLimit = nonnegativeKnown(request.deductionLimit)
  const adjustments = netAdjustments(request.adjustments, request.adjustmentBasis)
  const limitations: RrspRoomLimitation[] = []
  if (request.mismatch) limitations.push(request.mismatch)
  if (openingRoom.status === 'unknown') limitations.push({ code: 'roomUnknown', detail: openingRoom.reason })
  if (additions.status === 'unknown') limitations.push({ code: 'additionUnsourced', detail: additions.reason })
  if (adjustments.status === 'unknown') limitations.push({ code: 'adjustmentUnknown', detail: adjustments.reason })
  const blocked = limitations.some(item => BLOCKING.has(item.code))
  const planned = roundCents(request.lines.reduce((total, line) => total + line.amount, 0))
  let applied = 0
  let deductedThisYear = 0
  let deferredDeduction = 0
  let closing = 0
  let clampedAtZero = false
  const lineResults: RrspLineResult[] = request.lines.map(line => {
    const amount = Math.max(0, roundCents(line.amount))
    return {
      id: line.id, calendarYear: line.calendarYear, deductionYear: line.deductionYear,
      effectiveDeductionYear: line.deductionYear ?? line.calendarYear,
      planned: amount, applied: 0, retained: amount,
    }
  })
  if (!blocked) {
    const rawAvailable = (openingRoom as { value: number }).value + (additions as { value: number }).value + (adjustments as { value: number }).value
    clampedAtZero = rawAvailable < 0
    let remaining = Math.max(0, rawAvailable)
    for (const result of lineResults) {
      const take = roundCents(Math.min(result.planned, remaining))
      result.applied = take
      result.retained = roundCents(result.planned - take)
      applied = roundCents(applied + take)
      remaining = roundCents(remaining - take)
      if (result.effectiveDeductionYear === request.year) deductedThisYear = roundCents(deductedThisYear + take)
      else if (result.effectiveDeductionYear > request.year) deferredDeduction = roundCents(deferredDeduction + take)
      else if (take > 0) limitations.push({
        code: 'deductionYearBeforeContribution',
        detail: `contribution ${result.id} for ${result.calendarYear} asks for a ${result.effectiveDeductionYear} deduction; the first-60-days rule that would allow it is not wired`,
      })
    }
    closing = roundCents(remaining)
  }
  const retained = roundCents(planned - applied)
  const closingRoom: Known<number> = blocked
    ? { status: 'unknown', reason: limitations.filter(item => BLOCKING.has(item.code)).map(item => item.detail).join('; ') }
    : { status: 'known', value: closing }
  return {
    personId: request.personId,
    year: request.year,
    openingRoom,
    additions,
    adjustments,
    adjustmentBasis: request.adjustmentBasis,
    pensionAdjustment: request.adjustments.pensionAdjustment,
    pspa: request.adjustments.pspa,
    par: request.adjustments.par,
    unusedUndeducted,
    deductionLimit,
    planned,
    applied,
    retained,
    deductedThisYear,
    deferredDeduction,
    lines: lineResults,
    closingRoom,
    clampedAtZero,
    limitations,
  }
}

/** The one RRSP account a person owns, or an explicit "cannot tell" answer. */
export function ownRrspAccount(plan: Pick<InputsV2, 'accounts'>, personId: string): { accountId: string | null; ambiguous: boolean } {
  const owned = plan.accounts.filter(account => account.kind === 'rrsp' && account.ownerId === personId)
  if (owned.length === 1) return { accountId: owned[0].id, ambiguous: false }
  return { accountId: null, ambiguous: owned.length > 1 }
}

/** Deterministic input order: contribution year, then deduction year, then id. */
export function sortRrspLines(lines: RrspContributionLine[]): RrspContributionLine[] {
  return [...lines].sort((left, right) =>
    left.calendarYear - right.calendarYear ||
    (left.deductionYear ?? left.calendarYear) - (right.deductionYear ?? right.calendarYear) ||
    left.id.localeCompare(right.id))
}

/** Contribution rows recorded for one person for one calendar year. */
export function contributionLinesFor(contributions: Contribution[], personId: string, year: number): RrspContributionLine[] {
  return sortRrspLines(contributions
    .filter(contribution => contribution.calendarYear === year && contribution.contributorId === personId && contribution.amount > 0)
    .map(contribution => ({
      id: contribution.id,
      calendarYear: contribution.calendarYear,
      deductionYear: contribution.deductionYear,
      amount: contribution.amount,
    })))
}

/**
 * Every RRSP contribution line a plan makes for one person in one calendar
 * year: the recorded rows plus the RRSP share of the resolved voluntary savings
 * split. The kernel prices exactly these lines and the panel shows exactly this
 * ledger, so the displayed "planned"/"retained" figures cannot drift from the
 * kernel's (DM01 parity). `savingsShare` is
 * `resolveYearAllocation(plan, year).voluntary.rrsp`, computed by the same
 * function for both callers.
 */
export function plannedRrspLines(args: {
  contributions: Contribution[]
  personId: string
  year: number
  savingsShare: number
}): RrspContributionLine[] {
  const lines = contributionLinesFor(args.contributions, args.personId, args.year)
  const share = roundCents(Math.max(0, args.savingsShare))
  // Same synthetic id the kernel records, so the two ledgers are identical
  // objects and the applied row is attributable in the contribution history.
  if (share > 0) lines.push({ id: `annual:${args.year}:rrsp`, calendarYear: args.year, deductionYear: null, amount: share })
  return lines
}

export interface RrspRoomPreview {
  opening: ReturnType<typeof statementOpeningRoom>
  ledger: RrspRoomYear
  /** RRSP share of the year's voluntary savings split, a part of `ledger`. */
  savingsShare: number
}

/**
 * The panel-facing base-year ledger for one person. It reuses the same
 * statement arithmetic, the same planned-line set and the same resolved
 * allocation as `annualStep`, so the panel does not recompute a partial view of
 * the plan (the B1 defect). Later years are not previewed because they would
 * need the missing sourced room-addition rule.
 */
export function previewRrspRoomYear(plan: InputsV2, person: Person): RrspRoomPreview {
  const year = plan.baseYear
  const opening = statementOpeningRoom({
    rrspDeductionLimit: person.rrspDeductionLimit, rrspAvailableRoom: person.rrspAvailableRoom,
    rrspUnusedUndeducted: person.rrspUnusedUndeducted, rrspPensionAdjustment: person.rrspPensionAdjustment,
    rrspPspa: person.rrspPspa, rrspPar: person.rrspPar,
  })
  // A couple's voluntary RRSP split is refused by the kernel (attribution not
  // wired), so it is priced for neither ledger.
  const savingsShare = plan.people.length === 1 ? resolveYearAllocation(plan, year).voluntary.rrsp : 0
  const ledger = rrspRoomYear({
    personId: person.id, year, openingRoom: opening.room, mismatch: opening.mismatch,
    // The statement's available room already includes the statement year's own
    // addition; a later year would need the sourced cap/18% rule.
    additions: { status: 'known', value: 0 },
    adjustments: { pensionAdjustment: person.rrspPensionAdjustment, pspa: person.rrspPspa, par: person.rrspPar },
    adjustmentBasis: 'includedInStatement',
    unusedUndeducted: person.rrspUnusedUndeducted, deductionLimit: person.rrspDeductionLimit,
    lines: plannedRrspLines({ contributions: plan.contributions, personId: person.id, year, savingsShare }),
  })
  return { opening, ledger, savingsShare }
}
