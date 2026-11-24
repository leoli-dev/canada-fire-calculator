import type { Strategy } from '../../types'
import { known, RETIREE, RRSP, TFSA } from './retirementSettlement'
import { PARTNER, staggeredHouseholdPlan, staggeredReference, staggeredSpending } from './staggeredHousehold'

// 2026 Ontario anchor dollars. Both people are under 65, the spouse support
// fact is true, and neither has pension, benefits, or other taxable income.
// At $6,000 of RRSP income the retiree still owes zero and the worker loses
// $6,000 of federal spouse credit base and $4,897 of Ontario credit base.
const mixedGross = 6_000
const mixedIncrementalTax = mixedGross * 0.14 + (mixedGross - (12_132 - 11_029)) * 0.0505
const mixedGap = mixedGross - mixedIncrementalTax

// When both retire the RRSP owner claims the full spouse amounts. A $40,000
// draw is in the first brackets and has a $450 Ontario health premium.
const retiredGross = 40_000
const retiredTax = (retiredGross - 2 * 16_452) * 0.14
  + (retiredGross - 12_989 - 11_029) * 0.0505 + 450
const retiredSpending = retiredGross - retiredTax

export const householdRrspReference = {
  mixedGross, mixedIncrementalTax, mixedGap, retiredGross, retiredTax, retiredSpending,
  // On the working owner's return this entire draw lands in the second
  // federal and Ontario brackets, with no change to payroll or health premium.
  mixedWorkerGross: mixedGap / (1 - 0.205 - 0.0915),
}

export function householdRrspFixture({
  owner = RETIREE, strategy = 'rrspFirst', tfsaBalance = 0, rrspBalance = 50_000, mixedDeficit = true,
}: { owner?: typeof RETIREE | typeof PARTNER; strategy?: Strategy; tfsaBalance?: number; rrspBalance?: number; mixedDeficit?: boolean } = {}) {
  const plan = staggeredHouseholdPlan()
  plan.strategy = strategy
  plan.legacyProjection.strategy = strategy
  const rrsp = plan.accounts.find(account => account.id === RRSP)!
  rrsp.ownerId = owner
  rrsp.taxableOwnerShares = { status: 'known', shares: { [owner]: 1 } }
  rrsp.balance = rrspBalance
  const tfsa = plan.accounts.find(account => account.id === TFSA)!
  tfsa.balance = tfsaBalance
  plan.legacyProjection.balances = { tfsa: tfsaBalance, rrsp: rrsp.balance, nonReg: 0 }
  if (plan.budget.kind !== 'incomeBudget') throw new Error('Expected an income budget')
  plan.budget.retirementSpending = retiredSpending
  plan.legacyProjection.retirementSpending = retiredSpending
  const evidence = {
    ...staggeredSpending(),
    transitionSpending: known(staggeredReference.mixed.spending + (mixedDeficit ? mixedGap : 0)),
    retirementSpending: known(retiredSpending),
  }
  return { plan, evidence }
}
