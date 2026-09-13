import { CAPITAL_GAINS_INCLUSION } from './taxData'

/** All amounts here are nominal CAD at the event date. Rendering and legacy
 * funding may use real dollars, but neither is an ACB accounting unit. */
export interface CapitalHolding { marketValue: number; acb: number }
export type CapitalResult<T> = { status: 'ok'; value: T } |
  { status: 'invalid' | 'unsupported'; reason: string }
export interface CapitalDisposal {
  grossProceeds: number
  sellingExpenses: number
  allocatedAcb: number
  netProceeds: number
  gain: number
  closing: CapitalHolding
}
const valid = (n: number) => Number.isFinite(n) && n >= 0
const ok = <T>(value: T): CapitalResult<T> => ({ status: 'ok', value })
const invalid = <T>(reason: string): CapitalResult<T> => ({ status: 'invalid', reason })

/** A real display amount converts at the event year's base-year price index. */
export function nominalFactor(inflation: number, yearsFromBase: number): number {
  return (1 + inflation) ** yearsFromBase
}
export function toNominal(realAmount: number, factor: number): number { return realAmount * factor }
export function toReal(nominalAmount: number, factor: number): number { return nominalAmount / factor }

/** Average ACB of identical units: buys and reinvested distributions increase
 * cost by the amount actually reinvested. A tax payment is separate cash flow.
 * CRA mutual-fund example: https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/personal-income/line-12700-capital-gains/completing-schedule-3/tax-treatment-mutual-funds.html */
export function buyHolding(opening: CapitalHolding, purchase: number, acquisitionExpenses = 0): CapitalResult<CapitalHolding> {
  if (![opening.marketValue, opening.acb, purchase, acquisitionExpenses].every(valid)) return invalid('holding or purchase invalid')
  return ok({ marketValue: opening.marketValue + purchase, acb: opening.acb + purchase + acquisitionExpenses })
}

/** Sell a proportional share of one average-cost pool. A high ACB is legal;
 * losses are retained. Selling expenses reduce proceeds once, not ACB and
 * proceeds both. A negative result requires verified absence of a superficial
 * loss before it can be applied to tax.
 * CRA T4037: https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4037/capital-gains.html */
export function disposeHolding(opening: CapitalHolding, grossProceeds: number,
  sellingExpenses = 0, lossTreatment: 'confirmedNotSuperficial' | 'unknown' = 'unknown'):
  CapitalResult<CapitalDisposal> {
  if (![opening.marketValue, opening.acb, grossProceeds, sellingExpenses].every(valid) ||
      grossProceeds > opening.marketValue + 1e-8 || sellingExpenses > grossProceeds)
    return invalid('holding or disposal invalid')
  if (opening.marketValue === 0 && grossProceeds !== 0) return invalid('cannot sell an empty holding')
  const allocatedAcb = opening.marketValue === 0 ? 0 : opening.acb * (grossProceeds / opening.marketValue)
  const netProceeds = grossProceeds - sellingExpenses
  const gain = netProceeds - allocatedAcb
  if (gain < -1e-8 && lossTreatment === 'unknown')
    return { status: 'unsupported', reason: 'superficial-loss status not confirmed' }
  return ok({ grossProceeds, sellingExpenses, allocatedAcb, netProceeds, gain,
    closing: { marketValue: Math.max(0, opening.marketValue - grossProceeds),
      acb: Math.max(0, opening.acb - allocatedAcb) } })
}

export interface PersonCapitalYear {
  realizedGain: number
  openingLossCarry: number
  netTaxableGain: number
  closingLossCarry: number
}
/** Carry pre-inclusion nominal net capital loss by owner. A loss never offsets
 * wage, pension or other ordinary income. The pinned 2026 inclusion rate is
 * used only after netting the eligible gains. Future statutory rate changes
 * require BE-38's dated rule pack before they can be called exact.
 * CRA: https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/personal-income/line-12700-capital-gains/capital-losses-deductions.html */
export function settlePersonCapitalYear(realizedGain: number, openingLossCarry: number,
  inclusion = CAPITAL_GAINS_INCLUSION): CapitalResult<PersonCapitalYear> {
  if (!Number.isFinite(realizedGain) || !valid(openingLossCarry) || !valid(inclusion) || inclusion > 1)
    return invalid('capital loss carry or inclusion invalid')
  const net = realizedGain - openingLossCarry
  return ok({ realizedGain, openingLossCarry, netTaxableGain: Math.max(0, net) * inclusion,
    closingLossCarry: Math.max(0, -net) })
}

/** Taxable ownership is not a household 50/50 assumption. */
export function splitGainByOwner(gain: number, shares: Record<string, number>): CapitalResult<Record<string, number>> {
  if (!Number.isFinite(gain) || !Object.keys(shares).length ||
      Object.values(shares).some(share => !valid(share)) ||
      Math.abs(Object.values(shares).reduce((sum, share) => sum + share, 0) - 1) > 1e-8)
    return invalid('capital ownership shares invalid')
  return ok(Object.fromEntries(Object.entries(shares).map(([id, share]) => [id, gain * share])))
}

export function settleHouseholdCapitalYear(events: { gain: number; shares: Record<string, number> }[],
  openingLossCarry: Record<string, number>, inclusion = CAPITAL_GAINS_INCLUSION):
  CapitalResult<Record<string, PersonCapitalYear>> {
  const byOwner: Record<string, number> = {}
  for (const event of events) {
    const split = splitGainByOwner(event.gain, event.shares)
    if (split.status !== 'ok') return split
    for (const [id, amount] of Object.entries(split.value)) byOwner[id] = (byOwner[id] ?? 0) + amount
  }
  const output: Record<string, PersonCapitalYear> = {}
  for (const id of new Set([...Object.keys(byOwner), ...Object.keys(openingLossCarry)])) {
    const settled = settlePersonCapitalYear(byOwner[id] ?? 0, openingLossCarry[id] ?? 0, inclusion)
    if (settled.status !== 'ok') return settled
    output[id] = settled.value
  }
  return ok(output)
}
