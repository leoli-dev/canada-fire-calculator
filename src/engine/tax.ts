import {
  FED_AGE_AMOUNT,
  FED_PENSION_AMOUNT,
  FEDERAL,
  ON_HEALTH_PREMIUM,
  ON_SURTAX,
  PROV_AGE_PENSION,
  PROBATE_RATES,
  PROVINCIAL,
  QC_ABATEMENT,
  QC_FSS,
  QC_RAMQ,
  type Bracket,
} from './taxData'
import type { Province } from './types'

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
function federalBpa(taxable: number): number {
  const { bpa, bpaMin, brackets } = FEDERAL
  if (bpaMin === undefined) return bpa
  const from = brackets[2].upTo
  const to = brackets[3].upTo
  const phase = Math.min(1, Math.max(0, (taxable - from) / (to - from)))
  return bpa - (bpa - bpaMin) * phase
}

/**
 * Combined federal + provincial income tax on taxable income.
 * Optional retiree credits: the age amount (65+, income-tested) and the
 * pension income amount, both federal and provincial. Taxable income stands
 * in for net income in the phase-outs.
 */
export function incomeTax(
  taxable: number,
  province: Province,
  credits?: PersonCredits,
): number {
  if (taxable <= 0) return 0
  const senior = (credits?.age ?? 0) >= 65
  const pensionInc = credits?.pensionIncome ?? 0

  let fedCredit = federalBpa(taxable) * FEDERAL.brackets[0].rate
  // the pension income amount has no age test of its own — eligibility by
  // income type is the caller's job (see PersonCredits.pensionIncome)
  fedCredit += Math.min(FED_PENSION_AMOUNT, pensionInc) * FEDERAL.brackets[0].rate
  if (senior) {
    const ageAmt = Math.max(
      0,
      FED_AGE_AMOUNT.max - FED_AGE_AMOUNT.rate * Math.max(0, taxable - FED_AGE_AMOUNT.threshold),
    )
    fedCredit += ageAmt * FEDERAL.brackets[0].rate
  }
  let fed = Math.max(0, bracketTax(taxable, FEDERAL.brackets) - fedCredit)
  if (province === 'QC') fed *= 1 - QC_ABATEMENT

  const p = PROVINCIAL[province]
  const lowRate = p.brackets[0].rate
  let provBpa = p.bpa
  if (p.bpaPhaseOut) {
    // MB: to zero over $200k–$400k; YT mirrors the federal enhanced BPA
    const { from, to, min } = p.bpaPhaseOut
    const phase = Math.min(1, Math.max(0, (taxable - from) / (to - from)))
    provBpa = p.bpa - (p.bpa - min) * phase
  }
  let provCredit = provBpa * lowRate
  // provincial pension amounts (outside QC) have no age test either; QC's
  // equivalent stays inside the senior block below, folded into its combined
  // family-income-tested credit
  if (province !== 'QC') {
    provCredit += Math.min(PROV_AGE_PENSION[province].pension, pensionInc) * lowRate
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
export function marginalRate(taxable: number, province: Province): number {
  if (taxable <= 0) return 0
  const at = (brackets: Bracket[]) => {
    let prev = 0
    for (const b of brackets) {
      if (taxable <= b.upTo && taxable > prev) return b.rate
      prev = b.upTo
    }
    return brackets[brackets.length - 1].rate
  }
  let fed = at(FEDERAL.brackets)
  if (province === 'QC') fed *= 1 - QC_ABATEMENT
  return fed + at(PROVINCIAL[province].brackets)
}
