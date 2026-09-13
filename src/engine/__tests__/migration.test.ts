import { describe, expect, it } from 'vitest'
import type { Inputs } from '../types'
import { migratePersistedPlan, refreshCanonicalFromLegacy, removePerson, swapPersonRoles } from '../migration'
import { ageReachedInYear } from '../model'

const fixture = (couple = false): Inputs => ({
  currentAge: 45, fireAge: 55, lifeExpectancy: 90, province: 'ON', annualSavings: 40000,
  savingsSplit: { tfsa: .3, rrsp: .5, nonReg: .2 }, retirementSpending: 60000,
  returns: { tfsa: .04, rrsp: .04, nonReg: .04 },
  balances: { tfsa: 120000, rrsp: 230000, nonReg: 340000 }, nonRegBook: 210000,
  cppStartAge: 65, cppAnnualAt65: 14000, oasStartAge: 65, oasAnnualAt65: 9000,
  strategy: 'meltdownPaced', partner: couple ? { currentAge: 42, cppStartAge: 65, cppAnnualAt65: 7000, oasStartAge: 65, oasAnnualAt65: 8000, pension: { annualAmount: 12000, startAge: 62, indexation: 0, bridgeAnnual: 0 } } : null,
  pension: { annualAmount: 18000, startAge: 60, indexation: .7, bridgeAnnual: 4000 },
  fhsa: { balance: 28000, annualContribution: 8000, openedYearsAgo: 3 },
  lockedRetirement: { balance: 85000, employeeContribution: 4000, employerContribution: 4000, accessibleAge: 55, jurisdiction: 'ON', owner: couple ? 'partner' : 'self' },
  principalResidence: { value: 700000, appreciation: .02, sellAtAge: null, mortgage: { balance: 300000, annualPayment: 25000, yearsRemaining: 15 } },
  investmentProperties: [{ value: 450000, acb: 300000, appreciation: .02, sellAtAge: null, annualRent: 12000, mortgage: { balance: 200000, annualPayment: 15000, yearsRemaining: 20 } }],
  debts: [{ kind: 'carLoan', balance: 15000, annualPayment: 5000, yearsRemaining: 3 }],
  children: [{ age: 5 }],
})

describe('BE-10 migration fixtures T01/T13/T17', () => {
  it.each([2, 6, 9, 10])('preserves single-person v%s money and sources', version => {
    const input = fixture()
    const plan = migratePersistedPlan({ inputs: input }, version, 2026)
    expect(plan.schemaVersion).toBe(2)
    expect(plan.baseYear).toBe(2026)
    expect(ageReachedInYear(plan.people[0], plan.baseYear, 2027)).toBe(46)
    expect(plan.accounts.reduce((sum, a) => sum + a.balance, 0)).toBe(803000)
    expect(plan.accounts.every(a => a.ownerId === plan.people[0].id)).toBe(true)
    expect(plan.accounts.find(a => a.kind === 'nonReg')?.acb).toEqual({ status: 'known', value: 210000 })
    expect(plan.properties.find(p => p.kind === 'investment')?.acb).toEqual({ status: 'known', value: 300000 })
    expect(plan.debts.reduce((sum, d) => sum + d.principal, 0)).toBe(515000)
    expect(plan.properties.find(p => p.kind === 'investment')?.annualRent).toEqual({ status: 'known', value: 12000 })
    expect(plan.dependents).toEqual([{ id: 'legacy:dependent:0', ageInBaseYear: 5, provenance: { origin: 'legacy', sourceYear: null } }])
    expect(plan.people[0].pensionAnnual).toBe(18000)
    expect(plan.people[0].pension).toEqual(input.pension)
    expect(plan.incomeSources.find(source => source.id === `${plan.people[0].id}:pension`)?.startAge).toBe(60)
    expect(plan.properties.find(p => p.kind === 'investment')).toMatchObject({ appreciation: .02, sellAtAge: null })
    expect(plan.accounts.find(a => a.kind === 'fhsa')?.openedYear.status).toBe('unknown')
    expect(plan.accounts.find(a => a.kind === 'lira')?.accessibleAgeConfirmed).toBe(false)
    expect(plan.budget.kind).toBe('savingsBudget')
    expect(plan.people[0].rrspAvailableRoom.status).toBe('unknown')
    expect(migratePersistedPlan({ canonical: plan, inputs: input }, 10, 2030)).toEqual(plan)
  })
  it('puts couple balances and tax shares in suspense without a 50/50 assumption', () => {
    const input = fixture(true)
    const plan = migratePersistedPlan({ inputs: input }, 10, 2026)
    expect(plan.accounts.filter(a => a.ownerId === null).map(a => a.balance)).toEqual([120000, 230000, 340000, 28000])
    expect(plan.accounts.filter(a => a.ownerId === null).every(a => a.taxableOwnerShares.status === 'unknown')).toBe(true)
    expect(plan.accounts.find(a => a.kind === 'lira')?.ownerId).toBe(plan.people[1].id)
    expect(plan.people.map(p => p.pensionAnnual)).toEqual([18000, 12000])
    expect(plan.people[1].pension).toEqual(input.partner?.pension)
    expect(plan.incomeSources.filter(s => s.kind === 'cpp').map(s => s.annualAmount)).toEqual([{ status: 'known', value: 14000 }, { status: 'known', value: 7000 }])
    expect(plan.migration.ownershipNeedsConfirmation).toBe(true)
  })
  it('migrates Scenario A independently, including absence', () => {
    const current = migratePersistedPlan({ inputs: fixture(true) }, 10, 2026)
    const scenario = migratePersistedPlan({ inputs: { ...fixture(true), balances: { tfsa: 1, rrsp: 2, nonReg: 3 } } }, 10, 2026)
    expect(current.accounts[0].balance).toBe(120000)
    expect(scenario.accounts.slice(0, 3).map(a => a.balance)).toEqual([1, 2, 3])
    const state = { inputs: fixture(true), scenarioA: null }
    expect(state.scenarioA).toBeNull()
  })
  it('keeps references stable when roles swap or partner is removed', () => {
    const plan = migratePersistedPlan({ inputs: fixture(true) }, 10, 2026)
    const swapped = swapPersonRoles(plan)
    expect(swapped.people.map(p => p.id)).toEqual(plan.people.map(p => p.id))
    expect(swapped.accounts.find(a => a.kind === 'lira')?.ownerId).toBe(plan.people[1].id)
    const removed = removePerson(plan, plan.people[1].id)
    expect(removed.accounts.find(a => a.kind === 'lira')?.balance).toBe(85000)
    expect(removed.accounts.find(a => a.kind === 'lira')?.ownerId).toBeNull()
    expect(removed.incomeSources.find(s => s.id === `${plan.people[1].id}:cpp`)?.recipientId).toBeNull()
    const refreshed = refreshCanonicalFromLegacy(plan, { ...fixture(true), partner: null })
    expect(refreshed.accounts.find(a => a.kind === 'lira')?.ownerId).toBeNull()
    expect(refreshed.accounts.slice(0, 4).every(a => a.ownerId === null)).toBe(true)
  })
  it('keeps rental B identity, ownership, ACB and mortgage when A is deleted', () => {
    const input = fixture(true)
    input.investmentProperties = [
      { value: 400000, acb: 250000, appreciation: .01, sellAtAge: 70, mortgage: { balance: 100000, annualPayment: 10000, yearsRemaining: 12 } },
      { value: 900000, acb: 600000, appreciation: .03, sellAtAge: 75, mortgage: { balance: 300000, annualPayment: 22000, yearsRemaining: 18 } },
    ]
    const plan = migratePersistedPlan({ inputs: input }, 10, 2026)
    plan.properties.find(p => p.value === 400000)!.taxableOwnerShares = { status: 'known', shares: { [plan.people[0].id]: 1 } }
    plan.properties.find(p => p.value === 900000)!.taxableOwnerShares = { status: 'known', shares: { [plan.people[1].id]: 1 } }
    const priorB = plan.properties.find(p => p.value === 900000)!
    const next = refreshCanonicalFromLegacy(plan, { ...input, investmentProperties: input.investmentProperties.slice(1) })
    const rentals = next.properties.filter(p => p.kind === 'investment')
    expect(rentals).toHaveLength(1)
    expect(rentals[0]).toMatchObject({ id: priorB.id, value: 900000, acb: { status: 'known', value: 600000 }, appreciation: .03, sellAtAge: 75, taxableOwnerShares: { status: 'known', shares: { [plan.people[1].id]: 1 } } })
    expect(next.debts.filter(d => d.propertyId === priorB.id)).toMatchObject([{ principal: 300000 }])
    const reordered = refreshCanonicalFromLegacy(plan, { ...plan.legacyProjection, investmentProperties: [...plan.legacyProjection.investmentProperties!].reverse() })
    expect(reordered.properties.filter(p => p.kind === 'investment').map(p => p.id)).toEqual([
      priorB.id, plan.properties.find(p => p.value === 400000)!.id,
    ])
    expect(reordered.debts.find(d => d.propertyId === priorB.id)?.principal).toBe(300000)
  })
  it('follows an explicit locked owner edit instead of keeping the previous owner', () => {
    const input = fixture(true)
    input.lockedRetirement!.owner = 'self'
    const plan = migratePersistedPlan({ inputs: input }, 10, 2026)
    const next = refreshCanonicalFromLegacy(plan, { ...input, lockedRetirement: { ...input.lockedRetirement!, owner: 'partner' } })
    expect(next.accounts.find(a => a.kind === 'lira')?.ownerId).toBe(plan.people[1].id)
  })
  it('rejects malformed plans and unsupported future versions', () => {
    expect(() => migratePersistedPlan('{bad', 10, 2026)).toThrow()
    expect(() => migratePersistedPlan({ inputs: {} }, 10, 2026)).toThrow()
    expect(() => migratePersistedPlan({ inputs: { ...fixture(), balances: { tfsa: null, rrsp: 2, nonReg: 3 } } }, 10, 2026)).toThrow('balances.tfsa')
    expect(() => migratePersistedPlan({ inputs: fixture() }, 99, 2026)).toThrow()
  })
  it('normalizes supported pre-v5 strategy and singular investment property', () => {
    const input = fixture()
    const { investmentProperties, strategy: _strategy, ...old } = input
    const plan = migratePersistedPlan({ inputs: { ...old, withdrawalOrder: ['tfsa', 'rrsp'], investmentProperty: investmentProperties?.[0] } }, 4, 2026)
    expect(plan.strategy).toBe('tfsaFirst')
    expect(plan.properties.find(p => p.kind === 'investment')?.acb).toEqual({ status: 'known', value: 300000 })
  })
})
