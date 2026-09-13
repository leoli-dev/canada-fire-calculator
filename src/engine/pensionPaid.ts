import type { Pension } from './types'

/** Today's-dollar employer annuity including its under-65 bridge. */
export function pensionPaid(p: Pension | null | undefined, personAge: number, inflation: number): number {
  if (!p || personAge < p.startAge) return 0
  const erosion = Math.pow((1 + inflation * p.indexation) / (1 + inflation), personAge - p.startAge)
  const bridge = personAge < 65 ? p.bridgeAnnual : 0
  return (p.annualAmount + bridge) * erosion
}
