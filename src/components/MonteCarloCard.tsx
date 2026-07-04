import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Area,
  ComposedChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Inputs } from '../engine'
import type { MonteCarloResult } from '../engine/monteCarlo'
import { useCad, useCadCompact } from '../format'
import { Jargon } from './Jargon'

export function MonteCarloCard(props: { inputs: Inputs; scale?: (age: number) => number }) {
  const { t } = useTranslation()
  const cad = useCad()
  const cadTick = useCadCompact()
  const workerRef = useRef<Worker | null>(null)
  const [running, setRunning] = useState(false)
  const [mc, setMc] = useState<MonteCarloResult | null>(null)

  // results are stale as soon as inputs change
  useEffect(() => setMc(null), [props.inputs])
  useEffect(() => () => workerRef.current?.terminate(), [])

  const run = () => {
    setRunning(true)
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('../mc.worker.ts', import.meta.url), {
        type: 'module',
      })
    }
    workerRef.current.onmessage = (e: MessageEvent<MonteCarloResult>) => {
      setMc(e.data)
      setRunning(false)
    }
    workerRef.current.postMessage({ inputs: props.inputs, trials: 1000 })
  }

  const k = props.scale ?? (() => 1)
  const data = mc?.bands.map((b) => ({
    age: b.age,
    p10: Math.round(b.p10 * k(b.age)),
    band: Math.round((b.p90 - b.p10) * k(b.age)),
    p50: Math.round(b.p50 * k(b.age)),
  }))

  return (
    <div className="chart-card">
      <div className="card-head">
        <h3>{t('mcTitle')}</h3>
        <button className="primary" onClick={run} disabled={running}>
          {running ? t('mcRunning') : t('mcRun')}
        </button>
      </div>
      {mc && (
        <>
          <p className="mc-rate">
            {t('mcSuccess')}:{' '}
            <strong className={mc.successRate >= 0.85 ? 'good' : mc.successRate >= 0.7 ? 'warn' : 'poor'}>
              {Math.round(mc.successRate * 100)}%
            </strong>{' '}
            <span className="hint">({t('mcTrials', { n: mc.trials })})</span>
          </p>
          {mc.failures.count > 0 ? (
            <div className="fail-profile">
              <p>
                <Jargon
                  text={t('mcFailStats', {
                    count: mc.failures.count,
                    pct: Math.round((mc.failures.count / mc.trials) * 100),
                    earliest: mc.failures.earliestDepletedAge,
                    median: mc.failures.medianDepletedAge,
                  })}
                />
              </p>
              {mc.failures.avgEarlyReturnFailed !== null &&
                mc.failures.avgEarlyReturnSuccess !== null && (
                  <p>
                    <Jargon
                      text={t('mcFailWhy', {
                        failed: (mc.failures.avgEarlyReturnFailed * 100).toFixed(1),
                        succeeded: (mc.failures.avgEarlyReturnSuccess * 100).toFixed(1),
                      })}
                    />
                  </p>
                )}
            </div>
          ) : (
            <p className="hint">{t('mcNoFail', { n: mc.trials })}</p>
          )}
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
              <XAxis dataKey="age" type="number" allowDecimals={false}
                domain={data && data.length ? [data[0].age, data[data.length - 1].age] : undefined}
                tickCount={12} />
              <YAxis tickFormatter={(v: number) => cadTick(v)} width={64} />
              <Tooltip
                formatter={(v, name) =>
                  name === t('mcBand')
                    ? [cad(Number(v)), t('mcBand')]
                    : [cad(Number(v)), String(name)]
                }
              />
              <ReferenceLine x={props.inputs.fireAge} stroke="#b3541e" strokeDasharray="4 4" />
              <Area dataKey="p10" stackId="band" stroke="none" fill="transparent" name="p10" />
              <Area dataKey="band" stackId="band" stroke="none" fill="#7da2c9" fillOpacity={0.35} name={t('mcBand')} />
              <Line dataKey="p50" stroke="#1f4e79" strokeWidth={2} dot={false} name={t('mcMedian')} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="hint"><Jargon text={t('mcNote')} /></p>
        </>
      )}
      {!mc && !running && <p className="hint"><Jargon text={t('mcIdle')} /></p>}
    </div>
  )
}
