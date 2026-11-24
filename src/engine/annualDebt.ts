import type { AnnualState, YearRow } from './annualState'
import type { Debt } from './model'
import { impliedRate } from './debts'

/** Stable annuity present value, including its explicit zero-rate limit.
 * Only generated mortgages use this solver; provider arithmetic stays pinned. */
function fixedMortgageRate(original: Debt): number | null {
  const { principal, annualPayment: payment, yearsRemaining: years } = original
  if (principal <= 0 || payment <= 0 || years <= 0 || payment * years <= principal) return 0
  const pv = (rate: number) => rate === 0 ? payment * years : payment * (-Math.expm1(-years * Math.log1p(rate)) / rate)
  let lo = 0, hi = 1
  for (let i = 0; pv(hi) > principal && i < 1024; i++) hi *= 2
  if (!Number.isFinite(hi) || pv(hi) > principal) return null
  for (let i = 0; i < 120; i++) {
    const mid = lo + (hi - lo) / 2
    if (mid === lo || mid === hi) break
    if (pv(mid) > principal) lo = mid
    else hi = mid
  }
  const rate = lo + (hi - lo) / 2
  const tolerance = 16 * Number.EPSILON * principal
  if (!Number.isFinite(rate) || Math.abs(pv(rate) - principal) > tolerance) return null
  return rate
}

/** Fixed nominal annual modeled schedule, shared by both phases. Mutates a private clone only. */
export function settleAnnualDebt(state: AnnualState, generatedMortgages?: readonly Debt[]):
  | { status: 'ok'; value: { debtRows: YearRow['byDebt']; debtPayments: number } }
  | { status: 'invalid'; reason: string } {
  const debtRows: YearRow['byDebt'] = Object.fromEntries(Object.entries(state.byDebt).map(([id, debt]) => [id,
    { opening: debt.principal, interest: 0, principal: 0, payment: 0, closing: debt.principal, propertyId: debt.propertyId }]))
  let debtPayments = 0
  for (const [id, debt] of Object.entries(state.byDebt)) {
    if (debt.principal <= 0 || debt.yearsRemaining <= 0) continue
    if (debt.annualPayment * debt.yearsRemaining + 1e-8 < debt.principal) return { status: 'invalid', reason: `debt cannot amortize: ${id}` }
    const original = generatedMortgages?.find(d => d.id === id)
    const rate = original ? fixedMortgageRate(original) : impliedRate(debt.principal, debt.annualPayment, debt.yearsRemaining)
    if (rate === null) return { status: 'invalid', reason: `debt rate cannot be verified: ${id}` }
    if (original) {
      // Discount the remaining original payments rather than accumulating
      // recurrence error for the full loan duration. PV(0 payments) is exactly
      // zero. Opening remains the prior committed closing, never restated.
      const yearsAfterPayment = debt.yearsRemaining - 1
      const closing = yearsAfterPayment === 0 ? 0 : rate === 0
        ? debt.annualPayment * yearsAfterPayment
        : debt.annualPayment * (-Math.expm1(-yearsAfterPayment * Math.log1p(rate)) / rate)
      const principal = debt.principal - closing
      const payment = debt.annualPayment
      const interest = payment - principal
      // This checks one PV bridge, not a duration-sized forgiveness allowance.
      // Keep the old absolute cap; reject any substantive contract discrepancy.
      const accrued = debt.principal * (1 + rate)
      const bridgeBound = Math.min(0.005, 64 * Number.EPSILON * Math.max(1, accrued, payment))
      if (!Number.isFinite(closing) || closing < 0 || Math.abs(accrued - payment - closing) > bridgeBound)
        return { status: 'invalid', reason: `debt unpaid at maturity: ${id}` }
      debtRows[id].payment = payment
      debtRows[id].principal = principal
      debtRows[id].interest = interest
      debtRows[id].closing = closing
      debtPayments += payment
      debt.principal = closing
      debt.yearsRemaining = yearsAfterPayment
      continue
    }
    const accrued = debt.principal * (1 + rate)
    const due = Math.min(debt.annualPayment, accrued)
    debtRows[id].interest = accrued - debt.principal
    debtRows[id].payment = due
    debtPayments += due
    const remaining = Math.max(0, accrued - due)
    // Settle only representational noise on the final payment. The cash ledger
    // retains the actual due; a cent-scale shortfall must never disappear.
    const numericalResidue = Math.min(0.005, 64 * Number.EPSILON * Math.max(1, accrued, due))
    if (debt.yearsRemaining === 1 && remaining > numericalResidue) return { status: 'invalid', reason: `debt unpaid at maturity: ${id}` }
    debt.principal = debt.yearsRemaining === 1 ? 0 : remaining
    debtRows[id].closing = debt.principal
    debtRows[id].principal = debtRows[id].opening - debt.principal
    debt.yearsRemaining -= 1
  }
  return { status: 'ok', value: { debtRows, debtPayments } }
}
