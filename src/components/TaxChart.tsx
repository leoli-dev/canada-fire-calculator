import { ChartLegend, useChartSeries, type ChartSeries } from './ChartLegend'
import { useChartColors } from '../chartColors'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { marginalRate, type Inputs, type ProjectionResult } from '../engine'
import { useCad, useCadCompact } from '../format'
import { Jargon } from './Jargon'


const SOURCE_KEYS = ['rrsp', 'nonReg', 'cpp', 'oas', 'property', 'extraIncome', 'pension'] as const
type SourceKey = (typeof SOURCE_KEYS)[number]

interface TaxChartRow {
  age: number
  total: number
  totalTaxable: number
  avgRate: number
  marginalRate: number
  rrsp: number
  nonReg: number
  cpp: number
  oas: number
  property: number
  extraIncome: number
  pension: number
  taxableRrsp: number
  taxableNonReg: number
  taxableCpp: number
  taxableOas: number
  taxableProperty: number
  taxableExtraIncome: number
  taxablePension: number
}

const TAXABLE_KEY: Record<SourceKey, keyof TaxChartRow> = {
  rrsp: 'taxableRrsp',
  nonReg: 'taxableNonReg',
  cpp: 'taxableCpp',
  oas: 'taxableOas',
  property: 'taxableProperty',
  extraIncome: 'taxableExtraIncome',
  pension: 'taxablePension',
}

/**
 * Breaks the tax line from IncomeChart down by taxable source. Canada taxes
 * all income together on one bracket ladder, so there is no statutory
 * per-source tax; each slice is that source's share of the total taxable
 * income, scaled against the year's actual tax — the slices always sum to
 * the same total shown as the dashed line above. The tooltip pairs each
 * slice with the taxable income it came from, so it can be cross-referenced
 * against the gross-income breakdown in the chart above.
 */
export function TaxChart(props: {
  result: ProjectionResult
  inputs: Inputs
  scale?: (age: number) => number
}) {
  const { t } = useTranslation()
  const COLORS = useChartColors()
  const id = useId().replace(/:/g, '')
  const { hidden, toggle } = useChartSeries()
  const cad = useCad()
  const cadTick = useCadCompact()
  const k = props.scale ?? (() => 1)
  const persons = props.inputs.partner ? 2 : 1
  const data: TaxChartRow[] = props.result.rows
    .filter((r) => r.phase !== 'accumulation')
    .map((r) => {
      const s = r.taxBySource
      const ti = r.taxableBySource
      const totalTaxable = r.taxablePerPerson * persons
      return {
        age: r.age,
        rrsp: Math.round(s.rrsp * k(r.age)),
        nonReg: Math.round(s.nonReg * k(r.age)),
        cpp: Math.round(s.cpp * k(r.age)),
        oas: Math.round(s.oas * k(r.age)),
        property: Math.round(s.property * k(r.age)),
        extraIncome: Math.round(s.extraIncome * k(r.age)),
        pension: Math.round(s.pension * k(r.age)),
        taxableRrsp: Math.round(ti.rrsp * k(r.age)),
        taxableNonReg: Math.round(ti.nonReg * k(r.age)),
        taxableCpp: Math.round(ti.cpp * k(r.age)),
        taxableOas: Math.round(ti.oas * k(r.age)),
        taxableProperty: Math.round(ti.property * k(r.age)),
        taxableExtraIncome: Math.round(ti.extraIncome * k(r.age)),
        taxablePension: Math.round(ti.pension * k(r.age)),
        total: Math.round(r.tax * k(r.age)),
        // household total (not per-person) so it's directly comparable to
        // the household tax total in the same tooltip
        totalTaxable: Math.round(totalTaxable * k(r.age)),
        avgRate: totalTaxable > 0 ? r.tax / totalTaxable : 0,
        marginalRate: marginalRate(r.taxablePerPerson, props.inputs.province),
      }
    })

  const hasProperty = data.some((d) => d.property > 0 || d.taxableProperty > 0)
  const hasExtra = data.some((d) => d.extraIncome > 0 || d.taxableExtraIncome > 0)
  const hasPension = data.some((d) => d.pension > 0 || d.taxablePension > 0)

  if (data.length === 0) return null

  const peak = data.reduce((top, d) => (d.total > top.total ? d : top), data[0])
  const summary = t('taxChartSummary', {
    startAge: data[0].age, endAge: data[data.length - 1].age,
    total: cad(data.reduce((sum, d) => sum + d.total, 0)), peak: cad(peak.total), peakAge: peak.age,
  })

  const sourceLabels: Record<SourceKey, string> = {
    rrsp: t('rrsp'),
    nonReg: t('taxSrcNonReg'),
    cpp: t('cppLabel'),
    oas: t('oasLabel'),
    property: t('taxSrcProperty'),
    extraIncome: t('extraIncomeLabel'),
    pension: t('pensionLabel'),
  }
  const visibleSources: SourceKey[] = [
    'rrsp', 'nonReg', 'cpp', 'oas',
    ...(hasProperty ? (['property'] as const) : []),
    ...(hasExtra ? (['extraIncome'] as const) : []),
    ...(hasPension ? (['pension'] as const) : []),
  ]

  const series: ChartSeries[] = visibleSources.map(key => ({ key, label: sourceLabels[key], color: COLORS[key] }))

  function ChartTooltip(tprops: { active?: boolean; payload?: { payload?: TaxChartRow }[]; label?: number }) {
    const d = tprops.payload?.[0]?.payload
    if (!tprops.active || !d) return null
    return (
      <div className="chart-tooltip">
        <p>{tprops.label}</p>
        <p>{t('total')}：{cad(d.total)}</p>
        {visibleSources.map((key) => (
          <p key={key} className="chart-tooltip-source" style={{ '--series-color': COLORS[key] } as React.CSSProperties}>
            {sourceLabels[key]}：{t('taxTaxablePrefix')} {cad(d[TAXABLE_KEY[key]])} → {t('taxLabel')} {cad(d[key])}
          </p>
        ))}
        <p>{t('taxTotalTaxable')}：{cad(d.totalTaxable)}</p>
        <p>{t('taxAvgRate')}：{(d.avgRate * 100).toFixed(1)}%</p>
        <p>{t('colMarginal')}：{(d.marginalRate * 100).toFixed(1)}%</p>
      </div>
    )
  }

  return (
    <div className="chart-card">
      <div className="chart-heading"><h3 id={`${id}-title`}>{t('taxChartTitle')}</h3>
      <ChartLegend title={t('taxChartTitle')} series={series} hidden={hidden} toggle={toggle} />
      </div>
      {/* FE-45: the chart is one image to assistive tech, described in words. */}
      <p className="sr-only" id={`${id}-summary`}>{summary}</p>
      <div className="chart-plot" role="img" aria-labelledby={`${id}-title`} aria-describedby={`${id}-summary`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" strokeOpacity={0.4} />
          <XAxis stroke={COLORS.axis} dataKey="age" type="number" allowDecimals={false}
            domain={[data[0].age, data[data.length - 1].age]}
            tickCount={6} minTickGap={24} />
          <YAxis stroke={COLORS.axis} tickFormatter={(v: number) => cadTick(v)} width={58} tick={{ fontSize: 12 }} />
          <Tooltip includeHidden content={ChartTooltip} />
          <Line dataKey="total" name={t('total')} stroke="none" dot={false} activeDot={false} legendType="none" />
          <Area hide={hidden.has('rrsp')} dataKey="rrsp" stackId="1" name={t('rrsp')} stroke={COLORS.rrsp} fill={COLORS.rrsp} fillOpacity={0.55} />
          <Area hide={hidden.has('nonReg')} dataKey="nonReg" stackId="1" name={t('taxSrcNonReg')} stroke={COLORS.nonReg} fill={COLORS.nonReg} fillOpacity={0.55} />
          <Area hide={hidden.has('cpp')} dataKey="cpp" stackId="1" name={t('cppLabel')} stroke={COLORS.cpp} fill={COLORS.cpp} fillOpacity={0.55} />
          <Area hide={hidden.has('oas')} dataKey="oas" stackId="1" name={t('oasLabel')} stroke={COLORS.oas} fill={COLORS.oas} fillOpacity={0.55} />
          {hasProperty && (
            <Area hide={hidden.has('property')} dataKey="property" stackId="1" name={t('taxSrcProperty')} stroke={COLORS.property} fill={COLORS.property} fillOpacity={0.55} />
          )}
          {hasExtra && (
            <Area hide={hidden.has('extraIncome')} dataKey="extraIncome" stackId="1" name={t('extraIncomeLabel')} stroke={COLORS.extraIncome} fill={COLORS.extraIncome} fillOpacity={0.55} />
          )}
          {hasPension && (
            <Area hide={hidden.has('pension')} dataKey="pension" stackId="1" name={t('pensionLabel')} stroke={COLORS.pension} fill={COLORS.pension} fillOpacity={0.55} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      </div>
      <p className="chart-currency">{t('ui.results.currency')}</p>
      <p className="hint"><Jargon text={t('taxChartNote')} /></p>
    </div>
  )
}
