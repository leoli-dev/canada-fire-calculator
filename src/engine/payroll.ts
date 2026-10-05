import type { Province } from './types'

/**
 * BE-46: 2026 payroll contributions on post-FIRE side income.
 *
 * Sources (2026):
 *   CPP: CRA "CPP contribution rates, maximums and exemptions" (YMPE 74,600,
 *   basic exemption 3,500, 5.95% each for employee and employer, 11.9%
 *   self-employed) and "Second additional CPP contribution rates and maximums"
 *   (YAMPE 85,000, 4% each, 8% self-employed).
 *   QPP: Revenu Québec / Retraite Québec 2026 parameters (same 74,600 / 85,000
 *   / 3,500; 6.30% employee, 12.60% self-employed; QPP2 4% / 8%).
 *   EI: CRA "EI premium rates and maximums" (68,900 insurable; 1.63%, Quebec
 *   1.30%). QPIP: Québec 2026 rates (0.430% employee, 0.764% self-employed;
 *   442.90 maximum employee premium, i.e. 103,000 insurable).
 *   Canada employment amount 2026: 1,501.
 *
 * Tax treatment follows the return: the base-plan contribution (4.95% CPP,
 * 5.30% QPP of pensionable earnings) and EI/QPIP premiums are credits at the
 * lowest rate; the first additional 1% and the second additional (CPP2/QPP2)
 * contributions are deductions; a self-employed person also deducts the
 * employer half. Provincial credits for these amounts are approximated at the
 * provincial lowest rate.
 */
export const PAYROLL_2026 = {
  ympe: 74_600,
  yampe: 85_000,
  basicExemption: 3_500,
  cpp: { employee: 0.0595, basePart: 0.0495, secondEmployee: 0.04 },
  qpp: { employee: 0.063, basePart: 0.053, secondEmployee: 0.04 },
  ei: { insurable: 68_900, rate: 0.0163, quebecRate: 0.013 },
  qpip: { insurable: 103_000, employee: 0.0043, selfEmployed: 0.00764 },
  canadaEmploymentAmount: 1_501,
} as const

/** `other`: income with no payroll contributions (royalties, director fees taken as dividends, and so on). */
export type SideIncomeKind = 'employment' | 'selfEmployment' | 'other'

export interface PayrollDeductions {
  /** Cash withheld or paid on the earnings. */
  contributions: number
  /** Deducted from taxable income (enhanced CPP/QPP, CPP2/QPP2, employer half when self-employed). */
  taxDeduction: number
  /** Credited at the lowest federal and provincial rates (base CPP/QPP, EI, QPIP). */
  creditAmount: number
  /** The Canada employment amount, credited federally only. */
  employmentAmount: number
}

export function sideIncomeDeductions(earnings: number, kind: SideIncomeKind, province: Province): PayrollDeductions {
  const e = Math.max(0, earnings)
  if (e === 0 || kind === 'other') return { contributions: 0, taxDeduction: 0, creditAmount: 0, employmentAmount: 0 }
  const p = PAYROLL_2026
  const quebec = province === 'QC'
  const plan = quebec ? p.qpp : p.cpp
  const self = kind === 'selfEmployment'
  const pensionable = Math.max(0, Math.min(e, p.ympe) - p.basicExemption)
  const second = Math.max(0, Math.min(e, p.yampe) - p.ympe)
  const multiplier = self ? 2 : 1
  const base = pensionable * plan.employee * multiplier
  const secondContribution = second * plan.secondEmployee * multiplier
  const basePart = pensionable * plan.basePart
  const enhancedPart = pensionable * (plan.employee - plan.basePart)
  const ei = self ? 0 : Math.min(e, p.ei.insurable) * (quebec ? p.ei.quebecRate : p.ei.rate)
  const qpip = quebec ? Math.min(e, p.qpip.insurable) * (self ? p.qpip.selfEmployed : p.qpip.employee) : 0
  // Self-employed: the employer half of the base and second contributions is deducted too.
  const employerHalf = self ? pensionable * plan.employee + second * plan.secondEmployee : 0
  return {
    contributions: base + secondContribution + ei + qpip,
    taxDeduction: enhancedPart + second * plan.secondEmployee + employerHalf,
    creditAmount: basePart + ei + qpip,
    employmentAmount: self ? 0 : Math.min(p.canadaEmploymentAmount, e),
  }
}
