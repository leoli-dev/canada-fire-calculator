import { describe, expect, it } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { annualRetirementContinuation } from '../annualRetirement'
import { initializeState, projectAnnualCoverage, projectCanonicalCoverage, sumNetWorth, type KernelResult } from '../annualState'
import { runProjection } from '../projection'
import { BASE_YEAR, known, legacyRetirement, recorded, retirementPlan, RETIREE, TFSA } from './fixtures/retirementSettlement'

const HOME = 'home'
const LIEN = 'fixed-mortgage'
const SALE_YEAR = 2028
const CONTEXT = { scenarioId: 'mortgaged-home-sale-independent', revision: 1 }
const close = (amount: number) => expect.closeTo(amount, 6)

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function fixture() {
  const plan = retirementPlan({ tfsa: 25_000, rrsp: 0, spending: 5_000, inflation: 0.02, strategy: 'tfsaFirst' })
  plan.accounts = plan.accounts.filter(account => account.id === TFSA)
  Object.assign(plan.people[0], { earnedIncome: known(80_000), retirementAge: 58, tfsaAvailableRoom: known(20_000) })
  plan.lifeExpectancy = 61
  plan.budget = { kind: 'incomeBudget', workingSpending: 46_000, retirementSpending: 5_000 }
  plan.properties.push({
    id: HOME, kind: 'principal', value: 50_000, acb: known(20_000), annualRent: known(0), appreciation: 0.04,
    sellAtAge: 59, plannedPurchaseAge: null, plannedDownPayment: null, plannedMortgage: null,
    annualHoldingCostChange: 0, mortgageDebtId: LIEN,
    taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 1 } },
    provenance: { value: recorded, acb: { origin: 'user', sourceYear: 2014, note: 'Acquisition statement' } },
  })
  plan.debts.push({ id: LIEN, kind: 'mortgage', propertyId: HOME, principal: 25_220, annualPayment: 9_261,
    yearsRemaining: 3, provenance: recorded })
  const terms = {
    debtId: LIEN, timing: 'start-of-sale-year' as const, effectiveYear: SALE_YEAR,
    openingPrincipalNominal: known(8_820),
    additionalAccruedInterestNominal: known(0), prepaymentPenaltyNominal: known(0), dischargeFeesNominal: known(0),
    provenance: { origin: 'user' as const, sourceYear: BASE_YEAR, note: 'Recorded payout terms' },
  }
  const sale = { provenance: recorded, wholePropertyFullyExcluded: true as const,
    salePriceBasis: 'opening-year-nominal-value' as const, sellingCostsNominal: known(5_000),
    postSaleAnnualSpendingReal: known(20_000), mortgagePayoff: terms }
  plan.annualPrimaryHomeSaleEvidence = { [HOME]: sale }
  const evidence = { workingSpending: known(46_000), retirementSpending: known(5_000),
    scheduledMortgagePaymentsExcluded: known(true as const) }
  return { plan, evidence, terms, sale }
}

function findRow(rows: AnnualSheetRow[], id: string): AnnualSheetRow | undefined {
  for (const row of rows) {
    if (row.id === id) return row
    const child = findRow(row.children ?? [], id)
    if (child) return child
  }
}

describe('independent verified sale with a linked mortgage', () => {
  it('settles the fixed opening principal once and spends the residual before drawing the TFSA', () => {
    const { plan, evidence, terms } = fixture()
    const original = structuredClone({ plan, evidence })
    const held = structuredClone(plan)
    held.properties[0].sellAtAge = null
    delete held.annualPrimaryHomeSaleEvidence
    const prefix = ok(projectCanonicalCoverage(held, evidence, 2))
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(coverage).toMatchObject({ blocked: null, uncomputedYears: [], evaluationBasis: 'canonical-continuous' })
    expect(coverage.rows.map(row => row.year)).toEqual([2026, 2027, 2028, 2029, 2030])
    expect(coverage.rows.slice(0, 2)).toEqual(prefix.rows)
    const [working, retired, sold, carry, exhausted] = coverage.rows
    expect(working.workingSettlement).toBeDefined()
    expect(working.cashLedger).toMatchObject({ income: 80_000, spending: 46_000, debtPayments: 9_261 })
    expect(working.byAccount[TFSA].contribution).toBe(5_041.63)

    // The fixed schedule is $9,261 annually at 5%. After the first $1,261
    // interest, principal falls by $8,000. The second interest is $861,
    // leaving $8,820 of principal before any third-year interest.
    expect(working.byDebt[LIEN]).toEqual({ propertyId: HOME, opening: 25_220, interest: close(1_261),
      principal: close(8_000), payment: 9_261, closing: close(17_220) })
    expect(retired.byDebt[LIEN]).toEqual({ propertyId: HOME, opening: close(17_220), interest: close(861),
      principal: close(8_400), payment: 9_261, closing: close(8_820) })
    expect(retired.cashLedger).toMatchObject({ spending: close(5_100), debtPayments: 9_261 })
    expect(retired.byAccount[TFSA].withdrawal).toBeCloseTo(14_361, 6)
    expect(prefix.state.byAccount[TFSA].balance).toBeCloseTo(16_607.091852, 6)
    const exactBeforeSale = prefix.state.mortgageExactBalances![TFSA]
    const exactClosingAfterSale = {
      coefficient: (BigInt(exactBeforeSale.coefficient) * 102n).toString(),
      scale: exactBeforeSale.scale + 2,
    }

    // $50,000 × (1.04 × 1.02)² at sale-year opening. Selling costs reduce
    // the gain, ACB stays at its recorded nominal value, and the payoff
    // comes out of proceeds after the gain calculation.
    const gross = 56_264.832
    const net = 51_264.832
    const residual = 42_444.832
    const receipt = { propertyId: HOME, year: SALE_YEAR, grossProceeds: close(gross),
      sellingCosts: 5_000, acb: 20_000, netProceeds: close(net), realizedGain: close(31_264.832), taxableGain: 0,
      mortgagePayoff: { debtId: LIEN, openingPrincipal: close(8_820), additionalAccruedInterest: 0,
        prepaymentPenalty: 0, dischargeFees: 0, totalPayoff: close(8_820), residualCash: close(residual), terms } }
    expect(sold.retirementSettlement?.primaryHomeSale).toMatchObject(receipt)
    expect(sold.retirementSettlement?.primaryHomeSale?.valuation).toEqual({
      recordedOpeningValue: 56_264.831999999995,
      modeledGrossProceeds: { coefficient: '56264832', scale: 3 },
      reconciliation: 0.000000000005,
    })
    expect(sold.byProperty[HOME]).toEqual({ held: false, opening: close(gross), growth: 0, closing: 0 })
    expect(prefix.state.byProperty[HOME].value.toString()).toBe('56264.831999999995')
    expect(sold.byDebt[LIEN]).toMatchObject({ propertyId: HOME, opening: close(8_820), interest: 0,
      principal: close(8_820), payment: close(8_820), closing: 0, salePayoff: close(8_820) })
    expect(sold.retirementSettlement?.primaryHomeSaleArithmetic?.receipt).toMatchObject({
      grossProceeds: { coefficient: '56264832', scale: 3 },
      recordedOpeningValue: { coefficient: '56264831999999995', scale: 12 },
      saleValueReconciliation: { coefficient: '5', scale: 12 },
      mortgagePrincipalPaid: { coefficient: '8820', scale: 0 },
      residualCash: { coefficient: '42444832', scale: 3 },
    })

    const schedule = [
      [sold, 0, residual, 20_808, 21_636.832, 0, 20_808, 0, 16_939.23368904, 38_576.06568904],
      [carry, 21_636.832, 0, 21_224.16, 412.672, 0, 21_224.16, 0, 17_278.0183628208, 17_690.6903628208],
      [exhausted, 412.672, 0, 412.672, 0, 17_278.0183628208, 21_648.6432, 3_957.9528371792, 0, 0],
    ] as const
    for (const [row, opening, proceedsAdded, spendingUsed, closing, withdrawal, due, unmet, tfsaClosing, worth] of schedule) {
      expect(row.retirementSettlement).toMatchObject({ spendingDue: close(due), spendingFunded: close(due - unmet),
        spendingUnmet: close(unmet), primaryHomeSaleCash: {
          opening: close(opening), proceedsAdded: close(proceedsAdded), spendingUsed: close(spendingUsed), closing: close(closing),
        } })
      expect(row.cashLedger).toMatchObject({ income: 0, benefits: 0, spending: close(due - unmet), tax: 0, debtPayments: 0, unallocated: 0 })
      expect(row.taxLedger).toEqual({ [RETIREE]: { taxableIncome: 0, tax: 0 } })
      expect(row.byAccount[TFSA]).toMatchObject({ withdrawal: close(withdrawal), closing: close(tfsaClosing) })
      if (row.year > SALE_YEAR) {
        expect(row.retirementSettlement?.primaryHomeSale).toBeUndefined()
        expect(row.byDebt[LIEN]).toMatchObject({ opening: 0, interest: 0, principal: 0, payment: 0, closing: 0 })
        expect(row.byDebt[LIEN].salePayoff).toBeUndefined()
      }
      const shortened = ok(projectCanonicalCoverage(plan, evidence, row.year - BASE_YEAR + 1))
      expect(shortened.rows).toEqual(coverage.rows.slice(0, row.year - BASE_YEAR + 1))
      expect(shortened.state.byDebt[LIEN]).toMatchObject({ principal: 0, yearsRemaining: 0 })
      expect(shortened.state.mortgageExactBalances).toBeUndefined()
      expect(shortened.state.primaryHomeSaleCash).toMatchObject({ balance: close(closing), receipt })
      expect(shortened.state.primaryHomeSaleCash?.receipt.mortgagePayoff?.terms).not.toBe(terms)
      expect(shortened.state.primaryHomeSaleCash?.receipt.mortgagePayoff).not.toBe(
        shortened.rows[2].retirementSettlement?.primaryHomeSale?.mortgagePayoff)
      expect(sumNetWorth(shortened.state)).toBeCloseTo(worth, 6)
      if (row === sold) expect(shortened.state.primaryHomeSaleCash?.exactAccountBalances[TFSA]).toEqual(exactClosingAfterSale)
    }
    expect({ plan, evidence }).toEqual(original)
  })

  it('shows localized payoff and residual rows and reconciles pre-payoff proceeds', () => {
    const { plan, evidence } = fixture()
    const sheet = canonicalAnnualSheet(ok(projectCanonicalCoverage(plan, evidence, 5)), CONTEXT)
    const get = (...path: string[]) => findRow(sheet.rows, canonicalSheetId('value', ...path))!
    const column = sheet.years.find(year => year.year === SALE_YEAR)!
    const payoff = get('primaryHomeSale', 'mortgagePrincipalPaid')
    const residual = get('primaryHomeSale', 'residualCash')
    for (const [row, amount] of [[payoff, 8_820], [residual, 42_444.832]] as const) {
      const cell = row.cells![SALE_YEAR]
      expect(cell).toMatchObject({ value: close(amount), basis: 'nominal-CAD', timing: 'during-year' })
      expect(annualSheetDisplayValue(cell, column, 'nominal')).toBeCloseTo(amount, 6)
      expect(annualSheetDisplayValue(cell, column, 'real')).toBeCloseTo(amount / 1.0404, 6)
      for (const year of [2027, 2029]) expect(row.cells![year]).toMatchObject({ status: 'not-applicable', value: null })
    }
    for (const [locale, principalText, residualText] of [
      ['en', /principal paid from sale/i, /cash after payoff/i],
      ['fr', /capital hypothécaire payé par vente/i, /résiduelle après remboursement/i],
      ['zh', /出售所得偿还房贷本金/, /偿还房贷后售房现金/],
    ] as const) {
      expect(annualSheetText(payoff.label, locale)).toMatch(principalText)
      expect(annualSheetText(residual.label, locale)).toMatch(residualText)
    }
    const details = sheet.resolveExplanation!(residual.cells![SALE_YEAR].explanationRefs![0])!
    expect(details.formula).toEqual([
      expect.objectContaining({ field: 'netProceeds', direction: 'add', value: close(51_264.832) }),
      expect.objectContaining({ field: 'mortgagePayoff.totalPayoff', direction: 'subtract', value: close(8_820) }),
    ])
    const terms = details.sources!.find(source => source.field === 'annualPrimaryHomeSaleEvidence.mortgagePayoff')!
    const payments = get('debt', LIEN, 'payment').cells!
    const paymentExplanation = (year: number) => sheet.resolveExplanation!(payments[year].explanationRefs![0])!.summary!
    expect(payments[SALE_YEAR].value).toBeCloseTo(8_820, 6)
    expect(payments[2027].value).toBe(9_261)
    for (const [locale, saleFunding, scheduledPayment, prePayoff, principalPaid, payoffTerms, zeroCosts] of [
      ['en', /funded from sale proceeds/i, /fixed nominal payment/i, /net proceeds before payoff/i,
        /opening mortgage principal repaid/i, /payoff terms.*effective sale year/i,
        /additional accrued interest.*prepayment penalty.*discharge fees.*0 nominal CAD each/i],
      ['fr', /produit de (la )?vente/i, /paiement nominal fixe/i, /produit net avant remboursement/i,
        /capital hypothécaire initial remboursé/i, /modalités.*remboursement.*année/i,
        /intérêts courus supplémentaires.*pénalité de remboursement anticipé.*frais de quittance.*chacun 0 CAD/i],
      ['zh', /出售所得|售房所得/, /固定名义付款/, /偿还.*前.*净所得|偿还.*前.*净额/,
        /偿还.*期初.*本金|期初.*本金.*偿还/, /条款.*年/,
        /额外应计利息.*提前还款罚金.*解除抵押费用.*各为0名义加元/],
    ] as const) {
      expect(annualSheetText(paymentExplanation(SALE_YEAR), locale)).toMatch(saleFunding)
      const scheduled = annualSheetText(paymentExplanation(2027), locale)
      expect(scheduled).toMatch(scheduledPayment)
      expect(scheduled).not.toMatch(saleFunding)
      expect(annualSheetText(details.formula![0].label, locale)).toMatch(prePayoff)
      expect(annualSheetText(details.formula![1].label, locale)).toMatch(principalPaid)
      expect(annualSheetText(terms.label, locale)).toMatch(payoffTerms)
      const reference = annualSheetText(terms.displayReference!, locale)
      expect(reference).toContain(String(SALE_YEAR))
      expect(reference).toContain(String(BASE_YEAR))
      expect(reference).toMatch(/8[\s,\u00a0\u202f]?820/)
      expect(reference).toMatch(zeroCosts)
      expect(reference).not.toMatch(/[{}"]|effectiveYear|openingPrincipalNominal|prepaymentPenaltyNominal|dischargeFeesNominal/)
    }
    expect(get('cash', 'debtPayments').cells![SALE_YEAR].value).toBe(0)
    expect(get('primaryHomeSaleCash', 'proceedsAdded').cells![SALE_YEAR].value).toBeCloseTo(42_444.832, 6)
    expect(get('primaryHomeSale', 'acb').cells![SALE_YEAR]).toMatchObject({ value: 20_000, basis: 'nominal-tax-basis' })
    expect(get('netWorth').cells![SALE_YEAR].value).toBeCloseTo(38_576.06568904, 6)
  })

  it.each([
    ['absent terms', { mortgagePayoff: undefined }],
    ['wrong debt ID', { debtId: 'other-debt' }],
    ['wrong effective year', { effectiveYear: 2029 }],
    ['absent opening principal quote', { openingPrincipalNominal: undefined }],
    ['unknown opening principal quote', { openingPrincipalNominal: { status: 'unknown', reason: 'Missing quote' } }],
    ['mismatched opening principal quote', { openingPrincipalNominal: known(8_820.01) }],
    ['wrong timing', { timing: 'end-of-sale-year' }],
    ['future provenance year', { provenance: { origin: 'user', sourceYear: SALE_YEAR } }],
    ['estimated provenance', { provenance: { origin: 'estimated', sourceYear: BASE_YEAR } }],
    ['missing provenance', { provenance: undefined }],
    ['missing additional interest', { additionalAccruedInterestNominal: undefined }],
    ['unknown additional interest', { additionalAccruedInterestNominal: { status: 'unknown', reason: 'Missing statement' } }],
    ['nonzero additional interest', { additionalAccruedInterestNominal: known(0.01) }],
    ['nonzero penalty', { prepaymentPenaltyNominal: known(0.01) }],
    ['nonzero discharge fee', { dischargeFeesNominal: known(0.01) }],
    ['missing discharge fee', { dischargeFeesNominal: undefined }],
  ])('rolls back the sale with %s', (_, change) => {
    const { plan, evidence, terms, sale } = fixture()
    if ('mortgagePayoff' in change) delete plan.annualPrimaryHomeSaleEvidence![HOME].mortgagePayoff
    else Object.assign(terms, change)
    const before = structuredClone({ plan, evidence })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(stopped).toMatchObject({ blocked: { year: SALE_YEAR, status: 'unsupported', causes: ['propertySale'] },
      uncomputedYears: [2029, 2030], overallConclusionAvailable: false })
    expect(stopped.rows).toEqual(prefix.rows)
    expect(stopped.state).toEqual(prefix.state)
    expect(stopped.state.primaryHomeSaleCash).toBeUndefined()
    expect(stopped.state.byDebt[LIEN].principal).toBeCloseTo(8_820, 6)
    expect(stopped.state.byProperty[HOME].held).toBe(true)
    const sheet = canonicalAnnualSheet(stopped, CONTEXT)
    const cells = findRow(sheet.rows, canonicalSheetId('value', 'netWorth'))!.cells!
    expect(cells[2027].value).toBeCloseTo(64_051.923852, 6)
    for (const year of [2028, 2029, 2030]) expect(cells[year]).toMatchObject({ status: 'not-computed', value: null })
    expect({ plan, evidence }).toEqual(before)
    expect(sale).toEqual(before.plan.annualPrimaryHomeSaleEvidence![HOME])
  })

  it('admits exact payoff with zero residual and refuses a one-cent shortfall despite available TFSA', () => {
    const { plan, evidence, sale, terms } = fixture()
    plan.inflation = 0
    plan.accounts[0].balance = 10_000
    plan.people[0].earnedIncome = known(12_000)
    plan.budget = { kind: 'incomeBudget', workingSpending: 10_098.65, retirementSpending: 2_000 }
    evidence.workingSpending = known(10_098.65)
    evidence.retirementSpending = known(2_000)
    Object.assign(plan.properties[0], { value: 1_300, appreciation: 0, acb: known(200) })
    Object.assign(plan.debts[0], { principal: 3_600, annualPayment: 1_200 })
    terms.openingPrincipalNominal = known(1_200)
    sale.sellingCostsNominal = known(100)
    sale.postSaleAnnualSpendingReal = known(500)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(prefix.state.byAccount[TFSA].balance).toBe(6_800)
    expect(prefix.state.byDebt[LIEN].principal).toBe(1_200)
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    const sold = result.rows[2]
    expect(sold.retirementSettlement).toMatchObject({
      spendingFunded: 500, primaryHomeSale: { grossProceeds: 1_300, netProceeds: 1_200, realizedGain: 1_000, taxableGain: 0,
        mortgagePayoff: { totalPayoff: 1_200, residualCash: 0 } },
      primaryHomeSaleCash: { opening: 0, proceedsAdded: 0, spendingUsed: 0, closing: 0 },
    })
    expect(sold.byAccount[TFSA].withdrawal).toBe(500)
    expect(sumNetWorth(result.state)).toBe(6_300)

    sale.sellingCostsNominal = known(100.01)
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(stopped.rows).toEqual(prefix.rows)
    expect(stopped.state).toEqual(prefix.state)
    expect(stopped.blocked).toMatchObject({ year: SALE_YEAR, status: 'unsupported', causes: ['propertySale'] })
    expect(stopped.blocked?.issues[0].detail).toMatch(/net sale proceeds cannot cover opening mortgage principal/i)
  })

  it.each([
    {
      label: 'the opening debt recurrence carries floating-point noise', elapsed: 1, inflation: 0, appreciation: 0,
      value: 2_410, initialPrincipal: 3_310, annualPayment: 1_331, workingSpending: 9_967.65,
      gross: 2_410, sellingCosts: 100, oneCentHigher: 100.01, subCentHigher: 100.000000000001,
      payoff: 2_310, tfsaOpening: 10_000,
      spending: 500, netWorth: 9_500,
      recordedPrincipal: 2_310.0000000000005, recordedValue: 2_410,
      principalBridge: { coefficient: '-5', scale: 13 }, valueBridge: { coefficient: '0', scale: 0 },
    },
    {
      label: 'the opening property valuation carries floating-point noise', elapsed: 2, inflation: 0.03, appreciation: 0.02,
      value: 250_000, initialPrincipal: 3_600, annualPayment: 1_200, workingSpending: 10_098.65,
      gross: 275_940.09, sellingCosts: 274_740.09, oneCentHigher: 274_740.10, subCentHigher: 274_740.0900000001,
      payoff: 1_200, tfsaOpening: 7_251.20,
      spending: 530.45, netWorth: 6_922.3725,
      recordedPrincipal: 1_200, recordedValue: 275_940.08999999997,
      principalBridge: { coefficient: '0', scale: 0 }, valueBridge: { coefficient: '3', scale: 11 },
    },
  ])('admits a fully funded payout when $label', ({
    elapsed, inflation, appreciation, value, initialPrincipal, annualPayment, workingSpending,
    gross, sellingCosts, oneCentHigher, subCentHigher, payoff, tfsaOpening, spending, netWorth,
    recordedPrincipal, recordedValue, principalBridge, valueBridge,
  }) => {
    const { plan, evidence, terms, sale } = fixture()
    const year = BASE_YEAR + elapsed
    plan.inflation = inflation
    plan.accounts[0].balance = 10_000
    plan.people[0].earnedIncome = known(12_000)
    plan.budget = { kind: 'incomeBudget', workingSpending, retirementSpending: 2_000 }
    evidence.workingSpending = known(workingSpending)
    evidence.retirementSpending = known(2_000)
    Object.assign(plan.properties[0], { value, appreciation, sellAtAge: 57 + elapsed, acb: known(200) })
    Object.assign(plan.debts[0], { principal: initialPrincipal, annualPayment })
    terms.effectiveYear = year
    terms.openingPrincipalNominal = known(payoff)
    sale.sellingCostsNominal = known(sellingCosts)
    sale.postSaleAnnualSpendingReal = known(500)

    // At 10% the first installment pays $331 interest and $1,000
    // principal. The other case uses zero mortgage interest and values the
    // home at $250,000 × (1.02 × 1.03)² at the start of year three.
    const prefix = ok(projectCanonicalCoverage(plan, evidence, elapsed))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows[0].workingSettlement).toBeDefined()
    expect(prefix.state.byAccount[TFSA].balance).toBeCloseTo(tfsaOpening, 6)
    expect(prefix.state.byProperty[HOME].value).toBe(recordedValue)
    expect(prefix.state.byDebt[LIEN].principal).toBe(recordedPrincipal)

    const settled = ok(projectCanonicalCoverage(plan, evidence, elapsed + 2))
    expect(settled.blocked).toBeNull()
    expect(settled.rows.slice(0, elapsed)).toEqual(prefix.rows)
    const sold = settled.rows[elapsed]
    expect(sold.retirementSettlement).toMatchObject({
      spendingFunded: close(spending), primaryHomeSale: { grossProceeds: close(gross), netProceeds: close(payoff),
        realizedGain: close(payoff - 200), taxableGain: 0, valuation: { recordedOpeningValue: recordedValue },
        mortgagePayoff: { recordedOpeningPrincipal: recordedPrincipal, openingPrincipal: payoff, totalPayoff: payoff, residualCash: 0 } },
      primaryHomeSaleArithmetic: { receipt: { residualCash: { coefficient: '0', scale: 0 },
        saleValueReconciliation: valueBridge, mortgagePrincipalReconciliation: principalBridge } },
      primaryHomeSaleCash: { opening: 0, proceedsAdded: 0, spendingUsed: 0, closing: 0 },
    })
    expect(sold.byDebt[LIEN]).toMatchObject({ opening: recordedPrincipal, principal: payoff, payment: payoff, interest: 0, closing: 0 })
    if (principalBridge.coefficient !== '0') {
      expect(sold.byDebt[LIEN].payoffPrincipalReconciliation).toBe(-0.0000000000005)
      expect(sold.retirementSettlement?.primaryHomeSale?.mortgagePayoff?.principalReconciliation).toBe(-0.0000000000005)
    }
    if (valueBridge.coefficient !== '0') {
      expect(sold.retirementSettlement?.primaryHomeSale?.valuation?.reconciliation).toBe(0.00000000003)
    }
    expect(sold.byAccount[TFSA].withdrawal).toBeCloseTo(spending, 6)
    expect(sold.byAccount[TFSA].closing).toBeCloseTo(netWorth, 6)
    expect(settled.rows[elapsed + 1].retirementSettlement?.primaryHomeSale).toBeUndefined()

    const sheet = canonicalAnnualSheet(settled, CONTEXT)
    const cell = (field: string) => findRow(sheet.rows, canonicalSheetId('value', 'primaryHomeSale', field))!.cells![year]
    expect(cell('recordedOpeningValue').value).toBe(recordedValue)
    expect(cell('recordedOpeningPrincipal').value).toBe(recordedPrincipal)
    expect(cell('mortgagePrincipalPaid').value).toBe(payoff)
    expect(cell('saleValueReconciliation').value).toBe(valueBridge.coefficient === '0' ? 0 : 0.00000000003)
    expect(cell('mortgagePrincipalReconciliation').value).toBe(principalBridge.coefficient === '0' ? 0 : -0.0000000000005)
    const reconciliationField = valueBridge.coefficient !== '0' ? 'saleValueReconciliation' : 'mortgagePrincipalReconciliation'
    const signedAmount = reconciliationField === 'saleValueReconciliation'
      ? /\+\s*\$?\s*0[.,]00000000003\b/
      : /[-−]\s*\$?\s*(?:0[.,]0000000000005|5e[-−]13)\b/
    const explanation = sheet.resolveExplanation!(cell(reconciliationField).explanationRefs![0])!
    const reference = explanation.sources!.find(source => source.field === 'annualPrimaryHomeSaleEvidence.mortgagePayoff')!.displayReference!
    for (const [locale, nominalBasis, valueLabel, principalLabel, valuationDetail, principalDetail] of [
      ['en', /nominal CAD/i, /modeled (sale )?(value|price).*recorded/i, /quot(e|ed).*recorded/i,
        /modeled sale price minus recorded opening home value: ([^ ]+)/i, /signed quote minus recorded reconciliation: ([^ ]+)/i],
      ['fr', /CAD nominaux|CAD nominal/i, /prix modélisé.*valeur.*consignée/i, /devis.*consigné/i,
        /prix de vente modélisé moins valeur initiale du logement consignée\s*:\s*([^ ]+)/i,
        /devis moins capital consigné\s*:\s*([^ ]+)/i],
      ['zh', /名义加元/, /模型售价.*记录.*估值/, /报价.*记录.*本金/,
        /模型售价减记录期初房产价值的精确带符号差额：([^名]+)/, /报价减记录本金的带符号核对差额：([^名]+)/],
    ] as const) {
      const row = findRow(sheet.rows, canonicalSheetId('value', 'primaryHomeSale', reconciliationField))!
      expect(annualSheetText(row.label, locale)).toMatch(
        reconciliationField === 'saleValueReconciliation' ? valueLabel : principalLabel,
      )
      const detail = annualSheetText(reference, locale)
      const valuation = detail.match(valuationDetail)?.[1]
      const principal = detail.match(principalDetail)?.[1]
      expect(valuation).toBeDefined()
      expect(principal).toBeDefined()
      const [adjustment, unchanged] = reconciliationField === 'saleValueReconciliation'
        ? [valuation, principal] : [principal, valuation]
      expect(adjustment).toMatch(signedAmount)
      expect(unchanged).toMatch(/^\+?0$/)
      expect(detail).toMatch(nominalBasis)
      expect(detail).not.toMatch(/[{}"]|effectiveYear|openingPrincipalNominal|saleValueReconciliation|principalReconciliation/)
    }

    for (const higherFee of [oneCentHigher, subCentHigher]) {
      sale.sellingCostsNominal = known(higherFee)
      const stopped = ok(projectCanonicalCoverage(plan, evidence, elapsed + 2))
      expect(stopped.rows).toEqual(prefix.rows)
      expect(stopped.state).toEqual(prefix.state)
      expect(stopped.blocked).toMatchObject({ year, status: 'unsupported', causes: ['propertySale'] })
      expect(stopped.blocked?.issues[0].detail).toMatch(/net sale proceeds cannot cover opening mortgage principal/i)
    }
  })

  it('requires payoff terms even when the recorded linked mortgage matures before sale', () => {
    const { plan, evidence, terms } = fixture()
    Object.assign(plan.debts[0], { principal: 18_522, yearsRemaining: 2 })
    terms.openingPrincipalNominal = known(0)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(prefix.state.byDebt[LIEN]).toMatchObject({ principal: 0, yearsRemaining: 0 })
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    expect(result.rows[1].byDebt[LIEN].closing).toBe(0)
    expect(result.rows[2].retirementSettlement?.primaryHomeSale?.mortgagePayoff).toMatchObject({
      openingPrincipal: 0, totalPayoff: 0, residualCash: close(51_264.832),
    })
    terms.openingPrincipalNominal = known(1e-12)
    const tinyQuote = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(tinyQuote.rows).toEqual(prefix.rows)
    expect(tinyQuote.state).toEqual(prefix.state)
    expect(tinyQuote.blocked).toMatchObject({ year: SALE_YEAR, status: 'unsupported', causes: ['propertySale'] })
    expect(tinyQuote.blocked?.issues[0].detail).toMatch(/exactly zero opening principal/i)
    delete plan.annualPrimaryHomeSaleEvidence![HOME].mortgagePayoff
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(stopped.rows).toEqual(result.rows.slice(0, 2))
    expect(stopped.blocked).toMatchObject({ year: SALE_YEAR, status: 'unsupported', causes: ['propertySale'] })
  })

  it('rejects a zero quote when the recorded opening mortgage still has a tiny positive balance', () => {
    const { plan, evidence, terms } = fixture()
    // Three equal binary-exact installments avoid introducing a rate from
    // decimal-to-binary conversion before the payoff admission check.
    const installment = 2 ** -40
    Object.assign(plan.debts[0], { principal: 3 * installment, annualPayment: installment })
    terms.openingPrincipalNominal = known(installment)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(prefix.state.byDebt[LIEN]).toMatchObject({ principal: installment, yearsRemaining: 1 })
    const verified = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(verified.blocked).toBeNull()
    expect(verified.rows[2].retirementSettlement?.primaryHomeSale?.mortgagePayoff?.totalPayoff).toBe(installment)

    terms.openingPrincipalNominal = known(0)
    const zeroQuote = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(zeroQuote.rows).toEqual(prefix.rows)
    expect(zeroQuote.state).toEqual(prefix.state)
    expect(zeroQuote.blocked).toMatchObject({ year: SALE_YEAR, status: 'unsupported', causes: ['propertySale'] })
    expect(zeroQuote.blocked?.issues[0].detail).toMatch(/exactly zero opening principal/i)
  })

  it('keeps sale coverage limited to ordinary TFSA and verified zero public benefits', () => {
    const { plan, evidence } = fixture()
    plan.accounts.push(retirementPlan({ rrsp: 0 }).accounts[1])
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    const withRrsp = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(withRrsp.rows).toEqual(prefix.rows)
    expect(withRrsp.state).toEqual(prefix.state)
    expect(withRrsp.blocked).toMatchObject({ year: SALE_YEAR, status: 'unsupported', causes: ['propertySale'] })

    plan.accounts.pop()
    delete plan.people[0].cppAmountSource
    const unverified = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(unverified.blocked).toMatchObject({ year: BASE_YEAR, status: 'unsupported',
      issues: [expect.objectContaining({ detail: expect.stringMatching(/benefits require explicit supplied zero evidence/) })] })
    expect(unverified.rows).toEqual([])
  })

  it('confines sale receipts to canonical settlement and preserves provider and legacy behavior', () => {
    const { plan, evidence } = fixture()
    const covered = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(covered.blocked).toBeNull()
    const fabricated = structuredClone(covered.state)
    fabricated.primaryHomeSaleCash!.receipt.mortgagePayoff!.terms.debtId = 'forged'
    const providerPlan = { ...plan, people: [{ ...plan.people[0], retirementAge: 65 }],
      budget: { kind: 'savingsBudget' as const, annualNetSavings: 0, retirementSpending: 5_000,
      debtIncluded: known(true), taxBenefitIncluded: known(true) } }
    const providers = {
      evaluate: () => ({ byPerson: { [RETIREE]: { income: 9_261, earnedIncome: 9_261, benefits: 0, tax: 0, spending: 0,
        taxableIncome: 9_261, benefitIncomeForNextYear: known(9_261) } } }),
      returns: () => 0,
    }
    for (const state of [covered.state, structuredClone(covered.state), fabricated]) {
      expect(annualRetirementContinuation(plan, state, evidence).status).toBe('invalid')
      expect(projectAnnualCoverage(providerPlan, state, 1, providers)).toMatchObject({
        status: 'invalid', issues: [expect.objectContaining({ detail: expect.stringMatching(/authenticated generated settlement/) })],
      })
    }
    expect(covered.state.primaryHomeSaleCash?.receipt.mortgagePayoff?.terms.debtId).toBe(LIEN)
    const opening = ok(initializeState(providerPlan))
    const prefix = ok(projectAnnualCoverage(providerPlan, opening, 2, providers))
    expect(prefix.blocked).toBeNull()
    const stopped = ok(projectAnnualCoverage(providerPlan, opening, 4, providers))
    expect(stopped.rows).toEqual(prefix.rows)
    expect(stopped.state).toEqual(prefix.state)
    expect(stopped.blocked).toMatchObject({ year: SALE_YEAR, status: 'unsupported', causes: ['propertySale'] })

    const legacy = legacyRetirement({ currentAge: 57, fireAge: 58, lifeExpectancy: 61, inflation: 0.02,
      balances: { tfsa: 25_000, rrsp: 0, nonReg: 0 }, retirementSpending: 5_000,
      principalResidence: { value: 50_000, appreciation: 0.04, sellAtAge: 59,
        mortgage: { balance: 25_220, annualPayment: 9_261, yearsRemaining: 3 } } })
    plan.legacyProjection = legacy
    const baseline = structuredClone(plan)
    delete baseline.annualPrimaryHomeSaleEvidence
    const observed = runProjection(legacy, undefined, plan, { captureAnnualDetails: true })
    const reference = runProjection(legacy, undefined, baseline, { captureAnnualDetails: true })
    expect(observed).toEqual(reference)
    expect(legacyAnnualSheet(observed, legacy, CONTEXT).rows).toEqual(legacyAnnualSheet(reference, legacy, CONTEXT).rows)
  })
})
