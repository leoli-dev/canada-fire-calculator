export type Province =
  | 'AB' | 'BC' | 'MB' | 'NB' | 'NL' | 'NS' | 'NT' | 'NU'
  | 'ON' | 'PE' | 'QC' | 'SK' | 'YT'

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
 * How far the paced meltdown fills the RRSP each year before capping:
 * the first tax bracket (default, most conservative), the second bracket,
 * or the OAS clawback threshold (common advice for large RRSPs, where
 * staying in bracket 1 forever strands money into RRIF-forced withdrawals
 * and a 100%-taxable estate).
 */
export type MeltdownCap = 'bracket1' | 'bracket2' | 'oasClawback'
export const MELTDOWN_CAPS: MeltdownCap[] = ['bracket1', 'bracket2', 'oasClawback']

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

/**
 * BE-39 A. The source of one recorded CPP/QPP or OAS figure and the premises
 * the amount is expressed in, so a retirement-age change can never silently
 * leave an estimate stale or silently overwrite a recorded fact.
 */
export type PensionAmountSource = 'manual' | 'statement' | 'estimator' | 'unknown'

/**
 * `'unknown'` means no source was ever recorded — an older saved plan. It is
 * never rewritten as `'estimator'`, because nothing established that a formula
 * produced it. The amount fields are the unit contract: the engine stores
 * annual, age-65-basis, today's-dollars figures, so a monthly `1000` at age 65
 * is recorded `basis: 'monthly'`, `ageBasis: 65` and converted to 12,000
 * exactly once, with the recorded premise kept so it can be re-checked.
 */
export interface PensionAmountProvenance {
  source: PensionAmountSource
  /** The year the statement/estimate information is from; null = not given. */
  sourceYear: number | null
  /** Whether the recorded figure was stated monthly or annually. */
  basis: 'monthly' | 'annual'
  /**
   * The age the recorded amount is stated at. `null` means "the age-65
   * basis". When a statement states an amount at the person's actual claim
   * age (say 60), the claiming factor is already inside the number and must
   * not be applied a second time.
   */
  ageBasis: number | null
  /** `today` = today's purchasing power; `nominal` = dollars of `sourceYear`. */
  dollarBasis: 'today' | 'nominal'
  /** What an estimator-derived amount assumed, so it can be recomputed. */
  premises?: {
    /** The plan's retirement age at apply time — the stale-able premise. */
    retirementAge: number
    /** CPP/QPP: age full-time work began, and career-average YMPE ratio. */
    startWorkAge?: number
    avgEarningsRatio?: number
    /** OAS: years of Canadian residence by 65 (from age 18). */
    residenceYearsBy65?: number
  }
  /**
   * Set on a `statement` value whose retirement-age premise no longer matches
   * the plan. The amount is *not* changed; the flag asks the user to
   * re-confirm the premise against the statement.
   */
  premisesNeedReview?: boolean
}

/**
 * Expected income after FIRE beyond the portfolio (Barista FIRE: part-time
 * work, a small business, selling things). Taxable as ordinary income;
 * treated as employment income for the GIS exemption.
 */
export interface ExtraIncome {
  /** net annual amount, today's dollars */
  annual: number
  /** clamped to no earlier than fireAge */
  fromAge: number
  toAge: number
}

/**
 * Employer DB pension (v1): a lifetime annuity from startAge, plus an
 * optional bridge benefit that ends at 65. Amounts are today's dollars,
 * pre-tax. DC pensions aren't a separate thing here — their balance belongs
 * in the RRSP field (a LIRA/locked-in account behaves the same for
 * projection purposes; LIF withdrawal caps aren't modelled).
 *
 * Not modelled (disclosed simplifications): survivor benefits (the engine
 * has no one-spouse-dies-early scenario) and Quebec's provincial-only rule
 * that income splitting requires age 65+ even for RPP annuities.
 */
export interface Pension {
  /** annual lifetime pension at startAge (excluding any bridge) */
  annualAmount: number
  startAge: number
  /**
   * 0–1: how much of CPI the payments keep up with (1 = fully indexed,
   * 0 = fixed nominal). Erosion is applied from startAge on; a non-indexed
   * pension also losing value during the deferral years isn't modelled.
   */
  indexation: number
  /** temporary bridge paid from startAge until 65 (0 = none) */
  bridgeAnnual: number
}

export interface Partner {
  currentAge: number
  cppStartAge: number
  cppAnnualAt65: number
  oasStartAge: number
  oasAnnualAt65: number
  cppWork?: CppWork | null
  /** BE-39 A: where the partner's CPP/QPP and OAS figures came from. */
  cppAmountSource?: PensionAmountProvenance
  oasAmountSource?: PensionAmountProvenance
  pension?: Pension | null
}

export type DebtKind = 'mortgage' | 'carLoan' | 'other'
export const DEBT_KINDS: DebtKind[] = ['mortgage', 'carLoan', 'other']

/**
 * A loan with fixed nominal payments. The engine derives the implied
 * interest rate from (balance, annualPayment, yearsRemaining) and lets
 * inflation shrink the real weight of the payments over time.
 */
export interface Debt {
  /** Stable identity for canonical migration and list edits. */
  id?: string
  kind: DebtKind
  /** outstanding balance today */
  balance: number
  /** fixed nominal payment per year */
  annualPayment: number
  yearsRemaining: number
}

/** A mortgage tied to one specific property — same shape as Debt minus the
 * kind tag. Amortizes the same way (implied rate, inflation-eroded nominal
 * payments) but is discharged from sale proceeds when its property sells,
 * instead of continuing forever. */
export interface Mortgage {
  balance: number
  annualPayment: number
  yearsRemaining: number
}

export interface OwnedResidence {
  mode?: 'owned'
  value: number
  /** real annual appreciation */
  appreciation: number
  /** tax-free sale at the opening of this age; null = never sell */
  sellAtAge: number | null
  /** discharged from sale proceeds when the home sells; a plain cash-flow
   * cost until then (mortgage interest on a principal residence isn't
   * deductible, so there's no tax interaction, unlike a rental's mortgage) */
  mortgage?: Mortgage
}

/**
 * A future first-home purchase, mirroring the existing sale event: the home
 * doesn't exist until buyAtAge, at which point the down payment is funded
 * (FHSA, then TFSA, then non-registered, then RRSP — fixed, not
 * configurable) and a mortgage for the remainder amortizes from that year on.
 */
export interface PlannedResidence {
  mode: 'planned'
  /** clamped to no earlier than currentAge */
  buyAtAge: number
  /** purchase price, today's purchasing power */
  price: number
  downPayment: number
  /** real annual appreciation, same convention as OwnedResidence */
  appreciation: number
  /** fixed nominal payment (today's-dollar equivalent) on the auto-derived
   * mortgage (balance = price − downPayment). Required when that balance is
   * positive; zero/undefined is valid only for a full-price cash purchase. */
  annualMortgagePayment?: number
  mortgageYears?: number
  /** net $/year change in living costs once owned (can be negative if it's
   * cheaper than whatever housing cost — e.g. rent — it replaces); excludes
   * the mortgage payment itself, which is handled like any other mortgage */
  netHoldingCostChange: number
  /** tax-free sale at the opening of this age, after purchase; null = never sell */
  sellAtAge: number | null
}

export type PrincipalResidence = OwnedResidence | PlannedResidence

/**
 * FHSA (First Home Savings Account) — a household-combined bucket, not a
 * fourth AccountType: contributions piggyback on the RRSP return/volatility
 * assumption, and the balance never enters the withdrawal machinery on its
 * own. It has exactly one of two exits, both tax-free: a qualifying
 * first-home purchase, or — failing that — automatic rollover into the
 * RRSP (no room impact either way) at the earliest of 15 years after
 * opening or age 71. Deduction-on-contribution and the room tracking CRA
 * layers on top aren't modelled (same simplification as "RRSP refunds
 * aren't reinvested").
 */
export interface Fhsa {
  /** today's combined balance (both spouses, one household bucket) */
  balance: number
  /** combined annual contribution; carved out of annualSavings before savingsSplit */
  annualContribution: number
  /** years since the account was opened (earliest spouse); drives the 15-year clock */
  openedYearsAgo: number
}

/**
 * A DC pension balance that is, or will become, locked in (for example in a
 * LIRA).  It deliberately remains outside the ordinary RRSP bucket until the
 * plan's stated earliest withdrawal age.  v1 does not attempt LIF minimums,
 * maximums, or statutory unlocking rules; `jurisdiction` is retained for that
 * future extension.
 */
export interface LockedRetirement {
  balance: number
  /** employee contribution, carved out of annualSavings while still working */
  employeeContribution: number
  /** employer match/DC contribution, additional to annualSavings */
  employerContribution: number
  /** earliest age at which this plan can be used for spending */
  accessibleAge: number
  /** retained for future jurisdictional LIF rules; not used by v1 */
  jurisdiction: 'federal' | Province
  /** who owns it; v1 household tax splitting remains the app-wide approximation */
  owner: 'self' | 'partner'
}

/**
 * A child for Canada Child Benefit purposes.
 *
 * Not modelled (disclosed simplifications): CCB during the accumulation
 * years (assumed already folded into `annualSavings`, so it's only computed
 * from FIRE age on), provincial top-ups (e.g. Quebec's Family Allowance),
 * the Child Disability Benefit, and shared-custody 50% splitting.
 */
export interface Child {
  /** current age in years, 0-17 (unborn/future children aren't modelled) */
  age: number
}

export interface InvestmentProperty {
  /** Stable identity for canonical migration and list edits. */
  id?: string
  value: number
  /** adjusted cost base; gain above it is 50% taxable at sale */
  acb: number
  /** Estimated selling expenses in base-year purchasing-power CAD; charged
   * once at sale, then converted to nominal CAD for the tax-basis ledger. */
  saleExpenses?: number
  appreciation: number
  /** sale occurs at the opening of this age, including before FIRE; null = never sell */
  sellAtAge: number | null
  /**
   * Net annual rent while the property is held (rent minus operating costs,
   * today's dollars). Taxed as ordinary income; stops when the property sells.
   */
  annualRent?: number
  /** discharged from sale proceeds when the property sells; its interest
   * portion is deductible against the rent (principal repayment is not) */
  mortgage?: Mortgage
}

export interface Inputs {
  currentAge: number
  fireAge: number
  lifeExpectancy: number
  province: Province
  /** after-tax annual savings during accumulation, today's dollars */
  annualSavings: number
  /**
   * BE-13 A. Working-period spending for the canonical `incomeBudget` mode.
   * This form only edits the savings-budget figure, so switching to
   * `incomeBudget` stores its spending here and the canonical plan derives
   * `workingSpending` from it. `null` means the user has not recorded it yet —
   * it is never guessed from the retirement figure.
   */
  budgetWorkingSpending?: number | null
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
  /** BE-39 A: where `cppAnnualAt65` came from (manual / statement / estimator). */
  cppAmountSource?: PensionAmountProvenance
  /** work history from the estimator; refines the early-claim dilution */
  cppWork?: CppWork | null
  /** OAS start age, 65–70 */
  oasStartAge: number
  /** OAS annual benefit at 65, today's dollars */
  oasAnnualAt65: number
  /** BE-39 A: where `oasAnnualAt65` came from (manual / statement / estimator). */
  oasAmountSource?: PensionAmountProvenance
  /** how retirement spending is funded */
  strategy: Strategy
  /** meltdownPaced only: how far to fill the RRSP before capping (default bracket1) */
  meltdownBracketCap?: MeltdownCap
  /** optimization goal; defaults to legacy */
  goal?: Goal
  /** assumed average inflation, for nominal-dollar display (default 2.1%) */
  inflation?: number
  /** target investable assets at FIRE, for the goal-check question mode */
  fireTargetAssets?: number | null
  /** employer DB pension (annuity mode); DC balances go in the RRSP field */
  pension?: Pension | null
  /** spouse/partner for household mode; accounts are household totals */
  partner?: Partner | null
  /** expected post-FIRE side income (Barista FIRE) */
  extraIncome?: ExtraIncome | null
  /** annual return standard deviation per account, used by Monte Carlo */
  volatilities?: Record<AccountType, number>
  principalResidence?: PrincipalResidence | null
  /** rental/investment properties; store migrates the old singular field */
  investmentProperties?: InvestmentProperty[]
  /** outstanding loans; payments add to retirement spending until paid off */
  debts?: Debt[]
  /** FHSA lightweight side account; null/undefined = not using one */
  fhsa?: Fhsa | null
  /** DC/LIRA side account; unavailable until accessibleAge, then RRSP-like */
  lockedRetirement?: LockedRetirement | null
  /** children for CCB purposes; only pays out from FIRE age on (see Child) */
  children?: Child[] | null
}

/**
 * Proportional allocation of a year's total tax across its taxable
 * components (each component's share of total taxable income), so the
 * pieces sum exactly to `tax`. Not a statutory attribution — Canada taxes
 * combined income under one bracket ladder — but consistent with how
 * `rrspTax` is already attributed elsewhere in this engine.
 */
export interface TaxBySource {
  rrsp: number
  nonReg: number
  cpp: number
  oas: number
  /** net rent plus 50%-taxable investment-property sale gains */
  property: number
  extraIncome: number
  /** employer pension annuity (including any bridge benefit) */
  pension: number
}

export interface YearRow {
  age: number
  phase: Phase
  /** Obligations that could not be funded at the event date. */
  unfundedObligations: import('./funding').FundingGap[]
  /** Funding actually committed for a year-start home purchase, if any. */
  purchaseFunding: {
    eventId: string
    price: number
    mortgagePrincipal: number
    downPaymentFromFhsa: number
    downPaymentFromAccounts: number
    grossWithdrawals: Record<AccountType, number>
    firstYearCostFromSavings: number
    firstYearCostFromOpening: number
    withdrawalTax: number
  } | null
  /** Source/use ledger for a later accumulation-year home installment. */
  housingFunding: {
    eventId: string
    cost: number
    fromSavings: number
    fromOpening: number
    grossWithdrawals: Record<AccountType, number>
    withdrawalTax: number
  } | null
  /** end-of-year balances (after withdrawals/contributions and growth) */
  balances: Record<AccountType, number>
  withdrawals: Record<AccountType, number>
  cpp: number
  /** OAS actually received, after clawback */
  oas: number
  /** GIS received — tax-free, requires OAS, income-tested (TFSA invisible) */
  gis: number
  /**
   * The household category this year's GIS/Allowance was priced from
   * (BE-26 A), plus the annual income cut-off that category used, so a reader
   * can see which table row applied instead of inferring it from the amount.
   */
  gisCategory: string
  /** This year's income cut-off for that category, in annual dollars. */
  gisAnnualCutoff: number
  /** The part of `gis` that is the 60-64 spousal Allowance. */
  allowance: number
  /** CCB received this year — tax-free; 0 during accumulation (assumed
   * already folded into annualSavings) and once all children turn 18 */
  ccb: number
  /** net rent received from unsold investment properties (taxable) */
  rent: number
  /** post-FIRE side income received this year (taxable) */
  extraIncome: number
  /** employer pension received this year, bridge included (taxable) */
  pension: number
  tax: number
  /** after-tax cash available this year */
  netCash: number
  /** unmet spending (money ran out) */
  shortfall: number
  /** unsold real estate value at end of year */
  propertyValue: number
  /** end-of-year FHSA balance; 0 once it has matured into the RRSP or been spent on a home */
  fhsaBalance: number
  /** end-of-year locked DC/LIRA balance; becomes 0 once it reaches accessibleAge */
  lockedRetirementBalance: number
  /** real (today's-dollar) debt payments made this year */
  debtPayment: number
  /** real end-of-year debt balance outstanding */
  debtBalance: number
  /** taxable income per person this year (0 during accumulation) */
  taxablePerPerson: number
  /** this year's tax, allocated proportionally across taxable components */
  taxBySource: TaxBySource
  /** this year's taxable income (household total), split by component */
  taxableBySource: TaxBySource
  /** Legal-recipient tax ledger when canonical person attribution is available. */
  byPersonTax?: Record<string, import('./householdTax').PersonTaxRow>
  taxCapability?: 'person' | 'legacyEstimate'
}

export interface ProjectionResult {
  /** An explicit limit prevents an old pooled preview from becoming advice. */
  taxCapability?: { status: 'person' | 'legacyEstimate'; reason?: string }
  /**
   * BE-38 B1: the versioned tax rule pack that priced this run's bracket ladder
   * and basic personal amount, and whether that year was published or assumed.
   * Present so a reader can trace every tax figure to a pack rather than to a
   * constant in the source.
   */
  taxRules?: import('./tax').TaxRuleProvenance
  /**
   * BE-38 B2: the versioned CCB rule pack and July-June payment period that
   * priced this run's `ccb` amounts, and whether that period was published or
   * assumed. Present so a CCB figure is traceable to a sourced pack rather than
   * to a constant in the engine.
   */
  benefitRules?: import('./benefits').BenefitRuleProvenance
  /**
   * A modeled disposition depends on tax facts this engine cannot verify, so a
   * positive funding, retirement-age or spending claim derived from this run is
   * not verified. `investmentPropertySale` needs a land/building split and CCA
   * history; `nonRegisteredLoss` needs superficial-loss confirmation and an
   * owner-specific carry ledger.
   */
  capitalTaxLimit?: 'investmentPropertySale' | 'nonRegisteredLoss'
  rows: YearRow[]
  unfundedObligations: import('./funding').FundingGap[]
  /** spending fully funded through life expectancy */
  success: boolean
  /** first age where spending could not be met, if any */
  depletedAge: number | null
  /** face value at life expectancy — overstates RRSP-heavy outcomes */
  finalNetWorth: number
  /** Unsupported when an invalid direct-engine plan ends in accumulation;
   * numeric fields then retain a known-income surrogate for legacy callers. */
  terminalTaxStatus: 'estimated' | 'unsupported'
  /**
   * Incremental final-return income tax and OAS recovery from remaining RRSP/RRIF and taxable
   * unrealized gains, added to the year's modeled ordinary income. The
   * shared-endpoint allocation is not a person-by-person death model.
   */
  estateTax: number
  /** Additional OAS repayment included in estateTax, net of the annual recovery. */
  terminalOasRecovery: number
  /** Closing registered income included in the shared-endpoint estimate. */
  terminalRegisteredIncome: number
  /** Taxable portion of remaining non-registered and property gains. */
  terminalCapitalGainsIncome: number
  /**
   * Probate / estate administration fee on probatable assets (non-registered
   * account, unsold real estate) — registered accounts bypass it via named
   * beneficiary designation.
   */
  probateFee: number
  /** after-tax estate value — the number strategies should be ranked by */
  estateValue: number
  /**
   * total tax paid on RRSP/RRIF money: yearly tax attributed proportionally
   * to RRSP withdrawals, plus the RRSP share of the deemed-disposition tax
   */
  rrspTax: number
}
