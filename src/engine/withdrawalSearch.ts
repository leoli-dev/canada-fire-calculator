import type { AccountType } from './types'
export interface WithdrawalStep { account: AccountType; cap?: number }
/** Shared legacy allocation, with unchanged order and arithmetic. */
export function allocateOrderedWithdrawals(G: number, balances: Record<AccountType, number>, forcedRrsp: number, steps: WithdrawalStep[]): Record<AccountType, number> {
  const w: Record<AccountType, number> = { tfsa: 0, rrsp: 0, nonReg: 0 }
  let remaining = G
  const fromRrif = Math.min(remaining, forcedRrsp)
  w.rrsp += fromRrif
  remaining -= fromRrif
  for (const s of steps) {
    let capacity = balances[s.account] - w[s.account]
    if (s.cap !== undefined) capacity = Math.min(capacity, Math.max(0, s.cap - w[s.account]))
    const take = Math.min(remaining, capacity)
    w[s.account] += take
    remaining -= take
    if (remaining <= 0) break
  }
  return w
}
/** Preserve the legacy endpoint calls, 60 trials and final high-end evaluation. */
export function searchWithdrawalTarget<T extends { netCash: number }>(target: number, minimum: number, total: number, run: (gross: number) => T, iterations: 60 | 120 = 60): T {
  const atMin = run(minimum)
  if (atMin.netCash >= target) return atMin
  const atMax = run(total)
  if (atMax.netCash < target) return atMax
  let lo = minimum
  let hi = total
  // Legacy callers retain exactly their 60 trials and call trace. The
  // positive-GIS canonical caller opts into refinement so an extreme account
  // bracket cannot leave an otherwise exact recovery-boundary draw too high.
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2
    // Only the opt-in path stops at adjacent representable bounds; avoid
    // repeating a stagnant floating-point midpoint without touching legacy.
    if (iterations > 60 && (mid === lo || mid === hi)) break
    if (run(mid).netCash < target) lo = mid
    else hi = mid
  }
  return run(hi)
}
