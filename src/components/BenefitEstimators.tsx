import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { estimateCppAt65, estimateOasAt65 } from '../engine'
import { useCad } from '../format'
import { Jargon } from './Jargon'

function Row(props: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="field">
      <span><Jargon text={props.label} /></span>
      <input
        type="number"
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}

/** Estimate CPP/QPP at 65 from work history; contributions stop at retireAge. */
export function CppEstimator(props: { retireAge: number; onApply: (v: number) => void }) {
  const { t } = useTranslation()
  const cad = useCad()
  const [startWorkAge, setStartWorkAge] = useState(25)
  const [ratio, setRatio] = useState(100)
  const estimate = estimateCppAt65(startWorkAge, props.retireAge, ratio / 100)

  return (
    <details className="estimator">
      <summary>{t('estCppTitle')}</summary>
      <Row label={t('estStartWorkAge')} value={startWorkAge} onChange={setStartWorkAge} />
      <Row label={t('estRatio')} value={ratio} onChange={setRatio} />
      <div className="ws-total">
        <span>
          {t('estResult')}: <strong>{cad(estimate)}</strong>
        </span>
        <button type="button" onClick={() => props.onApply(Math.round(estimate))}>
          {t('estApply')}
        </button>
      </div>
      <p className="hint"><Jargon text={t('cppEstNote')} /></p>
    </details>
  )
}

/** Estimate OAS at 65 from years of Canadian residence after age 18. */
export function OasEstimator(props: { onApply: (v: number) => void }) {
  const { t } = useTranslation()
  const cad = useCad()
  const [residence, setResidence] = useState(40)
  const estimate = estimateOasAt65(residence)

  return (
    <details className="estimator">
      <summary>{t('estOasTitle')}</summary>
      <Row label={t('estResidence')} value={residence} onChange={setResidence} />
      <div className="ws-total">
        <span>
          {t('estResult')}: <strong>{cad(estimate)}</strong>
        </span>
        <button type="button" onClick={() => props.onApply(Math.round(estimate))}>
          {t('estApply')}
        </button>
      </div>
      <p className="hint"><Jargon text={t('oasEstNote')} /></p>
    </details>
  )
}
