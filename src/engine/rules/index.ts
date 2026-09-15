/** Pinned, nominal rule snapshots. No clock or network is consulted at runtime. */
import type { TaxTable } from '../taxData'
import type { Province } from '../types'
import { FEDERAL_2026_SNAPSHOT, PROVINCIAL_2026_SNAPSHOT } from './tax2026Snapshot'

export type Coverage = 'modeled' | 'estimated' | 'unsupported'
export type IndexationRule = 'cpi-assumption' | 'frozen'
export interface Provenance {
  sourceURL: string
  additionalSourceURLs?: string[]
  effectiveDate: string
  verifiedAt: string
  indexationRule: IndexationRule
  rounding: 'nearest-dollar'
  coverage: Coverage
  limitation: string
}
/** The dates publication validation needs without narrowing a pack's shape. */
interface RulePackMeta extends Provenance {
  id: string
  assumedFutureRule: boolean
  assumedAnnualRate?: number
  basedOnRuleId?: string
}
/**
 * A parameter that participates in a tax result but that this pack does *not*
 * year-switch, with a reason a caller can show. A bracket/BPA pack is not a
 * complete return: every figure outside `federal`/`provincial` keeps its pinned
 * value even in an assumed future year, and that has to be named in the pack
 * rather than left inside a `limitation` string nothing renders. BE-38 B
 * replaces these entries with real field-level packs.
 */
export interface TaxUnsupportedPath {
  id: string
  reason: string
}
export interface TaxRulePack extends Provenance {
  id: string
  jurisdiction: Province
  taxYear: number
  federal: TaxTable
  provincial: TaxTable
  fieldSources: { federalBrackets: string; federalBpa: string; provincialBrackets: string; provincialBpa: string }
  /** Additional evidence for a field whose published value needs more than one document. */
  fieldAdditionalSources?: Partial<Record<keyof TaxRulePack['fieldSources'], string[]>>
  /** Explicitly retained source disagreement awaiting a new legal-rule version. */
  sourceConflict?: string
  /** Exact thresholds in this list never receive future indexation. */
  frozenProvincialBracketIndexes: number[]
  /** The figures this pack does not year-switch, each with a reason. */
  unsupportedPaths: TaxUnsupportedPath[]
  assumedFutureRule: boolean
  assumedAnnualRate?: number
  basedOnRuleId?: string
  /**
   * The published tax year an assumed pack was indexed from, so "indexed once
   * per elapsed year" is auditable from the pack alone instead of inferred
   * from its id string.
   */
  basedOnTaxYear?: number
}
/**
 * The four eligible-child-count brackets a CCB reduction rate is indexed by:
 * 0 = one child, 1 = two, 2 = three, 3 = four or more.
 */
export type ChildCountBracket = [number, number, number, number]
/**
 * The dollar amounts a CCB result is computed from. Every one of them is
 * published (or, for an assumed future period, indexed from one that is), so a
 * pack is complete: the computation never falls back to a constant of its own.
 *
 * `rate1`/`rate2` are the two reduction rates per child-count bracket, and
 * `basePhaseOutAmounts` the published first-threshold phase-out amount per
 * bracket that those rates are the ratio of (`rate1[i]` =
 * `basePhaseOutAmounts[i] / th1`). Keeping the published amounts with the rates
 * makes the derivation auditable instead of turning rounded percentages into
 * the only statement of the rule.
 */
export interface CcbValues {
  maxUnder6: number
  max6to17: number
  th1: number
  th2: number
  rate1: ChildCountBracket
  rate2: ChildCountBracket
  basePhaseOutAmounts: ChildCountBracket
}
/**
 * A path the pack knowingly does not price, with a reason a caller can show.
 * CCB has its own gaps (the prior-year AFNI lag, shared custody), so it names
 * them itself rather than borrowing the tax or GIS lists.
 */
export interface BenefitUnsupportedPath {
  id: string
  reason: string
}
export interface BenefitRulePack extends Provenance {
  id: string
  program: 'CCB'
  paymentPeriod: string
  incomeTaxYear: number
  values: CcbValues
  fieldSources: { amounts: string; thresholds: string; rates: string }
  /** The figures this pack does not model, each with a reason. */
  unsupportedPaths: BenefitUnsupportedPath[]
  assumedFutureRule: boolean
  assumedAnnualRate?: number
  basedOnRuleId?: string
  /**
   * The payment period the projected pack was indexed from, so "indexed once
   * per elapsed program year" is auditable from the pack alone instead of
   * inferred from its id string. Required on an assumed pack.
   */
  basedOnPaymentPeriod?: string
}
/**
 * BE-36: the two FHSA limits that a contribution-room ledger needs and cannot
 * read off a statement. Both are statutory dollar amounts, not a tax table, so
 * they get their own small pack rather than being hardcoded in the ledger.
 */
export interface FhsaRulePack extends Provenance {
  id: string
  /** The most that can be contributed or transferred in one participation year. */
  annualLimit: number
  /** The most that can be contributed or transferred in a lifetime. */
  lifetimeLimit: number
  /**
   * The most unused participation room one year can carry into the next
   * ("FHSA participation room carryforward" is the lesser of $8,000 and a
   * contribution-adjusted figure). Without this bound a ledger would let idle
   * years accumulate unlimited room.
   */
  participationRoomCarryForwardLimit: number
  fieldSources: { annualLimit: string; lifetimeLimit: string; participationRoomCarryForwardLimit: string }
  assumedFutureRule: boolean
  assumedAnnualRate?: number
  basedOnRuleId?: string
}

/**
 * BE-26 A: the OAS/GIS/Allowance parameter pack. GIS and the Allowance are not
 * one table with one cut-off: the amount and the income cut-off both depend on
 * the household shape, so this pack carries one entry per supported category
 * and the values are never interchangeable across categories.
 */
export type GisHouseholdRuleCategory =
  | 'single'
  | 'couple-both-pensioners'
  | 'couple-partner-allowance'
  | 'couple-partner-no-oas-no-allowance'

/** A path the pack knowingly does not price, with a reason a caller can show. */
export interface GisUnsupportedPath {
  id: string
  reason: string
}

/**
 * The reduction of the annual maximum, piecewise linear in annual joint
 * income, in annual dollars removed per annual dollar of income. Each entry's
 * `upTo` is the income at which the next rate takes over; the last one is
 * `Infinity`.
 *
 * This is a *fit* to the published table of monthly amounts, not a published
 * formula: the tables publish a rounded amount per income bracket, and no
 * single line reproduces them. `maxMonthlyDeviation` records how far this fit
 * can be from its table, and the tests fail if it exceeds the stated
 * tolerance.
 */
export interface GisReductionSegment { rate: number; upTo: number }

export interface GisCategoryRule {
  /** Published maximum monthly payment for the whole household. */
  maxMonthly: number
  /** Published annual income cut-off for this category. */
  annualCutoff: number
  reductionSegments: GisReductionSegment[]
  /**
   * Largest monthly gap between this fitted reduction and the published table
   * it was fitted to, across every published bracket boundary. Fitted, not
   * published; pinned by `benefits.test.ts`.
   */
  maxMonthlyDeviation: number
  fieldSources: { maxMonthly: string; annualCutoff: string; reductionSegments: string }
}

export interface GisAllowanceRule {
  /** Published maximum monthly Allowance. */
  maxMonthly: number
  /** Published annual income cut-off for the Allowance. */
  annualCutoff: number
  /** Published income at which the Allowance starts to reduce. */
  topUpIncome: number
  reductionSegments: GisReductionSegment[]
  /** Largest monthly gap against Table 4's Allowance column, as above. */
  maxMonthlyDeviation: number
  fieldSources: {
    maxMonthly: string
    annualCutoff: string
    topUpIncome: string
    reductionSegments: string
  }
}

export interface GisRulePack extends Provenance {
  id: string
  program: 'GIS'
  /** The payment quarter these amounts are published for. */
  paymentPeriod: string
  /** The base calendar year whose income these amounts test. */
  basedOnIncomeYear: number
  categories: Record<GisHouseholdRuleCategory, GisCategoryRule>
  allowance: GisAllowanceRule
  /** The paths this pack does not price, each with a reason to surface. */
  unsupportedPaths: GisUnsupportedPath[]
  assumedFutureRule: boolean
  assumedAnnualRate?: number
  basedOnRuleId?: string
}

const FED_2025: TaxTable = {
  bpa: 16129, bpaMin: 14538,
  brackets: [
    { upTo: 57375, rate: 0.145 }, { upTo: 114750, rate: 0.205 },
    { upTo: 177882, rate: 0.26 }, { upTo: 253414, rate: 0.29 },
    { upTo: Infinity, rate: 0.33 },
  ],
}
const ON_2025: TaxTable = {
  bpa: 12747,
  brackets: [
    { upTo: 52886, rate: 0.0505 }, { upTo: 105775, rate: 0.0915 },
    { upTo: 150000, rate: 0.1116 }, { upTo: 220000, rate: 0.1216 },
    { upTo: Infinity, rate: 0.1316 },
  ],
}

const TAX_2025_FEDERAL = 'https://www.canada.ca/en/department-finance/news/2025/05/delivering-a-middle-class-tax-cut.html'
const TAX_2025_ON = 'https://www.canada.ca/content/dam/cra-arc/migration/cra-arc/tx/bsnss/tpcs/pyrll/t4032/2025/t4032-on-7-25e.pdf'
const TAX_2026_PDF = (jurisdiction: string) => `https://www.canada.ca/content/dam/cra-arc/migration/cra-arc/tx/bsnss/tpcs/pyrll/t4032/2026/t4032-${jurisdiction.toLowerCase()}-1-26e.pdf`
const QC_2026 = 'https://www.finances.gouv.qc.ca/Budget_et_mise_a_jour/maj/documents/AUTFR_RegimeImpot2026.pdf'
const CRA_2026_RATES = 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/current-year.html'
const BC_2026_JULY = 'https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032bc-july/t4032bc-july-general-information.html'
const NL_2026_JULY = 'https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4008-payroll-deductions-supplementary-tables/t4008nl-july/t4008nl-july-general-information.html'
const PE_2026_GOV = 'https://www.princeedwardisland.ca/en/information/finance-and-affordability/provincial-personal-income-tax'
/**
 * The figures `tax.ts` reads straight from `taxData.ts` rather than from a
 * pack, listed once so no pack can claim to govern a figure it does not carry.
 * They are the same for every jurisdiction except the provincial premiums and
 * levies, which only Ontario and Quebec charge.
 */
const TAX_UNCOVERED_COMMON: TaxUnsupportedPath[] = [
  { id: 'federal-age-pension-amounts',
    reason: 'The federal age amount and pension income amount are pinned 2026 figures in taxData.ts with no tax-year selection, so an assumed future year carries them forward unchanged.' },
  { id: 'provincial-age-pension-amounts',
    reason: 'Each jurisdiction\u2019s age amount, pension income amount and senior supplement are pinned 2026 figures in taxData.ts with no tax-year selection.' },
  { id: 'spouse-credit',
    reason: 'The spouse/common-law-partner amounts and their income tests (spouseCredit2026.ts) are pinned 2026 figures and are not selected by tax year.' },
  { id: 'low-income-tax-reductions',
    reason: 'Provincial low-income tax reductions and refundable credits (for example Ontario\u2019s LIFT credit) are not modelled at all, so no result priced by this pack is a complete provincial return.' },
  { id: 'capital-gains-inclusion',
    reason: 'The capital-gains inclusion rate (taxData.ts CAPITAL_GAINS_INCLUSION) is a pinned statutory share rather than a bracket, and is not selected by tax year.' },
  { id: 'probate-fees',
    reason: 'Probate and estate administration fees (taxData.ts PROBATE_RATES) are pinned 2026 figures outside this tax pack; the projection prices `probateFee` from them.' },
  { id: 'gst-hst-and-cash-benefits',
    reason: 'The GST/HST credit and provincial cash benefits are not modelled, so no result priced by this pack may be read as a complete after-tax or after-benefit position.' },
]
const TAX_UNCOVERED_BY_JURISDICTION: Partial<Record<Province, TaxUnsupportedPath>> = {
  ON: { id: 'provincial-premiums-and-levies',
    reason: 'Ontario surtax and the Ontario Health Premium (taxData.ts ON_SURTAX, ON_HEALTH_PREMIUM) are pinned figures with no tax-year selection.' },
  QC: { id: 'provincial-premiums-and-levies',
    reason: 'Quebec\u2019s federal abatement, the Fonds des services de sant\u00e9 contribution and the RAMQ premium (taxData.ts QC_ABATEMENT, QC_FSS, QC_RAMQ) are pinned figures with no tax-year selection.' },
}
function taxUnsupportedPaths(jurisdiction: Province): TaxUnsupportedPath[] {
  const provincial = TAX_UNCOVERED_BY_JURISDICTION[jurisdiction]
  return provincial ? [...TAX_UNCOVERED_COMMON, provincial] : [...TAX_UNCOVERED_COMMON]
}

const TAX_PACKS: TaxRulePack[] = [
  {
    id: 'CA-ON-tax-2025-v1', jurisdiction: 'ON', taxYear: 2025,
    federal: FED_2025, provincial: ON_2025, frozenProvincialBracketIndexes: [2, 3],
    sourceURL: TAX_2025_FEDERAL, effectiveDate: '2025-01-01', verifiedAt: '2026-09-13',
    fieldSources: { federalBrackets: TAX_2025_FEDERAL, federalBpa: TAX_2025_ON,
      provincialBrackets: TAX_2025_ON, provincialBpa: TAX_2025_ON },
    fieldAdditionalSources: { federalBrackets: [TAX_2025_ON] },
    indexationRule: 'cpi-assumption', rounding: 'nearest-dollar', coverage: 'estimated',
    limitation: 'Bracket/BPA snapshot only; other Ontario credits, tax reduction and benefits are not year-switched.',
    unsupportedPaths: taxUnsupportedPaths('ON'),
    assumedFutureRule: false,
  },
  ...Object.entries(PROVINCIAL_2026_SNAPSHOT).map(([jurisdiction, provincial]): TaxRulePack => ({
    id: `CA-${jurisdiction}-tax-2026-legacy-v1`, jurisdiction: jurisdiction as Province,
    taxYear: 2026, federal: FEDERAL_2026_SNAPSHOT, provincial,
    frozenProvincialBracketIndexes: jurisdiction === 'ON' ? [2, 3] : jurisdiction === 'YT' ? [3] : jurisdiction === 'MB' ? [0, 1] : [],
    sourceURL: jurisdiction === 'BC' ? BC_2026_JULY : TAX_2026_PDF(jurisdiction), effectiveDate: '2026-01-01', verifiedAt: '2026-09-13',
    fieldSources: { federalBrackets: TAX_2026_PDF(jurisdiction), federalBpa: TAX_2026_PDF(jurisdiction),
      provincialBrackets: jurisdiction === 'QC' ? QC_2026 : jurisdiction === 'BC' ? BC_2026_JULY : TAX_2026_PDF(jurisdiction),
      provincialBpa: jurisdiction === 'QC' ? QC_2026 : jurisdiction === 'NL' ? NL_2026_JULY : TAX_2026_PDF(jurisdiction) },
    fieldAdditionalSources: jurisdiction === 'PE' ? { provincialBrackets: [PE_2026_GOV] } : undefined,
    additionalSourceURLs: jurisdiction === 'MB' ? [CRA_2026_RATES] : [],
    sourceConflict: jurisdiction === 'MB'
      ? 'CRA generic 2026 rate page lists $47,564/$101,200; dedicated T4032-MB 2026 lists $47,000/$100,000 and $15,780 BPA, matching this retained legacy snapshot. BE-38 B must reconcile legal authority before changing calculations.'
      : jurisdiction === 'PE'
      ? 'Mixed-vintage legacy PE snapshot: January CRA T4032-PE 2026 supports the retained $142,250 fourth threshold at 17.62% and 19% above it. The PE government 2026 table instead lists $142,520 and adds a sixth bracket over $200,000 at 20%. This pack combines the January threshold with the later sixth bracket; BE-38 B must reconcile before changing calculations.'
      : undefined,
    indexationRule: jurisdiction === 'MB' ? 'frozen' : 'cpi-assumption',
    rounding: 'nearest-dollar', coverage: 'estimated',
    limitation: 'Existing engine constants are retained pending BE-38 B. Some provincial values/credits differ from current official tables; this is a versioned legacy snapshot, not a complete 2026 return.',
    unsupportedPaths: taxUnsupportedPaths(jurisdiction as Province),
    assumedFutureRule: false,
  })),
]

const CCB_2025_AMOUNTS = 'https://www.canada.ca/en/employment-social-development/news/2025/07/canada-child-benefit-payments-increasing-in-2025-2026.html'
const CCB_2025_SHEET = 'https://www.canada.ca/en/revenue-agency/services/child-family-benefits/canada-child-benefit/canada-child-benefit-ccb-calculation-sheet-july-2025-june-2026-payments-2024-tax-year.html'
const CCB_2026_AMOUNTS = 'https://www.canada.ca/en/employment-social-development/news/2026/07/canada-child-benefit-payments-increasing-in-2026-2027.html'
/**
 * The CCB base benefit amounts and both phase-out thresholds are published per
 * benefit year on the indexation page (July-to-June program year), and the
 * reduction *rates* are statutory: 7% / 13.5% / 19% / 23% of adjusted family net
 * income above the first threshold, then a further 3.2% / 5.7% / 8% / 9.5%
 * above the second. The published per-bracket first-threshold phase-out amounts
 * are stored alongside them; each is the amount the bracket's 7% / 13.5% / 19%
 * / 23% share of the threshold interval removes up to the second threshold
 * ($6,022 / $38,237 = 15.75% is *not* the applied two-child rate — the applied
 * rate is the statute's 13.5%, and the difference is exactly why the rates are
 * stored as rates and the published amounts as a cross-check). The rates are
 * fixed percentages in the statute and are not themselves indexed, so an
 * assumed future period indexes only the amounts.
 */
const CCB_RATES = 'https://laws-lois.justice.gc.ca/eng/acts/i-3.3/section-122.61.html'
const CCB_PUBLISHED_THRESHOLDS = 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/adjustment-personal-income-tax-benefit-amounts.html'
/** The limits of what this pack prices, each named once with its concrete reason. */
const CCB_UNSUPPORTED_PATHS: BenefitUnsupportedPath[] = [
  { id: 'ccb-prior-year-afni',
    reason: "The Canada Child Benefit is paid on the prior year's adjusted family net income; this calculator tests the same year's income." },
  { id: 'ccb-shared-custody',
    reason: 'A shared-custody child is paid at 50%; this calculator assumes one recipient household and never splits a child count.' },
  { id: 'ccb-child-disability-benefit',
    reason: 'The Child Disability Benefit is a separate supplement with its own $3,480 maximum and is not added to any amount this pack prices.' },
  { id: 'ccb-provincial-top-ups',
    reason: "Provincial child benefits (for example Quebec's Family Allowance) are not modelled, so no result this pack prices is a complete child-benefit position." },
  { id: 'ccb-eligibility-and-residence',
    reason: 'Eligibility facts (residency, immigration status, the 18-month extended-benefit rules) are not tested; the calculator prices a count of eligible children it is given.' },
]
const BENEFIT_PACKS: BenefitRulePack[] = [
  {
    id: 'CA-CCB-2025-07-v1', program: 'CCB', paymentPeriod: '2025-07/2026-06', incomeTaxYear: 2024,
    values: { maxUnder6: 7997, max6to17: 6748, th1: 37487, th2: 81222,
      rate1: [0.07, 0.135, 0.19, 0.23], rate2: [0.032, 0.057, 0.08, 0.095],
      basePhaseOutAmounts: [3061, 5904, 8310, 10059] },
    sourceURL: CCB_2025_AMOUNTS,
    fieldSources: { amounts: CCB_2025_AMOUNTS, thresholds: CCB_PUBLISHED_THRESHOLDS, rates: CCB_RATES },
    additionalSourceURLs: [CCB_2025_SHEET],
    effectiveDate: '2025-07-01', verifiedAt: '2026-09-13', indexationRule: 'cpi-assumption',
    rounding: 'nearest-dollar', coverage: 'estimated',
    limitation: 'Federal CCB parameter snapshot only; projection still approximates AFNI and has no prior-year lag or provincial top-ups.',
    unsupportedPaths: CCB_UNSUPPORTED_PATHS,
    assumedFutureRule: false,
  },
  {
    id: 'CA-CCB-2026-07-v1', program: 'CCB', paymentPeriod: '2026-07/2027-06', incomeTaxYear: 2025,
    values: { maxUnder6: 8157, max6to17: 6883, th1: 38237, th2: 82847,
      rate1: [0.07, 0.135, 0.19, 0.23], rate2: [0.032, 0.057, 0.08, 0.095],
      basePhaseOutAmounts: [3123, 6022, 8476, 10260] },
    sourceURL: CCB_2026_AMOUNTS,
    fieldSources: { amounts: CCB_2026_AMOUNTS, thresholds: CCB_PUBLISHED_THRESHOLDS, rates: CCB_RATES },
    additionalSourceURLs: [CCB_PUBLISHED_THRESHOLDS],
    effectiveDate: '2026-07-01', verifiedAt: '2026-09-13', indexationRule: 'cpi-assumption',
    rounding: 'nearest-dollar', coverage: 'estimated',
    limitation: 'Federal CCB parameter snapshot only; projection still approximates AFNI and has no prior-year lag or provincial top-ups.',
    unsupportedPaths: CCB_UNSUPPORTED_PATHS,
    assumedFutureRule: false,
  },
]

const FHSA_PARTICIPATING = 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/first-home-savings-account/contributing-your-fhsa.html'
const FHSA_DEFINITIONS = 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/first-home-savings-account/definitions.html'
/**
 * The FHSA annual and lifetime limits are fixed dollar amounts in the statute
 * with no indexation, so this pack needs no tax year. It is one pack, not one
 * per province: an FHSA is federal.
 */
const FHSA_PACKS: FhsaRulePack[] = [
  {
    id: 'CA-FHSA-limit-v1',
    annualLimit: 8000,
    lifetimeLimit: 40000,
    participationRoomCarryForwardLimit: 8000,
    sourceURL: FHSA_PARTICIPATING,
    fieldSources: {
      annualLimit: FHSA_PARTICIPATING,
      lifetimeLimit: FHSA_DEFINITIONS,
      participationRoomCarryForwardLimit: FHSA_DEFINITIONS,
    },
    additionalSourceURLs: [FHSA_DEFINITIONS],
    effectiveDate: '2023-04-01', verifiedAt: '2026-02-05', indexationRule: 'frozen',
    rounding: 'nearest-dollar', coverage: 'modeled',
    limitation: 'The $8,000 annual limit, the $40,000 lifetime limit and the $8,000 participation-room carryforward maximum are statutory federal figures and are not indexed. The year\u2019s spendable room is the published annual limit plus at most the carryforward maximum (the CRA participation-room formula is unused re-participation room plus the lesser of $8,000 plus participation-room carryforward less the prior excess, or $40,000 less prior contributions and transfers), and the lifetime limit bounds that whole total, so a carried-in room can never be spent on top of the remaining lifetime room. The ledger does not add back FHSA re-participation room, designated amounts or taxable withdrawals, and does not model the excess-FHSA-amount tax, so those unmodelled amounts can only reduce the room it reports; it never reports room the published limits would not allow.',
    assumedFutureRule: false,
  },
]

function validDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day
}
function validURL(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname }
  catch { return false }
}
function amount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
function validTable(value: unknown): value is TaxTable {
  const table = value as Partial<TaxTable> | null
  if (!table || !amount(table.bpa) ||
      (table.bpaMin !== undefined && (!amount(table.bpaMin) || table.bpaMin > table.bpa)) ||
      !Array.isArray(table.brackets) || table.brackets.length === 0) return false
  if (table.bpaPhaseOut && (!amount(table.bpaPhaseOut.from) || !amount(table.bpaPhaseOut.to) ||
      !amount(table.bpaPhaseOut.min) || table.bpaPhaseOut.from >= table.bpaPhaseOut.to ||
      table.bpaPhaseOut.min > table.bpa)) return false
  let previous = 0
  for (const [index, bracket] of table.brackets.entries()) {
    if (!bracket || typeof bracket.rate !== 'number' || !Number.isFinite(bracket.rate) ||
        bracket.rate < 0 || bracket.rate > 1 || typeof bracket.upTo !== 'number' ||
        (!Number.isFinite(bracket.upTo) && bracket.upTo !== Infinity) ||
        bracket.upTo <= previous || (bracket.upTo === Infinity) !== (index === table.brackets.length - 1)) return false
    previous = bracket.upTo
  }
  return true
}
const OAS_GIS_2026_Q3_URL = 'https://www.canada.ca/en/employment-social-development/programs/pensions/pension/statistics/2026-quarterly-july-september.html'
const OAS_GIS_TABLES_URL = 'https://open.canada.ca/data/en/dataset/dfa4daf1-669e-4514-82cd-982f27707ed0'
const ALLOWANCE_AMOUNT_URL = 'https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/guaranteed-income-supplement/allowance/benefit-amount.html'
/**
 * The four published tables of monthly amounts by income bracket that the
 * reduction segments are fitted to. They are resources of the same
 * open.canada.ca dataset; citing the dataset alone would not say which
 * household shape a fit came from.
 */
const GIS_TABLE_1_SINGLE_URL = 'https://open.canada.ca/data/en/dataset/dfa4daf1-669e-4514-82cd-982f27707ed0/resource/0a7918f0-6e8a-433b-9ea2-60e2b8674cb5/download/table1_gis_for_single_who_receives_oas_pension_july2026.csv'
const GIS_TABLE_2_SPOUSE_OAS_URL = 'https://open.canada.ca/data/en/dataset/dfa4daf1-669e-4514-82cd-982f27707ed0/resource/5efa3920-83f6-4108-bb51-db2456e7b37c/download/table2_gis_for_spouse_of_someone_receiving_oas_pension_july2026.csv'
const GIS_TABLE_3_SPOUSE_NO_OAS_URL = 'https://open.canada.ca/data/en/dataset/dfa4daf1-669e-4514-82cd-982f27707ed0/resource/b4e1258c-2a72-4c64-b202-d0ab6aa2d21a/download/table3_gis_for_spouse_of_someone_who_does_not_receive_oas_pension_july2026.csv'
const GIS_TABLE_4_ALLOWANCE_URL = 'https://open.canada.ca/data/en/dataset/dfa4daf1-669e-4514-82cd-982f27707ed0/resource/89b0fa2c-af49-4fb5-a74c-1cf2268fb521/download/table4_gis_and_allowance_for_couple_july2026.csv'

/** Both pensioners' household maximum: the table publishes one pensioner's. */
/** Published maximum monthly payments, whole household (ESDC Table 5). */
const SINGLE_MONTHLY = 1123.17
const ALLOWANCE_SPOUSE_MONTHLY = 676.09
/**
 * The both-pensioners row is published per pensioner; the household receives
 * one each, so the category's own maximum is two of them.
 */
const BOTH_PENSIONERS_MONTHLY = 2 * ALLOWANCE_SPOUSE_MONTHLY
const ALLOWANCE_MONTHLY = 1428.06
/** Published annual income cut-offs, one per household shape (ESDC Table 5). */
const SINGLE_CUTOFF = 22800
const BOTH_PENSIONERS_CUTOFF = 30096
const ALLOWANCE_CUTOFF = 42144
const NO_OAS_CUTOFF = 54624
/** Published annual income cut-offs for the GIS/Allowance top-ups (Table 5). */
const SINGLE_TOP_UP = 10352
const NO_OAS_TOP_UP = 20704
const ALLOWANCE_TOP_UP = 8800

/**
 * BE-26 A (corrected): the reduction segments below are a *fit* to the
 * published tables of monthly amounts, not a published formula. Table 5 of the
 * quarterly page publishes each household shape's maximum, income cut-off and
 * top-up income cut-off; the four companion tables publish the amount for
 * every income bracket. Only those published figures are labelled published
 * here.
 *
 * Every earlier version of this model drew one straight line from a flat
 * "top-up band" to the cut-off. That was wrong twice over: the single row has
 * no flat band at all (its table falls from the first $24 bracket), and the
 * one-pensioner Allowance row is not flat either (its pensioner-side GIS falls
 * with income, and the Allowance falls faster). Both rows are now fitted to
 * the slope changes their own tables show.
 *
 * Breakpoints: 10,352 / 20,704 / 8,800 are the published top-up income
 * cut-offs; 2,048 / 4,096 / 12,048 and the two fractional values are where the
 * published table's slope changes, the fractional ones placed so the fit
 * passes through the published amount at the table's top-up cut-off and on its
 * final plateau.
 */
function gisCategoryRules(): Record<GisHouseholdRuleCategory, GisCategoryRule> {
  return {
    single: {
      maxMonthly: SINGLE_MONTHLY, annualCutoff: SINGLE_CUTOFF,
      reductionSegments: [
        { rate: 0.5, upTo: 2048 },
        { rate: 0.75, upTo: SINGLE_TOP_UP },
        // The last rate is set so the fit reaches zero exactly at the
        // published 22,800 cut-off rather than a few dollars past it.
        { rate: 0.500164, upTo: Infinity },
      ],
      maxMonthlyDeviation: 1,
      fieldSources: {
        maxMonthly: OAS_GIS_2026_Q3_URL,
        annualCutoff: OAS_GIS_2026_Q3_URL,
        reductionSegments: GIS_TABLE_1_SINGLE_URL,
      },
    },
    'couple-both-pensioners': {
      maxMonthly: BOTH_PENSIONERS_MONTHLY, annualCutoff: BOTH_PENSIONERS_CUTOFF,
      reductionSegments: [
        { rate: 0.5, upTo: 4096 },
        { rate: 0.75, upTo: ALLOWANCE_TOP_UP },
        { rate: 0.5001026, upTo: Infinity },
      ],
      maxMonthlyDeviation: 2,
      fieldSources: {
        maxMonthly: OAS_GIS_2026_Q3_URL,
        annualCutoff: OAS_GIS_2026_Q3_URL,
        reductionSegments: GIS_TABLE_2_SPOUSE_OAS_URL,
      },
    },
    'couple-partner-allowance': {
      maxMonthly: ALLOWANCE_SPOUSE_MONTHLY, annualCutoff: ALLOWANCE_CUTOFF,
      // The pensioner's own GIS on this row is not flat: Table 4 shows it
      // falling with the Allowance until it levels off at its own $259.41
      // plateau, which is what the spouse-with-neither row pays at the same
      // income. That plateau is what makes the hand-off at 42,144 continuous.
      reductionSegments: [
        { rate: 0, upTo: 4096 },
        { rate: 0.125, upTo: ALLOWANCE_TOP_UP },
        { rate: 0, upTo: 12048 },
        { rate: 0.25, upTo: 29696.64 },
        { rate: 0, upTo: Infinity },
      ],
      maxMonthlyDeviation: 3,
      fieldSources: {
        maxMonthly: OAS_GIS_2026_Q3_URL,
        annualCutoff: OAS_GIS_2026_Q3_URL,
        reductionSegments: GIS_TABLE_4_ALLOWANCE_URL,
      },
    },
    'couple-partner-no-oas-no-allowance': {
      maxMonthly: SINGLE_MONTHLY, annualCutoff: NO_OAS_CUTOFF,
      reductionSegments: [
        { rate: 0, upTo: 4096 },
        { rate: 0.125, upTo: 8977.44 },
        { rate: 0.375, upTo: NO_OAS_TOP_UP },
        // Two closing segments: the published amount is reproduced exactly at
        // the 42,144 Allowance hand-off, and the fit still reaches zero at the
        // published 54,624 cut-off rather than 38 dollars before it.
        { rate: 0.25, upTo: ALLOWANCE_CUTOFF },
        { rate: 0.249231, upTo: Infinity },
      ],
      maxMonthlyDeviation: 1.81,
      fieldSources: {
        maxMonthly: OAS_GIS_2026_Q3_URL,
        annualCutoff: OAS_GIS_2026_Q3_URL,
        reductionSegments: GIS_TABLE_3_SPOUSE_NO_OAS_URL,
      },
    },
  }
}

/**
 * The Allowance's own published maximum, top-up income cut-off and income
 * cut-off (Table 5), with the reduction fitted to Table 4's Allowance column.
 * It never borrows a GIS maximum: 1,428.06 is the Allowance's own figure.
 */
function allowanceRule(): GisAllowanceRule {
  return {
    maxMonthly: ALLOWANCE_MONTHLY, annualCutoff: ALLOWANCE_CUTOFF, topUpIncome: ALLOWANCE_TOP_UP,
    reductionSegments: [
      { rate: 0.75, upTo: 4096 },
      { rate: 0.875, upTo: ALLOWANCE_TOP_UP },
      { rate: 0.75, upTo: 12048 },
      // Reaches zero exactly at the published 42,144 cut-off.
      { rate: 0.2496258, upTo: Infinity },
    ],
    maxMonthlyDeviation: 3,
    fieldSources: {
      maxMonthly: ALLOWANCE_AMOUNT_URL,
      annualCutoff: ALLOWANCE_AMOUNT_URL,
      topUpIncome: OAS_GIS_2026_Q3_URL,
      reductionSegments: GIS_TABLE_4_ALLOWANCE_URL,
    },
  }
}

/** Short names for the limitation text, so it never states a bound by hand. */
const GIS_CATEGORY_LABEL: Record<GisHouseholdRuleCategory, string> = {
  single: 'single',
  'couple-both-pensioners': 'both pensioners',
  'couple-partner-allowance': 'Allowance spouse',
  'couple-partner-no-oas-no-allowance': 'spouse with neither',
}

/** The fitted bounds, read off the rules so the limitation cannot drift from them. */
function deviationSummary(
  categories: Record<GisHouseholdRuleCategory, GisCategoryRule>,
  allowance: GisAllowanceRule,
): string {
  const perCategory = (Object.keys(categories) as GisHouseholdRuleCategory[])
    .map(key => `${GIS_CATEGORY_LABEL[key]} $${categories[key].maxMonthlyDeviation.toFixed(2)}`)
  return [...perCategory, `Allowance $${allowance.maxMonthlyDeviation.toFixed(2)}`].join(', ')
}

/**
 * The paths this pack does not price. Each is an explicit reason a caller can
 * surface, rather than free text inside a limitation a user never sees.
 */
const GIS_UNSUPPORTED_PATHS: GisUnsupportedPath[] = [
  { id: 'prior-year-base-period',
    reason: "GIS and the Allowance test the prior year's income (2025 for the 2026-07/2026-09 quarter); this calculator tests the same year's income." },
  { id: 'retirement-year-income-estimate',
    reason: 'The first payment year uses an estimated retirement-year income; this calculator does not estimate one.' },
  { id: 'ccb-historical-income',
    reason: "The Canada Child Benefit is paid on the prior year's adjusted family net income; this calculator uses the same year's income." },
  { id: 'provincial-top-ups',
    reason: 'Provincial GIS or Allowance top-ups (for example Quebec\'s) are not modelled.' },
]

/** The tolerance every fitted reduction in this pack is held to, in dollars a month. */
export const DEVIATION_TOLERANCE = 3.25

/**
 * July-September 2026 amounts. The maximums, income cut-offs and top-up income
 * cut-offs are transcribed from the published quarterly table (Table 5); the
 * reduction shape is fitted to the four companion tables of monthly amounts by
 * income bracket, and the fit's measured bound is recorded on each rule.
 */
const GIS_CATEGORIES_2026_Q3: Record<GisHouseholdRuleCategory, GisCategoryRule> = gisCategoryRules()
const GIS_ALLOWANCE_2026_Q3: GisAllowanceRule = allowanceRule()

const GIS_PACKS: GisRulePack[] = [
  {
    id: 'CA-OAS-GIS-2026-Q3-v1',
    program: 'GIS',
    paymentPeriod: '2026-07/2026-09',
    basedOnIncomeYear: 2025,
    categories: GIS_CATEGORIES_2026_Q3,
    allowance: GIS_ALLOWANCE_2026_Q3,
    unsupportedPaths: GIS_UNSUPPORTED_PATHS,
    sourceURL: OAS_GIS_2026_Q3_URL,
    additionalSourceURLs: [OAS_GIS_TABLES_URL, ALLOWANCE_AMOUNT_URL],
    effectiveDate: '2026-07-01', verifiedAt: '2026-09-14',
    indexationRule: 'cpi-assumption',
    rounding: 'nearest-dollar', coverage: 'estimated',
    limitation: 'Maximums, income cut-offs and top-up income cut-offs are the published July-September 2026 figures for each household shape (single; both pensioners; pensioner with an Allowance spouse; pensioner whose spouse has neither OAS nor the Allowance) and are reproduced exactly. The reduction is a piecewise-linear FIT to the published tables of monthly amounts by income bracket, not a published formula: at every published bracket boundary the modelled monthly amount is within the fitted bound recorded on each rule (' +
      deviationSummary(GIS_CATEGORIES_2026_Q3, GIS_ALLOWANCE_2026_Q3) +
      ') of its published table, and never more than $' + DEVIATION_TOLERANCE.toFixed(2) + '; the tests sweep the published range and fail if a fit drifts past its recorded bound. The tables publish $1 steps within brackets up to 48 dollars wide, so inside a bracket a continuous fit can differ from the rounded published amount by up to the step it is on. The Allowance is fitted from its own published maximum, 8,800 top-up income and 42,144 cut-off; the pensioner-side GIS follows its published Allowance-row table rather than staying flat, which is what keeps the household amount continuous when the Allowance ends at 42,144 and the household moves to the spouse-with-neither row. Not modelled: the Allowance for the Survivor, and the four paths listed in `unsupportedPaths`. Employment-income exemption: the first $5,000 of employment or self-employment income is excluded from the test, plus half of the next $10,000.',
    assumedFutureRule: false,
  },
]

/** A published shape's reduction segments must be ordered and end at Infinity. */
function validReductionSegments(segments: GisReductionSegment[] | undefined): boolean {
  if (!Array.isArray(segments) || segments.length === 0) return false
  let previous = 0
  return segments.every((segment, index) => {
    const last = index === segments.length - 1
    // A rate above 1 is legitimate: the reduction removes annual dollars from
    // an annualized maximum. A negative or non-finite rate never is.
    const ok = Number.isFinite(segment.rate) && segment.rate >= 0 && segment.rate < 12 &&
      (last ? segment.upTo === Infinity : Number.isFinite(segment.upTo) && segment.upTo > previous)
    previous = segment.upTo
    return ok
  })
}

/** A claimed fit bound must be a small, finite, positive number of dollars. */
function validDeviation(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= DEVIATION_TOLERANCE
}

/** Every path a pack knowingly does not price is named once, with a reason a caller can show. */
function validUnsupportedPaths(paths: { id: string; reason: string }[] | undefined): boolean {
  return Array.isArray(paths) &&
    new Set(paths.map(path => path.id)).size === paths.length &&
    paths.every(path => typeof path.id === 'string' && path.id.trim().length > 0 &&
      typeof path.reason === 'string' && path.reason.trim().length > 0)
}

function validGisPack(p: Partial<GisRulePack>): boolean {
  const categories: GisHouseholdRuleCategory[] = ['single', 'couple-both-pensioners',
    'couple-partner-allowance', 'couple-partner-no-oas-no-allowance']
  return !!p.categories && categories.every(key => {
    const rule = p.categories?.[key]
    if (!rule || !(rule.maxMonthly > 0) || !(rule.annualCutoff > 0)) return false
    return validReductionSegments(rule.reductionSegments) && validDeviation(rule.maxMonthlyDeviation) &&
      validURL(rule.fieldSources?.maxMonthly) && validURL(rule.fieldSources?.annualCutoff) &&
      validURL(rule.fieldSources?.reductionSegments)
  }) && !!p.allowance && p.allowance.maxMonthly > 0 && p.allowance.annualCutoff > 0 &&
    p.allowance.topUpIncome >= 0 && p.allowance.topUpIncome < p.allowance.annualCutoff &&
    validReductionSegments(p.allowance.reductionSegments) && validDeviation(p.allowance.maxMonthlyDeviation) &&
    !!p.allowance.fieldSources && Object.values(p.allowance.fieldSources).every(validURL) &&
    Array.isArray(p.unsupportedPaths) && p.unsupportedPaths.length > 0 &&
    validUnsupportedPaths(p.unsupportedPaths)
}

function validTaxPack(meta: RulePackMeta, p: Partial<TaxRulePack>): boolean {
  return typeof p.jurisdiction === 'string' && Object.hasOwn(PROVINCIAL_2026_SNAPSHOT, p.jurisdiction) &&
    Number.isInteger(p.taxYear) && (p.taxYear ?? 0) >= 1900 &&
    meta.effectiveDate?.slice(0, 4) === String(p.taxYear) &&
    validTable(p.federal) && validTable(p.provincial) &&
    Array.isArray(p.frozenProvincialBracketIndexes) &&
    new Set(p.frozenProvincialBracketIndexes).size === p.frozenProvincialBracketIndexes.length &&
    p.frozenProvincialBracketIndexes.every(i => Number.isInteger(i) && i >= 0 && i < p.provincial!.brackets.length - 1) &&
    // Every figure this pack does not year-switch must be named with a reason.
    validUnsupportedPaths(p.unsupportedPaths) &&
    // An assumed pack must say which published year it was indexed from, so the
    // elapsed-year count is auditable rather than implied by its id.
    (!p.assumedFutureRule || (Number.isInteger(p.basedOnTaxYear) && (p.basedOnTaxYear ?? 0) < (p.taxYear ?? 0))) &&
    !!p.fieldSources && Object.values(p.fieldSources).every(validURL) &&
    (p.fieldAdditionalSources === undefined || (!!p.fieldAdditionalSources && typeof p.fieldAdditionalSources === 'object' &&
      Object.entries(p.fieldAdditionalSources).every(([key, urls]) =>
        ['federalBrackets', 'federalBpa', 'provincialBrackets', 'provincialBpa'].includes(key) &&
        Array.isArray(urls) && urls.length > 0 && urls.every(url => validURL(url))))) &&
    ['federalBrackets', 'federalBpa', 'provincialBrackets', 'provincialBpa']
      .every(k => validURL(p.fieldSources?.[k as keyof typeof p.fieldSources]))
}

function validBenefitPack(meta: RulePackMeta, p: Partial<BenefitRulePack>): boolean {
  const start = Number(p.paymentPeriod?.slice(0, 4))
  // A child-count bracket is a four-entry rate (or dollar) row, one per
  // eligible-child count 1, 2, 3, 4-or-more: a shorter row would silently price
  // a larger family off `undefined`.
  const bracket = (value: unknown): value is ChildCountBracket =>
    Array.isArray(value) && value.length === 4 && value.every(amount)
  const values = p.values
  return p.program === 'CCB' && Number.isInteger(start) && start >= 1900 &&
    p.paymentPeriod === `${start}-07/${start + 1}-06` && p.incomeTaxYear === start - 1 &&
    meta.effectiveDate === `${start}-07-01` && !!values &&
    ['maxUnder6', 'max6to17', 'th1', 'th2'].every(k => amount(values?.[k as keyof CcbValues])) &&
    (values.maxUnder6 ?? 0) > 0 && (values.max6to17 ?? 0) > 0 &&
    (values.th1 ?? 0) < (values.th2 ?? 0) &&
    bracket(values.rate1) && bracket(values.rate2) &&
    // A reduction rate is a fraction of income; the second-threshold rate can
    // never exceed the first, or the reduction would accelerate with income.
    values.rate1.every(rate => rate > 0 && rate <= 1) && values.rate2.every(rate => rate >= 0 && rate <= 1) &&
    values.rate1.every((rate, index) => index === 0 || rate >= values.rate1[index - 1]) &&
    values.rate2.every((rate, index) => index === 0 || rate >= values.rate2[index - 1]) &&
    values.rate2.every((rate, index) => rate <= values.rate1[index]) &&
    bracket(values.basePhaseOutAmounts) && values.basePhaseOutAmounts.every(value => value > 0) &&
    validUnsupportedPaths(p.unsupportedPaths) && (p.unsupportedPaths?.length ?? 0) > 0 &&
    // An assumed period must say which published period it was indexed from,
    // and the two must not be the same period.
    (!p.assumedFutureRule || (typeof p.basedOnPaymentPeriod === 'string' &&
      p.basedOnPaymentPeriod !== p.paymentPeriod &&
      /^\d{4}-07\/\d{4}-06$/.test(p.basedOnPaymentPeriod))) &&
    !!p.fieldSources && validURL(p.fieldSources.amounts) && validURL(p.fieldSources.thresholds) &&
    validURL(p.fieldSources.rates)
}

function validFhsaPack(p: Partial<FhsaRulePack>): boolean {
  return amount(p.annualLimit) && amount(p.lifetimeLimit) && amount(p.participationRoomCarryForwardLimit) &&
    p.annualLimit > 0 && p.lifetimeLimit >= p.annualLimit &&
    p.participationRoomCarryForwardLimit > 0 && !!p.fieldSources &&
    validURL(p.fieldSources.annualLimit) && validURL(p.fieldSources.lifetimeLimit) &&
    validURL(p.fieldSources.participationRoomCarryForwardLimit)
}

export function publishRulePack<T extends TaxRulePack | BenefitRulePack | FhsaRulePack | GisRulePack>(candidate: unknown): T {
  const meta = candidate as RulePackMeta
  if (!meta || typeof meta.id !== 'string' || !meta.id.trim() || !validURL(meta.sourceURL) ||
      !validDate(meta.effectiveDate) || !validDate(meta.verifiedAt) ||
      !['cpi-assumption', 'frozen'].includes(meta.indexationRule ?? '') ||
      meta.rounding !== 'nearest-dollar' || !['modeled', 'estimated', 'unsupported'].includes(meta.coverage ?? '') ||
      typeof meta.limitation !== 'string' || !meta.limitation.trim() || typeof meta.assumedFutureRule !== 'boolean' ||
      (meta.additionalSourceURLs !== undefined && (!Array.isArray(meta.additionalSourceURLs) || meta.additionalSourceURLs.some(url => !validURL(url)))) ||
      (meta.assumedFutureRule && (!amount(meta.assumedAnnualRate) || meta.assumedAnnualRate > 1 || !meta.basedOnRuleId)) ||
      Number('jurisdiction' in meta) + Number('program' in meta) + Number('annualLimit' in meta) !== 1) throw new Error('Rule pack lacks publication metadata')
  // A tax table, a CCB period, the FHSA limits and the GIS categories are
  // published in different shapes; exactly one discriminator is present.
  const p = candidate as Partial<TaxRulePack> & Partial<BenefitRulePack> & Partial<FhsaRulePack> & Partial<GisRulePack>
  if ('jurisdiction' in p) {
    if (!validTaxPack(meta, p)) throw new Error('Tax pack lacks valid values, sources or scope')
  } else if ('annualLimit' in p) {
    if (!validFhsaPack(p)) throw new Error('FHSA pack lacks valid limits or sources')
  } else if (p.program === 'GIS') {
    if (typeof p.paymentPeriod !== 'string' || !/^\d{4}-07\/\d{4}-09$/.test(p.paymentPeriod) ||
        p.paymentPeriod.slice(0, 4) !== (meta.effectiveDate ?? '').slice(0, 4) ||
        !Number.isInteger(p.basedOnIncomeYear) || (p.basedOnIncomeYear ?? 0) < 1900 ||
        p.basedOnIncomeYear !== Number(meta.effectiveDate?.slice(0, 4)) - 1 || !validGisPack(p))
      throw new Error('GIS pack lacks valid category rules, cut-offs or sources')
  } else if (!validBenefitPack(meta, p)) {
    throw new Error('Benefit pack lacks valid values, sources or period')
  }
  return candidate as T
}
TAX_PACKS.forEach(pack => publishRulePack(pack))
BENEFIT_PACKS.forEach(pack => publishRulePack(pack))
FHSA_PACKS.forEach(pack => publishRulePack(pack))
GIS_PACKS.forEach(pack => publishRulePack(pack))

function indexed(value: number, years: number, rate: number): number {
  return Number.isFinite(value) ? Math.round(value * (1 + rate) ** years) : value
}
function projectTable(table: TaxTable, years: number, rate: number, frozen: number[]): TaxTable {
  return {
    ...table,
    bpa: indexed(table.bpa, years, rate),
    bpaMin: table.bpaMin === undefined ? undefined : indexed(table.bpaMin, years, rate),
    bpaPhaseOut: table.bpaPhaseOut && {
      from: indexed(table.bpaPhaseOut.from, years, rate),
      to: indexed(table.bpaPhaseOut.to, years, rate),
      min: indexed(table.bpaPhaseOut.min, years, rate),
    },
    brackets: table.brackets.map((b, i) => ({ ...b, upTo: frozen.includes(i) ? b.upTo : indexed(b.upTo, years, rate) })),
  }
}
const PUBLISHED_JURISDICTIONS: string[] = Object.keys(PROVINCIAL_2026_SNAPSHOT).sort()
/**
 * Why a (jurisdiction, tax year) request cannot be priced, or null when it can.
 * Each distinct failure gets its own concrete reason: a caller must never read
 * "no pack for this year" as "unknown jurisdiction", and an unknown
 * jurisdiction is never answered with another jurisdiction's table.
 */
function taxRefusalReason(jurisdiction: string, taxYear: number, future?: { annualRate: number }): string | null {
  if (!Object.hasOwn(PROVINCIAL_2026_SNAPSHOT, jurisdiction))
    return `unknown tax jurisdiction "${String(jurisdiction)}": published packs cover ${PUBLISHED_JURISDICTIONS.join(', ')}`
  if (!Number.isInteger(taxYear))
    return `tax year "${String(taxYear)}" for ${jurisdiction} is not a whole calendar year`
  if (TAX_PACKS.some(pack => pack.jurisdiction === jurisdiction && pack.taxYear === taxYear)) return null
  const base = TAX_PACKS.filter(pack => pack.jurisdiction === jurisdiction && pack.taxYear < taxYear).at(-1)
  if (!base) {
    const years = TAX_PACKS.filter(pack => pack.jurisdiction === jurisdiction)
      .map(pack => pack.taxYear).sort((a, b) => a - b)
    return years.length === 0
      ? `no published tax rule pack covers ${jurisdiction}`
      : `no published tax rule pack for ${jurisdiction} tax year ${taxYear}: published years are ${years.join(', ')}`
  }
  if (!future || !Number.isFinite(future.annualRate) || future.annualRate < 0 || future.annualRate > 1)
    return `tax year ${taxYear} is not published for ${jurisdiction} (latest published year ${base.taxYear}); pass an explicit future indexation rate between 0 and 1`
  return null
}
export function selectTaxRules(jurisdiction: string, taxYear: number, future?: { annualRate: number }): TaxRulePack {
  const refusal = taxRefusalReason(jurisdiction, taxYear, future)
  if (refusal) throw new Error(refusal)
  const exact = TAX_PACKS.find(p => p.jurisdiction === jurisdiction && p.taxYear === taxYear)
  if (exact) return structuredClone(exact)
  const base = TAX_PACKS.filter(p => p.jurisdiction === jurisdiction && p.taxYear < taxYear).at(-1)!
  const years = taxYear - base.taxYear
  // The pack's own indexation policy decides what freezes; the caller's rate is
  // the once-a-year indexation applied to everything the pack does not freeze.
  // Projecting always starts from the published pack, so a year is never
  // re-indexed on top of an already-indexed value.
  const rate = base.indexationRule === 'frozen' ? 0 : future!.annualRate
  const projected: TaxRulePack = {
    ...base, id: `${base.id}+assumed-${taxYear}-${rate}`, taxYear,
    effectiveDate: `${taxYear}-01-01`,
    federal: projectTable(base.federal, years, future!.annualRate, []),
    provincial: projectTable(base.provincial, years, rate, base.frozenProvincialBracketIndexes),
    assumedFutureRule: true, assumedAnnualRate: future!.annualRate, basedOnRuleId: base.id,
    basedOnTaxYear: base.taxYear,
    coverage: 'estimated',
  }
  // Frozen upper bounds can be overtaken by earlier indexed bounds. Never return an invalid pack.
  if (!validTable(projected.federal) || !validTable(projected.provincial))
    throw new Error('Projected tax bracket collision or invalid indexed value')
  return publishRulePack<TaxRulePack>(projected)
}
/** The programs a published pack exists for; a caller can be told what is covered. */
export const PUBLISHED_BENEFIT_PROGRAMS: string[] = [...new Set(BENEFIT_PACKS.map(p => p.program))].sort()
/** The payment periods the packs publish, oldest first, for a concrete refusal message. */
function publishedBenefitPeriods(program: string): string[] {
  return BENEFIT_PACKS.filter(p => p.program === program).map(p => p.paymentPeriod).sort()
}
/**
 * Why a (program, payment period) request cannot be priced, or null when it can.
 * CCB is selected by *payment period* (`2026-07/2027-06` is the July-June
 * program year whose base year is the 2025 tax year), never by a calendar tax
 * year. Each distinct failure gets its own reason: an unknown program is never
 * answered with a CCB pack, a malformed period is never shifted into the
 * published one, and a period before the published ones is never priced at the
 * first published period's amounts.
 */
function benefitRefusalReason(program: string, period: string, future?: { annualRate: number }): string | null {
  if (!PUBLISHED_BENEFIT_PROGRAMS.includes(program))
    return `unknown benefit program "${String(program)}": published packs cover ${PUBLISHED_BENEFIT_PROGRAMS.join(', ')}`
  const match = /^(\d{4})-07\/(\d{4})-06$/.exec(period ?? '')
  if (!match || period !== `${match[1]}-07/${Number(match[1]) + 1}-06`)
    return `benefit payment period "${String(period)}" for ${program} is not a whole July-to-June program year (expected e.g. "2026-07/2027-06")`
  const start = Number(match[1])
  if (BENEFIT_PACKS.some(p => p.program === program && p.paymentPeriod === period)) return null
  const published = publishedBenefitPeriods(program)
  const base = BENEFIT_PACKS
    .filter(p => p.program === program && Number(p.paymentPeriod.slice(0, 4)) < start)
    .sort((a, b) => a.paymentPeriod.localeCompare(b.paymentPeriod)).at(-1)
  if (!base)
    return `no published ${program} rule pack for payment period ${period} and none can be projected: published periods are ${published.join(', ')}, and a later period is projected from the latest of them`
  if (!future || !Number.isFinite(future.annualRate) || future.annualRate < 0 || future.annualRate > 1)
    return `${program} payment period ${period} is not published (latest published period ${base.paymentPeriod}); pass an explicit future indexation rate between 0 and 1`
  return null
}
/**
 * The pack that prices one CCB payment period. A period the packs publish is
 * returned exactly as published; a later one is projected from the *latest*
 * published pack under that pack's own indexation policy, applied exactly once
 * per elapsed program year, and is flagged `assumedFutureRule` with the pack it
 * came from. A frozen pack does not inflate: its values are carried across
 * unchanged. Nothing here consults the clock.
 */
export function selectBenefitRules(program: string, period: string, future?: { annualRate: number }): BenefitRulePack {
  const refusal = benefitRefusalReason(program, period, future)
  if (refusal) throw new Error(refusal)
  const exact = BENEFIT_PACKS.find(p => p.program === program && p.paymentPeriod === period)
  if (exact) return structuredClone(exact)
  const start = Number(period.slice(0, 4))
  const base = BENEFIT_PACKS
    .filter(p => p.program === program && Number(p.paymentPeriod.slice(0, 4)) < start)
    .sort((a, b) => a.paymentPeriod.localeCompare(b.paymentPeriod)).at(-1)!
  const years = start - Number(base.paymentPeriod.slice(0, 4))
  // Only the amounts are indexed. The rates are statutory percentages and the
  // published per-bracket phase-out amounts are a record of a published year,
  // so both are carried across unchanged, however long the horizon.
  const rate = base.indexationRule === 'frozen' ? 0 : future!.annualRate
  const projected: BenefitRulePack = {
    ...base,
    id: `${base.id}+assumed-${start}-${rate}`,
    paymentPeriod: period, incomeTaxYear: start - 1, effectiveDate: `${start}-07-01`,
    values: {
      ...base.values,
      maxUnder6: indexed(base.values.maxUnder6, years, rate),
      max6to17: indexed(base.values.max6to17, years, rate),
      th1: indexed(base.values.th1, years, rate),
      th2: indexed(base.values.th2, years, rate),
    },
    assumedFutureRule: true, assumedAnnualRate: future!.annualRate, basedOnRuleId: base.id,
    basedOnPaymentPeriod: base.paymentPeriod,
    coverage: 'estimated',
  }
  return publishRulePack<BenefitRulePack>(projected)
}
/**
 * The published CCB packs, read-only. Exported so a consumer can look up the
 * period a projected pack was indexed from without parsing an id, and so a
 * test can cross-check a computation against a pack rather than against a
 * second copy of its numbers.
 */
export function publishedBenefitPacks(): BenefitRulePack[] {
  return BENEFIT_PACKS.map(pack => structuredClone(pack))
}
export const publishedTaxCoverage = TAX_PACKS.map(p => ({ jurisdiction: p.jurisdiction, taxYear: p.taxYear, coverage: p.coverage, limitation: p.limitation }))

/**
 * BE-36: the FHSA limits are frozen statute, so there is no year to select and
 * no future projection. A caller that wants a different figure must publish a
 * new pack rather than passing a number in.
 */
export function selectFhsaRules(): FhsaRulePack {
  return structuredClone(FHSA_PACKS[0])
}

/**
 * BE-26 A: the GIS/Allowance amounts are published per quarter with no
 * projection mechanism (a future quarter needs a new pack, not an indexed
 * number), so this selector takes the period and refuses anything else.
 */
export function selectGisRules(period = '2026-07/2026-09'): GisRulePack {
  const exact = GIS_PACKS.find(pack => pack.paymentPeriod === period)
  if (!exact) throw new Error('Unpublished GIS payment period')
  return structuredClone(exact)
}
