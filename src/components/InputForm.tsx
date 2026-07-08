import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_FHSA,
  DEFAULT_INVESTMENT_PROPERTY,
  DEFAULT_PARTNER,
  DEFAULT_PENSION,
  MIX_PRESETS,
  useStore,
  WORKSHEET_KEYS,
} from '../store'
import {
  DEBT_KINDS,
  validateInputs,
  type AccountType,
  type DebtKind,
  type Goal,
  type Province,
  type ValidationIssue,
} from '../engine'
import { useCad } from '../format'
import { CppEstimator, OasEstimator } from './BenefitEstimators'
import { Jargon } from './Jargon'
import { NumberInput } from './NumberInput'

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
      <NumberInput
        className={props.issue ? `invalid-${props.issue.severity}` : undefined}
        value={props.value}
        step={props.step ?? 1}
        onChange={(v) => props.onChange(v ?? 0)}
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
      <NumberInput
        className={props.issue ? `invalid-${props.issue.severity}` : undefined}
        value={props.value}
        placeholder="—"
        onChange={props.onChange}
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

  const fhsaMaturityAge = inputs.fhsa
    ? Math.min(inputs.currentAge + Math.max(0, 15 - inputs.fhsa.openedYearsAgo), 71)
    : inputs.currentAge

  const pr = inputs.principalResidence

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
        <details>
          <summary>{t('worksheetTitle')}</summary>
          {WORKSHEET_KEYS.map((k) => (
            <Num key={k} label={t(k)} value={worksheet[k] || 0} step={500}
              onChange={(v) => setWorksheet(k, Math.max(0, v))} />
          ))}
          <div className="ws-total">
            <span>{t('wsTotal')}: <strong>{cad(worksheetTotal)}</strong></span>
            <button type="button" disabled={worksheetTotal <= 0}
              onClick={() => set({ retirementSpending: worksheetTotal })}>
              {t('wsApply')}
            </button>
          </div>
        </details>
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
        <p className="hint"><Jargon text={t('displayModeNote')} /></p>
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
      </fieldset>

      <fieldset>
        <legend>{t('accounts')}</legend>
        <p className="hint">{t('accountsHint')}</p>
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
        <p className="hint"><Jargon text={t('nonRegBookHint')} /></p>

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
          <p className="hint"><Jargon text={t('mixWhyConservative')} /></p>
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
        <legend><Jargon text={t('fhsaSection')} /></legend>
        <label className="field">
          <span>{t('fhsaToggle')}</span>
          <input
            type="checkbox"
            checked={!!inputs.fhsa}
            onChange={(e) => set({ fhsa: e.target.checked ? { ...DEFAULT_FHSA } : null })}
          />
        </label>
        {inputs.fhsa && (
          <>
            <p className="hint"><Jargon text={t('fhsaNote')} /></p>
            <Num label={t('fhsaBalance')} value={inputs.fhsa.balance} step={2000}
              issue={issueFor('fhsa.balance')}
              onChange={(v) => set({ fhsa: { ...inputs.fhsa!, balance: v } })} />
            <Num label={t('fhsaContribution')} value={inputs.fhsa.annualContribution} step={500}
              issue={issueFor('fhsa.annualContribution')}
              onChange={(v) => set({ fhsa: { ...inputs.fhsa!, annualContribution: v } })} />
            <p className="hint"><Jargon text={t('fhsaContributionHint')} /></p>
            <Num label={t('fhsaOpenedYearsAgo')} value={inputs.fhsa.openedYearsAgo}
              issue={issueFor('fhsa.openedYearsAgo')}
              onChange={(v) => set({ fhsa: { ...inputs.fhsa!, openedYearsAgo: v } })} />
            <p className="hint"><Jargon text={t('fhsaOpenedYearsAgoHint')} /></p>
            <p className="hint">
              {pr?.mode === 'planned' && pr.buyAtAge < fhsaMaturityAge
                ? t('fhsaTerminalPurchase', { age: pr.buyAtAge })
                : t('fhsaTerminalRrsp', {
                    n: inputs.fhsa.openedYearsAgo,
                    year: new Date().getFullYear() + (fhsaMaturityAge - inputs.currentAge),
                    age: fhsaMaturityAge,
                  })}
            </p>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>{t('propertySection')}</legend>

        {pr && (
          <div className="property-card">
            <p className="subhead property-head">
              🏠 <Jargon text={t('principalResidence')} />
              <button
                type="button"
                className="remove-item"
                onClick={() => set({ principalResidence: null })}
              >
                {t('removeItem')}
              </button>
            </p>
            <p className="hint"><Jargon text={t('prCardNote')} /></p>
            <div className="mode-toggle">
              <label>
                <input type="radio" name="prMode" checked={pr.mode !== 'planned'}
                  onChange={() => set({
                    principalResidence: { mode: 'owned', value: 800000, appreciation: 0.02, sellAtAge: null },
                  })} />
                {t('prModeOwned')}
              </label>
              <label>
                <input type="radio" name="prMode" checked={pr.mode === 'planned'}
                  onChange={() => set({
                    principalResidence: {
                      mode: 'planned',
                      buyAtAge: inputs.currentAge + 5,
                      price: 800000,
                      downPayment: 200000,
                      appreciation: 0.02,
                      annualMortgagePayment: 42000,
                      mortgageYears: 25,
                      netHoldingCostChange: 0,
                      sellAtAge: null,
                    },
                  })} />
                {t('prModePlanned')}
              </label>
            </div>

            {pr.mode === 'planned' ? (
              <>
                <Num label={t('prBuyAtAge')} value={pr.buyAtAge}
                  issue={issueFor('principalResidence.buyAtAge')}
                  onChange={(v) => set({ principalResidence: { ...pr, buyAtAge: v } })} />
                <Num label={t('prPrice')} value={pr.price} step={25000}
                  issue={issueFor('principalResidence.price')}
                  onChange={(v) => set({ principalResidence: { ...pr, price: v } })} />
                <Num label={t('prDownPayment')} value={pr.downPayment} step={10000}
                  issue={issueFor('principalResidence.downPayment')}
                  onChange={(v) => set({ principalResidence: { ...pr, downPayment: v } })} />
                <p className="hint"><Jargon text={t('prFundingOrderHint')} /></p>
                <Num label={t('propAppreciation')} value={pr.appreciation * 100} step={0.5}
                  onChange={(v) => set({ principalResidence: { ...pr, appreciation: v / 100 } })} />
                <Num label={t('debtPaymentLabel')} value={pr.annualMortgagePayment ?? 0} step={1000}
                  issue={issueFor('principalResidence.annualMortgagePayment')}
                  onChange={(v) => set({ principalResidence: { ...pr, annualMortgagePayment: v } })} />
                <Num label={t('debtYears')} value={pr.mortgageYears ?? 0}
                  onChange={(v) => set({ principalResidence: { ...pr, mortgageYears: v } })} />
                <Num label={t('prNetHoldingCost')} value={pr.netHoldingCostChange} step={500}
                  issue={issueFor('principalResidence.netHoldingCostChange')}
                  onChange={(v) => set({ principalResidence: { ...pr, netHoldingCostChange: v } })} />
                <p className="hint"><Jargon text={t('prNetHoldingCostHint')} /></p>
                <OptionalAge label={t('propSellAt')} value={pr.sellAtAge}
                  issue={issueFor('principalResidence.sellAtAge')}
                  onChange={(v) => set({ principalResidence: { ...pr, sellAtAge: v } })} />
              </>
            ) : (
              <>
                <Num label={t('propValue')} value={pr.value} step={25000}
                  issue={issueFor('principalResidence.value')}
                  onChange={(v) => set({ principalResidence: { ...pr, value: v } })} />
                <Num label={t('propAppreciation')} value={pr.appreciation * 100} step={0.5}
                  onChange={(v) => set({ principalResidence: { ...pr, appreciation: v / 100 } })} />
                <OptionalAge label={t('propSellAt')} value={pr.sellAtAge}
                  issue={issueFor('principalResidence.sellAtAge')}
                  onChange={(v) => set({ principalResidence: { ...pr, sellAtAge: v } })} />
                <p className="hint"><Jargon text={t('prNote')} /></p>
                <label className="field">
                  <span>{t('hasMortgage')}</span>
                  <input
                    type="checkbox"
                    checked={!!pr.mortgage}
                    onChange={(e) =>
                      set({
                        principalResidence: {
                          ...pr,
                          mortgage: e.target.checked
                            ? { balance: 300000, annualPayment: 24000, yearsRemaining: 20 }
                            : undefined,
                        },
                      })
                    }
                  />
                </label>
                {pr.mortgage && (
                  <>
                    <Num label={t('debtBalance')} value={pr.mortgage.balance} step={10000}
                      issue={issueFor('principalResidence.mortgage.balance')}
                      onChange={(v) => set({
                        principalResidence: { ...pr, mortgage: { ...pr.mortgage!, balance: v } },
                      })} />
                    <Num label={t('debtPaymentLabel')} value={pr.mortgage.annualPayment} step={1000}
                      issue={issueFor('principalResidence.mortgage.annualPayment')}
                      onChange={(v) => set({
                        principalResidence: { ...pr, mortgage: { ...pr.mortgage!, annualPayment: v } },
                      })} />
                    <Num label={t('debtYears')} value={pr.mortgage.yearsRemaining}
                      issue={issueFor('principalResidence.mortgage.yearsRemaining')}
                      onChange={(v) => set({
                        principalResidence: { ...pr, mortgage: { ...pr.mortgage!, yearsRemaining: v } },
                      })} />
                  </>
                )}
              </>
            )}
          </div>
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
                🏢 <Jargon text={t('investmentProperty')} /> #{i + 1}
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
              <p className="hint"><Jargon text={t('ipCardNote')} /></p>
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
              <p className="hint"><Jargon text={t('propRentHint')} /></p>
              <OptionalAge label={t('propSellAt')} value={ip.sellAtAge}
                issue={issueFor(`investmentProperties.${i}.sellAtAge`)}
                onChange={(v) => patch({ sellAtAge: v })} />
              <label className="field">
                <span>{t('hasMortgage')}</span>
                <input
                  type="checkbox"
                  checked={!!ip.mortgage}
                  onChange={(e) =>
                    patch({
                      mortgage: e.target.checked
                        ? { balance: 300000, annualPayment: 24000, yearsRemaining: 20 }
                        : undefined,
                    })
                  }
                />
              </label>
              {ip.mortgage && (
                <>
                  <Num label={t('debtBalance')} value={ip.mortgage.balance} step={10000}
                    issue={issueFor(`investmentProperties.${i}.mortgage.balance`)}
                    onChange={(v) => patch({ mortgage: { ...ip.mortgage!, balance: v } })} />
                  <Num label={t('debtPaymentLabel')} value={ip.mortgage.annualPayment} step={1000}
                    issue={issueFor(`investmentProperties.${i}.mortgage.annualPayment`)}
                    onChange={(v) => patch({ mortgage: { ...ip.mortgage!, annualPayment: v } })} />
                  <Num label={t('debtYears')} value={ip.mortgage.yearsRemaining}
                    issue={issueFor(`investmentProperties.${i}.mortgage.yearsRemaining`)}
                    onChange={(v) => patch({ mortgage: { ...ip.mortgage!, yearsRemaining: v } })} />
                  <p className="hint"><Jargon text={t('mortgageInterestNote')} /></p>
                </>
              )}
            </div>
          )
        })}
        <div className="add-buttons">
          {!inputs.principalResidence && (
            <button
              type="button"
              className="add-item"
              onClick={() =>
                set({
                  principalResidence: { value: 800000, appreciation: 0.02, sellAtAge: null },
                })
              }
            >
              {t('addPrincipalResidence')}
            </button>
          )}
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
        </div>
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

        <label className="field">
          <span><Jargon text={t('pensionToggle')} /></span>
          <input
            type="checkbox"
            checked={!!inputs.pension}
            onChange={(e) => set({ pension: e.target.checked ? DEFAULT_PENSION : null })}
          />
        </label>
        {inputs.pension && (
          <>
            <Num label={t('pensionAnnual')} value={inputs.pension.annualAmount} step={1000}
              issue={issueFor('pension.annualAmount')}
              onChange={(v) => set({ pension: { ...inputs.pension!, annualAmount: v } })} />
            <Num label={t('pensionStartAge')} value={inputs.pension.startAge}
              issue={issueFor('pension.startAge')}
              onChange={(v) => set({ pension: { ...inputs.pension!, startAge: v } })} />
            <Num label={t('pensionIndexation')} value={Math.round(inputs.pension.indexation * 100)} step={25}
              issue={issueFor('pension.indexation')}
              onChange={(v) => set({ pension: { ...inputs.pension!, indexation: Math.max(0, Math.min(100, v)) / 100 } })} />
            <Num label={t('pensionBridge')} value={inputs.pension.bridgeAnnual} step={1000}
              issue={issueFor('pension.bridgeAnnual')}
              onChange={(v) => set({ pension: { ...inputs.pension!, bridgeAnnual: v } })} />
            <p className="hint"><Jargon text={t('pensionNote')} /></p>
          </>
        )}

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
            <label className="field">
              <span><Jargon text={t('pensionToggle')} /></span>
              <input
                type="checkbox"
                checked={!!inputs.partner.pension}
                onChange={(e) =>
                  set({
                    partner: {
                      ...inputs.partner!,
                      pension: e.target.checked ? DEFAULT_PENSION : null,
                    },
                  })
                }
              />
            </label>
            {inputs.partner.pension && (
              <>
                <Num label={t('pensionAnnual')} value={inputs.partner.pension.annualAmount} step={1000}
                  issue={issueFor('partner.pension.annualAmount')}
                  onChange={(v) => set({ partner: { ...inputs.partner!, pension: { ...inputs.partner!.pension!, annualAmount: v } } })} />
                <Num label={t('pensionStartAge')} value={inputs.partner.pension.startAge}
                  issue={issueFor('partner.pension.startAge')}
                  onChange={(v) => set({ partner: { ...inputs.partner!, pension: { ...inputs.partner!.pension!, startAge: v } } })} />
                <Num label={t('pensionIndexation')} value={Math.round(inputs.partner.pension.indexation * 100)} step={25}
                  issue={issueFor('partner.pension.indexation')}
                  onChange={(v) => set({ partner: { ...inputs.partner!, pension: { ...inputs.partner!.pension!, indexation: Math.max(0, Math.min(100, v)) / 100 } } })} />
                <Num label={t('pensionBridge')} value={inputs.partner.pension.bridgeAnnual} step={1000}
                  issue={issueFor('partner.pension.bridgeAnnual')}
                  onChange={(v) => set({ partner: { ...inputs.partner!, pension: { ...inputs.partner!.pension!, bridgeAnnual: v } } })} />
                <p className="hint"><Jargon text={t('pensionNote')} /></p>
              </>
            )}
          </>
        )}

      </fieldset>

      <button type="button" className="reset" onClick={reset}>{t('reset')}</button>
    </form>
  )
}
