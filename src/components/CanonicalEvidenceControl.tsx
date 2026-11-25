import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'
import { refreshCanonicalFromLegacy } from '../engine/migration'
import { assertCanonicalPlan } from '../engine/modelValidation'
import { parseBudgetAmount } from '../forms/localeBudgetAmount'

/** Deliberate current-plan evidence entry, shared by Guide and Pro. */
export function CanonicalEvidenceControl() {
  const { t, i18n } = useTranslation()
  const state = useStore()
  const [working, setWorking] = useState('')
  const [retired, setRetired] = useState('')
  const [mixed, setMixed] = useState('')
  const [excluded, setExcluded] = useState(false)
  const workingAmount = parseBudgetAmount(working, i18n.language)
  const retiredAmount = parseBudgetAmount(retired, i18n.language)
  const mixedAmount = parseBudgetAmount(mixed, i18n.language)
  const hasMortgage = !!state.canonical?.debts.some(debt => debt.kind === 'mortgage') || !!(state.inputs.principalResidence?.mode !== 'planned' && state.inputs.principalResidence?.mortgage)
  const valid = workingAmount !== null && retiredAmount !== null && (!state.inputs.partner || mixedAmount !== null) && (!hasMortgage || excluded)
  const record = () => {
    if (!valid || workingAmount === null || retiredAmount === null || useStore.getState().inputRevision !== state.inputRevision) return
    const current = useStore.getState()
    const plan = structuredClone(current.canonical ?? refreshCanonicalFromLegacy(null, current.inputs))
    const inputs = { ...current.inputs, budgetWorkingSpending: workingAmount, retirementSpending: retiredAmount }
    plan.budget = { kind: 'incomeBudget', workingSpending: workingAmount, retirementSpending: retiredAmount }
    plan.legacyProjection = { ...inputs }
    plan.deterministicProjection = { mode: 'canonical', provenance: { origin: 'user', sourceYear: new Date().getFullYear() }, spending: {
      workingSpending: { status: 'known', value: workingAmount }, retirementSpending: { status: 'known', value: retiredAmount },
      ...(current.inputs.partner ? { transitionSpending: { status: 'known' as const, value: mixedAmount! } } : {}),
      ...(excluded ? { scheduledMortgagePaymentsExcluded: { status: 'known' as const, value: true as const } } : {}),
    } }
    assertCanonicalPlan(plan)
    const draftByField = { ...current.draftByField }
    delete draftByField.retirementSpending
    current.commitPlan({ inputs, canonical: plan, draftByField, answerMeta: { ...current.answerMeta,
      retirementSpending: { status: 'confirmed', origin: 'user', updatedAt: new Date().toISOString() } } })
    if (current.entryMode === 'guided') useStore.getState().setGuidedView('review')
    setWorking(''); setRetired(''); setMixed(''); setExcluded(false)
  }
  const disable = () => {
    const current = useStore.getState()
    if (!current.canonical || current.inputRevision !== state.inputRevision) return
    const plan = structuredClone(current.canonical)
    delete plan.deterministicProjection
    current.commitPlan({ inputs: current.inputs, canonical: plan, answerMeta: current.answerMeta, draftByField: current.draftByField })
    if (current.entryMode === 'guided') useStore.getState().setGuidedView('review')
  }
  return <details className="chart-card" data-testid="canonical-evidence">
    <summary>{t('canonical.title')}</summary>
    <p>{t('canonical.entryScope')}</p>
    <p>{t(state.canonical?.deterministicProjection ? 'canonical.selected' : 'canonical.optional')}</p>
    <label>{t('canonical.working')}<input data-testid="canonical-working-spending" type="text" inputMode="decimal" autoComplete="off" aria-invalid={working.trim() !== '' && workingAmount === null || undefined} value={working} onChange={e => setWorking(e.target.value)} /></label>
    <label>{t('canonical.retired')}<input data-testid="canonical-retirement-spending" type="text" inputMode="decimal" autoComplete="off" aria-invalid={retired.trim() !== '' && retiredAmount === null || undefined} value={retired} onChange={e => setRetired(e.target.value)} /></label>
    {state.inputs.partner && <label>{t('canonical.mixed')}<input data-testid="canonical-transition-spending" type="text" inputMode="decimal" autoComplete="off" aria-invalid={mixed.trim() !== '' && mixedAmount === null || undefined} value={mixed} onChange={e => setMixed(e.target.value)} /></label>}
    <label><input data-testid="canonical-mortgage-excluded" type="checkbox" checked={excluded} onChange={e => setExcluded(e.target.checked)} />{t('canonical.excluded')}</label>
    <p className="hint">{t('canonical.amountBasis', { year: state.canonical?.baseYear ?? new Date().getFullYear() })}</p>
    <button type="button" data-testid="canonical-enable" disabled={!valid} onClick={record}>{t('canonical.enable')}</button>
    {state.canonical?.deterministicProjection && <button type="button" data-testid="canonical-disable" onClick={disable}>{t('canonical.disable')}</button>}
    <label>{t('canonical.strategy')}<select value={state.inputs.strategy} onChange={e => state.set({ strategy: e.target.value as typeof state.inputs.strategy })}>
      <option value="nonRegFirst">{t('strat_nonRegFirst')}</option><option value="meltdownPaced">{t('strat_meltdownPaced')}</option><option value="rrspFirst">{t('strat_rrspFirst')}</option><option value="tfsaFirst">{t('strat_tfsaFirst')}</option>
    </select></label>
    {state.inputs.balances.nonReg === 0 && <button type="button" data-testid="canonical-no-nonreg" onClick={() => state.setAccountPresence('nonReg', false)}>{t('canonical.noNonReg')}</button>}
  </details>
}
