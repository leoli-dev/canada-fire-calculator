import type { AccountType, PlannedResidence } from './types'
import { CAPITAL_GAINS_INCLUSION } from './taxData'

export interface FundingGap {
  eventId: string
  field: string
  amount: number
  reason: 'missingMortgage' | 'downPayment' | 'employeeContribution' | 'purchaseCost' | 'invalidPurchase'
}

export interface PurchaseFunds {
  balances: Record<AccountType, number>
  fhsaBalance: number
  nonRegBook: number
  marginalRate: number
  annualSavings: number
  firstYearCost: number
}

export interface PurchaseAllocation {
  balances: Record<AccountType, number>
  nonRegBook: number
  taxableWithdrawal: number
  withdrawalTax: number
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
  if (funds.firstYearCost > funds.annualSavings + 0.01) return {
    mortgagePrincipal: principal, allocation: null,
    gap: { eventId: `purchase:${age}`, field: 'principalResidence.annualMortgagePayment',
      amount: funds.firstYearCost - funds.annualSavings, reason: 'purchaseCost' },
  }

  const balances = { ...funds.balances }
  const excessFhsa = Math.max(0, funds.fhsaBalance - home.downPayment)
  balances.nonReg += excessFhsa
  let book = funds.nonRegBook + excessFhsa
  let remaining = Math.max(0, home.downPayment - funds.fhsaBalance)
  const tfsa = Math.min(remaining, Math.max(0, balances.tfsa))
  balances.tfsa -= tfsa
  remaining -= tfsa
  const gainFraction = balances.nonReg > 0 ? Math.max(0, (balances.nonReg - book) / balances.nonReg) : 0
  const nonRegNetRatio = Math.max(0.01, 1 - gainFraction * CAPITAL_GAINS_INCLUSION * funds.marginalRate)
  const nonReg = Math.min(Math.max(0, balances.nonReg), remaining / nonRegNetRatio)
  const nonRegGain = nonReg * gainFraction * CAPITAL_GAINS_INCLUSION
  if (balances.nonReg > 0) book -= (nonReg / balances.nonReg) * book
  balances.nonReg -= nonReg
  remaining -= nonReg - nonRegGain * funds.marginalRate
  const rrspNetRatio = Math.max(0.01, 1 - funds.marginalRate)
  const rrsp = Math.min(Math.max(0, balances.rrsp), Math.max(0, remaining) / rrspNetRatio)
  balances.rrsp -= rrsp
  remaining -= rrsp * rrspNetRatio
  if (remaining > 0.01) return {
    mortgagePrincipal: principal, allocation: null,
    gap: { eventId: `purchase:${age}`, field: 'principalResidence.downPayment',
      amount: remaining, reason: 'downPayment' },
  }
  return {
    mortgagePrincipal: principal, gap: null,
    allocation: {
      balances, nonRegBook: book, taxableWithdrawal: nonRegGain + rrsp,
      withdrawalTax: (nonRegGain + rrsp) * funds.marginalRate,
    },
  }
}

export interface ContributionAllocation {
  fhsa: number
  employee: number
  employer: number
  voluntary: Record<AccountType, number>
  gap: FundingGap | null
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
  const gapAmount = Math.max(0, args.employee - employee)
  return {
    fhsa, employee, employer: Math.max(0, args.employer), voluntary,
    gap: gapAmount > 0.01 ? {
      eventId: `contributions:${args.age}`, field: 'lockedRetirement.employeeContribution',
      amount: gapAmount, reason: 'employeeContribution',
    } : null,
  }
}
