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

// 2025 figures — update annually
export const CPP_MAX_AT_65 = 17196
export const OAS_FULL_AT_65 = 8732

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

export const OAS_CLAWBACK_THRESHOLD = 90997
export const OAS_CLAWBACK_RATE = 0.15

/** OAS received after recovery tax, given net income excluding OAS. */
export function oasAfterClawback(oasGross: number, otherIncome: number): number {
  const excess = Math.max(0, otherIncome + oasGross - OAS_CLAWBACK_THRESHOLD)
  return Math.max(0, oasGross - excess * OAS_CLAWBACK_RATE)
}
