import type { Account, InputsV2, Known, Provenance } from '../../model'
import type { Inputs, PensionAmountProvenance, Strategy } from '../../types'

export const known = <T>(value: T): Known<T> => ({ status: 'known', value })
export const RETIREE = 'retiree'
export const TFSA = 'retiree-tfsa'
export const RRSP = 'retiree-rrsp'
export const BASE_YEAR = 2026
export const recorded: Provenance = { origin: 'user', sourceYear: BASE_YEAR }
const zeroBenefit: PensionAmountProvenance = {
  source: 'manual', sourceYear: BASE_YEAR, basis: 'annual', ageBasis: 65, dollarBasis: 'today',
}

export function legacyRetirement(overrides: Partial<Inputs> = {}): Inputs {
  return {
    currentAge: 57, fireAge: 55, lifeExpectancy: 59, province: 'ON',
    annualSavings: 0, retirementSpending: 25_000, inflation: 0,
    balances: { tfsa: 40_000, rrsp: 100_000, nonReg: 0 }, nonRegBook: 0,
    returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 },
    cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0,
    strategy: 'rrspFirst',
    ...overrides,
  }
}

export function retirementPlan({
  tfsa = 40_000, rrsp = 100_000, spending = 25_000, inflation = 0,
  tfsaReturn = 0, rrspReturn = 0, fee = 0, strategy = 'rrspFirst', age = 57,
}: { tfsa?: number; rrsp?: number; spending?: number; inflation?: number;
  tfsaReturn?: number; rrspReturn?: number; fee?: number; strategy?: Strategy; age?: number } = {}): InputsV2 {
  const account = (id: string, kind: Account['kind'], balance: number, realReturn: number): Account => ({
    id, kind, balance, realReturn, annualFee: fee, ownerId: RETIREE, volatility: null,
    acb: known(0), taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 1 } },
    contributionRoom: known(0), openedYear: known(2016), openedYearsAgoAtBaseYear: 10,
    provenance: {},
  })
  return {
    schemaVersion: 2, baseYear: BASE_YEAR, province: 'ON', inflation,
    budget: { kind: 'savingsBudget', annualNetSavings: 0, retirementSpending: spending,
      debtIncluded: known(true), taxBenefitIncluded: known(true) },
    people: [{
      id: RETIREE, role: 'self', ageInBaseYear: age, retirementAge: 55, earnedIncome: known(0),
      previousYearEarnedIncome: known(0), rrspAvailableRoom: known(0), rrspDeductionLimit: known(0),
      rrspUnusedUndeducted: known(0), rrspPensionAdjustment: known(0), rrspPspa: known(0), rrspPar: known(0),
      tfsaAvailableRoom: known(8_000), cppAnnualAt65: 0, oasAnnualAt65: 0,
      cppAmountSource: { ...zeroBenefit }, oasAmountSource: { ...zeroBenefit },
      pensionAnnual: 0, pension: null, cppWork: null, provenance: {},
    }],
    accounts: [account(TFSA, 'tfsa', tfsa, tfsaReturn), account(RRSP, 'rrsp', rrsp, rrspReturn)],
    contributions: [], recurringContributions: [], incomeSources: [], properties: [], debts: [], dependents: [],
    tfsaStatement: { [RETIREE]: { withdrawals: [], provenance: recorded } },
    savingsAllocation: { shares: { tfsa: 1, rrsp: 0, nonReg: 0 }, provenance: recorded },
    projectionAssumptions: { nonRegDistributionYield: 0, accumulationMarginalRate: 0, meltdownBracketCap: 'bracket1' },
    strategy, goal: 'legacy', lifeExpectancy: age + 2, targetAssets: known(0),
    legacyProjection: legacyRetirement({ currentAge: age, lifeExpectancy: age + 2, strategy, retirementSpending: spending, inflation, fees: fee,
      balances: { tfsa, rrsp, nonReg: 0 }, returns: { tfsa: tfsaReturn, rrsp: rrspReturn, nonReg: 0 } }),
    migration: { sourcePersistVersion: 11, ownershipNeedsConfirmation: false,
      ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false },
  }
}
