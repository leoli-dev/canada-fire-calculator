import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { runProjection, type ProjectionResult } from '../engine'
import { useCad } from '../format'
import { useStore } from '../store'
import { track } from '../analytics'
import { Jargon } from './Jargon'
import { canComparePrecisely, migrationReview } from '../engine/migrationReview'

function Cell(props: { r: ProjectionResult; life: number; legacyEstimate: boolean }) {
  const { t } = useTranslation()
  const cad = useCad()
  return (
    <>
      <td>
        {props.legacyEstimate ? t('migrationUnassigned') : props.r.success
          ? t('stratOk')
          : t('stratDepleted', { age: props.r.depletedAge })}
      </td>
      <td className="num">{props.legacyEstimate ? '—' : cad(props.r.estateValue)}</td>
    </>
  )
}

export function ScenarioCard() {
  const { t } = useTranslation()
  const { inputs, canonical, scenarioA, scenarioACanonical, saveScenarioA, restoreScenarioA, clearScenarioA } = useStore()
  const currentReview = migrationReview(canonical)
  const scenarioReview = migrationReview(scenarioACanonical)
  const comparisonBlocked = !!scenarioA && !canComparePrecisely(canonical, scenarioACanonical)
  const ownershipPending = currentReview?.ownershipPending || scenarioReview?.ownershipPending

  const resultA = useMemo(
    () => (scenarioA ? runProjection(scenarioA) : null),
    [scenarioA],
  )
  const resultNow = useMemo(() => runProjection(inputs), [inputs])

  return (
    <details className="chart-card collapsible"
      onToggle={(e) => e.currentTarget.open && track('panel_open', { panel: 'scenario_comparison' })}>
      <summary><h3>{t('scenarioTitle')}</h3></summary>
      {comparisonBlocked && <p className="hint">{t('migrationComparisonBlocked')} {ownershipPending && t('migrationLegacySummary')}</p>}
      <div className="card-head">
        <div>
          <button onClick={saveScenarioA}>
            {t('scenarioSave')}
          </button>
          {scenarioA && (
            <>
              <button className="subtle" onClick={restoreScenarioA}>
                {t('scenarioRestore')}
              </button>
              <button className="subtle" onClick={clearScenarioA}>
                {t('scenarioClear')}
              </button>
            </>
          )}
        </div>
      </div>
      {scenarioA && resultA ? (
        <div className="table-scroll">
        <table className="compare-table">
          <thead>
            <tr>
              <th></th>
              <th>{t('stratOutcome')}</th>
              <th scope="col" className="num">{t('finalNetWorth')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t('scenarioA')}</td>
              <Cell r={resultA} life={scenarioA.lifeExpectancy} legacyEstimate={comparisonBlocked} />
            </tr>
            <tr className="current-row">
              <td>{t('scenarioCurrent')}</td>
              <Cell r={resultNow} life={inputs.lifeExpectancy} legacyEstimate={comparisonBlocked} />
            </tr>
          </tbody>
        </table>
        </div>
      ) : (
        <p className="hint"><Jargon text={t('scenarioHint')} /></p>
      )}
    </details>
  )
}
