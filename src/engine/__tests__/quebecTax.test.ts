import { describe, expect, it } from 'vitest'
import type { Inputs } from '../types'
import type { InputsV2, QcDrugCoverage } from '../model'
import { migratePersistedPlan, refreshCanonicalFromLegacy, swapPersonRoles } from '../migration'
import { calculateHouseholdTax } from '../householdTax'
import { ramqMonthlyPeriodMaximum, ramqPremium2026, ramqScheduleK2025, scheduleB2026 } from '../quebecTax'
import { calculatePersonIncome, type IncomeEvent } from '../personIncome'
import { runProjection } from '../projection'

const base: Inputs = {
  currentAge: 66, fireAge: 66, lifeExpectancy: 67, province: 'QC', annualSavings: 0,
  savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 }, retirementSpending: 0,
  returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
  cppStartAge: 70, cppAnnualAt65: 0, oasStartAge: 70, oasAnnualAt65: 0, strategy: 'tfsaFirst',
  partner: { currentAge: 66, cppStartAge: 70, cppAnnualAt65: 0, oasStartAge: 70, oasAnnualAt65: 0 },
}
const months = (value: QcDrugCoverage) => Array<QcDrugCoverage>(12).fill(value)
function plan(inputs: Inputs = base): InputsV2 {
  const p = migratePersistedPlan({ inputs }, 10, 2026)
  p.migration = { sourcePersistVersion: 11, ownershipNeedsConfirmation: false, ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
  p.accounts.forEach(account => {
    account.ownerId = p.people[0].id
    account.taxableOwnerShares = { status: 'known', shares: { [p.people[0].id]: 1 } }
  })
  p.taxProfile = { spouseSupported: { status: 'known', value: false }, pensionSplit: null,
    qcPensionSplit: null, qcDrugCoverage: Object.fromEntries(p.people.map(person => [person.id, months('private')])) }
  return p
}

describe('BE-35 Quebec source-owned household schedules', () => {
  it('applies one Schedule B family reduction to two 65+ $40k pensions (2026 parameters)', () => {
    // RQ 2025 Schedule B lines 14, 30–34; Québec Finance 2026 Table 3.
    const p = plan()
    const events: IncomeEvent[] = p.people.map(person => ({ id: `${person.id}:db`, kind: 'dbPension', personId: person.id, amount: 40_000 }))
    p.people.forEach(person => { person.pension = { annualAmount: 40_000, startAge: 60, indexation: 1, bridgeAnnual: 0 } })
    const income = calculatePersonIncome(p, 2026, events)
    expect(income.status).toBe('ok')
    if (income.status !== 'ok') return
    // The lowest provincial rate now comes from the selected pack, not a literal.
    const b = scheduleB2026(income.byPerson, 0.14)
    expect(b.familyIncome).toBe(80_000)
    expect(b.availableAmount).toBeCloseTo(15_054 - (80_000 - 42_955) * .1875, 6)
    expect(b.credit).toBeCloseTo(1_135.12875, 6)
    const tax = calculateHouseholdTax(p, 2026, events)
    expect(tax.status).toBe('ok')
    if (tax.status === 'ok')
      expect(Object.values(tax.byPerson).reduce((sum, row) => sum + (row.qc?.scheduleBCredit ?? 0), 0)).toBeCloseTo(b.credit, 6)
    expect(calculateHouseholdTax(swapPersonRoles(p), 2026, events)).toEqual(tax)
  })

  it('credits under-65 line-122 RRSP retirement income without treating it as federal pension', () => {
    const p = plan({ ...base, partner: undefined, currentAge: 64, fireAge: 64, lifeExpectancy: 65 })
    const account = p.accounts.find(item => item.kind === 'rrsp')!
    const tax = calculateHouseholdTax(p, 2026, [{ id: 'rrsp', kind: 'rrspWithdrawal', accountId: account.id, amount: 30_000 }])
    expect(tax.status).toBe('ok')
    if (tax.status !== 'ok') return
    const row = tax.byPerson[p.people[0].id]
    expect(row.federalPensionEligible).toBe(0)
    expect(row.qc?.scheduleBCredit).toBeCloseTo(3_541 * .14, 6)
  })

  it('Schedule F includes investment/pension/CPP and excludes wages/OAS', () => {
    const p = plan({ ...base, partner: undefined })
    const id = p.people[0].id
    const account = p.accounts.find(item => item.kind === 'nonReg')!
    const events: IncomeEvent[] = [
      { id: 'wage', kind: 'employment', personId: id, amount: 100_000 },
      { id: 'oas', kind: 'oas', personId: id, amount: 12_000 },
      { id: 'cpp', kind: 'cpp', personId: id, amount: 10_000 },
      { id: 'interest', kind: 'interest', accountId: account.id, amount: 20_000 },
    ]
    const tax = calculateHouseholdTax(p, 2026, events)
    expect(tax.status).toBe('ok')
    if (tax.status !== 'ok') return
    expect(tax.byPerson[id].qc?.qcFssBase).toBe(30_000)
    expect(tax.byPerson[id].qc?.fss).toBeCloseTo((30_000 - 18_500) * .01, 6)
    for (const [kind, expectedBase, expectedFss] of [
      ['employment', 0, 0], ['oas', 0, 0], ['cpp', 40_000, 150],
    ] as const) {
      const result = calculateHouseholdTax(p, 2026, [{ id: kind, kind, personId: id, amount: 40_000 }])
      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.byPerson[id].qc?.qcFssBase).toBe(expectedBase)
        expect(result.byPerson[id].qc?.fss).toBe(expectedFss)
      }
    }
    const large = calculateHouseholdTax(p, 2026, [{ id: 'interest-large', kind: 'interest', accountId: account.id, amount: 70_000 }])
    expect(large.status).toBe('ok')
    if (large.status === 'ok') expect(large.byPerson[id].qc?.fss).toBeCloseTo(206.45, 6)
    expect(calculateHouseholdTax(p, 2026, [{ id: 'other', kind: 'other', personId: id, amount: 20_000 }]).status).toBe('unsupported')
  })

  it('keeps Quebec Schedule Q independent of federal T1032 and rejects under-65 transferor', () => {
    const p = plan()
    const [a, b] = p.people.map(person => person.id)
    p.people[0].pension = { annualAmount: 40_000, startAge: 60, indexation: 1, bridgeAnnual: 0 }
    const events: IncomeEvent[] = [{ id: 'db', kind: 'dbPension', personId: a, amount: 40_000 }]
    p.taxProfile!.pensionSplit = { transferorId: a, recipientId: b, amount: 10_000 }
    const federalOnly = calculateHouseholdTax(p, 2026, events)
    expect(federalOnly.status).toBe('ok')
    if (federalOnly.status !== 'ok') return
    expect(federalOnly.byPerson[a].qc?.qcTaxableIncome).toBe(40_000)
    expect(federalOnly.byPerson[b].qc?.qcTaxableIncome).toBe(0)
    p.taxProfile!.qcPensionSplit = { transferorId: a, recipientId: b, amount: 10_000 }
    const both = calculateHouseholdTax(p, 2026, events)
    expect(both.status).toBe('ok')
    if (both.status !== 'ok') return
    expect(both.byPerson[a].qc?.qcTaxableIncome).toBe(30_000)
    expect(both.byPerson[b].qc?.qcTaxableIncome).toBe(10_000)
    p.people[0].ageInBaseYear = 64
    expect(calculateHouseholdTax(p, 2026, events).status).toBe('invalid')
  })

  it('gates public and unknown 2026 months, allows all-private/waived and tracks the July boundary', () => {
    expect(ramqPremium2026(months('private'))).toEqual({ status: 'ok', premium: 0 })
    expect(ramqPremium2026(months('waived'))).toEqual({ status: 'ok', premium: 0 })
    const mixed = months('private'); mixed[6] = 'public'
    expect(ramqPremium2026(mixed)).toMatchObject({ status: 'unsupported' })
    mixed[6] = 'unknown'
    expect(ramqPremium2026(mixed)).toMatchObject({ status: 'unsupported' })
    expect(ramqMonthlyPeriodMaximum(2026, 6)).toBeCloseTo(766 / 12, 8)
    expect(ramqMonthlyPeriodMaximum(2026, 7)).toBeCloseTo(789 / 12, 8)
    const p = plan()
    p.taxProfile!.qcDrugCoverage![p.people[1].id] = months('public')
    expect(calculateHouseholdTax(p, 2026, []).status).toBe('unsupported')
  })

  it('historical 2025 Schedule K uses one family test and separate Jan–Jun/Jul–Dec caps', () => {
    // RQ 2025 Schedule K lines 40–48, 77–90; not a 2026 projection rule.
    const full = ramqScheduleK2025(80_000, true, months('public'))
    expect(full).toMatchObject({ status: 'ok', premium: 755, publicMonthsJanJun: 6, publicMonthsJulDec: 6 })
    expect(ramqScheduleK2025(80_000, true, months('private'))).toMatchObject({ status: 'ok', premium: 0 })
    const janPrivate = months('public'); janPrivate.fill('private', 0, 6)
    expect(ramqScheduleK2025(80_000, true, janPrivate)).toMatchObject({ status: 'ok', premium: 383,
      publicMonthsJanJun: 0, publicMonthsJulDec: 6 })
    const julPrivate = months('public'); julPrivate.fill('waived', 6)
    expect(ramqScheduleK2025(80_000, true, julPrivate)).toMatchObject({ status: 'ok', premium: 372.02,
      publicMonthsJanJun: 6, publicMonthsJulDec: 0 })
    expect(ramqScheduleK2025(32_240, true, months('public'))).toMatchObject({ status: 'ok', premium: 0 })
    expect(ramqScheduleK2025(19_890, false, months('public'))).toMatchObject({ status: 'ok', premium: 0 })
  })

  it('feeds both-mode canonical projection only when all coverage facts are confirmed and supported', () => {
    const p = plan({ ...base, partner: undefined })
    const result = runProjection({ ...base, partner: undefined }, undefined, p)
    expect(result.taxCapability?.status).toBe('person')
    expect(result.rows[0].byPersonTax?.[p.people[0].id].qc).toBeDefined()
    p.taxProfile!.qcDrugCoverage![p.people[0].id][0] = 'public'
    const limited = runProjection({ ...base, partner: undefined }, undefined, p)
    expect(limited.taxCapability?.status).toBe('legacyEstimate')
    expect(limited.rows[0].byPersonTax).toBeUndefined()
  })

  it('changes the normal annual cash/tax solve only when Quebec Schedule Q is actually elected', () => {
    const inputs: Inputs = { ...base, lifeExpectancy: 66, retirementSpending: 45_000,
      pension: { annualAmount: 50_000, startAge: 60, indexation: 1, bridgeAnnual: 0 } }
    const p = plan(inputs)
    const [a, b] = p.people.map(person => person.id)
    p.taxProfile!.pensionSplit = { transferorId: a, recipientId: b, amount: 20_000 }
    const federalOnly = runProjection(inputs, undefined, p)
    expect(federalOnly.taxCapability?.status).toBe('person')
    p.taxProfile!.qcPensionSplit = { transferorId: a, recipientId: b, amount: 20_000 }
    const both = runProjection(inputs, undefined, p)
    expect(both.taxCapability?.status).toBe('person')
    expect(federalOnly.rows[0].byPersonTax?.[a].qc?.qcTaxableIncome).toBe(50_000)
    expect(both.rows[0].byPersonTax?.[a].qc?.qcTaxableIncome).toBe(30_000)
    expect(both.rows[0].tax).not.toBeCloseTo(federalOnly.rows[0].tax, 2)
    expect(both.rows[0].netCash).not.toBeCloseTo(federalOnly.rows[0].netCash, 2)
  })

  it('retains confirmed coverage and separate elections through legacy-form refresh without assigning a new spouse', () => {
    const p = plan({ ...base, partner: undefined })
    const self = p.people[0].id
    p.taxProfile!.qcDrugCoverage![self][3] = 'waived'
    const changed = refreshCanonicalFromLegacy(p, { ...base, partner: undefined, retirementSpending: 1_000 })
    expect(changed.taxProfile?.qcDrugCoverage?.[self][3]).toBe('waived')
    const expanded = refreshCanonicalFromLegacy(changed, base)
    expect(expanded.taxProfile?.qcDrugCoverage?.[self][3]).toBe('waived')
    expect(expanded.taxProfile?.qcDrugCoverage?.[expanded.people[1].id]).toBeUndefined()
    expect(expanded.taxProfile?.qcPensionSplit).toBeNull()
  })
})
