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
