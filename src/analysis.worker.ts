import { ANALYSES, type AnalysisRequest, type AnalysisResponse } from './analysis/compute'

self.onmessage = (e: MessageEvent<AnalysisRequest>) => {
  const { requestId, kind, inputs } = e.data
  try {
    self.postMessage({ requestId, status: 'success', result: ANALYSES[kind](inputs) } satisfies AnalysisResponse)
  } catch (error) {
    self.postMessage({ requestId, status: 'error', error: String(error) } satisfies AnalysisResponse)
  }
}
