/**
 * BE-38 B2: the CCB rule pack governs the CCB computation.
 *
 * The defect this pins: `ccbAnnual` read a hardcoded `CCB` literal while the
 * sourced, versioned `selectBenefitRules` pack was only displayed by
 * `RuleAssumptions.tsx`. These tests exercise the two halves of the diagnostic
 * the recorded decision requires — editing the old literal must not move any
 * number, editing the pack must.
 *
 * Expected values here are either published table anchors or an independent
 * restatement of the published rule (`publishedCcb`), never a call to the
 * function under test and never a call to the engine's own helpers.
 */
import { describe, expect, it } from 'vitest'
import {
  PLAN_BENEFIT_PERIOD,
  CCB,
  anchorBenefitRules,
  ccbAnnual,
  selectPlanBenefitRules,
} from '../benefits'
import { publishRulePack, publishedBenefitPacks, selectBenefitRules, selectFhsaRules, selectGisRules, selectTaxRules, type BenefitRulePack } from '../rules'
import { runProjection } from '../projection'
import type { Inputs } from '../types'

/** The published plan-anchor pack: the one the projection must be reading. */
const anchor = selectBenefitRules('CCB', PLAN_BENEFIT_PERIOD)

/**
 * The published rule restated, transcribing the pack's own sourced figures into
 * the arithmetic the statute states: maximum for the child mix, less `rate1` of
 * AFNI above `th1` (to `th2`), less `rate2` above `th2`, floored at zero. This
 * is deliberately a second implementation of the rule, not a wrapper.
 */
function publishedCcb(
  nUnder6: number,
  n6to17: number,
  afni: number,
  pack = anchor,
): number {
  const n = nUnder6 + n6to17
  if (n <= 0) return 0
  const bracket = Math.min(n, 4) - 1
  const { values } = pack
  const maximum = nUnder6 * values.maxUnder6 + n6to17 * values.max6to17
  const firstBand = Math.max(0, Math.min(afni, values.th2) - values.th1)
  const secondBand = Math.max(0, afni - values.th2)
  return Math.max(0, maximum - values.rate1[bracket] * firstBand - values.rate2[bracket] * secondBand)
}

describe('BE-38 B2: the plan anchor is a sourced, published CCB pack', () => {
  it('selects the published plan-anchor period and states its policy', () => {
    expect(PLAN_BENEFIT_PERIOD).toBe('2026-07/2027-06')
    const context = anchorBenefitRules()
    expect(context.pack.id).toBe('CA-CCB-2026-07-v1')
    expect(context.pack.assumedFutureRule).toBe(false)
    expect(context.pack.incomeTaxYear).toBe(2025)
    expect(context.projectionPolicy).toEqual({ kind: 'published' })
  })

  it('puts every CCB figure the computation reads in the pack, with a source', () => {
    // Nothing the arithmetic uses may be missing from the pack: each figure is
    // asserted to be a finite positive number here, and the pack publication
    // check (`publishRulePack`) runs over every pack at import time.
    const { values } = anchor
    for (const key of ['maxUnder6', 'max6to17', 'th1', 'th2'] as const)
      expect(Number.isFinite(values[key]) && values[key] > 0, key).toBe(true)
    expect(values.rate1).toHaveLength(4)
    expect(values.rate2).toHaveLength(4)
    expect(values.basePhaseOutAmounts).toHaveLength(4)
    expect(anchor.fieldSources.amounts).toContain('/news/2026/07/')
    expect(anchor.fieldSources.thresholds).toContain('adjustment-personal-income-tax-benefit-amounts')
    expect(anchor.fieldSources.rates).toContain('laws-lois.justice.gc.ca')
  })

  it('records the published per-bracket phase-out amounts the rates describe', () => {
    // CRA publishes the first-threshold phase-out amount for one/two/three/four
    // -or-more children. They are stated in dollars in the pack and are what
    // the rates are a share of; pinning them keeps the derived rates auditable.
    expect(anchor.values.basePhaseOutAmounts).toEqual([3123, 6022, 8476, 10260])
    expect(selectBenefitRules('CCB', '2025-07/2026-06').values.basePhaseOutAmounts)
      .toEqual([3061, 5904, 8310, 10059])
  })
})

describe('BE-38 B2: published CCB boundary amounts', () => {
  // CRA's own worked example for the 2026-27 program year, quoted in the ESDC
  // news release: one child aged 5 and one aged 9 with a $65,000 adjusted
  // family net income receives approximately $11,430.
  it("matches the published ESDC worked example ($65,000, one child 5 and one 9)", () => {
    // The independent restatement of the published rule gives $11,427.00; the
    // release's own example says "approximately $11,430", which is its rounding
    // of the same figure (the continuous two-segment line differs from CRA's
    // rounded flat deduction at the second threshold by a few dollars — see the
    // existing projection test). Both are asserted: the rule exactly, and the
    // published headline within the release's own approximation.
    expect(ccbAnnual(1, 1, 65000)).toBeCloseTo(publishedCcb(1, 1, 65000), 6)
    expect(Math.abs(ccbAnnual(1, 1, 65000) - 11430)).toBeLessThan(5)
  })

  it('pays the maximum below the first threshold, for every child mix', () => {
    // Maximums are pack values × the child mix; the pack's own published
    // maximums are pinned separately above.
    for (let u = 0; u <= 4; u++) {
      for (let s = 0; s <= 4; s++) {
        if (u + s === 0) continue
        const maximum = u * 8157 + s * 6883
        expect(ccbAnnual(u, s, 0), `${u}/${s} at $0`).toBeCloseTo(maximum, 6)
        expect(ccbAnnual(u, s, anchor.values.th1), `${u}/${s} at th1`).toBeCloseTo(maximum, 6)
        expect(ccbAnnual(u, s, anchor.values.th1 - 1), `${u}/${s} just below th1`).toBeCloseTo(maximum, 6)
      }
    }
  })

  it('reduces at the first-threshold rate exactly at and just above th1', () => {
    const th1 = anchor.values.th1
    for (let n = 1; n <= 4; n++) {
      const rate = anchor.values.rate1[n - 1]
      expect(ccbAnnual(n, 0, th1 + 1)).toBeCloseTo(n * 8157 - rate, 6)
      expect(ccbAnnual(n, 0, th1 + 1000)).toBeCloseTo(n * 8157 - rate * 1000, 6)
    }
  })

  it('is continuous through the second threshold, and steeper after it', () => {
    const { th1, th2, rate1, rate2 } = anchor.values
    for (let n = 1; n <= 4; n++) {
      const bracket = n - 1
      // The two segments meet at th2: approaching from below and from above
      // give one limit, and the published second rate takes over from there.
      const atThreshold = n * 8157 - rate1[bracket] * (th2 - th1)
      expect(ccbAnnual(n, 0, th2), `${n} at th2`).toBeCloseTo(atThreshold, 6)
      expect(ccbAnnual(n, 0, th2 - 1), `${n} just below th2`).toBeCloseTo(atThreshold + rate1[bracket], 6)
      expect(ccbAnnual(n, 0, th2 + 1), `${n} just above th2`).toBeCloseTo(atThreshold - rate2[bracket], 6)
      // A larger family loses more per dollar above the second threshold.
      expect(rate2[bracket]).toBeGreaterThan(0)
      if (bracket > 0) expect(rate2[bracket]).toBeGreaterThan(rate2[bracket - 1])
    }
  })

  it('pins the child-count brackets: one, two, three and four-or-more', () => {
    // The bracket index is `min(n, 4) - 1`, so a fifth child uses the
    // four-or-more row's rates. The reduction is a per-bracket dollar figure,
    // not a per-child one: a fifth child does not raise it, so it adds one more
    // maximum and keeps the four-or-more reduction. That is why a fifth child
    // is worth the full `maxUnder6` more than a fourth at this income.
    for (const n of [1, 2, 3, 4, 5]) {
      expect(ccbAnnual(n, 0, 200000), `${n} children`).toBeCloseTo(publishedCcb(n, 0, 200000), 6)
    }
    expect(ccbAnnual(5, 0, 200000))
      .toBeCloseTo(ccbAnnual(4, 0, 200000) + anchor.values.maxUnder6, 6)
    // Beyond the fourth child the bracket cannot grow, so only the maximum does.
    expect(ccbAnnual(6, 0, 200000)).toBeCloseTo(ccbAnnual(5, 0, 200000) + anchor.values.maxUnder6, 6)
    // The reduction itself is a per-bracket dollar figure, not a per-child one:
    // at one income it is identical for four, five and six children, which is
    // what makes the extra children beyond the fourth worth a full maximum.
    const reduction = (n: number) => n * anchor.values.maxUnder6 - ccbAnnual(n, 0, 200000)
    expect(reduction(4)).toBeCloseTo(reduction(5), 6)
    expect(reduction(5)).toBeCloseTo(reduction(6), 6)
    // A smaller family is in a smaller bracket and reduces by less.
    expect(reduction(3)).toBeLessThan(reduction(4))
    expect(reduction(1)).toBeLessThan(reduction(2))
  })

  it('is zero with no children and never negative at extreme income', () => {
    expect(ccbAnnual(0, 0, 0)).toBe(0)
    expect(ccbAnnual(0, 0, 500000)).toBe(0)
    for (let u = 0; u <= 4; u++) {
      for (let s = 0; s <= 4; s++) {
        if (u + s === 0) continue
        expect(ccbAnnual(u, s, 10_000_000), `${u}/${s}`).toBe(0)
      }
    }
  })

  it('reproduces the whole parameter sweep against the published rule', () => {
    // 0-4 children in each age band, AFNI across both thresholds, exactly at
    // them, one dollar either side, and far beyond. This is the sweep whose
    // digest the base-vs-head comparison reports.
    const afni = new Set<number>([0, 1, 2, 3, 5000, 20000, 37500, 40000, 50000, 70000, 80000, 82500])
    for (const boundary of [anchor.values.th1, anchor.values.th2]) {
      for (const delta of [-2, -1, 0, 1, 2, 1000, 5000, 50000]) afni.add(Math.max(0, boundary + delta))
    }
    for (const value of [10000, 45000, 60000, 65000, 125000, 150000, 200000, 1_000_000, 10_000_000]) afni.add(value)
    // A dense grid between the two thresholds and beyond the second, so the
    // sweep covers the whole reduction line and not just its landmarks.
    for (const base of [anchor.values.th1, anchor.values.th2]) {
      for (let step = 0; step <= 12; step++) afni.add(base + step * 3000)
      for (const extra of [150000, 350000, 600000]) afni.add(base + extra)
    }
    let points = 0
    for (let u = 0; u <= 4; u++) {
      for (let s = 0; s <= 4; s++) {
        for (const income of [...afni].sort((a, b) => a - b)) {
          expect(ccbAnnual(u, s, income), `${u}/${s}/${income}`)
            .toBeCloseTo(publishedCcb(u, s, income), 10)
          points++
        }
      }
    }
    expect(points).toBeGreaterThan(1200)
  })
})

describe('BE-38 B2: the pack governs the computation, the old literal does not', () => {
  it('hands back no pack state a caller write can carry into a later selection', () => {
    // The review's two priced routes, then every write route on every path.
    // A write into the projected 2040 pack's rate row moved this to 0.
    selectBenefitRules('CCB', '2040-07/2041-06', { annualRate: 0.02 }).values.rate1[3] = 0.99
    expect(ccbAnnual(4, 0, 200000, selectPlanBenefitRules({ program: 'CCB', paymentPeriod: PLAN_BENEFIT_PERIOD }))).toBeCloseTo(11238.165, 3)
    // A write into the projected 2028 pack emptied the published ON frozen list.
    selectTaxRules('ON', 2028, { annualRate: 0.02 }).frozenProvincialBracketIndexes.length = 0
    expect(selectTaxRules('ON', 2030, { annualRate: 0.02 }).provincial.brackets.map(b => b.upTo)).toEqual([58333, 116670, 150000, 220000, Infinity])
    const poison = (v: any, seen = new Set<any>()): void => {
      if (!v || typeof v !== 'object' || seen.has(v)) return
      seen.add(v)
      for (const w of [() => Object.assign(v, { poisoned: 1 }), () => { delete v.id; delete v[0] }, () => Reflect.set(v, '__proto__', { poisoned: 1 }), () => { v[0] = 1; v.push?.(1); v.length = 0 }]) { try { w() } catch { /* a frozen member refuses the write */ } }
      Object.values(v).forEach(n => poison(n, seen))
    }
    for (const select of [
      () => selectTaxRules('ON', 2026), () => selectTaxRules('ON', 2030, { annualRate: 0.02 }),
      () => selectBenefitRules('CCB', '2026-07/2027-06'), () => selectBenefitRules('CCB', '2040-07/2041-06', { annualRate: 0.02 }),
      () => selectFhsaRules(), () => selectGisRules(),
    ]) {
      const before = JSON.stringify(select()); poison(select())
      expect(JSON.stringify(select())).toBe(before)
    }
  })

  it('computes from whatever pack it is handed, not from a literal', () => {
    // A distinct assumed future pack: if the computation read the old literal
    // (or ignored its argument) these would all equal the published figures.
    const assumed = selectPlanBenefitRules({
      program: 'CCB', paymentPeriod: '2027-07/2028-06', futureIndexation: { annualRate: 0.02 },
    })
    expect(assumed.pack.values.maxUnder6).toBe(8320)
    expect(ccbAnnual(1, 0, 0, assumed)).toBe(8320)
    expect(ccbAnnual(1, 0, 0)).toBe(8157)
    // The ESDC example moves with the pack: $11,430 published becomes $11,831.27.
    expect(ccbAnnual(1, 1, 65000, assumed)).toBeCloseTo(11831.27, 2)
    // And the policy travels with it, so an assumed figure is never presented
    // as a published one.
    expect(assumed.projectionPolicy).toEqual({
      kind: 'assumed', annualRate: 0.02,
      fromRuleId: 'CA-CCB-2026-07-v1', fromPaymentPeriod: '2026-07/2027-06',
    })
  })

  it('pins the retired literal to the published pack, so the two cannot drift', () => {
    // The `CCB` literal is dead — nothing computes from it — but it is still
    // exported, so a reader could mistake it for the source of truth. This is
    // the one test that names it: every field must equal the pack's, so a drift
    // in *either* direction fails.
    const published = publishedBenefitPacks().find(pack => pack.id === 'CA-CCB-2026-07-v1')!
    expect(published.values.maxUnder6).toBe(8157)
    for (const key of ['maxUnder6', 'max6to17', 'th1', 'th2'] as const)
      expect(CCB[key], `CCB.${key}`).toBe(published.values[key])
    expect(CCB.rate1).toEqual(published.values.rate1)
    expect(CCB.rate2).toEqual(published.values.rate2)
  })

  it('publishes exactly the two CCB packs the anchor can select from', () => {
    expect(publishedBenefitPacks().map(pack => pack.id))
      .toEqual(['CA-CCB-2025-07-v1', 'CA-CCB-2026-07-v1'])
  })

  it('does not let a caller mutate the cached anchor pack', () => {
    // `anchorBenefitRules` hands its cached context straight back on the
    // `ccbAnnual` hot path, so a stray write must not silently re-price later
    // amounts while `rulePackId` still names the published pack.
    const before = ccbAnnual(1, 0, 0)
    try {
      anchorBenefitRules().pack.values.maxUnder6 = 424242
    } catch {
      // A frozen cache refuses the write; a copy would absorb it.
    }
    expect(anchorBenefitRules().pack.values.maxUnder6).toBe(8157)
    expect(anchorBenefitRules().pack.id).toBe('CA-CCB-2026-07-v1')
    expect(ccbAnnual(1, 0, 0)).toBe(before)
  })
})

describe('BE-38 B2: runProjection prices CCB from the same pack', () => {
  const base: Inputs = {
    currentAge: 35,
    fireAge: 45,
    lifeExpectancy: 90,
    province: 'ON',
    annualSavings: 40000,
    savingsSplit: { tfsa: 0.3, rrsp: 0.5, nonReg: 0.2 },
    retirementSpending: 40000,
    returns: { tfsa: 0.05, rrsp: 0.05, nonReg: 0.05 },
    balances: { tfsa: 800000, rrsp: 50000, nonReg: 50000 },
    nonRegBook: 40000,
    cppStartAge: 65,
    cppAnnualAt65: 10000,
    oasStartAge: 65,
    oasAnnualAt65: 8700,
    strategy: 'tfsaFirst' as const,
  }

  it('reports the same pack and period the projection computed with', () => {
    const result = runProjection({ ...base, children: [{ age: 5 }] })
    expect(result.benefitRules).toMatchObject({
      program: 'CCB',
      paymentPeriod: PLAN_BENEFIT_PERIOD,
      rulePackId: 'CA-CCB-2026-07-v1',
      assumedFutureRule: false,
    })
    expect(result.benefitRules?.projectionPolicy).toEqual({ kind: 'published' })
  })

  it('matches the pack-derived amount in every year row that pays CCB', () => {
    // One child aged 5 at currentAge 35, so it is under 6 for this year and the
    // next, then 6-17. The year row's own taxable income reproduces the AFNI
    // the engine used, so the row's CCB must equal the published rule applied
    // to it — a value the pack produced, not the function under test.
    const result = runProjection({ ...base, children: [{ age: 5 }] })
    const rows = result.rows.filter(row => row.phase !== 'accumulation')
    expect(rows.some(row => row.ccb > 0)).toBe(true)
    let checked = 0
    for (const row of rows) {
      const yearIndex = row.age - base.currentAge
      const childAge = 5 + yearIndex
      if (childAge >= 18) {
        expect(row.ccb, `age ${row.age} after 18`).toBe(0)
        continue
      }
      const taxable = Object.values(row.taxableBySource).reduce((sum, part) => sum + part, 0)
      const expected = publishedCcb(childAge < 6 ? 1 : 0, childAge < 6 ? 0 : 1, taxable)
      expect(row.ccb, `age ${row.age} (child ${childAge}) at $${taxable.toFixed(2)}`)
        .toBeCloseTo(expected, 6)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('keeps the same pack when there are no children at all', () => {
    const result = runProjection({ ...base, children: null })
    expect(result.rows.every(row => row.ccb === 0)).toBe(true)
    // The selected pack is a property of the plan frame, not of whether a
    // child happens to be entered, so the disclosure does not vanish.
    expect(result.benefitRules?.rulePackId).toBe('CA-CCB-2026-07-v1')
  })
})

describe('BE-38 B2: an assumed period is indexed exactly once and marked assumed', () => {
  it('applies the pack indexation once per elapsed program year, from the latest pack', () => {
    const published = selectBenefitRules('CCB', '2026-07/2027-06')
    const one = selectBenefitRules('CCB', '2027-07/2028-06', { annualRate: 0.02 })
    const two = selectBenefitRules('CCB', '2028-07/2029-06', { annualRate: 0.02 })
    expect(one.assumedFutureRule).toBe(true)
    expect(one.assumedAnnualRate).toBe(0.02)
    expect(one.basedOnRuleId).toBe('CA-CCB-2026-07-v1')
    expect(one.basedOnPaymentPeriod).toBe('2026-07/2027-06')
    expect(one.values.maxUnder6).toBe(Math.round(published.values.maxUnder6 * 1.02))
    // Not compounded twice inside one projection, and never from the already
    // indexed pack: two program years is exactly two applications of 1.02.
    expect(two.values.maxUnder6).toBe(Math.round(published.values.maxUnder6 * 1.02 ** 2))
    expect(two.values.th1).toBe(Math.round(published.values.th1 * 1.02 ** 2))
    // The rates are statutory percentages: an assumed period does not inflate
    // them, and the two segments still meet at the indexed thresholds.
    expect(one.values.rate1).toEqual(published.values.rate1)
    expect(one.values.rate2).toEqual(published.values.rate2)
    expect(one.values.basePhaseOutAmounts).toEqual(published.values.basePhaseOutAmounts)
  })

  it('marks every assumed context as assumed and the published one as published', () => {
    const assumed = selectPlanBenefitRules({
      program: 'CCB', paymentPeriod: '2029-07/2030-06', futureIndexation: { annualRate: 0.021 },
    })
    expect(assumed.projectionPolicy.kind).toBe('assumed')
    expect(assumed.pack.assumedFutureRule).toBe(true)
    expect(assumed.pack.coverage).toBe('estimated')
    expect(anchorBenefitRules().projectionPolicy.kind).toBe('published')
  })

  it('reports the rate it actually applied for a frozen pack, and never inflates it', () => {
    // No frozen CCB pack is published, so drive the real selector with a frozen
    // fixture: four years on the values must not move, and the policy must
    // report the applied rate (none), never the requested 2.0% the panel would
    // otherwise render as indexation that never happened.
    const frozen = publishRulePack<BenefitRulePack>({
      ...selectBenefitRules('CCB', '2026-07/2027-06'),
      id: 'CA-CCB-2026-07-v1+frozen-fixture',
      indexationRule: 'frozen',
    })
    const context = selectPlanBenefitRules(
      { program: 'CCB', paymentPeriod: '2030-07/2031-06', futureIndexation: { annualRate: 0.02 } },
      [frozen],
    )
    expect(context.pack.values).toEqual(frozen.values)
    expect(context.pack.assumedAnnualRate).toBe(0)
    expect(context.projectionPolicy).toEqual({
      kind: 'assumed', annualRate: 0,
      fromRuleId: frozen.id, fromPaymentPeriod: '2026-07/2027-06',
    })
    expect(context.pack.assumedFutureRule).toBe(true)
    // A 0% caller assumption on an indexed pack is a no-op too, so only a new
    // publication can move a frozen value.
    const noIncrease = selectBenefitRules('CCB', '2028-07/2029-06', { annualRate: 0 })
    expect(noIncrease.assumedFutureRule).toBe(true)
    expect(noIncrease.assumedAnnualRate).toBe(0)
    expect(noIncrease.values.maxUnder6).toBe(8157)
  })
})
