import { describe, expect, it } from 'vitest'
import {
  PLAN_TAX_YEAR,
  incomeTax,
  selectPlanTaxRules,
  taxRuleProvenance,
  trySelectPlanTaxRules,
} from '../../tax'
import { publishRulePack, selectTaxRules } from '../index'
import type { Province } from '../../types'
import type { InputsV2 } from '../../model'
import type { Inputs } from '../../types'
import { migratePersistedPlan } from '../../migration'
import { calculateHouseholdTax } from '../../householdTax'
import { runProjection } from '../../projection'

const PROVINCES: Province[] = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']

/**
 * Expected total income tax at each 2026 bracket boundary — taken from the code
 * as it stood before the pack was wired in (commit 2d65797, clean worktree),
 * never from the function under test. Every row is
 * `[boundary, tax(boundary - 1), tax(boundary), tax(boundary + 1)]`, covering
 * the provincial first and second thresholds and the federal first threshold.
 * The pack's own published boundaries and rates are pinned separately in
 * `selection.test.ts`; `legacy.test.ts` (this table) is the number-difference
 * evidence: after the wiring the same incomes must produce exactly these
 * figures, because the 2026 snapshot is a byte-identical copy of the literals.
 */
const LEGACY_2026_TAX: Record<Province, [number, number, number, number][]> = {
  AB: [[61200, 9512.92, 9513.205, 9513.51], [154259, 39942.61, 39942.97, 39943.35], [58523, 8750.04, 8750.26, 8750.545]],
  BC: [[50363, 6827.576, 6827.772, 6827.989], [100728, 20500.02, 20500.302, 20500.612], [58523, 8598.275, 8598.492, 8598.774]],
  MB: [[47000, 7648.232, 7648.48, 7648.7475], [100000, 24521.6525, 24521.985, 24522.364], [58523, 10730.615, 10730.8825, 10731.215]],
  NB: [[52333, 8657.992, 8658.226, 8658.506], [104666, 26310.416, 26310.761, 26311.126], [58523, 10391.146, 10391.426, 10391.771]],
  NL: [[44678, 6699.221, 6699.448, 6699.733], [89354, 21435.773, 21436.123, 21436.486], [58523, 10644.988, 10645.273, 10645.623]],
  NS: [[30995, 3711.4298, 3711.6577, 3711.9472], [61991, 12910.0652, 12910.4197, 12910.7914], [58523, 11680.7242, 11681.0137, 11681.3682]],
  NT: [[53003, 7170.436, 7170.635, 7170.861], [106009, 22236.29, 22236.581, 22236.908], [58523, 8417.929, 8418.155, 8418.446]],
  NU: [[55801, 6954.36, 6954.54, 6954.75], [111602, 22122.61, 22122.885, 22123.18], [58523, 7525.95, 7526.16, 7526.435]],
  ON: [[53891, 7906.8205, 7907.011, 7907.2425], [107785, 23970.9576, 23971.2724, 23971.61132], [58523, 8979.0875, 8979.319, 8979.6155]],
  PE: [[33928, 4244.565, 4244.8, 4245.0747], [65820, 13479.4977, 13479.8374, 13480.2084], [58523, 11000.7718, 11001.0465, 11001.3862]],
  QC: [[54345, 10304.4548, 10304.7117, 10305.0186], [108680, 30145.2732, 30145.644375, 30146.06555], [58523, 11586.633, 11586.9399, 11587.301075]],
  SK: [[54532, 8916.81, 8917.055, 8917.32], [155805, 44209.145, 44209.53, 44209.935], [58523, 9974.405, 9974.67, 9975]],
  YT: [[58523, 8582.28, 8582.484, 8582.779], [117045, 25846.179, 25846.474, 25846.843], [58523, 8582.28, 8582.484, 8582.779]],
}

/** Credit/levy probes that exercise the age, pension and spouse paths. */
const LEGACY_2026_PROBES: [string, () => number, number][] = [
  ['ON 250k (surtax bands)', () => incomeTax(250_000, 'ON'), 89472.24579416317],
  ['MB 300k (BPA phase-out)', () => incomeTax(300_000, 'MB'), 116681.37],
  ['YT 300k (BPA phase-out)', () => incomeTax(300_000, 'YT'), 101158.121],
  ['QC 120k senior', () => incomeTax(120_000, 'QC', { age: 70, pensionIncome: 5000 }), 34815.25375],
  ['ON 90k with spouse', () => incomeTax(90_000, 'ON', { spouseNetIncome: 20_000 }), 18462.249499999998],
]

const baseInputs: Inputs = {
  currentAge: 40, fireAge: 55, lifeExpectancy: 90, province: 'ON', annualSavings: 20_000,
  savingsSplit: { tfsa: 0.34, rrsp: 0.33, nonReg: 0.33 }, retirementSpending: 60_000,
  returns: { tfsa: 0.05, rrsp: 0.05, nonReg: 0.04 }, balances: { tfsa: 100_000, rrsp: 300_000, nonReg: 200_000 },
  nonRegBook: 150_000, cppStartAge: 65, cppAnnualAt65: 12_000, oasStartAge: 65, oasAnnualAt65: 8_000,
  strategy: 'meltdownPaced',
}

function canonicalPlan(inputs: Inputs = baseInputs): InputsV2 {
  const plan = migratePersistedPlan({ inputs }, 10, PLAN_TAX_YEAR)
  // Clear the migration review gates so the plan may be priced at all; the pack
  // selection under test happens before any of them.
  plan.migration = { sourcePersistVersion: 11, ownershipNeedsConfirmation: false,
    ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
  return plan
}

describe('BE-38 B1: the annual tax computation reads the sourced rule pack', () => {
  it('prices every supported jurisdiction at bracket boundaries from the selected pack', () => {
    for (const province of PROVINCES) {
      const rules = selectPlanTaxRules({ jurisdiction: province, taxYear: 2026 })
      // The sourced, versioned pack — not a literal and not another jurisdiction's.
      expect(rules.pack.id).toBe(`CA-${province}-tax-2026-legacy-v1`)
      expect(rules.pack.jurisdiction).toBe(province)
      expect(rules.taxYear).toBe(2026)
      for (const [boundary, below, at, above] of LEGACY_2026_TAX[province]) {
        expect(incomeTax(boundary - 1, province, undefined, rules)).toBeCloseTo(below, 6)
        expect(incomeTax(boundary, province, undefined, rules)).toBeCloseTo(at, 6)
        expect(incomeTax(boundary + 1, province, undefined, rules)).toBeCloseTo(above, 6)
        // Crossing a published threshold can only raise the marginal rate: a
        // higher bracket rate applies from the boundary on, and a levy or
        // credit phase-out above it can only add. A tax that fell here would
        // mean the wrong ladder priced the boundary.
        const belowStep = incomeTax(boundary, province, undefined, rules) -
          incomeTax(boundary - 1, province, undefined, rules)
        const aboveStep = incomeTax(boundary + 1, province, undefined, rules) -
          incomeTax(boundary, province, undefined, rules)
        expect(aboveStep).toBeGreaterThan(belowStep - 1e-6)
      }
    }
  })

  it('keeps the default entry point on the same anchor pack as an explicit selection', () => {
    // No priced number changed when the literals were replaced by the pack: the
    // legacy figures are the expected values, taken before the change.
    for (const province of PROVINCES) {
      for (const [boundary, below, at, above] of LEGACY_2026_TAX[province]) {
        expect(incomeTax(boundary - 1, province)).toBeCloseTo(below, 6)
        expect(incomeTax(boundary, province)).toBeCloseTo(at, 6)
        expect(incomeTax(boundary + 1, province)).toBeCloseTo(above, 6)
      }
    }
    for (const [label, compute, expected] of LEGACY_2026_PROBES) {
      expect(compute(), label).toBeCloseTo(expected, 6)
    }
  })

  it('lets the selector, not a literal, decide the numbers: the 2025 ON pack prices 2025', () => {
    // ON 2025 first bracket: federal 57,375 at 14.5% with a 16,129 BPA, Ontario
    // 52,886 at 5.05% with a 12,747 BPA (pack CA-ON-tax-2025-v1).
    const on25 = selectPlanTaxRules({ jurisdiction: 'ON', taxYear: 2025 })
    expect(on25.pack.id).toBe('CA-ON-tax-2025-v1')
    expect(on25.pack.federal.brackets[0]).toEqual({ upTo: 57375, rate: 0.145 })
    expect(on25.pack.federal.bpa).toBe(16129)
    expect(on25.pack.provincial.brackets[0]).toEqual({ upTo: 52886, rate: 0.0505 })
    expect(on25.pack.provincial.bpa).toBe(12747)
    // 0.145 x (52,886 - 16,129) + 0.0505 x (52,886 - 12,747) + 600 health premium
    expect(incomeTax(52886, 'ON', undefined, on25)).toBeCloseTo(7956.7845, 6)
    const on26 = selectPlanTaxRules({ jurisdiction: 'ON', taxYear: 2026 })
    expect(incomeTax(52886, 'ON', undefined, on26)).not.toBeCloseTo(7956.7845, 2)
  })

  it('freezes what the pack freezes and indexes what it indexes, exactly once', () => {
    const on28 = selectTaxRules('ON', 2028, { annualRate: 0.02 })
    // Ontario's $150,000 and $220,000 thresholds are not indexed.
    expect(on28.provincial.brackets[2].upTo).toBe(150000)
    expect(on28.provincial.brackets[3].upTo).toBe(220000)
    expect(on28.provincial.brackets[0].upTo).toBe(Math.round(53891 * 1.02 ** 2))
    expect(on28.provincial.brackets[1].upTo).toBe(Math.round(107785 * 1.02 ** 2))
    expect(on28.federal.brackets[0].upTo).toBe(Math.round(58523 * 1.02 ** 2))
    expect(on28.assumedFutureRule).toBe(true)
    expect(on28.assumedAnnualRate).toBe(0.02)
    expect(on28.basedOnRuleId).toBe('CA-ON-tax-2026-legacy-v1')
    expect(on28.basedOnTaxYear).toBe(2026)
    expect(on28.id).toBe('CA-ON-tax-2026-legacy-v1+assumed-2028-0.02')
    // A frozen jurisdiction's own thresholds never rise.
    const mb28 = selectTaxRules('MB', 2028, { annualRate: 0.02 })
    expect(mb28.provincial.brackets[0].upTo).toBe(47000)
    expect(mb28.provincial.brackets[1].upTo).toBe(100000)
    expect(mb28.federal.brackets[0].upTo).toBe(Math.round(58523 * 1.02 ** 2))
    // Indexed once over three elapsed years, not compounded twice: applying the
    // rate to the already-indexed 2028 value would give 59,406 instead of 59,405.
    const on29 = selectTaxRules('ON', 2029, { annualRate: 0.005 })
    expect(on29.federal.brackets[0].upTo).toBe(Math.round(58523 * 1.005 ** 3))
    expect(on29.federal.brackets[0].upTo).toBe(59405)
    expect(on29.federal.brackets[0].upTo).not.toBe(59406)
  })

  it('marks exactly the assumed years and no published one', () => {
    const published = taxRuleProvenance(selectPlanTaxRules({ jurisdiction: 'ON', taxYear: 2026 }))
    expect(published).toEqual({
      rulePackId: 'CA-ON-tax-2026-legacy-v1', ruleYear: 2026, assumedFutureRule: false,
      projectionPolicy: { kind: 'published' }, coverage: 'estimated',
    })
    const assumed = taxRuleProvenance(selectPlanTaxRules({ jurisdiction: 'ON', taxYear: 2028, futureIndexation: { annualRate: 0.02 } }))
    expect(assumed.assumedFutureRule).toBe(true)
    expect(assumed.ruleYear).toBe(2028)
    expect(assumed.projectionPolicy).toEqual({
      kind: 'assumed', annualRate: 0.02, fromRuleId: 'CA-ON-tax-2026-legacy-v1', fromTaxYear: 2026,
    })
    // The assumed year really is priced from the indexed ladder.
    const assumed2028 = selectPlanTaxRules({ jurisdiction: 'ON', taxYear: 2028, futureIndexation: { annualRate: 0.02 } })
    const published2026 = selectPlanTaxRules({ jurisdiction: 'ON', taxYear: 2026 })
    expect(incomeTax(120000, 'ON', undefined, assumed2028)).toBeLessThan(incomeTax(120000, 'ON', undefined, published2026))
  })

  it('replays a historical year identically however often it is selected', () => {
    const first2025 = selectTaxRules('ON', 2025)
    const first2026 = selectTaxRules('ON', 2026)
    const taxOnce = incomeTax(60_000, 'ON', undefined, selectPlanTaxRules({ jurisdiction: 'ON', taxYear: 2026 }))
    // Other selections in between must not change what an earlier year returns.
    selectTaxRules('ON', 2028, { annualRate: 0.02 })
    selectTaxRules('BC', 2026)
    selectTaxRules('ON', 2029, { annualRate: 0.05 })
    expect(selectTaxRules('ON', 2025)).toEqual(first2025)
    expect(selectTaxRules('ON', 2026)).toEqual(first2026)
    expect(incomeTax(60_000, 'ON')).toBe(taxOnce)
    // Selection depends on the jurisdiction and year alone — no clock, no mode.
    expect(selectPlanTaxRules({ jurisdiction: 'ON' })).toEqual(selectPlanTaxRules({ jurisdiction: 'ON' }))
    expect(selectPlanTaxRules({ jurisdiction: 'ON' }).taxYear).toBe(PLAN_TAX_YEAR)
  })

  it('refuses an unknown jurisdiction with a reason and never falls back to Ontario', () => {
    const refusal = trySelectPlanTaxRules({ jurisdiction: 'ZZ', taxYear: 2026 })
    expect(refusal.status).toBe('unsupported')
    if (refusal.status !== 'unsupported') return
    expect(refusal.reason).toMatch(/unknown tax jurisdiction "ZZ"/)
    expect(refusal.reason).toMatch(/published packs cover/)
    expect(refusal.reason).toContain('ON')
    // A refusal is not a substituted pack, an Ontario id or an Ontario figure.
    expect(refusal.reason).not.toMatch(/CA-ON/)
    expect(JSON.stringify(refusal)).not.toContain('CA-ON-tax')
    expect(() => selectPlanTaxRules({ jurisdiction: 'ZZ', taxYear: 2026 })).toThrow(/unknown tax jurisdiction "ZZ"/)
    expect(() => incomeTax(60_000, 'ZZ' as Province)).toThrow(/unknown tax jurisdiction "ZZ"/)
    // The canonical household tax refuses structurally rather than pricing it.
    const plan = { ...canonicalPlan(), province: 'ZZ' as Province }
    const result = calculateHouseholdTax(plan, 2026, [])
    expect(result.status).toBe('unsupported')
    if (result.status === 'unsupported') expect(result.reason).toMatch(/unknown tax jurisdiction "ZZ"/)
  })

  it('refuses an unknown or unpublished year with the reason that failed', () => {
    const past = trySelectPlanTaxRules({ jurisdiction: 'ON', taxYear: 2024 })
    expect(past.status).toBe('unsupported')
    if (past.status === 'unsupported') {
      expect(past.reason).toMatch(/no published tax rule pack for ON tax year 2024/)
      expect(past.reason).toMatch(/2025, 2026/)
    }
    // BC has no 2025 pack: the refusal names BC's published years, so a caller
    // cannot mistake it for a request answered from Ontario's 2025 pack.
    const bc25 = trySelectPlanTaxRules({ jurisdiction: 'BC', taxYear: 2025 })
    expect(bc25.status).toBe('unsupported')
    if (bc25.status === 'unsupported') {
      expect(bc25.reason).toMatch(/no published tax rule pack for BC tax year 2025/)
      expect(bc25.reason).toMatch(/published years are 2026/)
    }
    const future = trySelectPlanTaxRules({ jurisdiction: 'ON', taxYear: 2027 })
    expect(future.status).toBe('unsupported')
    if (future.status === 'unsupported') {
      expect(future.reason).toMatch(/not published for ON/)
      expect(future.reason).toMatch(/explicit future indexation rate/)
    }
    const fractional = trySelectPlanTaxRules({ jurisdiction: 'ON', taxYear: 2027.5 })
    expect(fractional.status).toBe('unsupported')
    if (fractional.status === 'unsupported') expect(fractional.reason).toMatch(/not a whole calendar year/)
    expect(() => selectPlanTaxRules({ jurisdiction: 'ON', taxYear: 2024 })).toThrow(/published/)
    expect(() => selectPlanTaxRules({ jurisdiction: 'ON', taxYear: 2027 })).toThrow(/indexation rate/)
  })

  it('blocks publication of a pack whose scope or provenance metadata is missing', () => {
    const pack = selectTaxRules('ON', 2026)
    expect(() => publishRulePack(pack)).not.toThrow()
    expect(() => publishRulePack({ ...pack, unsupportedPaths: undefined })).toThrow(/scope/i)
    expect(() => publishRulePack({ ...pack, unsupportedPaths: [{ id: 'x', reason: '' }] })).toThrow(/scope/i)
    expect(() => publishRulePack({ ...pack, unsupportedPaths: [{ id: '', reason: 'y' }] })).toThrow(/scope/i)
    expect(() => publishRulePack({ ...pack, unsupportedPaths: [{ id: 'x', reason: 'y' }, { id: 'x', reason: 'z' }] })).toThrow(/scope/i)
    expect(() => publishRulePack({ ...pack, sourceURL: '' })).toThrow(/metadata/i)
    expect(() => publishRulePack({ ...pack, effectiveDate: '' })).toThrow(/metadata/i)
    expect(() => publishRulePack({ ...pack, verifiedAt: '' })).toThrow(/metadata/i)
    expect(() => publishRulePack({ ...pack, limitation: '' })).toThrow(/metadata/i)
    expect(() => publishRulePack({ ...pack, coverage: 'assumed' as never })).toThrow(/metadata/i)
    expect(() => publishRulePack({ ...pack, indexationRule: 'guess' as never })).toThrow(/metadata/i)
    expect(() => publishRulePack({ ...pack, fieldSources: undefined })).toThrow(/scope/i)
    // An assumed pack must say which published year it was indexed from.
    const assumed = selectTaxRules('ON', 2028, { annualRate: 0.02 })
    expect(() => publishRulePack({ ...assumed, basedOnTaxYear: undefined })).toThrow(/scope/i)
    expect(() => publishRulePack({ ...assumed, basedOnTaxYear: 2029 })).toThrow(/scope/i)
  })

  it('names every participating figure the pack does not govern', () => {
    const packs = [selectTaxRules('ON', 2025), ...PROVINCES.map(province => selectTaxRules(province, 2026))]
    for (const pack of packs) {
      // Nothing in this pack is silently unpriced: each uncovered rule is named.
      expect(pack.unsupportedPaths.length).toBeGreaterThan(0)
      expect(new Set(pack.unsupportedPaths.map(path => path.id)).size).toBe(pack.unsupportedPaths.length)
      for (const path of pack.unsupportedPaths) {
        expect(path.id.trim()).not.toBe('')
        expect(path.reason.trim().length).toBeGreaterThan(20)
      }
      // Every figure the pack does govern cites an https source.
      for (const url of Object.values(pack.fieldSources)) expect(url).toMatch(/^https:\/\//)
    }
    const on = selectTaxRules('ON', 2026)
    const ids = on.unsupportedPaths.map(path => path.id)
    // The slice's out-of-scope items are declared, not half-implemented.
    for (const required of ['federal-age-pension-amounts', 'provincial-age-pension-amounts', 'spouse-credit',
      'low-income-tax-reductions', 'capital-gains-inclusion', 'probate-fees',
      'gst-hst-and-cash-benefits', 'provincial-premiums-and-levies']) expect(ids).toContain(required)
    // Ontario's surtax/health premium declaration does not travel to a
    // jurisdiction that charges neither.
    expect(selectTaxRules('AB', 2026).unsupportedPaths.map(path => path.id))
      .not.toContain('provincial-premiums-and-levies')
    expect(selectTaxRules('QC', 2026).unsupportedPaths.map(path => path.id))
      .toContain('provincial-premiums-and-levies')
  })

  it('carries the selected pack through both entry paths without a mode input', () => {
    const result = runProjection(baseInputs)
    expect(result.taxRules).toEqual({
      rulePackId: 'CA-ON-tax-2026-legacy-v1', ruleYear: 2026, assumedFutureRule: false,
      projectionPolicy: { kind: 'published' }, coverage: 'estimated',
    })
    // The canonical (person-owned) path selects the same pack and year, so a
    // guided plan and a professional plan cannot disagree about the rule year.
    const canonical = canonicalPlan()
    const household = calculateHouseholdTax(canonical, 2026, [])
    expect(household.status).toBe('ok')
    if (household.status === 'ok') {
      expect(household.rulePackId).toBe(result.taxRules!.rulePackId)
      expect(household.ruleYear).toBe(result.taxRules!.ruleYear)
      expect(household.assumedFutureRule).toBe(false)
      expect(household.projectionPolicy).toEqual({ kind: 'published' })
    }
    // The same plan priced with the canonical adapter present keeps the pack.
    expect(runProjection(baseInputs, undefined, canonical).taxRules).toEqual(result.taxRules)
  })
})
