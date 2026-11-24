import { minimumForRrif } from "./rrif"
import { annualGis, gisAssessmentReceipt, GIS_OAS_RECOVERY_UNSUPPORTED } from './annualGis'
import { annualOas } from './annualOas'
import { oasAfterClawback, OAS_CLAWBACK_THRESHOLD } from './benefits'
import { annualCpp } from './annualCpp'
import type { InputsV2 } from './model'
import { pricingGate } from './model'
import { assertCanonicalPlan } from './modelValidation'
import { rrifConversionFor, isCanonicalGeneratedState, annualStopCause, fixedReturnProvider, snapshotProblem, type AnnualState, type AnnualStepValue, type AnnualCoverage, type KernelResult, type ReturnProvider, type YearRow } from './annualState'
import { PLAN_TAX_YEAR } from './tax'
import { calculateHouseholdTax } from './householdTax'
import { allocateOrderedWithdrawals, searchWithdrawalTarget } from './withdrawalSearch'
import { annualTfsaAdditionFor, tfsaRoomYear, tfsaStatement } from './tfsaRoom'
import type { AccountType } from './types'

const fail = (status: 'invalid' | 'unsupported', detail: string): KernelResult<never> => ({ status, issues: [{ code: status, detail }] })
// Room arithmetic rounds to cents: reject values whose cents are not safely representable.
const safeMoney = (value: number) => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 100
function retirementSnapshotProblem(plan: InputsV2, state: AnnualState, generatedBasis?: AnnualState): string | null {
  try {
  const problem = snapshotProblem(plan, state, generatedBasis)
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
    if (!generated && opening.rrifConversions) return fail("unsupported", "RRIF continuation requires internally generated state")
    if (generated && plan.baseYear !== PLAN_TAX_YEAR) return fail('unsupported', 'continuous retirement requires tax anchor')
    const gate = pricingGate(plan)
    if (!gate.allowed) return fail('unsupported', `pricing gate: ${gate.reasons.join(', ')}`)
    const problem = retirementSnapshotProblem(plan, opening, generated ? opening : undefined)
    if (problem) return fail('invalid', problem)
    const person = plan.people[0]
    const age = opening.byPerson[person.id].age
    if (plan.people.length !== 1 || person.role !== 'self' || plan.province !== 'ON') return fail('unsupported', 'retirement requires a single Ontario person')
    if ((!generated && person.ageInBaseYear < person.retirementAge) || age < person.retirementAge) return fail('unsupported', 'retirement settlement requires already-retired person')
    if (!generated && age >= 71 && plan.accounts.some(a => a.kind === 'rrsp' && opening.byAccount[a.id].balance > 0)) return fail('unsupported', 'RRSP age-71 conversion rule not yet wired')
    if (age > plan.lifeExpectancy) return fail('invalid', 'year beyond plan horizon')
    if (!generated && (person.earnedIncome.status !== 'known' || person.earnedIncome.value !== 0)) return fail('unsupported', 'retirement wage evidence must be known zero')
    // Recorded OAS/GIS settlement evidence, including an opted-in zero
    // profile, still uses the existing age gate and is outside the zero-benefit
    // RRIF slice. Explicit zero amounts without that opt-in remain eligible.
    const oas = generated && plan.annualBenefitsEvidence ? annualOas(plan, person, age) : undefined
    if ((!generated && person.cppAnnualAt65 !== 0) || (!oas && person.oasAnnualAt65 !== 0) || !['manual', 'statement'].includes(person.cppAmountSource?.source ?? '') || !['manual', 'statement'].includes(person.oasAmountSource?.source ?? '')) return fail('unsupported', 'retirement benefit evidence must be explicitly supplied zero')
    if (person.pension || person.pensionAnnual !== 0 || person.cppWork) return fail('unsupported', 'retirement pension or CPP work rules not yet wired')
    if (plan.dependents.length || plan.properties.length || plan.debts.length) return fail('unsupported', 'retirement dependents/property/debt settlement not yet wired')
    if (plan.taxProfile?.pensionSplit || plan.taxProfile?.qcPensionSplit) return fail('unsupported', 'retirement tax election not supported')
    const cpp = generated && person.cppAnnualAt65 > 0 ? annualCpp(plan, person, age) : undefined
    if (plan.incomeSources.some(source => !(cpp && source.kind === 'cpp' && source.recipientId === person.id) && !(oas && source.kind === 'oas' && source.id === oas.sourceId) && (source.fromAge ?? -Infinity) <= age && (source.startAge ?? -Infinity) <= age && (source.toAge ?? Infinity) >= age && (source.annualAmount.status !== 'known' || source.annualAmount.value !== 0))) return fail('unsupported', 'active retirement income source not yet wired')
    if (person.rrspUnusedUndeducted.status !== 'known' || person.rrspUnusedUndeducted.value !== 0) return fail('unsupported', 'retirement undeducted RRSP premiums require explicit zero evidence')
    if (plan.contributions.some(c => c.calendarYear < opening.year && c.deductionYear !== null && c.deductionYear >= opening.year && c.amount > 0)) return fail('unsupported', 'deferred retirement RRSP deductions not yet wired')
    if (plan.recurringContributions.some(c => c.annualAmount !== 0) || plan.contributions.some(c => c.calendarYear >= opening.year && c.amount !== 0)) return fail('unsupported', 'scheduled retirement contributions not yet wired')
    if (opening.unfundedEvents.length) return fail('unsupported', 'unsettled funding events')
    if (plan.strategy === 'meltdownPaced') return fail('unsupported', 'retirement meltdown strategy not yet wired')
    if (plan.accounts.some(a => (!['tfsa', 'rrsp'].includes(a.kind) && !(a.kind === 'nonReg' && a.balance === 0 && opening.byAccount[a.id].balance === 0)) || a.ownerId !== person.id) || ['tfsa', 'rrsp'].some(kind => plan.accounts.filter(a => a.kind === kind).length > 1)) return fail('unsupported', 'retirement supports one owned ordinary RRSP and one TFSA')
    const registered = plan.accounts.find(a => a.kind === "rrsp")
    const conversion = registered ? rrifConversionFor(opening, registered.id) : undefined
    const rrifSlice = generated && !!registered && (!!conversion || age >= 71 && opening.byAccount[registered.id].balance > 0)
    if (rrifSlice) {
      if (plan.accounts.some(a => a.rrifAgeElection !== undefined && a.rrifAgeElection !== null))
        return fail('unsupported', 'RRIF: pre-conversion age elections are not supported')
      for (const account of plan.accounts) {
        const category = account.rrifFactorCategory
        if (category === undefined) continue
        if (category?.status === 'known')
          return fail('unsupported', 'RRIF: known pre-conversion factor metadata conflicts with a new ordinary rollover')
        if (!category || category.status !== 'unknown' || typeof category.reason !== 'string' || !category.reason.trim())
          return fail('invalid', 'RRIF: malformed unknown pre-conversion factor metadata')
      }
    }
    if (rrifSlice && (!generated || person.cppAnnualAt65 !== 0 || person.oasAnnualAt65 !== 0 || oas || cpp || plan.incomeSources.some(i => i.annualAmount.status !== "known" || i.annualAmount.value !== 0) || plan.accounts.some(a => !["rrsp", "tfsa"].includes(a.kind) || a.jurisdiction || a.accessibleAge !== undefined))) return fail("unsupported", "RRIF: requires generated ordinary owner accounts and explicit zero benefits without additional rules")
    if (registered && age > 71 && !conversion && opening.byAccount[registered.id].balance > 0) return fail("unsupported", "RRIF: missing generated age-71 rollover")
    const taxPlan = conversion ? { ...plan, accounts: plan.accounts.map(a => a.id === registered!.id ? { ...a, kind: "rrif" as const, openedYear: { status: "known" as const, value: conversion.year }, rrifFactorCategory: { status: "known" as const, value: "allOther" as const }, rrifAgeElection: null } : a) } : plan
    const minimumReceipt = conversion ? minimumForRrif(taxPlan.accounts.find(a => a.id === registered!.id)!, plan.people, plan.baseYear, opening.year, opening.byAccount[registered!.id].balance) : undefined
    if (minimumReceipt && minimumReceipt.status !== "ok") return fail(minimumReceipt.status, minimumReceipt.reason)
    const floor = minimumReceipt?.status === "ok" ? minimumReceipt.amount : 0
    const state = structuredClone(opening)
    const year = state.year
    const startCpi = (1 + plan.inflation) ** (year - plan.baseYear)
    const spendingDue = plan.budget.retirementSpending * startCpi
    if (!Number.isFinite(startCpi) || startCpi <= 0 || !safeMoney(spendingDue)) return fail('invalid', 'retirement CPI/spending')
    if (oas && !safeMoney(oas.grossReal * startCpi)) return fail('invalid', 'retirement OAS nominal amount unsafe')
    if (cpp && !safeMoney(cpp.amountReal * startCpi)) return fail('invalid', 'retirement CPP nominal amount unsafe')
    const gis = generated && oas ? annualGis(plan, person.id, year, age, oas, opening.gisAssessmentLag?.[person.id]) : undefined
    if (gis && !safeMoney(gis.amountReal * startCpi)) return fail('invalid', 'GIS nominal amount unsafe')
    const balances = { tfsa: 0, rrsp: 0, nonReg: 0 }
    for (const a of plan.accounts) balances[a.kind as 'tfsa' | 'rrsp'] += state.byAccount[a.id].balance
    if (!Number.isFinite(balances.tfsa + balances.rrsp)) return fail('invalid', 'retirement aggregate balances')
    const order: AccountType[] = plan.strategy === 'tfsaFirst' ? ['tfsa', 'nonReg', 'rrsp'] : plan.strategy === 'nonRegFirst' ? ['nonReg', 'rrsp', 'tfsa'] : ['rrsp', 'nonReg', 'tfsa']
    const run = (gross: number) => {
      // Exact exhaustion is a canonical settlement invariant. Leave the shared
      // legacy allocator's subtraction order and all search calls untouched.
      const withdrawals = gross === balances.tfsa + balances.rrsp ? { ...balances } : allocateOrderedWithdrawals(gross, balances, floor, order.map(account => ({ account })))
      if (generated) for (const kind of ['tfsa', 'rrsp'] as const) {
        const remaining = balances[kind] - withdrawals[kind]
        const bound = Math.min(0.004, 4 * Number.EPSILON * (balances[kind] + withdrawals[kind]))
        if (remaining > 0 && remaining <= bound) withdrawals[kind] = balances[kind]
      }
      const rrsp = plan.accounts.find(a => a.kind === 'rrsp')
      const events: import('./personIncome').IncomeEvent[] = [...(cpp ? [{ id: `annual:${year}:cpp:${person.id}`, personId: person.id, kind: 'cpp' as const, amount: cpp.amountReal }] : []), ...(rrsp ? [{ id: `annual:${year}:withdrawal:${rrsp.id}`, kind: conversion ? 'rrifWithdrawal' as const : 'rrspWithdrawal' as const, accountId: rrsp.id, amount: withdrawals.rrsp / startCpi }] : [])]
      const before = calculateHouseholdTax(taxPlan, year, events)
      if (before.status !== 'ok') throw before
      const recoveryIncomeReal = before.byPerson[person.id].netIncome + (oas?.grossReal ?? 0)
      // Same anchor-real threshold as ordinary OAS. GIS is not an ordinary
      // taxable event here, but is included in the statutory repayment test.
      // Mark trials without throwing: a full-account probe can cross even
      // when a smaller, safely fundable accepted withdrawal does not.
      const gisReal = gis?.amountReal ?? 0
      const recoveryExcessReal = recoveryIncomeReal + gisReal - OAS_CLAWBACK_THRESHOLD
      // Original-clock division and sequential account growth can leave an
      // exact-boundary sum one ULP above the threshold. Normalize only that
      // operand-scale residue, symmetrically, never a financial tolerance:
      // 4 × epsilon × sum of absolute operands, capped at CAD 0.0001
      // (one hundredth of a cent) in BOTH anchor and nominal dollars.
      // The 2028 equality vector leaves 1.46e-11 CAD against a 1.69e-10
      // anchor bound; a genuine one-cent excess remains far outside it.
      const recoveryArithmeticBoundReal = Math.min(0.0001, 0.0001 / startCpi,
        4 * Number.EPSILON * (Math.abs(recoveryIncomeReal) + gisReal + OAS_CLAWBACK_THRESHOLD))
      const normalizedRecoveryExcessReal = Math.abs(recoveryExcessReal) <= recoveryArithmeticBoundReal ? 0 : recoveryExcessReal
      const gisRecoveryUnsupported = gisReal > 0 && normalizedRecoveryExcessReal > 0
      // Supported positive-GIS classification establishes zero repayment.
      // Preserve that exact invariant even when the ordinary OAS-only sum
      // has sub-ULP residue. Zero GIS and unsupported speculative trials keep
      // the existing OAS formula unchanged.
      const netReal = oas ? gisReal > 0 && !gisRecoveryUnsupported
        ? oas.grossReal : oasAfterClawback(oas.grossReal, before.byPerson[person.id].netIncome) : 0
      const settledOas = oas ? { ...oas, recoveryIncomeReal, netReal, recoveryReal: oas.grossReal - netReal } : undefined
      // Net OAS is the gross inclusion less line-23500 repayment; recovery
      // has already reduced benefit cash, so it is never debited as tax too.
      if (settledOas) events.push({ id: `annual:${year}:oas:${person.id}`, personId: person.id, kind: 'oas', amount: netReal })
      // GIS enters line 23600 before its line-25000 deduction. Price age
      // amounts with that separate net-income basis on supported candidates;
      // brackets and the ON health premium retain taxable income excluding
      // GIS. Keep the fixed benefit out of events/cash and assessment lags.
      // Outside the guarded domain only a finite provisional ordinary quote
      // is needed for bisection, never a GIS credit override or posting. At
      // the pivot, removing GIS from the credit phaseout basis can only lower
      // age-credit tax, hence increase cash: there is no downward jump that
      // could conceal a safely funded target on the supported segment. The
      // ordinary ON quote then retains its existing monotone withdrawal
      // curve. Any final result on this provisional branch is rejected below.
      const ageAmountContext = gisReal > 0 && !gisRecoveryUnsupported ? { ageAmountNetIncome: {
        [person.id]: before.byPerson[person.id].netIncome + netReal + gisReal,
      } } : undefined
      const tax = settledOas ? calculateHouseholdTax(taxPlan, year, events, ageAmountContext) : before
      if (tax.status !== 'ok') throw tax
      const nominalTax = tax.total * startCpi
      if (!Number.isFinite(nominalTax) || nominalTax < 0 || !Number.isFinite(tax.byPerson[person.id]?.taxableIncome)) throw new Error('invalid canonical tax')
      return { withdrawals, tax, nominalTax, settledOas, gisRecoveryUnsupported, netCash: ((cpp?.amountReal ?? 0) + netReal + (gis?.amountReal ?? 0)) * startCpi + withdrawals.rrsp + withdrawals.tfsa - nominalTax }
    }
    // No persistent cash account exists in this slice. Refuse a genuine CPP
    // surplus atomically rather than dropping it from the next year's state.
    if (floor > 0) {
      const baseline = run(floor)
      const bound = Math.min(0.004, 4 * Number.EPSILON * (floor + baseline.nominalTax + spendingDue))
      if (baseline.netCash - spendingDue > bound) return fail("unsupported", "RRIF: surplus requires a persistent cash destination")
    }
    if (cpp || oas) {
      const baseline = run(0)
      // Eligible income cannot decrease as this slice adds ordinary RRSP
      // withdrawals. A baseline already in the domain cannot be repaired by
      // a withdrawal; stop before surplus handling or any persistent posting.
      if (baseline.gisRecoveryUnsupported) return fail('unsupported', GIS_OAS_RECOVERY_UNSUPPORTED)
      const bound = Math.min(0.004, 0.004 * startCpi,
        4 * Number.EPSILON * (((cpp?.amountReal ?? 0) + (oas?.grossReal ?? 0)) * startCpi + baseline.nominalTax + spendingDue))
      if (baseline.netCash - spendingDue > bound) return fail('unsupported', gis && gis.amountReal > 0 ? 'GIS: surplus requires a persistent cash destination' : oas && oas.grossReal > 0 ? 'OAS surplus requires a persistent cash destination' : 'CPP surplus requires a persistent cash destination')
    }
    const final = gis && gis.amountReal > 0
      ? searchWithdrawalTarget(spendingDue, floor, balances.tfsa + balances.rrsp, run, 120)
      : searchWithdrawalTarget(spendingDue, floor, balances.tfsa + balances.rrsp, run)
    // Acceptance proof for this guarded model: with positive GIS, the
    // accepted eligible income + gross OAS + GIS must be <= the pinned
    // threshold after only the operand-scale residue normalization above.
    // Actual modeled repayment is then zero (including equality),
    // and ordinary OAS-only repayment in run() is also zero. Thus the
    // provisional funding quote is unchanged by the missing repayment
    // interaction for every accepted result. Above threshold we make no
    // funding/repayment claim, even for an account-exhaustion shortfall.
    // All candidate computations above use cloned state; stop atomically
    // before account, room, history, return or next-year basis postings.
    if (final.gisRecoveryUnsupported) return fail('unsupported', GIS_OAS_RECOVERY_UNSUPPORTED)
    const spendingFunded = Math.min(spendingDue, Math.max(0, final.netCash))
    const spendingUnmet = Math.max(0, spendingDue - spendingFunded)
    const accountRows: YearRow['byAccount'] = {}
    for (const account of plan.accounts) {
      const current = state.byAccount[account.id]
      const withdrawal = final.withdrawals[account.kind as AccountType]
      Object.defineProperty(accountRows, account.id, { enumerable: true, configurable: true, writable: true, value: { ...(conversion && account.id === registered?.id ? { openingKind: current.kind, closingKind: current.kind } : {}), opening: current.balance, contribution: 0, withdrawal, returnAmount: 0, closing: 0, acb: structuredClone(current.acb), ownerId: person.id } })
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
    const rates: Record<string, number> = Object.create(null)
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
    if (generated && registered && age === 71 && !conversion && state.byAccount[registered.id].balance > 0) {
      const current = state.byAccount[registered.id]
      ;Object.defineProperty(state.rrifConversions ??= {}, registered.id, { value: { year, ownerId: person.id, amount: current.balance, factorCategory: "allOther", ageBasis: "owner", provenance: "generated-owner-rrsp-rollover" }, enumerable: true, configurable: true, writable: true })
      current.kind = "rrif"
      current.openedYear = { status: "known", value: year }
      accountRows[registered.id].openingKind = "rrsp"
      accountRows[registered.id].closingKind = "rrif"
    }
    state.byPerson[person.id].age++
    state.byPerson[person.id].previousYearEarnedIncome = { status: 'known', value: 0 }
    // Both canonical lags exclude OAS. Provider/legacy paths keep their contract.
    const assessmentIncome = (final.tax.byPerson[person.id].netIncome - (final.settledOas?.netReal ?? 0)) * startCpi
    state.benefitIncomeLag[person.id] = { status: 'known', value: assessmentIncome }
    if (generated) (state.gisAssessmentLag ??= {})[person.id] = gisAssessmentReceipt(year, assessmentIncome, 0)
    state.year++
    const committedProblem = retirementSnapshotProblem(plan, state, generated ? opening : undefined)
    if (committedProblem) return fail('invalid', `year-end state: ${committedProblem}`)
    const { rulePackId, ruleYear, assumedFutureRule, projectionPolicy, coverage } = final.tax
    const taxableIncome = final.tax.byPerson[person.id].taxableIncome * startCpi
    const oasColumns = final.settledOas ? { oasGross: final.settledOas.grossReal * startCpi, oasRecovery: final.settledOas.recoveryReal * startCpi, oasNet: final.settledOas.netReal * startCpi } : {}
    const gisCash = (gis?.amountReal ?? 0) * startCpi
    const oasCash = (final.settledOas?.netReal ?? 0) * startCpi
    const row: YearRow = { year, byPerson: { [person.id]: { age, income: (cpp?.amountReal ?? 0) * startCpi, ...(cpp ? { cpp: cpp.amountReal * startCpi } : {}), earnedIncome: 0, ...oasColumns, ...(generated && oas?.evidence.gis.status === 'annual-estimate' ? { gis: gisCash } : {}), benefits: oasCash + gisCash, tax: final.nominalTax, spending: spendingFunded, taxableIncome } }, byAccount: accountRows, byDebt: {}, byProperty: {},
      cashLedger: { income: (cpp?.amountReal ?? 0) * startCpi, benefits: oasCash + gisCash, tax: final.nominalTax, spending: spendingFunded, debtPayments: 0, fhsaContributions: 0, employeeContributions: 0, employerContributions: 0, voluntaryContributions: 0, retainedContributions: 0, unallocated: Math.max(0, final.netCash - spendingFunded) },
      contributionLedger: { allocationCashBasis: 0, scheduledRrspBudgeted: 0, scheduledPlanned: 0, scheduledApplied: 0, scheduledRetained: 0, appliedTotal: 0, postings: [], retained: [] }, taxLedger: { [person.id]: { taxableIncome, tax: final.nominalTax } }, rrspLedger: {}, fhsaLedger: {}, tfsaLedger: statement ? { [person.id]: tfsaLedger } : {}, issues: [],
      retirementSettlement: { ...(registered && rrifConversionFor(state, registered.id) ? { rrif: { accountId: registered.id, conversion: structuredClone(rrifConversionFor(state, registered.id)!), openingBalance: opening.byAccount[registered.id].balance, ageAtYearStart: age - 1, factor: minimumReceipt?.status === "ok" ? minimumReceipt.factor : 0, minimum: floor, withdrawal: final.withdrawals.rrsp, discretionary: final.withdrawals.rrsp - floor, incomeKind: conversion ? "rrifWithdrawal" as const : "rrspWithdrawal" as const } } : {}), ...(gis ? { gis } : {}), ...(final.tax.byPerson[person.id].ageAmountNetIncome !== undefined ? { gisAgeAmountNetIncomeReal: final.tax.byPerson[person.id].ageAmountNetIncome } : {}), evaluationBasis: 'canonical-retirement', ...(cpp ? { cpp } : {}), ...(final.settledOas ? { oas: final.settledOas } : {}), spendingDue, spendingFunded, spendingUnmet, startCpi, taxRules: { rulePackId, ruleYear, assumedFutureRule, projectionPolicy, coverage } } }
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
