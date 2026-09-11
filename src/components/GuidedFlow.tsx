import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { validateInputs, type ProjectionResult } from '../engine'
import { useCad } from '../format'
import { GUIDED_SECTIONS, issueBelongsToStep, stepForField } from '../guidedSections'
import { accountSummary, answerIsUsable, guidedPlanReady, guidedRequiredFields, guidedResultSummary } from '../guidedReview'
import { useStore } from '../store'
import { GuidedChapterForm, REQUIRED_BY_STEP } from './guided/GuidedChapterForm'

export function GuidedFlow({ result }: { result: ProjectionResult }) {
  const { t } = useTranslation()
  const cad = useCad()
  const { inputs, activeStep, visitedSteps, setActiveStep, answerMeta, markAnswers } = useStore()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const issues = useMemo(() => validateInputs(inputs), [inputs])
  const stepErrors = issues.filter(
    (issue) => issue.severity === 'error' && issueBelongsToStep(issue.field, activeStep),
  )
  const section = GUIDED_SECTIONS[activeStep - 1]
  const accounts = accountSummary(inputs)
  const resultSummary = guidedResultSummary(result)
  const planReady = guidedPlanReady(answerMeta, inputs)
  const globallyUnanswered = guidedRequiredFields(inputs).filter((field) => !answerIsUsable(answerMeta[field]))
  const conditionalRequired = [
    ...(activeStep === 1 && inputs.partner ? ['partner.currentAge'] : []),
    ...(activeStep === 3 && inputs.fhsa ? ['fhsa.balance', 'fhsa.annualContribution', 'fhsa.openedYearsAgo'] : []),
    ...(activeStep === 3 && inputs.lockedRetirement ? ['lockedRetirement.balance', 'lockedRetirement.accessibleAge'] : []),
    ...(activeStep === 6 && inputs.partner ? [
      'partner.cppStartAge', 'partner.cppAnnualAt65', 'partner.oasStartAge', 'partner.oasAnnualAt65',
    ] : []),
  ]
  const unanswered = [...(REQUIRED_BY_STEP[activeStep] ?? []), ...conditionalRequired].filter(
    (field) => !answerIsUsable(answerMeta[field]),
  )

  useEffect(() => {
    titleRef.current?.focus()
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }, [activeStep])

  const goNext = () => {
    if (stepErrors.length || unanswered.length) {
      const target = stepErrors[0]?.field ?? unanswered[0]
      const container = Array.from(document.querySelectorAll<HTMLElement>('[data-field]'))
        .find((element) => element.dataset.field === target)
      ;(container?.querySelector<HTMLElement>('input, select')
        ?? document.querySelector<HTMLElement>('.question-card input, .question-card select'))?.focus()
      return
    }
    setActiveStep(activeStep + 1)
  }

  return (
    <div className="guided-flow">
      <nav className="step-list" aria-label={t('guidedProgress')}>
        {GUIDED_SECTIONS.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-current={item.id === activeStep ? 'step' : undefined}
            disabled={!visitedSteps.includes(item.id) && item.id !== activeStep}
            onClick={() => setActiveStep(item.id)}
          >
            <span>{item.id}</span>{t(`guided.steps.${item.key}.short`)}
          </button>
        ))}
      </nav>

      <div className="guided-head">
        <p>{t('guidedStepCount', { step: activeStep, total: GUIDED_SECTIONS.length })}</p>
        <h2 ref={titleRef} tabIndex={-1}>{t(`guided.steps.${section.key}.title`)}</h2>
        <p>{t(`guided.steps.${section.key}.help`)}</p>
      </div>

      {activeStep < 7 ? <GuidedChapterForm step={activeStep} /> : (
        <section className="review-card" aria-labelledby="review-title">
          <h3 id="review-title">{t('guidedReviewTitle')}</h3>
          <div className="review-chapters">
            {GUIDED_SECTIONS.slice(0, 6).map((chapter) => <article key={chapter.id}>
              <div><strong>{t(`guided.steps.${chapter.key}.short`)}</strong><button type="button" onClick={() => setActiveStep(chapter.id)}>{t('guidedEdit')}</button></div>
              <p>{chapter.id === 1 ? `${inputs.province} · ${inputs.partner ? t('couple') : t('single')} · ${t('fireAge')} ${inputs.fireAge}`
                : chapter.id === 2 ? cad(inputs.annualSavings)
                : chapter.id === 3 ? `${t('guidedTotalAccounts')}: ${cad(accounts.totalAccounts)}`
                : chapter.id === 4 ? (inputs.principalResidence ? t(inputs.principalResidence.mode === 'planned' ? 'prModePlanned' : 'prModeOwned') : t('guidedRent'))
                : chapter.id === 5 ? cad(inputs.retirementSpending)
                : `${t('cppStartAge')} ${inputs.cppStartAge} · ${t('oasStartAge')} ${inputs.oasStartAge}`}</p>
            </article>)}
          </div>
          <dl className="account-breakdown">
            <div><dt>{t('guidedTotalAccounts')}</dt><dd>{cad(accounts.totalAccounts)}</dd></div>
            <div><dt>{t('guidedAccessibleAccounts')}</dt><dd>{cad(accounts.accessibleNow)}</dd></div>
            {accounts.fhsa > 0 && <div><dt>{t('fhsaSection')}</dt><dd>{cad(accounts.fhsa)}</dd></div>}
            {accounts.locked > 0 && <div><dt>{t('lockedRetirementBalance')}</dt><dd>{cad(accounts.locked)}</dd></div>}
          </dl>
          {issues.length > 0 && (
            <div className="review-issues" role="status">
              <strong>{t('guidedReviewIssues', { count: issues.length })}</strong>
              <ul>{issues.map((issue, index) => (
                <li key={`${issue.field}-${index}`}>
                  {t(issue.key, issue.params)}{' '}
                  <button type="button" onClick={() => {
                    setActiveStep(stepForField(issue.field) ?? 1)
                  }}>{t('guidedEdit')}</button>
                </li>
              ))}</ul>
            </div>
          )}
          {!planReady && <div className="review-incomplete" role="status">
            <strong>{t('guidedReviewIncomplete', { count: globallyUnanswered.length })}</strong>
            <button type="button" className="estimate-values" onClick={() => markAnswers(globallyUnanswered, 'estimated', 'default')}>{t('guidedUseEstimate')}</button>
          </div>}
          {issues.every((issue) => issue.severity !== 'error') && planReady && <div className={`guided-result-story ${resultSummary.success ? 'good' : 'poor'}`}>
            <strong>{t('guidedBasedOnAssumptions')}</strong>
            <p>{resultSummary.success
              ? t('guidedResultSuccess', { age: inputs.lifeExpectancy })
              : t('guidedResultShortfall', { age: resultSummary.depletedAge, need: cad(resultSummary.need), available: cad(resultSummary.available), shortfall: cad(resultSummary.shortfall) })}</p>
          </div>}
          <p className="hint">{t('guidedResultsBelow')}</p>
        </section>
      )}

      <div className="guided-actions">
        <button type="button" className="reset" disabled={activeStep === 1} onClick={() => setActiveStep(activeStep - 1)}>
          {t('guidedBack')}
        </button>
        {activeStep < 7 && (
          <div className="guided-forward-actions">
            {unanswered.length > 0 && <button type="button" className="estimate-values" onClick={() => markAnswers(unanswered, 'estimated', 'default')}>{t('guidedUseEstimate')}</button>}
            {visitedSteps.includes(7) && <button type="button" className="return-review" onClick={() => setActiveStep(7)}>{t('guidedReturnReview')}</button>}
            <button type="button" className="guided-next" onClick={goNext}>{activeStep === 6 ? t('guidedReview') : t('guidedNext')}</button>
          </div>
        )}
      </div>
      {(stepErrors.length > 0 || unanswered.length > 0) && (
        <p className="validation-banner" aria-live="polite">
          {stepErrors.length > 0
            ? t('guidedFixErrors', { count: stepErrors.length })
            : t('guidedConfirmValues', { count: unanswered.length })}
        </p>
      )}
    </div>
  )
}
