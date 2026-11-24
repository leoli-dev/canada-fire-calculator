import type { InputsV2 } from '../../model'
import { known, legacyRetirement, retirementPlan } from './retirementSettlement'

// Reference constants and formulas pinned to 589742895cb351b817caa2feea1475d15e4b3193.
// The expectations use arithmetic on the pinned values without calling production calculators.
const wage = 80_000
const workingSpending = 54_000
const retirementSpending = 50_000
const inflation = 0.02
const tfsaOpening = 1_000
const rrspOpening = 30_000
const tfsaRoom = 8_000
const age = 56
const retirementAge = 57

// src/engine/payroll.ts: $71,100 at 5.95%, $5,400 at 4%, and capped EI.
const pensionable = 74_600 - 3_500
const cpp = pensionable * 0.0595
const cpp2 = (wage - 74_600) * 0.04
const ei = 68_900 * 0.0163
const payroll = cpp + cpp2 + ei
const taxDeduction = pensionable * 0.01 + cpp2
const creditAmount = pensionable * 0.0495 + ei
const employmentAmount = 1_501
const taxableWage = wage - taxDeduction

// src/engine/rules/tax2026Snapshot.ts: both second brackets apply, with full
// basic personal amounts. src/engine/tax.ts: base CPP and EI get federal and
// provincial credits; the employment amount is federal only. src/engine/taxData.ts:
// Ontario basic tax is below the $5,818 surtax threshold; the premium is $750.
const workingFederal = (58_523 - 16_452 - creditAmount - employmentAmount) * 0.14
  + (taxableWage - 58_523) * 0.205
const workingOntario = (53_891 - 12_989 - creditAmount) * 0.0505
  + (taxableWage - 53_891) * 0.0915 + 750
const workingTax = workingFederal + workingOntario
const netSavings = wage - payroll - workingTax - workingSpending

// Post the base-year savings share to the owner's confirmed TFSA room.
// src/engine/tfsaRoom.ts rounds posted contributions and closing room to cents.
// src/engine/annualState.ts applies nominal growth after the contribution.
const contribution = Math.round(netSavings * 100) / 100
const cpi = 1 + inflation
const tfsaClosing = (tfsaOpening + contribution) * cpi
const rrspClosing = rrspOpening * cpi

// src/engine/annualRetirement.ts prices the exhausted RRSP in anchor dollars
// and converts tax back to nominal once. At 57, ordinary RRSP withdrawals
// have no pension or age credit, and $30,000 attracts a $300 ON health premium.
const retirementTax = ((rrspOpening - 16_452) * 0.14 + (rrspOpening - 12_989) * 0.0505 + 300) * cpi
const spendingDue = retirementSpending * cpi
const spendingFunded = rrspClosing + tfsaClosing - retirementTax

export const phaseReference = {
  age, retirementAge, wage, workingSpending, retirementSpending, payroll, taxDeduction, creditAmount, employmentAmount,
  taxableWage, workingTax, netSavings, contribution, tfsaOpening, rrspOpening,
  tfsaRoom, tfsaClosingRoom: tfsaRoom - contribution, tfsaClosing, rrspClosing, cpi,
  retirementTax, spendingDue, spendingFunded, deficit: spendingDue - spendingFunded,
}

export function phaseTransitionPlan(): InputsV2 {
  const plan = retirementPlan({
    age, spending: retirementSpending, inflation, tfsa: tfsaOpening, rrsp: rrspOpening,
  })
  plan.budget = { kind: 'incomeBudget', workingSpending, retirementSpending }
  // The retirement fixture supplies user-recorded zero CPP/OAS, known zero
  // unused RRSP deductions and a confirmed empty TFSA withdrawal statement.
  Object.assign(plan.people[0], { retirementAge, earnedIncome: known(wage), previousYearEarnedIncome: known(wage) })
  plan.legacyProjection = legacyRetirement({
    currentAge: age, fireAge: retirementAge, lifeExpectancy: plan.lifeExpectancy,
    annualSavings: 4_000, retirementSpending, inflation,
    balances: { tfsa: tfsaOpening, rrsp: rrspOpening, nonReg: 0 },
  })
  return plan
}
