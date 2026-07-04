import { useTranslation } from 'react-i18next'
import type { ProjectionResult } from '../engine'

export function Summary(props: { result: ProjectionResult; lifeExpectancy: number }) {
  const { t, i18n } = useTranslation()
  const fmt = new Intl.NumberFormat(i18n.language, {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  })
  const { result } = props
  return (
    <div className={`summary ${result.success ? 'ok' : 'bad'}`}>
      <p className="verdict">
        {result.success
          ? t('success', { age: props.lifeExpectancy })
          : t('depleted', { age: result.depletedAge })}
      </p>
      <p>
        {t('finalNetWorth')}: <strong>{fmt.format(result.finalNetWorth)}</strong>
      </p>
    </div>
  )
}
