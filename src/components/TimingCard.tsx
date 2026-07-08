import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  cppAnnual,
  maxSustainableSpending,
  oasAnnual,
  runProjection,
  type Inputs,
} from '../engine'
import { useCad } from '../format'
import { useStore } from '../store'
import { track } from '../analytics'
import { Jargon } from './Jargon'

const CPP_AGES = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70]
const OAS_AGES = [65, 66, 67, 68, 69, 70]

interface TimingRow {
  age: number
  annual: number
  success: boolean
  depletedAge: number | null
  metric: number
}

function withAge(ages: number[], current: number): number[] {
  return ages.includes(current) ? ages : [...ages, current].sort((a, b) => a - b)
}

export function TimingCard(props: { inputs: Inputs }) {
  const { t } = useTranslation()
  const cad = useCad()
  const set = useStore((s) => s.set)
  const { inputs } = props
  const dwz = (inputs.goal ?? 'legacy') === 'dieWithZero'

  const { cppRows, oasRows, best } = useMemo(() => {
    const metric = (v: Inputs) =>
      dwz ? maxSustainableSpending(v) : runProjection(v).estateValue

    const buildRow = (v: Inputs, age: number, annual: number): TimingRow => {
      const r = runProjection(v)
      return { age, annual, success: r.success, depletedAge: r.depletedAge, metric: metric(v) }
    }

    const cppRows = withAge(CPP_AGES, inputs.cppStartAge).map((age) =>
      buildRow({ ...inputs, cppStartAge: age }, age, cppAnnual(inputs.cppAnnualAt65, age)),
    )
    const oasRows = withAge(OAS_AGES, inputs.oasStartAge).map((age) =>
      buildRow({ ...inputs, oasStartAge: age }, age, oasAnnual(inputs.oasAnnualAt65, age)),
    )

    let best = { cpp: inputs.cppStartAge, oas: inputs.oasStartAge, metric: -Infinity }
    if (dwz) {
      // the die-with-zero metric is a solver itself; a full joint scan would
      // be slow, so combine each table's own winner
      const bestCpp = cppRows.reduce((a, b) => (b.metric > a.metric ? b : a)).age
      const bestOas = oasRows.reduce((a, b) => (b.metric > a.metric ? b : a)).age
      best = {
        cpp: bestCpp,
        oas: bestOas,
        metric: metric({ ...inputs, cppStartAge: bestCpp, oasStartAge: bestOas }),
      }
    } else {
      for (const cpp of withAge(CPP_AGES, inputs.cppStartAge)) {
        for (const oas of withAge(OAS_AGES, inputs.oasStartAge)) {
          const m = metric({ ...inputs, cppStartAge: cpp, oasStartAge: oas })
          if (m > best.metric) best = { cpp, oas, metric: m }
        }
      }
    }
    return { cppRows, oasRows, best }
  }, [inputs, dwz])

  const currentCpp = cppRows.find((r) => r.age === inputs.cppStartAge)!
  const currentOas = oasRows.find((r) => r.age === inputs.oasStartAge)!
  const currentMetric = dwz ? maxSustainableSpending(inputs) : runProjection(inputs).estateValue
  const metricLabel = dwz ? t('maxSpendingCol') : t('estateValue')

  const renderTable = (
    rows: TimingRow[],
    currentAge: number,
    currentRow: TimingRow,
    apply: (age: number) => void,
  ) => (
    <div className="table-scroll">
    <table className="compare-table">
      <thead>
        <tr>
          <th>{t('colStartAge')}</th>
          <th>{t('colAnnual')}</th>
          <th>{t('stratOutcome')}</th>
          <th>{metricLabel}</th>
          <th>{t('colDelta')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const isCurrent = r.age === currentAge
          const delta = r.metric - currentRow.metric
          const isBestRow = r.metric === Math.max(...rows.map((x) => x.metric))
          return (
            <tr key={r.age} className={isCurrent ? 'current-row' : ''}>
              <td>
                {r.age}
                {isCurrent && <span className="tag">{t('current')}</span>}
                {isBestRow && <span className="tag best">{t('best')}</span>}
              </td>
              <td className="num">{cad(r.annual)}</td>
              <td>{r.success ? t('stratOk') : t('stratDepleted', { age: r.depletedAge })}</td>
              <td className="num">{cad(r.metric)}</td>
              <td className={`num ${delta > 0 ? 'good' : delta < 0 ? 'poor' : ''}`}>
                {isCurrent ? '—' : `${delta >= 0 ? '+' : '−'}${cad(Math.abs(delta))}`}
              </td>
              <td className="num">
                {!isCurrent && (
                  <button type="button" className="use-strategy" onClick={() => apply(r.age)}>
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
  )

  const bestIsCurrent = best.cpp === inputs.cppStartAge && best.oas === inputs.oasStartAge

  return (
    <details className="chart-card collapsible"
      onToggle={(e) => e.currentTarget.open && track('panel_open', { panel: 'timing_comparison' })}>
      <summary><h3>{t('timingTitle')}</h3></summary>
      <p className="hint">
        <Jargon text={t('timingWhy', { life: inputs.lifeExpectancy })} />
      </p>

      <h4 className="table-title">{t('timingCppTitle')}</h4>
      {renderTable(cppRows, inputs.cppStartAge, currentCpp, (age) => {
        set({ cppStartAge: age })
        track('timing_apply', { which: 'cpp' })
      })}

      <h4 className="table-title">{t('timingOasTitle')}</h4>
      {renderTable(oasRows, inputs.oasStartAge, currentOas, (age) => {
        set({ oasStartAge: age })
        track('timing_apply', { which: 'oas' })
      })}

      <div className="card-head" style={{ marginTop: 14 }}>
        <p className="combo">
          {bestIsCurrent ? (
            t('timingAlready')
          ) : (
            <>
              <Jargon text={t('timingBestCombo', { cpp: best.cpp, oas: best.oas })} />{' '}
              {best.metric > currentMetric && (
                <strong className="good">+{cad(best.metric - currentMetric)}</strong>
              )}
            </>
          )}
        </p>
        {!bestIsCurrent && (
          <button
            type="button"
            className="use-strategy"
            onClick={() => {
              set({ cppStartAge: best.cpp, oasStartAge: best.oas })
              track('timing_apply', { which: 'combo' })
            }}
          >
            {t('useStrategy')}
          </button>
        )}
      </div>
      <p className="hint"><Jargon text={t('timingNote')} /></p>
    </details>
  )
}
