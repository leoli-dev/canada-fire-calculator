import {
  FED_AGE_AMOUNT,
  FED_PENSION_AMOUNT,
  ON_HEALTH_PREMIUM,
  ON_SURTAX,
  PROV_AGE_PENSION,
  PROBATE_RATES,
  QC_ABATEMENT,
  QC_FSS,
  QC_RAMQ,
  type Bracket,
  type TaxTable,
} from './taxData'
import { freezeRuleContext, selectTaxRules, type TaxRulePack } from './rules'
import { PLAN_TAX_YEAR } from './planYear'
import type { Province } from './types'
import { federalSpouseAmount2026, provincialSpouseAmount2026 } from './spouseCredit2026'

/**
 * The tax year whose published pack prices the projection. Every table input in
 * this engine is a today's-dollar figure, so the projection is expressed in this
 * year's real dollars whatever calendar year a row represents: an annually
 * indexed ladder is already flat in real dollars, and indexing it a second time
 * for a projected year would inflate it. Raising this constant to a newly
 * published tax year is a deliberate, reviewed number change — it must land with
 * an independent expected-value test and a recorded before/after, never as
 * silent drift.
 *
 * BE-38 B3 moved the literal to `./planYear` and re-exports it here so the
 * coverage matrix can state the same year without importing the tax engine.
 */
export { PLAN_TAX_YEAR } from './planYear'

/** One selected, versioned rule pack plus the policy that produced it. */
export interface TaxRuleContext {
  jurisdiction: Province
  /** The tax year whose pack prices this computation. */
  taxYear: number
  /** The pack itself. A pack is published data: callers never mutate it. */
  pack: TaxRulePack
  /**
   * What happened beyond the pack's publication. `published` means every figure
   * is a published value. `assumed` means the pack's eligible nominal
   * thresholds were indexed exactly once per elapsed year from `fromTaxYear`,
   * the ones the pack freezes were held fixed, and the result is therefore an
   * assumption rather than a published figure.
   */
  projectionPolicy:
    | { kind: 'published' }
    | { kind: 'assumed'; annualRate: number; fromRuleId: string; fromTaxYear: number }
}

/** A request for the pack that should price one plan's tax. */
export interface TaxRuleRequest {
  jurisdiction: string
  /** Defaults to the plan anchor year; a year beyond publication needs `futureIndexation`. */
  taxYear?: number
  /** The once-a-year indexation assumption required for a year beyond publication. */
  futureIndexation?: { annualRate: number }
}

export type TaxRuleSelection =
  | { status: 'ok'; context: TaxRuleContext }
  /** No published or explicitly assumed pack can price this. Never a fallback. */
  | { status: 'unsupported'; reason: string }

/** The provenance every priced tax result must carry. */
export interface TaxRuleProvenance {
  rulePackId: string
  ruleYear: number
  assumedFutureRule: boolean
  projectionPolicy: TaxRuleContext['projectionPolicy']
  coverage: TaxRulePack['coverage']
}

function contextFor(pack: TaxRulePack, taxYear: number): TaxRuleContext {
  return {
    jurisdiction: pack.jurisdiction,
    taxYear,
    pack,
    projectionPolicy: pack.assumedFutureRule
      ? {
          kind: 'assumed',
          annualRate: pack.assumedAnnualRate ?? 0,
          fromRuleId: pack.basedOnRuleId ?? pack.id,
          fromTaxYear: pack.basedOnTaxYear ?? pack.taxYear,
        }
      : { kind: 'published' },
  }
}

/**
 * Select the pack for one plan, returning the refusal rather than throwing so a
 * caller can surface it. An unknown jurisdiction is never answered with another
 * jurisdiction's table, and an unpublished year is never answered with a
 * published one.
 */
export function trySelectPlanTaxRules(request: TaxRuleRequest): TaxRuleSelection {
  const taxYear = request.taxYear ?? PLAN_TAX_YEAR
  try {
    const pack = selectTaxRules(request.jurisdiction, taxYear, request.futureIndexation)
    return { status: 'ok', context: contextFor(pack, taxYear) }
  } catch (error) {
    return {
      status: 'unsupported',
      reason: error instanceof Error ? error.message : 'tax rule selection failed',
    }
  }
}

/** Strict form of {@link trySelectPlanTaxRules}: throws the same concrete reason. */
export function selectPlanTaxRules(request: TaxRuleRequest): TaxRuleContext {
  const selection = trySelectPlanTaxRules(request)
  if (selection.status !== 'ok') throw new Error(selection.reason)
  return selection.context
}

/**
 * Hot-path resolver for the plan anchor year. `incomeTax` runs inside every
 * withdrawal bisection, so the anchor context is resolved once per
 * (jurisdiction, year) and then read-only. The context is deep-frozen before it
 * is cached and handed back: `selectPlanTaxRules` returns its own copy, and this
 * resolver's cached copy cannot be mutated by a caller either, so the shared
 * pack can never be re-priced behind `rulePackId`.
 */
const anchorContexts = new Map<string, TaxRuleContext>()
export function anchorTaxRules(province: string, taxYear = PLAN_TAX_YEAR): TaxRuleContext {
  const key = `${province}:${taxYear}`
  const cached = anchorContexts.get(key)
  if (cached) return cached
  const context = freezeRuleContext(selectPlanTaxRules({ jurisdiction: province, taxYear }))
  anchorContexts.set(key, context)
  return context
}

export function taxRuleProvenance(context: TaxRuleContext): TaxRuleProvenance {
  return {
    rulePackId: context.pack.id,
    ruleYear: context.taxYear,
    assumedFutureRule: context.pack.assumedFutureRule,
    projectionPolicy: context.projectionPolicy,
    coverage: context.pack.coverage,
  }
}

/** A context must price the jurisdiction it is used for, or it is a bug. */
function tablesFor(context: TaxRuleContext, province: Province): { federal: TaxTable; provincial: TaxTable } {
  if (context.pack.jurisdiction !== province)
    throw new Error(
      `tax rule pack ${context.pack.id} prices ${context.pack.jurisdiction}, not ${province}`,
    )
  return { federal: context.pack.federal, provincial: context.pack.provincial }
}

export interface PersonCredits {
  /** the taxpayer's age — 65+ unlocks the age amount */
  age?: number
  /**
   * Eligible pension income for the pension income amount. Callers gate by
   * type: employer RPP annuities qualify at any age; RRIF/LIF withdrawals
   * only at 65+. (Quebec folds its equivalent into the family-income-tested
   * senior credit, so under-65 RPP income gets the federal amount only.)
   */
  pensionIncome?: number
  /** Provincial eligibility can differ from the federal pension amount. */
  provincialPensionIncome?: number
  /** Only supplied after the claimant confirms support/cohabitation. */
  spouseNetIncome?: number
}

function bracketTax(income: number, brackets: Bracket[]): number {
  let tax = 0
  let prev = 0
  for (const b of brackets) {
    if (income <= prev) break
    tax += (Math.min(income, b.upTo) - prev) * b.rate
    prev = b.upTo
  }
  return tax
}

/** Enhanced federal BPA phases down to the floor across the 4th bracket. */
function enhancedBpa(table: TaxTable, taxable: number): number {
  if (table.bpaMin === undefined) return table.bpa
  const from = table.brackets[2].upTo
  const to = table.brackets[3].upTo
  const phase = Math.min(1, Math.max(0, (taxable - from) / (to - from)))
  return table.bpa - (table.bpa - table.bpaMin) * phase
}

/** Components for the person-owned Québec return. Ordinary Québec tax omits
 * Schedule B, Schedule F and Schedule K; the household calculator adds each
 * from its actual family/source/coverage facts. The rule context is required:
 * the federal ladder is read from the pack, never from a literal. */
export function federalIncomeTax(taxable: number, rules: TaxRuleContext, credits?: PersonCredits, quebecAbatement = false): number {
  if (taxable <= 0) return 0
  const federal = rules.pack.federal
  let credit = enhancedBpa(federal, taxable) * federal.brackets[0].rate
  credit += Math.min(FED_PENSION_AMOUNT, credits?.pensionIncome ?? 0) * federal.brackets[0].rate
  if (credits?.spouseNetIncome !== undefined)
    credit += federalSpouseAmount2026(credits.spouseNetIncome, enhancedBpa(federal, taxable)) * federal.brackets[0].rate
  if ((credits?.age ?? 0) >= 65)
    credit += Math.max(0, FED_AGE_AMOUNT.max - FED_AGE_AMOUNT.rate * Math.max(0, taxable - FED_AGE_AMOUNT.threshold)) * federal.brackets[0].rate
  const amount = Math.max(0, bracketTax(taxable, federal.brackets) - credit)
  return quebecAbatement ? amount * (1 - QC_ABATEMENT) : amount
}

export function ordinaryQuebecIncomeTax(taxable: number, rules: TaxRuleContext): number {
  if (taxable <= 0) return 0
  if (rules.pack.jurisdiction !== 'QC')
    throw new Error(`ordinary Quebec tax needs a QC rule pack, got ${rules.pack.id}`)
  const qc = rules.pack.provincial
  return Math.max(0, bracketTax(taxable, qc.brackets) - qc.bpa * qc.brackets[0].rate)
}

/**
 * Legacy combined federal + provincial income-tax preview on taxable income.
 * The federal and provincial bracket ladders and basic personal amounts come
 * from the selected, versioned rule pack — never from a literal in this file.
 * The credits and levies the pack does not carry (age/pension amounts, the
 * spouse amount, Ontario surtax and health premium, Quebec's abatement/FSS/RAMQ)
 * still come from `taxData.ts` and are enumerated in the pack's
 * `unsupportedPaths`; BE-38 B replaces them with field-level packs.
 *
 * For Quebec this preview cannot identify Schedule F source income or Schedule
 * K coverage. Verified person-owned Quebec results use quebecTax.ts instead.
 * Optional retiree credits: the age amount (65+, income-tested) and the
 * pension income amount, both federal and provincial. Taxable income stands
 * in for net income in the phase-outs.
 */
export function incomeTax(
  taxable: number,
  province: Province,
  credits?: PersonCredits,
  rules?: TaxRuleContext,
): number {
  if (taxable <= 0) return 0
  const context = rules ?? anchorTaxRules(province)
  const { federal, provincial: p } = tablesFor(context, province)
  const senior = (credits?.age ?? 0) >= 65
  const pensionInc = credits?.pensionIncome ?? 0
  const provincialPensionInc = credits?.provincialPensionIncome ?? pensionInc

  let fedCredit = enhancedBpa(federal, taxable) * federal.brackets[0].rate
  // the pension income amount has no age test of its own — eligibility by
  // income type is the caller's job (see PersonCredits.pensionIncome)
  fedCredit += Math.min(FED_PENSION_AMOUNT, pensionInc) * federal.brackets[0].rate
  if (credits?.spouseNetIncome !== undefined)
    fedCredit += federalSpouseAmount2026(credits.spouseNetIncome, enhancedBpa(federal, taxable)) * federal.brackets[0].rate
  if (senior) {
    const ageAmt = Math.max(
      0,
      FED_AGE_AMOUNT.max - FED_AGE_AMOUNT.rate * Math.max(0, taxable - FED_AGE_AMOUNT.threshold),
    )
    fedCredit += ageAmt * federal.brackets[0].rate
  }
  let fed = Math.max(0, bracketTax(taxable, federal.brackets) - fedCredit)
  if (province === 'QC') fed *= 1 - QC_ABATEMENT

  const lowRate = p.brackets[0].rate
  let provBpa = p.bpa
  if (p.bpaPhaseOut) {
    // MB: to zero over $200k–$400k; YT mirrors the federal enhanced BPA
    const { from, to, min } = p.bpaPhaseOut
    const phase = Math.min(1, Math.max(0, (taxable - from) / (to - from)))
    provBpa = p.bpa - (p.bpa - min) * phase
  }
  let provCredit = provBpa * lowRate
  if (credits?.spouseNetIncome !== undefined && province !== 'QC')
    provCredit += (provincialSpouseAmount2026(province, credits.spouseNetIncome) ?? 0) * lowRate
  // provincial pension amounts (outside QC) have no age test either; QC's
  // equivalent stays inside the senior block below, folded into its combined
  // family-income-tested credit
  if (province !== 'QC') {
    provCredit += Math.min(PROV_AGE_PENSION[province].pension, provincialPensionInc) * lowRate
  }
  if (senior) {
    const ap = PROV_AGE_PENSION[province]
    provCredit += (ap.seniorSupplement ?? 0) * lowRate
    if (province === 'QC') {
      // combined age + retirement-income amount, family-income-tested at
      // 18.75%; applied per person on their income share (50/50 split)
      const combined = ap.ageMax + Math.min(ap.pension, pensionInc)
      provCredit +=
        Math.max(0, combined - ap.ageRate * Math.max(0, taxable - ap.ageThreshold)) * lowRate
    } else {
      const ageAmt = Math.max(
        0,
        ap.ageMax - ap.ageRate * Math.max(0, taxable - ap.ageThreshold),
      )
      provCredit += ageAmt * lowRate
    }
  }
  let prov = Math.max(0, bracketTax(taxable, p.brackets) - provCredit)
  if (province === 'ON') {
    // surtax is levied on basic Ontario tax (after credits), then the
    // health premium is added from taxable income
    prov +=
      Math.max(0, prov - ON_SURTAX.t1) * ON_SURTAX.r1 +
      Math.max(0, prov - ON_SURTAX.t2) * ON_SURTAX.r2
    prov += ontarioHealthPremium(taxable)
  }
  if (province === 'QC') {
    prov += qcFssContribution(taxable) + qcRamqPremium(taxable)
  }
  return fed + prov
}

function ontarioHealthPremium(income: number): number {
  let premium = 0
  for (const seg of ON_HEALTH_PREMIUM) {
    if (income > seg.from) {
      premium = Math.min(seg.cap, seg.base + seg.rate * (income - seg.from))
    }
  }
  return premium
}

/** Quebec Fonds des services de santé contribution — see taxData.ts. */
export function qcFssContribution(income: number): number {
  const { t1, t2, cap1, cap2 } = QC_FSS
  if (income <= t1) return 0
  if (income <= t2) return Math.min(cap1, (income - t1) * 0.01)
  return Math.min(cap2, cap1 + (income - t2) * 0.01)
}

/** Quebec RAMQ prescription-drug-insurance premium — see taxData.ts. */
export function qcRamqPremium(income: number): number {
  const { threshold, band1, rate1, rate2, max } = QC_RAMQ
  const excess = Math.max(0, income - threshold)
  if (excess <= band1) return excess * rate1
  return Math.min(max, band1 * rate1 + (excess - band1) * rate2)
}

/** Probate / estate administration fee on probatable assets — see taxData.ts. */
export function probateTax(value: number, province: Province): number {
  if (value <= 0) return 0
  const { flat, rate, threshold } = PROBATE_RATES[province]
  return flat + rate * Math.max(0, value - threshold)
}

/** Statutory combined marginal rate at a taxable income (QC abatement applied). */
export function marginalRate(taxable: number, province: Province, rules?: TaxRuleContext): number {
  if (taxable <= 0) return 0
  const context = rules ?? anchorTaxRules(province)
  const { federal, provincial } = tablesFor(context, province)
  const at = (brackets: Bracket[]) => {
    let prev = 0
    for (const b of brackets) {
      if (taxable <= b.upTo && taxable > prev) return b.rate
      prev = b.upTo
    }
    return brackets[brackets.length - 1].rate
  }
  let fed = at(federal.brackets)
  if (province === 'QC') fed *= 1 - QC_ABATEMENT
  return fed + at(provincial.brackets)
}
