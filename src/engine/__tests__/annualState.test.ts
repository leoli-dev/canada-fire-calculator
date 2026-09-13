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
})
