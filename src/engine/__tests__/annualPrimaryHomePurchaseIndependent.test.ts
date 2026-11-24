import { describe, expect, it } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { annualRetirementContinuation, annualRetirementStep } from '../annualRetirement'
import { fixedReturnProvider, initializeState, projectAnnualCoverage, projectCanonicalCoverage, sumNetWorth, type KernelResult } from '../annualState'
import { evaluateCanonicalWorkingYear } from '../annualWorking'
import { refreshCanonicalFromLegacy } from '../migration'
import type { InputsV2 } from '../model'
import { runProjection } from '../projection'
import { BASE_YEAR, known, legacyRetirement, recorded, retirementPlan, RETIREE, TFSA } from './fixtures/retirementSettlement'

const HOME = 'planned-home'
const PURCHASE_YEAR = 2027
const PRICE = 100_000.25
const COSTS = 1_299.75
const CONTEXT = { scenarioId: 'primary-home-purchase-independent', revision: 1 }
const close = (value: number) => expect.closeTo(value, 6)

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function fixture(tfsa = 100_000, costs = COSTS) {
  const plan = retirementPlan({ tfsa, rrsp: 0, spending: 8_000, inflation: 0.02, strategy: 'tfsaFirst' })
  plan.accounts = plan.accounts.filter(account => account.id === TFSA)
  Object.assign(plan.people[0], { earnedIncome: known(12_000), retirementAge: 58 })
  plan.lifeExpectancy = 60
  // $12,000 wages less $701.35 in payroll contributions and $10,298.65
  // living costs leaves $1,000 contributed before the year's 2% nominal growth.
  plan.budget = { kind: 'incomeBudget', workingSpending: 10_298.65, retirementSpending: 8_000 }
  plan.properties.push({
    id: HOME, kind: 'principal', value: PRICE, acb: known(PRICE), annualRent: known(0), appreciation: 0.04,
    sellAtAge: null, plannedPurchaseAge: 58, plannedDownPayment: PRICE, plannedMortgage: null,
    annualHoldingCostChange: 0, mortgageDebtId: null,
    taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 1 } },
    provenance: { value: recorded },
  })
  const purchase: NonNullable<InputsV2['annualPrimaryHomePurchaseEvidence']>[string] = {
    provenance: recorded,
    effectiveYear: PURCHASE_YEAR,
    timing: 'start-of-purchase-year' as const,
    priceNominal: known(PRICE),
    qualifyingAcquisitionCostsNominal: known(costs),
    postPurchaseAnnualSpendingReal: known(1_000),
    excludesOneTimeCosts: true as const,
  }
  plan.annualPrimaryHomePurchaseEvidence = { [HOME]: purchase }
  const evidence = { workingSpending: known(10_298.65), retirementSpending: known(8_000) }
  return { plan, evidence, purchase }
}

function migratedFixture(basePrice = PRICE, costs = 19.745, tfsa = 100_000) {
  const { plan, evidence, purchase } = fixture(tfsa, costs)
  const inputs = legacyRetirement({ currentAge: 57, fireAge: 58, lifeExpectancy: 60, inflation: 0.02,
    principalResidence: { mode: 'planned', buyAtAge: 58, price: basePrice, downPayment: basePrice,
      appreciation: 0.04, netHoldingCostChange: 0, sellAtAge: null } })
  const migrated = refreshCanonicalFromLegacy(null, inputs)
  // Carry the migrated terms into a plan with verified payroll, spending and
  // benefits. Map the migrated sole owner to the fixture's sole person.
  const [home] = migrated.properties
  home.taxableOwnerShares = { status: 'known', shares: { [RETIREE]: 1 } }
  plan.properties = [home]
  plan.annualPrimaryHomePurchaseEvidence = { [home.id]: purchase }
  purchase.priceBasis = 'base-year-real-indexed'
  return { plan, evidence, purchase, home }
}

function findRow(rows: AnnualSheetRow[], id: string): AnnualSheetRow | undefined {
  for (const row of rows) {
    if (row.id === id) return row
    const child = findRow(row.children ?? [], id)
    if (child) return child
  }
}

describe('independent canonical primary home purchase', () => {
  it('posts the mandatory purchase before indexed living, grows only the property price and carries the ACB once', () => {
    const { plan, evidence, purchase } = fixture()
    const original = structuredClone({ plan, evidence })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage).toMatchObject({ blocked: null, uncomputedYears: [], evaluationBasis: 'canonical-continuous' })
    expect(coverage.rows.map(row => row.year)).toEqual([2026, 2027, 2028, 2029])
    expect(coverage.rows.slice(0, 1)).toEqual(prefix.rows)
    const [working, bought, carry, exhausted] = coverage.rows
    expect(working.workingSettlement).toBeDefined()
    expect(working.cashLedger).toMatchObject({ income: 12_000, spending: 10_298.65, tax: 0 })
    expect(working.byAccount[TFSA]).toMatchObject({ opening: 100_000, contribution: 1_000, withdrawal: 0, closing: 103_020 })
    expect(working.byProperty[HOME]).toEqual({ held: false, opening: PRICE, growth: 0, closing: PRICE })
    expect(sumNetWorth(prefix.state)).toBe(103_020)

    // Purchase cost is $100,000.25 + $1,299.75 = $101,300 nominal.
    // Living uses $1,020 (base $1,000 × 1.02) of the $1,720 residue.
    // $700 grows to $714. From year two the account depletes, while property
    // growth starts in the acquisition year at 1.04 × 1.02 = 1.0608.
    const receipt = { propertyId: HOME, year: PURCHASE_YEAR, price: PRICE,
      priceBasis: 'purchase-year-nominal', qualifyingAcquisitionCosts: COSTS, totalCost: 101_300, acb: 101_300, tax: 0 }
    expect(bought.retirementSettlement?.primaryHomePurchase).toMatchObject(receipt)
    expect(bought.retirementSettlement?.primaryHomePurchaseEvidence).toEqual(purchase)
    expect(bought.retirementSettlement?.primaryHomePurchaseArithmetic).toMatchObject({
      price: { coefficient: '10000025', scale: 2 },
      qualifyingAcquisitionCosts: { coefficient: '129975', scale: 2 },
      totalCost: { coefficient: '101300', scale: 0 },
      withdrawals: { [TFSA]: { coefficient: '101300', scale: 0 } },
    })
    expect(bought.byProperty[HOME]).toEqual({ held: true, opening: PRICE, growth: close(6_080.0152), closing: close(106_080.2652) })
    expect(carry.byProperty[HOME]).toEqual({ held: true, opening: close(106_080.2652), growth: close(6_449.68012416), closing: close(112_529.94532416) })
    const schedule = [
      [bought, 103_020, 102_320, 14, 714, 1_020, 1_020, 0, 106_794.2652],
      [carry, 714, 714, 0, 0, 1_040.4, 714, 326.4, 112_529.94532416],
      [exhausted, 0, 0, 0, 0, 1_061.208, 0, 1_061.208, 119_371.765999868928],
    ] as const
    for (const [row, opening, withdrawal, growth, closing, due, funded, unmet, netWorth] of schedule) {
      expect(row.byAccount[TFSA]).toMatchObject({ opening, withdrawal, contribution: 0, returnAmount: close(growth), closing })
      expect(row.retirementSettlement).toMatchObject({ spendingDue: close(due), spendingFunded: close(funded), spendingUnmet: close(unmet) })
      expect(row.cashLedger).toMatchObject({ income: 0, benefits: 0, tax: 0, spending: close(funded), debtPayments: 0, unallocated: 0 })
      expect(row.taxLedger).toEqual({ [RETIREE]: { taxableIncome: 0, tax: 0 } })
      expect(row.byDebt).toEqual({})
      const length = row.year - BASE_YEAR + 1
      const throughYear = ok(projectCanonicalCoverage(plan, evidence, length))
      expect(throughYear.rows).toEqual(coverage.rows.slice(0, length))
      expect(throughYear.state.byProperty[HOME]).toMatchObject({ held: true, value: row.byProperty[HOME].closing, acb: known(101_300) })
      expect(sumNetWorth(throughYear.state)).toBeCloseTo(netWorth, 6)
      expect(throughYear.state.primaryHomePurchase).toMatchObject({
        receipt, evidence: purchase, exactAccountBalances: { [TFSA]: { coefficient: String(closing), scale: 0 } },
      })
      if (row !== bought) {
        expect(row.retirementSettlement?.primaryHomePurchase).toBeUndefined()
        expect(row.retirementSettlement?.primaryHomePurchaseArithmetic?.withdrawals[TFSA]).toEqual({ coefficient: '0', scale: 0 })
      }
    }
    expect(bought.tfsaLedger[RETIREE].restored).toEqual(known(0))
    expect(carry.tfsaLedger[RETIREE].restored).toEqual(known(102_320))
    expect(exhausted.tfsaLedger[RETIREE].restored).toEqual(known(714))
    expect(coverage.state.tfsaWithdrawalHistory).toEqual([
      { id: `annual:2027:withdrawal:${TFSA}`, personId: RETIREE, calendarYear: 2027, amount: 102_320 },
      { id: `annual:2028:withdrawal:${TFSA}`, personId: RETIREE, calendarYear: 2028, amount: 714 },
    ])
    expect({ plan, evidence }).toEqual(original)
  })

  it.each([
    [1_999.75, 102_000, 0],
    [1_299.75, 101_300, 700],
    [1_299.751, 101_300.001, 699.999],
  ])('acquires with qualifying costs of %f before settling partial living', (costs, totalCost, livingFunded) => {
    const { plan, evidence } = fixture(99_000, costs)
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    const row = result.rows[1]
    expect(row.byAccount[TFSA]).toMatchObject({ opening: 102_000, withdrawal: 102_000, returnAmount: 0, closing: 0 })
    expect(row.retirementSettlement).toMatchObject({
      primaryHomePurchase: { totalCost, acb: totalCost },
      spendingFunded: livingFunded, spendingUnmet: 1_020 - livingFunded,
    })
    expect(row.cashLedger.spending).toBe(livingFunded)
    expect(result.state.byProperty[HOME].held).toBe(true)
    expect(sumNetWorth(result.state)).toBeCloseTo(106_080.2652, 6)
  })

  it('leaves the committed prefix intact for a one-cent shortfall including acquisition costs', () => {
    const { plan, evidence } = fixture(99_000, 1_999.76)
    const original = structuredClone({ plan, evidence })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    expect(prefix.state.byAccount[TFSA].balance).toBe(102_000)
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(stopped).toMatchObject({
      blocked: { year: PURCHASE_YEAR, status: 'unsupported', causes: ['propertyPurchase'] },
      uncomputedYears: [2028, 2029], overallConclusionAvailable: false,
    })
    expect(stopped.rows).toEqual(prefix.rows)
    expect(stopped.state).toEqual(prefix.state)
    expect(stopped.state.primaryHomePurchase).toBeUndefined()
    expect(stopped.state.byProperty[HOME]).toMatchObject({ held: false, value: PRICE, acb: known(PRICE) })
    const sheet = canonicalAnnualSheet(stopped, CONTEXT)
    const cells = findRow(sheet.rows, canonicalSheetId('value', 'netWorth'))!.cells!
    expect(cells[BASE_YEAR].value).toBe(102_000)
    for (const year of [2027, 2028, 2029]) expect(cells[year]).toMatchObject({ status: 'not-computed', value: null })
    const detail = sheet.resolveExplanation!(cells[PURCHASE_YEAR].explanationRefs![0])!
    for (const [locale, insufficient, noDebit, suffix] of [
      ['en', /TFSA funding is insufficient.*full nominal purchase price.*qualifying acquisition costs/i, /no acquisition or account debit was committed/i, 'Not computed after the first blocked year.'],
      ['fr', /financement CELI est insuffisant.*prix d’achat nominal total.*frais d’acquisition admissibles/i, /aucun achat ni débit de compte.*comptabilisé/i, 'Non calculé après la première année bloquée.'],
      ['zh', /TFSA 筹资不足.*名义购房价格全额.*合资格购置费用/, /未购入房产.*未提交账户扣款/, '首个受阻年度之后未计算。'],
    ] as const) {
      const reason = annualSheetText(cells[PURCHASE_YEAR].reason!, locale)
      expect(reason).toMatch(insufficient)
      expect(reason).toMatch(noDebit)
      expect(annualSheetText(detail.limitations![0], locale)).toBe(reason)
      for (const year of [2028, 2029]) expect(annualSheetText(cells[year].reason!, locale)).toBe(suffix)
    }
    expect({ plan, evidence }).toEqual(original)
  })

  it('uses the mathematically funded working-growth handoff at the exact acquisition boundary', () => {
    // ($99,175 + $1,000) × 1.02 × 1.02 = $104,222.07.
    // Recorded nominal price of $100,000.25 plus $4,221.82 is exactly funded.
    const { plan, evidence, purchase } = fixture(99_175, 4_221.82)
    plan.accounts[0].realReturn = 0.02
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    expect(prefix.state.byAccount[TFSA].balance).toBe(104_222.07)
    expect(prefix.state.prospectivePurchaseExactBalances?.[TFSA]).toEqual({ coefficient: '10422207', scale: 2 })
    expect(prefix.rows[0].byAccount[TFSA].primaryHomePurchaseReconciliation).toBeGreaterThan(0)
    const bought = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(bought.blocked).toBeNull()
    expect(bought.rows[1].retirementSettlement).toMatchObject({
      primaryHomePurchase: { totalCost: 104_222.07, acb: 104_222.07 },
      primaryHomePurchaseArithmetic: { withdrawals: { [TFSA]: { coefficient: '10422207', scale: 2 } } },
      spendingFunded: 0, spendingUnmet: 1_020,
    })
    expect(bought.rows[1].byAccount[TFSA].closing).toBe(0)
    expect(bought.rows[1].byAccount[TFSA].withdrawal).toBe(104_222.07)
    expect(bought.state.tfsaWithdrawalHistory).toEqual([
      { id: `annual:2027:withdrawal:${TFSA}`, personId: RETIREE, calendarYear: 2027, amount: 104_222.07 },
    ])

    for (const costs of [4_221.820000000001, 4_221.83]) {
      purchase.qualifyingAcquisitionCostsNominal = known(costs)
      const short = ok(projectCanonicalCoverage(plan, evidence, 2))
      expect(short.blocked).toMatchObject({ year: PURCHASE_YEAR, causes: ['propertyPurchase'] })
      expect(short.rows).toEqual(prefix.rows)
      expect(short.state).toEqual(prefix.state)
      expect(short.state.byProperty[HOME].held).toBe(false)
    }
  })

  it.each([3_845.930000000001, 3_845.94])('does not spend working growth roundoff when qualifying costs are %s', costs => {
    // ($100,800 + $1,000) × 1.01 × 1.01 = $103,846.18. Available cash
    // excludes the floating-point excess in the numeric working balance.
    const { plan, evidence } = fixture(100_800, costs)
    plan.accounts[0].realReturn = 0.01
    plan.inflation = 0.01
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    expect(prefix.state.byAccount[TFSA].balance).toBe(103_846.18)
    expect(prefix.state.prospectivePurchaseExactBalances?.[TFSA]).toEqual({ coefficient: '10384618', scale: 2 })
    expect(prefix.rows[0].byAccount[TFSA].primaryHomePurchaseReconciliation).toBeLessThan(0)
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(stopped.blocked).toMatchObject({ year: PURCHASE_YEAR, causes: ['propertyPurchase'] })
    expect(stopped.rows).toEqual(prefix.rows)
    expect(stopped.state).toEqual(prefix.state)
  })

  it('carries the exact TFSA through a retired year before the scheduled opening purchase', () => {
    const { plan, evidence, purchase } = fixture(100_000, 1_756.95)
    const price = 95_000.25
    Object.assign(plan.properties[0], { value: price, acb: known(price), plannedDownPayment: price, plannedPurchaseAge: 59 })
    purchase.priceNominal = known(price)
    purchase.effectiveYear = 2028
    // The ordinary retirement budget applies until acquisition.
    // ($103,020 − $8,000 × 1.02) × 1.02 = $96,757.20.
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows[1].retirementSettlement).toMatchObject({ spendingDue: 8_160, spendingFunded: 8_160, spendingUnmet: 0 })
    expect(prefix.rows[1].retirementSettlement?.primaryHomePurchase).toBeUndefined()
    expect(prefix.rows[1].byProperty[HOME]).toMatchObject({ held: false, growth: 0 })
    expect(prefix.rows[1].byAccount[TFSA]).toMatchObject({ withdrawal: 8_160, closing: 96_757.20 })
    expect(prefix.state.prospectivePurchaseExactBalances?.[TFSA]).toEqual({ coefficient: '967572', scale: 1 })

    const settled = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(settled.blocked).toBeNull()
    expect(settled.rows.slice(0, 2)).toEqual(prefix.rows)
    expect(settled.rows[2].retirementSettlement).toMatchObject({
      primaryHomePurchase: { year: 2028, price, totalCost: 96_757.20, acb: 96_757.20 },
      spendingDue: 1_040.4, spendingFunded: 0, spendingUnmet: 1_040.4,
    })
    expect(settled.rows[2].byAccount[TFSA]).toMatchObject({ withdrawal: 96_757.20, closing: 0 })
    expect(settled.state.prospectivePurchaseExactBalances).toBeUndefined()
    expect(sumNetWorth(settled.state)).toBeCloseTo(100_776.2652, 6)
  })

  it('exhausts the exact TFSA for pre-purchase living and stops only at the next purchase', () => {
    const { plan, evidence, purchase } = fixture(100_000.01)
    plan.accounts[0].realReturn = 0.03
    plan.people[0].retirementAge = 60
    plan.properties[0].plannedPurchaseAge = 61
    plan.lifeExpectancy = 62
    purchase.effectiveYear = 2030
    plan.budget = { kind: 'incomeBudget', workingSpending: 11_298.65, retirementSpending: 1_000_000 }
    evidence.workingSpending = known(11_298.65)
    evidence.retirementSpending = known(1_000_000)
    // Zero contributions. $100,000.01 × (1.03 × 1.02)³ = $115,961.07501770634216.
    // The numeric opening rounds up and must not be subtracted from the
    // exact backing. The actual balance is the sole debit for living.
    const working = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(working.blocked).toBeNull()
    expect(working.rows.every(row => row.workingSettlement && row.byAccount[TFSA].contribution === 0)).toBe(true)
    expect(working.state.prospectivePurchaseExactBalances?.[TFSA]).toEqual({ coefficient: '11596107501770634216', scale: 14 })
    const retired = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(retired.blocked).toBeNull()
    expect(retired.rows.slice(0, 3)).toEqual(working.rows)
    const row = retired.rows[3]
    expect(row.retirementSettlement).toMatchObject({
      spendingDue: close(1_061_208), spendingFunded: close(115_961.07501770634216), spendingUnmet: close(945_246.92498229365784),
    })
    expect(row.retirementSettlement?.primaryHomePurchase).toBeUndefined()
    const exactDebit = { coefficient: '11596107501770634216', scale: 14 }
    expect(row.byAccount[TFSA]).toMatchObject({ withdrawal: 115_961.07501770634216, contribution: 0, returnAmount: 0, closing: 0,
      primaryHomePurchaseExactWithdrawal: exactDebit, primaryHomePurchaseWithdrawalReconciliation: -0.00000000000784 })
    expect(row.cashLedger).toMatchObject({ spending: 115_961.07501770634216, income: 0, benefits: 0, tax: 0, unallocated: 0 })
    expect(retired.state.prospectivePurchaseExactBalances?.[TFSA]).toEqual({ coefficient: '0', scale: 0 })
    expect(retired.state.tfsaWithdrawalHistory).toEqual([
      { id: `annual:2029:withdrawal:${TFSA}`, personId: RETIREE, calendarYear: 2029, amount: 115_961.07501770634216 },
    ])
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(stopped.blocked).toMatchObject({ year: 2030, status: 'unsupported', causes: ['propertyPurchase'] })
    expect(stopped.uncomputedYears).toEqual([2031])
    expect(stopped.rows).toEqual(retired.rows)
    expect(stopped.state).toEqual(retired.state)
    expect(stopped.state.byProperty[HOME].held).toBe(false)
    expect(sumNetWorth(stopped.state)).toBe(0)
    const sheet = canonicalAnnualSheet(stopped, CONTEXT)
    const memo = findRow(sheet.rows, canonicalSheetId('value', 'account', TFSA, 'primaryHomePurchaseWithdrawalReconciliation'))!
    const cell = memo.cells![2029]
    expect(cell.value).toBe(-0.00000000000784)
    const details = sheet.resolveExplanation!(cell.explanationRefs![0])!
    const exactSource = details.sources?.find(source => source.field === 'primaryHomePurchaseExactWithdrawal')!
    expect(JSON.parse(annualSheetText(exactSource.displayReference!, 'en'))).toEqual(exactDebit)
    expect(details.sources).toContainEqual(expect.objectContaining({ field: 'primaryHomePurchaseWithdrawalReconciliation', displayReference: '-7.84e-12' }))
    for (const [locale, debit] of [['en', /exact nominal TFSA debit/i], ['fr', /débit CELI nominal exact/i], ['zh', /精确名义 TFSA 扣款/]] as const) {
      expect(annualSheetText(exactSource.label, locale)).toMatch(debit)
    }
  })

  it('accepts a real migrated cash home with null loan terms and an explicitly indexed quote', () => {
    const { plan, evidence, purchase, home } = migratedFixture()
    expect(home.plannedMortgage).toEqual({ principal: 0, annualPayment: null, yearsRemaining: null })
    expect(home.provenance.value?.origin).toBe('legacy')
    // $100,000.25 base-year price × 1.02 = $102,000.255 nominal.
    // $19.745 fees stay nominal. $103,020 working carry less $102,020
    // acquisition leaves $1,000 for the $1,020 indexed living budget.
    purchase.priceNominal = known(102_000.255)
    const settled = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(settled.blocked).toBeNull()
    const bought = settled.rows[1]
    expect(bought.retirementSettlement).toMatchObject({
      primaryHomePurchase: { propertyId: home.id, priceBasis: 'base-year-real-indexed', price: 102_000.255,
        qualifyingAcquisitionCosts: 19.745, totalCost: 102_020, acb: 102_020, tax: 0 },
      primaryHomePurchaseArithmetic: {
        price: { coefficient: '102000255', scale: 3 }, totalCost: { coefficient: '102020', scale: 0 },
        withdrawals: { [TFSA]: { coefficient: '102020', scale: 0 } },
      },
      spendingDue: 1_020, spendingFunded: 1_000, spendingUnmet: 20,
    })
    expect(bought.byAccount[TFSA]).toMatchObject({ withdrawal: 103_020, closing: 0 })
    expect(bought.byProperty[home.id]).toMatchObject({ opening: 102_000.255, closing: close(108_201.870504) })
    expect(bought.byDebt).toEqual({})
    const sheet = canonicalAnnualSheet(settled, CONTEXT)
    const cell = findRow(sheet.rows, canonicalSheetId('value', 'primaryHomePurchase', 'price'))!.cells![PURCHASE_YEAR]
    const details = sheet.resolveExplanation!(cell.explanationRefs![0])!
    const source = details.sources!.find(item => item.field === 'annualPrimaryHomePurchaseEvidence.priceBasis')!
    expect(source.displayReference).toBe('base-year-real-indexed')
    for (const [locale, basis] of [
      ['en', /base-year real price.*exact CPI.*nominal costs/i],
      ['fr', /prix réel de référence.*IPC exact.*frais nominaux/i],
      ['zh', /精确 CPI.*基年实际价格.*名义费用/],
    ] as const) {
      expect(annualSheetText(source.label, locale)).toMatch(basis)
    }
  })

  it('uses an indexed price beyond numeric precision and blocks a genuine sub-cent increase', () => {
    const { plan, evidence, purchase } = migratedFixture(99_999.99999999999, 0.0000000000102, 99_000)
    // $99,999.99999999999 × 1.02 = $101,999.9999999999898, which rounds
    // to the recorded nominal Number. Its exact sum with the cost is
    // $102,000. Using the rounded quote instead would overcharge.
    purchase.priceNominal = known(101_999.99999999999)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.state.byAccount[TFSA].balance).toBe(102_000)
    const settled = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(settled.blocked).toBeNull()
    expect(settled.rows[1].retirementSettlement).toMatchObject({
      primaryHomePurchase: { price: 101_999.99999999999, totalCost: 102_000, acb: 102_000 },
      primaryHomePurchaseArithmetic: {
        price: { coefficient: '1019999999999999898', scale: 13 },
        totalCost: { coefficient: '102000', scale: 0 },
        withdrawals: { [TFSA]: { coefficient: '102000', scale: 0 } },
      },
      spendingFunded: 0, spendingUnmet: 1_020,
    })
    expect(settled.rows[1].byAccount[TFSA]).toMatchObject({ withdrawal: 102_000, closing: 0 })
    const sheet = canonicalAnnualSheet(settled, CONTEXT)
    const cell = findRow(sheet.rows, canonicalSheetId('value', 'primaryHomePurchase', 'price'))!.cells![PURCHASE_YEAR]
    const details = sheet.resolveExplanation!(cell.explanationRefs![0])!
    const source = details.sources!.find(item => item.field === 'primaryHomePurchaseArithmetic.price')!
    expect(JSON.parse(annualSheetText(source.displayReference!, 'en'))).toEqual({ coefficient: '1019999999999999898', scale: 13 })
    purchase.qualifyingAcquisitionCostsNominal = known(0.0000000000103)
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(stopped.blocked).toMatchObject({ year: PURCHASE_YEAR, causes: ['propertyPurchase'] })
    expect(stopped.rows).toEqual(prefix.rows)
    expect(stopped.state).toEqual(prefix.state)
  })

  it.each([['contradicted indexed quote', 'base-year-real-indexed', 102_000.26], ['no basis opt-in', undefined, 102_000.255]] as const)(
    'requires explicit, reconciled evidence for a migrated indexed price with %s', (_name, basis, price) => {
      const { plan, evidence, purchase } = migratedFixture()
      purchase.priceBasis = basis
      purchase.priceNominal = known(price)
      const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
      const stopped = ok(projectCanonicalCoverage(plan, evidence, 2))
      expect(stopped.blocked).toMatchObject({ year: PURCHASE_YEAR, causes: ['propertyPurchase'] })
      expect(stopped.rows).toEqual(prefix.rows)
      expect(stopped.state).toEqual(prefix.state)
    },
  )

  it.each([[0, 0], [0, null], [null, 0]] as const)('admits zero financing with payment %s and term %s', (annualPayment, yearsRemaining) => {
    const { plan, evidence } = fixture()
    plan.properties[0].plannedMortgage = { principal: 0, annualPayment, yearsRemaining }
    expect(ok(projectCanonicalCoverage(plan, evidence, 2)).rows[1].retirementSettlement?.primaryHomePurchase)
      .toMatchObject({ totalCost: 101_300, priceBasis: 'purchase-year-nominal' })
  })

  it('shows the nominal acquisition, ACB and post-purchase spending sources in English, French and Chinese', () => {
    const { plan, evidence } = fixture()
    const sheet = canonicalAnnualSheet(ok(projectCanonicalCoverage(plan, evidence, 4)), CONTEXT)
    const get = (...id: string[]) => findRow(sheet.rows, canonicalSheetId('value', ...id))!
    const column = sheet.years.find(year => year.year === PURCHASE_YEAR)!
    const group = findRow(sheet.rows, canonicalSheetId('group', 'primaryHomePurchase'))!
    const fields = [['price', PRICE], ['qualifyingAcquisitionCosts', COSTS], ['totalCost', 101_300], ['acb', 101_300], ['tax', 0]] as const
    expect(group.children?.map(row => row.id)).toEqual(fields.map(([field]) => get('primaryHomePurchase', field).id))
    for (const [field, amount] of fields) {
      const row = get('primaryHomePurchase', field)
      const cell = row.cells![PURCHASE_YEAR]
      expect(cell).toMatchObject({ value: amount, basis: field === 'acb' ? 'nominal-tax-basis' : 'nominal-CAD' })
      expect(annualSheetDisplayValue(cell, column, 'nominal')).toBe(amount)
      expect(annualSheetDisplayValue(cell, column, 'real')).toBeCloseTo(field === 'acb' ? amount : amount / 1.02, 6)
      for (const year of [2026, 2028, 2029]) expect(row.cells![year]).toMatchObject({ status: 'not-applicable', value: null })
    }
    const detail = (...id: string[]) => sheet.resolveExplanation!(get(...id).cells![PURCHASE_YEAR].explanationRefs![0])!
    expect(detail('primaryHomePurchase', 'acb').formula).toEqual([
      expect.objectContaining({ field: 'price', direction: 'add', value: PRICE, basis: 'nominal-tax-basis' }),
      expect.objectContaining({ field: 'qualifyingAcquisitionCosts', direction: 'add', value: COSTS, basis: 'nominal-tax-basis' }),
    ])
    const funded = detail('retirement', 'spendingFunded')
    expect(funded.sources).toContainEqual(expect.objectContaining({ field: 'annualPrimaryHomePurchaseEvidence.postPurchaseAnnualSpendingReal' }))
    expect(funded.sources?.some(source => source.field === 'budget.retirementSpending')).toBe(false)
    expect(funded.formula).toContainEqual(expect.objectContaining({ direction: 'subtract', value: 101_300 }))
    expect(funded.formula?.reduce((sum, term) => sum + (term.direction === 'subtract' ? -1 : 1) * (term.value ?? 0), 0)).toBe(1_020)
    expect(get('account', TFSA, 'withdrawal').cells![PURCHASE_YEAR].value).toBe(102_320)
    expect(get('netWorth').cells![PURCHASE_YEAR].value).toBeCloseTo(106_794.2652, 6)
    const purchaseDetail = detail('primaryHomePurchase', 'totalCost')
    for (const [locale, title, cost, timing, funding, base, incomeTax, transferTax] of [
      ['en', /primary residence purchase/i, /qualifying acquisition costs/i, /start of year/i, /TFSA debits/i, /nominal ACB/i, /modeled income tax/i, /transfer tax and rebates are not inferred or calculated/i],
      ['fr', /achat de résidence principale/i, /frais d’acquisition admissibles/i, /début d’année/i, /retraits CELI/i, /PBR nominal/i, /impôt sur le revenu modélisé/i, /taxes? de mutation.*remises ne sont ni présumées ni calculées/i],
      ['zh', /主要住所购入/, /合资格购置费用/, /年初/, /TFSA 扣款/, /名义 ACB/, /模型所得税/, /不推算或计算土地转让税及返还/],
    ] as const) {
      expect(annualSheetText(group.label, locale)).toMatch(title)
      expect(annualSheetText(get('primaryHomePurchase', 'qualifyingAcquisitionCosts').label, locale)).toMatch(cost)
      const summary = annualSheetText(purchaseDetail.summary!, locale)
      expect(summary).toMatch(timing)
      expect(summary).toMatch(funding)
      expect(summary).toMatch(base)
      expect(annualSheetText(get('primaryHomePurchase', 'tax').label, locale)).toMatch(incomeTax)
      expect(annualSheetText(detail('primaryHomePurchase', 'tax').summary!, locale)).toMatch(transferTax)
    }
  })

  it('documents the signed working balance reconciliation in each locale', () => {
    const { plan, evidence } = fixture(99_175, 4_221.82)
    plan.accounts[0].realReturn = 0.02
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(coverage.blocked).toBeNull()
    const sheet = canonicalAnnualSheet(coverage, CONTEXT)
    const memo = findRow(sheet.rows, canonicalSheetId('value', 'account', TFSA, 'primaryHomePurchaseReconciliation'))!
    const cell = memo.cells![BASE_YEAR]
    const correction = coverage.rows[0].byAccount[TFSA].primaryHomePurchaseReconciliation!
    expect(cell).toMatchObject({ status: 'estimated', basis: 'nominal-CAD', timing: 'closing', value: correction })
    expect(correction).toBeGreaterThan(0)
    expect(correction).toBeLessThan(0.000000001)
    const detail = sheet.resolveExplanation!(cell.explanationRefs![0])!
    expect(detail.sources).toContainEqual(expect.objectContaining({
      field: 'primaryHomePurchaseReconciliation', displayReference: String(correction),
    }))
    for (const [locale, label, signed] of [
      ['en', /purchase.*balance reconciliation/i, /signed.*closing/i],
      ['fr', /rapprochement décimal avant achat/i, /écart signé/i],
      ['zh', /购房前.*余额核对/, /带符号差额/],
    ] as const) {
      expect(annualSheetText(memo.label, locale)).toMatch(label)
      expect(annualSheetText(detail.summary!, locale)).toMatch(signed)
    }
  })

  it.each([
    ['unverified costs', { qualifyingAcquisitionCostsNominal: { status: 'unknown', reason: 'missing closing statement' } }],
    ['unverified post-purchase spending', { postPurchaseAnnualSpendingReal: { status: 'unknown', reason: 'missing budget' } }],
    ['negative costs', { qualifyingAcquisitionCostsNominal: known(-1) }],
    ['wrong price', { priceNominal: known(PRICE + 0.01) }],
    ['wrong timing', { timing: 'end-of-purchase-year' }],
    ['wrong year', { effectiveYear: 2028 }],
    ['estimated evidence', { provenance: { origin: 'estimated', sourceYear: 2026 } }],
    ['unknown cost exclusion', { excludesOneTimeCosts: undefined }],
  ])('retains the prefix with %s', (_, change) => {
    const { plan, evidence, purchase } = fixture()
    Object.assign(purchase, change)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(stopped.blocked).toMatchObject({ year: PURCHASE_YEAR, causes: ['propertyPurchase'] })
    expect(stopped.rows).toEqual(prefix.rows)
    expect(stopped.state).toEqual(prefix.state)
    expect(stopped.state.byProperty[HOME].held).toBe(false)
  })

  it.each([-1.01, Number.MAX_VALUE])('does not commit an unpriceable acquisition with appreciation %s', appreciation => {
    const { plan, evidence } = fixture()
    plan.properties[0].appreciation = appreciation
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(stopped.blocked).toMatchObject({ year: PURCHASE_YEAR })
    expect(stopped.rows).toEqual(prefix.rows)
    expect(stopped.state).toEqual(prefix.state)
  })

  it.each<[string, (plan: InputsV2) => void]>([
    ['another account', plan => { plan.accounts.push(retirementPlan({ rrsp: 10_000 }).accounts[1]) }],
    ['a financed purchase', plan => {
      plan.properties[0].plannedDownPayment = PRICE - 1_000
      plan.properties[0].plannedMortgage = { principal: 1_000, annualPayment: 200, yearsRemaining: 6 }
    }],
    ['a zero-principal stub with a nonzero payment', plan => {
      plan.properties[0].plannedMortgage = { principal: 0, annualPayment: 0.01, yearsRemaining: null }
    }],
    ['a zero-principal stub with a nonzero term', plan => {
      plan.properties[0].plannedMortgage = { principal: 0, annualPayment: null, yearsRemaining: 1 }
    }],
    ['a later property sale', plan => { plan.properties[0].sellAtAge = 60 }],
    ['a second property', plan => { plan.properties.push({ ...plan.properties[0], id: 'other-home' }) }],
    ['retirement benefit facts other than zero', plan => { plan.people[0].cppAnnualAt65 = 1_000 }],
  ])('keeps %s outside the purchase scope', (_, change) => {
    const { plan, evidence } = fixture()
    change(plan)
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(stopped.blocked).not.toBeNull()
    expect(stopped.state.primaryHomePurchase).toBeUndefined()
    expect(stopped.state.byProperty[HOME].held).toBe(false)
  })

  it('preserves the original canonical stop for an otherwise identical plan without recorded purchase evidence', () => {
    const { plan, evidence } = fixture()
    delete plan.annualPrimaryHomePurchaseEvidence
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(stopped.blocked).toMatchObject({
      year: BASE_YEAR, status: 'unsupported',
      issues: [{ code: 'unsupported', detail: 'passive home requires one wholly owned held primary residence without debt, rent, purchase or holding cost changes' }],
    })
    expect(stopped.rows).toEqual([])
    expect(stopped.state).toEqual(ok(initializeState(plan)))
    expect(stopped.uncomputedYears).toEqual([2027, 2028])
    const sheet = canonicalAnnualSheet(stopped, CONTEXT)
    expect(findRow(sheet.rows, canonicalSheetId('group', 'primaryHomePurchase'))).toBeUndefined()
    const cell = findRow(sheet.rows, canonicalSheetId('value', 'netWorth'))!.cells![BASE_YEAR]
    for (const [locale, original] of [
      ['en', 'This year requires rules or facts not yet supported. Later years were not computed.'],
      ['fr', 'Cette année nécessite des règles ou faits non pris en charge. Les années suivantes ne sont pas calculées.'],
      ['zh', '本年度需要尚未支持的规则或事实，后续年度未计算。'],
    ] as const) {
      expect(annualSheetText(cell.reason!, locale)).toBe(original)
    }
  })

  it('keeps working purchases gated even when their full cost can be paid', () => {
    const { plan, evidence } = fixture()
    plan.people[0].retirementAge = 59
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    expect(prefix.state.byAccount[TFSA].balance).toBe(103_020)
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(stopped.blocked).toMatchObject({ year: PURCHASE_YEAR, causes: ['propertyPurchase'] })
    expect(stopped.rows).toEqual(prefix.rows)
    expect(stopped.state).toEqual(prefix.state)
  })

  it('keeps provider runs, standalone retirement and unauthenticated handoffs outside purchase settlement', () => {
    const { plan, evidence } = fixture()
    expect(evaluateCanonicalWorkingYear(plan, evidence).status).toBe('unsupported')
    const atHandoff = ok(projectCanonicalCoverage(plan, evidence, 1)).state
    const acquired = ok(projectCanonicalCoverage(plan, evidence, 2)).state
    for (const opening of [atHandoff, acquired]) {
      expect(annualRetirementContinuation(plan, opening, evidence).status).toBe('invalid')
      expect(annualRetirementStep(plan, structuredClone(opening)).status).not.toBe('ok')
    }
    const standalone = structuredClone(plan)
    Object.assign(standalone.people[0], { retirementAge: 57, earnedIncome: known(0) })
    expect(annualRetirementStep(standalone, ok(initializeState(standalone))).status).toBe('unsupported')
    expect(projectCanonicalCoverage(standalone, evidence, 3).status).toBe('unsupported')
    expect(projectCanonicalCoverage({ ...plan, province: 'BC' }, evidence, 3).status).toBe('unsupported')

    const providerPlan: InputsV2 = { ...plan, people: [{ ...plan.people[0], retirementAge: 59 }],
      budget: { kind: 'savingsBudget', annualNetSavings: 0, retirementSpending: 8_000,
        debtIncluded: known(true), taxBenefitIncluded: known(true) } }
    const providers = {
      evaluate: () => ({ byPerson: { [RETIREE]: { income: 0, earnedIncome: 0, benefits: 0,
        tax: 0, spending: 0, taxableIncome: 0, benefitIncomeForNextYear: known(0) } } }),
      returns: fixedReturnProvider,
    }
    const opening = ok(initializeState(providerPlan))
    const prefix = ok(projectAnnualCoverage(providerPlan, opening, 1, providers))
    expect(prefix.blocked).toBeNull()
    expect(ok(projectAnnualCoverage(providerPlan, opening, 3, providers))).toMatchObject({
      rows: prefix.rows, state: prefix.state, evaluationBasis: 'provider-supplied',
      blocked: { year: PURCHASE_YEAR, status: 'unsupported', causes: ['propertyPurchase'] },
    })
  })

  it('preserves the legacy projection and S1 annual sheet including a separate legacy purchase', () => {
    const { plan } = fixture()
    const inputs = legacyRetirement({ currentAge: 57, fireAge: 58, lifeExpectancy: 60, inflation: 0.02,
      balances: { tfsa: 130_000, rrsp: 0, nonReg: 0 }, retirementSpending: 8_000,
      principalResidence: { mode: 'planned', buyAtAge: 58, price: PRICE, downPayment: PRICE,
        appreciation: 0.04, netHoldingCostChange: 0, sellAtAge: null } })
    plan.legacyProjection = inputs
    const baseline = structuredClone(plan)
    delete baseline.annualPrimaryHomePurchaseEvidence
    const reference = runProjection(inputs, undefined, baseline, { captureAnnualDetails: true })
    const observed = runProjection(inputs, undefined, plan, { captureAnnualDetails: true })
    expect(reference.rows[1].purchaseFunding).toBeDefined()
    expect(observed).toEqual(reference)
    expect(legacyAnnualSheet(observed, inputs, CONTEXT).rows).toEqual(legacyAnnualSheet(reference, inputs, CONTEXT).rows)
    expect(runProjection(inputs, () => -0.1, plan)).toEqual(runProjection(inputs, () => -0.1, baseline))
  })
})
