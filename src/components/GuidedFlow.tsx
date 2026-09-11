import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { validateInputs } from '../engine'
import { useCad } from '../format'
import { GUIDED_SECTIONS, issueBelongsToStep } from '../guidedSections'
import { useStore } from '../store'
import { InputForm } from './InputForm'

export function GuidedFlow() {
  const { t } = useTranslation()
  const cad = useCad()
  const { inputs, activeStep, visitedSteps, setActiveStep } = useStore()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const issues = useMemo(() => validateInputs(inputs), [inputs])
  const stepErrors = issues.filter(
    (issue) => issue.severity === 'error' && issueBelongsToStep(issue.field, activeStep),
  )
  const section = GUIDED_SECTIONS[activeStep - 1]
  const assets = Object.values(inputs.balances).reduce((sum, value) => sum + value, 0)

  useEffect(() => {
    titleRef.current?.focus()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [activeStep])

  const goNext = () => {
    if (stepErrors.length) {
      document.querySelector<HTMLElement>('.input-form .invalid-error')?.focus()
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

      {activeStep < 7 ? <InputForm guidedStep={activeStep} /> : (
        <section className="review-card" aria-labelledby="review-title">
          <h3 id="review-title">{t('guidedReviewTitle')}</h3>
          <dl>
            <div><dt>{t('household')}</dt><dd>{inputs.partner ? t('couple') : t('single')}</dd></div>
            <div><dt>{t('province')}</dt><dd>{inputs.province}</dd></div>
            <div><dt>{t('currentAge')}</dt><dd>{inputs.currentAge}</dd></div>
            <div><dt>{t('fireAge')}</dt><dd>{inputs.fireAge}</dd></div>
            <div><dt>{t('annualSavings')}</dt><dd>{cad(inputs.annualSavings)}</dd></div>
            <div><dt>{t('accounts')}</dt><dd>{cad(assets)}</dd></div>
            <div><dt>{t('retirementSpending')}</dt><dd>{cad(inputs.retirementSpending)}</dd></div>
          </dl>
          {issues.length > 0 && (
            <div className="review-issues" role="status">
              <strong>{t('guidedReviewIssues', { count: issues.length })}</strong>
              <ul>{issues.map((issue, index) => (
                <li key={`${issue.field}-${index}`}>
                  {t(issue.key, issue.params)}{' '}
                  <button type="button" onClick={() => {
                    const target = GUIDED_SECTIONS.find((item) => issueBelongsToStep(issue.field, item.id))
                    setActiveStep(target?.id ?? 1)
                  }}>{t('guidedEdit')}</button>
                </li>
              ))}</ul>
            </div>
          )}
          <p className="hint">{t('guidedResultsBelow')}</p>
        </section>
      )}

      <div className="guided-actions">
        <button type="button" className="reset" disabled={activeStep === 1} onClick={() => setActiveStep(activeStep - 1)}>
          {t('guidedBack')}
        </button>
        {activeStep < 7 && (
          <button type="button" className="guided-next" onClick={goNext}>
            {activeStep === 6 ? t('guidedReview') : t('guidedNext')}
          </button>
        )}
      </div>
      {stepErrors.length > 0 && (
        <p className="validation-banner" aria-live="polite">
          {t('guidedFixErrors', { count: stepErrors.length })}
        </p>
      )}
    </div>
  )
}
