import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  findEarliestFireAge,
  maxSustainableSpending,
  requiredFireAssets,
  runProjection,
  targetReport,
  type Inputs,
  type ProjectionResult,
} from '../engine'
import { useCad } from '../format'
import { useStore } from '../store'
import { Jargon } from './Jargon'

type Mode = 'last' | 'when' | 'number' | 'target'

export function ResultsPanel(props: { inputs: Inputs; result: ProjectionResult }) {
  const { t } = useTranslation()
  const cad = useCad()
  const [mode, setMode] = useState<Mode>('last')
  const { inputs, result } = props

  const earliest = useMemo(
    () => (mode === 'when' ? findEarliestFireAge(inputs) : null),
    [mode, inputs],
  )
  const fireNumber = useMemo(
    () => (mode === 'number' ? requiredFireAssets(inputs) : null),
    [mode, inputs],
  )
  const projectedAtFire = useMemo(
    () =>
      mode === 'number'
        ? targetReport(inputs, Number.MAX_SAFE_INTEGER).assetsAtFire
        : null,
    [mode, inputs],
  )
  const earliestAssets = useMemo(() => {
    if (mode !== 'when' || earliest === null) return null
    const row = runProjection({ ...inputs, fireAge: earliest }).rows.find(
      (x) => x.age === earliest,
    )
    return row ? row.balances.tfsa + row.balances.rrsp + row.balances.nonReg : null
  }, [mode, earliest, inputs])
  const set = useStore((s) => s.set)
  const dwzSpending = useMemo(
    () =>
      mode === 'last' && (inputs.goal ?? 'legacy') === 'dieWithZero'
        ? maxSustainableSpending(inputs)
        : null,
    [mode, inputs],
  )
  const target = inputs.fireTargetAssets ?? 0
  const goal = useMemo(
    () => (mode === 'target' && target > 0 ? targetReport(inputs, target) : null),
    [mode, inputs, target],
  )

  const ok =
    mode === 'last'
      ? result.success
      : mode === 'when'
        ? earliest !== null
        : mode === 'target'
          ? goal !== null && goal.reachedAge !== null && goal.reachedAge <= inputs.fireAge
          : mode === 'number'
            ? projectedAtFire !== null && fireNumber !== null && projectedAtFire >= fireNumber
            : true

  return (
    <div className={`summary ${ok ? 'ok' : 'bad'}`}>
      <div className="mode-tabs" role="tablist">
        {(['last', 'when', 'number', 'target'] as Mode[]).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={mode === m ? 'active' : ''}
            onClick={() => setMode(m)}
          >
            {t(`mode_${m}`)}
          </button>
        ))}
      </div>

      {mode === 'last' && (
        <>
          <p className="verdict">
            {result.success
              ? t('success', { age: inputs.lifeExpectancy })
              : t('depleted', { age: result.depletedAge })}
          </p>
          <p>
            {t('finalNetWorth')}: <strong>{cad(result.finalNetWorth)}</strong>
            {' · '}
            {t('estateValue')}: <strong>{cad(result.estateValue)}</strong>
          </p>
          {dwzSpending !== null && (
            <>
              <p>
                {t('dwzSpending')}: <strong>{cad(dwzSpending)}</strong>
                <span className="hint"> ({t('currentSpending')}: {cad(inputs.retirementSpending)})</span>
              </p>
              <p className="hint"><Jargon text={t('dwzNote')} /></p>
              <p className="dwz-warning"><Jargon text={t('dwzRiskWarning')} /></p>
            </>
          )}
        </>
      )}

      {mode === 'when' && (
        <>
          <p className="verdict">
            {earliest !== null
              ? t('whenAnswer', { age: earliest })
              : t('whenNever')}
          </p>
          {earliest !== null && earliestAssets !== null && (
            <p>
              <Jargon
                text={t('whenAssets', { age: earliest, amount: cad(earliestAssets) })}
              />
            </p>
          )}
          <p className="hint">
            <Jargon
              text={t('whenExplain', {
                life: inputs.lifeExpectancy,
                spending: cad(inputs.retirementSpending),
              })}
            />
          </p>
        </>
      )}

      {mode === 'number' && (
        <>
          <p className="verdict">
            {t('numberAnswer', { age: inputs.fireAge, amount: cad(fireNumber ?? 0) })}
          </p>
          {projectedAtFire !== null && fireNumber !== null && (
            <p>
              <Jargon
                text={
                  t('numberHave', { age: inputs.fireAge, amount: cad(projectedAtFire) }) +
                  (projectedAtFire >= fireNumber
                    ? t('numberSurplus', { amount: cad(projectedAtFire - fireNumber) })
                    : t('numberGap', { amount: cad(fireNumber - projectedAtFire) }))
                }
              />
            </p>
          )}
          <p className="hint">
            <Jargon text={t('numberExplain', { age: inputs.fireAge, life: inputs.lifeExpectancy })} />
          </p>
        </>
      )}

      {mode === 'target' && (
        <>
          <label className="field target-field">
            <span><Jargon text={t('targetInputLabel')} /></span>
            <input
              type="number"
              step={50000}
              value={inputs.fireTargetAssets ?? ''}
              onChange={(e) =>
                set({ fireTargetAssets: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          </label>
          {goal && (
            <p className="verdict">
              {goal.reachedAge !== null && goal.reachedAge < inputs.fireAge
                ? t('targetReachedEarly', {
                    fireAge: inputs.fireAge,
                    amount: cad(goal.assetsAtFire),
                    age: goal.reachedAge,
                    target: cad(target),
                  })
                : goal.reachedAge !== null && goal.reachedAge === inputs.fireAge
                  ? t('targetReachedAtFire', {
                      fireAge: inputs.fireAge,
                      amount: cad(goal.assetsAtFire),
                      target: cad(target),
                    })
                  : goal.reachedAge !== null
                  ? t('targetLate', {
                      fireAge: inputs.fireAge,
                      amount: cad(goal.assetsAtFire),
                      target: cad(target),
                      age: goal.reachedAge,
                    })
                  : t('targetNever', { target: cad(target) })}
            </p>
          )}
          <p className="hint"><Jargon text={t('targetHint')} /></p>
        </>
      )}
    </div>
  )
}
