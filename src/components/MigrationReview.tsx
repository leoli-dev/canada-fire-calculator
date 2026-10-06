import { useTranslation } from 'react-i18next'
import type { InputsV2 } from '../engine/model'
import { migrationReview } from '../engine/migrationReview'
import { settleSingleHousehold } from '../engine/migration'
import { commitCanonicalEdit } from '../forms/canonicalEdit'
import { accountNameKey } from './TaxFactsPanel'

function PlanStatus({ label, plan }: { label: string; plan: InputsV2 | null }) {
  const { t } = useTranslation()
  const review = migrationReview(plan)
  if (!plan || !review) return <section data-testid={label === t('scenarioA') ? 'migration-scenario-a' : 'migration-current'}><h3>{label}</h3><p>{t('migrationStatusUnverified')}</p></section>
  return <section data-testid={label === t('scenarioA') ? 'migration-scenario-a' : 'migration-current'}>
    <h3>{label}</h3>
    <p>{t(review.ownershipPending ? 'migrationStatusUnassigned' : review.precisionAllowed ? 'migrationStatusReady' : 'migrationApproximate')}</p>
    {review.ownershipPending && <>
      <ul>
        {plan.accounts.map(account => <li key={account.id}>{t(`questionnaire.accountNames.${accountNameKey(account.kind)}`)}: {account.balance.toLocaleString()} CAD {account.ownerId === null || account.taxableOwnerShares.status === 'unknown' ? t('migrationUnassigned') : t(plan.people.find(person => person.id === account.ownerId)?.role === 'partner' ? 'migrationOwnerPartner' : 'migrationOwnerSelf')}{account.acb.status === 'known' ? `, ${t('migrationBasis')} ${account.acb.value.toLocaleString()} CAD` : ''}</li>)}
        {review.unassignedProperties.map(property => <li key={property.id}>{t('migrationProperty')}: {property.value.toLocaleString()} CAD {t('migrationUnassigned')}</li>)}
        {review.unassignedIncome.map(source => <li key={source.id}>{t(`migrationKinds.${source.kind}`)}: {source.annualAmount.status === 'known' ? source.annualAmount.value.toLocaleString() : ''} CAD {t('migrationUnassigned')}</li>)}
        {review.orphanedPeople.map(person => <li key={person.id}>{t('migrationOrphanedPerson')}: {t(`migrationKinds.${person.role === 'partner' ? 'partner' : 'self'}`)}</li>)}
      </ul>
      <p>{t('migrationNoAutomaticSplit')}</p>
      {/* FE-38: a plan that is single again can say so in one step. Only the
          current plan is editable here; Scenario A is a saved snapshot. */}
      {label === t('scenarioCurrent') && plan.people.length === 1 && <div className="migration-settle">
        <p>{t('migrationSettleSingleHelp')}</p>
        <button type="button" className="primary-action" data-testid="migration-settle-single"
          onClick={() => commitCanonicalEdit(draft => { Object.assign(draft, settleSingleHousehold(draft)) })}>{t('migrationSettleSingle')}</button>
      </div>}
    </>}
  </section>
}

export function MigrationReview({ current, scenarioA, scenarioAExists }: { current: InputsV2 | null; scenarioA: InputsV2 | null; scenarioAExists: boolean }) {
  const { t } = useTranslation()
  const currentReview = migrationReview(current)
  const scenarioReview = migrationReview(scenarioA)
  if ((currentReview === null || currentReview.precisionAllowed) && (!scenarioAExists || scenarioReview?.precisionAllowed)) return null
  return <div role="status" className="hint" data-testid="migration-gate">
    <strong>{t('migrationPrecisionWarning')}</strong>
    <p>{t(currentReview?.ownershipPending || scenarioReview?.ownershipPending ? 'migrationSharedPlan' : 'migrationSharedStatus')}</p>
    <PlanStatus label={t('scenarioCurrent')} plan={current} />
    {scenarioAExists && <PlanStatus label={t('scenarioA')} plan={scenarioA} />}
  </div>
}
