import { isCanonicalGeneratedState, type AnnualState } from "./annualState"
import { calculatePersonIncome, type IncomeEvent, type IncomeYearContext } from './personIncome'
import { calculateHouseholdTax } from './householdTax'
import { oasAfterClawback } from './benefits'
import type { InputsV2, Person } from './model'
import { personOasAnnual } from './pensionProvenance'

export interface AnnualOas {
  grossReal: number
  recoveryReal: number
  netReal: number
  recoveryIncomeReal: number
  sourceId: string | null
  startAge: number | null
  sourceYear: number
  source: 'manual' | 'statement'
  ageBasis: number | null
  evidence: NonNullable<InputsV2['annualBenefitsEvidence']>[string]
  policy: 'annual-estimate-full-year-anchor-real'
}
/** A full-year amount at start CPI. No entitlement, monthly withholding,
 * quarterly rate changes or GIS/Allowance eligibility is inferred.
 * CRA line 23500 deducts repayment from the regular tax basis; line 42200
 * separately settles recovery. The net OAS tax event follows personProjectionTax.
 * https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-23500-social-benefits-repayment.html
 * https://www.canada.ca/content/dam/canada/employment-social-development/migration/documents/assets/portfolio/docs/en/statistics/quarterly_report/isp-card-apr-jun-2026-en.pdf
 */
function validateAnnualOas(plan: InputsV2, person: Person, age: number, household: boolean, retiredContinuation = false): AnnualOas {
  const stop = (reason: string): never => { throw { status: 'unsupported', reason } }
  if (!Number.isInteger(age) || age < 0) throw { status: 'invalid', reason: 'invalid OAS annual age' }
  if (plan.province !== 'ON' || plan.baseYear !== 2026 || (household ? plan.people.length !== 2 : plan.people.length !== 1) || age > (retiredContinuation ? 74 : 69))
    stop('OAS annual settlement supports one or two Ontario people through age 69 at 2026 anchor')
  const evidence = plan.annualBenefitsEvidence?.[person.id]
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || ![evidence.allowance, evidence.otherBenefits].every(e => e && typeof e === 'object' && !Array.isArray(e) && ['excluded', 'not-applicable'].includes(e.status) && typeof e.reason === 'string' && e.reason.trim().length > 0 && e.provenance?.origin === 'user' && Number.isSafeInteger(e.provenance.sourceYear) && e.provenance.sourceYear! >= 0))
    stop('OAS requires recorded GIS/Allowance/other-benefit exclusion evidence')
  const gis = evidence!.gis
  if (!gis || typeof gis !== 'object' || Array.isArray(gis) || !['excluded', 'not-applicable', ...(!household ? ['annual-estimate'] : [])].includes(gis.status) || typeof gis.reason !== 'string' || !gis.reason.trim() || gis.provenance?.origin !== 'user' || !Number.isSafeInteger(gis.provenance.sourceYear) || gis.provenance.sourceYear! < 0)
    stop(household ? 'OAS requires recorded GIS/Allowance/other-benefit exclusion evidence' : 'OAS requires recorded GIS scope evidence; household GIS unsupported')
  // Only these three validated exclusions enter settlement and explanations.
  const verifiedEvidence = { gis: evidence!.gis, allowance: evidence!.allowance, otherBenefits: evidence!.otherBenefits }
  const p = person.oasAmountSource
  const sources = plan.incomeSources.filter(s => s.kind === 'oas' && s.recipientId === person.id)
  const s = sources[0]
  const validProvenance = p && typeof p === 'object' && !Array.isArray(p) && ['manual', 'statement'].includes(p.source) && Number.isSafeInteger(p.sourceYear) && p.sourceYear! >= 0 && ['annual', 'monthly'].includes(p.basis) && p.dollarBasis === 'today' && (p.premisesNeedReview === undefined || p.premisesNeedReview === false) &&
    (p.premises === undefined || p.premises !== null && typeof p.premises === 'object' && !Array.isArray(p.premises) && Number.isSafeInteger(p.premises.retirementAge) &&
      [p.premises.startWorkAge, p.premises.avgEarningsRatio, p.premises.residenceYearsBy65].every(value => value === undefined || typeof value === 'number' && Number.isFinite(value))) &&
    (p.ageBasis === null || Number.isInteger(p.ageBasis) && p.ageBasis >= 65 && p.ageBasis <= 70) &&
    (p.source !== 'statement' || p.premises?.retirementAge === person.retirementAge)
  // A confirmed zero is absence evidence, not a claim with an invented date.
  if (person.oasAnnualAt65 === 0 && sources.length === 0 && validProvenance)
    return { grossReal: 0, recoveryReal: 0, netReal: 0, recoveryIncomeReal: 0, sourceId: null, startAge: null, sourceYear: p!.sourceYear!, source: p!.source as AnnualOas['source'], ageBasis: p!.ageBasis, evidence: verifiedEvidence, policy: 'annual-estimate-full-year-anchor-real' }
  if (sources.length !== 1 || !s || s.provenance.origin !== 'user' || s.provenance.sourceYear !== p?.sourceYear || s.annualAmount.status !== 'known' || s.annualAmount.value !== person.oasAnnualAt65 || !Number.isInteger(s.startAge) || s.startAge! < 65 || s.startAge! > 70 || s.fromAge !== undefined || s.toAge !== undefined ||
      !Number.isFinite(person.oasAnnualAt65) || person.oasAnnualAt65 < 0 || person.oasAnnualAt65 > Number.MAX_SAFE_INTEGER / 100 ||
      !validProvenance)
    stop('OAS requires unique user canonical source, matching verified real annual amount, own claim age and confirmed premise')
  const grossReal = age < s.startAge! ? 0 : personOasAnnual(person.oasAnnualAt65, s.startAge!, p!.ageBasis)
  if (!Number.isFinite(grossReal) || grossReal < 0 || grossReal > Number.MAX_SAFE_INTEGER / 100) throw { status: 'invalid', reason: 'unsafe OAS amount' }
  return { grossReal, recoveryReal: 0, netReal: grossReal, recoveryIncomeReal: 0, sourceId: s.id, startAge: s.startAge!, sourceYear: p!.sourceYear!, source: p!.source as AnnualOas['source'], ageBasis: p!.ageBasis, evidence: verifiedEvidence, policy: 'annual-estimate-full-year-anchor-real' }
}

/** Internal household quote: aggregate income without pricing credits first.
 * Recovery belongs to the recipient; ordinary tax sees net OAS exactly once.
 * Callers supply only already-reached withdrawal events, never pending accounts.
 */
export function settleHouseholdOas(plan: InputsV2, year: number, events: IncomeEvent[], payroll: IncomeYearContext['payroll'], benefits: Record<string, AnnualOas>) {
  const income = calculatePersonIncome(plan, year, events, { payroll })
  if (income.status !== 'ok') throw income
  const oas: Record<string, AnnualOas> = {}
  for (const [id, benefit] of Object.entries(benefits)) {
    const ownIncome = income.byPerson[id].netIncome
    const netReal = oasAfterClawback(benefit.grossReal, ownIncome)
    oas[id] = { ...benefit, netReal, recoveryReal: benefit.grossReal - netReal, recoveryIncomeReal: ownIncome + benefit.grossReal }
  }
  const priced = calculateHouseholdTax(plan, year, [...events, ...Object.entries(oas).map(([id, b]) => ({ id: `annual:${year}:oas:${id}`, personId: id, kind: 'oas' as const, amount: b.netReal }))], { payroll })
  if (priced.status !== 'ok') throw priced
  return { priced, oas }
}

/** Preserve the existing solo validator's public scope. */
export function annualOas(plan: InputsV2, person: Person, age: number): AnnualOas {
  return validateAnnualOas(plan, person, age, false)
}
/** Called only inside the generated household companion and CPP evidence gate. */
export function annualHouseholdOas(plan: InputsV2, person: Person, age: number): AnnualOas {
  return validateAnnualOas(plan, person, age, true)
}

/** Generated solo retirement only; public/provider quotes keep their existing boundary.
 * ESDC: the 10% uplift starts the month after the 75th birthday.
 * https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/benefit-amount.html
 */
export function annualGeneratedRetirementOas(plan: InputsV2, person: Person, age: number, state: AnnualState): AnnualOas {
  if (!isCanonicalGeneratedState(plan, state) || plan.people.length !== 1 || plan.people[0] !== person || state.byPerson[person.id]?.age !== age || age < person.retirementAge)
    throw { status: "unsupported", reason: "OAS continuation requires authenticated solo retirement" }
  if (age >= 75) throw { status: "unsupported", reason: "OAS: reached age 75 requires separate monthly uplift modeling; no claim month inferred" }
  if (age >= 70 && plan.annualBenefitsEvidence?.[person.id]?.gis.status === "annual-estimate")
    throw { status: "unsupported", reason: "GIS: continuation beyond age 69 requires explicit exclusion" }
  return validateAnnualOas(plan, person, age, false, true)
}
