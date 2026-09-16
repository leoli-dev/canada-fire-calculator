import { describe, expect, it } from 'vitest'
import {
  BLOCKED_SOURCES, CONTENT_VERIFIED_AUTHORITIES, COVERAGE_JURISDICTIONS, LIVE_PROBED_CITATIONS,
  coverageFor, coverageLimitationIds, coverageMatrix, coverageSummary, evidenceFixtureIds,
  matrixJurisdictions, rowAuthorities,
} from '../coverageMatrix'
import type { ImplementedCreditCoverage } from '../coverageMatrix'
import { PLAN_TAX_YEAR, incomeTax, probateTax, qcFssContribution, qcRamqPremium } from '../../tax'
import {
  CAPITAL_GAINS_INCLUSION, FED_AGE_AMOUNT, FED_PENSION_AMOUNT, ON_HEALTH_PREMIUM, ON_SURTAX,
  PROBATE_RATES, PROV_AGE_PENSION, QC_ABATEMENT, QC_FSS, QC_RAMQ, type TaxTable,
} from '../../taxData'
import { selectTaxRules, sourceResolutions } from '../index'
import { PROVINCIAL_2026_SNAPSHOT } from '../tax2026Snapshot'
import type { Province } from '../../types'

const PROVINCES: Province[] = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']
const CRA = 'https://www.canada.ca/content/dam/cra-arc/migration/cra-arc/tx/bsnss/tpcs/pyrll/t4032/2026/t4032-'
const TD1 = 'https://www.canada.ca/content/dam/cra-arc/formspubs/pbg/td1'
// The Ministry of Finance's 2026 parameters PDF at the URL the QC pack records
// in `fieldSources` (the byte-identical cdn-contenu mirror is not the pack's).
const RQ = 'https://www.finances.gouv.qc.ca/Budget_et_mise_a_jour/maj/documents/AUTFR_RegimeImpot2026.pdf'
/** The July editions this slice's rows cite, repeated here so an assertion reads
 * against the URL rather than against a row field. */
const PE_2026_JULY = 'https://www.canada.ca/content/dam/cra-arc/migration/cra-arc/tx/bsnss/tpcs/pyrll/t4032/2026/t4032-pe-7-26e.pdf'
const BC_2026_JULY = 'https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032bc-july/t4032bc-july-general-information.html'
const NL_2026_JULY = 'https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4008-payroll-deductions-supplementary-tables/t4008nl-july/t4008nl-july-general-information.html'
const CFFP_GUIDE = 'https://cffp.recherche.usherbrooke.ca/wp-content/uploads/2024/03/cr_2026_04_guide_mesures_fiscales_vf.pdf'
const PE_2026_GOV = 'https://www.princeedwardisland.ca/en/information/finance-and-affordability/provincial-personal-income-tax'

/** The two states the panel can render an authority in. `unverified` is what a
 * `contentChecked` row is forbidden to contain. */
function authorityStates(credit: ImplementedCreditCoverage): { unverified: string[] } {
  return {
    unverified: rowAuthorities(credit)
      .filter(authority => !authority.checkedFigures
        || CONTENT_VERIFIED_AUTHORITIES[authority.url]?.checkedOn !== credit.verifiedAt)
      .map(authority => authority.url),
  }
}

/**
 * BE-38 B3 review (BL1): the pack field each `ruleFields` entry prices, for the
 * fields the pack itself declares a `fieldSources` entry for. A row that prices
 * one of these must cite that URL, which is the assertion that would have caught
 * all four rows the review found pointing at an authority that does not carry
 * the priced figure.
 */
const PACK_FIELD_SOURCE: Record<string, 'federalBrackets' | 'federalBpa' | 'provincialBrackets' | 'provincialBpa'> = {
  'federal.brackets': 'federalBrackets',
  'federal.bpa': 'federalBpa',
  'provincial.brackets': 'provincialBrackets',
  'provincial.bpa': 'provincialBpa',
}

/** Chart 2 of each jurisdiction's own 2026 T4032: thresholds, rates, and the tax
 * the printed rates accumulate at every finite threshold. Hand-keyed. */
const BRACKETS: Record<string, { t: number[]; r: number[]; k: number[] }> = {
  ON: { t: [53891, 107785, 150000, 220000, Infinity], r: [0.0505, 0.0915, 0.1116, 0.1216, 0.1316], k: [2721.4955, 7652.7965, 12363.9905, 20875.9905] },
  AB: { t: [61200, 154259, 185111, 246813, 370220, Infinity], r: [0.08, 0.1, 0.12, 0.13, 0.14, 0.15], k: [4896, 14201.9, 17904.14, 25925.4, 43202.38] },
  BC: { t: [50363, 100728, 115648, 140430, 190405, 265545, Infinity], r: [0.056, 0.077, 0.105, 0.1229, 0.147, 0.168, 0.205], k: [2820.328, 6698.433, 8265.033, 11310.7408, 18657.0658, 31280.5858] },
  SK: { t: [54532, 155805, Infinity], r: [0.105, 0.125, 0.145], k: [5725.86, 18384.985] },
  NS: { t: [30995, 61991, 97417, 157124, Infinity], r: [0.0879, 0.1495, 0.1667, 0.175, 0.21], k: [2724.4605, 7358.3625, 13263.8767, 23712.6017] },
  NB: { t: [52333, 104666, 193861, Infinity], r: [0.094, 0.14, 0.16, 0.195], k: [4919.302, 12245.922, 26517.122] },
  NL: { t: [44678, 89354, 159528, 223340, 285319, 570638, 1141275, Infinity], r: [0.087, 0.145, 0.158, 0.178, 0.198, 0.208, 0.213, 0.218], k: [3886.986, 10365.006, 21452.498, 32811.034, 45082.876, 104429.228, 225974.909] },
  YT: { t: [58523, 117045, 181440, 500000, Infinity], r: [0.064, 0.09, 0.109, 0.128, 0.15], k: [3745.472, 9012.452, 16031.507, 56807.187] },
  NT: { t: [53003, 106009, 172346, Infinity], r: [0.059, 0.086, 0.122, 0.1405], k: [3127.177, 7685.693, 15778.807] },
  NU: { t: [55801, 111602, 181439, Infinity], r: [0.04, 0.07, 0.09, 0.115], k: [2232.04, 6138.11, 12423.44] },
  MB: { t: [47000, 100000, Infinity], r: [0.108, 0.1275, 0.174], k: [5076, 11833.5] },
  PE: { t: [33928, 65820, 106890, 142520, 200000, Infinity], r: [0.095, 0.1347, 0.166, 0.1762, 0.19, 0.2], k: [3223.16, 7519.0124, 14336.6324, 20614.6384, 31535.8384] },
}
const BPA: Record<string, number> = { ON: 12989, AB: 22769, BC: 13216, SK: 20381, NS: 11932,
  NB: 13664, NL: 13094, YT: 16452, NT: 18198, NU: 19659, MB: 15780, PE: 15000 }
const PENSION: Record<string, number> = { ON: 1796, AB: 1753, BC: 1000, SK: 1000, NS: 1173,
  NB: 1000, NL: 1000, YT: 2000, NT: 1000, NU: 2000, MB: 1000, PE: 1000 }
/** Each 2026 TD1's "Age amount ... between $Y and $Z" line. Every figure here
 * was read from that jurisdiction's own TD1; NL was previously held out on the
 * false premise that its form publishes no age amount. */
const AGE: Record<string, { max: number; threshold: number; end: number; supplement?: number }> = {
  ON: { max: 6342, threshold: 47210, end: 89490 }, AB: { max: 6345, threshold: 47234, end: 89534 },
  BC: { max: 5927, threshold: 44119, end: 83633 }, SK: { max: 5901, threshold: 43927, end: 83267, supplement: 2569 },
  NS: { max: 5826, threshold: 30828, end: 69668 }, NB: { max: 6158, threshold: 45844, end: 86898 },
  YT: { max: 9208, threshold: 46432, end: 107819 }, NT: { max: 8902, threshold: 46432, end: 105779 },
  NU: { max: 12550, threshold: 46432, end: 130099 }, MB: { max: 3728, threshold: 27749, end: 52602 },
  PE: { max: 6510, threshold: 36600, end: 80000 }, NL: { max: 7142, threshold: 39138, end: 86752 } }
/** The TD1 spouse line: `max` is the published amount, `threshold` where it
 * reaches zero, `low` the TD1's own start-of-reduction bound (`max + low =
 * threshold`; YT's 2,740 is an infirm-spouse top-up, not a bound). */
const SPOUSE: Record<string, { max: number; threshold: number; low?: number }> = {
  ON: { max: 11029, threshold: 12132, low: 1103 }, AB: { max: 22769, threshold: 22769 },
  BC: { max: 11317, threshold: 12449, low: 1132 }, SK: { max: 20381, threshold: 22419, low: 2038 },
  NS: { max: 11932, threshold: 12820, low: 888 }, NB: { max: 10709, threshold: 11781, low: 1072 },
  NL: { max: 9142, threshold: 10057 }, YT: { max: 16452, threshold: 16452, low: 2740 },
  NT: { max: 18198, threshold: 18198 }, NU: { max: 19659, threshold: 19659 },
  MB: { max: 9134, threshold: 9134 }, PE: { max: 12740, threshold: 14014, low: 1274 } }
const FEDERAL = { t: [58523, 117045, 181440, 258482, Infinity], r: [0.14, 0.205, 0.26, 0.29, 0.33] }
const FEDERAL_BPA = { bpa: 16452, bpaMin: 14829, from: 181440, to: 258482 }
const FEDERAL_AGE = { max: 9208, threshold: 46432, rate: 0.15, end: 107819 }
const FEDERAL_PENSION = 2000
const QUEBEC = { t: [54345, 108680, 132245, Infinity], r: [0.14, 0.19, 0.24, 0.2575], bpa: 18952 }
const QC_ABATEMENT_HAND = 0.165
/** Revenu Québec's own Line 361 figures (Quebec 2026 fiscal parameters, Table
 * 3): age 3,986, retirement income 3,541, reduction threshold 42,955, reduced
 * at the statutory 18.75% of income above it. */
const QC_AGE = { max: 3986, threshold: 42955, pension: 3541, rate: 0.1875 }
const ON_SURTAX_HAND = { t1: 5818, r1: 0.2, t2: 7446, r2: 0.36 }
const ON_HEALTH_HAND = [
  { from: 20000, base: 0, rate: 0.06, cap: 300 }, { from: 36000, base: 300, rate: 0.06, cap: 450 },
  { from: 48000, base: 450, rate: 0.25, cap: 600 }, { from: 72000, base: 600, rate: 0.25, cap: 750 },
  { from: 200000, base: 750, rate: 0.25, cap: 900 },
]
const QC_FSS_HAND = { t1: 18500, t2: 64355, cap1: 150, cap2: 1000 }
const QC_RAMQ_HAND = { threshold: 20288, band1: 5000, rate1: 0.0784, rate2: 0.1176, max: 770 }
const PROBATE_HAND: Record<string, { flat: number; rate: number; threshold: number }> = {
  ON: { flat: 0, rate: 0.015, threshold: 50000 },
  // BC is priced from the BC ladder block below rather than here: its rule is
  // the Act's two bands plus the Court Rules' filing fee, not a flat-plus-rate.
  // BE-38 B4 moved AB, NS and PE to `PROBATE_LADDER` for the same reason: each
  // is a printed step ladder (NS and PE then a marginal rate above it), so a
  // flat-plus-rate entry here would re-encode the approximation this slice
  // replaced. QC stays — one unconditional court fee — and MB is the abolished
  // zero.
  QC: { flat: 243, rate: 0, threshold: 0 },
  MB: { flat: 0, rate: 0, threshold: 0 }, SK: { flat: 200, rate: 0.007, threshold: 0 },
  NB: { flat: 100, rate: 0.005, threshold: 20000 }, NL: { flat: 60, rate: 0.006, threshold: 1000 },
  YT: { flat: 140, rate: 0, threshold: 25000 },
}
/**
 * The full ladder each jurisdiction's own instrument prints, hand-keyed with
 * every rung's fee and boundary wording. The three moved rows come from
 * `LADDERS`; NT/NU stay here. The expectations are independent of
 * `PROBATE_RATES`.
 */
/**
 * BE-38 B4 (the AB/NS/PE defect): per moved jurisdiction, the instrument, its
 * ladder rungs with the document's boundary wording, the figures as printed (so
 * "$85.60" is not compared through the number `85.6`), and the per-$1,000 rate
 * above the last rung. `sourceURL`, fixtures and expectations all derive from
 * this entry, so citation, ladder and priced value cannot drift apart. PEI's
 * *landing page* is the Radware-gated `BLOCKED_SOURCES` entry; the PDF is not.
 */
const LADDERS = {
  AB: {
    instrument: 'https://kings-printer.alberta.ca/documents/Regs/1995_130.pdf',
    literal: ['$35', '$135', '$275', '$400', '$525'],
    rate: 0, rateLiteral: 0,
    rungs: [
      { upTo: 10_000, fee: 35, phrase: '$10 000 or under' },
      { upTo: 25_000, fee: 135, phrase: 'over $10 000 but not more than $25 000' },
      { upTo: 125_000, fee: 275, phrase: 'over $25 000 but not more than $125 000' },
      { upTo: 250_000, fee: 400, phrase: 'over $125 000 but not more than $250 000' },
      { upTo: Infinity, fee: 525, phrase: 'over $250 000' },
    ],
  },
  NS: {
    instrument: 'https://nslegislature.ca/sites/default/files/legc/statutes/probate.pdf',
    literal: ['$85.60', '$215.20', '$358.15', '$1002.65'],
    rate: 16.95 / 1_000, rateLiteral: 16.95,
    rungs: [
      { upTo: 10_000, fee: 85.6, phrase: 'in estates not exceeding $10,000' },
      { upTo: 25_000, fee: 215.2, phrase: 'in estates exceeding $10,000 but not exceeding $25,000' },
      { upTo: 50_000, fee: 358.15, phrase: 'in estates exceeding $25,000 but not exceeding $50,000' },
      { upTo: 100_000, fee: 1002.65, phrase: 'in estates exceeding $50,000 but not exceeding $100,000' },
      { upTo: Infinity, fee: 1002.65, phrase: 'in estates exceeding $100,000' },
    ],
  },
  PE: {
    instrument: 'https://www.princeedwardisland.ca/sites/default/files/legislation/p-21-probate_act.pdf',
    literal: ['$50', '$100', '$200', '$400'],
    rate: 4 / 1_000, rateLiteral: 4,
    rungs: [
      { upTo: 10_000, fee: 50, phrase: 'up to $10,000' },
      { upTo: 25_000, fee: 100, phrase: '$10,001 to $25,000' },
      { upTo: 50_000, fee: 200, phrase: '$25,001 to $50,000' },
      { upTo: 100_000, fee: 400, phrase: '$50,001 to $100,000' },
      { upTo: Infinity, fee: 400, phrase: 'exceeding $100,000' },
    ],
  },
} as const

const PROBATE_LADDER: Partial<Record<string, {
  rungs: readonly { upTo: number; fee: number; phrase: string }[]
  rate: number
  rateLiteral: number
}>> = {
  // The three moved rows come from `LADDERS`, so the independent expectations and
  // the citation fixtures are the same hand-keyed figures. NT/NU stay here.
  ...Object.fromEntries(Object.entries(LADDERS).map(([province, entry]) =>
    [province, { rungs: entry.rungs, rate: entry.rate, rateLiteral: entry.rateLiteral }])),
  NT: {
    rungs: [
      { upTo: 10_000, fee: 30, phrase: '$10,000 or under' },
      { upTo: 25_000, fee: 110, phrase: 'more than $10,000 but not more than $25,000' },
      { upTo: 125_000, fee: 215, phrase: 'more than $25,000 but not more than $125,000' },
      { upTo: 250_000, fee: 325, phrase: 'more than $125,000 but not more than $250,000' },
      { upTo: Infinity, fee: 435, phrase: 'more than $250,000' },
    ],
    rate: 0, rateLiteral: 0,
  },
  NU: {
    rungs: [
      { upTo: 10_000, fee: 30, phrase: '$10,000 or under' },
      { upTo: 25_000, fee: 110, phrase: 'More than $10,000 but not more than $25,000' },
      { upTo: 125_000, fee: 215, phrase: 'More than $25,000 but not more than $125,000' },
      { upTo: 250_000, fee: 325, phrase: 'More than $125,000 but not more than $250,000' },
      { upTo: Infinity, fee: 425, phrase: 'More than $250,000' },
    ],
    rate: 0, rateLiteral: 0,
  },
}
/**
 * The hand formula the probate pins are read against, kept separate from
 * `probateTax` so the expectation is the *published* rule rather than a
 * line-for-line copy. YT is a step with no ladder (no fee to $25,000, $140
 * above it); a laddered jurisdiction (AB, NS, PE, NT, NU) comes from
 * `PROBATE_LADDER`, and NS/PE add that printed rate over the last closed rung.
 */
function handProbate(province: string, value: number): number {
  const ladder = PROBATE_LADDER[province]
  if (ladder) {
    if (value <= 0) return 0
    // `rungs` is [closed ..., closed, open]: inside a closed rung the printed fee
    // applies unchanged, past the last one the printed rate is added to `top`.
    const closed = ladder.rungs.slice(0, -1)
    const top = ladder.rungs[ladder.rungs.length - 1].fee
    for (const rung of closed) if (value <= rung.upTo) return rung.fee
    const boundary = closed[closed.length - 1].upTo
    return top + ladder.rate * (value - boundary)
  }
  // YT's wording is a step, spelled out from the sentence rather than the shape.
  if (province === 'YT') {
    if (value <= 0) return 0
    return value > 25_000 ? 140 : 0
  }
  // BC's published wording is a two-band ladder plus the Court Rules' filing
  // fee, read off the two instruments rather than off the engine's shape. The
  // Act's own rounding ("or part of $1,000") is not modelled by either the
  // engine or this expectation, so the proportional expression below is the
  // published rate applied to the excess.
  if (province === 'BC') {
    if (value <= 0) return 0
    if (value <= 25_000) return 0
    // The Court Rules' filing fee is waived at or below $25,000, so it applies
    // to everything the Act prices; the Act then charges $6 per $1,000 on the
    // excess over $25,000 (capped at the first $25,000 of excess) and $14 per
    // $1,000 on the excess over $50,000. `BC_BAND_1_RATE`/`BC_TOP_RATE` are the
    // per-$1,000 amounts, so the rate is that figure over 1,000.
    const band1 = Math.min(value, 50_000) - 25_000
    const act = (BC_BAND_1_RATE / 1_000) * band1 + (BC_TOP_RATE / 1_000) * Math.max(0, value - 50_000)
    return BC_FILING_FEE + act
  }
  const hand = PROBATE_HAND[province]
  if (value <= 0) return 0
  return hand.flat + hand.rate * Math.max(0, value - hand.threshold)
}
/** The only provincial BPA phase-outs the pack carries, and the matrix row that
 * must declare each one. A new phase-out in the snapshot fails the assertion in
 * the review suite rather than going undeclared. */
const PHASE_OUT: Partial<Record<Province, { row: string; from: number; to: number; min: number }>> = {
  MB: { row: 'manitoba-bpa-phase-out', from: 200000, to: 400000, min: 0 },
  YT: { row: 'yukon-bpa-phase-out', from: 181440, to: 258482, min: 14829 },
}

/**
 * The registry every `implemented` matrix row must name, each pointing at the
 * authority its row was keyed from. A row cannot be added without a fixture,
 * and a fixture cannot be dropped without its row noticing. The provincial ids
 * carry their jurisdiction because their authority does: the age, pension and
 * spouse figures come from that province's own TD1 (and Quebec's from its own
 * fiscal-parameters PDF), never from a shared stand-in.
 */
const FIXTURE_SOURCES: Record<string, string> = {
  'federal-brackets-2026': `${CRA}mb-1-26e.pdf`,
  'federal-bpa-and-phase-out-2026': `${TD1}/td1-26e.pdf`,
  'federal-pension-amount-2026': `${TD1}/td1-26e.pdf`,
  'federal-age-amount-2026': `${TD1}/td1-26e.pdf`,
  'federal-spouse-amount-2026': `${TD1}/td1-26e.pdf`,
  'capital-gains-inclusion-2026': 'https://laws-lois.justice.gc.ca/eng/acts/i-3.3/section-38.html',
  'ontario-surtax-2026': `${CRA}on-1-26e.pdf`,
  'ontario-health-premium-2026': `${CRA}on-1-26e.pdf`,
  'manitoba-bpa-phase-out-2026': `${CRA}mb-1-26e.pdf`,
  'yukon-bpa-phase-out-2026': `${CRA}yt-1-26e.pdf`,
  'quebec-brackets-2026': RQ,
  'quebec-bpa-2026': RQ,
  // The abatement's 16.5% is printed by the Department of Finance's 2026 report;
  // the `f-1.3` Act this fixture used to name does not exist on Justice Laws.
  'quebec-abatement-2026': 'https://www.canada.ca/content/dam/fin/publications/taxexp-depfisc/2026/taxexp-depfisc-26-eng.pdf',
  'quebec-fss-2026': RQ,
  // BE-38 B3 review (round 3, B1): the RAMQ figures are a legacy preview
  // indexed from the 2025 table, so the fixture is that table, not the 2026
  // parameters PDF the row used to cite.
  'quebec-ramq-2026': 'https://cffp.recherche.usherbrooke.ca/wp-content/uploads/2024/03/cr_2026_04_guide_mesures_fiscales_vf.pdf',
  'qc-provincial-age-amount-2026': RQ,
  'qc-provincial-pension-amount-2026': RQ,
}
/** The authority each probate figure was read from. Ontario's Estate
 * Administration Tax Act (98e34) is the statute that carries its $15-per-$1,000
 * tax over $50,000 — the Estates Administration Act (90e22) this fixture used
 * to name carries none of the row's figures. Every province is pinned from the
 * TaxTips.ca table named in `taxData.ts`.
 *
 * BE-38 B4: NT and NU are no longer priced from Yukon's $140 filing fee, so
 * their fixture is no longer Yukon's table. Each is the territory's own
 * regulation — the document that prints the $435 (NT) and $425 (NU) top tier
 * the build prices — which is also the row's `sourceURL`, so the fixture the
 * suite registers, the citation a reader sees and the priced value agree.
 *
 * BE-38 B4 follow-up: YT itself is the third row that stopped pricing from the
 * TaxTips.ca table. Its fixture is now Yukon's fee schedule, the document that
 * prints both the $140 and the $25,000 exemption boundary.
 *
 * BE-38 B4 (BC): BC is the fourth. Its fixture is the *Probate Fee Act*, the
 * document whose s. 2(2)(b)–(3)(b) prints the whole ladder the row prices; the
 * old TaxTips.ca-table fixture was the approximation this slice replaced. The
 * Court Rules item carrying the additional $200 filing fee is asserted
 * separately, so a fixture cannot stand in for a figure its own document lacks.
 *
 * BE-38 B4 (the AB/NS/PE defect): AB, NS and PE are the last three rows to
 * stop pricing from a TaxTips.ca table. Each row's fixture is now its own
 * instrument's full band ladder (Surrogate Rules Schedule 2; Probate Act
 * s. 87(2); Probate Act s. 119.1(4)), which is also the row's `sourceURL`, so a
 * fixture cannot stand in for a figure its own document lacks. Only NL and NB
 * still carry `PROBATE_TABLE`, and neither is a ladder.
 */
const PROBATE_TABLE = (province: string) =>
  `https://www.taxtips.ca/willsandestates/probatefees/${province.toLowerCase()}.htm`
/** NT's Department of Justice consolidation of the Court Services Fees
 * Regulations, R-120-93, Part 2 item 1(e): $435 where the value of the estate
 * exceeds $250,000. */
const NT_PROBATE = 'https://www.justice.gov.nt.ca/en/files/legislation/judicature/judicature.r10.pdf'
/** Nunavut's official consolidation of the Court Fees Regulations,
 * C.R.Nu. R-042-2021, Schedule C item 5: $425 where the value exceeds
 * $250,000. Recorded in `BLOCKED_SOURCES`: it answers an API request context
 * and a real headless Chromium navigation with Cloudflare's 403 challenge page.
 * The gate is User-Agent-sensitive — `curl` with its *default* UA gets 200 and
 * the PDF, while an empty UA and a Chrome UA both get 403 — so the entry keys
 * off the requests that are actually refused. */
const NU_PROBATE = 'https://www.nunavutlegislation.ca/en/file-download/download/public/7022'
/** Yukon's own tariff for probate fees: the Supreme Court Rules, Appendix C,
 * Schedule 1 (fees payable to the Territorial Treasurer), item 11. It prints
 * the two priced values this build charges — "No fee is payable ... where a
 * person dies leaving an estate not exceeding $25,000 in value" and $140 for
 * every grant or ancillary grant of probate and administration — and it is the
 * document the row's `sourceURL` and the `probate-fees-yt-2026` fixture both
 * name. The TaxTips.ca table the row used to cite is its additional source. */
const YT_PROBATE = 'https://www.yukoncourts.ca/sites/default/files/2023-08/rules_combined.pdf'
/** British Columbia's own two probate instruments, hand-keyed from the pages
 * themselves — the documents the BC row now cites, not the TaxTips.ca table it
 * was keyed to before this slice:
 *   - the *Probate Fee Act*, SBC 1999, c. 4, s. 2 (current to 2026-09-08):
 *     s. 2(2)(b) "No fee is payable under this Act ... if the value of the estate
 *     does not exceed $25 000"; s. 2(3)(a) "$6 for every $1 000 or part of
 *     $1 000 by which the value of the estate exceeds $25 000 but is not more
 *     than $50 000"; s. 2(3)(b) "$14 for every $1 000 or part of $1 000 by which
 *     the value of the estate exceeds $50 000".
 *   - the Supreme Court Civil Rules, Appendix C, Schedule 1, item 1 (as amended
 *     to B.C. Reg. 152/2025): a $200 fee for commencing the proceeding, with
 *     "No fee ... to file for and obtain a grant of probate or administration if
 *     a person dies leaving an estate that does not exceed $25 000 in value".
 *     That fee is part of what a BC executor pays, so the engine's `surcharge`
 *     prices it; pricing the Act's ladder alone would understate the total. */
const BC_PROBATE_ACT = 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/99004_01'
const BC_COURT_FEES = 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/168_2009_06'
/** The rate the Act's s. 2(3)(a) band charges per $1,000 of the excess over
 * $25,000, the rate s. 2(3)(b) charges per $1,000 above $50,000, and the Court
 * Rules' $200 filing fee — the three figures the BC expectations are built
 * from, none read back from `PROBATE_RATES`. */
const BC_BAND_1_RATE = 6
const BC_TOP_RATE = 14
const BC_FILING_FEE = 200
/** The two published rates as the per-dollar amounts an expression needs:
 * "$6 for every $1 000" is 6/1000, not 6. */
const bcBand1 = (excess: number) => (BC_BAND_1_RATE / 1_000) * excess
const bcTop = (excess: number) => (BC_TOP_RATE / 1_000) * excess
/** Ontario's probate rate and threshold, hand-keyed from `98e34` s. 2(6.1):
 * "$15 for each $1,000 or part thereof by which the value of the estate exceeds
 * $50,000", with an estate of $50,000 or less exempt. The old `90e22` citation
 * prints neither figure. */
const ON_PROBATE_STATUTE = 'https://www.ontario.ca/laws/statute/98e34'

for (const province of PROVINCES) {
  FIXTURE_SOURCES[`probate-fees-${province.toLowerCase()}-2026`] =
    province === 'ON' ? ON_PROBATE_STATUTE
      : province === 'BC' ? BC_PROBATE_ACT
        : province === 'YT' ? YT_PROBATE
          : province === 'NT' ? NT_PROBATE
            : province === 'NU' ? NU_PROBATE
              : province === 'AB' ? LADDERS.AB.instrument
                : province === 'NS' ? LADDERS.NS.instrument
                  : province === 'PE' ? LADDERS.PE.instrument : PROBATE_TABLE(province)
}
for (const province of PROVINCES) {
  if (province === 'QC') continue
  const code = province.toLowerCase()
  FIXTURE_SOURCES[`${code}-provincial-brackets-2026`] = `${CRA}${code}-1-26e.pdf`
  FIXTURE_SOURCES[`${code}-provincial-bpa-2026`] = `${CRA}${code}-1-26e.pdf`
  FIXTURE_SOURCES[`${code}-provincial-pension-amount-2026`] = `${TD1}${code}/td1${code}-26e.pdf`
  FIXTURE_SOURCES[`${code}-provincial-age-amount-2026`] = `${TD1}${code}/td1${code}-26e.pdf`
  FIXTURE_SOURCES[`${code}-provincial-spouse-amount-2026`] = `${TD1}${code}/td1${code}-26e.pdf`
}

const packTable = (p: Province): TaxTable => selectTaxRules(p, PLAN_TAX_YEAR).provincial
const thresholds = (t: TaxTable) => t.brackets.map(b => b.upTo)
const rates = (t: TaxTable) => t.brackets.map(b => b.rate)

/** The 2026 federal return from the published chart alone: CRA's own worksheet. */
function expectedFederalTax(taxable: number): number {
  const brackets: [number, number][] = [[58523, 0.14], [117045, 0.205], [181440, 0.26],
    [258482, 0.29], [Infinity, 0.33]]
  if (taxable <= 0) return 0
  let previous = 0
  let tax = 0
  for (const [upTo, rate] of brackets) {
    const slice = Math.min(taxable, upTo) - previous
    if (slice > 0) tax += slice * rate
    previous = upTo
    if (taxable <= upTo) break
  }
  const bpa = 16452 - (16452 - 14829) * Math.min(1, Math.max(0, (taxable - 181440) / 77042))
  return Math.max(0, tax - bpa * 0.14)
}

/** The tax the published chart alone produces, before every credit but the BPA. */
function bracketOnlyProvincial(province: Province, taxable: number): number {
  const table = packTable(province)
  let previous = 0
  let tax = 0
  for (const bracket of table.brackets) {
    const slice = Math.min(taxable, bracket.upTo) - previous
    if (slice > 0) tax += slice * bracket.rate
    previous = bracket.upTo
    if (taxable <= bracket.upTo) break
  }
  return Math.max(0, tax - table.bpa * table.brackets[0].rate)
}

/**
 * BE-38 B3 review (NB8): the same bracket-only line, taken from the hand-keyed
 * published charts rather than from the pack under test. A bound that reads the
 * pack can never fail, so it proves nothing; this one can.
 */
function publishedBracketOnly(province: Province, taxable: number): number {
  const table = BRACKETS[province]
  return Math.max(0, handBracketTax(table.t, table.r, taxable) - BPA[province] * table.r[0])
}

/** What one credit column is worth, measured by turning it off. */
function creditWorth(target: Record<string, unknown>, key: string, income: number,
  province: Province, credits?: Parameters<typeof incomeTax>[2]): number {
  const saved = target[key]
  const before = incomeTax(income, province, credits)
  let after: number
  try {
    target[key] = 0
    after = incomeTax(income, province, credits)
  } finally {
    target[key] = saved
  }
  return after - before
}

describe('BE-38 B3: the coverage matrix is exhaustive and drift-checked', () => {
  it('covers exactly the jurisdictions the app can price, with no extra and no missing', () => {
    expect(matrixJurisdictions()).toEqual([...COVERAGE_JURISDICTIONS])
    expect([...COVERAGE_JURISDICTIONS].sort()).toEqual([...PROVINCES].sort())
    expect([...COVERAGE_JURISDICTIONS].sort()).toEqual(Object.keys(PROVINCIAL_2026_SNAPSHOT).sort())
    expect(coverageMatrix.taxYear).toBe(PLAN_TAX_YEAR)
    for (const jurisdiction of COVERAGE_JURISDICTIONS) {
      expect(coverageFor(jurisdiction).jurisdiction).toBe(jurisdiction)
      expect(coverageFor(jurisdiction).taxYear).toBe(PLAN_TAX_YEAR)
    }
    expect(() => coverageFor('XX')).toThrow(/no coverage matrix entry for jurisdiction "XX"/)
    expect(() => coverageSummary('XX')).toThrow()
    expect(coverageSummary('MB').caveat).toBe(coverageMatrix.caveat)
  })

  it('names every unimplemented row as a negation, with a concrete reason and no completeness claim', () => {
    for (const row of coverageMatrix.jurisdictions) {
      for (const [id, credit] of Object.entries(row.unsupported)) {
        expect(id.length).toBeGreaterThan(0)
        expect(credit.scopeStatement.length, id).toBeGreaterThan(15)
        expect(credit.reason.length, id).toBeGreaterThan(40)
        expect(credit.scopeStatement, id).toMatch(/not |no |never|absent|outside/i)
        // A reason may *negate* completeness ("not a complete return"); it may
        // never assert it positively.
        const text = `${credit.reason} ${credit.scopeStatement}`
        expect(text, id).not.toMatch(/not (?:a )?complete/i)
        expect(text, id).not.toMatch(/(?<!no result )is a complete/i)
      }
      // Every jurisdiction carries the standing gaps, including the ones a
      // "tax complete" label would otherwise imply are already counted.
      for (const id of ['provincial-refundable-benefits', 'provincial-low-income-reduction',
        'provincial-other-non-refundable-credits', 'provincial-dividend-tax-credits'])
        expect(Object.keys(row.unsupported), `${row.jurisdiction}/${id}`).toContain(id)
      if (row.jurisdiction === 'QC') expect(Object.keys(row.unsupported)).toContain('provincial-spouse-amount')
      else expect(Object.keys(row.implemented)).toContain('provincial-spouse-amount')
    }
    expect(coverageMatrix.caveat).toMatch(/does not model the GST\/HST credit/)
    expect(coverageMatrix.caveat).toMatch(/complete after-benefit position/)
  })

  it('derives every implemented row from the pack, with a registered fixture and a source', () => {
    for (const jurisdiction of COVERAGE_JURISDICTIONS) {
      const pack = selectTaxRules(jurisdiction, PLAN_TAX_YEAR)
      expect(pack.jurisdiction).toBe(jurisdiction)
      expect(pack.limitation.length).toBeGreaterThan(0)
      for (const [id, credit] of Object.entries(coverageFor(jurisdiction).implemented)) {
        expect(credit.ruleFields.length, `${jurisdiction}/${id} ruleFields`).toBeGreaterThan(0)
        expect(credit.sourceURL, `${jurisdiction}/${id} source`).toMatch(/^https:\/\//)
        expect(credit.verifiedAt, `${jurisdiction}/${id} date`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(FIXTURE_SOURCES[credit.evidenceFixture], `${jurisdiction}/${id}`).toBeDefined()
        // The fixture must resolve to an authority the row itself names. This
        // is the check that catches a jurisdiction pointed at another
        // jurisdiction's form: NL's age row named Ontario's TD1.
        expect([credit.sourceURL, ...(credit.additionalSourceURLs ?? [])],
          `${jurisdiction}/${id} fixture authority`).toContain(FIXTURE_SOURCES[credit.evidenceFixture])
        // BE-38 B3 review (round 2 BL1, round 3 BL3): the row must cite the
        // authority the pack itself records for every pack field the row prices,
        // and — since round 3 — the *rendered* `sourceURL` must be exactly that
        // authority. Containment alone let the QC bracket rows show a bot-gated
        // page while the pack's own reachable parameters PDF sat unrendered in
        // `additionalSourceURLs`. The fixture check above is only
        // self-consistency; this is the one that catches a row pointing at the
        // *superseded edition* of a figure the pack actually prices — PE's
        // January chart ($142,250), BC's January 5.06%, NL's January BPA.
        const urls = [credit.sourceURL, ...(credit.additionalSourceURLs ?? [])]
        for (const field of credit.ruleFields) {
          const key = PACK_FIELD_SOURCE[field]
          if (!key) continue
          expect(credit.sourceURL, `${jurisdiction}/${id} must render the pack's own ${key} source`)
            .toBe(pack.fieldSources[key])
          for (const extra of pack.fieldAdditionalSources?.[key] ?? [])
            expect(urls, `${jurisdiction}/${id} must cite the pack's additional ${key} source`).toContain(extra)
        }
        for (const field of credit.ruleFields) {
          if (field.startsWith('provincial.')) expect(id).toMatch(/bracket|basic-personal|phase-out/)
          if (field.startsWith('federal.')) expect(credit.scope).toBe('federal')
        }
      }
    }
    // No fixture without a row, and no row without a fixture.
    const referenced = new Set<string>()
    for (const row of coverageMatrix.jurisdictions)
      for (const credit of Object.values(row.implemented)) referenced.add(credit.evidenceFixture)
    for (const id of evidenceFixtureIds()) expect(FIXTURE_SOURCES[id], `unregistered ${id}`).toBeDefined()
    for (const id of Object.keys(FIXTURE_SOURCES))
      expect(referenced.has(id), `orphan fixture ${id} is referenced by no matrix row`).toBe(true)
  })

  it('names the source each implemented row reads from, so a changed source invalidates the row', () => {
    // The matrix points at `taxData.ts:PROV_AGE_PENSION.ON.pension`; mutating
    // that constant must change a priced result, or the row describes a field
    // that never reaches a number.
    const credits = { pensionIncome: 5_000, provincialPensionIncome: 5_000 }
    const before = incomeTax(90_000, 'ON', credits)
    const saved = PROV_AGE_PENSION.ON.pension
    try {
      PROV_AGE_PENSION.ON.pension = 0
      const changed = incomeTax(90_000, 'ON', credits)
      expect(changed).not.toBe(before)
      expect(changed - before).toBeCloseTo(1796 * 0.0505, 6)
    } finally {
      PROV_AGE_PENSION.ON.pension = saved
    }
    expect(incomeTax(90_000, 'ON', credits)).toBe(before)
  })

  it('enumerates the unmapped figures the tax function applies on top of the pack', () => {
    const gaps = new Set(selectTaxRules('ON', PLAN_TAX_YEAR).unsupportedPaths.map(path => path.id))
    expect(gaps.has('gst-hst-and-cash-benefits')).toBe(true)
    expect(gaps.has('low-income-tax-reductions')).toBe(true)
    const matrix = coverageFor('ON')
    for (const id of ['provincial-low-income-reduction', 'provincial-refundable-benefits'])
      expect(matrix.unsupported[id], id).toBeDefined()
    expect(matrix.unsupported['provincial-refundable-benefits'].scopeStatement).toMatch(/not modelled/i)
    // The rows the pack calls "applied but not year-switched" are named in the
    // positive direction, with the year-switching gap as their limitation.
    expect(matrix.implemented['provincial-age-amount'].limitationId).toBe('provincialAgeAmount')
  })

  it('reproduces the published charts and credits the official amounts at the lowest rate', () => {
    for (const province of Object.keys(BRACKETS) as Province[]) {
      const expected = BRACKETS[province]
      expect(thresholds(packTable(province)), province).toEqual(expected.t)
      expect(rates(packTable(province)), province).toEqual(expected.r)
      // The tax the printed chart accumulates at every finite threshold; the
      // tolerance is one cent because every expected value is rounded there.
      const brackets = packTable(province).brackets
      let tax = 0
      expected.k.forEach((expectedTax, index) => {
        tax += (brackets[index].upTo - (index === 0 ? 0 : brackets[index - 1].upTo)) * brackets[index].rate
        expect(Math.abs(tax - expectedTax), `${province}@${index + 1}`).toBeLessThan(0.01)
      })
    }
    const federal = selectTaxRules('ON', PLAN_TAX_YEAR).federal
    expect(thresholds(federal)).toEqual(FEDERAL.t)
    expect(rates(federal)).toEqual(FEDERAL.r)
    expect([federal.bpa, federal.bpaMin, federal.brackets[2].upTo, federal.brackets[3].upTo])
      .toEqual([FEDERAL_BPA.bpa, FEDERAL_BPA.bpaMin, FEDERAL_BPA.from, FEDERAL_BPA.to])
    expect(expectedFederalTax(30_000)).toBeCloseTo(30_000 * 0.14 - 16_452 * 0.14, 6)
    const quebec = packTable('QC')
    expect(thresholds(quebec)).toEqual(QUEBEC.t)
    expect(rates(quebec)).toEqual(QUEBEC.r)
    expect(quebec.bpa).toBe(QUEBEC.bpa)
    for (const province of PROVINCES) {
      if (province === 'QC') continue
      expect(packTable(province).bpa, province).toBe(BPA[province])
    }
    expect(FED_PENSION_AMOUNT).toBe(FEDERAL_PENSION)
    expect([FED_AGE_AMOUNT.max, FED_AGE_AMOUNT.threshold, FED_AGE_AMOUNT.rate])
      .toEqual([FEDERAL_AGE.max, FEDERAL_AGE.threshold, FEDERAL_AGE.rate])
    expect(FEDERAL_AGE.threshold + FEDERAL_AGE.max / FEDERAL_AGE.rate).toBeCloseTo(FEDERAL_AGE.end, 0)
    for (const province of PROVINCES) {
      // Quebec's senior amount is one combined, family-tested credit with its
      // own published figures, checked in its own block below; every other
      // jurisdiction including NL is checked against its own TD1 here.
      if (province === 'QC') continue
      const lowest = packTable(province).brackets[0].rate
      const rule = PROV_AGE_PENSION[province]
      expect(rule.pension, `${province} pension`).toBe(PENSION[province])
      expect([rule.ageMax, rule.ageThreshold, rule.ageRate, rule.seniorSupplement], `${province} age`)
        .toEqual([AGE[province].max, AGE[province].threshold, 0.15, AGE[province].supplement])
      expect(rule.ageThreshold + rule.ageMax / rule.ageRate, `${province} window`).toBeCloseTo(AGE[province].end, -1)
      expect(creditWorth(PROV_AGE_PENSION[province], 'pension', 90_000, province,
        { pensionIncome: 5_000, provincialPensionIncome: 5_000 }), `${province} pension credit`)
        .toBeCloseTo(PENSION[province] * lowest, 6)
      const phase = Math.min(1, (50_000 - rule.ageThreshold) / (rule.ageMax / rule.ageRate))
      expect(creditWorth(PROV_AGE_PENSION[province], 'ageMax', 50_000, province, { age: 65 }), `${province} age credit`)
        .toBeCloseTo(rule.ageMax * (1 - phase) * lowest, 6)
      // The provincial spouse amount is the published threshold less the
      // spouse's net income, floored and capped; the federal amount sits on top.
      const amount = Math.min(SPOUSE[province].max, Math.max(0, SPOUSE[province].threshold - 4_000))
      expect(incomeTax(90_000, province) - incomeTax(90_000, province, { spouseNetIncome: 4_000 }),
        `${province} spouse credit`).toBeCloseTo(amount * lowest + (16_452 - 4_000) * 0.14, 6)
      expect(SPOUSE[province].threshold).toBeGreaterThanOrEqual(SPOUSE[province].max)
    }
    // Quebec's Line 361 amount, against the Ministry of Finance's own 2026
    // parameters: 3,986 of age amount and 3,541 of retirement-income amount,
    // reduced at 18.75% of income above 42,955. Both are priced below the
    // threshold, where the reduction is nil, so the expected credit is exact.
    const qc = PROV_AGE_PENSION.QC
    expect([qc.ageMax, qc.ageThreshold, qc.ageRate, qc.pension])
      .toEqual([QC_AGE.max, QC_AGE.threshold, QC_AGE.rate, QC_AGE.pension])
    expect(coverageFor('QC').implemented['provincial-age-amount'], 'QC age row').toBeDefined()
    expect(coverageFor('QC').implemented['provincial-pension-income-amount'], 'QC pension row').toBeDefined()
    expect(creditWorth(qc, 'ageMax', 40_000, 'QC', { age: 65 }), 'QC age credit')
      .toBeCloseTo(QC_AGE.max * QUEBEC.r[0], 6)
    expect(creditWorth(qc, 'pension', 40_000, 'QC',
      { age: 65, pensionIncome: 5_000, provincialPensionIncome: 5_000 }),
      'QC retirement-income credit').toBeCloseTo(Math.min(QC_AGE.pension, 5_000) * QUEBEC.r[0], 6)
    expect(ON_SURTAX).toEqual({ t1: 5818, r1: 0.2, t2: 7446, r2: 0.36 })
    expect(ON_HEALTH_PREMIUM[4]).toEqual({ from: 200000, base: 750, rate: 0.25, cap: 900 })
    expect(incomeTax(30_000, 'ON')).toBeCloseTo(
      expectedFederalTax(30_000) + 30_000 * 0.0505 - 12_989 * 0.0505 + 300, 6)
    // The surtax adds to basic Ontario tax above the published thresholds.
    expect(incomeTax(250_000, 'ON'))
      .toBeGreaterThan(expectedFederalTax(250_000) + bracketOnlyProvincial('ON', 250_000))
    expect(CAPITAL_GAINS_INCLUSION).toBe(0.5)
    expect([PROBATE_RATES.ON.rate, PROBATE_RATES.MB.rate, PROBATE_RATES.NS.rate]).toEqual([0.015, 0, 0.01695])
    expect(QC_ABATEMENT).toBe(QC_ABATEMENT_HAND)
    expect(QC_FSS).toEqual({ t1: 18500, t2: 64355, cap1: 150, cap2: 1000 })
    expect(QC_RAMQ).toEqual({ threshold: 20288, band1: 5000, rate1: 0.0784, rate2: 0.1176, max: 770 })
    expect(qcFssContribution(20_000)).toBeCloseTo(15, 6)
    expect(qcFssContribution(100_000)).toBeCloseTo(150 + (100_000 - 64_355) * 0.01, 6)
    expect(qcFssContribution(300_000)).toBeCloseTo(1000, 6)
    expect(qcRamqPremium(25_288)).toBeCloseTo(5_000 * 0.0784, 6)
    expect(qcRamqPremium(1_000_000)).toBeCloseTo(770, 6)
  })
})

describe('BE-38 B3: the two promised source conflicts are resolved', () => {
  it('resolves PE to the July 2026 T4032-PE threshold, rates and statutory top rate', () => {
    const pe = packTable('PE')
    expect(thresholds(pe)).toEqual([33928, 65820, 106890, 142520, 200000, Infinity])
    expect(thresholds(pe)).not.toContain(142250)
    expect(rates(pe)).toEqual([0.095, 0.1347, 0.166, 0.1762, 0.19, 0.2])
    // The 20% statutory rate PE enacted, never the 21% six-month prorated
    // withholding rate the July chart also prints.
    expect(pe.brackets.at(-1)!.rate).toBe(0.2)
    expect(selectTaxRules('PE', PLAN_TAX_YEAR).fieldSources.provincialBrackets).toContain('t4032-pe-7-26e')
  })

  it('prices the intended PE value and the exact delta the threshold move produces', () => {
    const tax = (brackets: { upTo: number; rate: number }[], income: number, bpa: number) => {
      let previous = 0
      let total = 0
      for (const bracket of brackets) {
        const slice = Math.min(income, bracket.upTo) - previous
        if (slice > 0) total += slice * bracket.rate
        previous = bracket.upTo
        if (income <= bracket.upTo) break
      }
      return total - bpa * brackets[0].rate
    }
    const pe = selectTaxRules('PE', PLAN_TAX_YEAR)
    // Before BE-38 B3 the pack combined January's $142,250 fourth threshold
    // with a 19% top rate. Reverting both at once isolates what the resolution
    // changed: the 270-dollar band is now taxed at 17.62% instead of 19%.
    const january = pe.provincial.brackets.map((bracket, index) =>
      index === 3 ? { ...bracket, upTo: 142250 } : index === 5 ? { ...bracket, rate: 0.19 } : bracket)
    const intended = tax(pe.provincial.brackets, 150_000, pe.provincial.bpa)
    expect(intended).toBeCloseTo(20_610.8384, 4)
    expect(tax(january, 150_000, pe.provincial.bpa) - intended).toBeCloseTo(270 * (0.19 - 0.1762), 6)
    // Below the threshold the two ladders are identical, so nothing else moved.
    expect(tax(pe.provincial.brackets, 120_000, pe.provincial.bpa))
      .toBeCloseTo(tax(january, 120_000, pe.provincial.bpa), 6)
    expect(incomeTax(150_000, 'PE')).toBeCloseTo(expectedFederalTax(150_000) + intended, 6)
  })

  it('retains the Manitoba values the dedicated T4032-MB guide and the 2026 budget publish', () => {
    const mb = packTable('MB')
    expect(thresholds(mb)).toEqual([47000, 100000, Infinity])
    expect(rates(mb)).toEqual([0.108, 0.1275, 0.174])
    expect(mb.bpa).toBe(15780)
    expect(selectTaxRules('MB', PLAN_TAX_YEAR).additionalSourceURLs).toContain(
      'https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/current-year.html')
  })

  it('records both resolutions with a governing authority and whether a number moved', () => {
    const mb = sourceResolutions.find(entry => entry.jurisdiction === 'MB')!
    const pe = sourceResolutions.find(entry => entry.jurisdiction === 'PE')!
    expect(mb.governingSourceURL).toContain('t4032-mb-1-26e')
    expect(mb.resolution).toMatch(/dedicated CRA T4032-MB/)
    expect(mb.resolution).toMatch(/\$47,564/)
    expect(mb.pricedChange).toBe('none')
    expect(pe.governingSourceURL).toContain('t4032-pe-7-26e')
    expect(pe.resolution).toMatch(/142,520/)
    expect(pe.resolution).toMatch(/20% for 2026 and subsequent years/)
    expect(pe.pricedChange).toMatch(/\$3\.726/)
    for (const entry of sourceResolutions) {
      expect(entry.governingSourceURL).toMatch(/^https:\/\//)
      expect(entry.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    // The pack notes say the same thing, and no pack still carries an open question.
    expect(selectTaxRules('MB', PLAN_TAX_YEAR).sourceConflict).toMatch(/Resolved 2026-09-15/)
    expect(selectTaxRules('MB', PLAN_TAX_YEAR).sourceConflict).toMatch(/no number changed/)
    expect(selectTaxRules('PE', PLAN_TAX_YEAR).sourceConflict).toMatch(/Resolved 2026-09-15/)
    for (const province of PROVINCES)
      expect(selectTaxRules(province, PLAN_TAX_YEAR).sourceConflict ?? '').not.toMatch(/must reconcile|awaits review/)
  })
})

describe('BE-38 B3: the declared-unimplemented items are really absent from the code path', () => {
  it('never prices a result below the published bracket arithmetic', () => {
    // BE-38 B3 review (NB8): the bound used to be built from the pack under
    // test, so it could not fail. It now comes from the hand-keyed published
    // charts above. A low-income or refundable reduction would push the result
    // below the bracket-only line; sweeping several incomes catches a phase-out
    // a single point could miss, and the phase-outs, surtax and health premium
    // only ever raise the result above this bound.
    for (const province of PROVINCES) {
      if (province === 'QC') continue
      for (const income of [15_000, 25_000, 40_000, 60_000, 120_000]) {
        expect(incomeTax(income, province), `${province}@${income}`)
          .toBeGreaterThanOrEqual(expectedFederalTax(income) + publishedBracketOnly(province, income) - 1e-6)
      }
    }
    // The bound is not vacuous: at 25,000 Ontario's own bracket arithmetic is
    // strictly below the result the engine returns, by the health premium alone.
    expect(publishedBracketOnly('ON', 15_000)).toBeCloseTo((15_000 - 12_989) * 0.0505, 6)
    expect(incomeTax(25_000, 'ON') - expectedFederalTax(25_000))
      .toBeGreaterThan(publishedBracketOnly('ON', 25_000) + 1e-6)
  })

  it('does not apply Ontario\u2019s tax reduction or Alberta\u2019s supplemental credit', () => {
    // T4032-ON and T4032-AB both publish a low-income reduction in their worked
    // examples. At 20,000 the result is exactly the federal return plus the
    // province's own published bracket arithmetic.
    expect(incomeTax(20_000, 'ON')).toBeCloseTo(
      expectedFederalTax(20_000) + 20_000 * 0.0505 - 12_989 * 0.0505, 6)
    // Alberta's 8% bracket tax on 30,000 is 2,400 and its 22,769 credit is worth
    // 1,821.52, so the provincial side is 578.48 with nothing subtracted.
    expect(incomeTax(30_000, 'AB')).toBeCloseTo(expectedFederalTax(30_000) + 2_400 - 1_821.52, 6)
    // Above the point where the basic personal amount stops absorbing the tax,
    // the marginal delta is the published 8% provincial plus 14% federal.
    expect(incomeTax(50_000, 'AB') - incomeTax(46_000, 'AB')).toBeCloseTo(4_000 * (0.08 + 0.14), 6)
    expect(bracketOnlyProvincial('AB', 50_000) - bracketOnlyProvincial('AB', 46_000))
      .toBeCloseTo(4_000 * 0.08, 6)
  })

  it('adds no provincial cash benefit and prices the reduction as absent, not as zero', () => {
    for (const province of PROVINCES) {
      const row = coverageFor(province)
      for (const id of ['provincial-refundable-benefits', 'provincial-other-non-refundable-credits',
        'provincial-dividend-tax-credits', 'provincial-low-income-reduction'])
        expect(row.unsupported[id], `${province}/${id}`).toBeDefined()
      expect(row.implemented['provincial-low-income-reduction'], province).toBeUndefined()
      expect(row.unsupported['provincial-low-income-reduction'].scopeStatement).toMatch(/not applied/)
      expect(row.unsupported['provincial-refundable-benefits'].reason, province)
        .toMatch(/no provincial cash-benefit program/i)
    }
    // British Columbia names its reduction with the published amount and the
    // rate change the same budget made, so the reason is not generic.
    expect(coverageFor('BC').unsupported['british-columbia-tax-reduction'].scopeStatement)
      .toMatch(/\$690|prorated|withdrawn/)
  })
})

// ---------------------------------------------------------------------------
// Review fix (B2): a declared status is only worth publishing if the pricing
// code agrees with it. The review found Quebec's age/retirement amount declared
// `unsupported` while `tax.ts` subtracted it, and the drift test could not see
// it because both QC loops skipped the province. This block reconciles every
// jurisdiction against the matrix's own declarations in both directions.
// ---------------------------------------------------------------------------

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** Bracket tax from a hand-keyed ladder — never from the pack under test. */
function handBracketTax(brackets: number[], rates: number[], income: number): number {
  let tax = 0
  let previous = 0
  for (let index = 0; index < brackets.length; index += 1) {
    const slice = Math.min(income, brackets[index]) - previous
    if (slice > 0) tax += slice * rates[index]
    previous = brackets[index]
    if (income <= brackets[index]) break
  }
  return tax
}

function handEnhancedBpa(taxable: number): number {
  return FEDERAL_BPA.bpa - (FEDERAL_BPA.bpa - FEDERAL_BPA.bpaMin)
    * clamp01((taxable - FEDERAL_BPA.from) / (FEDERAL_BPA.to - FEDERAL_BPA.from))
}

function handHealthPremium(income: number): number {
  let premium = 0
  for (const segment of ON_HEALTH_HAND)
    if (income > segment.from)
      premium = Math.min(segment.cap, segment.base + segment.rate * (income - segment.from))
  return premium
}

function handFss(income: number): number {
  const { t1, t2, cap1, cap2 } = QC_FSS_HAND
  if (income <= t1) return 0
  if (income <= t2) return Math.min(cap1, (income - t1) * 0.01)
  return Math.min(cap2, cap1 + (income - t2) * 0.01)
}

function handRamq(income: number): number {
  const { threshold, band1, rate1, rate2, max } = QC_RAMQ_HAND
  const excess = Math.max(0, income - threshold)
  return excess <= band1 ? excess * rate1 : Math.min(max, band1 * rate1 + (excess - band1) * rate2)
}

/**
 * What the matrix's own declarations imply the tax should be, hand-keyed from
 * the authorities the rows cite. A row declared `unsupported` contributes
 * nothing; a row declared `implemented` must be present. `incomeTax` is then
 * required to agree, which turns a mis-declared status into a failure in either
 * direction: a credit the matrix hides but the engine applies leaves the engine
 * cheaper than declared, and a credit the matrix claims but the engine ignores
 * leaves it dearer.
 */
function declaredOnlyTax(province: Province, taxable: number,
  credits: Parameters<typeof incomeTax>[2]): number {
  const has = (id: string) => coverageFor(province).implemented[id] !== undefined
  const senior = (credits?.age ?? 0) >= 65
  const pensionIncome = credits?.pensionIncome ?? 0
  const provincialPension = credits?.provincialPensionIncome ?? pensionIncome
  let expected = 0

  if (has('federal-income-tax-brackets')) {
    let credit = 0
    if (has('federal-basic-personal-amount')) credit += handEnhancedBpa(taxable) * 0.14
    if (has('federal-pension-income-amount')) credit += Math.min(FEDERAL_PENSION, pensionIncome) * 0.14
    if (has('federal-spouse-amount') && credits?.spouseNetIncome !== undefined)
      credit += Math.max(0, handEnhancedBpa(taxable) - Math.max(0, credits.spouseNetIncome)) * 0.14
    if (has('federal-age-amount') && senior)
      credit += Math.max(0, FEDERAL_AGE.max
        - FEDERAL_AGE.rate * Math.max(0, taxable - FEDERAL_AGE.threshold)) * 0.14
    let federal = Math.max(0, handBracketTax(FEDERAL.t, FEDERAL.r, taxable) - credit)
    if (province === 'QC' && has('quebec-federal-abatement')) federal *= 1 - QC_ABATEMENT_HAND
    expected += federal
  }

  const lowest = province === 'QC' ? QUEBEC.r[0] : BRACKETS[province].r[0]
  let credit = 0
  if (province === 'QC') {
    if (has('quebec-basic-personal-amount')) credit += QUEBEC.bpa * lowest
    if (senior && has('provincial-age-amount')) {
      const combined = QC_AGE.max
        + (has('provincial-pension-income-amount') ? Math.min(QC_AGE.pension, pensionIncome) : 0)
      credit += Math.max(0, combined - QC_AGE.rate * Math.max(0, taxable - QC_AGE.threshold)) * lowest
    }
  } else {
    if (has('provincial-basic-personal-amount')) {
      const phase = PHASE_OUT[province]
      credit += (phase && has(phase.row)
        ? BPA[province] - (BPA[province] - phase.min) * clamp01((taxable - phase.from) / (phase.to - phase.from))
        : BPA[province]) * lowest
    }
    if (has('provincial-pension-income-amount'))
      credit += Math.min(PENSION[province], provincialPension) * lowest
    if (has('provincial-spouse-amount') && credits?.spouseNetIncome !== undefined)
      credit += Math.min(SPOUSE[province].max,
        Math.max(0, SPOUSE[province].threshold - credits.spouseNetIncome)) * lowest
    if (has('provincial-age-amount') && senior) {
      credit += (AGE[province].supplement ?? 0) * lowest
      credit += Math.max(0, AGE[province].max - 0.15 * Math.max(0, taxable - AGE[province].threshold)) * lowest
    }
  }
  const brackets = province === 'QC' ? QUEBEC : BRACKETS[province]
  let provincial = Math.max(0, handBracketTax(brackets.t, brackets.r, taxable) - credit)
  if (province === 'ON') {
    if (has('ontario-surtax'))
      provincial += Math.max(0, provincial - ON_SURTAX_HAND.t1) * ON_SURTAX_HAND.r1
        + Math.max(0, provincial - ON_SURTAX_HAND.t2) * ON_SURTAX_HAND.r2
    if (has('ontario-health-premium')) provincial += handHealthPremium(taxable)
  }
  if (province === 'QC') {
    if (has('quebec-fss-contribution')) provincial += handFss(taxable)
    if (has('quebec-ramq-premium')) provincial += handRamq(taxable)
  }
  return expected + provincial
}

/** Incomes that exercise the low-income floor, both phase-outs, the surtax,
 *  the health premium and the Quebec levies, with and without each credit. */
const PROBES: { income: number; credits: Parameters<typeof incomeTax>[2] }[] = [
  { income: 15_000, credits: undefined },
  { income: 25_000, credits: { age: 65 } },
  { income: 30_000, credits: undefined },
  { income: 60_000, credits: { age: 70, pensionIncome: 5_000, provincialPensionIncome: 5_000 } },
  { income: 90_000, credits: { pensionIncome: 5_000, provincialPensionIncome: 5_000 } },
  { income: 90_000, credits: { spouseNetIncome: 4_000 } },
  { income: 130_000, credits: { age: 65, pensionIncome: 2_000, provincialPensionIncome: 2_000, spouseNetIncome: 3_000 } },
  { income: 250_000, credits: { age: 70 } },
  { income: 300_000, credits: undefined },
]

describe('BE-38 B3 review: every declared status is verified against the pricing code', () => {
  it('prices exactly the credits the matrix declares implemented, in all 13 jurisdictions', () => {
    for (const province of PROVINCES) {
      const carries = packTable(province).bpaPhaseOut !== undefined
      // Every phase-out the pack carries is a declared row the hand model
      // applies, and no other province may claim one: a new phase-out fails
      // here rather than going undeclared (the review's YT finding).
      expect(carries, `${province} carries a phase-out`).toBe(PHASE_OUT[province] !== undefined)
      if (PHASE_OUT[province])
        expect(coverageFor(province).implemented[PHASE_OUT[province]!.row], `${province} phase-out row`).toBeDefined()
    }
    for (const province of PROVINCES) {
      for (const probe of PROBES) {
        expect(incomeTax(probe.income, province, probe.credits), `${province}@${probe.income}`)
          .toBeCloseTo(declaredOnlyTax(province, probe.income, probe.credits), 6)
      }
    }
  })

  it('declares Quebec\u2019s senior credit implemented, at the price the code charges', () => {
    // The exact B2 regression. The engine subtracts a combined age +
    // retirement-income credit for Quebec; the expected delta below is
    // hand-keyed from the Ministry of Finance figures, not read from `tax.ts`.
    const federalSenior = (Math.max(0, FEDERAL_AGE.max
      - FEDERAL_AGE.rate * (60_000 - FEDERAL_AGE.threshold)) + Math.min(FEDERAL_PENSION, 5_000))
      * 0.14 * (1 - QC_ABATEMENT_HAND)
    const quebecSenior = Math.max(0, QC_AGE.max + Math.min(QC_AGE.pension, 5_000)
      - QC_AGE.rate * (60_000 - QC_AGE.threshold)) * QUEBEC.r[0]
    const credits = { age: 70, pensionIncome: 5_000, provincialPensionIncome: 5_000 }
    expect(incomeTax(60_000, 'QC') - incomeTax(60_000, 'QC', credits))
      .toBeCloseTo(federalSenior + quebecSenior, 6)
    // The panel may no longer tell a Quebec senior that this credit is excluded.
    const row = coverageFor('QC')
    expect(Object.keys(row.unsupported)).not.toContain('quebec-senior-amount')
    expect(row.unsupported['provincial-age-pension-amounts'].scopeStatement).not.toMatch(/not applied per person/)
    expect(row.implemented['provincial-age-amount']).toBeDefined()
    expect(row.implemented['provincial-pension-income-amount']).toBeDefined()
    // Quebec's own spouse amount stays unsupported and really is not applied,
    // even though the federal spouse amount on top of it is.
    expect(row.unsupported['provincial-spouse-amount']).toBeDefined()
    expect(incomeTax(90_000, 'QC', { spouseNetIncome: 4_000 }))
      .toBeCloseTo(incomeTax(90_000, 'QC') - (FEDERAL_BPA.bpa - 4_000) * 0.14 * (1 - QC_ABATEMENT_HAND), 6)
  })

  it('gives every declared id a reconciliation or its own pin, so no status is unproven', () => {
    const reconciled = new Set([
      'federal-income-tax-brackets', 'federal-basic-personal-amount', 'federal-pension-income-amount',
      'federal-age-amount', 'federal-spouse-amount', 'quebec-federal-abatement',
      'quebec-income-tax-brackets', 'quebec-basic-personal-amount',
      'provincial-income-tax-brackets', 'provincial-basic-personal-amount',
      'provincial-pension-income-amount', 'provincial-age-amount', 'provincial-spouse-amount',
      'manitoba-bpa-phase-out', 'yukon-bpa-phase-out', 'ontario-surtax', 'ontario-health-premium',
      'quebec-fss-contribution', 'quebec-ramq-premium',
    ])
    const pinnedSeparately = new Set(['capital-gains-inclusion-rate', 'probate-and-estate-fees'])
    for (const jurisdiction of COVERAGE_JURISDICTIONS)
      for (const id of Object.keys(coverageFor(jurisdiction).implemented))
        expect(reconciled.has(id) || pinnedSeparately.has(id), `${jurisdiction}/${id} has no status proof`).toBe(true)
    expect(CAPITAL_GAINS_INCLUSION).toBe(0.5)
    for (const province of PROVINCES) {
      expect(probateTax(200_000, province), `${province} probate`)
        .toBeCloseTo(handProbate(province, 200_000), 6)
    }
    // BE-38 B3 review (NB5): the shared probate pin is vacuous for the one
    // jurisdiction priced at zero, so the zero is pinned to its reason and to
    // the disclosure instead of being left as an unprovable `0 ≈ 0`. Manitoba
    // abolished the fee in 2020, so zero is the correct price, not a gap. A
    // laddered jurisdiction (NT, NU) has no `PROBATE_HAND` entry, so it is
    // excluded from this filter rather than read as `undefined`. BC is shaped
    // by `PROBATE_RATES.BC.baseRate` rather than by a `bands` ladder, so it is
    // excluded by its own `PROBATE_HAND` absence and pinned in its own suite.
    const zeroPriced = PROVINCES.filter(province => !PROBATE_LADDER[province]
      && PROBATE_HAND[province]?.flat === 0 && PROBATE_HAND[province]?.rate === 0)
    expect(zeroPriced).toEqual(['MB'])
    expect(PROBATE_RATES.MB).toEqual({ flat: 0, rate: 0, threshold: 0 })
    expect(probateTax(200_000, 'MB'), 'MB abolishes probate, so the pin is the disclosure').toBe(0)
    expect(coverageFor('MB').implemented['probate-and-estate-fees'].limitationId).toBe('probateFeesMB')
    // Every other jurisdiction's fee is non-zero at 200,000, so the shared row
    // is demonstrably priced rather than zero everywhere. BE-38 B4 review B1:
    // NT and NU used to be zero at 200,000; they are now priced at their own
    // instrument's $325 middle band, so the value is pinned like every other
    // province's rather than special-cased to the boundary.
    for (const province of PROVINCES) {
      if (province === 'MB') continue
      expect(Math.abs(probateTax(200_000, province)), `${province} is priced`).toBeGreaterThan(0)
    }
    // Quebec pays the federal ladder too, so that row is declared for it as
    // well; dropping it was the one other declared-status drift the audit found.
    for (const jurisdiction of COVERAGE_JURISDICTIONS)
      expect(coverageFor(jurisdiction).implemented['federal-income-tax-brackets'], jurisdiction).toBeDefined()
  })

  it('cites the probate authority each jurisdiction\u2019s pinned figure was read from', () => {
    // BE-38 B3 review (NB6): one Ontario fixture used to cover all thirteen
    // jurisdictions. `taxData.ts` reads the figures from the TaxTips.ca table
    // named per jurisdiction, so each row now cites its own.
    const table = (province: string) =>
      `https://www.taxtips.ca/willsandestates/probatefees/${province.toLowerCase()}.htm`
    for (const province of PROVINCES) {
      const row = coverageFor(province).implemented['probate-and-estate-fees']
      expect(row, province).toBeDefined()
      const urls = [row.sourceURL, ...(row.additionalSourceURLs ?? [])]
      if (province === 'ON') {
        // Ontario's Estate Administration Tax Act is the authority carrying its
        // 1.5% rate ($15 per $1,000 above $50,000). BE-38 B3 review (round 4,
        // B1): this assertion used to pin `90e22`, the Estates Administration
        // Act, which prints none of the row's figures.
        expect(row.sourceURL).toBe(ON_PROBATE_STATUTE)
        expect(urls).toContain(table('ON'))
        expect(row.contentChecked, 'ON probate must be content-checked, not merely listed').toBe(true)
      } else if (province === 'NT' || province === 'NU') {
        // BE-38 B4: these used to price Yukon's $140 flat filing fee and cite
        // Yukon's table for it, so the citation named a document that did not
        // carry the priced value. Each now cites the territory's own regulation
        // — the document that prints the $435 / $425 top tier `taxData.ts`
        // prices — and is content-checked against it. The tier ladder this
        // build still simplifies to its top tier stays disclosed through the
        // rendered `limitationId`; `solverMessages.test.ts` pins that prose.
        expect(row.sourceURL, `${province} cites its own regulation`).toBe(province === 'NT' ? NT_PROBATE : NU_PROBATE)
        expect(urls, `${province} also lists its TaxTips.ca table`).toContain(table(province))
        expect(urls, `${province} no longer evidences Yukon's fee`).not.toContain(table('YT'))
        expect(row.contentChecked, `${province} probate must be content-checked`).toBe(true)
        expect(row.verifiedAt, `${province} checked date`).toBe(
          CONTENT_VERIFIED_AUTHORITIES[province === 'NT' ? NT_PROBATE : NU_PROBATE].checkedOn)
        expect(row.limitationId, province).toBe(province === 'NT' ? 'probateFeesApproxNT' : 'probateFeesApproxNU')
      } else if (province === 'AB' || province === 'NS' || province === 'PE') {
        // BE-38 B4 (the AB/NS/PE defect): each of these three rows used to cite
        // its TaxTips.ca table for a single top-tier flat amount. Each now cites
        // its own instrument's band ladder — the document that prints the exact
        // fees `taxData.ts` charges, first rung included — and is content-checked
        // against it, so dropping a band from the registry fails the ladder test.
        expect(row.sourceURL, `${province} cites its own instrument`).toBe(
          province === 'AB' ? LADDERS.AB.instrument : province === 'NS' ? LADDERS.NS.instrument : LADDERS.PE.instrument)
        expect(urls, `${province} also lists its TaxTips.ca table`).toContain(table(province))
        expect(row.contentChecked, `${province} probate must be content-checked`).toBe(true)
        expect(row.verifiedAt, `${province} checked date`).toBe(
          CONTENT_VERIFIED_AUTHORITIES[row.sourceURL].checkedOn)
        expect(row.limitationId, `${province} names its own limitation`).toBe(`probateFees${province}`)
      } else if (province === 'YT') {
        // BE-38 B4 follow-up: YT used to cite its TaxTips.ca table for an
        // unconditional $140, which is not what the cited rule prints. It now
        // cites Yukon's Supreme Court Rules' fee schedule — the document whose
        // item 11 prints both the $140 and the $25,000 exemption — and is
        // content-checked against it, with its own limitation id rather than the
        // generic one that lists the provinces this build simplifies.
        expect(row.sourceURL, 'YT cites its own fee schedule').toBe(YT_PROBATE)
        expect(urls, 'YT also lists its TaxTips.ca table').toContain(table('YT'))
        expect(row.contentChecked, 'YT probate must be content-checked').toBe(true)
        expect(row.verifiedAt, 'YT checked date').toBe(CONTENT_VERIFIED_AUTHORITIES[YT_PROBATE].checkedOn)
        expect(row.limitationId, 'YT names its own limitation').toBe('probateFeesYT')
      } else if (province === 'BC') {
        // BE-38 B4 (the BC defect): the row used to cite its TaxTips.ca table
        // for a flat $200 + 1.4% that no instrument prints. It now cites the
        // *Probate Fee Act*, whose s. 2(2)(b)–(3)(b) prints the whole ladder the
        // engine prices, and lists the Supreme Court Civil Rules item that
        // carries the $200 filing fee it adds, so both priced figures have a
        // rendered authority. The TaxTips.ca table stays as a third, additional
        // source rather than as the citation.
        expect(row.sourceURL, 'BC cites the Act that prints its ladder').toBe(BC_PROBATE_ACT)
        expect(urls, 'BC also lists the Court Rules filing-fee item').toContain(BC_COURT_FEES)
        expect(urls, 'BC also lists its TaxTips.ca table').toContain(table('BC'))
        expect(row.contentChecked, 'BC probate must be content-checked').toBe(true)
        expect(row.verifiedAt, 'BC checked date').toBe(CONTENT_VERIFIED_AUTHORITIES[BC_PROBATE_ACT].checkedOn)
        expect(row.limitationId, 'BC names its own limitation').toBe('probateFeesBC')
      } else {
        expect(row.sourceURL, province).toBe(table(province))
        // BE-38 B4 follow-up: NB is the one table row with its own limitation,
        // because it prices a schedule repealed in 2026 and must disclose it.
        expect(row.limitationId, province)
          .toBe(province === 'MB' ? 'probateFeesMB' : province === 'NB' ? 'probateFeesNB' : 'probateFees')
      }
      expect(row.limitationId, `${province} names the table`).toBeTruthy()
    }
  })
})

describe('BE-38 B4: the territories are priced from their own published fees', () => {
  const TERRITORIES = ['NT', 'NU'] as const
  const BOUNDARY = 250_000
  /** The top tier each territory's own regulation prints above $250,000,
   * hand-keyed from the document itself — not read back from `PROBATE_RATES`,
   * whose value is the thing under test:
   *   - NT: Court Services Fees Regulations R-120-93, Part 2 item 1(e) — $435
   *     (https://www.justice.gov.nt.ca/en/files/legislation/judicature/judicature.r10.pdf)
   *   - NU: Court Fees Regulations C.R.Nu. R-042-2021, Schedule C item 5 — $425
   *     (https://www.nunavutlegislation.ca/en/file-download/download/public/7022)
   * The published boundary is "more than $250,000" in both documents, so
   * $250,000 itself falls in the preceding tier and is charged $325. */
  const TOP_TIER = { NT: 435, NU: 425 } as const

  it('prices every band both instruments print, on both sides of every boundary', () => {
    // BE-38 B4 review B1: the priced value is the instrument's own ladder, not
    // its top tier alone. A missing or one-rung-shifted band fails here.
    for (const province of TERRITORIES) {
      const ladder = PROBATE_LADDER[province]!.rungs
      expect(ladder.map(rung => [rung.upTo, rung.fee])).toEqual([
        [10_000, 30], [25_000, 110], [125_000, 215], [250_000, 325], [Infinity, TOP_TIER[province]],
      ])
      // The implementation carries the same ladder, in the same shape: `bands`
      // is the four rungs at or below the boundary and `flat` is the top tier.
      expect(PROBATE_RATES[province], `${province} pinned rule`).toEqual({
        flat: TOP_TIER[province], rate: 0, threshold: BOUNDARY,
        bands: ladder.slice(0, -1).map(rung => ({ upTo: rung.upTo, fee: rung.fee })),
      })
      for (const [index, rung] of ladder.entries()) {
        const previous = index === 0 ? 0 : ladder[index - 1].upTo
        // Both ends of every band: just above the rung below, and at this
        // band's own inclusive upper bound (the open top band has no finite
        // upper bound, so only its lower end is a boundary).
        expect(probateTax(previous + 1, province), `${province} ${rung.phrase} (lower end)`).toBe(rung.fee)
        if (Number.isFinite(rung.upTo))
          expect(probateTax(rung.upTo, province), `${province} ${rung.phrase} (upper end)`).toBe(rung.fee)
      }
      // ...and the hand expectation, read off the instrument, agrees band for
      // band rather than reproducing the implementation's branch (review N2).
      for (const value of [1, 10_000, 10_001, 25_000, 25_001, 125_000, 125_001, 200_000, 250_000, 250_001, 50_000_000])
        expect(probateTax(value, province), `${province} at ${value}`)
          .toBeCloseTo(handProbate(province, value), 6)
      // Above the top band the fee is a flat amount, not a rate.
      expect(probateTax(BOUNDARY + 1, province), `${province} just above the boundary`).toBe(TOP_TIER[province])
      expect(probateTax(1_000_000, province), `${province} at $1M`).toBe(TOP_TIER[province])
      expect(probateTax(50_000_000, province), `${province} far above the boundary`).toBe(TOP_TIER[province])
      // An estate with nothing probatable is still free; a laddered row never
      // prices an unknown as 0 and never a 0 as unknown.
      expect(probateTax(0, province), `${province} zero estate`).toBe(0)
    }
  })

  it('holds the cited authority\'s recorded figures equal to the priced ladder (review N1)', () => {
    // BE-38 B3's pack-source equality check skips probate rows: their
    // `ruleFields` is `taxData.ts:PROBATE_RATES`, which has no
    // `PACK_FIELD_SOURCE` key, so the loop `continue`d. The review proved the
    // gap by deleting `$30/$110/$215/$325` from the registry and watching every
    // test pass. This is the equality the review asked for: the fee figures the
    // registry records for each row's *cited authority* must be exactly the
    // ladder the engine prices — no more, no fewer — and the boundary wording
    // must be recorded too, so a future drift in either direction fails.
    for (const province of TERRITORIES) {
      const row = coverageFor(province).implemented['probate-and-estate-fees']
      expect(row.sourceURL, `${province} source`).toBe(province === 'NT' ? NT_PROBATE : NU_PROBATE)
      const record = CONTENT_VERIFIED_AUTHORITIES[row.sourceURL]
      expect(record, `${province} cited authority must be content-checked`).toBeDefined()
      expect(record.checkedOn, `${province} checked date`).toBe(row.verifiedAt)
      const ladder = PROBATE_LADDER[province]!.rungs
      // The record carries the five printed fees, the open top rung included.
      const pricedFees = ladder.map(rung => `$${rung.fee}`)
      expect(record.checkedFigures.filter(figure => /^\$[\d,]+$/.test(figure)),
        `${province} citation must carry exactly the priced ladder`).toEqual(pricedFees)
      for (const rung of ladder)
        expect(record.checkedFigures, `${province} must record "${rung.phrase}"`).toContain(rung.phrase)
    }
  })

  it('leaves every other jurisdiction, including the already-correct ON control, untouched', () => {
    // The confinement check the priced sweep in the PR repeats end to end: ON's
    // Estate Administration Tax is the control — 1.5% of the value over
    // $50,000 — and AB's and QC's unconditional flat fees pin the other shape
    // the shared `probateTax` expression has to keep serving.
    expect(probateTax(1_000_000, 'ON')).toBeCloseTo((1_000_000 - 50_000) * 0.015, 6)
    expect(probateTax(200_000, 'ON')).toBeCloseTo((200_000 - 50_000) * 0.015, 6)
    expect(PROBATE_RATES.ON).toEqual({ flat: 0, rate: 0.015, threshold: 50_000 })
    expect(probateTax(30_000_000, 'AB')).toBe(525)
    expect(probateTax(2_000_000, 'QC')).toBe(243)
    expect(probateTax(2_000_000, 'MB')).toBe(0)
    // Yukon keeps its own $140 filing fee now that it is no longer lent out,
    // and the fee it charges inside the published exemption is exactly zero.
    expect(PROBATE_RATES.YT).toEqual({ flat: 140, rate: 0, threshold: 25_000 })
    expect(probateTax(1_000_000, 'YT')).toBe(140)
  })
})

describe('BE-38 B4 follow-up: Yukon is priced from its own fee schedule, not an unconditional $140', () => {
  /** The two priced values Yukon's Supreme Court Rules, Appendix C, Schedule 1,
   * item 11 prints, hand-keyed from the instrument — not read back from
   * `PROBATE_RATES`, whose value is the thing under test:
   *
   *   "For every grant or ancillary grant of probate and administration, and on
   *    every resealing of an extra-territorial grant of probate or
   *    administration. No fee is payable to obtain a grant of probate and
   *    administration where a person dies leaving an estate not exceeding
   *    $25,000 in value ... 140"
   *
   * The fee is a step, not a rate: the boundary "$25,000" is *inclusive* of the
   * exemption, so $25,000 itself is charged nothing and only a value above it is
   * charged $140. The document prints no other probate figure, and states no
   * other band, so there is no rung to price between the two.
   */
  const YT_FEE_ABOVE = 140
  const YT_EXEMPTION = 25_000

  it('prices both values item 11 prints, on both sides of the exemption boundary', () => {
    // The two published values, probed where the instrument's wording turns:
    // "not exceeding $25,000" is $0, and the boundary itself belongs to that
    // exemption rather than to the $140 step.
    expect(probateTax(YT_EXEMPTION - 1, 'YT'), 'just below the exemption').toBe(0)
    expect(probateTax(YT_EXEMPTION, 'YT'), 'at the exemption boundary ("not exceeding")').toBe(0)
    expect(probateTax(YT_EXEMPTION + 1, 'YT'), 'just above the exemption').toBe(YT_FEE_ABOVE)
    // The defect itself: a small estate used to be charged the full $140.
    expect(probateTax(5_000, 'YT'), 'the $5,000 estate the defect overcharged').toBe(0)
    expect(probateTax(1, 'YT'), 'the smallest non-empty estate').toBe(0)
    expect(probateTax(0, 'YT'), 'an estate with nothing probatable').toBe(0)
    // The fee does not scale with the estate above the boundary.
    expect(probateTax(25_001, 'YT')).toBe(YT_FEE_ABOVE)
    expect(probateTax(1_000_000, 'YT')).toBe(YT_FEE_ABOVE)
    expect(probateTax(50_000_000, 'YT')).toBe(YT_FEE_ABOVE)
    // The implementation carries exactly those two values and no third band.
    expect(PROBATE_RATES.YT).toEqual({ flat: YT_FEE_ABOVE, rate: 0, threshold: YT_EXEMPTION })
    expect(PROBATE_RATES.YT.bands, 'item 11 prints no intermediate rung').toBeUndefined()
    // The independent expectation, from the instrument's wording: nothing up to
    // and including the boundary, $140 strictly above it.
    for (const value of [0, 1, 5_000, 24_999, 25_000, 25_001, 200_000, 1_000_000])
      expect(probateTax(value, 'YT'), `YT at ${value}`)
        .toBe(value <= YT_EXEMPTION ? 0 : YT_FEE_ABOVE)
    expect(PROBATE_HAND.YT).toEqual({ flat: YT_FEE_ABOVE, rate: 0, threshold: YT_EXEMPTION })
    for (const value of [1, 5_000, 24_999, 25_000, 25_001, 200_000, 1_000_000])
      expect(probateTax(value, 'YT'), `YT at ${value} vs the hand rule`)
        .toBeCloseTo(handProbate('YT', value), 6)
  })

  it('holds the cited authority\'s recorded figures equal to the priced values', () => {
    // The equality the earlier round added for NT/NU, extended to YT: the fee
    // figures the registry records for the row's *cited authority* must be
    // exactly the values the engine prices. Deleting `$0` or `$140` from the
    // registry, or pricing a third band the instrument does not print, fails.
    const row = coverageFor('YT').implemented['probate-and-estate-fees']
    expect(row.sourceURL, 'YT source is its own fee schedule').toBe(YT_PROBATE)
    expect(row.additionalSourceURLs, 'YT also lists the table it used to cite').toEqual([PROBATE_TABLE('YT')])
    const record = CONTENT_VERIFIED_AUTHORITIES[row.sourceURL]
    expect(record, 'YT cited authority must be content-checked').toBeDefined()
    expect(record.checkedOn, 'YT checked date').toBe(row.verifiedAt)
    expect(record.checkedFigures.filter(figure => /^\$[\d,]+$/.test(figure)),
      'the citation must carry exactly the two priced values').toEqual(['$0', '$140'])
    expect(record.checkedFigures, 'the exemption boundary as item 11 words it')
      .toContain('not exceeding $25,000 in value')
    // The TaxTips.ca table the row used to cite is now its additional source,
    // and it states the same boundary in its own words rather than supplying a
    // figure the primary does not print.
    expect(record.checkedFigures, 'the boundary is not inferred').not.toContain('$25,000')
  })

  it('moves YT alone: every other jurisdiction\'s probate keeps its published value', () => {
    // The confinement control. ON, QC, MB, SK, NB and NL keep exactly the values
    // the build charged before this slice, keyed here from their own authorities
    // rather than from `PROBATE_RATES`, so a change that leaks into another
    // province fails. NT/NU are covered by their own ladder suite above and are
    // asserted non-zero here to prove the shapes still coexist. AB, NS and PE
    // are *not* in this list: they moved in this slice and are pinned band by
    // band in their own suite below.
    const CONTROL: Record<string, number> = {
      ON: (1_000_000 - 50_000) * 0.015,
      // BE-38 B4 moved BC: its published total is the Act's ladder plus the
      // Court Rules' $200 filing fee, not the old flat $200 + 1.4%.
      BC: BC_FILING_FEE + bcBand1(50_000 - 25_000) + bcTop(1_000_000 - 50_000),
      QC: 243, MB: 0, SK: 200 + 0.007 * 1_000_000,
      NB: 100 + 0.005 * (1_000_000 - 20_000),
      NL: 60 + 0.006 * (1_000_000 - 1_000),
    }
    for (const [province, expected] of Object.entries(CONTROL))
      expect(probateTax(1_000_000, province as Province), `${province} probate`).toBeCloseTo(expected, 6)
    for (const province of ['NT', 'NU'] as const)
      expect(probateTax(1_000_000, province), `${province} top tier`).toBeGreaterThan(0)
    // The shared flat-plus-rate expression still serves every province the same
    // way; only YT's row gained a boundary.
    expect(PROBATE_RATES.ON).toEqual({ flat: 0, rate: 0.015, threshold: 50_000 })
    // BE-38 B4: BC is no longer a flat-plus-rate pin — it carries its own
    // published ladder and the Court Rules' filing fee, asserted in its own
    // suite below, so only the boundary it shares with ON is pinned here.
    expect(PROBATE_RATES.BC.threshold).toBe(50_000)
    // The three no-rate shapes still coexist: QC's flat amount is unconditional
    // (charged on the first dollar, as its own table prints), MB's is exactly
    // zero, and YT's alone is a step above its exemption. A change that turned
    // YT's boundary into a general "rate 0 ⇒ free below threshold" rule would
    // zero QC here. AB used to be the second unconditional flat pin; it is now a
    // ladder, so its first-dollar value is pinned in its own suite instead.
    expect(probateTax(1, 'QC')).toBe(243)
    expect(probateTax(1, 'MB')).toBe(0)
    expect(probateTax(1, 'YT')).toBe(0)
    expect(probateTax(1_000_000, 'QC')).toBe(243)
    // QC is now the only row in the table with an unconditional *non-zero* flat
    // fee; MB is the other `rate: 0, threshold: 0` row and is exactly zero by
    // abolition. AB used to be the third, and is a ladder now.
    expect(PROVINCES.filter(province => {
      const rule = PROBATE_RATES[province]
      return rule.rate === 0 && rule.threshold === 0 && rule.bands === undefined && rule.flat > 0
    })).toEqual(['QC'])
  })
})

describe('BE-38 B4: British Columbia is priced from the Probate Fee Act and the Court Rules, not a TaxTips approximation', () => {
  it('prices every band both instruments print, on both sides of both boundaries', () => {
    // Every expected value below is built from the hand-keyed Act rates and the
    // hand-keyed $200 filing fee — never from `PROBATE_RATES` or `probateTax`,
    // whose value is the thing under test.
    const at = (value: number) => probateTax(value, 'BC')
    // s. 2(2)(b): "does not exceed $25 000" — the whole exempt band is free,
    // including the boundary itself.
    expect(at(0), 'nothing probatable').toBe(0)
    expect(at(10_000), 'the $10,000 estate the defect overcharged').toBe(0)
    expect(at(24_999), 'just below the exemption').toBe(0)
    expect(at(25_000), 'at the exemption boundary ("does not exceed")').toBe(0)
    // s. 2(2)(b) ends and s. 2(3)(a) begins above $25,000; the Court Rules'
    // $200 filing fee is waived at or below the same boundary, so the smallest
    // estate above it owes that fee plus the proportional $6-per-$1,000 share.
    expect(at(1), 'inside the exemption, as the Court Rules also waive it').toBe(0)
    expect(at(25_001), 'just above the exemption').toBeCloseTo(
      BC_FILING_FEE + bcBand1(25_001 - 25_000), 6)
    expect(at(30_000), 'the smallest band the old row skipped').toBeCloseTo(
      BC_FILING_FEE + bcBand1(30_000 - 25_000), 6)
    // The old row charged $200 for every one of these; the published fee is 0
    // up to the boundary, so this band is the defect the sweep found.
    for (const value of [1, 5_000, 10_000, 20_000])
      expect(at(value), `$${value} is inside the published exemption`).toBe(0)
    // s. 2(3)(a): $6 per $1,000 over $25,000, plus the filing fee, up to
    // $50,000 — the band the old row omitted entirely.
    for (const value of [30_000, 40_000, 49_999, 50_000])
      expect(at(value), `$${value} in the s. 2(3)(a) band`).toBeCloseTo(
        BC_FILING_FEE + bcBand1(value - 25_000), 6)
    expect(at(50_000), 'the top of the second band').toBe(BC_FILING_FEE + 150)
    // s. 2(3)(b): $14 per $1,000 over $50,000, on top of what s. 2(3)(a)
    // accumulated at the boundary and the filing fee.
    for (const value of [50_001, 75_000, 200_000, 1_000_000, 50_000_000])
      expect(at(value), `$${value} above the boundary`).toBeCloseTo(
        BC_FILING_FEE + bcBand1(50_000 - 25_000) + bcTop(value - 50_000), 6)
    // The defect's third symptom, pinned as a number: the old row charged
    // `200 + 0.014 × (value − 50_000)`, exactly $150 light above $50,000 — the
    // whole of s. 2(3)(a)'s accumulated $150 ($6 × 25), which the old $200 flat
    // (the Court Rules filing fee) never included.
    expect(at(1_000_000) - (200 + 0.014 * (1_000_000 - 50_000))).toBeCloseTo(150, 6)
    // The implementation carries the two Act tiers, the Act's own accumulated
    // amount at the boundary, and the Court Rules' filing fee as four separate
    // published figures.
    expect(PROBATE_RATES.BC).toEqual({
      flat: bcBand1(50_000 - 25_000), rate: BC_TOP_RATE / 1_000,
      threshold: 50_000, surcharge: BC_FILING_FEE,
      baseRate: BC_BAND_1_RATE / 1_000, baseUpTo: 25_000,
    })
  })

  it('reads its expectations off the two instruments, not off the priced function', () => {
    // The independent-formula cross-check (the `handProbate` shape the YT and
    // NT/NU slices use): the published rule written out separately agrees band
    // for band, including the boundaries and the filing fee.
    for (const value of [0, 1, 10_000, 25_000, 25_001, 30_000, 40_000, 50_000, 50_001, 100_000, 200_000, 1_000_000])
      expect(probateTax(value, 'BC'), `BC at ${value} vs the hand rule`)
        .toBeCloseTo(handProbate('BC', value), 6)
    // The exemption is the Act's, so a small estate is free — the headline
    // symptom the sweep found (`probateTax(10_000, 'BC') === 200`).
    expect(handProbate('BC', 10_000), 'the hand rule also exempts $10,000').toBe(0)
    expect(handProbate('BC', 200_000), 'the hand rule is not the old flat+rate')
      .not.toBeCloseTo(200 + 0.014 * (200_000 - 50_000), 6)
  })

  it('holds the cited authorities\u2019 recorded figures equal to the priced ladder (review N1)', () => {
    // The equality the review asked for, covering BC: the figures the registry
    // records for each authority the row cites must be exactly the values the
    // engine prices, and the boundary wording must be recorded with them, so a
    // citation that stops carrying a priced figure fails here rather than
    // disagreeing silently with the number on screen.
    const row = coverageFor('BC').implemented['probate-and-estate-fees']
    expect(row.sourceURL, 'BC cites the Act that prints the band ladder').toBe(BC_PROBATE_ACT)
    expect(row.contentChecked, 'BC probate must be content-checked, not merely listed').toBe(true)
    expect(row.additionalSourceURLs, 'BC also lists the Court Rules item and its old table')
      .toEqual([BC_COURT_FEES, PROBATE_TABLE('BC')])
    expect(row.limitationId, 'BC names its own limitation').toBe('probateFeesBC')
    expect(row.verifiedAt, 'BC checked date').toBe(CONTENT_VERIFIED_AUTHORITIES[BC_PROBATE_ACT].checkedOn)

    // The Act's own record: the two rates it prints, in its own wording, plus
    // the exemption phrase. The priced ladder's *rate* figures are these, not a
    // round total — the total is derived, so the equality is on the rates and
    // boundaries the document carries.
    const act = CONTENT_VERIFIED_AUTHORITIES[BC_PROBATE_ACT]
    expect(act, 'the Act must be in the content-verified registry').toBeDefined()
    expect(act.checkedOn, 'Act checked date').toBe(row.verifiedAt)
    expect(act.checkedFigures, 's. 2(3)(a) rate as the Act prints it').toContain('$6 for every $1 000 or part of $1 000')
    expect(act.checkedFigures, 's. 2(3)(b) rate as the Act prints it').toContain('$14 for every $1 000 or part of $1 000')
    expect(act.checkedFigures, 'the lower boundary phrase').toContain('$25 000 but is not more than $50 000')
    expect(act.checkedFigures, 'the exemption phrase').toContain('does not exceed $25 000')
    // The equality this ID's standard asks for on the primary authority's flat
    // figures: the Act prints "No fee is payable", recorded here as the one
    // `$0` the engine prices inside the exemption (the same convention the YT
    // and NT/NU rows use), and no other flat fee — deleting it fails here.
    expect(act.checkedFigures.filter(figure => /^\$[\d,]+$/.test(figure)),
      'the Act records exactly its $0 exemption as a flat figure').toEqual(['$0'])
    // The Act charges no filing fee, so the $200 must not be read as its figure.
    expect(act.checkedFigures, 'the Act does not print the Court Rules fee').not.toContain('$200')
    // The Court Rules item supplies exactly the one figure the engine adds.
    const court = CONTENT_VERIFIED_AUTHORITIES[BC_COURT_FEES]
    expect(court, 'the Court Rules item must be in the registry').toBeDefined()
    expect(court.checkedOn, 'Court Rules checked date').toBe(row.verifiedAt)
    expect(court.checkedFigures.filter(figure => /^\$[\d,]+$/.test(figure)),
      'the Court Rules carry exactly the priced filing fee').toEqual([`$${BC_FILING_FEE}`])
    expect(court.checkedFigures, 'the fee is the probate filing fee, not another item').toContain(
      'to file for and obtain a grant of probate or administration')
    // The TaxTips.ca table the row used to cite as its authority is now only an
    // additional source, and it states the Act's rule rather than supplying one.
    const table = CONTENT_VERIFIED_AUTHORITIES[PROBATE_TABLE('BC')]
    expect(table, 'the additional table must be recorded too').toBeDefined()
    expect(table.checkedOn, 'table checked date').toBe(row.verifiedAt)
    // And the priced band figures the engine charges are the Act's own recorded
    // rates and boundaries, so dropping a rate from the registry fails above.
    expect(PROBATE_RATES.BC.baseRate, 'the s. 2(3)(a) rate').toBe(BC_BAND_1_RATE / 1_000)
    expect(PROBATE_RATES.BC.rate, 'the s. 2(3)(b) rate').toBe(BC_TOP_RATE / 1_000)
    expect(PROBATE_RATES.BC.baseUpTo, 'the exemption boundary').toBe(25_000)
    expect(PROBATE_RATES.BC.threshold, 'the s. 2(3)(b) boundary').toBe(50_000)
    expect(PROBATE_RATES.BC.flat, 'the s. 2(3)(a) amount accumulated at $50,000').toBe(
      bcBand1(50_000 - 25_000))
    expect(PROBATE_RATES.BC.surcharge, 'the Court Rules filing fee').toBe(BC_FILING_FEE)
  })

  it('leaves every other jurisdiction, including ON and the territories, untouched', () => {
    // The confinement control: ON's Estate Administration Tax, the territories'
    // own ladder tops and the remaining flat rows are the values the build
    // charged before this slice — keyed from their own authorities, not from
    // `PROBATE_RATES` — so a change that leaked into another province fails.
    // AB and NS are asserted at $1M too, but on their *new* published top tiers
    // (Surrogate Rules item 1(1)(e) $525; Probate Act s. 87(2)(e) $1002.65 +
    // $16.95 per $1,000), which is the same value the old approximation happened
    // to reach there — this slice moved their lower bands, not their top tier.
    expect(probateTax(1_000_000, 'ON')).toBeCloseTo((1_000_000 - 50_000) * 0.015, 6)
    expect(PROBATE_RATES.ON).toEqual({ flat: 0, rate: 0.015, threshold: 50_000 })
    expect(probateTax(1_000_000, 'NT')).toBe(435)
    expect(probateTax(1_000_000, 'NU')).toBe(425)
    expect(probateTax(1_000_000, 'YT')).toBe(140)
    expect(probateTax(1_000_000, 'AB')).toBe(525)
    expect(probateTax(1_000_000, 'QC')).toBe(243)
    expect(probateTax(1_000_000, 'NS')).toBeCloseTo(1002.65 + 0.01695 * (1_000_000 - 100_000), 6)
    expect(PROBATE_RATES.BC, 'only BC gained a second tier').toHaveProperty('baseRate')
    expect(PROBATE_RATES.BC, 'only BC gained a filing-fee surcharge').toHaveProperty('surcharge')
    for (const province of ['ON', 'AB', 'QC', 'MB', 'SK', 'NS', 'NB', 'PE', 'NL', 'YT', 'NT', 'NU'] as Province[]) {
      expect(PROBATE_RATES[province], `${province} must not gain a surcharge`).not.toHaveProperty('surcharge')
      expect(PROBATE_RATES[province], `${province} must not gain a second tier`).not.toHaveProperty('baseRate')
    }
  })
})

describe('BE-38 B3 review (round 3): a citation is reachable or visibly qualified', () => {
  const RQ_RATES = 'https://www.revenuquebec.ca/en/citizens/income-tax-return/completing-your-income-tax-return/income-tax-rates/'
  const QC_PARAMS = 'https://www.finances.gouv.qc.ca/Budget_et_mise_a_jour/maj/documents/AUTFR_RegimeImpot2026.pdf'

  it('never renders a bot-gated authority, and qualifies every row that cites one', () => {
    // B2: the rendered authority must be one a reader can reach. The authorities
    // the suite knows to be unreachable are recorded, dated, in
    // `BLOCKED_SOURCES`; a row may cite one — as primary or as an additional
    // source — only if its rendered limitation names the gate. This is the
    // assertion that would have failed the QC bracket rows while `RQ_RATES` was
    // their `sourceURL`.
    //
    // BE-38 B3 review (round 4, B2): the registry now also carries a source that
    // answers **200** to curl and to an API request context (PE's own page). A
    // status-code sweep cannot see that gate, so the guard keys off this
    // registry — populated from real Chromium navigations — and not off HTTP
    // status. `RuleAssumptions.tsx` marks each such link with its gate, and the
    // e2e suite pins the rendered marker.
    //
    // BE-38 B4 follow-up: Nunavut's own regulation is the fourth entry, and it
    // is a row's *primary* source. A blocked primary is permitted only with a
    // rendered qualification naming the gate, so the guard now asserts the
    // limitation for every blocked URL a row renders rather than only for the
    // additional ones — the e2e suite holds that qualification's marker in
    // en/fr/zh.
    for (const jurisdiction of COVERAGE_JURISDICTIONS)
      for (const [id, credit] of Object.entries(coverageFor(jurisdiction).implemented)) {
        for (const authority of rowAuthorities(credit))
          if (authority.blocked)
            expect(credit.limitationId,
              `${jurisdiction}/${id} cites a blocked authority with no rendered qualification`).toBeDefined()
      }
    // The record cannot be emptied to make the assertion vacuous.
    expect(Object.keys(BLOCKED_SOURCES)).toContain(RQ_RATES)
    expect(BLOCKED_SOURCES[RQ_RATES].gateMarker).toBe('403')
    // The round-4 entry: recorded with the reason that makes it invisible to a
    // status-code check, so a future reader cannot "simplify" the guard back to
    // an HTTP sweep without deleting this assertion.
    expect(Object.keys(BLOCKED_SOURCES)).toContain(PE_2026_GOV)
    expect(BLOCKED_SOURCES[PE_2026_GOV].reason).toMatch(/200/)
    expect(BLOCKED_SOURCES[PE_2026_GOV].reason).toMatch(/CAPTCHA/)
    expect(BLOCKED_SOURCES[PE_2026_GOV].observedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // BE-38 B4 follow-up: the gate the NT/NU slice left unrecorded. Measured on
    // a headless Chromium navigation to the cited URL: HTTP 403 and Cloudflare's
    // "Just a moment..." challenge. Deleting this entry makes the row render as
    // content-checked over a link a scripted reader cannot open, and the
    // assertion below is what refuses that.
    expect(Object.keys(BLOCKED_SOURCES)).toContain(NU_PROBATE)
    expect(BLOCKED_SOURCES[NU_PROBATE].gateMarker).toBe('403')
    expect(BLOCKED_SOURCES[NU_PROBATE].reason).toMatch(/403/)
    expect(BLOCKED_SOURCES[NU_PROBATE].reason).toMatch(/Cloudflare/)
    expect(BLOCKED_SOURCES[NU_PROBATE].reason).toMatch(/Chromium/)
    expect(BLOCKED_SOURCES[NU_PROBATE].observedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(coverageFor('NU').implemented['probate-and-estate-fees'].limitationId,
      'NU cannot cite the gated regulation unqualified').toBe('probateFeesApproxNU')
    for (const [url, blocked] of Object.entries(BLOCKED_SOURCES)) {
      expect(blocked.reason.length, url).toBeGreaterThan(40)
      expect(blocked.observedAt, url).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(blocked.gateMarker.length, url).toBeGreaterThan(0)
    }
  })

  it('derives the registered gate marker for every blocked URL a row renders', () => {
    // The generic shape of round 4's B2: for *every* recorded block, a row that
    // renders it — as `sourceURL` or as an `additionalSourceURLs` entry — must
    // carry a rendered limitation naming that block's own marker. Dropping the
    // marker from the catalogue, or citing a newly recorded URL without naming
    // its gate, fails here rather than shipping an unqualified dead link for the
    // next jurisdiction. BE-38 B4 follow-up moved NU's regulation into this set
    // as a primary source, so the check is no longer additional-source-only.
    for (const jurisdiction of COVERAGE_JURISDICTIONS)
      for (const [id, credit] of Object.entries(coverageFor(jurisdiction).implemented))
        for (const authority of rowAuthorities(credit))
          if (authority.blocked)
            expect(credit.limitationId,
              `${jurisdiction}/${id} renders a blocked authority with no limitation`).toBeDefined()
  })

  it('names a rendered limitation for every row whose cited source does not carry its figures', () => {
    // B1 + the non-blocking source gaps of the same class: a citation that does
    // not settle the figure may never be shown unqualified.
    for (const jurisdiction of COVERAGE_JURISDICTIONS)
      for (const [id, credit] of Object.entries(coverageFor(jurisdiction).implemented))
        if (credit.qualifiedSource)
          expect(credit.limitationId, `${jurisdiction}/${id} declares a source gap`).toBeDefined()
    const gaps: string[] = []
    for (const jurisdiction of COVERAGE_JURISDICTIONS)
      for (const [id, credit] of Object.entries(coverageFor(jurisdiction).implemented))
        if (credit.qualifiedSource) gaps.push(`${jurisdiction}/${id}`)
    // The exact set this round declared, so the flag cannot be dropped silently.
    // BE-38 B3 review (round 4, B1): ON probate is *not* in this set — its
    // citation now carries the priced figures (98e34) and the row is
    // content-checked instead. PE's bracket row is deliberately *not* here
    // either: its primary source carries the priced ladder, and the blocked PE
    // government page is a separate condition (`BLOCKED_SOURCES` + a rendered
    // limitation), asserted in the tests below.
    expect(gaps.sort()).toEqual([
      'MB/manitoba-bpa-phase-out', 'QC/provincial-age-amount',
      'QC/quebec-basic-personal-amount', 'QC/quebec-fss-contribution', 'QC/quebec-income-tax-brackets',
      'QC/quebec-ramq-premium', 'YT/yukon-bpa-phase-out',
    ])
  })

  it('content-verifies the ON probate citation and records the figures that were read', () => {
    // BE-38 B3 review (round 4, B1): the row cited `90e22` (Estates
    // Administration Act), which prints none of the priced figures, and the
    // suite pinned it. The citation is now the Estate Administration Tax Act,
    // and the row's claim is recorded in the registry with the figures a person
    // read on the page, so the artifact no longer asserts a read that did not
    // happen.
    const row = coverageFor('ON').implemented['probate-and-estate-fees']
    expect(row.sourceURL).toBe(ON_PROBATE_STATUTE)
    expect(row.sourceURL).not.toContain('90e22')
    expect(row.contentChecked).toBe(true)
    const record = CONTENT_VERIFIED_AUTHORITIES[ON_PROBATE_STATUTE]
    expect(record, 'the cited statute must be in the content-verified registry').toBeDefined()
    expect(record.checkedOn).toBe(row.verifiedAt)
    expect(record.checkedFigures.join(' ')).toMatch(/\$15/)
    expect(record.checkedFigures.join(' ')).toMatch(/\$50,000/)
    // The hand-keyed figures in the suite are the ones the statute prints:
    // $15 per $1,000 over $50,000 is exactly the 1.5% the engine charges.
    expect(PROBATE_HAND.ON).toEqual({ flat: 0, rate: 0.015, threshold: 50_000 })
    expect(PROBATE_RATES.ON).toEqual(PROBATE_HAND.ON)
    // And the wrong statute is the one the review found carries none of them.
    expect(Object.keys(CONTENT_VERIFIED_AUTHORITIES)).not.toContain('https://www.ontario.ca/laws/statute/90e22')
  })

  it('renders the content-verified / merely-listed distinction from the registry', () => {
    // BE-38 B3 review (round 4): the whole point of the round. A row may only be
    // called content-checked when *every* authority it lists is recorded in
    // `CONTENT_VERIFIED_AUTHORITIES` on the row's own `verifiedAt` date, and no
    // authority may render the "checked figures" claim unless it is recorded
    // there. The counts are pinned so the surface cannot silently start claiming
    // more than the registry holds.
    const verified = new Set<string>()
    const merelyListed = new Set<string>()
    for (const jurisdiction of COVERAGE_JURISDICTIONS)
      for (const [id, credit] of Object.entries(coverageFor(jurisdiction).implemented)) {
        const authorities = rowAuthorities(credit)
        expect(authorities.length, `${jurisdiction}/${id} renders at least its primary`).toBeGreaterThan(0)
        expect(authorities.map(a => a.url)).toEqual([credit.sourceURL, ...(credit.additionalSourceURLs ?? [])])
        // Round 4 found ON's federal row listing its own T4032 twice (as the
        // source *and* as a hard-coded additional source), and React warned
        // about the duplicate key. A URL may appear at most once per row, and a
        // row renders exactly one primary.
        expect(new Set(authorities.map(a => a.url)).size, `${jurisdiction}/${id} lists a URL twice`).toBe(authorities.length)
        expect(authorities.filter(a => a.primary).length, `${jurisdiction}/${id} renders more than one primary`).toBe(1)
        expect(authorities.filter(a => a.url === credit.sourceURL).length, `${jurisdiction}/${id} primary`).toBe(1)
        for (const authority of authorities) {
          if (authority.checkedFigures) {
            const record = CONTENT_VERIFIED_AUTHORITIES[authority.url]
            expect(record, `${jurisdiction}/${id} ${authority.url}`).toBeDefined()
            expect(record.checkedOn, `${jurisdiction}/${id} ${authority.url}`).toBe(credit.verifiedAt)
            expect(authority.checkedFigures).toEqual(record.checkedFigures)
            verified.add(authority.url)
          } else {
            expect(CONTENT_VERIFIED_AUTHORITIES[authority.url],
              `${jurisdiction}/${id} may not render an unrecorded authority as checked`).toBeUndefined()
            merelyListed.add(authority.url)
          }
        }
        // A `contentChecked` row means every one of its authorities is verified:
        // the flag can never cover for an unchecked link inside the same row.
        if (credit.contentChecked)
          expect(authorityStates(credit).unverified, `${jurisdiction}/${id} claims contentChecked`).toEqual([])
      }
    // Every registry entry is cited by at least one row, so the registry cannot
    // accumulate authorities the artifact does not show.
    const cited = new Set<string>()
    for (const jurisdiction of COVERAGE_JURISDICTIONS)
      for (const credit of Object.values(coverageFor(jurisdiction).implemented))
        for (const authority of rowAuthorities(credit)) cited.add(authority.url)
    for (const url of Object.keys(CONTENT_VERIFIED_AUTHORITIES))
      expect(cited.has(url), `registry entry cited by no row: ${url}`).toBe(true)
    for (const url of Object.keys(BLOCKED_SOURCES))
      expect(cited.has(url), `blocked entry cited by no row: ${url}`).toBe(true)
    // The two rendered categories, counted over unique authorities: the surface
    // says "content-checked" for 15 of the 56 distinct URLs it links and "listed
    // only" for the other 41. A reader can therefore tell which citations this
    // artifact actually claims a document↔figure correspondence for. BE-38 B4
    // follow-up added two: Yukon's own fee schedule and the TaxTips.ca table the
    // YT row still lists alongside it. BE-38 B4 (BC) added three more: the
    // Probate Fee Act, the Court Rules item carrying the $200 filing fee, and the
    // BC TaxTips.ca table (which was already among the cited 54 but now renders
    // content-checked, having stopped being the row's primary source).
    expect([...verified].sort()).toEqual([
      BC_2026_JULY, CFFP_GUIDE, NL_2026_JULY, PE_2026_JULY, ON_PROBATE_STATUTE,
      'https://www.taxtips.ca/willsandestates/probatefees/on.htm',
      // BE-38 B4: the two territories' own regulations, plus the two TaxTips.ca
      // territory tables their now-content-checked rows also list.
      NT_PROBATE, NU_PROBATE, PROBATE_TABLE('NT'), PROBATE_TABLE('NU'),
      // BE-38 B4 follow-up: Yukon's fee schedule and the table it used to cite.
      YT_PROBATE, PROBATE_TABLE('YT'),
      // BE-38 B4 (BC): the Act, the Court Rules filing-fee item, and the table
      // the row still lists as an additional source.
      BC_PROBATE_ACT, BC_COURT_FEES, PROBATE_TABLE('BC'),
      // BE-38 B4 (AB/NS/PE): each moved row's own band-ladder instrument and the
      // TaxTips.ca table it still lists as an additional source.
      LADDERS.AB.instrument, LADDERS.NS.instrument, LADDERS.PE.instrument,
      PROBATE_TABLE('AB'), PROBATE_TABLE('NS'), PROBATE_TABLE('PE'),
    ].sort())
    expect(cited.size).toBe(59)
    expect(verified.size).toBe(21)
    expect(merelyListed.size).toBe(38)
    expect(verified.size + merelyListed.size).toBe(cited.size)
    expect(CONTENT_VERIFIED_AUTHORITIES[PE_2026_JULY].checkedFigures).toContain('142,520')
    expect(CONTENT_VERIFIED_AUTHORITIES[BC_2026_JULY].checkedFigures.join(' ')).toMatch(/5\.60/)
    expect(CONTENT_VERIFIED_AUTHORITIES[NL_2026_JULY].checkedFigures.join(' ')).toMatch(/13,094/)
    expect(CONTENT_VERIFIED_AUTHORITIES[CFFP_GUIDE].checkedFigures.join(' ')).toMatch(/19 890/)
  })

  it('requires a recorded HTTP 200 probe for every citation rendered as content-checked', () => {
    // BE-38 B4 follow-up (blocking finding): the NS row cited a `probate.htm`
    // that answers 404 while rendering it as the row's *content-verified*
    // authority, because nothing recorded whether a citation had ever resolved.
    // A live re-fetch is not asserted here — CI has no network — so the suite
    // asserts the recorded probe instead: every URL the artifact claims a
    // document↔figure correspondence for must be in `LIVE_PROBED_CITATIONS`,
    // which only holds a URL a scripted reader actually fetched at HTTP 200. A
    // `BLOCKED_SOURCES` gate is exempt: it renders its own qualification rather
    // than the checked claim.
    const probed = new Set(LIVE_PROBED_CITATIONS)
    for (const url of Object.keys(CONTENT_VERIFIED_AUTHORITIES)) {
      if (BLOCKED_SOURCES[url]) continue
      expect(probed.has(url), `${url} renders as content-checked with no recorded live probe`).toBe(true)
    }
    for (const url of probed)
      expect(CONTENT_VERIFIED_AUTHORITIES[url] ?? BLOCKED_SOURCES[url],
        `live probe recorded for a URL no row cites as checked: ${url}`).toBeDefined()
  })

  it('cites the authority the QC RAMQ approximation was derived from, not the parameters PDF', () => {
    // B1: `taxData.ts` calls the four figures a legacy preview indexed from the
    // 2025 table, so the parameters PDF — which prints none of them — may not be
    // the authority this row shows. It now points at that 2025 table and renders
    // the derivation instead.
    const row = coverageFor('QC').implemented['quebec-ramq-premium']
    expect(row.sourceURL).toBe(CFFP_GUIDE)
    expect(row.limitationId).toBe('quebecRamqPremium')
    expect(row.qualifiedSource).toBe(true)
    expect([row.sourceURL, ...(row.additionalSourceURLs ?? [])]).not.toContain(QC_PARAMS)
  })

  it('renders the pack\u2019s own reachable source for the QC bracket rows and keeps the bot-gated page visible', () => {
    // B2: the pack's `fieldSources` for QC is the reachable parameters PDF; the
    // rates-only page is an additional source with a rendered qualification.
    for (const id of ['quebec-income-tax-brackets', 'quebec-basic-personal-amount']) {
      const row = coverageFor('QC').implemented[id]
      expect(row.sourceURL, id).toBe(QC_PARAMS)
      // The CFFP guide is the reachable source that prints the 2026 ladder
      // *including* the 14/19/24/25.75 rates the parameters PDF omits; the
      // Revenu Québec page is cited and is bot-gated, and the rendered
      // qualification says so.
      expect(row.additionalSourceURLs, id).toContain(CFFP_GUIDE)
      expect(row.additionalSourceURLs, id).toContain(RQ_RATES)
      expect(row.limitationId, id).toBeTruthy()
      expect(row.qualifiedSource, id).toBe(true)
    }
  })

  it('cites the CFFP guide for the Quebec figure the parameters PDF does not print', () => {
    // NTH5: the 18.75% age-credit reduction rate is not in the parameters PDF;
    // the CFFP guide prints it (and Quebec's 2026 age/retirement parameters), so
    // it is the row's additional source and the row declares the source gap.
    const age = coverageFor('QC').implemented['provincial-age-amount']
    expect(age.sourceURL).toBe(QC_PARAMS)
    expect(age.additionalSourceURLs).toContain(CFFP_GUIDE)
    expect(age.qualifiedSource).toBe(true)
  })

  it('derives the rendered limitation ids from the matrix rather than a hand list', () => {
    const ids = coverageLimitationIds()
    expect(ids.length).toBeGreaterThan(20)
    expect(ids).toEqual([...ids].sort())
    expect(ids).toContain('quebecRamqPremium')
    expect(ids).toContain('probateFeesApproxNT')
    expect(ids).toContain('probateFeesApproxNU')
    expect(ids).toContain('probateFeesMB')
  })
})

/** The first printed band's fee, as each document writes it, so the $10,000
 * probe compares against the instrument's own decimal precision. */
const EXACT_AT_10K: Record<string, number> = { AB: 35, NS: 85.6, PE: 50 }

describe('BE-38 B4: AB, NS and PE are priced from their own band ladders, not a top-tier flat amount', () => {
/** The three rows this slice moved; every expected value is hand-keyed from the
 * instruments, never from `PROBATE_RATES` or `probateTax`. */
  const MOVED = ['AB', 'NS', 'PE'] as const

  it('prices every band each instrument prints, on both sides of every boundary', () => {
    for (const province of MOVED) {
      const { rungs, rate } = PROBATE_LADDER[province]!
      const printed = rungs.filter(rung => Number.isFinite(rung.upTo))
      const top = rungs[rungs.length - 1]
      const boundary = printed[printed.length - 1].upTo
      // A ladder then a rate: `bands` the printed rungs, `flat` at the boundary.
      expect(PROBATE_RATES[province], `${province} pinned rule`).toEqual({
        flat: top.fee, rate, threshold: boundary,
        bands: printed.map(rung => ({ upTo: rung.upTo, fee: rung.fee })),
      })
      expect(probateTax(boundary + 1, province), `${province} open band lower end`)
        .toBeCloseTo(top.fee + rate, 6)
      for (const [index, rung] of printed.entries()) {
        const previous = index === 0 ? 0 : printed[index - 1].upTo
        expect(probateTax(previous + 1, province), `${province} ${rung.phrase} (lower end)`).toBeCloseTo(rung.fee, 6)
        expect(probateTax(rung.upTo, province), `${province} ${rung.phrase} (upper end)`).toBeCloseTo(rung.fee, 6)
      }
      expect(probateTax(boundary, province), `${province} at the boundary`)
        .toBeCloseTo(printed[printed.length - 1].fee, 6)
      expect(probateTax(boundary + 1, province) - probateTax(boundary, province),
        `${province} step into the open band`).toBeCloseTo(top.fee - printed[printed.length - 1].fee + rate, 6)
      for (const value of [0, 1, 5_000, 10_000, 10_001, 25_000, 25_001, 50_000, 50_001, 100_000,
        100_001, 125_000, 125_001, 200_000, 250_000, 250_001, 1_000_000, 50_000_000])
        expect(probateTax(value, province), `${province} at ${value}`)
          .toBeCloseTo(handProbate(province, value), 6)
      // The published figure at the $10,000 probe the defect turned on, in the
      // documents' own decimal precision (AB item 1(1)(a) $35; NS s. 87(2)(a)
      // $85.60; PE s. 119.1(4) $50).
      expect(probateTax(10_000, province), `${province} first printed band`).toBe(EXACT_AT_10K[province])
      expect(probateTax(0, province), `${province} zero estate`).toBe(0)
    }
  })

  it('holds each cited authority\'s recorded figures equal to the priced ladder', () => {
    // This ID's equality check: the registry's figures for each row's *cited
    // authority* must be exactly the ladder the engine prices, wording included.
    for (const province of MOVED) {
      const row = coverageFor(province).implemented['probate-and-estate-fees']
      expect(row.sourceURL, `${province} source`).toBe(LADDERS[province].instrument)
      const record = CONTENT_VERIFIED_AUTHORITIES[row.sourceURL]
      expect(record, `${province} cited authority must be content-checked`).toBeDefined()
      expect(record.checkedOn, `${province} checked date`).toBe(row.verifiedAt)
      const ladder = LADDERS[province]
      // Hand-keyed literals, so "85.60" is not compared through the number 85.6.
      const pricedFees: string[] = [...ladder.literal]
      if (ladder.rate > 0) pricedFees.push(`$${ladder.rateLiteral}`)
      expect(record.checkedFigures.filter(figure => /^\$[\d,]+(\.\d+)?$/.test(figure)),
        `${province} citation must carry exactly the priced figures`).toEqual(pricedFees)
      for (const rung of ladder.rungs)
        expect(record.checkedFigures, `${province} must record "${rung.phrase}"`).toContain(rung.phrase)
      expect(FIXTURE_SOURCES[`probate-fees-${province.toLowerCase()}-2026`], `${province} fixture`).toBe(LADDERS[province].instrument)
    }
  })

  it('moves AB, NS and PE alone: no untouched jurisdiction\'s probate changed', () => {
    // Untouched jurisdictions keep their exact base-3188a7c value.
    const CONTROL: Record<string, (value: number) => number> = {
      ON: value => 0.015 * Math.max(0, value - 50_000),
      BC: value => value <= 25_000 ? 0
        : BC_FILING_FEE + bcBand1(Math.min(value, 50_000) - 25_000) + bcTop(Math.max(0, value - 50_000)),
      QC: () => 243,
      MB: () => 0,
      SK: value => 200 + 0.007 * value,
      NB: value => 100 + 0.005 * Math.max(0, value - 20_000),
      NL: value => 60 + 0.006 * Math.max(0, value - 1_000),
      YT: value => value > 25_000 ? 140 : 0,
      NT: value => value <= 10_000 ? 30 : value <= 25_000 ? 110 : value <= 125_000 ? 215
        : value <= 250_000 ? 325 : 435,
      NU: value => value <= 10_000 ? 30 : value <= 25_000 ? 110 : value <= 125_000 ? 215
        : value <= 250_000 ? 325 : 425,
    }
    expect(Object.keys(CONTROL).sort()).toEqual(
      PROVINCES.filter(province => !MOVED.includes(province as typeof MOVED[number])).sort())
    for (const [province, expected] of Object.entries(CONTROL))
      for (const value of [1, 10_000, 200_000, 1_000_000])
        expect(probateTax(value, province as Province), `${province} at ${value}`)
          .toBeCloseTo(expected(value), 6)
    // The moved rows gain neither BC's surcharge nor its second tier.
    for (const province of ['NL', 'NB'] as const) {
      expect(PROBATE_RATES[province].bands, `${province} is not a ladder`).toBeUndefined()
      expect(PROBATE_RATES[province].rate, `${province} keeps its rate`).toBeGreaterThan(0)
    }
    for (const province of MOVED) {
      expect(PROBATE_RATES[province].bands, `${province} is a ladder`).toBeDefined()
      expect(PROBATE_RATES[province]).not.toHaveProperty('baseRate')
      expect(PROBATE_RATES[province]).not.toHaveProperty('surcharge')
    }
  })
})
