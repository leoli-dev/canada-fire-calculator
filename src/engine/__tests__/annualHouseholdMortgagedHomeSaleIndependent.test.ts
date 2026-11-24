import { describe, expect, it, vi } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { annualRetirementContinuation } from '../annualRetirement'
import { initializeState, projectAnnualCoverage, projectCanonicalCoverage, sumInvestableAssets, sumNetWorth,
  type KernelResult } from '../annualState'
import type { InputsV2, Property } from '../model'
import { runProjection } from '../projection'
import { BASE_YEAR, known, legacyRetirement, recorded, retirementPlan, RETIREE, TFSA } from './fixtures/retirementSettlement'

// Vitest's strict comparator treats an own "constructor" key as type metadata.
const { deepStrictEqual } = await vi.importActual<{
  deepStrictEqual(actual: unknown, expected: unknown): void
}>('node:assert/strict')

const PARTNER = 'title-holder'
const HOME = 'home:joint-scenario'
const LIEN = 'lender:fixed-loan'
const SALE_YEAR = BASE_YEAR + 2
const context = { scenarioId: 'household-mortgaged-sale-independent', revision: 1 }
const near = (value: number) => expect.closeTo(value, 7)
const exact = (coefficient: string, scale = 0) => ({ coefficient, scale })
function atom(coefficient: bigint, scale: number) {
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n
    scale--
  }
  return exact(coefficient.toString(), scale)
}
type Sale = NonNullable<InputsV2['annualPrimaryHomeSaleEvidence']>[string]

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function fixture() {
  const plan = retirementPlan({ tfsa: 8_500, rrsp: 0, inflation: 0.02, spending: 500, strategy: 'tfsaFirst' })
  const self = plan.people[0]
  Object.assign(self, { retirementAge: 58, earnedIncome: known(12_000) })
  const partner = { ...structuredClone(self), id: PARTNER, role: 'partner' as const,
    ageInBaseYear: 55, retirementAge: 57 }
  plan.people = [partner, self]
  plan.accounts = [plan.accounts[0]]
  plan.tfsaStatement![PARTNER] = { withdrawals: [], provenance: recorded }
  plan.taxProfile = { spouseSupported: known(false), pensionSplit: null }
  plan.budget = { kind: 'incomeBudget', workingSpending: 21_266.30, retirementSpending: 500 }
  plan.lifeExpectancy = 64
  const home: Property = {
    id: HOME, kind: 'principal', value: 12_500, acb: known(900.25), annualRent: known(0),
    appreciation: 0.03, annualHoldingCostChange: 0, sellAtAge: 59, plannedPurchaseAge: null,
    plannedDownPayment: null, plannedMortgage: null, mortgageDebtId: LIEN,
    taxableOwnerShares: { status: 'known', shares: { [PARTNER]: 1, [RETIREE]: 0 } },
    provenance: { value: recorded, acb: { ...recorded, sourceYear: 2014 }, taxableOwnerShares: recorded },
  }
  plan.properties = [home]
  const debt = { id: LIEN, kind: 'mortgage' as const, propertyId: HOME, principal: 3_310,
    annualPayment: 1_331, yearsRemaining: 3, provenance: recorded }
  plan.debts = [debt]
  const terms: NonNullable<Sale['mortgagePayoff']> = {
    debtId: LIEN, timing: 'start-of-sale-year', effectiveYear: SALE_YEAR,
    openingPrincipalNominal: known(1_210), additionalAccruedInterestNominal: known(0),
    prepaymentPenaltyNominal: known(0), dischargeFeesNominal: known(0), provenance: recorded,
  }
  const sale: Sale = {
    provenance: recorded, wholePropertyFullyExcluded: true, salePriceBasis: 'opening-year-nominal-value',
    effectiveYear: SALE_YEAR, timing: 'start-of-sale-year',
    ownerExclusions: { [PARTNER]: { fullyExcluded: true, provenance: { ...recorded, sourceYear: 2025 } } },
    allSaleCashAvailableForJointSpending: true, sellingCostsNominal: known(797.0045),
    postSaleAnnualSpendingReal: known(5_500), mortgagePayoff: terms,
  }
  plan.annualPrimaryHomeSaleEvidence = { [HOME]: sale }
  plan.legacyProjection = legacyRetirement({
    currentAge: 57, fireAge: 58, lifeExpectancy: 64, inflation: 0.02, retirementSpending: 500,
    strategy: 'tfsaFirst', balances: { tfsa: 8_500, rrsp: 0, nonReg: 0 },
    principalResidence: { value: home.value, appreciation: home.appreciation, sellAtAge: home.sellAtAge,
      mortgage: { balance: debt.principal, annualPayment: debt.annualPayment, yearsRemaining: debt.yearsRemaining } },
    partner: { currentAge: 55, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
  })
  const evidence = { workingSpending: known(21_266.30), transitionSpending: known(11_298.65),
    retirementSpending: known(500), scheduledMortgagePaymentsExcluded: known(true as const) }
  return { plan, home, debt, sale, terms, evidence }
}

function flatten(rows: AnnualSheetRow[]): AnnualSheetRow[] {
  return rows.flatMap(row => [row, ...flatten(row.children ?? [])])
}

function sheetRow(rows: AnnualSheetRow[], ...path: string[]) {
  const id = canonicalSheetId('value', ...path)
  const row = flatten(rows).find(row => row.id === id)
  if (!row) throw new Error(`Missing annual sheet row ${id}`)
  return row
}

describe('FE-53 household mortgaged sale with independently calculated balances', () => {
  it.each([TFSA, 'constructor', 'toString', '__proto__'])('settles once and attributes later withdrawals to the owner of %s', accountId => {
    const { plan, home, evidence, sale, terms } = fixture()
    plan.accounts[0].id = accountId
    if (accountId === 'toString') {
      home.taxableOwnerShares = { status: 'known', shares: { [PARTNER]: 0.625, [RETIREE]: 0.375 } }
      sale.ownerExclusions![RETIREE] = { fullyExcluded: true, provenance: recorded }
    }
    const before = structuredClone({ plan, evidence })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(coverage).toMatchObject({ blocked: null, uncomputedYears: [], evaluationBasis: 'canonical-continuous',
      overallConclusionAvailable: false })
    const [working, mixed, sold, carry, spent, later] = coverage.rows
    expect(coverage.rows.map(row => row.workingSettlement && 'household' in row.workingSettlement
      ? row.workingSettlement.household.phase : undefined))
      .toEqual(['both-working', 'mixed', 'both-retired', 'both-retired', 'both-retired', 'both-retired'])
    expect(sold.byPerson[RETIREE].age).toBe(59)
    expect(sold.byPerson[PARTNER].age).toBe(57)

    // At 10%, the first two fixed $1,331 installments repay $1,000 and $1,100.
    expect(working.byDebt[LIEN]).toEqual({ propertyId: HOME, opening: 3_310, interest: near(331),
      principal: near(1_000), payment: 1_331, closing: near(2_310) })
    expect(mixed.byDebt[LIEN]).toEqual({ propertyId: HOME, opening: near(2_310), interest: near(231),
      principal: near(1_100), payment: 1_331, closing: near(1_210) })
    expect(working.cashLedger).toMatchObject({ income: 24_000, tax: 0, debtPayments: 1_331, spending: near(21_266.30) })
    expect(mixed.cashLedger).toMatchObject({ income: 12_240, tax: 0, debtPayments: 1_331, spending: near(11_524.623) })
    expect(working.byAccount[accountId]).toMatchObject({ withdrawal: 0, closing: near(8_670) })
    expect(mixed.byAccount[accountId]).toMatchObject({ withdrawal: 1_331, closing: near(7_485.78) })

    const opening = ok(projectCanonicalCoverage(plan, evidence, 2))
    // Compare strictly with Node's comparator, which uses actual prototypes.
    deepStrictEqual(opening.rows, coverage.rows.slice(0, 2))
    for (const [index, row] of opening.rows.entries()) {
      const fresh = coverage.rows[index]
      expect(row.byAccount).not.toBe(fresh.byAccount)
      expect(Object.getPrototypeOf(row.byAccount)).toBe(Object.getPrototypeOf(fresh.byAccount))
      for (const map of [row.byAccount, fresh.byAccount]) {
        expect(Object.getOwnPropertyDescriptor(map, accountId)).toMatchObject({
          enumerable: true, configurable: true, writable: true, value: { ownerId: RETIREE },
        })
      }
    }
    const openingPrincipal = opening.state.byDebt[LIEN].principal
    const openingValue = opening.state.byProperty[HOME].value
    // $12,500 × (1.03 × 1.02)² is $13,797.0045 at opening. Subtract
    // $797.0045 in sale expenses and $900.25 ACB before considering debt.
    const receipt = sold.retirementSettlement?.primaryHomeSale
    expect(receipt).toMatchObject({ propertyId: HOME, year: SALE_YEAR, grossProceeds: 13_797.0045,
      sellingCosts: 797.0045, netProceeds: 13_000, acb: 900.25, realizedGain: 12_099.75, taxableGain: 0,
      valuation: { recordedOpeningValue: openingValue, modeledGrossProceeds: exact('137970045', 4) },
      mortgagePayoff: { debtId: LIEN, recordedOpeningPrincipal: openingPrincipal, openingPrincipal: 1_210,
        additionalAccruedInterest: 0, prepaymentPenalty: 0, dischargeFees: 0,
        totalPayoff: 1_210, residualCash: 11_790, terms } })
    const arithmetic = sold.retirementSettlement?.primaryHomeSaleArithmetic?.receipt
    expect(arithmetic).toMatchObject({ grossProceeds: exact('137970045', 4), netProceeds: exact('13000'),
      realizedGain: exact('1209975', 2), mortgagePrincipalPaid: exact('1210'), residualCash: exact('11790') })
    expect(sold.byProperty[HOME]).toEqual({ held: false, opening: 13_797.0045, growth: 0, closing: 0 })
    expect(sold.byDebt[LIEN]).toMatchObject({ propertyId: HOME, opening: openingPrincipal,
      principal: 1_210, payment: 1_210, salePayoff: 1_210, interest: 0, closing: 0 })
    expect(sold.byDebt[LIEN].payoffPrincipalReconciliation).toBe(receipt?.mortgagePayoff?.principalReconciliation)

    // Replay the detached mortgage carry as scaled integers. The zero-real
    // return rate is the serialized Number 1.02 - 1, or .020000000000000018.
    const unit = 10n ** 18n
    const multiplier = 1_020_000_000_000_000_018n
    const openingTfsa = (8_500n * multiplier - 1_331n * unit) * multiplier
    expect(opening.state.mortgageExactBalances?.[accountId]).toEqual(atom(openingTfsa, 36))
    const saleTfsa = openingTfsa * multiplier
    const carryTfsa = saleTfsa * multiplier
    const finalDraw = (carryTfsa - 572_222_088n * 10n ** 67n) * multiplier
    const exactFinalDraw = atom(finalDraw, 90)
    const finalDrawNumber = Number(`${exactFinalDraw.coefficient}e-${exactFinalDraw.scale}`)
    expect(finalDrawNumber).toBe(2_107.3043246400007)

    // Joint bills index by exact decimal CPI. Sale cash carries at zero nominal interest.
    const schedule = [
      { row: sold, cash: 0, added: 11_790, used: 5_722.2, remaining: 6_067.8, due: 5_722.2, draw: 0, tfsa: 7_635.4956, balance: atom(saleTfsa, 54) },
      { row: carry, cash: 6_067.8, added: 0, used: 5_836.644, remaining: 231.156, due: 5_836.644, draw: 0, tfsa: 7_788.205512, balance: atom(carryTfsa, 72) },
      { row: spent, cash: 231.156, added: 0, used: 231.156, remaining: 0, due: 5_953.37688, draw: 5_722.22088, tfsa: finalDrawNumber, balance: exactFinalDraw },
      { row: later, cash: 0, added: 0, used: 0, remaining: 0, due: 6_072.4444176, draw: finalDrawNumber, tfsa: 0, balance: exact('0') },
    ]
    for (const { row, cash, added, used, remaining, due, draw, tfsa, balance } of schedule) {
      expect(row.retirementSettlement?.primaryHomeSaleCash).toEqual({ opening: cash, proceedsAdded: added,
        spendingUsed: used, closing: remaining })
      expect(row.householdWithdrawalSettlement).toMatchObject({ spendingDue: due, spendingFunded: near(used + draw),
        spendingUnmet: near(due - used - draw), withdrawal: draw })
      expect(row.byAccount[accountId]).toMatchObject({ ownerId: RETIREE, withdrawal: draw, closing: tfsa, contribution: 0 })
      expect(row.cashLedger).toMatchObject({ income: 0, benefits: 0, tax: 0, debtPayments: 0,
        spending: near(used + draw), unallocated: 0 })
      if (row.year > SALE_YEAR) {
        expect(row.retirementSettlement?.primaryHomeSale).toBeUndefined()
        expect(row.byDebt[LIEN]).toEqual({ propertyId: HOME, opening: 0, principal: 0, payment: 0, interest: 0, closing: 0 })
        expect(row.byProperty[HOME]).toEqual({ held: false, opening: 0, growth: 0, closing: 0 })
      }
      const prefix = ok(projectCanonicalCoverage(plan, evidence, row.year - BASE_YEAR + 1))
      deepStrictEqual(prefix.rows, coverage.rows.slice(0, row.year - BASE_YEAR + 1))
      expect(prefix.state.byDebt[LIEN]).toMatchObject({ principal: 0, yearsRemaining: 0 })
      expect(prefix.state.byProperty[HOME]).toMatchObject({ held: false, value: 0 })
      expect(prefix.state.mortgageExactBalances).toBeUndefined()
      expect(prefix.state.primaryHomeSaleCash?.exactAccountBalances[accountId]).toEqual(balance)
      expect(sumInvestableAssets(prefix.state)).toBe(tfsa)
      expect(sumNetWorth(prefix.state)).toBeCloseTo(tfsa + remaining, 7)
    }
    expect(coverage.state.tfsaWithdrawalHistory).toEqual([
      { id: `annual:2027:withdrawal:${accountId}`, calendarYear: 2027, personId: RETIREE, amount: 1_331 },
      { id: `annual:2030:withdrawal:${accountId}`, calendarYear: 2030, personId: RETIREE, amount: 5_722.22088 },
      { id: `annual:2031:withdrawal:${accountId}`, calendarYear: 2031, personId: RETIREE, amount: finalDrawNumber },
    ])
    expect(later.retirementSettlement?.primaryHomeSaleArithmetic?.withdrawals[accountId]).toEqual(exactFinalDraw)
    expect(later.tfsaLedger[RETIREE].restored).toEqual(known(5_722.22))
    expect(later.tfsaLedger[PARTNER].restored).toEqual(known(0))
    expect({ plan, evidence }).toEqual(before)
  })
})

type Scenario = ReturnType<typeof fixture>

function stopsAfter({ plan, evidence }: Scenario, allowed: number) {
  const horizon = 5
  const prefix = allowed ? ok(projectCanonicalCoverage(plan, evidence, allowed))
    : { rows: [], state: ok(initializeState(plan)), blocked: null }
  expect(prefix.blocked).toBeNull()
  const stopped = ok(projectCanonicalCoverage(plan, evidence, horizon))
  expect(stopped.blocked?.year).toBe(BASE_YEAR + allowed)
  expect(stopped.uncomputedYears).toEqual(Array.from({ length: horizon - allowed - 1 }, (_, i) => BASE_YEAR + allowed + 1 + i))
  expect(stopped.overallConclusionAvailable).toBe(false)
  deepStrictEqual(stopped.rows, prefix.rows)
  deepStrictEqual(stopped.state, prefix.state)
  return stopped
}

describe('FE-53 payoff admission and exact residual boundary', () => {
  it.each([
    [1_209.999999999999, '-1', '11790000000000001'],
    [1_210.000000000001, '1', '11789999999999999'],
  ])('bridges exact funding to recorded opening valuation and the quote %s', (quote, direction, residual) => {
    const { plan, home, evidence, sale, terms } = fixture()
    home.value = 12_503
    sale.sellingCostsNominal = known(800.31578108)
    terms.openingPrincipalNominal = known(quote)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(coverage.blocked).toBeNull()
    deepStrictEqual(coverage.rows.slice(0, 2), prefix.rows)
    // 12503 × 1.0506² = 13800.31578108. The posted opening is two
    // trillionths lower. The debt opens at 1210 exactly in this schedule.
    expect(prefix.state.byProperty[HOME].value).toBe(13_800.315781079998)
    expect(prefix.state.byDebt[LIEN].principal).toBe(1_210)
    const row = coverage.rows[2]
    expect(row.byProperty[HOME]).toEqual({ held: false, opening: 13_800.315781079998, growth: 0, closing: 0 })
    expect(row.byDebt[LIEN]).toEqual({ propertyId: HOME, opening: 1_210, closing: 0, interest: 0,
      principal: quote, payment: quote, salePayoff: quote, payoffPrincipalReconciliation: Number(direction) * 1e-12 })
    const exactReceipt = row.retirementSettlement?.primaryHomeSaleArithmetic?.receipt
    expect(exactReceipt).toMatchObject({ grossProceeds: exact('1380031578108', 8),
      recordedOpeningValue: exact('13800315781079998', 12), saleValueReconciliation: exact('2', 12),
      recordedOpeningPrincipal: exact('1210'), mortgagePrincipalReconciliation: exact(direction, 12),
      netProceeds: exact('13000'), realizedGain: exact('1209975', 2), residualCash: exact(residual, 12) })
    expect(row.retirementSettlement?.primaryHomeSaleArithmetic?.cash.proceedsAdded).toEqual(exact(residual, 12))
    expect(row.cashLedger.debtPayments).toBe(0)
    expect(coverage.state.byDebt[LIEN]).toMatchObject({ principal: 0, yearsRemaining: 0 })
  })

  it('accepts exact zero residual and refuses true one-cent and sub-cent deficits against the quote', () => {
    const scenario = fixture()
    const { plan, home, sale, evidence } = scenario
    home.value = 12_503
    sale.sellingCostsNominal = known(12_590.31578108)
    const accepted = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(accepted.blocked).toBeNull()
    const sold = accepted.rows[2]
    expect(sold.retirementSettlement?.primaryHomeSaleArithmetic?.receipt).toMatchObject({
      netProceeds: exact('1210'), residualCash: exact('0'), realizedGain: exact('30975', 2),
    })
    expect(sold.retirementSettlement?.primaryHomeSaleCash).toEqual({ opening: 0, proceedsAdded: 0, spendingUsed: 0, closing: 0 })
    expect(sold.byAccount[TFSA].withdrawal).toBe(5_722.2)
    expect(sumNetWorth(accepted.state)).toBeCloseTo((7_485.78 - 5_722.2) * 1.02, 7)
    for (const fees of [12_590.32578108, 12_590.315781080002]) {
      sale.sellingCostsNominal = known(fees)
      const stopped = stopsAfter(scenario, 2)
      expect(stopped.blocked).toMatchObject({ status: 'unsupported', causes: ['propertySale'],
        issues: [{ detail: expect.stringMatching(/net sale proceeds cannot cover/i) }] })
    }
  })

  it('distinguishes mature zero principal from a tiny new charge or absent payoff proof', () => {
    const scenario = fixture()
    const { plan, debt, evidence, sale, terms } = scenario
    debt.principal = 2_662
    debt.yearsRemaining = 2
    terms.openingPrincipalNominal = known(0)
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows.map(row => row.byDebt[LIEN].payment)).toEqual([1_331, 1_331, 0, 0])
    expect(coverage.rows.map(row => row.byDebt[LIEN].closing)).toEqual([1_331, 0, 0, 0])
    expect(coverage.rows[2].retirementSettlement?.primaryHomeSale?.mortgagePayoff).toMatchObject({
      recordedOpeningPrincipal: 0, openingPrincipal: 0, totalPayoff: 0, residualCash: 13_000,
    })
    terms.openingPrincipalNominal = known(1e-12)
    expect(stopsAfter(scenario, 2).blocked).toMatchObject({ causes: ['propertySale'],
      issues: [{ detail: expect.stringMatching(/exactly zero opening principal/i) }] })
    delete sale.mortgagePayoff
    expect(stopsAfter(scenario, 2).blocked).toMatchObject({ causes: ['propertySale'],
      issues: [{ detail: expect.stringMatching(/payoff terms/i) }] })
  })

  it('rejects a zero quote for a tiny positive unmatured balance', () => {
    const scenario = fixture()
    const { plan, debt, evidence, terms } = scenario
    // Each $1,000 wage nets $983.70 after EI. Keep their joint first-year
    // cash exactly sufficient for the recorded living bill and installment.
    const installment = 0.0001
    for (const person of plan.people) person.earnedIncome = known(1_000)
    plan.budget = { kind: 'incomeBudget', workingSpending: 1_967.3999, retirementSpending: 500 }
    evidence.workingSpending = known(1_967.3999)
    evidence.transitionSpending = known(984)
    Object.assign(debt, { principal: 0.0003, annualPayment: installment })
    terms.openingPrincipalNominal = known(installment)
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    expect(result.rows[2].byDebt[LIEN]).toMatchObject({ opening: installment, salePayoff: installment, closing: 0 })
    terms.openingPrincipalNominal = known(0)
    expect(stopsAfter(scenario, 2).blocked).toMatchObject({ causes: ['propertySale'],
      issues: [{ detail: expect.stringMatching(/exactly zero opening principal/i) }] })
  })

  const refusals: [string, (scenario: Scenario) => unknown, RegExp][] = [
    ['no opt-in', ({ plan }) => delete plan.annualPrimaryHomeSaleEvidence, /property sale/i],
    ['missing payoff terms', ({ sale }) => delete sale.mortgagePayoff, /payoff terms/i],
    ['debt ID mismatch', ({ terms }) => { terms.debtId = 'wrong-id' }, /payoff terms/i],
    ['quote dated one year late', ({ terms }) => { terms.effectiveYear++ }, /payoff terms/i],
    ['future quote provenance', ({ terms }) => { terms.provenance = { ...recorded, sourceYear: SALE_YEAR } }, /payoff terms/i],
    ['quote at closing', ({ terms }) => Reflect.set(terms, 'timing', 'end-of-sale-year'), /payoff terms/i],
    ['a nonzero accrued interest charge', ({ terms }) => { terms.additionalAccruedInterestNominal = known(0.0001) }, /payoff terms/i],
    ['unknown discharge fees', ({ terms }) => { terms.dischargeFeesNominal = { status: 'unknown', reason: 'Statement pending' } }, /payoff terms/i],
    ['principal mismatch', ({ terms }) => { terms.openingPrincipalNominal = known(1_210.0000001) }, /inconsistent.*principal/i],
    ['unsafe quote', ({ terms }) => { terms.openingPrincipalNominal = known(Number.MAX_SAFE_INTEGER) }, /safe nominal/i],
    ['missing joint authorization', ({ sale }) => delete sale.allSaleCashAvailableForJointSpending, /authorization/i],
    ['missing proof for a positive title holder', ({ home }) => {
      home.taxableOwnerShares = { status: 'known', shares: { [PARTNER]: 0.75, [RETIREE]: 0.25 } }
    }, /owner exclusion/i],
    ['proof for a zero-title member', ({ sale }) => {
      sale.ownerExclusions![RETIREE] = { fullyExcluded: true, provenance: recorded }
    }, /owner exclusion/i],
  ]
  it.each(refusals)('keeps both completed installments before refusing %s', (_label, change, detail) => {
    const scenario = fixture()
    change(scenario)
    const opened = structuredClone(scenario)
    const blocked = stopsAfter(scenario, 2)
    expect(blocked.blocked).toMatchObject({ status: 'unsupported', causes: ['propertySale'],
      issues: [{ detail: expect.stringMatching(detail) }] })
    expect(blocked.state.byProperty[HOME]).toMatchObject({ held: true, value: 13_797.0045 })
    expect(blocked.state.byDebt[LIEN]).toMatchObject({ principal: 1_210, yearsRemaining: 1 })
    expect(blocked.state.primaryHomeSaleCash).toBeUndefined()
    expect(scenario).toEqual(opened)
  })

  it.each([0, 1])('refuses a sale reached in working phase at offset %s', elapsed => {
    const scenario = fixture()
    const { home, sale, terms } = scenario
    home.sellAtAge = 57 + elapsed
    sale.effectiveYear = terms.effectiveYear = BASE_YEAR + elapsed
    expect(stopsAfter(scenario, elapsed).blocked).toMatchObject({ status: 'unsupported', causes: ['propertySale'],
      issues: [{ detail: expect.stringMatching(/both-retired/i) }] })
  })

  it('rejects positive partner benefits at admission', () => {
    const scenario = fixture()
    scenario.plan.people[0].oasAnnualAt65 = 0.01
    expect(stopsAfter(scenario, 0).blocked).toMatchObject({ status: 'unsupported',
      issues: [{ detail: expect.stringMatching(/benefits/i) }] })
  })

  it('rejects living CPI that crosses the exact safe CAD ceiling only at the sale', () => {
    const scenario = fixture()
    const { plan, sale } = scenario
    plan.inflation = 1e-17
    const ceiling = Number.MAX_SAFE_INTEGER / 100
    sale.postSaleAnnualSpendingReal = known(ceiling)
    expect(ceiling * (1 + plan.inflation) ** 2).toBe(ceiling)
    expect(stopsAfter(scenario, 2).blocked).toMatchObject({ status: 'invalid', causes: ['propertySale'],
      issues: [{ detail: expect.stringMatching(/unsafe indexed nominal spending/i) }] })
  })

  it('rejects the exact modeled valuation beyond the safe range even when its recorded Number stays at the ceiling', () => {
    const scenario = fixture()
    const { plan, home, evidence } = scenario
    const ceiling = Number.MAX_SAFE_INTEGER / 100
    home.value = ceiling
    home.appreciation = 1e-17
    plan.inflation = 0
    const opening = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(opening.state.byProperty[HOME].value).toBe(ceiling)
    expect(stopsAfter(scenario, 2).blocked).toMatchObject({ status: 'unsupported', causes: ['propertySale'],
      issues: [{ detail: expect.stringMatching(/valuation.*outside supported nominal range/i) }] })
  })

  it.each([2, 4])('requires the actual owner statement only when a draw is reached at offset %s', offset => {
    const scenario = fixture()
    const { plan, home, evidence, sale } = scenario
    plan.inflation = 0
    evidence.transitionSpending = known(9_967.65) // Partner net wage less the full installment.
    home.appreciation = 0
    sale.sellingCostsNominal = known(offset === 2 ? 11_290 : 0)
    delete plan.tfsaStatement![RETIREE]
    const stopped = stopsAfter(scenario, offset)
    expect(stopped.blocked).toMatchObject({ status: 'unsupported', causes: ['tfsaWithdrawalEvidence'] })
    expect(stopped.rows.every(row => row.byAccount[TFSA].withdrawal === 0)).toBe(true)
    if (offset === 4) {
      expect(stopped.state.primaryHomeSaleCash?.balance).toBe(290)
      expect(stopped.state.byDebt[LIEN]).toMatchObject({ principal: 0, yearsRemaining: 0 })
    }
  })
})

describe('FE-53 household mortgaged sale presentation and entry points', () => {
  it('presents the signed debt bridge, official references, and cash bridge in each locale', () => {
    const { plan, evidence, terms } = fixture()
    terms.openingPrincipalNominal = known(1_209.999999999999)
    const sheet = canonicalAnnualSheet(ok(projectCanonicalCoverage(plan, evidence, 5)), context)
    const saleRow = (field: string) => sheetRow(sheet.rows, 'primaryHomeSale', field)
    const saleYear = sheet.years[2]
    const residual = saleRow('residualCash').cells![SALE_YEAR]
    const payoff = saleRow('mortgagePrincipalPaid').cells![SALE_YEAR]
    const acb = saleRow('acb').cells![SALE_YEAR]
    const details = sheet.resolveExplanation!(residual.explanationRefs![0])!
    const payment = sheetRow(sheet.rows, 'debt', LIEN, 'payment').cells!
    const explain = (year: number) => sheet.resolveExplanation!(payment[year].explanationRefs![0])!.summary!
    const carry = sheetRow(sheet.rows, 'primaryHomeSaleCash', 'closing').cells![SALE_YEAR]
    expect(saleRow('mortgagePrincipalReconciliation').cells![SALE_YEAR].value).toBe(-1e-12)
    expect(payment[SALE_YEAR - 1].value).toBe(1_331)
    expect(payment[SALE_YEAR].value).toBe(1_209.999999999999)
    expect(payment[SALE_YEAR + 1].value).toBe(0)
    expect(sheetRow(sheet.rows, 'cash', 'debtPayments').cells![SALE_YEAR].value).toBe(0)
    expect(details.formula).toMatchObject([
      { field: 'netProceeds', direction: 'add', value: 13_000 },
      { field: 'mortgagePayoff.totalPayoff', direction: 'subtract', value: 1_209.999999999999 },
    ])
    expect(sheet.resolveExplanation!(carry.explanationRefs![0])?.formula).toMatchObject([
      { field: 'opening', direction: 'add', value: 0 },
      { field: 'proceedsAdded', direction: 'add', value: 11_790.000000000002 },
      { field: 'spendingUsed', direction: 'subtract', value: 5_722.2 },
    ])
    for (const field of ['mortgagePrincipalPaid', 'residualCash', 'mortgagePrincipalReconciliation']) {
      expect(saleRow(field).cells![SALE_YEAR - 1]).toMatchObject({ status: 'not-applicable', value: null })
      expect(saleRow(field).cells![SALE_YEAR + 1]).toMatchObject({ status: 'not-applicable', value: null })
    }
    for (const [cell, amount, divisor] of [
      [payoff, 1_209.999999999999, 1.0404], [residual, 11_790.000000000002, 1.0404],
      [carry, 6_067.800000000001, 1.061208], [acb, 900.25, 1],
    ] as const) {
      expect(annualSheetDisplayValue(cell, saleYear, 'nominal')).toBe(amount)
      expect(annualSheetDisplayValue(cell, saleYear, 'real')).toBeCloseTo(amount / divisor, 8)
    }
    const sources = details.sources!
    const government = [
      'https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/personal-income/line-12700-capital-gains/principal-residence-other-real-estate.html',
      'https://laws-lois.justice.gc.ca/eng/acts/I-3.3/section-40.html',
      'https://laws-lois.justice.gc.ca/eng/acts/I-3.3/section-54.html',
      'https://www.canada.ca/en/financial-consumer-agency/services/mortgages/reduce-prepayment-penalties.html',
    ]
    const termsSource = sources.find(source => source.field === 'annualPrimaryHomeSaleEvidence.mortgagePayoff')!
    const jointSource = sources.find(source => source.field === 'annualPrimaryHomeSaleEvidence.allSaleCashAvailableForJointSpending')!
    expect(sources.filter(source => source.field?.includes('ownerExclusions'))).toMatchObject([
      { id: PARTNER, field: `annualPrimaryHomeSaleEvidence.ownerExclusions.${PARTNER}` },
    ])
    const funded = sheetRow(sheet.rows, 'retirement', 'spendingFunded').cells![2030]
    const funding = sheet.resolveExplanation!(funded.explanationRefs![0])!
    expect(funding.formula).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'retirementSettlement.primaryHomeSaleCash.spendingUsed', direction: 'add', value: near(231.156) }),
      expect.objectContaining({ field: 'withdrawal', direction: 'add', value: near(5_722.22088), sourceId: `annual:2030:withdrawal:${TFSA}` }),
    ]))
    expect(funding.formula?.filter(term => term.field === 'debtPayments')).toEqual([])
    for (const [locale, prePayoff, paymentCopy, installments, payoffTerms, jointLiving, regulator] of [
      ['en', /before mortgage payoff/i, /funded from sale proceeds/i, /fixed nominal payment/i,
        /signed quote minus recorded/i, /joint household living before TFSA/i, /FCAC/],
      ['fr', /avant remboursement hypothécaire/i, /produit de la vente/i, /paiement nominal fixe/i,
        /devis moins capital consigné/i, /dépenses communes avant le CELI/i, /ACFC/],
      ['zh', /偿还房贷前/, /出售所得/, /固定名义付款/, /报价减记录本金/, /先于TFSA用于家庭共同生活/, /金融消费者管理局/],
    ] as const) {
      expect(annualSheetText(saleRow('netProceeds').label, locale)).toMatch(prePayoff)
      expect(annualSheetText(explain(SALE_YEAR), locale)).toMatch(paymentCopy)
      expect(annualSheetText(explain(SALE_YEAR - 1), locale)).toMatch(installments)
      const note = annualSheetText(termsSource.displayReference!, locale)
      expect(note).toMatch(payoffTerms)
      expect(note).toContain('-1e-12')
      expect(note).toContain(String(SALE_YEAR))
      expect(note).toContain(String(BASE_YEAR))
      expect(annualSheetText(jointSource.label, locale)).toMatch(jointLiving)
      expect(annualSheetText(sheet.resolveExplanation!(carry.explanationRefs![0])!.summary!, locale)).toMatch(/T2091\(IND\)/i)
      for (const url of government) {
        const source = sources.find(item => item.displayReference && annualSheetText(item.displayReference, locale) === url)
        expect(source).toMatchObject({ granularity: 'input' })
        if (url === government[3]) expect(annualSheetText(source!.label, locale)).toMatch(regulator)
      }
    }
  })

  it('preserves the debt-free household sale rows and real or nominal values', () => {
    const { plan, home, sale, evidence } = fixture()
    plan.debts = []
    home.mortgageDebtId = null
    delete sale.mortgagePayoff
    plan.budget = { kind: 'incomeBudget', workingSpending: 22_597.30, retirementSpending: 500 }
    evidence.workingSpending = known(22_597.30)
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(coverage.blocked).toBeNull()
    const sheet = canonicalAnnualSheet(coverage, context)
    const group = flatten(sheet.rows).find(row => row.id === canonicalSheetId('group', 'primaryHomeSale'))!
    expect(group.children?.map(row => row.id)).toEqual([
      ...['grossProceeds', 'sellingCosts', 'netProceeds', 'acb', 'realizedGain', 'taxableGain'].map(field =>
        canonicalSheetId('value', 'primaryHomeSale', field)),
      ...['opening', 'proceedsAdded', 'spendingUsed', 'closing'].map(field => canonicalSheetId('value', 'primaryHomeSaleCash', field)),
    ])
    const net = sheetRow(sheet.rows, 'primaryHomeSale', 'netProceeds')
    for (const [locale, label] of [
      ['en', 'Net proceeds added to cash (memo)'], ['fr', 'Produit net ajouté (mémo)'], ['zh', '转入现金的净所得（备忘）'],
    ] as const) expect(annualSheetText(net.label, locale)).toBe(label)
    expect(annualSheetDisplayValue(net.cells![SALE_YEAR], sheet.years[2], 'nominal')).toBe(13_000)
    expect(annualSheetDisplayValue(net.cells![SALE_YEAR], sheet.years[2], 'real')).toBeCloseTo(13_000 / 1.0404, 8)
    const sold = coverage.rows[2].retirementSettlement
    expect(sold?.primaryHomeSale?.mortgagePayoff).toBeUndefined()
    expect(sold?.primaryHomeSaleCash?.proceedsAdded).toBe(13_000)
  })

  it('keeps a failed payoff year and its suffix uncomputed in both display modes', () => {
    const scenario = fixture()
    delete scenario.sale.mortgagePayoff
    const sheet = canonicalAnnualSheet(stopsAfter(scenario, 2), context)
    for (const path of [['debt', LIEN, 'payment'], ['property', HOME, 'closing'], ['netWorth']]) {
      const cells = sheetRow(sheet.rows, ...path).cells!
      expect(cells[SALE_YEAR - 1].value).not.toBeNull()
      for (const year of [SALE_YEAR, SALE_YEAR + 1]) {
        const cell = cells[year]
        expect(cell).toMatchObject({ status: 'not-computed', value: null })
        for (const mode of ['nominal', 'real'] as const)
          expect(annualSheetDisplayValue(cell, sheet.years[year - BASE_YEAR], mode)).toBeNull()
        expect(sheet.resolveExplanation!(cell.explanationRefs![0])?.sources?.[0].code)
          .toBe(year === SALE_YEAR ? 'propertySale' : 'suffix')
      }
    }
  })

  it('keeps the original debt-free refusal copy in all three languages', () => {
    const scenario = fixture()
    const { plan, home, sale, evidence } = scenario
    plan.debts = []
    home.mortgageDebtId = null
    delete sale.mortgagePayoff
    delete sale.ownerExclusions
    plan.budget = { kind: 'incomeBudget', workingSpending: 22_597.30, retirementSpending: 500 }
    evidence.workingSpending = known(22_597.30)
    const sheet = canonicalAnnualSheet(stopsAfter(scenario, 2), context)
    const cell = sheetRow(sheet.rows, 'netWorth').cells![SALE_YEAR]
    const explanation = sheet.resolveExplanation!(cell.explanationRefs![0])!
    for (const [locale, baseline] of [
      ['en', 'The planned sale age was reached on the self member’s clock. This household sale requires a supported both-retired debt-free household, dated user evidence for every positive title interest, known fees and nominal ACB, verified new living spending and authorization of all sale cash for joint household living. This year and later years were not computed.'],
      ['fr', 'L’âge prévu de vente est atteint selon l’âge du membre principal. La vente exige un ménage retraité sans dette pris en charge, des preuves utilisateur datées pour chaque intérêt positif, des frais et un PBR nominaux connus, de nouvelles dépenses vérifiées et l’autorisation de tout le produit pour les dépenses communes. Cette année et les suivantes ne sont pas calculées.'],
      ['zh', '本人达到计划住宅出售年龄。此次出售需要受支持的双方退休无债务家庭、每项正产权的注明日期用户证据、已知费用和名义成本基础、经核实的新生活支出以及全部售房现金共同开支授权。本年及后续年份未计算。'],
    ] as const) {
      expect(annualSheetText(cell.reason!, locale)).toBe(baseline)
      expect(annualSheetText(explanation.summary!, locale)).toBe(baseline)
    }
  })

  it('describes a future sale conditionally in the held prefix and the completed payoff as replacing installments', () => {
    const { plan, evidence } = fixture()
    const prefix = canonicalAnnualSheet(ok(projectCanonicalCoverage(plan, evidence, 2)), context)
    const settled = canonicalAnnualSheet(ok(projectCanonicalCoverage(plan, evidence, 3)), context)
    for (const [locale, condition, retired, noRepeat] of [
      ['en', /missing or incompatible evidence or insufficient proceeds stops/i, /both.retired/i,
        /no scheduled interest or installment is also posted|scheduled interest and installments are not also posted/i],
      ['fr', /preuves manquantes ou incompatibles ou un produit insuffisant arrêtent/i, /deux membres sont retraités/i,
        /aucun intérêt ni versement prévu n’est comptabilisé en plus|intérêts et versements prévus ne sont pas comptabilisés en plus/i],
      ['zh', /证据缺失或不符或所得不足时.*停止计算/, /双方退休/, /不再另计计划利息或还款/],
    ] as const) {
      expect(annualSheetText(prefix.scope, locale)).toMatch(condition)
      const scope = annualSheetText(settled.scope, locale)
      expect(scope).toMatch(retired)
      expect(scope).toMatch(noRepeat)
    }
    expect(annualSheetText(prefix.scope, 'en')).not.toMatch(/a reached planned sale stops coverage on the self clock\./i)
    expect(annualSheetText(prefix.scope, 'fr')).not.toMatch(/une vente prévue atteinte arrête le calcul selon l’âge du membre principal\./i)
    expect(annualSheetText(prefix.scope, 'zh')).not.toContain('本人达到计划出售年龄即停止覆盖。')
  })

  it('preserves the no-opt-in prefix and continued fixed maturity for the unsold control', () => {
    const scenario = fixture()
    const { plan, evidence, home } = scenario
    const admitted = ok(projectCanonicalCoverage(plan, evidence, 4))
    delete plan.annualPrimaryHomeSaleEvidence
    const noOptIn = stopsAfter(scenario, 2)
    deepStrictEqual(noOptIn.rows, admitted.rows.slice(0, 2))
    home.sellAtAge = null
    const held = ok(projectCanonicalCoverage(plan, evidence, 4))
    deepStrictEqual(held.rows.slice(0, 2), noOptIn.rows)
    expect(held.rows[2].byDebt[LIEN]).toEqual({ propertyId: HOME, opening: 1_210, closing: 0,
      interest: 121, principal: 1_210, payment: 1_331 })
    expect(held.rows[2].cashLedger.debtPayments).toBe(1_331)
    expect(held.rows[3].cashLedger.debtPayments).toBe(0)
    expect(held.state.byDebt[LIEN]).toMatchObject({ principal: 0, yearsRemaining: 0 })
  })

  it('keeps provider-supplied states outside the authenticated sale and leaves production and legacy outputs equal', () => {
    const { plan, evidence } = fixture()
    const snapshot = ok(projectCanonicalCoverage(plan, evidence, 2)).state
    expect(annualRetirementContinuation(plan, snapshot, evidence)).toMatchObject({ status: 'invalid' })
    const control = structuredClone(plan)
    delete control.annualPrimaryHomeSaleEvidence
    const input = plan.legacyProjection
    const traced = runProjection(input, undefined, plan, { captureAnnualDetails: true })
    const reference = runProjection(input, undefined, control, { captureAnnualDetails: true })
    expect(traced).toStrictEqual(reference)
    expect(legacyAnnualSheet(traced, input, context).rows).toStrictEqual(legacyAnnualSheet(reference, input, context).rows)
    expect(runProjection(input, undefined, plan)).toStrictEqual(runProjection(input, undefined, control))
    const sample = vi.fn(() => -0.03)
    const controlSample = vi.fn(() => -0.03)
    expect(runProjection(input, sample, plan)).toStrictEqual(runProjection(input, controlSample, control))
    expect(sample).toHaveBeenCalled()
    expect(sample.mock.calls).toEqual(controlSample.mock.calls)

    for (const candidate of [plan, control]) {
      candidate.budget = { kind: 'savingsBudget', annualNetSavings: 0, retirementSpending: 500,
        debtIncluded: known(true), taxBenefitIncluded: known(true) }
      for (const person of candidate.people) person.retirementAge = 67
    }
    const providers = {
      evaluate: () => ({ byPerson: Object.fromEntries(plan.people.map(person => {
        const income = person.role === 'self' ? 1_331 : 0
        return [person.id, { income, earnedIncome: income, benefits: 0, tax: 0, spending: 0,
          taxableIncome: income, benefitIncomeForNextYear: known(income) }]
      })) }),
      returns: () => 0,
    }
    const prefix = ok(projectAnnualCoverage(control, ok(initializeState(control)), 2, providers))
    const actual = ok(projectAnnualCoverage(plan, ok(initializeState(plan)), 4, providers))
    expect(actual).toStrictEqual(ok(projectAnnualCoverage(control, ok(initializeState(control)), 4, providers)))
    expect(actual).toMatchObject({ evaluationBasis: 'provider-supplied', rows: prefix.rows, state: prefix.state,
      blocked: { year: SALE_YEAR, status: 'unsupported', causes: ['propertySale'] }, uncomputedYears: [2029] })
  })

  it('preserves solo mortgage sale with the original non-household terms', () => {
    const { plan, home, sale, evidence } = fixture()
    plan.people = plan.people.filter(person => person.role === 'self')
    plan.people[0].retirementAge = 59
    delete plan.tfsaStatement![PARTNER]
    home.taxableOwnerShares = { status: 'known', shares: { [RETIREE]: 1 } }
    delete sale.allSaleCashAvailableForJointSpending
    delete sale.ownerExclusions
    delete sale.effectiveYear
    delete sale.timing
    plan.budget = { kind: 'incomeBudget', workingSpending: 9_967.65, retirementSpending: 500 }
    evidence.workingSpending = known(9_967.65)
    plan.inflation = 0
    home.appreciation = 0
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows[2].householdWithdrawalSettlement).toBeUndefined()
    expect(coverage.rows[2].retirementSettlement?.primaryHomeSale).toMatchObject({
      grossProceeds: 12_500, netProceeds: 11_702.9955, realizedGain: 10_802.7455,
      mortgagePayoff: { openingPrincipal: 1_210, residualCash: 10_492.9955 },
    })
  })
})
