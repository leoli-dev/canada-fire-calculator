import type { Inputs } from '../../types'

export interface MoneyFixture {
  id: string
  baselineRevision: string
  provenanceRef: string
  inputVersion: string
  taxPeriod: string
  source: { kind: string; derivation: string }
  toleranceCad: number
  inputs: Inputs
  expected: {
    finalNetWorth: number
    rowBalances: Inputs['balances'][]
    rowNetCash: number[]
    rowShortfall: number[]
  }
}

export function expectCad(actual: number, expected: number, toleranceCad: number): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > toleranceCad) {
    throw new Error(`CAD mismatch: actual ${actual}, independent expected ${expected}, tolerance ${toleranceCad}`)
  }
}
