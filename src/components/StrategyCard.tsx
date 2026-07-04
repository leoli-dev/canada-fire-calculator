import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { compareStrategies, type Inputs } from '../engine'
import { useCad } from '../format'
import { useStore } from '../store'
import { Jargon } from './Jargon'

export function StrategyCard(props: { inputs: Inputs }) {
  const { t } = useTranslation()
  const cad = useCad()
  const set = useStore((s) => s.set)
  const dwz = (props.inputs.goal ?? 'legacy') === 'dieWithZero'
  const rows = useMemo(
    () => compareStrategies(props.inputs, { maxSpending: dwz }),
    [props.inputs, dwz],
  )

  const score = (r: (typeof rows)[number]) =>
    dwz ? (r.maxSpending ?? 0) : r.result.estateValue
  const bestScore = Math.max(
    ...rows.filter((r) => dwz || r.result.success).map(score),
    -Infinity,
  )

  return (
    <div className="chart-card">
      <h3>{t('strategyTitle')}</h3>
      <table className="compare-table">
        <thead>
          <tr>
            <th>{t('withdrawalOrder')}</th>
            <th>{t('stratOutcome')}</th>
            <th>{t('totalTax')}</th>
            <th>{t('rrspTaxCol')}</th>
            <th>{dwz ? t('maxSpendingCol') : t('estateValue')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isBest = (dwz || r.result.success) && score(r) === bestScore
            const isCurrent = r.strategy === props.inputs.strategy
            return (
              <tr key={r.strategy} className={isCurrent ? 'current-row' : ''}>
                <td>
                  <Jargon text={t(`strat_${r.strategy}`)} />
                  {isCurrent && <span className="tag">{t('current')}</span>}
                  {isBest && <span className="tag best">{t('best')}</span>}
                </td>
                <td>
                  {r.result.success
                    ? t('stratOk')
                    : t('stratDepleted', { age: r.result.depletedAge })}
                </td>
                <td className="num">{cad(r.totalTax)}</td>
                <td className="num">{cad(r.result.rrspTax)}</td>
                <td className="num">
                  {dwz ? cad(r.maxSpending ?? 0) : cad(r.result.estateValue)}
                </td>
                <td className="num">
                  {!isCurrent && (
                    <button
                      type="button"
                      className="use-strategy"
                      onClick={() => set({ strategy: r.strategy })}
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
      <p className="hint"><Jargon text={dwz ? t('strategyNoteDwz') : t('strategyNote')} /></p>
    </div>
  )
}
