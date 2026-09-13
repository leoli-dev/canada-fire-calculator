import type { Province } from './types'

/** CRA 2026 TD1 and provincial TD1 forms, claim before the lowest-rate credit.
 * https://www.canada.ca/content/dam/cra-arc/formspubs/pbg/td1/td1-26e.pdf
 * Provincial source: https://www.canada.ca/content/dam/cra-arc/formspubs/pbg/td1on/td1on-26e.pdf
 * Replace `on` with each jurisdiction code below for its own 2026 TD1.
 * QC has a separate household framework; BE-35 must supply that rule. */
const PROVINCIAL_SPOUSE: Partial<Record<Province, { max: number; threshold: number }>> = {
  AB: { max: 22769, threshold: 22769 }, BC: { max: 11317, threshold: 12449 },
  MB: { max: 9134, threshold: 9134 }, NB: { max: 10709, threshold: 11781 },
  NL: { max: 9142, threshold: 10057 }, NS: { max: 11932, threshold: 12820 },
  NT: { max: 18198, threshold: 18198 }, NU: { max: 19659, threshold: 19659 },
  ON: { max: 11029, threshold: 12132 }, PE: { max: 12740, threshold: 14014 },
  SK: { max: 20381, threshold: 22419 }, YT: { max: 16452, threshold: 16452 },
}

export function federalSpouseAmount2026(spouseNet: number, claimantBpa: number): number {
  return Math.max(0, claimantBpa - Math.max(0, spouseNet))
}

export function provincialSpouseAmount2026(province: Province, spouseNet: number): number | null {
  const rule = PROVINCIAL_SPOUSE[province]
  return rule ? Math.min(rule.max, Math.max(0, rule.threshold - Math.max(0, spouseNet))) : null
}
