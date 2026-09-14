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
  assumedFutureRule: boolean
  assumedAnnualRate?: number
  basedOnRuleId?: string
}
export interface BenefitRulePack extends Provenance {
  id: string
  program: 'CCB'
  paymentPeriod: string
  incomeTaxYear: number
  values: { maxUnder6: number; max6to17: number; th1: number; th2: number }
  fieldSources: { amounts: string; thresholds: string }
  assumedFutureRule: boolean
  assumedAnnualRate?: number
  basedOnRuleId?: string
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

export interface GisCategoryRule {
  /** Published maximum monthly payment for the whole household. */
  maxMonthly: number
  /** Published annual income cut-off for this category. */
  annualCutoff: number
  /**
   * The published reduction, piecewise linear in annual joint income. The
   * official table is not one line from the maximum to the cut-off: the
   * top-up itself reduces, so the second segment is steeper than the first.
   * Each entry's `rate` is the dollars removed from the annual maximum per
   * dollar of annual income inside that segment.
   */
  reductionSegments: { rate: number; upTo: number }[]
  fieldSources: { maxMonthly: string; annualCutoff: string }
}

export interface GisRulePack extends Provenance {
  id: string
  program: 'GIS'
  /** The payment quarter these amounts are published for. */
  paymentPeriod: string
  /** The base calendar year whose income these amounts test. */
  basedOnIncomeYear: number
  categories: Record<GisHouseholdRuleCategory, GisCategoryRule>
  allowance: { maxMonthly: number; annualCutoff: number; topUpIncome: number }
  fieldSources: {
    maxMonthly: string
    annualCutoff: string
    topUpIncome: string
    allowanceMaxMonthly: string
    allowanceAnnualCutoff: string
  }
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
    assumedFutureRule: false,
  })),
]

const BENEFIT_PACKS: BenefitRulePack[] = [
  {
    id: 'CA-CCB-2025-07-v1', program: 'CCB', paymentPeriod: '2025-07/2026-06', incomeTaxYear: 2024,
    values: { maxUnder6: 7997, max6to17: 6748, th1: 37487, th2: 81222 },
    sourceURL: 'https://www.canada.ca/en/revenue-agency/services/child-family-benefits/canada-child-benefit/canada-child-benefit-ccb-calculation-sheet-july-2025-june-2026-payments-2024-tax-year.html',
    fieldSources: { amounts: 'https://www.canada.ca/en/revenue-agency/services/child-family-benefits/canada-child-benefit/canada-child-benefit-ccb-calculation-sheet-july-2025-june-2026-payments-2024-tax-year.html',
      thresholds: 'https://www.canada.ca/en/revenue-agency/services/child-family-benefits/canada-child-benefit/canada-child-benefit-ccb-calculation-sheet-july-2025-june-2026-payments-2024-tax-year.html' },
    effectiveDate: '2025-07-01', verifiedAt: '2026-09-13', indexationRule: 'cpi-assumption',
    rounding: 'nearest-dollar', coverage: 'estimated',
    limitation: 'Federal CCB parameter snapshot only; projection still approximates AFNI and has no prior-year lag or provincial top-ups.',
    assumedFutureRule: false,
  },
  {
    id: 'CA-CCB-2026-07-v1', program: 'CCB', paymentPeriod: '2026-07/2027-06', incomeTaxYear: 2025,
    values: { maxUnder6: 8157, max6to17: 6883, th1: 38237, th2: 82847 },
    sourceURL: 'https://www.canada.ca/en/employment-social-development/news/2026/07/canada-child-benefit-payments-increasing-in-2026-2027.html',
    fieldSources: { amounts: 'https://www.canada.ca/en/employment-social-development/news/2026/07/canada-child-benefit-payments-increasing-in-2026-2027.html',
      thresholds: 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/adjustment-personal-income-tax-benefit-amounts.html' },
    effectiveDate: '2026-07-01', verifiedAt: '2026-09-13', indexationRule: 'cpi-assumption',
    rounding: 'nearest-dollar', coverage: 'estimated',
    limitation: 'Federal CCB parameter snapshot only; projection still approximates AFNI and has no prior-year lag or provincial top-ups.',
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

/** 12 annual dollars per monthly dollar: these tables publish monthly amounts. */
const ANNUAL_PER_MONTHLY = 12
/** Both pensioners' household maximum: the table publishes one pensioner's. */
const BOTH_PENSIONERS_MONTHLY = 2 * 676.09
const SINGLE_MONTHLY = 1123.17
/** Published annual income cut-offs, one per household shape. */
const SINGLE_CUTOFF = 22800
const BOTH_PENSIONERS_CUTOFF = 30096
const ALLOWANCE_CUTOFF = 42144
const NO_OAS_CUTOFF = 54624
/**
 * The published top-up income levels: the lowest-income band the tables show
 * before the reduction starts to appear. A household at or below its band
 * still receives the full maximum.
 */
const SINGLE_TOP_UP = 4096
const NO_OAS_TOP_UP = 4096

/**
 * The reduction is two segments: a flat band up to the published top-up
 * income, then a single line from there to the published cut-off, where the
 * supplement reaches zero. The line's slope is fixed by those two published
 * points rather than fitted to the table's interior.
 *
 * That choice is deliberate. The published maximums and cut-offs are the two
 * figures a household's eligibility turns on, and the official tables reach
 * zero at a lower income than they publish as the cut-off, so no single line
 * can pass through both the tabled interior and the published end point. This
 * model takes the published end points exactly and reports the interior
 * deviation. Measured against the July-September 2026 tables it is at most
 * $229 a month (single, near 10,368 of income), $70 (two pensioners) and $58
 * (spouse with neither); the test file pins those bounds so they cannot drift
 * silently.
 */
/**
 * The modelled reduction: the published maximum holds through the top-up
 * income band, then one straight line runs to the published annual cut-off,
 * where the supplement is zero.
 *
 * It is deliberately a line through the two published endpoints rather than a
 * fit to the tables' interior. The official tables reduce faster in the middle
 * of the range and reach zero well below the cut-off they publish as the
 * eligibility limit, so no single line can pass through both the tabled
 * interior and the published end point. A household's entitlement turns on the
 * published maximum and cut-off, and this model reproduces both exactly.
 * Measured against the July-September 2026 tables the interior deviation is at
 * most $229 a month (single, near 10,368 of income), $70 (two pensioners) and
 * $58 (spouse with neither); the tests pin those bounds so they cannot drift
 * silently.
 */
function twoSegmentReduction(
  topUpIncome: number,
  annualCutoff: number,
  householdMonthlyMaximum: number,
): GisCategoryRule['reductionSegments'] {
  const householdAnnualMaximum = householdMonthlyMaximum * ANNUAL_PER_MONTHLY
  // A shape with no published top-up band reduces from the first dollar, so it
  // needs one segment rather than a zero-width flat one.
  const flat = topUpIncome > 0 ? [{ rate: 0, upTo: topUpIncome }] : []
  return [
    ...flat,
    { rate: householdAnnualMaximum / (annualCutoff - topUpIncome), upTo: Infinity },
  ]
}

function gisCategoryRules(): Record<GisHouseholdRuleCategory, GisCategoryRule> {
  return {
    single: {
      maxMonthly: SINGLE_MONTHLY, annualCutoff: SINGLE_CUTOFF,
      reductionSegments: twoSegmentReduction(SINGLE_TOP_UP, SINGLE_CUTOFF, SINGLE_MONTHLY),
      fieldSources: { maxMonthly: OAS_GIS_2026_Q3_URL, annualCutoff: OAS_GIS_2026_Q3_URL },
    },
    'couple-both-pensioners': {
      // Published per pensioner; the household receives one each.
      maxMonthly: BOTH_PENSIONERS_MONTHLY, annualCutoff: BOTH_PENSIONERS_CUTOFF,
      reductionSegments: twoSegmentReduction(0, BOTH_PENSIONERS_CUTOFF, BOTH_PENSIONERS_MONTHLY),
      fieldSources: { maxMonthly: OAS_GIS_2026_Q3_URL, annualCutoff: OAS_GIS_2026_Q3_URL },
    },
    'couple-partner-allowance': {
      maxMonthly: 676.09, annualCutoff: ALLOWANCE_CUTOFF,
      // Published as flat: at every tabled income up to the 42,144 cut-off the
      // pensioner's own GIS stays at 676.09, and the reduction falls on the
      // Allowance instead.
      reductionSegments: [{ rate: 0, upTo: Infinity }],
      fieldSources: { maxMonthly: OAS_GIS_2026_Q3_URL, annualCutoff: OAS_GIS_2026_Q3_URL },
    },
    'couple-partner-no-oas-no-allowance': {
      maxMonthly: SINGLE_MONTHLY, annualCutoff: NO_OAS_CUTOFF,
      reductionSegments: twoSegmentReduction(NO_OAS_TOP_UP, NO_OAS_CUTOFF, SINGLE_MONTHLY),
      fieldSources: { maxMonthly: OAS_GIS_2026_Q3_URL, annualCutoff: OAS_GIS_2026_Q3_URL },
    },
  }
}

/**
 * July-September 2026 amounts. The maxima and cut-offs are transcribed from
 * the published quarterly table (Table 5) and its five companion tables of
 * benefit amounts by income; the shape of the reduction is documented on
 * `twoSegmentReduction`.
 */
const GIS_PACKS: GisRulePack[] = [
  {
    id: 'CA-OAS-GIS-2026-Q3-v1',
    program: 'GIS',
    paymentPeriod: '2026-07/2026-09',
    basedOnIncomeYear: 2025,
    categories: gisCategoryRules(),
    allowance: {
      maxMonthly: 1428.06, annualCutoff: ALLOWANCE_CUTOFF, topUpIncome: 8800,
    },
    sourceURL: OAS_GIS_2026_Q3_URL,
    additionalSourceURLs: [OAS_GIS_TABLES_URL, ALLOWANCE_AMOUNT_URL],
    fieldSources: {
      maxMonthly: OAS_GIS_2026_Q3_URL,
      annualCutoff: OAS_GIS_2026_Q3_URL,
      topUpIncome: OAS_GIS_TABLES_URL,
      allowanceMaxMonthly: ALLOWANCE_AMOUNT_URL,
      allowanceAnnualCutoff: ALLOWANCE_AMOUNT_URL,
    },
    effectiveDate: '2026-07-01', verifiedAt: '2026-09-14',
    indexationRule: 'cpi-assumption',
    rounding: 'nearest-dollar', coverage: 'estimated',
    limitation: 'Maximum amounts and income cut-offs are the published July-September 2026 figures for each household shape (single; both pensioners; pensioner with an Allowance spouse; pensioner whose spouse has neither OAS nor the Allowance), annualized as twelve times the monthly amount, and they are reproduced exactly. The reduction between the top-up income and the cut-off is a single line through those two published points: the official tables reduce faster in the middle of the range and reach zero below the published cut-off, so the modelled amount can differ from a tabled monthly line by up to about $229 (single), $70 (two pensioners) and $58 (spouse with neither), which the tests pin. The Allowance is modelled from its published maximum, 8,800 top-up income and 42,144 cut-off; the pensioner-side GIS is flat while it is in pay. Not modelled: the Allowance for the Survivor, provincial top-ups, the prior-year base period and the retirement-year income estimate. Employment-income exemption: the first $5,000 of employment or self-employment income is excluded from the test, plus half of the next $10,000.',
    assumedFutureRule: false,
  },
]

function validGisPack(p: Partial<GisRulePack>): boolean {
  const categories: GisHouseholdRuleCategory[] = ['single', 'couple-both-pensioners',
    'couple-partner-allowance', 'couple-partner-no-oas-no-allowance']
  return !!p.categories && categories.every(key => {
    const rule = p.categories?.[key]
    if (!rule || !(rule.maxMonthly > 0) || !(rule.annualCutoff > 0) ||
        !Array.isArray(rule.reductionSegments) || rule.reductionSegments.length === 0) return false
    let previous = 0
    const ordered = rule.reductionSegments.every((segment, index) => {
      const last = index === rule.reductionSegments.length - 1
      // A rate above 1 is legitimate: the reduction removes annual dollars
      // from an annualized maximum and the tables are step functions, so the
      // straight line between the maximum and the cut-off can be steeper than
      // dollar-for-dollar. A negative or non-finite rate never is.
      const ok = Number.isFinite(segment.rate) && segment.rate >= 0 && segment.rate < 12 &&
        (last ? segment.upTo === Infinity : Number.isFinite(segment.upTo) && segment.upTo > previous)
      previous = segment.upTo
      return ok
    })
    return ordered && validURL(rule.fieldSources?.maxMonthly) && validURL(rule.fieldSources?.annualCutoff)
  }) && !!p.allowance && p.allowance.maxMonthly > 0 && p.allowance.annualCutoff > 0 &&
    p.allowance.topUpIncome >= 0 && p.allowance.topUpIncome < p.allowance.annualCutoff &&
    !!p.fieldSources && ['maxMonthly', 'annualCutoff', 'topUpIncome', 'allowanceMaxMonthly', 'allowanceAnnualCutoff']
      .every(key => validURL(p.fieldSources?.[key as keyof GisRulePack['fieldSources']]))
}

function validTaxPack(meta: RulePackMeta, p: Partial<TaxRulePack>): boolean {
  return typeof p.jurisdiction === 'string' && Object.hasOwn(PROVINCIAL_2026_SNAPSHOT, p.jurisdiction) &&
    Number.isInteger(p.taxYear) && (p.taxYear ?? 0) >= 1900 &&
    meta.effectiveDate?.slice(0, 4) === String(p.taxYear) &&
    validTable(p.federal) && validTable(p.provincial) &&
    Array.isArray(p.frozenProvincialBracketIndexes) &&
    new Set(p.frozenProvincialBracketIndexes).size === p.frozenProvincialBracketIndexes.length &&
    p.frozenProvincialBracketIndexes.every(i => Number.isInteger(i) && i >= 0 && i < p.provincial!.brackets.length - 1) &&
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
  return p.program === 'CCB' && Number.isInteger(start) && start >= 1900 &&
    p.paymentPeriod === `${start}-07/${start + 1}-06` && p.incomeTaxYear === start - 1 &&
    meta.effectiveDate === `${start}-07-01` && !!p.values &&
    ['maxUnder6', 'max6to17', 'th1', 'th2'].every(k => amount(p.values?.[k as keyof typeof p.values])) &&
    (p.values.th1 ?? 0) < (p.values.th2 ?? 0) &&
    !!p.fieldSources && validURL(p.fieldSources.amounts) && validURL(p.fieldSources.thresholds)
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
export function selectTaxRules(jurisdiction: string, taxYear: number, future?: { annualRate: number }): TaxRulePack {
  if (!Object.hasOwn(PROVINCIAL_2026_SNAPSHOT, jurisdiction) || !Number.isInteger(taxYear)) throw new Error('Unknown tax jurisdiction or year')
  const exact = TAX_PACKS.find(p => p.jurisdiction === jurisdiction && p.taxYear === taxYear)
  if (exact) return structuredClone(exact)
  const base = TAX_PACKS.filter(p => p.jurisdiction === jurisdiction && p.taxYear < taxYear).at(-1)
  if (!base || !future || !Number.isFinite(future.annualRate) || future.annualRate < 0 || future.annualRate > 1)
    throw new Error('Unpublished tax year requires an explicit future indexation assumption')
  const years = taxYear - base.taxYear
  const rate = base.indexationRule === 'frozen' ? 0 : future.annualRate
  const projected: TaxRulePack = {
    ...base, id: `${base.id}+assumed-${taxYear}-${rate}`, taxYear,
    effectiveDate: `${taxYear}-01-01`,
    federal: projectTable(base.federal, years, future.annualRate, []),
    provincial: projectTable(base.provincial, years, rate, base.frozenProvincialBracketIndexes),
    assumedFutureRule: true, assumedAnnualRate: future.annualRate, basedOnRuleId: base.id,
    coverage: 'estimated',
  }
  // Frozen upper bounds can be overtaken by earlier indexed bounds. Never return an invalid pack.
  if (!validTable(projected.federal) || !validTable(projected.provincial))
    throw new Error('Projected tax bracket collision or invalid indexed value')
  return publishRulePack<TaxRulePack>(projected)
}
export function selectBenefitRules(program: 'CCB', period: string, future?: { annualRate: number }): BenefitRulePack {
  if (program !== 'CCB') throw new Error('Unknown benefit program')
  const exact = BENEFIT_PACKS.find(p => p.program === program && p.paymentPeriod === period)
  if (exact) return structuredClone(exact)
  const start = Number(period.slice(0, 4))
  if (!/^\d{4}-07\/\d{4}-06$/.test(period) || period !== `${start}-07/${start + 1}-06` ||
      start <= 2026 || !future || !Number.isFinite(future.annualRate) || future.annualRate < 0 || future.annualRate > 1)
    throw new Error('Unpublished benefit period requires an explicit future indexation assumption')
  const base = BENEFIT_PACKS[1]
  const years = start - 2026
  const projected: BenefitRulePack = { ...base, id: `${base.id}+assumed-${start}-${future.annualRate}`,
    paymentPeriod: period, incomeTaxYear: start - 1, effectiveDate: `${start}-07-01`,
    values: Object.fromEntries(Object.entries(base.values).map(([k, v]) => [k, indexed(v, years, future.annualRate)])) as BenefitRulePack['values'],
    assumedFutureRule: true, assumedAnnualRate: future.annualRate, basedOnRuleId: base.id,
  }
  return publishRulePack<BenefitRulePack>(projected)
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
