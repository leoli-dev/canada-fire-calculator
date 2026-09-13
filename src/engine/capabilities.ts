import type { Inputs } from './types'

/** The current model has no jurisdiction-specific LIF withdrawal limits. */
export function hasUnverifiedLockedWithdrawals(inputs: Inputs): boolean {
  const locked = inputs.lockedRetirement
  return !!locked && (locked.balance > 0 || locked.employeeContribution > 0 || locked.employerContribution > 0)
}
