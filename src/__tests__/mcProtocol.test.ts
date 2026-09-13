import { describe, expect, it } from 'vitest'
import { matchesMcRequest, seededRandom, type McRequest, type McResponse } from '../mcProtocol'
import { DEFAULT_INPUTS } from '../store'

const request: McRequest = {
  requestId: 'run-a', inputRevision: 8, ruleVersion: 'rules-a', seed: 42,
  inputs: DEFAULT_INPUTS, trials: 1000,
}
const response: McResponse = { requestId: 'run-a', inputRevision: 8,
  ruleVersion: 'rules-a', seed: 42, status: 'error', error: 'controlled' }

describe('Monte Carlo worker identity', () => {
  it('requires every request coordinate to match before accepting a response', () => {
    expect(matchesMcRequest(response, request)).toBe(true)
    expect(matchesMcRequest({ ...response, requestId: 'run-b' }, request)).toBe(false)
    expect(matchesMcRequest({ ...response, inputRevision: 9 }, request)).toBe(false)
    expect(matchesMcRequest({ ...response, ruleVersion: 'rules-b' }, request)).toBe(false)
    expect(matchesMcRequest({ ...response, seed: 43 }, request)).toBe(false)
  })

  it('replays the same market draw stream from the seed', () => {
    const first = seededRandom(731)
    const replay = seededRandom(731)
    const different = seededRandom(732)
    const firstDraws = Array.from({ length: 10 }, first)
    expect(Array.from({ length: 10 }, replay)).toEqual(firstDraws)
    expect(Array.from({ length: 10 }, different)).not.toEqual(firstDraws)
    expect(firstDraws.every((value) => value >= 0 && value < 1)).toBe(true)
  })
})
