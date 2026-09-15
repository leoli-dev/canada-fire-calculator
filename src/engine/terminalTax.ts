import { anchorTaxRules, incomeTax, PLAN_TAX_YEAR, type PersonCredits, type TaxRuleContext } from './tax'
import { CAPITAL_GAINS_INCLUSION } from './taxData'
import { OAS_CLAWBACK_RATE, OAS_CLAWBACK_THRESHOLD } from './benefits'
import type { Province } from './types'

export interface TerminalTaxPerson {
  /** Income already included in the final year's ordinary tax calculation. */
  taxableIncome: number
  credits: PersonCredits
  /** Gross OAS reported on the final return; annual tax used the net amount. */
  oasGross?: number
  /** OAS retained after any recovery already reflected in the annual row. */
  oasNet?: number
}

export interface TerminalTaxInput {
  province: Province
  people: TerminalTaxPerson[]
  /** Closing registered balances only. Annual withdrawals are already taxable income. */
  remainingRegistered: number
  /** Unrealized gains may be negative and offset other terminal capital gains. */
  nonRegisteredGain: number
  investmentPropertyGain: number
  /** The plan's tax year; defaults to the real-dollar anchor year. */
  taxYear?: number
  /**
   * The rule pack that prices the closing return. Supplied by the caller that
   * selected it, so the terminal return cannot be priced from a different year
   * or jurisdiction than the annual rows it extends.
   */
  rules?: TaxRuleContext
}

export interface TerminalTaxResult {
  registeredIncome: number
  taxableCapitalGains: number
  taxableDisposition: number
  incomeTaxIncrement: number
  oasRecoveryIncrement: number
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
  const finite = (value: number) => Number.isFinite(value)
  if (!finite(input.remainingRegistered) || input.remainingRegistered < -0.01 ||
      !finite(input.nonRegisteredGain) || !finite(input.investmentPropertyGain) ||
      input.people.length === 0 || input.people.some((person) => {
        const gross = person.oasGross ?? 0
        const net = person.oasNet ?? gross
        return !finite(person.taxableIncome) ||
          (person.credits.age !== undefined && !finite(person.credits.age)) ||
          (person.credits.pensionIncome !== undefined && !finite(person.credits.pensionIncome)) ||
          !finite(gross) || !finite(net) || gross < 0 || net < 0 || net > gross
      })) {
    throw new RangeError('terminalTax requires finite, valid tax inputs and at least one person')
  }
  // Withdrawal bisection can leave sub-cent negative floating-point dust.
  const registered = Math.max(0, input.remainingRegistered)
  const taxableGains = CAPITAL_GAINS_INCLUSION *
    Math.max(0, input.nonRegisteredGain + input.investmentPropertyGain)
  const taxableDisposition = registered + taxableGains
  if (!finite(taxableGains) || !finite(taxableDisposition)) {
    throw new RangeError('terminalTax disposition exceeds the finite range')
  }
  if (taxableDisposition <= 0) {
    return { registeredIncome: registered, taxableCapitalGains: taxableGains,
      taxableDisposition, incomeTaxIncrement: 0, oasRecoveryIncrement: 0,
      incrementalTax: 0, registeredTaxShare: 0 }
  }
  const dispositionPerPerson = taxableDisposition / input.people.length
  const rules = input.rules ?? anchorTaxRules(input.province, input.taxYear ?? PLAN_TAX_YEAR)
  const increments = input.people.reduce((sum, person) => {
    const grossOas = person.oasGross ?? 0
    const netOas = person.oasNet ?? grossOas
    const alreadyRepaid = grossOas - netOas
    // OAS recovery is calculated on income before the line-23500 repayment
    // deduction. The deduction then lowers the final income-tax base; add
    // only the change in repayment because the ordinary year's net OAS was
    // already reflected in cash and taxable income.
    const incomeBeforeRepayment = person.taxableIncome + alreadyRepaid + dispositionPerPerson
    const finalRepayment = Math.min(grossOas,
      Math.max(0, incomeBeforeRepayment - OAS_CLAWBACK_THRESHOLD) * OAS_CLAWBACK_RATE)
    const before = incomeTax(person.taxableIncome, input.province, person.credits, rules)
    const after = incomeTax(incomeBeforeRepayment - finalRepayment, input.province, person.credits, rules)
    return {
      incomeTaxIncrement: sum.incomeTaxIncrement + after - before,
      oasRecoveryIncrement: sum.oasRecoveryIncrement + finalRepayment - alreadyRepaid,
    }
  }, { incomeTaxIncrement: 0, oasRecoveryIncrement: 0 })
  const incrementalTax = increments.incomeTaxIncrement + increments.oasRecoveryIncrement
  if (!finite(incrementalTax) || !finite(increments.incomeTaxIncrement) ||
      !finite(increments.oasRecoveryIncrement)) {
    throw new RangeError('terminalTax result exceeds the finite range')
  }
  const registeredTaxShare = incrementalTax * (registered / taxableDisposition)
  if (!finite(registeredTaxShare)) {
    throw new RangeError('terminalTax registered share exceeds the finite range')
  }
  return {
    registeredIncome: registered,
    taxableCapitalGains: taxableGains,
    taxableDisposition,
    ...increments,
    incrementalTax,
    registeredTaxShare,
  }
}
