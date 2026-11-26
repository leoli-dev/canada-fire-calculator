import { Segmented, Button, Disclosure } from '../ui'
import { annualSheetText, type AnnualSheetModel } from '../annualSheet'
import { canonicalStopText } from '../canonicalAnnualSheet'
import { useTranslation } from 'react-i18next'
import type { CanonicalDeterministicResult } from '../deterministicResult'
import { sumNetWorth } from '../engine/annualState'
import { useStore } from '../store'
import { useCad } from '../format'

export function CanonicalResults({ result, model }: { result: CanonicalDeterministicResult; model: AnnualSheetModel | null }) {
  const { t, i18n } = useTranslation()
  const cad = useCad(2)
  const displayMode = useStore(s => s.displayMode)
  const setDisplayMode = useStore(s => s.setDisplayMode)
  const factor = (year: number, closing = false) => displayMode === 'real' && result.coverage ? (1 + result.coverage.inflation) ** -(year - result.coverage.baseYear + (closing ? 1 : 0)) : 1
  const coverage = result.coverage
  const blockedYear = result.requestedYears > 0 && !result.validationIssues?.length ? coverage?.blocked?.year ?? (result.status !== 'complete' ? result.requestedStartYear : null) : null
  const uncomputed = coverage?.uncomputedYears ?? (blockedYear !== null ? Array.from({ length: Math.max(0, result.requestedYears - 1) }, (_, i) => result.requestedStartYear + i + 1) : [])
  return <section className="chart-card" data-testid="canonical-results">
    <h2>{t('canonical.title')}</h2>
    <Segmented className="segmented"><Button type="button" onClick={() => setDisplayMode('real')} aria-pressed={displayMode === 'real'}>{t('display_real')}</Button><Button type="button" onClick={() => setDisplayMode('nominal')} aria-pressed={displayMode === 'nominal'}>{t('display_nominal')}</Button></Segmented>
    <p role="status" data-testid="canonical-status">{t(`canonical.status.${result.status}`)}</p>
    {result.requestedYears > 0 ? <p>{t('canonical.horizon', { from: result.requestedStartYear, to: result.requestedStartYear + result.requestedYears - 1, count: coverage?.rows.length ?? 0 })}</p> : <p>{t('canonical.invalidHorizon')}</p>}
    <p>{t('canonical.limitations')}</p>
    {!!result.validationIssues?.length && <div role="alert" data-testid="canonical-validation-errors"><p>{t('canonical.invalidFields')}</p>
      <ul>{result.validationIssues.map((issue, index) => <li key={index}>{t(issue.key, issue.params)}</li>)}</ul></div>}
    {model && <Disclosure><summary>{t('canonical.coverage')}</summary><p>{annualSheetText(model.scope, i18n.language)}</p></Disclosure>}
    {blockedYear !== null && <p data-testid="canonical-blocked-year">{t('canonical.blockedYear', { year: blockedYear })}</p>}
    {!!uncomputed.length && <p data-testid="canonical-uncomputed">{t('canonical.uncomputed', { years: uncomputed.join(', ') })}</p>}
    {result.issues.length > 0 && <div role="alert"><p>{t(result.issues.some(i => i.detail === 'deterministic-spending-reconfirmation-required') ? 'canonical.reconfirm' : 'canonical.stopReason')}</p>
      <ul>{result.issues.filter(issue => issue.detail !== 'deterministic-spending-reconfirmation-required').map((issue, i) => <li key={i}>{annualSheetText(canonicalStopText(issue), i18n.language)}</li>)}</ul></div>}
    {coverage && coverage.rows.length > 0 && <>
      <p>{t('canonical.lastNetWorth', { year: coverage.rows.at(-1)!.year, amount: cad(sumNetWorth(coverage.state) * factor(coverage.rows.at(-1)!.year, true)) })}</p>
      {result.status === 'complete' && coverage.rows.at(-1)?.terminalEstateEstimate?.status === 'estimated' && (() => { const estate = coverage.rows.at(-1)!.terminalEstateEstimate!; return estate.status === 'estimated' ? <p data-testid="canonical-estate">{t('canonical.estate', { amount: cad(estate.netEstate * factor(coverage.rows.at(-1)!.year, true)), scope: t(estate.scope === 'self-estate-only' ? 'canonical.selfEstate' : 'canonical.wholeEstate') })}</p> : null })()}
      <p className="hint">{t('canonical.nominal')}</p>
      <div className="table-scroll"><table data-testid="canonical-coverage-table"><thead><tr>
        {['year', 'income', 'tax', 'payroll', 'living', 'unmet', 'mortgage', 'expensePaid', 'expenseUnmet', 'accounts', 'home', 'netWorth'].map(key => <th key={key} scope="col">{t(`canonical.columns.${key}`)}</th>)}
      </tr></thead><tbody>{coverage.rows.map(row => {
        const flow = (value: number) => cad(value * factor(row.year))
        const closing = (value: number) => cad(value * factor(row.year, true))
        const accounts = Object.values(row.byAccount).reduce((n, a) => n + a.closing, 0)
        const home = Object.values(row.byProperty).reduce((n, p) => n + (p.held ? p.closing : 0), 0)
        const debt = Object.values(row.byDebt).reduce((n, d) => n + d.closing, 0)
        const settlement = row.householdWithdrawalSettlement ?? row.retirementSettlement
        return <tr key={row.year}><th scope="row">{row.year}</th>
          <td>{flow(row.cashLedger.income + row.cashLedger.benefits)}</td><td>{flow(row.cashLedger.tax)}</td><td>{flow(row.payrollContributions ?? 0)}</td>
          <td>{flow(settlement?.spendingFunded ?? row.cashLedger.spending)}</td><td>{flow(settlement?.spendingUnmet ?? 0)}</td><td>{flow(row.cashLedger.debtPayments)}</td>
          <td>{flow(row.householdExpense?.paid ?? 0)}</td><td>{flow(row.householdExpense?.unmet ?? 0)}</td><td>{closing(accounts)}</td><td>{closing(home)}</td><td>{closing(accounts + home - debt + (row.retirementSettlement?.primaryHomeSaleCash?.closing ?? 0))}</td>
        </tr>
      })}</tbody></table></div>
    </>}
  </section>
}
