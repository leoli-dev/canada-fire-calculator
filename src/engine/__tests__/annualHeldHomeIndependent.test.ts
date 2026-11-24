import { describe, expect, it, vi } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { annualRetirementContinuation, annualRetirementStep, projectRetirementCoverage } from '../annualRetirement'
import { annualStep, initializeState, projectAnnualCoverage, projectCanonicalCoverage, projectFromState,
  sumInvestableAssets, sumNetWorth, type KernelResult } from '../annualState'
import { evaluateCanonicalWorkingYear } from '../annualWorking'
import type { InputsV2, Property, Provenance } from '../model'
import { runProjection } from '../projection'
import { BASE_YEAR, known, recorded, retirementPlan, RETIREE, TFSA } from './fixtures/retirementSettlement'

const HOME = 'my-primary-home'
const OPENING = 500_000
const ACB = 310_000
const CPI = 1.02
const REAL_GROWTH = 1.04
const NOMINAL_GROWTH = REAL_GROWTH * CPI
const TFSA_OPENING = 36_000
const RETIREMENT_SPENDING = 20_000
const context = { scenarioId: 'held-home-audit', revision: 1 }
const close = (amount: number) => expect.closeTo(amount, 6)

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function fixture() {
  const plan = retirementPlan({ tfsa: TFSA_OPENING, rrsp: 0, spending: RETIREMENT_SPENDING, inflation: 0.02, strategy: 'tfsaFirst' })
  plan.people[0].retirementAge = 59
  plan.lifeExpectancy = 61
  plan.budget = { kind: 'incomeBudget', workingSpending: 0, retirementSpending: RETIREMENT_SPENDING }
  const home: Property = {
    id: HOME, kind: 'principal', value: OPENING, acb: known(ACB), annualRent: known(0),
    appreciation: 0.04, sellAtAge: null, plannedPurchaseAge: null, plannedDownPayment: null,
    plannedMortgage: null, annualHoldingCostChange: 0, mortgageDebtId: null,
    taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 1 } },
    provenance: { value: recorded, acb: recorded, annualRent: recorded, taxableOwnerShares: recorded },
  }
  plan.properties.push(home)
  return { plan, home, evidence: { workingSpending: known(0), retirementSpending: known(RETIREMENT_SPENDING) } }
}

function findRow(rows: AnnualSheetRow[], id: string): AnnualSheetRow | undefined {
  for (const row of rows) {
    if (row.id === id) return row
    const nested = findRow(row.children ?? [], id)
    if (nested) return nested
  }
}

describe('independent annual held primary home ledger', () => {
  it('posts nominal property growth once across working and retirement while liquid spending exhausts', () => {
    const { plan, evidence } = fixture()
    const before = structuredClone(plan)
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 5))
    const noHome = ok(projectCanonicalCoverage({ ...plan, properties: [] }, evidence, 5))
    expect(coverage).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false })
    expect(coverage.rows.map(row => row.year)).toEqual([2026, 2027, 2028, 2029, 2030])
    const sheet = canonicalAnnualSheet(coverage, context)
    const cell = (year: number, ...path: string[]) => findRow(sheet.rows, canonicalSheetId('value', ...path))!.cells![year]

    // The TFSA has zero real investment return. It funds one full retirement
    // year, a partial second year and zero in the third.
    const fundedReal = [0, 0, 20_000, 16_000, 0]
    const liquidClosingReal = [36_000, 36_000, 16_000, 0, 0]
    for (const [index, row] of coverage.rows.entries()) {
      const year = sheet.years[index]
      const startCpi = CPI ** index
      const endCpi = CPI ** (index + 1)
      const opening = OPENING * NOMINAL_GROWTH ** index
      const closing = OPENING * NOMINAL_GROWTH ** (index + 1)
      const growth = closing - opening
      const funded = fundedReal[index] * startCpi
      const liquidClosing = liquidClosingReal[index] * endCpi
      expect(row.byProperty).toEqual({ [HOME]: { held: true, opening: close(opening), growth: close(growth), closing: close(closing) } })
      if (index) expect(row.byProperty[HOME].opening).toBe(coverage.rows[index - 1].byProperty[HOME].closing)
      expect(row.byProperty[HOME].opening + row.byProperty[HOME].growth).toBe(row.byProperty[HOME].closing)
      expect(row.byAccount[TFSA]).toMatchObject({ withdrawal: close(funded), closing: close(liquidClosing) })
      expect(row.byDebt).toEqual({})
      expect(row.taxLedger).toEqual({ [RETIREE]: { taxableIncome: 0, tax: 0 } })
      expect(row.cashLedger).toMatchObject({ income: 0, benefits: 0, tax: 0, debtPayments: 0,
        spending: close(funded), unallocated: 0 })
      expect(!!row.workingSettlement).toBe(index < 2)
      if (index >= 2) expect(row.retirementSettlement).toMatchObject({
        spendingDue: close(RETIREMENT_SPENDING * startCpi),
        spendingFunded: close(funded),
        spendingUnmet: close((RETIREMENT_SPENDING - fundedReal[index]) * startCpi),
      })
      expect({ ...row, byProperty: {} }).toEqual(noHome.rows[index])
      expect(ok(projectCanonicalCoverage(plan, evidence, index + 1)).state.byProperty[HOME]).toEqual({
        held: true, value: row.byProperty[HOME].closing, acb: known(ACB),
      })

      for (const [field, timing, nominal, real] of [
        ['opening', 'opening', opening, opening / startCpi],
        ['growth', 'during-year', growth, growth / startCpi],
        ['closing', 'closing', closing, closing / endCpi],
        ['inflationBridge', 'closing', 0, closing / endCpi - closing / startCpi],
      ] as const) {
        const property = cell(row.year, 'property', HOME, field)
        expect(property).toMatchObject({ timing, basis: 'nominal-CAD' })
        expect(annualSheetDisplayValue(property, year, 'nominal')).toBeCloseTo(nominal, 6)
        expect(annualSheetDisplayValue(property, year, 'real')).toBeCloseTo(real, 6)
      }
      const assets = cell(row.year, 'assets')
      const netWorth = cell(row.year, 'netWorth')
      expect(assets).toMatchObject({ timing: 'closing', value: close(liquidClosing) })
      expect(netWorth).toMatchObject({ timing: 'closing', value: close(liquidClosing + closing) })
      expect(annualSheetDisplayValue(netWorth, year, 'real')).toBeCloseTo(liquidClosingReal[index] + OPENING * REAL_GROWTH ** (index + 1), 6)
    }
    expect(sumInvestableAssets(coverage.state)).toBe(0)
    expect(sumNetWorth(coverage.state)).toBeCloseTo(OPENING * NOMINAL_GROWTH ** 5, 6)
    expect(plan).toEqual(before)
  })

  it('keeps recorded working spending and its resulting savings unchanged by the home', () => {
    const { plan, evidence } = fixture()
    plan.people[0].earnedIncome = known(12_000)
    plan.budget = { kind: 'incomeBudget', workingSpending: 10_000, retirementSpending: RETIREMENT_SPENDING }
    evidence.workingSpending = known(10_000)
    const held = ok(projectCanonicalCoverage(plan, evidence, 1))
    const baseline = ok(projectCanonicalCoverage({ ...plan, properties: [] }, evidence, 1))
    expect(held.blocked).toBeNull()
    expect(held.rows[0].cashLedger).toMatchObject({ income: 12_000, spending: 10_000, tax: 0, debtPayments: 0 })
    expect(held.rows[0].byAccount[TFSA].contribution).toBeGreaterThan(0)
    expect(held.rows.map(row => ({ ...row, byProperty: {} }))).toEqual(baseline.rows)
  })

  it.each([58, 60])('stops atomically in the year age %i is reached for a sale', saleAge => {
    const { plan, home, evidence } = fixture()
    home.sellAtAge = saleAge
    const stoppedYear = BASE_YEAR + saleAge - 57
    const before = structuredClone(plan)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, stoppedYear - BASE_YEAR))
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(prefix.blocked).toBeNull()
    expect(stopped).toMatchObject({ rows: prefix.rows, state: prefix.state, overallConclusionAvailable: false,
      blocked: { year: stoppedYear, status: 'unsupported', causes: ['propertySale'] },
      uncomputedYears: Array.from({ length: 2030 - stoppedYear }, (_, index) => stoppedYear + index + 1) })
    expect(stopped.state.byProperty[HOME]).toMatchObject({ held: true, acb: known(ACB),
      value: prefix.rows.at(-1)!.byProperty[HOME].closing })
    const sheet = canonicalAnnualSheet(stopped, context)
    for (const path of [['property', HOME, 'closing'], ['netWorth'], ['cash', 'income']]) {
      const cells = findRow(sheet.rows, canonicalSheetId('value', ...path))!.cells!
      expect(cells[stoppedYear - 1].value).not.toBeNull()
      expect(cells[stoppedYear]).toMatchObject({ value: null, status: 'not-computed' })
      expect(cells[stoppedYear + 1]).toMatchObject({ value: null, status: 'not-computed' })
      for (const [locale, sale] of [['en', /sale/i], ['fr', /vente/i], ['zh', /出售/]] as const) {
        expect(annualSheetText(cells[stoppedYear].reason!, locale)).toMatch(sale)
        expect(annualSheetText(cells[stoppedYear + 1].reason!, locale)).not.toMatch(sale)
      }
    }
    expect(plan).toEqual(before)
  })

  const outsideScope: [string, (plan: InputsV2, home: Property) => void][] = [
    ['a future purchase', (_, home) => { home.plannedPurchaseAge = 60; home.plannedDownPayment = 50_000 }],
    ['a proposed mortgage', (_, home) => { home.plannedMortgage = { principal: 100_000, annualPayment: 10_000, yearsRemaining: 10 } }],
    ['rental income', (_, home) => { home.annualRent = known(100) }],
    ['unknown rent', (_, home) => { home.annualRent = { status: 'unknown', reason: 'Rent statement unavailable' } }],
    ['a holding cost change', (_, home) => { home.annualHoldingCostChange = -100 }],
    ['an investment property', (_, home) => { home.kind = 'investment' }],
    ['a second home', (plan, home) => { plan.properties.push({ ...home, id: 'second-home' }) }],
    ['mortgage debt', (plan, home) => {
      home.mortgageDebtId = 'mortgage'
      plan.debts.push({ id: 'mortgage', kind: 'mortgage', propertyId: HOME, principal: 100_000,
        annualPayment: 10_000, yearsRemaining: 10, provenance: recorded })
    }],
    ['unknown ownership', (_, home) => { home.taxableOwnerShares = { status: 'unknown', reason: 'Title unavailable' } }],
    ['less than whole ownership', (_, home) => { home.taxableOwnerShares = { status: 'known', shares: { [RETIREE]: 0.999999999 } } }],
  ]

  it.each(outsideScope)('refuses %s without posting a year', (_, change) => {
    const { plan, home, evidence } = fixture()
    change(plan, home)
    const before = structuredClone(plan)
    const result = projectCanonicalCoverage(plan, evidence, 3)
    if (home.taxableOwnerShares.status === 'unknown') {
      expect(result).toMatchObject({ status: 'unsupported', issues: [{ detail: expect.stringMatching(/ownershipUnknown/) }] })
    } else {
      expect(ok(result)).toMatchObject({ rows: [], state: ok(initializeState(plan)),
        blocked: { year: BASE_YEAR, status: 'unsupported' }, uncomputedYears: [2027, 2028] })
    }
    expect(plan).toEqual(before)
  })

  it.each(['missing', 'unknown', 'estimated'] as const)('refuses %s home value provenance despite a finite value', origin => {
    const { plan, home, evidence } = fixture()
    if (origin === 'missing') delete home.provenance.value
    else home.provenance.value = { origin, sourceYear: BASE_YEAR }
    const before = structuredClone(plan)
    expect(ok(projectCanonicalCoverage(plan, evidence, 3))).toMatchObject({
      rows: [], state: ok(initializeState(plan)), uncomputedYears: [2027, 2028],
      blocked: { year: BASE_YEAR, status: 'unsupported' },
    })
    expect(plan).toEqual(before)
  })

  it.each([
    { sourceYear: BASE_YEAR },
    { origin: 'user' },
    { origin: 'user', sourceYear: String(BASE_YEAR) },
    { origin: 'legacy', sourceYear: BASE_YEAR + 0.5 },
    { origin: 'legacy', sourceYear: null, note: 123 },
  ])('rejects malformed home value provenance %j during plan validation', provenance => {
    const { plan, home, evidence } = fixture()
    home.provenance.value = provenance as unknown as Provenance
    expect(projectCanonicalCoverage(plan, evidence, 3)).toEqual({
      status: 'invalid', issues: [{ code: 'invalid', detail: 'canonical plan shape' }],
    })
  })

  it.each<Provenance>([recorded, { origin: 'legacy', sourceYear: null }])('carries a home with $origin value provenance', value => {
    const { plan, home, evidence } = fixture()
    // An owned home migrated from legacy has a value source but no known ACB.
    home.provenance = { value }
    home.acb = { status: 'unknown', reason: 'Principal residence basis not supplied' }
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    expect(result.rows[2].byProperty[HOME].closing).toBeCloseTo(OPENING * NOMINAL_GROWTH ** 3, 6)
    expect(result.state.byProperty[HOME].acb).toEqual(home.acb)
  })

  it.each([58, 59])('rolls back unrepresentable closing home value with retirement at %i', retirementAge => {
    const { plan, home, evidence } = fixture()
    plan.people[0].retirementAge = retirementAge
    home.value = 1
    home.appreciation = 1e200
    const before = structuredClone(plan)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    expect(prefix.state.byProperty[HOME].value).toBe(1e200 * CPI)
    expect(ok(projectCanonicalCoverage(plan, evidence, 3))).toMatchObject({
      rows: prefix.rows, state: prefix.state, uncomputedYears: [2028],
      blocked: { year: 2027, status: 'invalid',
        issues: [{ code: 'invalid', detail: 'year-end state: snapshot nested amount' }] },
    })
    expect(plan).toEqual(before)
  })

  it('rejects an appreciation rate below minus 100 percent before posting', () => {
    const { plan, home, evidence } = fixture()
    home.appreciation = -1.01
    expect(ok(projectCanonicalCoverage(plan, evidence, 2))).toMatchObject({
      rows: [], state: ok(initializeState(plan)), uncomputedYears: [2027],
      blocked: { year: BASE_YEAR, status: 'unsupported' },
    })
  })

  it('rejects a non-finite nominal growth factor before posting', () => {
    const { plan, home, evidence } = fixture()
    home.appreciation = Number.MAX_VALUE
    expect(ok(projectCanonicalCoverage(plan, evidence, 2))).toMatchObject({
      rows: [], state: ok(initializeState(plan)), uncomputedYears: [2027],
      blocked: { year: BASE_YEAR, status: 'invalid',
        issues: [{ code: 'invalid', detail: `property growth is not finite: ${HOME}` }] },
    })
  })

  it('preserves an opaque property ID as one own ledger entry in both phases', () => {
    const { plan, home, evidence } = fixture()
    home.id = '__proto__'
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    for (const [index, row] of result.rows.entries()) {
      expect(Object.keys(row.byProperty)).toEqual([home.id])
      expect(row.byProperty[home.id].closing).toBeCloseTo(OPENING * NOMINAL_GROWTH ** (index + 1), 6)
    }
    expect(Object.keys(result.state.byProperty)).toEqual([home.id])
    const sheet = canonicalAnnualSheet(result, context)
    expect(findRow(sheet.rows, canonicalSheetId('value', 'property', home.id, 'closing'))!.cells![2028].value)
      .toBeCloseTo(OPENING * NOMINAL_GROWTH ** 3, 6)
  })

  it('keeps provider-held growth and skips unused growth before a provider purchase', () => {
    const { plan, home } = fixture()
    delete home.provenance.value
    plan.budget = { kind: 'savingsBudget', annualNetSavings: 0, retirementSpending: RETIREMENT_SPENDING,
      debtIncluded: known(true), taxBenefitIncluded: known(true) }
    const providers = {
      evaluate: () => ({ byPerson: { [RETIREE]: { income: 100, earnedIncome: 100, benefits: 0, tax: 20,
        spending: 80, taxableIncome: 100, benefitIncomeForNextYear: known(100) } } }),
      returns: () => 0,
    }
    const opening = ok(initializeState(plan))
    const provided = ok(projectAnnualCoverage(plan, opening, 1, providers))
    expect(provided).toMatchObject({ blocked: null, evaluationBasis: 'provider-supplied' })
    const [row] = provided.rows
    expect(row.workingSettlement).toBeUndefined()
    expect(row.cashLedger).toMatchObject({ income: 100, tax: 20, spending: 80, debtPayments: 0 })
    expect(row.byProperty[HOME]).toEqual({ held: true, opening: OPENING,
      growth: close(OPENING * (NOMINAL_GROWTH - 1)), closing: close(OPENING * NOMINAL_GROWTH) })
    expect(ok(projectFromState(plan, opening, 1, providers))).toEqual({ rows: provided.rows, state: provided.state })
    expect(opening).toEqual(ok(initializeState(plan)))

    home.plannedPurchaseAge = 60
    home.plannedDownPayment = 50_000
    home.appreciation = -2
    const future = ok(projectAnnualCoverage(plan, ok(initializeState(plan)), 1, providers))
    expect(future.blocked).toBeNull()
    expect(future.rows[0].byProperty[HOME]).toEqual({ held: false, opening: OPENING, growth: 0, closing: OPENING })
  })

  it('keeps the exact provider diagnostic and committed prefix when the home closing overflows', () => {
    const { plan, home } = fixture()
    plan.budget = { kind: 'savingsBudget', annualNetSavings: 0, retirementSpending: RETIREMENT_SPENDING,
      debtIncluded: known(true), taxBenefitIncluded: known(true) }
    home.value = 1
    home.appreciation = 1e200
    const growth = (1 + home.appreciation) * CPI
    expect(Number.isFinite(growth)).toBe(true)
    expect(growth * growth).toBe(Infinity)
    const providers = {
      evaluate: () => ({ byPerson: { [RETIREE]: { income: 0, earnedIncome: 0, benefits: 0, tax: 0,
        spending: 0, taxableIncome: 0, benefitIncomeForNextYear: known(0) } } }),
      returns: () => 0,
    }
    const opening = ok(initializeState(plan))
    const prefix = ok(projectAnnualCoverage(plan, opening, 1, providers))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows[0].byProperty[HOME]).toEqual({ held: true, opening: 1, growth: growth - 1, closing: growth })
    const before = structuredClone(prefix.state)
    const invalid = { status: 'invalid', issues: [{ code: 'invalid', detail: 'year-end state: snapshot nested amount' }] }
    expect(annualStep(plan, prefix.state, providers)).toEqual(invalid)
    expect(projectFromState(plan, opening, 3, providers)).toEqual(invalid)
    expect(ok(projectAnnualCoverage(plan, opening, 3, providers))).toMatchObject({
      rows: prefix.rows, state: before, uncomputedYears: [2028],
      blocked: { year: 2027, ...invalid, causes: ['invalidState'] },
    })
    expect(prefix.state).toEqual(before)
    expect(opening).toEqual(ok(initializeState(plan)))
  })

  it('keeps public quoting and standalone retirement gated even with returned or imitated state', () => {
    const { plan, evidence } = fixture()
    const opening = ok(initializeState(plan))
    const working = ok(projectCanonicalCoverage(plan, evidence, 1)).state
    const retired = ok(projectCanonicalCoverage(plan, evidence, 2)).state
    expect(evaluateCanonicalWorkingYear({ ...plan, properties: [] }, evidence).status).toBe('ok')
    expect(evaluateCanonicalWorkingYear(plan, evidence)).toMatchObject({ status: 'unsupported' })
    for (const supplied of [working, structuredClone(working)]) {
      expect(evaluateCanonicalWorkingYear(plan, evidence, supplied.year, supplied)).toMatchObject({ status: 'unsupported' })
    }
    const returns = vi.fn()
    for (const supplied of [retired, structuredClone(retired)]) {
      expect(annualRetirementContinuation(plan, supplied)).toMatchObject({ status: 'invalid',
        issues: [{ detail: expect.stringMatching(/internally generated/) }] })
      expect(annualRetirementStep(plan, supplied, returns)).toMatchObject({ status: 'unsupported' })
      expect(ok(projectRetirementCoverage(plan, supplied, 1, returns))).toMatchObject({
        rows: [], state: supplied, blocked: { year: supplied.year, status: 'unsupported' },
      })
    }
    expect(returns).not.toHaveBeenCalled()
    expect(opening.byProperty[HOME]).toEqual({ held: true, value: OPENING, acb: known(ACB) })
    const never = { evaluate: vi.fn(), returns: vi.fn() }
    opening.byProperty[HOME].value += 1
    expect(annualStep(plan, opening, never)).toMatchObject({ status: 'invalid' })
    expect(never.evaluate).not.toHaveBeenCalled()
    expect(never.returns).not.toHaveBeenCalled()
  })

  it('preserves the App projection and legacy sheet when the canonical hold is enabled', () => {
    const { plan, evidence } = fixture()
    const inputs = { ...plan.legacyProjection, fireAge: 59, lifeExpectancy: 61,
      principalResidence: { value: OPENING, appreciation: 0.04, sellAtAge: null } }
    plan.legacyProjection = inputs
    const legacyPlan = { ...plan, properties: [] }
    const observed = runProjection(inputs, undefined, plan, { captureAnnualDetails: true })
    const legacy = runProjection(inputs, undefined, legacyPlan, { captureAnnualDetails: true })
    const plain = runProjection(inputs, undefined, plan)
    expect(observed).toEqual(legacy)
    expect({ ...observed, rows: observed.rows.map(({ annualDetails: _details, ...row }) => row) }).toEqual(plain)
    expect(legacyAnnualSheet(observed, inputs, context).rows).toEqual(legacyAnnualSheet(legacy, inputs, context).rows)
    const sample = vi.fn(() => -0.10)
    const sampled = runProjection(inputs, sample, plan)
    expect(sample).toHaveBeenCalledWith(57, 'tfsa')
    expect(sampled).toEqual(runProjection(inputs, () => -0.10, legacyPlan))
    expect(sampled.rows.map(row => row.propertyValue)).toEqual(observed.rows.map(row => row.propertyValue))
    expect(sampled.rows.every(row => !Object.hasOwn(row, 'annualDetails'))).toBe(true)
    const canonical = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(canonical.blocked).toBeNull()
    for (const [index, row] of observed.rows.entries()) {
      expect(row.propertyValue).toBeCloseTo(OPENING * REAL_GROWTH ** (index + 1), 6)
      expect(canonical.rows[index].byProperty[HOME].closing / CPI ** (index + 1)).toBeCloseTo(row.propertyValue, 6)
      expect(row.rent).toBe(0)
      expect(row.debtPayment).toBe(0)
      expect(row.taxableBySource.property).toBe(0)
    }
  })
})
