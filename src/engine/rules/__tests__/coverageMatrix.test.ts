import { describe, expect, it } from 'vitest'
import {
  BLOCKED_SOURCES, COVERAGE_JURISDICTIONS, coverageFor, coverageLimitationIds, coverageMatrix,
  coverageSummary, evidenceFixtureIds, matrixJurisdictions,
} from '../coverageMatrix'
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
  ON: { flat: 0, rate: 0.015, threshold: 50000 }, BC: { flat: 200, rate: 0.014, threshold: 50000 },
  AB: { flat: 525, rate: 0, threshold: 0 }, QC: { flat: 243, rate: 0, threshold: 0 },
  MB: { flat: 0, rate: 0, threshold: 0 }, SK: { flat: 200, rate: 0.007, threshold: 0 },
  NS: { flat: 1003, rate: 0.01695, threshold: 100000 }, NB: { flat: 100, rate: 0.005, threshold: 20000 },
  PE: { flat: 400, rate: 0.004, threshold: 100000 }, NL: { flat: 60, rate: 0.006, threshold: 1000 },
  YT: { flat: 140, rate: 0, threshold: 0 }, NT: { flat: 140, rate: 0, threshold: 0 },
  NU: { flat: 140, rate: 0, threshold: 0 },
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
/** The authority each probate figure was read from. Ontario has a statute that
 * carries its 1.5%; every other jurisdiction is pinned from the TaxTips.ca table
 * named in `taxData.ts`, and NT/NU price Yukon's $140 fee, so that is what their
 * row must evidence. */
const PROBATE_TABLE = (province: string) =>
  `https://www.taxtips.ca/willsandestates/probatefees/${province.toLowerCase()}.htm`
for (const province of PROVINCES) {
  FIXTURE_SOURCES[`probate-fees-${province.toLowerCase()}-2026`] =
    province === 'ON' ? 'https://www.ontario.ca/laws/statute/90e22'
      : province === 'NT' || province === 'NU' ? PROBATE_TABLE('YT') : PROBATE_TABLE(province)
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
      const hand = PROBATE_HAND[province]
      expect(probateTax(200_000, province), `${province} probate`)
        .toBeCloseTo(hand.flat + hand.rate * Math.max(0, 200_000 - hand.threshold), 6)
    }
    // BE-38 B3 review (NB5): the shared probate pin is vacuous for the one
    // jurisdiction priced at zero, so the zero is pinned to its reason and to
    // the disclosure instead of being left as an unprovable `0 ≈ 0`. Manitoba
    // abolished the fee in 2020, so zero is the correct price, not a gap.
    const zeroPriced = PROVINCES.filter(province => PROBATE_HAND[province].flat === 0
      && PROBATE_HAND[province].rate === 0)
    expect(zeroPriced).toEqual(['MB'])
    expect(PROBATE_RATES.MB).toEqual({ flat: 0, rate: 0, threshold: 0 })
    expect(probateTax(200_000, 'MB'), 'MB abolishes probate, so the pin is the disclosure').toBe(0)
    expect(coverageFor('MB').implemented['probate-and-estate-fees'].limitationId).toBe('probateFeesMB')
    // Every other jurisdiction's fee is non-zero at 200,000, so the shared row
    // is demonstrably priced rather than zero everywhere.
    for (const province of PROVINCES) if (province !== 'MB')
      expect(Math.abs(probateTax(200_000, province)), `${province} is priced`).toBeGreaterThan(0)
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
        // Ontario's statute is the authority carrying its 1.5% rate.
        expect(row.sourceURL).toBe('https://www.ontario.ca/laws/statute/90e22')
        expect(urls).toContain(table('ON'))
      } else if (province === 'NT' || province === 'NU') {
        // The declared exception: these price Yukon's $140 flat filing fee, so
        // that is the figure the row evidences, and the row names the published
        // tier it does not model instead of quietly swapping the authority. The
        // text now lives in the catalogue, keyed by `limitationId`, and the
        // panel renders it; `solverMessages.test.ts` pins the prose.
        expect(row.sourceURL, `${province} prices Yukon's fee`).toBe(table('YT'))
        expect(urls, `${province} names its own published table`).toContain(table(province))
        expect(row.limitationId, province).toBe(province === 'NT' ? 'probateFeesApproxNT' : 'probateFeesApproxNU')
      } else {
        expect(row.sourceURL, province).toBe(table(province))
        expect(row.limitationId, province).toBe(province === 'MB' ? 'probateFeesMB' : 'probateFees')
      }
      expect(row.limitationId, `${province} names the table`).toBeTruthy()
    }
  })
})

describe('BE-38 B3 review (round 3): a citation is reachable or visibly qualified', () => {
  const RQ_RATES = 'https://www.revenuquebec.ca/en/citizens/income-tax-return/completing-your-income-tax-return/income-tax-rates/'
  const QC_PARAMS = 'https://www.finances.gouv.qc.ca/Budget_et_mise_a_jour/maj/documents/AUTFR_RegimeImpot2026.pdf'
  const CFFP_GUIDE = 'https://cffp.recherche.usherbrooke.ca/wp-content/uploads/2024/03/cr_2026_04_guide_mesures_fiscales_vf.pdf'

  it('never renders a bot-gated authority, and qualifies every row that cites one', () => {
    // B2: the rendered authority must be one a reader can reach. The only
    // authority the suite knows to be unreachable is recorded, dated, in
    // `BLOCKED_SOURCES`; a row may list one as an additional source only if its
    // rendered limitation says so. This is the assertion that would have failed
    // the QC bracket rows while `RQ_RATES` was their `sourceURL`.
    for (const jurisdiction of COVERAGE_JURISDICTIONS)
      for (const [id, credit] of Object.entries(coverageFor(jurisdiction).implemented)) {
        expect(BLOCKED_SOURCES[credit.sourceURL],
          `${jurisdiction}/${id} renders a blocked authority`).toBeUndefined()
        for (const url of credit.additionalSourceURLs ?? [])
          if (BLOCKED_SOURCES[url])
            expect(credit.limitationId,
              `${jurisdiction}/${id} cites a blocked authority with no rendered qualification`).toBeDefined()
      }
    // The record cannot be emptied to make the assertion vacuous.
    expect(Object.keys(BLOCKED_SOURCES)).toContain(RQ_RATES)
    expect(BLOCKED_SOURCES[RQ_RATES]).toMatch(/403/)
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
    expect(gaps.sort()).toEqual([
      'MB/manitoba-bpa-phase-out', 'QC/provincial-age-amount', 'QC/quebec-basic-personal-amount',
      'QC/quebec-fss-contribution', 'QC/quebec-income-tax-brackets', 'QC/quebec-ramq-premium',
      'YT/yukon-bpa-phase-out',
    ])
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
