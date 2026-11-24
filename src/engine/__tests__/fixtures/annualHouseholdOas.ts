import type { InputsV2, Person } from '../../model'
import { cppStart } from './annualCpp'
import { BASE_YEAR, known, recorded, RETIREE, RRSP } from './retirementSettlement'
import { PARTNER, staggeredHouseholdPlan, staggeredReference } from './staggeredHousehold'

// Ontario 2026 rule pack at d589fa15b8012479a75d7891bbdef04fa3e20679.
// Synthetic verified full-year receipts in anchor CAD. The withdrawal
// targets independently pin line 23500 treatment and cash after recovery.
const opening = 250_000
const ownerGross = 9_150
const ownerCpp = 12_000
const partnerGross = 8_000
const partnerCpp = 8_000
const partialDraw = 88_000
const fullDraw = 155_000
// Recovery is 15% of the owner's $109,150 less $95,323 in 2027.
// In 2028, 15% of the owner's $176,150 less $95,323 exceeds $9,150.
// Apply the pinned federal and ON brackets, BPAs, age credits, ON surtax
// and health premium to the owner's post-recovery $107,075.95 / $167,000.
const partial = { draw: partialDraw, recovery: 2_074.05, net: 7_075.95, recoveryIncome: 109_150, taxable: 107_075.95, tax: 23_732.46641 }
const full = { draw: fullDraw, recovery: 9_150, net: 0, recoveryIncome: 176_150, taxable: 167_000, tax: 49_270.47376 }
const working = staggeredReference.working
const transitionSpending = working.partner.wage - working.partner.payroll - working.partner.tax + partial.taxable - partial.tax
// The partner's $16,000 is covered by their own basic and age credits.
const retirementSpending = full.taxable - full.tax + partnerGross + partnerCpp

export const householdOasReference = {
  inflation: 0.02, opening, working, transitionSpending, retirementSpending,
  ownerGross, ownerCpp, partnerGross, partnerCpp, partial, full,
}

export function householdBenefitExclusions(personId: string) {
  return {
    gis: { status: 'excluded' as const, reason: `No GIS modeled for ${personId}`, provenance: recorded },
    allowance: { status: 'not-applicable' as const, reason: `No Allowance for ${personId}`, provenance: recorded },
    otherBenefits: { status: 'excluded' as const, reason: `No other receipt modeled for ${personId}`, provenance: recorded },
  }
}

export function householdOasFixture() {
  const plan: InputsV2 = staggeredHouseholdPlan()
  const [self, partner] = plan.people
  const setBenefits = (person: Person, age: number, cpp: number, oas: number) => {
    Object.assign(person, { ageInBaseYear: age, retirementAge: 65, cppAnnualAt65: cpp, oasAnnualAt65: oas })
    plan.incomeSources.push(cppStart(person.id, 65, cpp), {
      id: `${person.id}:oas`, kind: 'oas', recipientId: person.id, startAge: 65, annualAmount: known(oas), provenance: recorded,
    })
  }
  setBenefits(self, 64, ownerCpp, ownerGross)
  setBenefits(partner, 63, partnerCpp, partnerGross)
  partner.oasAmountSource = {
    source: 'statement', sourceYear: BASE_YEAR, basis: 'annual', dollarBasis: 'today', ageBasis: 65, premises: { retirementAge: 65 },
  }
  plan.annualBenefitsEvidence = {
    [RETIREE]: householdBenefitExclusions(RETIREE),
    [PARTNER]: householdBenefitExclusions(PARTNER),
  }
  plan.accounts = plan.accounts.filter(account => account.id === RRSP)
  Object.assign(plan.accounts[0], { balance: opening, ownerId: RETIREE, taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 1 } } })
  plan.budget = { kind: 'incomeBudget', workingSpending: working.spending, retirementSpending }
  plan.strategy = 'rrspFirst'
  plan.lifeExpectancy = 69
  plan.taxProfile = { spouseSupported: known(false), pensionSplit: null }
  Object.assign(plan.legacyProjection, {
    currentAge: 64, fireAge: 65, lifeExpectancy: 69, retirementSpending,
    cppAnnualAt65: ownerCpp, oasAnnualAt65: ownerGross,
    balances: { tfsa: 0, rrsp: opening, nonReg: 0 },
    partner: { currentAge: 63, cppStartAge: 65, cppAnnualAt65: partnerCpp, oasStartAge: 65, oasAnnualAt65: partnerGross },
  })
  return {
    plan,
    evidence: {
      workingSpending: known(working.spending), transitionSpending: known(transitionSpending), retirementSpending: known(retirementSpending),
    },
  }
}
