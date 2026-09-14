import { useTranslation } from 'react-i18next'
import {
  manualProvenance,
  pensionAmountWarning,
  statementProvenance,
  type PensionAmountProvenance,
} from '../engine'
import { NumberInput } from './NumberInput'

/** A statement value is entered at the age the statement states it at. */
type StatementUnit = { basis: 'monthly' | 'annual'; ageBasis: number | null; dollarBasis: 'today' | 'nominal' }

/**
 * BE-39 A. The provenance line under one CPP/QPP or OAS amount: where the
 * figure came from, what its unit means, and — the point of the slice — the
 * flag raised when a retirement-age change invalidated a premise.
 *
 * The rules this surface has to show, and never blur:
 *   - `manual` and "no source recorded" are never flagged;
 *   - a `statement` amount is never silently overwritten; it asks for a
 *     re-confirmation instead;
 *   - an `estimator` CPP amount is re-priced from the same estimator, and says
 *     so; an `estimator` OAS amount cannot be re-priced from a retirement age,
 *     so it asks for confirmation.
 */
export function PensionSourceNote(props: {
  kind: 'cpp' | 'oas'
  amount: number
  provenance: PensionAmountProvenance | undefined
  /** The plan's current retirement age for this person. */
  retirementAge: number
  /** Write the recorded value in the units `provenance.basis` states. */
  onAmount: (value: number) => void
  onProvenance: (provenance: PensionAmountProvenance) => void
  /** Re-adopt the current retirement age as the amount's premise. */
  onReconfirm: () => void
}) {
  const { t } = useTranslation()
  const record = props.provenance
  const source = record?.source ?? 'unknown'
  const warning = pensionAmountWarning(record, props.kind, props.retirementAge)
  const unit: StatementUnit = {
    basis: record?.basis ?? 'annual',
    ageBasis: record?.ageBasis ?? null,
    dollarBasis: record?.dollarBasis ?? 'today',
  }

  const setSource = (next: 'manual' | 'statement') => {
    const year = new Date().getFullYear()
    if (next === 'manual') props.onProvenance(manualProvenance(year))
    else props.onProvenance(statementProvenance(year, unit, props.retirementAge))
  }
  const setUnit = (patch: Partial<StatementUnit>) => {
    const year = record?.sourceYear ?? new Date().getFullYear()
    props.onProvenance(statementProvenance(year, { ...unit, ...patch }, props.retirementAge))
  }

  return (
    <div className="pension-source" data-pension-kind={props.kind} data-pension-source={source}>
      <div className="pension-source-controls">
        <label className="field pension-source-field">
          <span>{t('pensionAmountSource')}</span>
          <select
            data-pension-source-select={props.kind}
            value={source === 'manual' || source === 'statement' ? source : ''}
            onChange={(event) => {
              const next = event.target.value
              if (next === 'manual' || next === 'statement') setSource(next)
            }}
          >
            {source === 'estimator' && <option value="">{t('pensionSourceEstimator')}</option>}
            {source === 'unknown' && <option value="">{t('pensionSourceUnknown')}</option>}
            <option value="manual">{t('pensionSourceManual')}</option>
            <option value="statement">{t('pensionSourceStatement')}</option>
          </select>
        </label>
        {source === 'statement' && <>
          <label className="field pension-source-field">
            <span>{t('pensionAmountBasis')}</span>
            <select
              data-pension-basis-select={props.kind}
              value={unit.basis}
              onChange={(event) => setUnit({ basis: event.target.value as 'monthly' | 'annual' })}
            >
              <option value="annual">{t('pensionBasisAnnual')}</option>
              <option value="monthly">{t('pensionBasisMonthly')}</option>
            </select>
          </label>
          <label className="field pension-source-field">
            <span>{t('pensionAgeBasis')}</span>
            <NumberInput
              data-pension-age-basis={props.kind}
              value={unit.ageBasis ?? 65}
              step={1}
              onChange={(value) => setUnit({ ageBasis: value == null ? null : Math.round(value) })}
            />
          </label>
        </>}
      </div>
      {warning && (
        <p className="pension-flag" data-pension-warning={warning.kind} role="status">
          {warning.kind === 'premisesNeedReview' && t('pensionStatementNeedsReview')}
          {warning.kind === 'estimatorNeedsReview' && t('pensionEstimatorNeedsReview')}
          {warning.kind === 'premisesNeedReview' || warning.kind === 'estimatorNeedsReview' ? (
            <button type="button" className="pension-reconfirm" data-pension-reconfirm={props.kind}
              onClick={props.onReconfirm}>
              {t('pensionReconfirm')}
            </button>
          ) : null}
        </p>
      )}
      <p className="hint pension-source-hint">
        {source === 'unknown' && t('pensionSourceUnknownNote')}
        {source === 'manual' && t('pensionSourceManualNote')}
        {source === 'statement' && t('pensionSourceStatementNote', { year: record?.sourceYear ?? '' })}
        {source === 'estimator' && t('pensionSourceEstimatorNote', { year: record?.sourceYear ?? '' })}
      </p>
    </div>
  )
}
