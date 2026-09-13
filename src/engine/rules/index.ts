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
export function publishRulePack<T extends TaxRulePack | BenefitRulePack>(candidate: unknown): T {
  const p = candidate as Partial<TaxRulePack & BenefitRulePack>
  if (!p || typeof p.id !== 'string' || !p.id.trim() || !validURL(p.sourceURL) ||
      !validDate(p.effectiveDate) || !validDate(p.verifiedAt) ||
      !['cpi-assumption', 'frozen'].includes(p.indexationRule ?? '') ||
      p.rounding !== 'nearest-dollar' || !['modeled', 'estimated', 'unsupported'].includes(p.coverage ?? '') ||
      typeof p.limitation !== 'string' || !p.limitation.trim() || typeof p.assumedFutureRule !== 'boolean' ||
      (p.additionalSourceURLs !== undefined && (!Array.isArray(p.additionalSourceURLs) || p.additionalSourceURLs.some(url => !validURL(url)))) ||
      (p.assumedFutureRule && (!amount(p.assumedAnnualRate) || p.assumedAnnualRate > 1 || !p.basedOnRuleId)) ||
      ('jurisdiction' in p) === ('program' in p)) throw new Error('Rule pack lacks publication metadata')
  if ('jurisdiction' in p) {
    if (typeof p.jurisdiction !== 'string' || !Object.hasOwn(PROVINCIAL_2026_SNAPSHOT, p.jurisdiction) ||
        !Number.isInteger(p.taxYear) || (p.taxYear ?? 0) < 1900 ||
        p.effectiveDate?.slice(0, 4) !== String(p.taxYear) ||
        !validTable(p.federal) || !validTable(p.provincial) ||
        !Array.isArray(p.frozenProvincialBracketIndexes) ||
        new Set(p.frozenProvincialBracketIndexes).size !== p.frozenProvincialBracketIndexes.length ||
        p.frozenProvincialBracketIndexes.some(i => !Number.isInteger(i) || i < 0 || i >= p.provincial!.brackets.length - 1) ||
        !p.fieldSources || !Object.values(p.fieldSources).every(validURL) ||
        (p.fieldAdditionalSources !== undefined && (!p.fieldAdditionalSources || typeof p.fieldAdditionalSources !== 'object' ||
          Object.entries(p.fieldAdditionalSources).some(([key, urls]) =>
            !['federalBrackets', 'federalBpa', 'provincialBrackets', 'provincialBpa'].includes(key) ||
            !Array.isArray(urls) || urls.length === 0 || urls.some(url => !validURL(url))))) ||
        !['federalBrackets', 'federalBpa', 'provincialBrackets', 'provincialBpa'].every(k => validURL(p.fieldSources?.[k as keyof typeof p.fieldSources])))
      throw new Error('Tax pack lacks valid values, sources or scope')
  } else if ('program' in p) {
    const start = Number(p.paymentPeriod?.slice(0, 4))
    if (p.program !== 'CCB' || !Number.isInteger(start) || start < 1900 ||
        p.paymentPeriod !== `${start}-07/${start + 1}-06` || p.incomeTaxYear !== start - 1 ||
        p.effectiveDate !== `${start}-07-01` || !p.values ||
        !['maxUnder6', 'max6to17', 'th1', 'th2'].every(k => amount(p.values?.[k as keyof typeof p.values])) ||
        (p.values.th1 ?? 0) >= (p.values.th2 ?? 0) ||
        !p.fieldSources || !validURL(p.fieldSources.amounts) || !validURL(p.fieldSources.thresholds))
      throw new Error('Benefit pack lacks valid values, sources or period')
  }
  return candidate as T
}
TAX_PACKS.forEach(pack => publishRulePack(pack))
BENEFIT_PACKS.forEach(pack => publishRulePack(pack))

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
