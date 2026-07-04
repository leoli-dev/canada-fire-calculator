import { useTranslation } from 'react-i18next'
import { marginalRate, type Inputs, type ProjectionResult } from '../engine'
import { useCad } from '../format'
import { Jargon } from './Jargon'

/**
 * Audit-grade year-by-year breakdown of the retirement plan. Always in real
 * (today's) dollars — tax brackets are defined in real terms.
 */
export function YearTable(props: { result: ProjectionResult; inputs: Inputs }) {
  const { t } = useTranslation()
  const cad = useCad()
  const rows = props.result.rows.filter((r) => r.phase !== 'accumulation')
  if (rows.length === 0) return null
  const hasGis = rows.some((r) => r.gis > 0)

  return (
    <details className="chart-card collapsible">
      <summary><h3>{t('yearTableTitle')}</h3></summary>
      <p className="hint"><Jargon text={t('yearTableNote')} /></p>
      <div className="table-scroll">
        <table className="compare-table year-table">
          <thead>
            <tr>
              <th>{t('colAge')}</th>
              <th>{t('rrsp')}</th>
              <th>{t('nonReg')}</th>
              <th>{t('tfsa')}</th>
              <th>{t('cppLabel')}</th>
              <th>{t('oasLabel')}</th>
              {hasGis && <th>{t('gisLabel')}</th>}
              <th>{t('colGross')}</th>
              <th>{t('taxLabel')}</th>
              <th>{t('colNet')}</th>
              <th>{t('colTaxable')}</th>
              <th>{t('colMarginal')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const gross =
                r.withdrawals.rrsp + r.withdrawals.nonReg + r.withdrawals.tfsa + r.cpp + r.oas + r.gis
              const rate = marginalRate(r.taxablePerPerson, props.inputs.province)
              return (
                <tr key={r.age} className={r.phase === 'pension' ? '' : 'bridge-row'}>
                  <td>
                    {r.age}
                    {r.shortfall > 1 && <span className="tag poor-tag">!</span>}
                  </td>
                  <td className="num">{cad(r.withdrawals.rrsp)}</td>
                  <td className="num">{cad(r.withdrawals.nonReg)}</td>
                  <td className="num">{cad(r.withdrawals.tfsa)}</td>
                  <td className="num">{cad(r.cpp)}</td>
                  <td className="num">{cad(r.oas)}</td>
                  {hasGis && <td className="num">{cad(r.gis)}</td>}
                  <td className="num strong">{cad(gross)}</td>
                  <td className="num">{cad(r.tax)}</td>
                  <td className="num strong">{cad(r.netCash)}</td>
                  <td className="num">{cad(r.taxablePerPerson)}</td>
                  <td className="num">{(rate * 100).toFixed(1)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </details>
  )
}
