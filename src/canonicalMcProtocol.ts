import type { Inputs } from './engine'
import type { InputsV2 } from './engine/model'
import type { CanonicalMonteCarloResult } from './canonicalMonteCarlo'

export const CANONICAL_MC_VERSION = 'canonical-mc-2026-v1'
export interface CanonicalMcRequest {
  requestId: string
  sourceId: string
  inputRevision: number
  ruleVersion: typeof CANONICAL_MC_VERSION
  seed: number
  inputs: Inputs
  plan: InputsV2
  evidence: { nonRegAbsent: boolean }
  /** Annual standard deviation of gross real returns, keyed by canonical account ID. */
  volatilityByAccount: Record<string, number | null>
  trials: number
}
export type CanonicalMcIdentity = Pick<CanonicalMcRequest, 'requestId' | 'sourceId' | 'inputRevision' | 'ruleVersion' | 'seed'>
export type CanonicalMcResponse = CanonicalMcIdentity & (
  { status: 'success'; result: CanonicalMonteCarloResult } | { status: 'error' }
)
export function matchesCanonicalMcRequest(response: CanonicalMcResponse, request: CanonicalMcRequest): boolean {
  return response?.requestId === request.requestId && response.sourceId === request.sourceId &&
    response.inputRevision === request.inputRevision && response.ruleVersion === request.ruleVersion && response.seed === request.seed
}
