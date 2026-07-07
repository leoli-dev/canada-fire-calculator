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
import type { ProjectionResult } from '../engine'
import { useCad, useCadCompact } from '../format'
import { Jargon } from './Jargon'

const COLORS = {
  tfsa: '#2e7d32',
  rrsp: '#1565c0',
  nonReg: '#ef6c00',
  cpp: '#6a1b9a',
  oas: '#ad1457',
  gis: '#00838f',
  rent: '#5d4037',
  extraIncome: '#7cb342',
  pension: '#f9a825',
}

export function IncomeChart(props: {
  result: ProjectionResult
  fireAge: number
  scale?: (age: number) => number
}) {
  const { t } = useTranslation()
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
      rent: Math.round(r.rent * k(r.age)),
      extraIncome: Math.round(r.extraIncome * k(r.age)),
      pension: Math.round(r.pension * k(r.age)),
      tax: Math.round(r.tax * k(r.age)),
      total: Math.round(
        (r.withdrawals.tfsa + r.withdrawals.rrsp + r.withdrawals.nonReg +
          r.cpp + r.oas + r.gis + r.rent + r.extraIncome + r.pension) *
          k(r.age),
      ),
    }))

  const hasGis = data.some((d) => d.gis > 0)
  const hasRent = data.some((d) => d.rent > 0)
  const hasExtra = data.some((d) => d.extraIncome > 0)
  const hasPension = data.some((d) => d.pension > 0)

  if (data.length === 0) return null

  return (
    <div className="chart-card">
      <h3>{t('incomeChartTitle')}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 24 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
          <XAxis dataKey="age" type="number" allowDecimals={false}
            domain={[data[0].age, data[data.length - 1].age]}
            tickCount={12} />
          <YAxis tickFormatter={(v: number) => cadTick(v)} width={64} />
          <Tooltip formatter={(v) => cad(Number(v))} />
          <Legend />
          <Line dataKey="total" name={t('total')} stroke="none" dot={false}
            activeDot={false} legendType="none" />
          <Area dataKey="rrsp" stackId="1" name={t('rrsp')} stroke={COLORS.rrsp} fill={COLORS.rrsp} fillOpacity={0.55} />
          <Area dataKey="nonReg" stackId="1" name={t('nonReg')} stroke={COLORS.nonReg} fill={COLORS.nonReg} fillOpacity={0.55} />
          <Area dataKey="tfsa" stackId="1" name={t('tfsa')} stroke={COLORS.tfsa} fill={COLORS.tfsa} fillOpacity={0.55} />
          {hasPension && (
            <Area dataKey="pension" stackId="1" name={t('pensionLabel')} stroke={COLORS.pension} fill={COLORS.pension} fillOpacity={0.55} />
          )}
          <Area dataKey="cpp" stackId="1" name={t('cppLabel')} stroke={COLORS.cpp} fill={COLORS.cpp} fillOpacity={0.55} />
          <Area dataKey="oas" stackId="1" name={t('oasLabel')} stroke={COLORS.oas} fill={COLORS.oas} fillOpacity={0.55} />
          {hasGis && (
            <Area dataKey="gis" stackId="1" name={t('gisLabel')} stroke={COLORS.gis} fill={COLORS.gis} fillOpacity={0.55} />
          )}
          {hasRent && (
            <Area dataKey="rent" stackId="1" name={t('rentLabel')} stroke={COLORS.rent} fill={COLORS.rent} fillOpacity={0.55} />
          )}
          {hasExtra && (
            <Area dataKey="extraIncome" stackId="1" name={t('extraIncomeLabel')} stroke={COLORS.extraIncome} fill={COLORS.extraIncome} fillOpacity={0.55} />
          )}
          <Line dataKey="tax" name={t('taxLabel')} stroke="#37474f" strokeWidth={2} strokeDasharray="5 3" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="hint"><Jargon text={t('incomeChartNote')} /></p>
    </div>
  )
}
