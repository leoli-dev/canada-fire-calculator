import { describe, expect, it } from 'vitest'
import type { Inputs } from '../types'
import type { InputsV2, Known } from '../model'
import { migratePersistedPlan } from '../migration'
import { RRSP_MONEY_TOLERANCE } from '../rrspRoom'
import {
  ATTRIBUTION_WINDOW_YEARS,
  SPOUSAL_HISTORY_UNKNOWN_REASON,
  attributeSpousalPayment,
  attributionWindowYears,
  isInAttributionWindow,
  knownRrifMinimum,
  spousalPremiumLines,
  type SpousalAttributionResult,
  type SpousalPremium,
} from '../spousalAttribution'
import { calculatePersonIncome } from '../personIncome'

const known = (value: number): Known<number> => ({ status: 'known', value })

const premium = (id: string, calendarYear: number, amount: number, overrides: Partial<SpousalPremium> = {}): SpousalPremium =>
  ({ id, calendarYear, deductionYear: null, contributorId: 'partner', amount, attributed: 0, ...overrides })

/** One contributor, one plan, no RRIF minimum. */
const request = (overrides: Partial<Parameters<typeof attributeSpousalPayment>[0]> = {}) => ({
  payment: 10_000,
  paymentYear: 2026,
  contributorId: 'partner',
  annuitantId: 'self',
  premiums: [] as SpousalPremium[] | null,
  rrifMinimum: null as Known<number> | null,
  annuitantIncomeBefore: 0,
  ...overrides,
})

const ok = (result: SpousalAttributionResult) => {
  expect(result.status).toBe('ok')
  if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}: ${result.reason}`)
  return result
}

describe('BE-12 B T2205 spousal attribution window', () => {
  it('attributes a payment in the contribution year and the two following years, but not the third', () => {
    // ITA s.146(8.3)(a): premiums "in the year or in one of the two
    // immediately preceding taxation years". A 2026 premium therefore reaches
    // a 2026, 2027 or 2028 payment; 2029 is outside the window.
    expect(ATTRIBUTION_WINDOW_YEARS).toBe(2)
    expect(attributionWindowYears(2028)).toEqual([2026, 2027, 2028])
    expect(isInAttributionWindow(2026, 2028)).toBe(true)
    expect(isInAttributionWindow(2026, 2029)).toBe(false)
    expect(isInAttributionWindow(2026, 2025)).toBe(false)
    const premiums = [premium('p2026', 2026, 2_000)]
    for (const paymentYear of [2026, 2027, 2028]) {
      const result = ok(attributeSpousalPayment(request({ premiums, paymentYear, payment: 1_500 })))
      expect(result.attributedToContributor, String(paymentYear)).toBe(1_500)
      expect(result.taxedToAnnuitant, String(paymentYear)).toBe(0)
    }
    const outside = ok(attributeSpousalPayment(request({ premiums, paymentYear: 2029, payment: 1_500 })))
    expect(outside.attributedToContributor).toBe(0)
    expect(outside.taxedToAnnuitant).toBe(1_500)
    expect(outside.lines).toEqual([])
  })

  it('reproduces the IT-307R4 paragraph 9 vector: 2,000 premium, 3,000 payment, 2,000 attributed', () => {
    // CRA IT-307R4 para. 9: a 2,000 premium in 1999 with no other premiums in
    // 1997, 1998, 2000 or 2001 attributes up to 2,000 of a withdrawal in 1999,
    // 2000 or 2001. A 3,000 withdrawal leaves the annuitant with a 2,000
    // deduction, so 1,000 is the annuitant's own income.
    const premiums = [premium('p1999', 1999, 2_000)]
    const result = ok(attributeSpousalPayment(request({ premiums, paymentYear: 2001, payment: 3_000 })))
    expect(result.attributedToContributor).toBe(2_000)
    expect(result.taxedToAnnuitant).toBe(1_000)
  })

  it('reproduces the IT-307R4 paragraph 11 vector: 1,000 in each of three years, 5,000 withdrawn, 3,000 attributed', () => {
    const premiums = [premium('p1999', 1999, 1_000), premium('p2000', 2000, 1_000), premium('p2001', 2001, 1_000)]
    const result = ok(attributeSpousalPayment(request({ premiums, paymentYear: 2001, payment: 5_000 })))
    expect(result.attributedToContributor).toBe(3_000)
    expect(result.taxedToAnnuitant).toBe(2_000)
  })

  it('reproduces the 1990 severed letter AC59521 vector where the deposit year, not the deduction year, sets the window', () => {
    // CRA severed letter AC59521 (22 February 1990): deposits of 1,000 on
    // 5 Feb 1987 (deducted for 1986), 1,000 on 1 Jan 1988 (deducted for 1987)
    // and 500 on 1 Mar 1989 (deducted for 1988); a 1991 withdrawal attributes
    // only the 500. The two earlier deposits fall outside the contribution-year
    // window even though their deduction years look closer.
    const premiums = [
      premium('d1987', 1987, 1_000, { deductionYear: 1986 }),
      premium('d1988', 1988, 1_000, { deductionYear: 1987 }),
      premium('d1989', 1989, 500, { deductionYear: 1988 }),
    ]
    const result = ok(attributeSpousalPayment(request({ premiums, paymentYear: 1991, payment: 2_500 })))
    expect(result.attributedToContributor).toBe(500)
    expect(result.taxedToAnnuitant).toBe(2_000)
  })

  it('handles exactly-equal and just-over eligible premiums at the window boundary', () => {
    const premiums = [premium('a', 2025, 3_000), premium('b', 2026, 2_000)]
    const exact = ok(attributeSpousalPayment(request({ premiums, paymentYear: 2027, payment: 5_000 })))
    expect(exact.inWindowUnattributed).toBe(5_000)
    expect(exact.attributedToContributor).toBe(5_000)
    expect(exact.taxedToAnnuitant).toBe(0)
    const over = ok(attributeSpousalPayment(request({ premiums, paymentYear: 2027, payment: 5_001 })))
    expect(over.attributedToContributor).toBe(5_000)
    expect(over.taxedToAnnuitant).toBe(1)
    // A premium one year outside the window contributes nothing, even when the
    // payment exceeds the in-window total.
    const withStale = [premium('stale', 2024, 9_000), ...premiums]
    const stale = ok(attributeSpousalPayment(request({ premiums: withStale, paymentYear: 2027, payment: 8_000 })))
    expect(stale.inWindowUnattributed).toBe(5_000)
    expect(stale.attributedToContributor).toBe(5_000)
    expect(stale.taxedToAnnuitant).toBe(3_000)
  })
})

describe('BE-12 B first in, first out and no re-use', () => {
  it('reproduces the IT-307R4 paragraph 14 vector across two withdrawal years', () => {
    // Year 1: 1,000; Year 3: 3,000. A Year 3 withdrawal of 1,500 attributes
    // 1,500 (1,000 from Year 1 then 500 of Year 3). A Year 5 withdrawal of
    // 4,500 can only reach the 2,500 of the Year 3 premium not yet included.
    const first = ok(attributeSpousalPayment(request({
      premiums: [premium('y1', 2019, 1_000), premium('y3', 2021, 3_000)],
      paymentYear: 2021, payment: 1_500,
    })))
    expect(first.attributedToContributor).toBe(1_500)
    expect(first.lines.map(line => [line.id, line.attributedNow])).toEqual([['y1', 1_000], ['y3', 500]])
    const second = ok(attributeSpousalPayment(request({
      premiums: first.premiumsAfter, paymentYear: 2023, payment: 4_500,
    })))
    expect(second.attributedToContributor).toBe(2_500)
    expect(second.taxedToAnnuitant).toBe(2_000)
  })

  it('never re-attributes a premium already included in the contributor income', () => {
    const premiums = [premium('p', 2026, 4_000, { attributed: 4_000 })]
    const result = ok(attributeSpousalPayment(request({ premiums, payment: 4_000 })))
    expect(result.inWindowUnattributed).toBe(0)
    expect(result.attributedToContributor).toBe(0)
    expect(result.taxedToAnnuitant).toBe(4_000)
  })

  it('is order-independent and deterministic', () => {
    const premiums = [premium('c', 2026, 1_000), premium('a', 2024, 2_000), premium('b', 2025, 3_000)]
    const forward = ok(attributeSpousalPayment(request({ premiums, payment: 4_000 })))
    const reversed = ok(attributeSpousalPayment(request({ premiums: [...premiums].reverse(), payment: 4_000 })))
    expect(reversed).toEqual(forward)
    expect(forward.lines.map(line => line.id)).toEqual(['a', 'b', 'c'])
    expect(ok(attributeSpousalPayment(request({ premiums, payment: 4_000 })))).toEqual(forward)
  })

  it('conserves the payment with no negative part', () => {
    const cases = [0, 1, 999.99, 5_000, 12_345.67]
    for (const payment of cases) {
      const result = ok(attributeSpousalPayment(request({ premiums: [premium('p', 2026, 6_000)], payment, paymentYear: 2026 })))
      expect(result.attributedToContributor).toBeGreaterThanOrEqual(0)
      expect(result.taxedToAnnuitant).toBeGreaterThanOrEqual(0)
      expect(Math.abs(result.attributedToContributor + result.taxedToAnnuitant - payment)).toBeLessThanOrEqual(RRSP_MONEY_TOLERANCE)
    }
  })
})

describe('BE-12 B RRIF minimum exception', () => {
  const people = [{ id: 'self', ageInBaseYear: 80 }]
  const rrif = {
    id: 'rrif', kind: 'rrif' as const, ownerId: 'self', balance: 100_000,
    openedYear: { status: 'known' as const, value: 2020 },
  }

  it('reuses minimumForRrif and the prescribed factor for age 80 (0.0658 of 100,000 = 6,580)', () => {
    // CRA prescribed factor for a RRIF annuitant at January 1 age 79, i.e. the
    // year they reach 80, is 0.0658. The engine's `minimumForRrif` computes the
    // January-1 age itself, so this fixture reaches 80 during 2026.
    const minimum = knownRrifMinimum(rrif as never, people as never, 2026, 2026, 100_000)
    expect(minimum).toEqual(known(6_580))
    expect(knownRrifMinimum({ ...rrif, kind: 'rrsp' } as never, people as never, 2026, 2026)).toBeNull()
  })

  it('taxes the minimum to the annuitant and attributes only the excess', () => {
    const premiums = [premium('p2025', 2025, 50_000)]
    const atMinimum = ok(attributeSpousalPayment(request({
      premiums, paymentYear: 2026, payment: 6_580, rrifMinimum: known(6_580),
    })))
    expect(atMinimum.minimumApplied).toBe(6_580)
    expect(atMinimum.attributedToContributor).toBe(0)
    expect(atMinimum.taxedToAnnuitant).toBe(6_580)
    const above = ok(attributeSpousalPayment(request({
      premiums, paymentYear: 2026, payment: 10_000, rrifMinimum: known(6_580),
    })))
    expect(above.minimumApplied).toBe(6_580)
    expect(above.attributedToContributor).toBe(3_420)
    expect(above.taxedToAnnuitant).toBe(6_580)
    // The eligible premium is smaller than the excess: the premium caps it.
    const capped = ok(attributeSpousalPayment(request({
      premiums: [premium('small', 2026, 1_000)], paymentYear: 2026, payment: 10_000, rrifMinimum: known(6_580),
    })))
    expect(capped.attributedToContributor).toBe(1_000)
    expect(capped.taxedToAnnuitant).toBe(9_000)
  })

  it('consumes the year minimum once across payments instead of once per payment', () => {
    // s.146.3(5.1)(c) compares the year's cumulative inclusion with the year's
    // minimum. A 4,000 payment is below the 6,580 minimum and attributes
    // nothing; the next 8,000 payment only has to finish the remaining 2,580,
    // so 12,000 of payments in total attribute 12,000 - 6,580 = 5,420.
    const premiums = [premium('p2025', 2025, 50_000)]
    const first = ok(attributeSpousalPayment(request({
      premiums, paymentYear: 2026, payment: 4_000, rrifMinimum: known(6_580), annuitantIncomeBefore: 0,
    })))
    expect(first.attributedToContributor).toBe(0)
    const second = ok(attributeSpousalPayment(request({
      premiums: first.premiumsAfter, paymentYear: 2026, payment: 8_000, rrifMinimum: known(6_580), annuitantIncomeBefore: 4_000,
    })))
    expect(second.minimumApplied).toBe(2_580)
    expect(second.attributedToContributor).toBe(5_420)
    expect(second.taxedToAnnuitant).toBe(2_580)
    expect(first.attributedToContributor + second.attributedToContributor).toBe(5_420)
  })
})

describe('BE-12 B deduction year versus contribution year', () => {
  it('attributes by the actual contribution calendar year, never by the deduction election', () => {
    // First-60-days (s.146(5.1)): a premium paid in the first 60 days of 2026
    // can be deducted for 2025. Attribution still uses 2026, so a 2028 payment
    // is inside the window while a deduction-year reading would wrongly place
    // 2025 at three years' distance.
    const lines = spousalPremiumLines([{
      id: 'first60', accountId: 'spousal', contributorId: 'partner',
      calendarYear: 2026, deductionYear: 2025, amount: 4_000,
      provenance: { origin: 'user', sourceYear: 2026 },
    }], 'spousal')
    expect(lines).toEqual([{ id: 'first60', calendarYear: 2026, deductionYear: 2025, contributorId: 'partner', amount: 4_000, attributed: 0 }])
    const inside = ok(attributeSpousalPayment(request({ premiums: lines, paymentYear: 2028, payment: 4_000 })))
    expect(inside.attributedToContributor).toBe(4_000)
    const outside = ok(attributeSpousalPayment(request({ premiums: lines, paymentYear: 2029, payment: 4_000 })))
    expect(outside.attributedToContributor).toBe(0)
  })
})

describe('BE-12 B unknown is never zero', () => {
  it('refuses a missing contribution history with a concrete reason', () => {
    const result = attributeSpousalPayment(request({ premiums: null }))
    expect(result).toEqual({ status: 'unsupported', reason: SPOUSAL_HISTORY_UNKNOWN_REASON })
    expect(SPOUSAL_HISTORY_UNKNOWN_REASON).toMatch(/not recorded/i)
  })

  it('treats a known empty history as a real zero, not as unknown', () => {
    const empty = ok(attributeSpousalPayment(request({ premiums: [] })))
    expect(empty.attributedToContributor).toBe(0)
    expect(empty.taxedToAnnuitant).toBe(10_000)
    const unknown = attributeSpousalPayment(request({ premiums: null }))
    expect(unknown.status).toBe('unsupported')
    expect(empty.attributedToContributor).not.toBe((unknown as { reason: string }).reason)
  })

  it('refuses an unrecorded contributor, an unrecorded plan holder and an unrecorded premium payer', () => {
    expect(attributeSpousalPayment(request({ contributorId: null })).status).toBe('unsupported')
    expect(attributeSpousalPayment(request({ annuitantId: null })).status).toBe('unsupported')
    const unrecorded = attributeSpousalPayment(request({ premiums: [premium('x', 2026, 1_000, { contributorId: null })] }))
    expect(unrecorded.status).toBe('unsupported')
    if (unrecorded.status !== 'unsupported') throw new Error('expected unsupported')
    expect(unrecorded.reason).toContain('x')
    expect(attributeSpousalPayment(request({ rrifMinimum: { status: 'unknown', reason: 'factor category unconfirmed' } })).status).toBe('unsupported')
  })

  it('attributes nothing when the contributor is the annuitant, because that is not a spousal premium', () => {
    const result = ok(attributeSpousalPayment(request({
      contributorId: 'self', annuitantId: 'self', premiums: [premium('own', 2026, 3_000, { contributorId: 'self' })], payment: 3_000,
    })))
    expect(result.attributedToContributor).toBe(0)
    expect(result.taxedToAnnuitant).toBe(3_000)
  })

  it('types malformed amounts and years as invalid rather than guessing', () => {
    expect(attributeSpousalPayment(request({ payment: -1 })).status).toBe('invalid')
    expect(attributeSpousalPayment(request({ payment: Number.NaN })).status).toBe('invalid')
    expect(attributeSpousalPayment(request({ paymentYear: 2026.5 })).status).toBe('invalid')
    expect(attributeSpousalPayment(request({ annuitantIncomeBefore: -1 })).status).toBe('invalid')
    expect(attributeSpousalPayment(request({ premiums: [premium('x', 2026, 1_000, { attributed: 2_000 })] })).status).toBe('invalid')
    expect(attributeSpousalPayment(request({ rrifMinimum: known(-1) })).status).toBe('invalid')
  })
})

/** A couple plan whose single RRSP account is a spousal plan owned by `self`. */
function spousalPlan(mutate: (plan: InputsV2, selfId: string, partnerId: string, accountId: string) => void = () => {}): InputsV2 {
  const inputs: Inputs = {
    currentAge: 60, fireAge: 65, lifeExpectancy: 90, province: 'ON', annualSavings: 0,
    savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 }, retirementSpending: 0,
    returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, balances: { tfsa: 0, rrsp: 100000, nonReg: 0 }, nonRegBook: 0,
    cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0, strategy: 'tfsaFirst',
    partner: { currentAge: 58, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
  }
  const plan = migratePersistedPlan({ inputs }, 10, 2026)
  plan.migration = { sourcePersistVersion: 11, ownershipNeedsConfirmation: false, ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
  const self = plan.people.find(person => person.role === 'self')!
  const partner = plan.people.find(person => person.role === 'partner')!
  for (const account of plan.accounts) {
    account.ownerId = self.id
    account.taxableOwnerShares = { status: 'known', shares: { [self.id]: 1 } }
  }
  const account = plan.accounts.find(item => item.kind === 'rrsp')!
  account.kind = 'spousalRrsp'
  mutate(plan, self.id, partner.id, account.id)
  return plan
}

describe('BE-12 B personIncome wiring', () => {
  it('routes an attributed spousal payment to the contributor and the rest to the annuitant', () => {
    const plan = spousalPlan((draft, _selfId, partnerId, accountId) => {
      draft.spousalHistory = { [accountId]: { status: 'complete' } }
      draft.contributions = [{ id: 'p2024', accountId, contributorId: partnerId, calendarYear: 2024, amount: 4_000, deductionYear: null,
        provenance: { origin: 'user', sourceYear: 2024 } }]
    })
    const account = plan.accounts.find(item => item.kind === 'spousalRrsp')!
    const self = plan.people.find(person => person.role === 'self')!
    const partner = plan.people.find(person => person.role === 'partner')!
    const result = calculatePersonIncome(plan, 2026, [{ id: 'draw', kind: 'rrspWithdrawal', accountId: account.id, amount: 10_000 }])
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.byPerson[partner.id].gross).toBe(4_000)
    expect(result.byPerson[self.id].gross).toBe(6_000)
    expect(result.byPerson[partner.id].gross + result.byPerson[self.id].gross).toBe(10_000)
  })

  it('does not re-attribute the same premium to a second payment in the same year', () => {
    const plan = spousalPlan((draft, _selfId, partnerId, accountId) => {
      draft.spousalHistory = { [accountId]: { status: 'complete' } }
      draft.contributions = [{ id: 'p2026', accountId, contributorId: partnerId, calendarYear: 2026, amount: 4_000, deductionYear: null,
        provenance: { origin: 'user', sourceYear: 2026 } }]
    })
    const account = plan.accounts.find(item => item.kind === 'spousalRrsp')!
    const self = plan.people.find(person => person.role === 'self')!
    const partner = plan.people.find(person => person.role === 'partner')!
    const result = calculatePersonIncome(plan, 2026, [
      { id: 'draw1', kind: 'rrspWithdrawal', accountId: account.id, amount: 3_000 },
      { id: 'draw2', kind: 'rrspWithdrawal', accountId: account.id, amount: 3_000 },
    ])
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    // The split is carried as income shares, so each person's gross is exact to
    // the engine's cent tolerance rather than to the last float bit.
    expect(result.byPerson[partner.id].gross).toBeCloseTo(4_000, 6)
    expect(result.byPerson[self.id].gross).toBeCloseTo(2_000, 6)
    expect(result.byPerson[partner.id].gross + result.byPerson[self.id].gross).toBeCloseTo(6_000, 6)
  })

  it('keeps an unrecorded history unsupported instead of assuming the annuitant', () => {
    const plan = spousalPlan()
    const account = plan.accounts.find(item => item.kind === 'spousalRrsp')!
    const result = calculatePersonIncome(plan, 2026, [{ id: 'draw', kind: 'rrspWithdrawal', accountId: account.id, amount: 5_000 }])
    expect(result.status).toBe('unsupported')
    if (result.status !== 'unsupported') throw new Error('expected unsupported')
    expect(result.reason).toContain('contribution history is not recorded')
  })

  it('accepts a confirmed empty history as a real zero attribution', () => {
    const plan = spousalPlan((draft, _selfId, _partnerId, accountId) => {
      draft.spousalHistory = { [accountId]: { status: 'complete' } }
    })
    const account = plan.accounts.find(item => item.kind === 'spousalRrsp')!
    const self = plan.people.find(person => person.role === 'self')!
    const partner = plan.people.find(person => person.role === 'partner')!
    const result = calculatePersonIncome(plan, 2026, [{ id: 'draw', kind: 'rrspWithdrawal', accountId: account.id, amount: 5_000 }])
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.byPerson[partner.id].gross).toBe(0)
    expect(result.byPerson[self.id].gross).toBe(5_000)
  })

  it('leaves an ordinary RRSP and a single-person spousal plan on the owner path', () => {
    const ordinary = spousalPlan((draft, _selfId, _partnerId, accountId) => {
      draft.accounts.find(item => item.id === accountId)!.kind = 'rrsp'
    })
    const account = ordinary.accounts.find(item => item.kind === 'rrsp')!
    const self = ordinary.people.find(person => person.role === 'self')!
    const result = calculatePersonIncome(ordinary, 2026, [{ id: 'draw', kind: 'rrspWithdrawal', accountId: account.id, amount: 5_000 }])
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.byPerson[self.id].gross).toBe(5_000)
  })
})
