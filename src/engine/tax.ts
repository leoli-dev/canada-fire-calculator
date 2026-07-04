import { FEDERAL, PROVINCIAL, QC_ABATEMENT, type Bracket } from './taxData'
import type { Province } from './types'

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

/** Combined federal + provincial income tax on taxable income. */
export function incomeTax(taxable: number, province: Province): number {
  if (taxable <= 0) return 0
  let fed = Math.max(
    0,
    bracketTax(taxable, FEDERAL.brackets) - FEDERAL.bpa * FEDERAL.brackets[0].rate,
  )
  if (province === 'QC') fed *= 1 - QC_ABATEMENT
  const p = PROVINCIAL[province]
  const prov = Math.max(
    0,
    bracketTax(taxable, p.brackets) - p.bpa * p.brackets[0].rate,
  )
  return fed + prov
}
