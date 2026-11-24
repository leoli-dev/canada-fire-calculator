import type { InputsV2, Known } from './model'
import { ageReachedInYear } from './model'
import { initializeState, type AnnualEvaluation, type KernelResult } from './annualState'
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
}

export interface CanonicalWorkingEvaluation {
  evaluationBasis: 'canonical-working'
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

const fail = (status: 'invalid' | 'unsupported', detail: string): KernelResult<never> => ({ status, issues: [{ code: status, detail }] })
const safeMoney = (n: number) => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER / 100

/** First BE-13 B slice: price a working year from canonical plan facts only.
 * This does not settle accounts, accept snapshots, splice provider rows, or
 * authorize a retirement transition. A future settlement entry point must
 * start at initializeState and carry the same plan through verified steps.
 * Wages/spending are anchor-real, CPI is the year's START factor, tax/payroll
 * use the anchor pack, and every posted evaluation amount is nominal CAD.
 */
export function evaluateCanonicalWorkingYear(plan: InputsV2, evidence: WorkingSpendingEvidence, year?: number): KernelResult<CanonicalWorkingEvaluation> {
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
    if (person.cppAnnualAt65 !== 0 || person.oasAnnualAt65 !== 0 || !['manual', 'statement'].includes(person.cppAmountSource?.source ?? '') || !['manual', 'statement'].includes(person.oasAmountSource?.source ?? '')) return fail('unsupported', 'working benefits require explicit supplied zero evidence')
    if (person.pension || person.pensionAnnual !== 0 || person.cppWork) return fail('unsupported', 'working pension and CPP work rules not yet wired')
    if (plan.dependents.length || plan.properties.length || plan.debts.length) return fail('unsupported', 'working dependents/property/debt pricing not yet wired')
    if (plan.taxProfile?.pensionSplit || plan.taxProfile?.qcPensionSplit) return fail('unsupported', 'working tax elections not supported')
    if (plan.incomeSources.some(s => (s.fromAge ?? -Infinity) <= age && (s.startAge ?? -Infinity) <= age && (s.toAge ?? Infinity) >= age && (s.annualAmount.status !== 'known' || s.annualAmount.value !== 0))) return fail('unsupported', 'additional active working income source not yet wired')
    if (person.rrspUnusedUndeducted.status !== 'known' || person.rrspUnusedUndeducted.value !== 0 || plan.contributions.some(c => c.amount !== 0) || plan.recurringContributions.some(c => c.annualAmount !== 0)) return fail('unsupported', 'working registered contributions and deductions not yet wired')
    // Even a zero nonReg placeholder is deliberately outside this quote's
    // scope: zero balance alone does not verify absence of active tax facts.
    if (plan.accounts.some(a => !['tfsa', 'rrsp'].includes(a.kind) || a.ownerId !== person.id) || ['tfsa', 'rrsp'].some(k => plan.accounts.filter(a => a.kind === k).length > 1)) return fail('unsupported', 'working supports one owned ordinary RRSP and one TFSA')
    const startCpi = (1 + plan.inflation) ** (year - plan.baseYear)
    if (1 + plan.inflation <= 0 || !Number.isFinite(startCpi) || startCpi <= 0 || !Number.isFinite(1 / startCpi)) return fail('invalid', 'working CPI ratio')
    const gross = person.earnedIncome.value
    const payroll = sideIncomeDeductions(gross, 'employment', plan.province, age)
    const priced = calculateHouseholdTax(plan, year, [{ id: `annual:${year}:wage:${person.id}`, personId: person.id, kind: 'employment', amount: gross }], { payroll: { [person.id]: payroll } })
    if (priced.status !== 'ok') return fail(priced.status, priced.reason)
    const taxPerson = priced.byPerson[person.id]
    const income = gross * startCpi
    const tax = priced.total * startCpi
    const payrollContributions = payroll.contributions * startCpi
    const spending = plan.budget.workingSpending * startCpi
    const taxableIncome = taxPerson.taxableIncome * startCpi
    // Enhanced CPP lowers taxable income in calculateHouseholdTax once. The
    // full cash payroll is subtracted here once, never hidden inside tax.
    // Net in the common anchor basis before indexing. Separately indexing
    // each cash leg can turn exact exhaustion into a tiny nominal deficit.
    const cashResidualReal = gross - payroll.contributions - priced.total - plan.budget.workingSpending
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
    return { status: 'ok', value: { evaluationBasis: 'canonical-working', year, personId: person.id, age, startCpi,
      suppliedInputs: { basis: 'supplied-known', grossWagesReal: gross, workingSpendingReal: plan.budget.workingSpending, retirementSpendingReal: plan.budget.retirementSpending },
      taxRules: { rulePackId, ruleYear, assumedFutureRule, projectionPolicy, coverage }, payrollReal: payroll, payrollContributions, netCash,
      evaluation: { byPerson: { [person.id]: { income, earnedIncome: income, benefits: 0, tax, spending, taxableIncome, benefitIncomeForNextYear: { status: 'known', value: taxPerson.netIncome * startCpi } } } },
      overallConclusionAvailable: false } }
  } catch { return fail('invalid', 'damaged working plan or spending evidence') }
}
