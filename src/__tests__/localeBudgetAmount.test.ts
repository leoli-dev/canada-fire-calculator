import { describe, expect, it } from 'vitest'
import { parseBudgetAmount } from '../forms/localeBudgetAmount'

describe('strict localized canonical budget amounts', () => {
  it.each(['fr', 'fr-CA'])('preserves comma decimals and valid grouped paste in %s', language => {
    for (const [raw, amount] of [['11298,65', 11298.65], ['12000,50', 12000.5], ['350,25', 350.25], ['350.25', 350.25], ['12\u202f000,50', 12000.5], ['12\u00a0000,50', 12000.5], ['12 000,50', 12000.5], ['0', 0], ['0,00', 0]] as const) expect(parseBudgetAmount(raw, language)).toBe(amount)
    for (const raw of ['', ' ', '35,0,25', '12 00,50', '12,000.50', '1e3', '-1', '12CAD', '12,', '12.']) expect(parseBudgetAmount(raw, language)).toBeNull()
  })
  it.each(['en', 'en-US', 'zh'])('accepts dot decimals without reinterpreting malformed comma input in %s', language => {
    expect(parseBudgetAmount('11298.65', language)).toBe(11298.65)
    expect(parseBudgetAmount('12,000.50', language)).toBe(12000.5)
    expect(parseBudgetAmount('0', language)).toBe(0)
    for (const raw of ['', '11298,65', '35,0,25', '12.000.50', '12 00.50', '1e3', '-1', '12CAD']) expect(parseBudgetAmount(raw, language)).toBeNull()
  })
})
