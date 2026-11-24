import { passiveHomeProblem } from './annualProperty'
import { nonRegProblem } from "./annualNonReg"
import { annualGis } from './annualGis'
import { annualOas, annualHouseholdOas, settleHouseholdOas, type AnnualOas } from './annualOas'
import { annualCpp, type AnnualCpp } from './annualCpp'
import type { InputsV2, Known } from './model'
import { ageReachedInYear } from './model'
import { initializeState, isCanonicalGeneratedState, type AnnualState, type AnnualEvaluation, type KernelResult } from './annualState'
import { calculateHouseholdTax } from './householdTax'
import { sideIncomeDeductions, type PayrollDeductions } from './payroll'
import { PLAN_TAX_YEAR, type TaxRuleProvenance } from './tax'

/** Explicit supplied-known evidence, separate from computed payroll and tax.
 * The current budget shape cannot distinguish unentered spending from zero.
 * Evidence must agree with this same plan; it supplies no computed cash/tax.
 */
export interface WorkingSpendingEvidence {
  workingSpending: Known<number>
  retirementSpending: Known<number>
  /** Explicit household total for years with one retired and one working member. */
  transitionSpending?: Known<number>
}

export interface CanonicalWorkingEvaluation {
  evaluationBasis: 'canonical-working'
  cpp?: AnnualCpp
  oas?: AnnualOas
  year: number
  personId: string
  age: number
  startCpi: number
  taxRules: TaxRuleProvenance
  suppliedInputs: { basis: 'supplied-known'; grossWagesReal: number; workingSpendingReal: number; retirementSpendingReal: number }
  /** Anchor-real payroll; only contributions are cash uses. */
  payrollReal: PayrollDeductions
  /** Nominal cash withheld, separately from income tax. */
  payrollContributions: number
  netCash: number
  /** Gross-income evaluation; payroll cash is separate above. It must not be
   * passed to annualStep as a provider result: that API has no payroll ledger.
   * Net allocation cash is netCash, after BOTH income tax and payroll. */
  evaluation: AnnualEvaluation
  overallConclusionAvailable: false
}

export interface CanonicalHouseholdWorkingEvaluation extends Omit<CanonicalWorkingEvaluation, 'personId' | 'age' | 'payrollReal' | 'suppliedInputs'> {
  /** evaluation and netCash are the original nominal wage/benefit/tax quote,
   * before withdrawals. Final receipts and tax live in YearRow cash/byPerson
   * ledgers; household.byPerson OAS records the accepted draw's recovery. */
  evaluationPhase: 'pre-withdrawal-baseline'
  household: {
    phase: 'both-working' | 'mixed' | 'both-retired'
    spending: number
    spendingReal: number
    spendingSource: 'workingSpending' | 'transitionSpending' | 'retirementSpending'
    /** Explicit year-specific omission; never a claim of complete household tax. */
    taxLimitations?: 'spouse-age-credit-transfer-unmodeled'[]
    byPerson: Record<string, { phase: 'working' | 'retired'; grossWagesReal: number; oas?: AnnualOas; cpp?: AnnualCpp; payrollReal: PayrollDeductions | null }>
  }
}
export type ContinuousWorkingEvaluation = CanonicalWorkingEvaluation | CanonicalHouseholdWorkingEvaluation

/** Internal household pricing companion. Direct quotes retain the zero-residual
 * boundary. Only the continuous runner's live state identity authorizes a
 * deficit or both-retired quote; the annual kernel chooses no taxable funding.
 * The existing tax pack remains estimated (including incomplete credit rules).
 */
export function evaluateCanonicalHouseholdWorkingYear(plan: InputsV2, evidence: WorkingSpendingEvidence, year: number, generatedState?: AnnualState): KernelResult<CanonicalHouseholdWorkingEvaluation> {
  try {
    const initialized = initializeState(plan)
    if (initialized.status !== 'ok') return initialized
    if (plan.people.length !== 2 || plan.province !== 'ON' || plan.baseYear !== PLAN_TAX_YEAR || plan.budget.kind !== 'incomeBudget') return fail('unsupported', 'household working pricing requires two-person Ontario incomeBudget at tax anchor')
    if (!Number.isInteger(year) || year < plan.baseYear) return fail('invalid', 'household working year')
    const active = plan.people.filter(p => ageReachedInYear(p, plan.baseYear, year) < p.retirementAge)
    const generated = !!generatedState && generatedState.year === year && isCanonicalGeneratedState(plan, generatedState)
    if (!active.length && !generated) return fail('unsupported', 'both-retired household settlement requires generated working prefix')
    for (const key of ['workingSpending', 'retirementSpending'] as const) {
      const fact = evidence[key]
      if (fact?.status !== 'known') return fail('unsupported', `working spending evidence missing: ${key}`)
      if (!safeMoney(fact.value) || fact.value !== plan.budget[key]) return fail('invalid', `working spending evidence disagrees with plan: ${key}`)
    }
    const phase = active.length === 2 ? 'both-working' : active.length === 1 ? 'mixed' : 'both-retired'
    const spendingSource = phase === 'mixed' ? 'transitionSpending' : phase === 'both-retired' ? 'retirementSpending' : 'workingSpending'
    const fact = evidence[spendingSource]
    if (fact?.status !== 'known') return fail('unsupported', `working spending evidence missing: ${spendingSource}`)
    if (!safeMoney(fact.value)) return fail('invalid', 'household transition spending amount')
    if (plan.dependents.length || plan.properties.length || plan.debts.length) return fail('unsupported', 'working dependents/property/debt pricing not yet wired')
    if (plan.taxProfile?.pensionSplit || plan.taxProfile?.qcPensionSplit) return fail('unsupported', 'working tax elections not supported')
    const support = plan.taxProfile?.spouseSupported
    if (support && (support.status === 'known' ? typeof support.value !== 'boolean' : support.status !== 'unknown' || typeof support.reason !== 'string' || !support.reason)) return fail('invalid', 'household spouse support evidence')
    if (plan.contributions.some(c => c.amount !== 0) || plan.recurringContributions.some(c => c.annualAmount !== 0)) return fail('unsupported', 'working registered contributions and deductions not yet wired')
    if (plan.accounts.some(a => !['tfsa', 'rrsp'].includes(a.kind) || !plan.people.some(p => p.id === a.ownerId)) || plan.people.some(p => ['tfsa', 'rrsp'].some(k => plan.accounts.filter(a => a.ownerId === p.id && a.kind === k).length > 1))) return fail('unsupported', 'working supports one owned ordinary RRSP and one TFSA per person')
    const byPerson: CanonicalHouseholdWorkingEvaluation['household']['byPerson'] = {}
    const payroll: Record<string, PayrollDeductions> = {}
    const events: import('./personIncome').IncomeEvent[] = []
    for (const p of plan.people) {
      const age = ageReachedInYear(p, plan.baseYear, year)
      if (![p.ageInBaseYear, p.retirementAge, plan.lifeExpectancy].every(Number.isInteger)) return fail('invalid', 'working age clocks must use whole years')
      if (p.role === 'self' && age >= plan.lifeExpectancy) return fail('unsupported', 'household end-life settlement not yet wired')
      if (age < 19 || age >= 70) return fail('unsupported', 'household working chain supports ages 19 through 69')
      const oas = generated && plan.annualBenefitsEvidence ? annualHouseholdOas(plan, p, age) : undefined
      if ((!generated && p.cppAnnualAt65 !== 0) || (!oas && p.oasAnnualAt65 !== 0) || !['manual', 'statement'].includes(p.cppAmountSource?.source ?? '') || !['manual', 'statement'].includes(p.oasAmountSource?.source ?? '')) return fail('unsupported', 'working benefits require explicit supplied zero evidence')
      if (p.pension || p.pensionAnnual !== 0 || p.cppWork) return fail('unsupported', 'working pension and CPP work rules not yet wired')
      if (p.rrspUnusedUndeducted.status !== 'known' || p.rrspUnusedUndeducted.value !== 0) return fail('unsupported', 'working registered contributions and deductions not yet wired')
      const working = active.includes(p)
      if (working && oas && oas.grossReal > 0) return fail('unsupported', 'household OAS recipient must be retired before payable OAS settlement')
      if (working && p.earnedIncome.status !== 'known') return fail('unsupported', 'working wage evidence unknown')
      const gross = working && p.earnedIncome.status === 'known' ? p.earnedIncome.value : 0
      if (!safeMoney(gross)) return fail('invalid', 'working wage amount')
      if (working) {
        payroll[p.id] = sideIncomeDeductions(gross, 'employment', plan.province, age)
        events.push({ id: `annual:${year}:wage:${p.id}`, personId: p.id, kind: 'employment', amount: gross })
      }
      const cpp = generated && plan.people.some(p => p.cppAnnualAt65 > 0) ? annualCpp(plan, p, age) : undefined
      if (cpp) events.push({ id: `annual:${year}:cpp:${p.id}`, personId: p.id, kind: 'cpp', amount: cpp.amountReal })
      byPerson[p.id] = { phase: working ? 'working' : 'retired', grossWagesReal: gross, ...(oas ? { oas } : {}), ...(cpp ? { cpp } : {}), payrollReal: payroll[p.id] ?? null }
    }
    for (const source of plan.incomeSources) {
      const recipient = plan.people.find(p => p.id === source.recipientId)
      if (!recipient) return fail('unsupported', `income recipient unknown: ${source.id}`)
      const age = ageReachedInYear(recipient, plan.baseYear, year)
      if (generated && source.kind === 'oas' && byPerson[recipient.id].oas?.sourceId === source.id) continue
      if (generated && source.kind === 'cpp' && byPerson[recipient.id].cpp) continue
      if ((source.fromAge ?? -Infinity) > age || (source.startAge ?? -Infinity) > age || (source.toAge ?? Infinity) < age) continue
      if (source.annualAmount.status !== 'known' || source.annualAmount.value !== 0) return fail('unsupported', 'additional active working income source not yet wired')
    }
    const settled = settleHouseholdOas(plan, year, events, payroll, Object.fromEntries(Object.entries(byPerson).flatMap(([id, p]) => p.oas ? [[id, p.oas]] : [])))
    const priced = settled.priced
    for (const [id, oas] of Object.entries(settled.oas)) byPerson[id].oas = oas
    const startCpi = (1 + plan.inflation) ** (year - plan.baseYear)
    if (1 + plan.inflation <= 0 || !Number.isFinite(startCpi) || startCpi <= 0 || !Number.isFinite(1 / startCpi)) return fail('invalid', 'working CPI ratio')
    if (Object.values(settled.oas).some(b => ![b.grossReal, b.netReal, b.recoveryReal, b.recoveryIncomeReal, b.grossReal * startCpi, b.netReal * startCpi, b.recoveryReal * startCpi, b.recoveryIncomeReal * startCpi].every(safeMoney))) return fail('invalid', 'household OAS monetary amount unsafe')
    const gross = events.reduce((s, e) => s + e.amount, 0) + Object.values(settled.oas).reduce((sum, b) => sum + b.netReal, 0)
    const deductions = Object.values(payroll).reduce((s, p) => s + p.contributions, 0)
    const residual = gross - deductions - priced.total - fact.value
    const bound = Math.min(0.004, 0.004 / startCpi, 4 * Number.EPSILON * (gross + deductions + priced.total + fact.value))
    if (residual < -bound && (!generated || phase === 'both-working')) return fail('unsupported', 'negative working cash requires withdrawal funding rule')
    if (residual > bound) return fail('unsupported', 'couple contribution attribution not yet wired; positive household cash')
    const evaluation: AnnualEvaluation = { byPerson: {} }
    for (const p of plan.people) {
      const tax = priced.byPerson[p.id]
      evaluation.byPerson[p.id] = { income: (tax.grossIncome - (byPerson[p.id].oas?.netReal ?? 0)) * startCpi, earnedIncome: byPerson[p.id].grossWagesReal * startCpi, benefits: (byPerson[p.id].oas?.netReal ?? 0) * startCpi, ...(byPerson[p.id].cpp ? { cpp: byPerson[p.id].cpp!.amountReal * startCpi } : {}), tax: tax.tax * startCpi, spending: 0, taxableIncome: tax.taxableIncome * startCpi, benefitIncomeForNextYear: { status: 'known', value: (tax.netIncome - (byPerson[p.id].oas?.netReal ?? 0)) * startCpi } }
    }
    if (![gross, deductions, priced.total, fact.value, gross * startCpi, deductions * startCpi, priced.total * startCpi, fact.value * startCpi].every(safeMoney)) return fail('invalid', 'working nominal pricing amount')
    const { rulePackId, ruleYear, assumedFutureRule, projectionPolicy, coverage } = priced
    return { status: 'ok', value: { evaluationBasis: 'canonical-working', year, startCpi, taxRules: { rulePackId, ruleYear, assumedFutureRule, projectionPolicy, coverage }, payrollContributions: deductions * startCpi, netCash: residual < -bound ? residual * startCpi : 0, evaluation, evaluationPhase: 'pre-withdrawal-baseline', household: { phase, spending: fact.value * startCpi, spendingReal: fact.value, spendingSource, byPerson, ...(plan.people.some(p => ageReachedInYear(p, plan.baseYear, year) >= 65) ? { taxLimitations: ['spouse-age-credit-transfer-unmodeled' as const] } : {}) }, overallConclusionAvailable: false } }
  } catch (e) { if (e && typeof e === 'object' && 'reason' in e && 'status' in e) return fail(e.status === 'invalid' ? 'invalid' : 'unsupported', String(e.reason)); return fail('invalid', 'damaged household working plan or evidence') }
}

const fail = (status: 'invalid' | 'unsupported', detail: string): KernelResult<never> => ({ status, issues: [{ code: status, detail }] })
const safeMoney = (n: number) => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER / 100

/** First BE-13 B slice: price a working year from canonical plan facts only.
 * This does not settle accounts, accept snapshots, splice provider rows, or
 * authorize a retirement transition. A future settlement entry point must
 * start at initializeState and carry the same plan through verified steps.
 * Wages/spending are anchor-real, CPI is the year's START factor, tax/payroll
 * use the anchor pack, and every posted evaluation amount is nominal CAD.
 */
export function evaluateCanonicalWorkingYear(plan: InputsV2, evidence: WorkingSpendingEvidence, year?: number, generatedState?: AnnualState): KernelResult<CanonicalWorkingEvaluation> {
  try {
    // Validate the canonical base, even for a later year's stateless quote.
    const base = initializeState(plan)
    if (base.status !== 'ok') return base
    // Resolve the optional clock only after validation; malformed runtime input
    // must return invalid even when the caller omits the year.
    if (year === undefined) year = plan.baseYear
    if (plan.baseYear !== PLAN_TAX_YEAR) return fail('unsupported', 'working pricing requires baseYear equal to tax/payroll anchor year')
    if (!Number.isInteger(year) || year < plan.baseYear) return fail('invalid', 'working evaluation year')
    if (plan.people.length !== 1 || plan.people[0].role !== 'self' || plan.province !== 'ON') return fail('unsupported', 'working pricing requires a single Ontario person')
    const generated = !!generatedState && generatedState.year === year && isCanonicalGeneratedState(plan, generatedState)
    const person = plan.people[0]
    const age = ageReachedInYear(person, plan.baseYear, year)
    if (![person.ageInBaseYear, person.retirementAge, plan.lifeExpectancy].every(Number.isInteger)) return fail('invalid', 'working age clocks must use whole years')
    if (age > plan.lifeExpectancy) return fail('invalid', 'year beyond plan horizon')
    if (age >= person.retirementAge) return fail('unsupported', 'working pricing stops at retirement; transition not yet wired')
    // The existing payroll model has no pre-18 CPP eligibility rule.
    if (age < 18 || age >= 70) return fail('unsupported', 'working payroll supports ages 18 through 69')
    if (plan.budget.kind !== 'incomeBudget') return fail('unsupported', 'working pricing requires incomeBudget')
    for (const key of ['workingSpending', 'retirementSpending'] as const) {
      if (!safeMoney(plan.budget[key])) return fail('invalid', `working budget amount: ${key}`)
      const fact = evidence[key]
      if (fact?.status !== 'known') return fail('unsupported', `working spending evidence missing: ${key}`)
      if (!safeMoney(fact.value) || fact.value !== plan.budget[key]) return fail('invalid', `working spending evidence disagrees with plan: ${key}`)
    }
    if (person.earnedIncome.status !== 'known') return fail('unsupported', 'working wage evidence unknown')
    if (!safeMoney(person.earnedIncome.value)) return fail('invalid', 'working wage amount')
    const futureOas = generated && plan.annualBenefitsEvidence ? annualOas(plan, person, age) : undefined
    if (futureOas && futureOas.grossReal === 0) annualGis(plan, person.id, year, age, futureOas)
    if (futureOas && futureOas.grossReal > 0) return fail('unsupported', 'working OAS settlement not yet wired')
    if ((!generated && person.cppAnnualAt65 !== 0) || (!futureOas && person.oasAnnualAt65 !== 0) || !['manual', 'statement'].includes(person.cppAmountSource?.source ?? '') || !['manual', 'statement'].includes(person.oasAmountSource?.source ?? '')) return fail('unsupported', 'working benefits require explicit supplied zero evidence')
    if (person.pension || person.pensionAnnual !== 0 || person.cppWork) return fail('unsupported', 'working pension and CPP work rules not yet wired')
    if (plan.dependents.length || plan.debts.length || (plan.properties.length && (!generated || passiveHomeProblem(plan)))) return fail('unsupported', 'working dependents/property/debt pricing not yet wired')
    if (plan.taxProfile?.pensionSplit || plan.taxProfile?.qcPensionSplit) return fail('unsupported', 'working tax elections not supported')
    const cpp = generated && person.cppAnnualAt65 !== 0 ? annualCpp(plan, person, age) : undefined
    if (plan.incomeSources.some(s => !(cpp && s.kind === 'cpp' && s.recipientId === person.id) && (s.fromAge ?? -Infinity) <= age && (s.startAge ?? -Infinity) <= age && (s.toAge ?? Infinity) >= age && (s.annualAmount.status !== 'known' || s.annualAmount.value !== 0))) return fail('unsupported', 'additional active working income source not yet wired')
    if (person.rrspUnusedUndeducted.status !== 'known' || person.rrspUnusedUndeducted.value !== 0 || plan.contributions.some(c => c.amount !== 0) || plan.recurringContributions.some(c => c.annualAmount !== 0)) return fail('unsupported', 'working registered contributions and deductions not yet wired')
    const poolAllowed = generated && !!plan.annualNonRegEvidence
    if (poolAllowed) { const problem = nonRegProblem(plan, generatedState!); if (problem) return fail("unsupported", problem) }
    // Even a zero nonReg placeholder is deliberately outside this quote's
    // scope: zero balance alone does not verify absence of active tax facts.
    if (plan.accounts.some(a => (!['tfsa', 'rrsp'].includes(a.kind) && !(poolAllowed && a.kind === 'nonReg')) || a.ownerId !== person.id) || ['tfsa', 'rrsp'].some(k => plan.accounts.filter(a => a.kind === k).length > 1)) return fail('unsupported', 'working supports one owned ordinary RRSP and one TFSA')
    const startCpi = (1 + plan.inflation) ** (year - plan.baseYear)
    if (1 + plan.inflation <= 0 || !Number.isFinite(startCpi) || startCpi <= 0 || !Number.isFinite(1 / startCpi)) return fail('invalid', 'working CPI ratio')
    const gross = person.earnedIncome.value
    const payroll = sideIncomeDeductions(gross, 'employment', plan.province, age)
    const priced = calculateHouseholdTax(plan, year, [{ id: `annual:${year}:wage:${person.id}`, personId: person.id, kind: 'employment', amount: gross }, ...(cpp ? [{ id: `annual:${year}:cpp:${person.id}`, personId: person.id, kind: 'cpp' as const, amount: cpp.amountReal }] : [])], { payroll: { [person.id]: payroll } })
    if (priced.status !== 'ok') return fail(priced.status, priced.reason)
    const taxPerson = priced.byPerson[person.id]
    const income = (gross + (cpp?.amountReal ?? 0)) * startCpi
    const tax = priced.total * startCpi
    const payrollContributions = payroll.contributions * startCpi
    const spending = plan.budget.workingSpending * startCpi
    const taxableIncome = taxPerson.taxableIncome * startCpi
    // Enhanced CPP lowers taxable income in calculateHouseholdTax once. The
    // full cash payroll is subtracted here once, never hidden inside tax.
    // Net in the common anchor basis before indexing. Separately indexing
    // each cash leg can turn exact exhaustion into a tiny nominal deficit.
    const cashResidualReal = gross + (cpp?.amountReal ?? 0) - payroll.contributions - priced.total - plan.budget.workingSpending
    // Normalize only operand-scale floating-point residue, symmetrically for
    // surplus and deficit. Do not impose a minimum scale: a zero-wage 1e-12
    // expense is a real deficit. Cap below half a cent in BOTH anchor and
    // nominal dollars so large operands/CPI cannot turn this into cash rounding.
    const arithmeticBoundReal = Math.min(0.004, 0.004 / startCpi,
      4 * Number.EPSILON * (gross + payroll.contributions + priced.total + plan.budget.workingSpending))
    const netCashReal = Math.abs(cashResidualReal) <= arithmeticBoundReal ? 0 : cashResidualReal
    const netCash = netCashReal * startCpi
    if (![income, tax, payrollContributions, spending, taxableIncome].every(safeMoney) || !Number.isFinite(netCash)) return fail('invalid', 'working nominal pricing amount')
    if (netCashReal < 0) return fail('unsupported', 'negative working cash requires withdrawal funding rule')
    const { rulePackId, ruleYear, assumedFutureRule, projectionPolicy, coverage } = priced
    return { status: 'ok', value: { evaluationBasis: 'canonical-working', year, personId: person.id, age, startCpi, ...(futureOas ? { oas: futureOas } : {}), ...(cpp ? { cpp } : {}),
      suppliedInputs: { basis: 'supplied-known', grossWagesReal: gross, workingSpendingReal: plan.budget.workingSpending, retirementSpendingReal: plan.budget.retirementSpending },
      taxRules: { rulePackId, ruleYear, assumedFutureRule, projectionPolicy, coverage }, payrollReal: payroll, payrollContributions, netCash,
      evaluation: { byPerson: { [person.id]: { income, earnedIncome: gross * startCpi, ...(cpp ? { cpp: cpp.amountReal * startCpi } : {}), benefits: 0, tax, spending, taxableIncome, benefitIncomeForNextYear: { status: 'known', value: taxPerson.netIncome * startCpi } } } },
      overallConclusionAvailable: false } }
  } catch (e) { if (e && typeof e === 'object' && 'reason' in e && 'status' in e) return fail(e.status === 'invalid' ? 'invalid' : 'unsupported', String(e.reason)); return fail('invalid', 'damaged working plan or spending evidence') }
}
