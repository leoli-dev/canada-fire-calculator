import type { Account, InputsV2, Known, Provenance } from './model'
import { plannedFhsaContribution } from './fhsaPlan'
import { selectFhsaRules } from './rules'
import { RRSP_MONEY_TOLERANCE } from './rrspRoom'

/**
 * BE-36 A: a recomputable per-person FHSA participation-room ledger.
 *
 * Scope of this module: the annual participation room, the carry-forward of
 * unused room (bounded by its published maximum), the lifetime limit on
 * cumulative contributions and RRSP transfers, and statement-driven history.
 * Money never disappears — a contribution the room cannot execute is clipped
 * and retained — and room never goes negative.
 *
 * Explicitly out of scope (BE-36 B), refused by the kernel rather than
 * half-implemented here: the 15-year / age-71 maturity clock, the closure
 * deadline after a first qualifying withdrawal, rollover into an RRSP/RRIF,
 * qualifying versus non-qualifying withdrawals, home-purchase eligibility
 * gating, and the death event (BE-33).
 *
 * The two dollar limits come from the published rule package
 * (`selectFhsaRules`), never from a literal in this file. Everything else is a
 * statement fact the user supplies: room is never derived from a balance, and
 * a missing statement line stays unknown instead of becoming zero.
 */

/** Cents-scale money tolerance shared with the rest of the engine. */
export const FHSA_MONEY_TOLERANCE = RRSP_MONEY_TOLERANCE

export const FHSA_OPENING_YEAR_MISSING =
  'the FHSA opening year is not confirmed, so the participation year and the 15-year clock cannot be established'

export const FHSA_HISTORY_MISSING =
  'the FHSA contribution history is not confirmed, so available participation room and remaining lifetime room cannot be established'

export const FHSA_TRANSFER_HISTORY_UNVERIFIED =
  'RRSP-to-FHSA transfers cannot be verified from this plan, so a transfer is not priced against participation room'

export const FHSA_LIFETIME_SIMPLIFICATION =
  'remaining lifetime room is the published lifetime limit less all prior contributions and RRSP transfers recorded on the statement; the ledger does not add back FHSA re-participation room, designated amounts or taxable withdrawals, because none of those amounts is supplied'

/**
 * The lifetime limit bounds the whole spendable room, so a history that is
 * already past it can only be refused. Clamping it to zero would hide the
 * overshoot instead of naming it.
 */
export const FHSA_LIFETIME_EXCEEDED =
  'the recorded prior contributions and RRSP transfers already exceed the published lifetime limit, so the excess-FHSA-amount treatment would be needed; it is not implemented (BE-36 B) and no further contribution is priced'

/**
 * The statute caps how much unused participation room one year may carry
 * forward, so idle years cannot accumulate room without limit.
 */
export const FHSA_CARRY_FORWARD_CAPPED = (limit: number) =>
  `the unused room carried into the year is capped at the published participation-room carryforward maximum of ${limit} CAD; the room above that maximum is not spendable in the year`

export const FHSA_MATURITY_UNSUPPORTED =
  'the FHSA 15-year / age-71 maturity clock, RRSP/RRIF rollover, qualifying and non-qualifying withdrawals, home-purchase eligibility, and the death event are not implemented (BE-36 B)'

export const FHSA_OUT_OF_SCOPE =
  'FHSA maturity, rollover, qualifying and non-qualifying withdrawals, home-purchase eligibility and the death event remain unsupported (BE-36 B)'

/**
 * One person-year is priced against one account's participation room. More than
 * one active account cannot be attributed to a single ledger, so it is refused
 * with a reason instead of being dropped into a conservation failure.
 */
export const FHSA_MULTIPLE_ACTIVE_ACCOUNTS =
  'more than one active FHSA cannot be attributed to a single participation-room ledger; BE-36 A prices at most one active FHSA per plan (BE-36 B owns per-person accounts)'

export type FhsaRoomLimitationCode =
  | 'openingYearUnknown'
  | 'historyUnknown'
  | 'openingRoomUnknown'
  | 'accountNotOpen'
  | 'notYetOpen'
  | 'lifetimeCapped'
  | 'lifetimeExceeded'
  | 'annualCapped'
  | 'carryForwardCapped'
  | 'carryForwardUnavailable'
  | 'maturityUnsupported'
  | 'transferUnverified'
  | 'ownershipUnknown'
  | 'ambiguousAccount'

export interface FhsaRoomLimitation {
  code: FhsaRoomLimitationCode
  detail: string
}

/**
 * The statement lines the ledger needs. `cumulativePriorContributions` is the
 * T4FHSA / Schedule 15 total of every contribution **and** RRSP transfer made
 * before the year being priced, so a known zero is a real "nothing has ever
 * been contributed" answer and an absent entry is unknown, not zero.
 */
export interface FhsaStatementHistory {
  cumulativePriorContributions: Known<number>
  provenance: Provenance
}

/** Mirrors the RRSP ledger line result so a reviewer can compare the two. */
export interface FhsaLineResult {
  id: string
  calendarYear: number
  kind: 'ordinary' | 'rrspTransfer'
  planned: number
  applied: number
  retained: number
}

export interface FhsaLineRequestLine {
  id: string
  calendarYear: number
  amount: number
  /** `ordinary` is a contribution; `rrspTransfer` is a direct RRSP transfer. */
  kind: 'ordinary' | 'rrspTransfer'
}

export interface FhsaRoomRequest {
  personId: string
  accountId: string
  year: number
  /** Calendar year the first FHSA was opened. */
  openedYear: Known<number>
  /**
   * Participation room carried into `year` from earlier years. It is **not**
   * the CRA participation-room statement's figure for `year`, which already
   * contains the year's own addition; it is the unused room from before. It is
   * zero in the opening year and is the prior year's closing room after that.
   * The room actually spendable this year is `carryForward + annualAddition`,
   * where `carryForward` is this figure capped at the published participation-
   * room carryforward maximum, so `openingRoom` may hold room the statute does
   * not let the year use.
   */
  openingRoom: Known<number>
  /** Prior contributions and RRSP transfers. Absent means not supplied. */
  history?: FhsaStatementHistory
  /** The year's planned contributions and RRSP transfers, in execution order. */
  lines: FhsaLineRequestLine[]
}

export interface FhsaRoomYear {
  personId: string
  accountId: string
  year: number
  openingYear: Known<number>
  /** Participation room carried in from earlier years, before any statutory cap. */
  openingRoom: Known<number>
  /** The sourced room this year adds: the published annual limit, lifetime-bound. */
  annualAddition: Known<number>
  /** The carried-in room this year may actually use, capped by the sourced maximum. */
  carryForward: Known<number>
  /**
   * Annual room this year, including the capped carry-forward, before clipping
   * by the lifetime ceiling.
   */
  availableRoom: Known<number>
  /** RRSP transfers applied this year that occupy participation room. */
  rrspTransfers: Known<number>
  ordinaryPlanned: number
  planned: number
  applied: number
  /** Money the room could not execute; retained, never deleted. */
  retained: number
  closingRoom: Known<number>
  /**
   * Lifetime limit less all prior and this year's contributions/transfers. It
   * is a signed figure: a negative value is a real overshoot the caller must
   * refuse, never a room-floored zero.
   */
  remainingLifetimeRoom: Known<number>
  lifetimeLimit: Known<number>
  /** Cumulative contributions and RRSP transfers, prior plus applied. */
  cumulativeContributions: Known<number>
  lines: FhsaLineResult[]
  limitations: FhsaRoomLimitation[]
}

const roundCents = (value: number) => Math.round(value * 100) / 100
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const finiteNonnegativeKnown = (value: Known<number>): Known<number> =>
  value.status === 'known' && (!Number.isFinite(value.value) || value.value < 0)
    ? { status: 'unknown', reason: 'a recorded FHSA amount must be a finite nonnegative figure' }
    : value
const knownValue = (value: Known<number>, fallback = 0) => value.status === 'known' ? value.value : fallback
const joinedReasons = (facts: Known<number>[]) =>
  facts.filter((fact): fact is { status: 'unknown'; reason: string } => fact.status === 'unknown').map(fact => fact.reason).join('; ')

/**
 * Minus an unknown is unknown: an unsourced lifetime basis never becomes a full
 * limit. The result floors at zero, because a lifetime limit is a ceiling on
 * future room — an over-contributed history means no room left, never a
 * negative entitlement.
 */
const subtractKnown = (total: Known<number>, used: Known<number>): Known<number> =>
  total.status === 'known' && used.status === 'known'
    ? { status: 'known', value: roundCents(Math.max(0, total.value - used.value)) }
    : { status: 'unknown', reason: joinedReasons([total, used]) || 'lifetime basis not supplied' }

/** Additions need a known remaining lifetime room; an unknown basis adds nothing. */
const minKnown = (limit: number, remaining: Known<number>): Known<number> =>
  remaining.status === 'known'
    ? { status: 'known', value: roundCents(Math.min(limit, Math.max(0, remaining.value))) }
    : remaining

const BLOCKING: ReadonlySet<FhsaRoomLimitationCode> = new Set([
  'openingYearUnknown', 'historyUnknown', 'openingRoomUnknown', 'accountNotOpen',
  'notYetOpen', 'transferUnverified', 'ownershipUnknown', 'ambiguousAccount', 'lifetimeExceeded',
])

const unknownFrom = (limitations: FhsaRoomLimitation[]): Known<number> =>
  ({ status: 'unknown', reason: limitations.filter(item => BLOCKING.has(item.code)).map(item => item.detail).join('; ') })

/**
 * Price one person-year of FHSA participation room. Clipping happens line by
 * line so each retained amount stays attached to the contribution that could
 * not execute, and
 * `closing = carryForward + annualAddition − applied` holds to cents, where
 * `carryForward` is the carried-in room after the published carryforward cap
 * (so a capped `openingRoom` is never spendable on top of the lifetime limit).
 */
export function fhsaRoomYear(request: FhsaRoomRequest): FhsaRoomYear {
  const rules = selectFhsaRules()
  const lifetimeLimit: Known<number> = { status: 'known', value: rules.lifetimeLimit }
  const openedYear = finiteNonnegativeKnown(request.openedYear)
  const openingRoom = finiteNonnegativeKnown(request.openingRoom)
  const cumulativePrior: Known<number> = request.history
    ? finiteNonnegativeKnown(request.history.cumulativePriorContributions)
    : { status: 'unknown', reason: FHSA_HISTORY_MISSING }

  const limitations: FhsaRoomLimitation[] = []
  if (openedYear.status === 'unknown') limitations.push({ code: 'openingYearUnknown', detail: openedYear.reason })
  if (openingRoom.status === 'unknown') limitations.push({ code: 'openingRoomUnknown', detail: openingRoom.reason })
  if (cumulativePrior.status === 'unknown') limitations.push({ code: 'historyUnknown', detail: cumulativePrior.reason })
  // A transfer row cannot be priced: the plan does not record transfer history,
  // so it cannot tell a new transfer from a re-recorded one.
  if (request.lines.some(line => line.kind === 'rrspTransfer')) limitations.push({ code: 'transferUnverified', detail: FHSA_TRANSFER_HISTORY_UNVERIFIED })

  const notYetOpen = openedYear.status === 'known' && request.year < openedYear.value
  const implausibleOpening = openedYear.status === 'known' && request.year - openedYear.value > 120
  // The 15-year participation clock is BE-36 B. Reachability is only measured
  // here so the caller can refuse it; this module never rolls anything over.
  const maturityReached = openedYear.status === 'known' && !notYetOpen && !implausibleOpening &&
    request.year - openedYear.value >= 15
  if (maturityReached) limitations.push({ code: 'maturityUnsupported', detail: FHSA_MATURITY_UNSUPPORTED })
  if (implausibleOpening) limitations.push({ code: 'accountNotOpen', detail: 'the recorded opening year is implausibly early for this person' })
  if (notYetOpen) limitations.push({ code: 'notYetOpen', detail: `the FHSA is not open until ${(openedYear as { value: number }).value}, so ${request.year} has no participation room` })

  // A conservative lifetime basis: every prior contribution and RRSP transfer
  // consumes the published lifetime limit. An over-contributed history is not
  // silently clamped to zero room — that would hide a real overshoot — it is
  // refused with its own blocking reason.
  if (cumulativePrior.status === 'known' && cumulativePrior.value > lifetimeLimit.value + FHSA_MONEY_TOLERANCE)
    limitations.push({ code: 'lifetimeExceeded', detail: FHSA_LIFETIME_EXCEEDED })
  const blocked = limitations.some(item => BLOCKING.has(item.code))
  const remainingLifetimeBefore = subtractKnown(lifetimeLimit, cumulativePrior)
  const annualAddition: Known<number> = blocked || notYetOpen || implausibleOpening
    ? { status: 'known', value: 0 }
    : minKnown(rules.annualLimit, remainingLifetimeBefore)
  // The carried-in room is the year's participation-room carryforward, which the
  // statute caps at a published maximum. This ledger does not model unused
  // re-participation room (a taxable-withdrawal entitlement), so the whole
  // carried-in figure is bounded by that maximum: idle years can never
  // accumulate unlimited room, and the cap understates rather than overstates.
  const carryForward: Known<number> = blocked
    ? unknownFrom(limitations)
    : minKnown(rules.participationRoomCarryForwardLimit, openingRoom)
  const carryForwardCapped = !blocked && openingRoom.status === 'known' &&
    openingRoom.value > rules.participationRoomCarryForwardLimit + FHSA_MONEY_TOLERANCE
  if (carryForwardCapped)
    limitations.push({ code: 'carryForwardCapped', detail: FHSA_CARRY_FORWARD_CAPPED(rules.participationRoomCarryForwardLimit) })
  // The year's room is the capped carry-forward plus this year's addition, and
  // the lifetime limit bounds that whole total. A carried-in room can therefore
  // never be spent on top of the remaining lifetime room.
  const roomBeforeLifetime: Known<number> = blocked
    ? unknownFrom(limitations)
    : { status: 'known', value: roundCents(Math.max(0, knownValue(carryForward) + knownValue(annualAddition))) }
  const availableRoom: Known<number> = blocked
    ? unknownFrom(limitations)
    : minKnown(knownValue(roomBeforeLifetime), remainingLifetimeBefore)
  const lifetimeBindsYear = !blocked && remainingLifetimeBefore.status === 'known' &&
    (knownValue(annualAddition) < rules.annualLimit - FHSA_MONEY_TOLERANCE ||
      knownValue(roomBeforeLifetime) > remainingLifetimeBefore.value + FHSA_MONEY_TOLERANCE)
  if (lifetimeBindsYear) limitations.push({ code: 'lifetimeCapped', detail: FHSA_LIFETIME_SIMPLIFICATION })

  const lines: FhsaLineResult[] = request.lines.map(line => {
    const amount = Math.max(0, roundCents(line.amount))
    return { id: line.id, calendarYear: line.calendarYear, kind: line.kind, planned: amount, applied: 0, retained: amount }
  })
  if (!blocked) {
    let remaining = roundCents(Math.max(0, knownValue(availableRoom)))
    // The lifetime ceiling, the carry-forward maximum and the annual limit are
    // all already inside `availableRoom`, so one running remainder applies all
    // three without ever double counting a transfer or a contribution.
    for (const result of lines) {
      const applied = roundCents(Math.min(result.planned, remaining))
      result.applied = applied
      result.retained = roundCents(result.planned - applied)
      remaining = roundCents(Math.max(0, remaining - applied))
      if (result.retained > FHSA_MONEY_TOLERANCE) limitations.push({
        // Name the constraint that actually shrank the year: the lifetime
        // ceiling first, then the statutory carry-forward cap, then the year.
        code: lifetimeBindsYear ? 'lifetimeCapped' : carryForwardCapped ? 'carryForwardCapped' : 'annualCapped',
        detail: result.kind === 'rrspTransfer'
          ? `RRSP transfer ${result.id} of ${result.planned} exceeds FHSA participation room; ${result.retained} is retained and not transferred`
          : `contribution ${result.id} of ${result.planned} exceeds FHSA participation room; ${result.retained} is retained and not contributed`,
      })
    }
  }
  // `blocked` is `false` here whenever the lines were priced, so this
  // is the year's closing room, floored at zero.
  const closing = blocked
    ? unknownFrom(limitations)
    : { status: 'known' as const, value: roundCents(Math.max(0, knownValue(availableRoom) - sum(lines.map(line => line.applied)))) }
  const cumulativeContributions = blocked
    ? unknownFrom(limitations)
    : ({ status: 'known' as const, value: roundCents(knownValue(cumulativePrior) + sum(lines.map(line => line.applied))) } as Known<number>)
  // Signed, not floored: the invariant is `cumulative <= lifetimeLimit`, and an
  // overshoot must stay visible instead of reading as "no room left". A history
  // past the limit is refused above, so only sub-tolerance noise can reach here,
  // and that is snapped to a real zero rather than reported as negative room.
  const signedRemainingLifetime = roundCents(lifetimeLimit.value - knownValue(cumulativeContributions))
  const remainingLifetimeRoom: Known<number> = blocked
    ? unknownFrom(limitations)
    : { status: 'known' as const, value: Math.abs(signedRemainingLifetime) <= FHSA_MONEY_TOLERANCE ? 0 : signedRemainingLifetime }
  return {
    personId: request.personId,
    accountId: request.accountId,
    year: request.year,
    openingYear: openedYear,
    openingRoom,
    annualAddition,
    carryForward,
    availableRoom,
    rrspTransfers: blocked
      ? unknownFrom(limitations)
      : { status: 'known', value: roundCents(sum(lines.filter(line => line.kind === 'rrspTransfer').map(line => line.applied))) },
    ordinaryPlanned: roundCents(sum(lines.filter(line => line.kind === 'ordinary').map(line => line.planned))),
    planned: roundCents(sum(lines.map(line => line.planned))),
    applied: roundCents(sum(lines.map(line => line.applied))),
    retained: roundCents(sum(lines.map(line => line.retained))),
    closingRoom: closing,
    remainingLifetimeRoom,
    lifetimeLimit,
    cumulativeContributions,
    lines,
    limitations,
  }
}

/**
 * The one FHSA account a person owns, or an explicit "cannot tell" answer. A
 * person's FHSA is never priced off a household bucket or another person's
 * account.
 */
export function ownFhsaAccount(plan: Pick<InputsV2, 'accounts'>, personId: string): { accountId: string | null; ambiguous: boolean } {
  const owned = plan.accounts.filter(account => account.kind === 'fhsa' && account.ownerId === personId)
  if (owned.length === 1) return { accountId: owned[0].id, ambiguous: false }
  return { accountId: null, ambiguous: owned.length > 1 }
}

/** The statement history recorded for one account, or `undefined` when not supplied. */
export function fhsaStatementHistory(plan: Pick<InputsV2, 'fhsaStatementHistory'>, accountId: string): FhsaStatementHistory | undefined {
  const entry = plan.fhsaStatementHistory?.[accountId]
  return entry?.cumulativePriorContributions === undefined ? undefined : entry
}

/**
 * Every FHSA line the plan makes for one account in one year. Ordinary
 * contributions come from the resolved savings split; RRSP transfers are not
 * priced (see `FHSA_TRANSFER_HISTORY_UNVERIFIED`), so they are never invented
 * here. Both entry modes call this, so the panel and the kernel agree.
 */
function plannedFhsaLines(args: { year: number; savingsShare: number }): FhsaLineRequestLine[] {
  const share = roundCents(Math.max(0, args.savingsShare))
  return share > 0
    ? [{ id: `annual:${args.year}:fhsa`, calendarYear: args.year, amount: share, kind: 'ordinary' }]
    : []
}

/**
 * The room carried into the base year from earlier years. A first-year FHSA
 * carries nothing, so its opening room is a real zero. An account opened
 * earlier needs the statement's own unused-room figure, which nothing else in
 * the plan can supply, and stays unknown until the user records it — a legacy
 * "opened two years ago" fact is not enough, because it says nothing about how
 * much of the earlier room was used.
 */
export function fhsaOpeningRoom(plan: InputsV2, account: Account): Known<number> {
  if (account.openedYear.status === 'known' && account.openedYear.value >= plan.baseYear)
    return { status: 'known', value: 0 }
  return account.contributionRoom
}

/** One account's statement row is the whole fact set the ledger needs. */
function fhsaAccountYearRequest(args: {
  plan: InputsV2
  account: Account
  year: number
  lines: FhsaLineRequestLine[]
}): FhsaRoomRequest {
  const { plan, account, year, lines } = args
  return {
    personId: account.ownerId ?? '',
    accountId: account.id,
    year,
    openedYear: account.openedYear,
    openingRoom: fhsaOpeningRoom(plan, account),
    history: fhsaStatementHistory(plan, account.id),
    lines,
  }
}

/**
 * One account's whole plan for one year, read from the plan by the one accessor
 * that records it (`plannedFhsaContribution`): the account's scheduled rows plus
 * its recorded recurring plan. The kernel and the panel preview both build their
 * request here, so they price the same lines and cannot drift apart.
 */
export function fhsaPlannedYearRequest(args: { plan: InputsV2; account: Account; year: number }): FhsaPlannedRequest {
  const { plan, account, year } = args
  const scheduled = plan.contributions.filter(contribution =>
    contribution.accountId === account.id && contribution.calendarYear === year && contribution.amount > 0)
  const recordedPlan = plannedFhsaContribution(plan, account.id)
  const scheduledPlanned = roundCents(sum(scheduled.map(contribution => contribution.amount)))
  // The recorded plan is the account's total annual plan; a scheduled row for
  // the same year is already part of it, so it is never added twice.
  const savingsShare = roundCents(Math.max(0, recordedPlan - scheduledPlanned))
  return {
    savingsShare,
    request: fhsaAccountYearRequest({
      plan, account, year,
      lines: [
        ...scheduled.map(contribution => ({ id: contribution.id, calendarYear: year, amount: contribution.amount, kind: 'ordinary' as const })),
        ...plannedFhsaLines({ year, savingsShare }),
      ],
    }),
  }
}

export interface FhsaPlannedRequest {
  request: FhsaRoomRequest
  /** The recurring plan the recorded row owns, after the scheduled rows. */
  savingsShare: number
}

export interface FhsaRoomPreview {
  account: Account
  ledger: FhsaRoomYear
  /** The account's recorded recurring plan, inside `ledger`. */
  savingsShare: number
}

/**
 * The panel-facing base-year ledger for one owned FHSA account. It reuses the
 * same statement arithmetic, the same recorded plan and the same line set as
 * `annualStep`.
 */
export function previewFhsaRoomYear(plan: InputsV2, account: Account): FhsaRoomPreview {
  const planned = fhsaPlannedYearRequest({ plan, account, year: plan.baseYear })
  return { account, savingsShare: planned.savingsShare, ledger: fhsaRoomYear(planned.request) }
}

/** Closing room for the next year, or `null` when the row cannot carry it. */
export const fhsaNextOpeningRoom = (ledger: FhsaRoomYear): Known<number> | null =>
  ledger.closingRoom.status === 'known' ? ledger.closingRoom : null
