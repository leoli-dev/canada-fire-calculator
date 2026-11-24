import { describe, expect, it, vi } from 'vitest'
import { annualSheetText, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { annualCpp } from '../annualCpp'
import { annualGeneratedRetirementOas, annualHouseholdOas, annualOas } from '../annualOas'
import { annualRetirementContinuation, annualRetirementStep } from '../annualRetirement'
import { initializeState, projectAnnualCoverage, projectCanonicalCoverage, type KernelResult, type YearRow } from '../annualState'
import { runProjection } from '../projection'
import { cppStart } from './fixtures/annualCpp'
import { known, recorded, RETIREE, retirementPlan, RRSP, TFSA } from './fixtures/retirementSettlement'
import { PARTNER, staggeredHouseholdPlan } from './fixtures/staggeredHousehold'

// ESDC age-70 claim adjustments. $12,000 CPP and $9,150 OAS are recorded
// age-65 annual amounts. Today's basis is projected with a flat 2% scenario CPI.
// https://www.canada.ca/en/services/benefits/publicpensions/cpp/when-start.html
// https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/when-start.html
const cppAt65 = 12_000
const oasAt65 = 9_150
const cpp = 17_040
const grossOas = 12_444
const oasId = 'recorded-owner-oas'
const inflation = 0.02
const cpiAt = (age: number) => (1 + inflation) ** (age - 69)
const close = (value: number) => expect.closeTo(value, 5)
// Prescribed factors for an ordinary RRIF at January 1 ages 71, 72 and 73.
// https://laws-lois.justice.gc.ca/eng/regulations/c.r.c.,_c._945/section-7308.html
const floorFactors = [0.0528, 0.054, 0.0553]

function ok<T>(value: KernelResult<T>): T {
  if (value.status !== 'ok') throw new Error(JSON.stringify(value))
  return value.value
}

// Independent worksheets for the selected 2026 Ontario income bands.
// The engine's pinned estimate omits the Ontario low-income reduction. Only
// the pre-rollover, pension-only comparison below falls into that range.
// https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/current-income-tax-rates.html
// https://www.canada.ca/en/revenue-agency/services/forms-publications/td1-personal-tax-credits-returns/td1-forms-pay-received-on-january-1-later.html
// https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-31400-pension-income-amount.html
const positive = (n: number) => Math.max(n, 0)
const band = (income: number, lower: number, upper: number) => positive(Math.min(income, upper) - lower)

function quote(draw: number, rrif = false, gross = grossOas) {
  // ESDC 2026 estimated threshold and CRA lines 23500/42200.
  // https://www.canada.ca/en/employment-social-development/programs/pensions/pension/statistics/2026-quarterly-april-june.html
  // https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-23500-social-benefits-repayment.html
  const recoveryIncome = cpp + gross + draw
  const recovery = Math.min(gross, 0.15 * positive(recoveryIncome - 95_323))
  const netOas = gross - recovery
  const taxable = cpp + netOas + draw
  const fedAge = positive(9_208 - 0.15 * positive(taxable - 46_432))
  const onAge = positive(6_342 - 0.15 * positive(taxable - 47_210))
  const fedPension = rrif ? 2_000 : 0
  const onPension = rrif ? 1_796 : 0
  const federal = positive((Math.min(taxable, 58_523) - 16_452 - fedAge - fedPension) * 0.14
    + band(taxable, 58_523, 117_045) * 0.205 + positive(taxable - 117_045) * 0.26)
  const ontario = positive((Math.min(taxable, 53_891) - 12_989 - onAge - onPension) * 0.0505
    + band(taxable, 53_891, 107_785) * 0.0915 + band(taxable, 107_785, 150_000) * 0.1116
    + positive(taxable - 150_000) * 0.1216)
  const surtax = 0.20 * positive(ontario - 5_818) + 0.36 * positive(ontario - 7_446)
  const premium = taxable < 36_000 ? Math.min(300, 0.06 * positive(taxable - 20_000))
    : taxable < 72_000 ? Math.min(600, 450 + 0.25 * positive(taxable - 48_000))
      : Math.min(750, 600 + 0.25 * (taxable - 72_000))
  const tax = federal + ontario + surtax + premium
  return { recoveryIncome, recovery, netOas, taxable, tax, cash: taxable - tax }
}

function exclusions() {
  return {
    gis: { status: 'excluded' as const, reason: 'No GIS modeled', provenance: recorded },
    allowance: { status: 'not-applicable' as const, reason: 'Solo owner', provenance: recorded },
    otherBenefits: { status: 'excluded' as const, reason: 'No other receipts modeled', provenance: recorded },
  }
}

function scenario(spending = 60_000, tfsa = 500_000, rrsp = 1_200_000) {
  const plan = retirementPlan({ age: 69, inflation, tfsa, rrsp, spending, strategy: 'tfsaFirst' })
  const owner = plan.people[0]
  Object.assign(owner, { retirementAge: 70, cppAnnualAt65: cppAt65, oasAnnualAt65: oasAt65 })
  plan.lifeExpectancy = 76
  plan.budget = { kind: 'incomeBudget', workingSpending: 0, retirementSpending: spending }
  plan.annualBenefitsEvidence = { [RETIREE]: exclusions() }
  plan.incomeSources = [
    cppStart(RETIREE, 70, cppAt65),
    { id: oasId, kind: 'oas', recipientId: RETIREE, startAge: 70, annualAmount: known(oasAt65), provenance: recorded },
  ]
  return { plan, evidence: { workingSpending: known(0), retirementSpending: known(spending) } }
}

function assertSettlement(row: YearRow, age: number, draw: number, tfsa: number, spending: number, gross = grossOas) {
  const cpi = cpiAt(age)
  const expected = quote(draw, age >= 72, gross)
  expect(row).toMatchObject({
    year: 2026 + age - 69,
    cashLedger: {
      income: close(cpp * cpi), benefits: close(expected.netOas * cpi), tax: close(expected.tax * cpi),
      spending: close(spending * cpi), unallocated: close(0),
    },
    byPerson: { [RETIREE]: {
      age, cpp: close(cpp * cpi), oasGross: close(gross * cpi), oasRecovery: close(expected.recovery * cpi),
      oasNet: close(expected.netOas * cpi), earnedIncome: 0,
    } },
    taxLedger: { [RETIREE]: { taxableIncome: close(expected.taxable * cpi), tax: close(expected.tax * cpi) } },
    retirementSettlement: {
      startCpi: close(cpi), spendingFunded: close(spending * cpi), spendingUnmet: close(0),
      cpp: { status: 'paying', startAge: 70, sourceYear: 2026, ageBasis: 65, amountReal: close(cpp) },
      oas: {
        grossReal: close(gross), netReal: close(expected.netOas), recoveryReal: close(expected.recovery),
        recoveryIncomeReal: close(expected.recoveryIncome), sourceId: oasId, startAge: 70, ageBasis: 65,
      },
    },
    byAccount: { [RRSP]: { ownerId: RETIREE, withdrawal: close(draw * cpi) }, [TFSA]: { withdrawal: close(tfsa * cpi) } },
  })
  expect(row.retirementSettlement?.gis).toBeUndefined()
  const cash = row.cashLedger
  expect(cash.income + cash.benefits + row.byAccount[RRSP].withdrawal + row.byAccount[TFSA].withdrawal - cash.tax)
    .toBeCloseTo(spending * cpi, 5)
}

function findRow(rows: AnnualSheetRow[], id: string): AnnualSheetRow | undefined {
  for (const row of rows) {
    if (row.id === id) return row
    const child = findRow(row.children ?? [], id)
    if (child) return child
  }
}

describe('independent Ontario RRIF with public benefits', () => {
  it.each([
    { label: 'partial', age71Draw: 80_000, age71Recovery: 2_124.15 },
    { label: 'full', age71Draw: 160_000, age71Recovery: 12_444 },
  ])('settles $label recovery on the RRSP and RRIF and preserves the age-74 close', ({ age71Draw, age71Recovery }) => {
    const spending = quote(age71Draw).cash
    expect(quote(age71Draw).recovery).toBeCloseTo(age71Recovery, 8)
    // At 70 the TFSA supplies all cash above CPP/OAS. At 71 it is empty.
    const at70Tfsa = spending - quote(0).cash
    const { plan, evidence } = scenario(spending, at70Tfsa)
    const input = structuredClone({ plan, evidence })
    const through74 = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(through74.blocked).toBeNull()
    const [working, claim, rollover, ...rrifYears] = through74.rows
    expect(working.cashLedger).toMatchObject({ income: 0, benefits: 0 })
    assertSettlement(claim, 70, 0, at70Tfsa, spending)
    expect(claim.retirementSettlement?.rrif).toBeUndefined()
    assertSettlement(rollover, 71, age71Draw, 0, spending)
    const rolloverAmount = (1_200_000 - age71Draw) * cpiAt(72)
    const conversion = { year: 2028, ownerId: RETIREE, amount: close(rolloverAmount), ageBasis: 'owner', factorCategory: 'allOther' }
    expect(rollover.retirementSettlement?.rrif).toMatchObject({
      accountId: RRSP, conversion, minimum: 0, factor: 0, incomeKind: 'rrspWithdrawal', discretionary: close(age71Draw * cpiAt(71)),
    })
    expect(rollover.byAccount[RRSP]).toMatchObject({ openingKind: 'rrsp', closingKind: 'rrif', contribution: 0, closing: close(rolloverAmount) })

    // Pension amounts reduce ordinary tax. In each vector the RRIF cash
    // equation is linear between the two known draws in the same bands.
    const high = quote(age71Draw, true).cash
    const low = quote(age71Draw - 1_000, true).cash
    expect(high).toBeGreaterThan(spending)
    expect(low).toBeLessThan(spending)
    const draw = age71Draw - 1_000 * (high - spending) / (high - low)
    let openingReal = 1_200_000 - age71Draw
    for (const [index, row] of rrifYears.entries()) {
      // CRA uses January 1 age. These calendar years reach ages 72, 73, 74.
      // https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/completing-slips-summaries/t4rsp-t4rif-information-returns/payments/minimum-amount-a-rrif.html
      const age = 72 + index
      const cpi = cpiAt(age)
      const factor = floorFactors[index]
      const minimumReal = openingReal * factor
      expect(draw).toBeGreaterThan(minimumReal)
      assertSettlement(row, age, draw, 0, spending)
      expect(row.retirementSettlement?.rrif).toMatchObject({
        accountId: RRSP, conversion, ageAtYearStart: age - 1, factor, minimum: close(minimumReal * cpi),
        withdrawal: close(draw * cpi), discretionary: close((draw - minimumReal) * cpi), incomeKind: 'rrifWithdrawal',
      })
      expect(row.byAccount[RRSP]).toMatchObject({
        openingKind: 'rrif', closingKind: 'rrif', opening: close(openingReal * cpi),
        closing: close((openingReal - draw) * cpiAt(age + 1)),
      })
      openingReal -= draw
    }
    expect(through74.state.benefitIncomeLag[RETIREE]).toMatchObject(known(close((draw + cpp) * cpiAt(74))))
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 8))
    expect(stopped).toMatchObject({
      rows: through74.rows, state: through74.state, uncomputedYears: [2033], overallConclusionAvailable: false,
      blocked: { year: 2032, status: 'unsupported', issues: [{ detail: expect.stringMatching(/75.*monthly/i) }] },
    })
    expect({ plan, evidence }).toEqual(input)
    const sheet = canonicalAnnualSheet(stopped, { scenarioId: 'rrif-public-benefits', revision: 1 })
    const taxCells = findRow(sheet.rows, canonicalSheetId('value', 'cash', 'tax'))!.cells!
    expect(taxCells[2031].value).toBeCloseTo(quote(draw, true).tax * cpiAt(74), 5)
    expect(taxCells[2032]).toMatchObject({ value: null, status: 'not-computed' })
    expect(annualSheetText(taxCells[2032].reason!, 'en')).toMatch(/75.*10%.*month/i)
    expect(taxCells[2033]).toMatchObject({ value: null, status: 'not-computed' })
  })

  it('uses the RRIF minimum, then exhausts TFSA, then gross-ups discretionary RRIF with no recovery', () => {
    const draw = 40_000
    const tfsa = 3_000
    const spending = quote(draw, true).cash + tfsa
    const preRrifTfsa = spending - quote(0).cash
    const { plan, evidence } = scenario(spending, 2 * preRrifTfsa + tfsa, 600_000)
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.blocked).toBeNull()
    assertSettlement(result.rows[1], 70, 0, preRrifTfsa, spending)
    assertSettlement(result.rows[2], 71, 0, preRrifTfsa, spending)
    const row = result.rows[3]
    assertSettlement(row, 72, draw, tfsa, spending)
    expect(row.retirementSettlement?.rrif).toMatchObject({
      minimum: close(31_680 * cpiAt(72)), discretionary: close(8_320 * cpiAt(72)),
    })
    expect(row.byAccount[TFSA].closing).toBe(0)
  })

  it('posts zero recovery at the exact threshold with mandatory RRIF cash before TFSA', () => {
    const draw = 95_323 - cpp - grossOas
    const spending = quote(draw, true).cash + 5_000
    const { plan, evidence } = scenario(spending, 250_000, draw / 0.0528)
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.blocked).toBeNull()
    const row = result.rows[3]
    assertSettlement(row, 72, draw, 5_000, spending)
    expect(row.retirementSettlement?.rrif).toMatchObject({ minimum: close(draw * cpiAt(72)), discretionary: close(0) })
    expect(row.byAccount[TFSA].closing).toBeGreaterThan(0)
  })

  it('uses documented age-70 statement amounts without another deferral adjustment', () => {
    const { plan, evidence } = scenario()
    const owner = plan.people[0]
    Object.assign(owner, { cppAnnualAt65: cpp, oasAnnualAt65: grossOas })
    for (const [source, kind, amount] of [[owner.cppAmountSource!, 'cpp', cpp], [owner.oasAmountSource!, 'oas', grossOas]] as const) {
      Object.assign(source, { source: 'statement', ageBasis: 70, premises: { retirementAge: 70 } })
      plan.incomeSources.find(income => income.kind === kind)!.annualAmount = known(amount)
    }
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    expect(result.rows[1].retirementSettlement).toMatchObject({
      cpp: { amountReal: cpp, ageBasis: 70, source: 'statement' },
      oas: { grossReal: grossOas, ageBasis: 70, source: 'statement' },
    })
  })
})

function upliftDate(firstUpliftYear = 2032, firstUpliftMonth = 7) {
  return { firstUpliftYear, firstUpliftMonth, provenance: { ...recorded, sourceYear: 2025 } }
}

describe('independent age-75 OAS month weighting', () => {
  // A recorded 20/40 pension of $4,200 at 65 becomes $5,712 at 70.
  // Justice Laws sections 3(3), 7(5), and 7.1(2)/(6) apply the 10%
  // increment to the pension after partial entitlement and deferral.
  // https://laws-lois.justice.gc.ca/eng/acts/O-9/page-1.html
  // https://laws-lois.justice.gc.ca/eng/acts/O-9/section-7.html
  // https://laws-lois.justice.gc.ca/eng/acts/O-9/section-7.1.html
  it.each([
    { month: 2, year: 2032, months: 11, gross: 6_235.60 },
    { month: 7, year: 2032, months: 6, gross: 5_997.60 },
    { month: 12, year: 2032, months: 1, gross: 5_759.60 },
    { month: 1, year: 2033, months: 0, gross: 5_712 },
  ])('settles an effective date of $year/$month using $months increased months', ({ year, month, months, gross }) => {
    const { plan, evidence } = scenario(60_000, 500_000, 600_000)
    plan.people[0].oasAnnualAt65 = 4_200
    plan.incomeSources[1].annualAmount = known(4_200)
    const date = upliftDate(year, month)
    plan.annualBenefitsEvidence![RETIREE].oasAge75 = date
    const input = structuredClone({ plan, evidence })
    const result = ok(projectCanonicalCoverage(plan, evidence, 8))
    expect(result.blocked).toBeNull()
    expect({ plan, evidence }).toEqual(input)
    const [baseline, transition, full] = result.rows.slice(5)
    expect(baseline.retirementSettlement?.oas).toMatchObject({ grossReal: close(5_712) })
    expect(baseline.retirementSettlement?.oas?.age75Uplift).toBeUndefined()
    expect(baseline.byPerson[RETIREE].oasGross).toBeCloseTo(5_712 * cpiAt(74), 5)
    for (const [row, age, expectedGross, increasedMonths] of [[transition, 75, gross, months], [full, 76, 6_283.20, 12]] as const) {
      expect(row.retirementSettlement?.oas).toMatchObject({
        grossReal: close(expectedGross), sourceYear: 2026,
        age75Uplift: { evidence: date, increasedMonths, baseGrossReal: close(5_712), policy: 'annual-estimate-month-weighted-anchor-real' },
      })
      expect(row.byPerson[RETIREE].oasGross).toBeCloseTo(expectedGross * cpiAt(age), 5)
      expect(row.cashLedger.benefits).toBeCloseTo(expectedGross * cpiAt(age), 5)
    }
  })

  it.each([
    { label: 'threshold equality', draw: 65_216.80, recovery: 0 },
    { label: 'partial recovery', draw: 85_000, recovery: 2_967.48 },
    { label: 'full recovery', draw: 164_000, recovery: 13_066.20 },
  ])('prices age-75 CPP, RRIF and ordinary income tax with $label', ({ draw, recovery }) => {
    const gross = 13_066.20
    const expected = quote(draw, true, gross)
    expect(expected.recovery).toBeCloseTo(recovery, 8)
    const factor = 0.0567
    const openingAt75 = draw / factor
    const initialRrsp = openingAt75 / floorFactors.reduce((remaining, minimum) => remaining * (1 - minimum), 1)
    const spending = expected.cash + 25_000
    const { plan, evidence } = scenario(spending, 1_000_000, initialRrsp)
    plan.annualBenefitsEvidence![RETIREE].oasAge75 = upliftDate()
    const result = ok(projectCanonicalCoverage(plan, evidence, 7))
    expect(result.blocked).toBeNull()
    const row = result.rows[6]
    assertSettlement(row, 75, draw, 25_000, spending, gross)
    expect(row.retirementSettlement?.rrif).toMatchObject({
      ageAtYearStart: 74, factor, minimum: close(draw * cpiAt(75)), discretionary: close(0),
    })
    expect(result.state.benefitIncomeLag[RETIREE]).toMatchObject(known(close((cpp + draw) * cpiAt(75))))
  })

  it.each([
    { label: 'missing', date: undefined },
    { label: 'null', date: null },
    { label: 'month out of range', date: upliftDate(2032, 13) },
    { label: 'fractional month', date: upliftDate(2032, 7.5) },
    { label: 'same-year January', date: upliftDate(2032, 1) },
    { label: 'following-year February', date: upliftDate(2033, 2) },
    { label: 'wrong calendar year', date: upliftDate(2031, 7) },
    { label: 'unrecorded provenance', date: { ...upliftDate(), provenance: { ...recorded, origin: 'estimated' } } },
    { label: 'invalid provenance year', date: { ...upliftDate(), provenance: { ...recorded, sourceYear: -1 } } },
  ])('keeps the complete age-74 prefix when uplift evidence is $label', ({ date }) => {
    const { plan, evidence } = scenario(60_000, 500_000, 600_000)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(prefix.blocked).toBeNull()
    if (date !== undefined) Object.assign(plan.annualBenefitsEvidence![RETIREE], { oasAge75: date })
    const input = structuredClone({ plan, evidence })
    const result = ok(projectCanonicalCoverage(plan, evidence, 8))
    const detail = date === undefined
      ? 'OAS: reached age 75 requires separate monthly uplift modeling; no claim month inferred'
      : 'OAS: reached age 75 requires verified user first uplift year and month compatible with reached age; no date inferred'
    expect(result).toMatchObject({
      rows: prefix.rows, state: prefix.state, overallConclusionAvailable: false, uncomputedYears: [2033],
      blocked: { year: 2032, status: 'unsupported', issues: [{ detail }] },
    })
    expect({ plan, evidence }).toEqual(input)
  })

  it.each([false, true])('continues confirmed zero OAS with matching source row present = %s', hasSource => {
    const { plan, evidence } = scenario(60_000, 500_000, 600_000)
    plan.people[0].oasAnnualAt65 = 0
    plan.incomeSources[1].annualAmount = known(0)
    if (!hasSource) plan.incomeSources.pop()
    const result = ok(projectCanonicalCoverage(plan, evidence, 8))
    expect(result.blocked).toBeNull()
    for (const row of result.rows.slice(6)) {
      expect(row.cashLedger.benefits).toBe(0)
      expect(row.retirementSettlement?.oas?.age75Uplift).toBeUndefined()
    }
    plan.annualBenefitsEvidence![RETIREE].oasAge75 = upliftDate()
    expect(ok(projectCanonicalCoverage(plan, evidence, 8))).toEqual(result)
    if (hasSource) {
      plan.incomeSources[1].annualAmount = known(1)
    } else {
      plan.people[0].oasAmountSource!.premisesNeedReview = true
    }
    expect(ok(projectCanonicalCoverage(plan, evidence, 8))).toMatchObject({
      blocked: { year: 2026, status: 'unsupported' }, rows: [],
    })
  })

  it('rejects malformed supplied evidence even for confirmed zero OAS', () => {
    const { plan, evidence } = scenario(60_000, 500_000, 600_000)
    plan.people[0].oasAnnualAt65 = 0
    plan.incomeSources.pop()
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(prefix.blocked).toBeNull()
    plan.annualBenefitsEvidence![RETIREE].oasAge75 = upliftDate(2032, 0)
    expect(ok(projectCanonicalCoverage(plan, evidence, 8))).toMatchObject({
      rows: prefix.rows, state: prefix.state, uncomputedYears: [2033],
      blocked: { year: 2032, status: 'unsupported', issues: [{ detail: expect.stringMatching(/75.*uplift.*month/i) }] },
    })
  })

  it('limits the uplift to generated retirement and preserves legacy and provider results', () => {
    const { plan, evidence } = scenario(60_000, 500_000, 0)
    Object.assign(plan.legacyProjection, { oasAnnualAt65: oasAt65, oasStartAge: 70, lifeExpectancy: 76 })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(prefix.blocked).toBeNull()
    const legacy = runProjection(plan.legacyProjection, undefined, plan)
    const providers = { evaluate: vi.fn(), returns: vi.fn() }
    const supplied = ok(projectAnnualCoverage(plan, prefix.state, 2, providers))
    plan.annualBenefitsEvidence![RETIREE].oasAge75 = upliftDate()
    const result = ok(projectCanonicalCoverage(plan, evidence, 8))
    expect(result.blocked).toBeNull()
    expect(result.rows.slice(0, 6)).toEqual(prefix.rows)
    expect(() => annualOas(plan, plan.people[0], 75)).toThrow(expect.objectContaining({ status: 'unsupported' }))
    expect(annualRetirementContinuation(plan, structuredClone(prefix.state))).toMatchObject({ status: 'invalid' })
    expect(annualRetirementStep(plan, prefix.state, providers.returns)).toMatchObject({ status: 'unsupported' })
    expect(supplied).toMatchObject({ rows: [], blocked: { year: 2032, status: 'unsupported' } })
    expect(ok(projectAnnualCoverage(plan, prefix.state, 2, providers))).toEqual(supplied)
    expect(providers.evaluate).not.toHaveBeenCalled()
    expect(providers.returns).not.toHaveBeenCalled()
    expect(runProjection(plan.legacyProjection, undefined, plan)).toEqual(legacy)
  })

  it('requires benefit opt-in for positive OAS even with a matching recorded amount', () => {
    const { plan, evidence } = scenario(60_000, 500_000, 0)
    plan.people[0].cppAnnualAt65 = 0
    plan.incomeSources.shift()
    delete plan.annualBenefitsEvidence
    const opening = ok(projectCanonicalCoverage(plan, evidence, 0))
    const result = ok(projectCanonicalCoverage(plan, evidence, 8))
    expect(result).toMatchObject({
      rows: [], state: opening.state, uncomputedYears: [2027, 2028, 2029, 2030, 2031, 2032, 2033],
      blocked: { year: 2026, status: 'unsupported', issues: [{ detail: expect.stringMatching(/benefits.*zero evidence/i) }] },
    })
  })

  it('displays the verified uplift only on eligible years in the annual sheet', () => {
    const { plan, evidence } = scenario(60_000, 500_000, 600_000)
    plan.annualBenefitsEvidence![RETIREE].oasAge75 = upliftDate(2033, 1)
    const result = ok(projectCanonicalCoverage(plan, evidence, 8))
    expect(result.blocked).toBeNull()
    const sheet = canonicalAnnualSheet(result, { scenarioId: 'oas-age-75', revision: 1 })
    const row = findRow(sheet.rows, canonicalSheetId('value', 'person', RETIREE, 'oasNet'))!
    const sourcesIn = (year: number) => {
      const ref = row.cells![year].explanationRefs![0]
      return sheet.resolveExplanation!(ref)?.sources
    }
    expect(sourcesIn(2031)?.some(source => source.field === 'annualBenefitsEvidence.oasAge75')).toBe(false)
    for (const [year, months] of [[2032, 0], [2033, 12]]) {
      const source = sourcesIn(year)?.find(source => source.field === 'annualBenefitsEvidence.oasAge75')
      expect(source).toBeDefined()
      for (const lang of ['en', 'fr', 'zh'] as const) {
        const label = annualSheetText(source!.label, lang)
        expect(label).toContain('2033-1')
        expect(label).toContain('2025')
        expect(label).toContain(`${months}/12`)
      }
    }
  })
})

describe('generated-only retirement benefit scope', () => {
  it.each(['unconfirmed CPP', 'unconfirmed OAS', 'unrecorded exclusion'])('refuses %s without benefit or rollover postings', invalid => {
    const { plan, evidence } = scenario()
    const owner = plan.people[0]
    if (invalid === 'unconfirmed CPP') owner.cppAmountSource!.source = 'estimator'
    if (invalid === 'unconfirmed OAS') owner.oasAmountSource!.dollarBasis = 'nominal'
    if (invalid === 'unrecorded exclusion') plan.annualBenefitsEvidence![RETIREE].otherBenefits.provenance = { ...recorded, origin: 'estimated' }
    const initial = ok(projectCanonicalCoverage(plan, evidence, 0))
    const result = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(result).toMatchObject({ blocked: { year: 2026, status: 'unsupported' }, rows: [], state: initial.state })
    expect(result.state.rrifConversions).toBeUndefined()
  })

  it('keeps the prefix when opted-in GIS would cross the age-69 limit', () => {
    const { plan, evidence } = scenario()
    plan.annualBenefitsEvidence![RETIREE].gis = { status: 'annual-estimate', reason: 'Requested GIS estimate', provenance: recorded }
    plan.annualBenefitsEvidence![RETIREE].oasAge75 = upliftDate()
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result).toMatchObject({
      rows: prefix.rows, state: prefix.state, uncomputedYears: [2028],
      blocked: { year: 2027, status: 'unsupported', issues: [{ detail: expect.stringMatching(/GIS.*69.*exclusion/i) }] },
    })
  })

  it('does not extend working or household coverage to an age-70 claim', () => {
    const { plan, evidence } = scenario()
    plan.people[0].retirementAge = 71
    plan.annualBenefitsEvidence![RETIREE].oasAge75 = upliftDate()
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    expect(ok(projectCanonicalCoverage(plan, evidence, 3))).toMatchObject({
      rows: prefix.rows, state: prefix.state, uncomputedYears: [2028],
      blocked: { year: 2027, status: 'unsupported' },
    })

    const household = staggeredHouseholdPlan()
    for (const owner of household.people) Object.assign(owner, { ageInBaseYear: 69, retirementAge: 70, earnedIncome: known(0) })
    household.people[0].oasAnnualAt65 = oasAt65
    household.lifeExpectancy = 73
    household.incomeSources = [plan.incomeSources[1]]
    household.annualBenefitsEvidence = { [RETIREE]: exclusions(), [PARTNER]: exclusions() }
    household.annualBenefitsEvidence[RETIREE].oasAge75 = upliftDate()
    household.budget = { kind: 'incomeBudget', workingSpending: 0, retirementSpending: 75_000 }
    const householdEvidence = { workingSpending: known(0), retirementSpending: known(75_000) }
    const householdPrefix = ok(projectCanonicalCoverage(household, householdEvidence, 1))
    expect(householdPrefix.blocked).toBeNull()
    expect(ok(projectCanonicalCoverage(household, householdEvidence, 3))).toMatchObject({
      rows: householdPrefix.rows, state: householdPrefix.state, uncomputedYears: [2028],
      blocked: { year: 2027, status: 'unsupported' },
    })
  })

  it('preserves public and standalone gates, including a copied authentic prefix', () => {
    const { plan, evidence } = scenario()
    const owner = plan.people[0]
    const boundary = { status: 'unsupported', reason: expect.stringMatching(/through age 69/i) }
    expect(() => annualOas(plan, owner, 70)).toThrow(expect.objectContaining(boundary))
    expect(() => annualCpp(plan, owner, 70)).toThrow(expect.objectContaining(boundary))
    const household = structuredClone(plan)
    household.people.push(staggeredHouseholdPlan().people[1])
    expect(() => annualHouseholdOas(household, household.people[0], 70)).toThrow(expect.objectContaining(boundary))

    const prefix = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(prefix.blocked).toBeNull()
    const copied = structuredClone(prefix.state)
    expect(() => annualGeneratedRetirementOas(plan, owner, 72, copied)).toThrow(expect.objectContaining({
      status: 'unsupported', reason: expect.stringMatching(/authenticated/i),
    }))
    expect(annualRetirementContinuation(plan, copied)).toMatchObject({ status: 'invalid' })

    owner.ageInBaseYear = 70
    const opening = ok(initializeState(plan))
    expect(annualRetirementStep(plan, opening)).toMatchObject({
      status: 'unsupported', issues: [{ detail: expect.stringMatching(/benefit evidence.*zero/i) }],
    })
  })

  it('keeps the zero-benefit RRIF path through age 75 without opting in', () => {
    const { plan, evidence } = scenario()
    const owner = plan.people[0]
    Object.assign(owner, { cppAnnualAt65: 0, oasAnnualAt65: 0 })
    plan.incomeSources = []
    delete plan.annualBenefitsEvidence
    const result = ok(projectCanonicalCoverage(plan, evidence, 7))
    expect(result.blocked).toBeNull()
    expect(result.rows[6]).toMatchObject({
      year: 2032, byPerson: { [RETIREE]: { age: 75 } }, cashLedger: { income: 0, benefits: 0 },
      retirementSettlement: { rrif: { factor: 0.0567, incomeKind: 'rrifWithdrawal' } },
    })
    expect(result.rows[6].retirementSettlement).not.toHaveProperty('cpp')
    expect(result.rows[6].retirementSettlement).not.toHaveProperty('oas')
  })
})

describe('explicit zero CPP in retired OAS continuation', () => {
  function zeroCppScenario() {
    const fixture = scenario(60_000, 500_000, 600_000)
    const { plan } = fixture
    Object.assign(plan.people[0], { ageInBaseYear: 68, retirementAge: 69, cppAnnualAt65: 0 })
    plan.incomeSources = plan.incomeSources.filter(source => source.kind === 'oas')
    return fixture
  }

  function expectNoCpp(row: YearRow) {
    expect(row.cashLedger.income).toBe(0)
    expect(row.byPerson[RETIREE]).not.toHaveProperty('cpp')
    expect(row.workingSettlement ?? {}).not.toHaveProperty('cpp')
    expect(row.retirementSettlement ?? {}).not.toHaveProperty('cpp')
  }

  it.each([
    { label: 'statement flagged for review', issue: /CPP.*premise.*confirmed/i },
    { label: 'statement with a stale retirement age', issue: /CPP.*premise.*confirmed/i },
    { label: 'duplicate zero CPP source rows', issue: /CPP.*unique/i },
  ])('stops atomically at 70 for a $label', ({ label, issue }) => {
    const { plan, evidence } = zeroCppScenario()
    const baseline = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(baseline.blocked).toBeNull()
    const owner = plan.people[0]
    if (label === 'duplicate zero CPP source rows') {
      const source = cppStart(RETIREE, 70, 0)
      plan.incomeSources.push(source, { ...source, id: 'second-zero-cpp' })
    } else {
      const flagged = label === 'statement flagged for review'
      Object.assign(owner.cppAmountSource!, {
        source: 'statement', premisesNeedReview: flagged,
        premises: { retirementAge: flagged ? owner.retirementAge : owner.retirementAge + 1 },
      })
    }
    const result = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(result).toMatchObject({
      rows: baseline.rows, state: baseline.state, uncomputedYears: [2029, 2030],
      blocked: { year: 2028, status: 'unsupported', issues: [{ detail: expect.stringMatching(issue) }] },
    })
    expect(result.rows.map(row => row.byPerson[RETIREE].age)).toEqual([68, 69])
    for (const row of result.rows) expectNoCpp(row)
    expect(result.state.rrifConversions).toBeUndefined()
  })

  it.each([
    { label: 'manual zero and no source row', hasSource: false },
    { label: 'manual zero and one matching source row', hasSource: true },
  ])('pays OAS through age 74 with $label and no CPP cash or receipt', ({ hasSource }) => {
    const { plan, evidence } = zeroCppScenario()
    if (hasSource) plan.incomeSources.push(cppStart(RETIREE, 70, 0))
    const result = ok(projectCanonicalCoverage(plan, evidence, 7))
    expect(result.blocked).toBeNull()
    expect(result.rows).toHaveLength(7)
    for (const row of result.rows) expectNoCpp(row)
    for (const [index, row] of result.rows.slice(2).entries()) {
      const gross = grossOas * (1 + inflation) ** (index + 2)
      expect(row.byPerson[RETIREE]).toMatchObject({ age: 70 + index, oasGross: close(gross), oasRecovery: 0, oasNet: close(gross) })
      expect(row.cashLedger.benefits).toBeCloseTo(gross, 5)
    }
    expect(result.rows[4].retirementSettlement?.rrif).toMatchObject({ factor: 0.0528, incomeKind: 'rrifWithdrawal' })
  })

  it('keeps the preexisting no-opt-in zero CPP shape', () => {
    const { plan, evidence } = zeroCppScenario()
    delete plan.annualBenefitsEvidence
    plan.people[0].oasAnnualAt65 = 0
    plan.incomeSources = []
    const baseline = ok(projectCanonicalCoverage(plan, evidence, 8))
    expect(baseline.blocked).toBeNull()
    expect(baseline.rows).toHaveLength(8)
    for (const row of baseline.rows) expectNoCpp(row)
    Object.assign(plan.people[0].cppAmountSource!, {
      source: 'statement', premisesNeedReview: true, premises: { retirementAge: 70 },
    })
    const source = cppStart(RETIREE, 70, 0)
    plan.incomeSources.push(source, { ...source, id: 'second-zero-cpp' })
    expect(ok(projectCanonicalCoverage(plan, evidence, 8))).toEqual(baseline)
  })
})
