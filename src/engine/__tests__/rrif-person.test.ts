import { describe, expect, it } from 'vitest'
import type { Inputs } from '../types'
import { migratePersistedPlan } from '../migration'
import { minimumForRrif, prescribedRrifFactor } from '../rrif'
import { runProjection } from '../projection'

const legacy: Inputs = {
  currentAge: 72, fireAge: 80, lifeExpectancy: 90, province: 'ON', annualSavings: 0,
  savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 }, retirementSpending: 0,
  returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
  cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0, strategy: 'tfsaFirst',
  partner: { currentAge: 62, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
}

describe('person-owned existing RRIF minimums', () => {
  it('uses each account election and opening year while the annuitant still works', () => {
    const plan = migratePersistedPlan({ inputs: legacy }, 10, 2026)
    const self = plan.people.find(person => person.role === 'self')!
    const partner = plan.people.find(person => person.role === 'partner')!
    const rrif = plan.accounts.find(account => account.kind === 'rrsp')!
    rrif.kind = 'rrif'
    rrif.ownerId = self.id
    rrif.balance = 1_000_000
    rrif.openedYear = { status: 'known', value: 2020 }
    rrif.rrifAgeElection = { personId: partner.id, electedAtOpening: true }
    const younger = minimumForRrif(rrif, plan.people, plan.baseYear, 2026)
    expect(younger).toMatchObject({ status: 'ok', agePersonId: partner.id, amount: 1_000_000 / 29 })
    const own = minimumForRrif({ ...rrif, rrifAgeElection: null }, plan.people, plan.baseYear, 2026)
    expect(own).toMatchObject({ status: 'ok', agePersonId: self.id, amount: 52_800 })
    const newlyOpened = minimumForRrif({ ...rrif, openedYear: { status: 'known', value: 2026 } }, plan.people, plan.baseYear, 2026)
    expect(newlyOpened).toMatchObject({ status: 'ok', amount: 0 })
    expect(minimumForRrif({ ...rrif, openedYear: { status: 'unknown', reason: 'statement missing' } }, plan.people, plan.baseYear, 2026).status).toBe('unsupported')
  })

  it('uses the CRA January-1 table and under-71 formula independently of retirement age', () => {
    expect(prescribedRrifFactor(61)).toBeCloseTo(1 / 29, 12)
    expect(prescribedRrifFactor(71)).toBe(0.0528)
    expect(prescribedRrifFactor(72)).toBe(0.054)
    expect(prescribedRrifFactor(95)).toBe(0.2)
  })

  it('gates pre-1987 RRIFs without an amendment/qualification fact before forcing cash', () => {
    const inputs: Inputs = { ...legacy, currentAge: 80, fireAge: 80, lifeExpectancy: 80,
      balances: { tfsa: 0, rrsp: 1_000_000, nonReg: 0 }, partner: undefined,
      strategy: 'rrspFirst' }
    const plan = migratePersistedPlan({ inputs }, 10, 2026)
    plan.migration = { sourcePersistVersion: 11, ownershipNeedsConfirmation: false,
      ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
    plan.accounts.forEach(account => { account.ownerId = plan.people[0].id;
      account.taxableOwnerShares = { status: 'known', shares: { [plan.people[0].id]: 1 } } })
    const rrif = plan.accounts.find(account => account.kind === 'rrsp')!
    rrif.kind = 'rrif'
    rrif.openedYear = { status: 'known', value: 1985 }
    expect(minimumForRrif(rrif, plan.people, plan.baseYear, 2026).status).toBe('unsupported')
    expect(minimumForRrif({ ...rrif, openedYear: { status: 'known', value: 1986 } },
      plan.people, plan.baseYear, 2026).status).toBe('unsupported')
    expect(minimumForRrif({ ...rrif, openedYear: { status: 'known', value: 1987 } },
      plan.people, plan.baseYear, 2026)).toMatchObject({ status: 'ok', amount: 65_800 })
    const result = runProjection(inputs, undefined, plan)
    expect(result.taxCapability?.status).toBe('legacyEstimate')
    expect(result.rows[0].taxCapability).toBe('legacyEstimate')
    expect(result.rows[0].withdrawals.rrsp).toBe(0)
    expect(result.rows[0].byPersonTax).toBeUndefined()
  })
})
