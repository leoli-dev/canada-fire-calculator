import type { Account, Contribution, InputsV2, Known, Person, SpousalHistoryStatus } from './model'
import { minimumForRrif } from './rrif'
import { RRSP_MONEY_TOLERANCE } from './rrspRoom'

/**
 * BE-12 B: spousal-plan attribution for one payment out of a spousal RRSP or
 * spousal RRIF (the mechanics reported on CRA form T2205).
 *
 * Rule basis, verified against the consolidated Income Tax Act and CRA
 * IT-307R4 (see the PR body):
 *
 * - ITA s.146(8.3): where a payment out of a spousal or common-law partner
 *   RRSP must be included in the annuitant's income, the contributor includes
 *   the lesser of
 *     (a) the premiums the contributor paid in the year of the payment or in
 *         either of the two immediately preceding taxation years, and
 *     (b) the payment itself.
 *   Reading (a) against a contribution made in calendar year C, the payment
 *   year Y is attributed when Y is C, C+1 or C+2. A payment in C+3 is not
 *   attributed.
 * - ITA s.146(8.5): earlier premiums are deemed attributed before later ones
 *   (first in, first out).
 * - ITA s.146(8.6): a premium already attributed is deemed, afterwards, not to
 *   have been paid to the spousal plan. It can never attribute a second time,
 *   and the annuitant deducts the attributed amount. Net of that deduction the
 *   annuitant is taxed on `payment - attributed`.
 * - ITA s.146.3(5.1): the RRIF version attributes the least of the premium
 *   total, the payment, and the excess of the amounts already required to be
 *   included in the annuitant's income for the year over the year's required
 *   minimum. The minimum itself is therefore taxed to the annuitant and only
 *   the excess over it is attributed.
 *
 * The attribution window uses the calendar year in which the premium was
 * actually paid. The first-60-days election (ITA s.146(5.1)) may move the year
 * the deduction is claimed; it never moves the attribution year, which is why
 * `deductionYear` is carried here for display only and never read as a window
 * year.
 *
 * Unknown is never zero. A missing contribution history, a premium whose
 * contributor is not recorded, an unidentified plan holder or an unconfirmed
 * RRIF minimum all return `unsupported` with a concrete reason instead of an
 * assumption. A known history with no premiums is a real zero and attributes
 * nothing.
 *
 * `attributeSpousalPayment` enforces no re-use WITHIN one call through
 * `premiumsAfter`. Across projected years the callers must carry that state
 * forward, so a `SpousalAttributionLedger` (per account, per premium id) is the
 * year-over-year carrier: the projection seeds it once at the base year
 * (`openingSpousalAttributionLedger`) and advances it with each year's
 * post-payment state. Without that ledger a premium is re-attributed in every
 * later year of its window, which breaks s.146(8.6)(a) and over-taxes the
 * contributor (review fix B2).
 */

/** A payment is attributed while its year is within this many years after the premium. */
export const ATTRIBUTION_WINDOW_YEARS = 2

export const SPOUSAL_HISTORY_UNKNOWN_REASON =
  'the spousal plan contribution history is not recorded, so no attribution can be determined'

/** The contributor's premiums to one spousal plan, in the plan's own record. */
export interface SpousalPremium {
  id: string
  /** Actual calendar year the premium was paid — the attribution year. */
  calendarYear: number
  /** The year the deduction is claimed when the first-60-days election moved it. */
  deductionYear: number | null
  /** Who paid it. `null` is an unrecorded contributor, not the annuitant. */
  contributorId: string | null
  amount: number
  /** Amount of this premium already included in the contributor's income. */
  attributed: number
}

export interface SpousalAttributionRequest {
  paymentId?: string
  /** The payment out of the plan, in the annuitant's hands. */
  payment: number
  /** Calendar year the payment is made. */
  paymentYear: number
  /** The spouse whose premiums are tested, or `null` when not identified. */
  contributorId: string | null
  /** The plan holder (annuitant), or `null` when not identified. */
  annuitantId: string | null
  /** `null` means the history is not recorded (unknown), which is not zero. */
  premiums: SpousalPremium[] | null
  /** Required RRIF minimum for the payment year; `null` for a spousal RRSP. */
  rrifMinimum: Known<number> | null
  /** Amounts from the same plan already included in the annuitant's income this year. */
  annuitantIncomeBefore: number
}

export interface SpousalAttributionLine {
  id: string
  calendarYear: number
  deductionYear: number | null
  amount: number
  attributedBefore: number
  attributedNow: number
  attributedAfter: number
}

export interface SpousalAttributionOk {
  status: 'ok'
  /** Included in the contributor's income under s.146(8.3) / s.146.3(5.1). */
  attributedToContributor: number
  /** Net of the s.146(8.6) deduction: what the annuitant ends up taxed on. */
  taxedToAnnuitant: number
  /** The attributed premium years, oldest first, for the window display. */
  windowYears: number[]
  /** Part of the payment consumed by the required RRIF minimum. */
  minimumApplied: number
  /** Unattributed in-window premiums available to this contributor. */
  inWindowUnattributed: number
  /** The in-window premiums, in first-in-first-out attribution order. */
  lines: SpousalAttributionLine[]
  /** Every premium row with `attributed` advanced by this payment. */
  premiumsAfter: SpousalPremium[]
}

export type SpousalAttributionResult = SpousalAttributionOk |
  { status: 'invalid' | 'unsupported'; reason: string }

/**
 * How much of each recorded spousal premium has already been included in the
 * contributor's income: account id → premium id → attributed amount.
 *
 * The ledger is the year-over-year carrier of the s.146(8.6)(a) no-re-use rule.
 * It is a plain value: `applyAttributionLedger` and `advanceAttributionLedger`
 * both return new objects and never touch the ledger they are given, so the
 * canonical plan and any caller's context are never mutated and running the
 * same projection twice produces the same ledger.
 */
export type SpousalAttributionLedger = Record<string, Record<string, number>>

const roundCents = (value: number) => Math.round(value * 100) / 100
const finiteNonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** The payment year and the two immediately preceding taxation years (s.146(8.3)(a)). */
export function attributionWindowYears(paymentYear: number): number[] {
  return Array.from({ length: ATTRIBUTION_WINDOW_YEARS + 1 }, (_, index) => paymentYear - ATTRIBUTION_WINDOW_YEARS + index)
}

/** True when a premium paid in `contributionYear` still attributes a `paymentYear` payment. */
export function isInAttributionWindow(contributionYear: number, paymentYear: number): boolean {
  return Number.isInteger(contributionYear) && Number.isInteger(paymentYear) &&
    contributionYear <= paymentYear && paymentYear - contributionYear <= ATTRIBUTION_WINDOW_YEARS
}

/**
 * Every recorded premium to one spousal plan. The attribution year is the
 * contribution's own calendar year; `deductionYear` is carried separately and
 * is deliberately not used to place a premium in the window.
 */
export function spousalPremiumLines(contributions: Contribution[], accountId: string): SpousalPremium[] {
  return contributions
    .filter(contribution => contribution.accountId === accountId)
    .map(contribution => ({
      id: contribution.id,
      calendarYear: contribution.calendarYear,
      deductionYear: contribution.deductionYear,
      contributorId: contribution.contributorId,
      amount: contribution.amount,
      attributed: 0,
    }))
    .sort((left, right) => left.calendarYear - right.calendarYear || left.id.localeCompare(right.id))
}

/**
 * Overlay a carried-forward ledger onto one account's premium rows. A premium
 * the ledger does not mention keeps the plan's own recorded `attributed`
 * (always zero for a canonical row), so a missing entry is a real zero and not
 * an unknown: the ledger is only ever written by this engine.
 */
export function applyAttributionLedger(premiums: SpousalPremium[], ledger: Record<string, number> | undefined): SpousalPremium[] {
  if (!ledger) return premiums
  return premiums.map(premium => {
    const attributed = ledger[premium.id]
    return attributed === undefined ? premium : { ...premium, attributed }
  })
}

/** The ledger advanced by one account's post-payment premium state. */
export function advanceAttributionLedger(
  ledger: SpousalAttributionLedger,
  accountId: string,
  premiumsAfter: SpousalPremium[],
): SpousalAttributionLedger {
  const next: Record<string, number> = { ...(ledger[accountId] ?? {}) }
  for (const premium of premiumsAfter) next[premium.id] = premium.attributed
  return { ...ledger, [accountId]: next }
}

/**
 * The attribution state of every recorded spousal premium at the start of the
 * plan's base year — the ledger the projection carries forward.
 *
 * Every premium starts at zero. That is a stated decision, not a silent
 * default:
 *
 * - `runProjection` computes the base year and later years only, and the
 *   canonical plan has no payment-history field, so a payment out of a plan
 *   before the base year is not a recorded fact. Reading an attribution out of
 *   one would mean inventing data the plan does not hold.
 * - The base year is the plan's own year zero, so its opening state is "no
 *   projected payment has attributed anything yet". A premium whose whole
 *   attribution window precedes the base year
 *   (`calendarYear < baseYear - ATTRIBUTION_WINDOW_YEARS`) can never reach a
 *   projected payment and stays at zero for that reason alone — the convention
 *   cannot inflate any result for it.
 * - The UI states the same convention beside the premium rows
 *   (`be12.spousalBaseYearNote`), so it is visible rather than implicit.
 *
 * Only a `complete` history has premium rows to carry: an unrecorded history is
 * refused by `resolveSpousalPlan`, never treated as an empty premium list.
 */
export function openingSpousalAttributionLedger(plan: InputsV2): SpousalAttributionLedger {
  const ledger: SpousalAttributionLedger = {}
  for (const account of plan.accounts) {
    if (plan.spousalHistory?.[account.id]?.status !== 'complete') continue
    const premiums = spousalPremiumLines(plan.contributions, account.id)
    if (premiums.length === 0) continue
    ledger[account.id] = Object.fromEntries(premiums.map(premium => [premium.id, 0]))
  }
  return ledger
}

/**
 * The required RRIF minimum as a `Known`, reusing `minimumForRrif` so there is
 * one minimum calculation in the engine. `null` means "not a RRIF", which is
 * not the same as an unknown minimum.
 *
 * `openingBalance` is the balance the year's mandatory withdrawal is computed
 * from. When the caller has a projected figure it must be passed: the frozen
 * canonical `account.balance` is the opening balance only in the base year, so
 * for any later year an absent balance is an explicit `unknown` rather than a
 * silent fall back to a figure that no longer applies (the round-2 defect).
 */
export function knownRrifMinimum(account: Account, people: Person[], baseYear: number, year: number, openingBalance?: number): Known<number> | null {
  if (account.kind !== 'rrif') return null
  if (openingBalance === undefined && year !== baseYear)
    return { status: 'unknown', reason: `the ${year} opening RRIF balance was not supplied, so the year's required minimum cannot be taken from the frozen ${baseYear} balance` }
  const minimum = minimumForRrif(account, people, baseYear, year, openingBalance)
  if (minimum.status === 'ok') return { status: 'known', value: roundCents(minimum.amount) }
  return { status: 'unknown', reason: minimum.reason }
}

/** The parties and the year's minimum for one account that is a spousal plan. */
export interface SpousalPlanParties {
  contributorId: string
  annuitantId: string
  premiums: SpousalPremium[]
  /** The year's required RRIF minimum, or `null` for a spousal RRSP. */
  rrifMinimum: Known<number> | null
}

export type SpousalPlanRouting =
  | { status: 'notSpousal' }
  | { status: 'unsupported'; reason: string }
  | { status: 'ok'; parties: SpousalPlanParties }

/** Registered plan name for a concrete refusal reason. */
function spousalPlanName(kind: Account['kind']): string {
  return kind === 'rrif' ? 'spousal RRIF' : kind === 'lif' ? 'spousal LIF' : kind === 'lira' ? 'spousal LIRA' : 'spousal RRSP'
}

/**
 * The one place that decides whether an account is a spousal plan, who the two
 * parties are and which RRIF minimum applies, so the tax panel and the income
 * kernel cannot drift apart.
 *
 * A recorded `spousalHistory` entry is itself the marker that the account is a
 * spousal plan, even after its registered type changes. The recorded fact is
 * therefore never persisted, invisible and ignored: a `rrif` account with a
 * recorded history is attributed through the s.146.3(5.1) minimum path, and a
 * `lif` or a plain-`rrsp` contradiction is refused loudly. An account with
 * neither the `spousalRrsp` kind nor a history entry stays on the ordinary
 * owner path, exactly as before this rule existed.
 *
 * `openingBalance` is the account's balance at the start of `year`. The income
 * kernel passes the projected balance the same year's mandatory RRIF withdrawal
 * is enforced from, so the attribution minimum and the forced withdrawal are
 * one number (review fix B1); the tax panel passes nothing in the base year,
 * where `minimumForRrif`'s default (`account.balance`) is that same balance.
 * For a later year an absent balance stays an explicit `unknown` supplied by
 * `knownRrifMinimum` instead of silently reusing the frozen balance.
 */
export function resolveSpousalPlan(
  account: Account,
  people: Person[],
  spousalHistory: Record<string, SpousalHistoryStatus> | undefined,
  contributions: Contribution[],
  baseYear: number,
  year: number,
  openingBalance?: number,
): SpousalPlanRouting {
  if (!['rrsp', 'spousalRrsp', 'rrif', 'lif', 'lira'].includes(account.kind)) return { status: 'notSpousal' }
  const history = spousalHistory?.[account.id]
  if (account.kind !== 'spousalRrsp' && history === undefined) return { status: 'notSpousal' }
  const name = spousalPlanName(account.kind)
  // LIF/LIRA minimum and maximum withdrawals are BE-36 territory and stay out
  // of scope; a recorded spousal history must not turn them into a plain owner
  // answer, and a stray history entry on a LIRA must not be silently dropped.
  if (account.kind === 'lif')
    return { status: 'unsupported', reason: `a ${name} cannot be attributed yet: LIF minimum and maximum withdrawals need BE-36 rules` }
  if (account.kind === 'lira')
    return { status: 'unsupported', reason: `a ${name} cannot be attributed yet: LIRA withdrawal and transfer rules need BE-36 rules` }
  // A plain RRSP kind together with a recorded spousal premium history is a
  // contradiction in the plan's own facts, not a fact to guess from.
  if (account.kind === 'rrsp')
    return { status: 'unsupported', reason: `a spousal premium history is recorded for this ordinary RRSP, so a withdrawal cannot be attributed: reclassify the account as a spousal RRSP or clear the history` }
  if (!account.ownerId || !people.some(person => person.id === account.ownerId))
    return { status: 'unsupported', reason: `${name} holder not identified` }
  const spouse = people.find(person => person.id !== account.ownerId)
  if (!spouse) return { status: 'unsupported', reason: `${name} attribution needs the annuitant's spouse in the plan` }
  if (history?.status !== 'complete')
    return { status: 'unsupported', reason: `${name} contribution history is not recorded, so the payment is not assumed to be the annuitant's` }
  return {
    status: 'ok',
    parties: {
      contributorId: spouse.id,
      annuitantId: account.ownerId,
      premiums: spousalPremiumLines(contributions, account.id),
      // Only a spousal RRIF has a required minimum; a spousal RRSP has none,
      // so the minimum is an explicit `null` rather than a zero. An
      // unconfirmed minimum stays `unknown` and makes the payment unsupported.
      rrifMinimum: account.kind === 'rrif' ? knownRrifMinimum(account, people, baseYear, year, openingBalance) : null,
    },
  }
}

/** Sort premiums deterministically so the result cannot depend on input order. */
function sortPremiums(premiums: SpousalPremium[]): SpousalPremium[] {
  return [...premiums].sort((left, right) =>
    left.calendarYear - right.calendarYear || left.id.localeCompare(right.id))
}

/**
 * Attribute one payment out of a spousal plan to the contributor.
 *
 * The result is order-independent (premiums are sorted by year then id) and
 * deterministic. Conservation holds to `RRSP_MONEY_TOLERANCE`:
 * `attributedToContributor + taxedToAnnuitant == payment`, and neither part is
 * negative.
 */
export function attributeSpousalPayment(request: SpousalAttributionRequest): SpousalAttributionResult {
  const { payment, paymentYear, contributorId, annuitantId, premiums, rrifMinimum } = request
  const annuitantIncomeBefore = request.annuitantIncomeBefore
  if (!finiteNonnegative(payment)) return { status: 'invalid', reason: 'a spousal payment must be a finite nonnegative amount' }
  if (!Number.isInteger(paymentYear)) return { status: 'invalid', reason: 'a spousal payment year must be an integer calendar year' }
  if (!finiteNonnegative(annuitantIncomeBefore)) return { status: 'invalid', reason: 'amounts already included in the annuitant income must be a finite nonnegative amount' }
  if (contributorId === null) return { status: 'unsupported', reason: 'the spousal plan contributor is not recorded, so a payment cannot be attributed' }
  if (annuitantId === null) return { status: 'unsupported', reason: 'the spousal plan holder (annuitant) is not identified, so a payment cannot be attributed' }
  if (premiums === null) return { status: 'unsupported', reason: SPOUSAL_HISTORY_UNKNOWN_REASON }
  if (!Array.isArray(premiums)) return { status: 'invalid', reason: 'spousal premium history must be an array or an explicit unknown' }
  for (const premium of premiums) {
    if (!Number.isInteger(premium.calendarYear)) return { status: 'invalid', reason: `spousal premium year is not a calendar year: ${premium.id}` }
    if (!finiteNonnegative(premium.amount)) return { status: 'invalid', reason: `spousal premium amount is not a finite nonnegative figure: ${premium.id}` }
    if (!finiteNonnegative(premium.attributed) || premium.attributed > premium.amount + RRSP_MONEY_TOLERANCE)
      return { status: 'invalid', reason: `attributed amount for spousal premium ${premium.id} exceeds the premium` }
  }
  if (rrifMinimum && rrifMinimum.status === 'unknown') return { status: 'unsupported', reason: `the RRIF minimum for ${paymentYear} is not confirmed: ${rrifMinimum.reason}` }
  if (rrifMinimum && rrifMinimum.status === 'known' && !finiteNonnegative(rrifMinimum.value))
    return { status: 'invalid', reason: 'the RRIF minimum for the year must be a finite nonnegative amount' }
  // The contributor at the time the premium was paid is the annuitant's
  // spouse. A premium the annuitant paid to their own spousal plan is not a
  // spousal premium and attributes nothing (s.146(8.3)(a)).
  if (contributorId === annuitantId) {
    return {
      status: 'ok', attributedToContributor: 0, taxedToAnnuitant: roundCents(payment),
      windowYears: attributionWindowYears(paymentYear), minimumApplied: 0, inWindowUnattributed: 0, lines: [],
      premiumsAfter: sortPremiums(premiums),
    }
  }
  // A premium whose payer was never recorded is not evidence of the
  // annuitant's own money either; refusing is the only honest answer.
  const unrecorded = premiums.find(premium => premium.contributorId === null)
  if (unrecorded) return { status: 'unsupported', reason: `spousal premium ${unrecorded.id} has no recorded contributor, so the attribution cannot be determined` }

  const minimum = rrifMinimum && rrifMinimum.status === 'known' ? rrifMinimum.value : 0
  // s.146.3(5.1)(c) compares the year's cumulative income inclusion with the
  // year's required minimum, so the minimum is consumed once across payments.
  const minimumApplied = roundCents(Math.min(payment, Math.max(0, minimum - annuitantIncomeBefore)))
  // Clamp both parts to [0, payment] before rounding to cents so a sub-cent
  // payment cannot round one part past the payment and make the other negative.
  const attributableCeiling = roundCents(Math.max(0, payment - minimumApplied))
  const sorted = sortPremiums(premiums)
  const inWindow = sorted.filter(premium => premium.contributorId === contributorId && isInAttributionWindow(premium.calendarYear, paymentYear))
  const inWindowUnattributed = roundCents(inWindow.reduce((total, premium) => total + Math.max(0, roundCents(premium.amount - premium.attributed)), 0))
  const attributedToContributor = roundCents(Math.max(0, Math.min(attributableCeiling, inWindowUnattributed, payment)))
  const taxedToAnnuitant = roundCents(Math.max(0, payment - attributedToContributor))

  // s.146(8.5) first in, first out. The totals above do not depend on this
  // order; the per-premium split does, so it is applied deterministically.
  let remaining = attributedToContributor
  const lines: SpousalAttributionLine[] = inWindow.map(premium => {
    const attributedBefore = roundCents(premium.attributed)
    const available = Math.max(0, roundCents(premium.amount - attributedBefore))
    const attributedNow = roundCents(Math.min(available, remaining))
    remaining = roundCents(remaining - attributedNow)
    return {
      id: premium.id,
      calendarYear: premium.calendarYear,
      deductionYear: premium.deductionYear,
      amount: premium.amount,
      attributedBefore,
      attributedNow,
      attributedAfter: roundCents(attributedBefore + attributedNow),
    }
  })
  const byId = new Map(lines.map(line => [line.id, line]))
  return {
    status: 'ok',
    attributedToContributor,
    taxedToAnnuitant,
    windowYears: attributionWindowYears(paymentYear),
    minimumApplied,
    inWindowUnattributed,
    lines,
    premiumsAfter: sorted.map(premium => {
      const line = byId.get(premium.id)
      return line ? { ...premium, attributed: line.attributedAfter } : premium
    }),
  }
}
