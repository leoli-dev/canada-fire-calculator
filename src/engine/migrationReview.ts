import { precisionGate, type InputsV2 } from './model'

export interface MigrationReview {
  ownershipPending: boolean
  precisionAllowed: boolean
  unassignedAccounts: InputsV2['accounts']
  unassignedProperties: InputsV2['properties']
  unassignedIncome: InputsV2['incomeSources']
  orphanedPeople: NonNullable<InputsV2['orphanedPeople']>
}

/** Read-only view of one canonical plan. A legacy total is never an owner assignment. */
export function migrationReview(plan: InputsV2 | null): MigrationReview | null {
  if (!plan) return null
  const gate = precisionGate(plan)
  return {
    ownershipPending: gate.reasons.includes('ownershipUnknown') || gate.reasons.includes('recipientUnknown'),
    precisionAllowed: gate.allowed,
    unassignedAccounts: plan.accounts.filter(account => account.kind !== 'nonReg' && account.ownerId === null || account.taxableOwnerShares.status === 'unknown'),
    unassignedProperties: plan.properties.filter(property => property.taxableOwnerShares.status === 'unknown'),
    unassignedIncome: plan.incomeSources.filter(source => source.recipientId === null && source.annualAmount.status === 'known' && source.annualAmount.value !== 0),
    orphanedPeople: plan.orphanedPeople ?? [],
  }
}

export function canComparePrecisely(current: InputsV2 | null, scenarioA: InputsV2 | null): boolean {
  return current !== null && scenarioA !== null && precisionGate(current).allowed && precisionGate(scenarioA).allowed
}
