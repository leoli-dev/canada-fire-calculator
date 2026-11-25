import { describe, expect, it } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetModel, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { projectCanonicalCoverage, sumNetWorth, type KernelResult } from '../annualState'
import { runProjection } from '../projection'
import {
  integratedEstateControlExpected, integratedEstateControlFixture, integratedEstateControlScenarioId,
  integratedHouseholdExpected, integratedHouseholdFixture, integratedHouseholdIds, integratedHouseholdScenarioId,
  integratedHouseholdVariant,
} from './fixtures/annualIntegratedHousehold'
import { known } from './fixtures/retirementSettlement'

const { self, partner, tfsa, home, debt } = integratedHouseholdIds
const context = { scenarioId: integratedHouseholdScenarioId, revision: 1 }
const near = (value: number) => expect.closeTo(value, 7)

// The S0 benchmark in src/__tests__/fixtures/annualProjectionHousehold.ts
// starts in 2030 and assumes separate TFSA/RRSP contributions, gains and
// direct RRSP tax debits alongside fixed principal plus declining interest,
// staggered pensions and an unpaid portion of a roof repair. The continuous
// runner requires the 2026 anchor, rejects scheduled registered contributions
// and employer pensions, and the held-home mortgage requires a fixed total
// payment, one funded ordinary TFSA and explicitly zero public benefits.
// There is no canonical partial repair receipt or year-specific repair budget.
// The estate passport excludes a retained home or mortgage and a sold home's
// plan or cash metadata. The separate control prices the supported self-only
// endpoint, with the companion's accounts outside that estate.

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function flatten(rows: AnnualSheetRow[]): AnnualSheetRow[] {
  return rows.flatMap(row => [row, ...flatten(row.children ?? [])])
}

function cell(sheet: AnnualSheetModel, year: number, ...path: string[]) {
  const id = canonicalSheetId(...path)
  const found = flatten(sheet.rows).find(row => row.id === id)?.cells?.[year]
  if (!found) throw new Error(`Missing ${id} for ${year}`)
  return found
}

function explanation(sheet: AnnualSheetModel, year: number, ...path: string[]) {
  const ref = cell(sheet, year, ...path).explanationRefs?.[0]
  const answer = ref && sheet.resolveExplanation?.(ref)
  if (!answer) throw new Error(`Missing explanation for ${path.join('/')} in ${year}`)
  return answer
}

describe('FE-53 S2 integrated canonical household', () => {
  it('settles both work transitions, releases equity once, and uses it before owner withdrawals', () => {
    const { plan, evidence, years } = integratedHouseholdFixture()
    const before = structuredClone({ plan, evidence })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, years))
    expect(coverage).toMatchObject({
      terminalYear: 2031, blocked: null, uncomputedYears: [],
      evaluationBasis: 'canonical-continuous', overallConclusionAvailable: false,
    })
    expect(coverage.rows.map(row => row.year)).toEqual([2026, 2027, 2028, 2029, 2030, 2031])

    // The zero-income-tax wages incur 5.95% CPP over $3,500 and 1.63% EI.
    const payroll = (12_000 - 3_500) * 0.0595 + 12_000 * 0.0163
    const saleNet = 12_500
    const afterPayoff = saleNet - 1_210
    const annualLiving = 5_500
    // Two installments of $1,331 imply $331 and $231 interest at 10%.
    // The sale discharges the remaining $1,210 before a third installment.
    const phases = ['both-working', 'mixed', 'both-retired', 'both-retired', 'both-retired', 'both-retired']
    const mortgages = [
      [3_310, 331, 1_000, 1_331, 2_310],
      [2_310, 231, 1_100, 1_331, 1_210],
      [1_210, 0, 1_210, 1_210, 0],
      [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0],
    ]
    let accountOpening = 8_500
    let openingSaleCash = 0
    const sheet = canonicalAnnualSheet(coverage, context)
    for (const [index, row] of coverage.rows.entries()) {
      const year = 2026 + index
      const workingPeople = Math.max(0, 2 - index)
      const [opening, interest, principal, payment, closing] = mortgages[index]
      const scheduled = index < 2 ? payment : 0
      const livingDue = index < 2 ? workingPeople * (12_000 - payroll) - scheduled : annualLiving
      const proceedsAdded = index === 2 ? afterPayoff : 0
      const spendingUsed = Math.min(livingDue, openingSaleCash + proceedsAdded)
      const withdrawal = index < 2 ? 0 : Math.min(accountOpening, livingDue - spendingUsed)
      const livingFunded = index < 2 ? livingDue : spendingUsed + withdrawal
      const cashClosing = openingSaleCash + proceedsAdded - spendingUsed
      const accountClosing = accountOpening - withdrawal
      const held = index < 2
      const netWorth = accountClosing + cashClosing + (held ? 12_500 : 0) - closing

      expect(integratedHouseholdExpected.years[index]).toMatchObject({
        year, netWorth, spending: near(livingFunded), livingGap: livingDue - livingFunded,
        tfsaClosing: accountClosing, saleCashClosing: cashClosing, debtClosing: closing,
      })
      expect(row.workingSettlement).toMatchObject({ household: { phase: phases[index] } })
      expect(Object.keys(row.byPerson).sort()).toEqual([self, partner].sort())
      expect(Object.keys(row.byAccount)).toEqual([tfsa])
      expect(Object.keys(row.byProperty)).toEqual([home])
      expect(Object.keys(row.byDebt)).toEqual([debt])
      expect(row.byPerson[self]).toMatchObject({ age: 57 + index, earnedIncome: index === 0 ? 12_000 : 0, tax: 0 })
      expect(row.byPerson[partner]).toMatchObject({ age: 55 + index, earnedIncome: index < 2 ? 12_000 : 0, tax: 0 })
      expect(row.payrollContributions).toBeCloseTo(workingPeople * payroll, 7)
      expect(row.cashLedger).toMatchObject({
        income: workingPeople * 12_000, benefits: 0, tax: 0, debtPayments: scheduled,
        spending: near(livingFunded), unallocated: near(0),
      })
      expect(row.byDebt[debt]).toMatchObject({
        opening: near(opening), interest: near(interest), principal: near(principal), payment: near(payment), closing: near(closing),
      })
      expect(row.byDebt[debt].salePayoff).toBe(index === 2 ? 1_210 : undefined)
      expect(row.byProperty[home]).toMatchObject({ held, closing: held ? 12_500 : 0, growth: 0 })
      expect(row.byAccount[tfsa]).toMatchObject({
        ownerId: self, opening: accountOpening, contribution: 0, withdrawal, returnAmount: 0,
        closing: accountClosing,
      })
      if (index === 2) {
        expect(row.retirementSettlement?.primaryHomeSale).toMatchObject({
          propertyId: home, grossProceeds: saleNet, sellingCosts: 0, netProceeds: saleNet, taxableGain: 0,
          acb: 900.25, realizedGain: 11_599.75,
          mortgagePayoff: { debtId: debt, totalPayoff: 1_210, residualCash: afterPayoff },
        })
      } else {
        expect(row.retirementSettlement?.primaryHomeSale).toBeUndefined()
      }
      if (index >= 2) {
        expect(row.retirementSettlement?.primaryHomeSaleCash).toEqual({
          opening: openingSaleCash, proceedsAdded, spendingUsed, closing: cashClosing,
        })
        expect(row.retirementSettlement).toMatchObject({
          spendingDue: livingDue, spendingFunded: livingFunded, spendingUnmet: livingDue - livingFunded,
        })
      }
      expect(cell(sheet, year, 'value', 'netWorth').value).toBeCloseTo(netWorth, 7)
      accountOpening = accountClosing
      openingSaleCash = cashClosing
    }
    expect(sumNetWorth(coverage.state)).toBe(0)
    expect(coverage.state.byDebt[debt]).toMatchObject({ principal: 0, yearsRemaining: 0 })
    expect(coverage.state.tfsaWithdrawalHistory).toEqual([
      { id: `annual:2030:withdrawal:${tfsa}`, personId: self, calendarYear: 2030, amount: 5_210 },
      { id: `annual:2031:withdrawal:${tfsa}`, personId: self, calendarYear: 2031, amount: 3_290 },
    ])
    expect(coverage.rows[5].terminalEstateEstimate).toMatchObject({ status: 'unavailable', reason: 'unsupported-estate' })
    const gap = sheet.years.find(({ year }) => (cell(sheet, year, 'value', 'retirement', 'spendingUnmet').value ?? 0) > 0)
    expect(gap?.year).toBe(integratedHouseholdExpected.firstLivingGap.year)
    expect(cell(sheet, 2031, 'value', 'retirement', 'spendingUnmet')).toMatchObject({
      status: 'estimated', value: integratedHouseholdExpected.firstLivingGap.amount,
    })
    expect(cell(sheet, 2031, 'value', 'netWorth')).toMatchObject({ status: 'estimated', value: 0 })
    const estate = cell(sheet, 2031, 'value', 'estate')
    expect(estate).toMatchObject({ status: 'unknown', value: null })
    expect(new Set(['en', 'fr', 'zh'].map(locale => annualSheetText(estate.reason!, locale))).size).toBe(3)
    expect(cell(sheet, 2030, 'value', 'estate')).toMatchObject({ status: 'not-applicable', value: null })
    expect({ plan, evidence }).toStrictEqual(before)
  })

  it('keeps unique sheet entities and connects the living draw to the sale cash and account', () => {
    const { plan, evidence, years } = integratedHouseholdFixture()
    const sheet = canonicalAnnualSheet(ok(projectCanonicalCoverage(plan, evidence, years)), context)
    const rows = flatten(sheet.rows)
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
    for (const [kind, id] of [['person', self], ['person', partner], ['account', tfsa], ['property', home], ['debt', debt]]) {
      const matches = rows.filter(row => row.id === canonicalSheetId('group', kind, id))
      expect(matches).toHaveLength(1)
      expect(matches[0].entity).toEqual({ kind, id })
    }
    const funding = explanation(sheet, 2030, 'value', 'retirement', 'spendingFunded')
    const withdrawalId = `annual:2030:withdrawal:${tfsa}`
    const cashField = 'retirementSettlement.primaryHomeSaleCash.spendingUsed'
    expect(funding.formula?.filter(term => term.field === cashField || term.field === 'withdrawal' || term.field === 'debtPayments'))
      .toMatchObject([
        { field: cashField, direction: 'add', value: 290 },
        { field: 'withdrawal', sourceId: withdrawalId, direction: 'add', value: 5_210 },
      ])
    expect(funding.sources?.filter(source => source.id === withdrawalId)).toMatchObject([
      { field: 'withdrawal', granularity: 'event' },
    ])
    expect(funding.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'annualPrimaryHomeSaleEvidence.allSaleCashAvailableForJointSpending', granularity: 'input' }),
      expect.objectContaining({ field: 'annualPrimaryHomeSaleEvidence.postSaleAnnualSpendingReal', granularity: 'input' }),
    ]))
    const payoff = explanation(sheet, 2028, 'value', 'primaryHomeSale', 'residualCash')
    expect(payoff.formula).toMatchObject([
      { field: 'netProceeds', direction: 'add', value: 12_500 },
      { field: 'mortgagePayoff.totalPayoff', direction: 'subtract', value: 1_210 },
    ])
    expect(payoff.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'annualPrimaryHomeSaleEvidence.mortgagePayoff', granularity: 'input' }),
    ]))
  })

  it('uses start CPI for flows and end CPI for closing balances, while retaining nominal tax basis', () => {
    const { plan, evidence } = integratedHouseholdFixture()
    plan.inflation = 0.02
    evidence.transitionSpending = known(10_000)
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(coverage.blocked).toBeNull()
    const sheet = canonicalAnnualSheet(coverage, context)
    const startCpi = 1.02 ** 2
    const gross = 12_500 * startCpi
    const living = 5_500 * startCpi
    const closingCash = gross - 1_210 - living
    for (const [path, nominal, real] of [
      [['value', 'primaryHomeSale', 'grossProceeds'], gross, 12_500],
      [['value', 'primaryHomeSale', 'acb'], 900.25, 900.25],
      [['value', 'debt', debt, 'payment'], 1_210, 1_210 / startCpi],
      [['value', 'primaryHomeSaleCash', 'spendingUsed'], living, 5_500],
      [['value', 'primaryHomeSaleCash', 'closing'], closingCash, closingCash / 1.02 ** 3],
    ] as const) {
      const item = cell(sheet, 2028, ...path)
      expect(annualSheetDisplayValue(item, sheet.years[2], 'nominal')).toBeCloseTo(nominal, 7)
      expect(annualSheetDisplayValue(item, sheet.years[2], 'real')).toBeCloseTo(real, 7)
    }
  })

  // S0's 2033 repair had a partial payment and a settled event gap after
  // pensions resumed. This sale analogue stops atomically at the reached
  // event. Its financing deficit is an input calculation, with no receipt.
  it.each([
    ['missing-sale-payoff', /requires explicit matching user start-of-sale-year payoff terms/],
    ['event-financing-gap', /net sale proceeds cannot cover opening mortgage principal/],
    ['missing-owner-statement', /TFSA withdrawal statement evidence missing/],
  ] as const)('preserves the committed prefix for %s', (kind, reason) => {
    const { plan, evidence, years, expectedFailure } = integratedHouseholdVariant(kind)
    const before = structuredClone({ plan, evidence })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, years))
    const prefix = ok(projectCanonicalCoverage(plan, evidence, expectedFailure.settledYears.length))
    expect(coverage.rows.map(row => row.year)).toEqual(expectedFailure.settledYears)
    expect(coverage.rows).toStrictEqual(prefix.rows)
    expect(coverage.state).toStrictEqual(prefix.state)
    expect(coverage.blocked).toMatchObject({
      year: expectedFailure.year, status: expectedFailure.status, causes: [expectedFailure.cause],
      issues: [expect.objectContaining({ detail: expect.stringMatching(reason) })],
    })
    expect(coverage.uncomputedYears).toEqual(expectedFailure.uncomputedYears)
    expect({ plan, evidence }).toStrictEqual(before)
    if (kind === 'event-financing-gap') {
      // $500 after fees gives a positive gain on $400 ACB, but falls $710 short of the lien.
      expect(expectedFailure.arithmeticFinancingDeficit).toBe(1_210 - (12_500 - 12_000))
      expect(coverage.state).toMatchObject({ byProperty: { [home]: { held: true } }, byAccount: { [tfsa]: { balance: 8_500 } } })
      expect(coverage.state.primaryHomeSaleCash).toBeUndefined()
      expect(coverage.state.tfsaWithdrawalHistory).toEqual([])
      expect(coverage.state.unfundedEvents).toEqual([])
    }
    const sheet = canonicalAnnualSheet(coverage, context)
    for (const year of [expectedFailure.year, ...expectedFailure.uncomputedYears]) {
      const yearColumn = sheet.years[year - 2026]
      for (const path of [
        ['value', 'netWorth'], ['value', 'debt', debt, 'payment'],
        ['value', 'account', tfsa, 'withdrawal'], ['value', 'retirement', 'spendingUnmet'], ['value', 'estate'],
      ]) {
        const item = cell(sheet, year, ...path)
        expect(item).toMatchObject({ status: 'not-computed', value: null })
        expect(annualSheetDisplayValue(item, yearColumn, 'nominal')).toBeNull()
        expect(annualSheetDisplayValue(item, yearColumn, 'real')).toBeNull()
        expect(explanation(sheet, year, ...path).sources?.[0].code)
          .toBe(year === expectedFailure.year ? expectedFailure.cause : 'suffix')
      }
    }
    if (kind !== 'missing-owner-statement') {
      const stop = cell(sheet, 2028, 'value', 'netWorth').reason!
      const suffix = cell(sheet, 2029, 'value', 'netWorth').reason!
      for (const [locale, stopCopy, suffixCopy] of [
        ['en', /without settlement|no .*posted|not computed/i, /after the first blocked year/i],
        ['fr', /sans règlement|comptabilisé|ne sont pas calculées/i, /après la première année bloquée/i],
        ['zh', /不结算|未记录|未计算/, /首个受阻年度之后/],
      ] as const) {
        expect(annualSheetText(stop, locale)).toMatch(stopCopy)
        expect(annualSheetText(suffix, locale)).toMatch(suffixCopy)
        expect(annualSheetText(explanation(sheet, 2028, 'value', 'netWorth').summary!, locale)).toBe(annualSheetText(stop, locale))
      }
    }
  })

  // S0 used positive TFSA and RRSP balances for both owners, scheduled
  // contributions, and staggered pensions in the same mortgaged household.
  // In this chain even the opening portfolio and nonzero public benefits
  // independently fail mortgage admission. Separately modeled debt-free
  // CPP/OAS cases do not admit the original pension schedule.
  it.each([
    ['s0-owner-accounts', /single funded TFSA/],
    ['s0-public-benefits', /explicit zero public benefits/],
  ] as const)('exposes the held-mortgage admission boundary for %s', (kind, reason) => {
    const { plan, evidence, years, expectedFailure } = integratedHouseholdVariant(kind)
    const coverage = ok(projectCanonicalCoverage(plan, evidence, years))
    expect(coverage.rows).toEqual([])
    expect(coverage.state.year).toBe(2026)
    expect(coverage.blocked).toMatchObject({
      year: 2026, status: 'unsupported', causes: ['unsupported'],
      issues: [expect.objectContaining({ detail: expect.stringMatching(reason) })],
    })
    expect(coverage.uncomputedYears).toEqual(expectedFailure.uncomputedYears)
  })

  it('prices a separate eligible self estate and excludes the surviving companion', () => {
    const { plan, evidence, years } = integratedEstateControlFixture()
    const coverage = ok(projectCanonicalCoverage(plan, evidence, years))
    expect(coverage).toMatchObject({ blocked: null, overallConclusionAvailable: false, terminalYear: 2031 })
    expect(coverage.rows).toHaveLength(6)
    const { year, ...estimate } = integratedEstateControlExpected
    const closing = 60_000
    const survivor = 90_000
    const fees = Math.ceil((closing - 50_000) / 1_000) * 15
    expect(estimate).toMatchObject({ closingNetWorth: closing, excludedSurvivorClosingNetWorth: survivor,
      householdClosingNetWorth: closing + survivor, incrementalFinalReturnIncomeTax: 0,
      estateAdministrationTax: fees, netEstate: closing - fees })
    expect(coverage.rows[5]).toMatchObject({ year, terminalEstateEstimate: {
      status: 'estimated', scope: 'self-estate-only', personId: self, survivingPersonId: partner, ...estimate,
    } })
    expect(sumNetWorth(coverage.state)).toBe(closing + survivor)
    const sheet = canonicalAnnualSheet(coverage, { ...context, scenarioId: integratedEstateControlScenarioId })
    expect(cell(sheet, year, 'value', 'estate')).toMatchObject({ status: 'estimated', value: 59_850 })
    expect(cell(sheet, year, 'value', 'netWorth').value).toBe(150_000)
    expect(explanation(sheet, year, 'value', 'estate').formula).toMatchObject([
      { field: 'terminalEstateEstimate.closingNetWorth', value: 60_000, direction: 'add' },
      { field: 'terminalEstateEstimate.incrementalFinalReturnIncomeTax', value: 0, direction: 'subtract' },
      { field: 'terminalEstateEstimate.estateAdministrationTax', value: 150, direction: 'subtract' },
    ])
  })

  it('preserves traced and ordinary legacy results when canonical evidence is attached', () => {
    const { plan } = integratedHouseholdFixture()
    const control = structuredClone(plan)
    delete control.annualPrimaryHomeSaleEvidence
    delete control.annualTerminalEstateEvidence
    const inputs = { ...plan.legacyProjection, principalResidence: {
      value: 12_500, appreciation: 0, sellAtAge: 59,
      mortgage: { balance: 3_310, annualPayment: 1_331, yearsRemaining: 3 },
    } }
    // App builds its dialog from the traced legacy result and the legacy adapter.
    const traced = runProjection(inputs, undefined, plan, { captureAnnualDetails: true })
    const tracedControl = runProjection(inputs, undefined, control, { captureAnnualDetails: true })
    expect(traced.rows.length).toBeGreaterThan(0)
    expect(traced).toStrictEqual(tracedControl)
    expect(legacyAnnualSheet(traced, inputs, context).rows)
      .toStrictEqual(legacyAnnualSheet(tracedControl, inputs, context).rows)
    const rows = traced.rows.map(({ annualDetails: _details, ...row }) => row)
    expect({ ...traced, rows }).toStrictEqual(runProjection(inputs, undefined, plan))
  })
})
