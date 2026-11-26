import { Field, Button } from '../ui'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Inputs } from '../engine'
import type { InputsV2 } from '../engine/model'
import { canonicalProjectionSnapshot } from '../deterministicResult'
import type { CanonicalMonteCarloResult } from '../canonicalMonteCarlo'
import { CANONICAL_MC_VERSION, matchesCanonicalMcRequest, type CanonicalMcRequest, type CanonicalMcResponse } from '../canonicalMcProtocol'
import { parseBudgetAmount } from '../forms/localeBudgetAmount'
import { useCad } from '../format'
import { useStore } from '../store'

type Props = { inputs: Inputs; plan: InputsV2; nonRegAbsent: boolean; revision: number; entryMode: 'guided' | 'professional' }
export function CanonicalMonteCarloCard(props: Props) {
  const { i18n } = useTranslation()
  const [source, setSource] = useState(() => ({ ...props, language: i18n.language, generation: 0 }))
  if (source.inputs !== props.inputs || source.plan !== props.plan || source.nonRegAbsent !== props.nonRegAbsent ||
    source.revision !== props.revision || source.entryMode !== props.entryMode || source.language !== i18n.language) {
    setSource({ ...props, language: i18n.language, generation: source.generation + 1 })
    return null
  }
  return <CanonicalMonteCarloDraft key={source.generation} {...props} />
}

function CanonicalMonteCarloDraft({ inputs, plan, nonRegAbsent, revision, entryMode }: Props) {
  const { t, i18n } = useTranslation()
  const cad = useCad(2)
  const displayMode = useStore(s => s.displayMode)
  const accounts = canonicalProjectionSnapshot(plan, { nonRegAbsent }).accounts
  const [seed, setSeed] = useState('42')
  const [trials, setTrials] = useState('100')
  const [vols, setVols] = useState<Record<string, string>>(() => Object.fromEntries(accounts.map(a => [a.id,
    a.volatility === null ? '' : new Intl.NumberFormat(i18n.language, { useGrouping: false, maximumSignificantDigits: 15 }).format(a.volatility * 100)])))
  const [state, setState] = useState<'idle' | 'running' | 'cancelled' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<CanonicalMonteCarloResult | null>(null)
  const [identity, setIdentity] = useState<CanonicalMcRequest | null>(null)
  const active = useRef<CanonicalMcRequest | null>(null)
  const worker = useRef<Worker | null>(null)
  const sourceId = useRef(crypto.randomUUID())
  const stop = () => { active.current = null; worker.current?.terminate(); worker.current = null }
  useEffect(() => () => { active.current = null; worker.current?.terminate() }, [])
  const current = () => {
    const s = useStore.getState(), meta = s.answerMeta['balances.nonReg']
    return s.inputs === inputs && s.canonical === plan && s.inputRevision === revision && s.entryMode === entryMode &&
      (meta?.status === 'notApplicable' && meta.origin === 'user') === nonRegAbsent &&
      (entryMode === 'professional' || s.guidedView === 'results' && s.resultRevision === revision)
  }
  const edit = () => { stop(); setResult(null); setIdentity(null); setState('idle') }
  const valid = /^\d+$/.test(seed) && Number(seed) <= 0xffffffff && /^\d+$/.test(trials) && Number(trials) >= 1 && Number(trials) <= 200 &&
    accounts.every(a => { const value = parseBudgetAmount(vols[a.id], i18n.language); return value !== null && value >= 0 && value <= 100 })
  const run = () => {
    if (!current() || !valid) return
    stop(); setResult(null); setState('running')
    const request: CanonicalMcRequest = { requestId: crypto.randomUUID(), sourceId: sourceId.current, inputRevision: revision,
      ruleVersion: CANONICAL_MC_VERSION, seed: /^\d+$/.test(seed) ? Number(seed) : NaN, trials: /^\d+$/.test(trials) ? Number(trials) : NaN,
      inputs, plan, evidence: { nonRegAbsent }, volatilityByAccount: Object.fromEntries(accounts.map(a => {
        const value = parseBudgetAmount(vols[a.id], i18n.language)
        return [a.id, value === null ? null : value / 100]
      })) }
    active.current = request; setIdentity(request)
    try {
      const w = new Worker(new URL('../canonicalMc.worker.ts', import.meta.url), { type: 'module' })
      worker.current = w
      w.onmessage = (event: MessageEvent<CanonicalMcResponse>) => {
        if (active.current !== request || !current()) return
        if (!matchesCanonicalMcRequest(event.data, request) || event.data.status !== 'success') { stop(); setState('error'); return }
        setResult(event.data.result); stop(); setState('done')
      }
      w.onerror = w.onmessageerror = () => { if (active.current === request) { stop(); setState('error') } }
      w.postMessage(request)
    } catch { stop(); setState('error') }
  }
  return <section className="chart-card" data-testid="canonical-mc">
    <h2>{t('canonicalMc.title')}</h2>
    <p>{t('canonicalMc.scope')}</p>
    <p className="hint">{t('canonicalMc.assumptions')}</p>
    <form onSubmit={e => { e.preventDefault(); run() }}>
      <Field>{t('canonicalMc.seed')}<input data-testid="canonical-mc-seed" type="text" inputMode="numeric" value={seed} onChange={e => { edit(); setSeed(e.target.value) }} /></Field>
      <Field>{t('canonicalMc.trials')}<input data-testid="canonical-mc-trials" type="text" inputMode="numeric" value={trials} onChange={e => { edit(); setTrials(e.target.value) }} /></Field>
      {accounts.map(a => <Field key={a.id}>{t('canonicalMc.volatility', { account: a.id })}<input data-testid={`canonical-mc-volatility-${a.id}`} type="text" inputMode="decimal" value={vols[a.id]} onChange={e => { edit(); setVols({ ...vols, [a.id]: e.target.value }) }} /></Field>)}
      <Button type="submit" data-testid="canonical-mc-run" disabled={state === 'running' || !valid}>{t('canonicalMc.run', { count: Number(trials) || 0 })}</Button>
      {state === 'running' && <Button type="button" data-testid="canonical-mc-cancel" onClick={() => { stop(); setResult(null); setState('cancelled') }}>{t('mcCancel')}</Button>}
    </form>
    <p role={state === 'error' ? 'alert' : 'status'} data-testid="canonical-mc-status">{t(`canonicalMc.status.${state}`)}</p>
    {result && <>
      <p>{t('canonicalMc.trace', { seed: identity?.seed, revision, version: identity?.ruleVersion, request: identity?.requestId, source: identity?.sourceId })}</p>
      <p data-testid="canonical-mc-counts">{t('canonicalMc.counts', { ...result.counts, total: result.trials })}</p>
      {result.stopReason && <p role="alert">{t(`canonicalMc.stop.${result.stopReason}`)}</p>}
      <p data-testid="canonical-mc-rate">{result.successRate === null ? t('canonicalMc.incomplete') : t('canonicalMc.rate', {
        numerator: result.counts.completeZeroGaps, denominator: result.completed, percent: new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 1 }).format(result.successRate),
      })}</p>
      {!!result.bands.length && <>
        <p>{t('canonicalMc.bands', { year: plan.baseYear, mode: t(displayMode === 'real' ? 'display_real' : 'display_nominal') })}</p>
        <div className="table-scroll"><table data-testid="canonical-mc-bands"><thead><tr>{['year', 'n', 'p10', 'p50', 'p90'].map(key => <th key={key} scope="col">{t(`canonicalMc.columns.${key}`)}</th>)}</tr></thead>
          <tbody>{result.bands.map(b => { const k = displayMode === 'real' ? (1 + plan.inflation) ** -(b.year - plan.baseYear + 1) : 1
            return <tr key={b.year}><th scope="row">{b.year}</th><td>{b.n}</td><td>{cad(b.p10 * k)}</td><td>{cad(b.p50 * k)}</td><td>{cad(b.p90 * k)}</td></tr>
          })}</tbody></table></div>
      </>}
    </>}
  </section>
}
