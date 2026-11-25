import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Inputs } from '../engine'
import type { InputsV2 } from '../engine/model'
import { CANONICAL_PLANNING_LIMIT, evaluateCanonicalCandidates, type CanonicalPlanningEvaluation } from '../canonicalPlanning'
import { canonicalAnnualSheet } from '../canonicalAnnualSheet'
import { parseBudgetAmount } from '../forms/localeBudgetAmount'
import { useStore } from '../store'
import { CanonicalResults } from './CanonicalResults'
import { AnnualSheetDialog } from './AnnualSheetDialog'

type CanonicalPlanningToolProps = {
  inputs: Inputs; plan: InputsV2; nonRegAbsent: boolean; revision: number; entryMode: 'guided' | 'professional'
}

/** Drafts, outcomes and dialogs belong to one exact source snapshot. Reset
 * during render so a replacement cannot commit a frame with the old draft,
 * or let a later effect erase an edit already made against the new source. */
export function CanonicalPlanningTool(props: CanonicalPlanningToolProps) {
  const { i18n } = useTranslation()
  const [source, setSource] = useState(() => ({ ...props, language: i18n.language, generation: 0 }))
  if (source.inputs !== props.inputs || source.plan !== props.plan || source.nonRegAbsent !== props.nonRegAbsent ||
    source.revision !== props.revision || source.entryMode !== props.entryMode || source.language !== i18n.language) {
    setSource({ ...props, language: i18n.language, generation: source.generation + 1 })
    return null
  }
  return <CanonicalPlanningDraft key={source.generation} {...props} />
}

/** Current revision only, deliberately local: experiments never commit a plan. */
function CanonicalPlanningDraft({ inputs, plan, nonRegAbsent, revision, entryMode }: CanonicalPlanningToolProps) {
  const { t, i18n } = useTranslation()
  const self = plan.people.find(person => person.role === 'self')
  const [age, setAge] = useState(String(self?.retirementAge ?? inputs.fireAge))
  const [spending, setSpending] = useState(() => new Intl.NumberFormat(i18n.language, { useGrouping: false, maximumSignificantDigits: 21 }).format(plan.budget.retirementSpending))
  const [comparison, setComparison] = useState<{ inputs: Inputs; plan: InputsV2; nonRegAbsent: boolean; outcomes: CanonicalPlanningEvaluation[] }>({ inputs, plan, nonRegAbsent, outcomes: [] })
  // Reference changes invalidate a result synchronously, even if an external
  // caller replaced a snapshot without advancing the ordinary edit revision.
  const outcomes = comparison.inputs === inputs && comparison.plan === plan && comparison.nonRegAbsent === nonRegAbsent ? comparison.outcomes : []
  const [limited, setLimited] = useState(false)
  const [sheet, setSheet] = useState<number | null>(null)
  const moneyMode = useStore(state => state.displayMode)
  const current = () => {
    const state = useStore.getState()
    const nonRegMeta = state.answerMeta['balances.nonReg']
    const currentNonRegAbsent = nonRegMeta?.status === 'notApplicable' && nonRegMeta.origin === 'user'
    return state.inputRevision === revision && state.entryMode === entryMode && state.inputs === inputs && state.canonical === plan &&
      currentNonRegAbsent === nonRegAbsent &&
      (entryMode === 'professional' || state.guidedView === 'results' && state.resultRevision === revision)
  }
  const evaluate = () => {
    if (!current()) return
    if (outcomes.length >= CANONICAL_PLANNING_LIMIT) { setLimited(true); return }
    const retirementAge = /^\d+$/.test(age.trim()) ? Number(age.trim()) : NaN
    const retirementSpending = parseBudgetAmount(spending, i18n.language) ?? NaN
    const [outcome] = evaluateCanonicalCandidates(inputs, plan, { nonRegAbsent }, [{ retirementAge, retirementSpending }])
    setComparison({ inputs, plan, nonRegAbsent, outcomes: [...outcomes, outcome] }); setSheet(null)
  }
  const sheetOutcome = sheet === null ? null : outcomes[sheet]
  const sheetModel = sheetOutcome?.result?.coverage ? canonicalAnnualSheet(sheetOutcome.result.coverage, { scenarioId: `candidate-${sheet}`, revision }) : null
  return <section className="chart-card" data-testid="canonical-planning">
    <h2>{t('planning.title')}</h2>
    <p>{t('planning.scope')}</p>
    <p className="hint">{t('planning.evidence')}</p>
    <p className="hint">{t('planning.bounds', { count: CANONICAL_PLANNING_LIMIT })}</p>
    <form onSubmit={event => { event.preventDefault(); evaluate() }}>
      <label>{t('planning.age')}<input data-testid="planning-retirement-age" type="text" inputMode="numeric" value={age} onChange={event => { setAge(event.target.value); setLimited(false) }} /></label>
      <label>{t('planning.spending', { year: plan.baseYear })}<input data-testid="planning-retirement-spending" type="text" inputMode="decimal" value={spending} onChange={event => { setSpending(event.target.value); setLimited(false) }} /></label>
      <button type="submit" data-testid="planning-evaluate">{t('planning.evaluate')}</button>
      <button type="button" data-testid="planning-reset" onClick={() => { setComparison({ inputs, plan, nonRegAbsent, outcomes: [] }); setLimited(false); setSheet(null) }}>{t('planning.reset')}</button>
    </form>
    <p>{t('planning.count', { count: outcomes.length, max: CANONICAL_PLANNING_LIMIT })}</p>
    {limited && outcomes.length >= CANONICAL_PLANNING_LIMIT && <p role="status" data-testid="planning-limit">{t('planning.status.search-limit')}</p>}
    {outcomes.map((outcome, index) => {
      const model = outcome.result?.coverage ? canonicalAnnualSheet(outcome.result.coverage, { scenarioId: `candidate-${index}`, revision }) : null
      return <details key={index} open={index === outcomes.length - 1} data-testid="planning-outcome" data-status={outcome.status}>
        <summary>{t('planning.candidate', { index: index + 1 })}: {t(`planning.status.${outcome.status}`)}</summary>
        <p>{t('planning.facts', { age: Number.isFinite(outcome.candidate.retirementAge) ? outcome.candidate.retirementAge : '—',
          year: self && Number.isFinite(outcome.candidate.retirementAge) ? plan.baseYear + outcome.candidate.retirementAge - self.ageInBaseYear : '—',
          amount: Number.isFinite(outcome.candidate.retirementSpending) ? new Intl.NumberFormat(i18n.language, { maximumSignificantDigits: 21 }).format(outcome.candidate.retirementSpending) : '—', baseYear: plan.baseYear })}</p>
        <p role="status">{t(`planning.status.${outcome.status}`)}</p>
        {outcome.reason && <p role="alert">{t(`planning.reason.${outcome.reason}`)}</p>}
        {!!outcome.livingGapYears.length && <p>{t('planning.livingGaps', { years: outcome.livingGapYears.join(', ') })}</p>}
        {!!outcome.eventGapYears.length && <p>{t('planning.eventGaps', { years: outcome.eventGapYears.join(', ') })}</p>}
        {outcome.result && <CanonicalResults result={outcome.result} model={model} />}
        {model && <button type="button" data-testid="planning-sheet" onClick={() => { if (current()) setSheet(index) }}>{t('planning.sheet')}</button>}
      </details>
    })}
    {sheetModel && <AnnualSheetDialog open={true} model={sheetModel} moneyMode={moneyMode} onClose={() => setSheet(null)} />}
  </section>
}
