import { describe, expect, it } from 'vitest'
import {
  FHSA_HISTORY_MISSING,
  FHSA_LIFETIME_EXCEEDED,
  FHSA_MATURITY_UNSUPPORTED,
  FHSA_MONEY_TOLERANCE,
  FHSA_TRANSFER_HISTORY_UNVERIFIED,
  fhsaNextOpeningRoom,
  fhsaPlannedYearRequest,
  fhsaRoomYear,
  fhsaStatementHistory,
  ownFhsaAccount,
  previewFhsaRoomYear,
  type FhsaLineRequestLine,
  type FhsaRoomRequest,
  type FhsaRoomYear,
} from '../fhsa'
import { fhsaPlanRowId, plannedFhsaContribution } from '../fhsaPlan'
import { selectFhsaRules } from '../rules'
import { assertCanonicalPlan } from '../modelValidation'
import type { Account, InputsV2, Known, Provenance } from '../model'
import { migratePersistedPlan } from '../migration'
import { DEFAULT_INPUTS } from '../../store'

/**
 * BE-36 A. Every expected figure below is a hand calculation from the two
 * published limits in `selectFhsaRules()` (8,000 a year, 40,000 a lifetime),
 * never a number produced by `fhsaRoomYear`.
 */
const known = (value: number): Known<number> => ({ status: 'known', value })
const knownBool = (value: boolean): Known<boolean> => ({ status: 'known', value })
const unknown = (reason: string): Known<number> => ({ status: 'unknown', reason })
const provenance: Provenance = { origin: 'user', sourceYear: 2026 }
const history = (cumulative: number) => ({ cumulativePriorContributions: known(cumulative), provenance })
const line = (id: string, amount: number, kind: FhsaLineRequestLine['kind'] = 'ordinary'): FhsaLineRequestLine =>
  ({ id, calendarYear: 2026, amount, kind })

const request = (overrides: Partial<FhsaRoomRequest> = {}): FhsaRoomRequest => ({
  personId: 'p1',
  accountId: 'fhsa1',
  year: 2026,
  openedYear: known(2026),
  openingRoom: known(0),
  history: history(0),
  lines: [],
  ...overrides,
})

const closing = (row: FhsaRoomYear): number => {
  if (row.closingRoom.status !== 'known') throw new Error('expected known closing room')
  return row.closingRoom.value
}
const remainingLifetime = (row: FhsaRoomYear): number => {
  if (row.remainingLifetimeRoom.status !== 'known') throw new Error('expected known remaining lifetime room')
  return row.remainingLifetimeRoom.value
}

describe('BE-36 A FHSA room ledger — published limits', () => {
  it('takes both limits from the sourced rule pack, not from a literal in the ledger', () => {
    const rules = selectFhsaRules()
    // Independent source: CRA "Participating in your FHSAs" ($8,000 in the year
    // the first FHSA is opened) and CRA FHSA definitions ("Lifetime FHSA limit
    // = $40,000"). Both are fixed, non-indexed statutory amounts.
    expect(rules.annualLimit).toBe(8000)
    expect(rules.lifetimeLimit).toBe(40000)
    expect(rules.sourceURL).toContain('canada.ca')
    expect(rules.limitation).toContain('re-participation')
    const row = fhsaRoomYear(request())
    expect(row.annualAddition).toEqual(known(8000))
    expect(row.lifetimeLimit).toEqual(known(40000))
  })
})

describe('BE-36 A audit P12 — cumulative contributions at the lifetime limit', () => {
  it('stops executing further contributions once 40,000 of cumulative contributions is reached', () => {
    // Audit P12 case: the statement already records the full 40,000 lifetime
    // limit, so the year has no room at all and the whole plan is retained.
    const row = fhsaRoomYear(request({
      openedYear: known(2016),
      openingRoom: known(0),
      history: history(40000),
      lines: [line('c1', 8000)],
    }))
    expect(remainingLifetime(row)).toBe(0)
    expect(row.applied).toBe(0)
    expect(row.retained).toBe(8000)
    expect(row.applied + row.retained).toBe(row.planned)
    expect(closing(row)).toBe(0)
    expect(row.limitations.map(item => item.code)).toContain('lifetimeCapped')
    // A deliberate second run proves the refusal is stable, not a fluke.
    const rerun = fhsaRoomYear(request({
      openedYear: known(2016), openingRoom: known(0), history: history(40000), lines: [line('c1', 8000)],
    }))
    expect(rerun).toEqual(row)
  })

  it('refuses a history already past the lifetime limit instead of flooring the overshoot to zero', () => {
    // 80,000 recorded against a 40,000 limit is a real excess FHSA amount. The
    // ledger must name that refusal, not report "0 remaining" as if the year
    // simply had no room, and it must not hide the overshoot behind a floor.
    const row = fhsaRoomYear(request({
      openedYear: known(2016),
      openingRoom: known(0),
      history: history(80000),
      lines: [line('c1', 8000)],
    }))
    expect(row.limitations.map(item => item.code)).toContain('lifetimeExceeded')
    expect(row.limitations.find(item => item.code === 'lifetimeExceeded')?.detail).toBe(FHSA_LIFETIME_EXCEEDED)
    expect(row.applied).toBe(0)
    expect(row.retained).toBe(8000)
    expect(row.applied + row.retained).toBe(row.planned)
    // Unknown, not a floored zero: the overshoot is refused rather than hidden.
    expect(row.remainingLifetimeRoom.status).toBe('unknown')
    expect(row.closingRoom.status).toBe('unknown')
    expect(row.cumulativeContributions.status).toBe('unknown')
  })

  it('caps at exactly the remaining lifetime limit and lets a growth-only balance stay legitimate', () => {
    // 39,000 already contributed leaves 1,000 of lifetime room. The year's
    // published annual room is 8,000, so the lifetime bound gives 1,000.
    const row = fhsaRoomYear(request({
      openedYear: known(2020),
      openingRoom: known(0),
      history: history(39000),
      lines: [line('c1', 5000)],
    }))
    expect(row.annualAddition).toEqual(known(1000))
    expect(row.applied).toBe(1000)
    expect(row.retained).toBe(4000)
    expect(remainingLifetime(row)).toBe(0)
    // The ledger has no balance input at all: a $250,000 balance cannot create
    // room, and the same request prices the same 1,000 whether or not the
    // account grew. Only the recorded statement facts matter.
    const grew = { ...request({
      openedYear: known(2020), openingRoom: known(0), history: history(39000), lines: [line('c1', 5000)],
    }), balance: 250000 } as FhsaRoomRequest & { balance: number }
    expect(fhsaRoomYear(grew)).toEqual(row)
  })
})

describe('BE-36 A participation-room carryforward maximum', () => {
  it('takes the carryforward maximum from the sourced rule pack', () => {
    const rules = selectFhsaRules()
    // CRA "FHSA participation room carryforward": the lesser of $8,000 and a
    // contribution-adjusted figure, so unused room can never carry more than
    // $8,000 into a year.
    expect(rules.participationRoomCarryForwardLimit).toBe(8000)
    expect(rules.fieldSources.participationRoomCarryForwardLimit).toBe(rules.fieldSources.lifetimeLimit)
    expect(rules.limitation).toContain('participation-room carryforward')
  })

  it('caps the carried-in room so idle years cannot accumulate unlimited room', () => {
    // Five idle years: opening room grows by the annual limit every year, but
    // the statutory carryforward maximum means the year can never hold more
    // than 8,000 + 8,000 = 16,000.
    let opening = known(0)
    const available: number[] = []
    for (let year = 2026; year <= 2032; year++) {
      const row = fhsaRoomYear(request({
        year, openedYear: known(2020), openingRoom: opening, history: history(0), lines: [],
      }))
      expect(row.availableRoom.status).toBe('known')
      available.push(row.availableRoom.status === 'known' ? row.availableRoom.value : NaN)
      opening = fhsaNextOpeningRoom(row)!
    }
    // A $40,000 plan in the fifth idle year executes only the legal 16,000.
    expect(available).toEqual([8000, 16000, 16000, 16000, 16000, 16000, 16000])
    const plan = fhsaRoomYear(request({
      year: 2030, openedYear: known(2020), openingRoom: known(32000), history: history(0), lines: [line('c1', 40000)],
    }))
    expect(plan.availableRoom).toEqual(known(16000))
    expect(plan.applied).toBe(16000)
    expect(plan.retained).toBe(24000)
    expect(plan.limitations.map(item => item.code)).toContain('carryForwardCapped')
    expect(plan.applied + plan.retained).toBe(plan.planned)
  })

  it('never spends carried-in room on top of the remaining lifetime room', () => {
    // 35,000 already contributed leaves 5,000 of lifetime room. 5,000 of room
    // is carried in, and the year adds the published 8,000, so the year's room
    // would be 13,000 — but the lifetime limit binds the whole total at 5,000.
    const row = fhsaRoomYear(request({
      openedYear: known(2020), openingRoom: known(5000), history: history(35000), lines: [line('c1', 7000)],
    }))
    expect(row.carryForward).toEqual(known(5000))
    expect(row.annualAddition).toEqual(known(5000))
    expect(row.availableRoom).toEqual(known(5000))
    expect(row.applied).toBe(5000)
    expect(row.retained).toBe(2000)
    expect(row.cumulativeContributions).toEqual(known(40000))
    expect(remainingLifetime(row)).toBe(0)
    expect(closing(row)).toBe(0)
    expect(row.limitations.map(item => item.code)).toContain('lifetimeCapped')
  })
})

describe('BE-36 A annual boundary and carry-forward', () => {
  it('executes a contribution exactly at the annual limit and retains nothing', () => {
    const row = fhsaRoomYear(request({ lines: [line('c1', 8000)] }))
    expect(row.applied).toBe(8000)
    expect(row.retained).toBe(0)
    expect(closing(row)).toBe(0)
    expect(row.limitations.filter(item => item.code === 'annualCapped' || item.code === 'lifetimeCapped')).toEqual([])
  })

  it('retains one cent over the annual limit instead of discarding or over-running it', () => {
    const row = fhsaRoomYear(request({ lines: [line('c1', 8000.01)] }))
    expect(row.applied).toBe(8000)
    expect(row.retained).toBeCloseTo(0.01, 6)
    expect(row.applied + row.retained).toBeCloseTo(row.planned, 6)
    expect(closing(row)).toBe(0)
  })

  it('carries unused annual room one year forward and lets the lifetime cap bind', () => {
    // 2026: 6,000 contributed against 8,000 room, so 2,000 unused.
    const first = fhsaRoomYear(request({ year: 2026, lines: [line('c1', 6000)] }))
    expect(first.applied).toBe(6000)
    expect(closing(first)).toBe(2000)
    // 2027: opening is 2026's closing room; the year adds 8,000, so 10,000 is
    // available. 10,000 executes exactly and carries nothing.
    const carried = fhsaNextOpeningRoom(first)
    expect(carried).toEqual(known(2000))
    const second = fhsaRoomYear(request({
      year: 2027,
      openingRoom: carried!,
      history: history(6000),
      lines: [{ id: 'c2', calendarYear: 2027, amount: 10000, kind: 'ordinary' }],
    }))
    expect(second.annualAddition).toEqual(known(8000))
    expect(second.applied).toBe(10000)
    expect(second.retained).toBe(0)
    expect(closing(second)).toBe(0)
    // 2028: 16,000 cumulative leaves 9,000 of lifetime room, and the year's
    // bound is 8,000 plus 0 carry-forward, so exactly 8,000 is available.
    const third = fhsaRoomYear(request({
      year: 2028,
      openingRoom: fhsaNextOpeningRoom(second)!,
      history: history(16000),
      lines: [{ id: 'c3', calendarYear: 2028, amount: 8000, kind: 'ordinary' }],
    }))
    expect(third.annualAddition).toEqual(known(8000))
    expect(third.applied).toBe(8000)
    expect(closing(third)).toBe(0)
    // 6,000 + 10,000 + 8,000 = 24,000 contributed, so 16,000 of the 40,000
    // lifetime limit remains.
    expect(third.cumulativeContributions).toEqual(known(24000))
    expect(remainingLifetime(third)).toBe(16000)
  })

  it('holds the identity closing = carryForward + annualAddition - applied and never goes negative', () => {
    const row = fhsaRoomYear(request({
      openedYear: known(2024),
      openingRoom: known(9000),
      history: history(10000),
      lines: [line('c1', 4000), line('c2', 3000)],
    }))
    // Lifetime room at the start is 30,000, so the year adds the full 8,000 on
    // top of the carried-in room — but the carried-in room is itself capped at
    // the published 8,000 carryforward maximum, so 16,000 is available, 7,000 is
    // executed and 9,000 is left. The 1,000 of opening room above the maximum is
    // not spendable this year.
    expect(row.carryForward).toEqual(known(8000))
    expect(row.annualAddition).toEqual(known(8000))
    expect(row.availableRoom).toEqual(known(16000))
    expect(row.applied).toBe(7000)
    expect(closing(row)).toBe(9000)
    expect(closing(row)).toBeCloseTo(8000 + 8000 - 7000, 6)
    expect(row.applied + row.retained).toBe(row.planned)
    expect(closing(row)).toBeGreaterThanOrEqual(0)
  })

  it('re-runs idempotently and continues a snapshot without resetting or double counting', () => {
    const base = request({ openedYear: known(2024), openingRoom: known(5000), history: history(4000), lines: [line('c1', 6000)] })
    const once = fhsaRoomYear(base)
    const twice = fhsaRoomYear(base)
    expect(twice).toEqual(once)
    // 5,000 carried in + the year's 8,000 = 13,000 available; 6,000 applied
    // leaves 7,000. The next year opens at 7,000 and must not re-add the 6,000.
    expect(closing(once)).toBe(7000)
    const next = fhsaRoomYear(request({
      year: 2027,
      openedYear: known(2024),
      openingRoom: fhsaNextOpeningRoom(once)!,
      history: history(4000),
      lines: [{ id: 'c2', calendarYear: 2027, amount: 6000, kind: 'ordinary' }],
    }))
    expect(next.openingRoom).toEqual(known(7000))
    expect(next.applied).toBe(6000)
    expect(closing(next)).toBe(9000)
  })
})

describe('BE-36 A RRSP transfers', () => {
  it('refuses to price an unverifiable RRSP transfer rather than double counting a deduction', () => {
    const row = fhsaRoomYear(request({ lines: [line('t1', 8000, 'rrspTransfer')] }))
    expect(row.applied).toBe(0)
    expect(row.retained).toBe(8000)
    expect(row.limitations.map(item => item.code)).toContain('transferUnverified')
    expect(row.limitations.find(item => item.code === 'transferUnverified')?.detail).toBe(FHSA_TRANSFER_HISTORY_UNVERIFIED)
    // A refused transfer is money the room could not execute: it is retained and
    // never counted as an ordinary contribution, so it cannot be deducted twice
    // or silently converted into a contribution.
    expect(row.ordinaryPlanned).toBe(0)
    expect(row.rrspTransfers.status).toBe('unknown')
    expect(row.retained).toBe(row.planned)
  })

  it('refuses a mixed year rather than pricing the ordinary half and guessing at the transfer', () => {
    const row = fhsaRoomYear(request({ lines: [line('c1', 3000), line('t1', 5000, 'rrspTransfer')] }))
    expect(row.applied).toBe(0)
    expect(row.retained).toBe(8000)
    expect(row.cumulativeContributions.status).toBe('unknown')
  })

  it('counts a prior transfer in the lifetime basis exactly once', () => {
    // The statement total of 30,000 includes a 12,000 direct RRSP transfer and
    // 18,000 of contributions. It leaves 10,000 of lifetime room, so the year
    // adds the full 8,000 and 2,000 remains.
    const row = fhsaRoomYear(request({
      openedYear: known(2022),
      openingRoom: known(0),
      history: history(30000),
      lines: [line('c1', 8000)],
    }))
    expect(row.annualAddition).toEqual(known(8000))
    expect(row.applied).toBe(8000)
    expect(row.cumulativeContributions).toEqual(known(38000))
    expect(remainingLifetime(row)).toBe(2000)
    expect(row.rrspTransfers).toEqual(known(0))
  })
})

describe('BE-36 A unknown is never zero and zero is never unknown', () => {
  it('treats unknown history as unsupported and prices no contribution', () => {
    const row = fhsaRoomYear(request({ openingRoom: known(8000), history: undefined, lines: [line('c1', 8000)] }))
    expect(row.applied).toBe(0)
    expect(row.retained).toBe(8000)
    expect(row.closingRoom.status).toBe('unknown')
    expect(row.remainingLifetimeRoom.status).toBe('unknown')
    expect(row.limitations.some(item => item.code === 'historyUnknown' && item.detail === FHSA_HISTORY_MISSING)).toBe(true)
  })

  it('treats a confirmed zero history as a real zero and prices the first 8,000', () => {
    const row = fhsaRoomYear(request({ openedYear: known(2024), openingRoom: known(0), history: history(0), lines: [line('c1', 8000)] }))
    expect(row.applied).toBe(8000)
    expect(row.retained).toBe(0)
    expect(remainingLifetime(row)).toBe(32000)
    expect(row.closingRoom).toEqual(known(0))
    expect(row.limitations.map(item => item.code)).not.toContain('historyUnknown')
  })

  it('treats a known zero opening room as a real zero, not as unknown room', () => {
    const row = fhsaRoomYear(request({ openedYear: known(2024), openingRoom: known(0), history: history(0), lines: [line('c1', 3000)] }))
    // The account's first year adds the published 8,000 of participation room,
    // so a 3,000 contribution executes in full against a real zero opening.
    expect(row.annualAddition).toEqual(known(8000))
    expect(row.applied).toBe(3000)
    expect(row.retained).toBe(0)
    expect(row.closingRoom).toEqual(known(5000))
    expect(row.limitations.map(item => item.code)).not.toContain('openingRoomUnknown')
  })

  it('treats an unknown opening room as unsupported rather than as unlimited', () => {
    const row = fhsaRoomYear(request({ openingRoom: unknown('participation room statement not supplied'), lines: [line('c1', 8000)] }))
    expect(row.applied).toBe(0)
    expect(row.retained).toBe(8000)
    expect(row.limitations.map(item => item.code)).toContain('openingRoomUnknown')
  })

  it('refuses a person with no attributable FHSA rather than splitting a household bucket', () => {
    expect(ownFhsaAccount({ accounts: [] }, 'p1')).toEqual({ accountId: null, ambiguous: false })
    expect(ownFhsaAccount({ accounts: [fhsaAccount({ ownerId: null })] }, 'p1')).toEqual({ accountId: null, ambiguous: false })
    const one = fhsaAccount({ ownerId: 'p1' })
    expect(ownFhsaAccount({ accounts: [one] }, 'p1')).toEqual({ accountId: 'fhsa1', ambiguous: false })
    expect(ownFhsaAccount({ accounts: [one, fhsaAccount({ id: 'fhsa2' })] }, 'p1')).toEqual({ accountId: null, ambiguous: true })
    // The other person's FHSA is never the answer.
    expect(ownFhsaAccount({ accounts: [one] }, 'p2').accountId).toBeNull()
  })
})

describe('BE-36 A scope: BE-36 B behaviour stays unsupported', () => {
  it('refuses the 15-year maturity clock instead of rolling the balance over', () => {
    const row = fhsaRoomYear(request({
      openedYear: known(2011), year: 2026, openingRoom: known(0), history: history(30000), lines: [line('c1', 8000)],
    }))
    expect(row.limitations.map(item => item.code)).toContain('maturityUnsupported')
    expect(row.limitations.find(item => item.code === 'maturityUnsupported')?.detail).toBe(FHSA_MATURITY_UNSUPPORTED)
    // The maturity clock is refused, but it is not a blocking fact: room was
    // still available, so the contribution executes and no rollover happens.
    expect(row.applied).toBe(8000)
    expect(row.closingRoom.status).toBe('known')
  })

  it('gives a year before the account opens no participation room', () => {
    const row = fhsaRoomYear(request({ openedYear: known(2027), year: 2026, history: history(0), lines: [line('c1', 8000)] }))
    expect(row.applied).toBe(0)
    expect(row.retained).toBe(8000)
    expect(row.limitations.map(item => item.code)).toContain('notYetOpen')
    expect(row.annualAddition).toEqual(known(0))
  })
})

describe('BE-36 A two people and two modes share one ledger', () => {
  it('keeps per-person rows independent for different opening years', () => {
    const alice = fhsaRoomYear(request({
      personId: 'alice', accountId: 'a', openedYear: known(2026), openingRoom: known(0), history: history(0),
      lines: [line('c1', 8000)],
    }))
    const bob = fhsaRoomYear(request({
      personId: 'bob', accountId: 'b', openedYear: known(2020), openingRoom: known(0), history: history(30000),
      lines: [line('c2', 8000)],
    }))
    // Alice's own first year prices the full 8,000 from her stated room.
    expect(alice.applied).toBe(8000)
    expect(closing(alice)).toBe(0)
    // Bob's 30,000 of history leaves 10,000 of lifetime room, so his year adds
    // the full published 8,000 and 2,000 remains.
    expect(bob.applied).toBe(8000)
    expect(bob.retained).toBe(0)
    expect(bob.annualAddition).toEqual(known(8000))
    expect(remainingLifetime(bob)).toBe(2000)
    // Neither row can see the other person's history.
    expect(remainingLifetime(alice)).toBe(32000)
  })

  it('prices the panel preview and the kernel from the one recorded plan row', () => {
    const plan = planWith({})
    const account = plan.accounts.find(item => item.kind === 'fhsa')!
    // The one row the panel writes is the only plan the account has.
    plan.recurringContributions.push({
      id: fhsaPlanRowId(account.id), accountId: account.id, contributorId: account.ownerId,
      annualAmount: 11000, funding: 'fromSavings', provenance,
    })
    const preview = previewFhsaRoomYear(plan, account)
    const planned = fhsaPlannedYearRequest({ plan, account, year: plan.baseYear })
    expect(preview.savingsShare).toBe(11000)
    expect(planned.savingsShare).toBe(11000)
    // The preview *is* the kernel's request, not a parallel computation.
    expect(preview.ledger).toEqual(fhsaRoomYear(planned.request))
    expect(preview.ledger.applied).toBe(8000)
    expect(preview.ledger.retained).toBe(3000)
    expect(fhsaStatementHistory(plan, account.id)?.cumulativePriorContributions).toEqual(known(0))
    // A stale second row for the same account is not priced on top of it, in
    // the accessor, the preview or the kernel request.
    plan.recurringContributions.push({
      id: 'legacy:contribution:fhsa', accountId: account.id, contributorId: account.ownerId,
      annualAmount: 7000, funding: 'fromSavings', provenance,
    })
    expect(plannedFhsaContribution(plan, account.id)).toBe(11000)
    expect(previewFhsaRoomYear(plan, account).ledger).toEqual(preview.ledger)
    expect(fhsaRoomYear(fhsaPlannedYearRequest({ plan, account, year: plan.baseYear }).request)).toEqual(preview.ledger)
  })
})

describe('BE-36 A statement history is optional persisted data', () => {
  it('validates a canonical plan with and without an FHSA statement history', () => {
    const withHistory = planWith({})
    expect(() => assertCanonicalPlan(withHistory)).not.toThrow()
    const without = planWith({ omitHistory: true })
    expect(without.fhsaStatementHistory).toBeUndefined()
    expect(() => assertCanonicalPlan(without)).not.toThrow()
  })

  it('still hydrates an old persisted v11 envelope that has no FHSA field', () => {
    const plan = migratePersistedPlan({ inputs: DEFAULT_INPUTS }, 10, 2026)
    expect(plan.fhsaStatementHistory).toBeUndefined()
    expect(() => assertCanonicalPlan(plan)).not.toThrow()
  })
})

function fhsaAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'fhsa1', kind: 'fhsa', ownerId: 'p1', balance: 0, realReturn: 0.043, volatility: null, annualFee: 0.002,
    acb: unknown('not applicable'), taxableOwnerShares: { status: 'known', shares: { p1: 1 } },
    contributionRoom: known(8000), openedYear: known(2026), openedYearsAgoAtBaseYear: null, provenance: {},
    ...overrides,
  }
}

/** A minimal canonical plan through the real migration path, then patched. */
function planWith(options: { omitHistory?: boolean }): InputsV2 {
  const plan = migratePersistedPlan({ inputs: DEFAULT_INPUTS }, 10, 2026)
  plan.migration.ownershipNeedsConfirmation = false
  plan.migration.ageBasisNeedsConfirmation = false
  plan.migration.savingsBasisNeedsConfirmation = false
  plan.budget = {
    kind: 'savingsBudget', annualNetSavings: 40000, retirementSpending: 40000,
    debtIncluded: knownBool(true), taxBenefitIncluded: knownBool(true),
  }
  const person = plan.people[0]
  person.earnedIncome = known(100000)
  for (const kind of ['tfsa', 'rrsp', 'nonReg'] as const) {
    const account = plan.accounts.find(item => item.kind === kind)!
    account.ownerId = person.id
    account.taxableOwnerShares = { status: 'known', shares: { [person.id]: 1 } }
  }
  const fhsa = fhsaAccount({ ownerId: person.id, taxableOwnerShares: { status: 'known', shares: { [person.id]: 1 } }, balance: 120000 })
  plan.accounts.push(fhsa)
  if (!options.omitHistory) plan.fhsaStatementHistory = { [fhsa.id]: history(0) }
  return plan
}

describe('BE-36 A tolerance', () => {
  it('keeps the cents tolerance at the engine-wide figure', () => {
    expect(FHSA_MONEY_TOLERANCE).toBe(0.01)
  })
})
