import type { InputsV2 } from '../../model'
import { integratedHeldHomeEstateFixture } from './annualIntegratedHeldHomeEstate'
import { phaseTransitionPlan, phaseTransitionSpending } from './phaseTransition'
import { BASE_YEAR, RETIREE, TFSA, known, recorded, retirementPlan } from './retirementSettlement'

export function sampledHousehold(variant: 'event-gap' | 'zero-gaps' | 'partial' = 'event-gap') {
  const { plan, spending } = integratedHeldHomeEstateFixture()
  plan.deterministicProjection = { mode: 'canonical', spending, provenance: recorded }
  if (variant === 'zero-gaps') {
    spending.retirementSpending = known(0)
    plan.budget.retirementSpending = 0
    plan.legacyProjection.retirementSpending = 0
  }
  if (variant === 'partial') {
    plan.lifeExpectancy = 61
    plan.legacyProjection.lifeExpectancy = 61
    Object.assign(plan.annualHouseholdExpenseEvidence!, { allowPartialPayment: false })
  }
  return withVolatility(plan, 0)
}

export function sampledSolo() {
  const plan = phaseTransitionPlan()
  plan.deterministicProjection = { mode: 'canonical', spending: phaseTransitionSpending(), provenance: recorded }
  return withVolatility(plan, 0)
}

export function sampledPurchase() {
  const plan = retirementPlan({ tfsa: 100_000, rrsp: 0, spending: 8_000, inflation: 0.02, strategy: 'tfsaFirst' })
  plan.accounts = plan.accounts.filter(account => account.id === TFSA)
  Object.assign(plan.people[0], { retirementAge: 58, earnedIncome: known(12_000) })
  plan.legacyProjection.fireAge = 58
  plan.budget = { kind: 'incomeBudget', workingSpending: 10_298.65, retirementSpending: 8_000 }
  plan.deterministicProjection = { mode: 'canonical', provenance: recorded,
    spending: { workingSpending: known(10_298.65), retirementSpending: known(8_000) } }
  plan.properties = [{
    id: 'planned-home', kind: 'principal', value: 100_000.25, acb: known(100_000.25), annualRent: known(0),
    appreciation: 0.04, sellAtAge: null, plannedPurchaseAge: 58, plannedDownPayment: 100_000.25,
    plannedMortgage: null, annualHoldingCostChange: 0, mortgageDebtId: null,
    taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 1 } }, provenance: { value: recorded },
  }]
  plan.annualPrimaryHomePurchaseEvidence = { 'planned-home': {
    provenance: recorded, effectiveYear: BASE_YEAR + 1, timing: 'start-of-purchase-year', priceNominal: known(100_000.25),
    qualifyingAcquisitionCostsNominal: known(1_299.75), postPurchaseAnnualSpendingReal: known(1_000), excludesOneTimeCosts: true,
  } }
  return withVolatility(plan, 0)
}

export function withVolatility(plan: InputsV2, value: number) {
  for (const account of plan.accounts) account.volatility = value
  return plan
}

export function deeplyFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deeplyFreeze(child)
    Object.freeze(value)
  }
  return value
}
