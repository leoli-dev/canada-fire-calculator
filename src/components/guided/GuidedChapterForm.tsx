import { useTranslation } from 'react-i18next'
import type { Goal, Province } from '../../engine'
import {
  DEFAULT_FHSA,
  DEFAULT_LOCKED_RETIREMENT,
  DEFAULT_PARTNER,
  useStore,
  type AnswerStatus,
} from '../../store'
import { useCad } from '../../format'
import { NumberInput } from '../NumberInput'

const PROVINCES: Province[] = [
  'ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'PE', 'NL', 'YT', 'NT', 'NU',
]

export const REQUIRED_BY_STEP: Record<number, string[]> = {
  1: ['goal', 'currentAge', 'fireAge', 'lifeExpectancy', 'province', 'household'],
  2: ['annualSavings'],
  3: ['balances.tfsa', 'balances.rrsp', 'balances.nonReg', 'nonRegBook'],
  4: ['housingMode'],
  5: ['retirementSpending'],
  6: ['cppStartAge', 'cppAnnualAt65', 'oasStartAge', 'oasAnnualAt65'],
  7: [],
}

function MetaBadge({ field }: { field: string }) {
  const { t } = useTranslation()
  const meta = useStore((state) => state.answerMeta[field])
  const status = meta?.origin === 'legacy' ? 'legacy' : (meta?.status ?? 'example')
  return <small className={`answer-meta ${status}`}>{t(`guided.meta.${status}`)}</small>
}

function GuidedNumber(props: {
  field: string
  label: string
  value: number
  onValue: (value: number) => void
  step?: number
  suffix?: string
}) {
  const { t } = useTranslation()
  const markAnswers = useStore((state) => state.markAnswers)
  return (
    <label className="guided-field" data-field={props.field}>
      <span>{props.label} <MetaBadge field={props.field} /></span>
      <span className="guided-input-wrap">
        <NumberInput
          value={props.value}
          step={props.step}
          onChange={(value) => {
            if (value == null) {
              markAnswers([props.field], 'unknown')
              return
            }
            props.onValue(value)
            markAnswers([props.field], 'confirmed')
          }}
        />
        {props.suffix && <small>{props.suffix}</small>}
      </span>
      <button type="button" className="unknown-answer" onClick={() => markAnswers([props.field], 'unknown')}>
        {t('guidedUnknown')}
      </button>
    </label>
  )
}

function ChapterIntro({ chapter }: { chapter: string }) {
  const { t } = useTranslation()
  return (
    <div className="concept-panel">
      <h3>{t(`guided.steps.${chapter}.question`)}</h3>
      <p>{t(`guided.steps.${chapter}.why`)}</p>
      <p><strong>{t('guidedWhere')}</strong> {t(`guided.steps.${chapter}.how`)}</p>
      <p className="fictional-example"><strong>{t('guidedExample')}</strong> {t(`guided.steps.${chapter}.example`)}</p>
    </div>
  )
}

export function GuidedChapterForm({ step }: { step: number }) {
  const { t } = useTranslation()
  const cad = useCad()
  const { inputs, set, markAnswers, displayMode, setDisplayMode } = useStore()
  const setStatus = (field: string, status: AnswerStatus) => markAnswers([field], status)

  if (step === 1) return (
    <section className="question-card">
      <ChapterIntro chapter="household" />
      <fieldset><legend>{t('guidedCorePlan')}</legend>
        <label className="guided-field" data-field="goal">
          <span>{t('goal')} <MetaBadge field="goal" /></span>
          <select value={inputs.goal ?? 'legacy'} onChange={(event) => {
            set({ goal: event.target.value as Goal }); setStatus('goal', 'confirmed')
          }}>
            <option value="legacy">{t('goal_legacy')}</option>
            <option value="dieWithZero">{t('goal_dieWithZero')}</option>
          </select>
        </label>
        <GuidedNumber field="currentAge" label={t('currentAge')} value={inputs.currentAge} onValue={(currentAge) => set({ currentAge })} />
        <GuidedNumber field="fireAge" label={t('fireAge')} value={inputs.fireAge} onValue={(fireAge) => set({ fireAge })} />
        <p className="guided-feedback">{t('guidedRetirementVsBenefits', { fire: inputs.fireAge, benefits: inputs.cppStartAge })}</p>
        <GuidedNumber field="lifeExpectancy" label={t('lifeExpectancy')} value={inputs.lifeExpectancy} onValue={(lifeExpectancy) => set({ lifeExpectancy })} />
        <label className="guided-field" data-field="province">
          <span>{t('province')} <MetaBadge field="province" /></span>
          <select value={inputs.province} onChange={(event) => {
            set({ province: event.target.value as Province }); setStatus('province', 'confirmed')
          }}>{PROVINCES.map((province) => <option key={province} value={province}>{province} — {t(`prov_${province}`)}</option>)}</select>
        </label>
        <label className="guided-field" data-field="household">
          <span>{t('household')} <MetaBadge field="household" /></span>
          <select value={inputs.partner ? 'couple' : 'single'} onChange={(event) => {
            set({ partner: event.target.value === 'couple' ? DEFAULT_PARTNER : null })
            setStatus('household', 'confirmed')
          }}><option value="single">{t('single')}</option><option value="couple">{t('couple')}</option></select>
        </label>
        {inputs.partner && <GuidedNumber field="partner.currentAge" label={t('partnerAge')} value={inputs.partner.currentAge} onValue={(currentAge) => set({ partner: { ...inputs.partner!, currentAge } })} />}
      </fieldset>
    </section>
  )

  if (step === 2) return (
    <section className="question-card">
      <ChapterIntro chapter="income" />
      <fieldset><legend>{t('guidedSavingsQuestion')}</legend>
        <GuidedNumber field="annualSavings" label={t('annualSavings')} value={inputs.annualSavings} step={1000} onValue={(annualSavings) => set({ annualSavings })} />
        <div className="story-strip"><span>{t('guidedPerMonth', { amount: cad(inputs.annualSavings / 12) })}</span><strong>{t('guidedPerYear', { amount: cad(inputs.annualSavings) })}</strong></div>
        <p className="guided-feedback">{t('guidedSavingsExcludes')}</p>
        <label className="guided-field toggle-row"><span>{t('extraIncomeToggle')}</span><input type="checkbox" checked={!!inputs.extraIncome} onChange={(event) => {
          set({ extraIncome: event.target.checked ? { annual: 20_000, fromAge: inputs.fireAge, toAge: inputs.fireAge + 10 } : null })
          setStatus('extraIncome', event.target.checked ? 'estimated' : 'notApplicable')
        }} /></label>
        {inputs.extraIncome && <>
          <GuidedNumber field="extraIncome.annual" label={t('extraIncomeAnnual')} value={inputs.extraIncome.annual} step={1000} onValue={(annual) => set({ extraIncome: { ...inputs.extraIncome!, annual } })} />
          <GuidedNumber field="extraIncome.fromAge" label={t('extraIncomeFrom')} value={inputs.extraIncome.fromAge} onValue={(fromAge) => set({ extraIncome: { ...inputs.extraIncome!, fromAge } })} />
          <GuidedNumber field="extraIncome.toAge" label={t('extraIncomeTo')} value={inputs.extraIncome.toAge} onValue={(toAge) => set({ extraIncome: { ...inputs.extraIncome!, toAge } })} />
        </>}
      </fieldset>
    </section>
  )

  if (step === 3) return (
    <section className="question-card">
      <ChapterIntro chapter="accounts" />
      <fieldset><legend>{t('guidedBalancesToday')}</legend>
        {(['tfsa', 'rrsp', 'nonReg'] as const).map((account) => <GuidedNumber key={account} field={`balances.${account}`} label={t(account)} value={inputs.balances[account]} step={5000} onValue={(value) => set({ balances: { ...inputs.balances, [account]: value } })} />)}
        <p className="guided-feedback">{t('guidedBalanceNotRoom')}</p>
        <GuidedNumber field="nonRegBook" label={t('nonRegBook')} value={inputs.nonRegBook} step={5000} onValue={(nonRegBook) => set({ nonRegBook })} />
        <p className="guided-feedback">{t('guidedAcbFeedback', { value: cad(inputs.balances.nonReg), cost: cad(inputs.nonRegBook), gain: cad(Math.max(0, inputs.balances.nonReg - inputs.nonRegBook)) })}</p>
      </fieldset>
      <fieldset><legend>{t('guidedSpecialAccounts')}</legend>
        <label className="guided-field toggle-row"><span>{t('fhsaToggle')}</span><input type="checkbox" checked={!!inputs.fhsa} onChange={(event) => {
          set({ fhsa: event.target.checked ? { ...DEFAULT_FHSA } : null }); setStatus('fhsa', event.target.checked ? 'estimated' : 'notApplicable')
        }} /></label>
        {inputs.fhsa && <>
          <GuidedNumber field="fhsa.balance" label={t('fhsaBalance')} value={inputs.fhsa.balance} step={2000} onValue={(balance) => set({ fhsa: { ...inputs.fhsa!, balance } })} />
          <GuidedNumber field="fhsa.annualContribution" label={t('fhsaContribution')} value={inputs.fhsa.annualContribution} step={500} onValue={(annualContribution) => set({ fhsa: { ...inputs.fhsa!, annualContribution } })} />
          <GuidedNumber field="fhsa.openedYearsAgo" label={t('fhsaOpenedYearsAgo')} value={inputs.fhsa.openedYearsAgo} onValue={(openedYearsAgo) => set({ fhsa: { ...inputs.fhsa!, openedYearsAgo } })} />
        </>}
        <label className="guided-field toggle-row"><span>{t('lockedRetirementToggle')}</span><input type="checkbox" checked={!!inputs.lockedRetirement} onChange={(event) => {
          set({ lockedRetirement: event.target.checked ? { ...DEFAULT_LOCKED_RETIREMENT } : null }); setStatus('lockedRetirement', event.target.checked ? 'estimated' : 'notApplicable')
        }} /></label>
        {inputs.lockedRetirement && <>
          <GuidedNumber field="lockedRetirement.balance" label={t('lockedRetirementBalance')} value={inputs.lockedRetirement.balance} step={5000} onValue={(balance) => set({ lockedRetirement: { ...inputs.lockedRetirement!, balance } })} />
          <GuidedNumber field="lockedRetirement.accessibleAge" label={t('lockedRetirementAge')} value={inputs.lockedRetirement.accessibleAge} onValue={(accessibleAge) => set({ lockedRetirement: { ...inputs.lockedRetirement!, accessibleAge } })} />
          <p className="guided-feedback">{t('guidedLockedTimeline', { fire: inputs.fireAge, access: inputs.lockedRetirement.accessibleAge })}</p>
        </>}
      </fieldset>
    </section>
  )

  if (step === 4) {
    const mode = inputs.principalResidence?.mode === 'planned' ? 'planned' : inputs.principalResidence ? 'owned' : 'rent'
    return <section className="question-card">
      <ChapterIntro chapter="housing" />
      <fieldset><legend>{t('guidedHousingSituation')}</legend>
        <label className="guided-field" data-field="housingMode"><span>{t('guidedHousingMode')} <MetaBadge field="housingMode" /></span><select value={mode} onChange={(event) => {
          const next = event.target.value
          set({ principalResidence: next === 'owned' ? { value: 800_000, appreciation: 0.02, sellAtAge: null } : next === 'planned' ? { mode: 'planned', buyAtAge: inputs.currentAge + 5, price: 800_000, downPayment: 200_000, appreciation: 0.02, annualMortgagePayment: 42_000, mortgageYears: 25, netHoldingCostChange: 0, sellAtAge: null } : null })
          setStatus('housingMode', next === 'rent' ? 'notApplicable' : 'estimated')
        }}><option value="rent">{t('guidedRent')}</option><option value="owned">{t('prModeOwned')}</option><option value="planned">{t('prModePlanned')}</option></select></label>
        {inputs.principalResidence && inputs.principalResidence.mode !== 'planned' && <GuidedNumber field="principalResidence.value" label={t('propValue')} value={inputs.principalResidence.value} step={25000} onValue={(value) => set({ principalResidence: { ...inputs.principalResidence as any, value } })} />}
        {inputs.principalResidence?.mode === 'planned' && <>
          <GuidedNumber field="principalResidence.buyAtAge" label={t('prBuyAtAge')} value={inputs.principalResidence.buyAtAge} onValue={(buyAtAge) => set({ principalResidence: { ...inputs.principalResidence as any, buyAtAge } })} />
          <GuidedNumber field="principalResidence.price" label={t('prPrice')} value={inputs.principalResidence.price} step={25000} onValue={(price) => set({ principalResidence: { ...inputs.principalResidence as any, price } })} />
          <GuidedNumber field="principalResidence.downPayment" label={t('prDownPayment')} value={inputs.principalResidence.downPayment} step={10000} onValue={(downPayment) => set({ principalResidence: { ...inputs.principalResidence as any, downPayment } })} />
        </>}
        <p className="guided-feedback">{mode === 'rent' ? t('guidedRentFeedback') : t('guidedHomeLiquidity')}</p>
        {(inputs.investmentProperties?.length ?? 0) + (inputs.debts?.length ?? 0) > 0 && <p className="guided-feedback">{t('guidedAdvancedHousingPresent', { properties: inputs.investmentProperties?.length ?? 0, debts: inputs.debts?.length ?? 0 })}</p>}
      </fieldset>
    </section>
  }

  if (step === 5) return (
    <section className="question-card">
      <ChapterIntro chapter="spending" />
      <fieldset><legend>{t('guidedSpendingQuestion')}</legend>
        <GuidedNumber field="retirementSpending" label={t('retirementSpending')} value={inputs.retirementSpending} step={1000} onValue={(retirementSpending) => set({ retirementSpending })} />
        <div className="story-strip"><span>{t('guidedPerMonth', { amount: cad(inputs.retirementSpending / 12) })}</span><strong>{t('guidedPerYear', { amount: cad(inputs.retirementSpending) })}</strong></div>
        <p className="guided-feedback">{t('guidedSpendingTaxNote')}</p>
      </fieldset>
    </section>
  )

  return (
    <section className="question-card">
      <ChapterIntro chapter="benefits" />
      <fieldset><legend>{t('benefitsSelf')}</legend>
        <GuidedNumber field="cppAnnualAt65" label={t('cppAnnualAt65')} value={inputs.cppAnnualAt65} step={500} onValue={(cppAnnualAt65) => set({ cppAnnualAt65 })} />
        <GuidedNumber field="cppStartAge" label={t('cppStartAge')} value={inputs.cppStartAge} onValue={(cppStartAge) => set({ cppStartAge })} />
        <GuidedNumber field="oasAnnualAt65" label={t('oasAnnualAt65')} value={inputs.oasAnnualAt65} step={100} onValue={(oasAnnualAt65) => set({ oasAnnualAt65 })} />
        <GuidedNumber field="oasStartAge" label={t('oasStartAge')} value={inputs.oasStartAge} onValue={(oasStartAge) => set({ oasStartAge })} />
        {inputs.partner && <>
          <p className="subhead">{t('partnerSection')}</p>
          <GuidedNumber field="partner.cppAnnualAt65" label={t('cppAnnualAt65')} value={inputs.partner.cppAnnualAt65} step={500} onValue={(cppAnnualAt65) => set({ partner: { ...inputs.partner!, cppAnnualAt65 } })} />
          <GuidedNumber field="partner.cppStartAge" label={t('cppStartAge')} value={inputs.partner.cppStartAge} onValue={(cppStartAge) => set({ partner: { ...inputs.partner!, cppStartAge } })} />
          <GuidedNumber field="partner.oasAnnualAt65" label={t('oasAnnualAt65')} value={inputs.partner.oasAnnualAt65} step={100} onValue={(oasAnnualAt65) => set({ partner: { ...inputs.partner!, oasAnnualAt65 } })} />
          <GuidedNumber field="partner.oasStartAge" label={t('oasStartAge')} value={inputs.partner.oasStartAge} onValue={(oasStartAge) => set({ partner: { ...inputs.partner!, oasStartAge } })} />
        </>}
      </fieldset>
      <fieldset><legend>{t('guidedAssumptions')}</legend>
        <label className="guided-field"><span>{t('inflationLabel')}</span><select value={String(inputs.inflation ?? 0.021)} onChange={(event) => set({ inflation: Number(event.target.value) })}><option value="0.015">{t('infl_low')}</option><option value="0.021">{t('infl_mid')}</option><option value="0.03">{t('infl_high')}</option></select></label>
        <label className="guided-field"><span>{t('displayModeLabel')}</span><select value={displayMode} onChange={(event) => setDisplayMode(event.target.value as 'real' | 'nominal')}><option value="real">{t('display_real')}</option><option value="nominal">{t('display_nominal')}</option></select></label>
        <p className="guided-feedback">{t('guidedAssumptionNote')}</p>
      </fieldset>
    </section>
  )
}
