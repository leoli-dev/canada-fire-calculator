import { describe, expect, it, vi } from 'vitest'
import { annualSheetText, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { annualRetirementContinuation, annualRetirementStep, projectRetirementCoverage } from '../annualRetirement'
import { annualStep, initializeState, projectAnnualCoverage, projectCanonicalCoverage, projectFromState, type KernelResult, type YearRow } from '../annualState'
import type { Account } from '../model'
import { runProjection } from '../projection'
import { known, legacyRetirement, retirementPlan, RETIREE, RRSP, TFSA } from './fixtures/retirementSettlement'

const setupYear = 2028
const firstDrawYear = 2029
const nextDrawYear = 2030
const close = (value: number) => expect.closeTo(value, 6)
const context = { scenarioId: 'independent-rrif', revision: 1 }

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function scenario({ rrsp = 600_000, tfsa = 150_000, spending = 40_000, inflation = 0, rrspReturn = 0 } = {}) {
  const plan = retirementPlan({ age: 69, rrsp, tfsa, spending, inflation, rrspReturn, strategy: 'tfsaFirst' })
  plan.people[0].retirementAge = 70
  plan.lifeExpectancy = 73
  plan.budget = { kind: 'incomeBudget', workingSpending: 0, retirementSpending: spending }
  return { plan, evidence: { workingSpending: known(0), retirementSpending: known(spending) } }
}

function findRow(rows: AnnualSheetRow[], id: string): AnnualSheetRow | undefined {
  for (const row of rows) {
    if (row.id === id) return row
    const child = findRow(row.children ?? [], id)
    if (child) return child
  }
}

// 2026 TD1/TD1ON amounts, CRA line 31400 and Ontario's $300 premium plateau.
// All uses below have both full age amounts, first-bracket rates and Ontario
// basic tax above $600, so the Ontario reduction and surtax do not apply.
// https://www.canada.ca/en/revenue-agency/services/forms-publications/td1-personal-tax-credits-returns/td1-forms-pay-received-on-january-1-later.html
// https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-31400-pension-income-amount.html
const rrifTax = (draw: number) => (draw - 16_452 - 9_208 - 2_000) * 0.14
  + (draw - 12_989 - 6_342 - 1_796) * 0.0505 + 300

function assertCash(row: YearRow, spending: number, draw: number, tfsa: number, tax: number) {
  expect(row.taxLedger[RETIREE]).toMatchObject({ taxableIncome: close(draw), tax: close(tax) })
  expect(row.cashLedger).toMatchObject({ income: 0, benefits: 0, spending: close(spending), tax: close(tax), unallocated: close(0) })
  expect(row.retirementSettlement).toMatchObject({ spendingDue: close(spending), spendingFunded: close(spending), spendingUnmet: close(0) })
  expect(row.byAccount[TFSA].withdrawal).toBeCloseTo(tfsa, 6)
  expect(row.byAccount[RRSP].withdrawal).toBeCloseTo(draw, 6)
  expect(draw + tfsa - tax).toBeCloseTo(spending, 6)
}

describe('independent Canadian RRIF annual settlement vectors', () => {
  it('conserves the direct rollover after age-71 growth and taxes two nominal opening-balance minimums', () => {
    // New ordinary RRIF funded solely from an RRSP fits s.7308(4).
    // Ages 72 and 73 as reached in the projection use January 1 ages 71 and 72.
    // https://laws-lois.justice.gc.ca/eng/regulations/c.r.c.,_c._945/section-7308.html
    // https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/completing-slips-summaries/t4rsp-t4rif-information-returns/payments/minimum-amount-a-rrif.html
    // https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/registered-retirement-income-fund-rrif/transferring-your-rrif/property-unmatured-rrsp.html
    const { plan, evidence } = scenario({ inflation: 0.02, rrspReturn: 0.02 })
    const input = structuredClone(plan)
    const preRollover = ok(projectCanonicalCoverage(plan, evidence, 2))
    const rolled = ok(projectCanonicalCoverage(plan, evidence, 3))
    const result = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(result).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false })
    expect(preRollover.state.rrifConversions).toBeUndefined()
    expect(result.rows.slice(0, 2)).toEqual(preRollover.rows)
    expect(result.rows.slice(0, 3)).toEqual(rolled.rows)
    expect(plan).toEqual(input)

    const [,, setup, first, next] = result.rows
    const conversion = { year: setupYear, ownerId: RETIREE, amount: close(675_697.4515584),
      factorCategory: 'allOther', ageBasis: 'owner', provenance: 'generated-owner-rrsp-rollover' }
    expect(setup.byPerson[RETIREE].age).toBe(71)
    assertCash(setup, 41_616, 0, 41_616, 0)
    expect(setup.contributionLedger.postings).toEqual([])
    expect(setup.retirementSettlement?.rrif).toMatchObject({ accountId: RRSP, conversion, minimum: 0,
      withdrawal: 0, factor: 0, incomeKind: 'rrspWithdrawal' })
    expect(setup.byAccount[RRSP]).toMatchObject({ ownerId: RETIREE, openingKind: 'rrsp', closingKind: 'rrif',
      opening: close(600_000 * 1.0404 ** 2), contribution: 0, closing: conversion.amount })
    expect(rolled.state.rrifConversions).toMatchObject({ [RRSP]: conversion })
    expect(rolled.state.byAccount[RRSP]).toMatchObject({ kind: 'rrif', ownerId: RETIREE, openedYear: known(setupYear) })
    expect(rolled.state.byAccount[RRSP].balance).toBe(setup.byAccount[RRSP].closing)

    // $600,000 × 1.0404³ × 5.28% = $35,676.82544228352 nominal. Compute
    // tax on $33,619.06944 anchor-real, then index it once.
    const vectors = [
      { row: first, prior: setup, age: 72, year: firstDrawYear, factor: 0.0528, opening: 675_697.4515584,
        draw: 35_676.82544228352, taxableReal: 33_619.06944, tax: 1_873.158646047011,
        spending: 42_448.32, tfsa: 8_644.653203763495, closing: 665_877.4594112076 },
      { row: next, prior: first, age: 73, year: nextDrawYear, factor: 0.054, opening: 665_877.4594112076,
        draw: 35_957.382808205206, taxableReal: 33_219.0636392448, tax: 1_828.1392922409323,
        spending: 43_297.2864, tfsa: 9_168.042884035724, closing: 655_368.8476977637 },
    ]
    for (const v of vectors) {
      const cpi = 1.02 ** (v.year - 2026)
      expect(rrifTax(v.taxableReal) * cpi).toBeCloseTo(v.tax, 8)
      expect(v.row.year).toBe(v.year)
      expect(v.row.byPerson[RETIREE].age).toBe(v.age)
      expect(v.row.retirementSettlement?.rrif).toMatchObject({ accountId: RRSP, conversion, openingBalance: close(v.opening),
        ageAtYearStart: v.age - 1, factor: v.factor, minimum: close(v.draw), withdrawal: close(v.draw),
        discretionary: close(0), incomeKind: 'rrifWithdrawal' })
      assertCash(v.row, v.spending, v.draw, v.tfsa, v.tax)
      expect(v.row.byAccount[RRSP]).toMatchObject({ ownerId: RETIREE, openingKind: 'rrif', closingKind: 'rrif',
        closing: close(v.closing), returnAmount: close((v.opening - v.draw) * 0.0404) })
      expect(Object.keys(v.row.byAccount).sort()).toEqual([RRSP, TFSA].sort())
      for (const id of [RRSP, TFSA]) expect(v.row.byAccount[id].opening).toBe(v.prior.byAccount[id].closing)
      expect(v.row.byAccount[TFSA].closing).toBeCloseTo((v.row.byAccount[TFSA].opening - v.tfsa) * 1.02, 6)
    }
    expect(result.state.rrifConversions).toEqual(rolled.state.rrifConversions)
    expect(result.state.byAccount[RRSP].balance).toBe(next.byAccount[RRSP].closing)
    expect(result.state.byAccount[TFSA].balance).toBe(next.byAccount[TFSA].closing)
    expect(result.state.benefitIncomeLag[RETIREE]).toMatchObject({ status: 'known', value: close(vectors[1].draw) })

    const sheet = canonicalAnnualSheet(result, context)
    const cell = (...keys: string[]) => findRow(sheet.rows, canonicalSheetId('value', ...keys))?.cells
    expect(cell('account', RRSP, 'rrif', 'rollover')?.[setupYear]).toMatchObject({ value: conversion.amount, timing: 'closing' })
    expect(cell('account', RRSP, 'rrif', 'rollover')?.[firstDrawYear]).toMatchObject({ value: null, status: 'not-applicable' })
    const floor = cell('account', RRSP, 'rrif', 'minimum')?.[firstDrawYear]
    expect(floor).toMatchObject({ value: close(vectors[0].draw), realFactor: close(1 / 1.02 ** 3) })
    expect(sheet.resolveExplanation?.(floor!.explanationRefs![0])?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: RRSP, field: 'rrifConversions' }),
    ]))
    expect(cell('account', TFSA, 'rrif', 'minimum')).toBeUndefined()
    expect(cell('estate')?.[nextDrawYear]).toMatchObject({ value: null, status: 'unknown' })
    expect(annualSheetText(sheet.scope!, 'en')).toMatch(/FIRE/i)
  })

  it('pays the mandatory floor, exhausts the TFSA, and gross-ups only the remaining RRIF cash need', () => {
    const tax = 3_130.6865 // RRIF-only income of $40,000 with both pension amounts and $450 premium.
    const tfsaDraw = 42_000 - (40_000 - tax)
    const { plan, evidence } = scenario({ tfsa: 2 * 42_000 + tfsaDraw, spending: 42_000 })
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.blocked).toBeNull()
    const row = result.rows[3]
    assertCash(row, 42_000, 40_000, tfsaDraw, tax)
    expect(row.retirementSettlement?.rrif).toMatchObject({ minimum: 31_680, withdrawal: close(40_000), discretionary: close(8_320) })
    expect(row.byAccount[TFSA].closing).toBe(0)
    expect(row.byAccount[RRSP].closing).toBeCloseTo(560_000, 6)
  })

  it('keeps taxable age-71 RRSP cash distinct from the tax-deferred transfer of the rest', () => {
    const { plan, evidence } = scenario({ tfsa: 40_000 })
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.blocked).toBeNull()
    const [, , setup, first] = result.rows
    // Inverting the 14% and 5.05% first brackets, age and basic amounts,
    // and $450 health premium gives $44,325.36689314 without pension credits.
    const rrspDraw = 44_325.36689314392
    assertCash(setup, 40_000, rrspDraw, 0, rrspDraw - 40_000)
    expect(setup.retirementSettlement?.rrif).toMatchObject({ minimum: 0, incomeKind: 'rrspWithdrawal',
      conversion: { amount: close(600_000 - rrspDraw) } })
    expect(first.retirementSettlement?.rrif?.minimum).toBeCloseTo((600_000 - rrspDraw) * 0.0528, 6)
    expect(first.retirementSettlement?.rrif?.incomeKind).toBe('rrifWithdrawal')
  })

  it('stops before posting an uncarried minimum surplus, keeping the rollover and prefix intact', () => {
    const { plan, evidence } = scenario({ spending: 10_000 })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(prefix.blocked).toBeNull()
    expect(prefix.state.byAccount[RRSP].balance).toBe(600_000)
    const result = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(result).toMatchObject({ blocked: { status: 'unsupported', year: firstDrawYear,
      issues: [{ detail: expect.stringMatching(/RRIF.*surplus.*persistent cash/i) }] },
    uncomputedYears: [nextDrawYear], overallConclusionAvailable: false })
    expect(result.rows).toEqual(prefix.rows)
    expect(result.state).toEqual(prefix.state)
    const sheet = canonicalAnnualSheet(result, context)
    const cashTax = findRow(sheet.rows, canonicalSheetId('value', 'cash', 'tax'))!
    for (const year of [firstDrawYear, nextDrawYear]) {
      expect(cashTax.cells?.[year]).toMatchObject({ value: null, status: 'not-computed' })
    }
    expect(annualSheetText(cashTax.cells![firstDrawYear].reason!, 'en')).toMatch(/persistent cash destination/i)
  })

  it('settles exact after-tax minimum spending and stops when spending is one cent lower', () => {
    const draw = 31_680
    // At this income the model uses the pinned 2026 first brackets and $300
    // health premium. Its Ontario tax estimate omits the low-income reduction.
    const tax = 1_395.7265
    const spending = 30_284.2735
    const exact = scenario({ spending })
    const accepted = ok(projectCanonicalCoverage(exact.plan, exact.evidence, 4))
    expect(accepted.blocked).toBeNull()
    assertCash(accepted.rows[3], spending, draw, 0, tax)
    const centLess = scenario({ spending: spending - 0.01 })
    const prefix = ok(projectCanonicalCoverage(centLess.plan, centLess.evidence, 3))
    const stopped = ok(projectCanonicalCoverage(centLess.plan, centLess.evidence, 5))
    expect(stopped).toMatchObject({ rows: prefix.rows, state: prefix.state,
      blocked: { year: firstDrawYear, status: 'unsupported', issues: [{ detail: expect.stringMatching(/surplus/i) }] },
      uncomputedYears: [nextDrawYear] })
  })
})

describe('RRIF scope and entry-point compatibility', () => {
  it.each<[string, Partial<Account>, number]>([
    ['existing RRIF', { kind: 'rrif', rrifFactorCategory: known('allOther') }, 0],
    ['spousal RRSP', { kind: 'spousalRrsp' }, 0],
    ['locked-in LIRA', { kind: 'lira', jurisdiction: 'ON' }, 0],
    ['locked-in LIF', { kind: 'lif', jurisdiction: 'ON' }, 0],
    ['explicit opening election', { rrifAgeElection: { personId: RETIREE, electedAtOpening: true } }, 2],
    ['known qualifying category', { rrifFactorCategory: known('qualifying') }, 2],
  ])('stops for %s without committing that year', (_label, facts, years) => {
    const { plan, evidence } = scenario()
    Object.assign(plan.accounts.find(account => account.id === RRSP)!, facts)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, years))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(result.blocked).toMatchObject({ year: 2026 + years, status: 'unsupported' })
    expect(result.uncomputedYears).toEqual([2027, 2028, 2029, 2030].filter(year => year > 2026 + years))
    expect(result.rows).toEqual(prefix.rows)
    expect(result.state).toEqual(prefix.state)
    expect(result.state.rrifConversions).toBeUndefined()
  })

  it.each([['constructor', 'toString'], ['toString', 'constructor']])(
    'settles a migration-shaped RRSP %s and TFSA %s with stable own keys', (rrspId, tfsaId) => {
      const { plan, evidence } = scenario()
      for (const account of plan.accounts) {
        account.id = account.kind === 'rrsp' ? rrspId : tfsaId
        account.rrifFactorCategory = { status: 'unknown', reason: 'RRIF factor category not confirmed' }
        account.rrifAgeElection = null
      }
      const result = ok(projectCanonicalCoverage(plan, evidence, 4))
      expect(result.blocked).toBeNull()
      expect(Object.keys(result.state.rrifConversions ?? {})).toEqual([rrspId])
      const row = result.rows[3]
      expect(Object.getPrototypeOf(row.byAccount)).toBe(Object.prototype)
      expect(row.byAccount[tfsaId]).not.toHaveProperty('openingKind')
      expect(row.retirementSettlement?.rrif).toMatchObject({ accountId: rrspId, minimum: 31_680,
        conversion: { factorCategory: 'allOther', amount: 600_000, ownerId: RETIREE } })
    },
  )

  it('keeps the pre-existing __proto__ working-year boundary atomic', () => {
    const { plan, evidence } = scenario()
    plan.accounts.find(account => account.id === TFSA)!.id = '__proto__'
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 0))
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(Object.hasOwn(prefix.state.byAccount, '__proto__')).toBe(true)
    expect(result).toMatchObject({ blocked: { year: 2026, status: 'invalid' }, rows: [], state: prefix.state })
  })

  it('keeps provider shape and strict APIs independent of authentic or forged conversion state', () => {
    const { plan, evidence } = scenario()
    const rolled = ok(projectCanonicalCoverage(plan, evidence, 3))
    const standalone = retirementPlan({ age: 71, rrsp: 600_000, tfsa: 150_000 })
    const opening = ok(initializeState(standalone))
    const never = { evaluate: vi.fn(), returns: vi.fn() }
    expect(annualRetirementStep(standalone, opening, never.returns)).toMatchObject({ status: 'unsupported', issues: [{ detail: expect.stringMatching(/age-71/) }] })
    expect(annualRetirementContinuation(plan, rolled.state)).toMatchObject({ status: 'invalid' })
    expect(projectRetirementCoverage(plan, rolled.state, 0, never.returns)).toMatchObject({ status: 'invalid' })

    const providerPlan = retirementPlan({ age: 69, rrsp: 600_000, tfsa: 150_000 })
    providerPlan.people[0].retirementAge = 74
    const providerOpening = ok(initializeState(providerPlan))
    const providers = {
      evaluate: () => ({ byPerson: { [RETIREE]: { income: 0, earnedIncome: 0, benefits: 0, tax: 0,
        spending: 0, taxableIncome: 0, benefitIncomeForNextYear: known(0) } } }),
      returns: () => 0,
    }
    const normal = ok(projectAnnualCoverage(providerPlan, providerOpening, 1, providers))
    expect(normal.blocked).toBeNull()
    expect(normal.rows[0].byAccount).toEqual({
      [RRSP]: { opening: 600_000, closing: 600_000, withdrawal: 0, contribution: 0, returnAmount: 0, acb: known(0), ownerId: RETIREE },
      [TFSA]: { opening: 150_000, closing: 150_000, withdrawal: 0, contribution: 0, returnAmount: 0, acb: known(0), ownerId: RETIREE },
    })
    expect(Object.getPrototypeOf(normal.rows[0].byAccount)).toBe(Object.prototype)
    const sheet = canonicalAnnualSheet(normal, context)
    expect(findRow(sheet.rows, canonicalSheetId('value', 'account', RRSP, 'rrif', 'minimum'))).toBeUndefined()
    const accountOpening = findRow(sheet.rows, canonicalSheetId('value', 'account', RRSP, 'opening'))!.cells![2026]
    expect(sheet.resolveExplanation?.(accountOpening.explanationRefs![0])?.sources ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'kind' }),
    ]))
    const providerPrefix = ok(projectFromState(providerPlan, providerOpening, 2, providers))
    const providerStop = ok(projectAnnualCoverage(providerPlan, providerOpening, 4, providers))
    expect(providerStop).toMatchObject({ rows: providerPrefix.rows, state: providerPrefix.state,
      blocked: { year: setupYear, status: 'unsupported', causes: ['registeredConversion'] }, uncomputedYears: [firstDrawYear] })
    expect(projectFromState(providerPlan, providerOpening, 4, providers)).toEqual({ status: 'unsupported', issues: providerStop.blocked!.issues })
    const forged = { ...rolled.state, byPerson: { [RETIREE]: { ...rolled.state.byPerson[RETIREE], retirementAge: 74 } } }
    const rejected = { status: 'invalid', issues: [{ detail: expect.stringMatching(/RRIF.*authenticated/i) }] }
    expect(annualStep(providerPlan, forged, never)).toMatchObject(rejected)
    expect(projectAnnualCoverage(providerPlan, forged, 0, never)).toMatchObject(rejected)
    expect(projectFromState(providerPlan, forged, 1, never)).toMatchObject(rejected)
    expect(never.evaluate).not.toHaveBeenCalled()
    expect(never.returns).not.toHaveBeenCalled()
  })

  it('preserves the legacy minimum and reinvestment through the projection and annual detail path used by the app', () => {
    const inputs = legacyRetirement({ currentAge: 71, fireAge: 71, lifeExpectancy: 73, retirementSpending: 0,
      balances: { tfsa: 0, rrsp: 100_000, nonReg: 0 }, strategy: 'tfsaFirst' })
    const plan = retirementPlan({ age: 71, rrsp: 100_000, tfsa: 0, spending: 0, strategy: 'tfsaFirst' })
    const plain = runProjection(inputs, undefined, plan)
    const observed = runProjection(inputs, undefined, plan, { captureAnnualDetails: true })
    expect({ ...observed, rows: observed.rows.map(({ annualDetails: _detail, ...row }) => row) }).toEqual(plain)
    const [setup, first, next] = observed.rows
    expect(setup.withdrawals.rrsp).toBe(0)
    expect(first.withdrawals.rrsp).toBe(5_280)
    expect(next.withdrawals.rrsp).toBeCloseTo(94_720 * 0.054, 6)
    expect(first.balances.nonReg).toBeCloseTo(5_280, 6)
    const sheet = legacyAnnualSheet(observed, inputs, context)
    expect(findRow(sheet.rows, canonicalSheetId('value', 'account', RRSP, 'rrif', 'minimum'))).toBeUndefined()
  })
})
