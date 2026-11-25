import { describe, expect, it, vi } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetModel } from '../../annualSheet'
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
import { cppStart } from './fixtures/annualCpp'
import { householdBenefitExclusions } from './fixtures/annualHouseholdOas'
import { BASE_YEAR, known, legacyRetirement, recorded, retirementPlan, RETIREE, RRSP, TFSA } from './fixtures/retirementSettlement'

const PARTNER = 's2-expense-partner'
const PARTNER_TFSA = 's2-partner-tfsa'
const HOME = 's2-primary-home'
const DEBT = 's2-fixed-mortgage'
const EVENT = 's2-opaque-event'
const YEAR = BASE_YEAR + 1
const PAYMENT = 1_331
const context = { scenarioId: 'rrsp-with-one-expense', revision: 1 }

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

// Independent arithmetic over serialized decimal atoms. A fixed scale of 40
// covers the products and shortest decimal renderings used by these cases.
const UNIT = 10n ** 40n
function exact(value: number | string | { coefficient: string; scale: number }): bigint {
  if (typeof value === 'object') return BigInt(value.coefficient) * 10n ** BigInt(40 - value.scale)
  const [mantissa, exponent = '0'] = String(value).split('e')
  const [whole, fraction = ''] = mantissa.split('.')
  return BigInt(whole + fraction) * 10n ** BigInt(40 - fraction.length + Number(exponent))
}

function fixture({ rrsp = 60_000, partnerTfsa = 70, selfTfsa = 130, living = 500,
  amount = 250, inflation = 0, cpp = 0, oas = 0, term = 2 }: {
  rrsp?: number; partnerTfsa?: number; selfTfsa?: number; living?: number;
  amount?: number; inflation?: number; cpp?: number; oas?: number; term?: number;
} = {}) {
  const plan = retirementPlan({ age: 64, tfsa: selfTfsa, rrsp, spending: living, inflation, strategy: 'tfsaFirst' })
  const self = plan.people[0]
  plan.lifeExpectancy = 69
  Object.assign(self, { retirementAge: 65, earnedIncome: known(12_000), cppAnnualAt65: cpp, oasAnnualAt65: oas })
  plan.people.unshift({ ...structuredClone(self), id: PARTNER, role: 'partner', earnedIncome: known(0), cppAnnualAt65: 0, oasAnnualAt65: 0 })
  plan.accounts.push({ ...structuredClone(plan.accounts[0]), id: PARTNER_TFSA, ownerId: PARTNER, balance: partnerTfsa,
    taxableOwnerShares: { status: 'known', shares: { [PARTNER]: 1 } } })
  plan.tfsaStatement![PARTNER] = { withdrawals: [], provenance: recorded }
  plan.taxProfile = { spouseSupported: known(false), pensionSplit: null }
  // $12,000 of working wages, less $505.75 CPP, $195.60 EI and $1,331 debt.
  plan.budget = { kind: 'incomeBudget', workingSpending: 9_967.65, retirementSpending: living }
  plan.properties.push({ id: HOME, kind: 'principal', value: 400_000, acb: known(200_000), annualRent: known(0),
    appreciation: 0, annualHoldingCostChange: 0, sellAtAge: null, plannedPurchaseAge: null,
    plannedDownPayment: null, plannedMortgage: null, mortgageDebtId: DEBT,
    taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 0.25, [PARTNER]: 0.75 } },
    provenance: { value: recorded, acb: recorded, taxableOwnerShares: recorded } })
  plan.debts.push({ id: DEBT, propertyId: HOME, kind: 'mortgage', principal: PAYMENT * term,
    annualPayment: PAYMENT, yearsRemaining: term, provenance: recorded })
  plan.annualHouseholdMortgageFundingEvidence = { authorized: true, purpose: 'household-held-mortgage-and-living',
    provenance: recorded, orderedAccounts: [{ accountId: PARTNER_TFSA, ownerId: PARTNER }, { accountId: TFSA, ownerId: RETIREE }] }
  plan.annualHouseholdMortgageRrspEvidence = { accountId: RRSP, ownerId: RETIREE, authorized: true,
    purpose: 'household-held-mortgage-and-living', priority: 'tfsa-before-rrsp', provenance: recorded }
  if (cpp || oas) {
    if (cpp) plan.incomeSources.push(cppStart(RETIREE, 65, cpp))
    if (oas) plan.incomeSources.push({ id: 's2-owner-oas', kind: 'oas', recipientId: RETIREE, startAge: 65, annualAmount: known(oas), provenance: recorded })
    plan.annualBenefitsEvidence = { [RETIREE]: householdBenefitExclusions(RETIREE), [PARTNER]: householdBenefitExclusions(PARTNER) }
    plan.annualHouseholdMortgageBenefitsEvidence = { authorized: true,
      purpose: 'household-held-mortgage-with-verified-public-benefits', provenance: recorded }
  }
  plan.annualHouseholdExpenseEvidence = { id: EVENT, effectiveYear: YEAR, timing: 'after-mortgage-and-living',
    amountNominal: known(amount), amountBasis: 'event-year-nominal-CAD', noncapital: true, nonDeductible: true,
    allowPartialPayment: true, excludesFromLivingBudget: true, useExistingFundingOrder: true,
    provenance: { origin: 'user', sourceYear: BASE_YEAR - 1 } }
  plan.legacyProjection = legacyRetirement({ currentAge: 64, fireAge: 65, lifeExpectancy: 69, inflation,
    retirementSpending: living, strategy: 'tfsaFirst', balances: { tfsa: selfTfsa + partnerTfsa, rrsp, nonReg: 0 },
    returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, cppAnnualAt65: cpp, oasAnnualAt65: oas,
    partner: { currentAge: 64, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
    principalResidence: { value: 400_000, appreciation: 0, sellAtAge: null,
      mortgage: { balance: PAYMENT * term, annualPayment: PAYMENT, yearsRemaining: term } } })
  const evidence: WorkingSpendingEvidence = { workingSpending: known(9_967.65), transitionSpending: known(living),
    retirementSpending: known(living), scheduledMortgagePaymentsExcluded: known(true) }
  return { plan, evidence }
}

function withoutExpense(plan: InputsV2) {
  const control = structuredClone(plan)
  delete control.annualHouseholdExpenseEvidence
  return control
}

function sheetCell(sheet: AnnualSheetModel, year: number, ...path: string[]) {
  const id = canonicalSheetId('value', ...path)
  const row = sheet.rows.flatMap(parent => [parent, ...(parent.children ?? [])]).find(entry => entry.id === id)
  const cell = row?.cells?.[year]
  if (!row || !cell) throw new Error(`Missing ${year} cell ${id}`)
  const explanation = cell.explanationRefs?.map(ref => sheet.resolveExplanation!(ref)!).find(detail => detail.formula?.length || detail.sources?.length)
  return { row, cell, explanation }
}

describe('authenticated mortgage expense alongside RRSP cash', () => {
  it('keeps the accepted Ontario draw, owner tax and OAS recovery fixed as the event amount changes', () => {
    // Independent pinned Ontario control at $88,000 real RRSP gross.
    // $109,150 recovery income incurs $2,074.05 OAS recovery; $107,075.95
    // taxable income incurs $23,732.46641 federal and Ontario income tax.
    const cpi = 1.125
    const living = 107_075.95 - 23_732.46641 + 900 - PAYMENT / cpi
    const { plan, evidence } = fixture({ rrsp: 250_000, partnerTfsa: 500, selfTfsa: 400,
      cpp: 12_000, oas: 9_150, inflation: 0.125, living })
    const ordinary = ok(projectCanonicalCoverage(withoutExpense(plan), evidence, 2))
    expect(ordinary.blocked).toBeNull()
    const base = ordinary.rows[1]
    const accepted = base.householdWithdrawalSettlement!.rrspFunding!
    expect(accepted.gross).toBeCloseTo(99_000, 7)
    expect(base.byPerson[RETIREE]).toMatchObject({ oasRecovery: expect.closeTo(2_074.05 * cpi, 7),
      oasNet: expect.closeTo(7_075.95 * cpi, 7), tax: expect.closeTo(23_732.46641 * cpi, 7) })
    for (const amount of [0.01, 250, 500_000]) {
      plan.annualHouseholdExpenseEvidence!.amountNominal = known(amount)
      const before = structuredClone({ plan, evidence })
      const coverage = ok(projectCanonicalCoverage(plan, evidence, 2))
      expect(coverage.blocked).toBeNull()
      expect(coverage.rows[0]).toStrictEqual(ordinary.rows[0])
      const row = coverage.rows[1]
      expect(row.householdWithdrawalSettlement!.rrspFunding).toStrictEqual(accepted)
      expect(row.householdWithdrawalSettlement!.postings).toStrictEqual(base.householdWithdrawalSettlement!.postings)
      expect(row.taxLedger).toStrictEqual(base.taxLedger)
      expect(row.byPerson).toStrictEqual(base.byPerson)
      expect(row.byAccount).toStrictEqual(base.byAccount)
      expect(row.byDebt).toStrictEqual(base.byDebt)
      expect(coverage.state.benefitIncomeLag).toStrictEqual(ordinary.state.benefitIncomeLag)
      expect(coverage.state.mortgageExactBalances).toStrictEqual(ordinary.state.mortgageExactBalances)
      expect(row.householdExpense).toMatchObject({ due: amount, paid: 0, unmet: amount, postings: [] })
      expect(row.cashLedger).toStrictEqual({ ...base.cashLedger, expensePayments: 0 })

      const settledCash = exact(12_000 * cpi) + exact(900 * cpi) + exact(accepted.gross)
        + exact(row.byPerson[RETIREE].benefits) - exact(row.taxLedger[RETIREE].tax)
      const livingDue = exact(living) * exact(cpi) / UNIT
      expect(exact(accepted.arithmetic.availableAfterDraw)).toBe(settledCash)
      expect(exact(accepted.cashProof!.livingFunded)).toBe(livingDue)
      expect(exact(accepted.cashProof!.residual)).toBe(settledCash - exact(PAYMENT) - livingDue)
      expect({ plan, evidence }).toStrictEqual(before)
    }
  })

  it('does not let a strictly positive tolerated RRSP quote remainder pay a tiny event', () => {
    const { plan, evidence } = fixture({ selfTfsa: 100, partnerTfsa: 100, living: 500.00000000000006, amount: 1e-14 })
    const control = ok(projectCanonicalCoverage(withoutExpense(plan), evidence, 2))
    expect(control.blocked).toBeNull()
    const accepted = control.rows[1].householdWithdrawalSettlement!.rrspFunding!
    expect(accepted.gross).toBe(1_631.0000000000002)
    expect(exact(accepted.cashProof!.residual)).toBe(exact('0.00000000000014'))
    const actual = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(actual.blocked).toBeNull()
    const row = actual.rows[1]
    expect(row.householdWithdrawalSettlement!.rrspFunding).toStrictEqual(accepted)
    expect(row.householdExpense).toMatchObject({ due: 1e-14, paid: 0, unmet: 1e-14, postings: [],
      arithmetic: { paid: { coefficient: '0', scale: 0 }, unmet: { coefficient: '1', scale: 14 } } })
    expect(actual.state.unfundedEvents).toEqual([{ eventId: EVENT,
      field: 'annualHouseholdExpenseEvidence.amountNominal', amount: 1e-14, reason: 'householdExpense' }])
    const paid = sheetCell(canonicalAnnualSheet(actual, context), YEAR, 'event', EVENT, 'expensePaid')
    expect(paid.cell.value).toBe(0)
    expect(paid.explanation?.formula?.filter(term => term.value !== 0) ?? []).toEqual([])
  })

  it('attributes zero event cash or owner debits when a depleted RRSP has slightly negative net cash', () => {
    const { plan, evidence } = fixture({ rrsp: 3.7e-12, cpp: 45_000.5, oas: 9_001.7, living: 59_002.2,
      selfTfsa: 1_500, partnerTfsa: 1_500 })
    const ordinary = ok(projectCanonicalCoverage(withoutExpense(plan), evidence, 2))
    const actual = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(ordinary.blocked).toBeNull()
    expect(actual.blocked).toBeNull()
    const base = ordinary.rows[1]
    const row = actual.rows[1]
    const funding = row.householdWithdrawalSettlement!
    expect(funding.rrspFunding).toMatchObject({ search: 'capacity-exhausted', gross: 3.7e-12, netCash: -3e-13 })
    expect(funding.rrspFunding).toStrictEqual(base.householdWithdrawalSettlement!.rrspFunding)
    expect(funding.postings).toStrictEqual(base.householdWithdrawalSettlement!.postings)
    expect(funding.spendingFunded).toBe(base.householdWithdrawalSettlement!.spendingFunded)
    expect(funding.spendingUnmet).toBe(base.householdWithdrawalSettlement!.spendingUnmet)
    expect(row.byAccount).toStrictEqual(base.byAccount)
    expect(row.byDebt).toStrictEqual(base.byDebt)
    expect(row.byPerson).toStrictEqual(base.byPerson)
    expect(row.taxLedger).toStrictEqual(base.taxLedger)
    expect(actual.state.tfsaWithdrawalHistory).toStrictEqual(ordinary.state.tfsaWithdrawalHistory)
    expect(actual.state.mortgageExactBalances).toStrictEqual(ordinary.state.mortgageExactBalances)
    expect(row.cashLedger).toStrictEqual({ ...base.cashLedger, expensePayments: 0 })
    expect(row.householdExpense).toMatchObject({ due: 250, paid: 0, unmet: 250, postings: [],
      arithmetic: { paid: { coefficient: '0', scale: 0 }, unmet: { coefficient: '250', scale: 0 } } })
    const sheet = canonicalAnnualSheet(actual, context)
    for (const field of ['expensePaid', 'expenseUnmet']) {
      const { cell, explanation } = sheetCell(sheet, YEAR, 'event', EVENT, field)
      expect(cell.value).toBe(field === 'expensePaid' ? 0 : 250)
      const sources = explanation!.sources!.filter(source =>
        source.field === 'annualHouseholdExpenseEvidence' || source.field?.startsWith('householdExpense.'))
      expect(sources.map(source => source.field)).toEqual(['annualHouseholdExpenseEvidence'])
      expect(explanation!.formula?.map(term => [term.field, term.direction, term.value]) ?? []).toEqual(
        field === 'expensePaid' ? [] : [['householdExpense.due', 'add', 250], ['householdExpense.paid', 'subtract', 0]],
      )
      for (const locale of ['en', 'fr', 'zh'] as const) {
        const visibleSources = sources.map(source => annualSheetText(source.displayReference!, locale))
        expect(visibleSources.join(' ')).not.toMatch(/3e-13|0\.0000000000003/)
      }
    }
  })

  it('uses actual residual CPP and OAS cash before an authorized TFSA draw', () => {
    const { plan, evidence } = fixture({ cpp: 6_000, oas: 8_000, living: 12_550, amount: 200, partnerTfsa: 50, selfTfsa: 60 })
    const ordinary = ok(projectCanonicalCoverage(withoutExpense(plan), evidence, 2))
    expect(ordinary.blocked).toMatchObject({ year: YEAR, status: 'unsupported',
      issues: [{ detail: expect.stringMatching(/positive household cash/) }] })
    const actual = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(actual.blocked).toBeNull()
    expect(actual.rows.slice(0, 1)).toStrictEqual(ordinary.rows)
    expect(actual.rows[1]).toMatchObject({
      cashLedger: { income: 6_000, benefits: 8_000, tax: 0, debtPayments: PAYMENT, spending: 12_550, expensePayments: 200, unallocated: 0 },
      householdExpense: { due: 200, paid: 200, unmet: 0, postings: [
        { accountId: PARTNER_TFSA, ownerId: PARTNER, amount: 50 }, { accountId: TFSA, ownerId: RETIREE, amount: 31 },
      ] },
      byAccount: { [PARTNER_TFSA]: { withdrawal: 50, closing: 0 }, [TFSA]: { withdrawal: 31, closing: 29 },
        [RRSP]: { withdrawal: 0, closing: 60_000 } },
    })
    const funding = actual.rows[1].householdWithdrawalSettlement!
    expect(funding.rrspFunding).toBeUndefined()
    const cash = funding.publicBenefitsCash!
    expect(exact(cash.beforeDrawsAfterDebt) - exact(cash.livingDue)).toBe(exact(119))
    expect(exact(actual.rows[1].householdExpense!.arithmetic.paid)).toBe(exact(119) + exact(50) + exact(31))
    expect(6_000 + 8_000 + 50 + 31 - PAYMENT - 12_550).toBe(200)
    const sheet = canonicalAnnualSheet(actual, context)
    const paid = sheetCell(sheet, YEAR, 'event', EVENT, 'expensePaid')
    const terms = paid.explanation!.formula!
    expect(terms.map(({ direction, value, basis }) => ({ direction, value, basis }))).toEqual([
      { direction: 'add', value: 119, basis: 'nominal-CAD' },
      { direction: 'add', value: 50, basis: 'nominal-CAD' },
      { direction: 'add', value: 31, basis: 'nominal-CAD' },
    ])
    expect(terms.reduce((sum, term) => sum + (term.direction === 'add' ? term.value : -term.value), 0)).toBe(paid.cell.value)
    const sources = paid.explanation!.sources!
    expect(sources.filter(source => source.field === 'householdExpense.postings').map(source => source.id)).toEqual([PARTNER_TFSA, TFSA])
    const cashSource = sources.find(source => source.field === terms[0].field)!
    expect(cashSource.displayReference).toBeDefined()
    for (const [locale, cash, tfsa] of [
      ['en', /ordinary.*cash|cash.*ordinary/i, /TFSA/],
      ['fr', /(?:espèces|trésorerie|liquidité).*ordinair/i, /CELI/],
      ['zh', /普通现金/, /TFSA/],
    ] as const) {
      expect(annualSheetText(terms[0].label, locale)).toMatch(cash)
      expect(annualSheetText(cashSource.label, locale)).toMatch(cash)
      expect(annualSheetText(cashSource.displayReference!, locale)).toContain('119')
      expect(terms.slice(1).map(term => annualSheetText(term.label, locale))).toEqual([expect.stringMatching(tfsa), expect.stringMatching(tfsa)])
    }
    const living = sheetCell(sheet, YEAR, 'retirement', 'spendingFunded')
    expect(living.explanation!.formula!.filter(term => term.field === 'expensePayments')).toEqual([
      expect.objectContaining({ value: 200, direction: 'subtract', basis: 'nominal-CAD' }),
    ])
  })

  it('uses only the unused ordered TFSA capacity even with a large RRSP balance', () => {
    const { plan, evidence } = fixture({ living: 300, amount: 500, partnerTfsa: 1_700, selfTfsa: 200 })
    const ordinary = ok(projectCanonicalCoverage(withoutExpense(plan), evidence, 2))
    const reached = ok(projectCanonicalCoverage(plan, evidence, 2))
    const actual = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(ordinary.blocked).toBeNull()
    expect(actual.blocked).toBeNull()
    expect(actual.rows.slice(0, 2)).toStrictEqual(reached.rows)
    const [working, row, next] = actual.rows
    expect(working).toStrictEqual(ordinary.rows[0])
    expect(ordinary.rows[1].householdWithdrawalSettlement!.postings).toEqual([
      { accountId: PARTNER_TFSA, ownerId: PARTNER, kind: 'tfsa', amount: 1_631 },
    ])
    expect(row).toMatchObject({
      cashLedger: { spending: 300, expensePayments: 269, debtPayments: PAYMENT, unallocated: 0 },
      byDebt: { [DEBT]: { opening: PAYMENT, principal: PAYMENT, payment: PAYMENT, interest: 0, closing: 0 } },
      householdWithdrawalSettlement: { spendingDue: 300, spendingFunded: 300, spendingUnmet: 0, withdrawal: 1_900,
        postings: [{ accountId: PARTNER_TFSA, ownerId: PARTNER, kind: 'tfsa', amount: 1_700 },
          { accountId: TFSA, ownerId: RETIREE, kind: 'tfsa', amount: 200 }] },
      householdExpense: { eventId: EVENT, year: YEAR, due: 500, paid: 269, unmet: 231,
        postings: [{ accountId: PARTNER_TFSA, ownerId: PARTNER, amount: 69 }, { accountId: TFSA, ownerId: RETIREE, amount: 200 }] },
      byAccount: { [PARTNER_TFSA]: { withdrawal: 1_700, closing: 0 }, [TFSA]: { withdrawal: 200, closing: 0 },
        [RRSP]: { withdrawal: 0, closing: 60_000 } },
    })
    expect(row.householdWithdrawalSettlement!.rrspFunding).toBeUndefined()
    expect(reached.state.unfundedEvents).toMatchObject([{ eventId: EVENT, amount: 231, reason: 'householdExpense' }])
    expect(actual.state.unfundedEvents).toEqual([])
    expect(actual.state.householdExpenseReceipt).toStrictEqual(row.householdExpense)
    expect(actual.state.tfsaWithdrawalHistory).toEqual([
      { id: `annual:${YEAR}:withdrawal:${PARTNER_TFSA}`, personId: PARTNER, calendarYear: YEAR, amount: 1_700 },
      { id: `annual:${YEAR}:withdrawal:${TFSA}`, personId: RETIREE, calendarYear: YEAR, amount: 200 },
    ])
    expect(next).toMatchObject({ cashLedger: { spending: 300, debtPayments: 0 },
      byAccount: { [RRSP]: { withdrawal: 300, closing: 59_700 } },
      tfsaLedger: { [PARTNER]: { restored: known(1_700) }, [RETIREE]: { restored: known(200) } } })
    for (const other of [working, next]) {
      expect(other.householdExpense).toBeUndefined()
      expect(other.cashLedger).not.toHaveProperty('expensePayments')
    }
  })
})

describe('exact mortgage and expense priority boundaries', () => {
  it('replays the no-benefit pre-withdrawal cash amount with a localized signed display adjustment', () => {
    const living = 5_000.02
    const amount = 250.01
    const { plan, evidence } = fixture({ living, amount })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows[1].householdWithdrawalSettlement!.publicBenefitsCash).toBeUndefined()
    const { cell, explanation } = sheetCell(canonicalAnnualSheet(coverage, context), YEAR, 'cash', 'canonicalNetCash')
    const terms = explanation!.formula!
    const unadjusted = -living - PAYMENT - amount
    expect(unadjusted).toBe(-6_581.030000000001)
    expect(cell.value).toBe(-6_581.03)
    expect(terms.map(({ field, direction, value }) => [field, direction, value])).toEqual([
      ['spendingDue', 'subtract', living], ['debtPayments', 'subtract', PAYMENT], ['expenseDue', 'subtract', amount],
      ['householdWithdrawalSettlement.before-draws-numeric-reconciliation', 'add', -6_581.03 - unadjusted],
    ])
    expect(terms.reduce((sum, term) => sum + (term.direction === 'add' ? term.value : -term.value), 0)).toBe(cell.value)
    for (const [locale, memo] of [
      ['en', /signed pre-withdrawal display reconciliation.*no cash/i],
      ['fr', /rapprochement signé d’affichage avant retraits.*aucune trésorerie/i],
      ['zh', /提款前显示带符号核对.*不提供现金/],
    ] as const) expect(annualSheetText(terms.at(-1)!.label, locale)).toMatch(memo)
  })

  it.each([
    { capacity: 1_130.9999999999998, funded: null, gap: null },
    { capacity: 1_131, funded: 0, gap: '500' },
    { capacity: 1_131.01, funded: 0.01, gap: '499.99' },
  ])('uses exact mandatory debt capacity at $capacity of RRSP', ({ capacity, funded, gap }) => {
    const { plan, evidence } = fixture({ rrsp: capacity })
    const ordinary = ok(projectCanonicalCoverage(withoutExpense(plan), evidence, 2))
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    const actual = ok(projectCanonicalCoverage(plan, evidence, 3))
    if (funded === null) {
      expect(actual).toMatchObject({ blocked: { year: YEAR, status: 'unsupported', issues: [{ detail: expect.stringMatching(/mortgage scheduled payment/) }] },
        rows: prefix.rows, state: prefix.state, uncomputedYears: [YEAR + 1] })
      expect(actual.state).toStrictEqual(prefix.state)
      expect(actual.rows).toStrictEqual(ordinary.rows)
      return
    }
    expect(actual.blocked).toBeNull()
    const row = actual.rows[1]
    const accepted = row.householdWithdrawalSettlement!.rrspFunding!
    expect(accepted).toStrictEqual(ordinary.rows[1].householdWithdrawalSettlement!.rrspFunding)
    expect(accepted).toMatchObject({ search: 'capacity-exhausted', gross: capacity, netCash: capacity, taxIncrement: 0, oasRecoveryIncrement: 0 })
    expect(exact(accepted.arithmetic.availableAfterDraw)).toBe(exact(capacity) + exact(200))
    expect(exact(accepted.cashProof!.afterDebt)).toBe(exact(funded))
    expect(exact(accepted.cashProof!.livingUnmet)).toBe(exact(gap!))
    expect(row).toMatchObject({ byDebt: { [DEBT]: { opening: PAYMENT, principal: PAYMENT, payment: PAYMENT, interest: 0, closing: 0 } },
      cashLedger: { debtPayments: PAYMENT, spending: funded, expensePayments: 0, unallocated: 0 },
      householdExpense: { paid: 0, unmet: 250, postings: [] },
      byAccount: { [RRSP]: { opening: capacity, withdrawal: capacity, closing: 0 }, [TFSA]: { withdrawal: 130 }, [PARTNER_TFSA]: { withdrawal: 70 } } })
    expect(actual.rows[2]).toStrictEqual(ok(projectCanonicalCoverage(withoutExpense(plan), evidence, 3)).rows[2])
    expect(actual.state.unfundedEvents).toEqual([])
  })

  it('keeps the nominal event gap and funded-living formula separate in EN, FR and ZH', () => {
    const { plan, evidence } = fixture({ rrsp: 1_140, inflation: 0.125 })
    const actual = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(actual.blocked).toBeNull()
    const sheet = canonicalAnnualSheet(actual, context)
    const result = sheetCell(sheet, YEAR, 'event', EVENT, 'expenseUnmet')
    const before = sheetCell(sheet, BASE_YEAR, 'event', EVENT, 'expenseUnmet')
    const next = sheetCell(sheet, YEAR + 1, 'event', EVENT, 'expenseUnmet')
    expect(before.cell.status).toBe('not-applicable')
    expect(next.cell.status).toBe('not-applicable')
    expect(result.cell).toMatchObject({ value: 250, basis: 'nominal-CAD', timing: 'during-year' })
    expect(annualSheetDisplayValue(result.cell, sheet.years[1], 'real')).toBeCloseTo(250 / 1.125, 12)
    expect(result.explanation!.formula!.map(({ direction, value }) => [direction, value])).toEqual([['add', 250], ['subtract', 0]])
    const spending = sheetCell(sheet, YEAR, 'retirement', 'spendingUnmet')
    const funded = sheetCell(sheet, YEAR, 'retirement', 'spendingFunded')
    // $1,282.50 RRSP plus $225 TFSA, less $1,331 debt leaves $176.50.
    expect(spending.cell.value).toBe(386)
    expect(funded.cell.value).toBe(176.5)
    expect(funded.explanation!.formula!.reduce((sum, term) => sum + (term.direction === 'add' ? term.value : -term.value), 0)).toBe(176.5)
    expect(funded.explanation!.formula!.filter(term => term.field === 'expensePayments')).toEqual([
      expect.objectContaining({ direction: 'subtract', value: 0 }),
    ])
    const gross = sheetCell(sheet, YEAR, 'household', 'mortgageRrspGross')
    expect(gross.cell.value).toBe(1_282.5)
    for (const [locale, label, priority, dated] of [
      ['en', /expense shortfall/i, /never triggers or increases an RRSP quote/i, /dated user expense evidence/i],
      ['fr', /déficit de dépense/i, /ne déclenche ni n’augmente un devis REER/i, /preuve utilisateur datée/i],
      ['zh', /一次性支出缺口/, /不触发或增加 RRSP 报价/, /用户注明日期的支出证据/],
    ] as const) {
      expect(annualSheetText(result.row.label, locale)).toMatch(label)
      expect(annualSheetText(result.explanation!.summary!, locale)).toMatch(priority)
      const source = result.explanation!.sources!.find(item => item.field === 'annualHouseholdExpenseEvidence')!
      expect(annualSheetText(source.label, locale)).toMatch(dated)
      expect(annualSheetText(source.displayReference!, locale)).toContain(String(BASE_YEAR - 1))
    }
  })

  it('replays an exact expense shortfall smaller than one ULP of its displayed payment', () => {
    const { plan, evidence } = fixture({ selfTfsa: 99.99999999999999, partnerTfsa: 1_731, living: 300, amount: 200 })
    plan.annualHouseholdMortgageFundingEvidence!.orderedAccounts.reverse()
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    const row = result.rows[1]
    expect(row.householdWithdrawalSettlement!.rrspFunding).toBeUndefined()
    expect(row.householdExpense).toMatchObject({ due: 200, paid: 200, unmet: 1e-14,
      postings: [{ accountId: PARTNER_TFSA, ownerId: PARTNER, amount: 200 }] })
    const arithmetic = row.householdExpense!.arithmetic
    expect(exact(arithmetic.paid)).toBe(exact('199.99999999999999'))
    expect(exact(arithmetic.unmet)).toBe(exact('0.00000000000001'))
    expect(exact(arithmetic.due) - exact(arithmetic.paid)).toBe(exact(arithmetic.unmet))
    const sheet = canonicalAnnualSheet(result, context)
    const paid = sheetCell(sheet, YEAR, 'event', EVENT, 'expensePaid')
    expect(paid.explanation!.formula!.filter(term => term.field === 'householdExpense.residualOrdinaryCash')).toEqual([])
    expect(paid.explanation!.sources!.filter(source => source.field === 'householdExpense.residualOrdinaryCash')).toEqual([])
    expect(paid.explanation!.formula!.filter(term => term.field === 'householdExpense.postings')).toEqual([
      expect.objectContaining({ direction: 'add', value: 200 }),
    ])
    const debitReconciliations = paid.explanation!.formula!.filter(term => term.field === 'householdExpense.owner-debit-display-reconciliation')
    expect(debitReconciliations).toEqual([
      expect.objectContaining({ direction: 'add', value: -1e-14, basis: 'nominal-CAD' }),
    ])
    expect(exact(200) + exact(debitReconciliations[0].value)).toBe(exact(arithmetic.paid))
    const paidArithmetic = paid.explanation!.sources!.find(source => source.field === 'householdExpense.arithmetic')!
    for (const [locale, memo] of [
      ['en', /signed owner-debit display reconciliation.*no cash/i],
      ['fr', /rapprochement signé d’affichage des débits.*aucune trésorerie/i],
      ['zh', /持有人扣款显示带符号核对.*不提供现金/],
    ] as const) {
      expect(annualSheetText(debitReconciliations[0].label, locale)).toMatch(memo)
      expect(annualSheetText(paidArithmetic.displayReference!, locale)).toContain('-0.00000000000001')
    }
    const { cell, explanation } = sheetCell(sheet, YEAR, 'event', EVENT, 'expenseUnmet')
    expect(cell.value).toBe(1e-14)
    const terms = explanation!.formula!
    expect(terms.reduce((total, term) => total + (term.direction === 'add' ? term.value : -term.value), 0)).toBe(cell.value)
    for (const [locale, label] of [
      ['en', /exact|reconciliation/i], ['fr', /exact|rapprochement/i], ['zh', /精确|核对/],
    ] as const) {
      expect(terms.map(term => annualSheetText(term.label, locale)).join(' ')).toMatch(label)
      const sources = explanation!.sources!.flatMap(source => [source.label, ...(source.displayReference ? [source.displayReference] : [])])
      expect(sources.map(source => annualSheetText(source, locale)).join(' ')).toMatch(/199\.99999999999999|19999999999999999/)
    }
  })
})

describe('reached evidence and route isolation', () => {
  it.each([
    ['invalid nominal amount', (plan: InputsV2) => { plan.annualHouseholdExpenseEvidence!.amountNominal = known(-1) }, 'householdExpense'],
    ['post-anchor provenance', (plan: InputsV2) => { plan.annualHouseholdExpenseEvidence!.provenance.sourceYear = BASE_YEAR + 1 }, 'householdExpense'],
    ['mixed working and retired members', (plan: InputsV2) => { plan.people[0].retirementAge = 66 }, 'householdExpense'],
    ['a reached second owner without a statement', (plan: InputsV2) => {
      plan.accounts[0].balance = 200
      plan.accounts.find(account => account.id === PARTNER_TFSA)!.balance = 1_700
      delete plan.tfsaStatement![RETIREE]
    }, 'tfsaWithdrawalEvidence'],
  ])('stops atomically on %s', (_label, change, cause) => {
    const { plan, evidence } = fixture({ living: 300, amount: 500 })
    change(plan)
    const immutable = structuredClone({ plan, evidence })
    const control = withoutExpense(plan)
    const ordinary = ok(projectCanonicalCoverage(control, evidence, 2))
    expect(ordinary.blocked).toBeNull()
    const prefix = ok(projectCanonicalCoverage(control, evidence, 1))
    expect(ok(projectCanonicalCoverage(plan, evidence, 1))).toStrictEqual(prefix)
    const actual = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(actual.blocked).toMatchObject({ year: YEAR, status: 'unsupported', causes: [cause] })
    expect(actual.uncomputedYears).toStrictEqual([YEAR + 1])
    expect(actual.rows).toStrictEqual(prefix.rows)
    expect(actual.state).toStrictEqual(prefix.state)
    expect({ plan, evidence }).toStrictEqual(immutable)
    if (cause === 'householdExpense') {
      const stopped = sheetCell(canonicalAnnualSheet(actual, context), YEAR, 'retirement', 'spendingUnmet').cell
      expect(stopped.status).toBe('not-computed')
      for (const [locale, reason] of [
        ['en', /one-time household expense.*dated user evidence/i], ['fr', /dépense ponctuelle.*preuve utilisateur datée/i],
        ['zh', /一次性支出.*注明日期的证据/],
      ] as const) expect(annualSheetText(stopped.reason!, locale)).toMatch(reason)
    }
  })

  it('keeps absent RRSP opt-in and a future invalid event on their original paths', () => {
    const { plan, evidence } = fixture({ living: 300 })
    plan.annualHouseholdExpenseEvidence!.effectiveYear = YEAR + 2
    plan.annualHouseholdExpenseEvidence!.amountNominal = known(-1)
    const control = ok(projectCanonicalCoverage(withoutExpense(plan), evidence, 3))
    expect(control.blocked).toBeNull()
    expect(control.rows[1].householdWithdrawalSettlement!.rrspFunding!.gross).toBe(1_431)
    expect(ok(projectCanonicalCoverage(plan, evidence, 3))).toStrictEqual(control)
    delete plan.annualHouseholdMortgageRrspEvidence
    const noOptIn = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(noOptIn).toStrictEqual(ok(projectCanonicalCoverage(withoutExpense(plan), evidence, 3)))
    expect(noOptIn.blocked!.year).toBe(BASE_YEAR)

    const tfsaOnly = fixture({ rrsp: 0, living: 300, amount: 80, partnerTfsa: 1_700, selfTfsa: 200 })
    delete tfsaOnly.plan.annualHouseholdMortgageRrspEvidence
    const oldExpense = ok(projectCanonicalCoverage(tfsaOnly.plan, tfsaOnly.evidence, 2))
    expect(oldExpense.blocked).toBeNull()
    expect(oldExpense.rows[1].householdExpense).toMatchObject({ due: 80, paid: 80, unmet: 0,
      postings: [{ accountId: PARTNER_TFSA, amount: 69 }, { accountId: TFSA, amount: 11 }] })
    expect(oldExpense.rows[1].householdWithdrawalSettlement!.rrspFunding).toBeUndefined()
    const oldSheet = canonicalAnnualSheet(oldExpense, context)
    const paid = sheetCell(oldSheet, YEAR, 'event', EVENT, 'expensePaid')
    expect(paid.explanation!.formula!.map(term => [term.field, term.direction, term.value])).toStrictEqual([
      ['householdExpense.postings', 'add', 69], ['householdExpense.postings', 'add', 11],
    ])
    for (const [locale, rrsp] of [['en', /RRSP/], ['fr', /REER/], ['zh', /RRSP/]] as const) {
      expect(annualSheetText(paid.explanation!.summary!, locale)).not.toMatch(rrsp)
    }
    const cashBefore = sheetCell(oldSheet, YEAR, 'cash', 'canonicalNetCash')
    expect(cashBefore.cell.value).toBe(-1_631)
    expect(cashBefore.explanation!.formula!.map(term => term.field)).toStrictEqual([
      'income', 'benefits', 'tax', 'spending', 'debtPayments', 'payrollContributions',
    ])
  })

  it('keeps external providers and detached continuations outside authenticated composition', () => {
    const { plan, evidence } = fixture()
    const reached = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(reached.blocked).toBeNull()
    const detached = structuredClone(reached.state)
    expect(annualRetirementContinuation(plan, detached, evidence)).toMatchObject({ status: 'invalid' })
    const untouched = structuredClone(detached)
    const evaluate = vi.fn<AnnualProviders['evaluate']>()
    const returns = vi.fn<AnnualProviders['returns']>()
    expect(annualStep(plan, detached, { evaluate, returns })).toMatchObject({ status: 'invalid' })
    expect(evaluate).not.toHaveBeenCalled()
    expect(returns).not.toHaveBeenCalled()
    expect(detached).toStrictEqual(untouched)

    plan.budget = { kind: 'savingsBudget', annualNetSavings: 0, retirementSpending: 0,
      debtIncluded: known(true), taxBenefitIncluded: known(true) }
    for (const person of plan.people) person.retirementAge = 68
    const opening = ok(initializeState(plan))
    const control = withoutExpense(plan)
    delete control.annualHouseholdMortgageRrspEvidence
    const providers: AnnualProviders = { returns: () => 0, evaluate: ({ state }) => ({
      byPerson: Object.fromEntries(plan.people.map(person => [person.id, {
        income: person.role === 'self' && state.byDebt[DEBT].principal > 0 ? PAYMENT : 0,
        earnedIncome: 0, benefits: 0, tax: 0, spending: 0, taxableIncome: 0, benefitIncomeForNextYear: known(0),
      }])),
    }) }
    const external = ok(projectAnnualCoverage(control, opening, 3, providers))
    expect(external).toMatchObject({ blocked: null, evaluationBasis: 'provider-supplied' })
    expect(external.rows[1].year).toBe(YEAR)
    expect(projectAnnualCoverage(plan, opening, 3, providers)).toStrictEqual({ status: 'ok', value: external })
    expect(projectFromState(plan, opening, 3, providers)).toStrictEqual(projectFromState(control, opening, 3, providers))
    expect(annualRetirementStep(plan, opening)).toStrictEqual(annualRetirementStep(control, opening))
  })

  it('preserves the solo ledger and production, sampled, and legacy/S1 results', () => {
    const { plan, evidence } = fixture()
    const control = withoutExpense(plan)
    delete control.annualHouseholdMortgageRrspEvidence
    const input = plan.legacyProjection
    for (const sampled of [false, true]) {
      const sample = sampled ? vi.fn(() => -0.04) : undefined
      const reference = sampled ? vi.fn(() => -0.04) : undefined
      expect(runProjection(input, sample, plan)).toStrictEqual(runProjection(input, reference, control))
      expect(sample?.mock.calls).toStrictEqual(reference?.mock.calls)
    }
    const traced = runProjection(input, undefined, plan, { captureAnnualDetails: true })
    const baseline = runProjection(input, undefined, control, { captureAnnualDetails: true })
    expect(traced).toStrictEqual(baseline)
    expect(traced.rows.some(row => row.age >= 65)).toBe(true)
    const sheet = legacyAnnualSheet(traced, input, context)
    const oldSheet = legacyAnnualSheet(baseline, input, context)
    expect(sheet.rows).toStrictEqual(oldSheet.rows)
    expect(sheet.years).toStrictEqual(oldSheet.years)

    plan.people.shift()
    plan.accounts = plan.accounts.filter(account => account.id !== PARTNER_TFSA)
    plan.properties[0].taxableOwnerShares = { status: 'known', shares: { [RETIREE]: 1 } }
    delete plan.tfsaStatement![PARTNER]
    delete plan.legacyProjection.partner
    delete plan.annualHouseholdMortgageFundingEvidence
    const solo = withoutExpense(plan)
    delete solo.annualHouseholdMortgageRrspEvidence
    const soloResult = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(soloResult.blocked).toBeNull()
    expect(soloResult).toStrictEqual(ok(projectCanonicalCoverage(solo, evidence, 2)))
  })
})
