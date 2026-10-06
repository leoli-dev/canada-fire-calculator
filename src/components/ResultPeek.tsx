import { useTranslation } from 'react-i18next'
import type { Inputs, ProjectionResult } from '../engine'
import { headlineVerdict } from './ResultsPanel'

/**
 * FE-48: on a phone the professional form is several screens long and the
 * result sits below it. This puts the headline above the form, with a jump
 * to the full results. Hidden where the two columns sit side by side.
 */
export function ResultPeek(props: { inputs: Inputs; result: ProjectionResult; estimate: boolean; personTax: boolean; taxWarning: boolean }) {
  const { t } = useTranslation()
  const verdict = headlineVerdict(t, props.inputs, props.result, props)
  return <div className={`result-peek ${verdict.tone}`} data-testid="result-peek">
    <p role="status">{verdict.text}</p>
    <button type="button" className="text-action" onClick={() => {
      const results = document.getElementById('results')
      results?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      results?.focus({ preventScroll: true })
    }}>{t('resultPeekJump')}</button>
  </div>
}
