import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisState } from '../analysis/useAnalysis'
import type { AnalysisKind, AnalysisResult } from '../analysis/compute'

/** Pending, stale and failed states shared by the comparison cards. */
export function AnalysisBody<K extends AnalysisKind>(props: {
  analysis: AnalysisState<K>
  children: (data: AnalysisResult<K>, stale: boolean) => ReactNode
}) {
  const { t } = useTranslation()
  const { analysis } = props
  if (!analysis.data) return <p className="hint" role="status" data-testid="analysis-pending">
    {analysis.status === 'error' ? t('analysisFailed') : t('analysisPending')}</p>
  return <div className={analysis.stale ? 'analysis-stale' : undefined} aria-busy={analysis.stale}>
    {analysis.stale && <p className="hint" role="status">{analysis.status === 'error' ? t('analysisFailed') : t('analysisUpdating')}</p>}
    {props.children(analysis.data, analysis.stale)}
  </div>
}
