import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Inputs, ProjectionResult } from '../engine'
import { useCad } from '../format'
import { Jargon } from './Jargon'
import { OAS_GIS_ALLOWANCE_2026_Q3 } from '../engine/benefits'

/**
 * BE-26 A: which GIS/Allowance table row this household is priced from, and
 * what that row's income cut-off is. The amount alone cannot show that a
 * couple with one pensioner uses its own row rather than the single table, so
 * the category, the split between the GIS and the 60-64 spousal Allowance and
 * the cut-off are all stated explicitly. Both entry modes mount this panel and
 * read the same projection rows, so a mode switch cannot change the answer.
 */
export function BenefitCategoryPanel(props: { inputs: Inputs; result: ProjectionResult }) {
  const { t } = useTranslation()
  const cad = useCad()
  // The first year benefits can be paid; before OAS starts there is no row.
  const rows = props.result.rows.filter((row) => row.phase !== 'accumulation' && row.gis > 0)
  const [age, setAge] = useState<number | null>(null)
  if (rows.length === 0) return null
  const selected = rows.find((row) => row.age === age) ?? rows[0]
  const pack = OAS_GIS_ALLOWANCE_2026_Q3

  return <details className="chart-card collapsible" data-testid="benefit-category-panel">
    <summary><h3>{t('benefitCategoryTitle')}</h3></summary>
    <p className="hint">{t('benefitCategoryNote', { id: pack.id, period: pack.paymentPeriod })}</p>
    <div className="benefit-category-year">
      <label className="field">
        <span>{t('benefitCategoryYear')}</span>
        <select value={selected.age} data-testid="benefit-category-year"
          onChange={(event) => setAge(Number(event.target.value))}>
          {rows.map((row) => <option key={row.age} value={row.age}>{row.age}</option>)}
        </select>
      </label>
    </div>
    <dl className="benefit-category-facts">
      <dt>{t('benefitCategoryRow')}</dt>
      <dd data-testid="benefit-category-name">{t(`benefitCategory.${selected.gisCategory}`)}</dd>
      <dt>{t('benefitCategoryCutoff')}</dt>
      <dd data-testid="benefit-category-cutoff">{cad(selected.gisAnnualCutoff)}</dd>
      <dt>{t('benefitCategoryGis')}</dt>
      <dd data-testid={`benefit-gis-${selected.age}`}>{cad(selected.gis - selected.allowance)}</dd>
      <dt>{t('benefitCategoryAllowance')}</dt>
      <dd data-testid={`benefit-allowance-${selected.age}`}>{cad(selected.allowance)}</dd>
      <dt>{t('benefitCategoryTotal')}</dt>
      <dd data-testid={`benefit-total-${selected.age}`}>{cad(selected.gis)}</dd>
    </dl>
    <p className="hint"><Jargon text={t('benefitCategoryLimit', { id: pack.id })} /></p>
  </details>
}
