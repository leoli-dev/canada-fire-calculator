import { runProjection } from './projection'
import type { Inputs } from './types'

export interface MonteCarloResult {
  trials: number
  successRate: number
  bands: { age: number; p10: number; p50: number; p90: number }[]
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
  for (let t = 0; t < trials; t++) {
    const r = runProjection(inputs, (_age, acct) => inputs.returns[acct] + vols[acct] * gauss())
    if (r.success) successes++
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

  return { trials, successRate: successes / trials, bands }
}
