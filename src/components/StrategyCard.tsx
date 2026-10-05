import { useTranslation } from 'react-i18next'
import type { Inputs } from '../engine'
import { useAnalysis, useCardOpen } from '../analysis/useAnalysis'
import type { AnalysisResult } from '../analysis/compute'
import { AnalysisBody } from './AnalysisBody'
import { useCad } from '../format'
import { useStore } from '../store'
import { track } from '../analytics'
import { Jargon } from './Jargon'

export function StrategyCard(props: { inputs: Inputs }) {
  const { t } = useTranslation()
  // FE-47: computed off the main thread, only while the card is open.
  const [open, setOpen] = useCardOpen('strategy')
  const analysis = useAnalysis('strategy', props.inputs, open)
  return (
    <details className="chart-card collapsible" open={open}
      onToggle={(e) => {
        setOpen(e.currentTarget.open)
        if (e.currentTarget.open && !open) track('panel_open', { panel: 'strategy_comparison' })
      }}>
      <summary><h3>{t('strategyTitle')}</h3></summary>
      {open && <AnalysisBody analysis={analysis}>{(scan, stale) => <StrategyBody inputs={props.inputs} scan={scan} stale={stale} />}</AnalysisBody>}
    </details>
  )
}

function StrategyBody(props: { inputs: Inputs; scan: AnalysisResult<'strategy'>; stale: boolean }) {
  const { t } = useTranslation()
  const cad = useCad()
  const set = useStore((s) => s.set)
  const dwz = (props.inputs.goal ?? 'legacy') === 'dieWithZero'
  const { rows, ranking } = props.scan

  return (
    <>
      <div className="table-scroll">
      <table className="compare-table">
        <thead>
          <tr>
            <th><Jargon text={t('withdrawalOrder')} /></th>
            <th>{t('stratOutcome')}</th>
            <th>{t('totalTax')}</th>
            <th>{t('rrspTaxCol')}</th>
            <th>{dwz ? t('maxSpendingCol') : t('estateValue')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const assessed = ranking.candidates.find((candidate) => candidate.value === r.strategy)!
            const isBest = assessed.status === 'feasible' && assessed.metric === ranking.best?.metric
            const isCurrent = r.strategy === props.inputs.strategy
            return (
              <tr key={r.strategy} className={isCurrent ? 'current-row' : ''}>
                <td>
                  <Jargon text={t(`strat_${r.strategy}`)} />
                  {isCurrent && <span className="tag">{t('current')}</span>}
                  {isBest && <span className="tag best">{t('best')}</span>}
                </td>
                <td>
                  {assessed.status === 'feasible'
                    ? t('stratOk')
                    : <>{assessed.status === 'infeasible' ? t('stratDepleted', { age: r.result.depletedAge })
                      : t(`solver_${assessed.status}`)}{' '}
                      {assessed.gap !== null && t('candidateGap', { amount: cad(assessed.gap) })}</>}
                </td>
                <td className="num">{assessed.status === 'feasible' ? cad(r.totalTax) : '—'}</td>
                <td className="num">{assessed.status === 'feasible' ? cad(r.result.rrspTax) : '—'}</td>
                <td className="num">
                  {assessed.metric !== null ? cad(assessed.metric) : '—'}
                </td>
                <td className="num">
                  {!isCurrent && assessed.status === 'feasible' && (
                    <button
                      type="button"
                      className="use-strategy"
                      disabled={props.stale}
                      onClick={() => {
                        set({ strategy: r.strategy })
                        track('strategy_change', { strategy: r.strategy, source: 'comparison_table' })
                      }}
                    >
                      {t('useStrategy')}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
      {ranking.status === 'noFeasibleCandidate' && <p className="hint">{t('noFeasibleCandidate')}</p>}
      {ranking.status === 'unrankedObjective' && <p className="hint">{ranking.candidates.some((row) => row.reason === 'lockedWithdrawalLimits')
        ? t('lockedRecommendationUnranked') : t('unrankedObjective')}</p>}
      <p className="hint"><Jargon text={dwz ? t('strategyNoteDwz') : t('strategyNote')} /></p>
    </>
  )
}
