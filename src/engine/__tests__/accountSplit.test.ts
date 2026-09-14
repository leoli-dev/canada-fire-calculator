import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Inputs } from '../types'
import { derivedAccountId, migratePersistedPlan, recordAccountSplit, recordPropertySplit,
  refreshCanonicalFromLegacy, removePerson } from '../migration'
import { precisionGate } from '../model'
import { assertCanonicalPlan } from '../modelValidation'
import { personProjectionTax } from '../personProjectionTax'
import { runProjection } from '../projection'
import { useStore } from '../../store'

/** Couple at FIRE with a 500,000 RRSP household total, no pensions or benefits. */
const couple = (): Inputs => ({
  currentAge: 65, fireAge: 65, lifeExpectancy: 90, province: 'ON', annualSavings: 0,
  savingsSplit: { tfsa: 0, rrsp: 1, nonReg: 0 }, retirementSpending: 60000,
  returns: { tfsa: 0, rrsp: 0, nonReg: 0 },
  balances: { tfsa: 100000, rrsp: 500000, nonReg: 200000 }, nonRegBook: 100000,
  cppStartAge: 70, cppAnnualAt65: 0, oasStartAge: 70, oasAnnualAt65: 0,
  strategy: 'meltdownPaced',
  partner: { currentAge: 63, cppStartAge: 70, cppAnnualAt65: 0, oasStartAge: 70, oasAnnualAt65: 0 },
})

const locked = (): Inputs => ({ ...couple(),
  lockedRetirement: { balance: 400000, owner: 'self', employeeContribution: 5000,
    employerContribution: 5000, jurisdiction: 'ON', accessibleAge: 55 } })

const plan = () => migratePersistedPlan({ inputs: couple() }, 10, 2026)
const selfId = (p: ReturnType<typeof plan>) => p.people.find(person => person.role === 'self')!.id
const partnerId = (p: ReturnType<typeof plan>) => p.people.find(person => person.role === 'partner')!.id
const rrspRow = (p: ReturnType<typeof plan>) => p.accounts.filter(account =>
  account.id === 'legacy:account:rrsp' || account.id === derivedAccountId('legacy:account:rrsp'))

describe('FE-35 A per-person account balances (registered)', () => {
  it('splits two non-zero amounts into two person-owned accounts that conserve the household total exactly', () => {
    const before = plan()
    const beforeTotal = before.accounts.reduce((sum, account) => sum + account.balance, 0)
    // Hand calculation: 300,000 + 200,000 = 500,000, the household RRSP total.
    const next = recordAccountSplit(before, 'legacy:account:rrsp', 300000, 200000)
    const row = rrspRow(next)
    expect(row).toHaveLength(2)
    expect(row.map(account => account.id).sort()).toEqual(
      [derivedAccountId('legacy:account:rrsp'), 'legacy:account:rrsp'].sort())
    expect(row.reduce((sum, account) => sum + account.balance, 0)).toBe(500000)
    expect(row.find(account => account.balance === 300000)?.ownerId).toBe(selfId(next))
    expect(row.find(account => account.balance === 200000)?.ownerId).toBe(partnerId(next))
    for (const account of row) {
      expect(account.taxableOwnerShares.status).toBe('known')
      if (account.taxableOwnerShares.status === 'known') {
        expect(Object.keys(account.taxableOwnerShares.shares)).toEqual([account.ownerId!])
        expect(Object.values(account.taxableOwnerShares.shares)).toEqual([1])
      }
    }
    // The household total across the whole plan is unchanged.
    expect(next.accounts.reduce((sum, account) => sum + account.balance, 0)).toBe(beforeTotal)
    expect(() => assertCanonicalPlan(next)).not.toThrow()
    // Re-applying the identical split is idempotent: same ids, no duplicates.
    const again = recordAccountSplit(next, 'legacy:account:rrsp', 300000, 200000)
    expect(again.accounts.map(account => account.id).sort()).toEqual(next.accounts.map(account => account.id).sort())
    expect(again.accounts).toEqual(next.accounts)
  })

  it('keeps exactly one account for a 100/0 split, with the right owner and id', () => {
    const base = recordAccountSplit(plan(), 'legacy:account:rrsp', 500000, 0)
    const selfOnly = rrspRow(base)
    expect(selfOnly).toHaveLength(1)
    expect(selfOnly[0]).toMatchObject({ id: 'legacy:account:rrsp', balance: 500000, ownerId: selfId(base) })
    // A partner-only collapse keeps the base id too: the row's canonical id
    // stays stable and the panel keeps rendering the row's registered-type
    // control for the partner-owned account (regression: the collapse renamed
    // unpinned accounts to the derived id and hid the control).
    const partnerOnly = recordAccountSplit(plan(), 'legacy:account:rrsp', 0, 500000)
    const singlePartnerRow = rrspRow(partnerOnly)
    expect(singlePartnerRow).toHaveLength(1)
    expect(singlePartnerRow[0]).toMatchObject({ id: 'legacy:account:rrsp', balance: 500000, ownerId: partnerId(partnerOnly) })
    expect(partnerOnly.ownershipAmounts?.['legacy:account:rrsp']).toEqual(
      { [selfId(partnerOnly)]: 0, [partnerId(partnerOnly)]: 500000 })
    // A zero household total keeps one account carrying the selected owner.
    const empty = migratePersistedPlan({ inputs: { ...couple(), balances: { tfsa: 0, rrsp: 0, nonReg: 0 } } }, 10, 2026)
    const zero = recordAccountSplit(empty, 'legacy:account:rrsp', 0, 0, { zeroOwnerId: partnerId(empty) })
    expect(rrspRow(zero)).toMatchObject([{ id: 'legacy:account:rrsp', balance: 0, ownerId: partnerId(empty) }])
  })

  it('rejects a mismatch with no partial write', () => {
    const before = plan()
    const accountsBefore = structuredClone(before.accounts)
    // Base-failure discipline: the export itself must exist at this commit,
    // so this test cannot pass on the base revision because the call throws
    // a TypeError for the wrong reason.
    expect(recordAccountSplit).toBeTypeOf('function')
    expect(() => recordAccountSplit(before, 'legacy:account:rrsp', 300000, 100000))
      .toThrow('split amounts 300000 + 100000 do not match the household total 500000')
    expect(before.accounts).toEqual(accountsBefore)
    expect(before.ownershipAmounts).toBeUndefined()
    expect(() => assertCanonicalPlan(before)).not.toThrow()
  })

  it('turns non-registered amounts into proportional shares that sum to 1 and leave the balance unchanged', () => {
    // Hand calculation: 150,000 / 200,000 = 0.75, 50,000 / 200,000 = 0.25.
    const next = recordAccountSplit(plan(), 'legacy:account:nonReg', 150000, 50000)
    const nonReg = next.accounts.find(account => account.kind === 'nonReg')!
    expect(nonReg.balance).toBe(200000)
    expect(nonReg.taxableOwnerShares).toMatchObject({ status: 'known' })
    const shares = (nonReg.taxableOwnerShares as { shares: Record<string, number> }).shares
    expect(shares[selfId(next)]).toBeCloseTo(0.75, 12)
    expect(shares[partnerId(next)]).toBeCloseTo(0.25, 12)
    expect(Object.values(shares).reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12)
    expect(nonReg.ownerId).toBeNull()
    expect(next.accounts).toHaveLength(plan().accounts.length)
    // 100/0 assigns the single owner.
    const selfOnly = recordAccountSplit(plan(), 'legacy:account:nonReg', 200000, 0)
    expect(selfOnly.accounts.find(account => account.kind === 'nonReg')).toMatchObject({
      ownerId: selfId(selfOnly), taxableOwnerShares: { status: 'known', shares: { [selfId(selfOnly)]: 1 } } })
  })

  it('turns investment-property amounts into proportional shares that sum to 1', () => {
    const input = couple()
    input.investmentProperties = [{ value: 400000, acb: 200000, appreciation: 0, sellAtAge: null, annualRent: 10000 }]
    const base = migratePersistedPlan({ inputs: input }, 10, 2026)
    // Hand calculation: 250,000 / 400,000 = 0.625, 150,000 / 400,000 = 0.375.
    const next = recordPropertySplit(base, 'legacy:property:investment:0', 250000, 150000)
    const property = next.properties.find(item => item.kind === 'investment')!
    expect(property.value).toBe(400000)
    const shares = (property.taxableOwnerShares as { shares: Record<string, number> }).shares
    expect(shares[selfId(next)]).toBeCloseTo(0.625, 12)
    expect(shares[partnerId(next)]).toBeCloseTo(0.375, 12)
    expect(Object.values(shares).reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12)
    expect(() => assertCanonicalPlan(next)).not.toThrow()
    const before = structuredClone(base.properties)
    expect(() => recordPropertySplit(base, 'legacy:property:investment:0', 250000, 100000)).toThrow()
    expect(base.properties).toEqual(before)
  })

  it('preserves the split across an unrelated legacy edit and restores it when the total again matches', () => {
    const split = recordAccountSplit(plan(), 'legacy:account:rrsp', 300000, 200000)
    const unrelated = refreshCanonicalFromLegacy(split, { ...split.legacyProjection, fees: 0.35 })
    expect(rrspRow(unrelated).map(account => [account.ownerId, account.balance]).sort())
      .toEqual([[selfId(unrelated), 300000], [partnerId(unrelated), 200000]].sort())
    expect(unrelated.ownershipAmounts?.['legacy:account:rrsp']).toEqual(
      { [selfId(unrelated)]: 300000, [partnerId(unrelated)]: 200000 })
    // Household-total change upward: total conserved, ownership suspended, recorded amounts kept.
    const raised = refreshCanonicalFromLegacy(unrelated, { ...unrelated.legacyProjection, balances: { ...unrelated.legacyProjection.balances, rrsp: 600000 } })
    const suspended = rrspRow(raised)
    expect(suspended).toHaveLength(1)
    expect(suspended[0]).toMatchObject({ id: 'legacy:account:rrsp', balance: 600000, ownerId: null })
    expect(suspended[0].taxableOwnerShares.status).toBe('unknown')
    expect(raised.ownershipAmounts?.['legacy:account:rrsp']).toEqual(
      { [selfId(raised)]: 300000, [partnerId(raised)]: 200000 })
    expect(raised.migration.ownershipNeedsConfirmation).toBe(true)
    expect(precisionGate(raised).allowed).toBe(false)
    expect(raised.accounts.every(account => account.balance >= 0)).toBe(true)
    // Lowering the total below a recorded person amount never produces a negative balance.
    const lowered = refreshCanonicalFromLegacy(unrelated, { ...unrelated.legacyProjection, balances: { ...unrelated.legacyProjection.balances, rrsp: 100000 } })
    expect(lowered.accounts.find(account => account.id === 'legacy:account:rrsp')).toMatchObject(
      { balance: 100000, ownerId: null })
    expect(lowered.accounts.every(account => account.balance >= 0)).toBe(true)
    expect(lowered.ownershipAmounts?.['legacy:account:rrsp']).toEqual(
      { [selfId(lowered)]: 300000, [partnerId(lowered)]: 200000 })
    // Restoring the original total restores the recorded split.
    const restored = refreshCanonicalFromLegacy(lowered, { ...lowered.legacyProjection, balances: { ...lowered.legacyProjection.balances, rrsp: 500000 } })
    expect(rrspRow(restored).map(account => [account.ownerId, account.balance]).sort())
      .toEqual([[selfId(restored), 300000], [partnerId(restored), 200000]].sort())
    expect(() => assertCanonicalPlan(restored)).not.toThrow()
  })

  it('keeps balances conserved and the recorded amounts through a guarded partner removal and re-add', () => {
    const split = recordAccountSplit(plan(), 'legacy:account:rrsp', 300000, 200000)
    const removedPartnerId = partnerId(split)
    const removed = removePerson(split, removedPartnerId)
    expect(rrspRow(removed).reduce((sum, account) => sum + account.balance, 0)).toBe(500000)
    expect(removed.accounts.find(account => account.id === derivedAccountId('legacy:account:rrsp'))?.ownerId).toBeNull()
    expect(removed.ownershipAmounts?.['legacy:account:rrsp']).toEqual(
      { [selfId(removed)]: 300000, [removedPartnerId]: 200000 })
    // The removal-surviving record must stay canonical-valid so reload and
    // Scenario A save keep working (regression: validation rejected the
    // entry keyed by the now-orphaned partner id).
    expect(() => assertCanonicalPlan(removed)).not.toThrow()
    // Partner returns: ownership needs confirmation again; nothing is auto-attributed.
    const returned = refreshCanonicalFromLegacy(removed, { ...removed.legacyProjection, partner: { ...couple().partner! } })
    const row = rrspRow(returned)
    expect(row).toHaveLength(1)
    expect(row[0]).toMatchObject({ id: 'legacy:account:rrsp', balance: 500000, ownerId: null })
    expect(returned.ownershipAmounts?.['legacy:account:rrsp']).toEqual(
      { [selfId(returned)]: 300000, [removedPartnerId]: 200000 })
    expect(returned.migration.ownershipNeedsConfirmation).toBe(true)
    expect(() => assertCanonicalPlan(returned)).not.toThrow()
  })

  it('still rejects ownershipAmounts entries that reference nobody at all', () => {
    const split = recordAccountSplit(plan(), 'legacy:account:rrsp', 300000, 200000)
    const removed = removePerson(split, partnerId(split))
    const dangling = structuredClone(removed)
    dangling.ownershipAmounts!['legacy:account:rrsp'] = { ghost: 300000, [selfId(dangling)]: 200000 }
    expect(() => assertCanonicalPlan(dangling)).toThrow('ownershipAmounts.legacy:account:rrsp.ghost.owner')
  })

  it('matches cents-scale splits on a tolerance relative to the household total', () => {
    // A 1-cent total split in half: exact amounts pass and the shares stay valid.
    const tiny = migratePersistedPlan({ inputs: { ...couple(), balances: { tfsa: 0, rrsp: 0, nonReg: 0.01 } } }, 10, 2026)
    const exact = recordAccountSplit(tiny, 'legacy:account:nonReg', 0.005, 0.005)
    const shares = (exact.accounts.find(account => account.kind === 'nonReg')!.taxableOwnerShares as { shares: Record<string, number> }).shares
    expect(Object.values(shares).reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12)
    expect(() => assertCanonicalPlan(exact)).not.toThrow()
    // Sums that only fit inside the old absolute 1e-8 CAD gate would produce
    // shares whose sum deviates more than the 1e-8 share validation allows;
    // the scaled gate rejects them here instead of on the next validation.
    expect(() => recordAccountSplit(tiny, 'legacy:account:nonReg', 0.005000005, 0.004999996))
      .toThrow('do not match the household total')
  })

  it('reports a labelled estimate instead of attributing a two-owner registered split to one person', () => {
    const inputs = couple()
    let split = recordAccountSplit(plan(), 'legacy:account:rrsp', 300000, 200000)
    // Complete the other ownership facts so the precision gate itself passes.
    split = recordAccountSplit(split, 'legacy:account:tfsa', 100000, 0)
    split = recordAccountSplit(split, 'legacy:account:nonReg', 200000, 0)
    split.migration = { ...split.migration, sourcePersistVersion: 11, ownershipNeedsConfirmation: false,
      ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
    // The split itself is complete and owned, so the precision gate passes…
    expect(precisionGate(split).allowed).toBe(true)
    // …but the per-person tax consumer must refuse a verified figure (BE-14 B).
    const result = runProjection(inputs, undefined, split)
    expect(result.taxCapability?.status).toBe('legacyEstimate')
    expect(result.taxCapability?.reason).toContain('multiple registered accounts')
    expect(result.rows[0].taxCapability).toBe('legacyEstimate')
    expect(result.rows[0].byPersonTax).toBeUndefined()
  })

  it('the per-person tax consumer itself refuses a split two-registered-account plan', () => {
    // Direct call, bypassing the funding guard in projection.ts: the
    // multiple-registered-account guard inside personProjectionTax must stop
    // the single-account attribution path on its own (BE-14 B).
    const inputs = couple()
    const split = recordAccountSplit(plan(), 'legacy:account:rrsp', 300000, 200000)
    const result = personProjectionTax({ plan: split, inputs, year: 2026, selfAge: 65,
      withdrawals: { rrsp: 10000, nonReg: 0 }, registeredBalance: 500000,
      nonRegGainFraction: 0, nonRegDistributions: 0, rent: 0, otherWork: 0,
      oasGross: [0, 0], purchaseRrspWithdrawal: 0, purchaseNonRegTaxable: 0, propertySaleTaxable: 0 })
    expect(result.status).toBe('unsupported')
    if (result.status === 'unsupported') {
      expect(result.reason).toContain('multiple or missing registered accounts')
      expect(result.reason).toContain('BE-14 B')
    }
  })

  it('the same guard also refuses a registered withdrawal for an accumulation-phase two-account plan', () => {
    // registeredBalance = 0 exercises the withdrawals-only branch of the guard.
    const inputs = couple()
    const split = recordAccountSplit(plan(), 'legacy:account:rrsp', 300000, 200000)
    const result = personProjectionTax({ plan: split, inputs, year: 2026, selfAge: 65,
      withdrawals: { rrsp: 10000, nonReg: 0 }, registeredBalance: 0,
      nonRegGainFraction: 0, nonRegDistributions: 0, rent: 0, otherWork: 0,
      oasGross: [0, 0], purchaseRrspWithdrawal: 0, purchaseNonRegTaxable: 0, propertySaleTaxable: 0 })
    expect(result.status).toBe('unsupported')
    if (result.status === 'unsupported') expect(result.reason).toContain('multiple or missing registered accounts')
  })

  it('the balance-only branch of the guard refuses a two-account plan with no withdrawals', () => {
    // withdrawals.rrsp = 0: the base withdrawals-only guard cannot catch this
    // call, so only the f.registeredBalance > 0 trigger rejects it. Removing
    // that trigger makes this test fail (the call falls through to 'ok').
    const inputs = couple()
    const split = recordAccountSplit(plan(), 'legacy:account:rrsp', 300000, 200000)
    const result = personProjectionTax({ plan: split, inputs, year: 2026, selfAge: 65,
      withdrawals: { rrsp: 0, nonReg: 0 }, registeredBalance: 500000,
      nonRegGainFraction: 0, nonRegDistributions: 0, rent: 0, otherWork: 0,
      oasGross: [0, 0], purchaseRrspWithdrawal: 0, purchaseNonRegTaxable: 0, propertySaleTaxable: 0 })
    expect(result.status).toBe('unsupported')
    if (result.status === 'unsupported') {
      expect(result.reason).toContain('multiple or missing registered accounts')
      expect(result.reason).toContain('BE-14 B')
    }
  })

  it('validates the recorded per-person amounts and rejects broken entries', () => {
    const split = recordAccountSplit(plan(), 'legacy:account:rrsp', 300000, 200000)
    expect(() => assertCanonicalPlan(split)).not.toThrow()
    const badOwner = structuredClone(split)
    badOwner.ownershipAmounts!['legacy:account:rrsp'] = { 'ghost': 300000, [partnerId(badOwner)]: 200000 }
    expect(() => assertCanonicalPlan(badOwner)).toThrow()
    const negative = structuredClone(split)
    negative.ownershipAmounts!['legacy:account:rrsp'] = { [selfId(negative)]: -1, [partnerId(negative)]: 200000 }
    expect(() => assertCanonicalPlan(negative)).toThrow()
  })
})

describe('FE-35 A locked-account splits keep pinned contribution references live', () => {
  const lockedPlan = () => migratePersistedPlan({ inputs: locked() }, 10, 2026)
  const liraRow = (p: ReturnType<typeof lockedPlan>) => p.accounts.filter(account => account.kind === 'lira')

  it('100% to self keeps the base id that the recurring contributions pin, and the plan stays valid', () => {
    const next = recordAccountSplit(lockedPlan(), 'legacy:account:locked', 400000, 0)
    expect(liraRow(next)).toMatchObject([{ id: 'legacy:account:locked', balance: 400000, ownerId: selfId(next) }])
    expect(next.recurringContributions.map(contribution => contribution.accountId))
      .toEqual(['legacy:account:locked', 'legacy:account:locked'])
    expect(() => assertCanonicalPlan(next)).not.toThrow()
  })

  it('100% to partner no longer renames the account out from under its pinned contributions', () => {
    const next = recordAccountSplit(lockedPlan(), 'legacy:account:locked', 0, 400000)
    expect(liraRow(next)).toHaveLength(1)
    expect(liraRow(next)[0]).toMatchObject(
      { id: 'legacy:account:locked', balance: 400000, ownerId: partnerId(next) })
    expect(next.ownershipAmounts?.['legacy:account:locked']).toEqual(
      { [selfId(next)]: 0, [partnerId(next)]: 400000 })
    expect(() => assertCanonicalPlan(next)).not.toThrow()
  })

  it('a two-way split keeps both ids live, pins intact, and conserves the total', () => {
    const next = recordAccountSplit(lockedPlan(), 'legacy:account:locked', 250000, 150000)
    expect(liraRow(next).map(account => [account.id, account.balance, account.ownerId]).sort())
      .toEqual([['legacy:account:locked', 250000, selfId(next)],
        [derivedAccountId('legacy:account:locked'), 150000, partnerId(next)]].sort())
    expect(liraRow(next).reduce((sum, account) => sum + account.balance, 0)).toBe(400000)
    expect(() => assertCanonicalPlan(next)).not.toThrow()
  })

  it('a recorded locked split survives partner removal and re-add without being rewritten to the legacy owner', () => {
    const split = recordAccountSplit(lockedPlan(), 'legacy:account:locked', 250000, 150000)
    const removedPartnerId = partnerId(split)
    const single = refreshCanonicalFromLegacy(split, { ...split.legacyProjection, partner: null })
    expect(single.ownershipAmounts?.['legacy:account:locked']).toEqual(
      { [selfId(single)]: 250000, [removedPartnerId]: 150000 })
    expect(() => assertCanonicalPlan(single)).not.toThrow()
    // Partner returns with the legacy lockedRetirement.owner field untouched:
    // the recorded amounts must survive and ownership must stay suspended for
    // confirmation, exactly like the RRSP row. Regression: returningPartner
    // used to trigger the locked-owner reset and silently rewrite the entry
    // to 100% of the legacy owner.
    const returned = refreshCanonicalFromLegacy(single, { ...single.legacyProjection,
      partner: { ...couple().partner! } })
    expect(returned.ownershipAmounts?.['legacy:account:locked']).toEqual(
      { [selfId(returned)]: 250000, [removedPartnerId]: 150000 })
    expect(liraRow(returned)).toHaveLength(1)
    expect(liraRow(returned)[0]).toMatchObject(
      { id: 'legacy:account:locked', balance: 400000, ownerId: null })
    expect(liraRow(returned)[0].taxableOwnerShares.status).toBe('unknown')
    expect(returned.migration.ownershipNeedsConfirmation).toBe(true)
    expect(() => assertCanonicalPlan(returned)).not.toThrow()
  })

  it('only an explicit legacy lockedRetirement.owner change re-records the split to 100%', () => {
    const split = recordAccountSplit(lockedPlan(), 'legacy:account:locked', 250000, 150000)
    const changed = refreshCanonicalFromLegacy(split, { ...split.legacyProjection,
      lockedRetirement: { ...split.legacyProjection.lockedRetirement!, owner: 'partner' } })
    expect(changed.ownershipAmounts?.['legacy:account:locked']).toEqual(
      { [selfId(changed)]: 0, [partnerId(changed)]: 400000 })
    expect(liraRow(changed)[0]).toMatchObject(
      { id: 'legacy:account:locked', balance: 400000, ownerId: partnerId(changed) })
    expect(() => assertCanonicalPlan(changed)).not.toThrow()
  })

  it('a one-off contribution pinning the base id also survives a partner-only collapse', () => {
    const base = lockedPlan()
    base.contributions.push({ id: 'contribution:oneoff', accountId: 'legacy:account:locked',
      contributorId: selfId(base), calendarYear: 2026, amount: 1000, deductionYear: null,
      provenance: { origin: 'user', sourceYear: null } })
    const next = recordAccountSplit(base, 'legacy:account:locked', 0, 400000)
    expect(liraRow(next)).toMatchObject([{ id: 'legacy:account:locked', ownerId: partnerId(next) }])
    expect(next.contributions[0].accountId).toBe('legacy:account:locked')
    expect(() => assertCanonicalPlan(next)).not.toThrow()
  })

  it('restores a partner-only locked split onto the pinned base id after a legacy edit', () => {
    const split = recordAccountSplit(lockedPlan(), 'legacy:account:locked', 0, 400000)
    const raised = refreshCanonicalFromLegacy(split, { ...split.legacyProjection,
      lockedRetirement: { ...split.legacyProjection.lockedRetirement!, balance: 450000 } })
    expect(liraRow(raised)).toMatchObject([{ id: 'legacy:account:locked', balance: 450000, ownerId: null }])
    expect(() => assertCanonicalPlan(raised)).not.toThrow()
    const restored = refreshCanonicalFromLegacy(raised, { ...raised.legacyProjection,
      lockedRetirement: { ...raised.legacyProjection.lockedRetirement!, balance: 400000 } })
    expect(liraRow(restored)).toMatchObject(
      [{ id: 'legacy:account:locked', balance: 400000, ownerId: partnerId(restored) }])
    expect(() => assertCanonicalPlan(restored)).not.toThrow()
  })
})

describe('FE-35 A Scenario A save/restore durability', () => {
  const original = useStore.getState()
  afterEach(() => {
    useStore.setState(original, true)
    vi.unstubAllGlobals()
  })

  it('the recorded split survives Scenario A save and restore', () => {
    vi.stubGlobal('window', {})
    const split = recordAccountSplit(plan(), 'legacy:account:rrsp', 300000, 200000)
    useStore.setState({ inputs: split.legacyProjection, canonical: split })
    useStore.getState().saveScenarioA()
    const saved = useStore.getState()
    expect(saved.scenarioACanonical!.ownershipAmounts?.['legacy:account:rrsp']).toEqual(
      { [selfId(split)]: 300000, [partnerId(split)]: 200000 })
    expect(rrspRow(saved.scenarioACanonical!).map(account => [account.ownerId, account.balance]).sort())
      .toEqual([[selfId(split), 300000], [partnerId(split), 200000]].sort())
    // Disturb the current plan, then restore Scenario A: the recorded split comes back intact.
    useStore.getState().commitPlan({ inputs: saved.inputs,
      canonical: recordAccountSplit(split, 'legacy:account:rrsp', 100000, 400000),
      answerMeta: {}, draftByField: {} })
    useStore.getState().restoreScenarioA()
    const restored = useStore.getState().canonical!
    expect(restored.ownershipAmounts?.['legacy:account:rrsp']).toEqual(
      { [selfId(restored)]: 300000, [partnerId(restored)]: 200000 })
    expect(rrspRow(restored).map(account => [account.ownerId, account.balance]).sort())
      .toEqual([[selfId(restored), 300000], [partnerId(restored), 200000]].sort())
    expect(() => assertCanonicalPlan(restored)).not.toThrow()
  })

  it('Scenario A save keeps working after a guarded partner removal keeps the recorded split', () => {
    vi.stubGlobal('window', {})
    const split = recordAccountSplit(plan(), 'legacy:account:rrsp', 300000, 200000)
    const removedPartnerId = partnerId(split)
    const single = refreshCanonicalFromLegacy(split, { ...split.legacyProjection, partner: null })
    useStore.setState({ inputs: single.legacyProjection, canonical: single })
    expect(() => useStore.getState().saveScenarioA()).not.toThrow()
    const saved = useStore.getState()
    expect(saved.scenarioACanonical!.ownershipAmounts?.['legacy:account:rrsp']).toEqual(
      { [selfId(single)]: 300000, [removedPartnerId]: 200000 })
    expect(saved.scenarioACanonical!.orphanedPeople?.map(person => person.id)).toEqual([removedPartnerId])
  })

  it('Scenario A save keeps working after a 100%-to-partner locked split', () => {
    vi.stubGlobal('window', {})
    const lira = recordAccountSplit(migratePersistedPlan({ inputs: locked() }, 10, 2026),
      'legacy:account:locked', 0, 400000)
    useStore.setState({ inputs: lira.legacyProjection, canonical: lira })
    expect(() => useStore.getState().saveScenarioA()).not.toThrow()
    const saved = useStore.getState()
    expect(saved.scenarioACanonical!.accounts.find(account => account.kind === 'lira'))
      .toMatchObject({ id: 'legacy:account:locked', ownerId: partnerId(lira) })
  })
})
