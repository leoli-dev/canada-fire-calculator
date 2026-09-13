import { incomeTax, type PersonCredits } from './tax'
import { CAPITAL_GAINS_INCLUSION } from './taxData'
import type { Province } from './types'

export interface TerminalTaxPerson {
  /** Income already included in the final year's ordinary tax calculation. */
  taxableIncome: number
  credits: PersonCredits
}

export interface TerminalTaxInput {
  province: Province
  people: TerminalTaxPerson[]
  /** Closing registered balances only. Annual withdrawals are already taxable income. */
  remainingRegistered: number
  /** Unrealized gains may be negative and offset other terminal capital gains. */
  nonRegisteredGain: number
  investmentPropertyGain: number
}

export interface TerminalTaxResult {
  registeredIncome: number
  taxableCapitalGains: number
  taxableDisposition: number
  incrementalTax: number
  registeredTaxShare: number
}

/**
 * Legacy shared-endpoint approximation: spread the remaining taxable
 * disposition evenly across the people already in the final-year tax model.
 * A later owner/beneficiary model must replace this allocation. We calculate
 * the increment on each existing final return, preserving the year's age and
 * pension credits rather than granting a second basic personal amount.
 */
export function terminalTax(input: TerminalTaxInput): TerminalTaxResult {
  const registered = Math.max(0, input.remainingRegistered)
  const taxableGains = CAPITAL_GAINS_INCLUSION *
    Math.max(0, input.nonRegisteredGain + input.investmentPropertyGain)
  const taxableDisposition = registered + taxableGains
  if (taxableDisposition <= 0 || input.people.length === 0) {
    return { registeredIncome: registered, taxableCapitalGains: taxableGains,
      taxableDisposition, incrementalTax: 0, registeredTaxShare: 0 }
  }
  const dispositionPerPerson = taxableDisposition / input.people.length
  const incrementalTax = input.people.reduce((sum, person) => {
    const before = incomeTax(person.taxableIncome, input.province, person.credits)
    const after = incomeTax(person.taxableIncome + dispositionPerPerson, input.province, person.credits)
    return sum + Math.max(0, after - before)
  }, 0)
  return {
    registeredIncome: registered,
    taxableCapitalGains: taxableGains,
    taxableDisposition,
    incrementalTax,
    registeredTaxShare: incrementalTax * registered / taxableDisposition,
  }
}
