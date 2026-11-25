import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'
import { recordCanonicalBudgets, disableCanonicalProjection, setCanonicalEstimateBudgetMode } from '../forms/canonicalProjectionCommands'
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
    current.commitPlan(recordCanonicalBudgets(current, { working: workingAmount, retired: retiredAmount,
      ...(current.inputs.partner ? { mixed: mixedAmount! } : {}), mortgageExcluded: excluded }))
    if (current.entryMode === 'guided') useStore.getState().setGuidedView('review')
    setWorking(''); setRetired(''); setMixed(''); setExcluded(false)
  }
  const disable = () => {
    const current = useStore.getState()
    if (!current.canonical || current.inputRevision !== state.inputRevision) return
    const transaction = disableCanonicalProjection(current)
    if (!transaction) return
    current.commitPlan(transaction)
    if (current.entryMode === 'guided') useStore.getState().setGuidedView('review')
  }
  const chooseReturnMode = (mode: 'savingsBudget' | 'incomeBudget') => {
    const current = useStore.getState()
    if (current.inputRevision !== state.inputRevision) return
    const transaction = setCanonicalEstimateBudgetMode(current, mode)
    if (!transaction) return
    current.commitPlan(transaction)
    if (current.entryMode === 'guided') useStore.getState().setGuidedView('review')
  }
  return <details className="chart-card" data-testid="canonical-evidence">
    <summary>{t('canonical.title')}</summary>
    <p>{t('canonical.entryScope')}</p>
    <p>{t(state.canonical?.deterministicProjection ? 'canonical.selected' : 'canonical.optional')}</p>
    {state.canonical?.deterministicProjection && !state.canonical.deterministicProjection.estimateBudgetMode && <p className="hint">{t('canonical.priorModeUnavailable')}</p>}
    {state.canonical?.deterministicProjection && <fieldset data-testid="canonical-return-budget">
      <legend>{t('canonical.returnBudgetTitle')}</legend>
      <p className="hint">{t('canonical.returnBudgetHint')}</p>
      <label><input type="radio" name="canonical-return-budget" data-testid="canonical-return-savings"
        checked={state.canonical.deterministicProjection.estimateBudgetMode === 'savingsBudget'} onChange={() => chooseReturnMode('savingsBudget')} />{t('budget.modeSavings')}</label>
      <label><input type="radio" name="canonical-return-budget" data-testid="canonical-return-income"
        checked={state.canonical.deterministicProjection.estimateBudgetMode === 'incomeBudget'} onChange={() => chooseReturnMode('incomeBudget')} />{t('budget.modeIncome')}</label>
    </fieldset>}
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
