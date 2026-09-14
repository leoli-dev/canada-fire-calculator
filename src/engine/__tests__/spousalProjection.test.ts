import { describe, expect, it } from 'vitest'
import type { Inputs } from '../types'
import type { InputsV2 } from '../model'
import { migratePersistedPlan } from '../migration'
import { runProjection } from '../projection'
import { minimumForRrif } from '../rrif'

/**
 * Review fix B1, pinned through the public `runProjection` rather than the
 * module: one year must contain exactly ONE required minimum. The mandatory
 * withdrawal is computed from the year's opening registered balance, so the
 * spousal s.146.3(5.1) attribution must use that same balance. Before the fix
 * the attribution fell back to the frozen canonical `account.balance`, so in
 * every projected year whose opening balance had moved, part of the annuitant's
 * mandatory minimum was silently attributed to the contributor.
 */

const BASE_YEAR = 2026

/** The reviewer's B1 scenario: two-person ON, one RRIF, annuitant reaches 74. */
function reviewerInputs(): Inputs {
  return {
    currentAge: 74, fireAge: 65, lifeExpectancy: 90, province: 'ON', annualSavings: 0,
    savingsSplit: { tfsa: 0, rrsp: 1, nonReg: 0 }, retirementSpending: 30_000,
    // 5% is what makes the reviewer's 2026 closing balance 72,984.12.
    returns: { tfsa: 0, rrsp: 0.05, nonReg: 0 },
    balances: { tfsa: 0, rrsp: 100_000, nonReg: 0 }, nonRegBook: 0,
    cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0, strategy: 'tfsaFirst',
    partner: { currentAge: 72, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
  }
}

/** The household RRIF becomes a spousal plan with a complete 2025 premium. */
function reviewerPlan(inputs: Inputs): { plan: InputsV2; selfId: string; partnerId: string; accountId: string } {
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
    amount: 40_000, deductionYear: null, provenance: { origin: 'user', sourceYear: 2025 } }]
  return { plan, selfId: self.id, partnerId: partner.id, accountId: account.id }
}

const cents = (value: number) => Math.round(value * 100) / 100

describe('BE-12 B spousal RRIF minimum through runProjection (review fix B1)', () => {
  it("taxes the annuitant on the year's minimum from that year's opening balance, not the frozen balance", () => {
    const inputs = reviewerInputs()
    const { plan, selfId, partnerId, accountId } = reviewerPlan(inputs)
    const account = plan.accounts.find(item => item.id === accountId)!
    const result = runProjection(inputs, undefined, plan)
    const year2026 = result.rows[0]
    const year2027 = result.rows[1]
    expect(result.taxCapability?.status).toBe('person')
    expect(year2026.taxCapability).toBe('person')
    expect(year2027.taxCapability).toBe('person')

    // The reviewer's before-fix row, reproduced so the vector is the same one:
    // 2027's opening balance is 2026's closing balance. (Before the fix 2027's
    // gross draw was 30,473.92; correcting the split also corrects the tax the
    // withdrawal solver grosses up, so the draw itself moves too.)
    expect(cents(year2026.withdrawals.rrsp)).toBe(30_491.31)
    const opening2027 = year2026.balances.rrsp
    expect(cents(opening2027)).toBe(72_984.12)

    // One definition of the year's minimum: `minimumForRrif` on the opening
    // balance the mandatory withdrawal itself was computed from.
    const minimum = minimumForRrif(account, plan.people, BASE_YEAR, BASE_YEAR + 1, opening2027)
    expect(minimum.status).toBe('ok')
    if (minimum.status !== 'ok') throw new Error('expected an RRIF minimum')
    expect(cents(minimum.amount)).toBe(4_138.2)

    const annuitant2027 = year2027.byPersonTax![selfId].grossIncome
    const contributor2027 = year2027.byPersonTax![partnerId].grossIncome
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
    const { plan, selfId, partnerId } = reviewerPlan(inputs)
    const result = runProjection(inputs, undefined, plan)
    // 2026 reaches 74, so the January-1 age is 73 and the factor is 0.0553:
    // 100,000 * 0.0553 = 5,530 taxed to the annuitant, the rest attributed.
    expect(cents(result.rows[0].byPersonTax![selfId].grossIncome)).toBe(5_530)
    expect(cents(result.rows[0].byPersonTax![partnerId].grossIncome)).toBe(24_961.31)
  })

  it('keeps the annuitant at the year minimum in every later year, never the frozen balance', () => {
    const inputs = reviewerInputs()
    const { plan, selfId } = reviewerPlan(inputs)
    const account = plan.accounts.find(item => item.kind === 'rrif')!
    const result = runProjection(inputs, undefined, plan)
    // 2026 and 2027 both have the 2025 premium inside the attribution window and
    // a payment above the minimum; each annuitant share must equal
    // `minimumForRrif` on that row's own opening balance (the previous row's
    // closing balance), not on the frozen canonical balance.
    for (const index of [0, 1]) {
      const opening = index === 0 ? account.balance : result.rows[index - 1].balances.rrsp
      const minimum = minimumForRrif(account, plan.people, BASE_YEAR, BASE_YEAR + index, opening)
      const annuitant = result.rows[index].byPersonTax![selfId].grossIncome
      const frozen = minimumForRrif(account, plan.people, BASE_YEAR, BASE_YEAR + index, account.balance)
      expect(minimum.status, String(index)).toBe('ok')
      expect(frozen.status, String(index)).toBe('ok')
      if (minimum.status !== 'ok' || frozen.status !== 'ok') continue
      expect(cents(annuitant), `year ${BASE_YEAR + index}`).toBe(cents(minimum.amount))
      if (Math.abs(minimum.amount - frozen.amount) > 0.01)
        expect(cents(annuitant), `year ${BASE_YEAR + index}`).not.toBe(cents(frozen.amount))
    }
  })
})
