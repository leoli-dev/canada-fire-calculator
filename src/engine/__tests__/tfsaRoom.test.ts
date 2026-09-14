import { describe, expect, it } from 'vitest'
import type { Inputs } from '../types'
import type { InputsV2, Known } from '../model'
import { migratePersistedPlan } from '../migration'
import { annualStep, initializeState, projectFromState, type AnnualProviders } from '../annualState'
import {
  TFSA_ADDITION_RULE_MISSING, TFSA_BLOCKING, TFSA_OUT_OF_SCOPE, TFSA_ROOM_UNKNOWN_NO_CONTRIBUTION,
  TFSA_STATEMENT_ROOM_BASIS, annualTfsaAdditionFor, plannedTfsaLines, previewTfsaRoomYear, restoredRoom,
  tfsaRoomYear, type TfsaRoomRequest, type TfsaRoomYear,
} from '../tfsaRoom'

/** BE-27 A: independent expected values, never produced by the code under test. */

const known = (value: number): Known<number> => ({ status: 'known', value })
const unknown = (reason: string): Known<number> => ({ status: 'unknown', reason })
const value = (fact: Known<number>) => fact.status === 'known' ? fact.value : Number.NaN

/** Room 5,000 and a planned 8,000 is the slice's own worked vector. */
const request = (overrides: Partial<TfsaRoomRequest> = {}): TfsaRoomRequest => ({
  personId: 'person:self', year: 2026, statementYear: 2026,
  openingRoom: known(5000),
  annualAddition: annualTfsaAdditionFor(2026, 2026),
  withdrawals: [],
  lines: [{ id: 'annual:2026:tfsa', calendarYear: 2026, amount: 8000 }],
  ...overrides,
})

/** `closing = opening + addition + restored − applied`, to cents. */
function expectIdentity(row: TfsaRoomYear) {
  expect(row.closingRoom.status).toBe('known')
  const identity = value(row.openingRoom) + value(row.annualAddition) + value(row.restored) - row.applied
  expect(Math.abs(identity - value(row.closingRoom))).toBeLessThanOrEqual(0.01)
  expect(value(row.closingRoom)).toBeGreaterThanOrEqual(0)
  expect(Math.abs(row.applied + row.retained - row.planned)).toBeLessThanOrEqual(0.01)
}

describe('BE-27 A TFSA room ledger', () => {
  it('clips a planned 8,000 against 5,000 of room and retains the 3,000 remainder', () => {
    const row = tfsaRoomYear(request())
    expect(row.openingRoom).toEqual(known(5000))
    expect(row.annualAddition).toEqual(known(0))
    expect(row.restored).toEqual(known(0))
    expect(row.availableRoom).toEqual(known(5000))
    expect(row.planned).toBe(8000)
    expect(row.applied).toBe(5000)
    expect(row.retained).toBe(3000)
    expect(row.closingRoom).toEqual(known(0))
    expect(row.lines).toEqual([{ id: 'annual:2026:tfsa', calendarYear: 2026, planned: 8000, applied: 5000, retained: 3000 }])
    expect(row.limitations.map(item => item.code)).toEqual(['roomClipped'])
    expectIdentity(row)
  })

  it('restores a 10,000 withdrawal in the next year and never in the same year', () => {
    const withdrawals = [{ id: 'w:2026', calendarYear: 2026, amount: 10_000 }]
    const sameYear = tfsaRoomYear(request({ withdrawals, openingRoom: known(0), lines: [] }))
    expect(sameYear.restored).toEqual(known(0))
    expect(sameYear.closingRoom).toEqual(known(0))
    // The next year adds the freed room once, and only once.
    const nextYear = tfsaRoomYear(request({
      year: 2027, withdrawals, openingRoom: sameYear.closingRoom, lines: [{ id: 'annual:2027:tfsa', calendarYear: 2027, amount: 4000 }],
    }))
    expect(nextYear.restored).toEqual(known(10_000))
    expect(nextYear.availableRoom).toEqual(known(10_000))
    expect(nextYear.applied).toBe(4000)
    expect(nextYear.closingRoom).toEqual(known(6000))
    expectIdentity(nextYear)
    // A year later the same withdrawal is gone: a year boundary cannot double-add it.
    const third = tfsaRoomYear(request({
      year: 2028, withdrawals, openingRoom: nextYear.closingRoom, lines: [],
    }))
    expect(third.restored).toEqual(known(0))
    expect(third.openingRoom).toEqual(nextYear.closingRoom)
    expect(third.closingRoom).toEqual(nextYear.closingRoom)
    expectIdentity(third)
  })

  it('does not restore a withdrawal the recorded room figure already contains', () => {
    // The room figure is the plan year's own: it already contains withdrawals
    // made before it, so restoring one again would spend the same room twice.
    const before = tfsaRoomYear(request({
      year: 2026, withdrawals: [{ id: 'w:2025', calendarYear: 2025, amount: 9000 }], openingRoom: known(5000), lines: [],
    }))
    expect(before.restored).toEqual(known(0))
    // With no withdrawal in the prior year the answer is a real zero, not unknown.
    expect(restoredRoom({ year: 2026, statementYear: 2026, withdrawals: [] })).toEqual(known(0))
  })

  it('recomputes deterministically and never mutates its request', () => {
    const line = { id: 'annual:2026:tfsa', calendarYear: 2026, amount: 8000 }
    const input = request({ lines: [line] })
    const snapshot = structuredClone(input)
    const first = tfsaRoomYear(input)
    const second = tfsaRoomYear(input)
    expect(second).toEqual(first)
    expect(input).toEqual(snapshot)
    expect(line.amount).toBe(8000)
  })

  it('prices two people from their own room and never merges them', () => {
    const left = tfsaRoomYear(request({ personId: 'person:self', openingRoom: known(5000) }))
    const right = tfsaRoomYear(request({ personId: 'person:partner', openingRoom: known(900) }))
    expect(left.applied).toBe(5000)
    expect(left.retained).toBe(3000)
    expect(left.closingRoom).toEqual(known(0))
    expect(right.personId).toBe('person:partner')
    expect(right.applied).toBe(900)
    expect(right.retained).toBe(7100)
    expect(right.closingRoom).toEqual(known(0))
    expectIdentity(left)
    expectIdentity(right)
  })

  it('keeps a known zero and an unknown room distinguishable', () => {
    const zero = tfsaRoomYear(request({ openingRoom: known(0) }))
    // A known zero is a real, priceable answer: nothing executes, closing is zero.
    expect(zero.applied).toBe(0)
    expect(zero.retained).toBe(8000)
    expect(zero.closingRoom).toEqual(known(0))
    expect(zero.limitations.map(item => item.code)).toEqual(['roomClipped'])
    expectIdentity(zero)

    const unconfirmed = tfsaRoomYear(request({ openingRoom: unknown('CRA statement not supplied') }))
    // Unknown is neither unlimited room nor zero: nothing executes, the money is
    // retained, and the closing room stays unknown with a concrete reason.
    expect(unconfirmed.applied).toBe(0)
    expect(unconfirmed.retained).toBe(8000)
    expect(unconfirmed.availableRoom.status).toBe('unknown')
    expect(unconfirmed.closingRoom).toMatchObject({ status: 'unknown', reason: expect.stringContaining('CRA statement not supplied') })
    expect(unconfirmed.limitations.map(item => item.code)).toEqual(['roomUnknown', 'unexecuted'])
    expect(unconfirmed.limitations.find(item => item.code === 'unexecuted')?.detail).toContain(TFSA_ROOM_UNKNOWN_NO_CONTRIBUTION)
    expect(unconfirmed.limitations.find(item => item.code === 'unexecuted')?.detail).toContain('retained in the non-registered account')
  })

  it('never lets room go negative and keeps conservation over many room shapes', () => {
    for (const opening of [0, 0.01, 2500, 5000, 8000, 3000.33]) {
      for (const planned of [0, 0.005, 1, 3000, 8000, 10000]) {
        const row = tfsaRoomYear(request({ openingRoom: known(opening), lines: [{ id: 'l', calendarYear: 2026, amount: planned }] }))
        expectIdentity(row)
        expect(value(row.closingRoom)).toBeGreaterThanOrEqual(0)
        expect(row.applied + row.retained).toBeCloseTo(row.planned, 10)
        expect(row.applied).toBeLessThanOrEqual(opening + 0.01)
      }
    }
  })

  it('sources the statement year’s addition and refuses to invent a later one', () => {
    // The CRA room figure for its own year already contains that year's limit.
    expect(annualTfsaAdditionFor(2026, 2026)).toEqual(known(0))
    expect(TFSA_STATEMENT_ROOM_BASIS).toContain('annual dollar limit')
    const later = annualTfsaAdditionFor(2027, 2026)
    expect(later.status).toBe('unknown')
    expect(later.status === 'unknown' && later.reason).toBe(TFSA_ADDITION_RULE_MISSING(2027))
    expect(later.status === 'unknown' && later.reason).toContain('no sourced TFSA annual dollar limit')
    // A room figure dated after the year being priced cannot price it either.
    const early = annualTfsaAdditionFor(2025, 2026)
    expect(early.status).toBe('unknown')
    expect(early.status === 'unknown' && early.reason).toContain('cannot price 2025')
    // With no sourced later addition the ledger prices nothing and retains it all.
    const row = tfsaRoomYear(request({ year: 2027, openingRoom: known(1000), annualAddition: later }))
    expect(row.applied).toBe(0)
    expect(row.retained).toBe(8000)
    expect(row.closingRoom.status).toBe('unknown')
    expect(row.limitations.map(item => item.code)).toEqual(['additionUnsourced', 'unexecuted'])
  })

  it('states every out-of-scope policy as unsupported with a concrete reason', () => {
    expect(TFSA_OUT_OF_SCOPE.map(item => item.id)).toEqual([
      'surplusRefillPolicy', 'rrifForcedSurplusReinvestment', 'surplusStrategyComparison', 'internalCompliantTransfer',
    ])
    for (const item of TFSA_OUT_OF_SCOPE) expect(item.reason.length).toBeGreaterThan(40)
    expect(TFSA_OUT_OF_SCOPE.find(item => item.id === 'internalCompliantTransfer')?.reason).toContain('not a withdrawal')
    expect([...TFSA_BLOCKING]).toEqual(['roomUnknown', 'additionUnsourced'])
  })
})

/* ------------------------------------------------------------------ *
 * The kernel side: the same ledger is what `annualStep` prices, so the *
 * retention is visible in the cash ledger and no money disappears.     *
 * ------------------------------------------------------------------ */

const input = (): Inputs => ({
  currentAge: 40, fireAge: 60, lifeExpectancy: 90, province: 'ON', annualSavings: 8000,
  savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 }, retirementSpending: 0, fees: 0,
  returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, balances: { tfsa: 1000, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
  cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0, strategy: 'tfsaFirst', debts: [],
})

function plan(legacy: Inputs = input()): InputsV2 {
  const result = migratePersistedPlan({ inputs: legacy }, 10, 2026)
  result.migration = { sourcePersistVersion: 11, ownershipNeedsConfirmation: false, ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
  result.budget = { kind: 'savingsBudget', annualNetSavings: legacy.annualSavings, retirementSpending: legacy.retirementSpending,
    debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } }
  result.inflation = 0
  for (const person of result.people) person.tfsaAvailableRoom = known(5000)
  return result
}

/** Evaluated cash equals the stated net savings, so the year can settle. */
const providers: AnnualProviders = {
  evaluate: ({ state }) => {
    const count = Object.keys(state.byPerson).length
    return { byPerson: Object.fromEntries(Object.keys(state.byPerson).map(id => [id, {
      income: 8000 / count, earnedIncome: 8000 / count, benefits: 0, tax: 0, spending: 0, taxableIncome: 8000 / count,
      benefitIncomeForNextYear: { status: 'known' as const, value: 8000 / count },
    }])) }
  },
  returns: () => 0,
}
const ok = <T>(result: { status: string; value?: T }): T => { expect(result.status).toBe('ok'); return result.value! }
const selfId = (canonical: InputsV2) => canonical.people[0].id

describe('BE-27 A kernel integration', () => {
  it('prices the base year through the ledger and retains the clipped share', () => {
    const canonical = plan()
    const { state, row } = ok(annualStep(canonical, ok(initializeState(canonical)), providers))
    const tfsa = canonical.accounts.find(account => account.kind === 'tfsa')!.id
    const nonReg = canonical.accounts.find(account => account.kind === 'nonReg')!.id
    expect(row.tfsaLedger[selfId(canonical)]).toMatchObject({ planned: 8000, applied: 5000, retained: 3000, closingRoom: { status: 'known', value: 0 } })
    expect(row.byAccount[tfsa].contribution).toBe(5000)
    // The clipped 3,000 is not deleted: it lands in the non-registered account.
    expect(row.byAccount[nonReg].contribution).toBe(3000)
    expect(row.cashLedger.retainedContributions).toBe(3000)
    expect(state.byPerson[selfId(canonical)].tfsaRoom).toEqual(known(0))
    expect(state.contributionHistory).toContainEqual(expect.objectContaining({ id: 'annual:2026:tfsa', accountId: tfsa, contributorId: selfId(canonical), amount: 5000 }))
  })

  it('carries the closing room into the next year without resetting or double counting', () => {
    const canonical = plan()
    const first = ok(annualStep(canonical, ok(initializeState(canonical)), providers))
    const second = ok(annualStep(canonical, first.state, providers))
    const tfsa = canonical.accounts.find(account => account.kind === 'tfsa')!.id
    // The second year opens where the first closed: no reset to the statement.
    expect(second.row.tfsaLedger[selfId(canonical)].openingRoom).toEqual(first.row.tfsaLedger[selfId(canonical)].closingRoom)
    expect(second.row.tfsaLedger[selfId(canonical)].openingRoom).toEqual(known(0))
    // The later year's addition is not sourced, so it executes nothing and
    // retains the whole share rather than silently continuing to contribute.
    expect(second.row.tfsaLedger[selfId(canonical)]).toMatchObject({ applied: 0, retained: 8000, planned: 8000 })
    expect(second.row.byAccount[tfsa].contribution).toBe(0)
    expect(second.row.cashLedger.retainedContributions).toBe(8000)
    // A snapshot continuation reproduces the same row rather than a new one.
    const resumed = ok(projectFromState(canonical, first.state, 1, providers))
    expect(resumed.rows[0]).toEqual(second.row)
    expect(resumed.state).toEqual(second.state)
  })

  it('retains an unconfirmed room instead of refusing the year, and keeps the TFSA balance live', () => {
    const canonical = plan()
    canonical.people[0].tfsaAvailableRoom = unknown('CRA statement not supplied')
    const initial = ok(initializeState(canonical))
    const { state, row } = ok(annualStep(canonical, initial, providers))
    const tfsa = canonical.accounts.find(account => account.kind === 'tfsa')!.id
    const ledger = row.tfsaLedger[selfId(canonical)]
    expect(ledger.applied).toBe(0)
    expect(ledger.retained).toBe(8000)
    expect(ledger.closingRoom.status).toBe('unknown')
    expect(ledger.limitations.map(item => item.code)).toContain('unexecuted')
    // The existing balance is still simulated: the opening 1,000 is untouched.
    expect(row.byAccount[tfsa]).toMatchObject({ opening: 1000, contribution: 0, closing: 1000 })
    expect(state.byAccount[tfsa].balance).toBe(1000)
    expect(row.cashLedger.retainedContributions).toBe(8000)
  })

  it('treats a known zero room as a real zero, not as unknown', () => {
    const canonical = plan()
    canonical.people[0].tfsaAvailableRoom = known(0)
    const { row } = ok(annualStep(canonical, ok(initializeState(canonical)), providers))
    const ledger = row.tfsaLedger[selfId(canonical)]
    expect(ledger.openingRoom).toEqual(known(0))
    expect(ledger.closingRoom).toEqual(known(0))
    expect(ledger.retained).toBe(8000)
    expect(ledger.limitations.map(item => item.code)).toEqual(['roomClipped'])
  })

  it('ignores the account’s own room column, which is not the per-person room', () => {
    const canonical = plan()
    const tfsa = canonical.accounts.find(account => account.kind === 'tfsa')!
    tfsa.contributionRoom = { status: 'unknown', reason: 'statement not supplied' }
    const priced = ok(annualStep(canonical, ok(initializeState(canonical)), providers))
    expect(priced.row.tfsaLedger[selfId(canonical)].applied).toBe(5000)
    expect(priced.state.byAccount[tfsa.id].room).toEqual(unknown('statement not supplied'))
    const tiny = plan()
    tiny.accounts.find(account => account.kind === 'tfsa')!.contributionRoom = known(1)
    expect(ok(annualStep(tiny, ok(initializeState(tiny)), providers)).row.tfsaLedger[selfId(tiny)].applied).toBe(5000)
  })

  it('shows the panel the same ledger the kernel prices', () => {
    const canonical = plan()
    const preview = previewTfsaRoomYear(canonical, canonical.people[0])
    const priced = ok(annualStep(canonical, ok(initializeState(canonical)), providers)).row.tfsaLedger[selfId(canonical)]
    expect(preview.savingsShare).toBe(priced.planned)
    expect(preview.ledger.applied).toBe(priced.applied)
    expect(preview.ledger.retained).toBe(priced.retained)
    expect(preview.ledger.closingRoom).toEqual(priced.closingRoom)
  })

  it('surfaces the room a recorded withdrawal will restore next year', () => {
    const canonical = plan()
    canonical.tfsaStatement = { [selfId(canonical)]: { withdrawals: [{ id: 'w:2026', calendarYear: 2026, amount: 10_000 }], provenance: { origin: 'user', sourceYear: 2026 } } }
    const preview = previewTfsaRoomYear(canonical, canonical.people[0])
    expect(preview.ledger.restored).toEqual(known(0))
    expect(preview.restoredNextYear).toEqual(known(10_000))
  })

  it('keeps a scheduled TFSA row and a couple’s TFSA share explicitly unsupported', () => {
    const scheduled = plan()
    scheduled.contributions = [{
      id: 'be27:scheduled', accountId: scheduled.accounts.find(account => account.kind === 'tfsa')!.id,
      contributorId: selfId(scheduled), calendarYear: 2026, amount: 100, deductionYear: null,
      provenance: { origin: 'user', sourceYear: 2026 },
    }]
    expect(annualStep(scheduled, ok(initializeState(scheduled)), providers)).toMatchObject({
      status: 'unsupported', issues: [{ detail: expect.stringContaining('scheduled tfsa contribution rule not yet wired') }] })

    const couple = plan({ ...input(), partner: { currentAge: 38, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 } })
    for (const account of couple.accounts) {
      account.ownerId = selfId(couple)
      account.taxableOwnerShares = { status: 'known', shares: { [selfId(couple)]: 1 } }
    }
    couple.people[1].tfsaAvailableRoom = known(5000)
    expect(annualStep(couple, ok(initializeState(couple)), providers)).toMatchObject({
      status: 'unsupported', issues: [{ detail: expect.stringContaining('couple TFSA contributor') }] })
  })

  it('plans the same synthetic contribution line the panel and kernel share', () => {
    expect(plannedTfsaLines({ personId: 'person:self', year: 2026, savingsShare: 8000 }))
      .toEqual([{ id: 'annual:2026:tfsa', calendarYear: 2026, amount: 8000 }])
    expect(plannedTfsaLines({ personId: 'person:self', year: 2026, savingsShare: 0 })).toEqual([])
    expect(plannedTfsaLines({ personId: 'person:self', year: 2026, savingsShare: -5 })).toEqual([])
  })

  it('keeps a TFSA contribution out of the RRSP and FHSA ledgers', () => {
    const canonical = plan()
    const { row } = ok(annualStep(canonical, ok(initializeState(canonical)), providers))
    expect(row.fhsaLedger).toEqual({})
    expect(Object.values(row.rrspLedger).map(item => item.applied)).toEqual([0])
    expect(row.tfsaLedger[selfId(canonical)].applied).toBe(5000)
  })

  it('does not move a cent of the year’s cash out of conservation when it clips', () => {
    const canonical = plan()
    const { state, row } = ok(annualStep(canonical, ok(initializeState(canonical)), providers))
    const tfsa = canonical.accounts.find(account => account.kind === 'tfsa')!.id
    const nonReg = canonical.accounts.find(account => account.kind === 'nonReg')!.id
    // The year's whole 8,000 is still somewhere: 5,000 executed and 3,000
    // retained, and the two accounts between them hold the opening 1,000 too.
    expect(row.cashLedger.voluntaryContributions).toBe(8000)
    expect(row.cashLedger.retainedContributions).toBe(3000)
    expect(Object.values(row.byAccount).reduce((total, account) => total + account.contribution, 0)).toBe(8000)
    expect(row.byAccount[tfsa].contribution + row.byAccount[nonReg].contribution).toBe(8000)
    expect(state.byAccount[tfsa].balance + state.byAccount[nonReg].balance).toBe(9000)
  })
})
