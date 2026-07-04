// Tax year 2026 figures, today's dollars. Update annually.
// Verified 2026-07 against CRA / TaxTips / provincial budgets (see devlog
// official-data-2025-2026). Known simplifications: no dividend
// gross-up/credit.
import type { Province } from './types'

export interface Bracket {
  upTo: number
  rate: number
}

export interface TaxTable {
  brackets: Bracket[]
  /** basic personal amount, credited at the lowest bracket rate */
  bpa: number
  /** BPA floor for high incomes (federal enhanced-BPA phase-out) */
  bpaMin?: number
}

export const FEDERAL: TaxTable = {
  // enhanced BPA phases down to bpaMin between the 4th and 5th brackets
  bpa: 16452,
  bpaMin: 14829,
  brackets: [
    { upTo: 58523, rate: 0.14 },
    { upTo: 117045, rate: 0.205 },
    { upTo: 181440, rate: 0.26 },
    { upTo: 258482, rate: 0.29 },
    { upTo: Infinity, rate: 0.33 },
  ],
}

/** Quebec residents get an abatement on basic federal tax (after credits) */
export const QC_ABATEMENT = 0.165

export const PROVINCIAL: Record<Province, TaxTable> = {
  ON: {
    bpa: 12989,
    brackets: [
      { upTo: 53891, rate: 0.0505 },
      { upTo: 107785, rate: 0.0915 },
      { upTo: 150000, rate: 0.1116 }, // not indexed
      { upTo: 220000, rate: 0.1216 }, // not indexed
      { upTo: Infinity, rate: 0.1316 },
    ],
  },
  QC: {
    bpa: 18952,
    brackets: [
      { upTo: 54345, rate: 0.14 },
      { upTo: 108680, rate: 0.19 },
      { upTo: 132245, rate: 0.24 },
      { upTo: Infinity, rate: 0.2575 },
    ],
  },
  BC: {
    bpa: 13216,
    brackets: [
      { upTo: 50363, rate: 0.056 }, // bottom rate 5.06% -> 5.60% in Budget 2026
      { upTo: 100728, rate: 0.077 },
      { upTo: 115648, rate: 0.105 },
      { upTo: 140430, rate: 0.1229 },
      { upTo: 190405, rate: 0.147 },
      { upTo: 265545, rate: 0.168 },
      { upTo: Infinity, rate: 0.205 },
    ],
  },
  AB: {
    bpa: 22769,
    brackets: [
      { upTo: 61200, rate: 0.08 },
      { upTo: 154259, rate: 0.1 },
      { upTo: 185111, rate: 0.12 },
      { upTo: 246813, rate: 0.13 },
      { upTo: 370220, rate: 0.14 },
      { upTo: Infinity, rate: 0.15 },
    ],
  },
}

// 66.67% proposal was formally cancelled 2025-03; never took effect
export const CAPITAL_GAINS_INCLUSION = 0.5

/** ON surtax: 20%/36% on Ontario basic tax above these levels (2026). */
export const ON_SURTAX = { t1: 5818, r1: 0.2, t2: 7446, r2: 0.36 }

/**
 * Ontario Health Premium by taxable income (per person, not indexed).
 * Each segment: premium = base + rate * (income - from), capped at next step.
 */
export const ON_HEALTH_PREMIUM: { from: number; base: number; rate: number; cap: number }[] = [
  { from: 20000, base: 0, rate: 0.06, cap: 300 },
  { from: 36000, base: 300, rate: 0.06, cap: 450 },
  { from: 48000, base: 450, rate: 0.25, cap: 600 },
  { from: 72000, base: 600, rate: 0.25, cap: 750 },
  { from: 200000, base: 750, rate: 0.25, cap: 900 },
]

/** Federal age amount (65+): credit base, phased out at 15% above threshold. */
export const FED_AGE_AMOUNT = { max: 9208, threshold: 46432, rate: 0.15 }
/** Federal pension income amount (not indexed). */
export const FED_PENSION_AMOUNT = 2000

/** Provincial age & pension amounts (credited at the lowest provincial rate). */
export const PROV_AGE_PENSION: Record<
  Province,
  { ageMax: number; ageThreshold: number; ageRate: number; pension: number }
> = {
  ON: { ageMax: 6342, ageThreshold: 47210, ageRate: 0.15, pension: 1796 },
  BC: { ageMax: 5927, ageThreshold: 44119, ageRate: 0.15, pension: 1000 },
  AB: { ageMax: 6345, ageThreshold: 47234, ageRate: 0.15, pension: 1753 },
  // QC uses a combined family-tested credit (age + retirement income),
  // reduced at 18.75% of family net income above the threshold; we apply it
  // per person on their income share, which matches the engine's 50/50 split.
  QC: { ageMax: 3986, ageThreshold: 42955, ageRate: 0.1875, pension: 3541 },
}
