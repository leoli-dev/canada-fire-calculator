import { useMemo } from 'react'

const tokens = {
  tfsa: 'c-tfsa', rrsp: 'c-rrsp', nonReg: 'c-nonreg', fhsa: 'c-fhsa', locked: 'c-locked', property: 'c-property',
  cpp: 'c-cpp', oas: 'c-oas', gis: 'c-gis', ccb: 'c-ccb', rent: 'c-rent', extraIncome: 'c-extra-income', pension: 'c-pension',
  need: 'c-need', tax: 'c-tax', shortfall: 'c-shortfall', shortfallTint: 'critical-tint',
  mcBand: 'c-mc-band', mcMedian: 'c-mc-median', mcWorst: 'c-mc-worst',
  fire: 'c-marker-fire', pensionMarker: 'c-marker-pension', sale: 'c-marker-sale', bridge: 'c-bridge', grid: 'c-grid', axis: 'c-axis',
} as const

/** Recharts needs concrete values, so resolve the CSS tokens once per mounted chart. */
export function readChartColors(style: Pick<CSSStyleDeclaration, 'getPropertyValue'> = getComputedStyle(document.documentElement)) {
  return Object.fromEntries(Object.entries(tokens).map(([key, token]) => [key, style.getPropertyValue(`--${token}`).trim()])) as Record<keyof typeof tokens, string>
}
export function useChartColors() { return useMemo(() => readChartColors(), []) }
