import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_INPUTS } from '../../store'
import { runProjection, type ReturnSampler } from '../projection'
import { legacyRetirement } from './fixtures/retirementSettlement'

// Measured at the S2 merge base d5168d11c9bfc96141cd1195009604d8b1e27bba.
function fingerprint(result: ReturnType<typeof runProjection>): string {
  // FNV-1a over the serialized result keeps the entire baseline compact.
  let hash = 0xcbf29ce484222325n
  for (const character of JSON.stringify(result)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0)!)) * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

describe('legacy projection parity across the retirement settlement change', () => {
  it('preserves the complete default result', () => {
    expect(fingerprint(runProjection(DEFAULT_INPUTS))).toMatchInlineSnapshot(`"773c1ee82052d279"`)
  })

  it('preserves the sampled spending and exhaustion path and return sampling order', () => {
    const input = legacyRetirement({ retirementSpending: 50_000, inflation: 0.02,
      fhsa: { balance: 1_000, annualContribution: 0, openedYearsAgo: 0 },
      lockedRetirement: { balance: 2_000, employeeContribution: 0, employerContribution: 0,
        accessibleAge: 65, jurisdiction: 'ON', owner: 'self' },
    })
    // Fresh draws on every call make repeated RRSP requests observable.
    let draw = 0
    const sample = vi.fn<ReturnSampler>(() => ++draw / 1_000)
    const result = runProjection(input, sample)
    expect(result.rows.map(row => row.shortfall > 0)).toEqual([false, false, true])
    expect(sample.mock.calls).toEqual([
      [57, 'tfsa'], [57, 'rrsp'], [57, 'nonReg'], [57, 'rrsp'], [57, 'rrsp'],
      [58, 'tfsa'], [58, 'rrsp'], [58, 'nonReg'], [58, 'rrsp'], [58, 'rrsp'],
      [59, 'tfsa'], [59, 'rrsp'], [59, 'nonReg'], [59, 'rrsp'], [59, 'rrsp'],
    ])
    expect(fingerprint(result)).toMatchInlineSnapshot(`"8acb87e3653e08ac"`)
  })
})
