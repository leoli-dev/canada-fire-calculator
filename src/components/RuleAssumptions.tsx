import { useTranslation } from 'react-i18next'
import { selectBenefitRules, selectTaxRules } from '../engine/rules'
import type { Province } from '../engine/types'

/** Shared disclosure: both entry modes read the same pinned pack selection. */
export function RuleAssumptions({ province, inflation }: { province: Province; inflation: number }) {
  const { t } = useTranslation()
  const tax = selectTaxRules(province, 2026)
  const ccb = selectBenefitRules('CCB', '2026-07/2027-06')
  return <div className="rule-assumptions" data-testid="rule-assumptions">
    <strong>{t('ruleAssumptionsTitle')}</strong>
    <p>{t('ruleAssumptionsVersion', { tax: tax.id, ccb: ccb.id })}</p>
    <p>{t('ruleAssumptionsPolicy', { rate: (inflation * 100).toFixed(1) })}</p>
    <p>{t('ruleAssumptionsLimit')}</p>
    <a href={tax.sourceURL} target="_blank" rel="noreferrer">{t('ruleTaxSource')}</a>{' · '}
    {tax.additionalSourceURLs?.map(url => <span key={url}><a href={url} target="_blank" rel="noreferrer">{new URL(url).hostname}</a>{' · '}</span>)}
    <a href={ccb.sourceURL} target="_blank" rel="noreferrer">{t('ruleCcbSource')}</a>
  </div>
}
