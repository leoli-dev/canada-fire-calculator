import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { runProjection, type ProjectionResult } from '../engine'
import { useCad } from '../format'
import { useStore } from '../store'
import { track } from '../analytics'
import { Jargon } from './Jargon'
import { canComparePrecisely, migrationReview } from '../engine/migrationReview'

function Cell(props: { r: ProjectionResult; life: number; blocked: boolean }) {
  const { t } = useTranslation()
  const cad = useCad()
  return (
    <>
      <td>
        {props.blocked ? t('migrationComparisonUnavailableOutcome') : props.r.success
          ? t('stratOk')
          : t('stratDepleted', { age: props.r.depletedAge })}
      </td>
      <td className="num">{props.blocked ? '—' : cad(props.r.finalNetWorth)}</td>
    </>
  )
}

export function ScenarioCard() {
  const { t } = useTranslation()
  const { inputs, canonical, scenarioA, scenarioACanonical, saveScenarioA, restoreScenarioA, clearScenarioA } = useStore()
  const currentReview = migrationReview(canonical)
  const scenarioReview = migrationReview(scenarioACanonical)
  const migrationComparisonBlocked = !!scenarioA && !canComparePrecisely(canonical, scenarioACanonical)
  const ownershipPending = currentReview?.ownershipPending || scenarioReview?.ownershipPending

  const resultA = useMemo(
    () => (scenarioA ? runProjection(scenarioA, undefined, scenarioACanonical ?? undefined) : null),
    [scenarioA, scenarioACanonical],
  )
  const resultNow = useMemo(() => runProjection(inputs, undefined, canonical ?? undefined), [inputs, canonical])
  const singleLegacyPreview = !inputs.partner && !scenarioA?.partner && inputs.province !== 'QC' && scenarioA?.province !== 'QC'
  const taxComparisonBlocked = !!scenarioA &&
    (resultNow.taxCapability?.status !== 'person' || resultA?.taxCapability?.status !== 'person')
  const terminalComparisonBlocked = !!scenarioA &&
    (resultNow.terminalTaxStatus === 'unsupported' || resultA?.terminalTaxStatus === 'unsupported')
  const comparisonBlocked = migrationComparisonBlocked || terminalComparisonBlocked || taxComparisonBlocked && !singleLegacyPreview

  return (
    <details className="chart-card collapsible" data-testid="scenario-comparison"
      onToggle={(e) => e.currentTarget.open && track('panel_open', { panel: 'scenario_comparison' })}>
      <summary><h3>{t('scenarioTitle')}</h3></summary>
      {comparisonBlocked && <p className="hint">{t(migrationComparisonBlocked ? 'migrationComparisonBlocked' : terminalComparisonBlocked ? 'be11TerminalComparisonLimit' : 'be11ComparisonLimit')} {ownershipPending && t('migrationLegacySummary')}</p>}
      {!comparisonBlocked && taxComparisonBlocked && <p className="hint">{t('be11ComparisonEstimate')}</p>}
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
              <Cell r={resultA} life={scenarioA.lifeExpectancy} blocked={comparisonBlocked} />
            </tr>
            <tr className="current-row">
              <td>{t('scenarioCurrent')}</td>
              <Cell r={resultNow} life={inputs.lifeExpectancy} blocked={comparisonBlocked} />
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
