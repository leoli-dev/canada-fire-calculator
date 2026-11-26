import { useTranslation } from 'react-i18next'

export function useCad(fractionDigits = 0) {
  const { i18n } = useTranslation()
  const fmt = new Intl.NumberFormat(i18n.language, {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
  return (v: number) => fmt.format(v)
}

/** CAD is stated once below each chart; use the narrow symbol on compact axes. */
export function useCadCompact() {
  const { i18n } = useTranslation()
  const fmt = new Intl.NumberFormat(i18n.language, {
    style: 'currency',
    currency: 'CAD',
    currencyDisplay: 'narrowSymbol',
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  return (v: number) => fmt.format(v)
}
