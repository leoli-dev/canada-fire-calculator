import type { IncomeSource, InputsV2 } from '../../model'
import { known, recorded, RETIREE, RRSP } from './retirementSettlement'
import { PARTNER, staggeredHouseholdPlan, staggeredReference, staggeredSpending } from './staggeredHousehold'

// Pinned Ontario 2026 rules at d0261bd33039351c0041a3fbf01b93ce51ae76db.
// The wages and tax brackets match the independent staggered-household reference.
const age65Amount = 12_000
const manualAt60 = age65Amount * (1 - 60 * 0.006)
const statementAt61 = 700 * 12
const mixedTaxable = 14_000
const onRate = 0.0505
const onBasicAmount = 12_989
const mixedTax = (mixedTaxable - onBasicAmount) * onRate
const retirementSpending = 24_000
// Only the RRSP owner has tax in the final year. Their gross must cover
// spending after the other person's CPP and the 5.05% Ontario tax above BPA.
const retiredTaxable = (retirementSpending - statementAt61 - onBasicAmount * onRate) / (1 - onRate)
const retiredTax = (retiredTaxable - onBasicAmount) * onRate
const { partner } = staggeredReference.working
const transitionSpending = partner.wage - partner.payroll - partner.tax + mixedTaxable - mixedTax

export const cppReference = {
  age65Amount, manualAt60, statementAt61, transitionSpending, retirementSpending,
  mixedTaxable, mixedTax, mixedWithdrawal: mixedTaxable - manualAt60,
  retiredTaxable, retiredTax, retiredWithdrawal: retiredTaxable - manualAt60,
}

export function cppPlan(includeCpp = true): InputsV2 {
  const plan = staggeredHouseholdPlan()
  const [self, partner] = plan.people
  Object.assign(self, { ageInBaseYear: 59, retirementAge: 60 })
  Object.assign(partner, { ageInBaseYear: 59, retirementAge: 61 })
  plan.lifeExpectancy = 63
  plan.taxProfile = { spouseSupported: known(false), pensionSplit: null }
  plan.budget = { kind: 'incomeBudget', workingSpending: staggeredReference.working.spending, retirementSpending }
  plan.strategy = 'rrspFirst'
  const rrsp = plan.accounts.find(account => account.id === RRSP)!
  Object.assign(rrsp, { balance: 60_000, ownerId: RETIREE, taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 1 } } })
  if (includeCpp) {
    self.cppAnnualAt65 = age65Amount
    partner.cppAnnualAt65 = statementAt61
    partner.cppAmountSource = { source: 'statement', sourceYear: 2025, basis: 'monthly', ageBasis: 61, dollarBasis: 'today', premises: { retirementAge: 61 } }
    plan.incomeSources = [cppStart(RETIREE, 60, age65Amount), cppStart(PARTNER, 61, statementAt61)]
  }
  return plan
}

export function cppStart(recipientId: string, startAge: number, amount: number): IncomeSource {
  return { id: `${recipientId}:cpp`, kind: 'cpp', recipientId, startAge, annualAmount: known(amount), provenance: recorded }
}

export function cppSpending() {
  return { ...staggeredSpending(), transitionSpending: known(transitionSpending), retirementSpending: known(retirementSpending) }
}
