import { useTranslation } from 'react-i18next'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
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

const COLORS = { tfsa: '#2e7d32', rrsp: '#1565c0', nonReg: '#ef6c00', property: '#8d6e63' }

export function ProjectionChart(props: {
  result: ProjectionResult
  fireAge: number
  pensionAge: number
  saleAges?: number[]
  /** >1 factors per year convert real dollars to nominal for display */
  scale?: (age: number) => number
}) {
  const { t } = useTranslation()
  const cad = useCad()
  const cadTick = useCadCompact()
  const k = props.scale ?? (() => 1)
  const data = props.result.rows.map((r) => ({
    age: r.age,
    tfsa: Math.round(r.balances.tfsa * k(r.age)),
    rrsp: Math.round(r.balances.rrsp * k(r.age)),
    nonReg: Math.round(r.balances.nonReg * k(r.age)),
    property: Math.round(r.propertyValue * k(r.age)),
    investable: Math.round((r.balances.tfsa + r.balances.rrsp + r.balances.nonReg) * k(r.age)),
    total: Math.round(
      (r.balances.tfsa + r.balances.rrsp + r.balances.nonReg + r.propertyValue) * k(r.age),
    ),
  }))
  const hasProperty = data.some((d) => d.property > 0)

  return (
    <div className="chart-card">
      <h3>{t('chartTitle')}</h3>
      <ResponsiveContainer width="100%" height={380}>
        <ComposedChart data={data} margin={{ top: 24, right: 16, bottom: 0, left: 24 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
          <XAxis dataKey="age" type="number" domain={[data[0].age, data[data.length - 1].age]}
            allowDecimals={false} tickCount={12} />
          <YAxis tickFormatter={(v: number) => cadTick(v)} width={64} />
          <Tooltip formatter={(v) => cad(Number(v))} />
          <Legend />
          {hasProperty && (
            <Line dataKey="investable" name={t('investableTotal')} stroke="none" dot={false}
              activeDot={false} legendType="none" />
          )}
          <Line dataKey="total" name={hasProperty ? t('totalWithProperty') : t('total')}
            stroke="none" dot={false} activeDot={false} legendType="none" />
          <ReferenceArea
            x1={props.fireAge}
            x2={props.pensionAge}
            fill="#c62828"
            fillOpacity={0.05}
            label={{ value: t('phaseBridge'), fill: '#9b7676', position: 'insideTop', fontSize: 12 }}
          />
          <ReferenceLine x={props.fireAge} stroke="#c62828" strokeDasharray="4 4"
            label={{ value: 'FIRE', fill: '#c62828', position: 'top' }} />
          <ReferenceLine x={props.pensionAge} stroke="#6a1b9a" strokeDasharray="4 4"
            label={{ value: 'CPP/OAS', fill: '#6a1b9a', position: 'top' }} />
          {(props.saleAges ?? []).map((age) => (
            <ReferenceLine key={age} x={age} stroke={COLORS.property} strokeDasharray="4 4"
              label={{ value: t('saleLabel'), fill: COLORS.property, position: 'insideTopLeft', fontSize: 12 }} />
          ))}
          <Area type="monotone" dataKey="tfsa" stackId="1" name={t('tfsa')}
            stroke={COLORS.tfsa} fill={COLORS.tfsa} fillOpacity={0.55} />
          <Area type="monotone" dataKey="rrsp" stackId="1" name={t('rrsp')}
            stroke={COLORS.rrsp} fill={COLORS.rrsp} fillOpacity={0.55} />
          <Area type="monotone" dataKey="nonReg" stackId="1" name={t('nonReg')}
            stroke={COLORS.nonReg} fill={COLORS.nonReg} fillOpacity={0.55} />
          {hasProperty && (
            <Area type="monotone" dataKey="property" stackId="1" name={t('propertyLabel')}
              stroke={COLORS.property} fill={COLORS.property} fillOpacity={0.45} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
