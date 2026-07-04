export type Province = 'AB' | 'BC' | 'ON' | 'QC'

export type AccountType = 'tfsa' | 'rrsp' | 'nonReg'
export const ACCOUNT_TYPES: AccountType[] = ['tfsa', 'rrsp', 'nonReg']

export type Phase = 'accumulation' | 'bridge' | 'pension'

/**
 * Withdrawal strategy.
 * - meltdownPaced: bracket-capped meltdown — each year the RRSP is drawn
 *   only up to the room left in the lowest tax bracket (after CPP/OAS);
 *   the remainder rides past 71 and exits via RRIF minimums. The rest of
 *   spending comes from non-registered, then TFSA.
 * - rrspFirst: aggressive — all spending from RRSP until empty (high tax).
 */
export type Strategy = 'meltdownPaced' | 'rrspFirst' | 'nonRegFirst' | 'tfsaFirst'
export const STRATEGIES: Strategy[] = ['meltdownPaced', 'rrspFirst', 'nonRegFirst', 'tfsaFirst']

/**
 * What the plan optimizes for — a life choice, not a calculation detail.
 * - legacy: maximize the after-tax estate at life expectancy
 * - dieWithZero: maximize stable real annual spending, ending near zero
 */
export type Goal = 'legacy' | 'dieWithZero'

/** Work history from the CPP estimator; lets the engine refine early claims. */
export interface CppWork {
  startWorkAge: number
  retireAge: number
}

export interface Partner {
  currentAge: number
  cppStartAge: number
  cppAnnualAt65: number
  oasStartAge: number
  oasAnnualAt65: number
  cppWork?: CppWork | null
}

export interface PrincipalResidence {
  value: number
  /** real annual appreciation */
  appreciation: number
  /** sale is tax-free (principal residence exemption); null = never sell */
  sellAtAge: number | null
}

export interface InvestmentProperty {
  value: number
  /** adjusted cost base; gain above it is 50% taxable at sale */
  acb: number
  appreciation: number
  /** engine clamps the sale to no earlier than fireAge; null = never sell */
  sellAtAge: number | null
}

export interface Inputs {
  currentAge: number
  fireAge: number
  lifeExpectancy: number
  province: Province
  /** after-tax annual savings during accumulation, today's dollars */
  annualSavings: number
  /** fraction of annual savings contributed to each account (sums to 1) */
  savingsSplit: Record<AccountType, number>
  /** desired after-tax annual spending in retirement, today's dollars */
  retirementSpending: number
  /** real (inflation-adjusted) annual return per account, gross of fees */
  returns: Record<AccountType, number>
  /** annual investment fee (MER) subtracted from every account's return */
  fees?: number
  /**
   * Non-registered tax drag: the fraction of the balance paid out each year
   * as taxable distributions (interest/dividends/ETF payouts, reinvested).
   * Taxed yearly as ordinary income — a deliberate simplification given no
   * dividend-credit modelling.
   */
  nonRegDistributionYield?: number
  /** marginal rate applied to those distributions before FIRE (working years) */
  accumulationMarginalRate?: number
  /** current balances */
  balances: Record<AccountType, number>
  /** adjusted cost base (book value) of non-registered holdings */
  nonRegBook: number
  /** CPP/QPP start age, 60–70 (QPP defers to 72) */
  cppStartAge: number
  /** user's estimated CPP/QPP annual benefit if taken at 65, today's dollars */
  cppAnnualAt65: number
  /** work history from the estimator; refines the early-claim dilution */
  cppWork?: CppWork | null
  /** OAS start age, 65–70 */
  oasStartAge: number
  /** OAS annual benefit at 65, today's dollars */
  oasAnnualAt65: number
  /** how retirement spending is funded */
  strategy: Strategy
  /** optimization goal; defaults to legacy */
  goal?: Goal
  /** assumed average inflation, for nominal-dollar display (default 2.1%) */
  inflation?: number
  /** target investable assets at FIRE, for the goal-check question mode */
  fireTargetAssets?: number | null
  /** spouse/partner for household mode; accounts are household totals */
  partner?: Partner | null
  /** annual return standard deviation per account, used by Monte Carlo */
  volatilities?: Record<AccountType, number>
  principalResidence?: PrincipalResidence | null
  investmentProperty?: InvestmentProperty | null
}

export interface YearRow {
  age: number
  phase: Phase
  /** end-of-year balances (after withdrawals/contributions and growth) */
  balances: Record<AccountType, number>
  withdrawals: Record<AccountType, number>
  cpp: number
  /** OAS actually received, after clawback */
  oas: number
  /** GIS received — tax-free, requires OAS, income-tested (TFSA invisible) */
  gis: number
  tax: number
  /** after-tax cash available this year */
  netCash: number
  /** unmet spending (money ran out) */
  shortfall: number
  /** unsold real estate value at end of year */
  propertyValue: number
  /** taxable income per person this year (0 during accumulation) */
  taxablePerPerson: number
}

export interface ProjectionResult {
  rows: YearRow[]
  /** spending fully funded through life expectancy */
  success: boolean
  /** first age where spending could not be met, if any */
  depletedAge: number | null
  /** face value at life expectancy — overstates RRSP-heavy outcomes */
  finalNetWorth: number
  /**
   * Deemed-disposition tax at death: remaining RRSP/RRIF is fully income in
   * the final year (no spousal rollover left at joint life expectancy), plus
   * 50% of unrealized non-registered and investment-property gains.
   */
  estateTax: number
  /** after-tax estate value — the number strategies should be ranked by */
  estateValue: number
  /**
   * total tax paid on RRSP/RRIF money: yearly tax attributed proportionally
   * to RRSP withdrawals, plus the RRSP share of the deemed-disposition tax
   */
  rrspTax: number
}
