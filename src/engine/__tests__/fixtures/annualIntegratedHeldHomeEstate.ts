import type { WorkingSpendingEvidence } from '../../annualWorking'
import type { InputsV2 } from '../../model'
import { BASE_YEAR, known, retirementPlan, RETIREE, TFSA } from './retirementSettlement'

export const heldHomeEstateIds = {
  self: RETIREE, partner: 'estate-partner', selfTfsa: TFSA, partnerTfsa: 'partner-tfsa',
  home: 'held/home', debt: 'held/mortgage', expense: 'one-time-repair',
} as const
const { self, partner, selfTfsa, partnerTfsa, home, debt, expense } = heldHomeEstateIds
export const estateYear = BASE_YEAR + 2

export function integratedHeldHomeEstateFixture() {
  const dated = { origin: 'user', sourceYear: BASE_YEAR - 1 } as const
  const plan = retirementPlan({ tfsa: 650, rrsp: 0, spending: 300, strategy: 'tfsaFirst' })
  plan.accounts.pop()
  const [person] = plan.people
  Object.assign(person, { retirementAge: 58, earnedIncome: known(2_500), tfsaAvailableRoom: known(100) })
  plan.people.push({ ...structuredClone(person), id: partner, role: 'partner', ageInBaseYear: 55,
    retirementAge: 57, earnedIncome: known(500), tfsaAvailableRoom: known(250) })
  const [account] = plan.accounts
  account.provenance = { balance: dated, ownerId: dated, taxableOwnerShares: dated }
  plan.accounts.push({ ...structuredClone(account), id: partnerTfsa, ownerId: partner, balance: 2_139.15,
    taxableOwnerShares: { status: 'known', shares: { [partner]: 1 } } })
  plan.tfsaStatement![partner] = { withdrawals: [], provenance: dated }
  plan.taxProfile = { spouseSupported: known(false), pensionSplit: null }
  plan.budget = { kind: 'incomeBudget', workingSpending: 1_520.10, retirementSpending: 300 }
  const title = { [self]: 0.25, [partner]: 0.75 }
  plan.properties = [{ id: home, kind: 'principal', value: 480_000, acb: known(240_000), annualRent: known(0),
    appreciation: 0.1, annualHoldingCostChange: 0, sellAtAge: null, plannedPurchaseAge: null,
    plannedDownPayment: null, plannedMortgage: null, mortgageDebtId: debt,
    taxableOwnerShares: { status: 'known', shares: { ...title } },
    provenance: { value: dated, acb: dated, taxableOwnerShares: dated } }]
  plan.debts = [{ id: debt, propertyId: home, kind: 'mortgage', principal: 3_310,
    annualPayment: 1_331, yearsRemaining: 3, provenance: dated }]
  const orderedAccounts: NonNullable<InputsV2['annualHouseholdMortgageFundingEvidence']>['orderedAccounts'] = [
    { ownerId: self, accountId: selfTfsa }, { ownerId: partner, accountId: partnerTfsa },
  ]
  plan.annualHouseholdMortgageFundingEvidence = { authorized: true, purpose: 'household-held-mortgage-and-living',
    provenance: dated, orderedAccounts }
  plan.annualHouseholdWorkingTfsaEvidence = { authorized: true, purpose: 'household-held-mortgage-working-tfsa',
    provenance: dated, years: { [BASE_YEAR]: [
      { ...orderedAccounts[0], amountNominal: 25.04 }, { ...orderedAccounts[1], amountNominal: 74.96 },
    ] } }
  plan.annualHouseholdExpenseEvidence = { id: expense, effectiveYear: estateYear, timing: 'after-mortgage-and-living',
    amountBasis: 'event-year-nominal-CAD', amountNominal: known(100), noncapital: true, nonDeductible: true,
    allowPartialPayment: true, excludesFromLivingBudget: true, useExistingFundingOrder: true, provenance: dated }
  const heldHome = { propertyId: home, locatedInOntario: true, ownerShares: { ...title }, decedentShareEstateIncluded: true,
    wholeTerminalGainExcluded: true, provenance: dated } as const
  const estate = { provenance: dated, effectiveYear: estateYear, personId: self, timing: 'end-of-terminal-year',
    modeledDecedent: 'self-only', survivingPersonId: partner, noSurvivorProjection: true,
    certificateRequired: true, completeEstate: true, noDeathBenefitsOrOtherTerminalIncome: true,
    accounts: { [selfTfsa]: { ownerId: self, estateIncluded: true, noBeneficiaryRollover: true, tfsaNoDeathIncome: true } },
    heldHome } as const
  const estates: InputsV2['annualTerminalEstateEvidence'] = { [estateYear]: estate }
  plan.annualTerminalEstateEvidence = estates
  plan.legacyProjection = { ...plan.legacyProjection, fireAge: 58, lifeExpectancy: 59,
    balances: { tfsa: 2_789.15, rrsp: 0, nonReg: 0 },
    partner: { currentAge: 55, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
    principalResidence: { value: 480_000, appreciation: 0.1, sellAtAge: null,
      mortgage: { balance: 3_310, annualPayment: 1_331, yearsRemaining: 3 } } }
  const spending: WorkingSpendingEvidence = { workingSpending: known(1_520.10), transitionSpending: known(350),
    retirementSpending: known(300), scheduledMortgagePaymentsExcluded: known(true) }
  return { plan, spending, heldHome }
}
