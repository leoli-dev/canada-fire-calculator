import { useTranslation } from 'react-i18next'
import type { Inputs, ProjectionResult } from '../engine'
import { useCad } from '../format'
import { Jargon } from './Jargon'
import { OAS_GIS_ALLOWANCE_2026_Q3 } from '../engine/benefits'

/** "65", "65–67" or "65, 70–72" from a sorted list of ages. */
function ageRanges(ages: number[]): string {
  const parts: string[] = []
  let start = ages[0]
  let prev = ages[0]
  for (const age of [...ages.slice(1), Infinity]) {
    if (age === prev + 1) { prev = age; continue }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`)
    start = age
    prev = age
  }
  return parts.join(', ')
}

/**
 * BE-26 A: which GIS/Allowance table row this household is priced from, and
 * what that row's income cut-off is. The amount alone cannot show that a
 * couple with one pensioner uses its own row rather than the single table, so
 * the category, the split between the GIS and the 60-64 spousal Allowance and
 * the cut-off are all stated explicitly, one line per paying year. Both entry
 * modes mount this panel and read the same projection rows, so a mode switch
 * cannot change the answer.
 */
export function BenefitCategoryPanel(props: { inputs: Inputs; result: ProjectionResult }) {
  const { t } = useTranslation()
  const cad = useCad()
  const retired = props.result.rows.filter((row) => row.phase !== 'accumulation')
  const rows = retired.filter((row) => row.gis > 0)
  if (rows.length === 0) return null
  // OAS years that paid nothing: the modelled income was over the cut-off.
  const missed = retired.filter((row) => row.oas > 0 && row.gis === 0 && row.gisCategory !== 'unsupported').length
  const total = rows.reduce((sum, row) => sum + row.gis, 0)
  const pack = OAS_GIS_ALLOWANCE_2026_Q3

  return <details className="chart-card collapsible" data-testid="benefit-category-panel">
    <summary><h3>{t('benefitCategoryTitle')}</h3></summary>
    <p data-testid="benefit-category-summary">
      {t('benefitCategorySummary', { ages: ageRanges(rows.map((row) => row.age)), total: cad(total) })}
      {missed > 0 && <> {t('benefitCategoryMissed', { n: missed })}</>}
    </p>
    <p className="hint"><Jargon text={t('benefitCategoryWhat')} /></p>
    <div className="table-scroll">
      <table className="compare-table year-table" data-testid="benefit-category-table">
        <thead>
          <tr>
            <th>{t('benefitCategoryAge')}</th>
            <th>{t('benefitCategoryRow')}</th>
            <th className="num">{t('benefitCategoryCutoff')}</th>
            <th className="num">{t('benefitCategoryGis')}</th>
            <th className="num">{t('benefitCategoryAllowance')}</th>
            <th className="num">{t('benefitCategoryTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => <tr key={row.age}>
            <td>{row.age}</td>
            <td data-testid={`benefit-category-name-${row.age}`}>{t(`benefitCategory.${row.gisCategory}`)}</td>
            <td className="num" data-testid={`benefit-category-cutoff-${row.age}`}>{cad(row.gisAnnualCutoff)}</td>
            <td className="num" data-testid={`benefit-gis-${row.age}`}>{cad(row.gis - row.allowance)}</td>
            <td className="num" data-testid={`benefit-allowance-${row.age}`}>{cad(row.allowance)}</td>
            <td className="num strong" data-testid={`benefit-total-${row.age}`}>{cad(row.gis)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <p className="hint">{t('benefitCategoryLimit', { id: pack.id, period: pack.paymentPeriod })}</p>
  </details>
}
