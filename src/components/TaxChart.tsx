import { useTranslation } from 'react-i18next'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
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

/**
 * Breaks the tax line from IncomeChart down by taxable source. Canada taxes
 * all income together on one bracket ladder, so there is no statutory
 * per-source tax; each slice is that source's share of the total taxable
 * income, scaled against the year's actual tax — the slices always sum to
 * the same total shown as the dashed line above.
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
  const data = props.result.rows
    .filter((r) => r.phase !== 'accumulation')
    .map((r) => {
      const s = r.taxBySource
      const totalTaxable = r.taxablePerPerson * persons
      return {
        age: r.age,
        rrsp: Math.round(s.rrsp * k(r.age)),
        nonReg: Math.round(s.nonReg * k(r.age)),
        cpp: Math.round(s.cpp * k(r.age)),
        oas: Math.round(s.oas * k(r.age)),
        property: Math.round(s.property * k(r.age)),
        extraIncome: Math.round(s.extraIncome * k(r.age)),
        total: Math.round(r.tax * k(r.age)),
        taxablePerPerson: Math.round(r.taxablePerPerson * k(r.age)),
        avgRate: totalTaxable > 0 ? r.tax / totalTaxable : 0,
        marginalRate: marginalRate(r.taxablePerPerson, props.inputs.province),
      }
    })

  const hasProperty = data.some((d) => d.property > 0)
  const hasExtra = data.some((d) => d.extraIncome > 0)

  if (data.length === 0) return null

  const avgRateLabel = t('taxAvgRate')
  const marginalRateLabel = t('colMarginal')
  const formatter = (v: number, name: string) => {
    if (name === avgRateLabel || name === marginalRateLabel) return `${(v * 100).toFixed(1)}%`
    return cad(v)
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
          <Tooltip formatter={formatter} />
          <Legend />
          <Line dataKey="total" name={t('total')} stroke="none" dot={false}
            activeDot={false} legendType="none" />
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
          <Line dataKey="taxablePerPerson" name={t('colTaxable')} stroke="none" dot={false}
            activeDot={false} legendType="none" />
          <Line dataKey="avgRate" name={avgRateLabel} stroke="none" dot={false}
            activeDot={false} legendType="none" />
          <Line dataKey="marginalRate" name={marginalRateLabel} stroke="none" dot={false}
            activeDot={false} legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="hint"><Jargon text={t('taxChartNote')} /></p>
    </div>
  )
}
