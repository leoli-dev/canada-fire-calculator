import { describe, expect, it } from 'vitest'
import { selectTaxRules, selectBenefitRules, publishRulePack } from '../index'

// Independent published boundary fixture, not calculated from taxData.ts.
// CRA 2025/2026 tax-rate pages and CCB payment-period pages are linked in the pack.
describe('dated rule selection', () => {
  it('selects the published cross-year boundaries rather than relabelling 2026', () => {
    const on25 = selectTaxRules('ON', 2025)
    const on26 = selectTaxRules('ON', 2026)
    expect(on25.federal.brackets[0]).toEqual({ upTo: 57375, rate: 0.145 })
    expect(on25.provincial.brackets.slice(0, 2)).toEqual([
      { upTo: 52886, rate: 0.0505 }, { upTo: 105775, rate: 0.0915 },
    ])
    expect(on26.federal.brackets[0]).toEqual({ upTo: 58523, rate: 0.14 })
    expect(on26.provincial.brackets.slice(0, 2)).toEqual([
      { upTo: 53891, rate: 0.0505 }, { upTo: 107785, rate: 0.0915 },
    ])
    expect(on25.assumedFutureRule).toBe(false)
    expect(on26.assumedFutureRule).toBe(false)
    expect(selectBenefitRules('CCB', '2025-07/2026-06').values.maxUnder6).toBe(7997)
    expect(selectBenefitRules('CCB', '2026-07/2027-06').values.maxUnder6).toBe(8157)
  })

  it('rejects unknown past periods and jurisdictions, marks future assumptions', () => {
    expect(() => selectTaxRules('ON', 2024)).toThrow()
    expect(() => selectTaxRules('ZZ', 2026)).toThrow()
    const future = selectTaxRules('ON', 2028, { annualRate: 0.02 })
    expect(future.assumedFutureRule).toBe(true)
    expect(future.provincial.brackets[2].upTo).toBe(150000)
    expect(future.provincial.brackets[3].upTo).toBe(220000)
    expect(future.federal.brackets[0].upTo).toBe(Math.round(58523 * 1.02 ** 2))
    expect(selectTaxRules('ON', 2026).federal.brackets[0].upTo).toBe(58523)
    expect(selectTaxRules('ON', 2028, { annualRate: 0.02 })).toEqual(future)
    expect(future.basedOnRuleId).toBe('CA-ON-tax-2026-legacy-v1')
    expect(selectTaxRules('MB', 2028, { annualRate: 0.02 }).provincial.brackets[0].upTo).toBe(47000)
    expect(() => selectBenefitRules('CCB', '2024-07/2025-06')).toThrow()
    expect(selectBenefitRules('CCB', '2027-07/2028-06', { annualRate: 0.02 }).values.maxUnder6).toBe(8320)
  })

  it('blocks publication without complete provenance and policy metadata', () => {
    expect(() => publishRulePack({ id: 'broken', jurisdiction: 'ON', taxYear: 2026 })).toThrow()
  })

  it('rejects malformed pack content before publication', () => {
    const valid = selectTaxRules('ON', 2026)
    expect(() => publishRulePack({ ...valid, jurisdiction: 'ZZ' })).toThrow()
    expect(() => publishRulePack({ ...valid, federal: { bpa: NaN, brackets: [] } })).toThrow()
    expect(() => publishRulePack({ ...valid, effectiveDate: '2026-02-31' })).toThrow()
    expect(() => publishRulePack({ ...valid, verifiedAt: '2026-13-01' })).toThrow()
    expect(() => publishRulePack({ ...valid, fieldSources: { ...valid.fieldSources, federalBpa: '' } })).toThrow()
    expect(() => publishRulePack({ ...valid, federal: { ...valid.federal, brackets: [
      { upTo: Number.NaN, rate: 0.1 }, { upTo: Infinity, rate: 0.2 },
    ] } })).toThrow()
    expect(() => publishRulePack({ ...valid, provincial: { ...valid.provincial, brackets: [
      { upTo: 1000, rate: 0.2 }, { upTo: 500, rate: 0.1 }, { upTo: Infinity, rate: 0.3 },
    ] } })).toThrow()
    expect(() => selectTaxRules('ON', 2027, { annualRate: -1 })).toThrow()
    expect(() => selectBenefitRules('CCB', '2027-07/2028-06', { annualRate: -1 })).toThrow()
    const ccb = selectBenefitRules('CCB', '2026-07/2027-06')
    expect(() => publishRulePack({ ...ccb, paymentPeriod: '2026-07/2026-06' })).toThrow()
    expect(() => publishRulePack({ ...ccb, values: { ...ccb.values, th1: Infinity } })).toThrow()
  })

  it('links each pinned field to dated official evidence and records MB conflict', () => {
    const on25 = selectTaxRules('ON', 2025)
    const on26 = selectTaxRules('ON', 2026)
    expect(on25.fieldSources.federalBrackets).toContain('/2025/')
    expect(on25.fieldSources.federalBpa).toContain('/2025/')
    expect(on25.fieldSources.provincialBrackets).toContain('/2025/')
    expect(on25.fieldSources.provincialBpa).toContain('/2025/')
    expect(on26.fieldSources.federalBrackets).toContain('/2026/')
    expect(on26.fieldSources.provincialBpa).toContain('/2026/')
    expect(selectBenefitRules('CCB', '2025-07/2026-06').fieldSources.amounts).toContain('2025')
    expect(selectBenefitRules('CCB', '2026-07/2027-06').fieldSources.amounts).toContain('/2026/')
    expect(selectTaxRules('MB', 2026).sourceConflict).toContain('$47,564')
  })
})
