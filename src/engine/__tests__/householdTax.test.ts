import { describe, expect, it } from 'vitest'
import type { Inputs } from '../types'
import { migratePersistedPlan, swapPersonRoles } from '../migration'
import type { InputsV2 } from '../model'
import { calculateHouseholdTax } from '../householdTax'
import type { IncomeEvent } from '../personIncome'
import { provincialSpouseAmount2026 } from '../spouseCredit2026'
import { runProjection } from '../projection'
import { incomeTax } from '../tax'

const legacy: Inputs = {
  currentAge: 62, fireAge: 62, lifeExpectancy: 90, province: 'ON', annualSavings: 0,
  savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 }, retirementSpending: 0,
  returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
  cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0, strategy: 'tfsaFirst',
  partner: { currentAge: 62, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
}
function plan(): InputsV2 {
  const p = migratePersistedPlan({ inputs: legacy }, 10, 2026)
  p.migration = { sourcePersistVersion: 11, ownershipNeedsConfirmation: false, ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
  p.accounts.forEach(account => {
    account.ownerId = p.people[0].id
    account.taxableOwnerShares = { status: 'known', shares: { [p.people[0].id]: 1 } }
  })
  p.taxProfile = { spouseSupported: { status: 'known', value: false }, pensionSplit: null }
  return p
}

describe('BE-11 person-owned tax and elections', () => {
  it('keeps a $160k wage on its earner; equal $80k wages are a different tax base', () => {
    const p = plan()
    const [a, b] = p.people.map(person => person.id)
    const one = calculateHouseholdTax(p, 2026, [{ id: 'a-wage', kind: 'employment', personId: a, amount: 160_000 }])
    const two = calculateHouseholdTax(p, 2026, [
      { id: 'a-wage', kind: 'employment', personId: a, amount: 80_000 },
      { id: 'b-wage', kind: 'employment', personId: b, amount: 80_000 },
    ])
    expect(one.status).toBe('ok')
    expect(two.status).toBe('ok')
    if (one.status !== 'ok' || two.status !== 'ok') return
    expect(one.byPerson[a].taxableIncome).toBe(160_000)
    expect(one.byPerson[b].taxableIncome).toBe(0)
    expect(two.byPerson[a].taxableIncome).toBe(80_000)
    // At $80k, 2026 federal: 58,523×14% + 21,477×20.5% − 16,452×14%.
    // ON: 53,891×5.05% + 26,109×9.15% − 12,989×5.05% + $750 health premium.
    const expectedPerPerson = 58_523 * .14 + 21_477 * .205 - 16_452 * .14 +
      53_891 * .0505 + 26_109 * .0915 - 12_989 * .0505 + 750
    expect(two.total).toBeCloseTo(expectedPerPerson * 2, 2)
    expect(one.total).toBeGreaterThan(two.total)
    expect(calculateHouseholdTax(swapPersonRoles(p), 2026, [
      { id: 'a-wage', kind: 'employment', personId: a, amount: 80_000 },
      { id: 'b-wage', kind: 'employment', personId: b, amount: 80_000 },
    ])).toEqual(two)
  })

  it('does not assign ordinary RRSP income to the spouse or accept a pension election on it', () => {
    const p = plan()
    const [a, b] = p.people.map(person => person.id)
    const rrsp = p.accounts.find(account => account.kind === 'rrsp')!
    const events: IncomeEvent[] = [{ id: 'draw', kind: 'rrspWithdrawal', accountId: rrsp.id, amount: 20_000 }]
    const result = calculateHouseholdTax(p, 2026, events)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.byPerson[a].taxableIncome).toBe(20_000)
      expect(result.byPerson[b].taxableIncome).toBe(0)
      expect(result.byPerson[a].federalPensionEligible).toBe(0)
    }
    p.taxProfile!.pensionSplit = { transferorId: a, recipientId: b, amount: 5_000 }
    expect(calculateHouseholdTax(p, 2026, events)).toMatchObject({ status: 'invalid' })
  })

  it('accepts 0 and 50% of eligible DB pension, rejects more and respects owner', () => {
    const p = plan()
    const [a, b] = p.people.map(person => person.id)
    p.people[0].pension = { annualAmount: 40_000, startAge: 60, indexation: 1, bridgeAnnual: 0 }
    const events: IncomeEvent[] = [{ id: 'db', kind: 'dbPension', personId: a, amount: 40_000 }]
    p.taxProfile!.pensionSplit = { transferorId: a, recipientId: b, amount: 0 }
    expect(calculateHouseholdTax(p, 2026, events)).toMatchObject({ status: 'ok', byPerson: { [a]: { taxableIncome: 40_000 }, [b]: { taxableIncome: 0 } } })
    p.taxProfile!.pensionSplit!.amount = 20_000
    expect(calculateHouseholdTax(p, 2026, events)).toMatchObject({ status: 'ok', byPerson: { [a]: { taxableIncome: 20_000 }, [b]: { taxableIncome: 20_000 } } })
    p.taxProfile!.pensionSplit!.amount = 20_001
    expect(calculateHouseholdTax(p, 2026, events).status).toBe('invalid')
  })

  it('caps one explicit election against total eligible DB plus RRIF income', () => {
    const p = plan()
    const [a, b] = p.people.map(person => person.id)
    p.people[0].ageInBaseYear = 72
    p.people[0].pension = { annualAmount: 20_000, startAge: 60, indexation: 1, bridgeAnnual: 0 }
    const account = p.accounts.find(item => item.kind === 'rrsp')!
    account.kind = 'rrif'
    const events: IncomeEvent[] = [
      { id: 'db', kind: 'dbPension', personId: a, amount: 20_000 },
      { id: 'rrif', kind: 'rrifWithdrawal', accountId: account.id, amount: 20_000 },
    ]
    p.taxProfile!.pensionSplit = { transferorId: a, recipientId: b, amount: 20_000 }
    expect(calculateHouseholdTax(p, 2026, events)).toMatchObject({ status: 'ok', byPerson: {
      [a]: { taxableIncome: 20_000 }, [b]: { taxableIncome: 20_000 },
    } })
    p.taxProfile!.pensionSplit.amount = 20_001
    expect(calculateHouseholdTax(p, 2026, events).status).toBe('invalid')
  })

  it('taxes RRIF split income to a 62-year-old without granting pension credits (CRA T1032 Step 4)', () => {
    const p = plan()
    const [a, b] = p.people.map(person => person.id)
    p.people[0].ageInBaseYear = 68
    p.people[1].ageInBaseYear = 62
    const account = p.accounts.find(item => item.kind === 'rrsp')!
    account.kind = 'rrif'
    p.taxProfile!.pensionSplit = { transferorId: a, recipientId: b, amount: 10_000 }
    const result = calculateHouseholdTax(p, 2026, [
      { id: 'rrif', kind: 'rrifWithdrawal', accountId: account.id, amount: 20_000 },
      { id: 'wage', kind: 'employment', personId: b, amount: 40_000 },
    ])
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.byPerson[b].taxableIncome).toBe(50_000)
    expect(result.byPerson[b].federalPensionEligible).toBe(0)
    expect(result.byPerson[b].provincialPensionEligible).toBe(0)
    // Independent 2026 ON fixture: 50k taxable, no pension amount, age 62.
    expect(result.byPerson[b].tax).toBeCloseTo(7_165.78, 2)
    p.people[1].ageInBaseYear = 65
    const older = calculateHouseholdTax(p, 2026, [
      { id: 'rrif', kind: 'rrifWithdrawal', accountId: account.id, amount: 20_000 },
      { id: 'wage', kind: 'employment', personId: b, amount: 40_000 },
    ])
    expect(older).toMatchObject({ status: 'ok', byPerson: { [b]: {
      federalPensionEligible: 10_000, provincialPensionEligible: 10_000,
    } } })
  })

  it('apportions mixed DB/RRIF split credit by source for an under-65 recipient', () => {
    const p = plan()
    const [a, b] = p.people.map(person => person.id)
    p.people[0].ageInBaseYear = 68
    p.people[1].ageInBaseYear = 62
    p.people[0].pension = { annualAmount: 20_000, startAge: 60, indexation: 1, bridgeAnnual: 0 }
    const account = p.accounts.find(item => item.kind === 'rrsp')!
    account.kind = 'rrif'
    p.taxProfile!.pensionSplit = { transferorId: a, recipientId: b, amount: 20_000 }
    const result = calculateHouseholdTax(p, 2026, [
      { id: 'db', kind: 'dbPension', personId: a, amount: 20_000 },
      { id: 'rrif', kind: 'rrifWithdrawal', accountId: account.id, amount: 20_000 },
    ])
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.byPerson[b].taxableIncome).toBe(20_000)
    expect(result.byPerson[b].federalPensionEligible).toBe(10_000)
  })

  it('uses the elected pension split for OAS recovery in normal projection cash and tax', () => {
    const inputs: Inputs = { ...legacy, currentAge: 68, fireAge: 68, lifeExpectancy: 68,
      pension: { annualAmount: 150_000, startAge: 65, indexation: 1, bridgeAnnual: 0 },
      oasAnnualAt65: 8_000, partner: { ...legacy.partner!, currentAge: 68 },
    }
    const p = migratePersistedPlan({ inputs }, 10, 2026)
    p.migration = { sourcePersistVersion: 11, ownershipNeedsConfirmation: false, ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
    p.accounts.forEach(account => { account.ownerId = p.people[0].id; account.taxableOwnerShares = { status: 'known', shares: { [p.people[0].id]: 1 } } })
    p.taxProfile = { spouseSupported: { status: 'known', value: false }, pensionSplit: { transferorId: p.people[0].id, recipientId: p.people[1].id, amount: 50_000 } }
    const row = runProjection(inputs, undefined, p).rows[0]
    expect(row.taxCapability).toBe('person')
    expect(row.oas).toBeCloseTo(8_000 - (100_000 + 8_000 - 95_323) * .15, 2)
    expect(row.byPersonTax?.[p.people[0].id].netIncome).toBeCloseTo(100_000 + row.oas, 2)
    expect(row.tax).toBeCloseTo(Object.values(row.byPersonTax!).reduce((sum, person) => sum + person.tax, 0), 2)
    expect(row.netCash).toBeCloseTo(row.pension + row.oas - row.tax, 2)
    const noElection = runProjection(inputs, undefined, { ...p, taxProfile: { ...p.taxProfile!, pensionSplit: null } }).rows[0]
    expect(noElection.oas).toBe(0)
    expect(row.netCash).toBeGreaterThan(noElection.netCash)
  })

  it('keeps a 62-year-old recipient RRIF split taxable but credit-ineligible in normal projection', () => {
    const inputs: Inputs = { ...legacy, currentAge: 68, fireAge: 68, lifeExpectancy: 68,
      retirementSpending: 40_000, balances: { tfsa: 0, rrsp: 100_000, nonReg: 0 },
      savingsSplit: { tfsa: 0, rrsp: 1, nonReg: 0 }, strategy: 'rrspFirst',
      partner: { ...legacy.partner!, currentAge: 62, cppStartAge: 62, cppAnnualAt65: 40_000 },
    }
    const p = migratePersistedPlan({ inputs }, 10, 2026)
    p.migration = { sourcePersistVersion: 11, ownershipNeedsConfirmation: false, ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
    p.accounts.forEach(account => { account.ownerId = p.people[0].id; account.taxableOwnerShares = { status: 'known', shares: { [p.people[0].id]: 1 } } })
    const registered = p.accounts.find(account => account.kind === 'rrsp')!
    registered.kind = 'rrif'
    registered.openedYear = { status: 'known', value: 2025 }
    p.taxProfile = { spouseSupported: { status: 'known', value: false }, pensionSplit: { transferorId: p.people[0].id, recipientId: p.people[1].id, amount: 5_000 } }
    const row = runProjection(inputs, undefined, p).rows[0]
    const recipient = row.byPersonTax?.[p.people[1].id]
    expect(row.taxCapability).toBe('person')
    expect(recipient?.taxableIncome).toBeGreaterThan(5_000)
    expect(recipient?.federalPensionEligible).toBe(0)
    expect(recipient?.tax).toBeCloseTo(incomeTax(recipient!.taxableIncome, 'ON', { age: 62, pensionIncome: 0 }), 2)
  })

  it('applies a confirmed spouse amount only to the claimant, with official 2026 ON limits', () => {
    const p = plan()
    const [a] = p.people.map(person => person.id)
    const events: IncomeEvent[] = [{ id: 'wage', kind: 'employment', personId: a, amount: 60_000 }]
    const noClaim = calculateHouseholdTax(p, 2026, events)
    p.taxProfile!.spouseSupported = { status: 'known', value: true }
    const claim = calculateHouseholdTax(p, 2026, events)
    expect(noClaim.status).toBe('ok')
    expect(claim.status).toBe('ok')
    if (noClaim.status !== 'ok' || claim.status !== 'ok') return
    // Federal: $16,452×14%; ON: $11,029×5.05%. ON basic tax remains
    // above that credit at $60k, so the full manual difference applies.
    expect(noClaim.total - claim.total).toBeCloseTo(16_452 * .14 + 11_029 * .0505, 2)
  })

  it('allocates 80/20 non-registered gains and rejects unknown ownership', () => {
    const p = plan()
    const [a, b] = p.people.map(person => person.id)
    const account = p.accounts.find(item => item.kind === 'nonReg')!
    account.taxableOwnerShares = { status: 'known', shares: { [a]: .8, [b]: .2 } }
    const event: IncomeEvent = { id: 'gain', kind: 'realizedGain', accountId: account.id, amount: 10_000 }
    expect(calculateHouseholdTax(p, 2026, [event])).toMatchObject({ status: 'ok', byPerson: { [a]: { taxableIncome: 4_000 }, [b]: { taxableIncome: 1_000 } } })
    account.taxableOwnerShares = { status: 'unknown', reason: 'statement missing' }
    expect(calculateHouseholdTax(p, 2026, [event]).status).toBe('unsupported')
  })

  it('attributes rental income and property capital gain to the property tax shares across role swaps', () => {
    const inputs: Inputs = { ...legacy, investmentProperties: [{ id: 'rental:1', value: 200_000,
      acb: 100_000, appreciation: 0, sellAtAge: null, annualRent: 10_000 }] }
    const p = migratePersistedPlan({ inputs }, 10, 2026)
    const [a, b] = p.people.map(person => person.id)
    p.migration = { sourcePersistVersion: 11, ownershipNeedsConfirmation: false,
      ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
    p.accounts.forEach(account => {
      account.ownerId = a
      account.taxableOwnerShares = { status: 'known', shares: { [a]: 1 } }
    })
    p.properties[0].taxableOwnerShares = { status: 'known', shares: { [a]: .8, [b]: .2 } }
    p.taxProfile = { spouseSupported: { status: 'known', value: false }, pensionSplit: null }
    const events: IncomeEvent[] = [
      { id: 'rent', kind: 'rent', propertyId: 'rental:1', amount: 10_000 },
      { id: 'sale', kind: 'realizedGain', propertyId: 'rental:1', amount: 100_000 },
    ]
    const first = calculateHouseholdTax(p, 2026, events)
    expect(first).toMatchObject({ status: 'ok', byPerson: {
      [a]: { taxableIncome: 48_000 }, [b]: { taxableIncome: 12_000 },
    } })
    expect(calculateHouseholdTax(swapPersonRoles(p), 2026, events)).toEqual(first)
  })

  it('uses province-specific 2026 spouse-credit thresholds, not federal household averaging', () => {
    // CRA TD1ON-26: max $11,029, spouse-net threshold $12,132;
    // TD1BC-26: max $11,317, spouse-net threshold $12,449;
    // TD1MB-26: $9,134 minus spouse net from dollar one.
    expect(provincialSpouseAmount2026('ON', 1_103)).toBe(11_029)
    expect(provincialSpouseAmount2026('ON', 5_000)).toBe(7_132)
    expect(provincialSpouseAmount2026('BC', 5_000)).toBe(7_449)
    expect(provincialSpouseAmount2026('MB', 5_000)).toBe(4_134)
  })

  it('feeds normal withdrawal solving and YearRow from the same person-owned tax ledger', () => {
    const inputs: Inputs = { ...legacy, lifeExpectancy: 65, retirementSpending: 10_000,
      cppStartAge: 62, cppAnnualAt65: 24_000, oasStartAge: 70,
      partner: { ...legacy.partner!, cppStartAge: 70, oasStartAge: 70 } }
    const p = plan()
    p.lifeExpectancy = 65
    p.people[0].cppAnnualAt65 = 24_000
    const result = runProjection(inputs, undefined, p)
    const first = result.rows[0]
    expect(result.taxCapability).toMatchObject({ status: 'person' })
    expect(first.taxCapability).toBe('person')
    expect(first.byPersonTax?.[p.people[0].id].taxableIncome).toBeGreaterThan(0)
    expect(first.byPersonTax?.[p.people[1].id].taxableIncome).toBe(0)
    expect(first.tax).toBeCloseTo(Object.values(first.byPersonTax!).reduce((sum, row) => sum + row.tax, 0), 7)
  })
})
