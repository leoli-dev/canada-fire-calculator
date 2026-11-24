/** Exact finite-decimal CAD modeling basis: Number.toString inputs/postings/rates.
 * This is a modeling convention, not reconstruction of lender data. State is
 * JSON compatible; bounded scale/digits prevent unbounded rational growth. */
export interface MortgageDecimal { coefficient: string; scale: number }
export class MortgagePrecisionError extends Error {
  readonly status = "unsupported" as const
  readonly reason = "mortgage decimal precision boundary"
}
const LIMIT = 8192
function decimal(n: bigint, scale: number): MortgageDecimal {
  while (scale > 0 && n % 10n === 0n) { n /= 10n; scale-- }
  if (scale < 0 || scale > LIMIT || n.toString().length > LIMIT) throw new MortgagePrecisionError()
  return { coefficient: n.toString(), scale }
}
export function validMortgageDecimal(d: MortgageDecimal): boolean {
  return !!d && typeof d.coefficient === 'string' && /^-?\d+$/.test(d.coefficient) && d.coefficient.length <= LIMIT && Number.isInteger(d.scale) && d.scale >= 0 && d.scale <= LIMIT
}
export function mortgageDecimal(n: number): MortgageDecimal {
  if (!Number.isFinite(n)) throw new MortgagePrecisionError()
  const [mantissa, exponent = '0'] = n.toString().split('e')
  const scale = (mantissa.split('.')[1]?.length ?? 0) - Number(exponent)
  const integer = BigInt(mantissa.replace('.', ''))
  return scale < 0 ? decimal(integer * 10n ** BigInt(-scale), 0) : decimal(integer, scale)
}
export function mortgageAdd(a: MortgageDecimal, b: MortgageDecimal): MortgageDecimal {
  const scale = Math.max(a.scale, b.scale)
  return decimal(BigInt(a.coefficient) * 10n ** BigInt(scale - a.scale) + BigInt(b.coefficient) * 10n ** BigInt(scale - b.scale), scale)
}
export const mortgageNegate = (a: MortgageDecimal): MortgageDecimal => ({ ...a, coefficient: (-BigInt(a.coefficient)).toString() })
export const mortgageSubtract = (a: MortgageDecimal, b: MortgageDecimal) => mortgageAdd(a, mortgageNegate(b))
export const mortgageMultiply = (a: MortgageDecimal, b: MortgageDecimal) => decimal(BigInt(a.coefficient) * BigInt(b.coefficient), a.scale + b.scale)
export const mortgageNegative = (a: MortgageDecimal) => BigInt(a.coefficient) < 0n
export function mortgageNumber(a: MortgageDecimal): number {
  const negative = a.coefficient.startsWith('-'), digits = negative ? a.coefficient.slice(1) : a.coefficient
  return Number(`${negative ? '-' : ''}${digits}e-${a.scale}`)
}
export function mortgageClosing(opening: MortgageDecimal, contribution: number, withdrawal: number, rate: number): MortgageDecimal {
  return mortgageMultiply(mortgageSubtract(mortgageAdd(opening, mortgageDecimal(contribution)), mortgageDecimal(withdrawal)), mortgageAdd(mortgageDecimal(1), mortgageDecimal(rate)))
}
