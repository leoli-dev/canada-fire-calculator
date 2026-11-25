import { describe, expect, it } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetExplanation, type AnnualSheetModel } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { annualHouseholdOas, settleHouseholdOas } from '../annualOas'
import { annualRetirementContinuation, annualRetirementStep } from '../annualRetirement'
import { annualStep, initializeState, projectAnnualCoverage, projectCanonicalCoverage, projectFromState, type AnnualProviders, type KernelResult } from '../annualState'
import { evaluateCanonicalHouseholdWorkingYear, type WorkingSpendingEvidence } from '../annualWorking'
import type { InputsV2 } from '../model'
import { runProjection } from '../projection'
import { cppStart } from './fixtures/annualCpp'
import { householdBenefitExclusions } from './fixtures/annualHouseholdOas'
import { BASE_YEAR, known, legacyRetirement, recorded, retirementPlan, RETIREE, RRSP, TFSA } from './fixtures/retirementSettlement'

const PARTNER = 'rrsp-mortgage-partner'
const SECOND_TFSA = 'self-mortgage-tfsa'
const HOME = 'rrsp-mortgage-home'
const DEBT = 'rrsp-mortgage-debt'
const MIXED = BASE_YEAR + 1
const RETIRED = BASE_YEAR + 2
const context = { scenarioId: 'mortgage-rrsp-independent', revision: 1 }
type Decimal = { coefficient: string; scale: number }

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

// Independent decimal arithmetic for the receipt proof, on a common grid of
// 80 fractional places. All shortest decimal inputs exercised here fit it.
function decimal(value: number | string | Decimal): bigint {
  if (typeof value === 'object') return BigInt(value.coefficient) * 10n ** BigInt(80 - value.scale)
  const [mantissa, exponent = '0'] = String(value).split('e')
  const [whole, fraction = ''] = mantissa.split('.')
  return BigInt(whole + fraction) * 10n ** BigInt(80 - fraction.length + Number(exponent))
}

function multiply(a: number | string | Decimal, b: number | string | Decimal): bigint {
  const product = decimal(a) * decimal(b)
  expect(product % 10n ** 80n).toBe(0n)
  return product / 10n ** 80n
}

function adjacent(value: number, offset: bigint) {
  const bits = new DataView(new ArrayBuffer(8))
  bits.setFloat64(0, value)
  bits.setBigUint64(0, bits.getBigUint64(0) + offset)
  return bits.getFloat64(0)
}

const close = (amount: number) => expect.closeTo(amount, 7)
const positive = (amount: number) => Math.max(0, amount)

// 2026 Ontario anchor. The retired owner's incomes remain below the federal
// BPA phaseout and the $200k premium step. Ordinary RRSP, CPP and OAS do not
// earn a pension credit. The explicit support election grants no spouse credit.
function seniorTax(income: number) {
  const federalAge = positive(9_208 - 0.15 * positive(income - 46_432))
  const ontarioAge = positive(6_342 - 0.15 * positive(income - 47_210))
  const federal = positive(0.14 * (Math.min(income, 58_523) - 16_452 - federalAge)
    + 0.205 * positive(Math.min(income, 117_045) - 58_523) + 0.26 * positive(income - 117_045))
  const ontario = positive(0.0505 * (Math.min(income, 53_891) - 12_989 - ontarioAge)
    + 0.0915 * positive(Math.min(income, 107_785) - 53_891)
    + 0.1116 * positive(Math.min(income, 150_000) - 107_785) + 0.1216 * positive(income - 150_000))
  const premium = Math.min(300, 0.06 * positive(income - 20_000))
    + Math.min(150, 0.06 * positive(income - 36_000)) + Math.min(150, 0.25 * positive(income - 48_000))
    + Math.min(150, 0.25 * positive(income - 72_000))
  return federal + ontario + 0.2 * positive(ontario - 5_818) + 0.36 * positive(ontario - 7_446) + premium
}

function ownerQuote(drawReal: number, benefits: boolean) {
  const cpp = benefits ? 12_000 : 0
  const grossOas = benefits ? 9_150 : 0
  const recoveryIncome = cpp + grossOas + drawReal
  const recovery = Math.min(grossOas, 0.15 * positive(recoveryIncome - 95_323))
  const netOas = grossOas - recovery
  const taxable = cpp + netOas + drawReal
  return { cpp, grossOas, recovery, recoveryIncome, netOas, taxable, tax: seniorTax(taxable) }
}

function fixture({ tfsa = 130.61, rrsp = 5_000, payment = 1_331, term = 2, inflation = 0, rrspReturn = 0,
  mixed = 0, retired: retirementSpending, benefits = false, partnerWage = 0, secondTfsa = 0 }: {
  tfsa?: number; rrsp?: number; payment?: number; term?: number; inflation?: number; rrspReturn?: number;
  mixed?: number; retired?: number; benefits?: boolean; partnerWage?: number; secondTfsa?: number;
} = {}) {
  const retired = retirementSpending ?? mixed
  // $12,000 of the self member's wages: no income tax, $505.75 CPP and $195.60 EI.
  // The partner's optional $500 wages incur only $8.15 EI.
  const working = (partnerWage ? 11_790.50 : 11_298.65) - payment
  const plan = retirementPlan({ tfsa, rrsp, rrspReturn, age: 64, inflation, spending: retired, strategy: 'tfsaFirst' })
  const self = plan.people[0]
  Object.assign(self, { retirementAge: 65, earnedIncome: known(12_000) })
  plan.people.push({ ...structuredClone(self), id: PARTNER, role: 'partner', ageInBaseYear: 63,
    earnedIncome: known(partnerWage), tfsaAvailableRoom: known(5_432) })
  Object.assign(plan.accounts.find(a => a.id === TFSA)!, { ownerId: PARTNER,
    taxableOwnerShares: { status: 'known', shares: { [PARTNER]: 1 } } })
  if (secondTfsa > 0) {
    plan.accounts.push({ ...structuredClone(plan.accounts[0]), id: SECOND_TFSA, ownerId: RETIREE, balance: secondTfsa,
      taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 1 } } })
    plan.annualHouseholdMortgageFundingEvidence = { authorized: true, purpose: 'household-held-mortgage-and-living',
      provenance: recorded, orderedAccounts: [{ accountId: SECOND_TFSA, ownerId: RETIREE }, { accountId: TFSA, ownerId: PARTNER }] }
  }
  plan.tfsaStatement![PARTNER] = { withdrawals: [], provenance: recorded }
  plan.taxProfile = { spouseSupported: known(false), pensionSplit: null }
  plan.lifeExpectancy = 70
  plan.budget = { kind: 'incomeBudget', workingSpending: working, retirementSpending: retired }
  plan.properties.push({ id: HOME, kind: 'principal', value: 400_000, acb: known(200_000), annualRent: known(0),
    appreciation: 0, annualHoldingCostChange: 0, sellAtAge: null, plannedPurchaseAge: null,
    plannedDownPayment: null, plannedMortgage: null, mortgageDebtId: DEBT,
    taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 0.25, [PARTNER]: 0.75 } },
    provenance: { value: recorded, acb: recorded, taxableOwnerShares: recorded } })
  plan.debts.push({ id: DEBT, propertyId: HOME, kind: 'mortgage', principal: payment * term,
    annualPayment: payment, yearsRemaining: term, provenance: recorded })
  plan.annualHouseholdMortgageRrspEvidence = { accountId: RRSP, ownerId: RETIREE, authorized: true,
    purpose: 'household-held-mortgage-and-living', priority: 'tfsa-before-rrsp',
    provenance: { origin: 'user', sourceYear: BASE_YEAR - 1 } }
  if (benefits) {
    Object.assign(self, { cppAnnualAt65: 12_000, oasAnnualAt65: 9_150 })
    plan.incomeSources.push(cppStart(RETIREE, 65, 12_000), {
      id: 'owner-oas', kind: 'oas', recipientId: RETIREE, startAge: 65, annualAmount: known(9_150), provenance: recorded,
    })
    plan.annualBenefitsEvidence = { [RETIREE]: householdBenefitExclusions(RETIREE), [PARTNER]: householdBenefitExclusions(PARTNER) }
    plan.annualHouseholdMortgageBenefitsEvidence = { authorized: true,
      purpose: 'household-held-mortgage-with-verified-public-benefits', provenance: recorded }
  }
  plan.legacyProjection = legacyRetirement({ currentAge: 64, fireAge: 65, lifeExpectancy: 69, inflation, retirementSpending: retired,
    strategy: 'tfsaFirst', balances: { tfsa: tfsa + secondTfsa, rrsp, nonReg: 0 },
    returns: { tfsa: 0, rrsp: rrspReturn, nonReg: 0 },
    cppAnnualAt65: benefits ? 12_000 : 0, oasAnnualAt65: benefits ? 9_150 : 0,
    partner: { currentAge: 63, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
    principalResidence: { value: 400_000, appreciation: 0, sellAtAge: null,
      mortgage: { balance: payment * term, annualPayment: payment, yearsRemaining: term } } })
  const evidence: WorkingSpendingEvidence = { workingSpending: known(working), transitionSpending: known(mixed),
    retirementSpending: known(retired), scheduledMortgagePaymentsExcluded: known(true) }
  return { plan, evidence }
}

function withoutRrspEvidence(plan: InputsV2) {
  const ordinary = structuredClone(plan)
  delete ordinary.annualHouseholdMortgageRrspEvidence
  return ordinary
}

function roundingFixture(lowBenefits = false) {
  const { plan, evidence } = fixture({ benefits: true, partnerWage: 500, tfsa: lowBenefits ? 90 : 1_500,
    secondTfsa: lowBenefits ? 80 : 500, rrsp: 60_000, payment: 9_261, term: 3,
    inflation: lowBenefits ? 0.02 : 0.125, mixed: lowBenefits ? 500 : 77_603.33359, retired: lowBenefits ? 9_000 : 80_000 })
  const self = plan.people.find(person => person.id === RETIREE)!
  const partner = plan.people.find(person => person.id === PARTNER)!
  Object.assign(self, { ageInBaseYear: 65, retirementAge: 66, earnedIncome: known(9_500),
    cppAnnualAt65: lowBenefits ? 5_420 : 80_000, oasAnnualAt65: lowBenefits ? 2_144 : 9_150 })
  self.cppAmountSource!.ageBasis = self.oasAmountSource!.ageBasis = 66
  plan.incomeSources = [cppStart(RETIREE, 66, self.cppAnnualAt65),
    { id: 'owner-oas', kind: 'oas', recipientId: RETIREE, startAge: 66, annualAmount: known(self.oasAnnualAt65), provenance: recorded }]
  if (lowBenefits) {
    partner.oasAnnualAt65 = 300
    partner.oasAmountSource!.ageBasis = 66
    plan.incomeSources.push({ id: 'partner-oas', kind: 'oas', recipientId: PARTNER,
      startAge: 66, annualAmount: known(300), provenance: recorded })
  }
  plan.annualHouseholdMortgageFundingEvidence!.orderedAccounts.reverse()
  plan.people.reverse()
  plan.accounts.reverse()
  // $9,500 wages pay $357 CPP and $154.85 EI. The other worker pays $8.15 EI.
  // The first fixed payment uses $9,261 of the $9,480 available before living.
  plan.budget = { kind: 'incomeBudget', workingSpending: 219, retirementSpending: lowBenefits ? 9_000 : 80_000 }
  evidence.workingSpending = known(219)
  plan.debts[0].principal = 25_220
  return { plan, evidence }
}

function replay(formula: AnnualSheetExplanation['formula']) {
  expect(formula?.length).toBeGreaterThan(0)
  return formula!.reduce((amount, term) => amount + (term.direction === 'subtract' ? -term.value : term.value), 0)
}

function sheetCell(sheet: AnnualSheetModel, year: number, ...path: string[]) {
  const id = canonicalSheetId('value', ...path)
  const row = sheet.rows.flatMap(parent => [parent, ...(parent.children ?? [])]).find(candidate => candidate.id === id)
  if (!row) throw new Error(`Missing annual sheet row ${id}`)
  const cell = row.cells![year]
  return { row, cell, explanation: cell.explanationRefs?.map(ref => sheet.resolveExplanation!(ref)!).find(detail => detail.formula?.length || detail.sources?.length) }
}

describe('FE-53 independent Ontario household mortgage RRSP cash', () => {
  it.each([
    { benefits: false, target: 40_000, recovery: 0, tax: 3_501.3845, secondTfsa: 0 },
    { benefits: true, target: 88_000, recovery: 2_074.05, tax: 23_732.46641, secondTfsa: 400 },
    { benefits: true, target: 155_000, recovery: 9_150, tax: 49_270.47376, secondTfsa: 0 },
  ])('prices an approximately $target real draw with benefits=$benefits', ({ benefits, target, tax, recovery, secondTfsa }) => {
    const cpi = 1.125
    const payment = 1_331
    const tfsa = 500
    const partnerCashReal = 491.85
    const expected = ownerQuote(target, benefits)
    const before = ownerQuote(0, benefits)
    expect(expected.tax).toBeCloseTo(tax, 7)
    expect(expected.recovery).toBeCloseTo(recovery, 7)
    const mixed = expected.taxable - tax + partnerCashReal + (tfsa + secondTfsa) - payment / cpi
    const { plan, evidence } = fixture({ tfsa, secondTfsa, rrsp: 250_000, benefits, mixed, partnerWage: 500, inflation: 0.125 })
    const original = structuredClone({ plan, evidence })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(coverage).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false })
    const [working, row] = coverage.rows
    const settle = row.householdWithdrawalSettlement!
    const receipt = settle.rrspFunding!
    const gross = receipt.gross
    expect(working).toMatchObject({ cashLedger: { debtPayments: payment, tax: 0 },
      byAccount: { [RRSP]: { opening: 250_000, withdrawal: 0, closing: 281_250 } } })
    expect(working.householdWithdrawalSettlement!.rrspFunding).toBeUndefined()
    expect(row).toMatchObject({ year: MIXED, payrollContributions: close(8.15 * cpi),
      byAccount: { [RRSP]: { ownerId: RETIREE, opening: 281_250, contribution: 0, withdrawal: gross },
        [TFSA]: { ownerId: PARTNER, opening: tfsa * cpi, withdrawal: tfsa * cpi, closing: 0 } },
      byDebt: { [DEBT]: { propertyId: HOME, opening: payment, principal: payment, payment, interest: 0, closing: 0 } },
      cashLedger: { income: (expected.cpp + 500) * cpi, benefits: close(expected.netOas * cpi),
        tax: close(tax * cpi), debtPayments: payment, spending: close(mixed * cpi), unallocated: 0 },
      byPerson: { [RETIREE]: { earnedIncome: 0, taxableIncome: close(expected.taxable * cpi), tax: close(tax * cpi) },
        [PARTNER]: { earnedIncome: 500 * cpi, taxableIncome: 500 * cpi, tax: 0 } },
      taxLedger: { [RETIREE]: { taxableIncome: close(expected.taxable * cpi), tax: close(tax * cpi) },
        [PARTNER]: { taxableIncome: 500 * cpi, tax: 0 } },
    })
    expect(receipt).toMatchObject({ authorization: plan.annualHouseholdMortgageRrspEvidence,
      accountId: RRSP, ownerId: RETIREE, gross: close(target * cpi),
      netCash: close((target - (tax - before.tax) - recovery) * cpi),
      taxIncrement: close((tax - before.tax) * cpi), oasRecoveryIncrement: close(recovery * cpi),
      search: 'bounded-adjacent-funded-quote' })
    expect(settle).toMatchObject({ spendingDue: close(mixed * cpi), spendingFunded: close(mixed * cpi),
      spendingUnmet: 0, taxTotal: close(tax * cpi), taxIncrement: close((tax - before.tax) * cpi),
      postings: [...(secondTfsa ? [{ accountId: SECOND_TFSA, ownerId: RETIREE, kind: 'tfsa', amount: secondTfsa * cpi }] : []),
        { accountId: TFSA, ownerId: PARTNER, kind: 'tfsa', amount: tfsa * cpi },
        { accountId: RRSP, ownerId: RETIREE, kind: 'rrsp', amount: gross }] })
    if (benefits) {
      expect(row.byPerson[RETIREE]).toMatchObject({ cpp: expected.cpp * cpi, oasGross: expected.grossOas * cpi,
        oasRecovery: close(recovery * cpi), oasNet: close(expected.netOas * cpi) })
      expect(row.workingSettlement).toMatchObject({ household: { byPerson: {
        [RETIREE]: { oas: { recoveryIncomeReal: close(expected.recoveryIncome), recoveryReal: close(recovery) } },
      } } })
    }
    const exact = receipt.arithmetic
    const finalTax = decimal(row.byPerson[RETIREE].tax) + decimal(row.byPerson[PARTNER].tax)
    const finalOas = benefits ? decimal(row.byPerson[RETIREE].benefits) : 0n
    const beforeOas = multiply(before.netOas, cpi)
    expect(decimal(exact.gross)).toBe(decimal(gross))
    expect(decimal(exact.taxIncrement)).toBe(finalTax - decimal(before.tax * cpi))
    expect(decimal(exact.oasRecoveryIncrement)).toBe(beforeOas - finalOas)
    expect(decimal(exact.netCash)).toBe(decimal(gross) - decimal(exact.taxIncrement) - decimal(exact.oasRecoveryIncrement))
    const cashAfterDraw = multiply(expected.cpp + 500 - 8.15 + tfsa + secondTfsa, cpi) + decimal(gross) + finalOas - finalTax
    expect(decimal(exact.availableAfterDraw)).toBe(cashAfterDraw)
    expect(cashAfterDraw).toBeGreaterThanOrEqual(decimal(payment) + multiply(mixed, cpi))
    const proof = receipt.cashProof!
    expect(decimal(proof.debtDue)).toBe(decimal(payment))
    expect(decimal(proof.afterDebt)).toBe(cashAfterDraw - decimal(payment))
    expect(decimal(proof.livingDue)).toBe(multiply(mixed, cpi))
    expect(decimal(proof.livingFunded)).toBe(decimal(proof.livingDue))
    expect(decimal(proof.livingUnmet)).toBe(0n)
    expect(decimal(proof.residual)).toBe(decimal(proof.afterDebt) - decimal(proof.livingFunded))
    expect(decimal(row.byAccount[RRSP].mortgageExactWithdrawal!)).toBe(decimal(gross))
    expect(decimal(coverage.state.mortgageExactBalances![RRSP])).toBe(multiply(281_250, cpi) - multiply(gross, cpi))
    expect(coverage.state.byAccount[RRSP]).toMatchObject({ kind: 'rrsp', ownerId: RETIREE,
      balance: close((281_250 - gross) * cpi) })
    expect(coverage.state.benefitIncomeLag[RETIREE]).toEqual(known(close((target + expected.cpp) * cpi)))
    expect(coverage.state.contributionHistory).toEqual([])
    expect({ plan, evidence }).toStrictEqual(original)
  })
})

describe('recorded scope and atomic refusal', () => {
  it.each([
    ['no consent', { authorized: false }],
    ['wrong purpose', { purpose: 'liquidate-retirement-assets' }],
    ['wrong priority', { priority: 'rrsp-before-tfsa' }],
    ['wrong owner', { ownerId: PARTNER }],
    ['wrong account', { accountId: TFSA }],
    ['future provenance', { provenance: { origin: 'user', sourceYear: BASE_YEAR + 1 } }],
    ['legacy provenance', { provenance: { origin: 'legacy', sourceYear: BASE_YEAR } }],
    ['fractional year', { provenance: { origin: 'user', sourceYear: BASE_YEAR - 0.5 } }],
    ['unrecorded year', { provenance: { origin: 'user' } }],
  ])('refuses %s before any generated settlement', (_label, changes) => {
    const { plan, evidence } = fixture()
    Object.assign(plan.annualHouseholdMortgageRrspEvidence!, changes)
    const opening = ok(initializeState(plan))
    expect(ok(projectCanonicalCoverage(plan, evidence, 3))).toMatchObject({
      rows: [], state: opening, uncomputedYears: [MIXED, RETIRED], blocked: { year: BASE_YEAR, status: 'unsupported',
        issues: [{ detail: expect.stringMatching(/^household mortgage RRSP requires dated explicit sole-owner account authorization/) }] },
    })
  })

  it('rejects null and inherited authorization fields', () => {
    for (const inherited of [false, true]) {
      const { plan, evidence } = fixture()
      const malformed = inherited ? Object.create(plan.annualHouseholdMortgageRrspEvidence!) : null
      Object.assign(plan, { annualHouseholdMortgageRrspEvidence: malformed })
      expect(ok(projectCanonicalCoverage(plan, evidence, 2))).toMatchObject({ rows: [], state: ok(initializeState(plan)),
        blocked: { year: BASE_YEAR, status: 'unsupported', issues: [{ detail: expect.stringMatching(/^household mortgage RRSP/) }] } })
    }
  })

  it('refuses another funded RRSP, shared taxable title and a non-owner contribution', () => {
    const second = fixture()
    const registered = second.plan.accounts.find(a => a.id === RRSP)!
    second.plan.accounts.push({ ...structuredClone(registered), id: 'partner-rrsp', ownerId: PARTNER, balance: 1,
      taxableOwnerShares: { status: 'known', shares: { [PARTNER]: 1 } } })
    const shared = fixture()
    shared.plan.accounts.find(a => a.id === RRSP)!.taxableOwnerShares = { status: 'known', shares: { [RETIREE]: 0.75, [PARTNER]: 0.25 } }
    const contributed = fixture()
    contributed.plan.contributions.push({ id: 'partner-premium', accountId: RRSP, contributorId: PARTNER,
      calendarYear: BASE_YEAR, amount: 100, deductionYear: BASE_YEAR, provenance: recorded })
    for (const [{ plan, evidence }, detail] of [
      [second, /^household mortgage RRSP/], [shared, /^household mortgage RRSP/], [contributed, /registered contributions and deductions/],
    ] as const) {
      expect(ok(projectCanonicalCoverage(plan, evidence, 2))).toMatchObject({ rows: [],
        blocked: { year: BASE_YEAR, status: 'unsupported', issues: [{ detail: expect.stringMatching(detail) }] } })
    }
  })

  it('stops when the still-working owner is reached, even after a tentative TFSA debit', () => {
    const { plan, evidence } = fixture()
    const account = plan.accounts.find(a => a.id === RRSP)!
    account.ownerId = PARTNER
    account.taxableOwnerShares = { status: 'known', shares: { [PARTNER]: 1 } }
    plan.annualHouseholdMortgageRrspEvidence!.ownerId = PARTNER
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    expect(ok(projectCanonicalCoverage(plan, evidence, 3))).toMatchObject({ rows: prefix.rows, state: prefix.state,
      blocked: { year: MIXED, status: 'unsupported', issues: [{ detail: expect.stringMatching(/RRSP owner must be retired/) }] },
      uncomputedYears: [RETIRED] })
  })

  it('keeps the mortgage, benefit, and owner-statement gates independent of RRSP consent', () => {
    const old = fixture()
    const ordinary = withoutRrspEvidence(old.plan)
    expect(ok(projectCanonicalCoverage(ordinary, old.evidence, 2))).toMatchObject({ rows: [], state: ok(initializeState(ordinary)),
      blocked: { year: BASE_YEAR, status: 'unsupported', issues: [{ detail: expect.stringMatching(/ordinary single funded TFSA/) }] } })

    const composed = fixture({ benefits: true, mixed: 25_000 })
    const composedWithoutRrsp = withoutRrspEvidence(composed.plan)
    expect(ok(projectCanonicalCoverage(composedWithoutRrsp, composed.evidence, 2))).toMatchObject({ rows: [],
      blocked: { year: BASE_YEAR, status: 'unsupported', issues: [{ detail: expect.stringMatching(/verified claims/) }] } })
    delete composed.plan.annualHouseholdMortgageBenefitsEvidence
    expect(ok(projectCanonicalCoverage(composed.plan, composed.evidence, 2))).toMatchObject({ rows: [],
      blocked: { year: BASE_YEAR, status: 'unsupported', issues: [{ detail: expect.stringMatching(/explicit zero public benefits/) }] } })

    const noExclusion = { ...old.evidence, scheduledMortgagePaymentsExcluded: undefined }
    expect(ok(projectCanonicalCoverage(old.plan, noExclusion, 2))).toMatchObject({ rows: [],
      blocked: { year: BASE_YEAR, status: 'unsupported', issues: [{ detail: expect.stringMatching(/explicitly exclude scheduled payments/) }] } })
    const workingDeficit = structuredClone(old)
    const working = 9_968.65
    workingDeficit.plan.budget = { kind: 'incomeBudget', workingSpending: working, retirementSpending: 0 }
    workingDeficit.evidence.workingSpending = known(working)
    expect(ok(projectCanonicalCoverage(workingDeficit.plan, workingDeficit.evidence, 2))).toMatchObject({ rows: [],
      blocked: { year: BASE_YEAR, status: 'unsupported', issues: [{ detail: expect.stringMatching(/negative working cash/) }] } })

    const surplus = fixture({ benefits: true, mixed: 10_000 })
    const beforeSurplus = ok(projectCanonicalCoverage(surplus.plan, surplus.evidence, 1))
    expect(beforeSurplus.blocked).toBeNull()
    expect(ok(projectCanonicalCoverage(surplus.plan, surplus.evidence, 3))).toMatchObject({ rows: beforeSurplus.rows,
      state: beforeSurplus.state, blocked: { year: MIXED, status: 'unsupported',
        issues: [{ detail: expect.stringMatching(/positive household cash/) }] } })

    delete old.plan.tfsaStatement![PARTNER]
    const prefix = ok(projectCanonicalCoverage(old.plan, old.evidence, 1))
    expect(prefix.blocked).toBeNull()
    expect(ok(projectCanonicalCoverage(old.plan, old.evidence, 3))).toMatchObject({ rows: prefix.rows, state: prefix.state,
      blocked: { year: MIXED, status: 'unsupported', issues: [{ detail: 'TFSA withdrawal statement evidence missing' }] } })
  })

  it('stops only when a one-time expense with post-anchor provenance is reached', () => {
    const { plan, evidence } = fixture({ benefits: true, mixed: 25_000, retired: 25_000, rrsp: 20_000 })
    plan.annualHouseholdExpenseEvidence = { id: 'household-extra', effectiveYear: RETIRED, timing: 'after-mortgage-and-living',
      amountNominal: known(400), amountBasis: 'event-year-nominal-CAD', noncapital: true, nonDeductible: true,
      allowPartialPayment: true, excludesFromLivingBudget: true, useExistingFundingOrder: true,
      provenance: { ...recorded, sourceYear: BASE_YEAR + 1 } }
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows[1].householdWithdrawalSettlement!.rrspFunding!.gross).toBeGreaterThan(0)
    expect(ok(projectCanonicalCoverage(plan, evidence, 4))).toMatchObject({ rows: prefix.rows, state: prefix.state,
      blocked: { year: RETIRED, status: 'unsupported', causes: ['householdExpense'],
        issues: [{ detail: expect.stringMatching(/^household expense:/) }] },
      uncomputedYears: [RETIRED + 1] })
  })
})

describe('exact mortgage priority and ordinary account carry', () => {
  it('leaves an authorized RRSP dormant when TFSA funds debt and living, even with its owner still working', () => {
    const { plan, evidence } = fixture({ tfsa: 2_000, mixed: 300, retired: 200 })
    const registered = plan.accounts.find(a => a.id === RRSP)!
    registered.ownerId = PARTNER
    registered.taxableOwnerShares = { status: 'known', shares: { [PARTNER]: 1 } }
    plan.annualHouseholdMortgageRrspEvidence!.ownerId = PARTNER
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows.map(row => row.byAccount[RRSP].withdrawal)).toEqual([0, 0, 0])
    expect(coverage.rows.map(row => row.householdWithdrawalSettlement!.rrspFunding)).toEqual([undefined, undefined, undefined])
    expect(coverage.rows[1]).toMatchObject({ householdWithdrawalSettlement: { spendingFunded: 300, spendingUnmet: 0,
      postings: [{ accountId: TFSA, ownerId: PARTNER, amount: 1_631, kind: 'tfsa' }] } })
    expect(coverage.rows[2]).toMatchObject({ householdWithdrawalSettlement: { spendingFunded: 200, spendingUnmet: 0,
      postings: [{ accountId: TFSA, ownerId: PARTNER, amount: 200, kind: 'tfsa' }] },
    tfsaLedger: { [PARTNER]: { restored: known(1_631) }, [RETIREE]: { restored: known(0) } } })
    expect(coverage.state.byAccount[RRSP]).toMatchObject({ kind: 'rrsp', ownerId: PARTNER, balance: 5_000 })
  })

  it.each([1_200.38, adjacent(1_200.39, -1n), 1_200.39])('observes mandatory debt capacity at exactly $%s of RRSP', rrsp => {
    const { plan, evidence } = fixture({ rrsp })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    const original = structuredClone({ plan, evidence })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(prefix.blocked).toBeNull()
    if (rrsp < 1_200.39) {
      // The adjacent double rounds up when added to the TFSA as Numbers.
      if (rrsp > 1_200.38) expect(130.61 + rrsp).toBe(1_331)
      expect(coverage).toMatchObject({ rows: prefix.rows, state: prefix.state, uncomputedYears: [RETIRED],
        blocked: { year: MIXED, status: 'unsupported', issues: [{ detail: 'mortgage scheduled payment cannot be fully funded' }] } })
    } else {
      expect(coverage.blocked).toBeNull()
      expect(coverage.rows[1]).toMatchObject({ cashLedger: { debtPayments: 1_331, spending: 0, tax: 0, unallocated: 0 },
        byAccount: { [RRSP]: { opening: rrsp, withdrawal: rrsp, closing: 0 }, [TFSA]: { withdrawal: 130.61, closing: 0 } },
        householdWithdrawalSettlement: { rrspFunding: { gross: rrsp, netCash: rrsp, taxIncrement: 0,
          oasRecoveryIncrement: 0, search: 'bounded-adjacent-funded-quote' }, spendingUnmet: 0 } })
      expect(coverage.state.byDebt[DEBT]).toMatchObject({ principal: 0, yearsRemaining: 0 })
      expect(coverage.state.tfsaWithdrawalHistory).toEqual([
        { id: `annual:${MIXED}:withdrawal:${TFSA}`, personId: PARTNER, calendarYear: MIXED, amount: 130.61 },
      ])
      expect(coverage.rows[2].tfsaLedger).toMatchObject({ [PARTNER]: { restored: known(130.61) }, [RETIREE]: { restored: known(0) } })
      const funded = sheetCell(canonicalAnnualSheet(coverage, context), MIXED, 'retirement', 'spendingFunded')
      expect(funded.cell.value).toBe(0)
      expect(replay(funded.explanation?.formula)).toBe(0)
      expect(decimal(coverage.rows[1].householdWithdrawalSettlement!.rrspFunding!.cashProof!.residual)).toBe(0n)
    }
    expect({ plan, evidence }).toStrictEqual(original)
  })

  it.each([5_000, 10_000_000_000])('quotes sufficient tax-free cash before a $%s opening capacity', rrsp => {
    // A large endpoint cannot pass the sub-cent tax precision gate, but it
    // need never be priced to certify a local debit. The previous double fails.
    const living = 2e-13
    const { plan, evidence } = fixture({ rrsp, mixed: living, retired: 1_500 })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(coverage.blocked).toBeNull()
    const [, row, after] = coverage.rows
    const gross = adjacent(1_200.39, 1n)
    const receipt = row.householdWithdrawalSettlement!.rrspFunding!
    const due = decimal(1_331) + decimal(living)
    expect(decimal(130.61) + decimal(adjacent(gross, -1n))).toBeLessThan(due)
    expect(decimal(receipt.arithmetic.availableAfterDraw)).toBe(decimal(130.61) + decimal(gross))
    expect(decimal(receipt.arithmetic.availableAfterDraw)).toBeGreaterThanOrEqual(due)
    expect(decimal(receipt.cashProof!.residual)).toBe(decimal(130.61) + decimal(gross) - due)
    expect(row).toMatchObject({ cashLedger: { debtPayments: 1_331, spending: living },
      householdWithdrawalSettlement: { rrspFunding: { gross, netCash: gross, search: 'bounded-adjacent-funded-quote' } } })
    const funded = sheetCell(canonicalAnnualSheet(coverage, context), MIXED, 'retirement', 'spendingFunded')
    expect(funded.cell.value).toBe(living)
    expect(replay(funded.explanation?.formula)).toBe(living)
    expect(after).toMatchObject({ cashLedger: { debtPayments: 0, spending: 1_500, tax: 0 },
      byAccount: { [RRSP]: { opening: row.byAccount[RRSP].closing, ownerId: RETIREE, withdrawal: 1_500 } },
      householdWithdrawalSettlement: { postings: [{ accountId: RRSP, ownerId: RETIREE, kind: 'rrsp', amount: 1_500 }] } })
    expect(decimal(coverage.state.mortgageExactBalances![RRSP])).toBe(decimal(rrsp) - decimal(gross) - decimal(1_500))
    expect(coverage.state.byAccount[RRSP]).toMatchObject({ kind: 'rrsp', ownerId: RETIREE, room: known(0) })
    expect(coverage.state.byPerson[RETIREE].rrspUnusedUndeducted).toEqual(known(0))
    expect(coverage.state.contributionHistory).toEqual([])
  })

  it('exhausts an exactly quotable taxed RRSP, pays the installment, and posts only the remaining living cash', () => {
    const { plan, evidence } = fixture({ rrsp: 40_000, mixed: 50_000, retired: 10_000 })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(coverage.blocked).toBeNull()
    const [, row, after] = coverage.rows
    const tax = seniorTax(40_000)
    const funded = 130.61 + 40_000 - tax - 1_331
    expect(row).toMatchObject({ cashLedger: { tax: close(tax), debtPayments: 1_331, spending: close(funded), unallocated: 0 },
      byAccount: { [RRSP]: { opening: 40_000, withdrawal: 40_000, closing: 0 }, [TFSA]: { withdrawal: 130.61, closing: 0 } },
      householdWithdrawalSettlement: { spendingDue: 50_000, spendingFunded: close(funded), spendingUnmet: close(50_000 - funded),
        rrspFunding: { gross: 40_000, netCash: close(40_000 - tax), taxIncrement: close(tax), search: 'capacity-exhausted' } } })
    expect(row.householdWithdrawalSettlement!.rrspFunding).not.toHaveProperty('adjacentRecovery')
    expect(after).toMatchObject({ cashLedger: { debtPayments: 0, tax: 0, spending: 0 },
      householdWithdrawalSettlement: { postings: [], spendingDue: 10_000, spendingUnmet: 10_000 },
      byAccount: { [RRSP]: { withdrawal: 0, closing: 0 } } })
    expect(after.householdWithdrawalSettlement!.rrspFunding).toBeUndefined()
  })

  it('preserves unrepresentable opening carry and refuses to call a rounded capacity exhausted', () => {
    const rrsp = adjacent(1_200.39, 1n)
    const rrspReturn = 0.125
    const short = fixture({ rrsp, rrspReturn, mixed: 300 })
    const prefix = ok(projectCanonicalCoverage(short.plan, short.evidence, 1))
    expect(prefix.blocked).toBeNull()
    const exactOpening = multiply(rrsp, '1.125')
    expect(decimal(prefix.state.mortgageExactBalances![RRSP])).toBe(exactOpening)
    expect(decimal(prefix.state.byAccount[RRSP].balance)).not.toBe(exactOpening)
    const blocked = ok(projectCanonicalCoverage(short.plan, short.evidence, 3))
    expect(blocked).toMatchObject({ rows: prefix.rows, state: prefix.state, uncomputedYears: [RETIRED], blocked: {
      year: MIXED, status: 'unsupported', issues: [{ detail: expect.stringMatching(/^household mortgage RRSP exhaustion cannot be proved/) }],
    } })
    const early = fixture({ rrsp, rrspReturn })
    const settled = ok(projectCanonicalCoverage(early.plan, early.evidence, 2))
    expect(settled.blocked).toBeNull()
    expect(settled.rows[1].byAccount[RRSP].withdrawal).toBe(1_200.39)
    expect(decimal(settled.state.mortgageExactBalances![RRSP])).toBe(multiply(rrsp, '1.265625') - multiply(1_200.39, '1.125'))
  })
})

describe('localized cash formulas and neighboring projection paths', () => {
  it('proves the bounded quote across the witnessed nonmonotone tax and OAS rounding step', () => {
    const { plan, evidence } = roundingFixture()
    const mixed = 71_957.63358999998
    evidence.transitionSpending = known(mixed)
    const cpi = 1.125
    const debt = 9_261
    const due = decimal(debt) + multiply(mixed, cpi)
    const base = multiply(80_500, cpi) - multiply(8.15, cpi) + decimal(2_250)
    const claims = Object.fromEntries(plan.people.map(person => [person.id, annualHouseholdOas(plan, person, person.ageInBaseYear + 1)]))
    function quote(gross: number) {
      const priced = settleHouseholdOas(plan, MIXED, [
        { id: 'partner-wages', personId: PARTNER, kind: 'employment', amount: 500 },
        { id: 'partner-cpp', personId: PARTNER, kind: 'cpp', amount: 0 },
        { id: 'owner-cpp', personId: RETIREE, kind: 'cpp', amount: 80_000 },
        { id: 'owner-rrsp', accountId: RRSP, kind: 'rrspWithdrawal', amount: gross / cpi },
      ], { [PARTNER]: { taxDeduction: 0, creditAmount: 8.15, employmentAmount: 500 } }, claims)
      const tax = Object.values(priced.priced.byPerson).reduce((sum, person) => sum + decimal(person.tax * cpi), 0n)
      const oas = Object.values(priced.oas).reduce((sum, person) => sum + decimal(person.netReal * cpi), 0n)
      return base + decimal(gross) + oas - tax
    }

    const anchorGross = 11_249.999999999973
    const earlierGross = 11_249.999999999956
    const interveningGross = 11_249.999999999958
    expect(due).toBe(decimal('90213.3377887499775'))
    expect(quote(earlierGross)).toBe(decimal('90213.33778874998'))
    expect(quote(interveningGross)).toBe(decimal('90213.337788749964'))
    expect(quote(adjacent(anchorGross, -1n))).toBe(decimal('90213.337788749976'))
    expect(quote(anchorGross)).toBe(decimal('90213.337788749979'))

    // Enumerate only the contracted window. An immediate predecessor's result
    // cannot establish a property of all smaller representable candidates.
    const window = 64
    const candidates = Array.from({ length: window + 1 }, (_, i) => adjacent(anchorGross, BigInt(i - window)))
    const lowestFundedInWindow = candidates.find(gross => quote(gross) >= due)!
    expect(lowestFundedInWindow).toBe(11_249.999999999955)
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(coverage.blocked).toBeNull()
    const row = coverage.rows[1]
    const receipt = row.householdWithdrawalSettlement!.rrspFunding!
    expect(receipt).toMatchObject({ gross: lowestFundedInWindow, search: 'bounded-adjacent-funded-quote',
      adjacentRecovery: { anchorGross, window, candidatesChecked: window,
        immediatePredecessorFunded: quote(adjacent(lowestFundedInWindow, -1n)) >= due } })
    const available = quote(receipt.gross)
    expect(available).toBeGreaterThanOrEqual(due)
    expect(decimal(receipt.arithmetic.availableAfterDraw)).toBe(available)
    expect(decimal(receipt.cashProof!.livingUnmet)).toBe(0n)
    expect(decimal(receipt.cashProof!.residual)).toBe(available - due)
    expect(decimal(row.byAccount[RRSP].mortgageExactWithdrawal!)).toBe(decimal(receipt.gross))
    expect(row.byAccount[RRSP]).toMatchObject({ opening: 67_500, withdrawal: receipt.gross, ownerId: RETIREE })
    const grossMemo = sheetCell(canonicalAnnualSheet(coverage, context), MIXED, 'household', 'mortgageRrspGross')
    for (const [locale, localBound, globalLimit] of [
      ['en', /up to 64 immediately lower/i, /not a globally least/i],
      ['fr', /jusqu’à 64.*immédiatement inférieurs/i, /aucun minimum global/i],
      ['zh', /至多 64 个相邻正浮点数/, /不保证全局最小/],
    ] as const) {
      const disclosure = annualSheetText(grossMemo.explanation!.summary!, locale)
      expect(disclosure).toMatch(localBound)
      expect(disclosure).toMatch(globalLimit)
    }
  })

  it('keeps the $2,250 ordered TFSA memo and $22,500 RRSP gross proofs separate in all three locales', () => {
    const { plan, evidence } = roundingFixture()
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(coverage.blocked).toBeNull()
    const row = coverage.rows[1]
    const gross = row.householdWithdrawalSettlement!.rrspFunding!.gross
    expect(gross).toBeCloseTo(22_500, 2)
    expect(row.householdWithdrawalSettlement!.postings).toEqual([
      { accountId: TFSA, ownerId: PARTNER, kind: 'tfsa', amount: 1_687.50 },
      { accountId: SECOND_TFSA, ownerId: RETIREE, kind: 'tfsa', amount: 562.50 },
      { accountId: RRSP, ownerId: RETIREE, kind: 'rrsp', amount: gross },
    ])
    const sheet = canonicalAnnualSheet(coverage, context)
    const tfsa = sheetCell(sheet, MIXED, 'household', 'withdrawalPosting')
    const rrsp = sheetCell(sheet, MIXED, 'household', 'mortgageRrspGross')
    const tfsaFormula = tfsa.explanation!.formula!
    const tfsaSources = tfsa.explanation!.sources!.filter(source => source.field === 'household.withdrawalPosting' && source.displayReference)
    const rrspSources = rrsp.explanation!.sources!.filter(source => source.field === 'householdWithdrawalSettlement.rrspFunding.gross')
    expect(tfsaFormula.map(term => [term.direction, term.value])).toEqual([['add', 1_687.50], ['add', 562.50]])
    expect(tfsa.cell.value).toBe(2_250)
    expect(replay(tfsaFormula)).toBe(2_250)
    expect(rrsp.cell.value).toBe(gross)
    expect(replay(rrsp.explanation!.formula)).toBe(gross)
    expect(tfsaSources).toHaveLength(2)
    expect(rrspSources).toEqual([expect.objectContaining({ id: RRSP })])
    for (const [locale, tfsaName, rrspName, first, second] of [
      ['en', /TFSA debits/i, /RRSP gross/i, /Order 1\b/, /Order 2\b/],
      ['fr', /Débits CELI/i, /REER brut/i, /Ordre 1\b/, /Ordre 2\b/],
      ['zh', /TFSA 扣款/, /RRSP 毛额/, /顺序 1/, /顺序 2/],
    ] as const) {
      expect(annualSheetText(tfsa.row.label, locale)).toMatch(tfsaName)
      expect(annualSheetText(rrsp.row.label, locale)).toMatch(rrspName)
      for (const [index, order] of [first, second].entries()) {
        expect(annualSheetText(tfsaFormula[index].label, locale)).toMatch(order)
        expect(annualSheetText(tfsaSources[index].label, locale)).toMatch(order)
        expect(annualSheetText(tfsaSources[index].displayReference!, locale)).toContain(String(tfsaFormula[index].value))
      }
      const rrspReference = annualSheetText(rrspSources[0].displayReference!, locale)
      expect(rrspReference).toContain(RRSP)
      expect(rrspReference).toContain(String(gross))
    }
  })

  it('describes posted OAS amounts in every locale and preserves the original exact CPI explanation', () => {
    const { plan, evidence } = roundingFixture(true)
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    const row = coverage.rows[3]
    const proof = row.householdWithdrawalSettlement!.publicBenefitsCash!
    expect(coverage.blocked).toBeNull()
    expect(row.householdWithdrawalSettlement!.rrspFunding!.oasRecoveryIncrement).toBe(0)
    expect(proof.basis).toBe('quoted-CPP-times-start-CPI-and-posted-tax-net-OAS-atoms')
    expect(decimal(proof.startCpi)).toBe(decimal('1.0612080000000002'))
    expect(decimal(proof.oasNet)).toBe(decimal('2593.59235200000004'))
    const old = withoutRrspEvidence(plan)
    old.accounts.find(account => account.id === RRSP)!.balance = 0
    old.accounts.find(account => account.id === TFSA)!.balance = 30_000
    const oldCoverage = ok(projectCanonicalCoverage(old, evidence, 4))
    expect(oldCoverage.blocked).toBeNull()
    const oldProof = oldCoverage.rows[3].householdWithdrawalSettlement!.publicBenefitsCash!
    expect(oldProof.basis).toBe('anchor-real-quote-times-serialized-start-CPI')
    const sheet = canonicalAnnualSheet(coverage, context)
    const oldSheet = canonicalAnnualSheet(oldCoverage, context)
    for (const [id, real, posted, exact] of [
      [RETIREE, 2_144, 2_275.229952, '2275.2299520000004288'],
      [PARTNER, 300, 318.36240000000004, '318.36240000000006'],
    ] as const) {
      expect(row.byPerson[id].oasNet).toBe(posted)
      expect(decimal(proof.byPerson[id].oasNet)).toBe(decimal(posted))
      expect(multiply(real, '1.0612080000000002')).toBe(decimal(exact))
      expect(decimal(oldProof.byPerson[id].oasNet)).toBe(decimal(exact))
      const detail = sheetCell(sheet, row.year, 'person', id, 'mortgageOasNetCash')
      const oldDetail = sheetCell(oldSheet, row.year, 'person', id, 'mortgageOasNetCash')
      const source = (explanation: AnnualSheetExplanation) => explanation.sources!.find(item => item.field?.endsWith('.oasNet'))!
      expect(detail.cell.value).toBe(posted)
      for (const [locale, postedWord, exactWord] of [
        ['en', /posted.*nominal|nominal.*posted/i, /Exact anchor-real/i],
        ['fr', /comptabilis|inscrit/i, /Réel de référence exact/i],
        ['zh', /入账/, /精确基准实际金额/],
      ] as const) {
        const reference = annualSheetText(source(detail.explanation!).displayReference!, locale)
        expect(reference).toMatch(postedWord)
        expect(reference).toContain(String(posted))
        expect(reference).not.toMatch(/×[^=]*=/)
        const original = annualSheetText(source(oldDetail.explanation!).displayReference!, locale)
        expect(original).toMatch(exactWord)
        expect(original).toMatch(/×[^=]*=/)
        expect(original).toContain(exact)
      }
    }
  })

  it('replays the incremental cash formula with dated owner proof in English, French and Chinese', () => {
    const { plan, evidence } = fixture({ benefits: true, tfsa: 500, rrsp: 150_000, mixed: 100_000, inflation: 0.125 })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(coverage.blocked).toBeNull()
    const sheet = canonicalAnnualSheet(coverage, context)
    const row = coverage.rows[1]
    const receipt = row.householdWithdrawalSettlement!.rrspFunding!
    expect(receipt.taxIncrement).toBeGreaterThan(0)
    expect(receipt.oasRecoveryIncrement).toBeGreaterThan(0)
    const auth = sheetCell(sheet, MIXED, 'household', 'mortgageRrspAuthorization')
    const net = sheetCell(sheet, MIXED, 'household', 'mortgageRrspNetCash')
    const withdrawal = sheetCell(sheet, MIXED, 'account', RRSP, 'withdrawal')
    const funded = sheetCell(sheet, MIXED, 'retirement', 'spendingFunded')
    expect(withdrawal.cell.value).toBe(receipt.gross)
    expect(auth.cell).toMatchObject({ value: 1, unit: 'number' })
    expect(auth.explanation!.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: RETIREE, field: 'annualHouseholdMortgageRrspEvidence.ownerId' }),
      expect.objectContaining({ id: RRSP, field: 'annualHouseholdMortgageRrspEvidence' }),
    ]))
    const proof = auth.explanation!.sources!.find(source => source.id === RRSP)!
    expect(net.explanation!.formula).toMatchObject([
      { direction: 'add', value: receipt.gross, unit: 'CAD', basis: 'nominal-CAD' },
      { direction: 'subtract', value: receipt.taxIncrement, unit: 'CAD', basis: 'nominal-CAD' },
      { direction: 'subtract', value: receipt.oasRecoveryIncrement, unit: 'CAD', basis: 'nominal-CAD' },
    ])
    expect(replay(net.explanation!.formula)).toBeCloseTo(receipt.netCash, 7)
    expect(replay(funded.explanation?.formula)).toBe(row.cashLedger.spending)
    expect(funded.explanation!.formula!.filter(term => /rrspFunding\.(netCash|taxIncrement|oasRecoveryIncrement)$/.test(term.field ?? ''))).toEqual([])
    for (const [key, value] of [['Gross', receipt.gross], ['NetCash', receipt.netCash],
      ['TaxIncrement', receipt.taxIncrement], ['OasRecoveryIncrement', receipt.oasRecoveryIncrement]] as const) {
      const detail = sheetCell(sheet, MIXED, 'household', `mortgageRrsp${key}`)
      expect(detail.cell).toMatchObject({ value, basis: 'nominal-CAD', timing: 'during-year' })
      expect(annualSheetDisplayValue(detail.cell, sheet.years[1], 'real')).toBeCloseTo(value / 1.125, 7)
    }
    for (const [language, scope, gross, tax, recovery, source] of [
      ['en', /TFSA funding first.*owner to be retired/i, /RRSP gross/i, /incremental household tax/i, /incremental OAS recovery/i, /TFSA first/i],
      ['fr', /CELI autorisés en premier.*titulaire soit retraité/i, /REER brut/i, /impôt supplémentaire du ménage/i, /récupération SV supplémentaire/i, /CELI en premier/i],
      ['zh', /先实际使用已授权 TFSA.*已退休持有人/, /RRSP 毛额/, /家庭增量税额/, /增量 OAS 追回/, /TFSA 优先/],
    ] as const) {
      expect(annualSheetText(sheet.scope, language)).toMatch(scope)
      for (const [index, pattern] of [gross, tax, recovery].entries()) {
        expect(annualSheetText(net.explanation!.formula![index].label, language)).toMatch(pattern)
      }
      expect(annualSheetText(proof.label, language)).toMatch(source)
      expect(annualSheetText(proof.displayReference!, language)).toContain(String(BASE_YEAR - 1))
    }
  })

  it.each([false, true])('preserves old mortgage output with benefits=%s and no RRSP opt-in', benefits => {
    const { plan, evidence } = fixture({ rrsp: 0, tfsa: 30_000, benefits, mixed: benefits ? 22_000 : 500 })
    const old = withoutRrspEvidence(plan)
    const coverage = ok(projectCanonicalCoverage(old, evidence, 3))
    expect(coverage.blocked).toBeNull()
    const row = coverage.rows[1]
    const ordinaryIncome = benefits ? 12_000 : 0
    const ordinaryBenefits = benefits ? 9_150 : 0
    expect(row).toMatchObject({ cashLedger: { debtPayments: 1_331, income: ordinaryIncome, benefits: ordinaryBenefits,
      spending: benefits ? 22_000 : 500, tax: benefits ? close(seniorTax(21_150)) : 0 }, byAccount: { [RRSP]: { withdrawal: 0, closing: 0 } } })
    expect(row.householdWithdrawalSettlement!.rrspFunding).toBeUndefined()
    const sheet = canonicalAnnualSheet(coverage, context)
    expect(sheet.rows.flatMap(parent => parent.children?.map(child => child.id) ?? []).some(id => id.includes('mortgageRrsp'))).toBe(false)
  })

  it('keeps the ordinary no-debt owner-withdrawal path and solo held mortgage semantics', () => {
    const { plan, evidence } = fixture({ mixed: 500, retired: 500 })
    const ordinary = withoutRrspEvidence(plan)
    ordinary.debts = []
    ordinary.properties[0].mortgageDebtId = null
    ordinary.budget = { kind: 'incomeBudget', workingSpending: 11_298.65, retirementSpending: 500 }
    const ordinaryEvidence = { ...evidence, workingSpending: known(11_298.65) }
    const noDebt = ok(projectCanonicalCoverage(ordinary, ordinaryEvidence, 2))
    expect(noDebt.blocked).toBeNull()
    expect(noDebt.rows[1]).toMatchObject({ cashLedger: { debtPayments: 0, spending: 500, tax: 0 },
      householdWithdrawalSettlement: { postings: [
        { accountId: TFSA, ownerId: PARTNER, amount: 130.61, kind: 'tfsa' },
        { accountId: RRSP, ownerId: RETIREE, amount: close(369.39), kind: 'rrsp' },
      ] } })
    expect(noDebt.rows[1].householdWithdrawalSettlement!.rrspFunding).toBeUndefined()

    plan.people.pop()
    delete plan.tfsaStatement![PARTNER]
    delete plan.legacyProjection.partner
    plan.accounts[0].ownerId = RETIREE
    plan.accounts[0].taxableOwnerShares = { status: 'known', shares: { [RETIREE]: 1 } }
    plan.properties[0].taxableOwnerShares = { status: 'known', shares: { [RETIREE]: 1 } }
    const solo = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(solo).toStrictEqual(ok(projectCanonicalCoverage(withoutRrspEvidence(plan), evidence, 2)))
    expect(solo.blocked).toBeNull()
    expect(solo.rows[1]).toMatchObject({ cashLedger: { debtPayments: 1_331, spending: 500 },
      byAccount: { [RRSP]: { withdrawal: 1_700.39 } } })
  })

  it('leaves external, standalone and legacy/S1 entry points on their existing contracts', () => {
    const { plan, evidence } = fixture({ rrsp: 30_000, mixed: 24_000, retired: 24_000, benefits: true })
    const old = withoutRrspEvidence(plan)
    const opening = ok(initializeState(plan))
    expect(evaluateCanonicalHouseholdWorkingYear(plan, evidence, BASE_YEAR))
      .toStrictEqual(evaluateCanonicalHouseholdWorkingYear(old, evidence, BASE_YEAR))
    const generated = ok(projectCanonicalCoverage(plan, evidence, 2)).state
    const providers: AnnualProviders = { returns: () => 0, evaluate: () => ({ byPerson: Object.fromEntries(plan.people.map(person => [person.id, {
      income: person.role === 'self' ? 1_331 : 0, earnedIncome: 0, tax: 0, benefits: 0, spending: 0,
      taxableIncome: 0, benefitIncomeForNextYear: known(0),
    }])) }) }
    expect(annualRetirementContinuation(plan, generated, evidence)).toMatchObject({ status: 'invalid' })
    expect(annualStep(plan, generated, providers)).toMatchObject({ status: 'invalid' })

    const providerPlan = { ...plan, budget: { kind: 'savingsBudget' as const, annualNetSavings: 0, retirementSpending: 0,
      debtIncluded: known(true), taxBenefitIncluded: known(true) } }
    const providerOld = withoutRrspEvidence(providerPlan)
    const before = structuredClone(opening)
    expect(annualRetirementStep(providerPlan, opening)).toStrictEqual(annualRetirementStep(providerOld, opening))
    expect(annualStep(providerPlan, opening, providers)).toStrictEqual(annualStep(providerOld, opening, providers))
    expect(projectFromState(providerPlan, opening, 1, providers)).toStrictEqual(projectFromState(providerOld, opening, 1, providers))
    const providerCoverage = ok(projectAnnualCoverage(providerPlan, opening, 2, providers))
    expect(providerCoverage).toStrictEqual(ok(projectAnnualCoverage(providerOld, opening, 2, providers)))
    expect(providerCoverage.rows[0]).toMatchObject({ cashLedger: { benefits: 0, debtPayments: 1_331 } })
    expect(opening).toStrictEqual(before)

    const inputs = plan.legacyProjection
    for (const sample of [undefined, () => -0.04]) {
      const baseline = runProjection(inputs, sample, old, { captureAnnualDetails: true })
      const actual = runProjection(inputs, sample, plan, { captureAnnualDetails: true })
      expect(actual).toStrictEqual(baseline)
      expect(actual.rows.length).toBeGreaterThan(2)
      const visible = legacyAnnualSheet(actual, inputs, context)
      const baselineSheet = legacyAnnualSheet(baseline, inputs, context)
      expect(visible.rows).toStrictEqual(baselineSheet.rows)
      expect(visible.years).toStrictEqual(baselineSheet.years)
    }
  })
})
