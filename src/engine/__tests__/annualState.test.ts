import { describe, expect, it, vi } from 'vitest'
import type { Inputs } from '../types'
import { migratePersistedPlan } from '../migration'
import type { InputsV2 } from '../model'
import { impliedRate } from '../debts'
import { annualStep, fixedReturnProvider, initializeState, projectFromState, sumInvestableAssets, sumNetWorth, type AnnualProviders } from '../annualState'
import { FHSA_HISTORY_MISSING, FHSA_MULTIPLE_ACTIVE_ACCOUNTS } from '../fhsa'
import { fhsaPlanRowId, plannedFhsaContribution } from '../fhsaPlan'

const input = (): Inputs => ({
  currentAge: 40, fireAge: 60, lifeExpectancy: 90, province: 'ON', annualSavings: 40,
  savingsSplit: { tfsa: .5, rrsp: .5, nonReg: 0 }, retirementSpending: 50,
  returns: { tfsa: .1, rrsp: .1, nonReg: .1 }, balances: { tfsa: 100, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
  cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0, strategy: 'tfsaFirst',
  debts: [{ id: 'loan', kind: 'carLoan', balance: 10, annualPayment: 10, yearsRemaining: 1 }],
})
function plan(legacy = input()): InputsV2 {
  const result = migratePersistedPlan({ inputs: legacy }, 10, 2026)
  result.migration = { sourcePersistVersion: 11, ownershipNeedsConfirmation: false, ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
  result.budget = { kind: 'savingsBudget', annualNetSavings: legacy.annualSavings, retirementSpending: legacy.retirementSpending,
    debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } }
  for (const account of result.accounts) account.contributionRoom = { status: 'known', value: 1000 }
  for (const person of result.people) { person.tfsaAvailableRoom = { status: 'known', value: 1000 }; person.rrspAvailableRoom = { status: 'known', value: 1000 } }
  return result
}
const providers = (income = 110): AnnualProviders => ({
  evaluate: ({ state }) => ({ byPerson: Object.fromEntries(Object.keys(state.byPerson).map(id => [id, { income, earnedIncome: income, benefits: 0, tax: 20, spending: 50, taxableIncome: income, benefitIncomeForNextYear: { status: 'known' as const, value: income } }])) }),
  returns: () => .1,
})
const ok = <T>(result: { status: string; value?: T }): T => { expect(result.status).toBe('ok'); return result.value! }

describe('BE-14 A nominal annual state kernel', () => {
  it('settles hand-calculated cash, debt, contributions, growth, ACB and ages once', () => {
    const canonical = plan()
    const opening = ok(initializeState(canonical))
    const { state, row } = ok(annualStep(canonical, opening, providers(120)))
    const tfsa = canonical.accounts.find(a => a.kind === 'tfsa')!.id
    const rrsp = canonical.accounts.find(a => a.kind === 'rrsp')!.id
    expect(row.cashLedger).toMatchObject({ income: 120, tax: 20, spending: 50, debtPayments: 10, voluntaryContributions: 40, unallocated: 0 })
    expect(row.byAccount[tfsa]).toMatchObject({ opening: 100, contribution: 20, returnAmount: 12, closing: 132 })
    expect(row.byAccount[rrsp]).toMatchObject({ opening: 0, contribution: 20, returnAmount: 2, closing: 22 })
    expect(sumInvestableAssets(state)).toBe(154)
    expect(sumNetWorth(state)).toBe(154)
    expect(state.byDebt.loan.principal).toBe(0)
    expect(state.byPerson[canonical.people[0].id].age).toBe(41)
    expect(state.benefitIncomeLag[canonical.people[0].id]).toEqual({ status: 'known', value: 120 })
    // BE-27 A: TFSA room belongs to the person, so the account's own
    // `contributionRoom` column is no longer decremented; the priced room lives
    // on the per-person ledger, where 20 of the 1,000 applied leaves 980.
    expect(state.byAccount[tfsa].room).toEqual({ status: 'known', value: 1000 })
    expect(row.tfsaLedger[canonical.people[0].id]).toMatchObject({
      applied: 20, retained: 0, closingRoom: { status: 'known', value: 980 } })
    expect(state.contributionHistory).toContainEqual(expect.objectContaining({ accountId: tfsa, contributorId: canonical.people[0].id, amount: 20, calendarYear: 2026 }))
    expect(opening.byAccount[tfsa].balance).toBe(100)
    expect(opening.byDebt.loan.principal).toBe(10)
    expect(opening.contributionHistory).toHaveLength(0)
  })

  it('keeps P08 locked contributions separate from opening balance and employer money', () => {
    const canonical = plan({ ...input(), annualSavings: 10000, inflation: 0, balances: { tfsa: 0, rrsp: 0, nonReg: 0 },
      savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 }, debts: [],
      lockedRetirement: { balance: 100000, employeeContribution: 3000, employerContribution: 2000, accessibleAge: 60, jurisdiction: 'ON', owner: 'self' } })
    const initial = ok(initializeState(canonical))
    const taxFree = { evaluate: ({ state }: { state: typeof initial }) => ({ byPerson: Object.fromEntries(Object.keys(state.byPerson).map(id => [id, { income: 10000, earnedIncome: 10000, benefits: 0, tax: 0, spending: 0, taxableIncome: 10000, benefitIncomeForNextYear: { status: 'known' as const, value: 10000 } }])) }), returns: () => 0 }
    const two = ok(projectFromState(canonical, initial, 2, taxFree))
    const lockedId = canonical.accounts.find(a => a.kind === 'lira')!.id
    expect(two.rows.map(row => row.byAccount[lockedId].closing)).toEqual([105000, 110000])
    expect(two.rows[0].cashLedger).toMatchObject({ employeeContributions: 3000, employerContributions: 2000, fhsaContributions: 0 })
    expect(two.rows.map(row => row.cashLedger.voluntaryContributions)).toEqual([7000, 7000])
    expect(sumInvestableAssets(two.state)).toBe(124000)
    const resumed = ok(projectFromState(canonical, ok(annualStep(canonical, initial, taxFree)).state, 1, taxFree))
    expect(resumed.rows[0]).toEqual(two.rows[1])
    expect(resumed.state).toEqual(two.state)
  })

  it('isolates evaluator and return candidates; age and previous-income lag advance before the next year', () => {
    const canonical = plan({ ...input(), debts: [], inflation: 0, children: [{ age: 10 }], savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 } })
    const initial = ok(initializeState(canonical))
    const seen: number[] = []
    const childAges: number[] = []
    const isolated: AnnualProviders = {
      evaluate: ({ state }) => {
        seen.push(state.byPerson[canonical.people[0].id].age)
        childAges.push(state.byDependent[canonical.dependents[0].id].age)
        state.byAccount[canonical.accounts[0].id].balance = 999999
        return { byPerson: { [canonical.people[0].id]: { income: 40, earnedIncome: 30, benefits: 0, tax: 0, spending: 0, taxableIncome: 40, benefitIncomeForNextYear: { status: 'known', value: state.year === 2026 ? 30 : 40 } } } }
      },
      returns: ({ state }) => { state.byAccount[canonical.accounts[0].id].balance = -999; return 0 },
    }
    const first = ok(annualStep(canonical, initial, isolated))
    expect(first.state.byAccount[canonical.accounts[0].id].balance).toBe(100)
    expect(first.state.benefitIncomeLag[canonical.people[0].id]).toEqual({ status: 'known', value: 30 })
    expect(first.state.byPerson[canonical.people[0].id].previousYearEarnedIncome).toEqual({ status: 'known', value: 30 })
    const second = ok(annualStep(canonical, first.state, isolated))
    expect(second.state.benefitIncomeLag[canonical.people[0].id]).toEqual({ status: 'known', value: 40 })
    expect(seen).toEqual([40, 41])
    expect(childAges).toEqual([10, 11])
    expect(second.state.byDependent[canonical.dependents[0].id].age).toBe(12)
    expect(initial.byPerson[canonical.people[0].id].age).toBe(40)
  })

  it('blocks unsupported event before evaluating cash, and types invalid results', () => {
    const canonical = plan({ ...input(), principalResidence: { mode: 'planned', buyAtAge: 40, price: 100, downPayment: 100, appreciation: 0, netHoldingCostChange: 0, sellAtAge: null } })
    const initial = ok(initializeState(canonical))
    const evaluate = vi.fn(providers().evaluate)
    const result = annualStep(canonical, initial, { evaluate, returns: fixedReturnProvider })
    expect(result).toMatchObject({ status: 'unsupported', issues: [{ code: 'unsupported', detail: expect.stringContaining('planned purchase') }] })
    expect(evaluate).not.toHaveBeenCalled()
    expect(initial.byProperty[canonical.properties[0].id].held).toBe(false)
    const broken = structuredClone(canonical)
    broken.accounts[0].balance = Number.NaN
    expect(initializeState(broken).status).toBe('invalid')
    const noPurchase = plan()
    const opening = ok(initializeState(noPurchase))
    expect(annualStep(noPurchase, opening, { ...providers(120), returns: () => Number.NaN }).status).toBe('invalid')
    const corrupted = structuredClone(opening)
    corrupted.byPerson[noPurchase.people[0].id].age = 39
    expect(annualStep(noPurchase, corrupted, providers()).status).toBe('invalid')
    expect(projectFromState(noPurchase, corrupted, 0, providers()).status).toBe('invalid')
    expect(projectFromState(noPurchase, corrupted, 1, providers()).status).toBe('invalid')
    const unclonable = Object.assign(structuredClone(opening), { unexpected: () => 1 })
    expect(projectFromState(noPurchase, unclonable, 0, providers()).status).toBe('invalid')
    expect(projectFromState(noPurchase, unclonable, 1, providers()).status).toBe('invalid')
  })

  it('gates unknown ownership and retains, rather than refuses, an unverified TFSA room', () => {
    const canonical = plan()
    canonical.accounts[0].ownerId = null
    canonical.accounts[0].taxableOwnerShares = { status: 'unknown', reason: 'unassigned' }
    expect(initializeState(canonical).status).toBe('unsupported')
    // BE-27 A: TFSA room is per person, so the account's own `contributionRoom`
    // column is no longer the gate. An unconfirmed person room prices nothing,
    // retains the whole planned amount where the user can see it, and never
    // becomes unlimited room or a real zero.
    const valid = plan()
    valid.people[0].tfsaAvailableRoom = { status: 'unknown', reason: 'statement missing' }
    const opening = ok(initializeState(valid))
    const step = ok(annualStep(valid, opening, providers(120)))
    expect(step.row.byAccount[valid.accounts[0].id].contribution).toBe(0)
    expect(step.row.cashLedger.retainedContributions).toBe(20)
    expect(step.row.tfsaLedger[valid.people[0].id].closingRoom.status).toBe('unknown')
    expect(step.row.tfsaLedger[valid.people[0].id].limitations.map(item => item.code)).toContain('unexecuted')
    expect(opening.byAccount[valid.accounts[0].id].balance).toBe(100)
  })

  it('uses self role rather than person-array order and does not infer couple contributor from account ownership', () => {
    const canonical = plan({ ...input(), debts: [], savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 }, partner: { currentAge: 37, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 } })
    const self = canonical.people.find(p => p.role === 'self')!
    for (const account of canonical.accounts) { account.ownerId = self.id; account.taxableOwnerShares = { status: 'known', shares: { [self.id]: 1 } } }
    const swapped = structuredClone(canonical)
    swapped.people.reverse()
    const evaluate: AnnualProviders['evaluate'] = ({ state }) => ({ byPerson: Object.fromEntries(Object.keys(state.byPerson).map(id => [id, {
      income: id === self.id ? 40 : 0, earnedIncome: id === self.id ? 40 : 0, benefits: 0, tax: 0, spending: 0, taxableIncome: id === self.id ? 40 : 0,
      benefitIncomeForNextYear: { status: 'unknown' as const, reason: 'AFNI not evaluated' },
    }])) })
    const providersA = { evaluate, returns: () => 0 }
    const left = ok(annualStep(canonical, ok(initializeState(canonical)), providersA))
    const right = ok(annualStep(swapped, ok(initializeState(swapped)), providersA))
    expect(right).toEqual(left)
    expect(left.row.byPerson[self.id].age).toBe(40)
    expect(left.state.contributionHistory.filter(c => c.calendarYear === 2026).map(c => c.contributorId)).toEqual([null])
    expect(left.state.benefitIncomeLag[self.id]).toEqual({ status: 'unknown', reason: 'AFNI not evaluated' })
    const rrspCandidate = structuredClone(canonical)
    rrspCandidate.savingsAllocation.shares = { tfsa: 0, rrsp: 1, nonReg: 0 }
    expect(annualStep(rrspCandidate, ok(initializeState(rrspCandidate)), providersA)).toMatchObject({ status: 'unsupported', issues: [{ detail: expect.stringContaining('couple RRSP contributor') }] })
  })

  it('uses the same deterministic return interface for fixed and zero-volatility MC providers', () => {
    // A TFSA-only split keeps this return-interface check two years long; an
    // RRSP carry needs a sourced room-addition rule after the statement year.
    const canonical = plan({ ...input(), debts: [], inflation: .02, annualSavings: 50, savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 } })
    const initial = ok(initializeState(canonical))
    const balanced = { evaluate: ({ state }: { state: typeof initial }) => ({ byPerson: { [canonical.people[0].id]: {
      income: 120 + state.year - canonical.baseYear, earnedIncome: 120 + state.year - canonical.baseYear,
      benefits: 0, tax: 20, spending: 50, taxableIncome: 120 + state.year - canonical.baseYear,
      benefitIncomeForNextYear: { status: 'unknown' as const, reason: 'not supplied' },
    } } }) }
    const fixed = ok(projectFromState(canonical, initial, 2, { ...balanced, returns: fixedReturnProvider }))
    const zeroVol = ok(projectFromState(canonical, initial, 2, { ...balanced, returns: () => .122 }))
    for (let year = 0; year < 2; year++) for (const account of canonical.accounts) {
      expect(zeroVol.rows[year].byAccount[account.id].closing).toBeCloseTo(fixed.rows[year].byAccount[account.id].closing, 10)
    }
    expect(sumInvestableAssets(zeroVol.state)).toBeCloseTo(sumInvestableAssets(fixed.state), 10)
    expect(fixed.rows[0].byAccount[canonical.accounts[0].id].returnAmount).toBeCloseTo(150 * ((1.1 * 1.02) - 1), 8)
  })

  it('counts FHSA and locked assets once and withholds unknown FHSA rollover timing', () => {
    const canonical = plan({ ...input(), balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, debts: [],
      fhsa: { balance: 40000, annualContribution: 0, openedYearsAgo: 2 },
      lockedRetirement: { balance: 100000, employeeContribution: 0, employerContribution: 0, accessibleAge: 60, jurisdiction: 'ON', owner: 'self' } })
    const initial = ok(initializeState(canonical))
    expect(sumInvestableAssets(initial)).toBe(140000)
    expect(sumNetWorth(initial)).toBe(140000)
    expect(annualStep(canonical, initial, providers()).status).toBe('unsupported')
  })

  it('keeps an owned home in nominal net worth while age-linked sale remains an opening event', () => {
    const canonical = plan({ ...input(), debts: [], inflation: .02, savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 },
      principalResidence: { value: 200, appreciation: .05, sellAtAge: 41 } })
    const initial = ok(initializeState(canonical))
    expect(sumNetWorth(initial)).toBe(300)
    const first = ok(annualStep(canonical, initial, { ...providers(110), returns: () => 0 }))
    expect(first.state.byProperty[canonical.properties[0].id].value).toBeCloseTo(214.2, 8)
    expect(sumNetWorth(first.state)).toBeCloseTo(354.2, 8)
    expect(annualStep(canonical, first.state, providers()).status).toBe('unsupported')
  })

  it('does not invest evaluator cash beyond canonical net savings or deduct included debt twice', () => {
    const noDebt = plan({ ...input(), debts: [], savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 } })
    const opening = ok(initializeState(noDebt))
    const tooMuch = { evaluate: () => ({ byPerson: { [noDebt.people[0].id]: {
      income: 100, earnedIncome: 100, benefits: 0, tax: 0, spending: 0, taxableIncome: 100,
      benefitIncomeForNextYear: { status: 'unknown' as const, reason: 'not supplied' },
    } } }), returns: () => 0 }
    expect(annualStep(noDebt, opening, tooMuch).status).toBe('unsupported')
    expect(opening.byAccount[noDebt.accounts[0].id].balance).toBe(100)
    const withDebt = plan()
    const debtOpening = ok(initializeState(withDebt))
    const exact = ok(annualStep(withDebt, debtOpening, providers(120)))
    expect(exact.row.cashLedger.debtPayments).toBe(10)
    expect(exact.row.cashLedger.voluntaryContributions).toBe(40)
    expect(annualStep(withDebt, debtOpening, providers(110)).status).toBe('unsupported')
    if (withDebt.budget.kind === 'savingsBudget') withDebt.budget.debtIncluded = { status: 'known', value: false }
    expect(annualStep(withDebt, debtOpening, providers(120)).status).toBe('unsupported')
    if (withDebt.budget.kind === 'savingsBudget') {
      withDebt.budget.debtIncluded = { status: 'known', value: true }
      withDebt.budget.taxBenefitIncluded = { status: 'unknown', reason: 'not confirmed' }
    }
    expect(annualStep(withDebt, debtOpening, providers(120)).status).toBe('unsupported')
    const deficit = plan({ ...input(), debts: [], annualSavings: -40, savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 } })
    expect(annualStep(deficit, ok(initializeState(deficit)), providers(110))).toMatchObject({ status: 'unsupported', issues: [{ detail: expect.stringContaining('negative net savings') }] })
  })

  it('stops zero-balance FHSA contributions when opening year is unknown before evaluating cash', () => {
    const canonical = plan({ ...input(), debts: [], fhsa: { balance: 0, annualContribution: 10, openedYearsAgo: 0 } })
    const opening = ok(initializeState(canonical))
    const evaluate = vi.fn(providers(110).evaluate)
    expect(annualStep(canonical, opening, { evaluate, returns: () => 0 })).toMatchObject({ status: 'unsupported', issues: [{ detail: expect.stringContaining('FHSA opening year') }] })
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('rejects nested NaN room before one-year stepping and zero-year continuation', () => {
    const canonical = plan({ ...input(), debts: [], savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 } })
    const opening = ok(initializeState(canonical))
    const broken = structuredClone(opening)
    broken.byAccount[canonical.accounts[0].id].room = { status: 'known', value: Number.NaN }
    expect(annualStep(canonical, broken, providers(110)).status).toBe('invalid')
    expect(projectFromState(canonical, broken, 0, providers(110)).status).toBe('invalid')
    expect(projectFromState(canonical, broken, 1, providers(110)).status).toBe('invalid')
  })

  it('does not book an FHSA contribution before its known opening year', () => {
    const canonical = plan({ ...input(), debts: [], fhsa: { balance: 0, annualContribution: 10, openedYearsAgo: 0 } })
    const fhsa = canonical.accounts.find(a => a.kind === 'fhsa')!
    fhsa.openedYear = { status: 'known', value: 2028 }
    const opening = ok(initializeState(canonical))
    const evaluate = vi.fn(providers(110).evaluate)
    expect(annualStep(canonical, opening, { evaluate, returns: () => 0 })).toMatchObject({ status: 'unsupported', issues: [{ detail: expect.stringContaining('FHSA opening year') }] })
    expect(evaluate).not.toHaveBeenCalled()
    expect(opening.byAccount[fhsa.id].balance).toBe(0)
    expect(opening.contributionHistory).toHaveLength(0)
  })

  it('never returns ok with malformed evaluator lag or negative property value', () => {
    const canonical = plan({ ...input(), debts: [], principalResidence: { value: 200, appreciation: 0, sellAtAge: null } })
    const opening = ok(initializeState(canonical))
    const malformed = { evaluate: () => ({ byPerson: { [canonical.people[0].id]: {
      income: 110, earnedIncome: 110, benefits: 0, tax: 20, spending: 50, taxableIncome: 110,
      benefitIncomeForNextYear: { status: 'unknown' },
    } } }), returns: () => 0 } as unknown as AnnualProviders
    expect(annualStep(canonical, opening, malformed).status).toBe('invalid')
    const validUnknown = ok(annualStep(canonical, opening, { ...providers(110), returns: () => 0 }))
    expect(projectFromState(canonical, validUnknown.state, 0, providers(110)).status).toBe('ok')
    const falling = structuredClone(canonical)
    falling.properties[0].appreciation = -1.2
    const result = annualStep(falling, ok(initializeState(falling)), { ...providers(110), returns: () => 0 })
    expect(result).toMatchObject({ status: 'unsupported', issues: [{ detail: expect.stringContaining('property growth') }] })
  })

  it('keeps the final committed year resumable for a zero-year read', () => {
    const canonical = plan({ ...input(), debts: [], lifeExpectancy: 40 })
    canonical.people[0].retirementAge = 100
    const opening = ok(initializeState(canonical))
    const final = ok(annualStep(canonical, opening, providers(110)))
    expect(projectFromState(canonical, final.state, 0, providers(110)).status).toBe('ok')
    expect(annualStep(canonical, final.state, providers(110)).status).toBe('invalid')
  })

  it('rejects a forged held planned home in both zero-year reads and annual stepping', () => {
    const canonical = plan({ ...input(), debts: [], balances: { tfsa: 0, rrsp: 0, nonReg: 0 },
      principalResidence: { mode: 'planned', buyAtAge: 40, price: 200000, downPayment: 200000, appreciation: 0, netHoldingCostChange: 0, sellAtAge: null } })
    const opening = ok(initializeState(canonical))
    const propertyId = canonical.properties[0].id
    expect(opening.byProperty[propertyId].held).toBe(false)
    expect(annualStep(canonical, opening, providers(110)).status).toBe('unsupported')
    const forged = structuredClone(opening)
    forged.byProperty[propertyId].held = true
    expect(projectFromState(canonical, forged, 0, providers(110)).status).toBe('invalid')
    expect(annualStep(canonical, forged, providers(110)).status).toBe('invalid')
    expect(opening.byProperty[propertyId].held).toBe(false)
    const owned = plan({ ...input(), debts: [], principalResidence: { value: 200000, appreciation: 0, sellAtAge: null } })
    const ownedSnapshot = ok(initializeState(owned))
    ownedSnapshot.byProperty[owned.properties[0].id].held = false
    expect(projectFromState(owned, ownedSnapshot, 0, providers(110)).status).toBe('invalid')
  })

  it('does not treat account room as proof that an FHSA contribution is legally available', () => {
    const canonical = plan({ ...input(), debts: [], annualSavings: 8000, savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 }, fhsa: { balance: 80000, annualContribution: 8000, openedYearsAgo: 5 } })
    const fhsa = canonical.accounts.find(account => account.kind === 'fhsa')!
    fhsa.openedYear = { status: 'known', value: 2021 }
    fhsa.contributionRoom = { status: 'known', value: 8000 }
    canonical.contributions = [2021, 2022, 2023, 2024, 2025].map(year => ({
      id: `fhsa:${year}`, accountId: fhsa.id, contributorId: canonical.people[0].id,
      calendarYear: year, amount: 8000, deductionYear: null,
      provenance: { origin: 'user', sourceYear: year },
    }))
    const opening = ok(initializeState(canonical))
    expect(opening.contributionHistory.reduce((sum, item) => sum + item.amount, 0)).toBe(40000)
    const result = annualStep(canonical, opening, { evaluate: () => ({ byPerson: { [canonical.people[0].id]: {
      income: 8000, earnedIncome: 8000, benefits: 0, tax: 0, spending: 0, taxableIncome: 8000,
      benefitIncomeForNextYear: { status: 'unknown', reason: 'not supplied' },
    } } }), returns: () => 0 })
    expect(result).toMatchObject({ status: 'unsupported', issues: [{ detail: expect.stringContaining('FHSA contribution') }] })
    expect(opening.byAccount[fhsa.id].balance).toBe(80000)
  })

  it('does not let a base-year snapshot invent confirmed account opening or room facts', () => {
    const canonical = plan({ ...input(), debts: [], fhsa: { balance: 0, annualContribution: 0, openedYearsAgo: 0 } })
    const opening = ok(initializeState(canonical))
    const fhsa = canonical.accounts.find(account => account.kind === 'fhsa')!
    const forgedOpening = structuredClone(opening)
    forgedOpening.byAccount[fhsa.id].openedYear = { status: 'known', value: 2020 }
    expect(projectFromState(canonical, forgedOpening, 0, providers(110)).status).toBe('invalid')
    const forgedRoom = structuredClone(opening)
    forgedRoom.byAccount[fhsa.id].room = { status: 'known', value: 999999 }
    expect(annualStep(canonical, forgedRoom, providers(110)).status).toBe('invalid')
  })

  it('anchors base-year account, owned-property, debt, and contribution-history facts to the plan', () => {
    const canonical = plan({ ...input(), principalResidence: { value: 200000, appreciation: .05, sellAtAge: null } })
    const owned = canonical.properties[0]
    owned.acb = { status: 'known', value: 150000 }
    const account = canonical.accounts.find(item => item.kind === 'nonReg')!
    account.acb = { status: 'known', value: 12 }
    canonical.contributions = [{ id: 'past:tfsa', accountId: canonical.accounts[0].id,
      contributorId: canonical.people[0].id, calendarYear: 2025, amount: 5, deductionYear: null,
      provenance: { origin: 'user', sourceYear: 2025 } }]
    const opening = ok(initializeState(canonical))
    const mutations: Array<[string, (snapshot: typeof opening) => void]> = [
      ['account balance', snapshot => { snapshot.byAccount[canonical.accounts[0].id].balance = 200 }],
      ['account ACB', snapshot => { snapshot.byAccount[account.id].acb = { status: 'known', value: 100 } }],
      ['property value', snapshot => { snapshot.byProperty[owned.id].value = 400000 }],
      ['property ACB', snapshot => { snapshot.byProperty[owned.id].acb = { status: 'known', value: 250000 } }],
      ['debt principal', snapshot => { snapshot.byDebt.loan.principal = 0 }],
      ['debt payment', snapshot => { snapshot.byDebt.loan.annualPayment = 20 }],
      ['debt term', snapshot => { snapshot.byDebt.loan.yearsRemaining = 2 }],
      ['debt property link', snapshot => { snapshot.byDebt.loan.propertyId = owned.id }],
      ['contribution history', snapshot => { snapshot.contributionHistory = [] }],
      ['unfunded event', snapshot => { snapshot.unfundedEvents = [{ eventId: 'fake', field: 'debt', amount: 1, reason: 'downPayment' }] }],
    ]
    for (const [name, mutate] of mutations) {
      const forged = structuredClone(opening)
      mutate(forged)
      expect(projectFromState(canonical, forged, 0, providers(120)), name).toMatchObject({ status: 'invalid' })
      expect(annualStep(canonical, forged, providers(120)), name).toMatchObject({ status: 'invalid' })
    }
    expect(sumNetWorth(opening)).toBe(200090)
    expect(ok(projectFromState(canonical, opening, 0, providers(120))).state).toEqual(opening)
  })

  it('resumes a legitimately changed later-year snapshot after growth, contributions, and debt amortization', () => {
    const canonical = plan({ ...input(), principalResidence: { value: 200000, appreciation: .05, sellAtAge: null },
      savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 }, inflation: 0 })
    const opening = ok(initializeState(canonical))
    const first = ok(annualStep(canonical, opening, providers(120)))
    const nonReg = canonical.accounts.find(account => account.kind === 'nonReg')!
    expect(first.state.byAccount[nonReg.id].balance).not.toBe(nonReg.balance)
    expect(first.state.byAccount[nonReg.id].acb).not.toEqual(nonReg.acb)
    expect(first.state.byProperty[canonical.properties[0].id].value).not.toBe(canonical.properties[0].value)
    expect(first.state.byDebt.loan.principal).not.toBe(canonical.debts[0].principal)
    expect(ok(projectFromState(canonical, first.state, 0, providers(110))).state).toEqual(first.state)
    expect(annualStep(canonical, first.state, providers(110)).status).toBe('ok')
    const staticForgeries: Array<(snapshot: typeof first.state) => void> = [
      snapshot => { snapshot.byPerson[canonical.people[0].id].retirementAge = 99 },
      snapshot => { snapshot.byDebt.loan.annualPayment = 0 },
      snapshot => { snapshot.byDebt.loan.propertyId = canonical.properties[0].id },
      snapshot => { snapshot.byProperty[canonical.properties[0].id].acb = { status: 'known', value: 1 } },
    ]
    for (const mutate of staticForgeries) {
      const forged = structuredClone(first.state)
      mutate(forged)
      expect(projectFromState(canonical, forged, 0, providers(110)).status).toBe('invalid')
      expect(annualStep(canonical, forged, providers(110)).status).toBe('invalid')
    }
  })

  it('withholds work-year projections needing registered account minimums or age-71 conversions', () => {
    const older = (age: number) => plan({ ...input(), currentAge: age, fireAge: 80, lifeExpectancy: 90,
      annualSavings: 0, debts: [], balances: { tfsa: 0, rrsp: 100000, nonReg: 0 },
      savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 } })
    const cases: Array<[string, InputsV2, string]> = [
      ['RRIF minimum while working', (() => { const p = older(72); const a = p.accounts.find(a => a.kind === 'rrsp')!; a.kind = 'rrif'; a.openedYear = { status: 'known', value: 2020 }; return p })(), 'RRIF'],
      ['LIF minimum while working', (() => { const p = older(72); p.accounts.find(a => a.kind === 'rrsp')!.kind = 'lif'; return p })(), 'LIF'],
      ['RRSP at 71', older(71), 'RRSP'],
      ['spousal RRSP at 71', (() => { const p = older(71); p.accounts.find(a => a.kind === 'rrsp')!.kind = 'spousalRrsp'; return p })(), 'RRSP'],
      ['LIRA at 71', (() => { const p = older(71); p.accounts.find(a => a.kind === 'rrsp')!.kind = 'lira'; return p })(), 'LIRA'],
      ['FHSA at 71', (() => { const p = older(71); const a = p.accounts.find(a => a.kind === 'rrsp')!; a.balance = 0; const fhsa = structuredClone(a); fhsa.id = 'older:fhsa'; fhsa.kind = 'fhsa'; fhsa.balance = 1000; fhsa.openedYear = { status: 'known', value: 2025 }; p.accounts.push(fhsa); return p })(), 'FHSA'],
      ['FHSA at 72', (() => { const p = older(72); const a = p.accounts.find(a => a.kind === 'rrsp')!; a.balance = 0; const fhsa = structuredClone(a); fhsa.id = 'older:fhsa'; fhsa.kind = 'fhsa'; fhsa.balance = 1000; fhsa.openedYear = { status: 'known', value: 2025 }; p.accounts.push(fhsa); return p })(), 'FHSA'],
    ]
    for (const [name, canonical, capability] of cases) {
      const opening = ok(initializeState(canonical))
      const evaluate = vi.fn(providers(70).evaluate)
      expect(annualStep(canonical, opening, { evaluate, returns: () => 0 }), name).toMatchObject({ status: 'unsupported', issues: [{ detail: expect.stringContaining(capability) }] })
      expect(evaluate, name).not.toHaveBeenCalled()
      expect(opening.year).toBe(canonical.baseYear)
    }
  })

  it('uses account-owner age and allows empty older accounts and younger working accumulation', () => {
    const couple = plan({ ...input(), currentAge: 40, fireAge: 80, lifeExpectancy: 90, annualSavings: 0,
      debts: [], balances: { tfsa: 0, rrsp: 100000, nonReg: 0 }, savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 },
      partner: { currentAge: 72, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 } })
    const partner = couple.people.find(person => person.role === 'partner')!
    const self = couple.people.find(person => person.role === 'self')!
    const account = couple.accounts.find(account => account.kind === 'rrsp')!
    for (const item of couple.accounts) {
      item.ownerId = self.id
      item.taxableOwnerShares = { status: 'known', shares: { [self.id]: 1 } }
    }
    account.ownerId = partner.id
    account.taxableOwnerShares = { status: 'known', shares: { [partner.id]: 1 } }
    expect(annualStep(couple, ok(initializeState(couple)), { ...providers(70), returns: () => 0 }).status).toBe('unsupported')
    account.balance = 0
    expect(annualStep(couple, ok(initializeState(couple)), { ...providers(70), returns: () => 0 }).status).toBe('ok')
    const young = plan({ ...input(), debts: [] })
    expect(annualStep(young, ok(initializeState(young)), providers(110)).status).toBe('ok')
  })

  it('blocks an age-71 RRSP contribution even when its opening balance is zero', () => {
    const canonical = plan({ ...input(), currentAge: 71, fireAge: 80, lifeExpectancy: 90, debts: [],
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, savingsSplit: { tfsa: 0, rrsp: 1, nonReg: 0 } })
    const opening = ok(initializeState(canonical))
    expect(annualStep(canonical, opening, providers(110))).toMatchObject({ status: 'unsupported', issues: [{ detail: expect.stringContaining('RRSP') }] })
  })

  it('settles only sub-cent final loan residue and resumes after a twenty-year payoff', () => {
    const canonical = plan({ ...input(), fireAge: 80, lifeExpectancy: 90, inflation: 0,
      annualSavings: 40, balances: { tfsa: 0, rrsp: 0, nonReg: 0 },
      savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 },
      debts: [{ id: 'longLoan', kind: 'carLoan', balance: 200000, annualPayment: 15000, yearsRemaining: 20 }] })
    const evaluate: AnnualProviders['evaluate'] = ({ state }) => {
      const income = state.year < canonical.baseYear + 20 ? 15040 : 40
      return { byPerson: { [canonical.people[0].id]: { income, earnedIncome: income,
        benefits: 0, tax: 0, spending: 0, taxableIncome: income,
        benefitIncomeForNextYear: { status: 'unknown', reason: 'not supplied' } } } }
    }
    const supplied = { evaluate, returns: () => 0 }
    const opening = ok(initializeState(canonical))
    const beforeFinal = ok(projectFromState(canonical, opening, 19, supplied))
    expect(beforeFinal.state.byDebt.longLoan.yearsRemaining).toBe(1)
    const lastDebt = beforeFinal.state.byDebt.longLoan
    const accrued = lastDebt.principal * (1 + impliedRate(lastDebt.principal, lastDebt.annualPayment, lastDebt.yearsRemaining))
    expect(accrued - Math.min(lastDebt.annualPayment, accrued)).toBeGreaterThan(0)
    expect(accrued - Math.min(lastDebt.annualPayment, accrued)).toBeLessThan(0.005)
    const final = ok(annualStep(canonical, beforeFinal.state, supplied))
    expect(final.row.cashLedger.debtPayments).toBeCloseTo(15000, 8)
    expect(final.row.cashLedger.voluntaryContributions).toBe(40)
    expect(final.row.cashLedger.income - final.row.cashLedger.debtPayments).toBeCloseTo(40, 8)
    expect(final.state.byDebt.longLoan).toMatchObject({ principal: 0, yearsRemaining: 0 })
    expect(ok(projectFromState(canonical, final.state, 0, supplied)).state).toEqual(final.state)
    expect(annualStep(canonical, final.state, supplied).status).toBe('ok')
    const stillOwed = structuredClone(beforeFinal.state)
    stillOwed.byDebt.longLoan.principal = stillOwed.byDebt.longLoan.annualPayment + 0.01
    expect(annualStep(canonical, stillOwed, supplied).status).toBe('invalid')
    expect(beforeFinal.state.byDebt.longLoan.yearsRemaining).toBe(1)
  })

  it('samples every account return from one settled snapshot regardless of split, order, or provider mutation', () => {
    const make = (tfsa: number, rrsp: number) => plan({ ...input(), debts: [], annualSavings: 0,
      savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 }, balances: { tfsa, rrsp, nonReg: 0 },
      returns: { tfsa: 0, rrsp: 0, nonReg: 0 } })
    const evaluate: AnnualProviders['evaluate'] = ({ state }) => ({ byPerson: Object.fromEntries(Object.keys(state.byPerson).map(id => [id, {
      income: 0, earnedIncome: 0, benefits: 0, tax: 0, spending: 0, taxableIncome: 0,
      benefitIncomeForNextYear: { status: 'unknown' as const, reason: 'not supplied' },
    }])) })
    const run = (canonical: InputsV2) => {
      const opening = ok(initializeState(canonical))
      const seenTotals: number[] = []
      const returns: AnnualProviders['returns'] = context => {
        const total = sumInvestableAssets(context.state)
        seenTotals.push(total)
        for (const account of Object.values(context.state.byAccount)) account.balance = 999999
        return total <= 205 ? .1 : .2
      }
      const result = ok(annualStep(canonical, opening, { evaluate, returns }))
      expect(seenTotals).toEqual([200, 200, 200])
      expect(sumInvestableAssets(opening)).toBe(200)
      return result
    }
    expect(sumInvestableAssets(run(make(200, 0)).state)).toBeCloseTo(220, 8)
    const split = run(make(100, 100))
    expect(sumInvestableAssets(split.state)).toBeCloseTo(220, 8)
    expect(Object.values(split.row.byAccount).map(row => row.returnAmount).sort((a, b) => a - b)).toEqual([0, 10, 10])
    const ordered = make(50, 150)
    const reversed = structuredClone(ordered)
    reversed.accounts.reverse()
    expect(sumInvestableAssets(run(ordered).state)).toBeCloseTo(220, 8)
    expect(sumInvestableAssets(run(reversed).state)).toBeCloseTo(220, 8)
    const invalid = make(100, 100)
    const opening = ok(initializeState(invalid))
    expect(annualStep(invalid, opening, { evaluate, returns: (_context, id) => id === invalid.accounts[1].id ? Number.NaN : .1 }).status).toBe('invalid')
    expect(sumInvestableAssets(opening)).toBe(200)
  })
})

/** Cash, tax and spending chosen so evaluated household cash equals the
 * savings budget; the total is split evenly so a couple still sums to cash. */
const cashProviders = (cash: number, earnedIncome = 0): AnnualProviders => ({
  evaluate: ({ state }) => {
    const ids = Object.keys(state.byPerson)
    return { byPerson: Object.fromEntries(ids.map(id => [id, {
      income: cash / ids.length, earnedIncome, benefits: 0, tax: 0, spending: 0, taxableIncome: cash / ids.length,
      benefitIncomeForNextYear: { status: 'known' as const, value: cash / ids.length },
    }])) }
  },
  returns: () => 0,
})

describe('BE-12 A RRSP room ledger wiring', () => {
  /** CRA statement vector: 20k deduction limit, 5k already contributed but not
   * deducted, so 15k is available; a planned 16k clips to 15k and retains 1k. */
  function clause(overrides: { amount?: number; deductionYear?: number | null; kind?: 'rrsp' | 'spousalRrsp'; cash?: number; scheduleYear?: number } = {}) {
    const canonical = plan({ ...input(), debts: [], inflation: 0, annualSavings: overrides.cash ?? 20000,
      savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 } })
    const self = canonical.people.find(person => person.role === 'self')!
    const rrsp = canonical.accounts.find(account => account.kind === 'rrsp')!
    if (overrides.kind) rrsp.kind = overrides.kind
    self.rrspDeductionLimit = { status: 'known', value: 20000 }
    self.rrspUnusedUndeducted = { status: 'known', value: 5000 }
    self.rrspAvailableRoom = { status: 'unknown', reason: 'available room not typed separately' }
    canonical.contributions = [{
      id: `plan:${self.id}:${overrides.scheduleYear ?? canonical.baseYear}`, accountId: rrsp.id, contributorId: self.id,
      calendarYear: overrides.scheduleYear ?? canonical.baseYear, amount: overrides.amount ?? 16000,
      deductionYear: overrides.deductionYear === undefined ? null : overrides.deductionYear,
      provenance: { origin: 'user', sourceYear: canonical.baseYear },
    }]
    return { canonical, self, rrsp, nonReg: canonical.accounts.find(account => account.kind === 'nonReg')! }
  }

  it('prices an own contribution against known room, clips it and retains the remainder', () => {
    const { canonical, self, rrsp, nonReg } = clause()
    const opening = ok(initializeState(canonical))
    const { state, row } = ok(annualStep(canonical, opening, cashProviders(20000)))
    expect(row.rrspLedger[self.id].openingRoom).toEqual({ status: 'known', value: 15000 })
    expect(row.rrspLedger[self.id].applied).toBe(15000)
    expect(row.rrspLedger[self.id].retained).toBe(1000)
    expect(row.rrspLedger[self.id].closingRoom).toEqual({ status: 'known', value: 0 })
    expect(row.byAccount[rrsp.id].contribution).toBe(15000)
    // 4,000 of the reserved cash that the split did not send to the RRSP plus
    // the clipped 1,000 stay visible in the non-registered account.
    expect(row.byAccount[nonReg.id].contribution).toBe(5000)
    expect(row.cashLedger.retainedContributions).toBe(1000)
    expect(row.cashLedger.voluntaryContributions).toBe(4000)
    expect(state.byPerson[self.id].rrspRoom).toEqual({ status: 'known', value: 0 })
    expect(state.contributionHistory).toContainEqual(expect.objectContaining({ id: 'plan:' + self.id + ':2026', amount: 15000, calendarYear: 2026 }))
    // 100 opening TFSA + 15,000 applied RRSP + 5,000 retained/voluntary nonReg.
    expect(sumInvestableAssets(state)).toBe(20100)
  })

  it('still withholds an unknown room with an explicit reason instead of treating it as zero or unlimited', () => {
    const { canonical, self } = clause()
    self.rrspDeductionLimit = { status: 'unknown', reason: 'CRA statement not supplied' }
    self.rrspUnusedUndeducted = { status: 'unknown', reason: 'CRA statement not supplied' }
    const result = annualStep(canonical, ok(initializeState(canonical)), cashProviders(20000))
    expect(result.status).toBe('unsupported')
    if (result.status !== 'unsupported') throw new Error('expected unsupported')
    expect(result.issues[0].detail).toContain('RRSP room not verified')
    expect(result.issues[0].detail).toContain('CRA statement')
  })

  it('prices a spousal contribution against the contributor room instead of rejecting the spousal shape', () => {
    const canonical = plan({ ...input(), debts: [], inflation: 0, annualSavings: 20000,
      savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 },
      partner: { currentAge: 38, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 } })
    const self = canonical.people.find(person => person.role === 'self')!
    const partner = canonical.people.find(person => person.role === 'partner')!
    for (const account of canonical.accounts) {
      account.ownerId = self.id
      account.taxableOwnerShares = { status: 'known', shares: { [self.id]: 1 } }
    }
    const spousal = canonical.accounts.find(account => account.kind === 'rrsp')!
    spousal.kind = 'spousalRrsp'
    // Statement vector for the contributor: deduction limit 20,000 with 12,000
    // already contributed but not deducted leaves 8,000 of room. The 6,000
    // spousal premium applies in full and leaves 2,000.
    partner.rrspDeductionLimit = { status: 'known', value: 20000 }
    partner.rrspUnusedUndeducted = { status: 'known', value: 12000 }
    partner.rrspAvailableRoom = { status: 'unknown', reason: 'available room not typed separately' }
    canonical.contributions = [{ id: 'spousal-plan', accountId: spousal.id, contributorId: partner.id,
      calendarYear: canonical.baseYear, amount: 6000, deductionYear: null,
      provenance: { origin: 'user', sourceYear: canonical.baseYear } }]
    const { state, row } = ok(annualStep(canonical, ok(initializeState(canonical)), cashProviders(20000)))
    expect(row.rrspLedger[partner.id].applied).toBe(6000)
    expect(row.rrspLedger[partner.id].retained).toBe(0)
    expect(row.rrspLedger[partner.id].closingRoom).toEqual({ status: 'known', value: 2000 })
    expect(state.byPerson[partner.id].rrspRoom).toEqual({ status: 'known', value: 2000 })
    // The annuitant pays no room for the spouse's premium.
    expect(row.rrspLedger[self.id].planned).toBe(0)
    expect(row.byAccount[spousal.id].contribution).toBe(6000)
    expect(state.contributionHistory).toContainEqual(expect.objectContaining({
      id: 'spousal-plan', accountId: spousal.id, contributorId: partner.id, amount: 6000, calendarYear: canonical.baseYear,
    }))
  })

  it('still refuses a spousal premium whose plan holder or contributor is not recorded', () => {
    const spousalClause = (mutate: (plan: InputsV2) => void) => {
      const canonical = plan({ ...input(), debts: [], inflation: 0, annualSavings: 20000,
        savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 },
        partner: { currentAge: 38, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 } })
      const self = canonical.people.find(person => person.role === 'self')!
      const partner = canonical.people.find(person => person.role === 'partner')!
      for (const account of canonical.accounts) {
        account.ownerId = self.id
        account.taxableOwnerShares = { status: 'known', shares: { [self.id]: 1 } }
      }
      const spousal = canonical.accounts.find(account => account.kind === 'rrsp')!
      spousal.kind = 'spousalRrsp'
      canonical.contributions = [{ id: 'spousal-plan', accountId: spousal.id, contributorId: partner.id,
        calendarYear: canonical.baseYear, amount: 6000, deductionYear: null,
        provenance: { origin: 'user', sourceYear: canonical.baseYear } }]
      mutate(canonical)
      return canonical
    }
    // A contributor that is not the holder is only supported on a spousal plan.
    const plain = spousalClause(draft => { draft.accounts.find(account => account.kind === 'spousalRrsp')!.kind = 'rrsp' })
    expect(annualStep(plain, ok(initializeState(plain)), cashProviders(20000))).toMatchObject({
      status: 'unsupported', issues: [{ detail: expect.stringContaining('contributor differs from the account owner') }],
    })
    // An unrecorded contributor stays unknown, never inferred from ownership.
    const noContributor = spousalClause(draft => { draft.contributions[0].contributorId = null })
    expect(annualStep(noContributor, ok(initializeState(noContributor)), cashProviders(20000))).toMatchObject({
      status: 'unsupported', issues: [{ detail: expect.stringContaining('contributor not recorded') }],
    })
  })

  it('keeps the couple voluntary-split RRSP path explicitly unsupported', () => {
    const couple = plan({ ...input(), debts: [], inflation: 0, annualSavings: 20000,
      savingsSplit: { tfsa: 0, rrsp: 1, nonReg: 0 },
      partner: { currentAge: 38, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 } })
    const self = couple.people.find(person => person.role === 'self')!
    for (const account of couple.accounts) {
      account.ownerId = self.id
      account.taxableOwnerShares = { status: 'known', shares: { [self.id]: 1 } }
    }
    expect(annualStep(couple, ok(initializeState(couple)), cashProviders(20000))).toMatchObject({
      status: 'unsupported', issues: [{ detail: expect.stringContaining('couple RRSP contributor') }],
    })
  })

  it('does not invent room from a high current income when last year was zero and no statement exists', () => {
    const canonical = plan({ ...input(), debts: [], inflation: 0, annualSavings: 30000, savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 } })
    const self = canonical.people.find(person => person.role === 'self')!
    self.previousYearEarnedIncome = { status: 'known', value: 0 }
    self.rrspDeductionLimit = { status: 'unknown', reason: 'CRA statement not supplied' }
    self.rrspAvailableRoom = { status: 'unknown', reason: 'CRA statement not supplied' }
    self.rrspUnusedUndeducted = { status: 'unknown', reason: 'CRA statement not supplied' }
    const rrsp = canonical.accounts.find(account => account.kind === 'rrsp')!
    canonical.contributions = [{ id: 'hopeful', accountId: rrsp.id, contributorId: self.id, calendarYear: canonical.baseYear,
      amount: 10000, deductionYear: null, provenance: { origin: 'user', sourceYear: canonical.baseYear } }]
    const result = annualStep(canonical, ok(initializeState(canonical)), cashProviders(30000, 200000))
    expect(result.status).toBe('unsupported')
    if (result.status !== 'unsupported') throw new Error('expected unsupported')
    expect(result.issues[0].detail).toContain('RRSP room not verified')
  })

  it('lets a person with no salary contribute from a carried-forward statement room', () => {
    const { canonical, self, rrsp } = clause({ amount: 3000 })
    self.previousYearEarnedIncome = { status: 'known', value: 0 }
    const { row } = ok(annualStep(canonical, ok(initializeState(canonical)), cashProviders(20000, 0)))
    expect(row.rrspLedger[self.id].applied).toBe(3000)
    expect(row.byAccount[rrsp.id].contribution).toBe(3000)
    expect(row.rrspLedger[self.id].closingRoom).toEqual({ status: 'known', value: 12000 })
  })

  it('records a later deduction year without changing the year the room is used', () => {
    const { canonical, self, rrsp } = clause({ amount: 4000, deductionYear: 2027 })
    const { state, row } = ok(annualStep(canonical, ok(initializeState(canonical)), cashProviders(20000)))
    expect(row.rrspLedger[self.id].deductedThisYear).toBe(0)
    expect(row.rrspLedger[self.id].deferredDeduction).toBe(4000)
    expect(row.byAccount[rrsp.id].contribution).toBe(4000)
    expect(state.byPerson[self.id].rrspRoom).toEqual({ status: 'known', value: 11000 })
  })

  it('refuses a contribution whose deduction year precedes it rather than guessing the first-60-days rule', () => {
    const { canonical } = clause({ amount: 4000, deductionYear: 2025 })
    expect(annualStep(canonical, ok(initializeState(canonical)), cashProviders(20000))).toMatchObject({
      status: 'unsupported', issues: [{ detail: expect.stringContaining('first-60-days') }],
    })
  })

  it('marks a later year unsupported because no sourced room-addition rule exists', () => {
    const { canonical, self } = clause({ amount: 0, scheduleYear: 2026 })
    canonical.contributions = []
    const first = ok(annualStep(canonical, ok(initializeState(canonical)), cashProviders(20000)))
    expect(first.state.byPerson[self.id].rrspRoom).toEqual({ status: 'known', value: 15000 })
    const rrsp = canonical.accounts.find(account => account.kind === 'rrsp')!
    canonical.contributions = [{ id: 'next-year', accountId: rrsp.id, contributorId: self.id, calendarYear: 2027,
      amount: 5000, deductionYear: null, provenance: { origin: 'user', sourceYear: 2027 } }]
    const second = annualStep(canonical, first.state, cashProviders(20000))
    expect(second.status).toBe('unsupported')
    if (second.status !== 'unsupported') throw new Error('expected unsupported')
    expect(second.issues[0].detail).toContain('18% of prior-year earned income')
  })

  it('carries closing room into the next snapshot without double counting a continuation', () => {
    const { canonical, self, rrsp } = clause({ amount: 5000 })
    const opening = ok(initializeState(canonical))
    const first = ok(annualStep(canonical, opening, cashProviders(20000)))
    expect(first.state.byPerson[self.id].rrspRoom).toEqual({ status: 'known', value: 10000 })
    expect(first.row.rrspLedger[self.id].closingRoom).toEqual(first.state.byPerson[self.id].rrspRoom)
    const resumed = ok(projectFromState(canonical, first.state, 0, cashProviders(20000)))
    expect(resumed.state).toEqual(first.state)
    const again = ok(annualStep(canonical, first.state, cashProviders(20000)))
    expect(again.row.rrspLedger[self.id].planned).toBe(0)
    // opening(year + 1) is exactly closing(year); the next closing is unknown
    // only because no sourced room-addition rule exists for 2027.
    expect(again.row.rrspLedger[self.id].openingRoom).toEqual(first.row.rrspLedger[self.id].closingRoom)
    expect(again.row.rrspLedger[self.id].closingRoom.status).toBe('unknown')
    expect(again.state.byAccount[rrsp.id].balance).toBe(first.state.byAccount[rrsp.id].balance)
  })

  it('rejects a base-year snapshot that forges a statement fact', () => {
    const { canonical, self } = clause()
    const opening = ok(initializeState(canonical))
    const forgeries: Array<(snapshot: typeof opening) => void> = [
      snapshot => { snapshot.byPerson[self.id].rrspDeductionLimit = { status: 'known', value: 1 } },
      snapshot => { snapshot.byPerson[self.id].rrspUnusedUndeducted = { status: 'known', value: 1 } },
      snapshot => { snapshot.byPerson[self.id].rrspPensionAdjustment = { status: 'known', value: 1 } },
      snapshot => { snapshot.byPerson[self.id].rrspPspa = { status: 'known', value: 1 } },
      snapshot => { snapshot.byPerson[self.id].rrspPar = { status: 'known', value: 1 } },
    ]
    for (const mutate of forgeries) {
      const forged = structuredClone(opening)
      mutate(forged)
      expect(projectFromState(canonical, forged, 0, cashProviders(20000)).status).toBe('invalid')
      expect(annualStep(canonical, forged, cashProviders(20000)).status).toBe('invalid')
    }
  })

  it('prices each partner against their own room and their own contributor', () => {
    const canonical = plan({ ...input(), debts: [], inflation: 0, annualSavings: 20000,
      savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 },
      partner: { currentAge: 38, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 } })
    const self = canonical.people.find(person => person.role === 'self')!
    const partner = canonical.people.find(person => person.role === 'partner')!
    const base = canonical.accounts.find(account => account.kind === 'rrsp')!
    for (const account of canonical.accounts) {
      account.ownerId = self.id
      account.taxableOwnerShares = { status: 'known', shares: { [self.id]: 1 } }
    }
    const partnerRrsp = { ...structuredClone(base), id: `${base.id}:partner`, ownerId: partner.id, balance: 0,
      taxableOwnerShares: { status: 'known' as const, shares: { [partner.id]: 1 } } }
    canonical.accounts.push(partnerRrsp)
    self.rrspAvailableRoom = { status: 'known', value: 10000 }
    partner.rrspAvailableRoom = { status: 'known', value: 4000 }
    canonical.contributions = [
      { id: 'self-plan', accountId: base.id, contributorId: self.id, calendarYear: canonical.baseYear, amount: 8000, deductionYear: null, provenance: { origin: 'user', sourceYear: canonical.baseYear } },
      { id: 'partner-plan', accountId: partnerRrsp.id, contributorId: partner.id, calendarYear: canonical.baseYear, amount: 6000, deductionYear: null, provenance: { origin: 'user', sourceYear: canonical.baseYear } },
    ]
    const { state, row } = ok(annualStep(canonical, ok(initializeState(canonical)), cashProviders(20000)))
    expect(row.rrspLedger[self.id].applied).toBe(8000)
    expect(row.rrspLedger[self.id].retained).toBe(0)
    expect(row.rrspLedger[partner.id].applied).toBe(4000)
    expect(row.rrspLedger[partner.id].retained).toBe(2000)
    expect(state.byPerson[self.id].rrspRoom).toEqual({ status: 'known', value: 2000 })
    expect(state.byPerson[partner.id].rrspRoom).toEqual({ status: 'known', value: 0 })
    expect(row.byAccount[base.id].contribution).toBe(8000)
    expect(row.byAccount[partnerRrsp.id].contribution).toBe(4000)
    // 6,000 voluntary nonReg + the partner's clipped 2,000 retained in nonReg.
    const nonReg = canonical.accounts.find(account => account.kind === 'nonReg')!
    expect(row.byAccount[nonReg.id].contribution).toBe(8000)
    expect(row.cashLedger.retainedContributions).toBe(2000)
  })

  it('reports a scheduled contribution the year cannot fund as unsupported, not a conservation error', () => {
    const { canonical } = clause({ amount: 16000, cash: 1000 })
    expect(annualStep(canonical, ok(initializeState(canonical)), cashProviders(1000))).toMatchObject({
      status: 'unsupported', issues: [{ detail: expect.stringContaining('exceeds the year net savings') }],
    })
  })
})

/**
 * BE-36 A: the kernel prices the supported FHSA shape — an owned account with a
 * confirmed statement, contributing within room — and keeps every other shape
 * explicitly unsupported.
 */
describe('BE-36 A FHSA participation room in the annual kernel', () => {
  /**
   * The legacy form is what materialises an FHSA account and its recurring
   * contribution, so `annualContribution` is part of the savings budget the
   * kernel checks. The canonical statement facts are patched on afterwards,
   * exactly as the panel writes them.
   */
  const fhsaPlan = (args: { cash: number; annualFhsa: number; cumulative?: number; openedYear?: number; history?: boolean }) => {
    const canonical = plan({
      ...input(), inflation: 0, debts: [], annualSavings: args.cash,
      savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 },
      fhsa: { balance: 0, annualContribution: args.annualFhsa, openedYearsAgo: 0 },
    } as Inputs)
    const person = canonical.people[0]
    const account = canonical.accounts.find(item => item.kind === 'fhsa')!
    account.ownerId = person.id
    account.taxableOwnerShares = { status: 'known', shares: { [person.id]: 1 } }
    account.openedYear = { status: 'known', value: args.openedYear ?? 2026 }
    account.contributionRoom = { status: 'known', value: 0 }
    if (args.history !== false) canonical.fhsaStatementHistory = {
      [account.id]: {
        cumulativePriorContributions: { status: 'known', value: args.cumulative ?? 0 },
        provenance: { origin: 'user', sourceYear: 2026 },
      },
    }
    return { canonical, person, account }
  }

  /** Evaluated cash equals the plan's savings budget when spending is income less cash. */
  const budgetProviders = (cash: number): AnnualProviders => ({
    evaluate: ({ state }) => ({ byPerson: Object.fromEntries(Object.keys(state.byPerson).map(id => [id, {
      income: cash * 2, earnedIncome: cash * 2, benefits: 0, tax: 0, spending: cash, taxableIncome: cash * 2,
      benefitIncomeForNextYear: { status: 'known' as const, value: cash * 2 },
    }])) }),
    returns: () => 0,
  })

  it('executes a contribution inside the published annual limit and retains nothing', () => {
    const { canonical, person, account } = fhsaPlan({ cash: 10000, annualFhsa: 6000 })
    const first = ok(annualStep(canonical, ok(initializeState(canonical)), budgetProviders(10000)))
    const ledger = first.row.fhsaLedger[person.id]
    expect(ledger.ordinaryPlanned).toBe(6000)
    expect(ledger.applied).toBe(6000)
    expect(ledger.retained).toBe(0)
    // 8,000 of published room less the 6,000 contribution leaves 2,000.
    expect(ledger.closingRoom).toEqual({ status: 'known', value: 2000 })
    expect(ledger.remainingLifetimeRoom).toEqual({ status: 'known', value: 34000 })
    expect(first.row.byAccount[account.id].contribution).toBe(6000)
    expect(first.row.cashLedger.fhsaContributions).toBe(6000)
    expect(first.row.cashLedger.retainedContributions).toBe(0)
    // The account's own `contributionRoom` column is the statement's carry-in,
    // not a running balance the ledger writes back.
    expect(account.contributionRoom).toEqual({ status: 'known', value: 0 })
  })

  it('clips a 22,000 plan against the 8,000 annual limit and retains 14,000', () => {
    const { canonical, person, account } = fhsaPlan({ cash: 22000, annualFhsa: 22000 })
    const first = ok(annualStep(canonical, ok(initializeState(canonical)), budgetProviders(22000)))
    const ledger = first.row.fhsaLedger[person.id]
    expect(ledger.ordinaryPlanned).toBe(22000)
    expect(ledger.applied).toBe(8000)
    expect(ledger.retained).toBe(14000)
    expect(ledger.limitations.map(item => item.code)).toContain('annualCapped')
    // The clipped remainder is retained in non-registered, never deleted.
    expect(first.row.cashLedger.retainedContributions).toBe(14000)
    expect(first.row.byAccount[account.id].contribution).toBe(8000)
    const nonReg = canonical.accounts.find(item => item.kind === 'nonReg')!.id
    expect(first.row.byAccount[nonReg].contribution).toBe(14000)
  })

  it('carries opening(y+1) = closing(y) through two projected years', () => {
    const { canonical, person, account } = fhsaPlan({ cash: 3000, annualFhsa: 3000 })
    const two = ok(projectFromState(canonical, ok(initializeState(canonical)), 2, budgetProviders(3000)))
    const [first, second] = two.rows.map(row => row.fhsaLedger[person.id])
    // Year 1 contributes 3,000 of the 8,000 available, leaving 5,000 unused.
    expect(first.applied).toBe(3000)
    expect(first.closingRoom).toEqual({ status: 'known', value: 5000 })
    // Year 2 opens at exactly year 1's closing room and adds 8,000 more.
    expect(second.openingRoom).toEqual({ status: 'known', value: 5000 })
    expect(second.annualAddition).toEqual({ status: 'known', value: 8000 })
    expect(second.applied).toBe(3000)
    expect(second.closingRoom).toEqual({ status: 'known', value: 10000 })
    expect(second.cumulativeContributions).toEqual({ status: 'known', value: 6000 })
    expect(two.rows[1].byAccount[account.id].contribution).toBe(3000)
  })

  it('refuses an FHSA with unknown statement history instead of assuming room', () => {
    const { canonical, person } = fhsaPlan({ cash: 10000, annualFhsa: 6000 })
    delete canonical.fhsaStatementHistory
    const result = annualStep(canonical, ok(initializeState(canonical)), budgetProviders(10000))
    expect(result.status).toBe('unsupported')
    if (result.status !== 'unsupported') throw new Error('expected unsupported')
    expect(result.issues[0].detail).toContain(FHSA_HISTORY_MISSING)
    expect(result.issues[0].detail).toContain(person.id)
  })

  it('refuses an older account whose carry-in room is not recorded, instead of assuming a full year', () => {
    const { canonical, account } = fhsaPlan({ cash: 10000, annualFhsa: 6000, openedYear: 2020 })
    // A prior-year account needs the statement's unused-room figure; nothing
    // else in the plan can produce it, so an unsupplied one is unknown.
    account.contributionRoom = { status: 'unknown', reason: 'participation-room statement not supplied' }
    const result = annualStep(canonical, ok(initializeState(canonical)), budgetProviders(10000))
    expect(result.status).toBe('unsupported')
    if (result.status !== 'unsupported') throw new Error('expected unsupported')
    expect(result.issues[0].detail).toContain('FHSA participation room not verified')
    expect(result.issues[0].detail).toContain('participation-room statement not supplied')
  })

  it('prices a recorded carry-in room for an older account and carries it forward', () => {
    const { canonical, account } = fhsaPlan({ cash: 10000, annualFhsa: 6000, openedYear: 2020 })
    account.contributionRoom = { status: 'known', value: 4000 }
    const first = ok(annualStep(canonical, ok(initializeState(canonical)), budgetProviders(10000)))
    // The statement's 4,000 of prior unused room plus the year's 8,000 is
    // 12,000; the 6,000 plan executes and 6,000 carries into next year.
    const ledger = first.row.fhsaLedger[canonical.people[0].id]
    expect(ledger.openingRoom).toEqual({ status: 'known', value: 4000 })
    expect(ledger.annualAddition).toEqual({ status: 'known', value: 8000 })
    expect(ledger.applied).toBe(6000)
    expect(ledger.closingRoom).toEqual({ status: 'known', value: 6000 })
  })

  it('refuses the 15-year maturity clock instead of rolling the balance into the RRSP', () => {
    const { canonical } = fhsaPlan({ cash: 10000, annualFhsa: 6000, openedYear: 2011 })
    const result = annualStep(canonical, ok(initializeState(canonical)), budgetProviders(10000))
    expect(result.status).toBe('unsupported')
    if (result.status !== 'unsupported') throw new Error('expected unsupported')
    // The kernel already refuses the rollover before the ledger; either way the
    // maturity path is explicit and nothing is rolled over.
    expect(result.issues[0].detail).toMatch(/15-year|maturity|rollover/)
  })

  it('prices a lifetime-exhausted account at zero room and retains the whole plan', () => {
    // 38,000 of prior contributions leaves 2,000 of lifetime room, so the year
    // adds 2,000 rather than the published 8,000 and keeps 4,000 back.
    const { canonical, person } = fhsaPlan({ cash: 6000, annualFhsa: 6000, cumulative: 38000, openedYear: 2020 })
    const first = ok(annualStep(canonical, ok(initializeState(canonical)), budgetProviders(6000)))
    const ledger = first.row.fhsaLedger[person.id]
    expect(ledger.annualAddition).toEqual({ status: 'known', value: 2000 })
    expect(ledger.applied).toBe(2000)
    expect(ledger.retained).toBe(4000)
    expect(ledger.remainingLifetimeRoom).toEqual({ status: 'known', value: 0 })
    expect(first.row.cashLedger.retainedContributions).toBe(4000)
  })

  it('still refuses a scheduled FHSA row whose contributor is not recorded', () => {
    const { canonical, person, account } = fhsaPlan({ cash: 10000, annualFhsa: 0 })
    canonical.contributions.push({
      id: 'other-contributor', accountId: account.id, contributorId: null, calendarYear: 2026, amount: 10, deductionYear: null,
      provenance: { origin: 'user', sourceYear: 2026 },
    })
    const result = annualStep(canonical, ok(initializeState(canonical)), budgetProviders(10000))
    expect(result.status).toBe('unsupported')
    if (result.status !== 'unsupported') throw new Error('expected unsupported')
    expect(result.issues[0].detail).toContain('scheduled FHSA contributor not recorded')
    expect(person.id).toBe(canonical.people[0].id)
  })

  /**
   * The reviewer's two B1 reproductions, pinned at the kernel level. Every
   * number below is a hand calculation from the published limits.
   */
  it('never lets carried-forward room breach the 40,000 lifetime limit over seven years', () => {
    // First-year FHSA in 2026, confirmed zero statement, 7,000 planned a year,
    // no growth. Before the fix this path reached 42,000 in 2031 and 45,000 in
    // 2032, the last 5,000 being priced after the breach.
    const { canonical, person } = fhsaPlan({ cash: 7000, annualFhsa: 7000 })
    const seven = ok(projectFromState(canonical, ok(initializeState(canonical)), 7, budgetProviders(7000)))
    const ledgers = seven.rows.map(row => row.fhsaLedger[person.id])
    const cumulative = ledgers.map(ledger => {
      if (ledger.cumulativeContributions.status !== 'known') throw new Error('expected known cumulative contributions')
      return ledger.cumulativeContributions.value
    })
    // 7,000 a year until the lifetime ceiling, then nothing: the cap binds.
    expect(cumulative).toEqual([7000, 14000, 21000, 28000, 35000, 40000, 40000])
    for (const total of cumulative) expect(total).toBeLessThanOrEqual(40000)
    // 2031 has 5,000 of lifetime room plus 5,000 carried in; only the lifetime
    // room may execute and 2,000 of the plan is retained.
    expect(ledgers[5].carryForward).toEqual({ status: 'known', value: 5000 })
    expect(ledgers[5].annualAddition).toEqual({ status: 'known', value: 5000 })
    expect(ledgers[5].availableRoom).toEqual({ status: 'known', value: 5000 })
    expect(ledgers[5].applied).toBe(5000)
    expect(ledgers[5].retained).toBe(2000)
    expect(ledgers[5].closingRoom).toEqual({ status: 'known', value: 0 })
    // 2032 is exhausted: nothing is priced and the whole plan is retained.
    expect(ledgers[6].applied).toBe(0)
    expect(ledgers[6].retained).toBe(7000)
    expect(ledgers[6].remainingLifetimeRoom).toEqual({ status: 'known', value: 0 })
  })

  it('caps a 40,000 plan at 8,000 of annual room plus 8,000 of carry-forward', () => {
    // An older account with 32,000 of unused room on the statement. Before the
    // fix the ledger reported 40,000 of room in the year and executed all of it,
    // creating a 24,000 excess FHSA amount the app called legal.
    const { canonical, person, account } = fhsaPlan({ cash: 40000, annualFhsa: 40000, openedYear: 2020 })
    account.contributionRoom = { status: 'known', value: 32000 }
    const first = ok(annualStep(canonical, ok(initializeState(canonical)), budgetProviders(40000)))
    const ledger = first.row.fhsaLedger[person.id]
    expect(ledger.openingRoom).toEqual({ status: 'known', value: 32000 })
    expect(ledger.carryForward).toEqual({ status: 'known', value: 8000 })
    expect(ledger.annualAddition).toEqual({ status: 'known', value: 8000 })
    expect(ledger.availableRoom).toEqual({ status: 'known', value: 16000 })
    expect(ledger.applied).toBe(16000)
    expect(ledger.retained).toBe(24000)
    expect(ledger.closingRoom).toEqual({ status: 'known', value: 0 })
    expect(ledger.limitations.map(item => item.code)).toContain('carryForwardCapped')
    // The 24,000 the room could not execute is retained, never deleted.
    expect(first.row.cashLedger.retainedContributions).toBe(24000)
  })

  it('keeps cumulative contributions at or below the lifetime limit across a long projection', () => {
    const { canonical, person } = fhsaPlan({ cash: 8000, annualFhsa: 8000 })
    const many = ok(projectFromState(canonical, ok(initializeState(canonical)), 10, budgetProviders(8000)))
    let previous = 0
    for (const row of many.rows) {
      const ledger = row.fhsaLedger[person.id]
      if (ledger.cumulativeContributions.status !== 'known') throw new Error('expected known cumulative contributions')
      const cumulative = ledger.cumulativeContributions.value
      expect(cumulative).toBeGreaterThanOrEqual(previous)
      expect(cumulative).toBeLessThanOrEqual(40000)
      // The invariant `closing = carryForward + annualAddition - applied` holds
      // to cents in every year of the run.
      const closing = ledger.closingRoom.status === 'known' ? ledger.closingRoom.value : NaN
      const carryForward = ledger.carryForward.status === 'known' ? ledger.carryForward.value : NaN
      const addition = ledger.annualAddition.status === 'known' ? ledger.annualAddition.value : NaN
      expect(closing).toBeCloseTo(Math.max(0, carryForward + addition - ledger.applied), 6)
      previous = cumulative
    }
    // 2026-2030 execute 8,000 a year; 2031 and later have no lifetime room left.
    expect(previous).toBe(40000)
    expect(many.rows[4].fhsaLedger[person.id].applied).toBe(8000)
    expect(many.rows[5].fhsaLedger[person.id].applied).toBe(0)
    expect(many.rows[5].fhsaLedger[person.id].retained).toBe(8000)
  })

  it('refuses two active FHSAs with a typed reason instead of a conservation failure', () => {
    const { canonical, person, account } = fhsaPlan({ cash: 10000, annualFhsa: 6000 })
    // A second owned FHSA with a balance is active but has no ledger of its own.
    canonical.accounts.push({
      ...account, id: 'fhsa:second', balance: 5000,
      taxableOwnerShares: { status: 'known', shares: { [person.id]: 1 } },
    })
    const result = annualStep(canonical, ok(initializeState(canonical)), budgetProviders(10000))
    expect(result.status).toBe('unsupported')
    if (result.status !== 'unsupported') throw new Error('expected unsupported')
    expect(result.issues[0].detail).toContain(FHSA_MULTIPLE_ACTIVE_ACCOUNTS)
    expect(result.issues[0].detail).toContain('fhsa:second')
    expect(result.issues[0].detail).not.toContain('conservation')
  })

  it('prices the one recorded plan row and never a stale duplicate as well', () => {
    // A plan saved by an earlier build could carry a legacy mirror row next to
    // the recorded row. The recorded row is the plan: pricing both would make
    // the 6,000 plan 14,000 and break cash conservation.
    const { canonical, person, account } = fhsaPlan({ cash: 6000, annualFhsa: 6000 })
    canonical.recurringContributions.push({
      id: 'legacy:contribution:fhsa', accountId: account.id, contributorId: person.id,
      annualAmount: 8000, funding: 'fromSavings', provenance: { origin: 'legacy', sourceYear: null },
    })
    expect(plannedFhsaContribution(canonical, account.id)).toBe(6000)
    const first = ok(annualStep(canonical, ok(initializeState(canonical)), budgetProviders(6000)))
    const ledger = first.row.fhsaLedger[person.id]
    expect(ledger.planned).toBe(6000)
    expect(ledger.applied).toBe(6000)
    expect(ledger.ordinaryPlanned).toBe(6000)
    expect(first.row.byAccount[account.id].contribution).toBe(6000)
    expect(first.row.cashLedger.retainedContributions).toBe(0)
  })

  /**
   * Blocking B-1: a scheduled FHSA row used to be parked in the RRSP ledger's
   * line set, priced as an RRSP contribution, booked into the FHSA account and
   * charged against RRSP room. These two reproductions are the reviewer's exact
   * scenarios, with the numbers hand-calculated from the published limits.
   */
  it('prices a scheduled FHSA row through participation room, never as an RRSP line', () => {
    const { canonical, person, account } = fhsaPlan({ cash: 40000, annualFhsa: 6000 })
    const rrsp = canonical.accounts.find(item => item.kind === 'rrsp')!.id
    const nonReg = canonical.accounts.find(item => item.kind === 'nonReg')!.id
    canonical.contributions.push({
      id: 'sched-fhsa', accountId: account.id, contributorId: person.id, calendarYear: 2026, amount: 2000, deductionYear: null,
      provenance: { origin: 'user', sourceYear: 2026 },
    })
    const first = ok(annualStep(canonical, ok(initializeState(canonical)), budgetProviders(40000)))
    const ledger = first.row.fhsaLedger[person.id]
    // The recorded plan is the account's whole plan, and the scheduled 2,000 is
    // a component of it, so the ledger prices 6,000 rather than 6,000 + 2,000.
    expect(ledger.planned).toBe(6000)
    expect(ledger.applied).toBe(6000)
    expect(ledger.availableRoom).toEqual({ status: 'known', value: 8000 })
    // The scheduled row is not an RRSP line and consumes no RRSP room.
    expect(first.row.rrspLedger[person.id].planned).toBe(0)
    expect(first.row.rrspLedger[person.id].applied).toBe(0)
    expect(first.row.rrspLedger[person.id].lines).toEqual([])
    // The FHSA account receives exactly what the participation ledger applied,
    // the RRSP account nothing, and the untouched budget stays in non-registered.
    expect(first.row.byAccount[account.id].contribution).toBe(6000)
    expect(first.row.byAccount[rrsp].contribution).toBe(0)
    expect(first.row.byAccount[nonReg].contribution).toBe(34000)
    expect(first.row.cashLedger.fhsaContributions).toBe(6000)
    expect(first.row.cashLedger.retainedContributions).toBe(0)
    // Cash is conserved: 6,000 + 34,000 is the year's 40,000 net savings.
    expect(first.row.cashLedger.fhsaContributions + first.row.cashLedger.voluntaryContributions).toBe(40000)
  })

  it('prices a scheduled FHSA row that has no recorded plan through the same ledger', () => {
    const { canonical, person, account } = fhsaPlan({ cash: 40000, annualFhsa: 0 })
    const nonReg = canonical.accounts.find(item => item.kind === 'nonReg')!.id
    canonical.contributions.push({
      id: 'sched-fhsa', accountId: account.id, contributorId: person.id, calendarYear: 2026, amount: 8000, deductionYear: null,
      provenance: { origin: 'user', sourceYear: 2026 },
    })
    const first = ok(annualStep(canonical, ok(initializeState(canonical)), budgetProviders(40000)))
    const ledger = first.row.fhsaLedger[person.id]
    expect(ledger.planned).toBe(8000)
    expect(ledger.applied).toBe(8000)
    expect(first.row.rrspLedger[person.id].planned).toBe(0)
    expect(first.row.byAccount[account.id].contribution).toBe(8000)
    expect(first.row.byAccount[nonReg].contribution).toBe(32000)
    expect(first.row.cashLedger.fhsaContributions).toBe(8000)
    expect(first.row.cashLedger.fhsaContributions + first.row.cashLedger.voluntaryContributions).toBe(40000)
  })

  it('never returns ok while a scheduled FHSA row executes without participation room', () => {
    // The reviewer's worst case: an owned FHSA, no statement history at all, no
    // recorded plan, and a scheduled 8,000 row. Before the fix this returned ok
    // with no FHSA ledger at all, RRSP room consumed and the RRSP ledger applied
    // 8,000 into the FHSA account.
    const { canonical, person, account } = fhsaPlan({ cash: 40000, annualFhsa: 0, history: false })
    canonical.contributions.push({
      id: 'sched-fhsa', accountId: account.id, contributorId: person.id, calendarYear: 2026, amount: 8000, deductionYear: null,
      provenance: { origin: 'user', sourceYear: 2026 },
    })
    const result = annualStep(canonical, ok(initializeState(canonical)), budgetProviders(40000))
    expect(result.status).toBe('unsupported')
    if (result.status !== 'unsupported') throw new Error('expected unsupported')
    expect(result.issues[0].detail).toContain('FHSA participation room not verified')
    expect(result.issues[0].detail).toContain(FHSA_HISTORY_MISSING)
    expect(result.issues[0].detail).toContain(person.id)
  })

  it('keeps each account kind out of the other ledger for several row combinations', () => {
    const { canonical, person, account } = fhsaPlan({ cash: 40000, annualFhsa: 6000 })
    const rrsp = canonical.accounts.find(item => item.kind === 'rrsp')!.id
    const nonReg = canonical.accounts.find(item => item.kind === 'nonReg')!.id
    canonical.contributions.push(
      { id: 'sched-fhsa', accountId: account.id, contributorId: person.id, calendarYear: 2026, amount: 2000, deductionYear: null,
        provenance: { origin: 'user', sourceYear: 2026 } },
      { id: 'sched-rrsp', accountId: rrsp, contributorId: person.id, calendarYear: 2026, amount: 500, deductionYear: null,
        provenance: { origin: 'user', sourceYear: 2026 } },
    )
    const first = ok(annualStep(canonical, ok(initializeState(canonical)), budgetProviders(40000)))
    const fhsaLines = first.row.fhsaLedger[person.id].lines.map(item => item.id)
    const rrspLines = first.row.rrspLedger[person.id].lines.map(item => item.id)
    expect(fhsaLines).toContain('sched-fhsa')
    expect(fhsaLines).not.toContain('sched-rrsp')
    expect(rrspLines).toContain('sched-rrsp')
    expect(rrspLines).not.toContain('sched-fhsa')
    // 6,000 of FHSA room (the scheduled 2,000 is inside the recorded plan),
    // 500 of RRSP room and the remaining 33,500 in non-registered.
    expect(first.row.byAccount[account.id].contribution).toBe(6000)
    expect(first.row.byAccount[rrsp].contribution).toBe(500)
    expect(first.row.byAccount[nonReg].contribution).toBe(33500)
  })

  it('never routes the voluntary RRSP share to the account of a scheduled FHSA row', () => {
    // The scheduled FHSA row used to park an RRSP destination, so the RRSP
    // ledger paid its applied amount into the FHSA account. The two ledgers now
    // keep their own destinations.
    const { canonical, person, account } = fhsaPlan({ cash: 40000, annualFhsa: 0 })
    person.rrspDeductionLimit = { status: 'known', value: 8000 }
    person.rrspUnusedUndeducted = { status: 'known', value: 0 }
    person.rrspAvailableRoom = { status: 'known', value: 8000 }
    canonical.savingsAllocation.shares = { tfsa: 0, rrsp: 1, nonReg: 0 }
    const rrsp = canonical.accounts.find(item => item.kind === 'rrsp')!.id
    canonical.contributions.push({
      id: 'sched-fhsa', accountId: account.id, contributorId: person.id, calendarYear: 2026, amount: 2000, deductionYear: null,
      provenance: { origin: 'user', sourceYear: 2026 },
    })
    const first = ok(annualStep(canonical, ok(initializeState(canonical)), budgetProviders(40000)))
    expect(first.row.fhsaLedger[person.id].applied).toBe(2000)
    // The 38,000 voluntary RRSP share is clipped to its own 8,000 of room.
    expect(first.row.rrspLedger[person.id].planned).toBe(38000)
    expect(first.row.rrspLedger[person.id].applied).toBe(8000)
    expect(first.row.byAccount[account.id].contribution).toBe(2000)
    expect(first.row.byAccount[rrsp].contribution).toBe(8000)
    expect(first.row.byAccount[account.id].contribution).not.toBe(10000)
  })

  it('takes the largest stale row, never their sum, when no recorded plan row exists', () => {
    // N-2: two non-canonical rows used to be added together (8,000 + 6,000 =
    // 14,000), resurrecting the doubling B2 removed.
    const { canonical, person, account } = fhsaPlan({ cash: 14000, annualFhsa: 0 })
    canonical.recurringContributions = canonical.recurringContributions.filter(item => item.accountId !== account.id)
    canonical.recurringContributions.push(
      { id: 'legacy:contribution:fhsa', accountId: account.id, contributorId: person.id, annualAmount: 8000, funding: 'fromSavings', provenance: { origin: 'legacy', sourceYear: null } },
      { id: 'stale:fhsa', accountId: account.id, contributorId: person.id, annualAmount: 6000, funding: 'fromSavings', provenance: { origin: 'legacy', sourceYear: null } },
    )
    expect(plannedFhsaContribution(canonical, account.id)).toBe(8000)
    const first = ok(annualStep(canonical, ok(initializeState(canonical)), budgetProviders(14000)))
    expect(first.row.fhsaLedger[person.id].planned).toBe(8000)
    expect(first.row.fhsaLedger[person.id].applied).toBe(8000)
    expect(first.row.byAccount[account.id].contribution).toBe(8000)
    expect(first.row.cashLedger.fhsaContributions).toBe(8000)
  })

  it('prices nothing and continues when an unconfirmed statement has no planned contribution', () => {
    // N-3: the panel says a blank line prices nothing. A held account with no
    // plan therefore does not have to stop the whole projection; it still stops
    // the moment a contribution would be priced against the unknown room.
    const { canonical, person, account } = fhsaPlan({ cash: 10000, annualFhsa: 0, history: false })
    account.balance = 25000
    const first = ok(annualStep(canonical, ok(initializeState(canonical)), budgetProviders(10000)))
    const ledger = first.row.fhsaLedger[person.id]
    expect(ledger.planned).toBe(0)
    expect(ledger.applied).toBe(0)
    expect(ledger.retained).toBe(0)
    // Unknown stays unknown: it is never read as a full 8,000 or as zero room.
    expect(ledger.availableRoom.status).toBe('unknown')
    expect(ledger.closingRoom.status).toBe('unknown')
    expect(first.row.byAccount[account.id].contribution).toBe(0)
    const recorded = canonical.recurringContributions.find(item => item.id === fhsaPlanRowId(account.id))!
    recorded.annualAmount = 6000
    const refused = annualStep(canonical, ok(initializeState(canonical)), budgetProviders(10000))
    expect(refused.status).toBe('unsupported')
    if (refused.status !== 'unsupported') throw new Error('expected unsupported')
    expect(refused.issues[0].detail).toContain(FHSA_HISTORY_MISSING)
  })

  it('refuses a couple whose two FHSAs are each active with the typed reason', () => {
    const canonical = plan({
      ...input(), inflation: 0, debts: [], annualSavings: 20000,
      savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 },
      partner: { currentAge: 38, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
      fhsa: { balance: 0, annualContribution: 0, openedYearsAgo: 0 },
    } as Inputs)
    const [self, partner] = canonical.people
    for (const item of canonical.accounts) {
      item.ownerId = self.id
      item.taxableOwnerShares = { status: 'known', shares: { [self.id]: 1 } }
    }
    const account = canonical.accounts.find(item => item.kind === 'fhsa')!
    account.openedYear = { status: 'known', value: 2026 }
    account.contributionRoom = { status: 'known', value: 0 }
    const partnerAccount = structuredClone(account)
    partnerAccount.id = 'fhsa:partner'
    partnerAccount.ownerId = partner.id
    partnerAccount.taxableOwnerShares = { status: 'known', shares: { [partner.id]: 1 } }
    canonical.accounts.push(partnerAccount)
    canonical.fhsaStatementHistory = {
      [account.id]: { cumulativePriorContributions: { status: 'known', value: 0 }, provenance: { origin: 'user', sourceYear: 2026 } },
      'fhsa:partner': { cumulativePriorContributions: { status: 'known', value: 0 }, provenance: { origin: 'user', sourceYear: 2026 } },
    }
    canonical.recurringContributions = [
      { id: fhsaPlanRowId(account.id), accountId: account.id, contributorId: self.id, annualAmount: 6000, funding: 'fromSavings', provenance: { origin: 'user', sourceYear: 2026 } },
      { id: fhsaPlanRowId(partnerAccount.id), accountId: partnerAccount.id, contributorId: partner.id, annualAmount: 6000, funding: 'fromSavings', provenance: { origin: 'user', sourceYear: 2026 } },
    ]
    const result = annualStep(canonical, ok(initializeState(canonical)), budgetProviders(20000))
    expect(result.status).toBe('unsupported')
    if (result.status !== 'unsupported') throw new Error('expected unsupported')
    expect(result.issues[0].detail).toContain(FHSA_MULTIPLE_ACTIVE_ACCOUNTS)
    expect(result.issues[0].detail).toContain('fhsa:partner')
  })
})
