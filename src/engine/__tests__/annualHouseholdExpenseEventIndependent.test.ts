import { describe, expect, it, vi } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { annualRetirementContinuation, annualRetirementStep } from '../annualRetirement'
import {
  annualStep, initializeState, projectAnnualCoverage, projectCanonicalCoverage, projectFromState,
  type AnnualProviders, type KernelResult,
} from '../annualState'
import type { WorkingSpendingEvidence } from '../annualWorking'
import type { InputsV2 } from '../model'
import { runProjection } from '../projection'
import { integratedHouseholdFixture } from './fixtures/annualIntegratedHousehold'
import { BASE_YEAR, known, legacyRetirement, recorded, retirementPlan, RETIREE, TFSA } from './fixtures/retirementSettlement'

const PARTNER = 'expense-partner'
const PARTNER_TFSA = 'expense-partner-tfsa'
const HOME = 'expense-held-home'
const LOAN = 'expense-fixed-loan'
const EVENT = 'expense-opaque-id'
const YEAR = BASE_YEAR + 2
const CONTEXT = { scenarioId: 'household-expense', revision: 1 }
type Evidence = NonNullable<InputsV2['annualHouseholdExpenseEvidence']>

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function fixture({
  partnerBalance = 300, selfBalance = 1_708.15, amount = 250, inflation = 0, order = 'self',
}: { partnerBalance?: number; selfBalance?: number; amount?: number; inflation?: number; order?: 'self' | 'partner' | 'sole' } = {}) {
  const plan = retirementPlan({ age: 42, tfsa: selfBalance, inflation, spending: 300, strategy: 'tfsaFirst' })
  plan.lifeExpectancy = 65
  const self = plan.people[0]
  Object.assign(self, { retirementAge: 43, earnedIncome: known(2_500) })
  plan.people.push({
    ...structuredClone(self), id: PARTNER, role: 'partner', ageInBaseYear: 41,
    earnedIncome: known(500), tfsaAvailableRoom: known(5_432),
  })
  plan.accounts = plan.accounts.filter(account => account.id === TFSA)
  if (order !== 'sole') {
    plan.accounts.push({
      ...structuredClone(plan.accounts[0]), id: PARTNER_TFSA, ownerId: PARTNER, balance: partnerBalance,
      taxableOwnerShares: { status: 'known', shares: { [PARTNER]: 1 } },
    })
    const selfRef = { accountId: TFSA, ownerId: RETIREE }
    const partnerRef = { accountId: PARTNER_TFSA, ownerId: PARTNER }
    plan.annualHouseholdMortgageFundingEvidence = {
      orderedAccounts: order === 'partner' ? [partnerRef, selfRef] : [selfRef, partnerRef],
      authorized: true, purpose: 'household-held-mortgage-and-living', provenance: recorded,
    }
  }
  plan.tfsaStatement![PARTNER] = { withdrawals: [], provenance: recorded }
  plan.taxProfile = { spouseSupported: known(false), pensionSplit: null }
  // EI at 1.63% leaves $2,951.10 in the first year and $491.85 in the mixed year.
  plan.budget = { kind: 'incomeBudget', workingSpending: 1_951.1, retirementSpending: 300 }
  plan.properties.push({
    id: HOME, kind: 'principal', value: 480_000, acb: known(240_000), annualRent: known(0),
    appreciation: 0, annualHoldingCostChange: 0, sellAtAge: null, plannedPurchaseAge: null,
    plannedDownPayment: null, plannedMortgage: null, mortgageDebtId: LOAN,
    taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 1 } },
    provenance: { value: recorded, acb: recorded, taxableOwnerShares: recorded },
  })
  plan.debts.push({
    id: LOAN, propertyId: HOME, kind: 'mortgage', principal: 3_000, annualPayment: 1_000,
    yearsRemaining: 3, provenance: recorded,
  })
  plan.legacyProjection = legacyRetirement({
    currentAge: 42, fireAge: 43, lifeExpectancy: 46, inflation, strategy: 'tfsaFirst', retirementSpending: 300,
    balances: { tfsa: selfBalance + (order === 'sole' ? 0 : partnerBalance), rrsp: 0, nonReg: 0 },
    partner: { currentAge: 41, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
    principalResidence: { value: 480_000, appreciation: 0, sellAtAge: null,
      mortgage: { balance: 3_000, annualPayment: 1_000, yearsRemaining: 3 } },
  })
  const evidence: WorkingSpendingEvidence = {
    workingSpending: known(1_951.1), transitionSpending: known(0), retirementSpending: known(300),
    scheduledMortgagePaymentsExcluded: known(true),
  }
  const event: Evidence = {
    id: EVENT, effectiveYear: YEAR, timing: 'after-mortgage-and-living',
    amountNominal: known(amount), amountBasis: 'event-year-nominal-CAD',
    noncapital: true, nonDeductible: true, allowPartialPayment: true,
    excludesFromLivingBudget: true, useExistingFundingOrder: true,
    provenance: { origin: 'user', sourceYear: BASE_YEAR - 1 },
  }
  plan.annualHouseholdExpenseEvidence = event
  return { plan, evidence, event }
}

function withoutEvent(plan: InputsV2) {
  const control = structuredClone(plan)
  delete control.annualHouseholdExpenseEvidence
  return control
}

function posting(accountId: string, ownerId: string, amount: number) {
  return { accountId, ownerId, amount }
}

function history(calendarYear: number, accountId: string, personId: string, amount: number) {
  return { id: `annual:${calendarYear}:withdrawal:${accountId}`, personId, calendarYear, amount }
}

function sheetRow(rows: AnnualSheetRow[], id: string): AnnualSheetRow {
  const found = rows.find(row => row.id === id) ?? rows.flatMap(row => row.children ?? []).find(row => row.id === id)
  if (!found) throw new Error(`Missing annual sheet row ${id}`)
  return found
}

describe('FE-53 S2 one-time household expense cash, owner debits, and gaps', () => {
  it.each([
    { partnerBalance: 400, living: 300, paid: 250, unmet: 0, partnerDraw: 350, suffixLiving: 50 },
    { partnerBalance: 300, living: 300, paid: 200, unmet: 50, partnerDraw: 300, suffixLiving: 0 },
    { partnerBalance: 100, living: 300, paid: 0, unmet: 250, partnerDraw: 100, suffixLiving: 0 },
    { partnerBalance: 40, living: 240, paid: 0, unmet: 250, partnerDraw: 40, suffixLiving: 0 },
  ])('settles $paid of the event with $partnerBalance in the second TFSA', ({
    partnerBalance, living, paid, unmet, partnerDraw, suffixLiving,
  }) => {
    const { plan, evidence, event } = fixture({ partnerBalance })
    const before = structuredClone({ plan, evidence })
    const control = ok(projectCanonicalCoverage(withoutEvent(plan), evidence, 4))
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    const reached = ok(projectCanonicalCoverage(plan, evidence, 3))
    const full = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(full).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false })
    expect(prefix.rows).toStrictEqual(control.rows.slice(0, 2))
    expect(prefix.state).toStrictEqual(ok(projectCanonicalCoverage(withoutEvent(plan), evidence, 2)).state)
    expect(full.rows.slice(0, 3)).toStrictEqual(reached.rows)
    expect(prefix.state.byAccount[TFSA].balance).toBe(1_200)
    expect(prefix.state.byDebt[LOAN].principal).toBe(1_000)
    const row = full.rows[2]
    const suffix = full.rows[3]
    expect(row).toMatchObject({
      year: YEAR,
      workingSettlement: { household: { phase: 'both-retired' } },
      cashLedger: { income: 0, tax: 0, benefits: 0, debtPayments: 1_000, spending: living, expensePayments: paid, unallocated: 0 },
      byDebt: { [LOAN]: { opening: 1_000, principal: 1_000, interest: 0, payment: 1_000, closing: 0 } },
      householdWithdrawalSettlement: {
        withdrawal: 1_200 + partnerDraw, spendingDue: 300, spendingFunded: living, spendingUnmet: 300 - living,
        taxIncrement: 0, postings: [
          { ...posting(TFSA, RETIREE, 1_200), kind: 'tfsa' },
          { ...posting(PARTNER_TFSA, PARTNER, partnerDraw), kind: 'tfsa' },
        ],
      },
      byAccount: {
        [TFSA]: { opening: 1_200, withdrawal: 1_200, closing: 0, contribution: 0, returnAmount: 0, acb: known(0) },
        [PARTNER_TFSA]: { opening: partnerBalance, withdrawal: partnerDraw, closing: partnerBalance - partnerDraw,
          contribution: 0, returnAmount: 0, acb: known(0) },
      },
      householdExpense: {
        eventId: EVENT, year: YEAR, due: 250, paid, unmet, evidence: event,
        arithmetic: { due: { coefficient: '250', scale: 0 }, paid: { coefficient: String(paid), scale: 0 },
          unmet: { coefficient: String(unmet), scale: 0 } },
        postings: paid ? [posting(PARTNER_TFSA, PARTNER, paid)] : [],
      },
    })
    expect(row.householdExpense!.evidence).not.toBe(event)
    expect(reached.state.householdExpenseReceipt).toStrictEqual(row.householdExpense)
    expect(reached.state.householdExpenseReceipt).not.toBe(reached.rows[2].householdExpense)
    expect(full.state.householdExpenseReceipt).toStrictEqual(row.householdExpense)
    expect(reached.state.unfundedEvents).toStrictEqual(unmet ? [{
      eventId: EVENT, amount: unmet, field: 'annualHouseholdExpenseEvidence.amountNominal', reason: 'householdExpense',
    }] : [])
    expect(full.state.unfundedEvents).toStrictEqual([])
    for (const other of [...full.rows.slice(0, 2), suffix, ...control.rows]) {
      expect(other).not.toHaveProperty('householdExpense')
      expect(other.cashLedger).not.toHaveProperty('expensePayments')
    }
    expect(control.state).not.toHaveProperty('householdExpenseReceipt')
    expect(row.tfsaLedger).toMatchObject({
      [RETIREE]: { restored: known(508.15), applied: 0 }, [PARTNER]: { restored: known(0), applied: 0 },
    })
    expect(suffix).toMatchObject({
      cashLedger: { debtPayments: 0, spending: suffixLiving, unallocated: 0 },
      householdWithdrawalSettlement: { spendingFunded: suffixLiving, spendingUnmet: 300 - suffixLiving },
      tfsaLedger: { [RETIREE]: { restored: known(1_200) }, [PARTNER]: { restored: known(partnerDraw) } },
    })
    expect(full.state.tfsaWithdrawalHistory).toStrictEqual([
      history(YEAR - 1, TFSA, RETIREE, 508.15), history(YEAR, TFSA, RETIREE, 1_200),
      history(YEAR, PARTNER_TFSA, PARTNER, partnerDraw),
      ...(suffixLiving ? [history(YEAR + 1, PARTNER_TFSA, PARTNER, suffixLiving)] : []),
    ])
    expect(full.state.contributionHistory).toStrictEqual([])
    expect(row.byPerson).toStrictEqual(control.rows[2].byPerson)
    expect(row.byProperty).toStrictEqual(control.rows[2].byProperty)
    expect(full.state.byProperty[HOME]).toMatchObject({ value: 480_000, acb: known(240_000), held: true })
    expect(full.rows.map(year => year.terminalEstateEstimate)).toStrictEqual(control.rows.map(year => year.terminalEstateEstimate))
    expect({ plan, evidence }).toStrictEqual(before)
  })

  it.each([
    { balance: 299.99, paid: 199.99, unmet: 0.01, exact: { coefficient: '1', scale: 2 } },
    { balance: 299.99999999999994, paid: 199.99999999999994, unmet: 0.00000000000006, exact: { coefficient: '6', scale: 14 } },
    { balance: 300, paid: 200, unmet: 0, exact: { coefficient: '0', scale: 0 } },
  ])('keeps the exact expense gap with $balance in the second TFSA', ({ balance, paid, unmet, exact }) => {
    const { plan, evidence } = fixture({ partnerBalance: balance, amount: 200 })
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    expect(result.rows[2]).toMatchObject({
      cashLedger: { debtPayments: 1_000, spending: 300, expensePayments: paid, unallocated: 0 },
      householdExpense: { due: 200, paid, unmet, arithmetic: { unmet: exact },
        postings: [posting(PARTNER_TFSA, PARTNER, paid)] },
      byAccount: { [PARTNER_TFSA]: { closing: 0, withdrawal: balance } },
    })
    expect(result.state.unfundedEvents.map(gap => gap.amount)).toStrictEqual(unmet ? [unmet] : [])
  })

  it('keeps a recorded obligation just above its funded dollar amount', () => {
    const amount = 200.00000000000003
    const { plan, evidence } = fixture({ amount })
    const reached = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(reached.blocked).toBeNull()
    expect(reached.rows[2].householdExpense).toMatchObject({
      due: amount, paid: 200, unmet: 0.00000000000003,
      arithmetic: { due: { coefficient: '20000000000000003', scale: 14 }, unmet: { coefficient: '3', scale: 14 } },
    })
    const suffix = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(suffix.blocked).toBeNull()
    expect(suffix.rows[4].tfsaLedger).toMatchObject({
      [RETIREE]: { restored: known(0) }, [PARTNER]: { restored: known(0) },
    })
    expect(suffix.state.unfundedEvents).toStrictEqual([])
    expect(suffix.state.householdExpenseReceipt).toStrictEqual(reached.state.householdExpenseReceipt)
  })

  it('uses the authorized partner-first order through mortgage, living, and both event debits', () => {
    const { plan, evidence } = fixture({ order: 'partner', partnerBalance: 1_900, selfBalance: 1_000, amount: 200 })
    // Partner starts the event year with $1,391.85 after the mixed-year $508.15
    // debit. Mortgage and living leave $91.85 before the event reaches self.
    plan.people.reverse()
    plan.accounts.reverse()
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.blocked).toBeNull()
    expect(result.rows[2]).toMatchObject({
      householdExpense: { postings: [posting(PARTNER_TFSA, PARTNER, 91.85), posting(TFSA, RETIREE, 108.15)] },
      householdWithdrawalSettlement: { postings: [
        { ...posting(PARTNER_TFSA, PARTNER, 1_391.85), kind: 'tfsa' },
        { ...posting(TFSA, RETIREE, 108.15), kind: 'tfsa' },
      ] },
      byAccount: { [PARTNER_TFSA]: { closing: 0 }, [TFSA]: { closing: 891.85 } },
    })
    expect(result.rows[3].tfsaLedger).toMatchObject({
      [PARTNER]: { restored: known(1_391.85) }, [RETIREE]: { restored: known(108.15) },
    })
  })
})

describe('one-time expense evidence and atomicity', () => {
  const malformed: [string, (event: Evidence) => unknown][] = [
    ['null amount', event => ({ ...event, amountNominal: null })],
    ['unknown amount', event => ({ ...event, amountNominal: { status: 'unknown' } })],
    ['zero amount', event => ({ ...event, amountNominal: known(0) })],
    ['negative amount', event => ({ ...event, amountNominal: known(-0.01) })],
    ['unsafe amount', event => ({ ...event, amountNominal: known(Number.MAX_SAFE_INTEGER) })],
    ['nonfinite amount', event => ({ ...event, amountNominal: known(Infinity) })],
    ['real amount basis', event => ({ ...event, amountBasis: 'base-year-real-CAD' })],
    ['missing timing', ({ timing: _timing, ...event }) => event],
    ['capital expense', event => ({ ...event, noncapital: false })],
    ['deductible expense', event => ({ ...event, nonDeductible: false })],
    ['all-or-nothing approval', event => ({ ...event, allowPartialPayment: false })],
    ['amount included in living', event => ({ ...event, excludesFromLivingBudget: false })],
    ['no funding order approval', event => ({ ...event, useExistingFundingOrder: false })],
    ['inherited event ID', ({ id, ...event }) => Object.assign(Object.create({ id }), event)],
    ['blank event ID', event => ({ ...event, id: '  ' })],
    ['undated evidence', event => ({ ...event, provenance: { origin: 'user', sourceYear: null } })],
    ['inherited date', event => ({ ...event, provenance: Object.assign(Object.create({ sourceYear: BASE_YEAR }), { origin: 'user' }) })],
    ['post-anchor consent', event => ({ ...event, provenance: { origin: 'user', sourceYear: BASE_YEAR + 1 } })],
    ['estimated consent', event => ({ ...event, provenance: { origin: 'estimated', sourceYear: BASE_YEAR } })],
  ]

  it.each(malformed)('stops on reached %s and preserves the accepted prefix', (_label, change) => {
    const { plan, evidence, event } = fixture()
    plan.annualHouseholdExpenseEvidence = change(event) as Evidence
    const prefix = ok(projectCanonicalCoverage(withoutEvent(plan), evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(ok(projectCanonicalCoverage(plan, evidence, 2))).toStrictEqual(prefix)
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result).toMatchObject({
      blocked: { year: YEAR, status: 'unsupported', causes: ['householdExpense'],
        issues: [{ detail: expect.stringMatching(/^household expense:/) }] },
      uncomputedYears: [YEAR + 1],
    })
    expect(result.rows).toStrictEqual(prefix.rows)
    expect(result.state).toStrictEqual(prefix.state)
    expect(result.state).not.toHaveProperty('householdExpenseReceipt')
    expect(result.state.unfundedEvents).toStrictEqual([])
  })

  it.each([null, [], { effectiveYear: YEAR + 0.5 }])('rejects a malformed record without a schedulable year', record => {
    const { plan, evidence } = fixture()
    plan.annualHouseholdExpenseEvidence = record as Evidence
    expect(ok(projectCanonicalCoverage(plan, evidence, 2))).toMatchObject({
      rows: [], state: ok(initializeState(plan)), blocked: { year: BASE_YEAR, causes: ['householdExpense'] },
    })
  })

  it.each([0, 1])('stops at a reached expense in working offset %i', offset => {
    const { plan, evidence, event } = fixture()
    event.effectiveYear = BASE_YEAR + offset
    const prefix = ok(projectCanonicalCoverage(withoutEvent(plan), evidence, offset))
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result).toMatchObject({
      blocked: { year: event.effectiveYear, status: 'unsupported', causes: ['householdExpense'] },
      uncomputedYears: Array.from({ length: 3 - offset }, (_, i) => event.effectiveYear + 1 + i),
    })
    expect(result.rows).toStrictEqual(prefix.rows)
    expect(result.state).toStrictEqual(prefix.state)
  })

  it('stops in a debt-free household without consuming any event cash', () => {
    const { plan, evidence } = fixture({ order: 'sole' })
    plan.debts = []
    plan.properties[0].mortgageDebtId = null
    plan.budget = { kind: 'incomeBudget', workingSpending: 2_951.1, retirementSpending: 300 }
    evidence.workingSpending = known(2_951.1)
    evidence.transitionSpending = known(491.85)
    delete evidence.scheduledMortgagePaymentsExcluded
    const control = ok(projectCanonicalCoverage(withoutEvent(plan), evidence, 4))
    expect(control.blocked).toBeNull()
    const prefix = ok(projectCanonicalCoverage(withoutEvent(plan), evidence, 2))
    const full = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(full).toMatchObject({ blocked: { year: YEAR, status: 'unsupported', causes: ['householdExpense'] },
      uncomputedYears: [YEAR + 1] })
    expect(full.rows).toStrictEqual(prefix.rows)
    expect(full.state).toStrictEqual(prefix.state)
  })

  it.each([false, true])('requires a recorded TFSA after mortgage maturity (zero-balance account recorded=%s)', recordedAccount => {
    const { plan, evidence } = fixture({ order: 'sole', selfBalance: 0 })
    Object.assign(plan.debts[0], { principal: 1_000, yearsRemaining: 1 })
    evidence.transitionSpending = known(491.85)
    if (!recordedAccount) plan.accounts = []
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows.map(row => row.cashLedger.debtPayments)).toStrictEqual([1_000, 0])
    expect(prefix.state.byDebt[LOAN].principal).toBe(0)
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.rows.slice(0, 2)).toStrictEqual(prefix.rows)
    if (recordedAccount) {
      expect(result.blocked).toBeNull()
      expect(result.rows[2]).toMatchObject({
        cashLedger: { debtPayments: 0, spending: 0, expensePayments: 0 },
        householdExpense: { eventId: EVENT, due: 250, paid: 0, unmet: 250, postings: [] },
        byAccount: { [TFSA]: { opening: 0, withdrawal: 0, closing: 0 } },
      })
      expect(result.rows[3]).not.toHaveProperty('householdExpense')
      expect(result.state.tfsaWithdrawalHistory).toStrictEqual([])
    } else {
      expect(result).toMatchObject({
        blocked: { year: YEAR, status: 'unsupported', causes: ['householdExpense'] }, uncomputedYears: [YEAR + 1],
      })
      expect(result.rows).toStrictEqual(prefix.rows)
      expect(result.state).toStrictEqual(prefix.state)
    }
  })

  it.each([1_508.14, 1_508.1499999999999, 1_508.15])('preserves the mandatory mortgage boundary with $%s opening TFSA', selfBalance => {
    const { plan, evidence } = fixture({ order: 'sole', selfBalance })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.rows.slice(0, 2)).toStrictEqual(prefix.rows)
    if (selfBalance < 1_508.15) {
      const control = ok(projectCanonicalCoverage(withoutEvent(plan), evidence, 4))
      expect(result).toStrictEqual(control)
      expect(result.blocked).toMatchObject({
        year: YEAR, issues: [{ detail: 'mortgage scheduled payment cannot be fully funded' }],
      })
      expect(result.rows).toStrictEqual(prefix.rows)
      expect(result.state).toStrictEqual(prefix.state)
    } else {
      expect(result.blocked).toBeNull()
      expect(result.rows[2]).toMatchObject({
        cashLedger: { debtPayments: 1_000, spending: 0, expensePayments: 0 },
        householdWithdrawalSettlement: { spendingUnmet: 300 },
        householdExpense: { paid: 0, unmet: 250, postings: [] },
      })
    }
  })

  it('stops atomically when the event first reaches a second TFSA without a dated statement', () => {
    const { plan, evidence } = fixture({ partnerBalance: 300, selfBalance: 1_808.15 })
    delete plan.tfsaStatement![PARTNER]
    const reference = ok(projectCanonicalCoverage(withoutEvent(plan), evidence, 3))
    expect(reference.blocked).toBeNull()
    expect(reference.rows[2].byAccount[PARTNER_TFSA].withdrawal).toBe(0)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result).toMatchObject({ blocked: { year: YEAR, status: 'unsupported', causes: ['tfsaWithdrawalEvidence'] },
      uncomputedYears: [YEAR + 1] })
    expect(result.rows).toStrictEqual(prefix.rows)
    expect(result.state).toStrictEqual(prefix.state)
  })

  it('does not settle the expense and an otherwise admissible mortgaged sale in the same year', () => {
    const { plan, evidence } = integratedHouseholdFixture()
    const control = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(control.blocked).toBeNull()
    expect(control.rows[2].retirementSettlement?.primaryHomeSale?.mortgagePayoff).toBeDefined()
    plan.annualHouseholdExpenseEvidence = fixture().event
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result).toMatchObject({ blocked: { year: YEAR, status: 'unsupported', causes: ['householdExpense'] },
      uncomputedYears: [YEAR + 1] })
    expect(result.rows).toStrictEqual(prefix.rows)
    expect(result.state).toStrictEqual(prefix.state)
    expect(result.state).not.toHaveProperty('primaryHomeSaleCash')
  })

  it('does not turn a paid noncapital expense into an estate input or change either tax ledger', () => {
    const { plan, evidence } = fixture({ partnerBalance: 400 })
    plan.lifeExpectancy = 44
    plan.annualTerminalEstateEvidence = { [YEAR]: {
      provenance: recorded, effectiveYear: YEAR, personId: RETIREE, timing: 'end-of-terminal-year',
      modeledDecedent: 'self-only', survivingPersonId: PARTNER, noSurvivorProjection: true,
      certificateRequired: true, completeEstate: true, noDeathBenefitsOrOtherTerminalIncome: true,
      accounts: { [TFSA]: { ownerId: RETIREE, estateIncluded: true, noBeneficiaryRollover: true, tfsaNoDeathIncome: true } },
    } }
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    const reference = ok(projectCanonicalCoverage(withoutEvent(plan), evidence, 3))
    expect(result.blocked).toBeNull()
    const [actual, expected] = [result.rows[2], reference.rows[2]]
    expect(actual.householdExpense?.paid).toBe(250)
    expect(actual.terminalEstateEstimate).toStrictEqual({ status: 'unavailable', reason: 'unsupported-estate' })
    expect(actual.terminalEstateEstimate).toStrictEqual(expected.terminalEstateEstimate)
    expect(actual.taxLedger).toStrictEqual(expected.taxLedger)
    expect(actual.byProperty).toStrictEqual(expected.byProperty)
    expect(result.state.byProperty[HOME].acb).toStrictEqual(known(240_000))
  })
})

describe('one-time expense explanation and nominal display', () => {
  it('exposes localized dated evidence and one event cash use, using start CPI for the real display', () => {
    const { plan, evidence } = fixture({ amount: 100, inflation: 0.02, partnerBalance: 600 })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage.blocked).toBeNull()
    const sheet = canonicalAnnualSheet(coverage, CONTEXT)
    const column = sheet.years[2]
    expect(column.year).toBe(YEAR)
    for (const [field, value] of [['expenseDue', 100], ['expensePaid', 100], ['expenseUnmet', 0]] as const) {
      const entry = sheetRow(sheet.rows, canonicalSheetId('value', 'event', EVENT, field))
      const cell = entry.cells![YEAR]
      expect(entry.entity).toEqual({ kind: 'event', id: EVENT })
      expect(cell).toMatchObject({ value, status: 'estimated', unit: 'CAD', basis: 'nominal-CAD', timing: 'during-year' })
      expect(cell.realFactor).toBeCloseTo(1 / 1.02 ** 2, 12)
      expect(annualSheetDisplayValue(cell, column, 'nominal')).toBe(value)
      expect(annualSheetDisplayValue(cell, column, 'real')).toBeCloseTo(value / 1.02 ** 2, 12)
      for (const year of [BASE_YEAR, YEAR - 1, YEAR + 1]) {
        expect(entry.cells![year]).toMatchObject({ value: null, status: 'not-applicable' })
      }
      const explanation = sheet.resolveExplanation!(cell.explanationRefs![0])!
      expect(explanation.formulaBasis).toBeDefined()
      for (const [locale, statements] of [
        ['en', [/event-year nominal CAD amount directly/i, /without CPI indexation or a tax conversion/i,
          /exact residual authorized liquidity after mandatory mortgage and living/i,
          /purchasing-power display only.*divide.*by start CPI/i]],
        ['fr', [/directement.*CAD nominaux de l’année de l’événement/i, /sans indexation ni conversion fiscale/i,
          /liquidité autorisée résiduelle exacte après l’hypothèque obligatoire et les dépenses courantes/i,
          /pouvoir d’achat seulement.*diviser.*par l’IPC initial/i]],
        ['zh', [/直接使用.*事件年名义加元/, /不作 CPI 指数化或税额换算/,
          /先付必需房贷及生活费用.*精确剩余授权流动资金/, /仅在显示购买力时.*除以年初 CPI/]],
      ] as const) {
        const basis = annualSheetText(explanation.formulaBasis!, locale)
        for (const statement of statements) expect(basis, locale).toMatch(statement)
      }
      const source = explanation.sources!.find(item => item.field === 'annualHouseholdExpenseEvidence')!
      expect(source).toMatchObject({ granularity: 'input', id: EVENT })
      for (const [locale, label, dated, priority] of [
        ['en', /one-time expense/i, /dated user expense evidence/i, /mortgage and living.*first/i],
        ['fr', /dépense ponctuelle/i, /preuve utilisateur datée/i, /hypothèque.*dépenses courantes.*premier/i],
        ['zh', /一次性支出/, /用户注明日期的支出证据/, /先付.*房贷.*生活/],
      ] as const) {
        expect(annualSheetText(entry.label, locale)).toMatch(label)
        expect(annualSheetText(explanation.summary!, locale)).toMatch(priority)
        expect(annualSheetText(source.label, locale)).toMatch(dated)
        expect(annualSheetText(source.displayReference!, locale)).toContain(String(BASE_YEAR - 1))
        const eventSources = explanation.sources!.filter(item => item === source || item.field === 'householdExpense.postings')
        const visible = eventSources.flatMap(item => [item.label, item.displayReference!])
          .map(value => annualSheetText(value, locale)).join(' ')
        expect(visible).not.toMatch(/expense-opaque-id|expense-partner|retiree|amountNominal/)
      }
    }
    const living = sheetRow(sheet.rows, canonicalSheetId('value', 'retirement', 'spendingFunded')).cells![YEAR]
    const formula = sheet.resolveExplanation!(living.explanationRefs![0])!.formula!
    expect(formula.filter(term => term.field === 'expensePayments')).toStrictEqual([
      expect.objectContaining({ value: 100, direction: 'subtract', basis: 'nominal-CAD' }),
    ])
    expect(formula.filter(term => term.field === 'debtPayments')).toStrictEqual([
      expect.objectContaining({ value: 1_000, direction: 'subtract' }),
    ])
    const fundedLiving = 300 * 1.02 ** 2
    expect(living.value).toBeCloseTo(fundedLiving, 10)
    expect(formula.reduce((sum, term) => sum + (term.direction === 'add' ? term.value : -term.value), 0))
      .toBeCloseTo(fundedLiving, 10)
  })

  it('shows separate ordinary and event gaps and localizes stopped years', () => {
    const { plan, evidence, event } = fixture({ partnerBalance: 40 })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    const sheet = canonicalAnnualSheet(coverage, CONTEXT)
    const livingId = canonicalSheetId('value', 'retirement', 'spendingUnmet')
    const expenseId = canonicalSheetId('value', 'event', EVENT, 'expenseUnmet')
    expect(sheetRow(sheet.rows, livingId).cells![YEAR].value).toBe(60)
    expect(sheetRow(sheet.rows, expenseId).cells![YEAR].value).toBe(250)
    event.amountNominal = known(-1)
    const stopped = canonicalAnnualSheet(ok(projectCanonicalCoverage(plan, evidence, 4)), CONTEXT)
    const cells = sheetRow(stopped.rows, livingId).cells!
    expect(cells[YEAR]).toMatchObject({ value: null, status: 'not-computed' })
    expect(cells[YEAR + 1]).toMatchObject({ value: null, status: 'not-computed' })
    for (const [locale, message] of [
      ['en', /one-time household expense.*dated user evidence/i],
      ['fr', /dépense ponctuelle.*preuve utilisateur datée/i],
      ['zh', /一次性支出.*注明日期的证据/],
    ] as const) {
      expect(annualSheetText(cells[YEAR].reason!, locale)).toMatch(message)
    }
  })
})

describe('one-time expense route isolation', () => {
  it('uses the existing single-funded-TFSA household path without ordered-account evidence', () => {
    const { plan, evidence } = fixture({ order: 'sole', selfBalance: 1_908.15 })
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.blocked).toBeNull()
    expect(result.rows[2]).toMatchObject({
      cashLedger: { debtPayments: 1_000, spending: 300, expensePayments: 100 },
      householdWithdrawalSettlement: { accountId: TFSA, ownerId: RETIREE, withdrawal: 1_400 },
      householdExpense: { due: 250, paid: 100, unmet: 150, postings: [posting(TFSA, RETIREE, 100)] },
    })
    expect(result.state.tfsaWithdrawalHistory).toStrictEqual([
      history(YEAR - 1, TFSA, RETIREE, 508.15), history(YEAR, TFSA, RETIREE, 1_400),
    ])
    expect(result.rows[3].tfsaLedger[RETIREE].restored).toStrictEqual(known(1_400))
  })

  it('preserves the solo canonical path and rejects detached household continuations', () => {
    const { plan, evidence } = fixture({ order: 'sole', selfBalance: 3_000 })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(coverage.state.householdExpenseReceipt).toBeDefined()
    const detached = structuredClone(coverage.state)
    const opening = structuredClone(detached)
    expect(annualRetirementContinuation(plan, detached, evidence)).toMatchObject({ status: 'invalid' })
    expect(annualStep(plan, detached, { evaluate: vi.fn(), returns: vi.fn() })).toMatchObject({ status: 'invalid' })
    expect(detached).toStrictEqual(opening)

    plan.people.pop()
    delete plan.tfsaStatement![PARTNER]
    plan.budget = { kind: 'incomeBudget', workingSpending: 1_459.25, retirementSpending: 300 }
    evidence.workingSpending = known(1_459.25)
    const solo = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(solo.blocked).toBeNull()
    expect(solo).toStrictEqual(ok(projectCanonicalCoverage(withoutEvent(plan), evidence, 4)))
    const initialized = ok(initializeState(plan))
    expect(annualRetirementStep(plan, initialized)).toStrictEqual(annualRetirementStep(withoutEvent(plan), initialized))
  })

  it('preserves external provider runs across the effective year', () => {
    const { plan } = fixture()
    plan.budget = { kind: 'savingsBudget', annualNetSavings: 0, retirementSpending: 300,
      debtIncluded: known(true), taxBenefitIncluded: known(true) }
    for (const person of plan.people) person.retirementAge = 65
    const control = withoutEvent(plan)
    const opening = ok(initializeState(plan))
    const providers: AnnualProviders = {
      evaluate: ({ state }) => ({ byPerson: Object.fromEntries(plan.people.map(person => [person.id, {
        income: person.role === 'self' && state.byDebt[LOAN].principal > 0 ? 1_000 : 0,
        earnedIncome: 0, benefits: 0, tax: 0, spending: 0,
        taxableIncome: 0, benefitIncomeForNextYear: known(0),
      }])) }),
      returns: () => 0,
    }
    const expected = ok(projectAnnualCoverage(control, opening, 4, providers))
    expect(expected).toMatchObject({ blocked: null, evaluationBasis: 'provider-supplied' })
    expect(expected.rows[2].year).toBe(YEAR)
    const reached = ok(projectAnnualCoverage(control, opening, 2, providers)).state
    expect(annualStep(plan, reached, providers)).toStrictEqual(annualStep(control, reached, providers))
    expect(projectAnnualCoverage(plan, opening, 4, providers)).toStrictEqual({ status: 'ok', value: expected })
    expect(projectFromState(plan, opening, 4, providers)).toStrictEqual(projectFromState(control, opening, 4, providers))
  })

  it('preserves production, sampled returns, and legacy sheet values', () => {
    const { plan } = fixture()
    const control = withoutEvent(plan)
    const input = plan.legacyProjection
    const traced = runProjection(input, undefined, plan, { captureAnnualDetails: true })
    const expected = runProjection(input, undefined, control, { captureAnnualDetails: true })
    expect(traced).toStrictEqual(expected)
    expect(legacyAnnualSheet(traced, input, CONTEXT).rows).toStrictEqual(legacyAnnualSheet(expected, input, CONTEXT).rows)
    expect(runProjection(input, undefined, plan)).toStrictEqual(runProjection(input, undefined, control))
    const sample = vi.fn(() => -0.04)
    const referenceSample = vi.fn(() => -0.04)
    expect(runProjection(input, sample, plan)).toStrictEqual(runProjection(input, referenceSample, control))
    expect(sample).toHaveBeenCalled()
    expect(sample.mock.calls).toStrictEqual(referenceSample.mock.calls)
  })
})
