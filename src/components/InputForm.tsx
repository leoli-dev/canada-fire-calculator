import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_INVESTMENT_PROPERTY,
  DEFAULT_PARTNER,
  MIX_PRESETS,
  useStore,
  WORKSHEET_KEYS,
} from '../store'
import {
  DEBT_KINDS,
  STRATEGIES,
  validateInputs,
  type AccountType,
  type DebtKind,
  type Goal,
  type Province,
  type Strategy,
  type ValidationIssue,
} from '../engine'
import { useCad } from '../format'
import { CppEstimator, OasEstimator } from './BenefitEstimators'
import { Jargon } from './Jargon'

const PROVINCES: Province[] = [
  'ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'PE', 'NL', 'YT', 'NT', 'NU',
]
const ACCOUNTS: AccountType[] = ['tfsa', 'rrsp', 'nonReg']

function Num(props: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  issue?: ValidationIssue
}) {
  const { t } = useTranslation()
  return (
    <label className="field">
      <span><Jargon text={props.label} /></span>
      <input
        type="number"
        className={props.issue ? `invalid-${props.issue.severity}` : undefined}
        value={props.value}
        step={props.step ?? 1}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      {props.issue && (
        <em className={`field-issue ${props.issue.severity}`}>
          {t(props.issue.key, props.issue.params)}
        </em>
      )}
    </label>
  )
}

function OptionalAge(props: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  issue?: ValidationIssue
}) {
  const { t } = useTranslation()
  return (
    <label className="field">
      <span><Jargon text={props.label} /></span>
      <input
        type="number"
        className={props.issue ? `invalid-${props.issue.severity}` : undefined}
        value={props.value ?? ''}
        placeholder="—"
        onChange={(e) =>
          props.onChange(e.target.value === '' ? null : Number(e.target.value))
        }
      />
      {props.issue && (
        <em className={`field-issue ${props.issue.severity}`}>
          {t(props.issue.key, props.issue.params)}
        </em>
      )}
    </label>
  )
}

export function InputForm() {
  const { t } = useTranslation()
  const cad = useCad()
  const {
    inputs, set, reset,
    mixPresets, applyMixPreset,
    worksheet, setWorksheet,
    displayMode, setDisplayMode,
  } = useStore()

  const worksheetTotal = WORKSHEET_KEYS.reduce((s, k) => s + (worksheet[k] || 0), 0)

  const issues = useMemo(() => validateInputs(inputs), [inputs])
  // errors outrank warnings when a field has both
  const issueFor = (field: string) =>
    issues.find((i) => i.field === field && i.severity === 'error') ??
    issues.find((i) => i.field === field)
  const errorCount = issues.filter((i) => i.severity === 'error').length

  return (
    <form className="input-form" onSubmit={(e) => e.preventDefault()}>
      {errorCount > 0 && (
        <p className="validation-banner">{t('valBanner', { count: errorCount })}</p>
      )}
      <fieldset>
        <legend>{t('profile')}</legend>
        <Num label={t('currentAge')} value={inputs.currentAge} issue={issueFor('currentAge')} onChange={(v) => set({ currentAge: v })} />
        <Num label={t('fireAge')} value={inputs.fireAge} issue={issueFor('fireAge')} onChange={(v) => set({ fireAge: v })} />
        <Num label={t('lifeExpectancy')} value={inputs.lifeExpectancy} issue={issueFor('lifeExpectancy')} onChange={(v) => set({ lifeExpectancy: v })} />
        <label className="field">
          <span><Jargon text={t('province')} /></span>
          <select
            value={inputs.province}
            onChange={(e) => set({ province: e.target.value as Province })}
          >
            {PROVINCES.map((p) => (
              <option key={p} value={p}>{p} — {t(`prov_${p}`)}</option>
            ))}
          </select>
        </label>
        <Num label={t('annualSavings')} value={inputs.annualSavings} step={1000} issue={issueFor('annualSavings')} onChange={(v) => set({ annualSavings: v })} />
        <Num label={t('retirementSpending')} value={inputs.retirementSpending} step={1000} issue={issueFor('retirementSpending')} onChange={(v) => set({ retirementSpending: v })} />
        <Num label={t('targetInputLabel')} value={inputs.fireTargetAssets ?? 0} step={50000}
          onChange={(v) => set({ fireTargetAssets: v > 0 ? v : null })} />
        <label className="field">
          <span><Jargon text={t('goal')} /></span>
          <select
            value={inputs.goal ?? 'legacy'}
            onChange={(e) => set({ goal: e.target.value as Goal })}
          >
            <option value="legacy">{t('goal_legacy')}</option>
            <option value="dieWithZero">{t('goal_dieWithZero')}</option>
          </select>
        </label>
        {(inputs.goal ?? 'legacy') === 'dieWithZero' && (
          <p className="hint"><Jargon text={t('dwzGoalNote')} /></p>
        )}
        <label className="field">
          <span>{t('inflationLabel')}</span>
          <select
            value={String(inputs.inflation ?? 0.021)}
            onChange={(e) => set({ inflation: Number(e.target.value) })}
          >
            <option value="0.015">{t('infl_low')}</option>
            <option value="0.021">{t('infl_mid')}</option>
            <option value="0.03">{t('infl_high')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('displayModeLabel')}</span>
          <select
            value={displayMode}
            onChange={(e) => setDisplayMode(e.target.value as 'real' | 'nominal')}
          >
            <option value="real">{t('display_real')}</option>
            <option value="nominal">{t('display_nominal')}</option>
          </select>
        </label>
        <label className="field">
          <span><Jargon text={t('household')} /></span>
          <select
            value={inputs.partner ? 'couple' : 'single'}
            onChange={(e) =>
              set({ partner: e.target.value === 'couple' ? DEFAULT_PARTNER : null })
            }
          >
            <option value="single">{t('single')}</option>
            <option value="couple">{t('couple')}</option>
          </select>
        </label>
        {inputs.partner && (
          <>
            <Num label={t('partnerAge')} value={inputs.partner.currentAge} issue={issueFor('partner.currentAge')}
              onChange={(v) => set({ partner: { ...inputs.partner!, currentAge: v } })} />
            <p className="hint"><Jargon text={t('coupleNote')} /></p>
          </>
        )}

        <label className="field">
          <span><Jargon text={t('extraIncomeToggle')} /></span>
          <input
            type="checkbox"
            checked={!!inputs.extraIncome}
            onChange={(e) =>
              set({
                extraIncome: e.target.checked
                  ? { annual: 20000, fromAge: inputs.fireAge, toAge: inputs.fireAge + 10 }
                  : null,
              })
            }
          />
        </label>
        {inputs.extraIncome && (
          <>
            <Num label={t('extraIncomeAnnual')} value={inputs.extraIncome.annual} step={1000}
              issue={issueFor('extraIncome.annual')}
              onChange={(v) => set({ extraIncome: { ...inputs.extraIncome!, annual: v } })} />
            <Num label={t('extraIncomeFrom')} value={inputs.extraIncome.fromAge}
              issue={issueFor('extraIncome.fromAge')}
              onChange={(v) => set({ extraIncome: { ...inputs.extraIncome!, fromAge: v } })} />
            <Num label={t('extraIncomeTo')} value={inputs.extraIncome.toAge}
              issue={issueFor('extraIncome.toAge')}
              onChange={(v) => set({ extraIncome: { ...inputs.extraIncome!, toAge: v } })} />
            <p className="hint"><Jargon text={t('extraIncomeNote')} /></p>
          </>
        )}

        <details>
          <summary>{t('worksheetTitle')}</summary>
          {WORKSHEET_KEYS.map((k) => (
            <Num key={k} label={t(k)} value={worksheet[k] || 0} step={500}
              onChange={(v) => setWorksheet(k, v)} />
          ))}
          <div className="ws-total">
            <span>{t('wsTotal')}: <strong>{cad(worksheetTotal)}</strong></span>
            <button type="button" disabled={worksheetTotal <= 0}
              onClick={() => set({ retirementSpending: worksheetTotal })}>
              {t('wsApply')}
            </button>
          </div>
        </details>
      </fieldset>

      <fieldset>
        <legend>{t('accounts')}</legend>
        {ACCOUNTS.map((a) => (
          <Num
            key={a}
            label={t(a)}
            value={inputs.balances[a]}
            step={5000}
            issue={issueFor(`balances.${a}`)}
            onChange={(v) => set({ balances: { ...inputs.balances, [a]: v } })}
          />
        ))}
        <Num label={t('nonRegBook')} value={inputs.nonRegBook} step={5000} issue={issueFor('nonRegBook')} onChange={(v) => set({ nonRegBook: v })} />

        <details>
          <summary><Jargon text={t('nonRegTaxTitle')} /></summary>
          <p className="hint"><Jargon text={t('nonRegYieldHint')} /></p>
          <Num label={t('nonRegYieldLabel')} value={(inputs.nonRegDistributionYield ?? 0) * 100} step={0.5}
            onChange={(v) => set({ nonRegDistributionYield: Math.max(0, v) / 100 })} />
          <Num label={t('accMarginalLabel')} value={(inputs.accumulationMarginalRate ?? 0.35) * 100} step={1}
            onChange={(v) => set({ accumulationMarginalRate: Math.max(0, Math.min(60, v)) / 100 })} />
        </details>

        <details>
          <summary>{t('mixLabel')}</summary>
          <p className="hint"><Jargon text={t('mixNote')} /></p>
          {ACCOUNTS.map((a) => (
            <label className="field" key={a}>
              <span><Jargon text={t(a)} /></span>
              <select
                value={mixPresets[a]}
                onChange={(e) => applyMixPreset(a, e.target.value)}
              >
                {Object.keys(MIX_PRESETS).map((p) => (
                  <option key={p} value={p}>{t(`mix_${p}`)}</option>
                ))}
              </select>
            </label>
          ))}
          <p className="hint">
            {ACCOUNTS.map((a) => `${t(a)}: ${(inputs.returns[a] * 100).toFixed(1)}%`).join(' · ')}
          </p>
          <Num label={t('feesLabel')} value={(inputs.fees ?? 0) * 100} step={0.05}
            onChange={(v) => set({ fees: Math.max(0, v) / 100 })} />
          <p className="hint"><Jargon text={t('feesHint')} /></p>
        </details>

        <details>
          <summary>{t('savingsSplit')}</summary>
          {ACCOUNTS.map((a) => (
            <Num key={a} label={t(a)} value={Math.round(inputs.savingsSplit[a] * 100)}
              onChange={(v) => set({ savingsSplit: { ...inputs.savingsSplit, [a]: Math.max(0, v) / 100 } })} />
          ))}
          {issueFor('savingsSplit') && (
            <em className="field-issue warning">
              {t(issueFor('savingsSplit')!.key, issueFor('savingsSplit')!.params)}
            </em>
          )}
        </details>
      </fieldset>

      <fieldset>
        <legend>{t('propertySection')}</legend>
        <label className="field">
          <span><Jargon text={t('principalResidence')} /></span>
          <input
            type="checkbox"
            checked={!!inputs.principalResidence}
            onChange={(e) =>
              set({
                principalResidence: e.target.checked
                  ? { value: 800000, appreciation: 0.02, sellAtAge: null }
                  : null,
              })
            }
          />
        </label>
        {inputs.principalResidence && (
          <>
            <Num label={t('propValue')} value={inputs.principalResidence.value} step={25000}
              onChange={(v) => set({ principalResidence: { ...inputs.principalResidence!, value: v } })} />
            <Num label={t('propAppreciation')} value={inputs.principalResidence.appreciation * 100} step={0.5}
              onChange={(v) => set({ principalResidence: { ...inputs.principalResidence!, appreciation: v / 100 } })} />
            <OptionalAge label={t('propSellAt')} value={inputs.principalResidence.sellAtAge}
              onChange={(v) => set({ principalResidence: { ...inputs.principalResidence!, sellAtAge: v } })} />
            <p className="hint"><Jargon text={t('prNote')} /></p>
          </>
        )}

        {(inputs.investmentProperties ?? []).map((ip, i) => {
          const patch = (part: Partial<typeof ip>) => {
            const next = [...(inputs.investmentProperties ?? [])]
            next[i] = { ...ip, ...part }
            set({ investmentProperties: next })
          }
          return (
            <div className="property-card" key={i}>
              <p className="subhead property-head">
                <Jargon text={t('investmentProperty')} /> #{i + 1}
                <button
                  type="button"
                  className="remove-item"
                  onClick={() =>
                    set({
                      investmentProperties: (inputs.investmentProperties ?? []).filter(
                        (_, j) => j !== i,
                      ),
                    })
                  }
                >
                  {t('removeItem')}
                </button>
              </p>
              <Num label={t('propValue')} value={ip.value} step={25000}
                issue={issueFor(`investmentProperties.${i}.value`)}
                onChange={(v) => patch({ value: v })} />
              <Num label={t('propAcb')} value={ip.acb} step={25000}
                issue={issueFor(`investmentProperties.${i}.acb`)}
                onChange={(v) => patch({ acb: v })} />
              <Num label={t('propAppreciation')} value={ip.appreciation * 100} step={0.5}
                onChange={(v) => patch({ appreciation: v / 100 })} />
              <Num label={t('propRent')} value={ip.annualRent ?? 0} step={1000}
                issue={issueFor(`investmentProperties.${i}.annualRent`)}
                onChange={(v) => patch({ annualRent: v })} />
              <OptionalAge label={t('propSellAt')} value={ip.sellAtAge}
                issue={issueFor(`investmentProperties.${i}.sellAtAge`)}
                onChange={(v) => patch({ sellAtAge: v })} />
            </div>
          )
        })}
        <button
          type="button"
          className="add-item"
          onClick={() =>
            set({
              investmentProperties: [
                ...(inputs.investmentProperties ?? []),
                { ...DEFAULT_INVESTMENT_PROPERTY },
              ],
            })
          }
        >
          {t('addProperty')}
        </button>
        {(inputs.investmentProperties?.length ?? 0) > 0 && (
          <p className="hint"><Jargon text={t('ipNote')} /></p>
        )}
      </fieldset>

      <fieldset>
        <legend><Jargon text={t('debtsSection')} /></legend>
        {(inputs.debts ?? []).map((d, i) => {
          const patch = (part: Partial<typeof d>) => {
            const next = [...(inputs.debts ?? [])]
            next[i] = { ...d, ...part }
            set({ debts: next })
          }
          return (
            <div className="property-card" key={i}>
              <p className="subhead property-head">
                {t(`debt_${d.kind}`)} #{i + 1}
                <button
                  type="button"
                  className="remove-item"
                  onClick={() =>
                    set({ debts: (inputs.debts ?? []).filter((_, j) => j !== i) })
                  }
                >
                  {t('removeItem')}
                </button>
              </p>
              <label className="field">
                <span>{t('debtKind')}</span>
                <select value={d.kind} onChange={(e) => patch({ kind: e.target.value as DebtKind })}>
                  {DEBT_KINDS.map((k) => (
                    <option key={k} value={k}>{t(`debt_${k}`)}</option>
                  ))}
                </select>
              </label>
              <Num label={t('debtBalance')} value={d.balance} step={10000}
                issue={issueFor(`debts.${i}.balance`)}
                onChange={(v) => patch({ balance: v })} />
              <Num label={t('debtPaymentLabel')} value={d.annualPayment} step={1000}
                issue={issueFor(`debts.${i}.annualPayment`)}
                onChange={(v) => patch({ annualPayment: v })} />
              <Num label={t('debtYears')} value={d.yearsRemaining}
                issue={issueFor(`debts.${i}.yearsRemaining`)}
                onChange={(v) => patch({ yearsRemaining: v })} />
            </div>
          )
        })}
        <button
          type="button"
          className="add-item"
          onClick={() =>
            set({
              debts: [
                ...(inputs.debts ?? []),
                { kind: 'mortgage', balance: 300000, annualPayment: 24000, yearsRemaining: 20 },
              ],
            })
          }
        >
          {t('addDebt')}
        </button>
        {(inputs.debts?.length ?? 0) > 0 && (
          <p className="hint"><Jargon text={t('debtNote')} /></p>
        )}
      </fieldset>

      <fieldset>
        <legend>{t('benefits')}</legend>
        {inputs.partner && <p className="subhead">{t('benefitsSelf')}</p>}
        <Num label={t('cppStartAge')} value={inputs.cppStartAge} onChange={(v) => set({ cppStartAge: v })} />
        <Num label={t('cppAnnualAt65')} value={inputs.cppAnnualAt65} step={500} onChange={(v) => set({ cppAnnualAt65: v })} />
        <CppEstimator retireAge={inputs.fireAge}
          onApply={(v, work) => set({ cppAnnualAt65: v, cppWork: work })} />
        <Num label={t('oasStartAge')} value={inputs.oasStartAge} onChange={(v) => set({ oasStartAge: v })} />
        <Num label={t('oasAnnualAt65')} value={inputs.oasAnnualAt65} step={100} onChange={(v) => set({ oasAnnualAt65: v })} />
        <OasEstimator onApply={(v) => set({ oasAnnualAt65: v })} />

        {inputs.partner && (
          <>
            <p className="subhead">{t('partnerSection')}</p>
            <Num label={t('cppStartAge')} value={inputs.partner.cppStartAge}
              onChange={(v) => set({ partner: { ...inputs.partner!, cppStartAge: v } })} />
            <Num label={t('cppAnnualAt65')} value={inputs.partner.cppAnnualAt65} step={500}
              onChange={(v) => set({ partner: { ...inputs.partner!, cppAnnualAt65: v } })} />
            <CppEstimator
              retireAge={inputs.partner.currentAge + (inputs.fireAge - inputs.currentAge)}
              onApply={(v, work) =>
                set({ partner: { ...inputs.partner!, cppAnnualAt65: v, cppWork: work } })}
            />
            <Num label={t('oasStartAge')} value={inputs.partner.oasStartAge}
              onChange={(v) => set({ partner: { ...inputs.partner!, oasStartAge: v } })} />
            <Num label={t('oasAnnualAt65')} value={inputs.partner.oasAnnualAt65} step={100}
              onChange={(v) => set({ partner: { ...inputs.partner!, oasAnnualAt65: v } })} />
            <OasEstimator
              onApply={(v) => set({ partner: { ...inputs.partner!, oasAnnualAt65: v } })}
            />
          </>
        )}

        <label className="field">
          <span><Jargon text={t('withdrawalOrder')} /></span>
          <select
            value={inputs.strategy}
            onChange={(e) => set({ strategy: e.target.value as Strategy })}
          >
            {STRATEGIES.map((s) => (
              <option key={s} value={s}>{t(`strat_${s}`)}</option>
            ))}
          </select>
        </label>
        {inputs.strategy === 'meltdownPaced' && <p className="hint"><Jargon text={t('meltdownNote')} /></p>}
      </fieldset>

      <button type="button" className="reset" onClick={reset}>{t('reset')}</button>
    </form>
  )
}
