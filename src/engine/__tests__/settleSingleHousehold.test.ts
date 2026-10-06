import { describe, expect, it } from 'vitest'
import { DEFAULT_INPUTS, DEFAULT_PARTNER } from '../../store'
import { refreshCanonicalFromLegacy, settleSingleHousehold } from '../migration'
import { pricingGate } from '../model'

const roundTrip = () => {
  const single = refreshCanonicalFromLegacy(null, DEFAULT_INPUTS)
  const couple = refreshCanonicalFromLegacy(single, { ...DEFAULT_INPUTS, partner: { ...DEFAULT_PARTNER } })
  return refreshCanonicalFromLegacy(couple, DEFAULT_INPUTS)
}

describe('FE-38 settling a plan that went single, couple, single', () => {
  it('reproduces the stuck household estimate', () => {
    expect(pricingGate(roundTrip()).reasons).toEqual(expect.arrayContaining(['ownershipUnknown', 'recipientUnknown']))
  })

  it('assigns everything to the one person, drops the removed partner and clears the gate', () => {
    const settled = settleSingleHousehold(roundTrip())
    expect(pricingGate(settled)).toEqual({ allowed: true, reasons: [] })
    expect(settled.accounts.every(account => account.ownerId === 'legacy:person:self')).toBe(true)
    expect(settled.incomeSources.some(source => source.id.startsWith('legacy:person:partner:'))).toBe(false)
    expect(settled.orphanedPeople).toBeUndefined()
    // Balances are untouched: settling is about owners, never amounts.
    expect(settled.accounts.map(account => account.balance)).toEqual(roundTrip().accounts.map(account => account.balance))
  })

  it('stays settled through the next ordinary form edit', () => {
    const next = refreshCanonicalFromLegacy(settleSingleHousehold(roundTrip()), { ...DEFAULT_INPUTS, annualSavings: 41_000 })
    expect(pricingGate(next).allowed).toBe(true)
  })

  it('leaves a couple unchanged', () => {
    const couple = refreshCanonicalFromLegacy(null, { ...DEFAULT_INPUTS, partner: { ...DEFAULT_PARTNER } })
    expect(settleSingleHousehold(couple)).toBe(couple)
  })
})
