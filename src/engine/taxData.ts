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
  /** provincial BPA phase-out: linear from `from` to `to`, down to `min` */
  bpaPhaseOut?: { from: number; to: number; min: number }
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
  MB: {
    // indexation frozen at 2024 levels through 2026; BPA phases out to zero
    // over $200k–$400k net income (2025+)
    bpa: 15780,
    bpaPhaseOut: { from: 200000, to: 400000, min: 0 },
    brackets: [
      { upTo: 47000, rate: 0.108 },
      { upTo: 100000, rate: 0.1275 },
      { upTo: Infinity, rate: 0.174 },
    ],
  },
  SK: {
    // Affordability Act adds $500/yr to the BPA (2025–2028) on top of indexing
    bpa: 20381,
    brackets: [
      { upTo: 54532, rate: 0.105 },
      { upTo: 155805, rate: 0.125 },
      { upTo: Infinity, rate: 0.145 },
    ],
  },
  NS: {
    // 2025 reform: flat BPA (the income-tested supplement was eliminated)
    bpa: 11932,
    brackets: [
      { upTo: 30995, rate: 0.0879 },
      { upTo: 61991, rate: 0.1495 },
      { upTo: 97417, rate: 0.1667 },
      { upTo: 157124, rate: 0.175 },
      { upTo: Infinity, rate: 0.21 },
    ],
  },
  NB: {
    bpa: 13664,
    brackets: [
      { upTo: 52333, rate: 0.094 },
      { upTo: 104666, rate: 0.14 },
      { upTo: 193861, rate: 0.16 },
      { upTo: Infinity, rate: 0.195 },
    ],
  },
  PE: {
    // surtax abolished 2024; the 20% bracket over $200k took effect Jan 2026
    bpa: 15000,
    brackets: [
      { upTo: 33928, rate: 0.095 },
      { upTo: 65820, rate: 0.1347 },
      { upTo: 106890, rate: 0.166 },
      { upTo: 142250, rate: 0.1762 },
      { upTo: 200000, rate: 0.19 },
      { upTo: Infinity, rate: 0.2 },
    ],
  },
  NL: {
    // 2026 budget raises the BPA $11,188 → $15,000 mid-year; $13,094 is the
    // prorated 2026 figure (TaxTips) — use $15,000 indexed from 2027
    bpa: 13094,
    brackets: [
      { upTo: 44678, rate: 0.087 },
      { upTo: 89354, rate: 0.145 },
      { upTo: 159528, rate: 0.158 },
      { upTo: 223340, rate: 0.178 },
      { upTo: 285319, rate: 0.198 },
      { upTo: 570638, rate: 0.208 },
      { upTo: 1141275, rate: 0.213 },
      { upTo: Infinity, rate: 0.218 },
    ],
  },
  YT: {
    // mirrors the federal enhanced BPA, including its phase-out
    bpa: 16452,
    bpaPhaseOut: { from: 181440, to: 258482, min: 14829 },
    brackets: [
      { upTo: 58523, rate: 0.064 },
      { upTo: 117045, rate: 0.09 },
      { upTo: 181440, rate: 0.109 },
      { upTo: 500000, rate: 0.128 }, // not indexed (tied to small-business limit)
      { upTo: Infinity, rate: 0.15 },
    ],
  },
  NT: {
    bpa: 18198,
    brackets: [
      { upTo: 53003, rate: 0.059 },
      { upTo: 106009, rate: 0.086 },
      { upTo: 172346, rate: 0.122 },
      { upTo: Infinity, rate: 0.1405 },
    ],
  },
  NU: {
    bpa: 19659,
    brackets: [
      { upTo: 55801, rate: 0.04 },
      { upTo: 111602, rate: 0.07 },
      { upTo: 181439, rate: 0.09 },
      { upTo: Infinity, rate: 0.115 },
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

/**
 * Quebec: individual contribution to the Fonds des services de santé (FSS),
 * levied on retirement income, investment income and capital gains (OAS is
 * excluded) — not just for seniors, but our engine only prices non-employment
 * income through incomeTax(), which is exactly the FSS base. 2026 figures,
 * officially confirmed (Bulletin d'information 2026-1): min($150, 1% of the
 * excess over $18,500) up to $64,355, then $150 + 1% of the excess over
 * $64,355, capped at $1,000.
 */
export const QC_FSS = { t1: 18500, t2: 64355, cap1: 150, cap2: 1000 }

/**
 * Quebec: RAMQ public prescription-drug-insurance premium, settled via the
 * tax return (Schedule K) by adults without private drug coverage — the
 * common case for FIRE'd retirees who've left an employer group plan. Per
 * person. 2026 figures approximate: CFFP's verified 2025 table ($19,890
 * threshold, $755 max) indexed +2%; RAMQ's own site did not publish the
 * exact 2026 Schedule K brackets at time of writing (see devlog).
 */
export const QC_RAMQ = { threshold: 20288, band1: 5000, rate1: 0.0784, rate2: 0.1176, max: 770 }

/** Federal age amount (65+): credit base, phased out at 15% above threshold. */
export const FED_AGE_AMOUNT = { max: 9208, threshold: 46432, rate: 0.15 }
/** Federal pension income amount (not indexed). */
export const FED_PENSION_AMOUNT = 2000

/** Provincial age & pension amounts (credited at the lowest provincial rate). */
export const PROV_AGE_PENSION: Record<
  Province,
  {
    ageMax: number
    ageThreshold: number
    ageRate: number
    pension: number
    /** SK senior supplementary amount — 65+, not income-tested */
    seniorSupplement?: number
  }
> = {
  ON: { ageMax: 6342, ageThreshold: 47210, ageRate: 0.15, pension: 1796 },
  BC: { ageMax: 5927, ageThreshold: 44119, ageRate: 0.15, pension: 1000 },
  AB: { ageMax: 6345, ageThreshold: 47234, ageRate: 0.15, pension: 1753 },
  // QC uses a combined family-tested credit (age + retirement income),
  // reduced at 18.75% of family net income above the threshold; we apply it
  // per person on their income share, which matches the engine's 50/50 split.
  QC: { ageMax: 3986, ageThreshold: 42955, ageRate: 0.1875, pension: 3541 },
  MB: { ageMax: 3728, ageThreshold: 27749, ageRate: 0.15, pension: 1000 }, // frozen
  SK: { ageMax: 5901, ageThreshold: 43927, ageRate: 0.15, pension: 1000, seniorSupplement: 2569 },
  NS: { ageMax: 5826, ageThreshold: 30828, ageRate: 0.15, pension: 1173 },
  NB: { ageMax: 6158, ageThreshold: 45844, ageRate: 0.15, pension: 1000 },
  PE: { ageMax: 6510, ageThreshold: 36600, ageRate: 0.15, pension: 1000 },
  NL: { ageMax: 7142, ageThreshold: 39138, ageRate: 0.15, pension: 1000 },
  YT: { ageMax: 9208, ageThreshold: 46432, ageRate: 0.15, pension: 2000 }, // mirrors federal
  NT: { ageMax: 8902, ageThreshold: 46432, ageRate: 0.15, pension: 1000 },
  NU: { ageMax: 12550, ageThreshold: 46432, ageRate: 0.15, pension: 2000 },
}
