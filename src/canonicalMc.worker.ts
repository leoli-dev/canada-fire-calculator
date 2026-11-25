import { runCanonicalMonteCarlo } from './canonicalMonteCarlo'
import { CANONICAL_MC_VERSION, type CanonicalMcIdentity, type CanonicalMcRequest, type CanonicalMcResponse } from './canonicalMcProtocol'

self.onmessage = (event: MessageEvent<CanonicalMcRequest>) => {
  const request = event.data
  const identity: CanonicalMcIdentity = { requestId: request.requestId, sourceId: request.sourceId, inputRevision: request.inputRevision, seed: request.seed, ruleVersion: CANONICAL_MC_VERSION }
  try {
    self.postMessage({ ...identity, status: 'success', result: runCanonicalMonteCarlo(request) } satisfies CanonicalMcResponse)
  } catch {
    self.postMessage({ ...identity, status: 'error' } satisfies CanonicalMcResponse)
  }
}
