import type { InputsV2 } from '../../model'
import { BASE_YEAR, known, legacyRetirement, recorded, retirementPlan, RETIREE, RRSP, TFSA } from './retirementSettlement'

export const PARTNER = 'working-partner'

// Hand calculation pinned to e7eeaa2384a2867fbdbdc3e1549295776f0bcf6d.
// The 2026 Ontario rule snapshot, payroll and spouse-credit parameters are
// written out here so the expectations do not call the calculators under test.
const selfWage = 40_000
const partnerWage = 80_000
const selfPayroll = (40_000 - 3_500) * 0.0595 + 40_000 * 0.0163
const partnerPayroll = (74_600 - 3_500) * 0.0595 + (80_000 - 74_600) * 0.04 + 68_900 * 0.0163
const selfTaxable = selfWage - 365
const partnerTaxable = partnerWage - 711 - 216
const selfPayrollCredit = 36_500 * 0.0495 + 40_000 * 0.0163
const partnerPayrollCredit = 71_100 * 0.0495 + 68_900 * 0.0163

// Both incomes exceed the spouse-credit thresholds in the working year.
// The Ontario health premiums are $450 and $750. Neither owes surtax.
const selfTax = (selfTaxable - 16_452 - selfPayrollCredit - 1_501) * 0.14
  + (selfTaxable - 12_989 - selfPayrollCredit) * 0.0505 + 450
const partnerTax = (58_523 - 16_452 - partnerPayrollCredit - 1_501) * 0.14
  + (partnerTaxable - 58_523) * 0.205
  + (53_891 - 12_989 - partnerPayrollCredit) * 0.0505
  + (partnerTaxable - 53_891) * 0.0915 + 750
// Once the self income stops, the supporting partner gets the full federal
// and Ontario spouse amounts.
const partnerMixedTax = partnerTax - 16_452 * 0.14 - 11_029 * 0.0505

const inflation = 0.02
const retirementSpending = 48_000
// Record exact anchor-real totals. Rounding the working total to cents
// would create a real cash residual in this deliberately break-even fixture.
const workingSpending = 93_116.164935
const transitionSpending = 63_162.87056
const tfsaOpening = 1_000
const rrspOpening = 20_000

export const staggeredReference = {
  inflation, tfsaOpening, rrspOpening, retirementSpending,
  working: {
    startCpi: 1, spending: workingSpending,
    self: { age: 56, wage: selfWage, payroll: selfPayroll, taxable: selfTaxable, tax: selfTax },
    partner: { age: 54, wage: partnerWage, payroll: partnerPayroll, taxable: partnerTaxable, tax: partnerTax },
  },
  mixed: {
    startCpi: 1 + inflation, spending: transitionSpending,
    withoutSpouseSupport: { partnerTax, spending: 60_302.62606 },
    self: { age: 57, wage: 0, payroll: 0, taxable: 0, tax: 0 },
    partner: { age: 55, wage: partnerWage, payroll: partnerPayroll, taxable: partnerTaxable, tax: partnerMixedTax },
  },
}

export function staggeredHouseholdPlan(): InputsV2 {
  const plan = retirementPlan({
    age: 56, spending: retirementSpending, inflation, tfsa: tfsaOpening, rrsp: rrspOpening,
  })
  const self = plan.people[0]
  Object.assign(self, {
    retirementAge: 57, earnedIncome: known(selfWage), previousYearEarnedIncome: known(31_000),
    provenance: { earnedIncome: recorded, previousYearEarnedIncome: recorded },
  })
  plan.people.push({
    ...structuredClone(self), id: PARTNER, role: 'partner', ageInBaseYear: 54, retirementAge: 56,
    earnedIncome: known(partnerWage), previousYearEarnedIncome: known(72_000),
  })
  plan.accounts.find(account => account.id === RRSP)!.ownerId = PARTNER
  plan.accounts.find(account => account.id === RRSP)!.taxableOwnerShares = { status: 'known', shares: { [PARTNER]: 1 } }
  plan.tfsaStatement![PARTNER] = { withdrawals: [], provenance: recorded }
  plan.budget = { kind: 'incomeBudget', workingSpending, retirementSpending }
  plan.taxProfile = { spouseSupported: known(true), pensionSplit: null }
  plan.lifeExpectancy = 60
  plan.legacyProjection = legacyRetirement({
    currentAge: 56, fireAge: 57, lifeExpectancy: plan.lifeExpectancy, annualSavings: 0,
    retirementSpending, inflation, balances: { tfsa: tfsaOpening, rrsp: rrspOpening, nonReg: 0 },
    partner: { currentAge: 54, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
  })
  return plan
}

export function staggeredSpending() {
  return {
    workingSpending: known(workingSpending),
    transitionSpending: known(transitionSpending),
    retirementSpending: known(retirementSpending),
  }
}

export const staggeredOwners = { [TFSA]: RETIREE, [RRSP]: PARTNER }
export const fullyRetiredYear = BASE_YEAR + 2
