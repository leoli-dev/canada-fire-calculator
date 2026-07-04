// CPP/QPP and OAS start-age adjustments and OAS clawback. 2025 figures.

/** CPP/QPP: -0.6%/month before 65 (floor age 60), +0.7%/month after (cap 70). */
export function cppAnnual(annualAt65: number, startAge: number): number {
  const months = (Math.min(70, Math.max(60, startAge)) - 65) * 12
  const factor = months < 0 ? 1 + months * 0.006 : 1 + months * 0.007
  return annualAt65 * factor
}

/** OAS: no early start; +0.6%/month deferred past 65 (cap 70). */
export function oasAnnual(annualAt65: number, startAge: number): number {
  const months = (Math.min(70, Math.max(65, startAge)) - 65) * 12
  return annualAt65 * (1 + months * 0.006)
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

// 2026 income year (2025: $93,454; the old $90,997 was the 2024 threshold)
/**
 * GIS (Guaranteed Income Supplement), 2026 Q3 annualized. Linear
 * approximation of the official tables: the maximum benefit shrinks to zero
 * at the income cutoff. GIS income excludes OAS itself — and TFSA
 * withdrawals are invisible to it, which is why low-taxable-income early
 * retirees can qualify.
 */
export const GIS_SINGLE = { max: 13478, cutoff: 22800 }
export const GIS_COUPLE = { maxEach: 8113, cutoff: 30096 }

/**
 * Annual household GIS. `receivingOas` flags each spouse actually receiving
 * OAS (GIS requires it); `householdIncome` is taxable income excluding OAS.
 * A couple with only one pensioner is approximated with the single rate.
 */
export function gisAnnual(receivingOas: boolean[], householdIncome: number): number {
  const receiving = receivingOas.filter(Boolean).length
  if (receiving === 0) return 0
  if (receivingOas.length === 2 && receiving === 2) {
    return Math.max(0, 2 * GIS_COUPLE.maxEach * (1 - householdIncome / GIS_COUPLE.cutoff))
  }
  return Math.max(0, GIS_SINGLE.max * (1 - householdIncome / GIS_SINGLE.cutoff))
}

export const OAS_CLAWBACK_THRESHOLD = 95323
export const OAS_CLAWBACK_RATE = 0.15

/** OAS received after recovery tax, given net income excluding OAS. */
export function oasAfterClawback(oasGross: number, otherIncome: number): number {
  const excess = Math.max(0, otherIncome + oasGross - OAS_CLAWBACK_THRESHOLD)
  return Math.max(0, oasGross - excess * OAS_CLAWBACK_RATE)
}
