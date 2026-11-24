import { describe, expect, it, vi } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { annualRetirementContinuation, annualRetirementStep } from '../annualRetirement'
import {
  annualStep, initializeState, projectAnnualCoverage, projectCanonicalCoverage, projectFromState,
  sumInvestableAssets, sumNetWorth, type AnnualProviders, type KernelResult,
} from '../annualState'
import { evaluateCanonicalHouseholdWorkingYear, evaluateCanonicalWorkingYear } from '../annualWorking'
import { recordPropertySplit } from '../migration'
import type { InputsV2, Property } from '../model'
import { runProjection } from '../projection'
import { householdBenefitExclusions } from './fixtures/annualHouseholdOas'
import { BASE_YEAR, known, legacyRetirement, recorded, retirementPlan, RETIREE, RRSP, TFSA } from './fixtures/retirementSettlement'

const EARLY = RETIREE
const LATE = 'later-retiree'
const HOME = 'family-residence'
const VALUE = 630_000
const ACB = 280_000
const APPRECIATION = 0.037
const CPI = 1.025
const YEARS = 4
const CONTEXT = { scenarioId: 'household-held-home', revision: 1 }
const close = (amount: number) => expect.closeTo(amount, 6)

// Pinned 2026 Ontario and federal first brackets. The $40k wage pays
// a $450 health premium; the $12k wage falls below both basic amounts.
const earlyPayroll = 36_500 * 0.0595 + 40_000 * 0.0163
const earlyPayrollCredit = 36_500 * 0.0495 + 40_000 * 0.0163
const earlyTaxable = 40_000 - 365
const earlyTax = (earlyTaxable - 16_452 - earlyPayrollCredit - 1_501) * 0.14
  + (earlyTaxable - 12_989 - earlyPayrollCredit) * 0.0505 + 450
const latePayroll = 8_500 * 0.0595 + 12_000 * 0.0163
const working = 52_000 - earlyPayroll - latePayroll - earlyTax
const mixed = 12_000 - latePayroll + 8_500 + 3_000
const retired = 8_500 + 7_500 + 6_000
const liquidOpening = 14_000

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function findRow(rows: AnnualSheetRow[], id: string): AnnualSheetRow {
  const row = rows.find(row => row.id === id)
    ?? rows.flatMap(row => row.children ?? []).find(row => row.id === id)
  if (!row) throw new Error(`Missing annual sheet row ${id}`)
  return row
}

function homeWith(shares: Record<string, number>): Property {
  return {
    id: HOME, kind: 'principal', value: VALUE, acb: known(ACB), annualRent: known(0), appreciation: APPRECIATION,
    sellAtAge: null, plannedPurchaseAge: null, plannedDownPayment: null, plannedMortgage: null,
    annualHoldingCostChange: 0, mortgageDebtId: null, taxableOwnerShares: { status: 'known', shares },
    provenance: { value: recorded, acb: recorded, annualRent: recorded, taxableOwnerShares: recorded },
  }
}

function fixture(title: 'self' | 'partner' | 'split' = 'split', selfRetiresFirst = true, reverseArrays = false) {
  const plan = retirementPlan({ age: 64, tfsa: liquidOpening, rrsp: 0, inflation: 0.025, strategy: 'tfsaFirst' })
  const early = plan.people[0]
  Object.assign(early, { retirementAge: 65, earnedIncome: known(40_000), oasAnnualAt65: 8_500 })
  const late = {
    ...structuredClone(early), id: LATE, role: 'partner' as const, ageInBaseYear: 63,
    earnedIncome: known(12_000), oasAnnualAt65: 7_500,
  }
  plan.people.push(late)
  if (!selfRetiresFirst) {
    early.role = 'partner'
    plan.people[1].role = 'self'
  }
  const self = plan.people.find(person => person.role === 'self')!
  const partner = plan.people.find(person => person.role === 'partner')!
  for (const person of plan.people) {
    plan.incomeSources.push({ id: `${person.id}:oas`, kind: 'oas', recipientId: person.id,
      startAge: 65, annualAmount: known(person.oasAnnualAt65), provenance: recorded })
  }
  plan.annualBenefitsEvidence = {
    [EARLY]: householdBenefitExclusions(EARLY), [LATE]: householdBenefitExclusions(LATE),
  }
  plan.tfsaStatement![LATE] = { withdrawals: [], provenance: recorded }
  const emptyRrsp = plan.accounts.find(account => account.id === RRSP)!
  emptyRrsp.ownerId = LATE
  emptyRrsp.taxableOwnerShares = { status: 'known', shares: { [LATE]: 1 } }
  plan.taxProfile = { spouseSupported: known(false), pensionSplit: null }
  plan.budget = { kind: 'incomeBudget', workingSpending: working, retirementSpending: retired }
  plan.lifeExpectancy = self.ageInBaseYear + 4
  plan.legacyProjection = legacyRetirement({
    currentAge: self.ageInBaseYear, fireAge: self.retirementAge, lifeExpectancy: plan.lifeExpectancy,
    retirementSpending: retired, inflation: plan.inflation, strategy: plan.strategy,
    balances: { tfsa: liquidOpening, rrsp: 0, nonReg: 0 }, oasAnnualAt65: self.oasAnnualAt65,
    partner: { currentAge: partner.ageInBaseYear, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: partner.oasAnnualAt65 },
    principalResidence: { value: VALUE, appreciation: APPRECIATION, sellAtAge: null },
  })
  const shares = title === 'split'
    ? Object.fromEntries((reverseArrays ? [[LATE, 0.625], [EARLY, 0.375]] : [[EARLY, 0.375], [LATE, 0.625]]))
    : { [title === 'self' ? self.id : partner.id]: 1 }
  const home = homeWith(shares)
  plan.properties.push(home)
  if (reverseArrays) {
    plan.people.reverse()
    plan.accounts.reverse()
    plan.incomeSources.reverse()
  }
  return { plan, home, self, evidence: {
    workingSpending: known(working), transitionSpending: known(mixed), retirementSpending: known(retired),
  } }
}

const orders = [true, false].flatMap(selfRetiresFirst => [false, true].map(reverseArrays => ({
  selfRetiresFirst, reverseArrays,
})))
const cases = (['self', 'partner', 'split'] as const).flatMap(title => orders.map(order => ({ title, ...order })))
const saleMessages = [
  { locale: 'en', unavailable: /household.*sale.*unsupported/i, clock: /self member’s clock/i, suffix: 'Not computed after the first blocked year.' },
  { locale: 'fr', unavailable: /vente.*ménage.*pas pris en charge/i, clock: /âge du membre principal/i, suffix: 'Non calculé après la première année bloquée.' },
  { locale: 'zh', unavailable: /尚不支持家庭住宅出售/, clock: /本人达到/, suffix: '首个受阻年度之后未计算。' },
] as const
const legacySaleReason = {
  en: 'This sale requires supported property, account and benefit conditions, explicit user sale designation, known fees and ACB, and a post-sale living budget. Losses and other unsupported sale conditions stop this year.',
  fr: 'Cette vente exige des conditions prises en charge pour le bien, les comptes et prestations, une désignation explicite, des frais et un PBR connus et un budget après vente. Une perte ou autre condition non prise en charge bloque cette année.',
  zh: '此次出售需要受支持的房产、账户及福利条件、用户明确指定、已知费用和成本基础及售后生活预算。亏损或其他未受支持的出售条件会使本年度停止计算。',
}

describe('FE-53 independently calculated household held home', () => {
  it.each(cases)('carries $title title with self-first=$selfRetiresFirst and reversed=$reverseArrays', ({ title, selfRetiresFirst, reverseArrays }) => {
    const { plan, evidence } = fixture(title, selfRetiresFirst, reverseArrays)
    const before = structuredClone({ plan, evidence })
    const baseline = ok(projectCanonicalCoverage({ ...plan, properties: [] }, evidence, YEARS))
    const coverage = ok(projectCanonicalCoverage(plan, evidence, YEARS))
    expect(baseline.blocked).toBeNull()
    expect(coverage).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false,
      evaluationBasis: 'canonical-continuous' })
    expect(coverage.rows.map(row => row.year)).toEqual([2026, 2027, 2028, 2029])
    const sheet = canonicalAnnualSheet(coverage, CONTEXT)
    const phases = ['both-working', 'mixed', 'both-retired', 'both-retired']
    const funded = [working, mixed, retired, retired - 1_000]
    const closingLiquid = [14_000, 11_000, 5_000, 0]
    const draws = [0, 3_000, 6_000, 5_000]

    for (const [index, row] of coverage.rows.entries()) {
      const start = CPI ** index
      const end = CPI ** (index + 1)
      const opening = VALUE * ((1 + APPRECIATION) * CPI) ** index
      const closing = VALUE * ((1 + APPRECIATION) * CPI) ** (index + 1)
      const liquid = closingLiquid[index] * end
      const [earlyOas, lateOas] = [index >= 1 ? 8_500 : 0, index >= 2 ? 7_500 : 0]
      expect({ ...row, byProperty: {} }).toEqual(baseline.rows[index])
      expect(row).toMatchObject({
        workingSettlement: { household: { phase: phases[index], byPerson: {
          [EARLY]: { phase: index >= 1 ? 'retired' : 'working' },
          [LATE]: { phase: index >= 2 ? 'retired' : 'working' },
        } } },
        byPerson: {
          [EARLY]: { age: 64 + index, oasNet: close(earlyOas * start), spending: 0 },
          [LATE]: { age: 63 + index, oasNet: close(lateOas * start), spending: 0 },
        },
        taxLedger: {
          [EARLY]: { taxableIncome: close(index ? earlyOas * start : earlyTaxable), tax: close(index ? 0 : earlyTax) },
          [LATE]: { taxableIncome: close((index < 2 ? 11_915 : lateOas) * start), tax: 0 },
        },
        cashLedger: { benefits: close((earlyOas + lateOas) * start), spending: close(funded[index] * start), debtPayments: 0 },
        byAccount: { [TFSA]: { ownerId: EARLY, withdrawal: close(draws[index] * start), closing: close(liquid) } },
      })
      if (index > 0) expect(row.householdWithdrawalSettlement).toMatchObject({
        ownerId: EARLY, spendingDue: close((index === 1 ? mixed : retired) * start),
        spendingFunded: close(funded[index] * start), spendingUnmet: close(index === 3 ? 1_000 * start : 0),
      })
      expect(row.byProperty).toEqual({ [HOME]: {
        held: true, opening: close(opening), closing: close(closing), growth: close(closing - opening),
      } })
      if (index > 0) expect(row.byProperty[HOME].opening).toBe(coverage.rows[index - 1].byProperty[HOME].closing)
      const state = ok(projectCanonicalCoverage(plan, evidence, index + 1)).state
      expect(state.byProperty).toEqual({ [HOME]: { held: true, value: row.byProperty[HOME].closing, acb: known(ACB) } })
      expect(sumInvestableAssets(state)).toBeCloseTo(liquid, 6)
      expect(sumNetWorth(state)).toBeCloseTo(liquid + closing, 6)

      const year = sheet.years[index]
      const cell = (...path: string[]) => findRow(sheet.rows, canonicalSheetId('value', ...path)).cells![row.year]
      const property = cell('property', HOME, 'closing')
      expect(property).toMatchObject({ value: close(closing), timing: 'closing', basis: 'nominal-CAD' })
      expect(annualSheetDisplayValue(property, year, 'real')).toBeCloseTo(VALUE * (1 + APPRECIATION) ** (index + 1), 6)
      expect(annualSheetDisplayValue(cell('property', HOME, 'opening'), year, 'real')).toBeCloseTo(opening / start, 6)
      expect(annualSheetDisplayValue(cell('property', HOME, 'growth'), year, 'real')).toBeCloseTo((closing - opening) / start, 6)
      expect(cell('assets').value).toBeCloseTo(liquid, 6)
      expect(cell('netWorth').value).toBeCloseTo(liquid + closing, 6)
      expect(annualSheetDisplayValue(cell('netWorth'), year, 'real')).toBeCloseTo((liquid + closing) / end, 6)
    }
    expect({ ...coverage.state, byProperty: {} }).toEqual(baseline.state)
    expect({ plan, evidence }).toEqual(before)
  })

  it.each(orders.flatMap(order => [0, 1, 2].map(saleOffset => ({ ...order, saleOffset }))))(
    'stops atomically at self clock +$saleOffset with self-first=$selfRetiresFirst and reversed=$reverseArrays',
    ({ selfRetiresFirst, reverseArrays, saleOffset }) => {
      const { plan, home, self, evidence } = fixture('partner', selfRetiresFirst, reverseArrays)
      const full = ok(projectCanonicalCoverage(plan, evidence, YEARS))
      expect(full.blocked).toBeNull()
      home.sellAtAge = self.ageInBaseYear + saleOffset
      const stopped = ok(projectCanonicalCoverage(plan, evidence, YEARS))
      const prefix = ok(projectCanonicalCoverage(plan, evidence, saleOffset))
      const saleYear = BASE_YEAR + saleOffset
      expect(prefix.blocked).toBeNull()
      expect(stopped).toMatchObject({
        blocked: { year: saleYear, status: 'unsupported', causes: ['propertySale'] },
        uncomputedYears: [2027, 2028, 2029].filter(year => year > saleYear), overallConclusionAvailable: false,
      })
      expect(stopped.rows).toEqual(prefix.rows)
      expect(stopped.rows).toEqual(full.rows.slice(0, saleOffset))
      expect(stopped.state).toEqual(prefix.state)
      expect(stopped.state.year).toBe(saleYear)
      expect(stopped.state.byProperty[HOME]).toEqual({
        held: true, acb: known(ACB), value: full.rows[saleOffset].byProperty[HOME].opening,
      })
      const sheet = canonicalAnnualSheet(stopped, CONTEXT)
      for (const path of [['property', HOME, 'closing'], ['netWorth'], ['cash', 'spending'], ['account', TFSA, 'withdrawal']]) {
        const cells = findRow(sheet.rows, canonicalSheetId('value', ...path)).cells!
        if (saleOffset > 0) expect(cells[saleYear - 1].value).toEqual(expect.any(Number))
        for (let year = saleYear; year <= 2029; year++) {
          const cell = cells[year]
          expect(cell).toMatchObject({ value: null, status: 'not-computed' })
          const explanation = sheet.resolveExplanation!(cell.explanationRefs![0])!
          expect(explanation.sources?.[0].code).toBe(year === saleYear ? 'propertySale' : 'suffix')
          for (const { locale, unavailable, clock, suffix } of saleMessages) {
            const message = annualSheetText(cell.reason!, locale)
            expect(annualSheetText(explanation.summary!, locale)).toBe(message)
            if (year === saleYear) {
              expect(message).toMatch(unavailable)
              expect(message).toMatch(clock)
            } else {
              expect(message).toBe(suffix)
            }
          }
        }
      }
    },
  )
})

describe('FE-53 household held-home admission and existing entry points', () => {
  const recordedTitles = [
    { label: 'rounded split', selfAmount: 148_000, partnerAmount: 252_000.02 },
    { label: 'rounded split with swapped amounts', selfAmount: 252_000.02, partnerAmount: 148_000 },
    { label: 'sole self with partner zero', selfAmount: 400_000.02, partnerAmount: 0 },
    { label: 'sole partner with self zero', selfAmount: 0, partnerAmount: 400_000.02 },
  ]

  it.each(recordedTitles.flatMap(title => [false, true].map(reverseArrays => ({ ...title, reverseArrays }))))(
    'carries the form-recorded $label with reversed=$reverseArrays',
    ({ selfAmount, partnerAmount, reverseArrays }) => {
      const { plan, home, evidence, self } = fixture('split', true, reverseArrays)
      home.value = 400_000.02
      home.taxableOwnerShares = { status: 'unknown', reason: 'Title awaiting entry' }
      plan.migration.ownershipNeedsConfirmation = true
      const partner = plan.people.find(person => person.role === 'partner')!
      const confirmed = recordPropertySplit(plan, HOME, selfAmount, partnerAmount)
      const shares = { [self.id]: selfAmount / home.value, [partner.id]: partnerAmount / home.value }
      if (selfAmount && partnerAmount) {
        expect(shares[self.id] + shares[partner.id]).toBe(0.9999999999999999)
      }
      const title = { status: 'known', shares }
      expect(confirmed.properties[0].taxableOwnerShares).toEqual(title)
      expect(confirmed.migration.ownershipNeedsConfirmation).toBe(false)
      const coverage = ok(projectCanonicalCoverage(confirmed, evidence, YEARS))
      const baseline = ok(projectCanonicalCoverage({ ...confirmed, properties: [] }, evidence, YEARS))
      expect(coverage.blocked).toBeNull()
      expect(coverage.rows.map(row => ({ ...row, byProperty: {} }))).toEqual(baseline.rows)
      expect(sumNetWorth(coverage.state) - sumInvestableAssets(coverage.state))
        .toBeCloseTo(home.value * ((1 + APPRECIATION) * CPI) ** YEARS, 6)
      expect(confirmed.properties[0].taxableOwnerShares).toEqual(title)
    },
  )

  const excluded: [string, (plan: InputsV2, home: Property) => void][] = [
    ['missing value source', (_, home) => { delete home.provenance.value }],
    ['estimated value source', (_, home) => { home.provenance.value = { ...recorded, origin: 'estimated' } }],
    ['unknown value source', (_, home) => { home.provenance.value = { ...recorded, origin: 'unknown' } }],
    ['almost whole title', (_, home) => {
      home.taxableOwnerShares = { status: 'known', shares: { [EARLY]: 0.375, [LATE]: 0.625 - 1e-9 } }
    }],
    ['sole title a unit of roundoff short of one', (_, home) => {
      home.taxableOwnerShares = { status: 'known', shares: { [EARLY]: 0.9999999999999999, [LATE]: 0 } }
    }],
    ['overallocated split inside the general shape tolerance', (_, home) => {
      home.taxableOwnerShares = { status: 'known', shares: { [EARLY]: 0.375, [LATE]: 0.625 + 1e-9 } }
    }],
    ['whole self title plus a positive partner share that rounds away', (_, home) => {
      home.taxableOwnerShares = { status: 'known', shares: { [EARLY]: 1, [LATE]: 2 ** -54 } }
    }],
    ['a positive self share that rounds away plus whole partner title', (_, home) => {
      home.taxableOwnerShares = { status: 'known', shares: { [EARLY]: 2 ** -54, [LATE]: 1 } }
    }],
    ['a second residence', (plan, home) => { plan.properties.push({ ...home, id: 'other-home' }) }],
    ['an investment property', (_, home) => { home.kind = 'investment' }],
    ['positive rent', (_, home) => { home.annualRent = known(450) }],
    ['unknown rent', (_, home) => { home.annualRent = { status: 'unknown', reason: 'No rent evidence' } }],
    ['future purchase', (_, home) => { home.plannedPurchaseAge = 66 }],
    ['planned down payment', (_, home) => { home.plannedDownPayment = 0 }],
    ['planned mortgage', (_, home) => {
      home.plannedMortgage = { principal: 25_000, annualPayment: 5_500, yearsRemaining: 5 }
    }],
    ['holding-cost change', (_, home) => { home.annualHoldingCostChange = -50 }],
    ['unrelated debt', plan => {
      plan.debts.push({ id: 'car', kind: 'carLoan', propertyId: null, principal: 500, annualPayment: 500,
        yearsRemaining: 1, provenance: recorded })
    }],
    ['linked mortgage', (plan, home) => {
      home.mortgageDebtId = 'lien'
      plan.debts.push({ id: 'lien', kind: 'mortgage', propertyId: HOME, principal: 25_000,
        annualPayment: 5_500, yearsRemaining: 5, provenance: recorded })
    }],
  ]

  it.each(excluded)('refuses %s at the opening year without posting', (_, mutate) => {
    const { plan, home, evidence } = fixture()
    mutate(plan, home)
    const before = structuredClone(plan)
    const result = ok(projectCanonicalCoverage(plan, { ...evidence, scheduledMortgagePaymentsExcluded: known(true as const) }, 3))
    expect(result).toMatchObject({
      rows: [], state: ok(initializeState(plan)), uncomputedYears: [2027, 2028], overallConclusionAvailable: false,
      blocked: { year: BASE_YEAR, status: 'unsupported', issues: [{ detail: expect.stringMatching(/household passive home/i) }] },
    })
    expect(plan).toEqual(before)
  })

  it.each([
    ['an absent person', { outside: 1 }],
    ['an empty record', {}],
    ['a nonfinite share', { [EARLY]: Infinity, [LATE]: 0 }],
    ['a nonnumeric share', { [EARLY]: '1' }],
    ['an out-of-range offsetting split', { [EARLY]: 1.25, [LATE]: -0.25 }],
  ])('rejects malformed title with %s', (_, shares) => {
    const { plan, home, evidence } = fixture()
    Reflect.set(home.taxableOwnerShares, 'shares', shares)
    expect(projectCanonicalCoverage(plan, evidence, 3)).toEqual({
      status: 'invalid', issues: [{ code: 'invalid', detail: 'canonical plan shape' }],
    })
  })

  it('rejects malformed value provenance and retains the opening unknown-title pricing gate', () => {
    const { plan, home, evidence } = fixture()
    Reflect.set(home.provenance, 'value', { origin: 'user', sourceYear: '2026' })
    expect(projectCanonicalCoverage(plan, evidence, 3)).toEqual({
      status: 'invalid', issues: [{ code: 'invalid', detail: 'canonical plan shape' }],
    })
    home.provenance.value = recorded
    home.taxableOwnerShares = { status: 'unknown', reason: 'Title not yet recorded' }
    expect(projectCanonicalCoverage(plan, evidence, 3)).toEqual({
      status: 'unsupported', issues: [{ code: 'unsupported', detail: 'pricing gate: ownershipUnknown' }],
    })
  })

  it('carries recorded legacy value and leaves unknown ACB as supplied', () => {
    const { plan, home, evidence } = fixture()
    home.provenance.value = { origin: 'legacy', sourceYear: null }
    home.acb = { status: 'unknown', reason: 'Old home purchase statement unavailable' }
    const result = ok(projectCanonicalCoverage(plan, evidence, YEARS))
    expect(result.blocked).toBeNull()
    expect(result.state.byProperty[HOME]).toMatchObject({ held: true, acb: home.acb })
  })

  it('does not grant public working quotes or standalone retirement access through returned states', () => {
    const { plan, evidence } = fixture()
    const publicPlan = { ...plan, annualBenefitsEvidence: undefined, incomeSources: [],
      people: plan.people.map(person => ({ ...person, oasAnnualAt65: 0 })) }
    expect(evaluateCanonicalHouseholdWorkingYear({ ...publicPlan, properties: [] }, evidence, BASE_YEAR).status).toBe('ok')
    const houseIssue = { status: 'unsupported', issues: [{ code: 'unsupported', detail: 'working dependents/property/debt pricing not yet wired' }] }
    const initial = ok(initializeState(publicPlan))
    expect(evaluateCanonicalHouseholdWorkingYear(publicPlan, evidence, BASE_YEAR)).toEqual(houseIssue)
    expect(evaluateCanonicalHouseholdWorkingYear(publicPlan, evidence, BASE_YEAR, initial)).toEqual(houseIssue)
    const returned = ok(projectCanonicalCoverage(plan, evidence, 1)).state
    for (const supplied of [returned, structuredClone(returned)]) {
      expect(evaluateCanonicalHouseholdWorkingYear(plan, evidence, supplied.year, supplied)).toEqual(houseIssue)
    }
    const retiredState = ok(projectCanonicalCoverage(plan, evidence, 2)).state
    const returns = vi.fn(() => 0)
    expect(annualRetirementContinuation(plan, retiredState, evidence)).toMatchObject({ status: 'invalid' })
    expect(annualRetirementStep(plan, retiredState, returns)).toMatchObject({ status: 'unsupported' })
    expect(returns).not.toHaveBeenCalled()
  })

  it('preserves provider-supplied home growth, sale-prefix behavior, and strict API refusal', () => {
    const { plan, home, self } = fixture('partner', false, false)
    for (const person of plan.people) person.retirementAge = 69
    plan.budget = { kind: 'savingsBudget', annualNetSavings: 0, retirementSpending: 0,
      debtIncluded: known(true), taxBenefitIncluded: known(true) }
    delete home.provenance.value
    home.sellAtAge = self.ageInBaseYear + 1
    const opening = ok(initializeState(plan))
    const before = structuredClone(opening)
    const evaluate = vi.fn(() => ({ byPerson: Object.fromEntries(plan.people.map(person => [person.id, {
      income: 100, earnedIncome: 100, benefits: 0, tax: 20, spending: 80, taxableIncome: 100,
      benefitIncomeForNextYear: known(100),
    }])) }))
    const providers: AnnualProviders = { evaluate, returns: () => 0 }
    const supplied = ok(projectAnnualCoverage(plan, opening, 3, providers))
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(supplied).toMatchObject({
      evaluationBasis: 'provider-supplied', blocked: { year: 2027, status: 'unsupported', causes: ['propertySale'] },
      uncomputedYears: [2028], overallConclusionAvailable: false,
    })
    expect(supplied.rows).toHaveLength(1)
    const [row] = supplied.rows
    expect(row.workingSettlement).toBeUndefined()
    expect(row.cashLedger).toMatchObject({ income: 200, tax: 40, spending: 160, benefits: 0, debtPayments: 0 })
    expect(row.byProperty).toEqual({ [HOME]: { held: true, opening: VALUE, closing: close(VALUE * (1 + APPRECIATION) * CPI),
      growth: close(VALUE * ((1 + APPRECIATION) * CPI - 1)) } })
    expect(ok(annualStep(plan, opening, providers))).toEqual({ state: supplied.state, row })
    const blocked = supplied.blocked!
    expect(projectFromState(plan, opening, 3, providers)).toEqual({ status: blocked.status, issues: blocked.issues })
    expect(opening).toEqual(before)
    const sheet = canonicalAnnualSheet(supplied, CONTEXT)
    const cells = findRow(sheet.rows, canonicalSheetId('value', 'property', HOME, 'closing')).cells!
    expect(cells[2027].reason).toEqual(legacySaleReason)
    for (const { locale, suffix } of saleMessages) {
      expect(annualSheetText(cells[2028].reason!, locale)).toBe(suffix)
    }
  })

  it('keeps the solo continuous home and strict solo quote boundaries', () => {
    const plan = retirementPlan({ age: 58, inflation: 0.025, spending: 1_500, tfsa: 10_000, rrsp: 0 })
    plan.people[0].retirementAge = 59
    plan.budget = { kind: 'incomeBudget', workingSpending: 0, retirementSpending: 1_500 }
    plan.properties.push(homeWith({ [RETIREE]: 1 }))
    const evidence = { workingSpending: known(0), retirementSpending: known(1_500) }
    const baseline = ok(projectCanonicalCoverage({ ...plan, properties: [] }, evidence, 2))
    const held = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(held.blocked).toBeNull()
    expect(held.rows.map(row => ({ ...row, byProperty: {} }))).toEqual(baseline.rows)
    expect(held.rows[1].retirementSettlement).toMatchObject({ spendingFunded: close(1_500 * CPI) })
    expect(held.state.byProperty[HOME].value).toBeCloseTo(VALUE * ((1 + APPRECIATION) * CPI) ** 2, 6)
    expect(evaluateCanonicalWorkingYear(plan, evidence)).toMatchObject({ status: 'unsupported' })
    plan.properties[0].sellAtAge = 58
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(stopped.blocked).toMatchObject({ year: BASE_YEAR, causes: ['propertySale'] })
    const sheet = canonicalAnnualSheet(stopped, CONTEXT)
    const cells = findRow(sheet.rows, canonicalSheetId('value', 'property', HOME, 'closing')).cells!
    expect(cells[2026].reason).toEqual(legacySaleReason)
    for (const { locale, suffix } of saleMessages) {
      expect(annualSheetText(cells[2027].reason!, locale)).toBe(suffix)
    }
  })

  it('preserves the generic evidence stop and suffix for a household without a property', () => {
    const { plan, evidence } = fixture()
    const stopped = ok(projectCanonicalCoverage({ ...plan, properties: [] }, {
      ...evidence, transitionSpending: undefined,
    }, YEARS))
    expect(stopped.blocked).toMatchObject({ year: 2027, status: 'unsupported', causes: ['unsupported'] })
    const sheet = canonicalAnnualSheet(stopped, CONTEXT)
    const cells = findRow(sheet.rows, canonicalSheetId('value', 'netWorth')).cells!
    expect(cells[2027].reason).toEqual({
      en: 'This year requires rules or facts not yet supported. Later years were not computed.',
      fr: 'Cette année nécessite des règles ou faits non pris en charge. Les années suivantes ne sont pas calculées.',
      zh: '本年度需要尚未支持的规则或事实，后续年度未计算。',
    })
    for (const { locale, suffix } of saleMessages) {
      expect(annualSheetText(cells[2028].reason!, locale)).toBe(suffix)
    }
  })

  it.each(['self', 'partner', 'split'] as const)('preserves the legacy production projection and sheet with %s title', title => {
    const { plan, evidence } = fixture(title)
    const inputs = plan.legacyProjection
    const baseline = { ...plan, properties: [] }
    const observed = runProjection(inputs, undefined, plan, { captureAnnualDetails: true })
    const ordinary = runProjection(inputs, undefined, plan)
    const legacy = runProjection(inputs, undefined, baseline, { captureAnnualDetails: true })
    expect(observed).toStrictEqual(legacy)
    expect({ ...observed, rows: observed.rows.map(({ annualDetails: _details, ...row }) => row) }).toStrictEqual(ordinary)
    expect(legacyAnnualSheet(observed, inputs, CONTEXT).rows).toStrictEqual(legacyAnnualSheet(legacy, inputs, CONTEXT).rows)
    const sampler = vi.fn(() => -0.07)
    const baselineSampler = vi.fn(() => -0.07)
    const sampled = runProjection(inputs, sampler, plan)
    expect(sampled).toStrictEqual(runProjection(inputs, baselineSampler, baseline))
    expect(sampler).toHaveBeenCalled()
    expect(sampler.mock.calls).toEqual(baselineSampler.mock.calls)
    const canonical = ok(projectCanonicalCoverage(plan, evidence, YEARS))
    expect(canonical.blocked).toBeNull()
    for (const [index, row] of observed.rows.slice(0, YEARS).entries()) {
      expect(row.propertyValue).toBeCloseTo(VALUE * (1 + APPRECIATION) ** (index + 1), 6)
      expect(canonical.rows[index].byProperty[HOME].closing / CPI ** (index + 1)).toBeCloseTo(row.propertyValue, 6)
      expect(row).toMatchObject({ rent: 0, debtPayment: 0, taxableBySource: { property: 0 } })
    }
  })
})
