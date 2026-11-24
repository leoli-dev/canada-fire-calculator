import { describe, expect, it, vi } from 'vitest'
import { annualSheetDisplayValue, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { annualRetirementContinuation, annualRetirementStep, projectRetirementCoverage } from '../annualRetirement'
import { annualStep, initializeState, projectAnnualCoverage, projectCanonicalCoverage, projectFromState,
  sumInvestableAssets, sumNetWorth, type KernelResult } from '../annualState'
import { evaluateCanonicalWorkingYear, type WorkingSpendingEvidence } from '../annualWorking'
import { runProjection } from '../projection'
import { phaseReference } from './fixtures/phaseTransition'
import { BASE_YEAR, known, legacyRetirement, recorded, retirementPlan, RETIREE, RRSP, TFSA } from './fixtures/retirementSettlement'

const HOME = 'home'
const LIEN = 'home-mortgage'
const CONTEXT = { scenarioId: 'held-home-mortgage', revision: 1 }
const CPI = 1.02
const HOME_VALUE = 500_000
const PRINCIPAL = 25_220
const PAYMENT = 9_261
const LIVING_WORK = 46_000
const LIVING_RETIRE = 30_000
const RRSP_OPENING = 200_000
const close = (amount: number) => expect.closeTo(amount, 6)

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function fixture({ tfsa = 0, rrsp = RRSP_OPENING, wage = 80_000, working = LIVING_WORK,
  living = LIVING_RETIRE, principal = PRINCIPAL, payment = PAYMENT, term = 3, inflation = 0.02 } = {}) {
  const plan = retirementPlan({ tfsa, rrsp, spending: living, inflation })
  plan.people[0].retirementAge = 58
  plan.people[0].earnedIncome = known(wage)
  plan.people[0].tfsaAvailableRoom = known(20_000)
  plan.lifeExpectancy = 60
  plan.budget = { kind: 'incomeBudget', workingSpending: working, retirementSpending: living }
  plan.properties.push({
    id: HOME, kind: 'principal', value: HOME_VALUE, acb: known(300_000), annualRent: known(0), appreciation: 0,
    sellAtAge: null, plannedPurchaseAge: null, plannedDownPayment: null, plannedMortgage: null,
    annualHoldingCostChange: 0, mortgageDebtId: LIEN,
    taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 1 } }, provenance: { value: recorded },
  })
  plan.debts.push({ id: LIEN, propertyId: HOME, kind: 'mortgage', principal, annualPayment: payment, yearsRemaining: term,
    provenance: recorded })
  plan.legacyProjection = legacyRetirement({
    fireAge: 58, lifeExpectancy: 60, inflation, retirementSpending: living,
    balances: { tfsa, rrsp, nonReg: 0 },
    principalResidence: { value: HOME_VALUE, appreciation: 0, sellAtAge: null,
      mortgage: { balance: principal, annualPayment: payment, yearsRemaining: term } },
  })
  const evidence: WorkingSpendingEvidence = {
    workingSpending: known(working), retirementSpending: known(living), scheduledMortgagePaymentsExcluded: known(true),
  }
  return { plan, evidence }
}

function cashLimited(tfsa: number) {
  return fixture({ tfsa, rrsp: 0, wage: 12_000, working: 9_967.65, living: 2_000, principal: 3_310, payment: 1_331 })
}

function findRow(rows: AnnualSheetRow[], id: string): AnnualSheetRow | undefined {
  for (const row of rows) {
    if (row.id === id) return row
    const child = findRow(row.children ?? [], id)
    if (child) return child
  }
}

// All three retiree draws stay below the first provincial/federal bracket
// ceiling. The paid years are on the $450 Ontario health-premium plateau,
// and the mature year is on the $300 plateau. Solve gross − income tax = target
// in 2026 dollars, then index using the year's opening CPI.
function retirementDraw(living: number, payment: number, startCpi: number) {
  const premium = payment ? 450 : 300
  const gross = (living + payment / startCpi + premium - 0.14 * 16_452 - 0.0505 * 12_989) / (1 - 0.14 - 0.0505)
  const tax = (gross - 16_452) * 0.14 + (gross - 12_989) * 0.0505 + premium
  return { gross: gross * startCpi, tax: tax * startCpi }
}

describe('independent held-home mortgage settlement', () => {
  it('pays the fixed nominal installment once per year through maturity, with separate wages, payroll, tax and living costs', () => {
    const { plan, evidence } = fixture()
    const original = structuredClone({ plan, evidence })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false,
      evaluationBasis: 'canonical-continuous' })
    expect(coverage.rows.map(row => row.year)).toEqual([2026, 2027, 2028, 2029])
    const sheet = canonicalAnnualSheet(coverage, CONTEXT)
    const { wage, taxableWage, payroll, workingTax } = phaseReference
    const netWorking = wage - payroll - workingTax - LIVING_WORK - PAYMENT
    const contribution = 5_041.63
    const [working] = coverage.rows
    expect(working).toMatchObject({
      payrollContributions: close(payroll), workingSettlement: { netCash: close(netWorking) },
      cashLedger: { income: wage, tax: close(workingTax), spending: LIVING_WORK, debtPayments: PAYMENT, unallocated: 0 },
      taxLedger: { [RETIREE]: { taxableIncome: close(taxableWage), tax: close(workingTax) } },
      contributionLedger: { allocationCashBasis: close(netWorking), appliedTotal: contribution },
      byAccount: { [TFSA]: { contribution, withdrawal: 0, closing: close(contribution * CPI) } },
    })
    expect(working.retirementSettlement).toBeUndefined()

    // Work backwards at 5% from a $0 maturity. Closing principal in each
    // prior year is (following closing principal + $9,261) / 1.05.
    const schedule = [
      [25_220, 1_261, 8_000, 9_261, 17_220, 2],
      [17_220, 861, 8_400, 9_261, 8_820, 1],
      [8_820, 441, 8_820, 9_261, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ] as const

    let rrsp = RRSP_OPENING
    for (const [index, row] of coverage.rows.entries()) {
      const startCpi = CPI ** index
      const endCpi = startCpi * CPI
      const [opening, interest, principal, payment, closing, yearsRemaining] = schedule[index]
      expect(row.byDebt).toEqual({ [LIEN]: {
        propertyId: HOME, opening: close(opening), interest: close(interest), principal: close(principal),
        payment: close(payment), closing: close(closing),
      } })
      if (index) expect(row.byDebt[LIEN].opening).toBe(coverage.rows[index - 1].byDebt[LIEN].closing)
      expect(row.byDebt[LIEN].closing + row.byDebt[LIEN].principal).toBeCloseTo(opening, 6)
      expect(row.byDebt[LIEN].interest + row.byDebt[LIEN].principal).toBeCloseTo(payment, 6)
      const prefix = ok(projectCanonicalCoverage(plan, evidence, index + 1))
      expect(prefix.rows).toEqual(coverage.rows.slice(0, index + 1))
      expect(prefix.state.byDebt[LIEN]).toEqual({ principal: close(closing), annualPayment: PAYMENT, yearsRemaining, propertyId: HOME })
      if (yearsRemaining === 0) expect(prefix.state.byDebt[LIEN].principal).toBe(0)

      const cell = (...path: string[]) => findRow(sheet.rows, canonicalSheetId('value', ...path))!.cells![row.year]
      const column = sheet.years[index]
      expect(row.cashLedger.debtPayments).toBeCloseTo(payment, 6)
      if (index) {
        const spending = LIVING_RETIRE * startCpi
        const { gross, tax } = retirementDraw(LIVING_RETIRE, payment, startCpi)
        expect(row.workingSettlement).toBeUndefined()
        expect(row.payrollContributions ?? 0).toBe(0)
        expect(row.byAccount[TFSA].withdrawal).toBe(0)
        expect(row.byAccount[RRSP]).toMatchObject({ opening: close(rrsp), withdrawal: close(gross), contribution: 0 })
        expect(row.taxLedger).toEqual({ [RETIREE]: { taxableIncome: close(gross), tax: close(tax) } })
        expect(row.cashLedger).toMatchObject({ income: 0, benefits: 0, tax: close(tax), spending: close(spending), unallocated: close(0) })
        expect(row.retirementSettlement).toMatchObject({
          spendingDue: close(spending), spendingFunded: close(spending), spendingUnmet: close(0),
        })
        expect(row.byAccount[RRSP].withdrawal - row.cashLedger.tax - row.cashLedger.debtPayments)
          .toBeCloseTo(row.cashLedger.spending, 6)
        const funded = cell('retirement', 'spendingFunded')
        const formula = sheet.resolveExplanation!(funded.explanationRefs![0])!.formula!
        if (payment) expect(formula.filter(term => term.field === 'debtPayments')).toEqual([
          expect.objectContaining({ direction: 'subtract', value: close(payment) }),
        ])
        expect(formula.reduce((total, term) => total + (term.direction === 'subtract' ? -1 : 1) * (term.value ?? 0), 0))
          .toBeCloseTo(spending, 6)
        rrsp -= gross
      }
      rrsp *= CPI
      expect(row.byAccount[RRSP].closing).toBeCloseTo(rrsp, 6)

      for (const [field, timing, amount, factor] of [
        ['opening', 'opening', opening, startCpi], ['interest', 'during-year', interest, startCpi],
        ['principal', 'during-year', principal, startCpi], ['payment', 'during-year', payment, startCpi],
        ['closing', 'closing', closing, endCpi],
      ] as const) {
        const debt = cell('debt', LIEN, field)
        expect(debt).toMatchObject({ timing, basis: 'nominal-CAD', value: close(amount) })
        expect(annualSheetDisplayValue(debt, column, 'real')).toBeCloseTo(amount / factor, 6)
        expect(annualSheetDisplayValue(debt, column, 'nominal')).toBeCloseTo(amount, 6)
      }
      expect(cell('cash', 'debtPayments').value).toBeCloseTo(payment, 6)
      const assets = rrsp + contribution * endCpi
      const netWorth = assets + HOME_VALUE * endCpi - closing
      expect(row.byProperty[HOME].closing).toBeCloseTo(HOME_VALUE * endCpi, 6)
      expect(prefix.state.byProperty[HOME].acb).toEqual(known(300_000))
      expect(sumInvestableAssets(prefix.state)).toBeCloseTo(assets, 6)
      expect(sumNetWorth(prefix.state)).toBeCloseTo(netWorth, 6)
      expect(cell('assets').value).toBeCloseTo(assets, 6)
      expect(annualSheetDisplayValue(cell('netWorth'), column, 'real')).toBeCloseTo(netWorth / endCpi, 6)
    }
    expect({ plan, evidence }).toEqual(original)
  })

  it('keeps debt-free held-home working pricing and retirement results independent of the mortgage attestation', () => {
    const { plan, evidence } = fixture()
    const held = ok(projectCanonicalCoverage(plan, evidence, 4))
    plan.debts = []
    plan.properties[0].mortgageDebtId = null
    const verified = ok(projectCanonicalCoverage(plan, evidence, 4))
    delete evidence.scheduledMortgagePaymentsExcluded
    expect(ok(projectCanonicalCoverage(plan, evidence, 4))).toEqual(verified)
    expect(verified.blocked).toBeNull()
    expect(verified.rows[0].taxLedger).toEqual(held.rows[0].taxLedger)
    expect(verified.rows[0].payrollContributions).toBe(held.rows[0].payrollContributions)
    expect(verified.rows[0].cashLedger.spending).toBe(held.rows[0].cashLedger.spending)
    expect(verified.rows[0].contributionLedger.allocationCashBasis - held.rows[0].contributionLedger.allocationCashBasis)
      .toBeCloseTo(PAYMENT, 6)
    for (const [index, row] of verified.rows.entries()) {
      expect(row.byDebt).toEqual({})
      expect(row.byProperty).toEqual(held.rows[index].byProperty)
      expect(row.cashLedger.debtPayments).toBe(0)
      if (index) {
        const { gross, tax } = retirementDraw(LIVING_RETIRE, 0, CPI ** index)
        expect(row.byAccount[RRSP].withdrawal).toBeCloseTo(gross, 6)
        expect(row.taxLedger[RETIREE].tax).toBeCloseTo(tax, 6)
      }
    }
  })

  it.each([undefined, { status: 'unknown', reason: 'not supplied' }, known(false), known('true'), { value: true }, true])(
    'refuses missing, negative or malformed living-spending exclusion %j atomically',
    flag => {
      const { plan, evidence } = fixture()
      evidence.scheduledMortgagePaymentsExcluded = flag as WorkingSpendingEvidence['scheduledMortgagePaymentsExcluded']
      expect(ok(projectCanonicalCoverage(plan, evidence, 4))).toMatchObject({
        rows: [], state: ok(initializeState(plan)), uncomputedYears: [2027, 2028, 2029],
        blocked: { year: BASE_YEAR, status: 'unsupported',
          issues: [{ detail: 'mortgage spending evidence must explicitly exclude scheduled payments' }] },
      })
    },
  )

  it('honours mandatory mortgage priority over living costs and has no payment in the year after maturity', () => {
    const { plan, evidence } = cashLimited(4_600)
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows[0].payrollContributions).toBeCloseTo(701.35, 6)
    expect(coverage.rows[0].byAccount[TFSA].contribution).toBe(0)
    const expected = [
      { interest: 331, principal: 1_000, closing: 2_310, payment: 1_331, withdrawal: 0, worth: 512_382 },
      { interest: 231, principal: 1_100, closing: 1_210, payment: 1_331, withdrawal: 3_371, worth: 520_337.42 },
      { interest: 121, principal: 1_210, closing: 0, payment: 1_331, withdrawal: 1_347.42, worth: 530_604 },
      { interest: 0, principal: 0, closing: 0, payment: 0, withdrawal: 0, worth: 541_216.08 },
    ]
    for (const [index, row] of coverage.rows.entries()) {
      const { interest, principal, closing, payment, withdrawal, worth } = expected[index]
      expect(row.byDebt[LIEN]).toMatchObject({ interest: close(interest), principal: close(principal), closing: close(closing), payment: close(payment) })
      expect(row.byAccount[TFSA].withdrawal).toBeCloseTo(withdrawal, 6)
      expect(sumNetWorth(ok(projectCanonicalCoverage(plan, evidence, index + 1)).state)).toBeCloseTo(worth, 6)
      if (index) {
        const due = 2_000 * CPI ** index
        expect(row.retirementSettlement).toMatchObject({
          spendingDue: close(due), spendingFunded: close(withdrawal - payment), spendingUnmet: close(due - withdrawal + payment),
        })
        expect(row.cashLedger).toMatchObject({ tax: 0, debtPayments: close(payment), spending: close(withdrawal - payment) })
      }
    }
  })

  it('rolls back the first unpayable installment to the exact preceding prefix, including TFSA history and home growth', () => {
    const { plan, evidence } = cashLimited(4_580)
    const original = structuredClone({ plan, evidence })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(prefix.state.byAccount[TFSA].balance).toBeCloseTo(1_326.612, 6)
    expect(prefix.state.byDebt[LIEN]).toMatchObject({ principal: close(1_210), yearsRemaining: 1 })
    expect(prefix.state.tfsaWithdrawalHistory).toMatchObject([{ calendarYear: 2027, amount: close(3_371) }])
    const failed = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(failed).toMatchObject({
      rows: prefix.rows, state: prefix.state, uncomputedYears: [2029],
      blocked: { year: 2028, status: 'unsupported', issues: [{ detail: 'mortgage scheduled payment cannot be fully funded' }] },
    })
    const sheet = canonicalAnnualSheet(failed, CONTEXT)
    for (const path of [['debt', LIEN, 'payment'], ['cash', 'spending'], ['netWorth']]) {
      const cells = findRow(sheet.rows, canonicalSheetId('value', ...path))!.cells!
      expect(cells[2027].value).not.toBeNull()
      for (const year of [2028, 2029]) expect(cells[year]).toMatchObject({ value: null, status: 'not-computed' })
    }
    expect({ plan, evidence }).toEqual(original)
  })

  it.each([0, -0.01])('settles only a fully funded mandatory installment with a cash difference of %s', difference => {
    const { plan, evidence } = cashLimited((1_331 + difference) / CPI)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    if (difference < 0) {
      expect(result).toMatchObject({ rows: prefix.rows, state: prefix.state,
        blocked: { year: 2027, status: 'unsupported', issues: [{ detail: 'mortgage scheduled payment cannot be fully funded' }] } })
    } else {
      expect(result.blocked).toBeNull()
      // Dividing by CPI to supply an opening balance can leave sub-picodollar
      // living cash on the shortest-decimal basis.
      expect(result.rows[1].cashLedger).toMatchObject({
        debtPayments: close(1_331), spending: expect.closeTo(0, 12), tax: 0, unallocated: 0,
      })
      expect(result.rows[1].retirementSettlement).toMatchObject({ spendingDue: 2_040, spendingUnmet: 2_040 })
      expect(result.rows[1].byAccount[TFSA]).toMatchObject({ withdrawal: close(1_331), closing: 0 })
      expect(result.state.byDebt[LIEN]).toMatchObject({ principal: close(1_210), yearsRemaining: 1 })
    }
  })

  it.each([
    { principal: PRINCIPAL, payment: 8_400 },
    { principal: 176_596.41, payment: 8_829.82, term: 20 },
  ])('rejects a genuinely underpaying loan term before posting any growth, savings or debt (%j)', terms => {
    const { plan, evidence } = fixture(terms)
    const opening = ok(initializeState(plan))
    expect(ok(projectCanonicalCoverage(plan, evidence, 4))).toMatchObject({
      rows: [], state: opening, uncomputedYears: [2027, 2028, 2029],
      blocked: { year: BASE_YEAR, status: 'invalid', issues: [{ detail: `debt cannot amortize: ${LIEN}` }] },
    })
  })

  it('settles a fully funded 20-year mortgage with the original fixed rate through exact maturity', () => {
    const term = 20
    const payment = 8_829.82
    const { plan, evidence } = fixture({ tfsa: 300_000, rrsp: 0, living: 2_000, principal: 120_000, payment, term })
    plan.lifeExpectancy = 77
    const before = structuredClone({ plan, evidence })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, term + 1))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows.map(row => row.year)).toEqual(Array.from({ length: term + 1 }, (_, year) => BASE_YEAR + year))

    // The rate solves the present value of 20 discounted end-of-year
    // installments at 65-digit decimal precision. Price each opening and
    // closing independently from its remaining installments.
    const fixedRate = 0.040000127393552068
    const presentValue = (years: number) => Array.from({ length: years }, (_, i) => payment / (1 + fixedRate) ** (i + 1))
      .reduce((total, installment) => total + installment, 0)
    for (const [index, row] of coverage.rows.slice(0, term).entries()) {
      const remaining = term - index
      const opening = presentValue(remaining)
      const closing = presentValue(remaining - 1)
      const debt = row.byDebt[LIEN]
      expect(debt).toMatchObject({ propertyId: HOME, opening: expect.closeTo(opening, 8),
        payment, interest: expect.closeTo(opening * fixedRate, 8),
        principal: expect.closeTo(opening - closing, 8), closing: expect.closeTo(closing, 8) })
      expect(row.cashLedger.debtPayments).toBe(payment)
      if (index > 0) {
        expect(debt.opening).toBe(coverage.rows[index - 1].byDebt[LIEN].closing)
        expect(row.retirementSettlement?.spendingUnmet).toBeCloseTo(0, 8)
        expect(row.byAccount[TFSA].withdrawal - row.cashLedger.spending).toBeCloseTo(payment, 8)
      }
    }
    expect(ok(projectCanonicalCoverage(plan, evidence, 19)).state.byDebt[LIEN])
      .toMatchObject({ principal: expect.closeTo(presentValue(1), 8), yearsRemaining: 1 })
    expect(coverage.rows[19].byDebt[LIEN].closing).toBe(0)
    expect(coverage.rows[20].byDebt[LIEN]).toEqual({ propertyId: HOME, opening: 0, payment: 0, interest: 0, principal: 0, closing: 0 })
    expect(coverage.rows[20].cashLedger.debtPayments).toBe(0)
    expect(coverage.state.byDebt[LIEN]).toEqual({ propertyId: HOME, principal: 0, yearsRemaining: 0, annualPayment: payment })
    expect({ plan, evidence }).toEqual(before)
  })

  it('settles three full installments on a near-zero-interest mortgage without leaving a maturity balance', () => {
    const { plan, evidence } = fixture({ principal: 29_999.99, payment: 10_000 })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage.blocked).toBeNull()
    // Independently discount the three end-of-year installments and solve
    // the resulting equation at high precision. Only one cent of total
    // interest accrues across the three payments.
    const rate = 1.666667129629771e-7
    let principal = 29_999.99
    for (const row of coverage.rows.slice(0, 3)) {
      const interest = principal * rate
      const closing = principal + interest - 10_000
      expect(row.byDebt[LIEN]).toMatchObject({ opening: expect.closeTo(principal, 8),
        interest: expect.closeTo(interest, 8), principal: expect.closeTo(10_000 - interest, 8),
        payment: expect.closeTo(10_000, 8), closing: expect.closeTo(closing, 8) })
      principal = closing
    }
    expect(coverage.rows[2].byDebt[LIEN].closing).toBe(0)
    expect(coverage.rows[3].cashLedger.debtPayments).toBe(0)
    expect(coverage.state.byDebt[LIEN]).toMatchObject({ principal: 0, yearsRemaining: 0 })
  })

  it.each([
    [167_766.57, -1], [167_766.58, 0], [167_766.59, 1],
  ])('settles the 20-year schedule against a cash-only TFSA of %s CAD', (tfsa, remainingCents) => {
    const payment = 8_829.82
    const { wage, payroll, workingTax } = phaseReference
    const { plan, evidence } = fixture({
      tfsa, rrsp: 0, wage, working: wage - payroll - workingTax - payment,
      living: 0, principal: 120_000, payment, term: 20, inflation: 0,
    })
    plan.lifeExpectancy = 77
    const original = structuredClone({ plan, evidence })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 19))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows[0].byAccount[TFSA]).toMatchObject({ contribution: 0, withdrawal: 0, closing: tfsa })
    expect(prefix.state.byAccount[TFSA].balance).toBeCloseTo(payment + remainingCents / 100, 8)
    expect(prefix.state.byDebt[LIEN].yearsRemaining).toBe(1)

    const coverage = ok(projectCanonicalCoverage(plan, evidence, 21))
    if (remainingCents < 0) {
      expect(coverage).toMatchObject({ rows: prefix.rows, state: prefix.state, uncomputedYears: [2046],
        blocked: { year: 2045, status: 'unsupported', issues: [{ detail: 'mortgage scheduled payment cannot be fully funded' }] } })
    } else {
      expect(coverage).toMatchObject({ blocked: null, uncomputedYears: [] })
      expect(coverage.rows.slice(0, 19)).toEqual(prefix.rows)
      expect(coverage.rows.slice(0, 20).map(row => row.cashLedger.debtPayments)).toEqual(Array(20).fill(payment))
      for (const [index, row] of coverage.rows.slice(1, 20).entries()) {
        const account = row.byAccount[TFSA]
        expect(account).toMatchObject({ contribution: 0, returnAmount: 0,
          withdrawal: expect.closeTo(payment, 8), closing: expect.closeTo(tfsa - (index + 1) * payment, 8) })
        expect(account.opening - account.withdrawal).toBeCloseTo(account.closing, 8)
        expect(row.cashLedger).toMatchObject({ tax: 0, spending: 0, unallocated: 0 })
      }
      const withdrawals = coverage.state.tfsaWithdrawalHistory!
      expect(withdrawals.map(entry => entry.calendarYear)).toEqual(coverage.rows.slice(1, 20).map(row => row.year))
      expect(withdrawals.map(entry => entry.amount)).toEqual(coverage.rows.slice(1, 20).map(row => row.byAccount[TFSA].withdrawal))
      expect(withdrawals.reduce((total, entry) => total + entry.amount, 0)).toBeCloseTo(167_766.58, 8)
      const maturity = coverage.rows[19]
      const following = coverage.rows[20]
      expect(maturity.year).toBe(2045)
      expect(maturity.byDebt[LIEN].closing).toBe(0)
      expect(following.year).toBe(2046)
      expect(following.cashLedger.debtPayments).toBe(0)
      expect(following.byAccount[TFSA].withdrawal).toBe(0)
      expect(coverage.state.byDebt[LIEN]).toMatchObject({ principal: 0, yearsRemaining: 0 })
      expect(coverage.state.byAccount[TFSA].balance).toBeCloseTo(remainingCents / 100, 8)
      expect(sumInvestableAssets(coverage.state)).toBeCloseTo(remainingCents / 100, 8)
      if (remainingCents === 0) {
        expect(coverage.state.byAccount[TFSA].balance).toBe(0)
        const sheet = canonicalAnnualSheet(coverage, CONTEXT)
        const funded = findRow(sheet.rows, canonicalSheetId('value', 'retirement', 'spendingFunded'))!.cells![2045]
        const formula = sheet.resolveExplanation!(funded.explanationRefs![0])!.formula!
        expect(formula.reduce((sum, term) => sum + (term.direction === 'subtract' ? -1 : 1) * (term.value ?? 0), 0)).toBe(0)
      }
    }
    expect({ plan, evidence }).toEqual(original)
  })

  it.each([0, -1e-12])('distinguishes exact tiny mortgage cash from a shortage of %s CAD', difference => {
    const payment = 1e-8
    const { plan, evidence } = fixture({ tfsa: payment + difference, rrsp: 0, wage: 1,
      working: 1 - 0.0163 - payment, living: 0, principal: 2 * payment, payment, term: 2, inflation: 0 })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    if (difference < 0) {
      expect(result).toMatchObject({ rows: prefix.rows, state: prefix.state,
        blocked: { year: 2027, status: 'unsupported', issues: [{ detail: 'mortgage scheduled payment cannot be fully funded' }] } })
    } else {
      expect(result.blocked).toBeNull()
      expect(result.rows[1].cashLedger.debtPayments).toBe(payment)
      expect(result.rows[1].byAccount[TFSA]).toMatchObject({ withdrawal: payment, closing: 0 })
      expect(result.state.byDebt[LIEN]).toMatchObject({ principal: 0, yearsRemaining: 0 })
    }
  })

  // The second balance is short in decimal CAD even though adding it to
  // 130.61 as JavaScript Numbers gives exactly 1,331.
  it.each([1_200.38, 1_200.3899999999999, 1_200.39, 5_000])('settles the TFSA-first mortgage quote with an RRSP opening of %s CAD', rrsp => {
    const payment = 1_331
    const { plan, evidence } = fixture({ tfsa: 130.61, rrsp, wage: 12_000, working: 9_967.65,
      living: 0, principal: 2 * payment, payment, term: 2, inflation: 0 })
    plan.strategy = 'tfsaFirst'
    const before = structuredClone({ plan, evidence })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows[0]).toMatchObject({
      payrollContributions: close(701.35),
      cashLedger: { income: 12_000, tax: 0, debtPayments: payment, spending: 9_967.65 },
      byAccount: { [TFSA]: { contribution: 0, withdrawal: 0, closing: 130.61 },
        [RRSP]: { contribution: 0, withdrawal: 0, closing: rrsp } },
    })
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    if (rrsp < 1_200.39) {
      expect(result.blocked).toMatchObject({ year: 2027, status: 'unsupported',
        issues: [{ detail: 'mortgage scheduled payment cannot be fully funded' }] })
      expect(result).toMatchObject({ rows: prefix.rows, state: prefix.state, uncomputedYears: [2028] })
    } else {
      expect(result.blocked).toBeNull()
      expect(result.rows[0]).toEqual(prefix.rows[0])
      const [, retired, next] = result.rows
      // 1,331.00 − 130.61 = 1,200.39, below both basic personal amounts
      // and the Ontario health-premium threshold.
      expect(retired).toMatchObject({
        year: 2027,
        taxLedger: { [RETIREE]: { taxableIncome: 1_200.39, tax: 0 } },
        cashLedger: { debtPayments: payment, tax: 0, spending: 0, unallocated: 0 },
        byDebt: { [LIEN]: { opening: payment, interest: 0, principal: payment, payment, closing: 0 } },
        byAccount: { [TFSA]: { opening: 130.61, withdrawal: 130.61, closing: 0 },
          [RRSP]: { opening: rrsp, withdrawal: 1_200.39, closing: close(rrsp - 1_200.39) } },
        retirementSettlement: { spendingDue: 0, spendingFunded: 0, spendingUnmet: 0 },
      })
      expect(retired.payrollContributions ?? 0).toBe(0)
      expect(result.state.tfsaWithdrawalHistory).toMatchObject([{ calendarYear: 2027, amount: 130.61 }])
      expect(next).toMatchObject({ year: 2028, cashLedger: { debtPayments: 0, tax: 0 },
        byAccount: { [TFSA]: { withdrawal: 0 }, [RRSP]: { withdrawal: 0 } } })
      expect(result.state.byDebt[LIEN]).toMatchObject({ principal: 0, yearsRemaining: 0 })
    }
    expect({ plan, evidence }).toEqual(before)
  })

  it.each([
    [25_602.56, true], [25_602.559999999, false],
  ] as const)('prices mortgage cash through a final working-year loss with TFSA %s CAD', (tfsa, fullyFunded) => {
    const payment = 100.01
    const { plan, evidence } = fixture({ tfsa, rrsp: 0, wage: 12_000,
      working: 12_000 - 701.35 - payment, living: 0, principal: 2 * payment, payment, term: 2, inflation: 0 })
    plan.accounts.find(account => account.id === TFSA)!.realReturn = -255 / 256
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    const [working] = prefix.rows
    // Adding the return amount to the original balance can lose precision
    // here. The independently calculated terminal value is opening / 256.
    expect(working.byAccount[TFSA]).toMatchObject({ opening: tfsa, contribution: 0, withdrawal: 0 })
    expect(working.byAccount[TFSA].closing).toBeCloseTo(tfsa / 256, 10)
    const account = working.byAccount[TFSA]
    expect(account.opening + account.returnAmount + (account.mortgageArithmeticReconciliation ?? 0)).toBe(account.closing)
    expect(working.cashLedger.debtPayments).toBe(payment)
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    if (!fullyFunded) {
      expect(result.blocked).toMatchObject({ year: 2027, status: 'unsupported',
        issues: [{ detail: 'mortgage scheduled payment cannot be fully funded' }] })
      expect(result).toMatchObject({ rows: prefix.rows, state: prefix.state, uncomputedYears: [2028] })
      return
    }
    expect(result.blocked).toBeNull()
    const [, retirement, next] = result.rows
    expect(retirement.year).toBe(2027)
    expect(retirement.byAccount[TFSA].opening).toBe(working.byAccount[TFSA].closing)
    expect(retirement.byAccount[TFSA]).toMatchObject({ withdrawal: expect.closeTo(payment, 10), closing: 0 })
    expect(retirement.byDebt[LIEN]).toMatchObject({ payment, closing: 0 })
    expect(retirement.cashLedger).toMatchObject({ debtPayments: payment, tax: 0, spending: 0 })
    expect(next.byAccount[TFSA]).toMatchObject({ withdrawal: 0, closing: 0 })
    expect(next.cashLedger.debtPayments).toBe(0)
  })

  it.each([
    { tfsa: 10_000_000_002_000, firstLiving: 1e13, payment: 1_000, balance: 1_000, inflation: 0 },
    { tfsa: 10_000_000_001_999.998, firstLiving: 1e13, payment: 1_000, balance: 999.998, inflation: 0 },
    { tfsa: 10_000_000_001_999.99, firstLiving: 1e13, payment: 1_000, balance: 999.99, inflation: 0 },
    { tfsa: 10_000_000_001_999.998, firstLiving: 1e13, payment: 1_000, balance: 999.998, inflation: -0.5 },
    { tfsa: 10_000.00000002, firstLiving: 10_000, payment: 1e-8, balance: 1e-8, inflation: 0 },
    { tfsa: 10_000.000000019998, firstLiving: 10_000, payment: 1e-8, balance: 9.998e-9, inflation: 0 },
    // The nearest Number sum is 10000.000000014901. Its shortest decimal
    // is below the exact bill, so the next quote is the first sufficient one.
    { tfsa: 10_000 + 2 * 2 ** -26 - 2 ** -39, firstLiving: 10_000, payment: 2 ** -26,
      firstDraw: 10_000.000000014903, balance: 1.4897e-8, inflation: 0 },
  ])('distinguishes exact late funding from a shortfall at TFSA $tfsa and inflation $inflation', ({ tfsa, firstLiving, payment, balance, inflation, firstDraw = firstLiving + payment }) => {
    const tiny = payment < 1
    const { plan, evidence } = fixture({ tfsa, rrsp: 0, wage: tiny ? 1 : 12_000,
      working: (tiny ? 0.9837 : 11_298.65) - payment, living: firstLiving / (1 + inflation),
      principal: 3 * payment, payment, term: 3, inflation })
    if (inflation) plan.accounts.find(account => account.id === TFSA)!.realReturn = 1
    const original = structuredClone({ plan, evidence })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows[0].byAccount[TFSA]).toMatchObject({ contribution: 0, closing: tfsa })
    expect(prefix.rows[1].byAccount[TFSA].withdrawal).toBe(firstDraw)
    expect(prefix.state.byDebt[LIEN]).toMatchObject({ principal: expect.closeTo(payment, 12), yearsRemaining: 1 })
    expect(prefix.state.byAccount[TFSA].balance).toBeCloseTo(balance, tiny ? 14 : 3)
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    if (balance < payment) {
      expect(prefix.state.byAccount[TFSA].balance).toBeLessThan(payment)
      expect(result.blocked).toMatchObject({ year: 2028, status: 'unsupported',
        issues: [{ detail: 'mortgage scheduled payment cannot be fully funded' }] })
      expect(result).toMatchObject({ rows: prefix.rows, state: prefix.state, uncomputedYears: [2029] })
    } else {
      expect(result.blocked).toBeNull()
      expect(result.rows[2].byDebt[LIEN]).toMatchObject({ payment, closing: 0 })
      expect(result.rows[2].cashLedger).toMatchObject({ debtPayments: payment, spending: 0, tax: 0 })
      expect(result.rows[2].byAccount[TFSA]).toMatchObject({ withdrawal: expect.closeTo(payment, tiny ? 11 : 3), closing: 0 })
      expect(result.rows[3].cashLedger.debtPayments).toBe(0)
    }
    expect({ plan, evidence }).toEqual(original)
  })

  it.each([[-0.01, 0.01], [0, 0], [0.01, null]] as const)(
    'uses exact working cash after payroll and debt at a living-spending change of %s',
    (difference, expectedContribution) => {
      const { plan, evidence } = fixture({
        wage: 4_500, working: 3_036.15 + difference, principal: 3_310, payment: 1_331,
      })
      const coverage = ok(projectCanonicalCoverage(plan, evidence, 1))
      if (expectedContribution === null) {
        expect(coverage).toMatchObject({ rows: [], state: ok(initializeState(plan)),
          blocked: { year: BASE_YEAR, status: 'unsupported' } })
      } else {
        expect(coverage.blocked).toBeNull()
        const [row] = coverage.rows
        expect(row.payrollContributions).toBeCloseTo(132.85, 6)
        expect(row.cashLedger).toMatchObject({ income: 4_500, tax: 0, debtPayments: 1_331, spending: close(3_036.15 + difference) })
        expect(row.byAccount[TFSA].contribution).toBe(expectedContribution)
        expect(row.workingSettlement?.netCash).toBeCloseTo(expectedContribution, 6)
      }
    },
  )

  it.each([
    ['missing reciprocal link', (plan: ReturnType<typeof fixture>['plan']) => { plan.properties[0].mortgageDebtId = null }],
    ['unrecorded debt', (plan: ReturnType<typeof fixture>['plan']) => { plan.debts[0].provenance = { origin: 'estimated', sourceYear: BASE_YEAR } }],
    ['a second home', (plan: ReturnType<typeof fixture>['plan']) => {
      plan.properties.push({ ...plan.properties[0], id: 'another-home', mortgageDebtId: null })
    }],
  ] as const)('refuses %s even when living-spending evidence is supplied', (_, change) => {
    const { plan, evidence } = fixture()
    change(plan)
    expect(ok(projectCanonicalCoverage(plan, evidence, 4))).toMatchObject({
      rows: [], state: ok(initializeState(plan)), blocked: { year: BASE_YEAR, status: 'unsupported' },
    })
  })

  it('keeps public working, standalone retirement and provider paths confined to their existing contracts', () => {
    const { plan, evidence } = fixture()
    const working = ok(projectCanonicalCoverage(plan, evidence, 1))
    const opening = ok(initializeState(plan))
    for (const supplied of [opening, working.state, structuredClone(working.state)]) {
      expect(evaluateCanonicalWorkingYear(plan, evidence, supplied.year, supplied).status).toBe('unsupported')
      expect(annualRetirementContinuation(plan, supplied, evidence).status).toBe('invalid')
    }
    const returns = vi.fn(() => 0)
    const invalid = { status: 'invalid', issues: [{ code: 'invalid', detail: 'mortgage decimal balances require authenticated generated state' }] }
    for (const supplied of [working.state, structuredClone(working.state)]) {
      expect(annualRetirementStep(plan, supplied, returns)).toEqual(invalid)
      expect(projectRetirementCoverage(plan, supplied, 2, returns)).toEqual(invalid)
    }
    const unprovedState = structuredClone(working.state)
    delete unprovedState.mortgageExactBalances
    expect(annualRetirementStep(plan, unprovedState, returns).status).toBe('unsupported')
    expect(ok(projectRetirementCoverage(plan, unprovedState, 2, returns))).toMatchObject({
      rows: [], state: unprovedState, blocked: { year: 2027, status: 'unsupported' },
    })
    expect(returns).not.toHaveBeenCalled()
    const providers = {
      evaluate: () => ({ byPerson: { [RETIREE]: { income: PAYMENT, earnedIncome: PAYMENT, benefits: 0,
        tax: 0, spending: 0, taxableIncome: PAYMENT, benefitIncomeForNextYear: known(PAYMENT) } } }),
      returns: () => 0,
    }
    expect(annualStep(plan, working.state, providers)).toEqual(invalid)
    expect(annualStep(plan, opening, providers).status).toBe('unsupported')
    const providerPlan = { ...plan, budget: { kind: 'savingsBudget' as const, annualNetSavings: 0,
      retirementSpending: LIVING_RETIRE, debtIncluded: known(true), taxBenefitIncluded: known(true) } }
    const providerOpening = ok(initializeState(providerPlan))
    const provided = ok(projectAnnualCoverage(providerPlan, providerOpening, 1, providers))
    expect(provided).toMatchObject({ blocked: null, evaluationBasis: 'provider-supplied' })
    // Pin the original provider recurrence independently of the generated
    // remaining-payment PV schedule. The two models differ by a few ULPs.
    expect(provided.rows[0].byDebt).toEqual({ [LIEN]: {
      propertyId: HOME, opening: 25_220, interest: 1_260.9999999999964,
      principal: 8_000.000000000004, payment: 9_261, closing: 17_219.999999999996,
    } })
    expect(provided.rows[0].cashLedger).toMatchObject({ income: PAYMENT, spending: 0, debtPayments: PAYMENT })
    expect(provided.rows[0].workingSettlement).toBeUndefined()
    expect(ok(projectFromState(providerPlan, providerOpening, 1, providers))).toEqual({ rows: provided.rows, state: provided.state })
    const badPlan = { ...providerPlan, debts: [{ ...plan.debts[0], annualPayment: 8_400 }] }
    const invalidOpening = ok(initializeState(badPlan))
    const invalidDebt = { status: 'invalid', issues: [{ code: 'invalid', detail: `debt cannot amortize: ${LIEN}` }] }
    expect(annualStep(badPlan, invalidOpening, providers)).toEqual(invalidDebt)
    expect(projectFromState(badPlan, invalidOpening, 2, providers)).toEqual(invalidDebt)
    expect(ok(projectAnnualCoverage(badPlan, invalidOpening, 2, providers))).toMatchObject({
      blocked: { year: BASE_YEAR, ...invalidDebt }, rows: [], state: invalidOpening, uncomputedYears: [2027],
    })
    expect(invalidOpening).toEqual(ok(initializeState(badPlan)))
    expect(providerOpening).toEqual(ok(initializeState(providerPlan)))
  })

  it('preserves the production projection, capture adapter and sampled run when canonical mortgage data is present', () => {
    const { plan, evidence } = fixture()
    const inputs = plan.legacyProjection
    const withoutCanonicalHome = { ...plan, properties: [], debts: [] }
    const observed = runProjection(inputs, undefined, plan, { captureAnnualDetails: true })
    const legacy = runProjection(inputs, undefined, withoutCanonicalHome, { captureAnnualDetails: true })
    expect(observed).toEqual(legacy)
    expect({ ...observed, rows: observed.rows.map(({ annualDetails: _details, ...row }) => row) })
      .toEqual(runProjection(inputs, undefined, plan))
    expect(legacyAnnualSheet(observed, inputs, CONTEXT).rows).toEqual(legacyAnnualSheet(legacy, inputs, CONTEXT).rows)
    const sample = vi.fn(() => -0.10)
    expect(runProjection(inputs, sample, plan)).toEqual(runProjection(inputs, () => -0.10, withoutCanonicalHome))
    expect(sample).toHaveBeenCalledWith(57, 'tfsa')

    const canonical = ok(projectCanonicalCoverage(plan, evidence, 4))
    for (const [index, row] of observed.rows.entries()) {
      const debt = canonical.rows[index].byDebt[LIEN]
      const endCpi = CPI ** (index + 1)
      expect(row.propertyValue).toBeCloseTo(HOME_VALUE, 6)
      expect(row.debtPayment).toBeCloseTo(debt.payment / endCpi, 6)
      expect(row.debtBalance).toBeCloseTo(debt.closing / endCpi, 6)
      expect(row.taxableBySource.property).toBe(0)
    }
  })
})
