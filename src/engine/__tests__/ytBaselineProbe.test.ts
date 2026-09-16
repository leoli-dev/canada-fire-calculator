// BE-38 B4 follow-up baseline probe. The expectations are the two values
// Yukon's Supreme Court Rules, Appendix C, Schedule 1, item 11 prints — $0 for
// an estate not exceeding $25,000 and $140 above it — written here as literals
// so the file runs against *both* revisions and the base failure is visible:
// at base `491b9f5`, `PROBATE_RATES.YT` is `{ flat: 140, rate: 0, threshold: 0 }`
// and every one of these fails with `140`.
import { describe, expect, it } from 'vitest'
import { probateTax } from '../tax'
import { PROBATE_RATES } from '../taxData'

describe('Yukon probate as its own fee schedule prints it', () => {
  it('charges nothing where the estate does not exceed $25,000', () => {
    expect(probateTax(5_000, 'YT')).toBe(0)
    expect(probateTax(25_000, 'YT')).toBe(0)
    expect(probateTax(25_001, 'YT')).toBe(140)
  })

  it('carries the published boundary in the priced row', () => {
    expect(PROBATE_RATES.YT).toEqual({ flat: 140, rate: 0, threshold: 25_000 })
  })

  it('leaves the other no-rate jurisdictions priced from their own schedules', () => {
    // BE-38 B4: AB stopped being unconditional — its Surrogate Rules Schedule 2
    // item 1(1)(a) charges $35 on "$10 000 or under", so the first dollar is that
    // printed rung rather than the old top-tier $525. QC's court fee is the one
    // unconditional flat amount left.
    expect(probateTax(1, 'AB')).toBe(35)
    expect(probateTax(10_000, 'AB')).toBe(35)
    expect(probateTax(250_001, 'AB')).toBe(525)
    expect(probateTax(1, 'QC')).toBe(243)
    expect(probateTax(1_000_000, 'ON')).toBeCloseTo((1_000_000 - 50_000) * 0.015, 6)
  })
})
