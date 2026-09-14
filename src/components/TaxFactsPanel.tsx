import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account, InputsV2, QcDrugCoverage } from '../engine/model'
import { applyAccountSplit, applyPropertySplit, derivedAccountId, refreshCanonicalFromLegacy, splitAmountsMatch } from '../engine/migration'
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
export function TaxFactsPanel() {
  const { t, i18n } = useTranslation()
  const plan = useStore(state => state.canonical)
  const inputs = useStore(state => state.inputs)
  const commitPlan = useStore(state => state.commitPlan)
  const current = plan ?? refreshCanonicalFromLegacy(null, inputs)
  const people = current.people
  const self = people.find(person => person.role === 'self')
  const partner = people.find(person => person.role === 'partner')
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
        const months = current.taxProfile?.qcDrugCoverage?.[person.id] ?? Array<QcDrugCoverage>(12).fill('unknown')
        const setCoverage = (index: number | null, value: QcDrugCoverage) => edit(draft => {
          draft.taxProfile ??= { spouseSupported: { status: 'unknown', reason: 'not supplied' }, pensionSplit: null }
          draft.taxProfile.qcDrugCoverage ??= {}
          const next = [...(draft.taxProfile.qcDrugCoverage[person.id] ?? Array<QcDrugCoverage>(12).fill('unknown'))]
          if (index === null) next.fill(value)
          else next[index] = value
          draft.taxProfile.qcDrugCoverage[person.id] = next
        })
        return <fieldset key={person.id}>
          <legend>{t('be35.coveragePerson', { person: label })}</legend>
          <label>{t('be35.allMonths')}
            <select data-testid={`qc-coverage-all-${person.role}`} value={months.every(month => month === months[0]) ? months[0] : 'mixed'}
              onChange={event => setCoverage(null, event.target.value as QcDrugCoverage)}>
              <option value="mixed" disabled>{t('be35.mixed')}</option>
              {(['unknown', 'private', 'public', 'waived'] as const).map(value => <option key={value} value={value}>{t(`be35.${value}`)}</option>)}
            </select>
          </label>
          <div className="qc-month-grid">{months.map((status, index) => <label key={index}>{monthNames[index]}
            <select data-testid={`qc-coverage-${person.role}-${index + 1}`} value={status}
              onChange={event => setCoverage(index, event.target.value as QcDrugCoverage)}>
              {(['unknown', 'private', 'public', 'waived'] as const).map(value => <option key={value} value={value}>{t(`be35.${value}`)}</option>)}
            </select>
          </label>)}</div>
        </fieldset>
      })}
      <p className="hint">{t('be35.publicLimit')}{' '}<a href="https://www.ramq.gouv.qc.ca/en/citizens/prescription-drug-insurance/rates-effect" target="_blank" rel="noopener noreferrer">{t('be35.ramqSource')}</a></p>
    </div>}
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
    <p>{t(current.province === 'QC' ? 'be35.limit' : 'be11.limit')}</p>
  </section>
}
