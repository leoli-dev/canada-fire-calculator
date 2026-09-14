import type { InputsV2, Known, Person, Provenance } from './model'
import { resolveYearAllocation } from './funding'
import { RRSP_MONEY_TOLERANCE } from './rrspRoom'

/**
 * BE-27 A: a recomputable per-person, per-year TFSA contribution-room ledger.
 *
 * TFSA room belongs to the person, not to an account: one CRA room figure
 * covers every TFSA a person holds, so nothing here is keyed by account and two
 * people are priced independently. Every figure in a row is either a recorded
 * CRA statement fact or the result of the identity
 * `closing = opening + addition + restored − applied`, so the row can be
 * re-derived from its parts and carried into the next year without drift. Money
 * the room cannot execute is clipped and retained — never deleted — and room
 * never goes negative.
 *
 * The restoration rule is the CRA one (see `TFSA_ROOM_SOURCE`): room is made of
 * the year's annual dollar limit, unused room from previous years, and the
 * withdrawals made in *previous* years, excluding direct transfers. So a
 * withdrawal in year Y restores room in Y+1 and never in Y, it is restored
 * exactly once (the row for Y+1 recomputes it from the recorded withdrawal
 * rather than accumulating a running total), and a withdrawal the recorded room
 * figure already contains — one made before its statement year — is not
 * restored a second time.
 *
 * The recorded room figure is the CRA available contribution room for the
 * plan's base year, read the same way the RRSP ledger reads its statement:
 * `statementYear` is that year, so the base year's own annual limit is already
 * inside the figure (`addition` is a sourced zero) and only withdrawals from
 * that year onward can restore room. Nothing here invents a room addition for a
 * later year: the published rule package has no TFSA dollar-limit entry and no
 * indexation rule for one, and the limit is indexed in $500 increments rather
 * than by a rate this package could project, so `annualTfsaAdditionFor` stays
 * `unknown` with a concrete reason. It takes a `Known<number>` so a sourced
 * limit slots in later without changing any arithmetic in this file.
 *
 * Explicitly out of scope for BE-27 A, refused rather than half-implemented
 * (see `TFSA_OUT_OF_SCOPE` for the reasons): the retirement surplus refill /
 * cash-flow surplus policy, the RRIF-forced-surplus reinvestment interaction,
 * the surplus-strategy comparison, and "internal compliant transfer" handling.
 */

/**
 * The CRA page the restoration rule and the meaning of "available contribution
 * room" come from. It states that room is the annual dollar limit plus unused
 * room from previous years plus withdrawals made during previous years,
 * excluding direct transfers.
 */
export const TFSA_ROOM_SOURCE =
  'https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/contributions.html'

/** Cents-scale money tolerance shared with the rest of the engine. */
export const TFSA_MONEY_TOLERANCE = RRSP_MONEY_TOLERANCE

/** The convention that makes the recorded room figure priceable without drift. */
export const TFSA_STATEMENT_ROOM_BASIS =
  'the recorded figure is the CRA available contribution room for the plan year, as of January 1: it already contains that year’s annual dollar limit and every withdrawal made in an earlier year'

/** The one reason a room addition is never invented for a later year. */
export const TFSA_ADDITION_RULE_MISSING = (year: number) =>
  `no sourced TFSA annual dollar limit is published for ${year}, and the statutory limit is indexed in $500 increments rather than by a rate this rule package could project, so no room addition is invented for a year after the statement year`

/**
 * The one explanation for a year whose room is not established. It is shown
 * where the user records the facts, because "unknown" is a real state and is
 * neither unlimited room nor a real zero.
 */
export const TFSA_ROOM_UNKNOWN_NO_CONTRIBUTION =
  'TFSA contribution room is not confirmed, so no new TFSA contribution is executed and the money is retained in the non-registered account instead; the room is never treated as unlimited or as zero'

/**
 * BE-27 A does not implement the policies that would decide where leftover cash
 * goes. Each is refused with its own reason rather than silently assumed.
 */
export const TFSA_SURPLUS_REFILL_UNSUPPORTED =
  'the retirement surplus refill policy (which account receives leftover cash) is not implemented (BE-27 B), so no leftover cash is routed into TFSA room here'

export const TFSA_RRIF_SURPLUS_REINVESTMENT_UNSUPPORTED =
  'RRIF-forced-surplus reinvestment is not modelled: the RRIF minimum withdrawal rule is not wired, so a forced surplus cannot be re-contributed and spends no TFSA room in this ledger'

export const TFSA_SURPLUS_STRATEGY_COMPARISON_UNSUPPORTED =
  'comparing surplus strategies (refill TFSA room versus hold non-registered cash) needs the BE-27 B surplus policy and is not implemented'

export const TFSA_INTERNAL_TRANSFER_UNSUPPORTED =
  'a direct transfer between a person’s own TFSAs is not a withdrawal under the CRA rule and is not recorded by this plan, so no transfer is treated as a withdrawal plus a new contribution (which would both restore room and spend it)'

export interface TfsaOutOfScopeItem {
  id: 'surplusRefillPolicy' | 'rrifForcedSurplusReinvestment' | 'surplusStrategyComparison' | 'internalCompliantTransfer'
  reason: string
}

/** Every policy BE-27 A deliberately leaves unsupported, with its reason. */
export const TFSA_OUT_OF_SCOPE: readonly TfsaOutOfScopeItem[] = [
  { id: 'surplusRefillPolicy', reason: TFSA_SURPLUS_REFILL_UNSUPPORTED },
  { id: 'rrifForcedSurplusReinvestment', reason: TFSA_RRIF_SURPLUS_REINVESTMENT_UNSUPPORTED },
  { id: 'surplusStrategyComparison', reason: TFSA_SURPLUS_STRATEGY_COMPARISON_UNSUPPORTED },
  { id: 'internalCompliantTransfer', reason: TFSA_INTERNAL_TRANSFER_UNSUPPORTED },
]

export type TfsaRoomLimitationCode = 'roomUnknown' | 'additionUnsourced' | 'roomClipped' | 'unexecuted'

export interface TfsaRoomLimitation {
  code: TfsaRoomLimitationCode
  detail: string
}

/** One withdrawal already made, by the calendar year it was made in. */
export interface TfsaWithdrawalLine {
  id: string
  calendarYear: number
  amount: number
}

/**
 * The CRA statement facts the room figure alone cannot supply: the withdrawals
 * made since it, which are the only thing that restores room. Contributions
 * already made are not listed a second time — the CRA available-room figure is
 * already net of every contribution made, so re-recording them would either
 * double-count the room or need a statement cutoff finer than a calendar year.
 */
export interface TfsaStatementHistory {
  withdrawals: TfsaWithdrawalLine[]
  provenance: Provenance
}

/** One planned contribution, in execution order. */
export interface TfsaContributionLine {
  id: string
  calendarYear: number
  amount: number
}

export interface TfsaRoomRequest {
  personId: string
  year: number
  /**
   * The year the recorded room figure is as of — the plan's base year. Only a
   * withdrawal in `statementYear` or later restores room, because an earlier
   * one is already inside the figure.
   */
  statementYear: number
  /**
   * Available room at the start of `year`. For the statement year this is the
   * recorded CRA figure; for a later year it is the prior row's closing room,
   * which is what makes `opening(y+1) == closing(y)` hold.
   */
  openingRoom: Known<number>
  /** The room this year adds; the statement year's addition is inside its figure. */
  annualAddition: Known<number>
  /** Withdrawals already made, by calendar year. */
  withdrawals: TfsaWithdrawalLine[]
  lines: TfsaContributionLine[]
}

export interface TfsaLineResult {
  id: string
  calendarYear: number
  planned: number
  applied: number
  retained: number
}

export interface TfsaRoomYear {
  personId: string
  year: number
  statementYear: number
  openingRoom: Known<number>
  annualAddition: Known<number>
  /** Room freed by a withdrawal in `year - 1`, added in this row only. */
  restored: Known<number>
  /** Room actually spendable this year, floored at zero. */
  availableRoom: Known<number>
  planned: number
  applied: number
  /** Money the room could not execute; retained, never deleted. */
  retained: number
  closingRoom: Known<number>
  lines: TfsaLineResult[]
  clampedAtZero: boolean
  limitations: TfsaRoomLimitation[]
}

const roundCents = (value: number) => Math.round(value * 100) / 100
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const nonnegativeKnown = (value: Known<number>): Known<number> =>
  value.status === 'known' && (!Number.isFinite(value.value) || value.value < 0)
    ? { status: 'unknown', reason: 'a recorded TFSA amount must be a finite nonnegative figure' }
    : value
const knownValue = (value: Known<number>, fallback = 0) => value.status === 'known' ? value.value : fallback

/**
 * The room additions that make the room itself unknowable. A clip is not
 * blocking: it is the point of the ledger. Exported so the kernel and the panel
 * read one set instead of keeping two copies that could diverge.
 */
export const TFSA_BLOCKING: ReadonlySet<TfsaRoomLimitationCode> = new Set(['roomUnknown', 'additionUnsourced'])

const unknownFrom = (limitations: TfsaRoomLimitation[]): Known<number> =>
  ({ status: 'unknown', reason: limitations.filter(item => TFSA_BLOCKING.has(item.code)).map(item => item.detail).join('; ') })

/** Rows the ledger may price: a real calendar year and a positive amount. */
const validWithdrawals = (lines: TfsaWithdrawalLine[]): TfsaWithdrawalLine[] =>
  lines
    .filter(line => Number.isInteger(line.calendarYear) && Number.isFinite(line.amount) && line.amount > 0)
    .map(line => ({ id: line.id, calendarYear: line.calendarYear, amount: roundCents(line.amount) }))

/**
 * The one definition of the room a year adds. The CRA room figure for its own
 * statement year already contains that year's annual dollar limit, so the
 * statement year adds nothing on top; a later year would need a sourced limit,
 * and there is none to read.
 */
export function annualTfsaAdditionFor(year: number, statementYear: number): Known<number> {
  if (year < statementYear)
    return { status: 'unknown', reason: `the recorded CRA TFSA room is for ${statementYear}, after plan year ${year}, so it cannot price ${year}` }
  if (year === statementYear) return { status: 'known', value: 0 }
  return { status: 'unknown', reason: TFSA_ADDITION_RULE_MISSING(year) }
}

/**
 * The room freed by a withdrawal in `year - 1` and added in `year`. It is a
 * recomputation from the recorded rows, never a carried running total, so a
 * restored amount is added exactly once and a rerun cannot add it again. A
 * withdrawal made before the statement year is already inside the recorded room
 * figure and restores nothing, and no withdrawal in the prior year is a real
 * zero. The result is always known: the room figure carries no unknown here.
 */
export function restoredRoom(args: { year: number; statementYear: number; withdrawals: TfsaWithdrawalLine[] }): Known<number> {
  const restoring = args.withdrawals.filter(line => line.calendarYear === args.year - 1 && line.calendarYear >= args.statementYear)
  return { status: 'known', value: roundCents(sum(restoring.map(line => line.amount))) }
}

/**
 * Price one person-year. Clipping happens line by line so a retained amount
 * stays attached to the contribution that could not execute, and
 * `closing = opening + addition + restored − applied` holds to cents. An
 * unconfirmed room does not refuse the year: it prices nothing, retains the
 * whole planned amount and says why.
 */
export function tfsaRoomYear(request: TfsaRoomRequest): TfsaRoomYear {
  const openingRoom = nonnegativeKnown(request.openingRoom)
  const annualAddition = nonnegativeKnown(request.annualAddition)
  const withdrawals = validWithdrawals(request.withdrawals)
  const restored = restoredRoom({ year: request.year, statementYear: request.statementYear, withdrawals })

  const limitations: TfsaRoomLimitation[] = []
  if (openingRoom.status === 'unknown') limitations.push({ code: 'roomUnknown', detail: openingRoom.reason })
  if (annualAddition.status === 'unknown') limitations.push({ code: 'additionUnsourced', detail: annualAddition.reason })
  const blocked = limitations.some(item => TFSA_BLOCKING.has(item.code))

  const lines: TfsaLineResult[] = request.lines.map(line => {
    const amount = Math.max(0, roundCents(line.amount))
    return { id: line.id, calendarYear: line.calendarYear, planned: amount, applied: 0, retained: amount }
  })
  const planned = roundCents(sum(lines.map(line => line.planned)))

  // The three room terms are each nonnegative, so the raw total cannot be
  // negative; the floor is kept as the invariant that room never goes below
  // zero even if a caller passes a nonnegative-but-unusable addition.
  const rawAvailable = roundCents(knownValue(openingRoom) + knownValue(annualAddition) + knownValue(restored))
  let availableRoom: Known<number>
  let closingRoom: Known<number>
  let clampedAtZero = false
  if (blocked) {
    availableRoom = unknownFrom(limitations)
    closingRoom = unknownFrom(limitations)
    if (planned > 0) limitations.push({
      code: 'unexecuted',
      detail: `${TFSA_ROOM_UNKNOWN_NO_CONTRIBUTION} (${limitations.filter(item => TFSA_BLOCKING.has(item.code)).map(item => item.detail).join('; ')})`,
    })
  } else {
    clampedAtZero = rawAvailable < 0
    let remaining = roundCents(Math.max(0, rawAvailable))
    const spendable = roundCents(Math.max(0, rawAvailable))
    availableRoom = { status: 'known', value: spendable }
    for (const result of lines) {
      const applied = roundCents(Math.min(result.planned, remaining))
      result.applied = applied
      result.retained = roundCents(result.planned - applied)
      remaining = roundCents(Math.max(0, remaining - applied))
      if (result.retained > TFSA_MONEY_TOLERANCE) limitations.push({
        code: 'roomClipped',
        detail: `contribution ${result.id} of ${result.planned} exceeds the ${spendable} CAD of TFSA room spendable in ${request.year}; ${result.retained} is retained and not contributed`,
      })
    }
    closingRoom = { status: 'known', value: remaining }
  }
  const applied = roundCents(sum(lines.map(line => line.applied)))
  return {
    personId: request.personId,
    year: request.year,
    statementYear: request.statementYear,
    openingRoom,
    annualAddition,
    restored,
    availableRoom,
    planned,
    applied,
    retained: roundCents(planned - applied),
    closingRoom,
    lines,
    clampedAtZero,
    limitations,
  }
}

/** The statement history recorded for one person, or `undefined` when not supplied. */
export function tfsaStatement(plan: Pick<InputsV2, 'tfsaStatement'>, personId: string): TfsaStatementHistory | undefined {
  return plan.tfsaStatement?.[personId]
}

/**
 * Every TFSA contribution line a plan makes for one person in one calendar
 * year: the TFSA share of the resolved voluntary savings split, under the same
 * synthetic id the kernel records in the contribution history. The kernel and
 * the panel both call this, so the displayed "planned"/"retained" figures cannot
 * drift from the priced ones (DM01 parity).
 */
export function plannedTfsaLines(args: { personId: string; year: number; savingsShare: number }): TfsaContributionLine[] {
  const share = roundCents(Math.max(0, args.savingsShare))
  return share > 0 ? [{ id: `annual:${args.year}:tfsa`, calendarYear: args.year, amount: share }] : []
}

/**
 * The TFSA share of the year's voluntary savings split. A couple's contribution
 * cannot be attributed to one person's room, so it is priced for neither —
 * exactly as the RRSP ledger does — and the kernel refuses it explicitly.
 */
export function resolvedTfsaShare(plan: InputsV2, year: number): number {
  return plan.people.length === 1 ? roundCents(Math.max(0, resolveYearAllocation(plan, year).voluntary.tfsa)) : 0
}

export interface TfsaRoomPreview {
  ledger: TfsaRoomYear
  /** TFSA share of the year's voluntary savings split, a part of `ledger`. */
  savingsShare: number
  /** Room the withdrawals recorded for this year will restore next year. */
  restoredNextYear: Known<number>
}

/**
 * The panel-facing base-year ledger for one person. It reads the same statement
 * facts and the same resolved allocation as `annualStep`, so the panel shows the
 * kernel's arithmetic rather than a partial view of it. Later years are not
 * previewed because they would need the missing sourced limit.
 */
export function previewTfsaRoomYear(plan: InputsV2, person: Person): TfsaRoomPreview {
  const year = plan.baseYear
  const statement = tfsaStatement(plan, person.id)
  const withdrawals = statement?.withdrawals ?? []
  const savingsShare = resolvedTfsaShare(plan, year)
  const ledger = tfsaRoomYear({
    personId: person.id,
    year,
    statementYear: plan.baseYear,
    openingRoom: person.tfsaAvailableRoom,
    annualAddition: annualTfsaAdditionFor(year, plan.baseYear),
    withdrawals,
    lines: plannedTfsaLines({ personId: person.id, year, savingsShare }),
  })
  return { ledger, savingsShare, restoredNextYear: restoredRoom({ year: year + 1, statementYear: plan.baseYear, withdrawals }) }
}
