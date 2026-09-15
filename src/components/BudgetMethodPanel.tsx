import { useTranslation } from 'react-i18next'
import { useStore } from '../store'
import { useCad } from '../format'
import { budgetFacts } from '../engine/budgetSemantics'
import type { BudgetMode, BudgetReconciliation } from '../engine/model'
import { NumberInput } from './NumberInput'

/**
 * BE-13 A. The one place a user answers what the plan's saving figure means:
 * the budget mode and, for `savingsBudget`, whether that figure is already net
 * of the separately listed loan payments and of the registered-contribution
 * tax difference. The same panel serves guided and professional so both entry
 * modes record the identical canonical facts.
 */

/** The state line's untouched text: only `ready` needs the recorded amount. */
export function budgetStateLabel(budget: BudgetMode): { key: string; params?: Record<string, string> } {
  const facts = budgetFacts(budget)
  if (facts.status === 'ready') return { key: 'budget.stateReady' }
  if (facts.status === 'needs-facts') return { key: 'budget.stateUnknown', params: { fields: facts.unconfirmed.map(field => field === 'budget.debtIncluded' ? 'budget.fieldDebt' : 'budget.fieldTax').join(', ') } }
  if (facts.status === 'income-budget') return { key: 'budget.stateIncome', params: { detail: facts.detail } }
  return { key: 'budget.stateKnownFalse', params: { detail: facts.detail } }
}

function TraceAnswer(props: {
  legend: string
  detail: string
  name: string
  value: boolean | undefined
  onChange: (value: boolean) => void
  testId: string
}) {
  const { t } = useTranslation()
  return <div className="budget-fact" data-testid={props.testId} role="group" aria-label={props.legend}>
    <p className="budget-fact-title">{props.legend}</p>
    <p className="hint">{props.detail}</p>
    <div className="choice-group" role="radiogroup" aria-label={props.legend}>
      {([true, false] as const).map((value) => <label key={String(value)} className={props.value === value ? 'selected' : ''}>
        <input type="radio" name={props.name} checked={props.value === value} data-testid={`${props.testId}-${value ? 'yes' : 'no'}`}
          onChange={() => props.onChange(value)} />
        <span><strong>{t(value ? 'budget.yes' : 'budget.no')}</strong></span>
      </label>)}
    </div>
  </div>
}

export function BudgetMethodPanel() {
  const { t } = useTranslation()
  const cad = useCad()
  const setBudgetChoice = useStore((s) => s.setBudgetChoice)
  const set = useStore((s) => s.set)
  const inputs = useStore((s) => s.inputs)
  const canonical = useStore((s) => s.canonical)
  const budget: BudgetMode = canonical?.budget ?? {
    kind: 'savingsBudget',
    annualNetSavings: inputs.annualSavings,
    retirementSpending: inputs.retirementSpending,
    debtIncluded: { status: 'unknown', reason: 'not asked yet' },
    taxBenefitIncluded: { status: 'unknown', reason: 'not asked yet' },
  }
  const decision: BudgetReconciliation | undefined = canonical?.migration.budgetReconciliation
  // Only a plan whose figure came from the v10 form has a meaning to reconcile,
  // and only while its recorded answer still describes the old approximation. A
  // plan first entered here answers the two facts directly and is never told
  // that its own amount came from "an earlier plan".
  const bothRecordedAsNew = budget.kind === 'savingsBudget' &&
    budget.debtIncluded.status === 'known' && budget.debtIncluded.value &&
    budget.taxBenefitIncluded.status === 'known' && budget.taxBenefitIncluded.value
  const migrated = canonical !== null && canonical.migration.sourcePersistVersion !== 11
  const debtBaseline = decision?.legacyAnnualDebtPayments ?? 0
  const savings = budget.kind === 'savingsBudget' ? budget : null
  const state = budgetStateLabel(budget)

  return <section className="budget-method" data-testid="budget-method">
    <h3>{t('budget.title')}</h3>
    <p className="hint">{t('budget.intro')}</p>

    <div className="budget-mode" role="radiogroup" aria-label={t('budget.title')}>
      <div className="choice-group">
        <label className={budget.kind === 'savingsBudget' ? 'selected' : ''}>
          <input type="radio" name="budget-mode" checked={budget.kind === 'savingsBudget'} data-testid="budget-mode-savings"
            onChange={() => setBudgetChoice({ kind: 'mode', mode: 'savingsBudget' })} />
          <span><strong>{t('budget.modeSavings')}</strong><small>{t('budget.modeSavingsDetail')}</small></span>
        </label>
        <label className={budget.kind === 'incomeBudget' ? 'selected' : ''}>
          <input type="radio" name="budget-mode" checked={budget.kind === 'incomeBudget'} data-testid="budget-mode-income"
            onChange={() => setBudgetChoice({ kind: 'mode', mode: 'incomeBudget' })} />
          <span><strong>{t('budget.modeIncome')}</strong><small>{t('budget.modeIncomeDetail')}</small></span>
        </label>
      </div>
    </div>

    {savings && <TraceAnswer
      legend={t('budget.debtIncluded')} detail={t('budget.debtIncludedDetail')} name="budget-debt"
      value={savings.debtIncluded.status === 'known' ? savings.debtIncluded.value : undefined}
      testId="budget-debt" onChange={(value) => setBudgetChoice({ kind: 'debtIncluded', value })} />}
    {savings && <TraceAnswer
      legend={t('budget.taxBenefitIncluded')} detail={t('budget.taxBenefitIncludedDetail')} name="budget-tax"
      value={savings.taxBenefitIncluded.status === 'known' ? savings.taxBenefitIncluded.value : undefined}
      testId="budget-tax" onChange={(value) => setBudgetChoice({ kind: 'taxBenefitIncluded', value })} />}

    {budget.kind === 'incomeBudget' && <label className="field" data-testid="budget-working-spending">
      <span>{t('budget.workingSpending')}</span>
      <NumberInput value={budget.workingSpending} step={1000}
        onChange={(value) => set({ budgetWorkingSpending: value == null ? null : value })} />
      <small className="hint">{t('budget.workingSpendingHint')}</small>
    </label>}

    {savings && migrated && !bothRecordedAsNew && (
      <div className="budget-reconciliation" data-testid="budget-reconciliation" role="group" aria-label={t('budget.legacyReview')}>
        <p className="budget-fact-title">{t('budget.legacyReview')}</p>
        <p className="hint">{t('budget.legacyBaseline', { annualDebt: cad(debtBaseline) })}</p>
        <div className="choice-group" role="radiogroup" aria-label={t('budget.legacyReview')}>
          <label>
            <input type="radio" name="budget-basis" data-testid="budget-basis-legacy"
              onChange={() => setBudgetChoice({ kind: 'migratedBasis', basis: 'legacy' })} />
            <span><strong>{t('budget.legacyKeep')}</strong><small>{t('budget.legacyKeepDetail')}</small></span>
          </label>
          <label>
            <input type="radio" name="budget-basis" data-testid="budget-basis-adopt"
              onChange={() => setBudgetChoice({ kind: 'migratedBasis', basis: 'newDefinition' })} />
            <span><strong>{t('budget.legacyAdopt')}</strong><small>{t('budget.legacyAdoptDetail')}</small></span>
          </label>
        </div>
      </div>
    )}

    <p className="budget-state" data-testid="budget-state" role="status" aria-live="polite">
      <strong>{t('budget.stateTitle')}</strong>{' '}
      {t(state.key, { ...Object.fromEntries(Object.entries(state.params ?? {}).map(([key, value]) => [key, value.split(', ').map(part => part.startsWith('budget.') ? t(part) : part).join(', ')])), value: factsAmount(budget, cad) })}
    </p>
  </section>
}

/** The recorded net saving amount, formatted for the state line. */
function factsAmount(budget: BudgetMode, cad: (value: number) => string): string {
  const facts = budgetFacts(budget)
  return facts.status === 'ready' ? cad(facts.annualNetSavings) : ''
}
