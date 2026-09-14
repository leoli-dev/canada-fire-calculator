import { describe, expect, it } from 'vitest'
import type { Inputs } from '../types'
import type { InputsV2 } from '../model'
import { migratePersistedPlan } from '../migration'
import { runProjection } from '../projection'
import { minimumForRrif } from '../rrif'

/**
 * Review fixes B1 and B2, pinned through the public `runProjection` rather than
 * the module.
 *
 * B1 — one year must contain exactly ONE required minimum. The mandatory
 * withdrawal is computed from the year's opening registered balance, so the
 * spousal s.146.3(5.1) attribution must use that same balance. Before the fix
 * the attribution fell back to the frozen canonical `account.balance`, so in
 * every projected year whose opening balance had moved, part of the annuitant's
 * mandatory minimum was silently attributed to the contributor.
 *
 * B2 — an attributed premium must not be reused in a later projected year.
 * ITA s.146(8.6)(a) deems a premium (or part) already included in the
 * contributor's income not to have been paid to the spousal plan, so cumulative
 * attribution over the life of the plan can never exceed the premiums actually
 * paid. Before the fix the attributed state was rebuilt from `plan.contributions`
 * inside every yearly `calculatePersonIncome` call, so a premium was attributed
 * again in each later year of its window.
 */

const BASE_YEAR = 2026

/** The round-2 reviewer scenario: two-person ON, one RRIF, annuitant reaches 74. */
function reviewerInputs(): Inputs {
  return {
    currentAge: 74, fireAge: 65, lifeExpectancy: 90, province: 'ON', annualSavings: 0,
    savingsSplit: { tfsa: 0, rrsp: 1, nonReg: 0 }, retirementSpending: 30_000,
    // 5% is what makes the 2026 closing balance 72,984.12.
    returns: { tfsa: 0, rrsp: 0.05, nonReg: 0 },
    balances: { tfsa: 0, rrsp: 100_000, nonReg: 0 }, nonRegBook: 0,
    cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0, strategy: 'tfsaFirst',
    partner: { currentAge: 72, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
  }
}

/**
 * The household RRIF becomes a spousal plan with a complete 2025 premium of
 * `premium`. The default 40,000 is the round-2 vector; the B1 tests use a
 * premium large enough that the year's minimum, not the remaining premium,
 * bounds the attribution, so the minimum-basis fix stays observable now that
 * B2 caps the cumulative total.
 */
function reviewerPlan(inputs: Inputs, premium = 40_000): { plan: InputsV2; selfId: string; partnerId: string; accountId: string } {
  const plan = migratePersistedPlan({ inputs }, 10, BASE_YEAR)
  plan.migration = { sourcePersistVersion: 11, ownershipNeedsConfirmation: false,
    ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
  const self = plan.people.find(person => person.role === 'self')!
  const partner = plan.people.find(person => person.role === 'partner')!
  for (const account of plan.accounts) {
    account.ownerId = self.id
    account.taxableOwnerShares = { status: 'known', shares: { [self.id]: 1 } }
  }
  const account = plan.accounts.find(item => item.kind === 'rrsp')!
  account.kind = 'rrif'
  account.openedYear = { status: 'known', value: 2020 }
  account.rrifFactorCategory = { status: 'known', value: 'allOther' }
  plan.spousalHistory = { [account.id]: { status: 'complete' } }
  // `known: false` is what reproduces the reviewer's 30,491.31 gross draw; it
  // only fixes the tax credits and does not touch the attribution.
  plan.taxProfile = { spouseSupported: { status: 'known', value: false }, pensionSplit: null }
  plan.contributions = [{ id: 'p2025', accountId: account.id, contributorId: partner.id, calendarYear: 2025,
    amount: premium, deductionYear: null, provenance: { origin: 'user', sourceYear: 2025 } }]
  return { plan, selfId: self.id, partnerId: partner.id, accountId: account.id }
}

/** The round-3 reviewer scenario: two-person ON, age 55, one spousal RRSP. */
function crossYearInputs(): Inputs {
  return {
    currentAge: 55, fireAge: 55, lifeExpectancy: 70, province: 'ON', annualSavings: 0,
    savingsSplit: { tfsa: 0, rrsp: 1, nonReg: 0 }, retirementSpending: 60_000,
    returns: { tfsa: 0, rrsp: 0, nonReg: 0 },
    balances: { tfsa: 0, rrsp: 300_000, nonReg: 0 }, nonRegBook: 0,
    cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0, strategy: 'tfsaFirst',
    partner: { currentAge: 55, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
  }
}

/** One 10,000 premium paid in 2025 by the partner to a spousal plan owned by self. */
function crossYearPlan(inputs: Inputs): { plan: InputsV2; selfId: string; partnerId: string; accountId: string } {
  const plan = migratePersistedPlan({ inputs }, 10, BASE_YEAR)
  plan.migration = { sourcePersistVersion: 11, ownershipNeedsConfirmation: false,
    ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
  const self = plan.people.find(person => person.role === 'self')!
  const partner = plan.people.find(person => person.role === 'partner')!
  for (const account of plan.accounts) {
    account.ownerId = self.id
    account.taxableOwnerShares = { status: 'known', shares: { [self.id]: 1 } }
  }
  const account = plan.accounts.find(item => item.kind === 'rrsp')!
  account.kind = 'spousalRrsp'
  account.openedYear = { status: 'known', value: 2020 }
  plan.spousalHistory = { [account.id]: { status: 'complete' } }
  plan.taxProfile = { spouseSupported: { status: 'known', value: false }, pensionSplit: null }
  plan.contributions = [{ id: 'p2025', accountId: account.id, contributorId: partner.id, calendarYear: 2025,
    amount: 10_000, deductionYear: null, provenance: { origin: 'user', sourceYear: 2025 } }]
  return { plan, selfId: self.id, partnerId: partner.id, accountId: account.id }
}

const cents = (value: number) => Math.round(value * 100) / 100

/** One person's taxable registered withdrawal in a row: their exact split share. */
const registeredShare = (row: { byPersonTax?: Record<string, { bySource: Partial<Record<string, number>> }> }, personId: string) => {
  const bySource = row.byPersonTax?.[personId]?.bySource
  return cents((bySource?.rrspWithdrawal ?? 0) + (bySource?.rrifWithdrawal ?? 0))
}

describe('BE-12 B spousal RRIF minimum through runProjection (review fix B1)', () => {
  it("taxes the annuitant on the year's minimum from that year's opening balance, not the frozen balance", () => {
    const inputs = reviewerInputs()
    // A premium large enough that the minimum, not the remaining premium, bounds
    // 2027's attribution — otherwise the B2 ledger cap would mask the basis.
    const { plan, selfId, partnerId, accountId } = reviewerPlan(inputs, 100_000)
    const account = plan.accounts.find(item => item.id === accountId)!
    const result = runProjection(inputs, undefined, plan)
    const year2026 = result.rows[0]
    const year2027 = result.rows[1]
    expect(result.taxCapability?.status).toBe('person')
    expect(year2026.taxCapability).toBe('person')
    expect(year2027.taxCapability).toBe('person')

    // The reviewer's row, reproduced so the vector is the same one: 2027's
    // opening balance is 2026's closing balance.
    expect(cents(year2026.withdrawals.rrsp)).toBe(30_491.31)
    const opening2027 = year2026.balances.rrsp
    expect(cents(opening2027)).toBe(72_984.12)

    // One definition of the year's minimum: `minimumForRrif` on the opening
    // balance the mandatory withdrawal itself was computed from.
    const minimum = minimumForRrif(account, plan.people, BASE_YEAR, BASE_YEAR + 1, opening2027)
    expect(minimum.status).toBe('ok')
    if (minimum.status !== 'ok') throw new Error('expected an RRIF minimum')
    expect(cents(minimum.amount)).toBe(4_138.2)

    const annuitant2027 = registeredShare(year2027, selfId)
    const contributor2027 = registeredShare(year2027, partnerId)
    // The annuitant keeps the statutory minimum; only the excess is attributed.
    expect(cents(annuitant2027)).toBe(4_138.2)
    expect(cents(contributor2027)).toBe(cents(year2027.withdrawals.rrsp - 4_138.2))
    // The pre-fix bug: the frozen 100,000 balance gave a 5,670 minimum, so
    // 1,531.80 of the annuitant's mandatory minimum went to the contributor.
    expect(cents(annuitant2027)).not.toBe(5_670)
    expect(cents(annuitant2027) + cents(contributor2027)).toBeCloseTo(cents(year2027.withdrawals.rrsp), 6)
  })

  it('leaves the base year unchanged because there the opening balance is the canonical balance', () => {
    const inputs = reviewerInputs()
    const { plan, selfId, partnerId } = reviewerPlan(inputs, 100_000)
    const result = runProjection(inputs, undefined, plan)
    // 2026 reaches 74, so the January-1 age is 73 and the factor is 0.0553:
    // 100,000 * 0.0553 = 5,530 taxed to the annuitant, the rest attributed.
    expect(cents(registeredShare(result.rows[0], selfId))).toBe(5_530)
    expect(cents(registeredShare(result.rows[0], partnerId))).toBe(24_961.31)
  })

  it('keeps the annuitant at the year minimum in every later in-window year, never the frozen balance', () => {
    const inputs = reviewerInputs()
    const { plan, selfId, partnerId } = reviewerPlan(inputs, 100_000)
    const account = plan.accounts.find(item => item.kind === 'rrif')!
    const result = runProjection(inputs, undefined, plan)
    // 2026 and 2027 both have the 2025 premium inside the attribution window and
    // a payment above the minimum; each annuitant share must equal
    // `minimumForRrif` on that row's own opening balance (the previous row's
    // closing balance), not on the frozen canonical balance.
    for (const index of [0, 1]) {
      const opening = index === 0 ? account.balance : result.rows[index - 1].balances.rrsp
      const minimum = minimumForRrif(account, plan.people, BASE_YEAR, BASE_YEAR + index, opening)
      const annuitant = registeredShare(result.rows[index], selfId)
      const frozen = minimumForRrif(account, plan.people, BASE_YEAR, BASE_YEAR + index, account.balance)
      expect(minimum.status, String(index)).toBe('ok')
      expect(frozen.status, String(index)).toBe('ok')
      if (minimum.status !== 'ok' || frozen.status !== 'ok') continue
      expect(cents(annuitant), `year ${BASE_YEAR + index}`).toBe(cents(minimum.amount))
      if (Math.abs(minimum.amount - frozen.amount) > 0.01)
        expect(cents(annuitant), `year ${BASE_YEAR + index}`).not.toBe(cents(frozen.amount))
    }
    // 2028 is past the window (the premium was paid in 2025, so its window is
    // 2025-2027): the whole draw is the annuitant's.
    expect(cents(registeredShare(result.rows[2], partnerId))).toBe(0)
    expect(cents(registeredShare(result.rows[2], selfId))).toBe(cents(result.rows[2].withdrawals.rrsp))
  })
})

describe('BE-12 B an attributed premium is never reused in a later projected year (review fix B2)', () => {
  it("attributes the reviewer's single 10,000 premium once and only once across the projection", () => {
    const inputs = crossYearInputs()
    const { plan, selfId, partnerId } = crossYearPlan(inputs)
    const result = runProjection(inputs, undefined, plan)
    const [y2026, y2027, y2028] = result.rows
    expect(result.taxCapability?.status).toBe('person')

    // 2026: the only in-window year left for the 2025 premium, so the whole
    // 10,000 is attributed to the contributor.
    expect(cents(y2026.withdrawals.rrsp)).toBe(69_171.64)
    expect(cents(registeredShare(y2026, partnerId))).toBe(10_000)
    expect(cents(registeredShare(y2026, selfId))).toBe(59_171.64)

    // 2027 is still inside the window, but s.146(8.6)(a) deems the 10,000
    // already attributed not to have been a premium: the attribution is 0 and
    // the annuitant is taxed on the whole draw. Before the fix this row
    // attributed a second 10,000.
    expect(cents(registeredShare(y2027, partnerId))).toBe(0)
    expect(cents(registeredShare(y2027, selfId))).toBe(cents(y2027.withdrawals.rrsp))

    // 2028 is outside the window and unattributed either way.
    expect(cents(registeredShare(y2028, partnerId))).toBe(0)
    expect(cents(registeredShare(y2028, selfId))).toBe(cents(y2028.withdrawals.rrsp))

    const cumulative = result.rows.reduce((sum, row) => sum + registeredShare(row, partnerId), 0)
    // The defect: 10,000 in 2026 + 10,000 in 2027 = 20,000 for one premium.
    expect(cents(cumulative)).toBe(10_000)
    expect(cents(cumulative)).not.toBe(20_000)
  })

  it("caps the round-2 vector's cumulative attribution at the 40,000 premium", () => {
    const inputs = reviewerInputs()
    const { plan, selfId, partnerId } = reviewerPlan(inputs, 40_000)
    const result = runProjection(inputs, undefined, plan)

    // 2026 attributes 24,961.31, leaving 15,038.69 of the premium. 2027's
    // excess over the 4,138.20 minimum is 26,429.58, but only the 15,038.69
    // still unattributed can be attributed; the rest (11,390.89) stays with the
    // annuitant. 24,961.31 + 26,429.58 = 51,390.89 was the defect.
    expect(cents(registeredShare(result.rows[0], partnerId))).toBe(24_961.31)
    expect(cents(registeredShare(result.rows[1], partnerId))).toBe(15_038.69)
    expect(cents(registeredShare(result.rows[1], selfId))).toBe(cents(result.rows[1].withdrawals.rrsp - 15_038.69))
    // The 2027 minimum is still that year's own opening-balance minimum; it is
    // no longer the whole annuitant share only because the premium ran out.
    expect(cents(registeredShare(result.rows[1], partnerId))).not.toBe(26_429.58)

    const cumulative = result.rows.reduce((sum, row) => sum + registeredShare(row, partnerId), 0)
    expect(cents(cumulative)).toBe(40_000)
    expect(cents(cumulative)).not.toBe(51_390.89)
    expect(cumulative).toBeLessThanOrEqual(40_000 + 1e-8)
    // No later year resurrects the premium.
    for (const row of result.rows.slice(2)) expect(cents(registeredShare(row, partnerId))).toBe(0)
  })

  it('conserves every year: attributed + annuitant == payment, neither negative', () => {
    const inputs = reviewerInputs()
    const { plan, selfId, partnerId } = reviewerPlan(inputs, 40_000)
    const result = runProjection(inputs, undefined, plan)
    for (const row of result.rows) {
      const contributed = registeredShare(row, partnerId)
      const annuitant = registeredShare(row, selfId)
      expect(contributed, `contributor ${row.age}`).toBeGreaterThanOrEqual(0)
      expect(annuitant, `annuitant ${row.age}`).toBeGreaterThanOrEqual(0)
      expect(cents(contributed + annuitant), `draw ${row.age}`).toBeCloseTo(cents(row.withdrawals.rrsp), 6)
    }
  })

  it('is deterministic and idempotent: a second run of the same plan is identical', () => {
    const inputs = crossYearInputs()
    const { plan, partnerId } = crossYearPlan(inputs)
    // A deep copy proves the run does not write the ledger back into canonical
    // data either.
    const before = structuredClone(plan)
    const first = runProjection(inputs, undefined, plan)
    const second = runProjection(inputs, undefined, plan)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(plan).toEqual(before)
    expect(plan.contributions).toEqual(before.contributions)
    expect(plan.contributions.every(contribution => !('attributed' in contribution))).toBe(true)
    // Both runs still produce the one-time attribution, so idempotence is not
    // the trivial "nothing was attributed" case.
    expect(cents(registeredShare(first.rows[0], partnerId))).toBe(10_000)
    expect(cents(registeredShare(second.rows[0], partnerId))).toBe(10_000)
  })
})
