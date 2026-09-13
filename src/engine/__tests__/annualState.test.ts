import { describe, expect, it, vi } from 'vitest'
import type { Inputs } from '../types'
import { migratePersistedPlan } from '../migration'
import type { InputsV2 } from '../model'
import { annualStep, fixedReturnProvider, initializeState, projectFromState, sumInvestableAssets, sumNetWorth, type AnnualProviders } from '../annualState'

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
    expect(state.byAccount[tfsa].room).toEqual({ status: 'known', value: 980 })
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

  it('gates unknown ownership and unverified room instead of inventing an assignment or tax rule', () => {
    const canonical = plan()
    canonical.accounts[0].ownerId = null
    canonical.accounts[0].taxableOwnerShares = { status: 'unknown', reason: 'unassigned' }
    expect(initializeState(canonical).status).toBe('unsupported')
    const valid = plan()
    valid.accounts[0].contributionRoom = { status: 'unknown', reason: 'statement missing' }
    const opening = ok(initializeState(valid))
    expect(annualStep(valid, opening, providers()).status).toBe('unsupported')
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
    const canonical = plan({ ...input(), debts: [], inflation: .02, annualSavings: 50 })
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
    expect(fixed.rows[0].byAccount[canonical.accounts[0].id].returnAmount).toBeCloseTo(125 * ((1.1 * 1.02) - 1), 8)
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
