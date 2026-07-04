// Asset-class real return and volatility assumptions, loosely based on the
// FP Canada Projection Assumption Guidelines (nominal minus ~2.1% inflation).
// Update annually alongside taxData.ts.
export type AssetClass = 'stocks' | 'bonds' | 'gic' | 'cash'
export const ASSET_CLASSES: AssetClass[] = ['stocks', 'bonds', 'gic', 'cash']

export interface AssetAssumption {
  realReturn: number
  volatility: number
}

export const ASSET_ASSUMPTIONS: Record<AssetClass, AssetAssumption> = {
  stocks: { realReturn: 0.045, volatility: 0.12 },
  bonds: { realReturn: 0.013, volatility: 0.05 },
  gic: { realReturn: 0.01, volatility: 0.01 },
  cash: { realReturn: 0.002, volatility: 0.005 },
}

export type AssetMix = Record<AssetClass, number>

export function blendedReturn(mix: AssetMix): number {
  return ASSET_CLASSES.reduce(
    (sum, c) => sum + (mix[c] ?? 0) * ASSET_ASSUMPTIONS[c].realReturn,
    0,
  )
}

/** Simplified: weighted-average volatility (ignores correlations). */
export function blendedVolatility(mix: AssetMix): number {
  return ASSET_CLASSES.reduce(
    (sum, c) => sum + (mix[c] ?? 0) * ASSET_ASSUMPTIONS[c].volatility,
    0,
  )
}
