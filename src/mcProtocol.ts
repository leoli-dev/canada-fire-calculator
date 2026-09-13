import type { Inputs } from './engine/types'
import type { MonteCarloResult } from './engine/monteCarlo'

// Bump when the projection's rules change; the worker echoes it for traceability.
export const MC_RULE_VERSION = '2026-tax-fe34a-1'

export interface McRequest {
  requestId: string
  inputRevision: number
  ruleVersion: string
  seed: number
  inputs: Inputs
  trials: number
}

export type McResponse = Pick<McRequest, 'requestId' | 'inputRevision' | 'ruleVersion' | 'seed'> & (
  | { status: 'success'; result: MonteCarloResult }
  | { status: 'error'; error: string }
)

export function matchesMcRequest(response: McResponse, request: McRequest): boolean {
  return response.requestId === request.requestId &&
    response.inputRevision === request.inputRevision &&
    response.ruleVersion === request.ruleVersion && response.seed === request.seed
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x6d2b79f5
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}
