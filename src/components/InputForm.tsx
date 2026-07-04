import { useTranslation } from 'react-i18next'
import { DEFAULT_PARTNER, MIX_PRESETS, useStore, WORKSHEET_KEYS } from '../store'
import {
  STRATEGIES,
  type AccountType,
  type Goal,
  type Province,
  type Strategy,
} from '../engine'
import { useCad } from '../format'
import { CppEstimator, OasEstimator } from './BenefitEstimators'
import { Jargon } from './Jargon'

const PROVINCES: Province[] = ['ON', 'QC', 'BC', 'AB']
const ACCOUNTS: AccountType[] = ['tfsa', 'rrsp', 'nonReg']

function Num(props: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
}) {
  return (
    <label className="field">
      <span><Jargon text={props.label} /></span>
      <input
        type="number"
        value={props.value}
        step={props.step ?? 1}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}

function OptionalAge(props: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
}) {
  return (
    <label className="field">
      <span><Jargon text={props.label} /></span>
      <input
        type="number"
        value={props.value ?? ''}
        placeholder="—"
        onChange={(e) =>
          props.onChange(e.target.value === '' ? null : Number(e.target.value))
        }
      />
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

  return (
    <form className="input-form" onSubmit={(e) => e.preventDefault()}>
      <fieldset>
        <legend>{t('profile')}</legend>
        <Num label={t('currentAge')} value={inputs.currentAge} onChange={(v) => set({ currentAge: v })} />
        <Num label={t('fireAge')} value={inputs.fireAge} onChange={(v) => set({ fireAge: v })} />
        <Num label={t('lifeExpectancy')} value={inputs.lifeExpectancy} onChange={(v) => set({ lifeExpectancy: v })} />
        <label className="field">
          <span><Jargon text={t('province')} /></span>
          <select
            value={inputs.province}
            onChange={(e) => set({ province: e.target.value as Province })}
          >
            {PROVINCES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <Num label={t('annualSavings')} value={inputs.annualSavings} step={1000} onChange={(v) => set({ annualSavings: v })} />
        <Num label={t('retirementSpending')} value={inputs.retirementSpending} step={1000} onChange={(v) => set({ retirementSpending: v })} />
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
            <Num label={t('partnerAge')} value={inputs.partner.currentAge}
              onChange={(v) => set({ partner: { ...inputs.partner!, currentAge: v } })} />
            <p className="hint"><Jargon text={t('coupleNote')} /></p>
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
            onChange={(v) => set({ balances: { ...inputs.balances, [a]: v } })}
          />
        ))}
        <Num label={t('nonRegBook')} value={inputs.nonRegBook} step={5000} onChange={(v) => set({ nonRegBook: v })} />

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
        </details>

        <details>
          <summary>{t('savingsSplit')}</summary>
          {ACCOUNTS.map((a) => (
            <Num key={a} label={t(a)} value={Math.round(inputs.savingsSplit[a] * 100)}
              onChange={(v) => set({ savingsSplit: { ...inputs.savingsSplit, [a]: v / 100 } })} />
          ))}
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

        <label className="field">
          <span><Jargon text={t('investmentProperty')} /></span>
          <input
            type="checkbox"
            checked={!!inputs.investmentProperty}
            onChange={(e) =>
              set({
                investmentProperty: e.target.checked
                  ? { value: 500000, acb: 400000, appreciation: 0.02, sellAtAge: null }
                  : null,
              })
            }
          />
        </label>
        {inputs.investmentProperty && (
          <>
            <Num label={t('propValue')} value={inputs.investmentProperty.value} step={25000}
              onChange={(v) => set({ investmentProperty: { ...inputs.investmentProperty!, value: v } })} />
            <Num label={t('propAcb')} value={inputs.investmentProperty.acb} step={25000}
              onChange={(v) => set({ investmentProperty: { ...inputs.investmentProperty!, acb: v } })} />
            <Num label={t('propAppreciation')} value={inputs.investmentProperty.appreciation * 100} step={0.5}
              onChange={(v) => set({ investmentProperty: { ...inputs.investmentProperty!, appreciation: v / 100 } })} />
            <OptionalAge label={t('propSellAt')} value={inputs.investmentProperty.sellAtAge}
              onChange={(v) => set({ investmentProperty: { ...inputs.investmentProperty!, sellAtAge: v } })} />
            <p className="hint"><Jargon text={t('ipNote')} /></p>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>{t('benefits')}</legend>
        {inputs.partner && <p className="subhead">{t('benefitsSelf')}</p>}
        <Num label={t('cppStartAge')} value={inputs.cppStartAge} onChange={(v) => set({ cppStartAge: v })} />
        <Num label={t('cppAnnualAt65')} value={inputs.cppAnnualAt65} step={500} onChange={(v) => set({ cppAnnualAt65: v })} />
        <CppEstimator retireAge={inputs.fireAge} onApply={(v) => set({ cppAnnualAt65: v })} />
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
              onApply={(v) => set({ partner: { ...inputs.partner!, cppAnnualAt65: v } })}
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
