import { benefitIncomeBasis, gisWorkExemption, OAS_GIS_ALLOWANCE_2026_Q4 } from './benefits'
import type { InputsV2, Known } from './model'
import type { AnnualOas } from './annualOas'

/** Explicit model boundary, not a quote of combined benefit repayment.
 * ITA ss.56(1)(a)(i)(A), 180.2 include GIS in adjusted income and the
 * repayment cap. The ordinary OAS-only settlement cannot price this domain.
 * https://laws-lois.justice.gc.ca/eng/acts/I-3.3/section-56.html
 * https://laws-lois.justice.gc.ca/eng/acts/I-3.3/section-180.2.html
 */
export const GIS_OAS_RECOVERY_UNSUPPORTED = 'GIS: combined OAS/GIS recovery interaction not supported'

/** Additive receipt. The legacy lag is not evidence of exemption-eligible work.
 * Only canonical settled employment/CPP/ordinary RRSP events produce this fact.
 * Self-employment, business expenses and other benefit income are unsupported.
 */
export interface GisAssessmentBasis {
  assessmentYear: number
  incomeNominal: number // assessment income excluding OAS/GIS and full employee CPP/EI, before work exemption
  employmentNetPayrollNominal: number // supported employment less full employee CPP/EI, before work exemption
  workPolicy: 'employment-only-net-cpp-ei'
}
export type GisAssessmentFact = Known<GisAssessmentBasis>
export interface AnnualGis {
  amountReal: number
  assessmentYear: number
  assessmentCpi: number
  grossIncomeReal: number
  workIncomeReal: number
  workExemptionNominal: number
  workExemptionReal: number
  countableIncomeReal: number
  rulePackId: string
  paymentPeriod: string
  policy: 'annualized-pinned-quarter-prior-year-original-cpi'
}
const safe = (n: number) => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER / 100
export function validGisBasis(fact: GisAssessmentFact, year: number): boolean {
  return fact?.status === 'unknown' ? typeof fact.reason === 'string' && !!fact.reason.trim()
    : fact?.status === 'known' && fact.value?.assessmentYear === year - 1 && fact.value.workPolicy === 'employment-only-net-cpp-ei' && safe(fact.value.incomeNominal) && safe(fact.value.employmentNetPayrollNominal)
}
export function gisAssessmentReceipt(year: number, incomeNominal: number, employmentNetPayrollNominal: number): GisAssessmentFact {
  if (!Number.isInteger(year) || !safe(incomeNominal) || !safe(employmentNetPayrollNominal)) throw { status: 'invalid', reason: 'GIS assessment receipt unsafe' }
  return { status: 'known', value: { assessmentYear: year, incomeNominal, employmentNetPayrollNominal, workPolicy: 'employment-only-net-cpp-ei' } }
}
/** Convert at the assessment year's original clock, never the payment year. */
export function gisAssessmentCpi(plan: InputsV2, assessmentYear: number): number {
  return (1 + plan.inflation) ** (assessmentYear - plan.baseYear)
}
export function annualGis(plan: InputsV2, personId: string, year: number, age: number, oas: AnnualOas, fact?: GisAssessmentFact): AnnualGis | undefined {
  if (oas.evidence.gis.status !== 'annual-estimate') return undefined
  const stop = (reason: string): never => { throw { status: 'unsupported', reason: `GIS: ${reason}` } }
  const e = plan.annualGisEvidence?.[personId]?.[year]
  if (plan.people.length !== 1 || plan.province !== 'ON' || plan.baseYear !== 2026 || age > 69) stop('requires solo Ontario full OAS in pay at age 65–69')
  // The validated canonical OAS claim establishes deferral, never eligibility.
  if (oas.startAge !== null && age < oas.startAge && oas.grossReal === 0) {
    if (e?.fullOasInPay === true) stop('in-pay evidence contradicts verified deferred OAS claim')
    return undefined
  }
  if (age < 65 || oas.grossReal <= 0) stop('requires solo Ontario full OAS in pay at age 65–69')
  if (!e || e.eligible !== true || e.residentInCanada !== true || e.notSponsored !== true || e.fullOasInPay !== true || e.provenance?.origin !== 'user' || !Number.isSafeInteger(e.provenance.sourceYear) || e.provenance.sourceYear! < 0 || e.provenance.sourceYear! > year) stop('annual eligibility, residence, sponsorship and full OAS in-pay evidence required')
  if (!fact || fact.status !== 'known') stop('committed prior-year assessment and employment evidence missing')
  if (!validGisBasis(fact!, year)) stop('prior-year assessment year or supported employment evidence invalid')
  const b = (fact as { status: 'known'; value: GisAssessmentBasis }).value
  const assessmentCpi = gisAssessmentCpi(plan, b.assessmentYear)
  const grossIncomeReal = b.incomeNominal / assessmentCpi
  const workIncomeReal = b.employmentNetPayrollNominal / assessmentCpi
  if (!(assessmentCpi > 0) || ![assessmentCpi, grossIncomeReal, workIncomeReal].every(safe)) throw { status: 'invalid', reason: 'GIS assessment CPI unsafe' }
  // OAS Act s.2 income (a)(ii)–(iii), (b.1): CPP/EI were deducted
  // in the receipt. Apply the statutory dollar bands in assessment-year
  // NOMINAL dollars before the original-clock conversion. Passing zero work
  // below prevents benefitIncomeBasis from exempting these earnings twice.
  // https://laws-lois.justice.gc.ca/eng/acts/O-9/page-1.html
  const workExemptionNominal = gisWorkExemption(b.employmentNetPayrollNominal)
  const countableIncomeReal = Math.max(0, b.incomeNominal - workExemptionNominal) / assessmentCpi
  const priced = benefitIncomeBasis([true], [age], countableIncomeReal, { workIncome: 0, gisPack: OAS_GIS_ALLOWANCE_2026_Q4 })
  if (priced.status !== 'modeled' || priced.allowance !== 0) stop('solo annual benefit basis unsupported')
  if (priced.status !== 'modeled') return undefined
  return { amountReal: priced.gis, assessmentYear: b.assessmentYear, assessmentCpi, grossIncomeReal, workIncomeReal, workExemptionNominal, workExemptionReal: workExemptionNominal / assessmentCpi, countableIncomeReal, rulePackId: priced.rulePackId, paymentPeriod: priced.paymentPeriod, policy: 'annualized-pinned-quarter-prior-year-original-cpi' }
}
