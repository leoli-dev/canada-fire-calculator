import { useTranslation } from 'react-i18next'
import type { Account, InputsV2 } from '../../engine/model'
import { derivedAccountId } from '../../engine/migration'
import { commitCanonicalEdit, commitRegisteredRowEdit } from '../../forms/canonicalEdit'
import { REGISTERED_TYPE_KINDS, registeredTypeAccounts, type RegisteredTypeKind } from '../../guided/accountFacts'
import { useStore } from '../../store'
import { useCad } from '../../format'
import { NumberInput } from '../NumberInput'
import { accountNameKey, usePersonLabel } from '../TaxFactsPanel'
import { CardChoices } from './CardChoices'

const LOCKED_ACCOUNT_ID = 'legacy:account:locked'

/** The household total of one registered row: the base account plus its recorded partner half. */
function rowTotal(plan: InputsV2, account: Account): number {
  return plan.accounts.filter(item => item.id === account.id || item.id === derivedAccountId(account.id))
    .reduce((sum, item) => sum + item.balance, 0)
}

/** Guided employment income: one optional amount per person; blank stays unknown. */
export function EarnedIncomeQuestion({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  const label = usePersonLabel()
  const record = (personId: string, value: number | null) => commitCanonicalEdit(draft => {
    draft.people.find(item => item.id === personId)!.earnedIncome = value === null
      ? { status: 'unknown', reason: 'employment amount not supplied' } : { status: 'known', value }
  })
  return <div data-testid="guided-earned-income">
    <p className="question-intro">{t('questionnaire.earned.intro')}</p>
    <div className="question-pair">{plan.people.map(person => {
      const known = person.earnedIncome.status === 'known'
      return <div className="question-answer" key={person.id}>
        <label htmlFor={`earned-${person.role}`}>{t('questionnaire.earned.label', { person: label(person) })}</label>
        <NumberInput id={`earned-${person.role}`} testId={`earned-${person.role}`} className="question-number"
          value={person.earnedIncome.status === 'known' ? person.earnedIncome.value : null}
          onChange={value => {
            if (value !== null && value < 0) return
            const current = person.earnedIncome.status === 'known' ? person.earnedIncome.value : null
            if (value !== current) record(person.id, value)
          }} />
        <div className="answer-actions">
          <small>{t(known ? 'questionnaire.earned.recorded' : 'questionnaire.earned.optional')}</small>
          {known && <button type="button" onClick={() => record(person.id, null)}>{t('questionnaire.earned.clear')}</button>}
        </div>
      </div>
    })}</div>
  </div>
}

/**
 * Guided registered-account type. A plain RRSP is the default; an unconfirmed
 * default is shown unselected, like every other example answer, so choosing
 * it is a real answer.
 */
export function RegisteredTypeQuestion({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  const cad = useCad()
  const answered = useStore(state => state.questionAnswers['account.rrsp.type'] !== undefined)
  const setQuestionAnswer = useStore(state => state.setQuestionAnswer)
  const couple = plan.people.some(person => person.role === 'partner')
  return <div className="ownership-checklist" data-testid="guided-registered-type">
    {registeredTypeAccounts(plan).map(account => {
      const locked = account.id === LOCKED_ACCOUNT_ID
      const kinds = REGISTERED_TYPE_KINDS.filter(kind => kind === account.kind || kind === 'rrsp' || kind === 'rrif' ||
        kind === 'spousalRrsp' && couple || kind === 'lif' && locked)
      const confirmed = answered || account.kind !== 'rrsp'
      return <div className="ownership-row" key={account.id}>
        <div className="ownership-row-head">
          <strong>{t(`questionnaire.accountNames.${locked ? 'locked' : accountNameKey(account.kind)}`)}</strong>
          <span>{cad(rowTotal(plan, account))}</span>
        </div>
        <CardChoices<RegisteredTypeKind> name={`registered-type-${account.id}`} testId={`registered-type-${account.id}`}
          value={confirmed ? account.kind as RegisteredTypeKind : undefined}
          options={kinds.map(kind => ({ value: kind, label: t(`questionnaire.accountType.${kind}`), detail: t(`questionnaire.accountType.${kind}Detail`) }))}
          onChange={kind => {
            setQuestionAnswer('account.rrsp.type', 'confirmed')
            if (kind !== account.kind) commitRegisteredRowEdit(account.id, item => { item.kind = kind })
          }} />
      </div>
    })}
  </div>
}

/** Guided RRIF facts: the opening year, the verified factor category and, for a couple, the age election. */
export function RrifDetailsQuestion({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  const cad = useCad()
  const label = usePersonLabel()
  const couple = plan.people.some(person => person.role === 'partner')
  return <div className="ownership-checklist" data-testid="guided-rrif-details">
    {registeredTypeAccounts(plan).filter(account => account.kind === 'rrif').map(account => {
      const opened = account.openedYear.status === 'known' ? account.openedYear.value : null
      const category = account.rrifFactorCategory?.status === 'known' ? account.rrifFactorCategory.value : 'unknown'
      return <div className="ownership-row" key={account.id}>
        <div className="ownership-row-head">
          <strong>{t(`questionnaire.accountNames.${account.id === LOCKED_ACCOUNT_ID ? 'locked' : accountNameKey(account.kind)}`)}</strong>
          <span>{cad(rowTotal(plan, account))}</span>
        </div>
        <div className="question-answer">
          <label htmlFor={`rrif-opened-${account.id}`}>{t('questionnaire.rrif.openedYear')}</label>
          <NumberInput id={`rrif-opened-${account.id}`} testId={`guided-rrif-opened-${account.id}`} className="question-number"
            value={opened} grouping={false}
            onChange={year => {
              // Partial years while typing are ignored; blank clears the fact.
              if (year !== null && (!Number.isInteger(year) || year < 1950 || year > 2200)) return
              if (year === opened) return
              commitRegisteredRowEdit(account.id, item => { item.openedYear = year === null
                ? { status: 'unknown', reason: 'RRIF opening year not supplied' } : { status: 'known', value: year } })
            }} />
        </div>
        <p className="question-subhead">{t('questionnaire.rrif.category')}</p>
        <CardChoices name={`rrif-category-${account.id}`} testId={`guided-rrif-category-${account.id}`} value={category}
          options={[
            { value: 'qualifying', label: t('be11.rrifQualifying'), detail: t('questionnaire.rrif.qualifyingDetail') },
            { value: 'allOther', label: t('be11.rrifAllOther'), detail: t('questionnaire.rrif.allOtherDetail') },
            { value: 'unknown', label: t('questionnaire.rrif.notConfirmed') },
          ]}
          onChange={value => commitRegisteredRowEdit(account.id, item => { item.rrifFactorCategory = value === 'unknown'
            ? { status: 'unknown', reason: 'RRIF factor qualification not confirmed' } : { status: 'known', value } })} />
        <p className="hint">{t('be11.rrifFactorHelp')}{' '}
          <a href="https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/completing-slips-summaries/t4rsp-t4rif-information-returns/payments/chart-prescribed-factors.html"
            target="_blank" rel="noopener noreferrer">{t('be11.rrifFactorSource')}</a>
        </p>
        {couple && <>
          <p className="question-subhead">{t('questionnaire.rrif.election')}</p>
          <CardChoices name={`rrif-election-${account.id}`} testId={`guided-rrif-election-${account.id}`}
            value={account.rrifAgeElection?.personId ?? 'none'}
            options={[
              { value: 'none', label: t('be11.noElection') },
              ...plan.people.map(person => ({ value: person.id, label: t('questionnaire.rrif.electedAge', { person: label(person) }) })),
            ]}
            onChange={value => commitRegisteredRowEdit(account.id, item => {
              item.rrifAgeElection = value === 'none' ? null : { personId: value, electedAtOpening: true }
            })} />
        </>}
      </div>
    })}
  </div>
}
