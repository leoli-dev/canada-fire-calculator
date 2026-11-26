import { ChartLegend, useChartSeries, type ChartSeries } from './ChartLegend'
import { useChartColors } from '../chartColors'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ProjectionResult } from '../engine'
import { useCad, useCadCompact } from '../format'


export function ProjectionChart(props: {
  result: ProjectionResult
  fireAge: number
  pensionAge: number
  saleAges?: number[]
  /** >1 factors per year convert real dollars to nominal for display */
  scale?: (age: number) => number
}) {
  const { t } = useTranslation()
  const COLORS = useChartColors()
  const id = useId().replace(/:/g, '')
  const { hidden, toggle } = useChartSeries()
  const cad = useCad()
  const cadTick = useCadCompact()
  const k = props.scale ?? (() => 1)
  const data = props.result.rows.map((r) => ({
    age: r.age,
    tfsa: Math.round(r.balances.tfsa * k(r.age)),
    rrsp: Math.round(r.balances.rrsp * k(r.age)),
    nonReg: Math.round(r.balances.nonReg * k(r.age)),
    fhsa: Math.round(r.fhsaBalance * k(r.age)),
    locked: Math.round(r.lockedRetirementBalance * k(r.age)),
    property: Math.round(r.propertyValue * k(r.age)),
    debt: Math.round(r.debtBalance * k(r.age)),
    investable: Math.round(
      (r.balances.tfsa + r.balances.rrsp + r.balances.nonReg + r.fhsaBalance + r.lockedRetirementBalance) * k(r.age),
    ),
    total: Math.round(
      (r.balances.tfsa + r.balances.rrsp + r.balances.nonReg + r.fhsaBalance + r.lockedRetirementBalance + r.propertyValue) *
        k(r.age),
    ),
    netWorth: Math.round(
      (r.balances.tfsa + r.balances.rrsp + r.balances.nonReg + r.fhsaBalance + r.lockedRetirementBalance + r.propertyValue -
        r.debtBalance) *
        k(r.age),
    ),
  }))
  const hasProperty = data.some((d) => d.property > 0)
  const hasDebt = data.some((d) => d.debt > 0)
  const hasFhsa = data.some((d) => d.fhsa > 0)
  const hasLocked = data.some((d) => d.locked > 0)

  // transient invalid inputs (life expectancy typed below the current age)
  // can produce zero rows — never crash the page over it
  const series: ChartSeries[] = [
    { key: 'tfsa', label: t('tfsa'), color: COLORS.tfsa },
    { key: 'rrsp', label: t('rrsp'), color: COLORS.rrsp },
    { key: 'nonReg', label: t('nonReg'), color: COLORS.nonReg },
    ...(hasFhsa ? [{ key: 'fhsa', label: t('fhsaLabel'), color: COLORS.fhsa }] : []),
    ...(hasLocked ? [{ key: 'locked', label: t('lockedRetirementLabel'), color: COLORS.locked }] : []),
    ...(hasProperty ? [{ key: 'property', label: t('propertyLabel'), color: COLORS.property }] : []),
    ...(hasDebt ? [{ key: 'debt', label: t('debtLabel'), color: COLORS.shortfall }] : []),
    ...(hasDebt ? [{ key: 'netWorth', label: t('netWorthLabel'), color: COLORS.tax }] : []),
  ]

  if (data.length === 0) return null

  const first = data[0]
  const last = data[data.length - 1]
  const atFire = data.find((d) => d.age === props.fireAge) ?? first
  const summary = t('chartSummary', {
    start: cad(first.netWorth), startAge: first.age, atFire: cad(atFire.netWorth), fireAge: atFire.age,
    end: cad(last.netWorth), endAge: last.age,
  })

  return (
    <div className="chart-card">
      <div className="chart-heading"><h3 id={`${id}-title`}>{t('chartTitle')}</h3>
      <ChartLegend title={t('chartTitle')} series={series} hidden={hidden} toggle={toggle} />
      </div>
      {/* FE-45: the chart is one image to assistive tech, described in words. */}
      <p className="sr-only" id={`${id}-summary`}>{summary}</p>
      <div className="chart-plot" role="img" aria-labelledby={`${id}-title`} aria-describedby={`${id}-summary`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 24, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" strokeOpacity={0.4} />
          <XAxis stroke={COLORS.axis} dataKey="age" type="number" domain={[data[0].age, data[data.length - 1].age]}
            allowDecimals={false} tickCount={6} minTickGap={24} />
          <YAxis stroke={COLORS.axis} tickFormatter={(v: number) => cadTick(v)} width={58} tick={{ fontSize: 12 }} />
          <Tooltip includeHidden itemStyle={{ color: COLORS.axis }} formatter={(v) => cad(Number(v))} />
          {hasProperty && (
            <Line dataKey="investable" name={t('investableTotal')} stroke="none" dot={false}
              activeDot={false} legendType="none" />
          )}
          <Line dataKey="total" name={hasProperty ? t('totalWithProperty') : t('total')}
            stroke="none" dot={false} activeDot={false} legendType="none" />
          <ReferenceArea
            x1={props.fireAge}
            x2={props.pensionAge}
            fill={COLORS.bridge}
            fillOpacity={1}
            label={{ value: t('phaseBridge'), fill: COLORS.axis, position: 'insideTop', fontSize: 12 }}
          />
          <ReferenceLine x={props.fireAge} stroke={COLORS.fire} strokeDasharray="4 4"
            label={{ value: 'FIRE', fill: COLORS.fire, position: 'top' }} />
          <ReferenceLine x={props.pensionAge} stroke={COLORS.pensionMarker} strokeDasharray="4 4"
            label={{ value: 'CPP/OAS', fill: COLORS.pensionMarker, position: 'top' }} />
          {(props.saleAges ?? []).map((age) => (
            <ReferenceLine key={age} x={age} stroke={COLORS.property} strokeDasharray="4 4"
              label={{ value: t('saleLabel'), fill: COLORS.property, position: 'insideTopLeft', fontSize: 12 }} />
          ))}
          <Area type="monotone" hide={hidden.has('tfsa')} dataKey="tfsa" stackId="1" name={t('tfsa')}
            stroke={COLORS.tfsa} fill={COLORS.tfsa} fillOpacity={0.55} />
          <Area type="monotone" hide={hidden.has('rrsp')} dataKey="rrsp" stackId="1" name={t('rrsp')}
            stroke={COLORS.rrsp} fill={COLORS.rrsp} fillOpacity={0.55} />
          <Area type="monotone" hide={hidden.has('nonReg')} dataKey="nonReg" stackId="1" name={t('nonReg')}
            stroke={COLORS.nonReg} fill={COLORS.nonReg} fillOpacity={0.55} />
          {hasFhsa && (
            <Area type="monotone" hide={hidden.has('fhsa')} dataKey="fhsa" stackId="1" name={t('fhsaLabel')}
              stroke={COLORS.fhsa} fill={COLORS.fhsa} fillOpacity={0.55} />
          )}
          {hasLocked && (
            <Area type="monotone" hide={hidden.has('locked')} dataKey="locked" stackId="1" name={t('lockedRetirementLabel')}
              stroke={COLORS.locked} fill={COLORS.locked} fillOpacity={0.55} />
          )}
          {hasProperty && (
            <Area type="monotone" hide={hidden.has('property')} dataKey="property" stackId="1" name={t('propertyLabel')}
              stroke={COLORS.property} fill={COLORS.property} fillOpacity={0.45} />
          )}
          {hasDebt && (
            <Line type="monotone" hide={hidden.has('debt')} dataKey="debt" name={t('debtLabel')}
              stroke={COLORS.shortfall} strokeWidth={2} strokeDasharray="5 3" dot={false} />
          )}
          {hasDebt && (
            <Line type="monotone" hide={hidden.has('netWorth')} dataKey="netWorth" name={t('netWorthLabel')}
              stroke={COLORS.tax} strokeWidth={2} dot={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      </div>
      <p className="chart-currency">{t('ui.results.currency')}</p>
    </div>
  )
}
