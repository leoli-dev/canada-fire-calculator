import type { BudgetBasis, BudgetMode, BudgetReconciliation, InputsV2 } from './model'
import type { Inputs } from './types'

/**
 * BE-13 A. One place that decides what the plan's budget asserts, so every
 * consumer reports the *same* specific reason instead of a generic "not
 * reconciled" refusal. Three genuinely different situations used to share one
 * message, which hid who had to act:
 *
 * - a fact the user still has to answer (`unknown`),
 * - a fact the user answered, but as a shape the kernel cannot yet price
 *   (`known: false`),
 * - a mode this app cannot price at all yet (`incomeBudget`).
 */

/** The `savingsBudget` inclusion facts, read out of a plan's budget. */
export type BudgetFacts =
  | { status: 'ready'; annualNetSavings: number }
  | { status: 'needs-facts'; unconfirmed: string[]; detail: string }
  | { status: 'unsupported'; detail: string }
  | { status: 'income-budget'; detail: string }
  | { status: 'invalid'; detail: string }

/**
 * What a `savingsBudget` means, exactly:
 * money available to voluntary investing — FHSA / personal DC / non-registered
 * — *after* living costs, income tax and separately listed debt payments, and
 * *excluding* any tax benefit such as an RRSP deduction difference.
 *
 * The two flags assert the matching facts about the recorded figure. They are
 * `true` only when the user says so:
 * - `debtIncluded`: the figure is already net of the debt payments listed on
 *   this plan, so the ledger must not subtract them a second time.
 * - `taxBenefitIncluded`: the figure already accounts for the RRSP tax
 *   difference, so it must not be added again as refund cash.
 */
export function budgetFacts(budget: BudgetMode): BudgetFacts {
  if (budget.kind === 'incomeBudget') return {
    status: 'income-budget',
    detail: 'income budget (per-person wages, payroll deductions and staged retirement) is out of scope for BE-13 A',
  }
  const unconfirmed: string[] = []
  if (budget.debtIncluded.status !== 'known') unconfirmed.push('budget.debtIncluded')
  if (budget.taxBenefitIncluded.status !== 'known') unconfirmed.push('budget.taxBenefitIncluded')
  if (unconfirmed.length) return {
    status: 'needs-facts',
    unconfirmed,
    detail: `the user must answer ${unconfirmed.join(' and ')} before a savings budget can be priced`,
  }
  const debtIncluded = budget.debtIncluded.status === 'known' && budget.debtIncluded.value
  const taxBenefitIncluded = budget.taxBenefitIncluded.status === 'known' && budget.taxBenefitIncluded.value
  if (!debtIncluded) return {
    status: 'unsupported',
    detail: 'the savings budget excludes separately listed debt payments, and the kernel cannot yet add them back to a cash budget (BE-13 A)',
  }
  if (!taxBenefitIncluded) return {
    status: 'unsupported',
    detail: 'the savings budget excludes the registered-contribution tax benefit, and the kernel cannot yet add it as refund cash (BE-13 A)',
  }
  if (!Number.isFinite(budget.annualNetSavings)) return { status: 'invalid', detail: 'nominal savings budget is not a finite amount' }
  return { status: 'ready', annualNetSavings: budget.annualNetSavings }
}

/**
 * The year's cash budget from the canonical figure, inflated to the year being
 * priced. `null` means the budget is not priceable — callers report
 * `budgetFacts(...).detail` rather than inventing a number.
 */
export function cashBudget(budget: BudgetMode, year: number, baseYear: number, inflation: number): number | null {
  const facts = budgetFacts(budget)
  return facts.status === 'ready' ? facts.annualNetSavings * Math.pow(1 + inflation, year - baseYear) : null
}

/** Sum of the debt rows the plan already amortizes, in nominal base-year dollars. */
export function listedAnnualDebtPayments(plan: Pick<InputsV2, 'debts'>): number {
  return plan.debts.reduce((total, debt) => total + debt.annualPayment, 0)
}

/**
 * The canonical budget a user decision produces, given the balances the legacy
 * form holds. Both flags are only ever set from the user's own answer or from
 * the recorded decision — never derived from an absence of information.
 */
export function canonicalBudgetForChoice(
  legacy: Pick<Inputs, 'annualSavings' | 'retirementSpending' | 'budgetWorkingSpending'>,
  choice: { mode: 'savingsBudget'; debtIncluded: boolean; taxBenefitIncluded: boolean } | { mode: 'incomeBudget' },
): BudgetMode {
  const retirementSpending = legacy.retirementSpending
  if (choice.mode === 'incomeBudget') return {
    kind: 'incomeBudget',
    // Not recorded is a real state: `workingSpending` stays 0 and the panel
    // shows it as still to enter instead of borrowing the retirement figure.
    workingSpending: legacy.budgetWorkingSpending ?? 0,
    retirementSpending,
  }
  return {
    kind: 'savingsBudget',
    annualNetSavings: legacy.annualSavings,
    retirementSpending,
    debtIncluded: { status: 'known', value: choice.debtIncluded },
    taxBenefitIncluded: { status: 'known', value: choice.taxBenefitIncluded },
  }
}

/**
 * The canonical budget a recorded migration answer produces, given the balances
 * the legacy form currently holds.
 *
 * `keepLegacy` states on the plan that the v10 figure is *net of* the listed
 * debt payments and excludes the tax benefit — the old meaning, so the kernel
 * reports exactly that shape as unsupported rather than reinterpreting the
 * number. `adoptNewDefinition` asserts both facts, so the same amount now means
 * the new basis. `legacyAnnualDebtPayments` is the baseline the user compared
 * against; it is never added to the figure.
 */
export function reconciledBudget(
  legacy: Pick<Inputs, 'annualSavings' | 'retirementSpending'>,
  choice: { keepLegacy: boolean },
): BudgetMode {
  return canonicalBudgetForChoice(legacy, {
    mode: 'savingsBudget',
    debtIncluded: !choice.keepLegacy,
    taxBenefitIncluded: !choice.keepLegacy,
  })
}

/** The answers archived on a plan, or the unanswered shape when there are none. */
export function recordedBasis(reconciliation: BudgetReconciliation | undefined): BudgetBasis {
  return reconciliation?.savingsBasis ?? {
    debtIncluded: { status: 'unknown', reason: 'not answered yet' },
    taxBenefitIncluded: { status: 'unknown', reason: 'not answered yet' },
  }
}
