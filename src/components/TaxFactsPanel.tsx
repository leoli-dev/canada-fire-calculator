import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account, InputsV2, Known, Person, QcDrugCoverage } from '../engine/model'
import { applyAccountSplit, applyPropertySplit, derivedAccountId, refreshCanonicalFromLegacy, splitAmountsMatch } from '../engine/migration'
import { applyQcAnnualCoverage, qcCoverageAnnualStatus, qcCoverageUniform } from '../engine/quebecTax'
import { ownRrspAccount, previewRrspRoomYear } from '../engine/rrspRoom'
import { attributeSpousalPayment, spousalPremiumLines } from '../engine/spousalAttribution'
import { useStore } from '../store'

const SPLIT_ROW_BASE_IDS = ['legacy:account:tfsa', 'legacy:account:rrsp', 'legacy:account:nonReg', 'legacy:account:locked'] as const
const roundCents = (value: number) => Math.round(value * 100) / 100

/** Two per-person amount inputs for one household total. Shows the live
 * arithmetic and commits only while the two amounts add up to the total; a
 * mismatch stays visible and never writes a partial split. */
function SplitAmounts({ rowId, total, selfAmount, partnerAmount, selfTestId, partnerTestId, onCommit }: {
  rowId: string
  total: number
  selfAmount: number | undefined
  partnerAmount: number | undefined
  selfTestId: string
  partnerTestId: string
  onCommit: (selfAmount: number, partnerAmount: number) => void
}) {
  const { t, i18n } = useTranslation()
  const [selfRaw, setSelfRaw] = useState(selfAmount === undefined ? '' : String(roundCents(selfAmount)))
  const [partnerRaw, setPartnerRaw] = useState(partnerAmount === undefined ? '' : String(roundCents(partnerAmount)))
  const parse = (raw: string): number | null => {
    const text = raw.trim()
    if (!text) return null
    const value = Number(text)
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  const selfValue = parse(selfRaw)
  const partnerValue = parse(partnerRaw)
  const sum = selfValue !== null && partnerValue !== null ? selfValue + partnerValue : null
  const matches = sum !== null && splitAmountsMatch(selfValue!, partnerValue!, total)
  const unchanged = sum !== null && selfAmount !== undefined && partnerAmount !== undefined &&
    Math.abs(selfValue! - selfAmount) <= 1e-8 && Math.abs(partnerValue! - partnerAmount) <= 1e-8
  const locale = i18n.language
  const confirm = () => { if (matches && !unchanged) onCommit(selfValue!, partnerValue!) }
  return <>
    <label>{t('be11.selfAmount')}
      <input type="number" min="0" step="0.01" data-testid={selfTestId} value={selfRaw}
        onChange={event => setSelfRaw(event.target.value)} onBlur={confirm} /></label>
    <label>{t('be11.partnerAmount')}
      <input type="number" min="0" step="0.01" data-testid={partnerTestId} value={partnerRaw}
        onChange={event => setPartnerRaw(event.target.value)} onBlur={confirm} /></label>
    <p data-testid={`ownership-sum-${rowId}`}>{t('be11.splitSum', {
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
function RrspRoomRow({ person, plan, onEdit }: { person: Person; plan: InputsV2; onEdit: (change: (draft: InputsV2) => void) => void }) {
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
    <h5>{t('be12.person', { person: t(person.role === 'self' ? 'be11.self' : 'be11.partner') })}</h5>
    <p className="hint">{t('be12.explanation')}</p>
    {RRSP_STATEMENT_FIELDS.map(([field, label]) => <label key={field}>{t(label)}
      <input type="number" min="0" step="1" data-testid={`${field === 'rrspDeductionLimit' ? 'rrsp-deduction-limit' :
        field === 'rrspAvailableRoom' ? 'rrsp-available-room' :
        field === 'rrspUnusedUndeducted' ? 'rrsp-unused-undeducted' :
        field === 'rrspPensionAdjustment' ? 'rrsp-pa' : field === 'rrspPspa' ? 'rrsp-pspa' : 'rrsp-par'}-${role}`}
        key={`${field}:${person.id}:${person[field].status === 'known' ? person[field].value : 'unknown'}`}
        defaultValue={person[field].status === 'known' ? person[field].value : ''}
        placeholder={t('be12.unknown')}
        onBlur={event => commit(field, event.currentTarget.value)} />
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
            <input type="number" min="0" step="1" data-testid={`rrsp-planned-${role}`}
              key={`planned:${person.id}:${planned?.amount ?? 'none'}`}
              defaultValue={planned?.amount ?? ''}
              placeholder={t('be12.zero')}
              onBlur={event => {
                const text = event.currentTarget.value.trim()
                const amount = text === '' ? null : Number(text)
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
 * BE-12 B: the recorded premium history of one spousal plan and a T2205 split
 * preview. The history-completeness state is explicit, so "no premiums" is a
 * user answer and an unrecorded history never silently becomes zero. Shared by
 * both entry modes because both mount this panel.
 */
function SpousalAttributionRow({ account, plan, onEdit }: { account: Account; plan: InputsV2; onEdit: (change: (draft: InputsV2) => void) => void }) {
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
  // A stable, collision-free row id keeps reload and mode switches deterministic.
  const nextRowId = () => {
    const used = new Set(plan.contributions.map(contribution => contribution.id))
    let serial = 0
    while (used.has(`be12:spousal:${account.id}:${serial}`)) serial += 1
    return `be12:spousal:${account.id}:${serial}`
  }
  const addRow = () => onEdit(draft => {
    draft.contributions.push({
      id: nextRowId(), accountId: account.id, contributorId: spouse?.id ?? null,
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
  const paymentText = paymentRaw.trim()
  const payment = paymentText === '' ? Number.NaN : Number(paymentText)
  const preview = complete && annuitant && spouse && Number.isFinite(payment) && payment > 0
    ? attributeSpousalPayment({
      payment, paymentYear: plan.baseYear, contributorId: spouse.id, annuitantId: annuitant.id,
      premiums: spousalPremiumLines(plan.contributions, account.id),
      // A spousal RRSP has no required minimum; the spousal-RRIF path is not
      // identified by the account model yet, so it is not previewed here.
      rrifMinimum: null, annuitantIncomeBefore: 0,
    })
    : null
  return <div data-testid={`spousal-attribution-${account.id}`}>
    <h5>{t('be12.spousalTitle')}</h5>
    <p className="hint">{t('be12.spousalExplanation')}</p>
    <label>{t('be12.spousalHistory')}
      <select data-testid={`spousal-history-${account.id}`} value={complete ? 'complete' : 'unknown'}
        onChange={event => setHistory(event.target.value === 'complete' ? 'complete' : 'unknown')}>
        <option value="unknown">{t('be12.spousalHistoryUnknown')}</option>
        <option value="complete">{t('be12.spousalHistoryComplete')}</option>
      </select>
    </label>
    {rows.map(row => <div key={row.id} data-testid={`spousal-row-${row.id}`}>
      <label>{t('be12.spousalYear')}
        <input type="number" min="1950" max="2200" step="1" data-testid={`spousal-year-${row.id}`}
          key={`year:${row.id}:${row.calendarYear}`} defaultValue={row.calendarYear}
          onBlur={event => {
            const year = Number(event.currentTarget.value)
            if (!Number.isInteger(year) || year < 1950 || year > 2200 || year === row.calendarYear) return
            setRow(row.id, contribution => { contribution.calendarYear = year })
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
        <input type="number" min="0" step="1" data-testid={`spousal-amount-${row.id}`}
          key={`amount:${row.id}:${row.amount}`} defaultValue={row.amount}
          onBlur={event => {
            const amount = Number(event.currentTarget.value)
            if (!Number.isFinite(amount) || amount < 0 || amount === row.amount) return
            setRow(row.id, contribution => { contribution.amount = amount })
          }} />
      </label>
      <button type="button" data-testid={`spousal-remove-${row.id}`}
        onClick={() => removeRow(row.id)}>{t('be12.spousalRemove')}</button>
    </div>)}
    <button type="button" data-testid={`spousal-add-${account.id}`} onClick={addRow}>{t('be12.spousalAdd')}</button>
    <p className="hint" data-testid={`spousal-window-${account.id}`}>{t('be12.spousalWindow', {
      year: plan.baseYear, years: [plan.baseYear - 2, plan.baseYear - 1, plan.baseYear].join(', ') })}</p>
    {!complete && <p className="hint" role="status" data-testid={`spousal-unknown-${account.id}`}>{t('be12.spousalNoHistory')}</p>}
    {complete && <label>{t('be12.spousalPaymentTest')}
      <input type="number" min="0" step="1" data-testid={`spousal-payment-${account.id}`}
        value={paymentRaw} onChange={event => setPaymentRaw(event.target.value)} />
    </label>}
    {preview && preview.status === 'ok' && <p data-testid={`spousal-split-${account.id}`}>{t('be12.spousalSplit', {
      contributor: label(spouse?.id), attributed: money(preview.attributedToContributor),
      annuitant: label(annuitant?.id), taxed: money(preview.taxedToAnnuitant),
    })}</p>}
    {preview && preview.status !== 'ok' && <p className="hint" role="status" data-testid={`spousal-unsupported-${account.id}`}>
      {t('be12.spousalUnsupported', { reason: preview.reason })}</p>}
    <p className="hint">{t('be12.spousalLimit')}{' '}<a href="https://www.canada.ca/en/revenue-agency/services/forms-publications/forms/t2205.html"
      target="_blank" rel="noopener noreferrer">{t('be12.spousalSource')}</a></p>
  </div>
}

export function TaxFactsPanel() {
  const { t, i18n } = useTranslation()
  const plan = useStore(state => state.canonical)
  const inputs = useStore(state => state.inputs)
  const commitPlan = useStore(state => state.commitPlan)
  const current = plan ?? refreshCanonicalFromLegacy(null, inputs)
  const people = current.people
  const self = people.find(person => person.role === 'self')
  const partner = people.find(person => person.role === 'partner')
  // Local-only reveal of the month detail; never part of the recorded plan.
  // A mixed recorded pattern always re-reveals itself so it cannot hide.
  const [revealMonths, setRevealMonths] = useState<Record<string, boolean>>({})
  const monthNames = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat(i18n.language, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, index, 1))))
  const edit = (change: (draft: InputsV2) => void) => {
    const state = useStore.getState()
    const draft = structuredClone(state.canonical ?? refreshCanonicalFromLegacy(null, state.inputs))
    change(draft)
    draft.migration.ownershipNeedsConfirmation = draft.accounts.some(account => account.kind !== 'nonReg' && !account.ownerId || account.taxableOwnerShares.status === 'unknown') ||
      draft.properties.some(property => property.taxableOwnerShares.status === 'unknown')
    commitPlan({ inputs: state.inputs, canonical: draft, answerMeta: state.answerMeta,
      draftByField: state.draftByField })
  }
  const ownerOptions = <>
    <option value="">{t('be11.unknown')}</option>
    <option value="shared" disabled>{t('be11.shared')}</option>
    <option value="split" disabled>{t('be11.splitOwners')}</option>
    {people.map(person => <option key={person.id} value={person.id}>{t(person.role === 'self' ? 'be11.self' : 'be11.partner')}</option>)}
  </>
  const rowAccounts = SPLIT_ROW_BASE_IDS.map((baseId): { baseId: string; base: Account | undefined; derived: Account | undefined } => ({
    baseId,
    base: current.accounts.find(account => account.id === baseId),
    derived: current.accounts.find(account => account.id === derivedAccountId(baseId)),
  })).filter((row): row is { baseId: string; base: Account | undefined; derived: Account | undefined } => !!row.base || !!row.derived)
  return <section className="hint" data-testid="person-tax-facts" aria-label={t('be11.title')}>
    <h3>{t('be11.title')}</h3>
    <p>{t('be11.explanation')}</p>
    {people.map(person => <label key={person.id}>
      {t('be11.earned', { person: t(person.role === 'self' ? 'be11.self' : 'be11.partner') })}
      <input data-testid={`earned-${person.role}`} type="number" min="0" step="1"
        key={`${person.id}:${person.earnedIncome.status === 'known' ? person.earnedIncome.value : 'unknown'}`}
        defaultValue={person.earnedIncome.status === 'known' ? person.earnedIncome.value : ''}
        placeholder={t('be11.unknown')}
        onBlur={event => {
          const raw = event.currentTarget.value.trim()
          const next = raw === '' ? null : Number(raw)
          if (next !== null && (!Number.isFinite(next) || next < 0)) return
          if (person.earnedIncome.status === 'known' && next === person.earnedIncome.value ||
              person.earnedIncome.status === 'unknown' && next === null) return
          edit(draft => { draft.people.find(item => item.id === person.id)!.earnedIncome = next === null
            ? { status: 'unknown', reason: 'employment amount not supplied' } : { status: 'known', value: next } })
        }} />
    </label>)}
    {partner && self && <>
      <h4>{t('be11.ownership')}</h4>
      <p>{t('be11.splitHelp')}</p>
      {rowAccounts.map(({ baseId, base, derived }) => {
        const account = base ?? derived!
        const total = (base?.balance ?? 0) + (derived?.balance ?? 0)
        const registered = account.kind !== 'nonReg'
        const entry = current.ownershipAmounts?.[baseId]
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
        return <div key={`${baseId}:${account.kind}:${total}:${JSON.stringify(entry ?? null)}:${base?.ownerId ?? ''}:${derived?.ownerId ?? ''}:${JSON.stringify(account.taxableOwnerShares)}`}
          data-testid={`ownership-row-${baseId}`}>
          <label>{account.kind} — {total.toLocaleString()} CAD
            <select data-testid={`owner-${baseId}`} value={selectValue} onChange={event => edit(draft => {
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
            onCommit={(selfAmt, partnerAmt) => edit(draft => applyAccountSplit(draft, baseId, selfAmt, partnerAmt))} />
          {baseId === 'legacy:account:locked' && <p className="hint">{t('be11.lockedOwnerResetHelp')}</p>}
          {!registered && <label>{t('be11.selfTaxShare')}
            <input type="number" min="0" max="100" step="1" data-testid={`account-self-share-${baseId}`}
              key={`share:${baseId}:${account.taxableOwnerShares.status === 'known' ? account.taxableOwnerShares.shares[self.id] ?? 0 : 'unknown'}`}
              defaultValue={account.taxableOwnerShares.status === 'known' ? (account.taxableOwnerShares.shares[self.id] ?? 0) * 100 : ''}
              onBlur={event => {
                const raw = event.currentTarget.value.trim()
                if (!raw) return
                const pct = Number(raw)
                if (!Number.isFinite(pct) || pct < 0 || pct > 100) return
                if (account.taxableOwnerShares.status === 'known' && Math.abs((account.taxableOwnerShares.shares[self.id] ?? 0) * 100 - pct) < 1e-8) return
                edit(draft => {
                  const item = draft.accounts.find(candidate => candidate.id === baseId)!
                  item.taxableOwnerShares = { status: 'known', shares: { [self.id]: pct / 100, [partner.id]: 1 - pct / 100 } }
                  item.ownerId = pct === 100 ? self.id : pct === 0 ? partner.id : null
                })
              }} />%
          </label>}
        </div>
      })}
      {current.properties.filter(property => property.kind === 'investment').map(property => {
        const selfAmount = property.taxableOwnerShares.status === 'known'
          ? roundCents((property.taxableOwnerShares.shares[self.id] ?? 0) * property.value) : undefined
        const partnerAmount = property.taxableOwnerShares.status === 'known' && selfAmount !== undefined
          ? roundCents(property.value - selfAmount) : undefined
        return <div key={`${property.id}:${property.value}:${JSON.stringify(property.taxableOwnerShares)}`}
          data-testid={`ownership-row-${property.id}`}>
          <label>{t('be11.propertyOwner')}
            <select data-testid={`property-owner-${property.id}`}
              value={property.taxableOwnerShares.status === 'known' ? Object.keys(property.taxableOwnerShares.shares).find(id => property.taxableOwnerShares.status === 'known' && property.taxableOwnerShares.shares[id] === 1) ?? 'shared' : ''}
              onChange={event => edit(draft => {
                const item = draft.properties.find(candidate => candidate.id === property.id)!
                item.taxableOwnerShares = event.target.value ? { status: 'known', shares: { [event.target.value]: 1 } }
                  : { status: 'unknown', reason: 'property taxable owner not assigned' }
              })}>{ownerOptions}</select>
          </label>
          <SplitAmounts rowId={property.id} total={property.value} selfAmount={selfAmount} partnerAmount={partnerAmount}
            selfTestId={`property-self-amount-${property.id}`} partnerTestId={`property-partner-amount-${property.id}`}
            onCommit={(selfAmt, partnerAmt) => edit(draft => applyPropertySplit(draft, property.id, selfAmt, partnerAmt))} />
          <label>{t('be11.selfTaxShare')}
            <input type="number" min="0" max="100" step="1" data-testid={`property-self-share-${property.id}`}
              key={`share:${property.id}:${property.taxableOwnerShares.status === 'known' ? property.taxableOwnerShares.shares[self.id] ?? 0 : 'unknown'}`}
              defaultValue={property.taxableOwnerShares.status === 'known' ? (property.taxableOwnerShares.shares[self.id] ?? 0) * 100 : ''}
              onBlur={event => {
                const raw = event.currentTarget.value.trim()
                if (!raw) return
                const pct = Number(raw)
                if (!Number.isFinite(pct) || pct < 0 || pct > 100) return
                if (property.taxableOwnerShares.status === 'known' && Math.abs((property.taxableOwnerShares.shares[self.id] ?? 0) * 100 - pct) < 1e-8) return
                edit(draft => { draft.properties.find(item => item.id === property.id)!.taxableOwnerShares = {
                  status: 'known', shares: { [self.id]: pct / 100, [partner.id]: 1 - pct / 100 },
                } })
              }} />%
          </label>
        </div>
      })}
      <label>{t('be11.spouseSupport')}
        <select data-testid="spouse-support" value={current.taxProfile?.spouseSupported.status === 'known' ? String(current.taxProfile.spouseSupported.value) : 'unknown'}
          onChange={event => edit(draft => {
            draft.taxProfile ??= { spouseSupported: { status: 'unknown', reason: 'not supplied' }, pensionSplit: null }
            draft.taxProfile.spouseSupported = event.target.value === 'unknown' ? { status: 'unknown', reason: 'not confirmed' }
              : { status: 'known', value: event.target.value === 'true' }
          })}>
          <option value="unknown">{t('be11.unknown')}</option><option value="true">{t('be11.yes')}</option><option value="false">{t('be11.no')}</option>
        </select>
      </label>
      <label>{t('be11.splitTransferor')}
        <select data-testid="split-transferor" value={current.taxProfile?.pensionSplit?.transferorId ?? ''}
          onChange={event => edit(draft => {
            draft.taxProfile ??= { spouseSupported: { status: 'unknown', reason: 'not supplied' }, pensionSplit: null }
            const transferorId = event.target.value
            const recipientId = draft.people.find(item => item.id !== transferorId)?.id
            draft.taxProfile.pensionSplit = transferorId && recipientId ? { transferorId, recipientId, amount: 0 } : null
          })}><option value="">{t('be11.noSplit')}</option>{people.map(person => <option key={person.id} value={person.id}>{t(person.role === 'self' ? 'be11.self' : 'be11.partner')}</option>)}</select>
      </label>
      {current.taxProfile?.pensionSplit && <label>{t('be11.splitAmount')}
        <input type="number" min="0" step="1" data-testid="split-amount"
          key={`split:${current.taxProfile.pensionSplit.transferorId}:${current.taxProfile.pensionSplit.amount}`}
          defaultValue={current.taxProfile.pensionSplit.amount}
          onBlur={event => {
            const amount = Number(event.currentTarget.value)
            if (!Number.isFinite(amount) || amount < 0 || amount === current.taxProfile?.pensionSplit?.amount) return
            edit(draft => { if (draft.taxProfile?.pensionSplit) draft.taxProfile.pensionSplit.amount = amount })
          }} />
      </label>}
      {current.province === 'QC' && <>
        <label>{t('be35.qcSplitTransferor')}
          <select data-testid="qc-split-transferor" value={current.taxProfile?.qcPensionSplit?.transferorId ?? ''}
            onChange={event => edit(draft => {
              draft.taxProfile ??= { spouseSupported: { status: 'unknown', reason: 'not supplied' }, pensionSplit: null }
              const transferorId = event.target.value
              const recipientId = draft.people.find(item => item.id !== transferorId)?.id
              draft.taxProfile.qcPensionSplit = transferorId && recipientId ? { transferorId, recipientId, amount: 0 } : null
            })}><option value="">{t('be11.noSplit')}</option>{people.map(person => <option key={person.id} value={person.id}>{t(person.role === 'self' ? 'be11.self' : 'be11.partner')}</option>)}</select>
        </label>
        {current.taxProfile?.qcPensionSplit && <label>{t('be35.qcSplitAmount')}
          <input type="number" min="0" step="1" data-testid="qc-split-amount"
            key={`qc-split:${current.taxProfile.qcPensionSplit.transferorId}:${current.taxProfile.qcPensionSplit.amount}`}
            defaultValue={current.taxProfile.qcPensionSplit.amount}
            onBlur={event => {
              const amount = Number(event.currentTarget.value)
              if (!Number.isFinite(amount) || amount < 0 || amount === current.taxProfile?.qcPensionSplit?.amount) return
              edit(draft => { if (draft.taxProfile?.qcPensionSplit) draft.taxProfile.qcPensionSplit.amount = amount })
            }} />
        </label>}
        <p className="hint">{t('be35.splitHelp')}</p>
      </>}
    </>}
    {current.province === 'QC' && <div data-testid="qc-drug-coverage">
      <h4>{t('be35.coverageTitle')}</h4>
      <p>{t('be35.coverageHelp')}</p>
      {people.map(person => {
        const label = t(person.role === 'self' ? 'be11.self' : 'be11.partner')
        const months = current.taxProfile?.qcDrugCoverage?.[person.id] ?? qcCoverageUniform('unknown')
        const annual = qcCoverageAnnualStatus(months)
        const mixed = annual === 'mixed'
        const revealed = mixed || !!revealMonths[person.id]
        return <fieldset key={person.id}>
          <legend>{t('be35.coveragePerson', { person: label })}</legend>
          <label>{t('be35.annualStatus')}
            <select data-testid={`qc-coverage-all-${person.role}`} value={annual}
              onChange={event => {
                const value = event.target.value
                if (value === 'mixed') return
                // An explicit annual pick is the one action that flattens a
                // mixed pattern; it also closes the month detail.
                setRevealMonths(previous => { const { [person.id]: _dropped, ...rest } = previous; return rest })
                edit(draft => {
                  draft.taxProfile ??= { spouseSupported: { status: 'unknown', reason: 'not supplied' }, pensionSplit: null }
                  draft.taxProfile.qcDrugCoverage = applyQcAnnualCoverage(draft.taxProfile.qcDrugCoverage, person.id, value as QcDrugCoverage)
                })
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
          </label>
          {revealed && <>
            <div className="qc-month-grid">{months.map((status, index) => <label key={index}>{monthNames[index]}
              <select data-testid={`qc-coverage-${person.role}-${index + 1}`} value={status}
                onChange={event => edit(draft => {
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
      })}
      <p className="hint">{t('be35.publicLimit')}{' '}<a href="https://www.ramq.gouv.qc.ca/en/citizens/prescription-drug-insurance/rates-effect" target="_blank" rel="noopener noreferrer">{t('be35.ramqSource')}</a></p>
    </div>}
    <h4>{t('be12.title')}</h4>
    {people.map(person => <RrspRoomRow key={person.id} person={person} plan={current} onEdit={edit} />)}
    <p className="hint">{t('be12.limit')}{' '}<a href="https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4040/rrsps-other-registered-plans-retirement.html" target="_blank" rel="noopener noreferrer">{t('be12.source')}</a></p>
    {current.accounts.filter(account => ['rrsp', 'spousalRrsp', 'rrif', 'lif'].includes(account.kind) && !account.id.endsWith(':partner')).map(account => {
      const rowIds = [account.id, derivedAccountId(account.id)]
      const setRow = (change: (item: Account) => void) => edit(draft => {
        for (const item of draft.accounts) if (rowIds.includes(item.id)) change(item)
      })
      return <div key={account.id}>
        <label>{t('be11.registeredType')}
          <select data-testid={`registered-type-${account.id}`} value={account.kind} onChange={event => setRow(item => {
            item.kind = event.target.value as 'rrsp' | 'spousalRrsp' | 'rrif' | 'lif'
          })}><option value="rrsp">RRSP</option><option value="spousalRrsp">Spousal RRSP</option><option value="rrif">RRIF</option><option value="lif">LIF</option></select>
        </label>
        {account.kind === 'rrif' && <>
          <label>{t('be11.rrifOpenedYear')}
            <input type="number" min="1950" max="2200" step="1" data-testid="rrif-opened-year"
              key={`opened:${account.id}:${account.openedYear.status === 'known' ? account.openedYear.value : 'unknown'}`}
              defaultValue={account.openedYear.status === 'known' ? account.openedYear.value : ''}
              onBlur={event => {
                const raw = event.currentTarget.value.trim()
                const year = Number(raw)
                if (raw && (!Number.isInteger(year) || year < 1950 || year > 2200)) return
                if (account.openedYear.status === 'known' && year === account.openedYear.value || account.openedYear.status === 'unknown' && !raw) return
                setRow(item => { item.openedYear = raw
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
    })}
    {current.accounts.filter(account => account.kind === 'spousalRrsp').map(account =>
      <SpousalAttributionRow key={account.id} account={account} plan={current} onEdit={edit} />)}
    <p>{t(current.province === 'QC' ? 'be35.limit' : 'be11.limit')}</p>
  </section>
}
