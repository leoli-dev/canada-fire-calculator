import type { Debt } from './types'

/**
 * Implied annual interest rate of a loan: the r at which `payment` a year
 * for `years` years exactly amortizes `balance`. 0 when the payments only
 * just cover the principal (or don't — validation flags that case).
 */
export function impliedRate(balance: number, payment: number, years: number): number {
  if (balance <= 0 || payment <= 0 || years <= 0) return 0
  if (payment * years <= balance) return 0
  const pv = (r: number) =>
    r === 0 ? payment * years : (payment * (1 - Math.pow(1 + r, -years))) / r
  let lo = 0
  let hi = 1
  while (pv(hi) > balance && hi < 10) hi *= 2
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (pv(mid) > balance) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export interface DebtStream {
  /** total real (today's-dollar) payments due, indexed by years from now */
  payments: number[]
  /** total real end-of-year balance outstanding, indexed by years from now */
  balances: number[]
  /** real interest portion of that year's payment (deductible for a rental mortgage) */
  interest: number[]
}

/**
 * Aggregate all debts into real-dollar payment and balance streams.
 *
 * Loan payments are fixed in nominal dollars, so in the engine's real-dollar
 * frame both the payment and the outstanding balance shrink by inflation
 * every year — the honest mechanism by which a mortgage gets lighter over a
 * FIRE plan. Each nominal balance accrues its implied rate and is forced to
 * zero once its remaining years elapse.
 */
export function buildDebtStream(
  debts: Debt[],
  years: number,
  inflation: number,
): DebtStream {
  // total function: transient UI states can produce negative or fractional
  // year spans (e.g. FIRE age typed above life expectancy) — never throw
  const n = Number.isFinite(years) ? Math.max(0, Math.floor(years)) : 0
  const payments = new Array<number>(n).fill(0)
  const balances = new Array<number>(n).fill(0)
  const interest = new Array<number>(n).fill(0)
  for (const d of debts) {
    if (d.balance <= 0 || d.yearsRemaining <= 0) continue
    const r = impliedRate(d.balance, d.annualPayment, d.yearsRemaining)
    let nominal = d.balance
    for (let t = 0; t < n && t < d.yearsRemaining; t++) {
      const deflate = Math.pow(1 + inflation, -(t + 1))
      const interestNominal = nominal * r
      payments[t] += Math.min(d.annualPayment, nominal + interestNominal) * deflate
      interest[t] += interestNominal * deflate
      nominal = Math.max(0, nominal + interestNominal - d.annualPayment)
      if (t === d.yearsRemaining - 1) nominal = 0
      balances[t] += nominal * deflate
    }
  }
  return { payments, balances, interest }
}

/**
 * Advance debts by `years` of amortization, keeping values in the original
 * today's-dollar frame. Solvers that shift `currentAge` forward feed the
 * result into a projection whose deflation restarts at the new start age;
 * scaling the nominal figures by (1+infl)^-years compensates exactly.
 */
export function rollDebtsForward(debts: Debt[], years: number, inflation: number): Debt[] {
  if (years <= 0) return debts
  const out: Debt[] = []
  for (const d of debts) {
    if (d.balance <= 0 || d.yearsRemaining <= years) continue
    const r = impliedRate(d.balance, d.annualPayment, d.yearsRemaining)
    let nominal = d.balance
    for (let t = 0; t < years; t++) nominal = Math.max(0, nominal * (1 + r) - d.annualPayment)
    if (nominal <= 0) continue
    const deflate = Math.pow(1 + inflation, -years)
    out.push({
      ...d,
      balance: nominal * deflate,
      annualPayment: d.annualPayment * deflate,
      yearsRemaining: d.yearsRemaining - years,
    })
  }
  return out
}
