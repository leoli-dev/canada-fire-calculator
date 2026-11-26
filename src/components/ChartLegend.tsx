import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui'

export type ChartSeries = { key: string; label: string; color: string }
export function useChartSeries() {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  return { hidden, toggle: (key: string) => setHidden(previous => {
    const next = new Set(previous)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }) }
}

/** Outside the chart's role=img so the controls remain available to assistive technology. */
export function ChartLegend({ series, hidden, toggle, title }: { series: ChartSeries[]; hidden: Set<string>; toggle: (key: string) => void; title: string }) {
  const { t } = useTranslation()
  return <div className="chart-legend" role="group" aria-label={t('ui.results.series', { title })}>
    {series.map(item => <Button key={item.key} size="sm" aria-pressed={!hidden.has(item.key)} data-series={item.key} onClick={() => toggle(item.key)}>
      <span className="chart-swatch" aria-hidden="true" style={{ '--series-color': item.color } as CSSProperties} />{item.label}
    </Button>)}
  </div>
}
