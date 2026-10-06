import { useTranslation } from 'react-i18next'
import type { InputsV2, Known, Person } from '../../engine/model'
import { previewRrspRoomYear } from '../../engine/rrspRoom'
import { previewTfsaRoomYear } from '../../engine/tfsaRoom'
import { activeFhsaAccounts, ownFhsaAccount, previewFhsaRoomYear } from '../../engine/fhsa'
import { commitCanonicalEdit } from '../../forms/canonicalEdit'
import { fhsaHoldings, pensionSplitRecorded } from '../../guided/taxDetails'
import { useStore } from '../../store'
import { useCad } from '../../format'
import { NumberInput } from '../NumberInput'
import { FhsaRoomRow, PensionSplitFields, RrspRoomRow, SpousalHistoryRows, TfsaRoomRow, usePersonLabel } from '../TaxFactsPanel'
import { CardChoices } from './CardChoices'

/** The first page of the optional category: add the details, or skip to the review. */
export function TaxDetailsIntro() {
  const { t } = useTranslation()
  const answer = useStore(state => state.questionAnswers['tax.intro'])
  const setQuestionAnswer = useStore(state => state.setQuestionAnswer)
  return <div data-testid="guided-tax-intro">
    <p className="question-intro">{t('questionnaire.taxDetails.intro')}</p>
    <CardChoices name="tax.intro" testId="guided-tax-intro-choice" value={typeof answer === 'string' ? answer : undefined}
      options={[
        { value: 'add', label: t('questionnaire.taxDetails.add'), detail: t('questionnaire.taxDetails.addDetail') },
        { value: 'skip', label: t('questionnaire.taxDetails.skip'), detail: t('questionnaire.taxDetails.skipDetail') },
      ]}
      onChange={value => setQuestionAnswer('tax.intro', value)} />
  </div>
}

/** One sentence about this year's plan against the room just entered. */
function RoomFeedback({ room, planned, retained, couple, testId }: { room: Known<number>; planned: number; retained: number; couple: boolean; testId: string }) {
  const { t } = useTranslation()
  const cad = useCad()
  if (room.status !== 'known') return null
  // A couple's household savings split is not divided between the two people
  // yet, so an empty personal plan is not evidence that nothing goes in.
  const key = planned <= 0 ? (couple ? 'notAttributed' : 'noPlan') : retained > 0 ? 'overRoom' : 'withinRoom'
  return <p className={retained > 0 ? 'field-issue warning' : 'hint'} role="status" data-testid={testId}>
    {t(`questionnaire.taxDetails.${key}`, { planned: cad(planned), retained: cad(retained) })}
  </p>
}

/** One person's main room figure, in the shared text number input. */
function RoomNumber({ id, testId, label, value, onChange }: { id: string; testId: string; label: string; value: Known<number>; onChange: (value: number | null) => void }) {
  const { t } = useTranslation()
  return <div className="question-answer">
    <label htmlFor={id}>{label}</label>
    <NumberInput id={id} testId={testId} className="question-number" value={value.status === 'known' ? value.value : null}
      placeholder={t('be12.unknown')}
      onChange={next => {
        if (next !== null && next < 0) return
        const current = value.status === 'known' ? value.value : null
        if (next !== current) onChange(next)
      }} />
  </div>
}

/** The advanced statement detail, open by default once any of it is recorded. */
function MoreDetail({ testId, summary, open, children }: { testId: string; summary: string; open: boolean; children: React.ReactNode }) {
  return <details className="guided-advanced" open={open || undefined}>
    <summary data-testid={testId}>{summary}</summary>
    {children}
  </details>
}

const setPersonFact = (personId: string, field: 'tfsaAvailableRoom' | 'rrspAvailableRoom', reason: string) => (value: number | null) =>
  commitCanonicalEdit(draft => {
    draft.people.find(item => item.id === personId)![field] = value === null ? { status: 'unknown', reason } : { status: 'known', value }
  })

function PersonHead({ person }: { person: Person }) {
  const label = usePersonLabel()
  return <div className="ownership-row-head"><strong>{label(person)}</strong></div>
}

/** TFSA: the CRA room figure; withdrawals and the ledger are advanced detail. */
export function TfsaRoomQuestion({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  return <div className="ownership-checklist" data-testid="guided-tfsa-room">
    {plan.people.map(person => {
      const { ledger } = previewTfsaRoomYear(plan, person)
      const withdrawals = plan.tfsaStatement?.[person.id]?.withdrawals.length ?? 0
      return <div className="ownership-row" key={person.id}>
        <PersonHead person={person} />
        <RoomNumber id={`tfsa-room-${person.role}`} testId={`tfsa-available-room-${person.role}`} label={t('questionnaire.taxDetails.tfsaRoom')}
          value={person.tfsaAvailableRoom} onChange={setPersonFact(person.id, 'tfsaAvailableRoom', 'CRA TFSA room statement not supplied')} />
        <RoomFeedback room={person.tfsaAvailableRoom} planned={ledger.planned} retained={ledger.retained} couple={plan.people.length > 1} testId={`guided-tfsa-feedback-${person.role}`} />
        <MoreDetail testId={`guided-tfsa-more-${person.role}`} summary={t('questionnaire.taxDetails.tfsaMore')} open={withdrawals > 0}>
          <TfsaRoomRow person={person} plan={plan} onEdit={commitCanonicalEdit} guided />
        </MoreDetail>
      </div>
    })}
    <details className="guided-advanced" data-testid="guided-tfsa-how"><summary>{t('questionnaire.taxDetails.howCounted')}</summary>
      <p className="hint">{t('be27.limit')}</p>
      <p className="hint">{t('be27.scope')}</p>
    </details>
    <p className="hint"><a href="https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/contributions.html"
      target="_blank" rel="noopener noreferrer">{t('be27.source')}</a></p>
  </div>
}

/** RRSP: one number from the notice of assessment; the other statement lines are advanced detail. */
export function RrspRoomQuestion({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  return <div className="ownership-checklist" data-testid="guided-rrsp-room">
    {plan.people.map(person => {
      const { ledger } = previewRrspRoomYear(plan, person)
      const advanced = (['rrspDeductionLimit', 'rrspUnusedUndeducted', 'rrspPensionAdjustment', 'rrspPspa', 'rrspPar'] as const)
        .some(field => person[field].status === 'known') ||
        plan.contributions.some(contribution => contribution.contributorId === person.id && contribution.calendarYear === plan.baseYear)
      return <div className="ownership-row" key={person.id}>
        <PersonHead person={person} />
        <RoomNumber id={`rrsp-room-${person.role}`} testId={`rrsp-available-room-${person.role}`} label={t('questionnaire.taxDetails.rrspRoom')}
          value={person.rrspAvailableRoom} onChange={setPersonFact(person.id, 'rrspAvailableRoom', 'CRA statement line not supplied')} />
        <RoomFeedback room={person.rrspAvailableRoom} planned={ledger.planned} retained={ledger.retained} couple={plan.people.length > 1} testId={`guided-rrsp-feedback-${person.role}`} />
        <MoreDetail testId={`guided-rrsp-more-${person.role}`} summary={t('questionnaire.taxDetails.rrspMore')} open={advanced}>
          <RrspRoomRow person={person} plan={plan} onEdit={commitCanonicalEdit} guided />
        </MoreDetail>
      </div>
    })}
    <details className="guided-advanced" data-testid="guided-rrsp-how"><summary>{t('questionnaire.taxDetails.howCounted')}</summary>
      <p className="hint">{t('be12.limit')}</p>
    </details>
    <p className="hint"><a href="https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4040/rrsps-other-registered-plans-retirement.html"
      target="_blank" rel="noopener noreferrer">{t('be12.source')}</a></p>
  </div>
}

/** FHSA: the participation room of each holder; the history and plan are advanced detail. */
export function FhsaRoomQuestion({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  const holdings = fhsaHoldings(plan)
  return <div className="ownership-checklist" data-testid="guided-fhsa-room">
    {holdings.length === 0 && <p className="hint" role="status" data-testid="guided-fhsa-no-holder">{t('questionnaire.taxDetails.fhsaNoHolder')}</p>}
    {plan.people.some(person => ownFhsaAccount(plan, person.id).ambiguous) && <p className="field-issue warning" role="status" data-testid="fhsa-ambiguous">
      {t('be36.ambiguousAccount')}</p>}
    {activeFhsaAccounts(plan, plan.baseYear, id => plan.accounts.find(item => item.id === id)?.balance ?? 0).length > 1 &&
      <p className="field-issue warning" role="status" data-testid="fhsa-multiple-active">{t('be36.multipleActive')}</p>}
    {holdings.map(({ personId, account }) => {
      const person = plan.people.find(item => item.id === personId)!
      const { ledger } = previewFhsaRoomYear(plan, account)
      const advanced = account.openedYear.status === 'known' || plan.fhsaStatementHistory?.[account.id] !== undefined
      return <div className="ownership-row" key={account.id}>
        <PersonHead person={person} />
        <RoomNumber id={`fhsa-room-${person.role}`} testId={`fhsa-opening-room-${person.role}`} label={t('questionnaire.taxDetails.fhsaRoom')}
          value={account.contributionRoom}
          onChange={value => commitCanonicalEdit(draft => {
            const item = draft.accounts.find(candidate => candidate.id === account.id)!
            item.contributionRoom = value === null ? { status: 'unknown', reason: 'participation-room statement not supplied' } : { status: 'known', value }
          })} />
        <RoomFeedback room={account.contributionRoom} planned={ledger.planned} retained={ledger.retained} couple={plan.people.length > 1} testId={`guided-fhsa-feedback-${person.role}`} />
        <MoreDetail testId={`guided-fhsa-more-${person.role}`} summary={t('questionnaire.taxDetails.fhsaMore')} open={advanced}>
          <FhsaRoomRow person={person} plan={plan} account={account} onEdit={commitCanonicalEdit} guided />
        </MoreDetail>
      </div>
    })}
    <details className="guided-advanced" data-testid="guided-fhsa-how"><summary>{t('questionnaire.taxDetails.howCounted')}</summary>
      <p className="hint">{t('be36.limit')}</p>
      <p className="hint">{t('be36.scope')}</p>
    </details>
    <p className="hint"><a href="https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/first-home-savings-account/contributing-your-fhsa.html"
      target="_blank" rel="noopener noreferrer">{t('be36.source')}</a></p>
  </div>
}

/** Pension splitting: no, or the federal (and Quebec) election details. */
export function PensionSplitQuestion({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  const answer = useStore(state => state.questionAnswers['tax.pensionSplit'])
  const setQuestionAnswer = useStore(state => state.setQuestionAnswer)
  const value = pensionSplitRecorded(plan) ? 'yes' : answer === 'no' || answer === 'yes' ? answer : undefined
  return <div data-testid="guided-pension-split">
    <CardChoices name="tax.pensionSplit" testId="guided-pension-split-choice" value={value}
      options={[
        { value: 'no', label: t('questionnaire.taxDetails.splitNo') },
        { value: 'yes', label: t('questionnaire.taxDetails.splitYes'), detail: t('questionnaire.taxDetails.splitYesDetail') },
      ]}
      onChange={next => {
        setQuestionAnswer('tax.pensionSplit', next)
        if (next === 'no') commitCanonicalEdit(draft => { if (draft.taxProfile) { draft.taxProfile.pensionSplit = null; draft.taxProfile.qcPensionSplit = null } })
      }} />
    {value === 'yes' && <div className="guided-advanced-body"><PensionSplitFields plan={plan} /></div>}
  </div>
}

/** Spousal plans: whether the premium history is complete, and its rows. */
export function SpousalHistoryQuestion({ plan }: { plan: InputsV2 }) {
  return <div className="guided-advanced-body" data-testid="guided-spousal-history"><SpousalHistoryRows plan={plan} /></div>
}

/**
 * A soft hint on the savings-split page: this year's split sends more to an
 * account than the room recorded for that person. Room is optional, so nothing
 * shows until a figure is entered, and the hint never blocks the page.
 */
export function SavingsRoomHint({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  const cad = useCad()
  const label = usePersonLabel()
  const over = plan.people.flatMap(person => {
    const rows: { account: 'tfsa' | 'rrsp'; planned: number; room: number }[] = []
    if (person.tfsaAvailableRoom.status === 'known') {
      const { ledger } = previewTfsaRoomYear(plan, person)
      if (ledger.retained > 0) rows.push({ account: 'tfsa', planned: ledger.planned, room: ledger.applied })
    }
    if (person.rrspAvailableRoom.status === 'known') {
      const { ledger } = previewRrspRoomYear(plan, person)
      if (ledger.retained > 0) rows.push({ account: 'rrsp', planned: ledger.planned, room: ledger.applied })
    }
    return rows.map(row => ({ ...row, person }))
  })
  if (over.length === 0) return null
  return <div className="allocation-room-hint" role="status" data-testid="guided-allocation-room-hint">
    {over.map(row => <p className="field-issue warning" key={`${row.person.id}:${row.account}`}>
      {t('questionnaire.taxDetails.allocationOver', { account: t(row.account), person: label(row.person), planned: cad(row.planned), room: cad(row.room) })}
    </p>)}
  </div>
}
