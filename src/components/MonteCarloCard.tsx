import { useChartColors } from '../chartColors'
import { Button } from '../ui'
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
import { track } from '../analytics'
import { Jargon } from './Jargon'
import { matchesMcRequest, type McRequest, type McResponse } from '../mcProtocol'

export function MonteCarloCard(props: { inputs: Inputs; inputRevision: number; ruleVersion: string; scale?: (age: number) => number }) {
  const { t } = useTranslation()
  const COLORS = useChartColors()
  const cad = useCad()
  const cadTick = useCadCompact()
  const workerRef = useRef<Worker | null>(null)
  const activeRef = useRef<McRequest | null>(null)
  const [running, setRunning] = useState(false)
  const [mc, setMc] = useState<MonteCarloResult | null>(null)
  const [error, setError] = useState(false)

  const stop = () => {
    activeRef.current = null
    workerRef.current?.terminate()
    workerRef.current = null
    setRunning(false)
  }
  // The App key remounts this card on input/mode/rule changes. Cleanup also
  // handles a result section disappearing before a worker has completed.
  useEffect(() => () => {
    activeRef.current = null
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  const run = () => {
    stop()
    track('monte_carlo_run')
    setMc(null)
    setError(false)
    setRunning(true)
    const request: McRequest = {
      requestId: crypto.randomUUID(),
      inputRevision: props.inputRevision,
      ruleVersion: props.ruleVersion,
      seed: crypto.getRandomValues(new Uint32Array(1))[0],
      inputs: props.inputs,
      trials: 1000,
    }
    activeRef.current = request
    try {
      const worker = new Worker(new URL('../mc.worker.ts', import.meta.url), {
        type: 'module',
      })
      workerRef.current = worker
      worker.onmessage = (e: MessageEvent<McResponse>) => {
        if (activeRef.current !== request) return
        if (!e.data || !matchesMcRequest(e.data, request)) {
          setError(true)
          stop()
          return
        }
        if (e.data.status === 'success') setMc(e.data.result)
        else setError(true)
        stop()
      }
      worker.onerror = worker.onmessageerror = () => {
        if (activeRef.current !== request) return
        setError(true)
        stop()
      }
      worker.postMessage(request)
    } catch {
      setError(true)
      stop()
    }
  }

  const k = props.scale ?? (() => 1)
  const data = mc?.bands.map((b, i) => ({
    age: b.age,
    p10: Math.round(b.p10 * k(b.age)),
    band: Math.round((b.p90 - b.p10) * k(b.age)),
    p50: Math.round(b.p50 * k(b.age)),
    worst: mc.failures.worstTrajectory
      ? Math.round(mc.failures.worstTrajectory[i].total * k(b.age))
      : undefined,
  }))

  return (
    <div className="chart-card">
      <div className="card-head">
        <h3>{t('mcTitle')}</h3>
        <Button variant="primary" className="primary" onClick={run} disabled={running}>
          {running ? t('mcRunning') : t('mcRun')}
        </Button>
        {running && <Button type="button" onClick={stop}>{t('mcCancel')}</Button>}
      </div>
      {mc && (
        <>
          <p className="mc-rate">
            {t('mcSuccess')}:{' '}
            <strong>
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
          <div className="chart-plot"><ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 24 }}>
              <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" strokeOpacity={0.4} />
              <XAxis stroke={COLORS.axis} dataKey="age" type="number" allowDecimals={false}
                domain={data && data.length ? [data[0].age, data[data.length - 1].age] : undefined}
                tickCount={12} />
              <YAxis stroke={COLORS.axis} tickFormatter={(v: number) => cadTick(v)} width={64} />
              <Tooltip itemStyle={{ color: COLORS.axis }}
                formatter={(v, name) =>
                  name === t('mcBand')
                    ? [cad(Number(v)), t('mcBand')]
                    : [cad(Number(v)), String(name)]
                }
              />
              <ReferenceLine x={props.inputs.fireAge} stroke={COLORS.fire} strokeDasharray="4 4" />
              {mc.failures.earliestDepletedAge != null && (
                <ReferenceLine
                  x={mc.failures.earliestDepletedAge}
                  stroke={COLORS.mcWorst}
                  strokeDasharray="2 3"
                  label={{ value: t('mcWorstAgeLabel', { age: mc.failures.earliestDepletedAge }), position: 'insideTopRight', fill: COLORS.mcWorst, fontSize: 12 }}
                />
              )}
              <Area dataKey="p10" stackId="band" stroke="none" fill="transparent" name="p10" />
              <Area dataKey="band" stackId="band" stroke="none" fill={COLORS.mcBand} fillOpacity={0.25} name={t('mcBand')} />
              <Line dataKey="p50" stroke={COLORS.mcMedian} strokeWidth={2} dot={false} name={t('mcMedian')} />
              {data?.some((d) => d.worst !== undefined) && (
                <Line dataKey="worst" stroke={COLORS.mcWorst} strokeWidth={1.5} strokeDasharray="4 3" dot={false} name={t('mcWorst')} connectNulls />
              )}
            </ComposedChart>
          </ResponsiveContainer></div>
          <p className="chart-currency">{t('ui.results.currency')}</p>
          <p className="hint"><Jargon text={t('mcNote')} /></p>
        </>
      )}
      {!mc && !running && <p className="hint"><Jargon text={t('mcIdle')} /></p>}
      {error && <p role="alert" className="hint">{t('mcError')}</p>}
    </div>
  )
}
