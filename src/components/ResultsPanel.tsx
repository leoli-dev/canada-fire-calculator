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
import { track } from '../analytics'
import { Jargon } from './Jargon'
import { NumberInput } from './NumberInput'
import { hasUnverifiedLockedWithdrawals } from '../engine/capabilities'

type Mode = 'last' | 'when' | 'number' | 'target'

export function ResultsPanel(props: { inputs: Inputs; result: ProjectionResult; legacyEstimate?: boolean; legacyOwnershipPending?: boolean; taxEstimate?: boolean; taxWarning?: boolean; personTax?: boolean }) {
  const { t } = useTranslation()
  const cad = useCad()
  const [mode, setMode] = useState<Mode>('last')
  const { inputs, result } = props
  const canonical = useStore((s) => s.canonical)

  const earliest = useMemo(
    () => (mode === 'when' ? findEarliestFireAge(inputs, canonical) : null),
    [mode, inputs, canonical],
  )
  const fireNumber = useMemo(
    () => (mode === 'number' ? requiredFireAssets(inputs, canonical) : null),
    [mode, inputs, canonical],
  )
  const projectedAtFire = useMemo(
    () =>
      mode === 'number' && fireNumber?.status === 'solved'
        ? targetReport(inputs, Number.MAX_SAFE_INTEGER).assetsAtFire
        : null,
    [mode, inputs, fireNumber],
  )
  const earliestAssets = useMemo(() => {
    if (mode !== 'when' || earliest?.status !== 'solved' || earliest.value === null) return null
    const row = runProjection({ ...inputs, fireAge: earliest.value }).rows.find(
      (x) => x.age === earliest.value,
    )
    return row ? row.balances.tfsa + row.balances.rrsp + row.balances.nonReg : null
  }, [mode, earliest, inputs])
  const set = useStore((s) => s.set)
  const markAnswers = useStore((s) => s.markAnswers)
  const setQuestionAnswer = useStore((s) => s.setQuestionAnswer)
  const entryMode = useStore((s) => s.entryMode)
  const dwzSpending = useMemo(
    () =>
      !props.legacyEstimate && mode === 'last' && (inputs.goal ?? 'legacy') === 'dieWithZero'
        ? maxSustainableSpending(inputs, canonical)
        : null,
    [mode, inputs, canonical],
  )
  const target = inputs.fireTargetAssets ?? 0
  const goal = useMemo(
    () => (mode === 'target' && target > 0 ? targetReport(inputs, target) : null),
    [mode, inputs, target],
  )
  const earlySale = (inputs.principalResidence?.sellAtAge ?? Infinity) < inputs.fireAge ||
    (inputs.investmentProperties ?? []).some((property) => (property.sellAtAge ?? Infinity) < inputs.fireAge)
  const quickEstimateUnsupported = inputs.principalResidence?.mode === 'planned' ||
    result.unfundedObligations.length > 0 || earlySale || fireNumber !== null && fireNumber.status !== 'solved'
  const quickEstimateMessage = inputs.principalResidence?.mode === 'planned'
    ? t('plannedPurchaseQuickUnsupported') : goal?.reason === 'investmentPropertySale'
      ? t('targetPropertySaleUnsupported') : fireNumber?.reason === 'nominalCapitalBasis'
        ? t('solverReason_nominalCapitalBasis') : fireNumber?.reason === 'investmentPropertySale'
          ? t('targetPropertySaleUnsupported') : result.unfundedObligations.length > 0
      ? t('fundingQuickUnsupported') : earlySale ? t('saleQuickUnsupported')
        : fireNumber?.reason === 'lockedWithdrawalLimits'
          ? t('solverReason_lockedWithdrawalLimits') : t(`solver_${fireNumber?.status ?? 'unsupported'}`)
  const lockedWithdrawalUnverified = hasUnverifiedLockedWithdrawals(inputs)
  const lastResultUnverified = result.success && (props.taxWarning || lockedWithdrawalUnverified || result.terminalTaxStatus === 'unsupported')
  const quickResultUnverified = (mode === 'when' && earliest?.reason === 'lockedWithdrawalLimits') ||
    (mode === 'number' && fireNumber?.reason === 'lockedWithdrawalLimits')
  const targetResultUnverified = mode === 'target' && goal?.status === 'supported' && lockedWithdrawalUnverified
  const resultUnverified = props.taxWarning || props.taxEstimate || (mode === 'last' && lastResultUnverified) || quickResultUnverified || targetResultUnverified

  const ok =
    mode === 'last'
      ? result.success
      : mode === 'when'
        ? earliest?.status === 'solved'
      : mode === 'target'
          ? goal !== null && goal.status === 'supported' && goal.reachedAge !== null && goal.reachedAge <= inputs.fireAge
          : mode === 'number'
            ? !quickEstimateUnsupported && Number.isFinite(projectedAtFire) && fireNumber?.value !== null &&
              fireNumber?.value !== undefined && projectedAtFire! >= fireNumber.value
            : true

  if (props.legacyEstimate) return (
    <div className="summary uncertain" data-testid="legacy-estimate">
      <p className="hint">{t(props.legacyOwnershipPending ? 'migrationLegacySummary' : 'migrationApproximate')}</p>
      <p>{t('finalNetWorth')}: <strong>{cad(result.finalNetWorth)}</strong></p>
    </div>
  )

  if (props.taxEstimate) return <div className="summary uncertain" data-testid="person-tax-estimate">
    <p className="hint">{t('be11TaxLimit')}</p>
    <p>{t('finalNetWorth')}: <strong>{cad(result.finalNetWorth)}</strong></p>
  </div>

  if (props.personTax) return <div className="summary uncertain" data-testid="person-tax-summary">
    <p className="verdict">{result.success ? t('modeledSuccessUnverified', { age: inputs.lifeExpectancy }) : t('stratDepleted', { age: result.depletedAge })}</p>
    <p>{t('finalNetWorth')}: <strong>{cad(result.finalNetWorth)}</strong></p>
    <p className="hint">{t('be11.ledgerLimit')}</p>
  </div>

  return (
    <div className={`summary ${resultUnverified
      ? 'uncertain' : mode === 'target' && target <= 0 ? '' : ok ? 'ok' : 'bad'}`}>
      <div className="mode-tabs" role="tablist">
        {(['last', 'when', 'number', 'target'] as Mode[]).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={mode === m ? 'active' : ''}
            onClick={() => {
              setMode(m)
              track('question_mode_change', { mode: m })
            }}
          >
            {t(`mode_${m}`)}
          </button>
        ))}
      </div>

      {mode === 'last' && (
        <>
          <p className="verdict">
            {result.success
              ? lastResultUnverified ? t('modeledSuccessUnverified', { age: inputs.lifeExpectancy })
                : t('success', { age: inputs.lifeExpectancy })
              : t('depleted', { age: result.depletedAge })}
          </p>
          {lockedWithdrawalUnverified && <p className="hint">{t('lockedWithdrawalUnverified')}</p>}
          {result.unfundedObligations.length > 0 && <ul className="funding-gaps">
            {result.unfundedObligations.map((gap) => <li key={gap.eventId + gap.reason}>
              {t(gap.reason === 'invalidPurchase' ? 'valPurchaseInvalid'
                : gap.reason === 'missingMortgage' ? 'valPurchaseMortgageRequired'
                : gap.reason === 'fhsaContribution' ? 'valFhsaContributionUnfunded'
                : gap.reason === 'employeeContribution' ? 'valContributionsUnfunded'
                  : gap.reason === 'saleDischarge' ? 'valSaleDischargeUnfunded'
                  : gap.reason === 'saleTax' ? 'valSaleTaxUnfunded'
                  : gap.reason === 'purchaseCost' ? 'valPurchaseCostUnfunded' : 'valDownPaymentUnfunded',
              { age: Number(gap.eventId.split(':')[1]), amount: Math.ceil(gap.amount) })}
            </li>)}
          </ul>}
          <p>
            {t('finalNetWorth')}: <strong>{cad(result.finalNetWorth)}</strong>
            {result.terminalTaxStatus === 'estimated' && <>
              {' · '}
              {t('estateValue')}: <strong>{cad(result.estateValue)}</strong>
            </>}
          </p>
          {result.terminalTaxStatus === 'estimated' ? <p className="hint">{t('terminalTaxBreakdown', {
            registered: cad(result.terminalRegisteredIncome),
            gains: cad(result.terminalCapitalGainsIncome),
            tax: cad(result.estateTax),
            oas: cad(result.terminalOasRecovery),
            probate: cad(result.probateFee),
          })}</p> : <p className="hint">{t('terminalUnsupported')}</p>}
          <p className="hint">{t('terminalEstimateNote')}</p>
          {dwzSpending?.status === 'solved' && dwzSpending.value !== null && (
            <>
              <p>
                {t('dwzSpending')}: <strong>{cad(dwzSpending.value)}</strong>
                <span className="hint"> ({t('currentSpending')}: {cad(inputs.retirementSpending)})</span>
              </p>
              <p className="hint"><Jargon text={t('dwzNote')} /></p>
              <p className="dwz-warning"><Jargon text={t('dwzRiskWarning')} /></p>
            </>
          )}
          {dwzSpending && dwzSpending.status !== 'solved' &&
            <p className="hint">{dwzSpending.reason
              ? t(`solverReason_${dwzSpending.reason}`, { defaultValue: t(`solver_${dwzSpending.status}`) })
              : t(`solver_${dwzSpending.status}`)}</p>}
          {dwzSpending?.status === 'searchLimit' && dwzSpending.lastVerifiedBound !== null &&
            <p className="hint">{t('solverCheckedSpending', { amount: cad(dwzSpending.lastVerifiedBound), iterations: dwzSpending.iterations })}</p>}
        </>
      )}

      {mode === 'when' && (
        <>
          <p className="verdict">
            {earliest?.status === 'solved'
              ? t('whenAnswer', { age: earliest.value })
              : earliest?.status === 'infeasible' ? t('whenNever', { age: earliest.lastVerifiedBound ?? inputs.currentAge })
                : earliest?.reason ? t(`solverReason_${earliest.reason}`, { defaultValue: t('solver_unsupported') })
                  : t(`solver_${earliest?.status ?? 'unsupported'}`)}
          </p>
          {earliest?.status !== 'solved' && earliest?.lastVerifiedBound !== null && earliest?.lastVerifiedBound !== undefined &&
            <p className="hint">{t('solverCheckedAge', { age: earliest.lastVerifiedBound, iterations: earliest.iterations })}</p>}
          {earliest?.status === 'solved' && earliestAssets !== null && (
            <p>
              <Jargon
                text={t('whenAssets', { age: earliest.value, amount: cad(earliestAssets) })}
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
          <p className="hint">{t('solverWhenAssumptions')}</p>
        </>
      )}

      {mode === 'number' && (
        <>
          {quickEstimateUnsupported ? <>
            <p className="verdict">{quickEstimateMessage}</p>
            {fireNumber?.status === 'searchLimit' && fireNumber.lastVerifiedBound !== null &&
              <p className="hint">{t('solverCheckedAssets', { amount: cad(fireNumber.lastVerifiedBound), iterations: fireNumber.iterations })}</p>}
          </> : <>
          <p className="verdict">
            {t('numberAnswer', { age: inputs.fireAge, amount: cad(fireNumber!.value!) })}
          </p>
          {Number.isFinite(projectedAtFire) && fireNumber?.value !== null && fireNumber?.value !== undefined && (
            <p>
              <Jargon
                text={
                  t('numberHave', { age: inputs.fireAge, amount: cad(projectedAtFire!) }) +
                  (projectedAtFire! >= fireNumber.value
                    ? t('numberSurplus', { amount: cad(projectedAtFire! - fireNumber.value) })
                    : t('numberGap', { amount: cad(fireNumber.value - projectedAtFire!) }))
                }
              />
            </p>
          )}
          <p className="hint">
            <Jargon text={t('numberExplain', { age: inputs.fireAge, life: inputs.lifeExpectancy })} />
          </p>
          </>}
          <p className="hint">{t('solverNumberAssumptions')}</p>
        </>
      )}

      {mode === 'target' && (
        <>
          <label className="field target-field">
            <span><Jargon text={t('targetInputLabel')} /></span>
            <NumberInput
              step={50000}
              value={inputs.fireTargetAssets ?? null}
              onChange={(v) => {
                set({ fireTargetAssets: v })
                setQuestionAnswer('time.work.target', v != null && v > 0 ? 'yes' : 'no')
                markAnswers(['fireTargetAssets'], v != null && v > 0 ? 'confirmed' : 'notApplicable')
                if (entryMode === 'guided') useStore.getState().generateGuidedResults()
              }}
            />
          </label>
          {!goal && <p className="hint">{t('targetUnset')}</p>}
          {goal?.status === 'unsupported' && <p className="verdict">{quickEstimateMessage}</p>}
          {goal?.status === 'supported' && (
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
          {targetResultUnverified && <p className="hint">{t('lockedWithdrawalUnverified')}</p>}
          <p className="hint"><Jargon text={t('targetHint')} /></p>
        </>
      )}
    </div>
  )
}
