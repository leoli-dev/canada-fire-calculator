import { useTranslation } from 'react-i18next'
import { selectBenefitRules, selectGisRules } from '../engine/rules'
import { PLAN_BENEFIT_PERIOD, benefitRuleProvenance, trySelectBenefitRules } from '../engine/benefits'
import { PLAN_TAX_YEAR, taxRuleProvenance, trySelectPlanTaxRules } from '../engine/tax'
import type { Province } from '../engine/types'

/**
 * Shared disclosure: both entry modes read the same pinned pack selection and
 * are given the same plan anchor year, so a mode switch cannot change the rule
 * pack, the rule year or the future-indexation policy. BE-38 B1: the tax pack
 * is no longer display-only — the projection computes its bracket ladder and
 * basic personal amount from it — so the panel now states which year priced the
 * numbers, whether that year was published or assumed, and every participating
 * figure the pack does not year-switch.
 *
 * The year shown is the engine's own anchor (`PLAN_TAX_YEAR`), never a prop:
 * the panel must report the pack that actually priced the numbers, so a caller
 * cannot make it display a year the computation did not use.
 */
export function RuleAssumptions({ province, inflation }: { province: Province; inflation: number }) {
  const { t } = useTranslation()
  const ccb = selectBenefitRules('CCB', PLAN_BENEFIT_PERIOD)
  // BE-26 A: the GIS/Allowance pack is a quarterly published table, so its id
  // and payment period are disclosed next to the tax and CCB ones, together
  // with the tables its fitted reduction is measured against and the paths it
  // knowingly does not price. Those paths used to live only in the pack's own
  // `limitation` string, which nothing rendered.
  const gis = selectGisRules()
  const selection = trySelectPlanTaxRules({ jurisdiction: province, taxYear: PLAN_TAX_YEAR })
  if (selection.status !== 'ok') {
    // An unknown jurisdiction or an unpublished year refuses; it is never
    // priced from another jurisdiction's table or shown as a number.
    return <div className="rule-assumptions" data-testid="rule-assumptions">
      <strong>{t('ruleAssumptionsTitle')}</strong>
      <p data-testid="rule-assumptions-refusal">{t('ruleAssumptionsRefused', { reason: selection.reason })}</p>
    </div>
  }
  const tax = selection.context.pack
  const provenance = taxRuleProvenance(selection.context)
  const policy = provenance.projectionPolicy
  // BE-38 B2: the CCB pack is no longer display-only either — `ccbAnnual`
  // computes from it — so the panel states which payment period priced the CCB,
  // whether that period was published or assumed, and the gap it refuses. The
  // period shown is the engine's own anchor, never a prop: the panel must report
  // the pack that actually priced the numbers.
  const ccbSelection = trySelectBenefitRules({ program: 'CCB', paymentPeriod: PLAN_BENEFIT_PERIOD })
  const ccbProvenance = ccbSelection.status === 'ok' ? benefitRuleProvenance(ccbSelection.context) : null
  const ccbPolicy = ccbProvenance?.projectionPolicy
  return <div className="rule-assumptions" data-testid="rule-assumptions">
    <strong>{t('ruleAssumptionsTitle')}</strong>
    <p>{t('ruleAssumptionsVersion', { tax: tax.id, ccb: `${ccb.id} (${ccb.paymentPeriod})`, gis: `${gis.id} (${gis.paymentPeriod})` })}</p>
    <p data-testid="rule-tax-pack" data-rule-pack-id={tax.id} data-rule-year={provenance.ruleYear}
      data-rule-assumed={String(provenance.assumedFutureRule)}>
      {t('ruleAssumptionsTaxPolicy', {
        year: provenance.ruleYear,
        policy: policy.kind === 'published'
          ? t('ruleAssumptionsTaxPolicyPublished')
          : t('ruleAssumptionsTaxPolicyAssumed', {
              rate: (policy.annualRate * 100).toFixed(1), from: policy.fromTaxYear,
            }),
      })}
    </p>
    {ccbProvenance
      ? <p data-testid="rule-ccb-pack" data-rule-pack-id={ccbProvenance.rulePackId}
          data-rule-period={ccbProvenance.paymentPeriod} data-rule-assumed={String(ccbProvenance.assumedFutureRule)}>
          {t('ruleAssumptionsCcbPolicy', {
            period: ccbProvenance.paymentPeriod,
            policy: ccbPolicy && ccbPolicy.kind === 'published'
              ? t('ruleAssumptionsCcbPolicyPublished')
              : t('ruleAssumptionsCcbPolicyAssumed', {
                  rate: ((ccbPolicy?.annualRate ?? 0) * 100).toFixed(1),
                  from: ccbPolicy?.kind === 'assumed' ? ccbPolicy.fromPaymentPeriod : '',
                }),
          })}
        </p>
      : <p data-testid="rule-ccb-refusal">
          {t('ruleAssumptionsBenefitRefused', { reason: ccbSelection.status === 'unsupported' ? ccbSelection.reason : '' })}
        </p>}
    <p>{t('ruleAssumptionsPolicy', { rate: (inflation * 100).toFixed(1) })}</p>
    <p data-testid="rule-ccb-not-modelled">
      {t('ruleAssumptionsCcbNotModelled')}{' '}
      {ccb.unsupportedPaths.map((path, index) => <span key={path.id}>
        {index > 0 ? '; ' : ''}{t(`ccbUnsupported.${path.id}`)}{' '}
      </span>)}
    </p>
    <p data-testid="rule-tax-not-modelled">
      {t('ruleAssumptionsTaxNotModelled')}{' '}
      {tax.unsupportedPaths.map((path, index) => <span key={path.id}>
        {index > 0 ? '; ' : ''}{t(`taxUnsupported.${path.id}`)}{' '}
      </span>)}
    </p>
    <p>{t('ruleAssumptionsLimit')}</p>
    <div className="rule-sources">
      {([
        ['ruleFederalBracketsSource', tax.fieldSources.federalBrackets],
        ['ruleFederalBpaSource', tax.fieldSources.federalBpa],
        ['ruleProvincialBracketsSource', tax.fieldSources.provincialBrackets],
        ['ruleProvincialBpaSource', tax.fieldSources.provincialBpa],
        ['ruleCcbAmountsSource', ccb.fieldSources.amounts],
        ['ruleCcbThresholdsSource', ccb.fieldSources.thresholds],
        ['ruleCcbRatesSource', ccb.fieldSources.rates],
        ['ruleGisQuarterSource', gis.sourceURL],
        ['ruleGisTablesSource', gis.categories.single.fieldSources.reductionSegments],
        ['ruleGisAllowanceSource', gis.allowance.fieldSources.maxMonthly],
      ] as const).map(([label, url]) => <span key={label}>
        <a href={url} target="_blank" rel="noreferrer">{t(label)}</a>{' · '}
      </span>)}
      {tax.fieldAdditionalSources?.provincialBrackets?.map(url => <span key={url}>
        <a href={url} target="_blank" rel="noreferrer">{t('rulePeUpdatedBracketSource')}</a>{' · '}
      </span>)}
      {tax.additionalSourceURLs?.map(url => <span key={url}><a href={url} target="_blank" rel="noreferrer">{t('ruleConflictingSource')}</a>{' · '}</span>)}
    </div>
    {tax.sourceConflict && <p>{t(province === 'PE' ? 'rulePeConflict' : 'ruleMbConflict')}</p>}
    <p data-testid="rule-gis-not-modelled">
      {t('ruleGisNotModelled')}{' '}
      {gis.unsupportedPaths.map((path, index) => <span key={path.id}>
        {index > 0 ? '; ' : ''}{t(`gisUnsupported.${path.id}`)}{' '}
      </span>)}
    </p>
  </div>
}
