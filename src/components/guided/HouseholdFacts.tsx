import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account, InputsV2, Property } from '../../engine/model'
import { applyAccountSplit } from '../../engine/migration'
import { commitCanonicalEdit } from '../../forms/canonicalEdit'
import { qcCoverageComplete } from '../../guided/householdFacts'
import { useStore } from '../../store'
import { useCad } from '../../format'
import { QcDrugCoverageEditor, SplitAmounts, ShareInput, accountNameKey, ownershipAccountRows, setLivesAlone, setSpouseSupport } from '../TaxFactsPanel'
import { CardChoices } from './CardChoices'

type OwnerChoice = 'self' | 'partner' | 'split'

/** One row of three choices, rendered like every other guided choice card. */
function OwnerChoices({ name, value, splitLabel, allowSplit, onChange }: {
  name: string
  value: OwnerChoice | undefined
  splitLabel: string
  allowSplit: boolean
  onChange: (choice: OwnerChoice) => void
}) {
  const { t } = useTranslation()
  const options: { value: OwnerChoice; label: string }[] = [
    { value: 'self', label: t('questionnaire.ownership.mine') },
    { value: 'partner', label: t('questionnaire.ownership.partners') },
    ...(allowSplit ? [{ value: 'split' as const, label: splitLabel }] : []),
  ]
  return <div className="owner-choices" role="radiogroup" data-testid={`owner-choice-${name}`}>
    {options.map(option => <label key={option.value} className={value === option.value ? 'selected' : ''}>
      <input type="radio" name={`owner-${name}`} value={option.value} checked={value === option.value}
        data-testid={`owner-choice-${name}-${option.value}`} onChange={() => onChange(option.value)} />
      <span>{option.label}</span>
    </label>)}
  </div>
}

/** The recorded owner of one account row, read the same way the professional editor reads it. */
function recordedAccountChoice(plan: InputsV2, base: Account | undefined, derived: Account | undefined): OwnerChoice | undefined {
  const self = plan.people.find(person => person.role === 'self')!
  const partner = plan.people.find(person => person.role === 'partner')!
  const account = base ?? derived!
  if (account.kind === 'nonReg') {
    if (account.taxableOwnerShares.status !== 'known') return undefined
    const selfShare = account.taxableOwnerShares.shares[self.id] ?? 0
    return selfShare >= 1 ? 'self' : selfShare <= 0 ? 'partner' : 'split'
  }
  const rows = [base, derived].filter((item): item is Account => !!item)
  if (rows.some(item => !item.ownerId || item.taxableOwnerShares.status !== 'known')) return undefined
  const owners = new Set(rows.map(item => item.ownerId))
  if (owners.size > 1) return 'split'
  return owners.has(self.id) ? 'self' : owners.has(partner.id) ? 'partner' : undefined
}

/**
 * Guided ownership checklist: one row per account, three choices each. Only a
 * row marked as held by both people asks for amounts (registered accounts) or
 * a share (non-registered). Every write goes through the same canonical
 * transaction as the professional editor.
 */
export function AccountOwnershipChecklist({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  const cad = useCad()
  const [pending, setPending] = useState<Record<string, OwnerChoice>>({})
  const self = plan.people.find(person => person.role === 'self')
  const partner = plan.people.find(person => person.role === 'partner')
  if (!self || !partner) return null
  return <div className="ownership-checklist">{ownershipAccountRows(plan).map(({ baseId, base, derived }) => {
    const account = base ?? derived!
    const total = (base?.balance ?? 0) + (derived?.balance ?? 0)
    const registered = account.kind !== 'nonReg'
    const recorded = recordedAccountChoice(plan, base, derived)
    const choice = pending[baseId] ?? recorded
    const entry = plan.ownershipAmounts?.[baseId]
    const selfAmount = registered ? entry?.[self.id] ?? (recorded === 'self' ? total : recorded === 'partner' ? 0 : undefined) : undefined
    const partnerAmount = registered ? entry?.[partner.id] ?? (recorded === 'partner' ? total : recorded === 'self' ? 0 : undefined) : undefined
    const choose = (next: OwnerChoice) => {
      if (next === 'split') { setPending(previous => ({ ...previous, [baseId]: 'split' })); return }
      setPending(previous => { const { [baseId]: _dropped, ...rest } = previous; return rest })
      const ownerId = next === 'self' ? self.id : partner.id
      commitCanonicalEdit(draft => {
        if (registered) {
          applyAccountSplit(draft, baseId, next === 'self' ? total : 0, next === 'partner' ? total : 0, { zeroOwnerId: ownerId })
          return
        }
        const item = draft.accounts.find(candidate => candidate.id === baseId)!
        item.ownerId = ownerId
        item.taxableOwnerShares = { status: 'known', shares: { [ownerId]: 1 } }
      })
    }
    return <div className="ownership-row" key={`${baseId}:${total}:${JSON.stringify(account.taxableOwnerShares)}:${base?.ownerId ?? ''}:${derived?.ownerId ?? ''}`}
      data-testid={`guided-ownership-row-${baseId}`}>
      <div className="ownership-row-head">
        <strong>{t(`questionnaire.accountNames.${accountNameKey(account.kind)}`)}</strong>
        <span>{cad(total)}</span>
      </div>
      <OwnerChoices name={baseId} value={choice} allowSplit={!registered || total > 0}
        splitLabel={t(registered ? 'questionnaire.ownership.eachHasOne' : 'questionnaire.ownership.joint')} onChange={choose} />
      {total === 0 && <p className="hint">{t('questionnaire.ownership.zeroBalance')}</p>}
      {choice === 'split' && registered && <div className="ownership-split">
        <SplitAmounts rowId={baseId} total={total} selfAmount={selfAmount} partnerAmount={partnerAmount}
          selfTestId={`account-self-amount-${baseId}`} partnerTestId={`account-partner-amount-${baseId}`}
          onCommit={(selfAmt, partnerAmt) => {
            setPending(previous => { const { [baseId]: _dropped, ...rest } = previous; return rest })
            commitCanonicalEdit(draft => applyAccountSplit(draft, baseId, selfAmt, partnerAmt))
          }} />
      </div>}
      {choice === 'split' && !registered && <ShareInput testId={`account-self-share-${baseId}`} shares={account.taxableOwnerShares} selfId={self.id}
        onShare={pct => commitCanonicalEdit(draft => {
          const item = draft.accounts.find(candidate => candidate.id === baseId)!
          item.taxableOwnerShares = { status: 'known', shares: { [self.id]: pct / 100, [partner.id]: 1 - pct / 100 } }
          item.ownerId = pct === 100 ? self.id : pct === 0 ? partner.id : null
        })} />}
    </div>
  })}</div>
}

function recordedPropertyChoice(plan: InputsV2, property: Property): OwnerChoice | undefined {
  if (property.taxableOwnerShares.status !== 'known') return undefined
  const self = plan.people.find(person => person.role === 'self')!
  const selfShare = property.taxableOwnerShares.shares[self.id] ?? 0
  return selfShare >= 1 ? 'self' : selfShare <= 0 ? 'partner' : 'split'
}

/** Guided property checklist: the home and every rental, three choices each. */
export function PropertyOwnershipChecklist({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  const cad = useCad()
  const [pending, setPending] = useState<Record<string, OwnerChoice>>({})
  const self = plan.people.find(person => person.role === 'self')
  const partner = plan.people.find(person => person.role === 'partner')
  if (!self || !partner) return null
  return <div className="ownership-checklist">{plan.properties.map((property, index) => {
    const recorded = recordedPropertyChoice(plan, property)
    const choice = pending[property.id] ?? recorded
    const choose = (next: OwnerChoice) => {
      if (next === 'split') { setPending(previous => ({ ...previous, [property.id]: 'split' })); return }
      setPending(previous => { const { [property.id]: _dropped, ...rest } = previous; return rest })
      const ownerId = next === 'self' ? self.id : partner.id
      commitCanonicalEdit(draft => {
        draft.properties.find(item => item.id === property.id)!.taxableOwnerShares = { status: 'known', shares: { [ownerId]: 1 } }
      })
    }
    const rentalNumber = plan.properties.slice(0, index + 1).filter(item => item.kind === 'investment').length
    return <div className="ownership-row" key={`${property.id}:${JSON.stringify(property.taxableOwnerShares)}`}
      data-testid={`guided-ownership-row-${property.id}`}>
      <div className="ownership-row-head">
        <strong>{property.kind === 'principal' ? t('questionnaire.ownership.home') : t('questionnaire.ownership.rental', { n: rentalNumber })}</strong>
        <span>{cad(property.value)}</span>
      </div>
      <OwnerChoices name={property.id} value={choice} allowSplit splitLabel={t('questionnaire.ownership.joint')} onChange={choose} />
      {choice === 'split' && <ShareInput testId={`property-self-share-${property.id}`} shares={property.taxableOwnerShares} selfId={self.id}
        onShare={pct => commitCanonicalEdit(draft => { draft.properties.find(item => item.id === property.id)!.taxableOwnerShares = {
          status: 'known', shares: { [self.id]: pct / 100, [partner.id]: 1 - pct / 100 },
        } })} />}
    </div>
  })}</div>
}

/** Guided spouse-support question: yes, no, or not sure yet. */
export function SpouseSupportQuestion({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  const answer = useStore(state => state.questionAnswers['family.spouseSupport'])
  const setQuestionAnswer = useStore(state => state.setQuestionAnswer)
  const recorded = plan.taxProfile?.spouseSupported
  const value = recorded?.status === 'known' ? (recorded.value ? 'yes' : 'no') : answer === 'unknown' ? 'unknown' : undefined
  const options = [
    { value: 'yes', label: t('questionnaire.choice.yes'), detail: t('questionnaire.spouseSupport.yesDetail') },
    { value: 'no', label: t('questionnaire.choice.no'), detail: t('questionnaire.spouseSupport.noDetail') },
    { value: 'unknown', label: t('questionnaire.choice.unknown') },
  ]
  return <div className="choice-group" role="radiogroup" data-testid="guided-spouse-support">
    {options.map(option => <label key={option.value} className={value === option.value ? 'selected' : ''}>
      <input type="radio" name="family.spouseSupport" value={option.value} checked={value === option.value}
        onChange={() => {
          setQuestionAnswer('family.spouseSupport', option.value)
          commitCanonicalEdit(draft => setSpouseSupport(draft, option.value === 'unknown' ? null : option.value === 'yes'))
        }} />
      <span><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span>
    </label>)}
  </div>
}

/** BE-44: guided living-alone question for a one-person Québec plan. */
export function LivesAloneQuestion({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  const answer = useStore(state => state.questionAnswers['family.livesAlone'])
  const setQuestionAnswer = useStore(state => state.setQuestionAnswer)
  const fact = plan.taxProfile?.livesAlone
  const value = fact?.status === 'known' ? (fact.value ? 'yes' : 'no') : answer === 'unknown' ? 'unknown' : undefined
  return <div data-testid="guided-lives-alone">
    <p className="question-intro">{t('be44.intro')}</p>
    <CardChoices name="family.livesAlone" testId="guided-lives-alone-choice" value={value} options={[
      { value: 'yes', label: t('questionnaire.choice.yes'), detail: t('be44.yesDetail') },
      { value: 'no', label: t('questionnaire.choice.no'), detail: t('be44.noDetail') },
      { value: 'unknown', label: t('questionnaire.choice.unknown') },
    ]} onChange={next => {
      setQuestionAnswer('family.livesAlone', next)
      commitCanonicalEdit(draft => setLivesAlone(draft, next === 'unknown' ? null : next === 'yes'))
    }} />
  </div>
}

/** Guided Quebec drug-coverage page: the shared editor plus an explicit "not sure". */
export function QcDrugCoverageQuestion({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  const answer = useStore(state => state.questionAnswers['family.qcDrug'])
  const setQuestionAnswer = useStore(state => state.setQuestionAnswer)
  return <div data-testid="guided-qc-drug">
    <p className="question-intro">{t('questionnaire.qcDrug.intro')}</p>
    <QcDrugCoverageEditor plan={plan} variant="cards" />
    {!qcCoverageComplete(plan) && <button type="button" className="text-action" aria-pressed={answer === 'unknown'}
      onClick={() => setQuestionAnswer('family.qcDrug', 'unknown')}>{t('guidedUnknown')}</button>}
    <p className="hint">{t('be35.publicLimit')}</p>
  </div>
}
