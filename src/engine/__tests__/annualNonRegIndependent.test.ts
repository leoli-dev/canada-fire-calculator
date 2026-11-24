import { describe, expect, it, vi } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { annualRetirementContinuation, annualRetirementStep, projectRetirementCoverage } from '../annualRetirement'
import { annualStep, initializeState, projectAnnualCoverage, projectCanonicalCoverage, projectFromState, type KernelResult, type YearRow } from '../annualState'
import { evaluateCanonicalWorkingYear } from '../annualWorking'
import type { InputsV2 } from '../model'
import { runProjection } from '../projection'
import { known, legacyRetirement, recorded, retirementPlan, RETIREE, RRSP, TFSA } from './fixtures/retirementSettlement'

const POOL = 'taxable-account'
const HOLDING = 'identical-share-class'
const close = (amount: number) => expect.closeTo(amount, 6)
const sheetContext = { scenarioId: 'independent-taxable-pool', revision: 1 }

function findRow(rows: AnnualSheetRow[], id: string): AnnualSheetRow | undefined {
  for (const row of rows) {
    if (row.id === id) return row
    const child = findRow(row.children ?? [], id)
    if (child) return child
  }
}

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function scenario({ balance = 400_000, acb = 200_000, spending = 50_000, tfsa = 0, rrsp = 0,
  age = 57, inflation = 0, realReturn = 0, accountId = POOL, strategy = 'nonRegFirst' as InputsV2['strategy'] } = {}) {
  const plan = retirementPlan({ age, tfsa, rrsp, spending, inflation, strategy })
  plan.people[0].retirementAge = age + 1
  plan.lifeExpectancy = age + 3
  plan.budget = { kind: 'incomeBudget', workingSpending: 0, retirementSpending: spending }
  const pool = { ...structuredClone(plan.accounts[0]), id: accountId, kind: 'nonReg' as const,
    balance, realReturn, acb: known(acb) }
  plan.accounts.push(pool)
  plan.annualNonRegEvidence = {
    accountId, holdingId: HOLDING, ownership: 'individual-whole', propertyKind: 'capital-identical-pool',
    units: 1_000, pooledAcbNominal: acb, distributions: 0, interest: 0, returnOfCapital: 0,
    saleFees: 0, provenance: 'user-supplied',
  }
  const evidence = { workingSpending: known(0), retirementSpending: known(spending) }
  return { plan, pool, evidence }
}

// ITA ss. 38(a), 40(1)(a) and 47(1) supply half inclusion, proceeds less
// disposition costs and pooled average cost per identical unit.
// https://laws-lois.justice.gc.ca/eng/acts/I-3.3/section-38.html
// https://laws-lois.justice.gc.ca/eng/acts/I-3.3/section-40.html
// https://laws-lois.justice.gc.ca/eng/acts/I-3.3/section-47.html
// CRA's 2026 tables supply BPAs, federal/ON brackets and health premium.
// The test incomes with positive tax are above the Ontario reduction range
// and below the surtax. Each test supplies its applicable premium plateau.
// https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032on-jan/t4032on-january-general-information.html
function firstBracketTax(taxable: number, healthPremium: number) {
  return (taxable - 16_452) * 0.14 + (taxable - 12_989) * 0.0505 + healthPremium
}

function assertCash(row: YearRow, spendingDue: number, taxable: number, tax: number, unmet = 0, ownerId = RETIREE) {
  expect(row.taxLedger[ownerId]).toEqual({ taxableIncome: close(taxable), tax: close(tax) })
  expect(row.cashLedger).toMatchObject({ income: 0, benefits: 0, spending: close(spendingDue - unmet),
    tax: close(tax), unallocated: close(0) })
  expect(row.retirementSettlement).toMatchObject({ spendingDue: close(spendingDue),
    spendingFunded: close(spendingDue - unmet), spendingUnmet: close(unmet) })
  expect(Object.values(row.byAccount).reduce((sum, account) => sum + account.withdrawal, 0) - tax)
    .toBeCloseTo(spendingDue - unmet, 6)
}

function assertSale(row: YearRow, proceeds: number, unitsSold: number, allocatedAcb: number, closingAcb: number,
  openingUnits = 1_000, accountId = POOL) {
  const gain = proceeds - allocatedAcb
  const account = row.byAccount[accountId]
  expect(account).toMatchObject({ withdrawal: close(proceeds), contribution: 0,
    acb: { status: 'known', value: close(closingAcb) },
    nonRegSale: { accountId, holdingId: HOLDING, openingMarket: account.opening, openingAcb: close(allocatedAcb + closingAcb),
      openingUnits: close(openingUnits), soldFraction: close(unitsSold / openingUnits), closingUnits: close(openingUnits - unitsSold),
      proceeds: close(proceeds), unitsSold: close(unitsSold),
      allocatedAcb: close(allocatedAcb), closingAcb: close(closingAcb), realizedGain: close(gain),
      taxableGain: close(gain / 2), inclusionRate: 0.5 } })
  expect(account.opening - (account.closing - account.returnAmount)).toBeCloseTo(proceeds, 6)
}

describe('independent Ontario non-registered retirement dispositions', () => {
  it('grosses up a partial sale and preserves nominal pooled cost over two years of real growth and CPI', () => {
    const cpi = 1.02
    const marketGrowth = 1.05 * cpi
    const spending = 160_000 - firstBracketTax(40_000, 450)
    const { plan, evidence } = scenario({ acb: 214_200, spending, tfsa: 250_000,
      inflation: 0.02, realReturn: 0.05 })
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    const [working, first, second] = result.rows
    expect(working.byAccount[POOL]).toMatchObject({ closing: close(428_400), acb: known(214_200) })
    expect(working.byAccount[POOL].nonRegSale).toBeUndefined()
    const firstProceeds = 160_000 * cpi
    const firstUnitsSold = 1_000 * firstProceeds / 428_400
    assertSale(first, firstProceeds, firstUnitsSold, 81_600, 132_600)
    assertCash(first, spending * cpi, 40_000 * cpi, firstBracketTax(40_000, 450) * cpi)
    const nextMarket = (428_400 - firstProceeds) * marketGrowth
    expect(first.byAccount[POOL]).toMatchObject({ closing: close(nextMarket),
      returnAmount: close(nextMarket - (428_400 - firstProceeds)) })
    expect(second.byAccount[POOL].opening).toBeCloseTo(nextMarket, 6)

    // Net cash = gross proceeds × (1 − marginal tax × taxable fraction)
    // minus the nominal tax intercept on the $450 health premium plateau.
    const taxableFraction = (1 - 132_600 / nextMarket) / 2
    const intercept = 450 - 16_452 * 0.14 - 12_989 * 0.0505
    const secondProceeds = cpi ** 2 * (spending + intercept) / (1 - 0.1905 * taxableFraction)
    const fractionSold = secondProceeds / nextMarket
    const secondAcb = 132_600 * (1 - fractionSold)
    const secondUnitsSold = (1_000 - firstUnitsSold) * fractionSold
    assertSale(second, secondProceeds, secondUnitsSold, 132_600 * fractionSold, secondAcb, 1_000 - firstUnitsSold)
    assertCash(second, spending * cpi ** 2, secondProceeds * taxableFraction, secondProceeds - spending * cpi ** 2)
    for (const row of [first, second]) expect(row.byAccount[TFSA].withdrawal).toBe(0)
    expect(result.state.byAccount[POOL]).toMatchObject({
      balance: close((nextMarket - secondProceeds) * marketGrowth), acb: { status: 'known', value: close(secondAcb) },
      nonRegPool: { holdingId: HOLDING, units: close(1_000 - firstUnitsSold - secondUnitsSold) },
    })
    const sheet = canonicalAnnualSheet(result, sheetContext)
    const saleField = (field: string) => findRow(sheet.rows, canonicalSheetId('value', 'account', POOL, 'nonRegSale', field))!
    const proceedsCells = saleField('proceeds').cells!
    expect(proceedsCells[2026]).toMatchObject({ value: null, status: 'not-applicable' })
    const proceeds = proceedsCells[2027]
    const withdrawal = findRow(sheet.rows, canonicalSheetId('value', 'account', POOL, 'withdrawal'))!.cells![2027]
    const year = sheet.years.find(column => column.year === 2027)!
    expect(proceeds).toMatchObject({ value: close(firstProceeds), timing: 'during-year' })
    expect(annualSheetDisplayValue(proceeds, year, 'real')).toBe(annualSheetDisplayValue(withdrawal, year, 'real'))
    expect(annualSheetDisplayValue(proceeds, year, 'real')).toBeCloseTo(160_000, 6)
    for (const [field, nominal] of [['allocatedAcb', 81_600], ['closingAcb', 132_600], ['realizedGain', 81_600], ['taxableGain', 40_800]] as const) {
      const cell = saleField(field).cells![2027]
      expect(cell.basis).toBe('nominal-tax-basis')
      expect(annualSheetDisplayValue(cell, year, 'real')).toBeCloseTo(nominal, 6)
    }
    expect(saleField('closingAcb').cells![2027].timing).toBe('closing')
    const gains = saleField('realizedGain').cells![2027]
    const explanation = sheet.resolveExplanation?.(gains.explanationRefs![0])
    expect(explanation).toMatchObject({ taxYear: 2026, projectionYear: 2027, rulePackage: expect.stringMatching(/^CA-ON-tax-/) })
    expect(explanation?.sources?.map(source => source.id)).toEqual(expect.arrayContaining([HOLDING, POOL]))
    expect(explanation?.formula).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'proceeds', value: close(firstProceeds), direction: 'add', basis: 'nominal-CAD' }),
      expect.objectContaining({ field: 'allocatedAcb', value: close(81_600), direction: 'subtract', basis: 'nominal-tax-basis' }),
    ]))
    const basis = explanation!.formulaBasis!
    expect(annualSheetText(basis, 'en')).toMatch(/sold fraction.*opening market/i)
    expect(annualSheetText(basis, 'fr')).toMatch(/fraction vendue.*valeur initiale/i)
    expect(annualSheetText(basis, 'zh')).toMatch(/出售比例.*期初市值/)
    const proceedsLabel = saleField('proceeds').label
    expect(annualSheetText(proceedsLabel, 'en')).toMatch(/proceeds/i)
    expect(annualSheetText(proceedsLabel, 'fr')).toMatch(/vente/i)
    expect(annualSheetText(proceedsLabel, 'zh')).toMatch(/出售/)
    expect(findRow(sheet.rows, canonicalSheetId('value', 'account', TFSA, 'nonRegSale', 'proceeds'))).toBeUndefined()
  })

  it('uses remaining nominal basis exactly at exhaustion and reconciles only the funded spending', () => {
    const { plan, evidence } = scenario({ balance: 160_000, acb: 80_000, spending: 160_000, tfsa: 1_000 })
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    const [, retired, exhausted] = result.rows
    const tax = firstBracketTax(40_000, 450)
    assertSale(retired, 160_000, 1_000, 80_000, 0)
    expect(retired.byAccount[TFSA].withdrawal).toBe(1_000)
    assertCash(retired, 160_000, 40_000, tax, tax - 1_000)
    expect(result.state.byAccount[POOL]).toMatchObject({ balance: 0, acb: known(0),
      nonRegPool: { holdingId: HOLDING, units: 0 } })
    expect(exhausted.byAccount[POOL].nonRegSale).toBeUndefined()
    assertCash(exhausted, 160_000, 0, 0, 160_000)
  })

  it('clears exactly the units and cost remaining after a prior partial sale', () => {
    const spending = 160_000 - firstBracketTax(40_000, 450)
    const { plan, evidence } = scenario({ balance: 319_000, acb: 159_500, spending })
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    const [, partial, full] = result.rows
    const sold = 1_000 * 160_000 / 319_000
    assertSale(partial, 160_000, sold, 80_000, 79_500)
    assertSale(full, 159_000, 1_000 - sold, 79_500, 0, 1_000 - sold)
    expect(full.byAccount[POOL].nonRegSale).toMatchObject({ closingUnits: 0, closingAcb: 0, soldFraction: 1 })
    const tax = firstBracketTax(39_750, 450)
    assertCash(full, spending, 39_750, tax, spending - (159_000 - tax))
    expect(result.state.byAccount[POOL]).toMatchObject({ balance: 0, acb: known(0),
      nonRegPool: { holdingId: HOLDING, units: 0 } })
  })

  it('records a sale exactly at cost with zero capital gain and no tax', () => {
    // At this amount, multiplying the sale fraction by the exactly equal
    // book and market value can round the allocated cost above the proceeds.
    const spending = 12_500.21
    const { plan, evidence } = scenario({ balance: 100_000, acb: 100_000, spending })
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    assertSale(result.rows[1], spending, 125.0021, spending, 87_499.79)
    expect(result.rows[1].byAccount[POOL].nonRegSale).toMatchObject({ realizedGain: 0, taxableGain: 0 })
    assertCash(result.rows[1], spending, 0, 0)
    expect(result.state.byAccount[POOL]).toMatchObject({ balance: close(87_499.79),
      acb: { status: 'known', value: close(87_499.79) }, nonRegPool: { holdingId: HOLDING, units: close(874.9979) } })
  })

  it('exhausts the RRSP before adding the taxable gain across both second brackets', () => {
    const taxable = 63_000 // $55,000 ordinary plus half of a $16,000 gain.
    const tax = (58_523 - 16_452) * 0.14 + (taxable - 58_523) * 0.205
      + (53_891 - 12_989) * 0.0505 + (taxable - 53_891) * 0.0915 + 600
    const { plan, evidence } = scenario({ rrsp: 55_000, tfsa: 150_000,
      spending: 87_000 - tax, strategy: 'rrspFirst' })
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    const row = result.rows[1]
    expect(row.byAccount[RRSP]).toMatchObject({ withdrawal: 55_000, closing: 0 })
    expect(row.byAccount[TFSA].withdrawal).toBe(0)
    assertSale(row, 32_000, 80, 16_000, 184_000)
    assertCash(row, 87_000 - tax, taxable, tax)
  })

  it.each([
    { spending: 32_700_636_939_003.19140625, proceeds: 0.00390625, unitsSold: 0.03125 },
    { spending: 32_700_636_939_003.1953125, proceeds: 0.0078125, unitsSold: 0.0625 },
  ])('settles exact pool proceeds of $proceeds after exhausting a large RRSP', ({ spending, proceeds, unitsSold }) => {
    const rrsp = 2 ** 46
    const registeredCash = 32_700_636_939_003.1875
    const tax = rrsp - registeredCash
    expect(spending - registeredCash).toBe(proceeds)
    expect(rrsp + proceeds).toBe(rrsp)

    const { plan, evidence } = scenario({ rrsp, balance: 128, acb: 128, spending, strategy: 'rrspFirst' })
    plan.annualNonRegEvidence!.units = 1_024
    const controlPlan = structuredClone(plan)
    controlPlan.accounts = controlPlan.accounts.filter(account => account.id !== POOL)
    delete controlPlan.annualNonRegEvidence
    const control = ok(projectCanonicalCoverage(controlPlan, evidence, 2))
    expect(control.blocked).toBeNull()
    expect(control.rows[1].cashLedger).toMatchObject({ spending: registeredCash, tax, unallocated: 0 })
    expect(control.rows[1].retirementSettlement?.spendingUnmet).toBe(proceeds)
    expect(control.rows[1].retirementSettlement?.cashBridge).toBeUndefined()

    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    const row = result.rows[1]
    expect(row.byAccount[RRSP]).toMatchObject({ opening: rrsp, withdrawal: rrsp, closing: 0 })
    expect(row.byAccount[TFSA].withdrawal).toBe(0)
    expect(row.taxLedger).toEqual(control.rows[1].taxLedger)
    expect(row.taxLedger[RETIREE]).toEqual({ taxableIncome: rrsp, tax })
    expect(row.cashLedger).toMatchObject({ income: 0, benefits: 0, tax, spending, unallocated: 0 })
    expect(row.retirementSettlement).toMatchObject({ spendingDue: spending, spendingFunded: spending, spendingUnmet: 0,
      cashBridge: { method: 'compensated-signed-cash', netCash: spending } })
    const remaining = 128 - proceeds
    const remainingUnits = 1_024 - unitsSold
    expect(row.byAccount[POOL]).toMatchObject({ opening: 128, withdrawal: proceeds, returnAmount: 0,
      closing: remaining, acb: known(remaining),
      nonRegSale: { proceeds, allocatedAcb: proceeds, closingAcb: remaining,
        openingUnits: 1_024, unitsSold, closingUnits: remainingUnits,
        realizedGain: 0, taxableGain: 0, inclusionRate: 0.5 } })
    expect(result.state.byAccount[POOL]).toMatchObject({ balance: remaining,
      acb: known(remaining), nonRegPool: { holdingId: HOLDING, units: remainingUnits } })

    const sheet = canonicalAnnualSheet(result, sheetContext)
    const fundedId = canonicalSheetId('value', 'retirement', 'spendingFunded')
    const funded = findRow(sheet.rows, fundedId)!.cells![2027]
    expect(funded.value).toBe(spending)
    const explanation = sheet.resolveExplanation?.(funded.explanationRefs![0])
    const formula = explanation?.formula
    expect(formula?.filter(term => term.value !== 0)).toEqual([
      expect.objectContaining({ sourceId: `annual:2027:withdrawal:${RRSP}`, direction: 'add', value: rrsp }),
      expect.objectContaining({ field: 'tax', direction: 'subtract', value: tax }),
      expect.objectContaining({ sourceId: `annual:2027:withdrawal:${POOL}`, direction: 'add', value: proceeds }),
    ])
    expect(formula?.reduce((total, term) => term.direction === 'add' ? total + term.value : total - term.value, 0))
      .toBe(spending)
    const cashBasis = explanation!.sources!.find(source => source.field === 'retirementSettlement.cashBridge')!.label
    expect(annualSheetText(cashBasis, 'en')).toMatch(/compensated signed sum/i)
    expect(annualSheetText(cashBasis, 'fr')).toMatch(/somme signée compensée/i)
    expect(annualSheetText(cashBasis, 'zh')).toMatch(/补偿有符号求和/)

    const controlSheet = canonicalAnnualSheet(control, sheetContext)
    const controlFunded = findRow(controlSheet.rows, fundedId)!.cells![2027]
    const controlExplanation = controlSheet.resolveExplanation?.(controlFunded.explanationRefs![0])
    expect(controlExplanation?.formula?.map(term => term.field)).toEqual(['withdrawal', 'withdrawal', 'tax', 'unallocated'])
    expect(controlExplanation?.sources?.some(source => source.field === 'retirementSettlement.cashBridge')).toBe(false)
  })

  it('posts the mandatory RRIF minimum before the discretionary pool sale and taxes both in one owner ledger', () => {
    // Reg. 7308(4) factor of 5.28% at calendar-year opening age 71.
    // CRA 2026 TD1/TD1ON full age amounts and eligible pension amounts.
    // https://laws-lois.justice.gc.ca/eng/regulations/C.R.C.,_c._945/section-7308.html
    // https://www.canada.ca/en/revenue-agency/services/forms-publications/td1-personal-tax-credits-returns/td1-forms-pay-received-on-january-1-later.html
    // https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-31400-pension-income-amount.html
    const floor = 600_000 * 0.0528
    const taxable = floor + 40_000 / 4
    const tax = (taxable - 16_452 - 9_208 - 2_000) * 0.14
      + (taxable - 12_989 - 6_342 - 1_796) * 0.0505 + 450
    const spending = floor + 40_000 - tax
    const { plan, evidence } = scenario({ age: 69, rrsp: 600_000, spending, tfsa: 2 * spending, strategy: 'tfsaFirst' })
    // TFSA funds ages 70 and 71 in full. In the following year the plan
    // has no TFSA left, so the fundable discretionary sale precedes RRIF.
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.blocked).toBeNull()
    const [, beforeConversion, converted, row] = result.rows
    expect(beforeConversion.byAccount[POOL].nonRegSale).toBeUndefined()
    expect(converted.byAccount[POOL].nonRegSale).toBeUndefined()
    expect(converted.retirementSettlement?.rrif?.conversion?.amount).toBe(600_000)
    expect(row.retirementSettlement?.rrif).toMatchObject({ minimum: close(floor), withdrawal: close(floor),
      discretionary: close(0), incomeKind: 'rrifWithdrawal' })
    expect(row.byAccount[RRSP].closing).toBeCloseTo(600_000 - floor, 6)
    assertSale(row, 40_000, 100, 20_000, 180_000)
    assertCash(row, spending, taxable, tax)
  })

  it('still refuses a genuine mandatory RRIF cash surplus with a verified pool', () => {
    const afterTaxFloor = 31_680 - 1_395.7265
    const spending = afterTaxFloor - 0.01
    const { plan, evidence } = scenario({ age: 69, rrsp: 600_000, tfsa: 2 * spending, spending, strategy: 'tfsaFirst' })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result).toMatchObject({ rows: prefix.rows, state: prefix.state,
      blocked: { year: 2029, status: 'unsupported', issues: [{ detail: expect.stringMatching(/RRIF.*surplus/i) }] } })
  })
})

describe('non-registered evidence boundaries and compatibility', () => {
  it('settles a representable small positive sale', () => {
    const { plan, evidence } = scenario({ balance: 50, acb: 49, spending: 0.13 })
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    assertSale(result.rows[1], 0.13, 2.6, 0.1274, 48.8726)
    assertCash(result.rows[1], 0.13, 0.0013, 0)
  })

  it.each([
    { label: 'an under-cent debit rounded up to a different cent', balance: 2 ** 46 + 1_024, acb: 0, units: 1_000, divisor: 2 ** 53 },
    { label: 'a sale that leaves the market balance unchanged', balance: 2 ** 46 + 1_024, acb: 0, units: 1_000, divisor: 2 ** 54 },
    { label: 'a partial sale that cannot move a positive unit count', balance: 100, acb: 40, units: Number.MIN_VALUE, divisor: 2 },
    { label: 'a half-value sale that rounds to selling two-thirds of the units', balance: 100, acb: 40, units: 3 * Number.MIN_VALUE, divisor: 2 },
    { label: 'a half-value sale that rounds to selling two-fifths of the units', balance: 100, acb: 40, units: 5 * Number.MIN_VALUE, divisor: 2 },
    { label: 'a true opening loss that rounds away on a small sale', balance: 50, acb: 50.00000000000001, units: 1_000, divisor: 50 / 0.13 },
  ])('atomically refuses $label', ({ balance, acb, units, divisor }) => {
    const { plan, evidence } = scenario({ balance, acb, spending: balance / divisor })
    plan.annualNonRegEvidence!.units = units
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    expect(prefix.state.byAccount[POOL]).toMatchObject({ balance, acb: known(acb), nonRegPool: { units } })
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result).toMatchObject({ rows: prefix.rows, state: prefix.state, uncomputedYears: [2028],
      blocked: { year: 2027, status: 'unsupported', causes: ['nonRegSale'] } })
  })

  it('carries a taxable pool with an own __proto__ key through working and retirement', () => {
    const accountId = '__proto__'
    const { plan, evidence } = scenario({ accountId, balance: 100_000, acb: 60_000 })
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    const [working, retired] = result.rows
    expect(Object.hasOwn(working.byAccount, accountId)).toBe(true)
    expect(Object.hasOwn(retired.byAccount, accountId)).toBe(true)
    expect(Object.hasOwn(result.state.byAccount, accountId)).toBe(true)
    assertSale(retired, 50_000, 500, 30_000, 30_000, 1_000, accountId)
    assertCash(retired, 50_000, 10_000, 0)
  })

  it('prices and posts one accepted gross-up for a taxable owner and account both keyed __proto__', () => {
    const id = '__proto__'
    const spending = 97_000
    const { plan, evidence } = scenario({ accountId: id, balance: 200_000, acb: 80_000, spending })
    plan.people[0].id = id
    plan.tfsaStatement = { [id]: { withdrawals: [], provenance: recorded } }
    for (const account of plan.accounts) {
      account.ownerId = id
      account.taxableOwnerShares = { status: 'known', shares: { [id]: 1 } }
    }

    // 60% gain, half included. Tax rises by 5.715 cents per additional
    // dollar of proceeds across both first brackets and the $300 plateau.
    const fixedSaleTax = firstBracketTax(29_100, 300)
    expect(fixedSaleTax).toBeCloseTo(2_884.3255, 7)
    const proceeds = spending + fixedSaleTax / (1 - 0.3 * 0.1905)
    const tax = firstBracketTax(proceeds * 0.3, 300)
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    const row = result.rows[1]
    expect(Object.keys(row.taxLedger)).toEqual([id])
    expect(Object.hasOwn(row.byAccount, id)).toBe(true)
    expect(row.byAccount[id].ownerId).toBe(id)
    assertSale(row, proceeds, proceeds / 200, proceeds * 0.4, 80_000 - proceeds * 0.4, 1_000, id)
    assertCash(row, spending, proceeds * 0.3, tax, 0, id)
  })

  it('settles earlier TFSA cash before probing a later pool whose full sale cannot be priced at the CPI anchor', () => {
    const cpiRatio = 2 ** -20
    const startCpi = cpiRatio ** 49
    const balance = 80_000_000_000_000
    const tinyCpiPlan = { age: 19, tfsa: 1, balance, acb: 0, inflation: cpiRatio - 1,
      realReturn: 1 / cpiRatio - 1, strategy: 'tfsaFirst' as const }
    const { plan, evidence } = scenario({ ...tinyCpiPlan, spending: 1 })
    plan.people[0].retirementAge = 68
    plan.lifeExpectancy = 69
    expect(balance / startCpi).toBe(Infinity)
    const result = ok(projectCanonicalCoverage(plan, evidence, 50))
    expect(result.blocked).toBeNull()
    const retired = result.rows[49]
    expect(retired.year).toBe(2075)
    expect(retired.byAccount[TFSA]).toMatchObject({ opening: startCpi, withdrawal: startCpi, closing: 0 })
    expect(retired.cashLedger).toMatchObject({ tax: 0, spending: startCpi, unallocated: 0 })
    expect(retired.retirementSettlement).toMatchObject({ startCpi, spendingDue: startCpi, spendingUnmet: 0 })
    expect(retired.byAccount[POOL].nonRegSale).toBeUndefined()
    expect(result.state.byAccount[POOL]).toMatchObject({ balance, acb: known(0), nonRegPool: { units: 1_000 } })

    const reached = scenario({ ...tinyCpiPlan, spending: 2 })
    reached.plan.people[0].retirementAge = 68
    reached.plan.lifeExpectancy = 69
    const prefix = ok(projectCanonicalCoverage(reached.plan, reached.evidence, 49))
    expect(prefix.blocked).toBeNull()
    const blocked = ok(projectCanonicalCoverage(reached.plan, reached.evidence, 51))
    expect(blocked).toMatchObject({ rows: prefix.rows, state: prefix.state, uncomputedYears: [2076],
      blocked: { year: 2075, status: 'unsupported', causes: ['nonRegSale'],
        issues: [{ detail: expect.stringMatching(/^nonReg:.*cannot be priced.*anchor-real/i) }] } })
  })

  it('funds a thirteen-cent TFSA draw with a million-dollar dormant loss pool', () => {
    const { plan, evidence } = scenario({ balance: 1_000_000, acb: 1_100_000, tfsa: 100,
      spending: 0.13, strategy: 'tfsaFirst' })
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    const retired = result.rows[1]
    expect(retired.byAccount[TFSA].withdrawal).toBeCloseTo(0.13, 14)
    expect(retired.cashLedger.unallocated).toBeCloseTo(0, 14)
    expect(retired.byAccount[POOL].nonRegSale).toBeUndefined()
    assertCash(retired, 0.13, 0, 0)
    expect(result.state.byAccount[POOL]).toMatchObject({
      balance: 1_000_000, acb: known(1_100_000), nonRegPool: { units: 1_000 },
    })
  })

  it('does not let generated working savings add untracked taxable units or cost', () => {
    const { plan, evidence } = scenario()
    plan.people[0].earnedIncome = known(10_000)
    plan.savingsAllocation.shares = { tfsa: 0, rrsp: 0, nonReg: 1 }
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 0))
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(stopped).toMatchObject({ rows: [], state: prefix.state,
      blocked: { year: 2026, status: 'unsupported' }, uncomputedYears: [2027] })
    expect(stopped.state.contributionHistory).toEqual([])
    expect(stopped.state.byAccount[POOL]).toMatchObject({ balance: 400_000, acb: known(200_000),
      nonRegPool: { holdingId: HOLDING, units: 1_000 } })
  })

  it('keeps an unreached loss out of the receipt and stops atomically when funding reaches it', () => {
    const { plan, evidence } = scenario({ balance: 100_000, acb: 110_000, tfsa: 65_000,
      rrsp: 200_000, strategy: 'tfsaFirst' })
    const original = structuredClone(plan)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows[1].byAccount[POOL].nonRegSale).toBeUndefined()
    assertCash(prefix.rows[1], 50_000, 0, 0)
    expect(prefix.state.byAccount[POOL]).toMatchObject({ balance: 100_000, acb: known(110_000),
      nonRegPool: { holdingId: HOLDING, units: 1_000 } })
    expect(prefix.state.byAccount[TFSA].balance).toBeCloseTo(15_000, 6)
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(stopped).toMatchObject({ blocked: { year: 2028, status: 'unsupported', causes: ['nonRegSale'],
      issues: [{ detail: expect.stringMatching(/^nonReg:.*loss/i) }] },
    rows: prefix.rows, state: prefix.state, uncomputedYears: [2029], overallConclusionAvailable: false })
    expect(plan).toEqual(original)
  })

  it('localizes the no-sale explanation in computed years and preserves the stop cause for a blocked sale', () => {
    const { plan, evidence } = scenario({ balance: 100_000, acb: 110_000, tfsa: 50_000, strategy: 'tfsaFirst' })
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.blocked).toMatchObject({ year: 2028, causes: ['nonRegSale'] })
    const sheet = canonicalAnnualSheet(result, sheetContext)
    for (const field of ['proceeds', 'allocatedAcb', 'closingAcb', 'realizedGain', 'taxableGain']) {
      const cells = findRow(sheet.rows, canonicalSheetId('value', 'account', POOL, 'nonRegSale', field))!.cells!
      for (const [locale, noSale, stopCause] of [
        ['en', /no .*sale.*recorded/i, /verified.*nonnegative gains/i],
        ['fr', /aucune vente.*(?:comptabilisé|enregistr)/i, /vérifié.*plus-value non négative/i],
        ['zh', /未记录.*出售/, /核实.*非负资本利得/],
      ] as const) {
        for (const year of [2026, 2027]) {
          expect(cells[year]).toMatchObject({ value: null, status: 'not-applicable' })
          expect(annualSheetText(cells[year].reason!, locale)).toMatch(noSale)
        }
        expect(cells[2028]).toMatchObject({ value: null, status: 'not-computed' })
        expect(annualSheetText(cells[2028].reason!, locale)).toMatch(stopCause)
        expect(annualSheetText(cells[2029].reason!, locale)).not.toMatch(noSale)
      }
    }
  })

  it.each(['unknown ACB', 'mismatched ACB', 'second pool', 'unverified ownership', 'distribution',
    'interest', 'return of capital', 'sale fees', 'projected distribution yield', 'restricted access'] as const)(
    'refuses %s before a sale or settlement can be returned', problem => {
      const { plan, pool, evidence } = scenario()
      const facts = plan.annualNonRegEvidence!
      switch (problem) {
        case 'unknown ACB': pool.acb = { status: 'unknown', reason: 'broker history missing' }; break
        case 'mismatched ACB': facts.pooledAcbNominal += 1; break
        case 'second pool': plan.accounts.push({ ...structuredClone(pool), id: 'other-holding' }); break
        case 'unverified ownership': pool.taxableOwnerShares = { status: 'unknown', reason: 'unknown beneficial ownership' }; break
        case 'distribution': Object.assign(facts, { distributions: 1 }); break
        case 'interest': Object.assign(facts, { interest: 1 }); break
        case 'return of capital': Object.assign(facts, { returnOfCapital: 1 }); break
        case 'sale fees': Object.assign(facts, { saleFees: 1 }); break
        case 'projected distribution yield': plan.projectionAssumptions.nonRegDistributionYield = 0.01; break
        case 'restricted access': pool.accessibleAge = 65; break
      }
      const snapshot = structuredClone(plan)
      const detail = problem === 'unverified ownership' ? 'pricing gate: ownershipUnknown' : expect.stringMatching(/^nonReg:/)
      expect(projectCanonicalCoverage(plan, evidence, 3)).toMatchObject({ status: 'unsupported', issues: [{ detail }] })
      expect(plan).toEqual(snapshot)
    },
  )

  it('preserves the public working quote, provider, and standalone scopes and rejects supplied pool state', () => {
    const { plan, evidence } = scenario()
    const noEvidence = structuredClone(plan)
    delete noEvidence.annualNonRegEvidence
    const opening = ok(initializeState(plan))
    expect(opening).toEqual(ok(initializeState(noEvidence)))
    expect(ok(projectCanonicalCoverage(noEvidence, evidence, 2))).toMatchObject({
      rows: [], state: opening, blocked: { status: 'unsupported' },
    })
    expect(evaluateCanonicalWorkingYear(plan, evidence)).toEqual(evaluateCanonicalWorkingYear(noEvidence, evidence))
    const providers = {
      evaluate: () => ({ byPerson: { [RETIREE]: { income: 100, earnedIncome: 0, benefits: 0, tax: 0,
        spending: 0, taxableIncome: 0, benefitIncomeForNextYear: known(0) } } }),
      returns: () => 0,
    }
    const providerPlan = structuredClone(plan)
    providerPlan.budget = { kind: 'savingsBudget', annualNetSavings: 100, retirementSpending: 50_000,
      debtIncluded: known(true), taxBenefitIncluded: known(true) }
    providerPlan.savingsAllocation.shares = { tfsa: 0, rrsp: 0, nonReg: 1 }
    const providerBaseline = structuredClone(providerPlan)
    delete providerBaseline.annualNonRegEvidence
    const provider = ok(projectAnnualCoverage(providerPlan, opening, 1, providers))
    expect(provider).toEqual(ok(projectAnnualCoverage(providerBaseline, opening, 1, providers)))
    expect(provider.blocked).toBeNull()
    expect(provider.rows[0].byAccount[POOL]).toEqual({ opening: 400_000, closing: 400_100,
      withdrawal: 0, contribution: 100, returnAmount: 0, acb: known(200_100), ownerId: RETIREE })
    expect(provider.state.byAccount[POOL].nonRegPool).toBeUndefined()

    const standalone = structuredClone(plan)
    standalone.people[0].retirementAge = 55
    const standaloneOpening = ok(initializeState(standalone))
    expect(annualRetirementStep(standalone, standaloneOpening)).toMatchObject({ status: 'unsupported' })
    expect(ok(projectRetirementCoverage(standalone, standaloneOpening, 1))).toMatchObject({
      rows: [], state: standaloneOpening, blocked: { status: 'unsupported' } })

    const returned = ok(projectCanonicalCoverage(plan, evidence, 2)).state
    const forged = structuredClone(opening)
    forged.byAccount[POOL].nonRegPool = { holdingId: HOLDING, units: 1_000 }
    const never = { evaluate: vi.fn(), returns: vi.fn() }
    for (const supplied of [returned, forged]) {
      expect(annualRetirementContinuation(plan, supplied)).toMatchObject({ status: 'invalid' })
      expect(annualRetirementStep(plan, supplied, never.returns)).toMatchObject({ status: 'invalid' })
      expect(annualStep(providerPlan, supplied, never)).toMatchObject({ status: 'invalid' })
      for (const years of [0, 1]) {
        expect(projectRetirementCoverage(plan, supplied, years, never.returns)).toMatchObject({ status: 'invalid' })
        expect(projectAnnualCoverage(providerPlan, supplied, years, never)).toMatchObject({ status: 'invalid' })
        expect(projectFromState(providerPlan, supplied, years, never)).toMatchObject({ status: 'invalid' })
      }
    }
    expect(never.evaluate).not.toHaveBeenCalled()
    expect(never.returns).not.toHaveBeenCalled()
  })

  it('keeps the App projection and legacy annual detail identical with or without the new evidence', () => {
    const { plan } = scenario()
    const inputs = legacyRetirement({ balances: { nonReg: 400_000, tfsa: 0, rrsp: 0 },
      nonRegBook: 200_000, retirementSpending: 50_000, strategy: 'nonRegFirst' })
    plan.legacyProjection = inputs
    const legacyPlan = structuredClone(plan)
    delete legacyPlan.annualNonRegEvidence
    const plain = runProjection(inputs, undefined, legacyPlan)
    const legacy = runProjection(inputs, undefined, legacyPlan, { captureAnnualDetails: true })
    const observed = runProjection(inputs, undefined, plan, { captureAnnualDetails: true })
    expect(observed).toEqual(legacy)
    expect({ ...observed, rows: observed.rows.map(({ annualDetails: _details, ...row }) => row) }).toEqual(plain)
    expect(observed.rows[0].withdrawals.nonReg).toBeGreaterThan(0)
    const sheet = legacyAnnualSheet(observed, inputs, sheetContext)
    expect(sheet.rows).toEqual(legacyAnnualSheet(legacy, inputs, sheetContext).rows)
    expect(findRow(sheet.rows, canonicalSheetId('value', 'account', POOL, 'nonRegSale', 'proceeds'))).toBeUndefined()
  })
})
