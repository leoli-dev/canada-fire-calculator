import { useEffect, useState } from 'react'
import type { Inputs } from '../engine'
import { ANALYSES, type AnalysisKind, type AnalysisRequest, type AnalysisResponse, type AnalysisResult } from './compute'

/** Recent results by kind and plan, so reopening a card or undoing an edit is instant. */
const CACHE_LIMIT = 12
const cache = new Map<string, unknown>()

function remember(key: string, value: unknown) {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
}

/**
 * One worker per kind. A scan cannot be interrupted mid-run, so a newer plan
 * terminates the worker still busy with an older one instead of queueing
 * behind it: while someone types, only the last value is ever computed.
 */
const busy = new Map<AnalysisKind, { worker: Worker; resolve: (response: AnalysisResponse | null) => void }>()
let nextRequestId = 1

/** Resolves null when a newer request for the same kind replaced this one. */
function run(kind: AnalysisKind, inputs: Inputs): Promise<AnalysisResponse | null> {
  if (typeof Worker === 'undefined') {
    // No worker (tests, very old browsers): compute in place.
    try { return Promise.resolve({ requestId: 0, status: 'success', result: ANALYSES[kind](inputs) }) } catch (error) {
      return Promise.resolve({ requestId: 0, status: 'error', error: String(error) })
    }
  }
  const previous = busy.get(kind)
  if (previous) {
    previous.worker.terminate()
    previous.resolve(null)
  }
  const worker = new Worker(new URL('../analysis.worker.ts', import.meta.url), { type: 'module', name: `fire-${kind}` })
  const requestId = nextRequestId++
  return new Promise((resolve) => {
    busy.set(kind, { worker, resolve })
    worker.onmessage = (e: MessageEvent<AnalysisResponse>) => {
      if (e.data.requestId !== requestId) return
      busy.delete(kind)
      worker.terminate()
      resolve(e.data)
    }
    worker.onerror = () => {
      busy.delete(kind)
      worker.terminate()
      resolve({ requestId, status: 'error', error: 'worker failed' })
    }
    worker.postMessage({ requestId, kind, inputs } satisfies AnalysisRequest)
  })
}

/** Which comparison cards are open, kept across a mode switch that remounts them. */
const openCards = new Set<AnalysisKind>()

export function useCardOpen(kind: AnalysisKind): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => openCards.has(kind))
  return [open, (next) => {
    if (next) openCards.add(kind)
    else openCards.delete(kind)
    setOpen(next)
  }]
}

export type AnalysisState<K extends AnalysisKind> =
  | { status: 'idle' | 'pending' | 'error'; data: AnalysisResult<K> | null; stale: boolean }
  | { status: 'ready'; data: AnalysisResult<K>; stale: false }

/**
 * Runs a comparison scan off the main thread while `enabled`. While a new
 * plan is computing, the previous result stays visible and is marked stale.
 */
export function useAnalysis<K extends AnalysisKind>(kind: K, inputs: Inputs, enabled: boolean): AnalysisState<K> {
  const key = `${kind}:${JSON.stringify(inputs)}`
  const cached = cache.get(key) as AnalysisResult<K> | undefined
  const [last, setLast] = useState<{ key: string; data: AnalysisResult<K> } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || cache.has(key)) return
    let live = true
    run(kind, inputs).then((response) => {
      if (!response) return
      if (response.status === 'success') remember(key, response.result)
      if (!live) return
      if (response.status === 'success') setLast({ key, data: response.result as AnalysisResult<K> })
      else setFailed(key)
    })
    return () => { live = false }
    // `key` encodes `kind` and `inputs`.
  }, [enabled, key])

  useEffect(() => {
    if (cached && last?.key !== key) setLast({ key, data: cached })
  }, [cached, key, last?.key])

  if (cached) return { status: 'ready', data: cached, stale: false }
  if (!enabled) return { status: 'idle', data: last?.data ?? null, stale: last !== null }
  if (failed === key) return { status: 'error', data: last?.data ?? null, stale: last !== null }
  return { status: 'pending', data: last?.data ?? null, stale: last !== null }
}
