import { describe, expect, it } from 'vitest'
import type { Inputs } from '../types'
import { completeCanonicalFacts, migratePersistedPlan, refreshCanonicalFromLegacy, removePerson, swapPersonRoles } from '../migration'
import { fhsaPlanRowId } from '../fhsaPlan'
import { ageReachedInYear } from '../model'
import { assertCanonicalPlan } from '../modelValidation'

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
  it('does not attribute newly combined account and property amounts to the prior single owner', () => {
    const input = fixture()
    const single = migratePersistedPlan({ inputs: input }, 10, 2026)
    const edited = refreshCanonicalFromLegacy(single, { ...single.legacyProjection, balances: { ...input.balances, tfsa: 120000 } })
    const combined = refreshCanonicalFromLegacy(edited, {
      ...edited.legacyProjection,
      partner: fixture(true).partner,
      balances: { ...edited.legacyProjection.balances, tfsa: 220000 },
      nonRegBook: 260000,
      principalResidence: { ...input.principalResidence!, value: 900000, mortgage: { balance: 400000, annualPayment: 30000, yearsRemaining: 18 } },
    } as Inputs)
    expect(combined.people).toHaveLength(2)
    expect(combined.accounts.find(a => a.kind === 'tfsa')).toMatchObject({ balance: 220000, ownerId: null, taxableOwnerShares: { status: 'unknown' } })
    expect(combined.accounts.find(a => a.kind === 'nonReg')).toMatchObject({ acb: { status: 'known', value: 260000 }, ownerId: null, taxableOwnerShares: { status: 'unknown' } })
    expect(combined.accounts.find(a => a.kind === 'lira')?.ownerId).toBe(single.people[0].id)
    expect(combined.properties.every(property => property.taxableOwnerShares.status === 'unknown')).toBe(true)
    expect(combined.debts.find(debt => debt.propertyId === 'legacy:property:principal')?.principal).toBe(400000)
    expect(combined.migration.ownershipNeedsConfirmation).toBe(true)
    expect(() => assertCanonicalPlan(combined)).not.toThrow()
    const laterEdit = refreshCanonicalFromLegacy(combined, { ...combined.legacyProjection, balances: { ...combined.legacyProjection.balances, tfsa: 250000 } })
    expect(laterEdit.accounts.find(a => a.kind === 'tfsa')).toMatchObject({ balance: 250000, ownerId: null })
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
  it('makes partner-owned rental tax shares unknown when the partner is removed', () => {
    const input = fixture(true)
    const plan = migratePersistedPlan({ inputs: input }, 10, 2026)
    const rental = plan.properties.find(p => p.kind === 'investment')!
    rental.taxableOwnerShares = { status: 'known', shares: { [plan.people[1].id]: 1 } }
    const next = refreshCanonicalFromLegacy(plan, { ...plan.legacyProjection, partner: null })
    expect(next.people).toHaveLength(1)
    expect(next.properties.find(p => p.id === rental.id)).toMatchObject({ value: 450000, acb: { status: 'known', value: 300000 }, mortgageDebtId: rental.mortgageDebtId, taxableOwnerShares: { status: 'unknown' } })
    expect(next.debts.find(d => d.id === rental.mortgageDebtId)?.principal).toBe(200000)
    expect(next.orphanedPeople?.[0].pension).toEqual(input.partner?.pension)
    expect(next.incomeSources.find(source => source.id === `${plan.people[1].id}:cpp`)).toMatchObject({ recipientId: null, annualAmount: { status: 'known', value: 7000 } })
    expect(() => assertCanonicalPlan(next)).not.toThrow()
    const edited = refreshCanonicalFromLegacy(next, { ...next.legacyProjection, annualSavings: 41000 })
    expect(edited.orphanedPeople?.[0].pension).toEqual(input.partner?.pension)
    expect(edited.incomeSources.find(source => source.id === `${plan.people[1].id}:cpp`)?.recipientId).toBeNull()
  })
  it('reconciles a returning partner without duplicate live/orphan IDs', () => {
    const input = fixture(true)
    const original = migratePersistedPlan({ inputs: input }, 10, 2026)
    const single = refreshCanonicalFromLegacy(original, { ...original.legacyProjection, partner: null })
    const reunited = refreshCanonicalFromLegacy(single, { ...single.legacyProjection, partner: input.partner })
    expect(reunited.people.map(person => person.id)).toEqual(original.people.map(person => person.id))
    expect(reunited.orphanedPeople ?? []).toEqual([])
    expect(() => assertCanonicalPlan(reunited)).not.toThrow()
    expect(reunited.people[1].pension).toEqual(input.partner?.pension)
    expect(reunited.accounts.find(a => a.kind === 'lira')?.ownerId).toBe(original.people[1].id)
  })
  it('keeps CRA RRSP statement facts through a legacy form edit and completes older snapshots', () => {
    const plan = migratePersistedPlan({ inputs: fixture() }, 10, 2026)
    const self = plan.people[0]
    self.rrspDeductionLimit = { status: 'known', value: 20000 }
    self.rrspAvailableRoom = { status: 'known', value: 15000 }
    self.rrspUnusedUndeducted = { status: 'known', value: 5000 }
    self.rrspPensionAdjustment = { status: 'known', value: 1000 }
    self.rrspPspa = { status: 'known', value: 200 }
    self.rrspPar = { status: 'known', value: 300 }
    const edited = refreshCanonicalFromLegacy(plan, { ...plan.legacyProjection, annualSavings: 41000 })
    expect(edited.people[0].rrspDeductionLimit).toEqual({ status: 'known', value: 20000 })
    expect(edited.people[0].rrspAvailableRoom).toEqual({ status: 'known', value: 15000 })
    expect(edited.people[0].rrspUnusedUndeducted).toEqual({ status: 'known', value: 5000 })
    expect(edited.people[0].rrspPensionAdjustment).toEqual({ status: 'known', value: 1000 })
    expect(edited.people[0].rrspPspa).toEqual({ status: 'known', value: 200 })
    expect(edited.people[0].rrspPar).toEqual({ status: 'known', value: 300 })
    // A v11 snapshot written before these fields existed is completed unknown,
    // never rejected and never backfilled with a guessed figure.
    const older = structuredClone(plan) as unknown as { people: Record<string, unknown>[] }
    for (const person of older.people) {
      delete person.rrspUnusedUndeducted
      delete person.rrspPensionAdjustment
      delete person.rrspPspa
      delete person.rrspPar
    }
    const completed = completeCanonicalFacts(older as unknown as typeof plan, fixture())
    assertCanonicalPlan(completed)
    expect(completed.people[0].rrspUnusedUndeducted).toEqual({ status: 'unknown', reason: 'CRA statement not supplied' })
    expect(completed.people[0].rrspPensionAdjustment).toEqual({ status: 'unknown', reason: 'CRA statement not supplied' })
    expect(completed.people[0].rrspPspa).toEqual({ status: 'unknown', reason: 'CRA statement not supplied' })
    expect(completed.people[0].rrspPar).toEqual({ status: 'unknown', reason: 'CRA statement not supplied' })
  })

  it('retains known recurring cash-flow instructions without relying on the legacy projection', () => {
    const input = fixture()
    input.savingsSplit = { tfsa: .1, rrsp: .2, nonReg: .7 }
    input.lockedRetirement!.employerContribution = 6000
    input.cppWork = { startWorkAge: 22, retireAge: 55 }
    input.nonRegDistributionYield = .025
    input.accumulationMarginalRate = .37
    input.meltdownBracketCap = 'bracket2'
    input.principalResidence = { mode: 'planned', buyAtAge: 60, price: 750000, downPayment: 150000, appreciation: .02, annualMortgagePayment: 30000, mortgageYears: 25, netHoldingCostChange: 12000, sellAtAge: null }
    const plan = migratePersistedPlan({ inputs: input }, 10, 2026)
    expect(plan.savingsAllocation.shares).toEqual(input.savingsSplit)
    expect(plan.recurringContributions.map(c => [c.accountId, c.annualAmount, c.funding])).toEqual([
      ['legacy:account:fhsa', 8000, 'fromSavings'],
      ['legacy:account:locked', 4000, 'fromSavings'],
      ['legacy:account:locked', 6000, 'employerAdditional'],
    ])
    expect(plan.properties[0]).toMatchObject({ annualHoldingCostChange: 12000, plannedMortgage: { annualPayment: 30000, yearsRemaining: 25 } })
    expect(plan.accounts.find(a => a.kind === 'fhsa')?.openedYearsAgoAtBaseYear).toBe(3)
    expect(plan.people[0].cppWork).toEqual(input.cppWork)
    expect(plan.projectionAssumptions).toEqual({ nonRegDistributionYield: .025, accumulationMarginalRate: .37, meltdownBracketCap: 'bracket2' })
    const edited = refreshCanonicalFromLegacy(plan, { ...plan.legacyProjection, savingsSplit: { tfsa: .2, rrsp: .3, nonReg: .5 }, fhsa: { ...input.fhsa!, annualContribution: 7000 } })
    expect(edited.savingsAllocation.shares).toEqual({ tfsa: .2, rrsp: .3, nonReg: .5 })
    expect(edited.recurringContributions[0].annualAmount).toBe(7000)
    const older = structuredClone(plan) as typeof plan
    delete (older as Partial<typeof plan>).savingsAllocation
    delete (older as Partial<typeof plan>).recurringContributions
    delete (older as Partial<typeof plan>).projectionAssumptions
    older.properties[0].plannedMortgage = undefined as unknown as typeof older.properties[0]['plannedMortgage']
    const completed = completeCanonicalFacts(older, input)
    expect(completed.recurringContributions).toEqual(plan.recurringContributions)
    expect(completed.properties[0].plannedMortgage).toEqual(plan.properties[0].plannedMortgage)
    expect(() => assertCanonicalPlan(completed)).not.toThrow()
  })
  it('rejects malformed financial adapter input rather than treating null returns as zero', () => {
    expect(() => migratePersistedPlan({ inputs: { ...fixture(), returns: null } }, 10, 2026)).toThrow()
  })
  it('drops explicit FHSA and LIRA removals from both canonical and legacy inputs', () => {
    const input = fixture()
    const plan = migratePersistedPlan({ inputs: input }, 10, 2026)
    const next = refreshCanonicalFromLegacy(plan, { ...plan.legacyProjection, fhsa: null, lockedRetirement: null })
    expect(next.accounts.filter(a => a.kind === 'fhsa' || a.kind === 'lira')).toEqual([])
    expect(next.legacyProjection.fhsa).toBeNull()
    expect(next.legacyProjection.lockedRetirement).toBeNull()
    expect(next.accounts.reduce((sum, a) => sum + a.balance, 0)).toBe(690000)
  })
  it('rejects malformed plans and unsupported future versions', () => {
    expect(() => migratePersistedPlan('{bad', 10, 2026)).toThrow()
    expect(() => migratePersistedPlan({ inputs: {} }, 10, 2026)).toThrow()
    expect(() => migratePersistedPlan({ inputs: { ...fixture(), balances: { tfsa: null, rrsp: 2, nonReg: 3 } } }, 10, 2026)).toThrow('balances.tfsa')
    expect(() => migratePersistedPlan({ inputs: fixture() }, 99, 2026)).toThrow()
  })
  it('records the planned FHSA contribution under the canonical row the panel writes', () => {
    const plan = migratePersistedPlan({ inputs: fixture() }, 10, 2026)
    const account = plan.accounts.find(a => a.kind === 'fhsa')!
    const rows = plan.recurringContributions.filter(c => c.accountId === account.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: `be36:fhsa:${account.id}`, annualAmount: 8000, funding: 'fromSavings' })
    expect(rows[0].id).toBe(fhsaPlanRowId(account.id))
  })
  it('keeps the recorded FHSA plan through an unrelated shared-field edit', () => {
    const input = fixture()
    const plan = migratePersistedPlan({ inputs: input }, 10, 2026)
    const account = plan.accounts.find(a => a.kind === 'fhsa')!
    const person = plan.people[0]
    // The tax panel records 6,000: one canonical row, and the legacy mirror in
    // step with it. This is exactly the state the panel commits.
    plan.recurringContributions = plan.recurringContributions.filter(c => c.accountId !== account.id)
    plan.recurringContributions.push({
      id: fhsaPlanRowId(account.id), accountId: account.id, contributorId: person.id,
      annualAmount: 6000, funding: 'fromSavings', provenance: { origin: 'user', sourceYear: 2026 },
    })
    const mirrored = { ...input, annualSavings: 41000, fhsa: { ...input.fhsa!, annualContribution: 6000 } }
    const edited = refreshCanonicalFromLegacy(plan, mirrored)
    expect(edited.recurringContributions.filter(c => c.accountId === account.id)).toEqual([
      expect.objectContaining({ id: fhsaPlanRowId(account.id), annualAmount: 6000 }),
    ])
    expect(edited.legacyProjection.fhsa?.annualContribution).toBe(6000)
    expect(edited.budget.kind === 'savingsBudget' && edited.budget.annualNetSavings).toBe(41000)
  })
  it('collapses a duplicate FHSA plan row left by an earlier build to the recorded plan', () => {
    const input = fixture()
    const plan = migratePersistedPlan({ inputs: input }, 10, 2026)
    const account = plan.accounts.find(a => a.kind === 'fhsa')!
    const person = plan.people[0]
    // The earlier build wrote both the recorded row and a legacy mirror row,
    // and mirrored their sum into the legacy form. The recorded row is the plan.
    plan.recurringContributions = plan.recurringContributions.map(c =>
      c.accountId === account.id ? { ...c, annualAmount: 6000 } : c)
    plan.recurringContributions.push({
      id: 'legacy:contribution:fhsa', accountId: account.id, contributorId: person.id,
      annualAmount: 8000, funding: 'fromSavings', provenance: { origin: 'legacy', sourceYear: null },
    })
    plan.legacyProjection = { ...input, fhsa: { ...input.fhsa!, annualContribution: 14000 } }
    const edited = refreshCanonicalFromLegacy(plan, plan.legacyProjection)
    const rows = edited.recurringContributions.filter(c => c.accountId === account.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: fhsaPlanRowId(account.id), annualAmount: 6000 })
    expect(edited.legacyProjection.fhsa?.annualContribution).toBe(6000)
  })
  it('validates complete v11 canonical shape and cross-references before hydration', () => {
    const plan = migratePersistedPlan({ inputs: fixture(true) }, 10, 2026)
    expect(() => assertCanonicalPlan(plan)).not.toThrow()
    expect(() => assertCanonicalPlan({ schemaVersion: 2 })).toThrow()
    const badOwner = structuredClone(plan)
    badOwner.accounts[0].ownerId = 'missing-person'
    expect(() => assertCanonicalPlan(badOwner)).toThrow('ownerId')
    const badMortgage = structuredClone(plan)
    badMortgage.properties.find(p => p.kind === 'investment')!.mortgageDebtId = 'missing-debt'
    expect(() => assertCanonicalPlan(badMortgage)).toThrow('mortgageDebtId')
  })
  it('normalizes supported pre-v5 strategy and singular investment property', () => {
    const input = fixture()
    const { investmentProperties, strategy: _strategy, ...old } = input
    const plan = migratePersistedPlan({ inputs: { ...old, withdrawalOrder: ['tfsa', 'rrsp'], investmentProperty: investmentProperties?.[0] } }, 4, 2026)
    expect(plan.strategy).toBe('tfsaFirst')
    expect(plan.properties.find(p => p.kind === 'investment')?.acb).toEqual({ status: 'known', value: 300000 })
  })
})
