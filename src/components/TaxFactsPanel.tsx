import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account, InputsV2, Known, Person, QcDrugCoverage } from '../engine/model'
import { applyAccountSplit, applyPropertySplit, derivedAccountId, splitAmountsMatch } from '../engine/migration'
import { applyQcAnnualCoverage, qcCoverageAnnualStatus, qcCoverageUniform } from '../engine/quebecTax'
import { ownRrspAccount, previewRrspRoomYear } from '../engine/rrspRoom'
import { previewTfsaRoomYear, tfsaStatement, type TfsaWithdrawalLine } from '../engine/tfsaRoom'
import { activeFhsaAccounts, fhsaStatementHistory, ownFhsaAccount, previewFhsaRoomYear } from '../engine/fhsa'
import { fhsaPlanRowId, fhsaScheduledContributions, plannedFhsaYearTotal } from '../engine/fhsaPlan'
import { attributeSpousalPayment, resolveSpousalPlan } from '../engine/spousalAttribution'
import { commitCanonicalEdit, commitRegisteredRowEdit, useCanonicalPlan } from '../forms/canonicalEdit'
import { registeredTypeAccounts } from '../guided/accountFacts'
import { CommitNumberInput, NumberInput } from './NumberInput'
import { useCad } from '../format'

const SPLIT_ROW_BASE_IDS = ['legacy:account:tfsa', 'legacy:account:rrsp', 'legacy:account:nonReg', 'legacy:account:locked', 'legacy:account:fhsa'] as const
const roundCents = (value: number) => Math.round(value * 100) / 100

/** Two per-person amount inputs for one household total. Shows the live
 * arithmetic and commits only while the two amounts add up to the total; a
 * mismatch stays visible and never writes a partial split. */
export function SplitAmounts({ rowId, total, selfAmount, partnerAmount, selfTestId, partnerTestId, onCommit }: {
  rowId: string
  total: number
  selfAmount: number | undefined
  partnerAmount: number | undefined
  selfTestId: string
  partnerTestId: string
  onCommit: (selfAmount: number, partnerAmount: number) => void
}) {
  const { t, i18n } = useTranslation()
  const [selfValue, setSelfValue] = useState<number | null>(selfAmount === undefined ? null : roundCents(selfAmount))
  const [partnerValue, setPartnerValue] = useState<number | null>(partnerAmount === undefined ? null : roundCents(partnerAmount))
  // The pair as last typed. Focus leaving a field is reported before React
  // re-renders with the new state, so the check reads this ref.
  const latest = useRef({ self: selfValue, partner: partnerValue })
  const usable = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0
  const sum = usable(selfValue) && usable(partnerValue) ? selfValue + partnerValue : null
  const matches = sum !== null && splitAmountsMatch(selfValue!, partnerValue!, total)
  const locale = i18n.language
  const confirm = () => {
    const { self, partner } = latest.current
    if (!usable(self) || !usable(partner) || !splitAmountsMatch(self, partner, total)) return
    const unchanged = selfAmount !== undefined && partnerAmount !== undefined &&
      Math.abs(self - selfAmount) <= 1e-8 && Math.abs(partner - partnerAmount) <= 1e-8
    if (!unchanged) onCommit(self, partner)
  }
  return <>
    <label>{t('be11.selfAmount')}
      <span className="commit-number" onBlur={confirm}><NumberInput testId={selfTestId} value={selfValue}
        onChange={value => { latest.current = { ...latest.current, self: value }; setSelfValue(value) }} /></span></label>
    <label>{t('be11.partnerAmount')}
      <span className="commit-number" onBlur={confirm}><NumberInput testId={partnerTestId} value={partnerValue}
        onChange={value => { latest.current = { ...latest.current, partner: value }; setPartnerValue(value) }} /></span></label>
    <p className="tax-facts-sum" data-testid={`ownership-sum-${rowId}`}>{t('be11.splitSum', {
      sum: sum === null ? '—' : sum.toLocaleString(locale), total: total.toLocaleString(locale) })}</p>
    {!matches && <p className="hint" role="status" data-testid={`ownership-mismatch-${rowId}`}>{t('be11.splitMismatch', { total: total.toLocaleString(locale) })}</p>}
  </>
}

/** One editor for both entry modes. Editing canonical facts is one store
 * transaction; the legacy form cannot turn an unknown owner into 50/50. */
const RRSP_STATEMENT_FIELDS = [
  ['rrspDeductionLimit', 'be12.deductionLimit'],
  ['rrspAvailableRoom', 'be12.availableRoom'],
  ['rrspUnusedUndeducted', 'be12.unusedUndeducted'],
  ['rrspPensionAdjustment', 'be12.pa'],
  ['rrspPspa', 'be12.pspa'],
  ['rrspPar', 'be12.par'],
] as const

/** BE-12 A statement facts and the recomputed room row, shared by both modes.
 * Unknown is a real, visible state and is never coerced to zero. */
export function RrspRoomRow({ person, plan, onEdit, guided = false }: { person: Person; plan: InputsV2; onEdit: (change: (draft: InputsV2) => void) => void
  /** Guided pages ask the available room above this row and show the rest as advanced detail. */
  guided?: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const money = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 2 })
  const commit = (field: typeof RRSP_STATEMENT_FIELDS[number][0], raw: string) => {
    const text = raw.trim()
    const next = text === '' ? null : Number(text)
    if (next !== null && (!Number.isFinite(next) || next < 0)) return
    const current = person[field]
    if (current.status === 'known' && next === current.value || current.status === 'unknown' && next === null) return
    onEdit(draft => {
      draft.people.find(item => item.id === person.id)![field] = next === null
        ? { status: 'unknown', reason: 'CRA statement line not supplied' } : { status: 'known', value: next }
    })
  }
  const resolved = ownRrspAccount(plan, person.id)
  const planned = plan.contributions.find(contribution => contribution.contributorId === person.id &&
    contribution.calendarYear === plan.baseYear && contribution.accountId === resolved.accountId)
  const planId = `be12:${person.id}:${resolved.accountId}:${plan.baseYear}`
  const writePlanned = (amount: number | null, deductLater: boolean) => {
    if (!resolved.accountId) return
    onEdit(draft => {
      const existing = draft.contributions.find(contribution => contribution.id === planId)
      if (amount === null || amount <= 0) {
        draft.contributions = draft.contributions.filter(contribution => contribution.id !== planId)
        return
      }
      const deductionYear = deductLater ? draft.baseYear + 1 : null
      if (existing) { existing.amount = amount; existing.deductionYear = deductionYear; return }
      draft.contributions.push({ id: planId, accountId: resolved.accountId!, contributorId: person.id,
        calendarYear: draft.baseYear, amount, deductionYear, provenance: { origin: 'user', sourceYear: draft.baseYear } })
    })
  }
  // One shared preview with the kernel: the statement arithmetic, the recorded
  // rows and the resolved savings-split RRSP share are the same computation
  // `annualStep` prices, so the panel cannot show a partial ledger (B1). The
  // statement's available room already includes the statement year's own
  // addition, so the panel adds nothing for that year; a later year would need
  // the sourced cap/18% rule, which is why the panel only prices the first year.
  const { opening, ledger, savingsShare } = previewRrspRoomYear(plan, person)
  const shown = (value: Known<number>) => value.status === 'known' ? money(value.value) : t('be12.unknown')
  const role = person.role
  return <div role="group" aria-label={t('be12.person', { person: t(person.role === 'self' ? 'be11.self' : 'be11.partner') })}
    data-testid={`rrsp-statement-${role}`}>
    {!guided && <h5>{t('be12.person', { person: t(person.role === 'self' ? 'be11.self' : 'be11.partner') })}</h5>}
    {!guided && <p className="hint">{t('be12.explanation')}</p>}
    {RRSP_STATEMENT_FIELDS.filter(([field]) => !guided || field !== 'rrspAvailableRoom').map(([field, label]) => <label key={field}>{t(label)}
      <CommitNumberInput testId={`${field === 'rrspDeductionLimit' ? 'rrsp-deduction-limit' :
        field === 'rrspAvailableRoom' ? 'rrsp-available-room' :
        field === 'rrspUnusedUndeducted' ? 'rrsp-unused-undeducted' :
        field === 'rrspPensionAdjustment' ? 'rrsp-pa' : field === 'rrspPspa' ? 'rrsp-pspa' : 'rrsp-par'}-${role}`}
        value={person[field].status === 'known' ? person[field].value : null}
        placeholder={t('be12.unknown')}
        onCommit={value => commit(field, value === null ? '' : String(value))} />
    </label>)}
    <p className="hint">{t('be12.adjustmentNote')}</p>
    {opening.mismatch && <p className="hint" role="status" data-testid={`rrsp-mismatch-${role}`}>{t('be12.mismatch')}</p>}
    {opening.overContribution > 0 && <p className="hint" role="status" data-testid={`rrsp-over-contribution-${role}`}>
      {t('be12.overContribution', { amount: money(opening.overContribution) })}</p>}
    {resolved.ambiguous
      ? <p className="hint" role="status" data-testid={`rrsp-no-account-${role}`}>{t('be12.ambiguousAccount')}</p>
      : resolved.accountId
        ? <>
          <label>{t('be12.planned')}
            <CommitNumberInput testId={`rrsp-planned-${role}`} value={planned?.amount ?? null}
              placeholder={t('be12.zero')}
              onCommit={amount => {
                if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return
                writePlanned(amount, planned?.deductionYear !== null && planned?.deductionYear !== undefined)
              }} />
          </label>
          <label className="hint">{t('be12.deductLater')}
            <input type="checkbox" data-testid={`rrsp-deduct-later-${role}`}
              checked={planned !== undefined && planned.deductionYear !== null}
              onChange={event => writePlanned(planned?.amount ?? 0, event.target.checked)} />
          </label>
        </>
        : <p className="hint" role="status" data-testid={`rrsp-no-account-${role}`}>{t('be12.noOwnAccount')}</p>}
    <p data-testid={`rrsp-ledger-${role}`}>{t('be12.ledger', {
      opening: shown(ledger.openingRoom), additions: shown(ledger.additions), adjustments: shown(ledger.adjustments),
      applied: money(ledger.applied), closing: shown(ledger.closingRoom),
    })}</p>
    <p className="hint" data-testid={`rrsp-retained-${role}`}>{t('be12.retained', { retained: money(ledger.retained) })}
      {ledger.retained > 0 ? ` ${t('be12.retainedHelp')}` : ''}</p>
    {savingsShare > 0 && <p className="hint" data-testid={`rrsp-savings-share-${role}`}>
      {t('be12.savingsShare', { amount: money(savingsShare) })}</p>}
    {ledger.closingRoom.status === 'unknown' && <p className="hint" role="status" data-testid={`rrsp-room-unknown-${role}`}>{t('be12.unknownRoom')}</p>}
    {ledger.deductedThisYear > 0 && <p className="hint">{t('be12.deductedThisYear', { amount: money(ledger.deductedThisYear), year: plan.baseYear })}</p>}
    {ledger.deferredDeduction > 0 && <p className="hint">{t('be12.deferred', { amount: money(ledger.deferredDeduction), year: plan.baseYear + 1 })}</p>}
    <p className="hint">{t('be12.deductionPolicy')}</p>
  </div>
}

/**
 * BE-36 A: one person's FHSA participation-room row. The room belongs to the
 * account holder, so this editor is keyed by person and never by a household
 * total. Expert and guided entry both mount it, the unknown state is explicit,
 * and the ledger is the same computation the kernel prices. The BE-36 B
 * maturity clock is displayed as out of scope rather than as room still
 * available.
 */
export function FhsaRoomRow({ person, account, plan, onEdit, guided = false }: {
  person: Person
  account: Account | undefined
  plan: InputsV2
  onEdit: (change: (draft: InputsV2) => void) => void
  /** Guided pages ask the participation room above this row. */
  guided?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const money = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 2 })
  const role = person.role
  // One recorded row per FHSA account is the whole plan, and the kernel reads
  // the same accessor, so the panel and the projection can never price a
  // different amount. A legacy plan's row carries the canonical id too, so the
  // box shows the plan the kernel prices instead of a blank field.
  // The box is the account's whole plan for the year — the recorded row, or the
  // scheduled rows when they are larger — read through the same accessor the
  // kernel prices. A plan imported with a scheduled row therefore shows (and
  // prices) one amount, not a blank box next to a priced ledger.
  const planShare = account ? plannedFhsaYearTotal(plan, account.id, plan.baseYear) : 0
  const scheduled = account ? fhsaScheduledContributions(plan, account.id, plan.baseYear) : []
  const scheduledAmount = scheduled.reduce((total, item) => total + item.amount, 0)
  const preview = account ? previewFhsaRoomYear(plan, account) : null
  const statement = account ? fhsaStatementHistory(plan, account.id) : undefined
  const ownerLabel = t(person.role === 'self' ? 'be11.self' : 'be11.partner')
  const shown = (value: Known<number>) => value.status === 'known' ? money(value.value) : t('be12.unknown')
  /** Writes a statement line, or clears it back to an explicit unknown. */
  const writeKnown = (read: () => Known<number>, write: (draft: InputsV2, value: Known<number>) => void, blankReason: string) =>
    (raw: string) => {
      const text = raw.trim()
      const next = text === '' ? null : Number(text)
      if (next !== null && (!Number.isFinite(next) || next < 0)) return
      const current = read()
      if (current.status === 'known' && next === current.value || current.status === 'unknown' && next === null) return
      onEdit(draft => write(draft, next === null ? { status: 'unknown', reason: blankReason } : { status: 'known', value: next }))
    }
  const setOpenedYear = writeKnown(
    () => account?.openedYear ?? { status: 'unknown', reason: 'FHSA opening year not supplied' },
    (draft, value) => { for (const item of draft.accounts) if (item.id === account?.id) item.openedYear = value }, 'FHSA opening year not supplied')
  const setOpeningRoom = writeKnown(
    () => account?.contributionRoom ?? { status: 'unknown', reason: 'participation-room statement not supplied' },
    (draft, value) => { for (const item of draft.accounts) if (item.id === account?.id) item.contributionRoom = value }, 'participation-room statement not supplied')
  const setPriorContributions = writeKnown(
    () => statement?.cumulativePriorContributions ?? { status: 'unknown', reason: 'FHSA contribution history not supplied' },
    (draft, value) => {
      draft.fhsaStatementHistory ??= {}
      draft.fhsaStatementHistory[account!.id] = {
        cumulativePriorContributions: value,
        provenance: { origin: 'user', sourceYear: draft.baseYear },
      }
    }, 'FHSA contribution history not supplied')
  const writePlanned = (amount: number | null) => {
    if (!account) return
    const id = fhsaPlanRowId(account.id)
    onEdit(draft => {
      // Replacing the plan means removing every recurring row for this account,
      // not only the canonical one: a legacy mirror row left behind would be a
      // second copy of the same plan and would be added to the recorded amount.
      draft.recurringContributions = draft.recurringContributions.filter(item => item.accountId !== account.id)
      // A scheduled row for this plan year is part of the amount this box shows,
      // so an explicit edit replaces it too. Other years' rows are left alone.
      draft.contributions = draft.contributions.filter(item => !(item.accountId === account.id && item.calendarYear === draft.baseYear))
      if (amount === null || amount <= 0) return
      draft.recurringContributions.push({
        id, accountId: account.id, contributorId: person.id, annualAmount: amount,
        funding: 'fromSavings', provenance: { origin: 'user', sourceYear: draft.baseYear },
      })
    })
  }
  const maturityReached = account?.openedYear.status === 'known' && plan.baseYear - account.openedYear.value >= 15
  return <div role="group" aria-label={t('be36.person', { person: ownerLabel })} data-testid={`fhsa-statement-${role}`}>
    {!guided && <h5>{t('be36.person', { person: ownerLabel })}</h5>}
    {!guided && <p className="hint">{t('be36.explanation')}</p>}
    {!account
      ? <p className="hint" role="status" data-testid={`fhsa-no-account-${role}`}>{t('be36.noAccount')}</p>
      : <>
        <label>{t('be36.openedYear')}
          <CommitNumberInput testId={`fhsa-opened-year-${role}`} grouping={false}
            value={account.openedYear.status === 'known' ? account.openedYear.value : null}
            placeholder={t('be12.unknown')}
            onCommit={year => {
              if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2200)) return
              setOpenedYear(year === null ? '' : String(year))
            }} />
        </label>
        <label>{t('be36.priorContributions')}
          <CommitNumberInput testId={`fhsa-prior-contributions-${role}`}
            value={statement?.cumulativePriorContributions.status === 'known' ? statement.cumulativePriorContributions.value : null}
            placeholder={t('be12.unknown')}
            onCommit={value => setPriorContributions(value === null ? '' : String(value))} />
        </label>
        {!guided && <><label>{t('be36.openingRoom')}
          <CommitNumberInput testId={`fhsa-opening-room-${role}`}
            value={account.contributionRoom.status === 'known' ? account.contributionRoom.value : null}
            placeholder={t('be12.unknown')}
            onCommit={value => setOpeningRoom(value === null ? '' : String(value))} />
        </label>
        <p className="hint">{t('be36.openingRoomNote')}</p></>}
        <label>{t('be36.planned')}
          <CommitNumberInput testId={`fhsa-planned-${role}`} value={planShare > 0 ? planShare : null}
            placeholder={t('be12.zero')}
            onCommit={amount => {
              if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return
              writePlanned(amount)
            }} />
        </label>
        {scheduled.length > 0 && <p className="hint" role="status" data-testid={`fhsa-scheduled-${role}`}>
          {t('be36.scheduledRecorded', { amount: money(scheduledAmount) })}</p>}
        {preview && <p data-testid={`fhsa-ledger-${role}`}>{t('be36.ledger', {
          opening: shown(preview.ledger.openingRoom), addition: shown(preview.ledger.annualAddition),
          applied: money(preview.ledger.applied), closing: shown(preview.ledger.closingRoom),
        })}</p>}
        {preview && <p className="hint" data-testid={`fhsa-lifetime-${role}`}>{t('be36.lifetime', {
          remaining: shown(preview.ledger.remainingLifetimeRoom), used: shown(preview.ledger.cumulativeContributions),
          limit: money(preview.ledger.lifetimeLimit.status === 'known' ? preview.ledger.lifetimeLimit.value : 0),
        })}</p>}
        {preview && <p className="hint" data-testid={`fhsa-retained-${role}`}>{t('be36.retained', { retained: money(preview.ledger.retained) })}
          {preview.ledger.retained > 0 ? ` ${t('be36.retainedHelp')}` : ''}</p>}
        {preview?.ledger.closingRoom.status === 'unknown' && <p className="hint" role="status" data-testid={`fhsa-room-unknown-${role}`}>
          {t('be36.unknownRoom', { reason: preview.ledger.closingRoom.reason })}</p>}
        {maturityReached && <p className="hint" role="status" data-testid={`fhsa-maturity-${role}`}>{t('be36.maturity')}</p>}
      </>}
    <p className="hint">{t('be36.limit')}{' '}<a href="https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/first-home-savings-account/contributing-your-fhsa.html"
      target="_blank" rel="noopener noreferrer">{t('be36.source')}</a></p>
  </div>
}

/**
 * BE-27 A: one person's TFSA contribution-room row. TFSA room belongs to the
 * person, so the editor is keyed by person and never by an account or a
 * household total. Expert and guided entry both mount it, the unknown state is
 * explicit, and the ledger is the same computation the kernel prices. The
 * withdrawals recorded here are the only thing that restores room, and the row
 * says when that happens instead of implying it happens immediately.
 */
export function TfsaRoomRow({ person, plan, onEdit, guided = false }: { person: Person; plan: InputsV2; onEdit: (change: (draft: InputsV2) => void) => void
  /** Guided pages ask the CRA room above this row. */
  guided?: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const money = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 2 })
  const role = person.role
  const ownerLabel = t(person.role === 'self' ? 'be11.self' : 'be11.partner')
  const statement = tfsaStatement(plan, person.id)
  const withdrawals = statement?.withdrawals ?? []
  const { ledger, savingsShare, restoredNextYear } = previewTfsaRoomYear(plan, person)
  const shown = (value: Known<number>) => value.status === 'known' ? money(value.value) : t('be12.unknown')
  const writeRoom = (raw: string) => {
    const text = raw.trim()
    const next = text === '' ? null : Number(text)
    if (next !== null && (!Number.isFinite(next) || next < 0)) return
    const current = person.tfsaAvailableRoom
    if (current.status === 'known' && next === current.value || current.status === 'unknown' && next === null) return
    onEdit(draft => {
      draft.people.find(item => item.id === person.id)!.tfsaAvailableRoom = next === null
        ? { status: 'unknown', reason: 'CRA TFSA room statement not supplied' } : { status: 'known', value: next }
    })
  }
  // The withdrawal rows are a recorded fact set, not a derived value: an empty
  // list is a confirmed "nothing was withdrawn" only once the user adds one,
  // and clearing every row returns the history to its absent state.
  const writeWithdrawals = (change: (rows: TfsaWithdrawalLine[]) => TfsaWithdrawalLine[]) =>
    onEdit(draft => {
      draft.tfsaStatement ??= {}
      const entry = draft.tfsaStatement[person.id]
      draft.tfsaStatement[person.id] = {
        withdrawals: change(entry?.withdrawals ?? []),
        provenance: entry?.provenance ?? { origin: 'user', sourceYear: draft.baseYear },
      }
    })
  const addWithdrawal = () => writeWithdrawals(rows => {
    let serial = 0
    while (rows.some(row => row.id === `be27:withdrawal:${person.id}:${serial}`)) serial += 1
    return [...rows, { id: `be27:withdrawal:${person.id}:${serial}`, calendarYear: plan.baseYear, amount: 0 }]
  })
  const setWithdrawal = (id: string, change: (row: TfsaWithdrawalLine) => void) =>
    writeWithdrawals(rows => rows.map(row => { if (row.id !== id) return row; const next = { ...row }; change(next); return next }))
  const removeWithdrawal = (id: string) => writeWithdrawals(rows => rows.filter(row => row.id !== id))
  return <div role="group" aria-label={t('be27.person', { person: ownerLabel })} data-testid={`tfsa-statement-${role}`}>
    {!guided && <><h5>{t('be27.person', { person: ownerLabel })}</h5>
    <p className="hint">{t('be27.explanation')}</p>
    <label>{t('be27.availableRoom')}
      <CommitNumberInput testId={`tfsa-available-room-${role}`}
        value={person.tfsaAvailableRoom.status === 'known' ? person.tfsaAvailableRoom.value : null}
        placeholder={t('be12.unknown')}
        onCommit={value => writeRoom(value === null ? '' : String(value))} />
    </label>
    <p className="hint">{t('be27.availableRoomNote')}</p></>}
    <p className="hint">{t('be27.withdrawalsHelp')}</p>
    {withdrawals.map(row => <div key={row.id} data-testid={`tfsa-withdrawal-${row.id}`}>
      <label>{t('be27.withdrawalYear')}
        <CommitNumberInput testId={`tfsa-withdrawal-year-${row.id}`} grouping={false} value={row.calendarYear}
          onCommit={year => {
            if (year === null || !Number.isInteger(year) || year < 1900 || year > 2200 || year === row.calendarYear) return
            setWithdrawal(row.id, item => { item.calendarYear = year })
          }} />
      </label>
      <label>{t('be27.withdrawalAmount')}
        <CommitNumberInput testId={`tfsa-withdrawal-amount-${row.id}`} value={row.amount}
          onCommit={amount => {
            if (amount === null || !Number.isFinite(amount) || amount < 0 || amount === row.amount) return
            setWithdrawal(row.id, item => { item.amount = amount })
          }} />
      </label>
      <button type="button" data-testid={`tfsa-withdrawal-remove-${row.id}`}
        onClick={() => removeWithdrawal(row.id)}>{t('be27.withdrawalRemove')}</button>
    </div>)}
    <button type="button" data-testid={`tfsa-withdrawal-add-${role}`} onClick={addWithdrawal}>{t('be27.withdrawalAdd')}</button>
    {restoredNextYear.status === 'known' && restoredNextYear.value > 0 && <p className="hint" data-testid={`tfsa-restored-next-${role}`}>
      {t('be27.restoredNext', { amount: money(restoredNextYear.value), year: plan.baseYear, nextYear: plan.baseYear + 1 })}</p>}
    {savingsShare > 0 && <p className="hint" data-testid={`tfsa-savings-share-${role}`}>
      {t('be27.savingsShare', { amount: money(savingsShare) })}</p>}
    <p data-testid={`tfsa-ledger-${role}`}>{t('be27.ledger', {
      opening: shown(ledger.openingRoom), addition: shown(ledger.annualAddition),
      restored: shown(ledger.restored), applied: money(ledger.applied), closing: shown(ledger.closingRoom),
    })}</p>
    <p className="hint" data-testid={`tfsa-retained-${role}`}>{t('be27.retained', { retained: money(ledger.retained) })}
      {ledger.retained > 0 ? ` ${t('be27.retainedHelp')}` : ''}</p>
    {ledger.closingRoom.status === 'unknown' && <p className="hint" role="status" data-testid={`tfsa-room-unknown-${role}`}>
      {t('be27.unknownRoom', { reason: ledger.closingRoom.reason })}</p>}
  </div>
}

/**
 * BE-12 B: the recorded premium history of one spousal plan and a T2205 split
 * preview. The history-completeness state is explicit, so "no premiums" is a
 * user answer and an unrecorded history never silently becomes zero. Shared by
 * both entry modes because both mount this panel.
 */
export function SpousalAttributionRow({ account, plan, onEdit }: { account: Account; plan: InputsV2; onEdit: (change: (draft: InputsV2) => void) => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const money = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 2 })
  const label = (id: string | null | undefined) => {
    const person = plan.people.find(item => item.id === id)
    return person ? t(person.role === 'self' ? 'be11.self' : 'be11.partner') : t('be12.spousalUnassigned')
  }
  const annuitant = plan.people.find(person => person.id === account.ownerId)
  const spouse = annuitant ? plan.people.find(person => person.id !== annuitant.id) : undefined
  const rows = plan.contributions.filter(contribution => contribution.accountId === account.id)
  const complete = plan.spousalHistory?.[account.id]?.status === 'complete'
  const [paymentRaw, setPaymentRaw] = useState('')
  const addRow = () => onEdit(draft => {
    // The id is derived from the fresh draft, not from the render-time plan, so
    // two adds in one task cannot produce the same id and corrupt the plan.
    const used = new Set(draft.contributions.map(contribution => contribution.id))
    let serial = 0
    while (used.has(`be12:spousal:${account.id}:${serial}`)) serial += 1
    draft.contributions.push({
      id: `be12:spousal:${account.id}:${serial}`, accountId: account.id, contributorId: spouse?.id ?? null,
      calendarYear: draft.baseYear - 1, amount: 0, deductionYear: null,
      provenance: { origin: 'user', sourceYear: draft.baseYear },
    })
    draft.spousalHistory = { ...(draft.spousalHistory ?? {}), [account.id]: { status: 'complete' } }
  })
  const setRow = (rowId: string, change: (contribution: InputsV2['contributions'][number]) => void) =>
    onEdit(draft => { const row = draft.contributions.find(item => item.id === rowId); if (row) change(row) })
  const removeRow = (rowId: string) => onEdit(draft => {
    draft.contributions = draft.contributions.filter(item => item.id !== rowId)
  })
  const setHistory = (status: 'complete' | 'unknown') => onEdit(draft => {
    draft.spousalHistory = { ...(draft.spousalHistory ?? {}), [account.id]: status === 'complete'
      ? { status: 'complete' } : { status: 'unknown', reason: 'spousal premium history not supplied' } }
  })
  // The recorded premium history is itself the marker that this account is a
  // spousal plan, so a type switch to RRIF keeps attributing (above the year's
  // minimum) and a type switch to LIF or an ordinary RRSP is refused rather
  // than silently taxed to the owner. The same routing drives the kernel.
  const routing = resolveSpousalPlan(account, plan.people, plan.spousalHistory, plan.contributions, plan.baseYear, plan.baseYear)
  const paymentText = paymentRaw.trim()
  const payment = paymentText === '' ? Number.NaN : Number(paymentText)
  const preview = complete && routing.status === 'ok' && Number.isFinite(payment) && payment > 0
    ? attributeSpousalPayment({
      payment, paymentYear: plan.baseYear,
      contributorId: routing.parties.contributorId, annuitantId: routing.parties.annuitantId,
      premiums: routing.parties.premiums, rrifMinimum: routing.parties.rrifMinimum,
      annuitantIncomeBefore: 0,
    })
    : null
  // A recorded plan that cannot be priced still says why, so a confirmed
  // history never leaves the user with a field that can never answer.
  const blocker = complete && routing.status === 'unsupported' ? routing.reason : null
  return <div data-testid={`spousal-attribution-${account.id}`}>
    <h5>{t('be12.spousalTitle')}</h5>
    <p className="hint">{t('be12.spousalExplanation')}</p>
    {account.kind === 'rrif' && <p className="hint" data-testid={`spousal-rrif-note-${account.id}`}>{t('be12.spousalRrifNote')}</p>}
    <label>{t('be12.spousalHistory')}
      <select data-testid={`spousal-history-${account.id}`} value={complete ? 'complete' : 'unknown'}
        onChange={event => setHistory(event.target.value === 'complete' ? 'complete' : 'unknown')}>
        <option value="unknown">{t('be12.spousalHistoryUnknown')}</option>
        <option value="complete">{t('be12.spousalHistoryComplete')}</option>
      </select>
    </label>
    {rows.map(row => <div key={row.id} data-testid={`spousal-row-${row.id}`}>
      <label>{t('be12.spousalYear')}
        <CommitNumberInput testId={`spousal-year-${row.id}`} grouping={false} value={row.calendarYear}
          onCommit={year => {
            if (year === null || !Number.isInteger(year) || year < 1950 || year > 2200 || year === row.calendarYear) return
            setRow(row.id, contribution => {
              contribution.calendarYear = year
              // The deferral is relative to the contribution year, so moving the
              // year keeps "deducted the following year" true.
              if (contribution.deductionYear !== null) contribution.deductionYear = year + 1
            })
          }} />
      </label>
      <label>{t('be12.spousalContributor')}
        <select data-testid={`spousal-contributor-${row.id}`} value={row.contributorId ?? ''}
          onChange={event => setRow(row.id, contribution => { contribution.contributorId = event.target.value || null })}>
          <option value="">{t('be12.spousalUnassigned')}</option>
          {plan.people.map(person => <option key={person.id} value={person.id}>
            {t(person.role === 'self' ? 'be11.self' : 'be11.partner')}</option>)}
        </select>
      </label>
      <label>{t('be12.spousalAmount')}
        <CommitNumberInput testId={`spousal-amount-${row.id}`} value={row.amount}
          onCommit={amount => {
            if (amount === null || !Number.isFinite(amount) || amount < 0 || amount === row.amount) return
            setRow(row.id, contribution => { contribution.amount = amount })
          }} />
      </label>
      <label>{t('be12.spousalDeductLater')}
        <input type="checkbox" data-testid={`spousal-deduct-later-${row.id}`}
          checked={row.deductionYear !== null}
          onChange={event => setRow(row.id, contribution => {
            contribution.deductionYear = event.target.checked ? contribution.calendarYear + 1 : null
          })} />
      </label>
      {row.deductionYear !== null && <p className="hint" data-testid={`spousal-deduction-year-${row.id}`}>
        {t('be12.spousalDeductionYear', { deductionYear: row.deductionYear, contributionYear: row.calendarYear })}</p>}
      <button type="button" data-testid={`spousal-remove-${row.id}`}
        onClick={() => removeRow(row.id)}>{t('be12.spousalRemove')}</button>
    </div>)}
    <button type="button" data-testid={`spousal-add-${account.id}`} onClick={addRow}>{t('be12.spousalAdd')}</button>
    <p className="hint" data-testid={`spousal-window-${account.id}`}>{t('be12.spousalWindow', {
      year: plan.baseYear, years: [plan.baseYear - 2, plan.baseYear - 1, plan.baseYear].join(', ') })}</p>
    <p className="hint" data-testid={`spousal-base-year-${account.id}`}>
      {t('be12.spousalBaseYearNote', { baseYear: plan.baseYear })}</p>
    {!complete && <p className="hint" role="status" data-testid={`spousal-unknown-${account.id}`}>{t('be12.spousalNoHistory')}</p>}
    {complete && <label>{t('be12.spousalPaymentTest')}
      <NumberInput testId={`spousal-payment-${account.id}`} value={paymentRaw === '' ? null : Number(paymentRaw)}
        onChange={value => setPaymentRaw(value === null ? '' : String(value))} />
    </label>}
    {blocker && <p className="hint" role="status" data-testid={`spousal-unsupported-${account.id}`}>
      {t('be12.spousalUnsupported', { reason: blocker })}</p>}
    {preview && preview.status === 'ok' && <p data-testid={`spousal-split-${account.id}`}>{t('be12.spousalSplit', {
      contributor: label(routing.status === 'ok' ? routing.parties.contributorId : spouse?.id),
      attributed: money(preview.attributedToContributor),
      annuitant: label(routing.status === 'ok' ? routing.parties.annuitantId : annuitant?.id),
      taxed: money(preview.taxedToAnnuitant),
    })}</p>}
    {preview && preview.status !== 'ok' && <p className="hint" role="status" data-testid={`spousal-unsupported-${account.id}`}>
      {t('be12.spousalUnsupported', { reason: preview.reason })}</p>}
    <p className="hint">{t('be12.spousalLimit')}{' '}<a href="https://www.canada.ca/en/revenue-agency/services/forms-publications/forms/t2205.html"
      target="_blank" rel="noopener noreferrer">{t('be12.spousalSource')}</a></p>
  </div>
}

/** The independent editors the shared tax-facts panel is built from. */
export type TaxFactsSection = 'earned' | 'ownership' | 'spouseSupport' | 'pensionSplit' | 'qcCoverage' |
  'rrspRoom' | 'fhsaRoom' | 'tfsaRoom' | 'registered' | 'spousal'
export const ALL_TAX_FACTS_SECTIONS: readonly TaxFactsSection[] = ['earned', 'ownership', 'spouseSupport', 'pensionSplit',
  'qcCoverage', 'rrspRoom', 'fhsaRoom', 'tfsaRoom', 'registered', 'spousal']

export const usePersonLabel = () => {
  const { t } = useTranslation()
  return (person: Person | undefined) => person ? t(person.role === 'self' ? 'be11.self' : 'be11.partner') : t('be12.spousalUnassigned')
}

/** Each person's current employment income; blank stays unknown, never zero. */
export function EarnedIncomeFields({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  const label = usePersonLabel()
  return <>{plan.people.map(person => <label key={person.id}>
    {t('be11.earned', { person: label(person) })}
    <CommitNumberInput testId={`earned-${person.role}`}
      value={person.earnedIncome.status === 'known' ? person.earnedIncome.value : null}
      placeholder={t('be11.unknown')}
      onCommit={next => {
        if (next !== null && (!Number.isFinite(next) || next < 0)) return
        if (person.earnedIncome.status === 'known' && next === person.earnedIncome.value ||
            person.earnedIncome.status === 'unknown' && next === null) return
        commitCanonicalEdit(draft => { draft.people.find(item => item.id === person.id)!.earnedIncome = next === null
          ? { status: 'unknown', reason: 'employment amount not supplied' } : { status: 'known', value: next } })
      }} />
  </label>)}</>
}

/** The account rows a household total can be recorded against, base and partner halves together. */
export function ownershipAccountRows(plan: InputsV2): { baseId: string; base: Account | undefined; derived: Account | undefined }[] {
  return SPLIT_ROW_BASE_IDS.map(baseId => ({
    baseId,
    base: plan.accounts.find(account => account.id === baseId),
    derived: plan.accounts.find(account => account.id === derivedAccountId(baseId)),
  })).filter(row => !!row.base || !!row.derived)
}

/** Professional ownership editor: one owner select and two amounts per account. */
export function AccountOwnershipRows({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  const cad = useCad()
  const self = plan.people.find(person => person.role === 'self')
  const partner = plan.people.find(person => person.role === 'partner')
  if (!self || !partner) return null
  const ownerOptions = <>
    <option value="">{t('be11.unknown')}</option>
    <option value="shared" disabled>{t('be11.shared')}</option>
    <option value="split" disabled>{t('be11.splitOwners')}</option>
    {plan.people.map(person => <option key={person.id} value={person.id}>{t(person.role === 'self' ? 'be11.self' : 'be11.partner')}</option>)}
  </>
  return <>{ownershipAccountRows(plan).map(({ baseId, base, derived }) => {
    const account = base ?? derived!
    const total = (base?.balance ?? 0) + (derived?.balance ?? 0)
    const registered = account.kind !== 'nonReg'
    const entry = plan.ownershipAmounts?.[baseId]
    let selfAmount: number | undefined
    let partnerAmount: number | undefined
    if (registered) {
      selfAmount = entry ? entry[self.id] : account.ownerId === self.id ? total : account.ownerId === partner.id ? 0 : undefined
      partnerAmount = entry ? entry[partner.id] : account.ownerId === partner.id ? total : account.ownerId === self.id ? 0 : undefined
    } else if (account.taxableOwnerShares.status === 'known') {
      const selfShare = account.taxableOwnerShares.shares[self.id] ?? 0
      selfAmount = roundCents(selfShare * total)
      partnerAmount = roundCents(total - selfAmount)
    }
    const selectValue = registered
      ? derived && derived.ownerId && base && base.ownerId && derived.ownerId !== base.ownerId ? 'split' : account.ownerId ?? ''
      : account.ownerId ?? (account.taxableOwnerShares.status === 'known' ? 'shared' : '')
    return <div className="tax-facts-row" key={`${baseId}:${account.kind}:${total}:${JSON.stringify(entry ?? null)}:${base?.ownerId ?? ''}:${derived?.ownerId ?? ''}:${JSON.stringify(account.taxableOwnerShares)}`}
      data-testid={`ownership-row-${baseId}`}>
      <div className="tax-facts-row-head">
        <strong>{t(`questionnaire.accountNames.${accountNameKey(account.kind)}`)}</strong>
        <span>{cad(total)}</span>
      </div>
      <label>{t('be11.accountOwner')}
        <select data-testid={`owner-${baseId}`} value={selectValue} onChange={event => commitCanonicalEdit(draft => {
          const value = event.target.value
          if (!registered) {
            const item = draft.accounts.find(candidate => candidate.id === baseId)!
            item.ownerId = value || null
            item.taxableOwnerShares = item.ownerId ? { status: 'known', shares: { [item.ownerId]: 1 } }
              : { status: 'unknown', reason: 'account owner not assigned' }
            return
          }
          if (!value) {
            for (const item of draft.accounts) if (item.id === baseId || item.id === derivedAccountId(baseId)) {
              item.ownerId = null
              item.taxableOwnerShares = { status: 'unknown', reason: 'account owner not assigned' }
            }
            if (draft.ownershipAmounts?.[baseId]) {
              const { [baseId]: _dropped, ...rest } = draft.ownershipAmounts
              draft.ownershipAmounts = Object.keys(rest).length ? rest : undefined
            }
            return
          }
          if (value === self.id) applyAccountSplit(draft, baseId, total, 0, { zeroOwnerId: self.id })
          else if (value === partner.id) applyAccountSplit(draft, baseId, 0, total, { zeroOwnerId: partner.id })
        })}>{ownerOptions}</select>
      </label>
      <SplitAmounts rowId={baseId} total={total} selfAmount={selfAmount} partnerAmount={partnerAmount}
        selfTestId={`account-self-amount-${baseId}`} partnerTestId={`account-partner-amount-${baseId}`}
        onCommit={(selfAmt, partnerAmt) => commitCanonicalEdit(draft => applyAccountSplit(draft, baseId, selfAmt, partnerAmt))} />
      {baseId === 'legacy:account:locked' && <p className="hint">{t('be11.lockedOwnerResetHelp')}</p>}
      {!registered && <ShareInput testId={`account-self-share-${baseId}`} shares={account.taxableOwnerShares} selfId={self.id}
        onShare={pct => commitCanonicalEdit(draft => {
          const item = draft.accounts.find(candidate => candidate.id === baseId)!
          item.taxableOwnerShares = { status: 'known', shares: { [self.id]: pct / 100, [partner.id]: 1 - pct / 100 } }
          item.ownerId = pct === 100 ? self.id : pct === 0 ? partner.id : null
        })} />}
    </div>
  })}</>
}

/** The question-catalogue key that names one account kind in all three languages. */
export function accountNameKey(kind: Account['kind']): string {
  return kind === 'nonReg' ? 'nonReg' : kind === 'tfsa' ? 'tfsa' : kind === 'fhsa' ? 'fhsa'
    : kind === 'lira' || kind === 'lif' ? 'locked' : 'rrsp'
}

/** One person's taxable share of a jointly held asset, as a percentage. */
export function ShareInput({ testId, shares, selfId, onShare }: { testId: string; shares: Account['taxableOwnerShares']; selfId: string; onShare: (pct: number) => void }) {
  const { t } = useTranslation()
  return <label>{t('be11.selfTaxShare')}
    <CommitNumberInput testId={testId} grouping={false}
      value={shares.status === 'known' ? (shares.shares[selfId] ?? 0) * 100 : null}
      onCommit={pct => {
        if (pct === null || !Number.isFinite(pct) || pct < 0 || pct > 100) return
        if (shares.status === 'known' && Math.abs((shares.shares[selfId] ?? 0) * 100 - pct) < 1e-8) return
        onShare(pct)
      }} />
  </label>
}

/** Professional property-ownership editor. The home is listed too: the
 * precision gate needs every property's taxable owner, so a couple's principal
 * residence has to be answerable somewhere. */
export function PropertyOwnershipRows({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  const cad = useCad()
  const self = plan.people.find(person => person.role === 'self')
  const partner = plan.people.find(person => person.role === 'partner')
  if (!self || !partner) return null
  const ownerOptions = <>
    <option value="">{t('be11.unknown')}</option>
    <option value="shared" disabled>{t('be11.shared')}</option>
    {plan.people.map(person => <option key={person.id} value={person.id}>{t(person.role === 'self' ? 'be11.self' : 'be11.partner')}</option>)}
  </>
  let rental = 0
  return <>{plan.properties.map(property => {
    if (property.kind === 'investment') rental += 1
    const selfAmount = property.taxableOwnerShares.status === 'known'
      ? roundCents((property.taxableOwnerShares.shares[self.id] ?? 0) * property.value) : undefined
    const partnerAmount = property.taxableOwnerShares.status === 'known' && selfAmount !== undefined
      ? roundCents(property.value - selfAmount) : undefined
    return <div className="tax-facts-row" key={`${property.id}:${property.value}:${JSON.stringify(property.taxableOwnerShares)}`}
      data-testid={`ownership-row-${property.id}`}>
      <div className="tax-facts-row-head">
        <strong>{property.kind === 'principal' ? t('questionnaire.ownership.home') : t('questionnaire.ownership.rental', { n: rental })}</strong>
        <span>{cad(property.value)}</span>
      </div>
      <label>{t(property.kind === 'principal' ? 'be11.homeOwner' : 'be11.propertyOwner')}
        <select data-testid={`property-owner-${property.id}`}
          value={property.taxableOwnerShares.status === 'known' ? Object.keys(property.taxableOwnerShares.shares).find(id => property.taxableOwnerShares.status === 'known' && property.taxableOwnerShares.shares[id] === 1) ?? 'shared' : ''}
          onChange={event => commitCanonicalEdit(draft => {
            const item = draft.properties.find(candidate => candidate.id === property.id)!
            item.taxableOwnerShares = event.target.value ? { status: 'known', shares: { [event.target.value]: 1 } }
              : { status: 'unknown', reason: 'property taxable owner not assigned' }
          })}>{ownerOptions}</select>
      </label>
      <SplitAmounts rowId={property.id} total={property.value} selfAmount={selfAmount} partnerAmount={partnerAmount}
        selfTestId={`property-self-amount-${property.id}`} partnerTestId={`property-partner-amount-${property.id}`}
        onCommit={(selfAmt, partnerAmt) => commitCanonicalEdit(draft => applyPropertySplit(draft, property.id, selfAmt, partnerAmt))} />
      <ShareInput testId={`property-self-share-${property.id}`} shares={property.taxableOwnerShares} selfId={self.id}
        onShare={pct => commitCanonicalEdit(draft => { draft.properties.find(item => item.id === property.id)!.taxableOwnerShares = {
          status: 'known', shares: { [self.id]: pct / 100, [partner.id]: 1 - pct / 100 },
        } })} />
    </div>
  })}</>
}

/** Whether the spouses live together and one supports the other (spouse amount). */
export function SpouseSupportSelect({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  return <label>{t('be11.spouseSupport')}
    <select data-testid="spouse-support" value={plan.taxProfile?.spouseSupported.status === 'known' ? String(plan.taxProfile.spouseSupported.value) : 'unknown'}
      onChange={event => commitCanonicalEdit(draft => setSpouseSupport(draft, event.target.value === 'unknown' ? null : event.target.value === 'true'))}>
      <option value="unknown">{t('be11.unknown')}</option><option value="true">{t('be11.yes')}</option><option value="false">{t('be11.no')}</option>
    </select>
  </label>
}

/** BE-44: record whether a one-person Québec household lived alone all year. */
export function setLivesAlone(draft: InputsV2, value: boolean | null): void {
  draft.taxProfile ??= { spouseSupported: { status: 'unknown', reason: 'not supplied' }, pensionSplit: null }
  draft.taxProfile.livesAlone = value === null ? { status: 'unknown', reason: 'living arrangement not confirmed' } : { status: 'known', value }
}

/** BE-44: professional field for the Québec living-alone amount. */
export function LivesAloneSelect({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  const fact = plan.taxProfile?.livesAlone
  return <label>{t('be44.livesAlone')}
    <select data-testid="lives-alone" value={fact?.status === 'known' ? String(fact.value) : 'unknown'}
      onChange={event => commitCanonicalEdit(draft => setLivesAlone(draft, event.target.value === 'unknown' ? null : event.target.value === 'true'))}>
      <option value="unknown">{t('be11.unknown')}</option><option value="true">{t('be11.yes')}</option><option value="false">{t('be11.no')}</option>
    </select>
  </label>
}

/** Record the spouse-support fact, or clear it back to an explicit unknown. */
export function setSpouseSupport(draft: InputsV2, value: boolean | null): void {
  draft.taxProfile ??= { spouseSupported: { status: 'unknown', reason: 'not supplied' }, pensionSplit: null }
  draft.taxProfile.spouseSupported = value === null ? { status: 'unknown', reason: 'not confirmed' } : { status: 'known', value }
}

/** The explicit federal (T1032) and, in Quebec, Schedule Q pension-split elections. */
export function PensionSplitFields({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  const people = plan.people
  return <>
    <label>{t('be11.splitTransferor')}
      <select data-testid="split-transferor" value={plan.taxProfile?.pensionSplit?.transferorId ?? ''}
        onChange={event => commitCanonicalEdit(draft => {
          draft.taxProfile ??= { spouseSupported: { status: 'unknown', reason: 'not supplied' }, pensionSplit: null }
          const transferorId = event.target.value
          const recipientId = draft.people.find(item => item.id !== transferorId)?.id
          draft.taxProfile.pensionSplit = transferorId && recipientId ? { transferorId, recipientId, amount: 0 } : null
        })}><option value="">{t('be11.noSplit')}</option>{people.map(person => <option key={person.id} value={person.id}>{t(person.role === 'self' ? 'be11.self' : 'be11.partner')}</option>)}</select>
    </label>
    {plan.taxProfile?.pensionSplit && <label>{t('be11.splitAmount')}
      <CommitNumberInput testId="split-amount" value={plan.taxProfile.pensionSplit.amount}
        onCommit={amount => {
          if (amount === null || !Number.isFinite(amount) || amount < 0 || amount === plan.taxProfile?.pensionSplit?.amount) return
          commitCanonicalEdit(draft => { if (draft.taxProfile?.pensionSplit) draft.taxProfile.pensionSplit.amount = amount })
        }} />
    </label>}
    {plan.province === 'QC' && <>
      <label>{t('be35.qcSplitTransferor')}
        <select data-testid="qc-split-transferor" value={plan.taxProfile?.qcPensionSplit?.transferorId ?? ''}
          onChange={event => commitCanonicalEdit(draft => {
            draft.taxProfile ??= { spouseSupported: { status: 'unknown', reason: 'not supplied' }, pensionSplit: null }
            const transferorId = event.target.value
            const recipientId = draft.people.find(item => item.id !== transferorId)?.id
            draft.taxProfile.qcPensionSplit = transferorId && recipientId ? { transferorId, recipientId, amount: 0 } : null
          })}><option value="">{t('be11.noSplit')}</option>{people.map(person => <option key={person.id} value={person.id}>{t(person.role === 'self' ? 'be11.self' : 'be11.partner')}</option>)}</select>
      </label>
      {plan.taxProfile?.qcPensionSplit && <label>{t('be35.qcSplitAmount')}
        <CommitNumberInput testId="qc-split-amount" value={plan.taxProfile.qcPensionSplit.amount}
          onCommit={amount => {
            if (amount === null || !Number.isFinite(amount) || amount < 0 || amount === plan.taxProfile?.qcPensionSplit?.amount) return
            commitCanonicalEdit(draft => { if (draft.taxProfile?.qcPensionSplit) draft.taxProfile.qcPensionSplit.amount = amount })
          }} />
      </label>}
      <p className="hint">{t('be35.splitHelp')}</p>
    </>}
  </>
}

/** Each person's Quebec prescription-drug coverage: one annual status, with the
 * month detail only when coverage actually changed during the year. Guided
 * pages show the annual status as choice cards; professional keeps a select. */
export function QcDrugCoverageEditor({ plan, variant = 'select' }: { plan: InputsV2; variant?: 'select' | 'cards' }) {
  const { t, i18n } = useTranslation()
  const label = usePersonLabel()
  // Local-only reveal of the month detail; never part of the recorded plan.
  // A mixed recorded pattern always re-reveals itself so it cannot hide.
  const [revealMonths, setRevealMonths] = useState<Record<string, boolean>>({})
  const monthNames = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat(i18n.language, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, index, 1))))
  return <>{plan.people.map(person => {
    const months = plan.taxProfile?.qcDrugCoverage?.[person.id] ?? qcCoverageUniform('unknown')
    const annual = qcCoverageAnnualStatus(months)
    const mixed = annual === 'mixed'
    const revealed = mixed || !!revealMonths[person.id]
    // An explicit annual pick is the one action that flattens a mixed pattern;
    // it also closes the month detail.
    const chooseAnnual = (value: QcDrugCoverage) => {
      setRevealMonths(previous => { const { [person.id]: _dropped, ...rest } = previous; return rest })
      commitCanonicalEdit(draft => setQcAnnualCoverage(draft, person.id, value))
    }
    return <fieldset key={person.id} className={variant === 'cards' ? 'qc-coverage-person' : undefined}>
      <legend>{t('be35.coveragePerson', { person: label(person) })}</legend>
      {variant === 'cards' ? <div className="owner-choices" role="radiogroup" aria-label={t('be35.annualStatus')} data-testid={`qc-coverage-all-${person.role}`}>
        {(['public', 'private', 'waived'] as const).map(value => <label key={value} className={annual === value && !revealed ? 'selected' : ''}>
          <input type="radio" name={`qc-coverage-${person.id}`} value={value} checked={annual === value && !revealed}
            data-testid={`qc-coverage-all-${person.role}-${value}`} onChange={() => chooseAnnual(value)} />
          <span>{t(`be35.${value}`)}</span>
        </label>)}
        <label className={revealed ? 'selected' : ''}>
          <input type="radio" name={`qc-coverage-${person.id}`} value="mixed" checked={revealed}
            data-testid={`qc-coverage-changed-${person.role}`} onChange={() => setRevealMonths(previous => ({ ...previous, [person.id]: true }))} />
          <span>{t('be35.changedDuringYear')}</span>
        </label>
      </div> : <><label>{t('be35.annualStatus')}
        <select data-testid={`qc-coverage-all-${person.role}`} value={annual}
          onChange={event => {
            const value = event.target.value
            if (value !== 'mixed') chooseAnnual(value as QcDrugCoverage)
          }}>
          <option value="mixed" disabled>{t('be35.mixed')}</option>
          {(['unknown', 'private', 'public', 'waived'] as const).map(value => <option key={value} value={value}>{t(`be35.${value}`)}</option>)}
        </select>
      </label>
      <label className="qc-change-toggle">
        <input type="checkbox" data-testid={`qc-coverage-changed-${person.role}`}
          checked={revealed}
          onChange={event => setRevealMonths(previous => ({ ...previous, [person.id]: event.target.checked }))} />
        {t('be35.changedDuringYear')}
      </label></>}
      {revealed && <>
        <div className="qc-month-grid">{months.map((status, index) => <label key={index}>{monthNames[index]}
          <select data-testid={`qc-coverage-${person.role}-${index + 1}`} value={status}
            onChange={event => commitCanonicalEdit(draft => {
              draft.taxProfile ??= { spouseSupported: { status: 'unknown', reason: 'not supplied' }, pensionSplit: null }
              draft.taxProfile.qcDrugCoverage ??= {}
              const next = [...(draft.taxProfile.qcDrugCoverage[person.id] ?? qcCoverageUniform('unknown'))]
              next[index] = event.target.value as QcDrugCoverage
              draft.taxProfile.qcDrugCoverage[person.id] = next
            })}>
            {(['unknown', 'private', 'public', 'waived'] as const).map(value => <option key={value} value={value}>{t(`be35.${value}`)}</option>)}
          </select>
        </label>)}</div>
        <p className="hint">{t('be35.monthDetailHelp')}</p>
      </>}
    </fieldset>
  })}</>
}

/** Record one whole-year coverage status for one person. */
export function setQcAnnualCoverage(draft: InputsV2, personId: string, status: QcDrugCoverage): void {
  draft.taxProfile ??= { spouseSupported: { status: 'unknown', reason: 'not supplied' }, pensionSplit: null }
  draft.taxProfile.qcDrugCoverage = applyQcAnnualCoverage(draft.taxProfile.qcDrugCoverage, personId, status)
}

/** Registered-account type and, for a RRIF, the facts its minimum needs. */
export function RegisteredAccountRows({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  const people = plan.people
  const partner = people.find(person => person.role === 'partner')
  return <>{registeredTypeAccounts(plan).map(account => {
    const setRow = (change: (item: Account) => void) => commitRegisteredRowEdit(account.id, change)
    return <div className="tax-facts-row" key={account.id}>
      <label>{t('be11.registeredType')}
        <select data-testid={`registered-type-${account.id}`} value={account.kind} onChange={event => setRow(item => {
          item.kind = event.target.value as 'rrsp' | 'spousalRrsp' | 'rrif' | 'lif'
        })}><option value="rrsp">RRSP</option><option value="spousalRrsp">{t('be11.typeSpousalRrsp')}</option><option value="rrif">RRIF</option><option value="lif">LIF</option></select>
      </label>
      {account.kind === 'rrif' && <>
        <label>{t('be11.rrifOpenedYear')}
          <CommitNumberInput testId="rrif-opened-year" grouping={false}
            value={account.openedYear.status === 'known' ? account.openedYear.value : null}
            onCommit={year => {
              if (year !== null && (!Number.isInteger(year) || year < 1950 || year > 2200)) return
              if (account.openedYear.status === 'known' && year === account.openedYear.value || account.openedYear.status === 'unknown' && year === null) return
              setRow(item => { item.openedYear = year !== null
                ? { status: 'known', value: year } : { status: 'unknown', reason: 'RRIF opening year not supplied' } })
            }} />
        </label>
        <label>{t('be11.rrifFactorCategory')}
          <select data-testid={`rrif-factor-category-${account.id}`}
            value={account.rrifFactorCategory?.status === 'known' ? account.rrifFactorCategory.value : 'unknown'}
            onChange={event => setRow(item => { item.rrifFactorCategory =
              event.target.value === 'unknown' ? { status: 'unknown', reason: 'RRIF factor qualification not confirmed' }
                : { status: 'known', value: event.target.value as 'qualifying' | 'allOther' } })}>
            <option value="unknown">{t('be11.unknown')}</option>
            <option value="qualifying">{t('be11.rrifQualifying')}</option>
            <option value="allOther">{t('be11.rrifAllOther')}</option>
          </select>
        </label>
        <p className="hint">{t('be11.rrifFactorHelp')}{' '}
          <a href="https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/completing-slips-summaries/t4rsp-t4rif-information-returns/payments/chart-prescribed-factors.html"
            target="_blank" rel="noopener noreferrer">{t('be11.rrifFactorSource')}</a>
        </p>
        {partner && <label>{t('be11.rrifAgeElection')}
          <select data-testid="rrif-age-election" value={account.rrifAgeElection?.personId ?? ''}
            onChange={event => setRow(item => { item.rrifAgeElection = event.target.value
              ? { personId: event.target.value, electedAtOpening: true } : null })}>
            <option value="">{t('be11.noElection')}</option>{people.map(person => <option key={person.id} value={person.id}>{t(person.role === 'self' ? 'be11.self' : 'be11.partner')}</option>)}
          </select>
        </label>}
      </>}
    </div>
  })}</>
}

/** The spousal-plan premium histories that drive T2205 attribution. */
export function SpousalHistoryRows({ plan }: { plan: InputsV2 }) {
  return <>{plan.accounts.filter(account =>
    ['rrsp', 'spousalRrsp', 'rrif', 'lif'].includes(account.kind) &&
    (account.kind === 'spousalRrsp' || plan.spousalHistory?.[account.id] !== undefined)).map(account =>
    <SpousalAttributionRow key={account.id} account={account} plan={plan} onEdit={commitCanonicalEdit} />)}</>
}

/** RRSP room rows for every person, with the statement source. */
export function RrspRoomSection({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  return <>
    {plan.people.map(person => <RrspRoomRow key={person.id} person={person} plan={plan} onEdit={commitCanonicalEdit} />)}
    <p className="hint">{t('be12.limit')}{' '}<a href="https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4040/rrsps-other-registered-plans-retirement.html" target="_blank" rel="noopener noreferrer">{t('be12.source')}</a></p>
  </>
}

/** FHSA room rows: one per account holder, never a household bucket. */
export function FhsaRoomSection({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  return <>
    {plan.people.map(person => {
      const resolved = ownFhsaAccount(plan, person.id)
      return <FhsaRoomRow key={person.id} person={person} plan={plan} onEdit={commitCanonicalEdit}
        account={resolved.accountId ? plan.accounts.find(item => item.id === resolved.accountId) : undefined} />
    })}
    {plan.people.some(person => ownFhsaAccount(plan, person.id).ambiguous) && <p className="hint" role="status" data-testid="fhsa-ambiguous">
      {t('be36.ambiguousAccount')}</p>}
    {/* BE-36 A prices one active FHSA per plan, so the couple rows above are
        offered while the projection refuses the year. Say so where the user
        records the accounts instead of only inside the kernel. */}
    {activeFhsaAccounts(plan, plan.baseYear, id => plan.accounts.find(item => item.id === id)?.balance ?? 0).length > 1 &&
      <p className="hint" role="status" data-testid="fhsa-multiple-active">{t('be36.multipleActive')}</p>}
    <p className="hint">{t('be36.scope')}</p>
  </>
}

/** TFSA room rows: room belongs to the person, not an account. */
export function TfsaRoomSection({ plan }: { plan: InputsV2 }) {
  const { t } = useTranslation()
  return <>
    {plan.people.map(person => <TfsaRoomRow key={person.id} person={person} plan={plan} onEdit={commitCanonicalEdit} />)}
    <p className="hint">{t('be27.limit')}{' '}<a href="https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/contributions.html"
      target="_blank" rel="noopener noreferrer">{t('be27.source')}</a></p>
    <p className="hint" data-testid="tfsa-scope">{t('be27.scope')}</p>
  </>
}

/**
 * The shared tax-facts panel. Professional mode shows every section; a guided
 * page can mount just the sections it asks about, so the two modes always edit
 * the same recorded facts through the same transactions.
 */
export function TaxFactsPanel({ sections = ALL_TAX_FACTS_SECTIONS }: { sections?: readonly TaxFactsSection[] }) {
  const { t } = useTranslation()
  const plan = useCanonicalPlan()
  const self = plan.people.find(person => person.role === 'self')
  const partner = plan.people.find(person => person.role === 'partner')
  const show = (section: TaxFactsSection) => sections.includes(section)
  return <section className="tax-facts-panel" data-testid="person-tax-facts" aria-label={t('be11.title')}>
    <h3>{t('be11.title')}</h3>
    <p>{t('be11.explanation')}</p>
    {show('earned') && <EarnedIncomeFields plan={plan} />}
    {partner && self && <>
      {show('ownership') && <>
        <h4>{t('be11.ownership')}</h4>
        <p>{t('be11.splitHelp')}</p>
        <AccountOwnershipRows plan={plan} />
        <PropertyOwnershipRows plan={plan} />
      </>}
      {show('spouseSupport') && <SpouseSupportSelect plan={plan} />}
      {show('pensionSplit') && <PensionSplitFields plan={plan} />}
    </>}
    {show('qcCoverage') && plan.province === 'QC' && plan.people.length === 1 && <LivesAloneSelect plan={plan} />}
    {show('qcCoverage') && plan.province === 'QC' && <div data-testid="qc-drug-coverage">
      <h4>{t('be35.coverageTitle')}</h4>
      <p>{t('be35.coverageHelp')}</p>
      <QcDrugCoverageEditor plan={plan} />
      <p className="hint">{t('be35.publicLimit')}{' '}<a href="https://www.ramq.gouv.qc.ca/en/citizens/prescription-drug-insurance/rates-effect" target="_blank" rel="noopener noreferrer">{t('be35.ramqSource')}</a></p>
    </div>}
    {show('rrspRoom') && <><h4>{t('be12.title')}</h4><RrspRoomSection plan={plan} /></>}
    {show('fhsaRoom') && <><h4>{t('be36.title')}</h4><FhsaRoomSection plan={plan} /></>}
    {/* BE-27 A: TFSA room is per person too, and this row is the only place the
        CRA room figure and the withdrawal history that restores it are recorded.
        Both entry modes mount this panel, so the two never diverge. */}
    {show('tfsaRoom') && <><h4>{t('be27.title')}</h4><TfsaRoomSection plan={plan} /></>}
    {show('registered') && <RegisteredAccountRows plan={plan} />}
    {show('spousal') && <SpousalHistoryRows plan={plan} />}
    <p>{t(plan.province === 'QC' ? 'be35.limit' : 'be11.limit')}</p>
  </section>
}
