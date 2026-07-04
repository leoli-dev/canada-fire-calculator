import { runProjection } from './projection'
import type { Inputs } from './types'

export interface FailureProfile {
  count: number
  /** earliest age any failed run went broke */
  earliestDepletedAge: number | null
  /** median depletion age among failed runs */
  medianDepletedAge: number | null
  /** mean annual return over the first 5 post-FIRE years, failed runs */
  avgEarlyReturnFailed: number | null
  /** same, successful runs — the gap is sequence-of-returns risk made visible */
  avgEarlyReturnSuccess: number | null
}

export interface MonteCarloResult {
  trials: number
  successRate: number
  bands: { age: number; p10: number; p50: number; p90: number }[]
  failures: FailureProfile
}

const DEFAULT_VOLS = { tfsa: 0.1, rrsp: 0.1, nonReg: 0.1 }

/**
 * Repeated projections with normally-distributed annual returns per account.
 * Returns the success rate and 10/50/90th-percentile net-worth bands by age.
 */
export function runMonteCarlo(
  inputs: Inputs,
  trials = 1000,
  rand: () => number = Math.random,
): MonteCarloResult {
  const vols = inputs.volatilities ?? DEFAULT_VOLS

  const gauss = () => {
    let u = 0
    let v = 0
    while (u === 0) u = rand()
    while (v === 0) v = rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  let successes = 0
  const totalsByYear: number[][] = []
  const failDepletedAges: number[] = []
  const earlyFailed: number[] = []
  const earlySuccess: number[] = []
  for (let t = 0; t < trials; t++) {
    let earlySum = 0
    let earlyN = 0
    const r = runProjection(inputs, (age, acct) => {
      const ret = inputs.returns[acct] + vols[acct] * gauss()
      if (age >= inputs.fireAge && age < inputs.fireAge + 5) {
        earlySum += ret
        earlyN++
      }
      return ret
    })
    const earlyAvg = earlyN > 0 ? earlySum / earlyN : 0
    if (r.success) {
      successes++
      earlySuccess.push(earlyAvg)
    } else {
      failDepletedAges.push(r.depletedAge!)
      earlyFailed.push(earlyAvg)
    }
    r.rows.forEach((row, i) => {
      const total =
        row.balances.tfsa + row.balances.rrsp + row.balances.nonReg + row.propertyValue
      ;(totalsByYear[i] ??= []).push(total)
    })
  }

  const ages = runProjection(inputs).rows.map((r) => r.age)
  const bands = totalsByYear.map((arr, i) => {
    arr.sort((a, b) => a - b)
    const q = (p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))]
    return { age: ages[i], p10: q(0.1), p50: q(0.5), p90: q(0.9) }
  })

  failDepletedAges.sort((a, b) => a - b)
  const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)
  const failures: FailureProfile = {
    count: failDepletedAges.length,
    earliestDepletedAge: failDepletedAges[0] ?? null,
    medianDepletedAge: failDepletedAges[Math.floor(failDepletedAges.length / 2)] ?? null,
    avgEarlyReturnFailed: mean(earlyFailed),
    avgEarlyReturnSuccess: mean(earlySuccess),
  }
  return { trials, successRate: successes / trials, bands, failures }
}
