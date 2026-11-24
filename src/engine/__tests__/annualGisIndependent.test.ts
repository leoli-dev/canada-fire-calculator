import { describe, expect, it } from 'vitest'
import { annualSheetDisplayValue, annualSheetText } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { initializeState, projectAnnualCoverage, projectCanonicalCoverage, type AnnualCoverage, type KernelResult } from '../annualState'
import { annualGis } from '../annualGis'
import { annualOas } from '../annualOas'
import type { InputsV2 } from '../model'
import { cppStart } from './fixtures/annualCpp'
import { BASE_YEAR, known, recorded, retirementPlan, RETIREE, RRSP, TFSA } from './fixtures/retirementSettlement'
import { staggeredReference } from './fixtures/staggeredHousehold'

// ESDC Oct–Dec 2026 Table 5 and footnote 6, pinned by CA-OAS-GIS-2026-Q4-v1.
// https://www.canada.ca/en/employment-social-development/programs/pensions/pension/statistics/2026-quarterly-october-december.html
const OAS = 762.50 * 12
const CPP = 4_800
const MAX_GIS = 1_138.90 * 12
const inflation = 0.02
const cpi = (year: number) => (1 + inflation) ** (year - BASE_YEAR)
const close = (amount: number) => expect.closeTo(amount, 5)

// OAS Act s. 2(a)(ii)–(iii), (b.1): deduct full employee CPP/EI and apply
// the fixed nominal employment exemption before converting the residual.
// https://laws-lois.justice.gc.ca/eng/acts/O-9/page-1.html
const wage = 12_000
const workingTaxable = wage - 85
const assessmentEmployment = 11_524.623 // ($12,000 − $505.75 CPP − $195.60 EI) × 1.02
const workExemption = 8_262.3115 // $5,000 + 50% × ($11,524.623 − $5,000)
const countableIncomeReal = (assessmentEmployment - workExemption) / 1.02
// These vectors sit on the second segment of the pinned solo GIS fit:
// 50% on the first $2,048 and 75% on the balance through $10,496.
const gis65 = MAX_GIS - 1_024 - 0.75 * (countableIncomeReal - 2_048)
const gis66NoDraw = MAX_GIS - 1_024 - 0.75 * (4_800 - 2_048)
const gis66WithDraw = MAX_GIS - 1_024 - 0.75 * (7_800 - 2_048)
const exclusion = { status: 'excluded' as const, reason: 'Payment excluded by the user', provenance: recorded }

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function scenario({ rrsp = 0, tfsa = 0, spending = 40_000, claimAge = 65, oas = OAS, cpp = CPP, wages = wage, baseAge = 63 }: {
  rrsp?: number; tfsa?: number; spending?: number; claimAge?: number; oas?: number; cpp?: number; wages?: number; baseAge?: number
} = {}) {
  const plan = retirementPlan({ age: baseAge, rrsp, tfsa, spending, inflation })
  const self = plan.people[0]
  Object.assign(self, { retirementAge: 65, cppAnnualAt65: cpp, oasAnnualAt65: oas, earnedIncome: known(wages) })
  self.provenance.earnedIncome = recorded
  plan.lifeExpectancy = 69
  if (cpp) plan.incomeSources.push(cppStart(RETIREE, 65, cpp))
  if (oas) plan.incomeSources.push({
    id: 'recorded-oas', kind: 'oas', recipientId: RETIREE, startAge: claimAge, annualAmount: known(oas), provenance: recorded,
  })
  const working = staggeredReference.working.self
  const workingSpending = wages === 40_000
    ? working.wage - working.payroll - working.tax
    : wages - Math.max(0, wages - 3_500) * 0.0595 - wages * 0.0163
  plan.budget = { kind: 'incomeBudget', workingSpending, retirementSpending: spending }
  plan.annualBenefitsEvidence = { [RETIREE]: { gis: exclusion, allowance: exclusion, otherBenefits: exclusion } }
  return { plan, evidence: { workingSpending: known(workingSpending), retirementSpending: known(spending) } }
}

function optIntoGis(plan: InputsV2, firstYear = 2028) {
  plan.annualBenefitsEvidence = { [RETIREE]: {
    gis: { ...exclusion, status: 'annual-estimate', reason: 'User supplied annual GIS eligibility' },
    allowance: exclusion, otherBenefits: exclusion,
  } }
  plan.annualGisEvidence = { [RETIREE]: Object.fromEntries([firstYear, firstYear + 1, firstYear + 2].map(year => [year, {
    eligible: true, residentInCanada: true, notSponsored: true, fullOasInPay: true, provenance: recorded,
  }])) }
}

function gisSheetRow(coverage: AnnualCoverage) {
  const sheet = canonicalAnnualSheet(coverage, { scenarioId: 'independent-gis', revision: 1 })
  const person = sheet.rows.find(row => row.id === canonicalSheetId('group', 'person', RETIREE))
  return { sheet, gis: person?.children?.find(row => row.id === canonicalSheetId('value', 'person', RETIREE, 'gis')) }
}

describe('independent Ontario solo annual GIS settlement vectors', () => {
  it('deducts full employee CPP and EI before applying the first-year nominal exemption', () => {
    const { plan, evidence } = scenario({ baseAge: 64, wages: 10_000 })
    optIntoGis(plan, 2027)
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    const [working, payment] = result.rows
    expect(working.payrollContributions).toBeCloseTo(386.75 + 163, 5)
    expect(working.taxLedger[RETIREE].taxableIncome).toBe(9_935)
    expect(payment.retirementSettlement?.gis).toMatchObject({
      assessmentYear: 2026, assessmentCpi: 1, workIncomeReal: close(9_450.25),
      workExemptionNominal: close(7_225.125), workExemptionReal: close(7_225.125), countableIncomeReal: close(2_225.125),
      amountReal: close(12_509.95625),
    })
    expect(payment.byPerson[RETIREE].gis).toBeCloseTo(12_509.95625 * 1.02, 5)
  })

  it('uses the prior committed CPI, excludes OAS and GIS from the next basis, and passes only accepted RRSP draws forward', () => {
    const runs = [0, 3_000].map(rrsp => {
      const { plan, evidence } = scenario({ rrsp, tfsa: 2_000 })
      optIntoGis(plan)
      const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
      expect(prefix.blocked).toBeNull()
      expect(prefix.state.gisAssessmentLag?.[RETIREE]).toMatchObject({
        status: 'known', value: {
          assessmentYear: 2027, incomeNominal: close(assessmentEmployment),
          employmentNetPayrollNominal: close(assessmentEmployment), workPolicy: 'employment-only-net-cpp-ei',
        },
      })
      const coverage = ok(projectCanonicalCoverage(plan, evidence, 5))
      expect(coverage.rows.slice(0, 2)).toEqual(prefix.rows)
      return coverage
    })
    for (const [index, result] of runs.entries()) {
      expect(result).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false })
      const [age63, age64, age65, age66, age67] = result.rows
      expect(age63.cashLedger.benefits).toBe(0)
      expect(age64).toMatchObject({ byPerson: { [RETIREE]: { earnedIncome: close(wage * cpi(2027)) } },
        taxLedger: { [RETIREE]: { taxableIncome: close(workingTaxable * cpi(2027)) } }, cashLedger: { benefits: 0 } })
      expect(age65.retirementSettlement?.gis).toMatchObject({
        amountReal: close(gis65), assessmentYear: 2027, assessmentCpi: cpi(2027),
        grossIncomeReal: close(assessmentEmployment / 1.02), workIncomeReal: close(assessmentEmployment / 1.02),
        workExemptionNominal: close(workExemption), workExemptionReal: close(workExemption / 1.02), countableIncomeReal: close(countableIncomeReal),
        rulePackId: 'CA-OAS-GIS-2026-Q4-v1', paymentPeriod: '2026-10/2026-12',
        policy: 'annualized-pinned-quarter-prior-year-original-cpi',
      })
      expect(age65.byPerson[RETIREE].gis).toBeCloseTo(12_255.9552225, 6)
      const rrspDraw = index * 3_000
      expect(age66.retirementSettlement?.gis).toMatchObject({
        assessmentYear: 2028, assessmentCpi: cpi(2028), grossIncomeReal: close(CPP + rrspDraw),
        workIncomeReal: 0, workExemptionReal: 0, countableIncomeReal: close(CPP + rrspDraw),
      })
      expect(age67.retirementSettlement?.gis).toMatchObject({ assessmentYear: 2029, grossIncomeReal: close(CPP) })
      for (const [row, gis, rrsp, tfsa] of [
        [age65, gis65, rrspDraw, 2_000],
        [age66, index ? gis66WithDraw : gis66NoDraw, 0, 0],
        [age67, gis66NoDraw, 0, 0],
      ] as const) {
        const factor = cpi(row.year)
        expect(row.byPerson[RETIREE].gis).toBeCloseTo(gis * factor, 5)
        const funded = OAS + CPP + gis + rrsp + tfsa
        expect(row).toMatchObject({
          byPerson: { [RETIREE]: { cpp: close(CPP * factor), oasNet: close(OAS * factor), benefits: close((OAS + gis) * factor) } },
          cashLedger: { income: close(CPP * factor), benefits: close((OAS + gis) * factor), tax: 0, spending: close(funded * factor), unallocated: 0 },
          taxLedger: { [RETIREE]: { taxableIncome: close((OAS + CPP + rrsp) * factor) } },
          byAccount: { [RRSP]: { withdrawal: close(rrsp * factor), closing: 0 }, [TFSA]: { withdrawal: close(tfsa * factor), closing: 0 } },
          retirementSettlement: { spendingDue: close(40_000 * factor), spendingFunded: close(funded * factor), spendingUnmet: close((40_000 - funded) * factor) },
        })
      }
    }
    expect(runs[1].rows[2].cashLedger.benefits).toEqual(runs[0].rows[2].cashLedger.benefits)
    expect(runs[0].rows[3].cashLedger.benefits - runs[1].rows[3].cashLedger.benefits).toBeCloseTo(2_250 * cpi(2029), 5)
  })

  it('funds the exact residual after GIS with a partial RRSP withdrawal', () => {
    const spending = 27_000
    const { plan, evidence } = scenario({ rrsp: 3_000, spending })
    optIntoGis(plan)
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    const residual = spending - CPP - OAS - gis65
    const factor = cpi(2028)
    expect(result.rows[2]).toMatchObject({
      byAccount: { [RRSP]: { withdrawal: close(residual * factor) } },
      taxLedger: { [RETIREE]: { taxableIncome: close((CPP + OAS + residual) * factor) } },
      retirementSettlement: { spendingFunded: close(spending * factor), spendingUnmet: close(0) },
      cashLedger: { spending: close(spending * factor), unallocated: close(0) },
    })
    expect(result.rows[2].byAccount[RRSP].closing).toBeGreaterThan(0)
  })

  it('pays the pinned maximum for prior known zero, and a known zero at high prior income', () => {
    for (const [wages, gis] of [[0, MAX_GIS], [40_000, 0]]) {
      const { plan, evidence } = scenario({ wages })
      optIntoGis(plan)
      const result = ok(projectCanonicalCoverage(plan, evidence, 3))
      expect(result.blocked).toBeNull()
      expect(result.rows[2].cashLedger.benefits).toBeCloseTo((OAS + gis) * cpi(2028), 5)
      expect(result.rows[2].byPerson[RETIREE].gis).toBeCloseTo(gis * cpi(2028), 5)
      expect(result.rows[2].retirementSettlement?.gis?.amountReal).toBeCloseTo(gis, 5)
      const { sheet, gis: gisRow } = gisSheetRow(result)
      const cell = gisRow?.cells?.[2028]
      expect(cell).toMatchObject({ value: close(gis * cpi(2028)) })
      const explanation = sheet.resolveExplanation?.(cell?.explanationRefs?.[0] ?? '')
      const sources = explanation?.sources ?? []
      const assessment = sources.find(source => source.field === 'gisAssessmentLag')
      if (!assessment) throw new Error('Missing GIS assessment provenance')
      for (const [locale, ageBasis] of [
        ['en', /age.amount net income/i], ['fr', /revenu net (?:pour|aux fins).*âge/i], ['zh', /年龄抵免净收入/],
      ] as const) {
        expect(annualSheetText(assessment.label, locale)).toContain('CA-OAS-GIS-2026-Q4-v1')
        const labels = sources.map(source => annualSheetText(source.label, locale)).join(' ')
        expect(labels).not.toContain('undefined')
        if (gis > 0) expect(labels).toMatch(ageBasis)
        else expect(labels).not.toMatch(ageBasis)
      }
    }
  })

  it('takes no GIS before the verified OAS claim, including age 65 with deferred OAS', () => {
    const { plan, evidence } = scenario({ claimAge: 66 })
    optIntoGis(plan)
    delete plan.annualGisEvidence![RETIREE][2028]
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.blocked).toBeNull()
    expect(result.rows.slice(0, 3).map(row => row.cashLedger.benefits)).toEqual([0, 0, 0])
    expect(result.rows[2].byPerson[RETIREE].gis).toBe(0)
    expect(result.rows[2].retirementSettlement?.gis).toBeUndefined()
    expect(result.rows[3].cashLedger.benefits).toBeCloseTo((OAS * 1.072 + gis66NoDraw) * cpi(2029), 5)
    const { sheet, gis } = gisSheetRow(result)
    expect(gis?.cells?.[2028]).toMatchObject({ status: 'not-applicable', value: null })
    const paymentCell = gis?.cells?.[2029]
    const paymentYear = sheet.years.find(year => year.year === 2029)
    if (!paymentCell || !paymentYear) throw new Error('Missing GIS payment cell')
    expect(annualSheetDisplayValue(paymentCell, paymentYear, 'real')).toBeCloseTo(gis66NoDraw, 5)
  })

  it('refuses contradictory full OAS in-pay evidence before the verified claim', () => {
    const { plan, evidence } = scenario({ claimAge: 66 })
    optIntoGis(plan)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result).toMatchObject({
      rows: prefix.rows, state: prefix.state, blocked: { year: 2028, status: 'unsupported', issues: [{ detail: expect.stringMatching(/GIS/i) }] },
      uncomputedYears: [2029],
    })
  })

  it('rejects missing, unestablished and non-prior assessment evidence for a payable year', () => {
    const { plan } = scenario()
    optIntoGis(plan)
    const oas = annualOas(plan, plan.people[0], 65)
    expect(() => annualGis(plan, RETIREE, 2028, 65, oas)).toThrow(expect.objectContaining({ status: 'unsupported', reason: expect.stringMatching(/prior-year/i) }))
    expect(() => annualGis(plan, RETIREE, 2028, 65, oas, { status: 'unknown', reason: 'No assessment' }))
      .toThrow(expect.objectContaining({ status: 'unsupported', reason: expect.stringMatching(/prior-year/i) }))
    expect(() => annualGis(plan, RETIREE, 2028, 65, oas, known({
      assessmentYear: 2028, incomeNominal: 0, employmentNetPayrollNominal: 0, workPolicy: 'employment-only-net-cpp-ei',
    }))).toThrow(expect.objectContaining({ status: 'unsupported', reason: expect.stringMatching(/prior-year/i) }))
  })

  it('preserves pre-claim rows when the claim arrives during working years', () => {
    const { plan, evidence } = scenario()
    optIntoGis(plan)
    plan.people[0].retirementAge = 66
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result).toMatchObject({
      rows: prefix.rows, state: prefix.state, blocked: { year: 2028, status: 'unsupported', issues: [{ detail: expect.stringMatching(/working.*OAS/i) }] },
      uncomputedYears: [2029],
    })
  })

  it('leaves the committed prefix intact when payable-year eligibility is missing', () => {
    const { plan, evidence } = scenario()
    optIntoGis(plan)
    delete plan.annualGisEvidence![RETIREE][2029]
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(prefix.blocked).toBeNull()
    expect(prefix.state.gisAssessmentLag?.[RETIREE]).toMatchObject({
      status: 'known', value: { assessmentYear: 2028, employmentNetPayrollNominal: 0,
        incomeNominal: close(CPP * cpi(2028)), workPolicy: 'employment-only-net-cpp-ei' },
    })
    const result = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(result).toMatchObject({
      rows: prefix.rows, state: prefix.state, blocked: { year: 2029, status: 'unsupported', issues: [{ detail: expect.stringMatching(/GIS/i) }] },
      uncomputedYears: [2030], overallConclusionAvailable: false,
    })
  })

  it('stops atomically when GIS creates a retirement surplus with no persistent destination', () => {
    const { plan, evidence } = scenario({ spending: 20_000 })
    optIntoGis(plan)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result).toMatchObject({
      rows: prefix.rows, state: prefix.state, blocked: { year: 2028, status: 'unsupported', issues: [{ detail: expect.stringMatching(/surplus/i) }] },
      uncomputedYears: [2029], overallConclusionAvailable: false,
    })
  })

  it('preserves the recorded OAS and CPP exclusion branch', () => {
    const { plan, evidence } = scenario()
    optIntoGis(plan)
    plan.annualBenefitsEvidence![RETIREE].gis = exclusion
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    expect(result.rows[2].retirementSettlement?.gis).toBeUndefined()
    expect(result.rows[2].byPerson[RETIREE].gis).toBeUndefined()
    expect(gisSheetRow(result).gis).toBeUndefined()
    expect(result.rows.map(row => row.cashLedger.benefits)).toEqual([0, 0, OAS * cpi(2028)])
    expect(result.rows[2]).toMatchObject({
      byPerson: { [RETIREE]: { cpp: close(CPP * cpi(2028)), oasNet: close(OAS * cpi(2028)) } },
      taxLedger: { [RETIREE]: { taxableIncome: close((CPP + OAS) * cpi(2028)), tax: 0 } },
      retirementSettlement: { spendingFunded: close((CPP + OAS) * cpi(2028)), spendingUnmet: close((40_000 - CPP - OAS) * cpi(2028)) },
    })
  })

  it('stops atomically in the first canonical year when the GIS scope subfact is omitted', () => {
    const { plan, evidence } = scenario()
    optIntoGis(plan)
    // Simulate incomplete runtime input while retaining the other recorded exclusions.
    Reflect.deleteProperty(plan.annualBenefitsEvidence![RETIREE], 'gis')
    const opening = ok(initializeState(plan))
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result).toMatchObject({
      evaluationBasis: 'canonical-continuous', rows: [],
      blocked: { year: 2026, status: 'unsupported', causes: ['unsupported'], issues: [
        { code: 'unsupported', detail: expect.stringMatching(/GIS scope evidence/i) },
      ] },
      uncomputedYears: [2027, 2028], overallConclusionAvailable: false,
    })
    expect(result.state).toEqual(opening)
  })

  it.each([
    { scope: 'annual GIS opt-in', omitGis: false },
    { scope: 'an omitted GIS scope subfact', omitGis: true },
  ])('honours provider-controlled benefits and carry with $scope', ({ omitGis }) => {
    const plan = retirementPlan({ age: 63 })
    plan.people[0].retirementAge = 65
    optIntoGis(plan)
    if (omitGis) Reflect.deleteProperty(plan.annualBenefitsEvidence![RETIREE], 'gis')
    const opening = ok(initializeState(plan))
    const result = ok(projectAnnualCoverage(plan, opening, 1, {
      evaluate: () => ({
        byPerson: { [RETIREE]: { income: 0, earnedIncome: 0, benefits: 321, tax: 0, spending: 321, taxableIncome: 0, benefitIncomeForNextYear: known(456) } },
      }),
      returns: () => 0,
    }))
    expect(result).toMatchObject({ blocked: null, evaluationBasis: 'provider-supplied' })
    const row = result.rows[0]
    expect(row.cashLedger).toMatchObject({ benefits: 321, spending: 321, unallocated: 0 })
    expect(row.byPerson[RETIREE].benefits).toBe(321)
    expect(Object.prototype.hasOwnProperty.call(row.byPerson[RETIREE], 'gis')).toBe(false)
    expect(result.state.benefitIncomeLag[RETIREE]).toEqual(known(456))
    expect(result.state.gisAssessmentLag?.[RETIREE]).toBeUndefined()
  })
})


// Income Tax Act ss. 56 and 180.2 include the supplement in the income
// and repayment bases. The annual model uses its pinned 2026 threshold.
// https://laws-lois.justice.gc.ca/eng/acts/I-3.3/section-180.2.html
describe('independent GIS-inclusive OAS recovery guard', () => {
  const threshold = 95_323
  const boundaryDraw = threshold - CPP - OAS - gis65

  function expectRecoveryStop(rrsp: number, spending: number) {
    const { plan, evidence } = scenario({ rrsp, spending })
    optIntoGis(plan)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(result.blocked).toMatchObject({
      year: 2028, status: 'unsupported', causes: ['unsupported'],
      issues: [{ code: 'unsupported', detail: 'GIS: combined OAS/GIS recovery interaction not supported' }],
    })
    expect(result.rows).toEqual(prefix.rows)
    expect(result.state).toEqual(prefix.state)
    expect(result.uncomputedYears).toEqual([2029, 2030])
    expect(result.overallConclusionAvailable).toBe(false)
    const { sheet, gis } = gisSheetRow(result)
    const blockedCell = gis?.cells?.[2028]
    expect(blockedCell).toMatchObject({ status: 'not-computed', value: null })
    expect(gis?.cells?.[2029]).toMatchObject({ status: 'not-computed', value: null })
    const explanation = sheet.resolveExplanation?.(blockedCell?.explanationRefs?.[0] ?? '')
    if (!explanation?.summary) throw new Error('Missing GIS recovery stop explanation')
    expect(annualSheetText(explanation.summary, 'en')).toMatch(/combined OAS\/GIS (?:recovery|repayment)/i)
    expect(annualSheetText(explanation.summary, 'fr')).toMatch(/récupération|recouvrement|remboursement/i)
    expect(annualSheetText(explanation.summary, 'zh')).toMatch(/扣回|追缴|追回|回收|偿还/)
  }

  it.each([90_000, 120_000])('stops on the reviewer’s $%i spending case with a $900,000 RRSP', spending => {
    expectRecoveryStop(900_000, spending)
  })

  it.each([0.01, 1])('stops when GIS alone pushes the exhausted candidate $%s over the threshold', offset => {
    const rrsp = boundaryDraw + offset
    expect(rrsp + CPP + OAS).toBeLessThan(threshold)
    expect(rrsp + CPP + OAS + gis65).toBeCloseTo(threshold + offset, 8)
    // With $90,000 spending and no other accounts, the early shortfall
    // exhausts this RRSP even before subtracting regular income tax.
    expectRecoveryStop(rrsp, 90_000)
  })

  it.each([-1, 0])('commits a GIS-inclusive recovery base $%i relative to the threshold', offset => {
    const rrsp = boundaryDraw + offset
    const { plan, evidence } = scenario({ rrsp, spending: 90_000 })
    optIntoGis(plan)
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    const row = result.rows[2]
    expect(row.byAccount[RRSP]).toMatchObject({ withdrawal: close(rrsp * cpi(2028)), closing: 0 })
    expect(row.retirementSettlement?.oas).toMatchObject({ recoveryReal: 0, grossReal: OAS, netReal: OAS })
    expect(row.byPerson[RETIREE].gis).toBeCloseTo(gis65 * cpi(2028), 5)
    expect(row.cashLedger.spending).toBeCloseTo((threshold + offset) * cpi(2028) - row.cashLedger.tax, 5)
  })

  it('allows a safe accepted draw even though the full RRSP trial exceeds the threshold', () => {
    const { plan, evidence } = scenario({ rrsp: 900_000 })
    optIntoGis(plan)
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    const row = result.rows[2]
    expect(row.byAccount[RRSP].opening / cpi(2028) + CPP + OAS + gis65).toBeGreaterThan(threshold)
    expect(row.byAccount[RRSP].withdrawal).toBeGreaterThan(0)
    expect(row.byAccount[RRSP].withdrawal / cpi(2028) + CPP + OAS + gis65).toBeLessThan(threshold)
    expect(row.retirementSettlement).toMatchObject({ spendingFunded: close(40_000 * cpi(2028)), spendingUnmet: close(0) })
  })

  it('settles the same safe withdrawal with an extreme or moderate speculative RRSP cap', () => {
    // Both full age amounts remain available on the accepted candidate. At
    // the resulting taxable income both tax rates are in the first bracket
    // and Ontario's health premium is on its $300 plateau.
    const spending = 40_000
    const credits = 0.14 * (16_452 + 9_208) + 0.0505 * (12_989 + 6_342)
    const taxable = (spending - MAX_GIS - credits + 300) / (1 - 0.14 - 0.0505)
    const draw = taxable - OAS
    const tax = taxable + MAX_GIS - spending
    const rrspBalances = [900_000, Number.MAX_SAFE_INTEGER / 100 - 1_000]
    const withdrawals = rrspBalances.map(rrsp => {
      const { plan, evidence } = scenario({ cpp: 0, wages: 0, spending, rrsp })
      plan.inflation = 0
      optIntoGis(plan)
      const result = ok(projectCanonicalCoverage(plan, evidence, 3))
      expect(result.blocked).toBeNull()
      const row = result.rows[2]
      const withdrawal = row.byAccount[RRSP].withdrawal
      expect(Math.abs(withdrawal - draw)).toBeLessThan(0.0001)
      expect(row).toMatchObject({
        taxLedger: { [RETIREE]: { taxableIncome: expect.closeTo(taxable, 2), tax: expect.closeTo(tax, 2) } },
        cashLedger: { benefits: expect.closeTo(OAS + MAX_GIS, 2), tax: expect.closeTo(tax, 2), spending, unallocated: expect.closeTo(0, 2) },
        retirementSettlement: {
          gis: { amountReal: close(MAX_GIS) }, gisAgeAmountNetIncomeReal: expect.closeTo(taxable + MAX_GIS, 2),
          oas: { recoveryReal: 0, grossReal: OAS, netReal: OAS }, spendingFunded: spending, spendingUnmet: 0,
        },
      })
      expect(result.state.gisAssessmentLag?.[RETIREE]).toMatchObject({
        status: 'known', value: { assessmentYear: 2028, incomeNominal: close(withdrawal), employmentNetPayrollNominal: 0 },
      })
      return withdrawal
    })
    expect(Math.abs(withdrawals[1] - withdrawals[0])).toBeLessThan(0.0001)
  })

  it.each([-0.01, 0, 0.01])('decides an extreme-cap funded withdrawal $%s from the recovery threshold', offset => {
    const rrsp = Number.MAX_SAFE_INTEGER / 100 - 1_000
    const draw = threshold - MAX_GIS - OAS + offset
    const taxable = draw + OAS
    const netIncome = taxable + MAX_GIS
    // At this income Ontario's age amount is zero and the $750 premium
    // applies. Federal age credit still phases out at 15% of net income.
    const federalAgeAmount = 9_208 - 0.15 * (netIncome - 46_432)
    const tax = 0.14 * (58_523 - 16_452 - federalAgeAmount) + 0.205 * (taxable - 58_523)
      + 0.0505 * (53_891 - 12_989) + 0.0915 * (taxable - 53_891) + 750
    const spending = netIncome - tax
    if (offset === 0) {
      expect(draw).toBeCloseTo(72_506.20, 8)
      expect(spending).toBeCloseTo(79_597.0962, 8)
    }
    const { plan, evidence } = scenario({ wages: 0, cpp: 0, rrsp, spending })
    plan.inflation = 0
    optIntoGis(plan)
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    if (offset > 0) {
      expect(result.blocked).toMatchObject({
        year: 2028, status: 'unsupported',
        issues: [{ code: 'unsupported', detail: 'GIS: combined OAS/GIS recovery interaction not supported' }],
      })
      return
    }
    expect(result.blocked).toBeNull()
    const row = result.rows[2]
    expect(Math.abs(row.byAccount[RRSP].withdrawal - draw)).toBeLessThan(0.0001)
    expect(row.retirementSettlement).toMatchObject({
      oas: { recoveryReal: 0, grossReal: OAS, netReal: OAS },
      gisAgeAmountNetIncomeReal: expect.closeTo(netIncome, 2),
      spendingFunded: expect.closeTo(spending, 2), spendingUnmet: 0,
    })
    expect(row.taxLedger[RETIREE]).toMatchObject({ taxableIncome: expect.closeTo(taxable, 2), tax: expect.closeTo(tax, 2) })
  })

  it('posts exactly zero OAS recovery when a tiny positive GIS reaches the bounded equality', () => {
    const rrsp = 86_173.00000000002
    const spending = 110_000
    const workingSpending = 29_673.52814634313
    const { plan, evidence } = scenario({ baseAge: 64, cpp: 0, wages: 35_602.41242492631, rrsp, spending })
    plan.inflation = 0
    plan.budget = { kind: 'incomeBudget', workingSpending, retirementSpending: spending }
    evidence.workingSpending = known(workingSpending)
    optIntoGis(plan, 2027)
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    const row = result.rows[1]
    expect(row.byAccount[RRSP].withdrawal).toBe(rrsp)
    const gis = row.retirementSettlement?.gis?.amountReal ?? 0
    expect(gis).toBeGreaterThan(0)
    expect(gis).toBeLessThan(1e-9)
    expect(row.retirementSettlement?.oas).toMatchObject({ recoveryReal: 0, grossReal: OAS, netReal: OAS })
    expect(row.byPerson[RETIREE]).toMatchObject({ oasRecovery: 0, oasGross: OAS, oasNet: OAS })
  })

  it('preserves ordinary OAS recovery when assessed GIS is a known zero', () => {
    const { plan, evidence } = scenario({ wages: 40_000, rrsp: 900_000, spending: 90_000 })
    const excluded = ok(projectCanonicalCoverage(plan, evidence, 3))
    optIntoGis(plan)
    const optedIn = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(excluded.blocked).toBeNull()
    expect(optedIn.blocked).toBeNull()
    const row = optedIn.rows[2]
    const control = excluded.rows[2]
    expect(row.byPerson[RETIREE].gis).toBe(0)
    expect(row.retirementSettlement?.gis?.amountReal).toBe(0)
    expect(row.retirementSettlement?.oas?.recoveryReal).toBeGreaterThan(0)
    expect(row.retirementSettlement?.oas?.recoveryReal).toEqual(control.retirementSettlement?.oas?.recoveryReal)
    expect(row.cashLedger).toEqual(control.cashLedger)
    expect(row.taxLedger).toEqual(control.taxLedger)
    expect(row.byAccount).toEqual(control.byAccount)
  })
})


it('uses GIS in net income for federal and Ontario age amounts while excluding it from taxable income and the next GIS assessment', () => {
  // CRA lines 30100/58080 use line 23600 net income. The GIS deduction at
  // line 25000 reduces taxable income in this below-recovery fixture.
  // https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-30100-amount.html
  // https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-25000-other-payments-deduction.html
  const draw = 60_000
  const taxable = draw + OAS
  const factor = cpi(2028)
  // The fixtures lie in the second tax bracket in both jurisdictions, below
  // Ontario surtax and in the $600 premium plateau. Both age amounts phase down.
  const ageAmount = (maximum: number, threshold: number, netIncome: number) => maximum - 0.15 * (netIncome - threshold)
  const federal = (netIncome: number) => 0.14 * (58_523 - 16_452 - ageAmount(9_208, 46_432, netIncome))
    + 0.205 * (taxable - 58_523)
  const ontario = (netIncome: number) => 0.0505 * (53_891 - 12_989 - ageAmount(6_342, 47_210, netIncome))
    + 0.0915 * (taxable - 53_891) + 600
  expect(federal(taxable + MAX_GIS) - federal(taxable)).toBeCloseTo(287.0028, 6)
  expect(ontario(taxable + MAX_GIS) - ontario(taxable)).toBeCloseTo(103.52601, 6)

  for (const optIn of [false, true]) {
    const gis = optIn ? MAX_GIS : 0
    const tax = federal(taxable + gis) + ontario(taxable + gis)
    const spending = taxable + gis - tax
    const { plan, evidence } = scenario({ wages: 0, cpp: 0, rrsp: 900_000, spending })
    if (optIn) optIntoGis(plan)
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    const row = result.rows[2]
    expect(row).toMatchObject({
      byAccount: { [RRSP]: { withdrawal: close(draw * factor) } },
      taxLedger: { [RETIREE]: { taxableIncome: close(taxable * factor), tax: close(tax * factor) } },
      cashLedger: { benefits: close((OAS + gis) * factor), spending: close(spending * factor), unallocated: close(0) },
      retirementSettlement: { oas: { recoveryReal: 0 }, spendingUnmet: close(0) },
    })
    if (optIn) {
      expect(row.retirementSettlement?.gisAgeAmountNetIncomeReal).toBeCloseTo(taxable + gis, 5)
      expect(result.state.gisAssessmentLag?.[RETIREE]).toMatchObject({
        status: 'known', value: { assessmentYear: 2028, incomeNominal: close(draw * factor), employmentNetPayrollNominal: 0 },
      })
      const next = ok(projectCanonicalCoverage(plan, evidence, 4))
      expect(next.blocked).toBeNull()
      expect(next.rows[3].retirementSettlement?.gis).toMatchObject({
        amountReal: 0, assessmentYear: 2028, grossIncomeReal: close(draw),
      })
    }
  }
})
