import type { InputsV2 } from '../../model'
import type { WorkingSpendingEvidence } from '../../annualWorking'
import { BASE_YEAR, known, recorded, retirementPlan, RETIREE, TFSA } from './retirementSettlement'

/** FE-53 S2 synthetic canonical acceptance scenario, NOT a migrated S0 result.
 * Source brief: src/__tests__/fixtures/annualProjectionHousehold.ts and the
 * annual-projection-sheet-plan.md S0/S2 acceptance criteria. All amounts below
 * are nominal CAD dollars (the original S0 uses cents). No engine evaluation,
 * projection, tax calculator or output snapshot supplies these expectations.
 * Zero CPI/returns deliberately isolate the continuous cash/debt postings.
 */
export const integratedHouseholdIds = {
  self: RETIREE, partner: 'integrated-sam', tfsa: TFSA,
  home: 'integrated-home', debt: 'integrated-mortgage',
} as const
const { self, partner, tfsa, home, debt } = integratedHouseholdIds
export const integratedHouseholdScenarioId = 'annual-integrated-household'
export const integratedEstateControlScenarioId = 'annual-integrated-estate-control'

export function integratedHouseholdFixture(): { plan: InputsV2; evidence: WorkingSpendingEvidence; years: number } {
  const plan = retirementPlan({ tfsa: 8_500, rrsp: 0, inflation: 0, spending: 500, strategy: 'tfsaFirst' })
  Object.assign(plan.people[0], { retirementAge: 58, earnedIncome: known(12_000) })
  plan.people.push({ ...structuredClone(plan.people[0]), id: partner, role: 'partner', ageInBaseYear: 55, retirementAge: 57 })
  plan.accounts = [plan.accounts[0]]
  plan.tfsaStatement![partner] = { withdrawals: [], provenance: recorded }
  plan.taxProfile = { spouseSupported: known(false), pensionSplit: null }
  plan.lifeExpectancy = 62
  plan.budget = { kind: 'incomeBudget', workingSpending: 21_266.30, retirementSpending: 500 }
  plan.properties = [{ id: home, kind: 'principal', value: 12_500, acb: known(900.25), annualRent: known(0),
    appreciation: 0, annualHoldingCostChange: 0, sellAtAge: 59, plannedPurchaseAge: null,
    plannedDownPayment: null, plannedMortgage: null, mortgageDebtId: debt,
    taxableOwnerShares: { status: 'known', shares: { [partner]: 1, [self]: 0 } },
    provenance: { value: recorded, acb: recorded, taxableOwnerShares: recorded } }]
  plan.debts = [{ id: debt, kind: 'mortgage', propertyId: home, principal: 3_310,
    annualPayment: 1_331, yearsRemaining: 3, provenance: recorded }]
  plan.annualPrimaryHomeSaleEvidence = { [home]: {
    provenance: recorded, wholePropertyFullyExcluded: true, salePriceBasis: 'opening-year-nominal-value',
    effectiveYear: 2028, timing: 'start-of-sale-year', sellingCostsNominal: known(0),
    postSaleAnnualSpendingReal: known(5_500), allSaleCashAvailableForJointSpending: true,
    ownerExclusions: { [partner]: { fullyExcluded: true, provenance: recorded } },
    mortgagePayoff: { debtId: debt, timing: 'start-of-sale-year', effectiveYear: 2028,
      openingPrincipalNominal: known(1_210), additionalAccruedInterestNominal: known(0),
      prepaymentPenaltyNominal: known(0), dischargeFeesNominal: known(0), provenance: recorded },
  } }
  plan.annualTerminalEstateEvidence = { 2031: {
    provenance: recorded, effectiveYear: 2031, personId: self, timing: 'end-of-terminal-year',
    modeledDecedent: 'self-only', survivingPersonId: partner, noSurvivorProjection: true,
    certificateRequired: true, completeEstate: true, noDeathBenefitsOrOtherTerminalIncome: true,
    accounts: { [tfsa]: { ownerId: self, estateIncluded: true, noBeneficiaryRollover: true, tfsaNoDeathIncome: true } },
  } }
  Object.assign(plan.legacyProjection, { fireAge: 58, lifeExpectancy: 62,
    partner: { currentAge: 55, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 } })
  return { plan, years: 6, evidence: { workingSpending: known(21_266.30), transitionSpending: known(9_967.65),
    retirementSpending: known(500), scheduledMortgagePaymentsExcluded: known(true) } }
}

// Each $12,000 wage pays CPP (12,000−3,500)×.0595 = 505.75 and
// EI 12,000×.0163 = 195.60; income tax is zero. Net wage = 11,298.65.
// Working cash: 24,000−1,402.70−21,266.30−1,331 = 0.
// Mixed cash: 12,000−701.35−9,967.65−1,331 = 0.
// Fixed 10% mortgage: 3310+331−1331=2310; 2310+231−1331=1210.
// Sale: 12500−0−1210=11290 cash; excluded gain=12500−900.25=11599.75.
// Living uses sale cash first, then the sole owner's TFSA:
// 11290−5500=5790; 5790−5500=290; 5500−290=5210 TFSA draw;
// 8500−5210=3290; final year 5500−3290=2210 unmet living.
export const integratedHouseholdExpected = {
  years: [
    { year: 2026, phase: 'both-working', ages: [57, 55], income: 24_000, payroll: 1_402.70, tax: 0,
      spending: 21_266.30, debtOpening: 3_310, interest: 331, principal: 1_000, debtPayment: 1_331, debtClosing: 2_310,
      tfsaOpening: 8_500, tfsaWithdrawal: 0, tfsaClosing: 8_500, saleCashOpening: 0, saleCashAdded: 0, saleCashUsed: 0, saleCashClosing: 0,
      propertyClosing: 12_500, netWorth: 18_690, livingGap: 0 },
    { year: 2027, phase: 'mixed', ages: [58, 56], income: 12_000, payroll: 701.35, tax: 0,
      spending: 9_967.65, debtOpening: 2_310, interest: 231, principal: 1_100, debtPayment: 1_331, debtClosing: 1_210,
      tfsaOpening: 8_500, tfsaWithdrawal: 0, tfsaClosing: 8_500, saleCashOpening: 0, saleCashAdded: 0, saleCashUsed: 0, saleCashClosing: 0,
      propertyClosing: 12_500, netWorth: 19_790, livingGap: 0 },
    { year: 2028, phase: 'both-retired', ages: [59, 57], income: 0, payroll: 0, tax: 0,
      spending: 5_500, debtOpening: 1_210, interest: 0, principal: 1_210, debtPayment: 1_210, debtClosing: 0,
      tfsaOpening: 8_500, tfsaWithdrawal: 0, tfsaClosing: 8_500, saleCashOpening: 0, saleCashAdded: 11_290, saleCashUsed: 5_500, saleCashClosing: 5_790,
      propertyClosing: 0, netWorth: 14_290, livingGap: 0 },
    { year: 2029, phase: 'both-retired', ages: [60, 58], income: 0, payroll: 0, tax: 0,
      spending: 5_500, debtOpening: 0, interest: 0, principal: 0, debtPayment: 0, debtClosing: 0,
      tfsaOpening: 8_500, tfsaWithdrawal: 0, tfsaClosing: 8_500, saleCashOpening: 5_790, saleCashAdded: 0, saleCashUsed: 5_500, saleCashClosing: 290,
      propertyClosing: 0, netWorth: 8_790, livingGap: 0 },
    { year: 2030, phase: 'both-retired', ages: [61, 59], income: 0, payroll: 0, tax: 0,
      spending: 5_500, debtOpening: 0, interest: 0, principal: 0, debtPayment: 0, debtClosing: 0,
      tfsaOpening: 8_500, tfsaWithdrawal: 5_210, tfsaClosing: 3_290, saleCashOpening: 290, saleCashAdded: 0, saleCashUsed: 290, saleCashClosing: 0,
      propertyClosing: 0, netWorth: 3_290, livingGap: 0 },
    { year: 2031, phase: 'both-retired', ages: [62, 60], income: 0, payroll: 0, tax: 0,
      spending: 3_290, spendingDue: 5_500, debtOpening: 0, interest: 0, principal: 0, debtPayment: 0, debtClosing: 0,
      tfsaOpening: 3_290, tfsaWithdrawal: 3_290, tfsaClosing: 0, saleCashOpening: 0, saleCashAdded: 0, saleCashUsed: 0, saleCashClosing: 0,
      propertyClosing: 0, netWorth: 0, livingGap: 2_210 },
  ],
  firstLivingGap: { year: 2031, amount: 2_210 },
  sale: { year: 2028, grossProceeds: 12_500, netProceeds: 12_500, realizedGain: 11_599.75, taxableGain: 0, payoff: 1_210, residualCash: 11_290 },
  terminalEstate: { status: 'unavailable', reason: 'unsupported-estate' },
  overallConclusionAvailable: false,
} as const

export type IntegratedHouseholdVariant = 'missing-sale-payoff' | 'event-financing-gap' | 'missing-owner-statement' | 's0-owner-accounts' | 's0-public-benefits'
export function integratedHouseholdVariant(kind: IntegratedHouseholdVariant) {
  const scenario = integratedHouseholdFixture()
  const { plan } = scenario
  let year = 2028
  let cause = 'propertySale'
  if (kind === 'missing-sale-payoff') delete plan.annualPrimaryHomeSaleEvidence![home].mortgagePayoff
  if (kind === 'event-financing-gap') {
    // $12,500−$12,000 fees=$500: the $1,210 lien cannot settle; $710
    // financing deficit is arithmetic only, NOT a posted canonical event gap.
    plan.annualPrimaryHomeSaleEvidence![home].sellingCostsNominal = known(12_000)
    // Keep the gain positive ($500−$400=$100), so the refusal specifically
    // reaches insufficient lien payoff rather than the sale-loss boundary.
    plan.properties[0].acb = known(400)
  }
  if (kind === 'missing-owner-statement') { delete plan.tfsaStatement![self]; year = 2030; cause = 'tfsaWithdrawalEvidence' }
  if (kind === 's0-owner-accounts') {
    for (const owner of [self, partner]) {
      if (owner === partner) plan.accounts.push({ ...structuredClone(plan.accounts[0]), id: 'sam-tfsa', ownerId: partner,
        balance: 5_000, taxableOwnerShares: { status: 'known', shares: { [partner]: 1 } } })
      plan.accounts.push({ ...structuredClone(plan.accounts[0]), id: `${owner}-rrsp`, kind: 'rrsp', ownerId: owner,
        balance: 10_000, taxableOwnerShares: { status: 'known', shares: { [owner]: 1 } } })
    }
    year = BASE_YEAR; cause = 'unsupported'
  }
  if (kind === 's0-public-benefits') { plan.people[0].oasAnnualAt65 = 8_000; year = BASE_YEAR; cause = 'unsupported' }
  return { ...scenario, expectedFailure: { year, status: 'unsupported' as const, cause,
    settledYears: Array.from({ length: year - BASE_YEAR }, (_, i) => BASE_YEAR + i),
    uncomputedYears: Array.from({ length: 2031 - year }, (_, i) => year + i + 1),
    ...(kind === 'event-financing-gap' ? { arithmeticFinancingDeficit: 710, eventId: home } : {}),
  } }
}

/** Independent estate CONTROL, not a continuation or splice of housing rows. */
export function integratedEstateControlFixture() {
  const scenario = integratedHouseholdFixture()
  const { plan } = scenario
  plan.properties = []; plan.debts = []; delete plan.annualPrimaryHomeSaleEvidence
  plan.accounts[0].balance = 60_000
  plan.accounts.push({ ...structuredClone(plan.accounts[0]), id: 'estate-partner-tfsa', ownerId: partner,
    balance: 90_000, taxableOwnerShares: { status: 'known', shares: { [partner]: 1 } } })
  plan.budget = { kind: 'incomeBudget', workingSpending: 22_597.30, retirementSpending: 0 }
  scenario.evidence = { workingSpending: known(22_597.30), transitionSpending: known(11_298.65), retirementSpending: known(0) }
  return scenario
}
// No returns or draws: self $60,000, survivor $90,000. Ontario certificate
// fee: ceil(($60,000−$50,000)/$1,000)×$15=$150; no TFSA death income.
export const integratedEstateControlExpected = { year: 2031, closingNetWorth: 60_000,
  householdClosingNetWorth: 150_000, excludedSurvivorClosingNetWorth: 90_000,
  closingRegisteredFairMarketValue: 0, incrementalFinalReturnIncomeTax: 0,
  estateAdministrationTaxBase: 60_000, estateAdministrationTax: 150, netEstate: 59_850 } as const

/** Remaining full-S0 blockers: mortgage admission permits only one funded
 * owner TFSA and no positive registered balances/public benefits; the sale
 * gate atomically refuses underfunded settlement instead of posting a partial
 * event; terminal estate excludes plans retaining housing/sale cash metadata.
 * Smallest end-to-end remedy: expand the authenticated mortgage/sale route's
 * existing owner withdrawal postings to multiple TFSA/RRSP owners + benefit
 * settlement, carry an explicit due/paid/gap event receipt without committing
 * an unpaid sale, and certify the sold-property cash/title estate bridge.
 * Until then keep S0 as a view benchmark, this real supported chain plus the
 * explicit refusals as S2 acceptance, and never splice the estate control in.
 */
