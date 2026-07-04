import { runMonteCarlo } from './engine/monteCarlo'
import type { Inputs } from './engine/types'

self.onmessage = (e: MessageEvent<{ inputs: Inputs; trials: number }>) => {
  const { inputs, trials } = e.data
  self.postMessage(runMonteCarlo(inputs, trials))
}
