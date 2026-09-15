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
 * What a `savingsBudget` means, exactly: money available to voluntary investing
 * (FHSA / personal DC / non-registered) *after* living costs, income tax and
 * separately listed debt payments, and *excluding* any tax benefit such as an
 * RRSP deduction difference.
 *
 * Each flag asserts the matching fact about the recorded figure and is `true`
 * only when the user says so: `debtIncluded` means the figure is already net of
 * the debt payments listed on this plan (so the ledger must not subtract them
 * again), and `taxBenefitIncluded` means it already accounts for the RRSP tax
 * difference (so no refund is added once more).
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
 * The canonical budget a recorded migration answer produces, in the exact words
 * of the copy the user clicks.
 *
 * `keepLegacy` keeps the v10 meaning: the figure is *already net of* the listed
 * debt payments (that is how the legacy projection priced it — see
 * `projection.ts` and `debtsSection.debtNote`) and *without* the tax difference.
 * The alternative asserts both facts, so the same amount now means the new
 * basis. The number itself is never rewritten either way.
 *
 * A recorded fact may never contradict the sentence that produced it: this is
 * pinned by the copy/record test in `budgetSemantics.test.ts`.
 */
export function reconciledBudget(
  legacy: Pick<Inputs, 'annualSavings' | 'retirementSpending'>,
  choice: { keepLegacy: boolean },
): BudgetMode {
  return canonicalBudgetForChoice(legacy, {
    mode: 'savingsBudget',
    debtIncluded: true,
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
