import { useTranslation } from 'react-i18next'
import {
  MELTDOWN_CAPS,
  STRATEGIES,
  type Inputs,
  type MeltdownCap,
  type Strategy,
} from '../engine'
import { useStore } from '../store'
import { Jargon } from './Jargon'

export function WithdrawalOrderCard(props: { inputs: Inputs }) {
  const { t } = useTranslation()
  const set = useStore((s) => s.set)
  const { inputs } = props

  return (
    <div className="chart-card withdrawal-order-card">
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
      {inputs.strategy === 'meltdownPaced' && (
        <>
          <p className="hint"><Jargon text={t('meltdownNote')} /></p>
          <label className="field">
            <span><Jargon text={t('meltdownCapLabel')} /></span>
            <select
              value={inputs.meltdownBracketCap ?? 'bracket1'}
              onChange={(e) => set({ meltdownBracketCap: e.target.value as MeltdownCap })}
            >
              {MELTDOWN_CAPS.map((c) => (
                <option key={c} value={c}>{t(`meltdownCap_${c}`)}</option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  )
}
