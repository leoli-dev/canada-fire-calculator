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
  ReferenceLine,
} from 'recharts'
import type { ProjectionResult } from '../engine'
import { useCad, useCadCompact } from '../format'
import { Jargon } from './Jargon'


export function IncomeChart(props: {
  result: ProjectionResult
  fireAge: number
  scale?: (age: number) => number
}) {
  const { t } = useTranslation()
  const COLORS = useChartColors()
  const id = useId().replace(/:/g, '')
  const { hidden, toggle } = useChartSeries()
  const cad = useCad()
  const cadTick = useCadCompact()
  const k = props.scale ?? (() => 1)
  const data = props.result.rows
    .filter((r) => r.phase !== 'accumulation')
    .map((r) => ({
      age: r.age,
      tfsa: Math.round(r.withdrawals.tfsa * k(r.age)),
      rrsp: Math.round(r.withdrawals.rrsp * k(r.age)),
      nonReg: Math.round(r.withdrawals.nonReg * k(r.age)),
      cpp: Math.round(r.cpp * k(r.age)),
      oas: Math.round(r.oas * k(r.age)),
      gis: Math.round(r.gis * k(r.age)),
      ccb: Math.round(r.ccb * k(r.age)),
      rent: Math.round(r.rent * k(r.age)),
      extraIncome: Math.round(r.extraIncome * k(r.age)),
      pension: Math.round(r.pension * k(r.age)),
      tax: Math.round(r.tax * k(r.age)),
      // FE-44: what the year needed before tax, and the part nothing covered.
      need: Math.round((r.netCash + r.shortfall + r.tax) * k(r.age)),
      shortfall: Math.round(r.shortfall * k(r.age)),
      total: Math.round(
        (r.withdrawals.tfsa + r.withdrawals.rrsp + r.withdrawals.nonReg +
          r.cpp + r.oas + r.gis + r.ccb + r.rent + r.extraIncome + r.pension) *
          k(r.age),
      ),
    }))

  const hasGis = data.some((d) => d.gis > 0)
  const hasCcb = data.some((d) => d.ccb > 0)
  const hasRent = data.some((d) => d.rent > 0)
  const hasExtra = data.some((d) => d.extraIncome > 0)
  const hasPension = data.some((d) => d.pension > 0)
  const hasShortfall = data.some((d) => d.shortfall > 0)

  const series: ChartSeries[] = [
    { key: 'rrsp', label: t('rrsp'), color: COLORS.rrsp },
    { key: 'nonReg', label: t('nonReg'), color: COLORS.nonReg },
    { key: 'tfsa', label: t('tfsa'), color: COLORS.tfsa },
    { key: 'cpp', label: t('cppLabel'), color: COLORS.cpp },
    { key: 'oas', label: t('oasLabel'), color: COLORS.oas },
    { key: 'need', label: t('incomeNeed'), color: COLORS.need },
    { key: 'tax', label: t('taxLabel'), color: COLORS.tax },
    ...(hasPension ? [{ key: 'pension', label: t('pensionLabel'), color: COLORS.pension }] : []),
    ...(hasGis ? [{ key: 'gis', label: t('gisLabel'), color: COLORS.gis }] : []),
    ...(hasCcb ? [{ key: 'ccb', label: t('ccbLabel'), color: COLORS.ccb }] : []),
    ...(hasRent ? [{ key: 'rent', label: t('rentLabel'), color: COLORS.rent }] : []),
    ...(hasExtra ? [{ key: 'extraIncome', label: t('extraIncomeLabel'), color: COLORS.extraIncome }] : []),
    ...(hasShortfall ? [{ key: 'shortfall', label: t('incomeShortfall'), color: COLORS.shortfall }] : []),
  ]

  if (data.length === 0) return null

  const gap = data.reduce((worst, d) => (d.shortfall > worst.shortfall ? d : worst), data[0])
  const summary = t('incomeChartSummary', {
    startAge: data[0].age, endAge: data[data.length - 1].age,
    covered: data.filter((d) => d.shortfall <= 0).length, years: data.length,
  }) + (hasShortfall ? ' ' + t('incomeChartSummaryGap', { gap: cad(gap.shortfall), age: gap.age }) : '')

  return (
    <div className="chart-card">
      <div className="chart-heading"><h3 id={`${id}-title`}>{t('incomeChartTitle')}</h3>
      <ChartLegend title={t('incomeChartTitle')} series={series} hidden={hidden} toggle={toggle} />
      </div>
      {/* FE-45: the chart is one image to assistive tech, described in words. */}
      {hasShortfall && <p className="chart-shortfall" data-testid="income-unfunded">{t('ui.results.unfunded', { age: data.find(row => row.shortfall > 0)!.age })}</p>}
      <p className="sr-only" id={`${id}-summary`}>{summary}</p>
      <div className="chart-plot" role="img" aria-labelledby={`${id}-title`} aria-describedby={`${id}-summary`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
          <defs><pattern id={`${id}-shortfall`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill={COLORS.shortfallTint} /><line x1="0" y1="0" x2="0" y2="8" stroke={COLORS.shortfall} strokeWidth="2" />
          </pattern></defs>
          {hasShortfall && <ReferenceLine x={data.find(row => row.shortfall > 0)!.age} stroke={COLORS.shortfall} strokeDasharray="2 3" />}
          <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" strokeOpacity={0.4} />
          <XAxis stroke={COLORS.axis} dataKey="age" type="number" allowDecimals={false}
            domain={[data[0].age, data[data.length - 1].age]}
            tickCount={6} minTickGap={24} />
          <YAxis stroke={COLORS.axis} tickFormatter={(v: number) => cadTick(v)} width={58} tick={{ fontSize: 12 }} />
          <Tooltip includeHidden itemStyle={{ color: COLORS.axis }} formatter={(v) => cad(Number(v))} />
          <Line dataKey="total" name={t('total')} stroke="none" dot={false}
            activeDot={false} legendType="none" />
          <Area hide={hidden.has('rrsp')} dataKey="rrsp" stackId="1" name={t('rrsp')} stroke={COLORS.rrsp} fill={COLORS.rrsp} fillOpacity={0.55} />
          <Area hide={hidden.has('nonReg')} dataKey="nonReg" stackId="1" name={t('nonReg')} stroke={COLORS.nonReg} fill={COLORS.nonReg} fillOpacity={0.55} />
          <Area hide={hidden.has('tfsa')} dataKey="tfsa" stackId="1" name={t('tfsa')} stroke={COLORS.tfsa} fill={COLORS.tfsa} fillOpacity={0.55} />
          {hasPension && (
            <Area hide={hidden.has('pension')} dataKey="pension" stackId="1" name={t('pensionLabel')} stroke={COLORS.pension} fill={COLORS.pension} fillOpacity={0.55} />
          )}
          <Area hide={hidden.has('cpp')} dataKey="cpp" stackId="1" name={t('cppLabel')} stroke={COLORS.cpp} fill={COLORS.cpp} fillOpacity={0.55} />
          <Area hide={hidden.has('oas')} dataKey="oas" stackId="1" name={t('oasLabel')} stroke={COLORS.oas} fill={COLORS.oas} fillOpacity={0.55} />
          {hasGis && (
            <Area hide={hidden.has('gis')} dataKey="gis" stackId="1" name={t('gisLabel')} stroke={COLORS.gis} fill={COLORS.gis} fillOpacity={0.55} />
          )}
          {hasCcb && (
            <Area hide={hidden.has('ccb')} dataKey="ccb" stackId="1" name={t('ccbLabel')} stroke={COLORS.ccb} fill={COLORS.ccb} fillOpacity={0.55} />
          )}
          {hasRent && (
            <Area hide={hidden.has('rent')} dataKey="rent" stackId="1" name={t('rentLabel')} stroke={COLORS.rent} fill={COLORS.rent} fillOpacity={0.55} />
          )}
          {hasExtra && (
            <Area hide={hidden.has('extraIncome')} dataKey="extraIncome" stackId="1" name={t('extraIncomeLabel')} stroke={COLORS.extraIncome} fill={COLORS.extraIncome} fillOpacity={0.55} />
          )}
          {hasShortfall && (
            <Area hide={hidden.has('shortfall')} dataKey="shortfall" stackId="1" name={t('incomeShortfall')} stroke={COLORS.shortfall} fill={`url(#${id}-shortfall)`} fillOpacity={1} />
          )}
          <Line hide={hidden.has('need')} dataKey="need" name={t('incomeNeed')} stroke={COLORS.need} strokeWidth={2} strokeDasharray="2 3" dot={false} />
          <Line hide={hidden.has('tax')} dataKey="tax" name={t('taxLabel')} stroke={COLORS.tax} strokeWidth={2} strokeDasharray="5 3" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
      <p className="chart-currency">{t('ui.results.currency')}</p>
      <p className="hint"><Jargon text={t('incomeChartNote')} /></p>
    </div>
  )
}
