import type { AnnualState } from "./annualState"
import type { InputsV2, Person } from './model'
import { annualOas, annualHouseholdOas, annualGeneratedRetirementOas } from './annualOas'
import { personCppAnnual } from './pensionProvenance'

/** Annual convention: age reached in the year, full-year payment at start CPI.
 * No monthly proration, work-history reevaluation or entitlement inference.
 */
export interface AnnualCpp {
  amountReal: number
  sourceId: string | null
  startAge: number | null
  sourceYear: number | null
  source: 'manual' | 'statement'
  ageBasis: number | null
  status: 'before-start' | 'known-none' | 'paying'
}
/** Validate even known-zero plans: a negative or damaged fact is never absence. */
export function cppInputProblem(person: Person): string | null {
  if (!Number.isFinite(person.cppAnnualAt65) || person.cppAnnualAt65 < 0 || person.cppAnnualAt65 > Number.MAX_SAFE_INTEGER / 100) return 'CPP amount must be finite nonnegative safe annual dollars'
  const p = person.cppAmountSource
  if (p === undefined) return null
  if (!p || typeof p !== 'object' || Array.isArray(p) || !['manual', 'statement', 'estimator', 'unknown'].includes(p.source) ||
      !(p.sourceYear === null || Number.isSafeInteger(p.sourceYear) && p.sourceYear >= 0) ||
      !['annual', 'monthly'].includes(p.basis) || !['today', 'nominal'].includes(p.dollarBasis) ||
      !(p.ageBasis === null || Number.isInteger(p.ageBasis) && p.ageBasis >= 60 && p.ageBasis <= 70) ||
      (p.premisesNeedReview !== undefined && typeof p.premisesNeedReview !== 'boolean') ||
      (p.premises !== undefined && (!p.premises || typeof p.premises !== 'object' || Array.isArray(p.premises) || !Number.isInteger(p.premises.retirementAge))))
    return 'CPP amount provenance fields are malformed'
  return null
}
export function annualCpp(plan: InputsV2, person: Person, age: number, retirementState?: AnnualState): AnnualCpp {
  const problem = cppInputProblem(person)
  if (problem) throw { status: 'invalid', reason: problem }
  const sources = plan.incomeSources.filter(s => s.kind === 'cpp' && s.recipientId === person.id)
  const s = sources[0]
  const p = person.cppAmountSource
  // A zero statement is still a recorded premise, so reconfirmation applies
  // before the source-less absence shortcut as well as to paying sources.
  if (p?.premisesNeedReview || p?.source === 'statement' && p.premises?.retirementAge !== person.retirementAge)
    throw { status: 'unsupported', reason: 'CPP statement retirement premise must be confirmed' }
  // Explicit zero on the person is absence evidence; it needs no synthetic
  // income row, claim age, or legacy mirror. Existing rows, if any, must agree.
  if (person.cppAnnualAt65 === 0 && sources.length === 0 && p && ['manual', 'statement'].includes(p.source))
    return { amountReal: 0, sourceId: null, startAge: null, sourceYear: p.sourceYear, source: p.source as AnnualCpp['source'], ageBasis: p.ageBasis, status: 'known-none' }
  // The normal app adapter labels its mirror legacy. Accept that unique exact
  // mirror only with independently confirmed person amount provenance below.
  const trustedSource = s && (s.provenance.origin === 'user' || s.provenance.origin === 'legacy' && s.id === `${person.id}:cpp`)
  if (sources.length !== 1 || !s || !trustedSource || s.annualAmount.status !== 'known' || s.annualAmount.value !== person.cppAnnualAt65 ||
      !Number.isInteger(s.startAge) || s.startAge! < 60 || s.startAge! > 70 || s.fromAge !== undefined || s.toAge !== undefined ||
      !p || !['manual', 'statement'].includes(p.source) || !['annual', 'monthly'].includes(p.basis) || p.dollarBasis !== 'today' ||
      (p.ageBasis !== null && (!Number.isInteger(p.ageBasis) || p.ageBasis < 60 || p.ageBasis > 70)) ||
      person.cppWork ||
      !Number.isFinite(s.annualAmount.value) || s.annualAmount.value < 0)
    throw { status: 'unsupported', reason: 'CPP requires unique confirmed canonical source (user or matching app mirror), known matching amount, verified today-dollar basis and start age; statement retirement premise must be confirmed' }
  // Crossing 65 requires independently verified OAS and explicit exclusions.
  // The legacy known-zero context retains its existing stop and reason.
  if (plan.people.some(p => p.cppAnnualAt65 > 0) && plan.people.some(p => p.ageInBaseYear + age - person.ageInBaseYear >= 65)) {
    if (!plan.annualBenefitsEvidence) throw { status: 'unsupported', reason: 'CPP slice stops at household age 65: OAS/GIS/Allowance eligibility not wired' }
    for (const member of plan.people) {
      const memberAge = member.ageInBaseYear + age - person.ageInBaseYear
      if (retirementState) annualGeneratedRetirementOas(plan, member, memberAge, retirementState)
      else (plan.people.length === 2 ? annualHouseholdOas : annualOas)(plan, member, memberAge)
    }
  }
  if (age < person.retirementAge && age >= s.startAge! && s.annualAmount.value > 0)
    throw { status: 'unsupported', reason: 'working CPP recipient requires post-retirement benefit and payroll election rules' }
  const amountReal = age < s.startAge! ? 0 : personCppAnnual(person, s.startAge!, plan.province, s.annualAmount.value, p.ageBasis)
  if (!Number.isFinite(amountReal) || amountReal < 0 || amountReal > Number.MAX_SAFE_INTEGER / 100) throw { status: 'invalid', reason: 'CPP amount unsafe' }
  return { amountReal, sourceId: s.id, startAge: s.startAge!, sourceYear: p.sourceYear, source: p.source as AnnualCpp['source'], ageBasis: p.ageBasis, status: s.annualAmount.value === 0 ? 'known-none' : age < s.startAge! ? 'before-start' : 'paying' }
}
