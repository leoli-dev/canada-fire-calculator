import { describe, expect, it } from 'vitest'
import {
  RRSP_ADDITION_RULE_MISSING,
  RRSP_DEDUCTION_YEAR_POLICY,
  ownRrspAccount,
  rrspRoomYear,
  statementOpeningRoom,
  type RrspRoomRequest,
} from '../rrspRoom'
import type { Known } from '../model'

const known = (value: number): Known<number> => ({ status: 'known', value })
const unknown = (reason: string): Known<number> => ({ status: 'unknown', reason })

/** CRA statement vector from the household spec: deduction limit 20k, 5k of
 * contributions already made but not deducted, so 15k is available to deduct. */
const statement = {
  rrspDeductionLimit: known(20000),
  rrspAvailableRoom: unknown('available room not typed separately'),
  rrspUnusedUndeducted: known(5000),
  rrspPensionAdjustment: unknown('PA not supplied'),
  rrspPspa: unknown('PSPA not supplied'),
  rrspPar: unknown('PAR not supplied'),
}

const request = (overrides: Partial<RrspRoomRequest> = {}): RrspRoomRequest => ({
  personId: 'p1',
  year: 2026,
  openingRoom: known(15000),
  additions: known(0),
  adjustments: { pensionAdjustment: unknown('PA not supplied'), pspa: unknown('PSPA not supplied'), par: unknown('PAR not supplied') },
  adjustmentBasis: 'includedInStatement',
  unusedUndeducted: known(5000),
  deductionLimit: known(20000),
  lines: [{ id: 'c1', calendarYear: 2026, deductionYear: null, amount: 16000 }],
  ...overrides,
})

describe('BE-12 A RRSP room ledger', () => {
  it('derives statement opening room from the deduction limit less unused contributions (15k of 20k - 5k)', () => {
    const opening = statementOpeningRoom(statement)
    expect(opening.room).toEqual(known(15000))
    expect(opening.mismatch).toBeNull()
    const row = rrspRoomYear(request({ openingRoom: opening.room }))
    expect(row.planned).toBe(16000)
    expect(row.applied).toBe(15000)
    expect(row.retained).toBe(1000)
    expect(row.closingRoom).toEqual(known(0))
    expect(row.limitations).toEqual([])
  })

  it('accepts an explicit available-room line only when it agrees with the statement arithmetic', () => {
    const consistent = statementOpeningRoom({ ...statement, rrspAvailableRoom: known(15000) })
    expect(consistent.room).toEqual(known(15000))
    expect(consistent.mismatch).toBeNull()
    const conflicting = statementOpeningRoom({ ...statement, rrspAvailableRoom: known(12000) })
    expect(conflicting.room.status).toBe('unknown')
    expect(conflicting.mismatch?.code).toBe('statementMismatch')
    const row = rrspRoomYear(request({ openingRoom: conflicting.room, mismatch: conflicting.mismatch }))
    expect(row.applied).toBe(0)
    expect(row.retained).toBe(16000)
    expect(row.limitations.map(item => item.code)).toContain('statementMismatch')
  })

  it('reports an over-contributed statement as a real zero plus the excess, not as a contradiction', () => {
    // Hand calculation: deduction limit 20,000 less unused undeducted 25,000 is
    // -5,000. CRA prints available room as 0 for an over-contributor, so the
    // statement's own 0 line agrees with the floored arithmetic and the 5,000
    // excess is the over-contribution.
    const overstated = statementOpeningRoom({ ...statement, rrspUnusedUndeducted: known(25000), rrspAvailableRoom: known(0) })
    expect(overstated.room).toEqual(known(0))
    expect(overstated.mismatch).toBeNull()
    expect(overstated.overContribution).toBe(5000)
    // The same statement with the room line left blank: the derived figure is a
    // real zero, not unknown, and the excess is surfaced either way.
    const blankLine = statementOpeningRoom({ ...statement, rrspUnusedUndeducted: known(25000) })
    expect(blankLine.room).toEqual(known(0))
    expect(blankLine.room.status).toBe('known')
    expect(blankLine.mismatch).toBeNull()
    expect(blankLine.overContribution).toBe(5000)
    // A line that genuinely disagrees with the floored arithmetic is refused.
    const contradictory = statementOpeningRoom({ ...statement, rrspUnusedUndeducted: known(25000), rrspAvailableRoom: known(3000) })
    expect(contradictory.room.status).toBe('unknown')
    expect(contradictory.mismatch?.code).toBe('statementMismatch')
    expect(contradictory.overContribution).toBe(0)
    // The same floored arithmetic also accepts a consistent explicit line, and
    // a derived 15,000 stays distinct from a derived zero.
    expect(statementOpeningRoom({ ...statement, rrspAvailableRoom: known(15000) }).room).toEqual(known(15000))
    expect(statementOpeningRoom({ ...statement, rrspUnusedUndeducted: known(20000), rrspAvailableRoom: known(0) }).room).toEqual(known(0))
    // A known zero room prices no contribution and retains all of it, with no
    // statement-mismatch limitation.
    const row = rrspRoomYear(request({ openingRoom: overstated.room, mismatch: overstated.mismatch }))
    expect(row.applied).toBe(0)
    expect(row.retained).toBe(16000)
    expect(row.closingRoom).toEqual(known(0))
    expect(row.limitations).toEqual([])
  })

  it('keeps the identity closing = opening + additions + adjustments - applied and never goes negative', () => {
    const row = rrspRoomYear(request({
      openingRoom: known(15000),
      additions: known(0),
      adjustments: { pensionAdjustment: known(0), pspa: known(0), par: known(0) },
      adjustmentBasis: 'appliedHere',
      lines: [{ id: 'c1', calendarYear: 2026, deductionYear: null, amount: 16000 }],
    }))
    expect(row.adjustments).toEqual(known(0))
    expect(row.closingRoom.status).toBe('known')
    if (row.closingRoom.status !== 'known') throw new Error('expected known closing room')
    expect(row.closingRoom.value).toBeCloseTo(
      (row.openingRoom as { value: number }).value + (row.additions as { value: number }).value +
      (row.adjustments as { value: number }).value - row.applied, 9)
    expect(row.applied + row.retained).toBe(row.planned)
    expect(row.closingRoom.value).toBeGreaterThanOrEqual(0)
  })

  it('nets PAR up and PA/PSPA down only when the caller says they still apply', () => {
    const applied = rrspRoomYear(request({
      adjustments: { pensionAdjustment: known(2000), pspa: known(500), par: known(300) },
      adjustmentBasis: 'appliedHere',
      openingRoom: known(10000),
      additions: known(1000),
      lines: [{ id: 'c1', calendarYear: 2026, deductionYear: null, amount: 20000 }],
    }))
    expect(applied.adjustments).toEqual(known(-2200))
    expect(applied.applied).toBe(8800)
    expect(applied.retained).toBe(11200)
    expect(applied.closingRoom).toEqual(known(0))
    // The statement already nets PA/PSPA/PAR into its available room: applying
    // them a second time would double count.
    const included = rrspRoomYear(request({
      adjustments: { pensionAdjustment: known(2000), pspa: known(500), par: known(300) },
      adjustmentBasis: 'includedInStatement',
      openingRoom: known(10000),
      additions: known(0),
      lines: [{ id: 'c1', calendarYear: 2026, deductionYear: null, amount: 10000 }],
    }))
    expect(included.adjustments).toEqual(known(0))
    expect(included.applied).toBe(10000)
    expect(included.pensionAdjustment).toEqual(known(2000))
    expect(included.pspa).toEqual(known(500))
    expect(included.par).toEqual(known(300))
  })

  it('distinguishes unknown room from a real zero and never treats either as unlimited', () => {
    const unknownRoom = rrspRoomYear(request({ openingRoom: unknown('CRA statement not supplied') }))
    expect(unknownRoom.applied).toBe(0)
    expect(unknownRoom.retained).toBe(16000)
    expect(unknownRoom.closingRoom.status).toBe('unknown')
    expect(unknownRoom.limitations.map(item => item.code)).toContain('roomUnknown')
    const zeroRoom = rrspRoomYear(request({ openingRoom: known(0), additions: known(0) }))
    expect(zeroRoom.applied).toBe(0)
    expect(zeroRoom.retained).toBe(16000)
    expect(zeroRoom.closingRoom).toEqual(known(0))
    expect(zeroRoom.limitations).toEqual([])
    expect(unknownRoom.closingRoom).not.toEqual(zeroRoom.closingRoom)
  })

  it('withholds an unsourced room addition instead of inventing one from this year', () => {
    const row = rrspRoomYear(request({
      openingRoom: known(0),
      additions: unknown(RRSP_ADDITION_RULE_MISSING),
      adjustmentBasis: 'appliedHere',
      lines: [{ id: 'c1', calendarYear: 2026, deductionYear: null, amount: 25000 }],
    }))
    expect(row.applied).toBe(0)
    expect(row.retained).toBe(25000)
    expect(row.closingRoom.status).toBe('unknown')
    expect(row.limitations.map(item => item.code)).toContain('additionUnsourced')
    expect(RRSP_ADDITION_RULE_MISSING).toMatch(/18%/)
  })

  it('carries closing room into the next year and re-runs without drift or double counting', () => {
    const first = rrspRoomYear(request({ lines: [{ id: 'c1', calendarYear: 2026, deductionYear: null, amount: 5000 }] }))
    expect(first.closingRoom).toEqual(known(10000))
    const carried = first.closingRoom
    const second = rrspRoomYear(request({
      year: 2027,
      openingRoom: carried,
      additions: known(0),
      adjustmentBasis: 'appliedHere',
      adjustments: { pensionAdjustment: known(0), pspa: known(0), par: known(0) },
      lines: [{ id: 'c2', calendarYear: 2027, deductionYear: null, amount: 4000 }],
    }))
    expect(second.openingRoom).toEqual(first.closingRoom)
    expect(second.closingRoom).toEqual(known(6000))
    const rerun = rrspRoomYear(request({ lines: [{ id: 'c1', calendarYear: 2026, deductionYear: null, amount: 5000 }] }))
    expect(rerun).toEqual(first)
    const third = rrspRoomYear(request({
      year: 2028,
      openingRoom: second.closingRoom,
      additions: known(0),
      adjustmentBasis: 'appliedHere',
      adjustments: { pensionAdjustment: known(0), pspa: known(0), par: known(0) },
      lines: [],
    }))
    expect(third.openingRoom).toEqual(second.closingRoom)
    expect(third.planned).toBe(0)
    expect(third.applied).toBe(0)
    expect(third.retained).toBe(0)
  })

  it('reads the deduction year separately, defers a later deduction and refuses an earlier one', () => {
    const deferred = rrspRoomYear(request({
      openingRoom: known(30000),
      lines: [{ id: 'c1', calendarYear: 2026, deductionYear: 2027, amount: 8000 }],
    }))
    expect(deferred.deductedThisYear).toBe(0)
    expect(deferred.deferredDeduction).toBe(8000)
    const sameYear = rrspRoomYear(request({
      openingRoom: known(30000),
      lines: [{ id: 'c1', calendarYear: 2026, deductionYear: null, amount: 8000 }],
    }))
    expect(sameYear.deductedThisYear).toBe(8000)
    expect(sameYear.deferredDeduction).toBe(0)
    expect(RRSP_DEDUCTION_YEAR_POLICY).toMatch(/policy/i)
    const earlier = rrspRoomYear(request({
      openingRoom: known(30000),
      lines: [{ id: 'c1', calendarYear: 2026, deductionYear: 2025, amount: 8000 }],
    }))
    expect(earlier.limitations.map(item => item.code)).toContain('deductionYearBeforeContribution')
  })

  it('clips line by line so each retained amount stays attached to its own contribution', () => {
    const row = rrspRoomYear(request({
      openingRoom: known(10000),
      lines: [
        { id: 'a', calendarYear: 2026, deductionYear: null, amount: 6000 },
        { id: 'b', calendarYear: 2026, deductionYear: 2027, amount: 9000 },
      ],
    }))
    expect(row.applied).toBe(10000)
    expect(row.retained).toBe(5000)
    expect(row.deductedThisYear).toBe(6000)
    expect(row.deferredDeduction).toBe(4000)
  })

  it('finds the one own RRSP account and refuses to guess between duplicates', () => {
    const account = (id: string, kind: string, ownerId: string | null) => ({
      id, kind, ownerId, balance: 0, realReturn: 0, volatility: null, annualFee: 0,
      acb: unknown('basis'), taxableOwnerShares: ownerId ? { status: 'known' as const, shares: { [ownerId]: 1 } } : unknown('owner'),
      contributionRoom: unknown('room'), openedYear: unknown('year'), provenance: {},
    })
    const plan = { people: [{ id: 'p1' }], accounts: [account('rrsp', 'rrsp', 'p1'), account('tfsa', 'tfsa', 'p1')] } as never
    expect(ownRrspAccount(plan, 'p1')).toEqual({ accountId: 'rrsp', ambiguous: false })
    const duplicated = { people: [{ id: 'p1' }], accounts: [account('rrsp', 'rrsp', 'p1'), account('rrsp2', 'rrsp', 'p1')] } as never
    expect(ownRrspAccount(duplicated, 'p1')).toEqual({ accountId: null, ambiguous: true })
    const none = { people: [{ id: 'p1' }], accounts: [account('tfsa', 'tfsa', 'p1')] } as never
    expect(ownRrspAccount(none, 'p1')).toEqual({ accountId: null, ambiguous: false })
  })
})
