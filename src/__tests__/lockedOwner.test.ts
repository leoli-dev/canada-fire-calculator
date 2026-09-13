import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_INPUTS, DEFAULT_LOCKED_RETIREMENT, DEFAULT_PARTNER, useStore } from '../store'

const original = useStore.getState()
afterEach(() => {
  useStore.setState(original, true)
  vi.unstubAllGlobals()
})

describe('locked account owner answer lifecycle', () => {
  it('requires a fresh answer when the account or its owner changes outside guided', () => {
    vi.stubGlobal('window', {})
    const confirmed = { status: 'confirmed' as const, origin: 'user' as const, updatedAt: '2026-09-13T00:00:00Z' }
    useStore.setState({ inputs: { ...DEFAULT_INPUTS, partner: DEFAULT_PARTNER,
      lockedRetirement: { ...DEFAULT_LOCKED_RETIREMENT, balance: 500_000, owner: 'self' } },
    answerMeta: { 'lockedRetirement.owner': confirmed } })
    useStore.getState().set({ lockedRetirement: { ...DEFAULT_LOCKED_RETIREMENT, balance: 500_000, owner: 'partner' } })
    expect(useStore.getState().answerMeta['lockedRetirement.owner']?.status).toBe('unknown')
    useStore.getState().markAnswers(['lockedRetirement.owner'], 'confirmed')
    useStore.getState().set({ lockedRetirement: null })
    expect(useStore.getState().answerMeta['lockedRetirement.owner']?.status).toBe('unknown')
  })
})
