import type { AccountType, PlannedResidence } from './types'
import type { AccountKind, InputsV2 } from './model'
import { ageReachedInYear } from './model'
import { CAPITAL_GAINS_INCLUSION } from './taxData'

export interface FundingGap {
  eventId: string
  field: string
  amount: number
  reason: 'missingMortgage' | 'downPayment' | 'employeeContribution' | 'fhsaContribution' | 'purchaseCost' | 'invalidPurchase' | 'saleDischarge' | 'saleTax'
}

export interface PurchaseFunds {
  balances: Record<AccountType, number>
  fhsaBalance: number
  nonRegBook: number
  marginalRate: number
  /** Tax increment from taxable withdrawals made to close the purchase. */
  taxOnWithdrawal?: (taxable: number, rrspGross: number) => number
  annualSavings: number
  firstYearCost: number
}

export interface PurchaseAllocation {
  balances: Record<AccountType, number>
  grossWithdrawals: Record<AccountType, number>
  nonRegBook: number
  taxableWithdrawal: number
  nonRegTaxable: number
  rrspWithdrawal: number
  withdrawalTax: number
  firstYearCostFromSavings: number
  firstYearCostFromOpening: number
  downPaymentFromFhsa: number
  downPaymentFromAccounts: number
  /** A non-registered disposal realized a loss whose tax treatment is unmodeled. */
  nonRegLossRealized: boolean
}

/** Validate the consideration identity before any home or loan is booked. */
export function planPurchaseFunding(home: PlannedResidence, age: number, funds?: PurchaseFunds):
  { mortgagePrincipal: number; gap: FundingGap | null; allocation: PurchaseAllocation | null } {
  if (!Number.isFinite(home.price) || !Number.isFinite(home.downPayment) ||
      home.price < 0 || home.downPayment < 0 || home.downPayment > home.price) {
    return {
      mortgagePrincipal: 0, allocation: null,
      gap: { eventId: `purchase:${age}`, field: 'principalResidence.downPayment',
        amount: Math.abs(home.price - home.downPayment), reason: 'invalidPurchase' },
    }
  }
  const principal = Math.max(0, home.price - home.downPayment)
  const payment = home.annualMortgagePayment ?? 0
  const years = home.mortgageYears ?? 0
  const missing = principal > 0 && (!Number.isFinite(payment) || payment <= 0 ||
    !Number.isFinite(years) || !Number.isInteger(years) || years <= 0 || payment * years < principal)
  if (missing) return {
    mortgagePrincipal: 0, allocation: null,
    gap: {
      eventId: `purchase:${age}`, field: 'principalResidence.annualMortgagePayment',
      amount: principal, reason: 'missingMortgage',
    },
  }
  if (!funds) return { mortgagePrincipal: principal, gap: null, allocation: null }

  const balances = { ...funds.balances }
  const excessFhsa = Math.max(0, funds.fhsaBalance - home.downPayment)
  balances.nonReg += excessFhsa
  let book = funds.nonRegBook + excessFhsa
  let taxableWithdrawal = 0
  let nonRegTaxable = 0
  let rrspWithdrawal = 0
  let nonRegLossRealized = false
  const grossWithdrawals: Record<AccountType, number> = { tfsa: 0, nonReg: 0, rrsp: 0 }
  const tax = funds.taxOnWithdrawal ?? ((taxable: number) => taxable * funds.marginalRate)
  const takeTaxable = (capacity: number, taxablePerGross: number, need: number, isRrsp: boolean) => {
    const net = (gross: number) => gross - (tax(
      taxableWithdrawal + gross * taxablePerGross,
      rrspWithdrawal + (isRrsp ? gross : 0),
    ) - tax(taxableWithdrawal, rrspWithdrawal))
    const max = Math.max(0, capacity)
    if (net(max) <= need) return max
    let lo = 0
    let hi = max
    for (let i = 0; i < 55; i++) {
      const mid = (lo + hi) / 2
      if (net(mid) < need) lo = mid
      else hi = mid
    }
    return hi
  }
  const drawNet = (need: number) => {
    let remaining = Math.max(0, need)
    const tfsa = Math.min(remaining, Math.max(0, balances.tfsa))
    balances.tfsa -= tfsa
    grossWithdrawals.tfsa += tfsa
    remaining -= tfsa
    const gainFraction = balances.nonReg > 0 ? Math.max(0, (balances.nonReg - book) / balances.nonReg) : 0
    const nonRegTaxablePerGross = gainFraction * CAPITAL_GAINS_INCLUSION
    const nonReg = takeTaxable(balances.nonReg, nonRegTaxablePerGross, remaining, false)
    // An unrealized loss disposed of here is previewed as tax-free by the
    // nonnegative gain fraction; report it so no consumer treats it as exact.
    if (nonReg > 1 && balances.nonReg > 1 && book > balances.nonReg + 1e-8)
      nonRegLossRealized = true
    const nonRegGain = nonReg * nonRegTaxablePerGross
    const nonRegTax = tax(taxableWithdrawal + nonRegGain, rrspWithdrawal) - tax(taxableWithdrawal, rrspWithdrawal)
    if (balances.nonReg > 0) {
      const disposed = Math.min(1, nonReg / balances.nonReg)
      book = disposed >= 1 ? 0 : book * (1 - disposed)
    }
    balances.nonReg -= nonReg
    grossWithdrawals.nonReg += nonReg
    remaining -= nonReg - nonRegTax
    taxableWithdrawal += nonRegGain
    nonRegTaxable += nonRegGain
    const rrsp = takeTaxable(balances.rrsp, 1, Math.max(0, remaining), true)
    const rrspTax = tax(taxableWithdrawal + rrsp, rrspWithdrawal + rrsp) - tax(taxableWithdrawal, rrspWithdrawal)
    balances.rrsp -= rrsp
    grossWithdrawals.rrsp += rrsp
    remaining -= rrsp - rrspTax
    taxableWithdrawal += rrsp
    rrspWithdrawal += rrsp
    return Math.max(0, remaining)
  }
  const downPaymentFromFhsa = Math.min(home.downPayment, funds.fhsaBalance)
  const downPaymentFromAccounts = home.downPayment - downPaymentFromFhsa
  const remaining = drawNet(downPaymentFromAccounts)
  if (remaining > 0.01) return {
    mortgagePrincipal: principal, allocation: null,
    gap: { eventId: `purchase:${age}`, field: 'principalResidence.downPayment',
      amount: remaining, reason: 'downPayment' },
  }
  const firstYearCostFromSavings = Math.min(Math.max(0, funds.firstYearCost), Math.max(0, funds.annualSavings))
  const firstYearCostFromOpening = Math.max(0, funds.firstYearCost - firstYearCostFromSavings)
  const unpaidCost = drawNet(firstYearCostFromOpening)
  const gap: FundingGap | null = unpaidCost > 0.01
    ? { eventId: `purchase:${age}`, field: 'principalResidence.annualMortgagePayment',
      amount: unpaidCost, reason: 'purchaseCost' }
    : null
  return {
    mortgagePrincipal: principal, gap,
    allocation: {
      balances, grossWithdrawals, nonRegBook: book, taxableWithdrawal, nonRegTaxable, rrspWithdrawal,
      withdrawalTax: tax(taxableWithdrawal, rrspWithdrawal),
      firstYearCostFromSavings, firstYearCostFromOpening: firstYearCostFromOpening - unpaidCost,
      downPaymentFromFhsa, downPaymentFromAccounts, nonRegLossRealized,
    },
  }
}

/** Fund a later working-year home cost from that year's savings, then opening liquid assets. */
export function planAnnualHousingFunding(age: number, cost: number, funds: Omit<PurchaseFunds, 'fhsaBalance' | 'firstYearCost'>) {
  const zeroHome: PlannedResidence = {
    mode: 'planned', buyAtAge: age, price: 0, downPayment: 0,
    appreciation: 0, netHoldingCostChange: 0, sellAtAge: null,
  }
  return planPurchaseFunding(zeroHome, age, { ...funds, fhsaBalance: 0, firstYearCost: Math.max(0, cost) })
}

/** Reconcile a scheduled installment against cash actually available to pay it. */
export function reconcileMortgagePayment(scheduled: number, available: number) {
  const due = Math.max(0, scheduled)
  const paid = Math.min(due, Math.max(0, available))
  return { paid, unpaid: Math.max(0, due - paid) }
}

export interface ContributionAllocation {
  fhsa: number
  employee: number
  employer: number
  voluntary: Record<AccountType, number>
  gaps: FundingGap[]
}

/** FHSA then mandatory employee DC, then the configured voluntary split. */
export function allocateContributions(args: {
  age: number; budget: number; fhsa: number; employee: number; employer: number
  split: Record<AccountType, number>
}): ContributionAllocation {
  let remaining = Math.max(0, args.budget)
  const fhsa = Math.min(remaining, Math.max(0, args.fhsa))
  remaining -= fhsa
  const employee = Math.min(remaining, Math.max(0, args.employee))
  remaining -= employee
  const tfsaWeight = Math.max(0, args.split.tfsa)
  const rrspWeight = Math.max(0, args.split.rrsp)
  const nonRegWeight = Math.max(0, args.split.nonReg)
  const weightSum = tfsaWeight + rrspWeight + nonRegWeight
  const divisor = Math.max(1, weightSum)
  const voluntary = {
    tfsa: remaining * tfsaWeight / divisor,
    rrsp: remaining * rrspWeight / divisor,
    // The model has no cash account: hold any unassigned savings in nonReg.
    nonReg: remaining * (nonRegWeight / divisor + Math.max(0, 1 - weightSum)),
  }
  const employeeGap = Math.max(0, args.employee - employee)
  const fhsaGap = Math.max(0, args.fhsa - fhsa)
  return {
    fhsa, employee, employer: Math.max(0, args.employer), voluntary,
    gaps: [
      ...(fhsaGap > 0.01 ? [{ eventId: `contributions:${args.age}`, field: 'fhsa.annualContribution',
        amount: fhsaGap, reason: 'fhsaContribution' as const }] : []),
      ...(employeeGap > 0.01 ? [{ eventId: `contributions:${args.age}`, field: 'lockedRetirement.employeeContribution',
        amount: employeeGap, reason: 'employeeContribution' as const }] : []),
    ],
  }
}

/**
 * Resolve one plan-year's contribution allocation from the plan alone: nominal
 * net savings for the year, less the scheduled RRSP contributions already
 * reserved from it, less FHSA/mandatory employee money, then the configured
 * voluntary split. The annual kernel and the panel's RRSP ledger preview both
 * call this, so the voluntary RRSP share that the RRSP room is priced against
 * is one computation rather than a kernel figure and a separate panel guess.
 */
export function resolveYearAllocation(plan: InputsV2, year: number): ContributionAllocation {
  const self = plan.people.find(person => person.role === 'self') ?? plan.people[0]
  const age = self ? ageReachedInYear(self, plan.baseYear, year) : 0
  const split = plan.savingsAllocation.shares
  // No savings budget means no voluntary split to allocate; the kernel refuses
  // such a plan earlier, and the panel shows statement facts only.
  if (plan.budget.kind !== 'savingsBudget') return allocateContributions({ age, budget: 0, fhsa: 0, employee: 0, employer: 0, split })
  const cash = plan.budget.annualNetSavings * Math.pow(1 + plan.inflation, year - plan.baseYear)
  const scheduledPlanned = plan.contributions
    .filter(contribution => contribution.calendarYear === year && contribution.amount > 0)
    .reduce((total, contribution) => total + contribution.amount, 0)
  const kindOf = (accountId: string) => plan.accounts.find(account => account.id === accountId)?.kind
  const fromSavings = (kind: AccountKind) => plan.recurringContributions
    .filter(contribution => kindOf(contribution.accountId) === kind && contribution.funding === 'fromSavings')
    .reduce((total, contribution) => total + contribution.annualAmount, 0)
  const employer = plan.recurringContributions
    .filter(contribution => contribution.funding === 'employerAdditional')
    .reduce((total, contribution) => total + contribution.annualAmount, 0)
  return allocateContributions({
    age, budget: cash - scheduledPlanned,
    fhsa: fromSavings('fhsa'), employee: fromSavings('lira'), employer, split,
  })
}
