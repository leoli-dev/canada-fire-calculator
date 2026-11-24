import { describe, expect, it, vi } from 'vitest'
import {
  annualSheetCellStatus, annualSheetDisplayValue, annualSheetText,
  type AnnualSheetModel, type AnnualSheetRow,
} from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import {
  annualStep, initializeState, projectAnnualCoverage, projectFromState, sumInvestableAssets, sumNetWorth,
  type AnnualProviders, type KernelResult,
} from '../annualState'
import type { Account, InputsV2, Known, Person, Provenance } from '../model'

const self = 'person:alex'
const partner = 'person:sam'
const alexLocked = 'account:alex:locked'
const samLocked = 'account:sam:locked'
const brokerage = 'account:alex:brokerage'
const home = 'property:home'
const car = 'debt:car'
const known = <T>(value: T): Known<T> => ({ status: 'known', value })
const unknown = { status: 'unknown', reason: 'No statement in this fixture' } as const
const provenance: Provenance = { origin: 'user', sourceYear: 2026 }

function person(id: string, role: Person['role'], ageInBaseYear: number, retirementAge: number): Person {
  return {
    id, role, ageInBaseYear, retirementAge, earnedIncome: unknown, previousYearEarnedIncome: unknown,
    rrspDeductionLimit: unknown, rrspAvailableRoom: unknown, rrspUnusedUndeducted: unknown,
    rrspPensionAdjustment: unknown, rrspPspa: unknown, rrspPar: unknown, tfsaAvailableRoom: unknown,
    cppAnnualAt65: 0, oasAnnualAt65: 0, pensionAnnual: 0, pension: null, cppWork: null,
    provenance: { ageInBaseYear: provenance, retirementAge: provenance },
  }
}

function account(id: string, kind: Account['kind'], ownerId: string, balance: number): Account {
  return {
    id, kind, ownerId, balance, realReturn: 0, volatility: null, annualFee: 0,
    taxableOwnerShares: { status: 'known', shares: { [ownerId]: 1 } },
    acb: kind === 'nonReg' ? known(4000) : unknown, contributionRoom: unknown, openedYear: unknown,
    openedYearsAgoAtBaseYear: null, provenance: { balance: provenance, ownerId: provenance },
  }
}

function workingHousehold(): InputsV2 {
  const shares = { tfsa: 0, rrsp: 0, nonReg: 1 }
  return {
    schemaVersion: 2, baseYear: 2026, province: 'ON', inflation: .02,
    budget: {
      kind: 'savingsBudget', annualNetSavings: 10000, retirementSpending: 45000,
      debtIncluded: known(true), taxBenefitIncluded: known(true),
    },
    people: [person(partner, 'partner', 58, 60), person(self, 'self', 48, 63)],
    accounts: [
      account(alexLocked, 'lira', self, 10000), account(samLocked, 'lira', partner, 17250),
      account(brokerage, 'nonReg', self, 5000),
    ],
    contributions: [],
    recurringContributions: [
      { id: 'alex:employee', accountId: alexLocked, contributorId: self, annualAmount: 1000, funding: 'fromSavings', provenance },
      { id: 'alex:employer', accountId: alexLocked, contributorId: self, annualAmount: 500, funding: 'employerAdditional', provenance },
      { id: 'sam:employee', accountId: samLocked, contributorId: partner, annualAmount: 2000, funding: 'fromSavings', provenance },
      { id: 'sam:employer', accountId: samLocked, contributorId: partner, annualAmount: 750, funding: 'employerAdditional', provenance },
    ],
    savingsAllocation: { shares, provenance },
    projectionAssumptions: { nonRegDistributionYield: 0, accumulationMarginalRate: .35, meltdownBracketCap: 'bracket1' },
    properties: [{
      id: home, kind: 'principal', value: 100000, acb: known(80000), annualRent: known(0),
      appreciation: 0, sellAtAge: null, plannedPurchaseAge: null, plannedDownPayment: null, plannedMortgage: null,
      annualHoldingCostChange: 0, mortgageDebtId: null, taxableOwnerShares: { status: 'known', shares: { [self]: .5, [partner]: .5 } },
      provenance: { value: provenance, acb: provenance },
    }],
    // A 10% loan with two $1,210 payments has a present value of $1,100 + $1,000.
    debts: [{ id: car, kind: 'carLoan', principal: 2100, annualPayment: 1210, yearsRemaining: 2, propertyId: null, provenance }],
    incomeSources: [], dependents: [], strategy: 'tfsaFirst', goal: 'legacy', lifeExpectancy: 90, targetAssets: unknown,
    legacyProjection: {
      currentAge: 48, fireAge: 63, lifeExpectancy: 90, province: 'ON', annualSavings: 10000, inflation: .02,
      savingsSplit: shares, retirementSpending: 45000, returns: { tfsa: 0, rrsp: 0, nonReg: 0 },
      balances: { tfsa: 0, rrsp: 0, nonReg: 5000 }, nonRegBook: 4000,
      cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0, strategy: 'tfsaFirst',
      partner: { currentAge: 58, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
    },
    migration: { sourcePersistVersion: 11, ownershipNeedsConfirmation: false, ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false },
  }
}

function providerPerson(income: number, benefits: number, tax: number, spending: number) {
  return { income, earnedIncome: income, benefits, tax, spending, taxableIncome: income, benefitIncomeForNextYear: known(income) }
}

function householdProviders() {
  const evaluation: Record<number, ReturnType<AnnualProviders['evaluate']>> = {
    2026: { byPerson: { [self]: providerPerson(70000, 0, 14000, 50000), [partner]: providerPerson(50000, 300, 9000, 36090) } },
    2027: { byPerson: { [self]: providerPerson(71400, 0, 14280, 51000), [partner]: providerPerson(51000, 300, 9180, 36830) } },
  }
  const rates: Record<string, number> = { [alexLocked]: .10, [samLocked]: .05, [brokerage]: .025 }
  return {
    evaluate: vi.fn<AnnualProviders['evaluate']>(({ state }) => {
      const input = evaluation[state.year]
      if (!input) throw new Error(`Unexpected evaluation in ${state.year}`)
      return structuredClone(input)
    }),
    returns: vi.fn<AnnualProviders['returns']>((_context, accountId) => rates[accountId]),
  }
}

// Nominal CAD. Cash = income + benefits - taxes - living expenses - debt payment.
// Employee contributions consume $3,000 of that cash each year. Employer
// contributions add $1,250 to locked accounts. Account returns apply after deposits.
const handCalculated = [
  {
    year: 2026, ages: [48, 58], cash: { income: 120000, benefits: 300, tax: 23000, spending: 86090, savings: 10000, voluntary: 7000 },
    accounts: {
      [alexLocked]: { ownerId: self, opening: 10000, contribution: 1500, returnAmount: 1150, closing: 12650 },
      [samLocked]: { ownerId: partner, opening: 17250, contribution: 2750, returnAmount: 1000, closing: 21000 },
      [brokerage]: { ownerId: self, opening: 5000, contribution: 7000, returnAmount: 300, closing: 12300 },
    },
    brokerageBasis: 11000, debt: { opening: 2100, payment: 1210, interest: 210, principal: 1000, closing: 1100 },
    property: { opening: 100000, growth: 2000, closing: 102000 }, investable: 45950, netWorth: 146850,
  },
  {
    year: 2027, ages: [49, 59], cash: { income: 122400, benefits: 300, tax: 23460, spending: 87830, savings: 10200, voluntary: 7200 },
    accounts: {
      [alexLocked]: { ownerId: self, opening: 12650, contribution: 1500, returnAmount: 1415, closing: 15565 },
      [samLocked]: { ownerId: partner, opening: 21000, contribution: 2750, returnAmount: 1187.5, closing: 24937.5 },
      [brokerage]: { ownerId: self, opening: 12300, contribution: 7200, returnAmount: 487.5, closing: 19987.5 },
    },
    brokerageBasis: 18200, debt: { opening: 1100, payment: 1210, interest: 110, principal: 1100, closing: 0 },
    property: { opening: 102000, growth: 2040, closing: 104040 }, investable: 60490, netWorth: 164530,
  },
]

function settled<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

const sheetContext = { scenarioId: 'working-household', revision: 5 }

function sheetRows(rows: AnnualSheetRow[]): AnnualSheetRow[] {
  return rows.flatMap(row => [row, ...sheetRows(row.children ?? [])])
}

const valueId = (path: string) => canonicalSheetId('value', ...path.replace(/^canonical\./, '').split('.'))

function sheetAccess(sheet: AnnualSheetModel) {
  const rows = new Map(sheetRows(sheet.rows).map(row => [row.id, row]))
  const column = (year: number) => sheet.years.find(item => item.year === year)!
  const cell = (path: string, year: number) => {
    const found = rows.get(valueId(path))?.cells?.[year]
    if (!found) throw new Error(`Missing sheet cell ${path} in ${year}`)
    return found
  }
  const nominal = (id: string, year: number) => annualSheetDisplayValue(cell(id, year), column(year), 'nominal')!
  const explanation = (id: string, year: number) => sheet.resolveExplanation?.(cell(id, year).explanationRefs![0])!
  const real = (id: string, year: number) => annualSheetDisplayValue(cell(id, year), column(year), 'real')!
  return { rows, column, cell, nominal, real, explanation }
}

describe('FE-53 canonical household annual ledger', () => {
  it('settles the nominal working years against independent provider inputs', () => {
    const plan = workingHousehold()
    const providers = householdProviders()
    const opening = settled(initializeState(plan))
    const originalOpening = structuredClone(opening)
    const originalPlan = structuredClone(plan)
    let state = opening
    for (const expected of handCalculated) {
      const before = structuredClone(state)
      const step = settled(annualStep(plan, state, providers))
      const { row } = step
      expect(state).toEqual(before)
      expect(row.year).toBe(expected.year)
      expect([row.byPerson[self].age, row.byPerson[partner].age]).toEqual(expected.ages)
      expect(row.cashLedger).toMatchObject({
        income: expected.cash.income, benefits: expected.cash.benefits, tax: expected.cash.tax, spending: expected.cash.spending,
        debtPayments: expect.closeTo(expected.debt.payment, 2), employeeContributions: 3000, employerContributions: 1250,
        voluntaryContributions: expected.cash.voluntary, fhsaContributions: 0, retainedContributions: 0, unallocated: 0,
      })
      const { income, benefits, tax, spending, debtPayments } = row.cashLedger
      expect(income + benefits - tax - spending - debtPayments).toBeCloseTo(expected.cash.savings, 2)
      for (const [id, balance] of Object.entries(expected.accounts)) {
        expect(row.byAccount[id]).toMatchObject({ ...balance, withdrawal: 0 })
        expect(step.state.byAccount[id].balance).toBe(balance.closing)
      }
      expect(row.byAccount[brokerage].acb).toEqual(known(expected.brokerageBasis))
      const posts = step.state.contributionHistory.filter(line => line.calendarYear === expected.year && line.accountId !== brokerage)
      expect(posts).toHaveLength(4)
      expect(posts).toEqual(expect.arrayContaining([
        expect.objectContaining({ accountId: alexLocked, contributorId: self, amount: 1000 }),
        expect.objectContaining({ accountId: alexLocked, contributorId: self, amount: 500 }),
        expect.objectContaining({ accountId: samLocked, contributorId: partner, amount: 2000 }),
        expect.objectContaining({ accountId: samLocked, contributorId: partner, amount: 750 }),
      ]))
      expect(step.state.byDebt[car].principal).toBeCloseTo(expected.debt.closing, 2)
      expect(row.byDebt).toEqual({
        [car]: {
          opening: expect.closeTo(expected.debt.opening, 2), payment: expect.closeTo(expected.debt.payment, 2),
          interest: expect.closeTo(expected.debt.interest, 2), principal: expect.closeTo(expected.debt.principal, 2),
          closing: expect.closeTo(expected.debt.closing, 2), propertyId: null,
        },
      })
      expect(step.state.byProperty[home]).toMatchObject({ held: true, value: expected.property.closing, acb: known(80000) })
      expect(row.byProperty).toEqual({ [home]: { held: true, ...expected.property } })
      expect(sumInvestableAssets(step.state)).toBe(expected.investable)
      expect(sumNetWorth(step.state)).toBeCloseTo(expected.netWorth, 2)
      state = step.state
    }
    expect(opening).toEqual(originalOpening)
    expect(plan).toEqual(originalPlan)
  })

  it('reports the first blocked year and preserves the settled prefix', () => {
    const plan = workingHousehold()
    const opening = settled(initializeState(plan))
    const originalOpening = structuredClone(opening)
    const providers = householdProviders()
    const coverage = settled(projectAnnualCoverage(plan, opening, 5, providers))
    expect(coverage).toMatchObject({
      baseYear: 2026, inflation: .02, requestedStartYear: 2026, requestedYears: 5,
      blocked: { year: 2028, status: 'unsupported', issues: [{ code: 'unsupported', detail: expect.stringContaining('retirement') }] },
      uncomputedYears: [2029, 2030], overallConclusionAvailable: false,
    })
    expect(coverage.rows.map(row => row.year)).toEqual([2026, 2027])
    expect(coverage.state.year).toBe(2028)
    expect(coverage.state.byPerson[partner].age).toBe(60)
    expect(coverage.state.byPerson[self].age).toBe(50)
    expect(sumNetWorth(coverage.state)).toBeCloseTo(164530, 2)
    expect(providers.evaluate.mock.calls.map(([{ state }]) => state.year)).toEqual([2026, 2027])
    expect(providers.returns.mock.calls.map(([{ state }]) => state.year)).toEqual([2026, 2026, 2026, 2027, 2027, 2027])
    expect(opening).toEqual(originalOpening)
  })

  it.each([2026, 2027])('discards a failed %i after its earlier trial postings', (failedYear) => {
    const plan = workingHousehold()
    const opening = settled(initializeState(plan))
    const originalOpening = structuredClone(opening)
    const providers = householdProviders()
    const normalReturns = providers.returns.getMockImplementation()!
    providers.returns.mockImplementation((context, accountId) =>
      context.state.year === failedYear && accountId === brokerage ? Number.NaN : normalReturns(context, accountId))
    const coverage = settled(projectAnnualCoverage(plan, opening, 5, providers))
    expect(coverage.blocked).toEqual({
      year: failedYear, status: 'invalid', causes: ['invalidReturn'],
      issues: [{ code: 'invalid', detail: expect.stringContaining(brokerage) }],
    })
    expect(coverage.rows.map(row => row.year)).toEqual(failedYear === 2026 ? [] : [2026])
    expect(coverage.uncomputedYears).toEqual(failedYear === 2026 ? [2027, 2028, 2029, 2030] : [2028, 2029, 2030])
    expect(coverage.state.year).toBe(failedYear)
    expect(coverage.state).toEqual(failedYear === 2026
      ? originalOpening
      : settled(annualStep(plan, opening, householdProviders())).state)
    expect(providers.evaluate.mock.calls.map(([{ state }]) => state.year)).toEqual(failedYear === 2026 ? [2026] : [2026, 2027])
    const lastReturnTrial = providers.returns.mock.lastCall![0].state
    expect(providers.returns.mock.lastCall![1]).toBe(brokerage)
    expect(lastReturnTrial.byDebt[car].principal).toBeCloseTo(failedYear === 2026 ? 1100 : 0, 2)
    expect(lastReturnTrial.byAccount[brokerage].balance).toBe(failedYear === 2026 ? 12000 : 19500)
    expect(opening).toEqual(originalOpening)
  })

  it('distinguishes a settled request from an available overall conclusion', () => {
    const plan = workingHousehold()
    const opening = settled(initializeState(plan))
    const coverage = settled(projectAnnualCoverage(plan, opening, 2, householdProviders()))
    expect(coverage).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false })
    expect(coverage.rows.map(row => row.year)).toEqual([2026, 2027])
    expect(settled(projectFromState(plan, opening, 2, householdProviders()))).toEqual({
      rows: coverage.rows, state: coverage.state,
    })
  })

  it('validates zero-year openings and returns an independent snapshot without calling providers', () => {
    const plan = workingHousehold()
    const opening = settled(initializeState(plan))
    const providers = householdProviders()
    const coverage = settled(projectAnnualCoverage(plan, opening, 0, providers))
    expect(coverage).toMatchObject({
      state: opening, requestedStartYear: 2026, requestedYears: 0, rows: [],
      blocked: null, uncomputedYears: [], overallConclusionAvailable: false,
    })
    expect(coverage.state).not.toBe(opening)
    expect(coverage.state.byAccount[brokerage]).not.toBe(opening.byAccount[brokerage])
    const invalid = structuredClone(opening)
    invalid.byAccount[brokerage].balance = Number.NaN
    expect(projectAnnualCoverage(plan, invalid, 0, providers)).toMatchObject({ status: 'invalid' })
    expect(providers.evaluate).not.toHaveBeenCalled()
    expect(providers.returns).not.toHaveBeenCalled()
  })

  it('keeps the strict projection contract when the partner reaches retirement first', () => {
    const plan = workingHousehold()
    const providers = householdProviders()
    const opening = settled(initializeState(plan))
    const before = structuredClone(opening)
    const result = projectFromState(plan, opening, 5, providers)
    expect(result).toEqual({
      status: 'unsupported',
      issues: [{ code: 'unsupported', detail: expect.stringContaining('retirement') }],
    })
    expect(providers.evaluate.mock.calls.map(([{ state }]) => state.year)).toEqual([2026, 2027])
    expect(providers.returns.mock.calls.map(([{ state }]) => state.year)).toEqual([2026, 2026, 2026, 2027, 2027, 2027])
    expect(opening).toEqual(before)
  })
})

describe('FE-53 canonical annual sheet', () => {
  it('exposes the hand-calculated ledger and reconciles household and owner rows once', () => {
    const plan = workingHousehold()
    const providers = householdProviders()
    const coverage = settled(projectAnnualCoverage(plan, settled(initializeState(plan)), 2, providers))
    const before = structuredClone(coverage)
    const sheet = canonicalAnnualSheet(coverage, sheetContext)
    const { nominal } = sheetAccess(sheet)
    expect(sheet).toMatchObject({ ...sheetContext, baseYear: 2026 })
    for (const expected of handCalculated) {
      const { year } = expected
      const amount = (id: string) => nominal(`canonical.${id}`, year)
      for (const [id, account] of Object.entries(expected.accounts)) {
        const prefix = `account.${id}`
        expect(amount(`${prefix}.opening`)).toBe(account.opening)
        expect(amount(`${prefix}.contribution`)).toBe(account.contribution)
        expect(amount(`${prefix}.returnAmount`)).toBe(account.returnAmount)
        expect(amount(`${prefix}.withdrawal`)).toBe(0)
        expect(amount(`${prefix}.closing`)).toBe(account.closing)
        expect(amount(`${prefix}.opening`) + amount(`${prefix}.contribution`) +
          amount(`${prefix}.returnAmount`) - amount(`${prefix}.withdrawal`)).toBe(account.closing)
      }
      for (const [field, value] of Object.entries(expected.debt)) {
        expect(amount(`debt.${car}.${field}`)).toBeCloseTo(value, 2)
      }
      expect(amount(`debt.${car}.interest`) + amount(`debt.${car}.principal`)).toBeCloseTo(expected.debt.payment, 2)
      expect(amount(`debt.${car}.opening`) - amount(`debt.${car}.principal`)).toBeCloseTo(expected.debt.closing, 2)
      for (const [field, value] of Object.entries(expected.property)) {
        expect(amount(`property.${home}.${field}`)).toBe(value)
      }
      expect(amount(`property.${home}.opening`) + amount(`property.${home}.growth`)).toBe(expected.property.closing)

      for (const field of ['opening', 'contribution', 'returnAmount', 'closing'] as const) {
        const alex = expected.accounts[alexLocked][field] + expected.accounts[brokerage][field]
        const sam = expected.accounts[samLocked][field]
        expect(amount(`person.${self}.accounts.${field}`)).toBe(alex)
        expect(amount(`person.${partner}.accounts.${field}`)).toBe(sam)
        expect(amount(field === 'closing' ? 'assets' : `accounts.${field}`)).toBe(alex + sam)
      }
      expect(amount('accounts.withdrawal')).toBe(0)
      expect(amount(`person.${self}.accounts.withdrawal`)).toBe(0)
      expect(amount(`person.${partner}.accounts.withdrawal`)).toBe(0)
      expect(amount('assets')).toBe(expected.investable)
      expect(amount('netWorth')).toBeCloseTo(expected.netWorth, 2)
      expect(amount('assets') + amount(`property.${home}.closing`) - amount(`debt.${car}.closing`)).toBeCloseTo(expected.netWorth, 2)

      for (const field of ['income', 'benefits', 'tax', 'spending'] as const) {
        expect(amount(`cash.${field}`)).toBe(expected.cash[field])
        expect(amount(`person.${self}.${field}`) + amount(`person.${partner}.${field}`)).toBe(expected.cash[field])
      }
      expect(amount('cash.debtPayments')).toBeCloseTo(expected.debt.payment, 2)
      expect(amount('cash.employeeContributions')).toBe(3000)
      expect(amount('cash.employerContributions')).toBe(1250)
      expect(amount('cash.voluntaryContributions')).toBe(expected.cash.voluntary)
      for (const field of ['fhsaContributions', 'retainedContributions', 'unallocated']) expect(amount(`cash.${field}`)).toBe(0)
      expect(amount('cash.income') + amount('cash.benefits') - amount('cash.tax') -
        amount('cash.spending') - amount('cash.debtPayments')).toBeCloseTo(expected.cash.savings, 2)
      expect(amount('accounts.contribution')).toBe(expected.cash.savings + 1250)
    }
    const continuity = [
      ...[alexLocked, samLocked, brokerage].map(id => [`account.${id}.opening`, `account.${id}.closing`]),
      [`debt.${car}.opening`, `debt.${car}.closing`],
      [`property.${home}.opening`, `property.${home}.closing`],
      ['accounts.opening', 'assets'],
    ]
    for (const [opening, closing] of continuity) {
      expect(nominal(`canonical.${opening}`, 2027)).toBe(nominal(`canonical.${closing}`, 2026))
    }
    expect(coverage).toEqual(before)
    expect(providers.evaluate).toHaveBeenCalledTimes(2)
    expect(providers.returns).toHaveBeenCalledTimes(6)
  })

  it('uses the opening and settlement CPI factors and keeps nominal tax bases intact', () => {
    const plan = workingHousehold()
    const coverage = settled(projectAnnualCoverage(plan, settled(initializeState(plan)), 2, householdProviders()))
    const sheet = canonicalAnnualSheet(coverage, sheetContext)
    const { rows, column, cell, real, nominal } = sheetAccess(sheet)
    const startFactors = { 2026: 1, 2027: 100 / 102 }
    const endFactors = { 2026: 100 / 102, 2027: 10000 / 10404 }
    const rollForwards = [
      { prefix: 'accounts', closing: 'assets', flows: [['contribution', 1], ['returnAmount', 1], ['withdrawal', -1]] },
      ...[alexLocked, samLocked, brokerage].map(id => ({ prefix: `account.${id}`, closing: `account.${id}.closing`, flows: [['contribution', 1], ['returnAmount', 1], ['withdrawal', -1]] })),
      ...[self, partner].map(id => ({
        prefix: `person.${id}.accounts`, closing: `person.${id}.accounts.closing`, bridge: `personAccounts.${id}.inflationBridge`,
        flows: [['contribution', 1], ['returnAmount', 1], ['withdrawal', -1]],
      })),
      { prefix: `debt.${car}`, closing: `debt.${car}.closing`, flows: [['principal', -1]] },
      { prefix: `property.${home}`, closing: `property.${home}.closing`, flows: [['growth', 1]] },
    ] as const
    for (const year of [2026, 2027] as const) {
      for (const rollForward of rollForwards) {
        const { prefix, closing, flows } = rollForward
        const opening = `${prefix}.opening`
        const bridge = 'bridge' in rollForward ? rollForward.bridge : `${prefix}.inflationBridge`
        expect(cell(opening, year).timing).toBe('opening')
        expect(cell(closing, year).timing).toBe('closing')
        expect(real(opening, year)).toBeCloseTo(nominal(opening, year) * startFactors[year], 8)
        expect(real(closing, year)).toBeCloseTo(nominal(closing, year) * endFactors[year], 8)
        expect(nominal(bridge, year)).toBe(0)
        expect(real(bridge, year)).toBeCloseTo(nominal(closing, year) * (endFactors[year] - startFactors[year]), 8)
        for (const [field] of flows) {
          const path = `${prefix}.${field}`
          expect(cell(path, year).timing).toBe('during-year')
          expect(real(path, year)).toBeCloseTo(nominal(path, year) * startFactors[year], 8)
        }
        const change = flows.reduce((sum, [field, sign]) => sum + Number(sign) * real(`${prefix}.${field}`, year), 0)
        expect(real(opening, year) + change + real(bridge, year)).toBeCloseTo(real(closing, year), 8)
      }
      expect(real(`property.${home}.closing`, year)).toBeCloseTo(100000, 8)
      expect(real('netWorth', year)).toBeCloseTo(nominal('netWorth', year) * endFactors[year], 8)
      for (const path of ['cash.income', 'cash.benefits', 'cash.tax', 'cash.spending', 'cash.debtPayments',
        'cash.employeeContributions', 'cash.employerContributions', 'cash.voluntaryContributions',
        `debt.${car}.interest`, `debt.${car}.payment`]) {
        expect(cell(path, year).timing).toBe('during-year')
        expect(real(path, year)).toBeCloseTo(nominal(path, year) * startFactors[year], 8)
      }
    }
    expect(real(`property.${home}.opening`, 2027)).toBeCloseTo(real(`property.${home}.closing`, 2026), 8)
    expect(annualSheetDisplayValue(cell(`canonical.account.${brokerage}.acb`, 2027), column(2027), 'real')).toBe(18200)
    expect(annualSheetDisplayValue(cell(`canonical.person.${self}.taxableIncome`, 2027), column(2027), 'real')).toBe(71400)
    expect(annualSheetDisplayValue(cell(`canonical.person.${self}.income`, 2027), column(2027), 'real')).toBeCloseTo(70000, 8)
    expect(cell(`canonical.account.${brokerage}.acb`, 2027)).toMatchObject({ basis: 'nominal-tax-basis', timing: 'closing' })
    expect(cell(`canonical.person.${self}.taxableIncome`, 2027)).toMatchObject({ basis: 'nominal-tax-basis', timing: 'during-year' })
    expect(cell(`canonical.person.${partner}.age`, 2027)).toMatchObject({ value: 59, unit: 'years', timing: 'during-year', status: 'calculated' })

    const first = settled(projectAnnualCoverage(plan, settled(initializeState(plan)), 1, householdProviders()))
    const resumed = settled(projectAnnualCoverage(plan, first.state, 1, householdProviders()))
    const resumedSheet = canonicalAnnualSheet(resumed, sheetContext)
    expect(resumedSheet.years).toEqual([column(2027)])
    expect(sheetRows(resumedSheet.rows).map(row => [row.id, row.cells?.[2027]]))
      .toEqual([...rows.values()].map(row => [row.id, row.cells?.[2027]]))
  })

  it('keeps absent facts, inapplicable property and uncomputed years distinct', () => {
    const plan = workingHousehold()
    const futureHome = 'property:future-home'
    plan.properties.push({ ...plan.properties[0], id: futureHome, value: 250000, plannedPurchaseAge: 52 })
    const coverage = settled(projectAnnualCoverage(plan, settled(initializeState(plan)), 5, householdProviders()))
    const sheet = canonicalAnnualSheet(coverage, sheetContext)
    const { cell, column, rows, nominal } = sheetAccess(sheet)
    expect(sheet.years.map(item => item.year)).toEqual([2026, 2027, 2028, 2029, 2030])
    const unknownAcb = `canonical.account.${alexLocked}.acb`
    const futureProperty = `canonical.property.${futureHome}.closing`
    const zeroDebt = `canonical.debt.${car}.closing`
    const expectedByRow = [
      { id: unknownAcb, year: 2027, status: 'unknown' },
      { id: 'canonical.retirement', year: 2027, status: 'not-applicable' },
      { id: 'canonical.estate', year: 2027, status: 'not-applicable' },
      { id: futureProperty, year: 2027, status: 'not-applicable' },
      { id: zeroDebt, year: 2027, status: 'calculated' },
      { id: 'canonical.cash.income', year: 2027, status: 'estimated' },
    ]
    for (const row of rows.values()) {
      if (!row.cells) continue
      for (const year of [2028, 2029, 2030]) {
        expect(row.cells[year]).toMatchObject({ status: 'not-computed', value: null })
        expect(annualSheetDisplayValue(row.cells[year], column(year), 'nominal')).toBeNull()
        expect(annualSheetDisplayValue(row.cells[year], column(year), 'real')).toBeNull()
      }
    }
    for (const { id, year, status } of expectedByRow) {
      expect(annualSheetCellStatus(cell(id, year), column(year), 'real')).toBe(status)
      expect(annualSheetCellStatus(cell(id, year), column(year), 'nominal')).toBe(status)
    }
    expect(cell(zeroDebt, 2027).value).toBe(0)
    expect(nominal('canonical.netWorth', 2027)).toBeCloseTo(164530, 2)
    expect(cell(futureProperty, 2027).value).toBeNull()
    expect(cell(unknownAcb, 2027).value).toBeNull()
    expect(cell('canonical.netWorth', 2028).reason).not.toEqual(cell('canonical.netWorth', 2029).reason)
    for (const [language, retirement] of [['en', /retire/i], ['fr', /retraite/i], ['zh', /退休/]] as const) {
      const reason = annualSheetText(cell('canonical.netWorth', 2028).reason!, language)
      expect(reason).toMatch(retirement)
      expect(reason).not.toContain(coverage.blocked!.issues[0].detail)
    }
  })

  it('marks estate as applicable but unknown only at a settled terminal year', () => {
    const plan = workingHousehold()
    plan.lifeExpectancy = 49
    const coverage = settled(projectAnnualCoverage(plan, settled(initializeState(plan)), 2, householdProviders()))
    const { cell } = sheetAccess(canonicalAnnualSheet(coverage, sheetContext))
    expect(cell('estate', 2026)).toMatchObject({ status: 'not-applicable', value: null, timing: 'terminal' })
    expect(cell('estate', 2027)).toMatchObject({ status: 'unknown', value: null, timing: 'terminal' })
    expect(cell('retirement', 2027)).toMatchObject({ status: 'not-applicable', value: null })
  })

  it.each([
    { room: 5000, applied: 1000, retained: 0, alexOwned: 7500, samOwned: 3750, alexAttributed: 2500 },
    { room: 600, applied: 600, retained: 400, alexOwned: 7900, samOwned: 3350, alexAttributed: 2100 },
  ])('attributes a booked spousal RRSP premium with $room of contributor room', ({ room, applied, retained, alexOwned, samOwned, alexAttributed }) => {
    const plan = workingHousehold()
    const spousal = 'account:sam:spousal'
    plan.accounts.push(account(spousal, 'spousalRrsp', partner, 2000))
    const contributor = plan.people.find(person => person.id === self)!
    contributor.rrspAvailableRoom = known(room)
    contributor.rrspDeductionLimit = known(room)
    contributor.rrspUnusedUndeducted = known(0)
    plan.contributions.push({
      id: 'premium:alex:2026', accountId: spousal, contributorId: self, amount: 1000,
      calendarYear: 2026, deductionYear: 2026, provenance,
    })
    const providers = householdProviders()
    const normalReturns = providers.returns.getMockImplementation()!
    providers.returns.mockImplementation((context, id) => id === spousal ? 0 : normalReturns(context, id))
    const coverage = settled(projectAnnualCoverage(plan, settled(initializeState(plan)), 1, providers))
    expect(coverage.rows[0].contributionLedger.postings).toContainEqual({
      id: 'premium:alex:2026', accountId: spousal, ownerId: partner, contributorId: self, amount: applied,
    })
    const { nominal, rows } = sheetAccess(canonicalAnnualSheet(coverage, sheetContext))
    const amount = (path: string) => nominal(path, 2026)
    expect(amount('cash.voluntaryContributions')).toBe(6000)
    expect(amount('contributions.scheduledPlanned')).toBe(1000)
    expect(amount('contributions.scheduledApplied')).toBe(applied)
    expect(amount('contributions.scheduledRetained')).toBe(retained)
    expect(amount('cash.retainedContributions')).toBe(retained)
    expect(amount('contributions.appliedTotal')).toBe(11250)
    expect(amount('contributions.appliedTotal') - amount('cash.employerContributions')).toBe(
      amount('cash.employeeContributions') + amount('cash.voluntaryContributions') +
      amount('contributions.scheduledApplied') + amount('cash.retainedContributions'))
    expect(amount(`account.${spousal}.contribution`)).toBe(applied)
    expect(amount(`account.${spousal}.closing`)).toBe(2000 + applied)
    expect(amount(`account.${brokerage}.contribution`)).toBe(6000 + retained)
    expect(amount(`person.${partner}.accounts.contribution`)).toBe(samOwned)
    expect(amount(`person.${self}.accounts.contribution`)).toBe(alexOwned)
    // Alex is credited with the locked deposit and the accepted spousal premium.
    // The brokerage deposit has no person attributed as contributor.
    expect(amount(`person.${self}.contributed`)).toBe(alexAttributed)
    expect(amount(`person.${partner}.contributed`)).toBe(2750)
    const ownerRow = rows.get(valueId(`person.${partner}.accounts.contribution`))!
    const contributorRow = rows.get(valueId(`person.${partner}.contributed`))!
    for (const language of ['en', 'fr', 'zh']) {
      expect(annualSheetText(ownerRow.label, language)).not.toBe(annualSheetText(contributorRow.label, language))
    }
  })

  it.each([
    { kind: 'rrsp', room: 5000, scheduled: 2000, scheduledApplied: 2000, scheduledRetained: 0, residualApplied: 3000, totalRetained: 5000 },
    { kind: 'rrsp', room: 1200, scheduled: 2000, scheduledApplied: 1200, scheduledRetained: 800, residualApplied: 0, totalRetained: 8800 },
    { kind: 'fhsa', room: 8000, scheduled: 2000, scheduledApplied: 2000, scheduledRetained: 0, residualApplied: 6000, totalRetained: 1000 },
    { kind: 'fhsa', room: 8000, scheduled: 8500, scheduledApplied: 8000, scheduledRetained: 500, residualApplied: 0, totalRetained: 1000 },
  ] as const)('keeps scheduled $kind attribution separate at $room room and $scheduled scheduled', ({
    kind, room, scheduled, scheduledApplied, scheduledRetained, residualApplied, totalRetained,
  }) => {
    const plan = workingHousehold()
    plan.people = [person(self, 'self', 48, 63)]
    plan.people[0].rrspAvailableRoom = known(room)
    plan.properties[0].taxableOwnerShares = { status: 'known', shares: { [self]: 1 } }
    const registeredId = `account:alex:${kind}`
    const registered = account(registeredId, kind, self, 0)
    plan.accounts = [account(brokerage, 'nonReg', self, 5000), registered]
    plan.recurringContributions = []
    if (kind === 'rrsp') {
      plan.savingsAllocation.shares = { tfsa: 0, rrsp: 1, nonReg: 0 }
    } else {
      registered.openedYear = known(2026)
      plan.fhsaStatementHistory = { [registeredId]: { cumulativePriorContributions: known(0), provenance } }
      plan.recurringContributions = [{ id: 'fhsa:annual-plan', accountId: registeredId, contributorId: self,
        annualAmount: 9000, funding: 'fromSavings', provenance }]
    }
    const providers: AnnualProviders = {
      evaluate: () => ({ byPerson: { [self]: providerPerson(120000, 300, 23000, 86090) } }),
      returns: () => 0,
    }
    const expectedRegistered = scheduledApplied + residualApplied
    const expectedBrokerage = 10000 - expectedRegistered
    for (const id of ['scheduled-row', `annual:2026:${kind}`]) {
      plan.contributions = [{
        id, accountId: registeredId, contributorId: self, amount: scheduled, calendarYear: 2026, deductionYear: null, provenance,
      }]
      const coverage = settled(projectAnnualCoverage(plan, settled(initializeState(plan)), 1, providers))
      expect(coverage.blocked).toBeNull()
      const { contributionLedger, byAccount, cashLedger } = coverage.rows[0]
      expect(contributionLedger).toMatchObject({
        scheduledPlanned: scheduled, scheduledApplied, scheduledRetained, appliedTotal: 10000,
      })
      expect(cashLedger.retainedContributions).toBe(totalRetained)
      expect(byAccount[registeredId].contribution).toBe(expectedRegistered)
      expect(byAccount[brokerage].contribution).toBe(expectedBrokerage)
      const registeredPosts = contributionLedger.postings.filter(post => post.accountId === registeredId)
      expect(registeredPosts.map(post => post.amount).sort((left, right) => left - right))
        .toEqual([scheduledApplied, residualApplied].filter(amount => amount > 0).sort((left, right) => left - right))
      expect(contributionLedger.postings.reduce((total, post) => total + post.amount, 0)).toBe(10000)
      const { nominal } = sheetAccess(canonicalAnnualSheet(coverage, sheetContext))
      expect(nominal('contributions.scheduledApplied', 2026)).toBe(scheduledApplied)
      expect(nominal('contributions.scheduledRetained', 2026)).toBe(scheduledRetained)
      expect(nominal('contributions.appliedTotal', 2026)).toBe(10000)
    }
  })

  it('gives colliding entity paths unique safe row and explanation IDs', () => {
    const plan = workingHousehold()
    const lookalike = `${home}.opening`
    plan.properties.push({ ...plan.properties[0], id: lookalike, kind: 'investment', value: 250000 })
    const coverage = settled(projectAnnualCoverage(plan, settled(initializeState(plan)), 1, householdProviders()))
    const sheet = canonicalAnnualSheet(coverage, sheetContext)
    const all = sheetRows(sheet.rows)
    expect(new Set(all.map(row => row.id)).size).toBe(all.length)
    for (const row of all) expect(row.id).toMatch(/^[A-Za-z_][A-Za-z0-9_-]*$/)
    const { rows } = sheetAccess(sheet)
    const group = rows.get(canonicalSheetId('group', 'property', lookalike))!
    const firstOpening = rows.get(canonicalSheetId('value', 'property', home, 'opening'))!
    const secondOpening = rows.get(canonicalSheetId('value', 'property', lookalike, 'opening'))!
    expect(group.entity).toEqual({ kind: 'property', id: lookalike })
    expect(firstOpening.cells![2026].value).toBe(100000)
    expect(secondOpening.cells![2026].value).toBe(250000)
    expect(firstOpening.cells![2026].explanationRefs).not.toEqual(secondOpening.cells![2026].explanationRefs)
    expect(sheet.resolveExplanation?.(secondOpening.cells![2026].explanationRefs![0])?.sources?.[0].id).toBe(lookalike)
  })

  it('retains stable entity references and provides localized explanations without exposing issue details', () => {
    const plan = workingHousehold()
    const opening = settled(initializeState(plan))
    const providers = householdProviders()
    const normalReturns = providers.returns.getMockImplementation()!
    providers.returns.mockImplementation((context, id) =>
      context.state.year === 2027 && id === brokerage ? Number.NaN : normalReturns(context, id))
    const coverage = settled(projectAnnualCoverage(plan, opening, 3, providers))
    const internalDetail = coverage.blocked!.issues[0].detail
    expect(internalDetail).toContain(brokerage)
    const sheet = canonicalAnnualSheet(coverage, sheetContext)
    const { rows, cell, explanation } = sheetAccess(sheet)
    const entities = { person: [self, partner], account: [alexLocked, samLocked, brokerage], debt: [car], property: [home] } as const
    for (const [kind, ids] of Object.entries(entities)) {
      for (const id of ids) {
        const group = rows.get(canonicalSheetId('group', kind, id))!
        expect(group.entity).toEqual({ kind, id })
        for (const row of sheetRows(group.children!)) {
          expect(row.entity).toEqual({ kind, id })
          if (!row.cells) continue
          expect(sheet.resolveExplanation?.(row.cells![2026].explanationRefs![0])).toMatchObject({
            projectionYear: 2026, sources: [{ id, field: row.id, granularity: 'year' }],
          })
        }
      }
    }
    const refs = sheetRows(sheet.rows).flatMap(row => Object.values(row.cells ?? {}).flatMap(value => value.explanationRefs ?? []))
    expect(new Set(refs).size).toBe(refs.length)
    expect(sheet.resolveExplanation?.('missing-reference')).toBeUndefined()
    const rowId = `canonical.account.${brokerage}.closing`
    const translations = [
      { language: 'en-CA', blocked: /investment return could not be validated/i, suffix: /after the first blocked year/i, evaluator: /supplied by an evaluator/i },
      { language: 'fr-CA', blocked: /rendement fourni ne peut être validé/i, suffix: /après la première année bloquée/i, evaluator: /fournis par un évaluateur/i },
      { language: 'zh-CN', blocked: /投资回报无法验证/, suffix: /首个受阻年度之后/, evaluator: /由评估器提供/ },
    ]
    for (const { language, blocked, suffix, evaluator } of translations) {
      expect(annualSheetText(sheet.scope, language)).toMatch(evaluator)
      for (const [year, message] of [[2027, blocked], [2028, suffix]] as const) {
        const detail = explanation(rowId, year)
        const source = detail.sources![0]
        expect(detail.projectionYear).toBe(year)
        expect(source.displayReference).toBeUndefined()
        const visible = [rows.get(valueId(rowId))!.label, cell(rowId, year).reason!, detail.summary!, source.label, ...detail.limitations!]
          .map(value => annualSheetText(value, language))
        expect(visible[1]).toMatch(message)
        expect(visible[4]).toMatch(message)
        expect(visible.join(' ')).not.toContain(internalDetail)
        expect(visible.join(' ')).not.toContain(brokerage)
        expect(visible.join(' ')).not.toContain(rowId)
      }
    }
  })
})
