import type { InputsV2, Known, AccountKind } from './model'
import { ageReachedInYear, precisionGate } from './model'
import { assertCanonicalPlan } from './modelValidation'
import { resolveYearAllocation, type FundingGap } from './funding'
import { impliedRate } from './debts'
import {
  RRSP_ADDITION_RULE_MISSING, plannedRrspLines, rrspRoomYear, statementOpeningRoom,
  type RrspRoomLimitation, type RrspRoomYear,
} from './rrspRoom'

/** Nominal CAD throughout. A snapshot is an owned value; evaluators receive copies. */
export interface AnnualState {
  year: number
  baseYear: number
  byPerson: Record<string, { age: number; retirementAge: number; previousYearEarnedIncome: Known<number>; rrspRoom: Known<number>; tfsaRoom: Known<number>
    rrspDeductionLimit: Known<number>; rrspUnusedUndeducted: Known<number>
    rrspPensionAdjustment: Known<number>; rrspPspa: Known<number>; rrspPar: Known<number> }>
  byAccount: Record<string, { kind: AccountKind; ownerId: string; balance: number; acb: Known<number>; room: Known<number>; openedYear: Known<number> }>
  byDependent: Record<string, { age: number }>
  byDebt: Record<string, { principal: number; annualPayment: number; yearsRemaining: number; propertyId: string | null }>
  byProperty: Record<string, { value: number; held: boolean; acb: Known<number> }>
  contributionHistory: { id: string; accountId: string; contributorId: string | null; calendarYear: number; amount: number; deductionYear: number | null }[]
  benefitIncomeLag: Record<string, Known<number>>
  unfundedEvents: FundingGap[]
}

export interface AnnualEvaluation {
  /** Explicit external cash/tax facts for this year. No legacy household tax split is inferred here. */
  byPerson: Record<string, { income: number; earnedIncome: number; benefits: number; tax: number; spending: number; taxableIncome: number; benefitIncomeForNextYear: Known<number> }>
}
export interface AnnualContext { plan: InputsV2; state: AnnualState }
export type TaxBenefitEvaluator = (context: AnnualContext) => AnnualEvaluation
export type ReturnProvider = (context: AnnualContext, accountId: string) => number
export interface AnnualProviders { evaluate: TaxBenefitEvaluator; returns: ReturnProvider }
/** Deterministic nominal return from the canonical real-return and fee assumptions. */
export const fixedReturnProvider: ReturnProvider = ({ plan }, accountId) => {
  const account = plan.accounts.find(item => item.id === accountId)
  if (!account) return Number.NaN
  return (1 + account.realReturn - account.annualFee) * (1 + plan.inflation) - 1
}
export interface AnnualIssue { code: 'invalid' | 'unsupported' | 'unfunded'; detail: string; eventId?: string }
export interface YearRow {
  year: number
  byPerson: Record<string, { age: number; income: number; earnedIncome: number; benefits: number; tax: number; spending: number; taxableIncome: number }>
  byAccount: Record<string, { opening: number; contribution: number; withdrawal: number; returnAmount: number; closing: number; acb: Known<number>; ownerId: string }>
  cashLedger: { income: number; benefits: number; tax: number; spending: number; debtPayments: number; fhsaContributions: number; employeeContributions: number; employerContributions: number; voluntaryContributions: number; retainedContributions: number; unallocated: number }
  taxLedger: Record<string, { taxableIncome: number; tax: number }>
  /** BE-12 A per-person room ledger; every year is recomputable from its parts. */
  rrspLedger: Record<string, RrspRoomYear>
  issues: AnnualIssue[]
}
export type KernelResult<T> = { status: 'ok'; value: T } | { status: 'invalid' | 'unsupported'; issues: AnnualIssue[] }
export interface AnnualStepValue { state: AnnualState; row: YearRow }
const clone = <T>(value: T): T => structuredClone(value)
const fail = (status: 'invalid' | 'unsupported', detail: string): KernelResult<never> => ({ status, issues: [{ code: status, detail }] })
const finiteNonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const validKnownAmount = (value: unknown, nonnegative = false): value is Known<number> => {
  if (!value || typeof value !== 'object') return false
  const fact = value as Known<number>
  return fact.status === 'unknown' ? typeof fact.reason === 'string' && fact.reason.length > 0
    : fact.status === 'known' && typeof fact.value === 'number' && Number.isFinite(fact.value) && (!nonnegative || fact.value >= 0)
}
const sameKnown = (left: Known<number>, right: Known<number>) => left.status === right.status &&
  (left.status === 'known' && right.status === 'known' ? left.value === right.value :
    left.status === 'unknown' && right.status === 'unknown' && left.reason === right.reason)
const sameContribution = (left: AnnualState['contributionHistory'][number], right: InputsV2['contributions'][number]) =>
  left.id === right.id && left.accountId === right.accountId && left.contributorId === right.contributorId &&
  left.calendarYear === right.calendarYear && left.amount === right.amount && left.deductionYear === right.deductionYear
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

export function initializeState(plan: InputsV2): KernelResult<AnnualState> {
  try { assertCanonicalPlan(plan) } catch { return fail('invalid', 'canonical plan shape') }
  const gate = precisionGate(plan)
  if (!gate.allowed) return fail('unsupported', `precision gate: ${gate.reasons.join(', ')}`)
  if (plan.accounts.some(account => account.ownerId === null)) return fail('unsupported', 'account ownership unknown')
  if (plan.accounts.some(account => !finiteNonnegative(account.balance)) || plan.debts.some(debt => !finiteNonnegative(debt.principal))) return fail('invalid', 'negative or nonfinite opening balance')
  const byPerson = Object.fromEntries(plan.people.map(person => [person.id, {
    age: ageReachedInYear(person, plan.baseYear, plan.baseYear), retirementAge: person.retirementAge,
    previousYearEarnedIncome: clone(person.previousYearEarnedIncome), rrspRoom: clone(person.rrspAvailableRoom), tfsaRoom: clone(person.tfsaAvailableRoom),
    rrspDeductionLimit: clone(person.rrspDeductionLimit), rrspUnusedUndeducted: clone(person.rrspUnusedUndeducted),
    rrspPensionAdjustment: clone(person.rrspPensionAdjustment), rrspPspa: clone(person.rrspPspa), rrspPar: clone(person.rrspPar),
  }]))
  const byAccount = Object.fromEntries(plan.accounts.map(account => [account.id, {
    kind: account.kind, ownerId: account.ownerId!, balance: account.balance, acb: clone(account.acb), room: clone(account.contributionRoom), openedYear: clone(account.openedYear),
  }]))
  const byDebt = Object.fromEntries(plan.debts.map(debt => [debt.id, { principal: debt.principal, annualPayment: debt.annualPayment, yearsRemaining: debt.yearsRemaining, propertyId: debt.propertyId }]))
  const byDependent = Object.fromEntries(plan.dependents.map(dependent => [dependent.id, { age: dependent.ageInBaseYear }]))
  const byProperty = Object.fromEntries(plan.properties.map(property => [property.id, { value: property.value, held: property.plannedPurchaseAge === null, acb: clone(property.acb) }]))
  const state: AnnualState = { year: plan.baseYear, baseYear: plan.baseYear, byPerson, byAccount, byDependent, byDebt, byProperty,
    contributionHistory: plan.contributions.filter(c => c.calendarYear < plan.baseYear).map(c => ({ id: c.id, accountId: c.accountId, contributorId: c.contributorId, calendarYear: c.calendarYear, amount: c.amount, deductionYear: c.deductionYear })),
    benefitIncomeLag: Object.fromEntries(plan.people.map(person => [person.id, { status: 'unknown', reason: 'benefit income basis not supplied' }])), unfundedEvents: [] }
  const problem = snapshotProblem(plan, state)
  return problem ? fail('invalid', problem) : { status: 'ok', value: state }
}

/** Only supported, settled events commit. No trial may mutate the caller's state. */
function snapshotProblem(plan: InputsV2, opening: AnnualState): string | null {
  try {
    const self = plan.people.find(person => person.role === 'self')!
    if (!Number.isInteger(opening.year) || opening.year < plan.baseYear || opening.baseYear !== plan.baseYear) return 'snapshot year/base mismatch'
    if (opening.year > plan.baseYear + plan.lifeExpectancy - self.ageInBaseYear + 1) return 'year beyond plan horizon'
    if (Object.keys(opening.byPerson ?? {}).sort().join('|') !== plan.people.map(p => p.id).sort().join('|') ||
        Object.keys(opening.byAccount ?? {}).sort().join('|') !== plan.accounts.map(a => a.id).sort().join('|') ||
        Object.keys(opening.byDependent ?? {}).sort().join('|') !== plan.dependents.map(d => d.id).sort().join('|') ||
        Object.keys(opening.byDebt ?? {}).sort().join('|') !== plan.debts.map(d => d.id).sort().join('|') ||
        Object.keys(opening.byProperty ?? {}).sort().join('|') !== plan.properties.map(p => p.id).sort().join('|')) return 'snapshot entity IDs'
    if (Object.values(opening.byAccount).some(a => !finiteNonnegative(a.balance)) ||
        Object.values(opening.byDebt).some(d => !finiteNonnegative(d.principal) || !finiteNonnegative(d.annualPayment) || !Number.isInteger(d.yearsRemaining) || d.yearsRemaining < 0 || (d.principal > 0 && d.yearsRemaining === 0))) return 'snapshot balance or debt term'
    if (Object.values(opening.byPerson).some(p => !validKnownAmount(p.previousYearEarnedIncome) || !validKnownAmount(p.rrspRoom, true) || !validKnownAmount(p.tfsaRoom, true) ||
        !validKnownAmount(p.rrspDeductionLimit, true) || !validKnownAmount(p.rrspUnusedUndeducted, true) ||
        !validKnownAmount(p.rrspPensionAdjustment, true) || !validKnownAmount(p.rrspPspa, true) || !validKnownAmount(p.rrspPar, true)) ||
        Object.values(opening.byAccount).some(a => !validKnownAmount(a.acb, true) || !validKnownAmount(a.room, true) || !validKnownAmount(a.openedYear) || (a.openedYear.status === 'known' && !Number.isInteger(a.openedYear.value))) ||
        Object.values(opening.byProperty).some(p => !finiteNonnegative(p.value) || !validKnownAmount(p.acb, true)) ||
        Object.values(opening.benefitIncomeLag ?? {}).some(v => !validKnownAmount(v)) ||
        Object.keys(opening.benefitIncomeLag ?? {}).sort().join('|') !== plan.people.map(p => p.id).sort().join('|') ||
        !Array.isArray(opening.contributionHistory) || opening.contributionHistory.some(c => !finiteNonnegative(c.amount) || !Number.isInteger(c.calendarYear)) ||
        !Array.isArray(opening.unfundedEvents) || opening.unfundedEvents.some(gap => !finiteNonnegative(gap.amount))) return 'snapshot nested amount'
    if (plan.people.some(person => opening.byPerson[person.id].age !== ageReachedInYear(person, plan.baseYear, opening.year) ||
        opening.byPerson[person.id].retirementAge !== person.retirementAge) ||
        plan.dependents.some(dependent => opening.byDependent[dependent.id].age !== dependent.ageInBaseYear + opening.year - plan.baseYear) ||
        plan.accounts.some(account => opening.byAccount[account.id].kind !== account.kind || opening.byAccount[account.id].ownerId !== account.ownerId)) return 'snapshot identity or age'
    // A never executes purchase/sale or changes opening-year facts. A candidate
    // cannot claim the property was acquired or a missing statement was verified.
    if (plan.properties.some(property => opening.byProperty[property.id].held !== (property.plannedPurchaseAge === null) ||
        !sameKnown(opening.byProperty[property.id].acb, property.acb)) ||
        plan.debts.some(debt => opening.byDebt[debt.id].annualPayment !== debt.annualPayment ||
          opening.byDebt[debt.id].propertyId !== debt.propertyId) ||
        plan.accounts.some(account => !sameKnown(opening.byAccount[account.id].openedYear, account.openedYear))) return 'snapshot event or opening fact'
    const priorContributions = plan.contributions.filter(contribution => contribution.calendarYear < plan.baseYear)
    if (opening.year === plan.baseYear && (
      plan.accounts.some(account => opening.byAccount[account.id].balance !== account.balance ||
        !sameKnown(opening.byAccount[account.id].acb, account.acb) ||
        !sameKnown(opening.byAccount[account.id].room, account.contributionRoom)) ||
      plan.properties.some(property => opening.byProperty[property.id].value !== property.value) ||
      plan.debts.some(debt => opening.byDebt[debt.id].principal !== debt.principal ||
        opening.byDebt[debt.id].yearsRemaining !== debt.yearsRemaining) ||
      plan.people.some(person => !sameKnown(opening.byPerson[person.id].rrspRoom, person.rrspAvailableRoom) ||
        !sameKnown(opening.byPerson[person.id].tfsaRoom, person.tfsaAvailableRoom) ||
        !sameKnown(opening.byPerson[person.id].rrspDeductionLimit, person.rrspDeductionLimit) ||
        !sameKnown(opening.byPerson[person.id].rrspUnusedUndeducted, person.rrspUnusedUndeducted) ||
        !sameKnown(opening.byPerson[person.id].rrspPensionAdjustment, person.rrspPensionAdjustment) ||
        !sameKnown(opening.byPerson[person.id].rrspPspa, person.rrspPspa) ||
        !sameKnown(opening.byPerson[person.id].rrspPar, person.rrspPar) ||
        !sameKnown(opening.byPerson[person.id].previousYearEarnedIncome, person.previousYearEarnedIncome)) ||
      plan.people.some(person => !sameKnown(opening.benefitIncomeLag[person.id], { status: 'unknown', reason: 'benefit income basis not supplied' })) ||
      opening.unfundedEvents.length !== 0 ||
      priorContributions.length !== opening.contributionHistory.length ||
      priorContributions.some((contribution, index) => !sameContribution(opening.contributionHistory[index], contribution))
    )) return 'snapshot base-year facts'
    return null
  } catch { return 'damaged annual snapshot' }
}

function annualStepUnchecked(plan: InputsV2, opening: AnnualState, providers: AnnualProviders): KernelResult<AnnualStepValue> {
  try { assertCanonicalPlan(plan) } catch { return fail('invalid', 'canonical plan shape') }
  const gate = precisionGate(plan)
  if (!gate.allowed) return fail('unsupported', `precision gate: ${gate.reasons.join(', ')}`)
  const self = plan.people.find(person => person.role === 'self')!
  const problem = snapshotProblem(plan, opening)
  if (problem) return fail('invalid', problem)
  if (opening.year >= plan.baseYear + plan.lifeExpectancy - self.ageInBaseYear + 1) return fail('invalid', 'year beyond plan horizon')
  const state = clone(opening)
  const year = opening.year
  // Rules not yet supplied by BE-11/12/23/38 must not masquerade as exact advice.
  // These obligations follow the account holder's age, even when they remain
  // employed. A does not compute minimums, conversions, or FHSA closure tax.
  for (const account of plan.accounts) {
    const current = state.byAccount[account.id]
    const ownerAge = state.byPerson[account.ownerId!].age
    const plannedContribution = plan.recurringContributions.some(item => item.accountId === account.id && item.annualAmount > 0) ||
      plan.contributions.some(item => item.accountId === account.id && item.calendarYear === year && item.amount > 0) ||
      (account.kind === 'rrsp' && plan.budget.kind === 'savingsBudget' && plan.budget.annualNetSavings > 0 && plan.savingsAllocation.shares.rrsp > 0)
    if (current.balance <= 0 && !plannedContribution) continue
    if (account.kind === 'rrif' || account.kind === 'lif') return fail('unsupported', `${account.kind.toUpperCase()} minimum withdrawal rule not yet wired: ${account.id}`)
    if (ownerAge >= 71 && ['rrsp', 'spousalRrsp', 'lira'].includes(account.kind)) return fail('unsupported', `${account.kind === 'lira' ? 'LIRA' : 'RRSP'} age-71 conversion rule not yet wired: ${account.id}`)
    if (ownerAge >= 71 && account.kind === 'fhsa') return fail('unsupported', `FHSA age-71 closure rule not yet wired: ${account.id}`)
  }
  if (plan.people.some(person => state.byPerson[person.id]?.age >= person.retirementAge)) return fail('unsupported', 'retirement withdrawals and benefit rules not yet wired')
  if (plan.properties.some(property => property.plannedPurchaseAge !== null && state.byPerson[self.id].age >= property.plannedPurchaseAge && !state.byProperty[property.id]?.held)) return fail('unsupported', 'planned purchase funding and tax integration not yet wired')
  if (plan.properties.some(property => property.sellAtAge !== null && state.byPerson[self.id].age >= property.sellAtAge && state.byProperty[property.id]?.held)) return fail('unsupported', 'property sale funding and tax integration not yet wired')
  const activeFhsa = plan.accounts.filter(account => account.kind === 'fhsa' &&
    (state.byAccount[account.id].balance > 0 || plan.recurringContributions.some(c => c.accountId === account.id && c.annualAmount > 0)))
  if (activeFhsa.some(account => {
    const opened = state.byAccount[account.id].openedYear
    return opened.status === 'unknown' || year < opened.value
  })) return fail('unsupported', 'FHSA opening year unknown or in the future')
  if (activeFhsa.some(account => {
    const opened = state.byAccount[account.id].openedYear
    return opened.status === 'known' && year - opened.value >= 15
  })) return fail('unsupported', 'FHSA statutory rollover not yet wired')
  if (plan.recurringContributions.some(contribution => state.byAccount[contribution.accountId]?.kind === 'fhsa' && contribution.annualAmount > 0)) return fail('unsupported', 'FHSA contribution annual and lifetime rules not yet wired')
  // BE-12 A: a scheduled contribution is priced by the person's own RRSP room
  // ledger. Spousal or attributed contributions stay explicitly unsupported.
  const scheduled = plan.contributions.filter(contribution => contribution.calendarYear === year && contribution.amount > 0)
  const scheduledByPerson: Record<string, { accountId: string; planned: number }> = {}
  for (const contribution of scheduled) {
    if (!finiteNonnegative(contribution.amount) || (contribution.deductionYear !== null && !Number.isInteger(contribution.deductionYear))) return fail('invalid', `scheduled contribution facts: ${contribution.id}`)
    const account = state.byAccount[contribution.accountId]
    if (!account) return fail('invalid', `scheduled contribution account missing: ${contribution.id}`)
    if (account.kind === 'spousalRrsp') return fail('unsupported', `spousal RRSP attribution (T2205) is not wired: ${contribution.id}`)
    if (account.kind !== 'rrsp') return fail('unsupported', `scheduled ${account.kind} contribution rule not yet wired: ${contribution.id}`)
    if (contribution.contributorId === null) return fail('unsupported', `scheduled RRSP contributor not recorded: ${contribution.id}`)
    if (contribution.contributorId !== account.ownerId) return fail('unsupported', `RRSP contributor differs from the account owner; spousal attribution is not wired: ${contribution.id}`)
    const bucket = scheduledByPerson[contribution.contributorId] ??= { accountId: contribution.accountId, planned: 0 }
    if (bucket.accountId !== contribution.accountId) return fail('unsupported', `one person has scheduled RRSP contributions to more than one account: ${contribution.contributorId}`)
    bucket.planned += contribution.amount
  }
  const view = (): AnnualContext => ({ plan: clone(plan), state: clone(state) })
  let evaluation: AnnualEvaluation
  try { evaluation = providers.evaluate(view()) } catch { return fail('invalid', 'tax/benefit evaluator failed') }
  if (!evaluation || Object.keys(evaluation.byPerson ?? {}).sort().join('|') !== Object.keys(state.byPerson).sort().join('|')) return fail('invalid', 'evaluator person IDs')
  const personRows: YearRow['byPerson'] = {}
  for (const [id, person] of Object.entries(state.byPerson)) {
    const entry = evaluation.byPerson[id]
    if (!entry || ![entry.income, entry.earnedIncome, entry.benefits, entry.tax, entry.spending, entry.taxableIncome].every(finiteNonnegative) ||
        !validKnownAmount(entry.benefitIncomeForNextYear)) return fail('invalid', `evaluator amounts: ${id}`)
    personRows[id] = { age: person.age, income: entry.income, earnedIncome: entry.earnedIncome, benefits: entry.benefits, tax: entry.tax, spending: entry.spending, taxableIncome: entry.taxableIncome }
  }
  for (const dependent of Object.values(state.byDependent)) dependent.age += 1
  const income = sum(Object.values(personRows).map(p => p.income))
  const benefits = sum(Object.values(personRows).map(p => p.benefits))
  const tax = sum(Object.values(personRows).map(p => p.tax))
  const spending = sum(Object.values(personRows).map(p => p.spending))
  // A savings budget is already net of living costs, tax/benefits and separately
  // listed debt. Evaluated cash is a consistency check, never extra money.
  if (plan.budget.kind !== 'savingsBudget' || plan.budget.debtIncluded.status !== 'known' || !plan.budget.debtIncluded.value ||
      plan.budget.taxBenefitIncluded.status !== 'known' || !plan.budget.taxBenefitIncluded.value) return fail('unsupported', 'budget treatment not yet reconciled')
  const cash = plan.budget.annualNetSavings * Math.pow(1 + plan.inflation, year - plan.baseYear)
  if (!Number.isFinite(cash)) return fail('invalid', 'nominal savings budget')
  if (cash < 0) return fail('unsupported', 'negative net savings needs withdrawal funding rule')
  let debtPayments = 0
  for (const [id, debt] of Object.entries(state.byDebt)) {
    if (debt.principal <= 0 || debt.yearsRemaining <= 0) continue
    const rate = impliedRate(debt.principal, debt.annualPayment, debt.yearsRemaining)
    if (debt.annualPayment * debt.yearsRemaining + 1e-8 < debt.principal) return fail('invalid', `debt cannot amortize: ${id}`)
    const accrued = debt.principal * (1 + rate)
    const due = Math.min(debt.annualPayment, accrued)
    debtPayments += due
    const remaining = Math.max(0, accrued - due)
    // Settle only representational noise on the final payment. The cash ledger
    // retains the actual due; a cent-scale shortfall must never disappear.
    const numericalResidue = Math.min(0.005, 64 * Number.EPSILON * Math.max(1, accrued, due))
    if (debt.yearsRemaining === 1 && remaining > numericalResidue) return fail('invalid', `debt unpaid at maturity: ${id}`)
    debt.principal = debt.yearsRemaining === 1 ? 0 : remaining
    debt.yearsRemaining -= 1
  }
  const evaluatedCash = income + benefits - tax - spending - debtPayments
  if (!Number.isFinite(evaluatedCash)) return fail('invalid', 'evaluated cash')
  if (evaluatedCash < -1e-8) return fail('unsupported', 'taxable withdrawal funding not yet wired')
  if (Math.abs(evaluatedCash - cash) > 0.01) return fail('unsupported', 'evaluated cash disagrees with canonical net savings budget')
  const recurring = plan.recurringContributions.filter(c => state.byAccount[c.accountId])
  if (recurring.length !== plan.recurringContributions.length) return fail('invalid', 'recurring contribution account missing')
  if (recurring.some(c => !finiteNonnegative(c.annualAmount) || !['fhsa', 'lira'].includes(state.byAccount[c.accountId].kind) || (state.byAccount[c.accountId].kind === 'fhsa' && c.funding !== 'fromSavings'))) return fail('unsupported', 'recurring contribution rule not yet wired')
  const scheduledPlanned = sum(Object.values(scheduledByPerson).map(bucket => bucket.planned))
  // A scheduled contribution is funded from the year's net savings, like the
  // configured voluntary split; it is never extra money the plan does not have.
  if (scheduledPlanned > cash + 1e-8) return fail('unsupported', 'scheduled RRSP contribution exceeds the year net savings')
  // One allocation resolver serves the kernel and the panel preview, so the
  // voluntary RRSP share priced here is the same number the panel shows.
  const allocation = resolveYearAllocation(plan, year)
  if (allocation.gaps.length) return { status: 'unsupported', issues: allocation.gaps.map(gap => ({ code: 'unfunded', detail: gap.reason, eventId: gap.eventId })) }
  if (plan.people.length > 1 && allocation.voluntary.rrsp > 0) return fail('unsupported', 'couple RRSP contributor and room attribution not yet wired')
  const rrspDestinations = Object.entries(state.byAccount).filter(([, account]) => account.kind === 'rrsp')
  if (allocation.voluntary.rrsp > 0 && rrspDestinations.length !== 1) return fail('unsupported', 'ambiguous rrsp contribution destination')
  const nonRegDestinations = Object.entries(state.byAccount).filter(([, account]) => account.kind === 'nonReg')
  const accountRows: YearRow['byAccount'] = {}
  for (const [id, account] of Object.entries(state.byAccount)) accountRows[id] = { opening: account.balance, contribution: 0, withdrawal: 0, returnAmount: 0, closing: account.balance, acb: clone(account.acb), ownerId: account.ownerId }
  for (const contribution of recurring) {
    const amount = contribution.annualAmount
    accountRows[contribution.accountId].contribution += amount
    state.contributionHistory.push({ id: `${contribution.id}:${year}`, accountId: contribution.accountId, contributorId: contribution.contributorId, calendarYear: year, amount, deductionYear: null })
  }
  // TFSA keeps its existing account/person room check; RRSP room is owned by
  // the per-person ledger below so an over-contribution is clipped, not refused.
  if (allocation.voluntary.tfsa > 0) {
    const destinations = Object.entries(state.byAccount).filter(([, account]) => account.kind === 'tfsa')
    if (destinations.length !== 1) return fail('unsupported', 'ambiguous tfsa contribution destination')
    accountRows[destinations[0][0]].contribution += allocation.voluntary.tfsa
    state.contributionHistory.push({ id: `annual:${year}:tfsa`, accountId: destinations[0][0], contributorId: plan.people.length === 1 ? self.id : null, calendarYear: year, amount: allocation.voluntary.tfsa, deductionYear: null })
  }
  const rrspLedger: Record<string, RrspRoomYear> = {}
  for (const person of plan.people) {
    const facts = state.byPerson[person.id]
    const bucket = scheduledByPerson[person.id]
    const voluntary = plan.people.length === 1 ? allocation.voluntary.rrsp : 0
    // The same line set `previewRrspRoomYear` prices for the panel: recorded
    // rows plus the resolved savings-split RRSP share.
    const lines = plannedRrspLines({ contributions: plan.contributions, personId: person.id, year, savingsShare: voluntary })
    const statementYear = year === plan.baseYear
    let openingRoom = facts.rrspRoom
    let mismatch: RrspRoomLimitation | null = null
    if (statementYear) {
      const derived = statementOpeningRoom({
        rrspDeductionLimit: facts.rrspDeductionLimit, rrspAvailableRoom: facts.rrspRoom, rrspUnusedUndeducted: facts.rrspUnusedUndeducted,
        rrspPensionAdjustment: facts.rrspPensionAdjustment, rrspPspa: facts.rrspPspa, rrspPar: facts.rrspPar,
      })
      openingRoom = derived.room
      mismatch = derived.mismatch
    }
    const row = rrspRoomYear({
      personId: person.id, year, openingRoom,
      // The statement's available room already includes the statement year's
      // addition. A later year would need the missing sourced cap/18% rule.
      additions: statementYear ? { status: 'known', value: 0 } : { status: 'unknown', reason: RRSP_ADDITION_RULE_MISSING },
      adjustments: { pensionAdjustment: facts.rrspPensionAdjustment, pspa: facts.rrspPspa, par: facts.rrspPar },
      adjustmentBasis: statementYear ? 'includedInStatement' : 'appliedHere',
      unusedUndeducted: facts.rrspUnusedUndeducted, deductionLimit: facts.rrspDeductionLimit, mismatch, lines,
    })
    rrspLedger[person.id] = row
    const blocking = row.limitations.filter(limitation => limitation.code !== 'deductionYearBeforeContribution')
    if (row.planned > 0 && blocking.length) return fail('unsupported', `RRSP room not verified for ${person.id}: ${blocking.map(item => item.detail).join('; ')}`)
    const backdated = row.limitations.find(limitation => limitation.code === 'deductionYearBeforeContribution')
    if (backdated) return fail('unsupported', backdated.detail)
    facts.rrspRoom = row.closingRoom
    for (const line of row.lines) {
      if (line.applied <= 0) continue
      const accountId = bucket?.accountId ?? rrspDestinations[0]?.[0]
      if (!accountId) return fail('unsupported', `RRSP contribution has no account: ${person.id}`)
      accountRows[accountId].contribution += line.applied
      state.contributionHistory.push({ id: line.id, accountId, contributorId: person.id, calendarYear: line.calendarYear, amount: line.applied, deductionYear: line.deductionYear })
    }
  }
  // Money an RRSP plan could not legally execute is retained, visibly, in the
  // non-registered account instead of being deleted or rerouted to registered room.
  const retainedContributions = sum(Object.values(rrspLedger).map(row => row.retained))
  const nonRegAmount = allocation.voluntary.nonReg + retainedContributions
  if (nonRegAmount > 0) {
    if (nonRegDestinations.length !== 1) return fail('unsupported', 'ambiguous nonReg contribution destination')
    accountRows[nonRegDestinations[0][0]].contribution += nonRegAmount
    state.contributionHistory.push({ id: `annual:${year}:nonReg`, accountId: nonRegDestinations[0][0], contributorId: plan.people.length === 1 ? self.id : null, calendarYear: year, amount: nonRegAmount, deductionYear: null })
  }
  for (const [id, row] of Object.entries(accountRows)) {
    if (row.contribution <= 0) continue
    const account = state.byAccount[id]
    if (!['tfsa', 'fhsa'].includes(account.kind)) continue
    if (account.room.status !== 'known') return fail('unsupported', `contribution room unknown: ${id}`)
    if (row.contribution > account.room.value + 1e-8) return fail('unsupported', `contribution exceeds account room: ${id}`)
    const person = state.byPerson[account.ownerId]
    const personRoom = account.kind === 'fhsa' ? undefined : person?.tfsaRoom
    if (account.kind !== 'fhsa' && (!personRoom || personRoom.status !== 'known')) return fail('unsupported', `person contribution room unknown: ${account.ownerId}`)
    if (personRoom?.status === 'known' && row.contribution > personRoom.value + 1e-8) return fail('unsupported', `contribution exceeds person room: ${account.ownerId}`)
    account.room.value -= row.contribution
    if (personRoom?.status === 'known') personRoom.value -= row.contribution
  }
  const totalContributions = sum(Object.values(accountRows).map(row => row.contribution))
  if (Math.abs(totalContributions - cash - allocation.employer) > 0.01) return fail('invalid', 'cash/contribution conservation')
  // Every provider evaluates the same settled, pre-growth portfolio. Neither
  // account order nor a provider mutating its own context may affect peers.
  for (const [id, account] of Object.entries(state.byAccount)) {
    account.balance += accountRows[id].contribution
    if (account.kind === 'nonReg' && account.acb.status === 'known') account.acb.value += accountRows[id].contribution
  }
  const settled = clone(state)
  if (Object.values(settled.byAccount).some(account => !finiteNonnegative(account.balance))) return fail('invalid', 'pre-growth account balance')
  const rates: Record<string, number> = {}
  for (const id of Object.keys(settled.byAccount)) {
    let rate: number
    try { rate = providers.returns({ plan: clone(plan), state: clone(settled) }, id) } catch { return fail('invalid', `return provider failed: ${id}`) }
    if (!Number.isFinite(rate) || rate < -1) return fail('invalid', `return rate: ${id}`)
    rates[id] = rate
  }
  for (const [id, account] of Object.entries(state.byAccount)) {
    accountRows[id].returnAmount = account.balance * rates[id]
    account.balance += accountRows[id].returnAmount
    accountRows[id].closing = account.balance
    accountRows[id].acb = clone(account.acb)
  }
  for (const property of plan.properties) if (state.byProperty[property.id].held) {
    const growthFactor = (1 + property.appreciation) * (1 + plan.inflation)
    if (!Number.isFinite(growthFactor)) return fail('invalid', `property growth is not finite: ${property.id}`)
    if (property.appreciation < -1 || plan.inflation < -1 || growthFactor < 0) return fail('unsupported', `property growth outside nonnegative value model: ${property.id}`)
    state.byProperty[property.id].value *= growthFactor
  }
  for (const [id, person] of Object.entries(state.byPerson)) {
    person.age += 1
    person.previousYearEarnedIncome = { status: 'known', value: personRows[id].earnedIncome }
    state.benefitIncomeLag[id] = clone(evaluation.byPerson[id].benefitIncomeForNextYear)
  }
  state.year += 1
  const committedProblem = snapshotProblem(plan, state)
  if (committedProblem) return fail('invalid', `year-end state: ${committedProblem}`)
  const row: YearRow = { year, byPerson: personRows, byAccount: accountRows,
    cashLedger: { income, benefits, tax, spending, debtPayments, fhsaContributions: allocation.fhsa, employeeContributions: allocation.employee,
      employerContributions: allocation.employer, voluntaryContributions: sum(Object.values(allocation.voluntary)), retainedContributions, unallocated: 0 },
    taxLedger: Object.fromEntries(Object.entries(personRows).map(([id, p]) => [id, { taxableIncome: p.taxableIncome, tax: p.tax }])), rrspLedger, issues: [] }
  return { status: 'ok', value: { state, row } }
}

export function annualStep(plan: InputsV2, opening: AnnualState, providers: AnnualProviders): KernelResult<AnnualStepValue> {
  try { return annualStepUnchecked(plan, opening, providers) }
  catch { return fail('invalid', 'damaged annual snapshot or provider result') }
}

export function projectFromState(plan: InputsV2, opening: AnnualState, years: number, providers: AnnualProviders): KernelResult<{ state: AnnualState; rows: YearRow[] }> {
  if (!Number.isInteger(years) || years < 0 || years > 120) return fail('invalid', 'projection years')
  try { assertCanonicalPlan(plan) } catch { return fail('invalid', 'canonical plan shape') }
  const gate = precisionGate(plan)
  if (!gate.allowed) return fail('unsupported', `precision gate: ${gate.reasons.join(', ')}`)
  const problem = snapshotProblem(plan, opening)
  if (problem) return fail('invalid', problem)
  let state: AnnualState
  try { state = clone(opening) } catch { return fail('invalid', 'snapshot cannot be cloned') }
  const rows: YearRow[] = []
  for (let index = 0; index < years; index++) {
    const next = annualStep(plan, state, providers)
    if (next.status !== 'ok') return next
    state = next.value.state
    rows.push(next.value.row)
  }
  return { status: 'ok', value: { state, rows } }
}

export const sumInvestableAssets = (state: AnnualState) => sum(Object.values(state.byAccount).map(account => account.balance))
export const sumNetWorth = (state: AnnualState) => sumInvestableAssets(state) + sum(Object.values(state.byProperty).filter(p => p.held).map(p => p.value)) - sum(Object.values(state.byDebt).map(d => d.principal))
export const sumWithdrawals = (row: YearRow) => sum(Object.values(row.byAccount).map(account => account.withdrawal))
