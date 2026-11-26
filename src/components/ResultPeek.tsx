import { Button, Callout, StatusChip } from '../ui'
import { useTranslation } from 'react-i18next'
import type { Inputs, ProjectionResult } from '../engine'
import { headlineVerdict } from './ResultsPanel'

/**
 * FE-48: on a phone the professional form is several screens long and the
 * result sits below it. This puts the headline above the form, with a jump
 * to the full results. Hidden where the two columns sit side by side.
 */
export function ResultPeek(props: { inputs: Inputs; result: ProjectionResult; estimate: boolean; personTax: boolean; taxWarning: boolean; onOpen?: () => void }) {
  const { t } = useTranslation()
  const verdict = headlineVerdict(t, props.inputs, props.result, props)
  return <Callout variant={verdict.tone === 'ok' ? 'info' : 'warn'} className={`result-peek ${verdict.tone}`} data-testid="result-peek">
    <p role="status"><StatusChip status={verdict.tone === 'uncertain' ? 'est' : verdict.tone}>{t(`ui.conclusion.${verdict.tone}`)}</StatusChip><span className="sr-only">{verdict.text}</span><span aria-hidden="true">{t(props.result.success ? 'ui.professional.lasts' : 'ui.professional.depleted', { age: props.result.success ? props.inputs.lifeExpectancy : props.result.depletedAge })}</span></p>
    <Button variant="link" type="button" className="text-action" onClick={() => {
      props.onOpen?.()
      requestAnimationFrame(() => {
        const results = document.getElementById('results')
        if (props.onOpen && results) results.scrollTop = 0
        results?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        results?.focus({ preventScroll: true })
      })
    }}>{t('resultPeekJump')}</Button>
  </Callout>
}
