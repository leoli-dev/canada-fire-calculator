import { useTranslation } from 'react-i18next'
import type { InputsV2 } from '../engine/model'
import type { ProjectionResult } from '../engine/types'
import { useCad } from '../format'

/** A tax ledger is meaningful only with an identified recipient per row. */
export function PersonTaxTable({ plan, result }: { plan: InputsV2; result: ProjectionResult }) {
  const { t } = useTranslation()
  const cad = useCad()
  const rows = result.rows.filter(row => row.phase !== 'accumulation' && row.byPersonTax)
  if (rows.length === 0) return null
  return <details className="chart-card collapsible" data-testid="person-tax-table">
    <summary><h3>{t('be11.personLedger')}</h3></summary>
    <p className="hint">{t('be11.ledgerLimit')}</p>
    <div className="table-scroll"><table className="compare-table">
      <thead><tr><th>{t('colAge')}</th><th>{t('be11.person')}</th><th>{t('be11.grossIncome')}</th>
        <th>{t('colTaxable')}</th><th>{t(plan.province === 'QC' ? 'be35.federalEligiblePension' : 'be11.eligiblePension')}</th>
        {plan.province === 'QC' && <><th>{t('be35.qcRetirementEligible')}</th><th>{t('be35.scheduleB')}</th><th>{t('be35.qcProvincialTax')}</th><th>{t('be35.fss')}</th><th>{t('be35.ramq')}</th></>}
        <th>{t('taxLabel')}</th></tr></thead>
      <tbody>{rows.flatMap(row => Object.values(row.byPersonTax!).map(person => <tr key={`${row.age}:${person.personId}`}>
        <td>{row.age}</td><td>{t(plan.people.find(item => item.id === person.personId)?.role === 'partner' ? 'be11.partner' : 'be11.self')}</td>
        <td className="num">{cad(person.grossIncome)}</td><td className="num">{cad(person.taxableIncome)}</td>
        <td className="num">{cad(person.federalPensionEligible)}</td>
        {plan.province === 'QC' && <><td className="num">{cad(person.provincialPensionEligible)}</td><td className="num">{cad(person.qc?.scheduleBCredit ?? 0)}</td>
          <td className="num">{cad(person.qc?.provincialIncomeTax ?? 0)}</td><td className="num">{cad(person.qc?.fss ?? 0)}</td>
          <td className="num">{cad(person.qc?.ramq ?? 0)}</td></>}
        <td className="num">{cad(person.tax)}</td>
      </tr>))}</tbody>
    </table></div>
  </details>
}
