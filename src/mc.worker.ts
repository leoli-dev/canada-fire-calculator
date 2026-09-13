import { runMonteCarlo } from './engine/monteCarlo'
import { MC_RULE_VERSION, seededRandom, type McRequest, type McResponse } from './mcProtocol'

self.onmessage = (e: MessageEvent<McRequest>) => {
  const { requestId, inputRevision, ruleVersion, seed, inputs, trials } = e.data
  const identity = { requestId, inputRevision, ruleVersion: MC_RULE_VERSION, seed }
  try {
    if (ruleVersion !== MC_RULE_VERSION) throw new Error('Monte Carlo rule version mismatch')
    const result = runMonteCarlo(inputs, trials, seededRandom(seed))
    self.postMessage({ ...identity, status: 'success', result } satisfies McResponse)
  } catch (error) {
    self.postMessage({ ...identity, status: 'error', error: String(error) } satisfies McResponse)
  }
}
