import { useTranslation } from 'react-i18next'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { marginalRate, type Inputs, type ProjectionResult } from '../engine'
import { useCad, useCadCompact } from '../format'
import { Jargon } from './Jargon'

const COLORS = {
  rrsp: '#1565c0',
  nonReg: '#ef6c00',
  cpp: '#6a1b9a',
  oas: '#ad1457',
  property: '#5d4037',
  extraIncome: '#7cb342',
}

const SOURCE_KEYS = ['rrsp', 'nonReg', 'cpp', 'oas', 'property', 'extraIncome'] as const
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
  taxableRrsp: number
  taxableNonReg: number
  taxableCpp: number
  taxableOas: number
  taxableProperty: number
  taxableExtraIncome: number
}

const TAXABLE_KEY: Record<SourceKey, keyof TaxChartRow> = {
  rrsp: 'taxableRrsp',
  nonReg: 'taxableNonReg',
  cpp: 'taxableCpp',
  oas: 'taxableOas',
  property: 'taxableProperty',
  extraIncome: 'taxableExtraIncome',
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
        taxableRrsp: Math.round(ti.rrsp * k(r.age)),
        taxableNonReg: Math.round(ti.nonReg * k(r.age)),
        taxableCpp: Math.round(ti.cpp * k(r.age)),
        taxableOas: Math.round(ti.oas * k(r.age)),
        taxableProperty: Math.round(ti.property * k(r.age)),
        taxableExtraIncome: Math.round(ti.extraIncome * k(r.age)),
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

  if (data.length === 0) return null

  const sourceLabels: Record<SourceKey, string> = {
    rrsp: t('rrsp'),
    nonReg: t('taxSrcNonReg'),
    cpp: t('cppLabel'),
    oas: t('oasLabel'),
    property: t('taxSrcProperty'),
    extraIncome: t('extraIncomeLabel'),
  }
  const visibleSources: SourceKey[] = [
    'rrsp', 'nonReg', 'cpp', 'oas',
    ...(hasProperty ? (['property'] as const) : []),
    ...(hasExtra ? (['extraIncome'] as const) : []),
  ]

  function ChartTooltip(tprops: { active?: boolean; payload?: { payload?: TaxChartRow }[]; label?: number }) {
    const d = tprops.payload?.[0]?.payload
    if (!tprops.active || !d) return null
    return (
      <div style={{
        margin: 0, padding: 10, background: '#fff',
        border: '1px solid #ccc', whiteSpace: 'nowrap', fontSize: 13,
      }}>
        <p style={{ margin: 0, paddingBottom: 4 }}>{tprops.label}</p>
        <p style={{ margin: 0, paddingBottom: 4 }}>{t('total')}：{cad(d.total)}</p>
        {visibleSources.map((key) => (
          <p key={key} style={{ margin: 0, paddingBottom: 4, color: COLORS[key] }}>
            {sourceLabels[key]}：{t('taxTaxablePrefix')} {cad(d[TAXABLE_KEY[key]])} → {t('taxLabel')} {cad(d[key])}
          </p>
        ))}
        <p style={{ margin: 0, paddingBottom: 4 }}>{t('taxTotalTaxable')}：{cad(d.totalTaxable)}</p>
        <p style={{ margin: 0, paddingBottom: 4 }}>{t('taxAvgRate')}：{(d.avgRate * 100).toFixed(1)}%</p>
        <p style={{ margin: 0 }}>{t('colMarginal')}：{(d.marginalRate * 100).toFixed(1)}%</p>
      </div>
    )
  }

  return (
    <div className="chart-card">
      <h3>{t('taxChartTitle')}</h3>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 24 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
          <XAxis dataKey="age" type="number" allowDecimals={false}
            domain={[data[0].age, data[data.length - 1].age]}
            tickCount={12} />
          <YAxis tickFormatter={(v: number) => cadTick(v)} width={64} />
          <Tooltip content={ChartTooltip} />
          <Legend />
          <Area dataKey="rrsp" stackId="1" name={t('rrsp')} stroke={COLORS.rrsp} fill={COLORS.rrsp} fillOpacity={0.55} />
          <Area dataKey="nonReg" stackId="1" name={t('taxSrcNonReg')} stroke={COLORS.nonReg} fill={COLORS.nonReg} fillOpacity={0.55} />
          <Area dataKey="cpp" stackId="1" name={t('cppLabel')} stroke={COLORS.cpp} fill={COLORS.cpp} fillOpacity={0.55} />
          <Area dataKey="oas" stackId="1" name={t('oasLabel')} stroke={COLORS.oas} fill={COLORS.oas} fillOpacity={0.55} />
          {hasProperty && (
            <Area dataKey="property" stackId="1" name={t('taxSrcProperty')} stroke={COLORS.property} fill={COLORS.property} fillOpacity={0.55} />
          )}
          {hasExtra && (
            <Area dataKey="extraIncome" stackId="1" name={t('extraIncomeLabel')} stroke={COLORS.extraIncome} fill={COLORS.extraIncome} fillOpacity={0.55} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <p className="hint"><Jargon text={t('taxChartNote')} /></p>
    </div>
  )
}
