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
    // surtax abolished 2024; the 20% bracket over $200k took effect Jan 2026.
    // This table is a dead export (no module imports it; `rules/` owns the
    // priced ladders), kept in step with the July 2026 T4032-PE so a future
    // import cannot silently reintroduce January's superseded $142,250.
    bpa: 15000,
    brackets: [
      { upTo: 33928, rate: 0.095 },
      { upTo: 65820, rate: 0.1347 },
      { upTo: 106890, rate: 0.166 },
      { upTo: 142520, rate: 0.1762 },
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
 * levied on Schedule F's source-specific base. The legacy incomeTax() caller
 * still approximates that base using taxable income; the person-owned Quebec
 * path calculates it from income events in quebecTax.ts. 2026 figures,
 * officially confirmed (Quebec Finance 2026 Table 3): min($150, 1% of the
 * excess over $18,500) up to $64,355, then $150 + 1% of the excess over
 * $64,355, capped at $1,000.
 */
export const QC_FSS = { t1: 18500, t2: 64355, cap1: 150, cap2: 1000 }

/**
 * Quebec: RAMQ public prescription-drug-insurance premium, settled via the
 * tax return (Schedule K) by adults without private drug coverage — the
 * common case for FIRE'd retirees who've left an employer group plan. Per
 * person. These retained values are legacy preview approximations ONLY.
 * Revenu Québec has not published the 2026 tax-year Schedule K; the
 * person-owned Quebec path gates public coverage instead of using them.
 */
export const QC_RAMQ = { threshold: 20288, band1: 5000, rate1: 0.0784, rate2: 0.1176, max: 770 }

/** One rung of a published probate step ladder: the fee that applies while the
 * probatable value is at most `upTo` (and above the preceding rung's `upTo`).
 * `bands` carries the rungs *below* the top tier, ascending, ending exactly on
 * `threshold`; where the published schedule then continues as a rate (NS, PE)
 * the `upTo` that closes the ladder is also the boundary the rate starts at. */
export interface ProbateBand {
  upTo: number
  fee: number
}
/** A jurisdiction's published probate fee. `bands` is a step ladder (AB, NT,
 * NU) and takes precedence over everything below it; a row that is a step
 * ladder *followed by* a marginal rate (NS, PE) carries both, with `flat` the
 * last printed rung and `rate` the published amount per dollar above
 * `threshold`. A row whose priced value is a step function with one boundary
 * (YT) still has the flat-plus-rate shape with `rate: 0`: the boundary is
 * `threshold`, the fee is `flat` and the step carries no rate.
 * `baseRate`/`baseUpTo` add a *second* marginal tier below `threshold` (BC
 * alone), where the published fee is a rate on the excess over one boundary up
 * to a second one rather than a single flat-plus-rate. */
export interface ProbateRate {
  flat: number
  rate: number
  threshold: number
  /** The rungs at or below `threshold`, ascending, ending exactly on it. The
   * tier above `threshold` is `flat`, so it is not repeated here. */
  bands?: readonly ProbateBand[]
  /** The marginal rate the published schedule charges on the excess over
   * `baseUpTo`, up to `threshold` — BC's Probate Fee Act s. 2(3)(a) "$6 for
   * every $1 000 or part of $1 000 by which the value of the estate exceeds
   * $25 000 but is not more than $50 000", i.e. 0.006 over $25,000. `flat` is
   * the amount that rate accumulates at `threshold`, so the lower tier meets the
   * top tier there with no step. Absent for every row whose schedule has one
   * rate. */
  baseRate?: number
  /** The boundary `baseRate` starts at. Required wherever `baseRate` is set. */
  baseUpTo?: number
  /** A fixed amount the published schedule adds on top of `flat` and the priced
   * rate, switched on at `baseUpTo` where there is a lower tier. BC's is the
   * $200 filing fee the Supreme Court Civil Rules, Appendix C, Schedule 1, item
   * 1 charges to file for a grant above $25,000 — a second instrument's figure,
   * stored apart from the Act's own accumulated $150 in `flat`. */
  surcharge?: number
}

/**
 * Probate / estate administration fees: flat + rate * max(0, value − threshold),
 * or a published step ladder (`bands`), applied to probatable assets
 * (non-registered account, unsold real estate). Registered accounts
 * (RRSP/RRIF/TFSA) bypass probate via named beneficiary designation — the norm
 * in Canada — so they're excluded from the base. 2026 figures (taxtips.ca,
 * current as of 2026-01-25). BE-38 B4 left NL and NB the only two rows still
 * simplified to a single flat + rate matching the top tier; every other row in
 * this table now prices the schedule its own instrument prints, band by band.
 *
 * BE-38 B4: NT and NU are no longer priced from Yukon's $140 filing fee. Each
 * is priced from the *full* ladder its own regulation prints, and each row in
 * `coverageMatrix.ts` cites that regulation:
 *   - NT: Court Services Fees Regulations, R-120-93, Part 2, item 1 — $30 ·
 *     $110 · $215 · $325 · $435 (top tier where the value exceeds $250,000)
 *     (`https://www.justice.gov.nt.ca/en/files/legislation/judicature/judicature.r10.pdf`).
 *   - NU: Court Fees Regulations, C.R.Nu. R-042-2021, Schedule C, item 5 — $30
 *     · $110 · $215 · $325 · $425 (top tier where the value exceeds $250,000)
 *     (`https://www.nunavutlegislation.ca/en/file-download/download/public/7022`).
 * The two instruments state identical boundaries; only the top tier differs.
 * `bands` carries the four rungs up to and including $250,000 and `flat` is the
 * tier above it, so every value the instrument covers is priced at the printed
 * amount rather than charged nothing below the boundary.
 *
 * BE-38 B4 follow-up (the YT defect this slice prices): YT was `flat: 140,
 * rate: 0, threshold: 0`, which charged $140 on *every* estate greater than
 * zero. Yukon's own authority charges nothing there. Its Supreme Court Rules,
 * Appendix C, Schedule 1 (Fees payable to Territorial Treasurer), item 11 —
 * "For every grant or ancillary grant of probate and administration ... No fee
 * is payable ... where a person dies leaving an estate not exceeding $25,000 in
 * value ... 140" — prints exactly two priced values: $0 inside the exemption
 * and $140 above it. YT is therefore the third *priced* shape in this table,
 * not a single unconditional amount, and it is `threshold: 25_000` rather than
 * 0. The TaxTips.ca table this row used to be keyed to states the same rule in
 * its own words ("If the estate is worth more than $25,000, the Supreme Court
 * charges a filing fee of $140") and is the transition source here, never an
 * authority for the figure.
 *
 * MB's zero is the published abolition of the fee, not a missing figure.
 *
 * BE-38 B4 (the BC defect this slice prices): BC was `flat: 200, rate: 0.014,
 * threshold: 50000`, which is not a ladder at all — it charged $200 on a
 * $10,000 estate that the Probate Fee Act exempts outright, skipped the
 * $25,000–$50,000 band the Act prices, and under-charged $150 above $50,000.
 * The row now carries the whole published ladder, hand-read from the two
 * instruments above (the Probate Fee Act and the Supreme Court Civil Rules'
 * Appendix C, Schedule 1, item 1), and the coverage row cites the Act that
 * carries the priced figures. Every other province remains as before.
 *
 * BE-38 B4 (the AB/NS/PE defect this slice prices): each of these three rows
 * was a top-tier-only approximation charged from the first dollar — a $10,000
 * estate paid AB $525 against $35, NS $1,003 against $85.60 and PE $400 against
 * $50. Each now prices its own instrument's ladder band by band: AB's Surrogate
 * Rules, Alta. Reg. 130/95, Sch. 2 item 1(1) (a step ladder); NS's Probate Act,
 * R.S.N.S. 1989, c. 359, s. 87(2) and PE's Probate Act, R.S.P.E.I. 1974,
 * c. P-21, s. 119.1(4) (four printed rungs to $100,000 then a printed rate).
 * Every figure is recorded in `coverageMatrix.ts`'s content-verified registry.
 */
export const PROBATE_RATES: Record<Province, ProbateRate> = {
  ON: { flat: 0, rate: 0.015, threshold: 50000 },
  // Probate Fee Act, SBC 1999, c. 4, s. 2 (bclaws.gov.bc.ca, current to
  // 2026-09-08): s. 2(2)(b) charges *no fee* where the value "does not exceed
  // $25 000"; s. 2(3)(a) charges $6 "for every $1 000 or part of $1 000" by
  // which the value exceeds $25 000 but is not more than $50 000; s. 2(3)(b)
  // charges $14 for every $1 000 above $50 000. On top of that Act fee, the
  // Supreme Court Civil Rules' Appendix C, Schedule 1, item 1 ("for commencing
  // a proceeding ... No fee is payable under this item to file for and obtain a
  // grant of probate or administration if a person dies leaving an estate that
  // does not exceed $25 000 in value ... 200") charges $200 to file for the
  // grant itself — the `surcharge`, waived at the same $25,000 the Act exempts.
  // The row this replaced was `flat: 200, rate: 0.014, threshold: 50000`: it
  // charged $200 inside the $25,000 exemption (the Law Reform sweep found
  // `probateTax(10_000, 'BC') === 200` against s. 2(2)(b)'s "no fee"), it
  // omitted the $25,000–$50,000 band entirely (s. 2(3)(a)'s $6 per $1,000), and
  // above $50,000 it under-charged by $150: the old model never added the $150
  // the s. 2(3)(a) tier accumulates at the $50,000 boundary ($6 × 25).
  //
  // The two Act tiers are modelled as two marginal rates on one row rather than
  // as `bands`, because the Act's schedule is *continuous* at $50,000: bands
  // are step fees and would have to store the accumulated total, losing the
  // published $6-per-$1,000 rate. `flat` is the $150 the Act accumulates at the
  // boundary, `surcharge` the Court Rules' $200 filing fee, `baseRate` the
  // $6-per-$1,000 the lower tier charges and `rate` the $14-per-$1,000 above it.
  BC: {
    flat: 150, rate: 14 / 1000, threshold: 50_000, surcharge: 200,
    baseRate: 6 / 1000, baseUpTo: 25_000,
  },
  // Surrogate Rules, Alta. Reg. 130/95, Schedule 2, item 1(1) — the net value of
  // property in Alberta, five printed rungs ending at "over $250 000 $525".
  // The row this replaced was `flat: 525, rate: 0, threshold: 0`, which charged
  // the top tier from the first dollar: `probateTax(10_000, 'AB')` was $525
  // against item 1(1)(a)'s "$10 000 or under $35".
  AB: {
    flat: 525, rate: 0, threshold: 250_000,
    bands: [
      { upTo: 10_000, fee: 35 }, { upTo: 25_000, fee: 135 },
      { upTo: 125_000, fee: 275 }, { upTo: 250_000, fee: 400 },
    ],
  },
  QC: { flat: 243, rate: 0, threshold: 0 }, // court will-verification fee
  MB: { flat: 0, rate: 0, threshold: 0 }, // abolished November 2020
  SK: { flat: 200, rate: 0.007, threshold: 0 },
  // Probate Act, R.S.N.S. 1989, c. 359, s. 87(2): four printed rungs up to
  // $100,000, then "$1002.65 plus an additional $16.95 for every $1,000 ...
  // in excess of $100,000". The rungs meet the rate exactly at the boundary, so
  // `flat` is s. 87(2)(d)'s $1002.65 and the four rungs are `bands`. The row this
  // replaced was `flat: 1003, rate: 0.01695, threshold: 100000`, which charged
  // $1,003 on a $10,000 estate that s. 87(2)(a) prices at $85.60.
  NS: {
    flat: 1002.65, rate: 0.01695, threshold: 100_000,
    bands: [
      { upTo: 10_000, fee: 85.6 }, { upTo: 25_000, fee: 215.2 },
      { upTo: 50_000, fee: 358.15 }, { upTo: 100_000, fee: 1002.65 },
    ],
  },
  NB: { flat: 100, rate: 0.005, threshold: 20000 },
  // Probate Act, R.S.P.E.I. 1974, c. P-21, s. 119.1(4): four printed rungs up
  // to $100,000, then "$400 plus $4 for each $1,000 or fraction thereof in
  // excess of $100,000". Same shape as NS. The row this replaced was
  // `flat: 400, rate: 0.004, threshold: 100000`, which charged $400 on a
  // $10,000 estate that s. 119.1(4) prices at $50.
  PE: {
    flat: 400, rate: 0.004, threshold: 100_000,
    bands: [
      { upTo: 10_000, fee: 50 }, { upTo: 25_000, fee: 100 },
      { upTo: 50_000, fee: 200 }, { upTo: 100_000, fee: 400 },
    ],
  },
  NL: { flat: 60, rate: 0.006, threshold: 1000 },
  // Supreme Court Rules, Appendix C, Schedule 1, item 11: $140 for every grant
  // of probate and administration, and *no fee* where the estate does not exceed
  // $25,000 in value. Two priced values, one boundary — not an unconditional
  // $140 (which is what `threshold: 0` charged).
  YT: { flat: 140, rate: 0, threshold: 25_000 },
  // R-120-93, Part 2, item 1(a)–(d) — the rungs up to $250,000 — then (e) $435.
  NT: {
    flat: 435, rate: 0, threshold: 250000,
    bands: [
      { upTo: 10_000, fee: 30 }, { upTo: 25_000, fee: 110 },
      { upTo: 125_000, fee: 215 }, { upTo: 250_000, fee: 325 },
    ],
  },
  // C.R.Nu. R-042-2021, Schedule C, item 5 table — same rungs, $425 top tier.
  NU: {
    flat: 425, rate: 0, threshold: 250000,
    bands: [
      { upTo: 10_000, fee: 30 }, { upTo: 25_000, fee: 110 },
      { upTo: 125_000, fee: 215 }, { upTo: 250_000, fee: 325 },
    ],
  },
}

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
