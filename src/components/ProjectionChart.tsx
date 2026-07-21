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

const COLORS = { tfsa: '#2e7d32', rrsp: '#1565c0', nonReg: '#ef6c00', fhsa: '#00897b', locked: '#6a1b9a', property: '#8d6e63' }

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
  if (data.length === 0) return null

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
          {hasFhsa && (
            <Area type="monotone" dataKey="fhsa" stackId="1" name={t('fhsaLabel')}
              stroke={COLORS.fhsa} fill={COLORS.fhsa} fillOpacity={0.55} />
          )}
          {hasLocked && (
            <Area type="monotone" dataKey="locked" stackId="1" name={t('lockedRetirementLabel')}
              stroke={COLORS.locked} fill={COLORS.locked} fillOpacity={0.55} />
          )}
          {hasProperty && (
            <Area type="monotone" dataKey="property" stackId="1" name={t('propertyLabel')}
              stroke={COLORS.property} fill={COLORS.property} fillOpacity={0.45} />
          )}
          {hasDebt && (
            <Line type="monotone" dataKey="debt" name={t('debtLabel')}
              stroke="#c62828" strokeWidth={2} strokeDasharray="5 3" dot={false} />
          )}
          {hasDebt && (
            <Line type="monotone" dataKey="netWorth" name={t('netWorthLabel')}
              stroke="#1a2532" strokeWidth={2} dot={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
