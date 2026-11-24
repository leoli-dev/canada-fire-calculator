import { annualCpp } from './annualCpp'
import type { InputsV2 } from './model'
import { pricingGate } from './model'
import { assertCanonicalPlan } from './modelValidation'
import { isCanonicalGeneratedState, annualStopCause, fixedReturnProvider, snapshotProblem, type AnnualState, type AnnualStepValue, type AnnualCoverage, type KernelResult, type ReturnProvider, type YearRow } from './annualState'
import { PLAN_TAX_YEAR } from './tax'
import { calculateHouseholdTax } from './householdTax'
import { allocateOrderedWithdrawals, searchWithdrawalTarget } from './withdrawalSearch'
import { annualTfsaAdditionFor, tfsaRoomYear, tfsaStatement } from './tfsaRoom'
import type { AccountType } from './types'

const fail = (status: 'invalid' | 'unsupported', detail: string): KernelResult<never> => ({ status, issues: [{ code: status, detail }] })
// Room arithmetic rounds to cents: reject values whose cents are not safely representable.
const safeMoney = (value: number) => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 100
function retirementSnapshotProblem(plan: InputsV2, state: AnnualState): string | null {
  try {
  const problem = snapshotProblem(plan, state)
  if (problem) return problem
  const ratio = 1 + plan.inflation
  const start = ratio ** (state.year - plan.baseYear)
  const end = start * ratio
  if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isFinite(start) || start <= 0 || !Number.isFinite(end) || end <= 0 || !Number.isFinite(1 / end)) return 'retirement CPI ratio'
  if (Object.values(state.byAccount).some(a => !safeMoney(a.balance)) || !safeMoney(Object.values(state.byAccount).reduce((sum, a) => sum + a.balance, 0))) return 'retirement unsafe monetary amount'
  if (Object.values(state.byPerson).some(p => p.tfsaRoom.status === 'known' && !safeMoney(p.tfsaRoom.value))) return 'retirement unsafe TFSA room'
  const history = state.tfsaWithdrawalHistory
  if (history !== undefined && !Array.isArray(history)) return 'TFSA withdrawal snapshot history'
  const ids = new Set<string>()
  for (const h of history ?? []) {
    const account = plan.accounts.find(a => a.kind === 'tfsa' && a.ownerId === h?.personId && h?.id === `annual:${h.calendarYear}:withdrawal:${a.id}`)
    if (!account || !Number.isInteger(h.calendarYear) || h.calendarYear < plan.baseYear || h.calendarYear >= state.year || !safeMoney(h.amount) || h.amount === 0 || ids.has(h.id)) return 'TFSA withdrawal snapshot history'
    ids.add(h.id)
  }
  return null
  } catch { return 'damaged retirement snapshot' }
}
/** Internal only: ordered draws, no external cash or mandatory registered rules.
 * Tax events enter the existing anchor-real tax engine; settlement is nominal.
 */
function retirementStep(plan: InputsV2, opening: AnnualState, returns: ReturnProvider, generated = false): KernelResult<AnnualStepValue> {
  try {
    assertCanonicalPlan(plan)
    if (generated && plan.baseYear !== PLAN_TAX_YEAR) return fail('unsupported', 'continuous retirement requires tax anchor')
    const gate = pricingGate(plan)
    if (!gate.allowed) return fail('unsupported', `pricing gate: ${gate.reasons.join(', ')}`)
    const problem = retirementSnapshotProblem(plan, opening)
    if (problem) return fail('invalid', problem)
    const person = plan.people[0]
    const age = opening.byPerson[person.id].age
    if (plan.people.length !== 1 || person.role !== 'self' || plan.province !== 'ON') return fail('unsupported', 'retirement requires a single Ontario person')
    if ((!generated && person.ageInBaseYear < person.retirementAge) || age < person.retirementAge) return fail('unsupported', 'retirement settlement requires already-retired person')
    if (age >= 71 && plan.accounts.some(a => a.kind === 'rrsp' && opening.byAccount[a.id].balance > 0)) return fail('unsupported', 'RRSP age-71 conversion rule not yet wired')
    if (age > plan.lifeExpectancy) return fail('invalid', 'year beyond plan horizon')
    if (!generated && (person.earnedIncome.status !== 'known' || person.earnedIncome.value !== 0)) return fail('unsupported', 'retirement wage evidence must be known zero')
    if ((!generated && person.cppAnnualAt65 !== 0) || person.oasAnnualAt65 !== 0 || !['manual', 'statement'].includes(person.cppAmountSource?.source ?? '') || !['manual', 'statement'].includes(person.oasAmountSource?.source ?? '')) return fail('unsupported', 'retirement benefit evidence must be explicitly supplied zero')
    if (person.pension || person.pensionAnnual !== 0 || person.cppWork) return fail('unsupported', 'retirement pension or CPP work rules not yet wired')
    if (plan.dependents.length || plan.properties.length || plan.debts.length) return fail('unsupported', 'retirement dependents/property/debt settlement not yet wired')
    if (plan.taxProfile?.pensionSplit || plan.taxProfile?.qcPensionSplit) return fail('unsupported', 'retirement tax election not supported')
    const cpp = generated && person.cppAnnualAt65 > 0 ? annualCpp(plan, person, age) : undefined
    if (plan.incomeSources.some(source => !(cpp && source.kind === 'cpp' && source.recipientId === person.id) && (source.fromAge ?? -Infinity) <= age && (source.startAge ?? -Infinity) <= age && (source.toAge ?? Infinity) >= age && (source.annualAmount.status !== 'known' || source.annualAmount.value !== 0))) return fail('unsupported', 'active retirement income source not yet wired')
    if (person.rrspUnusedUndeducted.status !== 'known' || person.rrspUnusedUndeducted.value !== 0) return fail('unsupported', 'retirement undeducted RRSP premiums require explicit zero evidence')
    if (plan.contributions.some(c => c.calendarYear < opening.year && c.deductionYear !== null && c.deductionYear >= opening.year && c.amount > 0)) return fail('unsupported', 'deferred retirement RRSP deductions not yet wired')
    if (plan.recurringContributions.some(c => c.annualAmount !== 0) || plan.contributions.some(c => c.calendarYear >= opening.year && c.amount !== 0)) return fail('unsupported', 'scheduled retirement contributions not yet wired')
    if (opening.unfundedEvents.length) return fail('unsupported', 'unsettled funding events')
    if (plan.strategy === 'meltdownPaced') return fail('unsupported', 'retirement meltdown strategy not yet wired')
    if (plan.accounts.some(a => (!['tfsa', 'rrsp'].includes(a.kind) && !(a.kind === 'nonReg' && a.balance === 0 && opening.byAccount[a.id].balance === 0)) || a.ownerId !== person.id) || ['tfsa', 'rrsp'].some(kind => plan.accounts.filter(a => a.kind === kind).length > 1)) return fail('unsupported', 'retirement supports one owned ordinary RRSP and one TFSA')
    const state = structuredClone(opening)
    const year = state.year
    const startCpi = (1 + plan.inflation) ** (year - plan.baseYear)
    const spendingDue = plan.budget.retirementSpending * startCpi
    if (!Number.isFinite(startCpi) || startCpi <= 0 || !safeMoney(spendingDue)) return fail('invalid', 'retirement CPI/spending')
    if (cpp && !safeMoney(cpp.amountReal * startCpi)) return fail('invalid', 'retirement CPP nominal amount unsafe')
    const balances = { tfsa: 0, rrsp: 0, nonReg: 0 }
    for (const a of plan.accounts) balances[a.kind as 'tfsa' | 'rrsp'] += state.byAccount[a.id].balance
    if (!Number.isFinite(balances.tfsa + balances.rrsp)) return fail('invalid', 'retirement aggregate balances')
    const order: AccountType[] = plan.strategy === 'tfsaFirst' ? ['tfsa', 'nonReg', 'rrsp'] : plan.strategy === 'nonRegFirst' ? ['nonReg', 'rrsp', 'tfsa'] : ['rrsp', 'nonReg', 'tfsa']
    const run = (gross: number) => {
      // Exact exhaustion is a canonical settlement invariant. Leave the shared
      // legacy allocator's subtraction order and all search calls untouched.
      const withdrawals = gross === balances.tfsa + balances.rrsp ? { ...balances } : allocateOrderedWithdrawals(gross, balances, 0, order.map(account => ({ account })))
      if (generated) for (const kind of ['tfsa', 'rrsp'] as const) {
        const remaining = balances[kind] - withdrawals[kind]
        const bound = Math.min(0.004, 4 * Number.EPSILON * (balances[kind] + withdrawals[kind]))
        if (remaining > 0 && remaining <= bound) withdrawals[kind] = balances[kind]
      }
      const rrsp = plan.accounts.find(a => a.kind === 'rrsp')
      const tax = calculateHouseholdTax(plan, year, [...(cpp ? [{ id: `annual:${year}:cpp:${person.id}`, personId: person.id, kind: 'cpp' as const, amount: cpp.amountReal }] : []), ...(rrsp ? [{ id: `annual:${year}:withdrawal:${rrsp.id}`, kind: 'rrspWithdrawal' as const, accountId: rrsp.id, amount: withdrawals.rrsp / startCpi }] : [])])
      if (tax.status !== 'ok') throw tax
      const nominalTax = tax.total * startCpi
      if (!Number.isFinite(nominalTax) || nominalTax < 0 || !Number.isFinite(tax.byPerson[person.id]?.taxableIncome)) throw new Error('invalid canonical tax')
      return { withdrawals, tax, nominalTax, netCash: (cpp?.amountReal ?? 0) * startCpi + withdrawals.rrsp + withdrawals.tfsa - nominalTax }
    }
    // No persistent cash account exists in this slice. Refuse a genuine CPP
    // surplus atomically rather than dropping it from the next year's state.
    if (cpp) {
      const baseline = run(0)
      const bound = Math.min(0.004, 0.004 * startCpi,
        4 * Number.EPSILON * (cpp.amountReal * startCpi + baseline.nominalTax + spendingDue))
      if (baseline.netCash - spendingDue > bound) return fail('unsupported', 'CPP surplus requires a persistent cash destination')
    }
    const final = searchWithdrawalTarget(spendingDue, 0, balances.tfsa + balances.rrsp, run)
    const spendingFunded = Math.min(spendingDue, Math.max(0, final.netCash))
    const spendingUnmet = Math.max(0, spendingDue - spendingFunded)
    const accountRows: YearRow['byAccount'] = {}
    for (const account of plan.accounts) {
      const current = state.byAccount[account.id]
      const withdrawal = final.withdrawals[account.kind as AccountType]
      accountRows[account.id] = { opening: current.balance, contribution: 0, withdrawal, returnAmount: 0, closing: 0, acb: structuredClone(current.acb), ownerId: person.id }
      current.balance -= withdrawal
    }
    const history = state.tfsaWithdrawalHistory ?? []
    if (history.some(h => h.personId !== person.id || !Number.isInteger(h.calendarYear) || h.calendarYear < plan.baseYear || h.calendarYear >= year || !Number.isFinite(h.amount) || h.amount < 0) || new Set(history.map(h => h.id)).size !== history.length) return fail('invalid', 'TFSA withdrawal snapshot history')
    if (year > plan.baseYear && plan.accounts.some(a => a.kind === 'tfsa') && !state.tfsaWithdrawalHistory) return fail('unsupported', 'TFSA withdrawal snapshot history missing')
    const recordedStatement = tfsaStatement(plan, person.id)
    const statement = recordedStatement && recordedStatement.provenance.origin !== 'unknown' ? { ...recordedStatement, withdrawals: recordedStatement.withdrawals.filter(h => h.amount > 0) } : undefined
    if (recordedStatement?.withdrawals.some(h => !safeMoney(h.amount))) return fail('invalid', 'unsafe TFSA statement withdrawal')
    if (!statement && balances.tfsa > 0) return fail('unsupported', 'TFSA withdrawal statement evidence missing')
    if (statement?.withdrawals.some(h => h.calendarYear >= plan.baseYear) || history.some(h => statement?.withdrawals.some(s => s.id === h.id))) return fail('unsupported', 'TFSA recorded and projected withdrawals overlap')
    const tfsaLedger = tfsaRoomYear({ personId: person.id, year, statementYear: plan.baseYear, openingRoom: state.byPerson[person.id].tfsaRoom, annualAddition: annualTfsaAdditionFor(year, plan.baseYear), withdrawals: [...(statement?.withdrawals ?? []), ...history], lines: [] })
    if ([tfsaLedger.restored, tfsaLedger.closingRoom, tfsaLedger.availableRoom].some(fact => fact.status === 'known' && !safeMoney(fact.value))) return fail('invalid', 'unsafe TFSA room arithmetic')
    state.byPerson[person.id].tfsaRoom = statement ? tfsaLedger.closingRoom : { status: 'unknown', reason: 'TFSA statement history missing; no room restoration claim' }
    state.tfsaWithdrawalHistory = [...history, ...(final.withdrawals.tfsa > 0 ? [{ id: `annual:${year}:withdrawal:${plan.accounts.find(a => a.kind === 'tfsa')!.id}`, personId: person.id, calendarYear: year, amount: final.withdrawals.tfsa }] : [])]
    const settled = structuredClone(state)
    const rates: Record<string, number> = {}
    for (const account of plan.accounts) {
      const rate = returns({ plan: structuredClone(plan), state: structuredClone(settled) }, account.id)
      if (!Number.isFinite(rate) || rate < -1) return fail('invalid', `return rate: ${account.id}`)
      rates[account.id] = rate
    }
    for (const account of plan.accounts) {
      const current = state.byAccount[account.id]
      const row = accountRows[account.id]
      row.returnAmount = current.balance * rates[account.id]
      current.balance += row.returnAmount
      row.closing = current.balance
    }
    state.byPerson[person.id].age++
    state.byPerson[person.id].previousYearEarnedIncome = { status: 'known', value: 0 }
    state.benefitIncomeLag[person.id] = { status: 'known', value: final.tax.byPerson[person.id].netIncome * startCpi }
    state.year++
    const committedProblem = retirementSnapshotProblem(plan, state)
    if (committedProblem) return fail('invalid', `year-end state: ${committedProblem}`)
    const { rulePackId, ruleYear, assumedFutureRule, projectionPolicy, coverage } = final.tax
    const taxableIncome = final.tax.byPerson[person.id].taxableIncome * startCpi
    const row: YearRow = { year, byPerson: { [person.id]: { age, income: (cpp?.amountReal ?? 0) * startCpi, ...(cpp ? { cpp: cpp.amountReal * startCpi } : {}), earnedIncome: 0, benefits: 0, tax: final.nominalTax, spending: spendingFunded, taxableIncome } }, byAccount: accountRows, byDebt: {}, byProperty: {},
      cashLedger: { income: (cpp?.amountReal ?? 0) * startCpi, benefits: 0, tax: final.nominalTax, spending: spendingFunded, debtPayments: 0, fhsaContributions: 0, employeeContributions: 0, employerContributions: 0, voluntaryContributions: 0, retainedContributions: 0, unallocated: Math.max(0, final.netCash - spendingFunded) },
      contributionLedger: { allocationCashBasis: 0, scheduledRrspBudgeted: 0, scheduledPlanned: 0, scheduledApplied: 0, scheduledRetained: 0, appliedTotal: 0, postings: [], retained: [] }, taxLedger: { [person.id]: { taxableIncome, tax: final.nominalTax } }, rrspLedger: {}, fhsaLedger: {}, tfsaLedger: statement ? { [person.id]: tfsaLedger } : {}, issues: [],
      retirementSettlement: { evaluationBasis: 'canonical-retirement', ...(cpp ? { cpp } : {}), spendingDue, spendingFunded, spendingUnmet, startCpi, taxRules: { rulePackId, ruleYear, assumedFutureRule, projectionPolicy, coverage } } }
    return { status: 'ok', value: { state, row } }
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && 'reason' in error && (error.status === 'invalid' || error.status === 'unsupported')) return fail(error.status, String(error.reason))
    return fail('invalid', 'damaged retirement snapshot or canonical pricing failure')
  }
}

/** Explicit canonical pricing entry point; never joins provider/legacy rows. */
export function projectRetirementCoverage(plan: InputsV2, opening: AnnualState, years: number, returns: ReturnProvider = fixedReturnProvider): KernelResult<AnnualCoverage> {
  if (!Number.isInteger(years) || years < 0 || years > 120) return fail('invalid', 'projection years')
  try { assertCanonicalPlan(plan) } catch { return fail('invalid', 'canonical plan shape') }
  const gate = pricingGate(plan)
  if (!gate.allowed) return fail('unsupported', `pricing gate: ${gate.reasons.join(', ')}`)
  const problem = retirementSnapshotProblem(plan, opening)
  if (problem) return fail('invalid', problem)
  let state: AnnualState
  try { state = structuredClone(opening) } catch { return fail('invalid', 'snapshot cannot be cloned') }
  const rows: YearRow[] = []
  let blocked: AnnualCoverage['blocked'] = null
  for (let i = 0; i < years; i++) {
    const result = annualRetirementStep(plan, state, returns)
    if (result.status !== 'ok') { blocked = { year: state.year, status: result.status, issues: result.issues, causes: [...new Set(result.issues.map(annualStopCause))] }; break }
    state = result.value.state
    rows.push(result.value.row)
  }
  return { status: 'ok', value: { baseYear: plan.baseYear, inflation: plan.inflation, terminalYear: plan.baseYear + plan.lifeExpectancy - plan.people.find(p => p.role === 'self')!.ageInBaseYear, requestedStartYear: opening.year, requestedYears: years, state, rows, blocked, uncomputedYears: blocked ? Array.from({ length: years - rows.length - 1 }, (_, i) => blocked!.year + i + 1) : [], overallConclusionAvailable: false, evaluationBasis: 'canonical-retirement' } }
}

export function annualRetirementStep(plan: InputsV2, opening: AnnualState, returns: ReturnProvider = fixedReturnProvider): KernelResult<AnnualStepValue> {
  return retirementStep(plan, opening, returns)
}
/** Only the initializing continuous runner can issue a live state identity. */
export function annualRetirementContinuation(plan: InputsV2, opening: AnnualState): KernelResult<AnnualStepValue> {
  if (!isCanonicalGeneratedState(plan, opening)) return fail('invalid', 'retirement continuation requires internally generated state')
  return retirementStep(plan, opening, fixedReturnProvider, true)
}
