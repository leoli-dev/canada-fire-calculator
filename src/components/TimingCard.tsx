import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cppAnnual, oasAnnual, scanBenefitTiming, type Inputs, type RankedCandidate } from '../engine'
import { useCad } from '../format'
import { useStore } from '../store'
import { track } from '../analytics'
import { Jargon } from './Jargon'

type AgeCandidate = RankedCandidate<{ cppStartAge: number; oasStartAge: number }>

export function TimingCard({ inputs }: { inputs: Inputs }) {
  const { t } = useTranslation()
  const cad = useCad()
  const set = useStore((s) => s.set)
  const ranking = useMemo(() => scanBenefitTiming(inputs), [inputs])
  const dwz = (inputs.goal ?? 'legacy') === 'dieWithZero'
  const current = ranking.candidates.find((row) => row.value.cppStartAge === inputs.cppStartAge && row.value.oasStartAge === inputs.oasStartAge)
  const best = ranking.candidates.find((row) => row.value.cppStartAge === ranking.best?.cppStartAge && row.value.oasStartAge === ranking.best?.oasStartAge)
  const cppRows = ranking.candidates.filter((row) => row.value.oasStartAge === inputs.oasStartAge)
    .sort((a, b) => a.value.cppStartAge - b.value.cppStartAge)
  const oasRows = ranking.candidates.filter((row) => row.value.cppStartAge === inputs.cppStartAge)
    .sort((a, b) => a.value.oasStartAge - b.value.oasStartAge)
  const failure = (row: AgeCandidate) => row.status === 'unsupported' && row.reason
    ? t(`solverReason_${row.reason}`, { defaultValue: t('solver_unsupported') })
    : row.status === 'searchLimit' || row.status === 'invalid' || row.status === 'unsupported'
      ? t(`solver_${row.status}`)
      : t('stratDepleted', { age: row.result?.depletedAge })
  const renderTable = (rows: AgeCandidate[], which: 'cpp' | 'oas') => {
    const currentAge = which === 'cpp' ? inputs.cppStartAge : inputs.oasStartAge
    const bestScore = Math.max(-Infinity, ...rows.filter((row) => row.status === 'feasible').map((row) => row.metric!))
    return <div className="table-scroll"><table className="compare-table">
      <thead><tr><th>{t('colStartAge')}</th><th>{t('colAnnual')}</th><th>{t('stratOutcome')}</th>
        <th>{dwz ? t('maxSpendingCol') : t('estateValue')}</th><th>{t('colDelta')}</th><th></th></tr></thead>
      <tbody>{rows.map((row) => {
        const age = which === 'cpp' ? row.value.cppStartAge : row.value.oasStartAge
        const annual = which === 'cpp' ? cppAnnual(inputs.cppAnnualAt65, age, inputs.province === 'QC' ? 72 : 70) : oasAnnual(inputs.oasAnnualAt65, age)
        const isCurrent = age === currentAge
        const delta = row.metric !== null && current?.metric !== null && current?.metric !== undefined ? row.metric - current.metric : null
        return <tr key={age} className={isCurrent ? 'current-row' : ''}>
          <td>{age}{isCurrent && <span className="tag">{t('current')}</span>}
            {row.status === 'feasible' && row.metric === bestScore && <span className="tag best">{t('best')}</span>}</td>
          <td className="num">{Number.isFinite(annual) ? cad(annual) : '—'}</td>
          <td>{row.status === 'feasible' ? t('stratOk') : <>{failure(row)}{' '}
            {row.gap !== null && t('candidateGap', { amount: cad(row.gap) })}</>}</td>
          <td className="num">{row.metric !== null ? cad(row.metric) : '—'}</td>
          <td className={`num ${delta !== null && delta > 0 ? 'good' : delta !== null && delta < 0 ? 'poor' : ''}`}>
            {isCurrent || delta === null ? '—' : `${delta >= 0 ? '+' : '−'}${cad(Math.abs(delta))}`}</td>
          <td className="num">{!isCurrent && row.status === 'feasible' &&
            <button type="button" className="use-strategy" onClick={() => {
              set({ [which === 'cpp' ? 'cppStartAge' : 'oasStartAge']: age }); track('timing_apply', { which })
            }}>{t('useStrategy')}</button>}</td>
        </tr>
      })}</tbody>
    </table></div>
  }
  const bestIsCurrent = best?.value.cppStartAge === inputs.cppStartAge && best?.value.oasStartAge === inputs.oasStartAge
  const gaps = ranking.candidates.filter((row) => row.gap !== null).sort((a, b) => a.gap! - b.gap!)
  return <details className="chart-card collapsible"
    onToggle={(event) => event.currentTarget.open && track('panel_open', { panel: 'timing_comparison' })}>
    <summary><h3>{t('timingTitle')}</h3></summary>
    <p className="hint"><Jargon text={t('timingWhy', { life: inputs.lifeExpectancy })} /></p>
    <h4 className="table-title">{t('timingCppTitle')}</h4>
    {renderTable(cppRows, 'cpp')}
    <h4 className="table-title">{t('timingOasTitle')}</h4>
    {renderTable(oasRows, 'oas')}
    <div className="card-head" style={{ marginTop: 14 }}>
      <p className="combo">{ranking.status === 'noFeasibleCandidate'
        ? <>{t('noFeasibleCandidate')} {ranking.candidates[0] && failure(ranking.candidates[0])}{' '}
          {gaps.length > 0 && t('smallestCandidateGap', { amount: cad(gaps[0].gap!), cpp: gaps[0].value.cppStartAge, oas: gaps[0].value.oasStartAge })}</>
        : bestIsCurrent ? t('timingAlready') : <>
          <Jargon text={t('timingBestCombo', { cpp: best?.value.cppStartAge, oas: best?.value.oasStartAge })} />{' '}
          {best?.metric !== null && current?.metric !== null && current?.metric !== undefined && best!.metric! > current.metric &&
            <strong className="good">+{cad(best!.metric! - current.metric)}</strong>}
        </>}</p>
      {!bestIsCurrent && best && <button type="button" className="use-strategy" onClick={() => {
        set({ cppStartAge: best.value.cppStartAge, oasStartAge: best.value.oasStartAge }); track('timing_apply', { which: 'combo' })
      }}>{t('useStrategy')}</button>}
    </div>
    <p className="hint"><Jargon text={t('timingNote')} /></p>
  </details>
}
