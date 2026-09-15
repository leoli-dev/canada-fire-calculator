// CPP/QPP and OAS start-age adjustments and OAS clawback. 2025 figures.

import {
  freezeRuleContext,
  selectBenefitRules,
  selectGisRules,
  type BenefitRulePack,
  type GisHouseholdRuleCategory,
  type GisReductionSegment,
  type GisRulePack,
} from './rules'

/**
 * CPP/QPP: -0.6%/month before 65 (floor age 60), +0.7%/month after.
 * CPP deferral caps at 70; QPP allows 72 since 2024 (up to +58.8%) —
 * pass maxAge 72 for Quebec.
 */
export function cppAnnual(annualAt65: number, startAge: number, maxAge = 70): number {
  const months = (Math.min(maxAge, Math.max(60, startAge)) - 65) * 12
  const factor = months < 0 ? 1 + months * 0.006 : 1 + months * 0.007
  return annualAt65 * factor
}

/**
 * The start-age adjustment itself, as a multiplier over the age-65 amount.
 * `cppAnnual` is this factor times the amount, so a caller can state an amount
 * on a different basis without ever applying the same adjustment twice.
 */
export function cppAgeFactor(startAge: number, maxAge = 70): number {
  const months = (Math.min(maxAge, Math.max(60, startAge)) - 65) * 12
  return months < 0 ? 1 + months * 0.006 : 1 + months * 0.007
}

/** OAS: no early start; +0.6%/month deferred past 65 (cap 70). */
export function oasAgeFactor(startAge: number): number {
  const months = (Math.min(70, Math.max(65, startAge)) - 65) * 12
  return 1 + months * 0.006
}

/**
 * BE-39 A: an amount recorded on a basis other than 65 carries the factor of
 * its own basis, so the projection scales it by the ratio between the claim age
 * and the basis age rather than by the full claim factor. An amount already
 * stated at its claim age gets a ratio of 1, which stops a statement's
 * early-claim amount from being reduced a second time. A `null` basis is the
 * ordinary "amount at 65" contract and takes the full factor.
 */
export function cppAnnualAtBasis(amount: number, basisAge: number | null, startAge: number, maxAge = 70): number {
  return amount * (cppAgeFactor(startAge, maxAge) / cppAgeFactor(basisAge ?? 65, maxAge))
}

export function oasAnnualAtBasis(amount: number, basisAge: number | null, startAge: number): number {
  return amount * (oasAgeFactor(startAge) / oasAgeFactor(basisAge ?? 65))
}

/**
 * Claiming before 65 shortens the contributory period (18 → claim age), and
 * the 17% general dropout with it: at 60 the divisor is ~35 years, not 39,
 * so a FIRE retiree's zero-income years dilute less. Returns the multiplier
 * (≥1) to apply on top of the age-65 estimate for a work history that ended
 * by the claim age; 1 when the history is unknown or the claim is at 65+.
 */
export function earlyClaimDilutionRelief(
  startWorkAge: number,
  retireAge: number,
  claimAge: number,
): number {
  if (claimAge >= 65) return 1
  const from = Math.max(18, startWorkAge)
  const credited65 = Math.max(0, Math.min(65, retireAge) - from)
  const creditedClaim = Math.max(0, Math.min(claimAge, retireAge) - from)
  if (credited65 <= 0 || creditedClaim <= 0) return 1
  const divisorAtClaim = 0.83 * (claimAge - 18)
  const ratio65 = Math.min(1, credited65 / 39)
  const ratioClaim = Math.min(1, creditedClaim / divisorAtClaim)
  return ratioClaim / ratio65
}

/** OAS: no early start; +0.6%/month deferred past 65 (cap 70). */
export function oasAnnual(annualAt65: number, startAge: number): number {
  return annualAt65 * oasAgeFactor(startAge)
}

// 2026 figures — update annually. CPP max rises each year with the
// enhancement phase-in; OAS is the 65-74 rate (75+ gets +10%).
export const CPP_MAX_AT_65 = 18092
export const OAS_FULL_AT_65 = 9024

/**
 * Rough CPP/QPP estimate at 65: best 39 of the years between 18 and 65 count
 * (the general dropout removes ~17% of low years). Stopping contributions at
 * FIRE dilutes the average — the main reason early retirees get far less
 * than the maximum.
 *
 * @param avgEarningsRatio career-average pensionable earnings / YMPE, 0–1
 */
export function estimateCppAt65(
  startWorkAge: number,
  retireAge: number,
  avgEarningsRatio: number,
): number {
  const contributoryYears = Math.max(0, Math.min(retireAge, 65) - Math.max(18, startWorkAge))
  const creditedYears = Math.min(39, contributoryYears)
  return CPP_MAX_AT_65 * Math.min(1, Math.max(0, avgEarningsRatio)) * (creditedYears / 39)
}

/** OAS at 65: 40 years of Canadian residence after 18 = full, else prorated. */
export function estimateOasAt65(residenceYearsBy65: number): number {
  return OAS_FULL_AT_65 * Math.min(1, Math.max(0, residenceYearsBy65) / 40)
}

/**
 * BE-26 A: the GIS and Allowance parameter set for one published payment
 * quarter, selected by household shape rather than by one shared cut-off.
 *
 * The old shape of this module was: one single table, one couple table, and a
 * separate Allowance — so a couple with exactly one pensioner (the other
 * spouse 60-64 with no OAS and no Allowance) was priced with the single
 * 22,800 cut-off instead of its own 54,624 one, and a pensioner whose spouse
 * draws the Allowance was priced with the pensioners' 30,096 cut-off instead
 * of 42,144. Both figures now come from `GisRulePack`, one entry per category,
 * with the slope the official quarterly tables actually show.
 */
export const OAS_GIS_ALLOWANCE_2026_Q3: GisRulePack = selectGisRules()
const GIS_RULES: GisRulePack = OAS_GIS_ALLOWANCE_2026_Q3

/** The category keys a caller (and a reviewer) can ask about. */
export const GIS_HOUSEHOLD_CATEGORIES: GisHouseholdRuleCategory[] = [
  'single', 'couple-both-pensioners', 'couple-partner-allowance',
  'couple-partner-no-oas-no-allowance',
]

/**
 * A category the rule pack cannot price. It is not zero and not an estimate:
 * GIS requires an OAS pension, so a household where nobody receives one has no
 * modelled GIS at all.
 */
export type GisHouseholdClassification =
  | { status: 'modeled'; category: GisHouseholdRuleCategory; receivingAllowance: boolean }
  /** Nobody in the household receives OAS, so no GIS or Allowance is payable. */
  | { status: 'none'; reason: string }
  /** A fact needed to pick the row is unknown. Never priced as zero. */
  | { status: 'unsupported'; reason: string }

export interface GisCategoryOptions {
  /**
   * Whether the 60-64 spouse/common-law partner actually has the Allowance in
   * pay. Pinning it overrides the income test below. Pass `false` for the audit
   * case: an eligible-looking spouse who nonetheless draws neither OAS nor the
   * Allowance, whose household uses the 54,624 cut-off.
   */
  receivingAllowance?: boolean
  /**
   * The household's GIS test income. When given, a couple at or past the
   * Allowance cut-off is not receiving it, so the one-pensioner household falls
   * back to the "spouse receives neither OAS nor the Allowance" row.
   */
  grossIncome?: number
}

/**
 * The index of the one spouse receiving OAS, or null when the ages needed to
 * judge the second row were not supplied. Only a one-pensioner couple needs
 * ages (to tell a 60-64 spouse from a younger one); the single and
 * both-pensioners rows are decided by OAS receipt alone.
 */
function onlyPensionerIndex(
  receivingOas: boolean[],
  agesPerPerson: number[],
): number | null {
  if (receivingOas.length !== 2 || receivingOas.filter(Boolean).length !== 1) return null
  const oasIdx = receivingOas.findIndex(Boolean)
  return agesPerPerson.length === 2 ? oasIdx : null
}

/**
 * Whether the Allowance is in pay, which decides which of the two
 * one-pensioner rows applies. It is only reached when the caller has not
 * pinned the answer: a 60-64 spouse is read as a recipient unless the income
 * test says otherwise, and a spouse outside 60-64 never is. A household whose
 * combined income is at or past the Allowance cut-off is not receiving it, so
 * the pensioner's GIS falls back to the row whose cut-off is 54,624. Without
 * an income the only thing known is age eligibility.
 */
function allowanceInPay(oasIdx: number, agesPerPerson: number[], income: number | undefined): boolean {
  const otherAge = agesPerPerson[1 - oasIdx]
  if (otherAge < 60 || otherAge >= 65) return false
  return income === undefined || income < GIS_RULES.allowance.annualCutoff
}

/**
 * WHICH table row applies. Marital status is the array length; OAS receipt and
 * the 60-64 spouse's Allowance decide the couple row. The engine has no
 * single-parent/roommate household type, so a one-person household is single
 * and a two-person household is a couple.
 */
export function gisHouseholdCategory(
  receivingOas: boolean[],
  agesPerPerson: number[],
  options: GisCategoryOptions = {},
): GisHouseholdClassification {
  const receives = receivingOas.filter(Boolean).length
  if (receives === 0) {
    return { status: 'none', reason: 'GIS requires at least one spouse receiving an OAS pension; the Allowance requires a GIS recipient' }
  }
  if (receivingOas.length === 1) {
    return { status: 'modeled', category: 'single', receivingAllowance: false }
  }
  if (receives === 2) {
    return { status: 'modeled', category: 'couple-both-pensioners', receivingAllowance: false }
  }
  // An explicit pin decides the row without needing the ages that would
  // otherwise infer it: a caller that says the Allowance is (or is not) in pay
  // has answered the only question the ages were there to answer. Pinning it
  // *on* still needs both ages, because the allowance row's own maximum is the
  // 60-64 spouse's.
  if (options.receivingAllowance !== undefined) {
    if (options.receivingAllowance && agesPerPerson.length !== 2) {
      return { status: 'unsupported', reason: 'the Allowance is only payable to a 60 to 64 spouse/common-law partner, so its household row needs both ages' }
    }
    return {
      status: 'modeled',
      receivingAllowance: options.receivingAllowance,
      category: options.receivingAllowance ? 'couple-partner-allowance' : 'couple-partner-no-oas-no-allowance',
    }
  }
  // Otherwise the ages decide: a 60-64 spouse is read as an Allowance
  // recipient unless the income test says it is no longer in pay
  // (`allowanceInPay`). Without them the row is unknown, never guessed.
  const oasIdx = onlyPensionerIndex(receivingOas, agesPerPerson)
  if (oasIdx === null) {
    return { status: 'unsupported', reason: 'the one-pensioner couple rows need both ages: a spouse aged 60 to 64 is the Allowance row, an older or younger one is the row whose cut-off is 54,624' }
  }
  const inPay = allowanceInPay(oasIdx, agesPerPerson, options.grossIncome)
  return {
    status: 'modeled',
    receivingAllowance: inPay,
    category: inPay ? 'couple-partner-allowance' : 'couple-partner-no-oas-no-allowance',
  }
}

/**
 * GIS employment-income exemption: the first $5,000 of work income doesn't
 * count, and only half of the next $10,000 does. Statutory and identical for
 * every household category (ESDC footnote 6 on the quarterly table).
 */
export function gisWorkExemption(workIncome: number): number {
  const w = Math.max(0, workIncome)
  return Math.min(5000, w) + 0.5 * Math.min(10000, Math.max(0, w - 5000))
}

/**
 * The published tables' piecewise reduction, in annual dollars: the first
 * segment's rate applies up to its `upTo`, the next from there, and so on.
 * The tables change slope where the top-up itself starts to reduce and again
 * where it runs out, which is why this is piecewise rather than one line to
 * the cut-off.
 */
function segmentReduction(segments: GisReductionSegment[], income: number): number {
  let reduction = 0
  let lower = 0
  for (const segment of segments) {
    const inside = Math.max(0, Math.min(income, segment.upTo) - lower)
    reduction += inside * segment.rate
    lower = segment.upTo
    if (income <= segment.upTo) break
  }
  return reduction
}

interface CategoryAmounts {
  /** GIS for the whole household at this income, before the work exemption. */
  gis: number
  /** Allowance for this household at this income, 0 when none is in pay. */
  allowance: number
}

function categoryAmounts(
  category: GisHouseholdRuleCategory,
  receivingAllowance: boolean,
  income: number,
): CategoryAmounts {
  const rule = GIS_RULES.categories[category]
  // The maximum is the whole household's: a category whose table shows a
  // per-pensioner maximum (both pensioners) has two of them, which is why the
  // official reduction is 1/48 of joint income per pensioner and 1/4 for the
  // household.
  const gis = Math.max(0, rule.maxMonthly * 12 - segmentReduction(rule.reductionSegments, income))
  // The Allowance has its own maximum, top-up income and cut-off — never a GIS
  // maximum borrowed from a category that does not correspond to it — and its
  // own fitted reduction, which the pensioner-side GIS follows rather than
  // staying flat.
  const allowance = receivingAllowance
    ? Math.max(0, GIS_RULES.allowance.maxMonthly * 12 -
        segmentReduction(GIS_RULES.allowance.reductionSegments, income))
    : 0
  return { gis, allowance }
}

/**
 * Annual Allowance for a 60-64 spouse of a GIS recipient. Its income basis is
 * `benefitIncomeBasis`'s, so the Allowance-in-pay test, the work exemption and
 * the amount all come from one classification rather than from two that can
 * disagree near the 42,144 cut-off.
 *
 * Returns `null` — not zero — when the household's row cannot be determined
 * from the facts supplied.
 */
export function allowanceAnnual(
  receivingOas: boolean[],
  agesPerPerson: number[],
  householdIncome: number,
  options: GisCategoryOptions & { workIncome?: number } = {},
): number | null {
  const basis = benefitIncomeBasis(receivingOas, agesPerPerson, householdIncome, options)
  if (basis.status === 'modeled') return basis.allowance
  return basis.status === 'none' ? 0 : null
}

/**
 * The household's annual GIS *plus* any Allowance in pay — the one tax-free
 * OAS-program amount the projection adds to cash. `receivingOas` flags each
 * spouse actually receiving OAS (the GIS and the Allowance both require it);
 * `householdIncome` is income for the test — taxable income excluding OAS,
 * with the work exemption below applied first. `workIncome` is the employment
 * portion (Barista/side income), which gets the exemption; pass the household
 * total, since the exemption is one statutory amount for the couple's combined
 * employment income.
 *
 * The amount, the cut-off and whether the Allowance is in pay all come from
 * the household's own category; `benefitIncomeBasis` returns the same figure
 * split into GIS and Allowance with the category that produced it. This is the
 * function the audit faulted: a couple with exactly one pensioner previously
 * took the single table (13,478.04 max, 22,800 cut-off) even when the other
 * spouse had no OAS and no Allowance, whose correct cut-off is 54,624.
 *
 * Ages decide the two one-pensioner couple rows, so this returns `null` — not
 * a guessed age and not zero — when they are missing. `benefitIncomeBasis`
 * carries the concrete reason; `none` (nobody draws OAS) is a real zero.
 */
export function gisAnnual(
  receivingOas: boolean[],
  householdIncome: number,
  workIncome = 0,
  options: GisCategoryOptions & { agesPerPerson?: number[] } = {},
): number | null {
  const basis = benefitIncomeBasis(receivingOas, options.agesPerPerson ?? [], householdIncome, {
    ...options, workIncome,
  })
  if (basis.status === 'modeled') return basis.gis + basis.allowance
  return basis.status === 'none' ? 0 : null
}

/**
 * The GIS + Allowance cash amount for a household whose basis is already
 * classified. `none` is a real zero (nobody draws OAS, so neither the GIS nor
 * the Allowance is payable); an `unsupported` classification means a fact is
 * missing and is refused rather than priced at zero.
 */
export function basisAnnualAmount(basis: BenefitBasis): number {
  if (basis.status === 'modeled') return basis.gis + basis.allowance
  if (basis.status === 'none') return 0
  throw new Error(`GIS household basis is unsupported: ${basis.reason}`)
}

/**
 * The whole household's GIS + Allowance for one income, with the category, the
 * income basis and the two amounts exposed separately so a reviewer can check
 * which cut-off was used and why.
 */
export interface BenefitIncomeBasis {
  status: 'modeled'
  category: GisHouseholdRuleCategory
  /** Whether the Allowance is in pay (decides which couple row applies). */
  receivingAllowance: boolean
  /** The rule pack the amounts came from. */
  rulePackId: string
  paymentPeriod: string
  /** Income for the test before the work exemption. */
  grossIncome: number
  /** Work income removed by the exemption. */
  workExemption: number
  /** Income actually compared against the cut-off. */
  countableIncome: number
  /** Annual cut-off of the category that was used. */
  annualCutoff: number
  /** Annual maximum of the category that was used. */
  annualMax: number
  gis: number
  allowance: number
}
export type BenefitBasis =
  | BenefitIncomeBasis
  /** Nobody draws OAS, so no GIS or Allowance is payable: a real zero. */
  | { status: 'none'; reason: string }
  /** A fact the row needs is unknown. Never reported as zero. */
  | { status: 'unsupported'; reason: string }

/**
 * `grossIncome` is the GIS test income (taxable income excluding OAS);
 * `workIncome` is its employment portion; `agesPerPerson` is what
 * distinguishes a 60-64 spouse from a younger or older one. This is the single
 * entry point: `gisAnnual` and `allowanceAnnual` are thin wrappers over it, so
 * the Allowance-in-pay test and the amount cannot use different bases.
 */
export function benefitIncomeBasis(
  receivingOas: boolean[],
  agesPerPerson: number[],
  grossIncome: number,
  options: GisCategoryOptions & { workIncome?: number } = {},
): BenefitBasis {
  const workIncome = options.workIncome ?? 0
  const workExemption = gisWorkExemption(workIncome)
  const countableIncome = Math.max(0, grossIncome - workExemption)
  const classification = gisHouseholdCategory(receivingOas, agesPerPerson, { ...options, grossIncome: countableIncome })
  if (classification.status !== 'modeled') return classification
  const amounts = categoryAmounts(
    classification.category, classification.receivingAllowance, countableIncome,
  )
  const rule = GIS_RULES.categories[classification.category]
  return {
    status: 'modeled',
    category: classification.category,
    receivingAllowance: classification.receivingAllowance,
    rulePackId: GIS_RULES.id,
    paymentPeriod: GIS_RULES.paymentPeriod,
    grossIncome,
    workExemption,
    countableIncome,
    annualCutoff: rule.annualCutoff,
    annualMax: rule.maxMonthly * 12,
    gis: amounts.gis,
    allowance: amounts.allowance,
  }
}

/**
 * Canada Child Benefit rule selection, payment period and provenance.
 *
 * BE-38 B2. The CCB figures used to live in a `CCB` literal in this module and
 * `ccbAnnual` read that literal, while the sourced, versioned `BenefitRulePack`
 * existed only so `RuleAssumptions.tsx` could display it — "shown" but never
 * "computed with". The selection below is now what the computation reads:
 *
 *  - CCB is selected by *payment period* (the July-June program year, e.g.
 *    `2026-07/2027-06`, whose base year is the 2025 tax year), never by a
 *    calendar tax year;
 *  - the plan anchor is the published period below, in the same today's-dollar
 *    frame as the tax anchor (`PLAN_TAX_YEAR`), so an annually indexed benefit
 *    is not indexed a second time for a projected year;
 *  - a period beyond publication is projected from the latest published pack
 *    under that pack's own indexation policy, exactly once per elapsed program
 *    year, and is marked `assumedFutureRule`;
 *  - an unknown program or period refuses with its own concrete reason and
 *    never falls back to the published period.
 *
 * Raising the anchor to a newly published period is a deliberate, reviewed
 * number change, exactly like `PLAN_TAX_YEAR`.
 */
export const PLAN_BENEFIT_PERIOD = '2026-07/2027-06'

/** One selected CCB pack plus the policy that produced it. */
export interface BenefitRuleContext {
  program: 'CCB'
  /** The July-June payment period whose pack prices this computation. */
  paymentPeriod: string
  /** The pack itself. A pack is published data: callers never mutate it. */
  pack: BenefitRulePack
  /**
   * `published` means every figure is a published value. `assumed` means the
   * pack is a later period projected from `fromRuleId` by that pack's own
   * indexation policy, applied once per elapsed program year.
   */
  projectionPolicy:
    | { kind: 'published' }
    | { kind: 'assumed'; annualRate: number; fromRuleId: string; fromPaymentPeriod: string }
}

export type BenefitRuleSelection =
  | { status: 'ok'; context: BenefitRuleContext }
  /** No published or explicitly assumed pack can price this. Never a fallback. */
  | { status: 'unsupported'; reason: string }

/** The provenance every CCB amount must carry. */
export interface BenefitRuleProvenance {
  program: 'CCB'
  paymentPeriod: string
  rulePackId: string
  assumedFutureRule: boolean
  projectionPolicy: BenefitRuleContext['projectionPolicy']
  coverage: BenefitRulePack['coverage']
}

function benefitContextFor(pack: BenefitRulePack, paymentPeriod: string): BenefitRuleContext {
  return {
    program: 'CCB',
    paymentPeriod,
    pack,
    projectionPolicy: pack.assumedFutureRule
      ? {
          kind: 'assumed',
          annualRate: pack.assumedAnnualRate ?? 0,
          fromRuleId: pack.basedOnRuleId ?? pack.id,
          fromPaymentPeriod: pack.basedOnPaymentPeriod ?? paymentPeriod,
        }
      : { kind: 'published' },
  }
}

/**
 * Select the pack for one CCB payment period, returning the refusal rather than
 * throwing so a caller can surface it. An unknown program is never answered
 * with the CCB pack, and an unpublished period is never answered with a
 * published one. `packs` defaults to the published packs (a test seam).
 */
export function trySelectBenefitRules(request: {
  program: string
  paymentPeriod?: string
  futureIndexation?: { annualRate: number }
}, packs?: BenefitRulePack[]): BenefitRuleSelection {
  const paymentPeriod = request.paymentPeriod ?? PLAN_BENEFIT_PERIOD
  try {
    const pack = selectBenefitRules(request.program, paymentPeriod, request.futureIndexation, packs)
    return { status: 'ok', context: benefitContextFor(pack, paymentPeriod) }
  } catch (error) {
    return {
      status: 'unsupported',
      reason: error instanceof Error ? error.message : 'CCB rule selection failed',
    }
  }
}

/** Strict form of {@link trySelectBenefitRules}: throws the same concrete reason. */
export function selectPlanBenefitRules(request: {
  program: string
  paymentPeriod?: string
  futureIndexation?: { annualRate: number }
}, packs?: BenefitRulePack[]): BenefitRuleContext {
  const selection = trySelectBenefitRules(request, packs)
  if (selection.status === 'ok') return selection.context
  throw new Error(selection.reason)
}

/** The provenance every CCB result in a projection carries. */
export function benefitRuleProvenance(context: BenefitRuleContext): BenefitRuleProvenance {
  return {
    program: context.program,
    paymentPeriod: context.paymentPeriod,
    rulePackId: context.pack.id,
    assumedFutureRule: context.pack.assumedFutureRule,
    projectionPolicy: context.projectionPolicy,
    coverage: context.pack.coverage,
  }
}

/**
 * The plan-anchored CCB context, resolved once per payment period and then read
 * only. `ccbAnnual` runs inside every withdrawal bisection, so the context is
 * deep-frozen before it is cached and handed back: a stray write throws instead
 * of silently re-pricing every later amount while `rulePackId` still names the
 * published pack.
 */
const anchorBenefitContexts = new Map<string, BenefitRuleContext>()
export function anchorBenefitRules(period = PLAN_BENEFIT_PERIOD): BenefitRuleContext {
  const cached = anchorBenefitContexts.get(period)
  if (cached) return cached
  const context = freezeRuleContext(selectPlanBenefitRules({ program: 'CCB', paymentPeriod: period }))
  anchorBenefitContexts.set(period, context)
  return context
}

/**
 * Canada Child Benefit for one July-June payment period. The maximums, both
 * thresholds and both reduction-rate rows all come from the selected, sourced
 * pack: no amount or rate is a literal in this module.
 *
 * `nUnder6`/`n6to17` are counts of eligible children in each band, and `afni`
 * is the adjusted family net income approximation. The reduction is a
 * continuous two-segment line from the maximum: `rate1` of AFNI above `th1`
 * (up to `th2`) plus `rate2` above `th2`. The line replaces CRA's rounded flat
 * deduction at `th2` and differs from CRA's own worked examples by at most $1.
 *
 * AFNI here is approximated by the engine's household taxable income
 * (`totalTaxable`, includes OAS unlike the GIS income test; excludes TFSA
 * withdrawals) for the *same* year — no one-year lag like the real CRA
 * benefit-year mechanics (same simplification as GIS). Federal only: the
 * provincial top-ups, the Child Disability Benefit, shared-custody splitting
 * and eligibility/residence checks the pack names as unsupported are not added.
 *
 * The `rules` context is required, not defaulted: a result that does not carry
 * the pack it was priced from is exactly the defect this signature removes.
 */
export function ccbAnnual(nUnder6: number, n6to17: number, afni: number, rules?: BenefitRuleContext): number {
  const pack = (rules ?? anchorBenefitRules()).pack
  const { values } = pack
  const n = nUnder6 + n6to17
  if (n <= 0) return 0
  const idx = Math.min(n, 4) - 1
  const max = nUnder6 * values.maxUnder6 + n6to17 * values.max6to17
  const band1 = Math.max(0, Math.min(afni, values.th2) - values.th1)
  const band2 = Math.max(0, afni - values.th2)
  const reduction = values.rate1[idx] * band1 + values.rate2[idx] * band2
  return Math.max(0, max - reduction)
}

/**
 * RETIRED (BE-38 B2): the CCB figure set that used to price `ccbAnnual`.
 *
 * Nothing reads this any more — the annual amount is computed from the
 * selected `BenefitRulePack` (`CA-CCB-2026-07-v1` for the plan anchor period).
 * It is kept only so the previous slice's comparison and the mutation
 * diagnostic have a named subject: editing a number here must leave every test
 * green (it is dead), while editing the pack must not. Deleting it is a
 * follow-up, not part of this slice.
 *
 * @deprecated not computed with; use `selectPlanBenefitRules`/`ccbAnnual`'s pack.
 */
export const CCB = {
  maxUnder6: 8157,
  max6to17: 6883,
  th1: 38237,
  th2: 82847,
  rate1: [0.07, 0.135, 0.19, 0.23],
  rate2: [0.032, 0.057, 0.08, 0.095],
}

/**
 * BE-39 A: CPP/QPP and OAS rules this slice deliberately does not model. Each
 * names the concrete reason it is out of scope, so an unmodelled outcome is a
 * declared gap rather than a silent default. Nothing reads them to compute an
 * amount; a test asserts the boundary stays explicit.
 */
export interface BenefitUnsupportedPath {
  id: string
  reason: string
}

export const CPP_OAS_UNSUPPORTED_PATHS: BenefitUnsupportedPath[] = [
  {
    id: 'cpp-qpp-separate-dropout',
    reason: 'CPP and QPP have different dropout provisions (QPP excludes low-income months at 15% rather than the CPP 17% general dropout, and their enhanced/phase-in rules differ); BE-28 B owns the per-plan estimator, so this slice keeps one shared general-dropout approximation and labels every estimator amount as estimated',
  },
  {
    id: 'oas-residence-eligibility',
    reason: 'OAS residence is modelled only as a prorated 0-40 year scale, so a count below 40 is priced in proportion to it (3 years is priced at 676.80) and no minimum is applied. The 10-year minimum for in-Canada benefits, the 20-year requirement for benefits outside Canada and social-security-agreement years are not modelled, so the eligibility step those rules decide is absent',
  },
  {
    id: 'db-indexation-start',
    reason: 'an employer DB pension is an amount stated at its start age with an indexation fraction; whether the amount is today\'s purchasing power or a future nominal entitlement, and when indexation begins, are not resolved, so the projection assumes the stated amount and discloses the assumption rather than deriving it',
  },
  {
    id: 'provincial-benefit-interactions',
    reason: 'provincial benefit top-ups and their interaction with federal CPP/OAS/GIS amounts are not modelled; only federal CPP/QPP, OAS, GIS/Allowance and CCB enter the projection',
  },
]

export const OAS_CLAWBACK_THRESHOLD = 95323
export const OAS_CLAWBACK_RATE = 0.15

/** OAS received after recovery tax, given net income excluding OAS. */
export function oasAfterClawback(oasGross: number, otherIncome: number): number {
  const excess = Math.max(0, otherIncome + oasGross - OAS_CLAWBACK_THRESHOLD)
  return Math.max(0, oasGross - excess * OAS_CLAWBACK_RATE)
}
