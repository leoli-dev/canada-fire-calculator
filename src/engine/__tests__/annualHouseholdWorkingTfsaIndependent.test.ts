import { describe, expect, it } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetModel, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { annualRetirementContinuation, annualRetirementStep } from '../annualRetirement'
import {
  annualStep, initializeState, projectAnnualCoverage, projectCanonicalCoverage, projectFromState,
  type AnnualProviders, type KernelResult,
} from '../annualState'
import { evaluateCanonicalHouseholdWorkingYear, type WorkingSpendingEvidence } from '../annualWorking'
import type { InputsV2 } from '../model'
import { runProjection } from '../projection'
import { householdBenefitExclusions } from './fixtures/annualHouseholdOas'
import { BASE_YEAR, known, recorded, retirementPlan, RETIREE, TFSA } from './fixtures/retirementSettlement'

const PARTNER = 'wage-partner'
const PARTNER_TFSA = 'partner-registered'
const HOME = 'held-home'
const DEBT = 'fixed-mortgage'
const MIXED_YEAR = BASE_YEAR + 1
const RETIRED_YEAR = BASE_YEAR + 2
const context = { scenarioId: 'working-household-tfsa-independent', revision: 1 }
const sourceYear = BASE_YEAR - 1
type OptIn = NonNullable<InputsV2['annualHouseholdWorkingTfsaEvidence']>

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function fixture({
  working = 1_851.10, selfWage = 2_500, partnerWage = 500, inflation = 0,
  selfRoom = 25.04, partnerRoom = 1_234.56, selfBalance = 650, partnerBalance = 1_450,
  payment = 1_000, principal = 3_000, bothWorkingNext = false,
} = {}) {
  const plan = retirementPlan({ age: 42, tfsa: selfBalance, rrsp: 0, inflation, spending: 300, strategy: 'tfsaFirst' })
  const self = plan.people[0]
  Object.assign(self, { retirementAge: bothWorkingNext ? 44 : 43, earnedIncome: known(selfWage), tfsaAvailableRoom: known(selfRoom) })
  plan.people.push({ ...structuredClone(self), id: PARTNER, role: 'partner', ageInBaseYear: 41,
    retirementAge: 43, earnedIncome: known(partnerWage), tfsaAvailableRoom: known(partnerRoom) })
  plan.accounts = [plan.accounts[0], { ...structuredClone(plan.accounts[0]), id: PARTNER_TFSA,
    ownerId: PARTNER, balance: partnerBalance, taxableOwnerShares: { status: 'known', shares: { [PARTNER]: 1 } } }]
  plan.tfsaStatement![PARTNER] = { withdrawals: [], provenance: recorded }
  plan.taxProfile = { spouseSupported: known(false), pensionSplit: null }
  plan.lifeExpectancy = 63
  plan.budget = { kind: 'incomeBudget', workingSpending: working, retirementSpending: 300 }
  plan.properties.push({ id: HOME, kind: 'principal', value: 480_000, acb: known(240_000), annualRent: known(0),
    appreciation: 0, annualHoldingCostChange: 0, sellAtAge: null, plannedPurchaseAge: null,
    plannedDownPayment: null, plannedMortgage: null, mortgageDebtId: DEBT,
    taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 0.25, [PARTNER]: 0.75 } },
    provenance: { value: recorded, acb: recorded, taxableOwnerShares: recorded } })
  plan.debts.push({ id: DEBT, propertyId: HOME, kind: 'mortgage', principal,
    annualPayment: payment, yearsRemaining: 3, provenance: recorded })
  plan.annualHouseholdMortgageFundingEvidence = { authorized: true, purpose: 'household-held-mortgage-and-living',
    provenance: { origin: 'user', sourceYear },
    orderedAccounts: [{ accountId: TFSA, ownerId: RETIREE }, { accountId: PARTNER_TFSA, ownerId: PARTNER }] }
  const optIn: OptIn = { authorized: true, purpose: 'household-held-mortgage-working-tfsa', provenance: { origin: 'user', sourceYear },
    years: { [BASE_YEAR]: [{ accountId: TFSA, ownerId: RETIREE, amountNominal: 25.04 },
      { accountId: PARTNER_TFSA, ownerId: PARTNER, amountNominal: 74.96 }] } }
  plan.annualHouseholdWorkingTfsaEvidence = optIn
  plan.legacyProjection = { ...plan.legacyProjection, fireAge: 43, lifeExpectancy: 46,
    balances: { tfsa: selfBalance + partnerBalance, rrsp: 0, nonReg: 0 },
    partner: { currentAge: 41, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
    principalResidence: { value: 480_000, appreciation: 0, sellAtAge: null,
      mortgage: { balance: principal, annualPayment: payment, yearsRemaining: 3 } } }
  const evidence: WorkingSpendingEvidence = { workingSpending: known(working), transitionSpending: known(350),
    retirementSpending: known(300), scheduledMortgagePaymentsExcluded: known(true) }
  return { plan, evidence, optIn }
}

function withoutOptIn(plan: InputsV2) {
  const baseline = structuredClone(plan)
  delete baseline.annualHouseholdWorkingTfsaEvidence
  return baseline
}

function rowById(rows: AnnualSheetRow[], id: string): AnnualSheetRow | undefined {
  for (const row of rows) {
    if (row.id === id) return row
    const nested = row.children && rowById(row.children, id)
    if (nested) return nested
  }
}

function sheetCell(sheet: AnnualSheetModel, year: number, ...path: string[]) {
  const id = canonicalSheetId('value', ...path)
  const cell = rowById(sheet.rows, id)?.cells?.[year]
  if (!cell) throw new Error(`Missing annual sheet cell ${id}/${year}`)
  return { cell, details: cell.explanationRefs?.map(ref => sheet.resolveExplanation!(ref)!) ?? [] }
}

// Reconstruct the serialized decimal receipt on a common grid independently
// of the engine's decimal arithmetic. The fixture's atoms fit this precision.
function atom({ coefficient, scale }: { coefficient: string; scale: number }) {
  return BigInt(coefficient) * 10n ** BigInt(24 - scale)
}

describe('FE-53 exact household working mortgage TFSA contributions', () => {
  it('posts both owner credits once, then carries balances and restores actual later withdrawals', () => {
    const { plan, evidence, optIn } = fixture()
    const original = structuredClone({ plan, evidence })
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false })
    const [working, mixed, retired, following] = result.rows
    const receipt = working.householdWorkingTfsaSettlement!
    expect(receipt).toMatchObject({ contributions: optIn.years[BASE_YEAR], evidence: optIn })
    expect(receipt.evidence).not.toBe(optIn)
    const proof = receipt.arithmetic
    // $2,500 and $500 wages each fall below the $3,500 CPP exemption.
    // At 1.63% EI they yield $2,951.10, with zero tax for either person.
    // Living of $1,851.10 and the $1,000 fixed payment leave exactly $100.
    const expectedProof = { income: 300_000n, payroll: 4_890n, tax: 0n, living: 185_110n,
      debtPayments: 100_000n, surplus: 10_000n, allocated: 10_000n }
    for (const field of Object.keys(expectedProof) as (keyof typeof expectedProof)[]) {
      expect(atom(proof[field]), field).toBe(expectedProof[field] * 10n ** 22n)
    }
    expect(atom(proof.income) - atom(proof.payroll) - atom(proof.tax) - atom(proof.living)
      - atom(proof.debtPayments)).toBe(atom(proof.allocated))
    expect(working).toMatchObject({
      payrollContributions: expect.closeTo(48.90, 10),
      byPerson: { [RETIREE]: { earnedIncome: 2_500, taxableIncome: 2_500, tax: 0 },
        [PARTNER]: { earnedIncome: 500, taxableIncome: 500, tax: 0 } },
      byDebt: { [DEBT]: { opening: 3_000, principal: 1_000, interest: 0, payment: 1_000, closing: 2_000 } },
      cashLedger: { income: 3_000, tax: 0, benefits: 0, debtPayments: 1_000, spending: 1_851.10,
        fhsaContributions: 0, employeeContributions: 0, employerContributions: 0,
        voluntaryContributions: 100, retainedContributions: 0, unallocated: 0 },
      contributionLedger: { allocationCashBasis: 100, appliedTotal: 100, scheduledRrspBudgeted: 0,
        scheduledPlanned: 0, scheduledApplied: 0, scheduledRetained: 0, retained: [] },
      householdWithdrawalSettlement: { postings: [], withdrawal: 0, spendingUnmet: 0 },
    })

    const afterWorking = ok(projectCanonicalCoverage(plan, evidence, 1)).state
    const byAccount = [
      { accountId: TFSA, ownerId: RETIREE, amount: 25.04, opening: 650, closing: 675.04, room: 25.04, remaining: 0 },
      { accountId: PARTNER_TFSA, ownerId: PARTNER, amount: 74.96, opening: 1_450, closing: 1_524.96, room: 1_234.56, remaining: 1_159.60 },
    ]
    expect(working.contributionLedger.postings).toHaveLength(2)
    expect(afterWorking.contributionHistory).toHaveLength(2)
    expect(new Set(afterWorking.contributionHistory.map(line => line.id)).size).toBe(2)
    expect(afterWorking.tfsaWithdrawalHistory).toEqual([])
    for (const entry of byAccount) {
      const { accountId, ownerId, amount, opening, closing, room, remaining } = entry
      expect(working.byAccount[accountId]).toMatchObject({ ownerId, opening, closing, contribution: amount,
        withdrawal: 0, returnAmount: 0 })
      expect(working.contributionLedger.postings).toContainEqual(expect.objectContaining({ accountId, ownerId,
        contributorId: ownerId, amount }))
      expect(afterWorking.contributionHistory).toContainEqual({
        id: working.contributionLedger.postings.find(line => line.accountId === accountId)!.id,
        accountId, contributorId: ownerId, calendarYear: BASE_YEAR, amount, deductionYear: null,
      })
      expect(working.tfsaLedger[ownerId]).toMatchObject({ openingRoom: known(room), annualAddition: known(0),
        restored: known(0), planned: amount, applied: amount, retained: 0, closingRoom: known(remaining) })
      expect(working.tfsaLedger[ownerId].lines).toHaveLength(1)
      expect(afterWorking.byPerson[ownerId].tfsaRoom).toEqual(known(remaining))
      expect(afterWorking.byAccount[accountId].balance).toBe(closing)
    }

    // Mixed: $491.85 of wages after EI leaves a draw of $858.15.
    // The self TFSA exhausts at $675.04 and the partner covers $183.11.
    // Retired: the partner covers $1,300, leaving $41.85 after maturity.
    expect(mixed).toMatchObject({
      workingSettlement: { household: { phase: 'mixed' } },
      byAccount: { [TFSA]: { opening: 675.04, withdrawal: 675.04, closing: 0 },
        [PARTNER_TFSA]: { opening: 1_524.96, withdrawal: 183.11, closing: 1_341.85 } },
      householdWithdrawalSettlement: { withdrawal: 858.15, spendingFunded: 350, spendingUnmet: 0 },
      cashLedger: { income: 500, spending: 350, debtPayments: 1_000, unallocated: 0 },
      tfsaLedger: { [RETIREE]: { openingRoom: known(0), restored: known(0) },
        [PARTNER]: { openingRoom: known(1_159.60), restored: known(0) } },
    })
    expect(retired).toMatchObject({
      workingSettlement: { household: { phase: 'both-retired' } },
      byAccount: { [TFSA]: { opening: 0, withdrawal: 0, closing: 0 },
        [PARTNER_TFSA]: { opening: 1_341.85, withdrawal: 1_300, closing: 41.85 } },
      byDebt: { [DEBT]: { payment: 1_000, closing: 0 } },
      byPerson: { [RETIREE]: { earnedIncome: 0, tax: 0 }, [PARTNER]: { earnedIncome: 0, tax: 0 } },
      tfsaLedger: { [RETIREE]: { restored: known(675.04) }, [PARTNER]: { restored: known(183.11) } },
    })
    expect(following).toMatchObject({
      householdWithdrawalSettlement: { withdrawal: 41.85, spendingFunded: 41.85, spendingUnmet: 258.15 },
      tfsaLedger: { [RETIREE]: { restored: known(0) }, [PARTNER]: { restored: known(1_300) } },
    })
    for (const [index, row] of [mixed, retired, following].entries()) {
      expect(row.householdWorkingTfsaSettlement).toBeUndefined()
      expect(row.contributionLedger.postings).toEqual([])
      expect(row.cashLedger.voluntaryContributions).toBe(0)
      expect(row.tfsaLedger[RETIREE].closingRoom).toMatchObject({ status: 'unknown' })
      expect(row.tfsaLedger[PARTNER].closingRoom).toMatchObject({ status: 'unknown' })
      const prefix = ok(projectCanonicalCoverage(plan, evidence, index + 2))
      expect(prefix.rows).toStrictEqual(result.rows.slice(0, index + 2))
      expect(prefix.state.contributionHistory).toStrictEqual(afterWorking.contributionHistory)
    }
    expect(result.state.tfsaWithdrawalHistory).toStrictEqual([
      { id: `annual:${MIXED_YEAR}:withdrawal:${TFSA}`, personId: RETIREE, calendarYear: MIXED_YEAR, amount: 675.04 },
      { id: `annual:${MIXED_YEAR}:withdrawal:${PARTNER_TFSA}`, personId: PARTNER, calendarYear: MIXED_YEAR, amount: 183.11 },
      { id: `annual:${RETIRED_YEAR}:withdrawal:${PARTNER_TFSA}`, personId: PARTNER, calendarYear: RETIRED_YEAR, amount: 1_300 },
      { id: `annual:${RETIRED_YEAR + 1}:withdrawal:${PARTNER_TFSA}`, personId: PARTNER, calendarYear: RETIRED_YEAR + 1, amount: 41.85 },
    ])
    expect({ plan, evidence }).toStrictEqual(original)
  })

  it('funds the exact decimal surplus even when posted wage aggregation rounds down', () => {
    // 980 + 1900.03 has a binary posting below 2880.03. Exact EI is
    // 46.944489. Subtract living 1733.085511 and debt 1000 to leave 100.
    const { plan, evidence } = fixture({ selfWage: 980, partnerWage: 1_900.03, working: 1_733.085511 })
    const result = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(result.blocked).toBeNull()
    expect(result.rows[0].cashLedger.income).toBe(2_880.0299999999997)
    const proof = result.rows[0].householdWorkingTfsaSettlement!.arithmetic
    expect(atom(proof.income)).toBe(288_003n * 10n ** 22n)
    expect(atom(proof.payroll)).toBe(46_944_489n * 10n ** 18n)
    expect(atom(proof.surplus)).toBe(100n * 10n ** 24n)
  })

  it('prices income tax and enhanced CPP once before the allocation without a registered deduction', () => {
    // 2026 anchor, $40,000 wages. Pensionable wages $36,500 incur
    // $2,171.75 CPP, including a $365 income deduction. Base CPP of
    // $1,806.75 and EI of $652 earn credits. Health premium is $450.
    const taxable = 39_635
    const payrollCredits = 1_806.75 + 652
    const tax = 0.14 * (taxable - 16_452 - 1_501 - payrollCredits)
      + 0.0505 * (taxable - 12_989 - payrollCredits) + 450
    expect(tax).toBeCloseTo(4_362.711125, 10)
    const { plan, evidence } = fixture({ selfWage: 40_000, working: 32_205.388875 })
    const result = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(result.blocked).toBeNull()
    expect(result.rows[0]).toMatchObject({
      payrollContributions: expect.closeTo(2_831.90, 9),
      taxLedger: { [RETIREE]: { taxableIncome: taxable, tax: expect.closeTo(tax, 9) },
        [PARTNER]: { taxableIncome: 500, tax: 0 } },
      cashLedger: { tax: expect.closeTo(tax, 9), voluntaryContributions: 100, unallocated: 0 },
    })
    expect(atom(result.rows[0].householdWorkingTfsaSettlement!.arithmetic.tax)).toBe(4_362_711_125n * 10n ** 18n)
  })
})

describe('reached-year authorization and atomic refusals', () => {
  it.each([
    ['one cent less cash', 1_851.11],
    ['one cent more cash', 1_851.09],
    ['sub-cent shortfall', 1_851.1000000000001],
    ['sub-cent surplus', 1_851.0999999999997],
    ['no surplus', 1_951.1],
    ['actual living deficit with ample existing TFSA assets', 1_951.11],
    ['wage cash cannot pay the mandatory mortgage', 0],
  ])('refuses %s without changing opening cash, balances, history or room', (label, working) => {
    const { plan, evidence } = label === 'wage cash cannot pay the mandatory mortgage'
      ? fixture({ working, payment: 3_000, principal: 9_000 }) : fixture({ working })
    const original = structuredClone({ plan, evidence })
    const opening = ok(initializeState(plan))
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result).toMatchObject({ rows: [], state: opening, uncomputedYears: [MIXED_YEAR, RETIRED_YEAR],
      blocked: { year: BASE_YEAR, status: 'unsupported', causes: ['householdWorkingTfsa'] } })
    expect(result.state).toStrictEqual(opening)
    expect({ plan, evidence }).toStrictEqual(original)
  })

  it.each([
    ['room short by one cent', ({ plan }) => { plan.people[0].tfsaAvailableRoom = known(25.03) }],
    ['room short at decimal precision', ({ plan }) => { plan.people[0].tfsaAvailableRoom = known(25.039999999999996) }],
    ['unknown room for the second owner', ({ plan }) => { plan.people[1].tfsaAvailableRoom = { status: 'unknown', reason: 'No confirmed amount' } }],
    ['actual owner references swapped', ({ optIn }) => {
      const [self, partner] = optIn.years[BASE_YEAR]
      optIn.years[BASE_YEAR] = [{ ...self, ownerId: partner.ownerId }, { ...partner, ownerId: self.ownerId }]
    }],
    ['amounts swapped beyond the self owner’s cap despite enough total room', ({ optIn }) => {
      const [self, partner] = optIn.years[BASE_YEAR]
      optIn.years[BASE_YEAR] = [{ ...self, amountNominal: partner.amountNominal }, { ...partner, amountNominal: self.amountNominal }]
    }],
    ['duplicated account and owner', ({ optIn }) => {
      optIn.years[BASE_YEAR][1] = { ...optIn.years[BASE_YEAR][0], amountNominal: 74.96 }
    }],
    ['non-cent contributions still sum to 100', ({ optIn }) => {
      optIn.years[BASE_YEAR][0].amountNominal = 25.039
      optIn.years[BASE_YEAR][1].amountNominal = 74.961
    }],
    ['a zero instruction', ({ optIn }) => { optIn.years[BASE_YEAR][0].amountNominal = 0 }],
    ['undated proof', ({ optIn }) => { optIn.provenance.sourceYear = null }],
    ['post-anchor source year', ({ optIn }) => { optIn.provenance.sourceYear = MIXED_YEAR }],
    ['legacy rather than user proof', ({ optIn }) => { optIn.provenance.origin = 'legacy' }],
    ['inherited owner id', ({ optIn }) => {
      const { ownerId, ...line } = optIn.years[BASE_YEAR][1]
      optIn.years[BASE_YEAR][1] = Object.assign(Object.create({ ownerId }), line)
    }],
  ] satisfies [string, (testCase: ReturnType<typeof fixture>) => void][])('refuses %s', (_, change) => {
    const testCase = fixture()
    change(testCase)
    const result = ok(projectCanonicalCoverage(testCase.plan, testCase.evidence, 2))
    expect(result).toMatchObject({ rows: [], uncomputedYears: [MIXED_YEAR],
      blocked: { year: BASE_YEAR, status: 'unsupported', causes: ['householdWorkingTfsa'] } })
    expect(result.state).toStrictEqual(ok(initializeState(testCase.plan)))
  })

  it('follows valid swapped amounts by actual title even when every input list is reversed', () => {
    const { plan, evidence, optIn } = fixture({ selfRoom: 100 })
    plan.people.reverse()
    plan.accounts.reverse()
    optIn.years[BASE_YEAR] = [
      { accountId: PARTNER_TFSA, ownerId: PARTNER, amountNominal: 25.04 },
      { accountId: TFSA, ownerId: RETIREE, amountNominal: 74.96 },
    ]
    plan.savingsAllocation.shares = { rrsp: 0.4, tfsa: 0.1, nonReg: 0.5 }
    const result = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(result.blocked).toBeNull()
    expect(result.rows[0]).toMatchObject({
      byAccount: { [TFSA]: { contribution: 74.96, closing: 724.96, ownerId: RETIREE },
        [PARTNER_TFSA]: { contribution: 25.04, closing: 1_475.04, ownerId: PARTNER } },
      tfsaLedger: { [RETIREE]: { applied: 74.96, closingRoom: known(25.04) },
        [PARTNER]: { applied: 25.04, closingRoom: known(1_209.52) } },
      cashLedger: { voluntaryContributions: 100, retainedContributions: 0, unallocated: 0 },
      contributionLedger: { appliedTotal: 100, scheduledRrspBudgeted: 0 },
    })
  })

  it('leaves a committed prefix intact when an opted later both-working year has no sourced room addition', () => {
    const { plan, evidence, optIn } = fixture({ bothWorkingNext: true, selfRoom: 100 })
    optIn.years[MIXED_YEAR] = structuredClone(optIn.years[BASE_YEAR])
    const original = structuredClone({ plan, evidence })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    const attempted = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(attempted).toMatchObject({ blocked: { year: MIXED_YEAR, status: 'unsupported', causes: ['householdWorkingTfsa'],
      issues: [{ detail: expect.stringMatching(/room/) }] }, uncomputedYears: [RETIRED_YEAR, RETIRED_YEAR + 1] })
    expect(attempted.rows).toStrictEqual(prefix.rows)
    expect(attempted.state).toStrictEqual(prefix.state)
    expect(attempted.state.byPerson[RETIREE].tfsaRoom).toEqual(known(74.96))
    expect(attempted.state.byPerson[PARTNER].tfsaRoom).toEqual(known(1_159.60))
    expect(attempted.state.byDebt[DEBT].principal).toBe(2_000)
    expect(attempted.state.contributionHistory).toHaveLength(2)
    expect(attempted.state.tfsaWithdrawalHistory).toEqual([])
    expect({ plan, evidence }).toStrictEqual(original)
  })

  it('refuses when the ordinary room ledger would move a cent before or after an exact owner debit', () => {
    // In exact cents, 45,000,000,000,000.02 minus 25.04 is
    // 44,999,999,999,974.98. Number rounding in the shared ledger
    // can first turn .02 into .03 and then publish .99 as carry.
    const { plan, evidence } = fixture({ selfRoom: 45_000_000_000_000.02 })
    expect(4_500_000_000_000_002n - 2_504n).toBe(4_499_999_999_997_498n)
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result).toMatchObject({ rows: [], uncomputedYears: [MIXED_YEAR, RETIRED_YEAR],
      blocked: { year: BASE_YEAR, status: 'unsupported', causes: ['householdWorkingTfsa'],
        issues: [{ detail: expect.stringMatching(/room.*exact|exact.*room/i) }] } })
    expect(result.state).toStrictEqual(ok(initializeState(plan)))
    expect(result.state.byPerson[RETIREE].tfsaRoom).toEqual(known(45_000_000_000_000.02))
  })

  it('keeps the separate mortgage spending proof and two-owner withdrawal authorization in force', () => {
    const { plan, evidence } = fixture()
    const missingSpendingProof = { ...evidence }
    delete missingSpendingProof.scheduledMortgagePaymentsExcluded
    const noSpendingProof = ok(projectCanonicalCoverage(plan, missingSpendingProof, 2))
    expect(noSpendingProof).toMatchObject({ rows: [], blocked: { year: BASE_YEAR,
      issues: [{ detail: expect.stringMatching(/exclude scheduled payments/) }] } })
    const ordered = structuredClone(plan.annualHouseholdMortgageFundingEvidence)
    delete plan.annualHouseholdMortgageFundingEvidence
    const noOrder = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(noOrder).toMatchObject({ rows: [], blocked: { year: BASE_YEAR,
      issues: [{ detail: expect.stringMatching(/single funded TFSA|funding authorization/) }] } })
    plan.annualHouseholdMortgageFundingEvidence = ordered
    delete plan.tfsaStatement![PARTNER]
    const afterWorking = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(afterWorking.blocked).toBeNull()
    const noOwnerStatement = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(noOwnerStatement.blocked).toMatchObject({ year: MIXED_YEAR, causes: ['tfsaWithdrawalEvidence'] })
    expect(noOwnerStatement.rows).toStrictEqual(afterWorking.rows)
    expect(noOwnerStatement.state).toStrictEqual(afterWorking.state)

    plan.accounts[1].taxableOwnerShares = { status: 'unknown', reason: 'No confirmed title' }
    expect(projectCanonicalCoverage(plan, evidence, 2)).toMatchObject({ status: 'unsupported',
      issues: [{ detail: 'pricing gate: ownershipUnknown' }] })
  })

  it('cannot activate after removing the held mortgage or on a reached mixed year', () => {
    const noMortgage = fixture()
    noMortgage.plan.properties[0].mortgageDebtId = null
    noMortgage.plan.debts = []
    expect(ok(projectCanonicalCoverage(noMortgage.plan, noMortgage.evidence, 1))).toMatchObject({
      rows: [], blocked: { year: BASE_YEAR, causes: ['householdWorkingTfsa'] },
    })

    const { plan, evidence, optIn } = fixture({ working: 1_951.1 })
    optIn.years[MIXED_YEAR] = optIn.years[BASE_YEAR]
    delete optIn.years[BASE_YEAR]
    const baseline = ok(projectCanonicalCoverage(withoutOptIn(plan), evidence, 3))
    expect(baseline.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toMatchObject({ year: MIXED_YEAR, causes: ['householdWorkingTfsa'] })
    expect(result.rows).toStrictEqual(baseline.rows.slice(0, 1))
    expect(result.state).toStrictEqual(ok(projectCanonicalCoverage(withoutOptIn(plan), evidence, 1)).state)
  })
})

describe('exact ledger aggregation and contribution identity', () => {
  it('posts a 30-cent cash use from exact 10- and 20-cent lines with no rounding memo', () => {
    const { plan, evidence, optIn } = fixture({ working: 1_950.80 })
    optIn.years[BASE_YEAR][0].amountNominal = 0.10
    optIn.years[BASE_YEAR][1].amountNominal = 0.20
    expect(0.1 + 0.2).not.toBe(0.3)
    const result = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(result.blocked).toBeNull()
    expect(result.rows[0]).toMatchObject({
      byAccount: { [TFSA]: { contribution: 0.10, closing: 650.10 },
        [PARTNER_TFSA]: { contribution: 0.20, closing: 1_450.20 } },
      contributionLedger: { allocationCashBasis: 0.30, appliedTotal: 0.30, retained: [] },
      cashLedger: { voluntaryContributions: 0.30, unallocated: 0 },
      contributionRounding: 0,
      tfsaLedger: { [RETIREE]: { closingRoom: known(24.94) }, [PARTNER]: { closingRoom: known(1_234.36) } },
    })
    const sheet = canonicalAnnualSheet(result, context)
    expect(sheetCell(sheet, BASE_YEAR, 'cash', 'contributionRounding').cell.value).toBe(0)
    expect(sheetCell(sheet, BASE_YEAR, 'contributions', 'appliedTotal').cell.value).toBe(0.30)
  })

  it('gives delimiter-bearing account/owner pairs distinct history IDs and preserves their linkage through a mixed year', () => {
    const { plan, evidence, optIn } = fixture()
    const self = { accountId: 'a', ownerId: 'b:c' }
    const partner = { accountId: 'a:b', ownerId: 'c' }
    expect(`${self.accountId}:${self.ownerId}`).toBe(`${partner.accountId}:${partner.ownerId}`)
    plan.tfsaStatement = {}
    for (const [index, { accountId, ownerId }] of [self, partner].entries()) {
      plan.people[index].id = ownerId
      Object.assign(plan.accounts[index], { id: accountId, ownerId,
        taxableOwnerShares: { status: 'known', shares: { [ownerId]: 1 } } })
      plan.tfsaStatement[ownerId] = { withdrawals: [], provenance: recorded }
      Object.assign(optIn.years[BASE_YEAR][index], { accountId, ownerId })
    }
    plan.properties[0].taxableOwnerShares = { status: 'known', shares: { [self.ownerId]: 0.25, [partner.ownerId]: 0.75 } }
    plan.annualHouseholdMortgageFundingEvidence!.orderedAccounts = [self, partner]
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    const [first, mixed] = result.rows
    const postings = first.contributionLedger.postings
    expect(new Set(postings.map(posting => posting.id)).size).toBe(2)
    const history = result.state.contributionHistory
    expect(history).toHaveLength(2)
    for (const [ref, amount] of [[self, 25.04], [partner, 74.96]] as const) {
      const { accountId, ownerId } = ref
      const posting = postings.find(line => line.accountId === accountId)!
      expect(posting).toMatchObject({ ownerId, contributorId: ownerId, amount })
      expect(history).toContainEqual({ id: posting.id, accountId, contributorId: ownerId,
        calendarYear: BASE_YEAR, amount, deductionYear: null })
    }
    expect(mixed.byAccount[self.accountId]).toMatchObject({ ownerId: self.ownerId, opening: 675.04, withdrawal: 675.04, closing: 0 })
    expect(mixed.byAccount[partner.accountId]).toMatchObject({ ownerId: partner.ownerId, opening: 1_524.96, withdrawal: 183.11, closing: 1_341.85 })
    expect(mixed.contributionLedger.postings).toEqual([])
    expect(history).toEqual(ok(projectCanonicalCoverage(plan, evidence, 1)).state.contributionHistory)
  })
})

const locales = ['en', 'fr', 'zh'] as const

describe('annual sheet values, signed formulas and source lineage', () => {
  it.each([false, true])('replays wage allocation and actual cash uses in all locales with zero public benefit composition=%s', composedBenefits => {
    const { plan, evidence } = fixture({ inflation: 0.25 })
    if (composedBenefits) {
      plan.annualBenefitsEvidence = { [RETIREE]: householdBenefitExclusions(RETIREE),
        [PARTNER]: householdBenefitExclusions(PARTNER) }
      plan.annualHouseholdMortgageBenefitsEvidence = { authorized: true,
        purpose: 'household-held-mortgage-with-verified-public-benefits', provenance: recorded }
    }
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows[0].householdWithdrawalSettlement?.publicBenefitsCash !== undefined).toBe(composedBenefits)
    const sheet = canonicalAnnualSheet(coverage, context)
    const wageSurplus = sheetCell(sheet, BASE_YEAR, 'cash', 'canonicalNetCash')
    const fundedLiving = sheetCell(sheet, BASE_YEAR, 'retirement', 'spendingFunded')
    const posted = sheetCell(sheet, BASE_YEAR, 'contributions', 'appliedTotal')
    const signed = (entry: typeof wageSurplus) => entry.details.flatMap(detail => detail.formula ?? [])
    const replay = (entry: typeof wageSurplus) => signed(entry)
      .reduce((total, term) => total + (term.direction === 'add' ? term.value : -term.value), 0)
    expect(wageSurplus.cell.value).toBe(100)
    expect(replay(wageSurplus)).toBeCloseTo(100, 10)
    expect(fundedLiving.cell.value).toBe(1_851.1)
    expect(replay(fundedLiving)).toBeCloseTo(1_851.1, 10)
    expect(posted.cell.value).toBe(100)
    expect(replay(posted)).toBeCloseTo(100, 10)
    for (const [entry, direction] of [[fundedLiving, 'subtract'], [posted, 'add']] as const) {
      expect(signed(entry).filter(term => term.field === 'contributionPosting')).toMatchObject([
        { value: 25.04, direction, unit: 'CAD', basis: 'nominal-CAD' },
        { value: 74.96, direction, unit: 'CAD', basis: 'nominal-CAD' },
      ])
    }
    expect(signed(fundedLiving).filter(term => term.field?.includes('residual'))
      .every(term => Math.abs(term.value) < 1e-9)).toBe(true)

    const mixedCash = sheetCell(sheet, MIXED_YEAR, 'cash', 'canonicalNetCash')
    expect(mixedCash.cell.value).toBeCloseTo(-822.6875, 10)
    expect(replay(mixedCash)).toBeCloseTo(-822.6875, 10)
    expect(annualSheetDisplayValue(mixedCash.cell, sheet.years[1], 'real')).toBeCloseTo(-658.15, 10)
    expect(mixedCash.details.flatMap(detail => detail.sources ?? [])
      .some(source => source.field?.startsWith('annualHouseholdWorkingTfsaEvidence'))).toBe(false)

    for (const [accountId, ownerId, amount, closeNominal, closeReal] of [
      [TFSA, RETIREE, 25.04, 843.8, 675.04],
      [PARTNER_TFSA, PARTNER, 74.96, 1_906.2, 1_524.96],
    ] as const) {
      const credit = sheetCell(sheet, BASE_YEAR, 'account', accountId, 'contribution')
      const contributed = sheetCell(sheet, BASE_YEAR, 'person', ownerId, 'contributed')
      const closing = sheetCell(sheet, BASE_YEAR, 'account', accountId, 'closing')
      expect(credit.cell).toMatchObject({ value: amount, unit: 'CAD', timing: 'during-year' })
      expect(contributed.cell.value).toBe(amount)
      expect(annualSheetDisplayValue(closing.cell, sheet.years[0], 'nominal')).toBe(closeNominal)
      expect(annualSheetDisplayValue(closing.cell, sheet.years[0], 'real')).toBeCloseTo(closeReal, 10)
      expect(sheetCell(sheet, MIXED_YEAR, 'account', accountId, 'contribution').cell.value).toBe(0)
      const sources = credit.details.flatMap(detail => detail.sources ?? [])
      const dated = sources.find(source => source.field === 'annualHouseholdWorkingTfsaEvidence')!
      expect(dated.granularity).toBe('input')
      expect(sources).toContainEqual(expect.objectContaining({ id: ownerId, field: `annualHouseholdWorkingTfsaEvidence.years.${BASE_YEAR}` }))
      expect(sources).toContainEqual(expect.objectContaining({ id: accountId, field: 'amountNominal', displayReference: String(amount) }))
      expect(sources).toContainEqual(expect.objectContaining({ field: 'householdWorkingTfsaSettlement.arithmetic.surplus', displayReference: '100' }))
      for (const [index, locale] of locales.entries()) {
        const phrase = [/actual sole TFSA owner/i, /titulaire unique réel.*CELI/i, /实际唯一持有人.*TFSA/][index]
        expect(annualSheetText(dated.label, locale)).toMatch(phrase)
        expect(annualSheetText(dated.displayReference!, locale)).toMatch(new RegExp(`${sourceYear}.*${BASE_YEAR}`))
        for (const term of signed(fundedLiving).filter(term => term.field === 'contributionPosting')) {
          expect(annualSheetText(term.label, locale)).toMatch([/contributor/i, /cotisant/i, /供款人/][index])
        }
      }
    }
  })

  it('shows the typed refusal in each locale and leaves the uncomputed suffix blank', () => {
    const { plan, evidence } = fixture({ working: 1_851.0999999999997 })
    const sheet = canonicalAnnualSheet(ok(projectCanonicalCoverage(plan, evidence, 2)), context)
    const blocked = sheetCell(sheet, BASE_YEAR, 'netWorth')
    const after = sheetCell(sheet, MIXED_YEAR, 'netWorth')
    expect(blocked.cell).toMatchObject({ value: null, status: 'not-computed' })
    expect(after.cell).toMatchObject({ value: null, status: 'not-computed' })
    expect(blocked.details.flatMap(detail => detail.sources ?? []))
      .toContainEqual(expect.objectContaining({ code: 'householdWorkingTfsa' }))
    for (const [locale, pattern, suffix] of [
      ['en', /confirmed sufficient unrounded room/i, /after the first blocked year/i],
      ['fr', /droits suffisants non arrondis/i, /après la première année bloquée/i],
      ['zh', /未经舍入的足够额度/, /首个受阻年度之后未计算/],
    ] as const) {
      expect(annualSheetText(blocked.cell.reason!, locale)).toMatch(pattern)
      expect(annualSheetText(after.cell.reason!, locale)).toMatch(suffix)
    }
  })
})

describe('no-opt-in, prior ordered mortgage, solo, provider and legacy parity', () => {
  it('keeps positive cash outside the household slice without a reached election and preserves ordinary ordered withdrawals', () => {
    const positive = fixture()
    const baseline = withoutOptIn(positive.plan)
    expect(ok(projectCanonicalCoverage(baseline, positive.evidence, 3))).toMatchObject({
      rows: [], state: ok(initializeState(baseline)),
      blocked: { year: BASE_YEAR, causes: ['contributionAttribution'] },
    })

    const { plan, evidence, optIn } = fixture({ working: 1_951.1 })
    optIn.years[BASE_YEAR + 5] = optIn.years[BASE_YEAR]
    delete optIn.years[BASE_YEAR]
    const dormant = ok(projectCanonicalCoverage(plan, evidence, 4))
    const ordinary = ok(projectCanonicalCoverage(withoutOptIn(plan), evidence, 4))
    expect(dormant).toStrictEqual(ordinary)
    expect(dormant.blocked).toBeNull()
    expect(dormant.rows[1]).toMatchObject({ byAccount: {
      [TFSA]: { withdrawal: 650, closing: 0 }, [PARTNER_TFSA]: { withdrawal: 208.15, closing: 1_241.85 },
    } })
    const dormantSheet = canonicalAnnualSheet(dormant, context)
    const ordinarySheet = canonicalAnnualSheet(ordinary, context)
    expect(dormantSheet.rows).toStrictEqual(ordinarySheet.rows)
    expect(dormantSheet.scope).toStrictEqual(ordinarySheet.scope)
  })

  it('does not authorize existing standalone, provider or legacy entry points', () => {
    const { plan, evidence } = fixture()
    const baseline = withoutOptIn(plan)
    const opening = ok(initializeState(plan))
    const before = structuredClone(opening)
    const providers: AnnualProviders = {
      evaluate: () => ({ byPerson: Object.fromEntries(plan.people.map(person => [person.id, {
        income: 0, earnedIncome: 0, benefits: 0, tax: 0, spending: 0, taxableIncome: 0,
        benefitIncomeForNextYear: known(0),
      }])) }),
      returns: () => 0,
    }
    expect(evaluateCanonicalHouseholdWorkingYear(plan, evidence, BASE_YEAR))
      .toStrictEqual(evaluateCanonicalHouseholdWorkingYear(baseline, evidence, BASE_YEAR))
    expect(evaluateCanonicalHouseholdWorkingYear(plan, evidence, BASE_YEAR, opening)).toMatchObject({ status: 'unsupported' })
    expect(annualRetirementStep(plan, opening)).toStrictEqual(annualRetirementStep(baseline, opening))
    expect(annualStep(plan, opening, providers)).toStrictEqual(annualStep(baseline, opening, providers))
    expect(projectFromState(plan, opening, 2, providers)).toStrictEqual(projectFromState(baseline, opening, 2, providers))
    expect(projectAnnualCoverage(plan, opening, 2, providers))
      .toStrictEqual(projectAnnualCoverage(baseline, opening, 2, providers))
    expect(opening).toStrictEqual(before)

    const generated = ok(projectCanonicalCoverage(plan, evidence, 2)).state
    expect(annualRetirementContinuation(plan, generated, evidence)).toMatchObject({ status: 'invalid' })
    expect(annualStep(plan, generated, providers)).toMatchObject({ status: 'invalid' })

    for (const sample of [undefined, () => -0.04]) {
      const inputs = plan.legacyProjection
      const legacy = runProjection(inputs, sample, plan, { captureAnnualDetails: true })
      const ordinary = runProjection(inputs, sample, baseline, { captureAnnualDetails: true })
      expect(legacy).toStrictEqual(ordinary)
      const legacySheet = legacyAnnualSheet(legacy, inputs, context)
      const ordinarySheet = legacyAnnualSheet(ordinary, inputs, context)
      expect(legacySheet.rows).toStrictEqual(ordinarySheet.rows)
      expect(legacySheet.scope).toStrictEqual(ordinarySheet.scope)
    }

    plan.properties = []
    plan.debts = []
    delete plan.annualHouseholdMortgageFundingEvidence
    plan.budget = { kind: 'savingsBudget', annualNetSavings: 0, retirementSpending: 0,
      debtIncluded: known(true), taxBenefitIncluded: known(true) }
    const providerOpening = ok(initializeState(plan))
    const success = annualStep(plan, providerOpening, providers)
    expect(success.status).toBe('ok')
    expect(success).toStrictEqual(annualStep(withoutOptIn(plan), providerOpening, providers))
  })

  it('preserves the solo mortgage contribution and withdrawal path with household evidence present', () => {
    const { plan, evidence } = fixture({ working: 1_359.25, selfBalance: 3_000, selfRoom: 500 })
    plan.people.pop()
    plan.accounts.pop()
    plan.properties[0].taxableOwnerShares = { status: 'known', shares: { [RETIREE]: 1 } }
    delete plan.tfsaStatement![PARTNER]
    delete plan.annualHouseholdMortgageFundingEvidence
    const solo = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(solo.blocked).toBeNull()
    expect(solo.rows[0]).toMatchObject({
      cashLedger: { voluntaryContributions: expect.closeTo(100, 10), debtPayments: 1_000, unallocated: 0 },
      byAccount: { [TFSA]: { contribution: 100, closing: 3_100 } },
    })
    expect(solo.rows[0].householdWorkingTfsaSettlement).toBeUndefined()
    expect(solo.rows[1].byAccount[TFSA]).toMatchObject({ withdrawal: 1_300, closing: 1_800 })
    expect(solo).toStrictEqual(ok(projectCanonicalCoverage(withoutOptIn(plan), evidence, 2)))
  })
})
