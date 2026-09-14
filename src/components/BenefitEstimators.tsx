import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  estimateCppAt65,
  estimateOasAt65,
  cppEstimatorProvenance,
  oasEstimatorProvenance,
  type PensionAmountProvenance,
} from '../engine'
import { useCad } from '../format'
import { track } from '../analytics'
import { Jargon } from './Jargon'
import { NumberInput } from './NumberInput'

function Row(props: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="field">
      <span><Jargon text={props.label} /></span>
      <NumberInput
        value={props.value}
        onChange={(v) => props.onChange(v ?? 0)}
      />
    </label>
  )
}

/** The calendar year an applied estimate was computed with. */
const estimateSourceYear = () => new Date().getFullYear()

/**
 * BE-39 A: estimate CPP/QPP at 65 from work history; contributions stop at
 * retireAge. The retirement age and the other premises are handed to `onApply`
 * so the plan can record what the amount assumed — not merely that an estimate
 * happened. Without the premises a later FIRE-age change could only leave the
 * number silently stale.
 */
export function CppEstimator(props: {
  retireAge: number
  onApply: (v: number, provenance: PensionAmountProvenance, work: { startWorkAge: number; retireAge: number }) => void
}) {
  const { t } = useTranslation()
  const cad = useCad()
  const [startWorkAge, setStartWorkAge] = useState(25)
  const [ratio, setRatio] = useState(100)
  const estimate = estimateCppAt65(startWorkAge, props.retireAge, ratio / 100)

  return (
    <details className="estimator"
      onToggle={(e) => e.currentTarget.open && track('panel_open', { panel: 'cpp_estimator' })}>
      <summary>{t('estCppTitle')}</summary>
      <Row label={t('estStartWorkAge')} value={startWorkAge} onChange={setStartWorkAge} />
      <Row label={t('estRatio')} value={ratio} onChange={setRatio} />
      <p className="hint">{t('cppEstUsesFireAge', { age: props.retireAge })}</p>
      <div className="ws-total">
        <span>
          {t('estResult')}: <strong>{cad(estimate)}</strong>
        </span>
        <button
          type="button"
          onClick={() => {
            track('estimator_apply', { which: 'cpp' })
            props.onApply(
              Math.round(estimate),
              cppEstimatorProvenance(
                { retirementAge: props.retireAge, startWorkAge, avgEarningsRatio: ratio / 100 },
                estimateSourceYear(),
              ),
              { startWorkAge, retireAge: props.retireAge },
            )
          }}
        >
          {t('estApply')}
        </button>
      </div>
      <p className="hint"><Jargon text={t('cppEstNote')} /></p>
    </details>
  )
}

/**
 * Estimate OAS at 65 from years of Canadian residence after age 18. The OAS
 * formula has no retirement-age input, so the premise recorded is the residence
 * count; a later FIRE-age change keeps the amount and raises the review flag
 * rather than inventing residence years the user never stated.
 */
export function OasEstimator(props: {
  retireAge: number
  onApply: (v: number, provenance: PensionAmountProvenance) => void
}) {
  const { t } = useTranslation()
  const cad = useCad()
  const [residence, setResidence] = useState(40)
  const estimate = estimateOasAt65(residence)

  return (
    <details className="estimator"
      onToggle={(e) => e.currentTarget.open && track('panel_open', { panel: 'oas_estimator' })}>
      <summary>{t('estOasTitle')}</summary>
      <Row label={t('estResidence')} value={residence} onChange={setResidence} />
      <p className="hint">{t('oasEstUsesFireAge', { age: props.retireAge })}</p>
      <div className="ws-total">
        <span>
          {t('estResult')}: <strong>{cad(estimate)}</strong>
        </span>
        <button
          type="button"
          onClick={() => {
            track('estimator_apply', { which: 'oas' })
            props.onApply(
              Math.round(estimate),
              oasEstimatorProvenance({ retirementAge: props.retireAge, residenceYearsBy65: residence }, estimateSourceYear()),
            )
          }}
        >
          {t('estApply')}
        </button>
      </div>
      <p className="hint"><Jargon text={t('oasEstNote')} /></p>
    </details>
  )
}
