import { useTranslation } from 'react-i18next'
import { blendedReturn, validateInputs, type DebtKind, type Goal, type Pension, type Province, type Strategy } from '../../engine'
import {
  DEFAULT_FHSA,
  DEFAULT_INVESTMENT_PROPERTY,
  DEFAULT_LOCKED_RETIREMENT,
  DEFAULT_PARTNER,
  DEFAULT_PENSION,
  MIX_PRESETS,
  useStore,
} from '../../store'
import { useCad } from '../../format'
import type { QuestionDefinition } from '../../guided/schema'
import { guidanceForPage } from '../../guided/pageGuidance'
import { NumberInput } from '../NumberInput'
import { CppEstimator, OasEstimator } from '../BenefitEstimators'

const PROVINCES: Province[] = ['ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'PE', 'NL', 'YT', 'NT', 'NU']

function QuestionHelp({ guidanceKey }: { guidanceKey: string }) {
  const { i18n, t } = useTranslation()
  const guidance = guidanceForPage(guidanceKey, i18n.resolvedLanguage ?? i18n.language)
  return <details className="question-help">
    <summary>{t('questionnaire.helpTitle')}</summary>
    <p>{guidance.why}</p>
    <p><strong>{t('questionnaire.findLabel')}</strong> {guidance.find}</p>
    <p className="question-example"><strong>{t('questionnaire.exampleLabel')}</strong> {guidance.example}</p>
  </details>
}

function FactNumber(props: { field: string; label: string; value: number; onValue: (value: number) => void; step?: number }) {
  const { t } = useTranslation()
  const markAnswers = useStore((s) => s.markAnswers)
  const meta = useStore((s) => s.answerMeta[props.field])
  const inputs = useStore((s) => s.inputs)
  const issue = props.field.startsWith('principalResidence.') || props.field === 'lockedRetirement.employeeContribution'
    ? validateInputs(inputs).find((candidate) => candidate.field === props.field && candidate.severity === 'error')
    : undefined
  return <div className="question-answer" data-field={props.field}>
    <label htmlFor={`q-${props.field}`}>{props.label}</label>
    <NumberInput id={`q-${props.field}`} value={props.value} step={props.step} onChange={(value) => {
      if (value == null) return markAnswers([props.field], 'unknown')
      props.onValue(value)
      markAnswers([props.field], 'confirmed')
    }} className="question-number" />
    <div className="answer-actions">
      <small>{t(`guided.meta.${meta?.origin === 'legacy' ? 'legacy' : (meta?.status ?? 'example')}`)}</small>
      <button type="button" onClick={() => markAnswers([props.field], 'unknown')}>{t('guidedUnknown')}</button>
    </div>
    {issue && <em className="field-issue error">{t(issue.key, issue.params)}</em>}
  </div>
}

function ChoiceGroup(props: { id: string; value?: string; label?: string; options: Array<{ value: string; label: string; detail?: string }>; onChange: (value: string) => void }) {
  return <div className="choice-group" role="radiogroup" aria-label={props.label}>
    {props.options.map((option) => <label key={option.value} className={props.value === option.value ? 'selected' : ''}>
      <input type="radio" name={props.id} value={option.value} checked={props.value === option.value} onChange={() => props.onChange(option.value)} />
      <span><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span>
    </label>)}
  </div>
}

function BenefitClaimAgeGuide(props: { field: string; value: number; kind: 'cpp' | 'qpp' | 'oas'; onValue: (value: number) => void }) {
  const { t } = useTranslation()
  const markAnswers = useStore((s) => s.markAnswers)
  const meta = useStore((s) => s.answerMeta[props.field])
  const isOas = props.kind === 'oas'
  const guideTitle = t(isOas ? 'guidedOasAgeGuideTitle' : props.kind === 'qpp' ? 'guidedQppAgeGuideTitle' : 'guidedCppAgeGuideTitle')
  const options = isOas ? [
    { value: '65', label: t('guidedOasAge65'), detail: t('guidedOasAge65Detail') },
    { value: '67', label: t('guidedOasAge67'), detail: t('guidedOasAge67Detail') },
    { value: '70', label: t('guidedOasAge70'), detail: t('guidedOasAge70Detail') },
  ] : [
    { value: '60', label: t('guidedCppAgeEarly'), detail: t('guidedCppAgeEarlyDetail') },
    { value: '65', label: t('guidedCppAgeStandard'), detail: t('guidedCppAgeStandardDetail') },
    { value: '70', label: t('guidedCppAgeLate'), detail: t('guidedCppAgeLateDetail') },
    ...(props.kind === 'qpp' ? [{ value: '72', label: t('guidedQppAgeLate'), detail: t('guidedQppAgeLateDetail') }] : []),
  ]
  const source = isOas
    ? 'https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/when-start.html'
    : props.kind === 'qpp'
      ? 'https://www.retraitequebec.gouv.qc.ca/en/citizens/retirement-planning/applying-your-retirement-pension/retirement-pension-quebec-pension-plan/what-age-should-you-apply-your-retirement-pension'
      : 'https://www.canada.ca/en/services/benefits/publicpensions/cpp/when-start.html'
  return <div className="benefit-age-guide">
    <h3>{guideTitle}</h3>
    <p>{t(isOas ? 'guidedOasAgeGuideIntro' : 'guidedCppAgeGuideIntro')}</p>
    <ChoiceGroup id={props.field} label={guideTitle} value={meta?.status === 'confirmed' ? String(props.value) : undefined} options={options} onChange={(value) => {
      props.onValue(Number(value))
      markAnswers([props.field], 'confirmed')
    }} />
    <p className="benefit-age-source">{t(isOas ? 'guidedOasAgeGuideNote' : 'guidedCppAgeGuideNote')} <a href={source} target="_blank" rel="noopener noreferrer">{t(isOas ? 'guidedOasAgeGuideSource' : 'guidedCppAgeGuideSource')}</a></p>
  </div>
}

function PensionIndexing(props: {
  prefix: 'pension' | 'partner.pension'
  pension: Pension
  answer?: string
  setAnswer: (id: string, value: string) => void
  setPension: (pension: Pension) => void
}) {
  const { t } = useTranslation()
  const markAnswers = useStore((s) => s.markAnswers)
  const questionId = props.prefix === 'pension' ? 'pension.self.indexing' : 'pension.partner.indexing'
  const choose = (value: string) => {
    props.setAnswer(questionId, value)
    if (value === 'full') props.setPension({ ...props.pension, indexation: 1 })
    if (value === 'fixed') props.setPension({ ...props.pension, indexation: 0 })
    markAnswers([`${props.prefix}.indexation`], value === 'unknown' ? 'unknown' : 'confirmed')
  }
  return <div className="question-pair">
    <div><ChoiceGroup id={`${questionId}-kind`} value={props.answer} options={[
      { value: 'full', label: t('questionnaire.choice.indexedFull') },
      { value: 'partial', label: t('questionnaire.choice.indexedPartial') },
      { value: 'fixed', label: t('questionnaire.choice.indexedFixed') },
      { value: 'unknown', label: t('questionnaire.choice.unknown') },
    ]} onChange={choose} />
    {props.answer === 'partial' && <FactNumber field={`${props.prefix}.indexation`} label={t('pensionIndexation')} value={props.pension.indexation * 100} onValue={(value) => props.setPension({ ...props.pension, indexation: value / 100 })} />}</div>
    <FactNumber field={`${props.prefix}.bridgeAnnual`} label={t('pensionBridge')} value={props.pension.bridgeAnnual} onValue={(bridgeAnnual) => props.setPension({ ...props.pension, bridgeAnnual })} />
  </div>
}

export function QuestionPage({ definition }: { definition: QuestionDefinition }) {
  const { i18n, t } = useTranslation()
  const cad = useCad()
  const {
    inputs, set, answerMeta, markAnswers, questionAnswers, setQuestionAnswer,
    planningIntent, setPlanningIntent, worksheet, setWorksheet, applyMixPreset,
  } = useStore()
  const key = definition.contentKey
  const answer = questionAnswers[definition.id] as string | undefined
  const markChoice = (field: string, value: string, status: 'confirmed' | 'notApplicable' = 'confirmed') => {
    setQuestionAnswer(definition.id, value)
    markAnswers([field], status)
  }
  const applyIntent = (legacyPreference: typeof planningIntent.legacyPreference, spendingPreference: typeof planningIntent.spendingPreference) => {
    const goal: Goal = spendingPreference === 'exploreCeiling' ? 'dieWithZero' : 'legacy'
    set({ goal })
    setPlanningIntent({ legacyPreference, spendingPreference, understandingAcknowledged: true, confirmedIntentRevision: Date.now() })
    markAnswers(['goal'], 'confirmed')
  }

  let control: React.ReactNode
  switch (definition.id) {
    case 'family.people':
      control = <ChoiceGroup id={definition.id} value={inputs.partner ? 'couple' : answer} options={[
        { value: 'single', label: t('single'), detail: t('questionnaire.choice.single') },
        { value: 'couple', label: t('couple'), detail: t('questionnaire.choice.couple') },
      ]} onChange={(value) => {
        set({ partner: value === 'couple' ? (inputs.partner ?? DEFAULT_PARTNER) : null })
        markChoice('household', value)
      }} />
      break
    case 'family.ages':
      control = <div className="question-pair"><FactNumber field="currentAge" label={t('currentAge')} value={inputs.currentAge} onValue={(currentAge) => set({ currentAge })} />
        {inputs.partner && <FactNumber field="partner.currentAge" label={t('partnerAge')} value={inputs.partner.currentAge} onValue={(currentAge) => set({ partner: { ...inputs.partner!, currentAge } })} />}</div>
      break
    case 'family.children': {
      const hasChildren = !!inputs.children
      control = <><ChoiceGroup id={definition.id} value={hasChildren ? 'yes' : answer} options={[
        { value: 'no', label: t('questionnaire.choice.noChildren') },
        { value: 'yes', label: t('questionnaire.choice.hasChildren') },
      ]} onChange={(value) => {
        set({ children: value === 'yes' ? (inputs.children ?? [{ age: 5 }]) : null })
        markChoice('children', value, value === 'yes' ? 'confirmed' : 'notApplicable')
      }} />
      {inputs.children?.map((child, index) => <FactNumber key={index} field={`children.${index}.age`} label={t('childCard', { n: index + 1 })} value={child.age} onValue={(age) => {
        const children = [...inputs.children!]; children[index] = { age }; set({ children })
      }} />)}</>
      break
    }
    case 'family.province':
      control = <label className="question-select"><span>{t('province')}</span><select value={inputs.province} onChange={(e) => { set({ province: e.target.value as Province }); markAnswers(['province'], 'confirmed') }}>{PROVINCES.map((p) => <option key={p}>{p}</option>)}</select></label>
      break
    case 'time.work':
      control = <>
        <FactNumber field="fireAge" label={t('fireAge')} value={inputs.fireAge} onValue={(fireAge) => set({ fireAge })} />
        <section className="target-question" aria-labelledby="target-question-title">
          <h3 id="target-question-title">{t('questionnaire.targetQuestion')}</h3>
          <p>{t('questionnaire.targetExplanation')}</p>
          <ChoiceGroup id="time.work.target" label={t('questionnaire.targetQuestion')} value={questionAnswers['time.work.target'] as string | undefined} options={[
            { value: 'yes', label: t('questionnaire.choice.hasTarget') },
            { value: 'no', label: t('questionnaire.choice.noTarget') },
          ]} onChange={(value) => {
            setQuestionAnswer('time.work.target', value)
            if (value === 'no') {
              set({ fireTargetAssets: null })
              markAnswers(['fireTargetAssets'], 'notApplicable')
            } else {
              set({ fireTargetAssets: inputs.fireTargetAssets ?? 1_000_000 })
              markAnswers(['fireTargetAssets'], 'unknown')
            }
          }} />
          {questionAnswers['time.work.target'] === 'yes' && <>
            <FactNumber field="fireTargetAssets" label={t('targetInputLabel')} value={inputs.fireTargetAssets ?? 1_000_000} step={50_000} onValue={(fireTargetAssets) => set({ fireTargetAssets })} />
            {answerMeta.fireTargetAssets?.status !== 'confirmed' && <p className="answer-feedback">{t('questionnaire.targetExampleNote')}</p>}
          </>}
        </section>
      </>
      break
    case 'time.horizon':
      control = <FactNumber field="lifeExpectancy" label={t('lifeExpectancy')} value={inputs.lifeExpectancy} onValue={(lifeExpectancy) => set({ lifeExpectancy })} />
      break
    case 'saving.method':
      control = <ChoiceGroup id={definition.id} value={answer} options={[{ value: 'monthly', label: t('questionnaire.choice.monthly') }, { value: 'annual', label: t('questionnaire.choice.annual') }]} onChange={(value) => setQuestionAnswer(definition.id, value)} />
      break
    case 'saving.amount': {
      const monthly = questionAnswers['saving.method'] !== 'annual'
      control = <><FactNumber field="annualSavings" label={monthly ? t('questionnaire.monthlySavings') : t('annualSavings')} value={monthly ? inputs.annualSavings / 12 : inputs.annualSavings} step={monthly ? 100 : 1000} onValue={(value) => set({ annualSavings: monthly ? value * 12 : value })} />
        <p className="answer-feedback">{t('questionnaire.savingFeedback', { monthly: cad(inputs.annualSavings / 12), annual: cad(inputs.annualSavings) })}</p></>
      break
    }
    case 'work.after':
      control = <ChoiceGroup id={definition.id} value={answer} options={[{ value: 'no', label: t('questionnaire.choice.noWork') }, { value: 'yes', label: t('questionnaire.choice.someWork') }, { value: 'unknown', label: t('questionnaire.choice.undecided') }]} onChange={(value) => {
        setQuestionAnswer(definition.id, value)
        set({ extraIncome: value === 'yes' ? (inputs.extraIncome ?? { annual: 20_000, fromAge: inputs.fireAge, toAge: inputs.fireAge + 10 }) : null })
        markAnswers(['extraIncome'], value === 'yes' ? 'estimated' : value === 'no' ? 'notApplicable' : 'unknown')
      }} />
      break
    case 'work.amount':
      control = <FactNumber field="extraIncome.annual" label={t('extraIncomeAnnual')} value={inputs.extraIncome!.annual} onValue={(annual) => set({ extraIncome: { ...inputs.extraIncome!, annual } })} />
      break
    case 'work.period':
      control = <div className="question-pair"><FactNumber field="extraIncome.fromAge" label={t('extraIncomeFrom')} value={inputs.extraIncome!.fromAge} onValue={(fromAge) => set({ extraIncome: { ...inputs.extraIncome!, fromAge } })} /><FactNumber field="extraIncome.toAge" label={t('extraIncomeTo')} value={inputs.extraIncome!.toAge} onValue={(toAge) => set({ extraIncome: { ...inputs.extraIncome!, toAge } })} /></div>
      break
    case 'assets.identify': {
      const selected = (questionAnswers[definition.id] as string[] | undefined) ?? []
      const choices = ['tfsa', 'rrsp', 'nonReg', 'fhsa', 'locked'] as const
      control = <div className="check-group">{choices.map((account) => {
        const optionId = `account-${account}`
        return <label key={account} className={selected.includes(account) ? 'selected' : undefined}><input type="checkbox" aria-labelledby={`${optionId}-name`} aria-describedby={`${optionId}-role`} checked={selected.includes(account)} onChange={(e) => {
        if (!e.target.checked) {
          const nonZero = account === 'fhsa' ? (inputs.fhsa?.balance ?? 0) > 0
            : account === 'locked' ? (inputs.lockedRetirement?.balance ?? 0) > 0
              : inputs.balances[account as keyof typeof inputs.balances] > 0
          if (nonZero && !window.confirm(t('questionnaire.confirmRemoveValue'))) return
        }
        const next = e.target.checked ? [...selected, account] : selected.filter((item) => item !== account)
        setQuestionAnswer(definition.id, next)
        if (account === 'fhsa') set({ fhsa: e.target.checked ? (inputs.fhsa ?? DEFAULT_FHSA) : null })
        else if (account === 'locked') set({ lockedRetirement: e.target.checked ? (inputs.lockedRetirement ?? DEFAULT_LOCKED_RETIREMENT) : null })
        else set({ balances: { ...inputs.balances, [account]: e.target.checked ? inputs.balances[account as keyof typeof inputs.balances] : 0 } })
        markAnswers([account === 'locked' ? 'lockedRetirement' : account], e.target.checked ? 'estimated' : 'notApplicable')
        }} /><span><strong id={`${optionId}-name`}>{t(`questionnaire.accountNames.${account}`)}</strong><small id={`${optionId}-role`}>{t(`questionnaire.accountRoles.${account}`)}</small></span></label>
      })}</div>
      break
    }
    case 'account.tfsa.balance': case 'account.rrsp.balance': {
      const account = definition.id.split('.')[1] as 'tfsa' | 'rrsp'
      control = <FactNumber field={`balances.${account}`} label={t(account)} value={inputs.balances[account]} step={5000} onValue={(value) => set({ balances: { ...inputs.balances, [account]: value } })} />
      break
    }
    case 'account.nonReg.balance':
      control = <><div className="question-pair"><FactNumber field="balances.nonReg" label={t('nonReg')} value={inputs.balances.nonReg} step={5000} onValue={(nonReg) => set({ balances: { ...inputs.balances, nonReg } })} /><FactNumber field="nonRegBook" label={t('nonRegBook')} value={inputs.nonRegBook} step={5000} onValue={(nonRegBook) => set({ nonRegBook })} /></div><p className="answer-feedback">{t('guidedAcbFeedback', { value: cad(inputs.balances.nonReg), cost: cad(inputs.nonRegBook), gain: cad(Math.max(0, inputs.balances.nonReg - inputs.nonRegBook)) })}</p></>
      break
    case 'allocation.tfsa': {
      const accounts = ['tfsa', 'rrsp', 'nonReg'] as const
      const total = Math.round(accounts.reduce((sum, account) => sum + inputs.savingsSplit[account], 0) * 100)
      const difference = Math.abs(100 - total)
      const isComplete = difference === 0
      control = <div className="allocation-editor">
        <p className="allocation-instruction">{t('questionnaire.allocationInstruction')}</p>
        <div className="question-pair">{accounts.map((account) => <FactNumber key={account} field={`savingsSplit.${account}`} label={`${t(account)} %`} value={Math.round(inputs.savingsSplit[account] * 100)} onValue={(value) => set({ savingsSplit: { ...inputs.savingsSplit, [account]: value / 100 } })} />)}</div>
        <div className={`allocation-total ${isComplete ? 'complete' : 'incomplete'}`} role="status" aria-live="polite">
          <strong>{t('questionnaire.allocationTotal', { total })}</strong>
          <span>{isComplete ? t('questionnaire.allocationComplete') : total < 100 ? t('questionnaire.allocationRemaining', { difference }) : t('questionnaire.allocationOver', { difference })}</span>
        </div>
      </div>
      break
    }
    case 'fhsa.details':
      control = <div className="question-pair"><FactNumber field="fhsa.balance" label={t('fhsaBalance')} value={inputs.fhsa!.balance} onValue={(balance) => set({ fhsa: { ...inputs.fhsa!, balance } })} /><FactNumber field="fhsa.annualContribution" label={t('fhsaContribution')} value={inputs.fhsa!.annualContribution} onValue={(annualContribution) => set({ fhsa: { ...inputs.fhsa!, annualContribution } })} /></div>
      break
    case 'fhsa.open':
      control = <FactNumber field="fhsa.openedYearsAgo" label={t('fhsaOpenedYearsAgo')} value={inputs.fhsa!.openedYearsAgo} onValue={(openedYearsAgo) => set({ fhsa: { ...inputs.fhsa!, openedYearsAgo } })} />
      break
    case 'locked.balance':
      control = <FactNumber field="lockedRetirement.balance" label={t('lockedRetirementBalance')} value={inputs.lockedRetirement!.balance} onValue={(balance) => set({ lockedRetirement: { ...inputs.lockedRetirement!, balance } })} />
      break
    case 'locked.access':
      control = <div className="question-pair"><FactNumber field="lockedRetirement.accessibleAge" label={t('lockedRetirementAge')} value={inputs.lockedRetirement!.accessibleAge} onValue={(accessibleAge) => set({ lockedRetirement: { ...inputs.lockedRetirement!, accessibleAge } })} />{inputs.partner && <label className="question-select"><span>{t('lockedRetirementOwner')}</span><select value={inputs.lockedRetirement!.owner} onChange={(e) => set({ lockedRetirement: { ...inputs.lockedRetirement!, owner: e.target.value as 'self' | 'partner' } })}><option value="self">{t('benefitsSelf')}</option><option value="partner">{t('partnerSection')}</option></select></label>}</div>
      break
    case 'locked.contributions':
      control = <div className="question-pair"><FactNumber field="lockedRetirement.employeeContribution" label={t('lockedRetirementEmployee')} value={inputs.lockedRetirement!.employeeContribution} onValue={(employeeContribution) => set({ lockedRetirement: { ...inputs.lockedRetirement!, employeeContribution } })} /><FactNumber field="lockedRetirement.employerContribution" label={t('lockedRetirementEmployer')} value={inputs.lockedRetirement!.employerContribution} onValue={(employerContribution) => set({ lockedRetirement: { ...inputs.lockedRetirement!, employerContribution } })} /></div>
      break
    case 'home.situation':
      control = <ChoiceGroup id={definition.id} value={inputs.principalResidence?.mode === 'planned' ? 'planned' : inputs.principalResidence ? 'owned' : answer} options={[{ value: 'rent', label: t('guidedRent') }, { value: 'owned', label: t('prModeOwned') }, { value: 'planned', label: t('prModePlanned') }]} onChange={(value) => {
        setQuestionAnswer(definition.id, value)
        set({ principalResidence: value === 'owned' ? { value: 800_000, appreciation: 0.02, sellAtAge: null } : value === 'planned' ? { mode: 'planned', buyAtAge: inputs.currentAge + 5, price: 800_000, downPayment: 200_000, appreciation: 0.02, annualMortgagePayment: 0, mortgageYears: 25, netHoldingCostChange: 0, sellAtAge: null } : null })
        markAnswers(['housingMode'], value === 'rent' ? 'notApplicable' : 'estimated')
      }} />
      break
    case 'home.value': {
      const home = inputs.principalResidence!
      if (home.mode === 'planned') break
      control = <div className="question-pair"><FactNumber field="principalResidence.value" label={t('propValue')} value={home.value} onValue={(value) => set({ principalResidence: { ...home, value } })} /><FactNumber field="principalResidence.sellAtAge" label={t('propSellAt')} value={home.sellAtAge ?? 0} onValue={(sellAtAge) => set({ principalResidence: { ...home, sellAtAge: sellAtAge || null } })} /></div>
      break
    }
    case 'home.mortgage': {
      const home = inputs.principalResidence!
      if (home.mode === 'planned') break
      control = <ChoiceGroup id={definition.id} value={home.mortgage ? 'yes' : answer} options={[{ value: 'no', label: t('questionnaire.choice.no') }, { value: 'yes', label: t('questionnaire.choice.yes') }]} onChange={(value) => { setQuestionAnswer(definition.id, value); set({ principalResidence: { ...home, mortgage: value === 'yes' ? (home.mortgage ?? { balance: 300_000, annualPayment: 24_000, yearsRemaining: 20 }) : undefined } }); markAnswers(['principalResidence.mortgage'], value === 'yes' ? 'estimated' : 'notApplicable') }} />
      break
    }
    case 'mortgage.balance': {
      const home = inputs.principalResidence!; if (home.mode === 'planned' || !home.mortgage) break
      control = <FactNumber field="principalResidence.mortgage.balance" label={t('debtBalance')} value={home.mortgage.balance} onValue={(balance) => set({ principalResidence: { ...home, mortgage: { ...home.mortgage!, balance } } })} />
      break
    }
    case 'mortgage.payment': {
      const home = inputs.principalResidence!; if (home.mode === 'planned' || !home.mortgage) break
      control = <div className="question-pair"><FactNumber field="principalResidence.mortgage.annualPayment" label={t('debtPaymentLabel')} value={home.mortgage.annualPayment} onValue={(annualPayment) => set({ principalResidence: { ...home, mortgage: { ...home.mortgage!, annualPayment } } })} /><FactNumber field="principalResidence.mortgage.yearsRemaining" label={t('debtYears')} value={home.mortgage.yearsRemaining} onValue={(yearsRemaining) => set({ principalResidence: { ...home, mortgage: { ...home.mortgage!, yearsRemaining } } })} /></div>
      break
    }
    case 'purchase.time': { const home = inputs.principalResidence!; if (home.mode !== 'planned') break; control = <FactNumber field="principalResidence.buyAtAge" label={t('prBuyAtAge')} value={home.buyAtAge} onValue={(buyAtAge) => set({ principalResidence: { ...home, buyAtAge } })} />; break }
    case 'purchase.price': { const home = inputs.principalResidence!; if (home.mode !== 'planned') break; control = <div className="question-pair"><FactNumber field="principalResidence.price" label={t('prPrice')} value={home.price} onValue={(price) => set({ principalResidence: { ...home, price } })} /><FactNumber field="principalResidence.downPayment" label={t('prDownPayment')} value={home.downPayment} onValue={(downPayment) => set({ principalResidence: { ...home, downPayment } })} /></div>; break }
    case 'purchase.loan': { const home = inputs.principalResidence!; if (home.mode !== 'planned') break; control = <div className="question-pair"><FactNumber field="principalResidence.annualMortgagePayment" label={t('debtPaymentLabel')} value={home.annualMortgagePayment ?? 0} onValue={(annualMortgagePayment) => set({ principalResidence: { ...home, annualMortgagePayment } })} /><FactNumber field="principalResidence.mortgageYears" label={t('debtYears')} value={home.mortgageYears ?? 0} onValue={(mortgageYears) => set({ principalResidence: { ...home, mortgageYears } })} /></div>; break }
    case 'housing.other':
      control = <div className="question-pair">
        <ChoiceGroup id={`${definition.id}-rentals`} value={questionAnswers['housing.other.rentals'] as string | undefined} options={[{ value: 'no', label: t('questionnaire.choice.noRental') }, { value: 'yes', label: t('questionnaire.choice.hasRental') }]} onChange={(value) => {
          const existing = inputs.investmentProperties ?? []
          if (value === 'no' && existing.some((property) => property.value > 0) && !window.confirm(t('questionnaire.confirmRemoveValue'))) return
          set({ investmentProperties: value === 'yes' ? (existing.length ? existing : [{ ...DEFAULT_INVESTMENT_PROPERTY }]) : [] })
          setQuestionAnswer('housing.other.rentals', value)
          markAnswers(['investmentProperties'], value === 'yes' ? 'estimated' : 'notApplicable')
        }} />
        <ChoiceGroup id={`${definition.id}-debts`} value={questionAnswers['housing.other.debts'] as string | undefined} options={[{ value: 'no', label: t('questionnaire.choice.noDebt') }, { value: 'yes', label: t('questionnaire.choice.hasDebt') }]} onChange={(value) => {
          const existing = inputs.debts ?? []
          if (value === 'no' && existing.some((debt) => debt.balance > 0) && !window.confirm(t('questionnaire.confirmRemoveValue'))) return
          set({ debts: value === 'yes' ? (existing.length ? existing : [{ kind: 'other', balance: 10_000, annualPayment: 2_400, yearsRemaining: 5 }]) : [] })
          setQuestionAnswer('housing.other.debts', value)
          markAnswers(['debts'], value === 'yes' ? 'estimated' : 'notApplicable')
        }} />
      </div>
      break
    case 'rental.0.value': {
      const property = inputs.investmentProperties![0]
      control = <div className="question-pair"><FactNumber field="investmentProperties.0.value" label={t('propValue')} value={property.value} onValue={(value) => { const next = [...inputs.investmentProperties!]; next[0] = { ...property, value }; set({ investmentProperties: next }) }} /><FactNumber field="investmentProperties.0.acb" label={t('propAcb')} value={property.acb} onValue={(acb) => { const next = [...inputs.investmentProperties!]; next[0] = { ...property, acb }; set({ investmentProperties: next }) }} /></div>
      break
    }
    case 'rental.0.income': {
      const property = inputs.investmentProperties![0]
      control = <div className="question-pair"><FactNumber field="investmentProperties.0.annualRent" label={t('propRent')} value={property.annualRent ?? 0} onValue={(annualRent) => { const next = [...inputs.investmentProperties!]; next[0] = { ...property, annualRent }; set({ investmentProperties: next }) }} /><FactNumber field="investmentProperties.0.sellAtAge" label={t('propSellAt')} value={property.sellAtAge ?? 0} onValue={(sellAtAge) => { const next = [...inputs.investmentProperties!]; next[0] = { ...property, sellAtAge: sellAtAge || null }; set({ investmentProperties: next }) }} /></div>
      break
    }
    case 'rental.0.mortgage': {
      const property = inputs.investmentProperties![0]
      control = <ChoiceGroup id={definition.id} value={property.mortgage ? 'yes' : answer} options={[{ value: 'no', label: t('questionnaire.choice.no') }, { value: 'yes', label: t('questionnaire.choice.yes') }]} onChange={(value) => { const next = [...inputs.investmentProperties!]; next[0] = { ...property, mortgage: value === 'yes' ? (property.mortgage ?? { balance: 200_000, annualPayment: 18_000, yearsRemaining: 20 }) : undefined }; setQuestionAnswer(definition.id, value); set({ investmentProperties: next }); markAnswers(['investmentProperties.0.mortgage'], value === 'yes' ? 'estimated' : 'notApplicable') }} />
      break
    }
    case 'rental.0.loan': {
      const property = inputs.investmentProperties![0]; const mortgage = property.mortgage!
      control = <div className="question-pair"><FactNumber field="investmentProperties.0.mortgage.balance" label={t('debtBalance')} value={mortgage.balance} onValue={(balance) => { const next = [...inputs.investmentProperties!]; next[0] = { ...property, mortgage: { ...mortgage, balance } }; set({ investmentProperties: next }) }} /><FactNumber field="investmentProperties.0.mortgage.annualPayment" label={t('debtPaymentLabel')} value={mortgage.annualPayment} onValue={(annualPayment) => { const next = [...inputs.investmentProperties!]; next[0] = { ...property, mortgage: { ...mortgage, annualPayment } }; set({ investmentProperties: next }) }} /></div>
      break
    }
    case 'rental.0.term': {
      const property = inputs.investmentProperties![0]; const mortgage = property.mortgage!
      control = <FactNumber field="investmentProperties.0.mortgage.yearsRemaining" label={t('debtYears')} value={mortgage.yearsRemaining} onValue={(yearsRemaining) => { const next = [...inputs.investmentProperties!]; next[0] = { ...property, mortgage: { ...mortgage, yearsRemaining } }; set({ investmentProperties: next }) }} />
      break
    }
    case 'debt.0.type': {
      const debt = inputs.debts![0]
      control = <label className="question-select"><span>{t('debtKind')}</span><select value={answer ?? ''} onChange={(e) => { const kind = e.target.value as DebtKind; const next = [...inputs.debts!]; next[0] = { ...debt, kind }; setQuestionAnswer(definition.id, kind); set({ debts: next }); markAnswers(['debts.0.kind'], 'confirmed') }}><option value="" disabled>{t('questionnaire.chooseOne')}</option>{(['mortgage', 'carLoan', 'other'] as DebtKind[]).map((kind) => <option key={kind} value={kind}>{t(`debt_${kind}`)}</option>)}</select></label>
      break
    }
    case 'debt.0.balance': {
      const debt = inputs.debts![0]
      control = <FactNumber field="debts.0.balance" label={t('debtBalance')} value={debt.balance} onValue={(balance) => { const next = [...inputs.debts!]; next[0] = { ...debt, balance }; set({ debts: next }) }} />
      break
    }
    case 'debt.0.payment': {
      const debt = inputs.debts![0]
      control = <div className="question-pair"><FactNumber field="debts.0.annualPayment" label={t('debtPaymentLabel')} value={debt.annualPayment} onValue={(annualPayment) => { const next = [...inputs.debts!]; next[0] = { ...debt, annualPayment }; set({ debts: next }) }} /><FactNumber field="debts.0.yearsRemaining" label={t('debtYears')} value={debt.yearsRemaining} onValue={(yearsRemaining) => { const next = [...inputs.debts!]; next[0] = { ...debt, yearsRemaining }; set({ debts: next }) }} /></div>
      break
    }
    case 'spending.method':
      control = <ChoiceGroup id={definition.id} value={answer} options={[{ value: 'known', label: t('questionnaire.choice.knowBudget') }, { value: 'estimate', label: t('questionnaire.choice.estimateBudget') }, { value: 'unknown', label: t('questionnaire.choice.unknown') }]} onChange={(value) => setQuestionAnswer(definition.id, value)} />
      break
    case 'spending.total':
      control = <><FactNumber field="retirementSpending" label={t('retirementSpending')} value={inputs.retirementSpending} onValue={(retirementSpending) => set({ retirementSpending })} /><p className="answer-feedback">{t('questionnaire.spendingFeedback', { monthly: cad(inputs.retirementSpending / 12), annual: cad(inputs.retirementSpending) })}</p></>
      break
    case 'spending.homeFood':
      control = <div className="question-pair"><FactNumber field="worksheet.wsHousing" label={t('wsHousing')} value={worksheet.wsHousing} onValue={(value) => setWorksheet('wsHousing', value)} /><FactNumber field="worksheet.wsGroceries" label={t('wsGroceries')} value={worksheet.wsGroceries} onValue={(value) => setWorksheet('wsGroceries', value)} /></div>
      break
    case 'spending.travelHealth':
      control = <div className="question-pair"><FactNumber field="worksheet.wsTravel" label={t('wsTravel')} value={worksheet.wsTravel} onValue={(value) => setWorksheet('wsTravel', value)} /><FactNumber field="worksheet.wsHealth" label={t('wsHealth')} value={worksheet.wsHealth} onValue={(value) => setWorksheet('wsHealth', value)} /></div>
      break
    case 'spending.utilitiesTransport':
      control = <div className="question-pair"><FactNumber field="worksheet.wsUtilities" label={t('wsUtilities')} value={worksheet.wsUtilities} onValue={(value) => setWorksheet('wsUtilities', value)} /><FactNumber field="worksheet.wsTransport" label={t('wsTransport')} value={worksheet.wsTransport} onValue={(value) => setWorksheet('wsTransport', value)} /></div>
      break
    case 'spending.funOther':
      control = <div className="question-pair"><FactNumber field="worksheet.wsEntertainment" label={t('wsEntertainment')} value={worksheet.wsEntertainment} onValue={(value) => setWorksheet('wsEntertainment', value)} /><FactNumber field="worksheet.wsOther" label={t('wsOther')} value={worksheet.wsOther} onValue={(value) => setWorksheet('wsOther', value)} /></div>
      break
    case 'cpp.self':
      control = <>
        <FactNumber field="cppAnnualAt65" label={t('cppAnnualAt65')} value={inputs.cppAnnualAt65} onValue={(cppAnnualAt65) => set({ cppAnnualAt65 })} />
        <CppEstimator retireAge={inputs.fireAge} onApply={(cppAnnualAt65, cppWork) => { set({ cppAnnualAt65, cppWork }); markAnswers(['cppAnnualAt65'], 'confirmed') }} />
        <p className="benefit-estimate-note">{t('guidedCppEstimateNote')}</p>
        <FactNumber field="cppStartAge" label={t('cppStartAge')} value={inputs.cppStartAge} onValue={(cppStartAge) => set({ cppStartAge })} />
        <BenefitClaimAgeGuide field="cppStartAge" value={inputs.cppStartAge} kind={inputs.province === 'QC' ? 'qpp' : 'cpp'} onValue={(cppStartAge) => set({ cppStartAge })} />
      </>
      break
    case 'oas.self':
      control = <>
        <FactNumber field="oasAnnualAt65" label={t('oasAnnualAt65')} value={inputs.oasAnnualAt65} onValue={(oasAnnualAt65) => set({ oasAnnualAt65 })} />
        <OasEstimator onApply={(oasAnnualAt65) => { set({ oasAnnualAt65 }); markAnswers(['oasAnnualAt65'], 'confirmed') }} />
        <p className="benefit-estimate-note">{t('guidedOasEstimateNote')}</p>
        <FactNumber field="oasStartAge" label={t('oasStartAge')} value={inputs.oasStartAge} onValue={(oasStartAge) => set({ oasStartAge })} />
        <BenefitClaimAgeGuide field="oasStartAge" value={inputs.oasStartAge} kind="oas" onValue={(oasStartAge) => set({ oasStartAge })} />
      </>
      break
    case 'cpp.partner':
      control = <>
        <FactNumber field="partner.cppAnnualAt65" label={t('cppAnnualAt65')} value={inputs.partner!.cppAnnualAt65} onValue={(cppAnnualAt65) => set({ partner: { ...inputs.partner!, cppAnnualAt65 } })} />
        <CppEstimator retireAge={inputs.fireAge} onApply={(cppAnnualAt65, cppWork) => { set({ partner: { ...inputs.partner!, cppAnnualAt65, cppWork } }); markAnswers(['partner.cppAnnualAt65'], 'confirmed') }} />
        <p className="benefit-estimate-note">{t('guidedCppEstimateNote')}</p>
        <FactNumber field="partner.cppStartAge" label={t('cppStartAge')} value={inputs.partner!.cppStartAge} onValue={(cppStartAge) => set({ partner: { ...inputs.partner!, cppStartAge } })} />
        <BenefitClaimAgeGuide field="partner.cppStartAge" value={inputs.partner!.cppStartAge} kind={inputs.province === 'QC' ? 'qpp' : 'cpp'} onValue={(cppStartAge) => set({ partner: { ...inputs.partner!, cppStartAge } })} />
      </>
      break
    case 'oas.partner':
      control = <>
        <FactNumber field="partner.oasAnnualAt65" label={t('oasAnnualAt65')} value={inputs.partner!.oasAnnualAt65} onValue={(oasAnnualAt65) => set({ partner: { ...inputs.partner!, oasAnnualAt65 } })} />
        <OasEstimator onApply={(oasAnnualAt65) => { set({ partner: { ...inputs.partner!, oasAnnualAt65 } }); markAnswers(['partner.oasAnnualAt65'], 'confirmed') }} />
        <p className="benefit-estimate-note">{t('guidedOasEstimateNote')}</p>
        <FactNumber field="partner.oasStartAge" label={t('oasStartAge')} value={inputs.partner!.oasStartAge} onValue={(oasStartAge) => set({ partner: { ...inputs.partner!, oasStartAge } })} />
        <BenefitClaimAgeGuide field="partner.oasStartAge" value={inputs.partner!.oasStartAge} kind="oas" onValue={(oasStartAge) => set({ partner: { ...inputs.partner!, oasStartAge } })} />
      </>
      break
    case 'pension.self':
      control = <ChoiceGroup id={definition.id} value={inputs.pension ? 'db' : answer} options={[{ value: 'none', label: t('questionnaire.choice.noPension') }, { value: 'db', label: t('questionnaire.choice.dbPension'), detail: t('questionnaire.choice.dbDetail') }, { value: 'dc', label: t('questionnaire.choice.dcPension'), detail: t('questionnaire.choice.dcDetail') }]} onChange={(value) => { setQuestionAnswer(definition.id, value); set({ pension: value === 'db' ? (inputs.pension ?? DEFAULT_PENSION) : null }); markAnswers(['pension'], value === 'db' ? 'estimated' : 'notApplicable') }} />
      break
    case 'pension.self.details':
      control = <div className="question-pair"><FactNumber field="pension.annualAmount" label={t('pensionAnnual')} value={inputs.pension!.annualAmount} onValue={(annualAmount) => set({ pension: { ...inputs.pension!, annualAmount } })} /><FactNumber field="pension.startAge" label={t('pensionStartAge')} value={inputs.pension!.startAge} onValue={(startAge) => set({ pension: { ...inputs.pension!, startAge } })} /></div>
      break
    case 'pension.self.indexing':
      control = <PensionIndexing prefix="pension" pension={inputs.pension!} answer={answer} setAnswer={setQuestionAnswer} setPension={(pension) => set({ pension })} />
      break
    case 'pension.partner':
      control = <ChoiceGroup id={definition.id} value={inputs.partner!.pension ? 'db' : answer} options={[{ value: 'none', label: t('questionnaire.choice.noPension') }, { value: 'db', label: t('questionnaire.choice.dbPension'), detail: t('questionnaire.choice.dbDetail') }, { value: 'dc', label: t('questionnaire.choice.dcPension'), detail: t('questionnaire.choice.dcDetail') }]} onChange={(value) => { setQuestionAnswer(definition.id, value); set({ partner: { ...inputs.partner!, pension: value === 'db' ? (inputs.partner!.pension ?? DEFAULT_PENSION) : null } }); markAnswers(['partner.pension'], value === 'db' ? 'estimated' : 'notApplicable') }} />
      break
    case 'pension.partner.details':
      control = <div className="question-pair"><FactNumber field="partner.pension.annualAmount" label={t('pensionAnnual')} value={inputs.partner!.pension!.annualAmount} onValue={(annualAmount) => set({ partner: { ...inputs.partner!, pension: { ...inputs.partner!.pension!, annualAmount } } })} /><FactNumber field="partner.pension.startAge" label={t('pensionStartAge')} value={inputs.partner!.pension!.startAge} onValue={(startAge) => set({ partner: { ...inputs.partner!, pension: { ...inputs.partner!.pension!, startAge } } })} /></div>
      break
    case 'pension.partner.indexing':
      control = <PensionIndexing prefix="partner.pension" pension={inputs.partner!.pension!} answer={answer} setAnswer={setQuestionAnswer} setPension={(pension) => set({ partner: { ...inputs.partner!, pension } })} />
      break
    case 'intent.legacy':
      control = <ChoiceGroup id={definition.id} value={planningIntent.legacyPreference} options={[{ value: 'maxRemaining', label: t('questionnaire.choice.leaveMore') }, { value: 'none', label: t('questionnaire.choice.noLegacy') }, { value: 'minimumAmount', label: t('questionnaire.choice.fixedLegacy'), detail: t('questionnaire.choice.unsupported') }, { value: 'lifetimeGifts', label: t('questionnaire.choice.lifetimeGifts'), detail: t('questionnaire.choice.unsupported') }, { value: 'undecided', label: t('questionnaire.choice.undecided') }]} onChange={(value) => { setQuestionAnswer(definition.id, value); applyIntent(value as typeof planningIntent.legacyPreference, planningIntent.spendingPreference) }} />
      break
    case 'intent.spending': {
      const supported = planningIntent.spendingPreference === 'exploreCeiling' ? 'spending' : planningIntent.legacyPreference === 'maxRemaining' ? 'legacy' : 'sustainability'
      control = <><ChoiceGroup id={definition.id} value={planningIntent.spendingPreference} options={[{ value: 'maintain', label: t('questionnaire.choice.maintainSpending') }, { value: 'exploreCeiling', label: t('questionnaire.choice.exploreCeiling') }, { value: 'undecided', label: t('questionnaire.choice.undecided') }]} onChange={(value) => { setQuestionAnswer(definition.id, value); applyIntent(planningIntent.legacyPreference, value as typeof planningIntent.spendingPreference) }} />{answer && <div className="intent-recommendation" role="status"><strong>{t('questionnaire.intentRecommendationLabel')}</strong><p>{t(`questionnaire.intentSummary.${supported}`, { spending: cad(inputs.retirementSpending) })}</p>{['minimumAmount', 'lifetimeGifts'].includes(planningIntent.legacyPreference) && <p className="capability-note">{t('questionnaire.intentUnsupported')}</p>}</div>}</>
      break
    }
    case 'invest.mix': {
      const number = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      control = <div className="mix-choice"><p className="mix-return-explanation">{t('questionnaire.mixReturnExplanation')}</p><ChoiceGroup id={definition.id} value={answer} options={['allStocks', 'aggressive', 'balanced', 'conservative', 'gic'].map((value) => ({ value, label: t(`questionnaire.mixNames.${value}`), detail: t('questionnaire.mixExpectedReturn', { value: number.format(Math.round((blendedReturn(MIX_PRESETS[value]) * 100) * 10 + 1e-9) / 10) }) }))} onChange={(value) => { setQuestionAnswer(definition.id, value); (['tfsa', 'rrsp', 'nonReg'] as const).forEach((account) => applyMixPreset(account, value)); markAnswers(['returns', 'volatilities'], 'estimated', 'default') }} /></div>
      break
    }
    case 'invest.fees': {
      const choosePreset = (field: 'fees' | 'inflation', value: number) => {
        set({ [field]: value / 100 })
        markAnswers([field], 'estimated', 'default')
      }
      const preset = (field: 'fees' | 'inflation', value: number, label: string) => <button key={`${field}-${value}`} type="button" className="assumption-preset" aria-pressed={Boolean(answerMeta[field]?.status === 'estimated' && answerMeta[field]?.origin === 'default' && Math.abs((inputs[field] ?? 0) * 100 - value) < 0.001)} onClick={() => choosePreset(field, value)}>{label}</button>
      control = <div className="assumption-presets">
        <div className="assumption-preset-field"><FactNumber field="fees" label={t('questionnaire.feeTotalLabel')} value={(inputs.fees ?? 0) * 100} step={0.1} onValue={(value) => set({ fees: value / 100 })} /><p>{t('questionnaire.feePresetIntro')}</p><div className="assumption-preset-options" role="group" aria-label={t('questionnaire.feePresetGroup')}>
          {preset('fees', 0.2, t('questionnaire.feePreset.etf'))}{preset('fees', 0.65, t('questionnaire.feePreset.managed'))}{preset('fees', 2.1, t('questionnaire.feePreset.mutual'))}
        </div><p className="assumption-source">{t('questionnaire.feePresetSource')} <a href="https://www.vanguard.ca/en/product/etf/asset-allocation/9692/vanguard-all-equity-etf-portfolio" target="_blank" rel="noopener noreferrer">Vanguard</a>, <a href="https://www.wealthsimple.com/en-ca/pricing" target="_blank" rel="noopener noreferrer">Wealthsimple</a> + <a href="https://help.wealthsimple.com/hc/en-ca/articles/360056584334-Management-expense-ratio-MER-fees-for-managed-accounts" target="_blank" rel="noopener noreferrer">ETF MER</a>, <a href="https://funds.rbcgam.com/pdf/fund-facts/funds/rbf272_e.pdf" target="_blank" rel="noopener noreferrer">RBC</a>.</p></div>
        <div className="assumption-preset-field"><FactNumber field="inflation" label={t('inflationLabel')} value={(inputs.inflation ?? 0.021) * 100} step={0.1} onValue={(value) => set({ inflation: value / 100 })} /><p>{t('questionnaire.inflationPresetIntro')}</p><div className="assumption-preset-options" role="group" aria-label={t('questionnaire.inflationPresetGroup')}>
          {preset('inflation', 2.1, t('questionnaire.inflationPreset.fpCanada'))}{preset('inflation', 2.0, t('questionnaire.inflationPreset.bankTarget'))}{preset('inflation', 3.0, t('questionnaire.inflationPreset.stress'))}
        </div><p className="assumption-source">{t('questionnaire.inflationPresetSource')} <a href="https://www.fpcanada.ca/projection-assumption-guidelines" target="_blank" rel="noopener noreferrer">FP Canada</a>, <a href="https://www.bankofcanada.ca/rates/indicators/key-variables/inflation-control-target/" target="_blank" rel="noopener noreferrer">Bank of Canada</a>.</p></div>
      </div>
      break
    }
    case 'invest.tax': {
      const distributionRate = inputs.nonRegDistributionYield ?? 0.02
      const marginalRate = inputs.accumulationMarginalRate ?? 0.35
      const exampleDistribution = 100_000 * distributionRate
      control = <div className="tax-assumptions">
        <p className="tax-page-intro">{t('questionnaire.taxIntro')}</p>
        <div className="tax-assumption-field">
          <FactNumber field="nonRegDistributionYield" label={t('questionnaire.taxDistributionLabel')} value={distributionRate * 100} step={0.1} onValue={(value) => set({ nonRegDistributionYield: value / 100 })} />
          <p>{t('questionnaire.taxDistributionMeaning')}</p>
          <p>{t('questionnaire.taxDistributionFind')} <a href="https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/personal-income/line-12700-capital-gains/completing-schedule-3/tax-treatment-mutual-funds.html" target="_blank" rel="noopener noreferrer">{t('questionnaire.taxDistributionSource')}</a></p>
          <p>{t('questionnaire.taxDistributionZero')}</p>
        </div>
        <div className="tax-assumption-field">
          <FactNumber field="accumulationMarginalRate" label={t('questionnaire.taxRateLabel')} value={marginalRate * 100} step={1} onValue={(value) => set({ accumulationMarginalRate: value / 100 })} />
          <p>{t('questionnaire.taxRateMeaning')}</p>
          <p>{t('questionnaire.taxRateFind')} <a href="https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/current-year.html" target="_blank" rel="noopener noreferrer">{t('questionnaire.taxRateSource')}</a></p>
        </div>
        <p className="tax-worked-example" aria-live="polite">{t('questionnaire.taxWorkedExample', { balance: cad(100_000), distribution: cad(exampleDistribution), tax: cad(exampleDistribution * marginalRate) })}</p>
        <p className="tax-model-note">{t('questionnaire.taxModelNote')}</p>
      </div>
      break
    }
    case 'invest.strategy':
      control = <div className="strategy-question">
        <p className="strategy-intro">{t('questionnaire.strategyIntro')}</p>
        <ChoiceGroup id={definition.id} value={answer} options={(['meltdownPaced', 'nonRegFirst', 'tfsaFirst', 'rrspFirst'] as Strategy[]).map((value) => ({
          value,
          label: t(`strat_${value}`),
          detail: t(`questionnaire.strategyDetails.${value}`, { cap: t(`meltdownCap_${inputs.meltdownBracketCap ?? 'bracket1'}`) }),
        }))} onChange={(value) => { setQuestionAnswer(definition.id, value); set({ strategy: value as Strategy }); markAnswers(['strategy'], 'confirmed') }} />
        <p className="strategy-source">{t('questionnaire.strategySourceLabel')} <a href="https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/rrsps-related-plans/making-withdrawals.html" target="_blank" rel="noopener noreferrer">{t('questionnaire.strategySourceRrsp')}</a> · <a href="https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/what.html" target="_blank" rel="noopener noreferrer">{t('questionnaire.strategySourceTfsa')}</a> · <a href="https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/personal-income/line-12700-capital-gains/calculating-reporting-your-capital-gains-losses.html" target="_blank" rel="noopener noreferrer">{t('questionnaire.strategySourceCapital')}</a> · <a href="https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/registered-retirement-income-fund-rrif/receiving-income-a-rrif.html" target="_blank" rel="noopener noreferrer">{t('questionnaire.strategySourceRrif')}</a> · <a href="https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/recovery-tax.html" target="_blank" rel="noopener noreferrer">{t('questionnaire.strategySourceOas')}</a></p>
      </div>
      break
    default:
      control = <p>{t('questionnaire.notApplicable')}</p>
  }

  return <article className="question-page" data-page-id={definition.id}>
    <p className="question-location">{t(`questionnaire.categories.${definition.categoryId}`)}</p>
    <h2 id="question-title" tabIndex={-1}>{t(`questionnaire.pages.${key}.question`)}</h2>
    {control}
    <QuestionHelp guidanceKey={definition.guidanceKey} />
    {definition.fieldBindings.some((field) => answerMeta[field]?.status === 'unknown') && <p className="pending-note">{t('questionnaire.pendingSaved')}</p>}
  </article>
}
