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

const TAX_SOURCES = {
  2025: 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/last-year.html',
  2026: 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/current-year.html',
}
const TAX_PACKS: TaxRulePack[] = [
  {
    id: 'CA-ON-tax-2025-v1', jurisdiction: 'ON', taxYear: 2025,
    federal: FED_2025, provincial: ON_2025, frozenProvincialBracketIndexes: [2, 3],
    sourceURL: TAX_SOURCES[2025], effectiveDate: '2025-01-01', verifiedAt: '2026-09-13',
    additionalSourceURLs: ['https://budget.ontario.ca/2025/fallstatement/provisions.html'],
    indexationRule: 'cpi-assumption', rounding: 'nearest-dollar', coverage: 'estimated',
    limitation: 'Bracket/BPA snapshot only; other Ontario credits, tax reduction and benefits are not year-switched.',
    assumedFutureRule: false,
  },
  ...Object.entries(PROVINCIAL_2026_SNAPSHOT).map(([jurisdiction, provincial]): TaxRulePack => ({
    id: `CA-${jurisdiction}-tax-2026-legacy-v1`, jurisdiction: jurisdiction as Province,
    taxYear: 2026, federal: FEDERAL_2026_SNAPSHOT, provincial,
    frozenProvincialBracketIndexes: jurisdiction === 'ON' ? [2, 3] : jurisdiction === 'YT' ? [3] : jurisdiction === 'MB' ? [0, 1] : [],
    sourceURL: TAX_SOURCES[2026], effectiveDate: '2026-01-01', verifiedAt: '2026-09-13',
    additionalSourceURLs: jurisdiction === 'QC'
      ? ['https://www.revenuquebec.ca/en/citizens/income-tax-return/completing-your-income-tax-return/income-tax-rates/'] : [],
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
    sourceURL: 'https://www.canada.ca/en/department-finance/services/publications/federal-tax-expenditures/2026/part-9.html',
    effectiveDate: '2025-07-01', verifiedAt: '2026-09-13', indexationRule: 'cpi-assumption',
    rounding: 'nearest-dollar', coverage: 'estimated',
    limitation: 'Federal CCB parameter snapshot only; projection still approximates AFNI and has no prior-year lag or provincial top-ups.',
    assumedFutureRule: false,
  },
  {
    id: 'CA-CCB-2026-07-v1', program: 'CCB', paymentPeriod: '2026-07/2027-06', incomeTaxYear: 2025,
    values: { maxUnder6: 8157, max6to17: 6883, th1: 38237, th2: 82847 },
    sourceURL: 'https://www.canada.ca/en/revenue-agency/services/child-family-benefits/canada-child-benefit/how-much.html',
    effectiveDate: '2026-07-01', verifiedAt: '2026-09-13', indexationRule: 'cpi-assumption',
    rounding: 'nearest-dollar', coverage: 'estimated',
    limitation: 'Federal CCB parameter snapshot only; projection still approximates AFNI and has no prior-year lag or provincial top-ups.',
    assumedFutureRule: false,
  },
]

function validDate(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}
export function publishRulePack<T extends TaxRulePack | BenefitRulePack>(candidate: unknown): T {
  const p = candidate as Partial<TaxRulePack & BenefitRulePack>
  if (!p || !p.id || !p.sourceURL || !/^https:\/\//.test(p.sourceURL) ||
      !validDate(p.effectiveDate) || !validDate(p.verifiedAt) ||
      !['cpi-assumption', 'frozen'].includes(p.indexationRule ?? '') ||
      p.rounding !== 'nearest-dollar' || !['modeled', 'estimated', 'unsupported'].includes(p.coverage ?? '') ||
      !p.limitation || typeof p.assumedFutureRule !== 'boolean' ||
      (p.additionalSourceURLs?.some(url => !/^https:\/\//.test(url)) ?? false) ||
      !('jurisdiction' in p || 'program' in p)) throw new Error('Rule pack lacks publication metadata')
  if ('jurisdiction' in p && (!p.taxYear || !p.federal || !p.provincial || !p.frozenProvincialBracketIndexes))
    throw new Error('Tax pack lacks values or scope')
  if ('program' in p && (!p.paymentPeriod || !p.incomeTaxYear || !p.values))
    throw new Error('Benefit pack lacks values or period')
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
  if (!base || !future || !Number.isFinite(future.annualRate) || future.annualRate < -1 || future.annualRate > 1)
    throw new Error('Unpublished tax year requires an explicit future indexation assumption')
  const years = taxYear - base.taxYear
  const rate = base.indexationRule === 'frozen' ? 0 : future.annualRate
  return {
    ...base, id: `${base.id}+assumed-${taxYear}-${rate}`, taxYear,
    effectiveDate: `${taxYear}-01-01`,
    federal: projectTable(base.federal, years, future.annualRate, []),
    provincial: projectTable(base.provincial, years, rate, base.frozenProvincialBracketIndexes),
    assumedFutureRule: true, assumedAnnualRate: future.annualRate, basedOnRuleId: base.id,
    coverage: 'estimated',
  }
}
export function selectBenefitRules(program: 'CCB', period: string, future?: { annualRate: number }): BenefitRulePack {
  if (program !== 'CCB') throw new Error('Unknown benefit program')
  const exact = BENEFIT_PACKS.find(p => p.program === program && p.paymentPeriod === period)
  if (exact) return structuredClone(exact)
  const start = Number(period.slice(0, 4))
  if (!/^\d{4}-07\/\d{4}-06$/.test(period) || period !== `${start}-07/${start + 1}-06` ||
      start <= 2026 || !future || !Number.isFinite(future.annualRate) || future.annualRate < -1 || future.annualRate > 1)
    throw new Error('Unpublished benefit period requires an explicit future indexation assumption')
  const base = BENEFIT_PACKS[1]
  const years = start - 2026
  return { ...base, id: `${base.id}+assumed-${start}-${future.annualRate}`,
    paymentPeriod: period, incomeTaxYear: start - 1, effectiveDate: `${start}-07-01`,
    values: Object.fromEntries(Object.entries(base.values).map(([k, v]) => [k, indexed(v, years, future.annualRate)])) as BenefitRulePack['values'],
    assumedFutureRule: true, assumedAnnualRate: future.annualRate, basedOnRuleId: base.id,
  }
}
export const publishedTaxCoverage = TAX_PACKS.map(p => ({ jurisdiction: p.jurisdiction, taxYear: p.taxYear, coverage: p.coverage, limitation: p.limitation }))
