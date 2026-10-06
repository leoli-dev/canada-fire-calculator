import { compareStrategies, rankCandidates, scanBenefitTiming, type Inputs } from '../engine'

/**
 * FE-47: the comparison scans behind the collapsed result cards. A die-with-zero
 * benefit timing scan runs a spending search per age pair and takes seconds,
 * so these run in a worker, only while their card is open.
 */
export function strategyScan(inputs: Inputs) {
  const dwz = (inputs.goal ?? 'legacy') === 'dieWithZero'
  const rows = compareStrategies(inputs, { maxSpending: dwz })
  return {
    rows,
    ranking: rankCandidates(rows.map((row) => ({
      value: row.strategy, inputs: { ...inputs, strategy: row.strategy }, result: row.result, solver: row.maxSpending,
    })), dwz ? 'maxSpending' : 'estate'),
  }
}

export const ANALYSES = {
  timing: scanBenefitTiming,
  strategy: strategyScan,
} as const

export type AnalysisKind = keyof typeof ANALYSES
export type AnalysisResult<K extends AnalysisKind> = ReturnType<(typeof ANALYSES)[K]>

export interface AnalysisRequest { requestId: number; kind: AnalysisKind; inputs: Inputs }
export type AnalysisResponse = { requestId: number } & (
  | { status: 'success'; result: AnalysisResult<AnalysisKind> }
  | { status: 'error'; error: string }
)
