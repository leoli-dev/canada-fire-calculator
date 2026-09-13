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
    <div className="rule-sources">
      {([
        ['ruleFederalBracketsSource', tax.fieldSources.federalBrackets],
        ['ruleFederalBpaSource', tax.fieldSources.federalBpa],
        ['ruleProvincialBracketsSource', tax.fieldSources.provincialBrackets],
        ['ruleProvincialBpaSource', tax.fieldSources.provincialBpa],
        ['ruleCcbAmountsSource', ccb.fieldSources.amounts],
        ['ruleCcbThresholdsSource', ccb.fieldSources.thresholds],
      ] as const).map(([label, url]) => <span key={label}>
        <a href={url} target="_blank" rel="noreferrer">{t(label)}</a>{' · '}
      </span>)}
      {tax.additionalSourceURLs?.map(url => <span key={url}><a href={url} target="_blank" rel="noreferrer">{t('ruleConflictingSource')}</a>{' · '}</span>)}
    </div>
    {tax.sourceConflict && <p>{t(province === 'PE' ? 'rulePeConflict' : 'ruleMbConflict')}</p>}
  </div>
}
