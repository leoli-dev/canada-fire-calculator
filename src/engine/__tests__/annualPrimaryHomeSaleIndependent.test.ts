import { describe, expect, it, vi } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { annualRetirementContinuation, annualRetirementStep, projectRetirementCoverage } from '../annualRetirement'
import { initializeState, projectAnnualCoverage, projectCanonicalCoverage, sumInvestableAssets, sumNetWorth, type KernelResult } from '../annualState'
import { evaluateCanonicalWorkingYear } from '../annualWorking'
import type { InputsV2, Property } from '../model'
import { runProjection } from '../projection'
import { phaseReference } from './fixtures/phaseTransition'
import { BASE_YEAR, known, legacyRetirement, recorded, retirementPlan, RETIREE, TFSA } from './fixtures/retirementSettlement'

const HOME = 'primary-home'
const HOME_VALUE = 90_000
const ACB = 65_000
const FEES = 8_125.75
const BEFORE_SALE_SPENDING = 5_000
const AFTER_SALE_SPENDING = 45_000
const TFSA_OPENING = 25_000
const SALE_YEAR = 2028
const CPI = 1.125
const NOMINAL_HOME_FACTOR = 1.125 * CPI
const CONTEXT = { scenarioId: 'home-sale-independent', revision: 1 }
const close = (amount: number) => expect.closeTo(amount, 6)

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function fixture() {
  const plan = retirementPlan({ tfsa: TFSA_OPENING, rrsp: 0, spending: BEFORE_SALE_SPENDING,
    inflation: CPI - 1, strategy: 'tfsaFirst' })
  plan.accounts = plan.accounts.filter(account => account.id === TFSA)
  plan.people[0].retirementAge = 58
  plan.lifeExpectancy = 62
  plan.budget = { kind: 'incomeBudget', workingSpending: 0, retirementSpending: BEFORE_SALE_SPENDING }
  const home: Property = {
    id: HOME, kind: 'principal', value: HOME_VALUE, acb: known(ACB), annualRent: known(0),
    appreciation: 0.125, sellAtAge: 59, plannedPurchaseAge: null, plannedDownPayment: null,
    plannedMortgage: null, annualHoldingCostChange: 0, mortgageDebtId: null,
    taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 1 } },
    provenance: { value: recorded, acb: recorded, annualRent: recorded, taxableOwnerShares: recorded },
  }
  plan.properties.push(home)
  const sale = {
    provenance: { origin: 'user' as const, sourceYear: BASE_YEAR },
    wholePropertyFullyExcluded: true as const,
    salePriceBasis: 'opening-year-nominal-value' as const,
    sellingCostsNominal: known(FEES),
    postSaleAnnualSpendingReal: known(AFTER_SALE_SPENDING),
  }
  plan.annualPrimaryHomeSaleEvidence = { [HOME]: sale }
  return { plan, home, sale, evidence: { workingSpending: known(0), retirementSpending: known(BEFORE_SALE_SPENDING) } }
}

function findRow(rows: AnnualSheetRow[], id: string): AnnualSheetRow | undefined {
  for (const row of rows) {
    if (row.id === id) return row
    const child = findRow(row.children ?? [], id)
    if (child) return child
  }
}

describe('independent verified primary-home sale', () => {
  it('sells once at opening, exhausts nominal proceeds before the TFSA and keeps indexed living after exhaustion', () => {
    const { plan, sale: suppliedSale, evidence } = fixture()
    const before = structuredClone({ plan, evidence })
    const held = structuredClone(plan)
    held.properties[0].sellAtAge = null
    delete held.annualPrimaryHomeSaleEvidence
    const prefix = ok(projectCanonicalCoverage(held, evidence, 2))
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(coverage).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false,
      evaluationBasis: 'canonical-continuous' })
    expect(coverage.rows.map(row => row.year)).toEqual([2026, 2027, 2028, 2029, 2030, 2031])
    expect(coverage.rows.slice(0, 2)).toEqual(prefix.rows)
    expect(coverage.rows[0].workingSettlement).toBeDefined()
    expect(coverage.rows[1].retirementSettlement?.spendingFunded).toBe(BEFORE_SALE_SPENDING * CPI)

    // Two closing appreciations are already in opening FMV. Nominal costs
    // and ACB are fixed. A verified full exemption gives zero taxable gain.
    // https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/personal-income/line-12700-capital-gains/principal-residence-other-real-estate.html
    const gross = HOME_VALUE * NOMINAL_HOME_FACTOR ** 2
    const net = gross - FEES
    const sale = coverage.rows[2]
    const receipt = {
      propertyId: HOME, year: SALE_YEAR, grossProceeds: close(gross), sellingCosts: FEES,
      netProceeds: close(net), acb: ACB, realizedGain: close(net - ACB), taxableGain: 0,
    }
    expect(sale.retirementSettlement?.primaryHomeSale).toEqual(receipt)
    expect(sale.byProperty[HOME]).toMatchObject({ held: false, opening: close(gross), growth: 0, closing: 0 })
    expect(sale.byProperty[HOME].opening).toBe(prefix.state.byProperty[HOME].value)

    const saleLiving = AFTER_SALE_SPENDING * CPI ** 2
    const nextLiving = AFTER_SALE_SPENDING * CPI ** 3
    const thirdLiving = AFTER_SALE_SPENDING * CPI ** 4
    const fourthLiving = AFTER_SALE_SPENDING * CPI ** 5
    const cashAfterSale = net - saleLiving
    const cashAfterNext = cashAfterSale - nextLiving
    const tfsaThirdOpening = (TFSA_OPENING - BEFORE_SALE_SPENDING) * CPI ** 4
    // The third year needs more than the remaining proceeds and TFSA combined.
    expect(cashAfterNext + tfsaThirdOpening).toBeLessThan(thirdLiving)
    const schedule = [
      [0, net, saleLiving, cashAfterSale, 0, saleLiving, saleLiving, (TFSA_OPENING - BEFORE_SALE_SPENDING) * CPI ** 3],
      [cashAfterSale, 0, nextLiving, cashAfterNext, 0, nextLiving, nextLiving, tfsaThirdOpening],
      [cashAfterNext, 0, cashAfterNext, 0, tfsaThirdOpening, thirdLiving, cashAfterNext + tfsaThirdOpening, 0],
      [0, 0, 0, 0, 0, fourthLiving, 0, 0],
    ]
    for (const [index, [opening, proceedsAdded, spendingUsed, closing, withdrawal, due, funded, tfsaClosing]] of schedule.entries()) {
      const row = coverage.rows[index + 2]
      expect(row.retirementSettlement).toMatchObject({
        spendingDue: close(due), spendingFunded: close(funded), spendingUnmet: close(due - funded),
      })
      expect(row.retirementSettlement?.primaryHomeSaleCash).toEqual({
        opening: close(opening), proceedsAdded: close(proceedsAdded), spendingUsed: close(spendingUsed), closing: close(closing),
      })
      if (index > 0) {
        expect(row.retirementSettlement?.primaryHomeSale).toBeUndefined()
        expect(row.byProperty[HOME]).toEqual({ held: false, opening: 0, growth: 0, closing: 0 })
      }
      expect(row.taxLedger).toEqual({ [RETIREE]: { taxableIncome: 0, tax: 0 } })
      expect(row.cashLedger).toMatchObject({ income: 0, benefits: 0, tax: 0, spending: close(funded),
        debtPayments: 0, unallocated: 0, voluntaryContributions: 0 })
      expect(row.byAccount[TFSA]).toMatchObject({ contribution: 0, withdrawal: close(withdrawal), closing: close(tfsaClosing) })
      const shortened = ok(projectCanonicalCoverage(plan, evidence, index + 3))
      expect(shortened.rows).toEqual(coverage.rows.slice(0, index + 3))
      expect(shortened.state.byProperty[HOME]).toMatchObject({ held: false, value: 0 })
      expect(shortened.state.primaryHomeSaleCash).toMatchObject({ balance: close(closing), receipt, evidence: suppliedSale })
      expect(shortened.state.primaryHomeSaleCash?.receipt).not.toBe(shortened.rows[2].retirementSettlement?.primaryHomeSale)
      expect(row.retirementSettlement?.primaryHomeSaleEvidence).toEqual(suppliedSale)
      expect(row.retirementSettlement?.primaryHomeSaleEvidence?.provenance).not.toBe(suppliedSale.provenance)
      expect(row.retirementSettlement?.primaryHomeSaleEvidence?.postSaleAnnualSpendingReal).not.toBe(
        shortened.state.primaryHomeSaleCash?.evidence.postSaleAnnualSpendingReal)
      if (index) expect(row.retirementSettlement?.primaryHomeSaleEvidence?.sellingCostsNominal).not.toBe(
        coverage.rows[index + 1].retirementSettlement?.primaryHomeSaleEvidence?.sellingCostsNominal)
      expect(sumInvestableAssets(shortened.state)).toBeCloseTo(tfsaClosing, 6)
      expect(sumNetWorth(shortened.state)).toBeCloseTo(closing + tfsaClosing, 6)
    }
    expect({ plan, evidence }).toEqual(before)
  })

  it('keeps conventional 2% CPI and a cent-valued appraisal through three years of sale cash', () => {
    const { plan, home, sale, evidence } = fixture()
    plan.inflation = 0.02
    home.value = 500_000
    home.appreciation = 0.04
    home.acb = known(310_000)
    sale.sellingCostsNominal = known(12_500)
    sale.postSaleAnnualSpendingReal = known(50_000)
    plan.lifeExpectancy = 70
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 14))
    expect(coverage.blocked).toBeNull()
    const [, , sold, carry, later] = coverage.rows
    expect(sold.retirementSettlement?.primaryHomeSale).toEqual({ propertyId: HOME, year: SALE_YEAR,
      grossProceeds: 562_648.32, sellingCosts: 12_500, netProceeds: 550_148.32,
      acb: 310_000, realizedGain: 240_148.32, taxableGain: 0 })
    for (const [row, opening, proceedsAdded, spendingUsed, closing] of [
      [sold, 0, 550_148.32, 52_020, 498_128.32],
      [carry, 498_128.32, 0, 53_060.40, 445_067.92],
      [later, 445_067.92, 0, 54_121.608, 390_946.312],
    ] as const) {
      expect(row.retirementSettlement).toMatchObject({ spendingDue: spendingUsed, spendingFunded: spendingUsed, spendingUnmet: 0,
        primaryHomeSaleCash: { opening, proceedsAdded, spendingUsed, closing } })
      expect(row.byAccount[TFSA].withdrawal).toBe(0)
    }
    // Repeated decimal multiplication by 102/100 gives these exact values.
    // The floating display values cannot represent every final decimal digit.
    expect(coverage.rows[10].retirementSettlement?.primaryHomeSaleArithmetic).toMatchObject({
      spendingDue: { coefficient: '60949720999737856512', scale: 15 },
      cash: { closing: { coefficient: '42712549013369317888', scale: 15 } },
    })
    expect(coverage.rows[11].retirementSettlement?.primaryHomeSaleArithmetic).toMatchObject({
      spendingUnmet: { coefficient: '0', scale: 0 },
      cash: { spendingUsed: { coefficient: '42712549013369317888', scale: 15 }, closing: { coefficient: '0', scale: 0 } },
      withdrawals: { [TFSA]: { coefficient: '1945616640636329575424', scale: 17 } },
    })
    expect(coverage.rows[12].retirementSettlement?.spendingUnmet).toBeCloseTo(57_892.54357136692, 6)
    expect(coverage.rows[12].byAccount[TFSA]).toMatchObject({ withdrawal: close(5_519.546156760345), closing: 0 })
    expect(coverage.rows[13].cashLedger.spending).toBe(0)
    expect(coverage.rows[13].retirementSettlement?.primaryHomeSaleArithmetic).toMatchObject({
      spendingUnmet: { coefficient: '64680331522689811233386496', scale: 21 },
      cash: { opening: { coefficient: '0', scale: 0 }, closing: { coefficient: '0', scale: 0 } },
    })
    expect(coverage.state.primaryHomeSaleCash).toMatchObject({
      balance: 0, exactBalance: { coefficient: '0', scale: 0 }, exactAccountBalances: { [TFSA]: { coefficient: '0', scale: 0 } },
      exactReceipt: { netProceeds: { coefficient: '55014832', scale: 2 }, realizedGain: { coefficient: '24014832', scale: 2 } },
    })
  })

  it('shows dated receipt, carry reconciliation and living funding in nominal and real sheet modes', () => {
    const { plan, evidence } = fixture()
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(coverage.blocked).toBeNull()
    const sheet = canonicalAnnualSheet(coverage, CONTEXT)
    const cell = (year: number, ...parts: string[]) => findRow(sheet.rows, canonicalSheetId('value', ...parts))!.cells![year]
    const details = (year: number, ...parts: string[]) => sheet.resolveExplanation!(cell(year, ...parts).explanationRefs![0])!
    const gross = HOME_VALUE * NOMINAL_HOME_FACTOR ** 2
    const net = gross - FEES
    const firstSpend = AFTER_SALE_SPENDING * CPI ** 2
    const firstClosing = net - firstSpend
    const secondSpend = AFTER_SALE_SPENDING * CPI ** 3
    const secondClosing = firstClosing - secondSpend
    for (const [group, field, year, timing, nominal, cpi] of [
      ['primaryHomeSale', 'grossProceeds', 2028, 'during-year', gross, CPI ** 2],
      ['primaryHomeSale', 'sellingCosts', 2028, 'during-year', FEES, CPI ** 2],
      ['primaryHomeSale', 'netProceeds', 2028, 'during-year', net, CPI ** 2],
      ['primaryHomeSale', 'acb', 2028, 'during-year', ACB, CPI ** 2],
      ['primaryHomeSale', 'realizedGain', 2028, 'during-year', net - ACB, CPI ** 2],
      ['primaryHomeSale', 'taxableGain', 2028, 'during-year', 0, CPI ** 2],
      ['primaryHomeSaleCash', 'opening', 2029, 'opening', firstClosing, CPI ** 3],
      ['primaryHomeSaleCash', 'proceedsAdded', 2028, 'during-year', net, CPI ** 2],
      ['primaryHomeSaleCash', 'spendingUsed', 2029, 'during-year', secondSpend, CPI ** 3],
      ['primaryHomeSaleCash', 'closing', 2029, 'closing', secondClosing, CPI ** 4],
    ] as const) {
      const observed = cell(year, group, field)
      const column = sheet.years.find(item => item.year === year)!
      expect(observed).toMatchObject({ timing, basis: field === 'acb' ? 'nominal-tax-basis' : 'nominal-CAD' })
      expect(annualSheetDisplayValue(observed, column, 'nominal')).toBeCloseTo(nominal, 6)
      expect(annualSheetDisplayValue(observed, column, 'real')).toBeCloseTo(field === 'acb' ? nominal : nominal / cpi, 6)
    }
    for (const year of [2027, 2029]) {
      expect(cell(year, 'primaryHomeSale', 'grossProceeds')).toMatchObject({ status: 'not-applicable', value: null })
    }
    expect(cell(2031, 'retirement', 'spendingDue').value).toBeCloseTo(AFTER_SALE_SPENDING * CPI ** 5, 6)
    expect(cell(2029, 'netWorth').value).toBeCloseTo(secondClosing + (TFSA_OPENING - BEFORE_SALE_SPENDING) * CPI ** 4, 6)

    const receipt = details(2028, 'primaryHomeSale', 'realizedGain')
    const carry = details(2029, 'primaryHomeSaleCash', 'closing')
    for (const explanation of [receipt, carry]) {
      const provenance = explanation.sources!.find(source => source.field === 'annualPrimaryHomeSaleEvidence')!
      expect(provenance).toMatchObject({ id: HOME, granularity: 'input' })
      for (const [locale, yearLabel] of [['en', /source year/], ['fr', /Année source/], ['zh', /来源年份/]] as const) {
        const label = annualSheetText(provenance.displayReference!, locale)
        expect(label).toMatch(yearLabel)
        expect(label).toContain('2026')
        const summary = annualSheetText(explanation.summary!, locale)
        expect(summary).toContain('T2091(IND)')
      }
      expect(explanation.sources).toEqual(expect.arrayContaining([
        expect.objectContaining({ label: expect.stringMatching(/CRA.*principal residence/i), displayReference: expect.stringContaining('canada.ca') }),
        expect.objectContaining({ label: expect.stringContaining('40(2)(b)'), displayReference: expect.stringContaining('justice.gc.ca') }),
        expect.objectContaining({ label: expect.stringMatching(/Act 54/), displayReference: expect.stringContaining('justice.gc.ca') }),
      ]))
    }
    expect(carry.formula).toEqual([
      expect.objectContaining({ value: close(firstClosing), direction: 'add', basis: 'nominal-CAD' }),
      expect.objectContaining({ value: 0, direction: 'add', basis: 'nominal-CAD' }),
      expect.objectContaining({ value: close(secondSpend), direction: 'subtract', basis: 'nominal-CAD' }),
    ])
    for (const term of carry.formula!) {
      expect(annualSheetText(term.label, 'fr')).not.toBe(annualSheetText(term.label, 'en'))
      expect(annualSheetText(term.label, 'zh')).toMatch(/[\p{Script=Han}]/u)
    }
    const funding = details(2029, 'retirement', 'spendingFunded')
    expect(funding.sources).toContainEqual(expect.objectContaining({ field: 'annualPrimaryHomeSaleEvidence.postSaleAnnualSpendingReal' }))
    expect(funding.formula).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'retirementSettlement.primaryHomeSaleCash.spendingUsed', value: close(secondSpend), direction: 'add' }),
      expect.objectContaining({ field: 'withdrawal', value: 0, direction: 'add' }),
      expect.objectContaining({ field: 'tax', value: 0, direction: 'subtract' }),
    ]))
  })

  it.each([2014, null])('keeps cent-valued property ACB nominal with source year %s', sourceYear => {
    const { plan, home, evidence } = fixture()
    home.acb = known(0.64)
    const note = 'Original acquisition statement'
    if (sourceYear === null) delete home.provenance.acb
    else home.provenance.acb = { origin: 'user', sourceYear, note }
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage.blocked).toBeNull()
    const sheet = canonicalAnnualSheet(coverage, CONTEXT)
    const column = sheet.years.find(year => year.year === SALE_YEAR)!
    const row = (field: string) => findRow(sheet.rows, canonicalSheetId('value', 'primaryHomeSale', field))!
    const acb = row('acb').cells![SALE_YEAR]
    const gross = row('grossProceeds').cells![SALE_YEAR]
    const openingValue = HOME_VALUE * NOMINAL_HOME_FACTOR ** 2
    expect(acb).toMatchObject({ value: 0.64, timing: 'during-year', basis: 'nominal-tax-basis' })
    expect(annualSheetDisplayValue(acb, column, 'nominal')).toBe(0.64)
    expect(annualSheetDisplayValue(acb, column, 'real')).toBe(0.64)
    expect(gross).toMatchObject({ basis: 'nominal-CAD', timing: 'during-year' })
    expect(annualSheetDisplayValue(gross, column, 'nominal')).toBeCloseTo(openingValue, 6)
    expect(annualSheetDisplayValue(gross, column, 'real')).toBeCloseTo(openingValue / CPI ** 2, 6)

    const explanation = sheet.resolveExplanation!(acb.explanationRefs![0])!
    const source = explanation.sources!.find(item => item.field === 'property.acb')!
    expect(source).toMatchObject({ id: HOME, granularity: 'input' })
    expect(explanation.sources).not.toContainEqual(
      expect.objectContaining({ field: 'annualPrimaryHomeSaleEvidence' }),
    )
    if (sourceYear === null) expect(source.displayReference).toBeUndefined()
    for (const [locale, basis, adjustment, yearLabel] of [
      ['en', /ACB|cost base/i, /not inflation.adjusted/i, /source year/i],
      ['fr', /PBR/, /non ajusté pour l’inflation/i, /année source/i],
      ['zh', /成本基础/, /不作通胀调整/, /来源年份/],
    ] as const) {
      const label = annualSheetText(row('acb').label, locale)
      expect(label).toMatch(basis)
      expect(label).toMatch(adjustment)
      expect(annualSheetText(source.label, locale)).toMatch(basis)
      if (sourceYear !== null) {
        const recorded = annualSheetText(source.displayReference!, locale)
        expect(recorded).toMatch(yearLabel)
        expect(recorded).toContain(String(sourceYear))
        expect(recorded).toContain(note)
        expect(recorded).not.toMatch(/2026|undefined/)
      }
    }
  })

  it('keeps ordinary working tax separate from a later exempt disposal with explicit zero costs and zero living', () => {
    const { plan, sale, evidence } = fixture()
    const { wage, workingTax, taxableWage, payroll } = phaseReference
    const workingSpending = 46_000
    plan.people[0].earnedIncome = known(wage)
    plan.people[0].tfsaAvailableRoom = known(20_000)
    plan.budget = { kind: 'incomeBudget', workingSpending, retirementSpending: BEFORE_SALE_SPENDING }
    evidence.workingSpending = known(workingSpending)
    sale.sellingCostsNominal = known(0)
    sale.postSaleAnnualSpendingReal = known(0)
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows[0]).toMatchObject({
      payrollContributions: close(payroll),
      taxLedger: { [RETIREE]: { taxableIncome: close(taxableWage), tax: close(workingTax) } },
      cashLedger: { income: wage, tax: close(workingTax), spending: workingSpending },
    })
    const proceeds = HOME_VALUE * NOMINAL_HOME_FACTOR ** 2
    for (const row of coverage.rows.slice(2)) {
      expect(row.taxLedger[RETIREE]).toEqual({ taxableIncome: 0, tax: 0 })
      expect(row.cashLedger).toMatchObject({ income: 0, tax: 0, spending: 0, unallocated: 0 })
      expect(row.retirementSettlement).toMatchObject({ spendingDue: 0, spendingFunded: 0,
        primaryHomeSaleCash: { spendingUsed: 0, closing: close(proceeds) } })
    }
  })

  const invalidFacts: [string, (plan: InputsV2) => void][] = [
    ['absent evidence', plan => { delete plan.annualPrimaryHomeSaleEvidence }],
    ['evidence for a different property', plan => { plan.annualPrimaryHomeSaleEvidence = { other: plan.annualPrimaryHomeSaleEvidence![HOME] } }],
    ['an unknown selling cost', plan => { plan.annualPrimaryHomeSaleEvidence![HOME].sellingCostsNominal = { status: 'unknown', reason: 'Missing statement' } }],
    ['an unknown post-sale budget', plan => { plan.annualPrimaryHomeSaleEvidence![HOME].postSaleAnnualSpendingReal = { status: 'unknown', reason: 'Missing budget' } }],
    ['a negative selling cost', plan => { plan.annualPrimaryHomeSaleEvidence![HOME].sellingCostsNominal = known(-1) }],
    ['a negative post-sale budget', plan => { plan.annualPrimaryHomeSaleEvidence![HOME].postSaleAnnualSpendingReal = known(-1) }],
    ['a loss after selling costs', plan => { plan.annualPrimaryHomeSaleEvidence![HOME].sellingCostsNominal = known(85_000) }],
    ['an underwater sale', plan => { plan.annualPrimaryHomeSaleEvidence![HOME].sellingCostsNominal = known(150_000) }],
    ['unknown ACB', plan => { plan.properties[0].acb = { status: 'unknown', reason: 'Missing basis' } }],
    ['nonfinite fees', plan => { plan.annualPrimaryHomeSaleEvidence![HOME].sellingCostsNominal = known(Infinity) }],
    ['fees outside the safe currency range', plan => { plan.annualPrimaryHomeSaleEvidence![HOME].sellingCostsNominal = known(Number.MAX_SAFE_INTEGER) }],
    ['a numeric string for spending', plan => { plan.annualPrimaryHomeSaleEvidence![HOME].postSaleAnnualSpendingReal = known('45000' as unknown as number) }],
    ['an unconfirmed exemption', plan => { Object.assign(plan.annualPrimaryHomeSaleEvidence![HOME], { wholePropertyFullyExcluded: false }) }],
    ['an incompatible price clock', plan => { Object.assign(plan.annualPrimaryHomeSaleEvidence![HOME], { salePriceBasis: 'closing-year-value' }) }],
    ['an estimated attestation', plan => { Object.assign(plan.annualPrimaryHomeSaleEvidence![HOME], { provenance: { origin: 'estimated', sourceYear: BASE_YEAR } }) }],
    ['a malformed provenance year', plan => { Object.assign(plan.annualPrimaryHomeSaleEvidence![HOME], { provenance: { origin: 'user', sourceYear: '2026' } }) }],
  ]

  it.each(invalidFacts)('keeps the committed prefix and shows the uncomputed suffix with %s', (_, change) => {
    const { plan, evidence } = fixture()
    change(plan)
    const before = structuredClone({ plan, evidence })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(stopped).toMatchObject({ rows: prefix.rows, state: prefix.state,
      blocked: { year: SALE_YEAR, status: 'unsupported', causes: ['propertySale'] },
      uncomputedYears: [2029, 2030], overallConclusionAvailable: false })
    expect(stopped.state.byProperty[HOME]).toEqual({ held: true, value: close(HOME_VALUE * NOMINAL_HOME_FACTOR ** 2), acb: plan.properties[0].acb })
    const sheet = canonicalAnnualSheet(stopped, CONTEXT)
    const cells = findRow(sheet.rows, canonicalSheetId('value', 'netWorth'))!.cells!
    expect(cells[2027].value).toBeGreaterThan(0)
    for (const year of [2028, 2029, 2030]) expect(cells[year]).toMatchObject({ value: null, status: 'not-computed' })
    expect(annualSheetText(cells[2028].reason!, 'en')).toMatch(/sale/i)
    expect({ plan, evidence }).toEqual(before)
  })

  it('retains the old working-sale stop and requires a genuine working prefix', () => {
    const { plan, home, evidence } = fixture()
    plan.people[0].retirementAge = 60
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(stopped).toMatchObject({ rows: prefix.rows, state: prefix.state, uncomputedYears: [2029, 2030],
      blocked: { year: SALE_YEAR, status: 'unsupported', causes: ['propertySale'],
        issues: [{ code: 'unsupported', detail: 'property sale funding and tax integration not yet wired' }] } })
    plan.people[0].retirementAge = 57
    home.sellAtAge = 57
    const atBase = projectCanonicalCoverage(plan, evidence, 2)
    expect(atBase).toMatchObject({ status: 'unsupported', issues: [
      { detail: 'continuous projection requires an initial working year for each person; use strict standalone retirement' },
    ] })
  })

  it('preserves provider sale denial, standalone admission gates and post-sale snapshot isolation', () => {
    const { plan, evidence } = fixture()
    const retired = ok(projectCanonicalCoverage(plan, evidence, 2)).state
    const sold = ok(projectCanonicalCoverage(plan, evidence, 3)).state
    const returns = vi.fn(() => 0)
    expect(evaluateCanonicalWorkingYear(plan, evidence)).toMatchObject({ status: 'unsupported' })
    for (const supplied of [retired, structuredClone(retired), sold, structuredClone(sold)]) {
      expect(annualRetirementContinuation(plan, supplied).status).toBe('invalid')
      expect(annualRetirementStep(plan, supplied, returns).status).not.toBe('ok')
      expect(projectRetirementCoverage(plan, supplied, 1, returns)).not.toMatchObject({
        status: 'ok', value: { rows: [expect.anything()] },
      })
    }
    const providerPlan: InputsV2 = { ...plan, people: [{ ...plan.people[0], retirementAge: 66 }],
      budget: { kind: 'savingsBudget', annualNetSavings: 0, retirementSpending: BEFORE_SALE_SPENDING,
        debtIncluded: known(true), taxBenefitIncluded: known(true) } }
    const provider = { evaluate: () => ({ byPerson: { [RETIREE]: { income: 0, earnedIncome: 0, benefits: 0,
      tax: 0, spending: 0, taxableIncome: 0, benefitIncomeForNextYear: known(0) } } }), returns }
    const opening = ok(initializeState(providerPlan))
    const providerPrefix = ok(projectAnnualCoverage(providerPlan, opening, 2, provider))
    expect(ok(projectAnnualCoverage(providerPlan, opening, 4, provider))).toMatchObject({
      rows: providerPrefix.rows, state: providerPrefix.state, uncomputedYears: [2029], evaluationBasis: 'provider-supplied',
      blocked: { year: SALE_YEAR, status: 'unsupported', causes: ['propertySale'],
        issues: [{ code: 'unsupported', detail: 'property sale funding and tax integration not yet wired' }] },
    })
    expect(returns).toHaveBeenCalledTimes(4)
  })

  it('denies a mortgaged sale and leaves the existing held-mortgage path intact', () => {
    const { plan, home, evidence } = fixture()
    home.mortgageDebtId = 'lien'
    plan.debts.push({ id: 'lien', kind: 'mortgage', propertyId: HOME, principal: 3_310,
      annualPayment: 1_331, yearsRemaining: 3, provenance: recorded })
    const mortgageEvidence = { ...evidence, scheduledMortgagePaymentsExcluded: known(true as const), workingSpending: known(9_967.65) }
    plan.people[0].earnedIncome = known(12_000)
    plan.budget = { kind: 'incomeBudget', workingSpending: 9_967.65, retirementSpending: BEFORE_SALE_SPENDING }
    const denied = ok(projectCanonicalCoverage(plan, mortgageEvidence, 4))
    expect(denied.blocked).not.toBeNull()
    expect(denied.rows.every(row => !row.retirementSettlement?.primaryHomeSale)).toBe(true)
    const held = structuredClone(plan)
    held.properties[0].sellAtAge = null
    const legacyMortgage = structuredClone(held)
    delete legacyMortgage.annualPrimaryHomeSaleEvidence
    const existing = ok(projectCanonicalCoverage(legacyMortgage, mortgageEvidence, 4))
    expect(existing.blocked).toBeNull()
    expect(existing.rows.map(row => row.byDebt.lien.payment)).toEqual([1331, 1331, 1331, 0])
    expect(ok(projectCanonicalCoverage(held, mortgageEvidence, 4))).toEqual(existing)
  })

  it('keeps the legacy projection and annual sheet independent of canonical sale evidence', () => {
    const { plan } = fixture()
    const inputs = legacyRetirement({ currentAge: 57, fireAge: 58, lifeExpectancy: 62, inflation: CPI - 1,
      balances: { tfsa: TFSA_OPENING, rrsp: 0, nonReg: 0 }, retirementSpending: BEFORE_SALE_SPENDING,
      principalResidence: { value: HOME_VALUE, appreciation: 0.125, sellAtAge: 59 } })
    plan.legacyProjection = inputs
    const baseline = structuredClone(plan)
    delete baseline.annualPrimaryHomeSaleEvidence
    const observed = runProjection(inputs, undefined, plan, { captureAnnualDetails: true })
    const reference = runProjection(inputs, undefined, baseline, { captureAnnualDetails: true })
    expect(observed).toEqual(reference)
    expect(legacyAnnualSheet(observed, inputs, CONTEXT).rows).toEqual(legacyAnnualSheet(reference, inputs, CONTEXT).rows)
  })
})
