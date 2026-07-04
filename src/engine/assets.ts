// Asset-class real return and volatility assumptions, loosely based on the
// FP Canada Projection Assumption Guidelines 2026 (nominal minus 2.1%
// inflation). PAG returns are gross of fees — the engine subtracts the
// user's fee (MER) input separately. Update annually alongside taxData.ts.
export type AssetClass = 'stocks' | 'bonds' | 'gic' | 'cash'
export const ASSET_CLASSES: AssetClass[] = ['stocks', 'bonds', 'gic', 'cash']

export interface AssetAssumption {
  realReturn: number
  volatility: number
}

export const ASSET_ASSUMPTIONS: Record<AssetClass, AssetAssumption> = {
  // PAG 2026 nominal: equities ~6.4% blended, fixed income 3.2%, short 2.4%
  stocks: { realReturn: 0.043, volatility: 0.12 },
  bonds: { realReturn: 0.011, volatility: 0.05 },
  gic: { realReturn: 0.008, volatility: 0.01 },
  cash: { realReturn: 0.003, volatility: 0.005 },
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
