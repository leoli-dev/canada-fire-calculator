import { describe, expect, it, vi } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { annualRetirementContinuation, annualRetirementStep } from '../annualRetirement'
import {
  annualStep, initializeState, projectAnnualCoverage, projectCanonicalCoverage, projectFromState,
  sumInvestableAssets, sumNetWorth, type AnnualCoverage, type AnnualProviders, type KernelResult,
} from '../annualState'
import { evaluateCanonicalHouseholdWorkingYear, type WorkingSpendingEvidence } from '../annualWorking'
import { runProjection } from '../projection'
import { BASE_YEAR, known, legacyRetirement, recorded, retirementPlan, RETIREE, RRSP, TFSA } from './fixtures/retirementSettlement'

const PARTNER = 'younger-partner'
const HOME = 'household-home'
const LIEN = 'fixed-home-loan'
const VALUE = 480_000
const ACB = 245_000
const APPRECIATION = 0.015
const CPI = 1.02
const PAYMENT = 9_261
const PRINCIPAL = 25_220
const OPENING_TFSA = 22_000
const CONTEXT = { scenarioId: 'household-fixed-mortgage', revision: 1 }
const close = (value: number) => expect.closeTo(value, 6)

// The 2026 Ontario snapshot supplies the first brackets and nonrefundable
// credits. No transfer of an unused spouse credit is elected in this fixture.
const selfPayroll = 36_500 * 0.0595 + 40_000 * 0.0163
const selfPayrollCredit = 36_500 * 0.0495 + 40_000 * 0.0163
const selfTaxable = 40_000 - 365
const selfTax = (selfTaxable - 16_452 - 1_501 - selfPayrollCredit) * 0.14
  + (selfTaxable - 12_989 - selfPayrollCredit) * 0.0505 + 450
const partnerPayroll = 8_500 * 0.0595 + 12_000 * 0.0163
const partnerTaxable = 12_000 - 85
const partnerNet = 11_298.65
const workingLiving = 34_851.188875

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function fixture({
  tfsa = OPENING_TFSA, inflation = 0.02, selfWage = 40_000, partnerWage = 12_000,
  working = workingLiving, mixed = partnerNet, retired = 5_000, payment = PAYMENT, principal = PRINCIPAL,
  term = 3, selfAge = 52, title = 'split', reverse = false,
} = {}) {
  const plan = retirementPlan({ age: selfAge, tfsa, rrsp: 0, inflation, spending: retired, strategy: 'tfsaFirst' })
  const self = plan.people[0]
  Object.assign(self, { retirementAge: selfAge + 1, earnedIncome: known(selfWage) })
  const partner = {
    ...structuredClone(self), id: PARTNER, role: 'partner' as const,
    ageInBaseYear: selfAge - 1, earnedIncome: known(partnerWage),
  }
  plan.people.push(partner)
  plan.accounts = plan.accounts.filter(account => account.id === TFSA)
  plan.tfsaStatement![PARTNER] = { withdrawals: [], provenance: recorded }
  plan.taxProfile = { spouseSupported: known(false), pensionSplit: null }
  plan.budget = { kind: 'incomeBudget', workingSpending: working, retirementSpending: retired }
  plan.lifeExpectancy = 69
  const shares: Record<string, number> = title === 'partner' ? { [PARTNER]: 1 }
    : title === 'self' ? { [RETIREE]: 1 } : { [RETIREE]: 0.375, [PARTNER]: 0.625 }
  plan.properties.push({
    id: HOME, kind: 'principal', value: VALUE, acb: known(ACB), annualRent: known(0),
    appreciation: APPRECIATION, annualHoldingCostChange: 0, sellAtAge: null, plannedPurchaseAge: null,
    plannedDownPayment: null, plannedMortgage: null, mortgageDebtId: LIEN,
    taxableOwnerShares: { status: 'known', shares },
    provenance: { value: recorded, acb: recorded, taxableOwnerShares: recorded },
  })
  plan.debts.push({ id: LIEN, propertyId: HOME, kind: 'mortgage', principal, annualPayment: payment,
    yearsRemaining: term, provenance: recorded })
  plan.legacyProjection = legacyRetirement({
    currentAge: selfAge, fireAge: selfAge + 1, lifeExpectancy: selfAge + 4, inflation,
    retirementSpending: retired, strategy: plan.strategy, balances: { tfsa, rrsp: 0, nonReg: 0 },
    partner: { currentAge: partner.ageInBaseYear, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
    principalResidence: { value: VALUE, appreciation: APPRECIATION, sellAtAge: null,
      mortgage: { balance: principal, annualPayment: payment, yearsRemaining: term } },
  })
  if (reverse) plan.people.reverse()
  const evidence: WorkingSpendingEvidence = {
    workingSpending: known(working), transitionSpending: known(mixed), retirementSpending: known(retired),
    scheduledMortgagePaymentsExcluded: known(true),
  }
  return { plan, evidence }
}

function sheetRow(rows: AnnualSheetRow[], ...path: string[]): AnnualSheetRow {
  const id = canonicalSheetId('value', ...path)
  const row = rows.find(row => row.id === id) ?? rows.flatMap(row => row.children ?? []).find(row => row.id === id)
  if (!row) throw new Error(`Missing annual sheet row ${id}`)
  return row
}

describe('FE-53 S2 independent household mortgage ledger', () => {
  it.each(['split', 'self', 'partner'])('settles a fixed mortgage with %s title in inverse person order', title => {
    const { plan, evidence } = fixture({ title, reverse: title !== 'split' })
    const original = structuredClone({ plan, evidence })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false,
      evaluationBasis: 'canonical-continuous' })
    expect(coverage.rows.map(row => row.year)).toEqual([2026, 2027, 2028, 2029])
    const sheet = canonicalAnnualSheet(coverage, CONTEXT)

    // Work backwards from zero at maturity with 5% annual interest.
    // Independently apply 2% CPI to wages, living costs, and the remaining
    // zero-real-return TFSA. The contractual payment stays in nominal CAD.
    const schedule = [
      { opening: 25_220, interest: 1_261, principal: 8_000, payment: 9_261, closing: 17_220 },
      { opening: 17_220, interest: 861, principal: 8_400, payment: 9_261, closing: 8_820 },
      { opening: 8_820, interest: 441, principal: 8_820, payment: 9_261, closing: 0 },
      { opening: 0, interest: 0, principal: 0, payment: 0, closing: 0 },
    ]
    const due = [workingLiving, 11_524.623, 5_202, 5_306.04]
    const funded = [workingLiving, 11_524.623, 4_181.58, 0]
    const openings = [22_000, 22_440, 13_442.58, 0]
    const balances = [22_440, 13_442.58, 0, 0]
    const draws = [0, 9_261, 13_442.58, 0]
    const phases = ['both-working', 'mixed', 'both-retired', 'both-retired']
    for (const [index, row] of coverage.rows.entries()) {
      const cpi = CPI ** index
      const endCpi = cpi * CPI
      const gross = index === 0 ? 52_000 : index === 1 ? 12_000 : 0
      const payroll = index === 0 ? selfPayroll + partnerPayroll : index === 1 ? partnerPayroll : 0
      const tax = index === 0 ? selfTax : 0
      const debt = schedule[index]
      expect(row).toMatchObject({
        workingSettlement: { household: { phase: phases[index], byPerson: {
          [RETIREE]: { grossWagesReal: index === 0 ? 40_000 : 0 },
          [PARTNER]: { grossWagesReal: index < 2 ? 12_000 : 0 },
        } } },
        byPerson: { [RETIREE]: { benefits: 0 }, [PARTNER]: { benefits: 0 } },
        payrollContributions: close(payroll * cpi),
        taxLedger: {
          [RETIREE]: { taxableIncome: close(index === 0 ? selfTaxable : 0), tax: close(tax) },
          [PARTNER]: { taxableIncome: close(index < 2 ? partnerTaxable * cpi : 0), tax: 0 },
        },
        cashLedger: { income: close(gross * cpi), benefits: 0, tax: close(tax),
          debtPayments: debt.payment, spending: close(funded[index]), unallocated: 0 },
        byAccount: { [TFSA]: { opening: close(openings[index]), closing: close(balances[index]),
          withdrawal: close(draws[index]), contribution: 0, ownerId: RETIREE } },
      })
      expect(row.byDebt).toEqual({ [LIEN]: {
        propertyId: HOME, opening: close(debt.opening), principal: close(debt.principal),
        closing: close(debt.closing), interest: close(debt.interest), payment: debt.payment,
      } })
      expect(row.byPerson[RETIREE].cpp ?? 0).toBe(0)
      expect(row.byPerson[PARTNER].cpp ?? 0).toBe(0)
      const household = row.workingSettlement!
      if (!('household' in household)) throw new Error('Missing household payroll memo')
      expect(household.household.byPerson[RETIREE].payrollReal).toEqual(index === 0
        ? expect.objectContaining({ contributions: close(selfPayroll), taxDeduction: close(365) }) : null)
      expect(household.household.byPerson[PARTNER].payrollReal).toEqual(index < 2
        ? expect.objectContaining({ contributions: close(partnerPayroll), taxDeduction: close(85) }) : null)
      expect(row.cashLedger.income + draws[index] - row.payrollContributions! - row.cashLedger.tax
        - row.cashLedger.debtPayments).toBeCloseTo(funded[index], 6)
      expect(row.householdWithdrawalSettlement).toMatchObject({
        spendingDue: close(due[index]), spendingFunded: close(funded[index]),
        spendingUnmet: close(due[index] - funded[index]), withdrawal: close(draws[index]), taxIncrement: 0,
      })
      if (index > 0) {
        expect(row.byDebt[LIEN].opening).toBe(coverage.rows[index - 1].byDebt[LIEN].closing)
      }
      const cell = sheetRow(sheet.rows, 'retirement', 'spendingFunded').cells![row.year]
      const formula = sheet.resolveExplanation!(cell.explanationRefs![0])!.formula!
      expect(formula.filter(term => term.field === 'debtPayments')).toEqual(debt.payment
        ? [expect.objectContaining({ value: debt.payment, direction: 'subtract' })] : [])
      expect(formula.reduce((sum, term) => sum + (term.direction === 'subtract' ? -1 : 1) * (term.value ?? 0), 0))
        .toBeCloseTo(funded[index], 6)

      const prefix = ok(projectCanonicalCoverage(plan, evidence, index + 1))
      expect(prefix.rows).toEqual(coverage.rows.slice(0, index + 1))
      expect(prefix.state.byDebt[LIEN]).toMatchObject({ principal: close(debt.closing), yearsRemaining: Math.max(0, 2 - index) })
      const homeClosing = VALUE * ((1 + APPRECIATION) * CPI) ** (index + 1)
      expect(prefix.state.byProperty[HOME]).toEqual({ held: true, acb: known(ACB), value: close(homeClosing) })
      expect(sumInvestableAssets(prefix.state)).toBeCloseTo(balances[index], 6)
      const worth = homeClosing + balances[index] - debt.closing
      expect(sumNetWorth(prefix.state)).toBeCloseTo(worth, 6)
      expect(sheetRow(sheet.rows, 'netWorth').cells![row.year].value).toBeCloseTo(worth, 6)
      for (const [field, amount] of Object.entries(debt)) {
        const timing = field === 'opening' ? 'opening' : field === 'closing' ? 'closing' : 'during-year'
        const debtCell = sheetRow(sheet.rows, 'debt', LIEN, field).cells![row.year]
        expect(debtCell).toMatchObject({ timing, basis: 'nominal-CAD', value: close(amount) })
        expect(annualSheetDisplayValue(debtCell, sheet.years[index], 'real')).toBeCloseTo(amount / (field === 'closing' ? endCpi : cpi), 6)
      }
    }
    expect(coverage.state.tfsaWithdrawalHistory).toMatchObject([
      { calendarYear: 2027, amount: 9_261 }, { calendarYear: 2028, amount: 13_442.58 },
    ])
    expect(coverage.state.byDebt[LIEN]).toMatchObject({ principal: 0, yearsRemaining: 0 })
    const paymentCell = sheetRow(sheet.rows, 'debt', LIEN, 'payment').cells![2027]
    const explanation = sheet.resolveExplanation!(paymentCell.explanationRefs![0])!
    for (const [locale, text] of [
      ['en', /fixed nominal payment.*separate from living spending.*no tax deduction/i],
      ['fr', /paiement nominal fixe.*distinct des dépenses courantes.*pas déduits/i],
      ['zh', /固定名义付款.*单列于生活支出之外.*不作税务扣除/],
    ] as const) {
      expect(annualSheetText(explanation.summary!, locale)).toMatch(text)
    }
    for (const [locale, reason] of [
      ['en', /spending evidence explicitly excludes scheduled payments.*paid once before living costs/i],
      ['fr', /dépenses excluent explicitement les paiements prévus.*payée une fois avant les dépenses courantes/i],
      ['zh', /支出证据均明确排除计划还款.*生活支出前仅支付一次/],
    ] as const) {
      expect(annualSheetText(sheet.scope, locale)).toMatch(reason)
    }
    expect({ plan, evidence }).toEqual(original)
  })

  it('identifies the funded ordinary TFSA and the excluded positive balances in each locale', () => {
    const { plan, evidence } = fixture()
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage.blocked).toBeNull()
    const sheet = canonicalAnnualSheet(coverage, CONTEXT)
    for (const [locale, funding, exclusion, benefits] of [
      ['en', /one funded ordinary TFSA/i, /positive RRSP or other account balances are unsupported/i, /public benefits must be explicitly zero/i],
      ['fr', /un CELI ordinaire approvisionné/i, /soldes positifs REER ou d’autres comptes ne sont pas pris en charge/i, /prestations publiques doivent être explicitement nulles/i],
      ['zh', /唯一有余额的普通 TFSA/, /不支持 RRSP 或其他账户的正余额/, /公共福利须明确为零/],
    ] as const) {
      const scope = annualSheetText(sheet.scope, locale)
      expect(scope).toMatch(funding)
      expect(scope).toMatch(exclusion)
      expect(scope).toMatch(benefits)
    }
  })
})

describe('FE-53 S2 mortgage reconciliation evidence', () => {
  function expectReconciliation(
    coverage: AnnualCoverage,
    field: string,
    correction: number,
  ) {
    const sheet = canonicalAnnualSheet(coverage, CONTEXT)
    const cash = sheetRow(sheet.rows, 'cash', 'mortgageCashReconciliation').cells![2027]
    expect(cash).toMatchObject({ value: correction, timing: 'during-year', basis: 'nominal-CAD' })
    const funded = sheetRow(sheet.rows, 'retirement', 'spendingFunded').cells![2027]
    const formula = sheet.resolveExplanation!(funded.explanationRefs![0])!.formula!
    expect(formula.filter(term => term.field?.includes('mortgageCashReconciliation'))).toEqual([
      expect.objectContaining({ field, value: correction, direction: 'add', unit: 'CAD', basis: 'nominal-CAD' }),
    ])
    expect(formula.reduce((sum, term) => sum + (term.direction === 'subtract' ? -1 : 1) * (term.value ?? 0), 0))
      .toBeCloseTo(funded.value!, 12)
  }

  it('attributes the mixed-year reconciliation to the household settlement', () => {
    const { plan, evidence } = fixture({
      tfsa: 632.86, inflation: 0, selfWage: 4_500, partnerWage: 4_500, working: 3_734.30,
      mixed: 100, retired: 0, payment: 5_000, principal: 10_000, term: 2,
    })
    // Decimal cash is 5,000.01 after CPP/EI and the exhausted TFSA.
    // The left-to-right Number sum lands one ULP below the decimal result.
    const correction = 5_000.01 - (4_500 - 132.85 + 632.86)
    expect(correction).toBeGreaterThan(0)
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows[1].householdWithdrawalSettlement).toMatchObject({
      mortgageCashReconciliation: correction, withdrawal: 632.86, spendingFunded: 0.01,
    })
    expectReconciliation(coverage, 'householdWithdrawalSettlement.mortgageCashReconciliation', correction)
  })

  it('preserves the solo retirement settlement as the reconciliation source', () => {
    const { plan, evidence } = fixture({
      tfsa: 100.1, inflation: 0, selfWage: 12_000, working: 10_998.35,
      retired: 100, payment: 300.3, principal: 600.6, term: 2, title: 'self',
    })
    plan.people = plan.people.filter(person => person.role === 'self')
    delete plan.tfsaStatement![PARTNER]
    const rrsp = retirementPlan({ rrsp: 200.2 }).accounts.find(account => account.id === RRSP)!
    plan.accounts.push(rrsp)
    // Both accounts exhaust with no income tax. Their exact decimal sum
    // meets the full installment and leaves no cash for living costs.
    const correction = 300.3 - (100.1 + 200.2)
    expect(correction).toBeGreaterThan(0)
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows[1].retirementSettlement).toMatchObject({
      mortgageCashReconciliation: { amount: correction, basis: 'decimal-CAD' }, spendingFunded: 0,
    })
    expectReconciliation(coverage, 'retirementSettlement.mortgageCashReconciliation.amount', correction)
  })
})

describe('FE-53 S2 mortgage funding boundaries', () => {
  const shortage = { status: 'unsupported', issues: [{ detail: 'mortgage scheduled payment cannot be fully funded' }] }

  it('commits an exactly funded first year despite a calculated payroll artifact', () => {
    const { plan, evidence } = fixture({
      inflation: 0, selfWage: 986, partnerWage: 1_973, working: 1_910.7683,
      payment: 1_000, principal: 1_952,
    })
    // These wages have no tax or CPP. EI at 1.63% is $48.2317 in
    // decimal CAD, even though adding the per-person Number results differs.
    expect(986 * 0.0163 + 1_973 * 0.0163).toBe(48.231700000000004)
    const debtFree = structuredClone(plan)
    debtFree.debts = []
    debtFree.properties[0].mortgageDebtId = null
    debtFree.budget = { kind: 'incomeBudget', workingSpending: 2_910.7683, retirementSpending: 5_000 }
    const control = ok(projectCanonicalCoverage(debtFree, { ...evidence, workingSpending: known(2_910.7683) }, 1))
    const funded = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(control.blocked).toBeNull()
    expect(funded.blocked).toBeNull()
    const [row] = funded.rows
    expect(row.taxLedger).toEqual(control.rows[0].taxLedger)
    expect(row.payrollContributions).toBe(control.rows[0].payrollContributions)
    expect(row.payrollContributions).toBeCloseTo(48.2317, 10)
    expect(row).toMatchObject({
      cashLedger: { income: 2_959, tax: 0, spending: 1_910.7683, debtPayments: 1_000, unallocated: 0 },
      householdWithdrawalSettlement: { spendingDue: 1_910.7683, spendingFunded: 1_910.7683, spendingUnmet: 0 },
      byAccount: { [TFSA]: { opening: OPENING_TFSA, withdrawal: 0, contribution: 0, closing: OPENING_TFSA } },
    })
    expect(row.byDebt[LIEN]).toMatchObject({ opening: 1_952, interest: close(488), principal: close(512), closing: close(1_440) })
  })

  it('commits exact living costs when adding the posted household wages rounds down', () => {
    // With EI only, decimal cash is 2,880.03 - 46.944489 - 1,000.
    const living = 1_833.085511
    const postedWages = 980 + 1_900.03
    expect(postedWages).toBe(2_880.0299999999997)
    const { plan, evidence } = fixture({
      inflation: 0, selfWage: 980, partnerWage: 1_900.03, working: living, payment: 1_000, principal: 1_952,
    })
    const control = structuredClone(plan)
    control.debts = []
    control.properties[0].mortgageDebtId = null
    control.budget = { kind: 'incomeBudget', workingSpending: 2_833.085511, retirementSpending: 5_000 }
    const debtFree = ok(projectCanonicalCoverage(control, { ...evidence, workingSpending: known(2_833.085511) }, 1))
    const funded = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(debtFree.blocked).toBeNull()
    expect(funded.blocked).toBeNull()
    const [row] = funded.rows
    expect(row.byPerson).toEqual(debtFree.rows[0].byPerson)
    expect(row.taxLedger).toEqual(debtFree.rows[0].taxLedger)
    expect(row.payrollContributions).toBe(debtFree.rows[0].payrollContributions)
    expect(row.payrollContributions).toBeCloseTo(46.944489, 12)
    expect(row).toMatchObject({
      byPerson: { [RETIREE]: { earnedIncome: 980 }, [PARTNER]: { earnedIncome: 1_900.03 } },
      cashLedger: { income: postedWages, tax: 0, benefits: 0, debtPayments: 1_000, spending: living, unallocated: 0 },
      householdWithdrawalSettlement: { spendingDue: living, spendingFunded: living, spendingUnmet: 0, withdrawal: 0 },
      byAccount: { [TFSA]: { closing: OPENING_TFSA, withdrawal: 0, contribution: 0 } },
    })
  })

  it('stops atomically on a recorded 2e-13 CAD shortfall when posted wages round up', () => {
    // Exact wages 2,880.14, less EI of 46.946282 and debt of 1,000,
    // leave 1,833.193718. The next supplied figure is genuinely greater.
    expect(980 + 1_900.14).toBe(2_880.1400000000003)
    const options = { inflation: 0, selfWage: 980, partnerWage: 1_900.14, payment: 1_000, principal: 1_952 }
    const exact = fixture({ ...options, working: 1_833.193718 })
    const short = fixture({ ...options, working: 1_833.1937180000002 })
    const original = structuredClone(short)
    const exactCoverage = ok(projectCanonicalCoverage(exact.plan, exact.evidence, 1))
    expect(exactCoverage.blocked).toBeNull()
    expect(exactCoverage.rows[0]).toMatchObject({
      cashLedger: { income: 2_880.1400000000003, debtPayments: 1_000, spending: 1_833.193718 },
      householdWithdrawalSettlement: { spendingFunded: 1_833.193718, spendingUnmet: 0, withdrawal: 0 },
    })
    const opening = ok(initializeState(short.plan))
    expect(ok(projectCanonicalCoverage(short.plan, short.evidence, 3))).toMatchObject({
      rows: [], state: opening, uncomputedYears: [2027, 2028],
      blocked: { year: BASE_YEAR, status: 'unsupported' },
    })
    expect(short).toEqual(original)
  })

  it('keeps inflated mixed-year wages, payroll, and ordinary tax postings on the debt-free pricing basis', () => {
    const { plan, evidence } = fixture({
      inflation: 0.25, selfWage: 12_000, partnerWage: 40_000, mixed: 35_000,
    })
    const control = structuredClone(plan)
    control.debts = []
    control.properties[0].mortgageDebtId = null
    control.budget = { kind: 'incomeBudget', workingSpending: 44_112.188875, retirementSpending: 5_000 }
    const debtFree = ok(projectCanonicalCoverage(control, { ...evidence, workingSpending: known(44_112.188875) }, 2))
    const mortgaged = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(debtFree.blocked).toBeNull()
    expect(mortgaged.blocked).toBeNull()
    const [, mixed] = mortgaged.rows
    const [, controlMixed] = debtFree.rows
    expect(mixed.byPerson).toEqual(controlMixed.byPerson)
    expect(mixed.taxLedger).toEqual(controlMixed.taxLedger)
    expect(mixed.payrollContributions).toBe(controlMixed.payrollContributions)
    expect(mixed.cashLedger.tax).toBe(controlMixed.cashLedger.tax)
    expect(mixed.cashLedger.income).toBe(controlMixed.cashLedger.income)
    // Starting CPI 1.25 gives 50,000 wages, 3,529.6875 payroll and
    // 5,453.38890625 tax. The fixed installment is still 9,261.
    expect(mixed).toMatchObject({
      payrollContributions: close(3_529.6875),
      taxLedger: { [PARTNER]: { taxableIncome: 49_543.75, tax: close(5_453.38890625) } },
      cashLedger: { income: 50_000, tax: close(5_453.38890625), debtPayments: PAYMENT, spending: 43_750 },
      byAccount: { [TFSA]: { withdrawal: close(11_994.07640625) } },
      householdWithdrawalSettlement: { spendingDue: 43_750, spendingFunded: 43_750, spendingUnmet: 0 },
    })
    expect(mixed.byAccount[TFSA].withdrawal - controlMixed.byAccount[TFSA].withdrawal).toBeCloseTo(PAYMENT, 8)
  })

  it('uses exact indexed wages for the mixed TFSA draw while preserving the posted wage', () => {
    const wage = 3_499.99
    const postedWage = wage * 1.25
    expect(postedWage).toBe(4_374.987499999999)
    const { plan, evidence } = fixture({
      inflation: 0.25, selfWage: 2_500, partnerWage: wage, working: 4_902.190163,
      mixed: 3_500, payment: 1_000, principal: 1_952,
    })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(coverage.blocked).toBeNull()
    const [, mixed] = coverage.rows
    // Exact nominal wage is 4,374.9875, and EI is 71.31229625.
    // Living of 4,375 plus the 1,000 installment therefore needs
    // exactly 1,071.32479625 from the TFSA.
    expect(mixed).toMatchObject({
      cashLedger: { income: postedWage, tax: 0, debtPayments: 1_000, spending: 4_375 },
      byAccount: { [TFSA]: { withdrawal: 1_071.32479625,
        mortgageExactWithdrawal: { coefficient: '107132479625', scale: 8 } } },
      householdWithdrawalSettlement: { spendingDue: 4_375, spendingFunded: 4_375, spendingUnmet: 0 },
    })
  })

  it.each([3_918.5000000000005, 3_918.51])('stops atomically on a true both-working deficit with $%s living due', working => {
    const { plan, evidence } = fixture({
      inflation: 0, selfWage: 2_500, partnerWage: 2_500, working, payment: 1_000, principal: 1_952,
    })
    const opening = ok(initializeState(plan))
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(coverage).toMatchObject({
      rows: [], state: opening, uncomputedYears: [2027], blocked: { year: BASE_YEAR, status: 'unsupported' },
    })
  })

  it.each([508.14, 508.1499999999999, 508.15])('prices the mixed-year payroll boundary with $%s in the TFSA', tfsa => {
    const { plan, evidence } = fixture({
      tfsa, inflation: 0, selfWage: 2_500, partnerWage: 500, working: 1_951.10,
      mixed: 100, payment: 1_000, principal: 2_000, term: 2,
    })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    if (tfsa < 508.15) {
      expect(coverage).toMatchObject({ rows: prefix.rows, state: prefix.state,
        blocked: { year: 2027, ...shortage }, uncomputedYears: [2028] })
    } else {
      expect(coverage.blocked).toBeNull()
      expect(coverage.rows[1]).toMatchObject({
        payrollContributions: close(8.15),
        cashLedger: { income: 500, tax: 0, spending: 0, debtPayments: 1_000 },
        householdWithdrawalSettlement: { withdrawal: 508.15, spendingDue: 100, spendingFunded: 0, spendingUnmet: 100 },
        byAccount: { [TFSA]: { closing: 0, withdrawal: 508.15 } },
      })
    }
  })

  it.each([632.84, 632.8499999999999, 632.85, 682.85])(
    'funds the mixed installment before living costs with $%s of TFSA capacity',
    tfsa => {
      const payment = 5_000
      const { plan, evidence } = fixture({
        tfsa, inflation: 0, selfWage: 4_500, partnerWage: 4_500, working: 3_734.30, mixed: 100,
        retired: 200, payment, principal: payment * 2, term: 2,
      })
      const original = structuredClone({ plan, evidence })
      const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
      expect(prefix.blocked).toBeNull()
      expect(prefix.rows[0].byAccount[TFSA]).toMatchObject({ closing: tfsa, contribution: 0, withdrawal: 0 })
      expect(prefix.state.byDebt[LIEN]).toMatchObject({ principal: payment, yearsRemaining: 1 })
      const full = ok(projectCanonicalCoverage(plan, evidence, 3))
      // $4,500 minus $132.85 CPP/EI leaves $4,367.15. A binary Number
      // addition can render the sub-cent case as exactly $5,000.
      if (tfsa === 632.8499999999999) expect(4_367.15 + tfsa).toBe(payment)
      if (tfsa < 632.85) {
        expect(full).toMatchObject({ rows: prefix.rows, state: prefix.state,
          blocked: { year: 2027, ...shortage }, uncomputedYears: [2028] })
      } else {
        const living = tfsa === 632.85 ? 0 : 50
        expect(full.blocked).toBeNull()
        const [, mixed, retired] = full.rows
        expect(mixed).toMatchObject({
          byDebt: { [LIEN]: { payment, interest: 0, principal: payment, closing: 0 } },
          byAccount: { [TFSA]: { opening: tfsa, withdrawal: tfsa, closing: 0, contribution: 0 } },
          cashLedger: { income: 4_500, benefits: 0, tax: 0, debtPayments: payment, spending: living, unallocated: 0 },
          householdWithdrawalSettlement: { spendingDue: 100, spendingFunded: living, spendingUnmet: 100 - living },
        })
        expect(retired).toMatchObject({
          cashLedger: { debtPayments: 0, spending: 0 },
          householdWithdrawalSettlement: { spendingDue: 200, spendingFunded: 0, spendingUnmet: 200 },
        })
        expect(full.state.tfsaWithdrawalHistory).toMatchObject([{ calendarYear: 2027, amount: tfsa }])
      }
      expect({ plan, evidence }).toEqual(original)
    },
  )

  it.each([
    [10_000_000_002_000, 1_000],
    [10_000_000_001_999.998, 999.998],
  ])('carries the exact mixed-to-retired balance from $%s', (tfsa, expectedBalance) => {
    const { plan, evidence } = fixture({
      tfsa, inflation: 0, selfWage: 12_000, partnerWage: 0, working: 10_298.65,
      mixed: 10_000_000_000_000, retired: 200, payment: 1_000, principal: 3_000, term: 3,
    })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows[1]).toMatchObject({
      byAccount: { [TFSA]: { withdrawal: 10_000_000_001_000, closing: expectedBalance } },
      cashLedger: { debtPayments: 1_000, spending: 10_000_000_000_000 },
    })
    expect(prefix.state.byAccount[TFSA].balance).toBe(expectedBalance)
    const full = ok(projectCanonicalCoverage(plan, evidence, 4))
    if (expectedBalance < 1_000) {
      expect(full).toMatchObject({ rows: prefix.rows, state: prefix.state,
        blocked: { year: 2028, ...shortage }, uncomputedYears: [2029] })
    } else {
      expect(full.blocked).toBeNull()
      expect(full.rows[2]).toMatchObject({
        byDebt: { [LIEN]: { payment: 1_000, closing: 0 } },
        byAccount: { [TFSA]: { withdrawal: 1_000, closing: 0 } },
        householdWithdrawalSettlement: { spendingDue: 200, spendingFunded: 0, spendingUnmet: 200 },
        cashLedger: { debtPayments: 1_000, spending: 0 },
      })
      expect(full.rows[3].cashLedger.debtPayments).toBe(0)
    }
  })

  it.each([
    [23_506.22, false], [23_506.22999999999, false], [23_506.23, true], [23_506.24, true],
  ] as const)('preserves a late exact-capacity maturity with $%s starting TFSA', (tfsa, funded) => {
    const payment = 1_237.17
    const { plan, evidence } = fixture({
      tfsa, inflation: 0, selfAge: 25, selfWage: 12_000, partnerWage: 0, working: 10_061.48,
      mixed: 0, retired: 0, payment, principal: 24_743.40, term: 20,
    })
    const original = structuredClone({ plan, evidence })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 19))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows.map(row => row.cashLedger.debtPayments)).toEqual(Array(19).fill(payment))
    expect(prefix.state.byDebt[LIEN]).toMatchObject({ principal: close(payment), yearsRemaining: 1 })
    // Use a cent-based recurrence for the expected balances, independent of
    // repeated binary subtraction in a long schedule.
    for (const [index, row] of prefix.rows.entries()) {
      const withdrawals = Math.max(0, index)
      expect(row.byAccount[TFSA]).toMatchObject({
        contribution: 0, withdrawal: index === 0 ? 0 : payment, returnAmount: 0,
        closing: close(tfsa - (withdrawals * 123_717) / 100),
      })
      expect(row.cashLedger).toMatchObject({ tax: 0, spending: index === 0 ? 10_061.48 : 0, unallocated: 0 })
    }
    const full = ok(projectCanonicalCoverage(plan, evidence, 21))
    expect(full.rows.slice(0, 19)).toEqual(prefix.rows)
    if (!funded) {
      expect(prefix.state.byAccount[TFSA].balance).toBeLessThan(payment)
      expect(full).toMatchObject({ rows: prefix.rows, state: prefix.state,
        blocked: { year: 2045, ...shortage }, uncomputedYears: [2046] })
    } else {
      expect(full.blocked).toBeNull()
      expect(full.rows[19]).toMatchObject({
        byDebt: { [LIEN]: { payment, closing: 0 } },
        byAccount: { [TFSA]: { withdrawal: payment, closing: close(tfsa - 23_506.23) } },
        cashLedger: { debtPayments: payment, spending: 0, unallocated: 0 },
      })
      if (tfsa === 23_506.23) expect(full.rows[19].byAccount[TFSA].closing).toBe(0)
      expect(full.rows[20]).toMatchObject({ byAccount: { [TFSA]: { withdrawal: 0 } }, cashLedger: { debtPayments: 0 } })
      expect(full.state.byDebt[LIEN]).toMatchObject({ principal: 0, yearsRemaining: 0 })
      expect(full.state.tfsaWithdrawalHistory?.map(entry => entry.amount)).toEqual(Array(19).fill(payment))
    }
    expect({ plan, evidence }).toEqual(original)
  })
})

describe('FE-53 S2 evidence and unsupported events', () => {
  type Scenario = ReturnType<typeof fixture>
  const openingRefusals: [string, (scenario: Scenario) => void, RegExp][] = [
    ['missing spending exclusion', ({ evidence }) => { delete evidence.scheduledMortgagePaymentsExcluded }, /exclude scheduled payments/i],
    ['unknown spending exclusion', ({ evidence }) => {
      evidence.scheduledMortgagePaymentsExcluded = { status: 'unknown', reason: 'Living costs may include installments' }
    }, /exclude scheduled payments/i],
    ['false exclusion', ({ evidence }) => { Reflect.set(evidence, 'scheduledMortgagePaymentsExcluded', known(false)) }, /exclude scheduled payments/i],
    ['string exclusion', ({ evidence }) => { Reflect.set(evidence, 'scheduledMortgagePaymentsExcluded', known('true')) }, /exclude scheduled payments/i],
    ['debt without home link', ({ plan }) => { plan.properties[0].mortgageDebtId = null }, /bidirectionally linked/i],
    ['estimated loan provenance', ({ plan }) => { plan.debts[0].provenance = { ...recorded, origin: 'estimated' } }, /recorded debt provenance/i],
    ['whole partner title plus a positive phantom self share', ({ plan }) => {
      plan.properties[0].taxableOwnerShares = { status: 'known', shares: { [PARTNER]: 1, [RETIREE]: 2 ** -54 } }
    }, /wholly household-owned/i],
    ['estimated property value', ({ plan }) => { plan.properties[0].provenance.value = { ...recorded, origin: 'estimated' } }, /recorded property value/i],
    ['positive household benefit', ({ plan }) => { plan.people[0].cppAnnualAt65 = 500 }, /benefits/i],
    ['a second funded TFSA', ({ plan }) => {
      plan.accounts.push({ ...plan.accounts[0], id: 'partner-TFSA', ownerId: PARTNER, balance: 100,
        taxableOwnerShares: { status: 'known', shares: { [PARTNER]: 1 } } })
    }, /single funded TFSA/i],
  ]
  it.each(openingRefusals)('refuses %s before any posting', (_, change, detail) => {
    const scenario = fixture()
    change(scenario)
    const { plan, evidence } = scenario
    const before = structuredClone(scenario)
    expect(ok(projectCanonicalCoverage(plan, evidence, 3))).toMatchObject({
      rows: [], state: ok(initializeState(plan)), uncomputedYears: [2027, 2028],
      blocked: { year: BASE_YEAR, status: 'unsupported', issues: [{ detail: expect.stringMatching(detail) }] },
    })
    expect(scenario).toEqual(before)
  })

  it.each([undefined, known(Infinity), known(-1)])('blocks the mixed prefix on reached transition evidence %j', transitionSpending => {
    const { plan, evidence } = fixture()
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    const result = ok(projectCanonicalCoverage(plan, { ...evidence, transitionSpending }, 4))
    expect(prefix.blocked).toBeNull()
    expect(result).toMatchObject({
      rows: prefix.rows, state: prefix.state, uncomputedYears: [2028, 2029],
      blocked: { year: 2027, status: transitionSpending ? 'invalid' : 'unsupported' },
    })
  })

  it('rejects malformed debt and household ownership before assembling years', () => {
    const { plan, evidence } = fixture()
    Reflect.set(plan.debts[0], 'provenance', { origin: 'user', sourceYear: '2026' })
    expect(projectCanonicalCoverage(plan, evidence, 4)).toMatchObject({ status: 'invalid' })
    plan.debts[0].provenance = recorded
    plan.debts[0].propertyId = null
    expect(projectCanonicalCoverage(plan, evidence, 4)).toMatchObject({ status: 'invalid' })
    plan.debts[0].propertyId = HOME
    plan.properties[0].taxableOwnerShares = { status: 'known', shares: { absent: 1 } }
    expect(projectCanonicalCoverage(plan, evidence, 4)).toMatchObject({ status: 'invalid' })
  })

  it.each([1, 2])('stops at self age plus %s despite reverse order and sole partner title', offset => {
    const { plan, evidence } = fixture({ title: 'partner', reverse: true })
    const self = plan.people.find(person => person.role === 'self')!
    plan.properties[0].sellAtAge = self.ageInBaseYear + offset
    const prefix = ok(projectCanonicalCoverage(plan, evidence, offset))
    expect(prefix.blocked).toBeNull()
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    const saleYear = BASE_YEAR + offset
    expect(coverage).toMatchObject({ rows: prefix.rows, state: prefix.state,
      blocked: { year: saleYear, status: 'unsupported', causes: ['propertySale'] },
      uncomputedYears: [2027, 2028, 2029].filter(year => year > saleYear) })
    const sheet = canonicalAnnualSheet(coverage, CONTEXT)
    for (const path of [['debt', LIEN, 'payment'], ['property', HOME, 'closing'], ['netWorth']]) {
      const cells = sheetRow(sheet.rows, ...path).cells!
      for (const year of [2027, 2028, 2029].filter(year => year >= saleYear)) {
        expect(cells[year]).toMatchObject({ value: null, status: 'not-computed' })
        const explanation = sheet.resolveExplanation!(cells[year].explanationRefs![0])!
        expect(explanation.sources?.[0].code).toBe(year === saleYear ? 'propertySale' : 'suffix')
        for (const [locale, saleText, suffix] of [
          ['en', /self member’s clock/i, 'Not computed after the first blocked year.'],
          ['fr', /âge du membre principal/i, 'Non calculé après la première année bloquée.'],
          ['zh', /本人达到/, '首个受阻年度之后未计算。'],
        ] as const) {
          const reason = annualSheetText(cells[year].reason!, locale)
          if (year === saleYear) expect(reason).toMatch(saleText)
          else expect(reason).toBe(suffix)
        }
      }
    }
  })
})

describe('FE-53 S2 entry point and production parity', () => {
  it.each([
    ['constructor', false], ['toString', false], ['constructor', true], ['toString', true],
  ] as const)('settles withdrawals from opaque account ID %s with mortgage=%s', (accountId, mortgaged) => {
    const working = mortgaged ? 10_298.65 : 11_298.65
    const { plan, evidence } = fixture({
      inflation: 0, selfWage: 12_000, partnerWage: 0, working, mixed: 200, retired: 300,
      payment: 1_000, principal: 3_000, term: 3,
    })
    plan.accounts[0].id = accountId
    if (!mortgaged) {
      plan.debts = []
      plan.properties[0].mortgageDebtId = null
      delete evidence.scheduledMortgagePaymentsExcluded
    }
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage).toMatchObject({ blocked: null, uncomputedYears: [] })
    expect(coverage.rows.map(row => row.year)).toEqual([2026, 2027, 2028, 2029])
    const draws = mortgaged ? [0, 1_200, 1_300, 300] : [0, 200, 300, 300]
    const balances = mortgaged ? [22_000, 20_800, 19_500, 19_200] : [22_000, 21_800, 21_500, 21_200]
    const payments = mortgaged ? [1_000, 1_000, 1_000, 0] : [0, 0, 0, 0]

    for (const [index, row] of coverage.rows.entries()) {
      expect(Object.keys(row.byAccount)).toEqual([accountId])
      const posting = row.byAccount[accountId]
      expect(posting).toMatchObject({
        ownerId: RETIREE, opening: index ? balances[index - 1] : OPENING_TFSA,
        withdrawal: draws[index], contribution: 0, returnAmount: 0, closing: balances[index],
      })
      expect(row.cashLedger).toMatchObject({ debtPayments: payments[index],
        spending: index === 0 ? working : index === 1 ? 200 : 300, unallocated: 0 })
      if (index) expect(row.householdWithdrawalSettlement).toMatchObject({
        accountId, ownerId: RETIREE, withdrawal: draws[index], spendingUnmet: 0,
        postings: [{ accountId, ownerId: RETIREE, kind: 'tfsa', amount: draws[index] }],
      })
      if (mortgaged && index) {
        expect(posting.mortgageExactWithdrawal).toEqual({ coefficient: String(draws[index]), scale: 0 })
      } else {
        expect(posting).not.toHaveProperty('mortgageExactWithdrawal')
      }
    }
    expect(Object.keys(coverage.state.byAccount)).toEqual([accountId])
    expect(coverage.state.byAccount[accountId]).toMatchObject({ balance: balances[3], ownerId: RETIREE })
    expect(coverage.state.tfsaWithdrawalHistory).toEqual(draws.slice(1).map((amount, index) => ({
      id: `annual:${2027 + index}:withdrawal:${accountId}`, calendarYear: 2027 + index, personId: RETIREE, amount,
    })))
    if (mortgaged) {
      expect(Object.keys(coverage.state.mortgageExactBalances!)).toEqual([accountId])
      expect(coverage.state.mortgageExactBalances![accountId]).toEqual({ coefficient: '19200', scale: 0 })
    } else {
      expect(coverage.state).not.toHaveProperty('mortgageExactBalances')
    }
  })

  it('preserves the base provider refusal when negative savings and underamortization coincide', () => {
    const { plan } = fixture({ payment: 1_000, principal: 1_000.01, term: 1 })
    plan.budget = { kind: 'savingsBudget', annualNetSavings: -10, retirementSpending: 800,
      debtIncluded: known(true), taxBenefitIncluded: known(true) }
    const opening = ok(initializeState(plan))
    const before = structuredClone(opening)
    const providers: AnnualProviders = {
      evaluate: () => ({ byPerson: Object.fromEntries(plan.people.map(person => [person.id, {
        income: 0, earnedIncome: 0, benefits: 0, tax: 0, spending: 0, taxableIncome: 0,
        benefitIncomeForNextYear: known(0),
      }])) }),
      returns: vi.fn(() => 0),
    }
    const baseRefusal = { status: 'unsupported', issues: [
      { code: 'unsupported', detail: 'negative net savings needs withdrawal funding rule' },
    ] }
    expect(annualStep(plan, opening, providers)).toEqual(baseRefusal)
    expect(projectFromState(plan, opening, 2, providers)).toEqual(baseRefusal)
    expect(ok(projectAnnualCoverage(plan, opening, 2, providers))).toMatchObject({
      rows: [], state: before, evaluationBasis: 'provider-supplied', uncomputedYears: [2027],
      blocked: { year: BASE_YEAR, ...baseRefusal, causes: ['withdrawalFunding'] },
    })
    plan.budget.annualNetSavings = 0
    expect(annualStep(plan, opening, providers)).toEqual({
      status: 'invalid', issues: [{ code: 'invalid', detail: `debt cannot amortize: ${LIEN}` }],
    })
    expect(providers.returns).not.toHaveBeenCalled()
    expect(opening).toEqual(before)
  })

  it.each([1_000, 1_000.0000000000001, 1_000.01])(
    'checks exact household contract maturity at $%s principal while preserving provider and solo behavior',
    principal => {
      const { plan, evidence } = fixture({
        inflation: 0, selfWage: 2_500, partnerWage: 2_500, working: 3_918.50, mixed: 2_459.25,
        payment: 1_000, principal, term: 1, title: 'self',
      })
      const household = ok(projectCanonicalCoverage(plan, evidence, 2))
      if (principal === 1_000) {
        expect(household.blocked).toBeNull()
        expect(household.rows[0].byDebt[LIEN]).toEqual({
          propertyId: HOME, opening: 1_000, interest: 0, principal: 1_000, payment: 1_000, closing: 0,
        })
        expect(household.rows[1].cashLedger.debtPayments).toBe(0)
        expect(household.state.byDebt[LIEN]).toMatchObject({ principal: 0, yearsRemaining: 0 })
      } else {
        expect(household).toMatchObject({ rows: [], state: ok(initializeState(plan)), uncomputedYears: [2027],
          blocked: { year: BASE_YEAR, status: 'unsupported',
            issues: [{ detail: 'household mortgage recorded principal exceeds scheduled payments' }] },
        })
      }

      const solo = structuredClone(plan)
      solo.people = solo.people.filter(person => person.role === 'self')
      delete solo.tfsaStatement![PARTNER]
      solo.budget = { kind: 'incomeBudget', workingSpending: 1_459.25, retirementSpending: 5_000 }
      const soloCoverage = ok(projectCanonicalCoverage(solo, { ...evidence, workingSpending: known(1_459.25) }, 1))
      const providerPlan = { ...plan, budget: { kind: 'savingsBudget' as const, annualNetSavings: 0, retirementSpending: 5_000,
        debtIncluded: known(true), taxBenefitIncluded: known(true) } }
      const providers: AnnualProviders = {
        evaluate: () => ({ byPerson: Object.fromEntries(plan.people.map(person => [person.id, {
          income: 500, earnedIncome: 500, benefits: 0, tax: 0, spending: 0, taxableIncome: 500,
          benefitIncomeForNextYear: known(500),
        }])) }),
        returns: () => 0,
      }
      const provider = annualStep(providerPlan, ok(initializeState(providerPlan)), providers)
      if (principal === 1_000.01) {
        const invalid = { status: 'invalid', issues: [{ code: 'invalid', detail: `debt cannot amortize: ${LIEN}` }] }
        expect(soloCoverage.blocked).toMatchObject(invalid)
        expect(provider).toEqual(invalid)
      } else {
        expect(soloCoverage.blocked).toBeNull()
        const cashAndPrincipal = { propertyId: HOME, opening: principal, principal, payment: 1_000, closing: 0 }
        expect(soloCoverage.rows[0].byDebt[LIEN]).toEqual({ ...cashAndPrincipal, interest: 1_000 - principal })
        expect(ok(provider).row.byDebt[LIEN]).toEqual({ ...cashAndPrincipal, interest: 0 })
      }
    },
  )

  it('rejects a contract shortfall hidden by rounding payment times term', () => {
    const principal = 0.30000000000000004
    expect(0.1 * 3).toBe(principal)
    const options = { inflation: 0, selfWage: 2_500, partnerWage: 2_500, working: 4_918.40,
      mixed: 2_459.25, payment: 0.1, term: 3 }
    const short = fixture({ ...options, principal })
    const shortCoverage = ok(projectCanonicalCoverage(short.plan, short.evidence, 4))
    expect(shortCoverage).toMatchObject({
      rows: [], state: ok(initializeState(short.plan)), uncomputedYears: [2027, 2028, 2029],
      blocked: { year: BASE_YEAR, status: 'unsupported',
        issues: [{ detail: 'household mortgage recorded principal exceeds scheduled payments' }] },
    })

    // Three recorded ten-cent installments cover exactly thirty cents.
    const exact = fixture({ ...options, principal: 0.3 })
    const exactCoverage = ok(projectCanonicalCoverage(exact.plan, exact.evidence, 4))
    expect(exactCoverage.blocked).toBeNull()
    expect(exactCoverage.rows.map(row => row.cashLedger.debtPayments)).toEqual([0.1, 0.1, 0.1, 0])
    expect(exactCoverage.state.byDebt[LIEN]).toMatchObject({ principal: 0, yearsRemaining: 0 })
  })

  it('requires authenticated continuous state even when reopening with returned snapshots', () => {
    const { plan, evidence } = fixture()
    const initial = ok(initializeState(plan))
    const returned = ok(projectCanonicalCoverage(plan, evidence, 2)).state
    const evaluate = vi.fn()
    const returns = vi.fn(() => 0)
    const providers = { evaluate, returns }
    for (const state of [initial, returned, structuredClone(returned)]) {
      expect(evaluateCanonicalHouseholdWorkingYear(plan, evidence, state.year, state)).toMatchObject({
        status: 'unsupported',
      })
      expect(annualRetirementContinuation(plan, state, evidence)).toMatchObject({ status: 'invalid' })
    }
    for (const state of [returned, structuredClone(returned)]) {
      const rejection = { status: 'invalid', issues: [{ detail: 'mortgage decimal balances require authenticated generated state' }] }
      expect(annualStep(plan, state, providers)).toMatchObject(rejection)
      expect(annualRetirementStep(plan, state, returns)).toMatchObject(rejection)
    }
    expect(evaluate).not.toHaveBeenCalled()
    expect(returns).not.toHaveBeenCalled()
  })

  it('preserves the provider-supplied household debt path and its original recurrence', () => {
    const { plan } = fixture()
    plan.budget = { kind: 'savingsBudget', annualNetSavings: 0, retirementSpending: 0,
      debtIncluded: known(true), taxBenefitIncluded: known(true) }
    const opening = ok(initializeState(plan))
    const original = structuredClone(opening)
    const providers: AnnualProviders = {
      evaluate: ({ plan }) => ({ byPerson: Object.fromEntries(plan.people.map(person => [person.id, {
        income: 10_000, earnedIncome: 10_000, benefits: 0, tax: 1_000, taxableIncome: 10_000,
        benefitIncomeForNextYear: known(10_000), spending: 4_369.50,
      }])) }),
      returns: () => 0,
    }
    const provider = ok(projectAnnualCoverage(plan, opening, 1, providers))
    expect(provider).toMatchObject({ blocked: null, evaluationBasis: 'provider-supplied' })
    const [row] = provider.rows
    expect(row.workingSettlement).toBeUndefined()
    expect(row.householdWithdrawalSettlement).toBeUndefined()
    expect(row.cashLedger).toMatchObject({ income: 20_000, benefits: 0, tax: 2_000, spending: 8_739, debtPayments: 9_261 })
    expect(row.byDebt).toEqual({ [LIEN]: {
      propertyId: HOME, opening: 25_220, interest: 1_260.9999999999964, principal: 8_000.000000000004,
      payment: 9_261, closing: 17_219.999999999996,
    } })
    expect(ok(annualStep(plan, opening, providers))).toEqual({ row, state: provider.state })
    expect(ok(projectFromState(plan, opening, 1, providers))).toEqual({ rows: provider.rows, state: provider.state })
    expect(opening).toEqual(original)
  })

  it('preserves the debt-free held home and solo mortgage when using the same evidence contract', () => {
    const { plan, evidence } = fixture({ selfWage: 12_000, partnerWage: 0, inflation: 0,
      working: 10_298.65, mixed: 0, retired: 200, payment: 1_000, principal: 2_000, term: 2, title: 'self' })
    const solo = structuredClone(plan)
    solo.people = solo.people.filter(person => person.role === 'self')
    delete solo.tfsaStatement![PARTNER]
    const soloCoverage = ok(projectCanonicalCoverage(solo, evidence, 3))
    expect(soloCoverage.blocked).toBeNull()
    expect(soloCoverage.rows[1]).toMatchObject({
      cashLedger: { debtPayments: 1_000, spending: 200, tax: 0 },
      retirementSettlement: { spendingDue: 200, spendingFunded: 200, spendingUnmet: 0 },
      byAccount: { [TFSA]: { withdrawal: 1_200, closing: 20_800 } },
    })
    expect(soloCoverage.rows[1].householdWithdrawalSettlement).toBeUndefined()

    plan.debts = []
    plan.properties[0].mortgageDebtId = null
    if (plan.budget.kind !== 'incomeBudget') throw new Error('Expected income budget')
    plan.budget.workingSpending = partnerNet
    evidence.workingSpending = known(partnerNet)
    delete evidence.scheduledMortgagePaymentsExcluded
    const held = ok(projectCanonicalCoverage(plan, evidence, 3))
    const noHome = ok(projectCanonicalCoverage({ ...plan, properties: [] }, evidence, 3))
    expect(held.blocked).toBeNull()
    expect(held.rows.map(row => ({ ...row, byProperty: {} }))).toStrictEqual(noHome.rows)
    expect(held.rows.map(row => row.cashLedger.debtPayments)).toEqual([0, 0, 0])
    expect(held.state.mortgageExactBalances).toBeUndefined()
    expect(held.rows[2].householdWithdrawalSettlement).toMatchObject({ withdrawal: 200, spendingFunded: 200, spendingUnmet: 0 })
    expect(sumInvestableAssets(held.state)).toBe(21_800)
  })

  it('preserves the production projection, sampled returns, and legacy sheet from the legacy inputs', () => {
    const { plan } = fixture()
    const inputs = plan.legacyProjection
    const baseline = { ...plan, properties: [], debts: [] }
    const actual = runProjection(inputs, undefined, plan, { captureAnnualDetails: true })
    const expected = runProjection(inputs, undefined, baseline, { captureAnnualDetails: true })
    expect(actual).toStrictEqual(expected)
    expect({ ...actual, rows: actual.rows.map(({ annualDetails: _details, ...row }) => row) })
      .toStrictEqual(runProjection(inputs, undefined, plan))
    expect(legacyAnnualSheet(actual, inputs, CONTEXT).rows).toStrictEqual(legacyAnnualSheet(expected, inputs, CONTEXT).rows)
    const sample = vi.fn(() => -0.07)
    expect(runProjection(inputs, sample, plan)).toStrictEqual(runProjection(inputs, () => -0.07, baseline))
    expect(sample).toHaveBeenCalledWith(52, 'tfsa')
    expect(actual.rows.slice(0, 3).map(row => row.debtPayment)).toEqual([
      close(PAYMENT / CPI), close(PAYMENT / CPI ** 2), close(PAYMENT / CPI ** 3),
    ])
  })
})
