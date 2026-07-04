import { useTranslation } from 'react-i18next'

export function useCad() {
  const { i18n } = useTranslation()
  const fmt = new Intl.NumberFormat(i18n.language, {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  })
  return (v: number) => fmt.format(v)
}

/** Compact axis-tick formatter: CA$6M, CA$150K — keeps charts readable on mobile. */
export function useCadCompact() {
  const { i18n } = useTranslation()
  const fmt = new Intl.NumberFormat(i18n.language, {
    style: 'currency',
    currency: 'CAD',
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  return (v: number) => fmt.format(v)
}
