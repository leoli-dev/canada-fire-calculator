import type { InputsV2 } from '../engine/model'
import { qcCoverageAnnualStatus } from '../engine/quebecTax'

/** Whether every account a couple holds has a confirmed taxable owner. */
export function accountOwnershipComplete(plan: InputsV2): boolean {
  return plan.accounts.every(account => (account.kind === 'nonReg' || !!account.ownerId) && account.taxableOwnerShares.status === 'known')
}

/** Whether every property, the home included, has a confirmed taxable owner. */
export function propertyOwnershipComplete(plan: InputsV2): boolean {
  return plan.properties.every(property => property.taxableOwnerShares.status === 'known')
}

/** Whether every person's Quebec drug coverage is recorded for all twelve months. */
export function qcCoverageComplete(plan: InputsV2): boolean {
  return plan.people.every(person => {
    const months = plan.taxProfile?.qcDrugCoverage?.[person.id]
    return !!months && months.length === 12 && !months.includes('unknown') && qcCoverageAnnualStatus(months) !== 'unknown'
  })
}
