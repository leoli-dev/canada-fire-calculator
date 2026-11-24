import { describe, expect, it, vi } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { annualRetirementContinuation, annualRetirementStep, projectRetirementCoverage } from '../annualRetirement'
import { initializeState, projectAnnualCoverage, projectCanonicalCoverage, sumInvestableAssets, sumNetWorth,
  type KernelResult } from '../annualState'
import { evaluateCanonicalHouseholdWorkingYear } from '../annualWorking'
import type { InputsV2, Property } from '../model'
import { runProjection } from '../projection'
import { cppStart } from './fixtures/annualCpp'
import { BASE_YEAR, known, legacyRetirement, recorded, retirementPlan, RETIREE } from './fixtures/retirementSettlement'

const SELF = 'resident/self.%'
const PARTNER = 'resident:partner/中'
const TFSA = 'account:tfsa/%.中'
const HOME = 'property.home:/%中'
const YEAR = 2029
const PRICE = 170_000.25
const CONTEXT = { scenarioId: 'household-purchase-independent', revision: 1 }
const atom = (coefficient: string, scale = 0) => ({ coefficient, scale })
const close = (value: number) => expect.closeTo(value, 8)

type PurchaseEvidence = NonNullable<InputsV2['annualPrimaryHomePurchaseEvidence']>[string]

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function fixture(ids = { self: SELF, partner: PARTNER, tfsa: TFSA, home: HOME }) {
  const plan = retirementPlan({ tfsa: 65_536, rrsp: 0, spending: 4_096, inflation: 0.125,
    tfsaReturn: 0.26, fee: 0.01, strategy: 'tfsaFirst' })
  const self = plan.people[0]
  Object.assign(self, { id: ids.self, retirementAge: 58 })
  const partner = { ...structuredClone(self), id: ids.partner, role: 'partner' as const,
    ageInBaseYear: 59, retirementAge: 61 }
  // The partner's age and array position differ from the self purchase clock.
  plan.people = [partner, self]
  plan.accounts = [{ ...plan.accounts[0], id: ids.tfsa, ownerId: ids.partner,
    taxableOwnerShares: { status: 'known', shares: { [ids.partner]: 1 } } }]
  plan.tfsaStatement = {
    [ids.self]: { withdrawals: [], provenance: recorded },
    [ids.partner]: plan.tfsaStatement![RETIREE],
  }
  plan.taxProfile = { spouseSupported: known(false), pensionSplit: null }
  plan.budget = { kind: 'incomeBudget', workingSpending: 0, retirementSpending: 4_096 }
  plan.lifeExpectancy = 68
  const titleShares = { [ids.self]: 1 }
  const home: Property = {
    id: ids.home, kind: 'principal', value: PRICE, acb: known(150_000), annualRent: known(0),
    appreciation: 0.125, sellAtAge: null, plannedPurchaseAge: 60, plannedDownPayment: PRICE,
    plannedMortgage: { principal: 0, annualPayment: null, yearsRemaining: null },
    annualHoldingCostChange: 0, mortgageDebtId: null,
    taxableOwnerShares: { status: 'known', shares: titleShares },
    provenance: { value: recorded, taxableOwnerShares: recorded },
  }
  plan.properties = [home]
  const purchase = {
    provenance: recorded, effectiveYear: YEAR, timing: 'start-of-purchase-year',
    priceNominal: known(PRICE), qualifyingAcquisitionCostsNominal: known(999.75),
    postPurchaseAnnualSpendingReal: known(512), excludesOneTimeCosts: true,
    householdTitle: { shares: { ...titleShares }, verified: true, policy: 'user-verified-title', provenance: recorded },
    fundingAuthorization: { accountId: ids.tfsa, ownerId: ids.partner, authorized: true,
      purpose: 'household-primary-home-purchase', provenance: recorded },
  } satisfies PurchaseEvidence
  plan.annualPrimaryHomePurchaseEvidence = { [ids.home]: purchase }
  const evidence = { workingSpending: known(0), transitionSpending: known(1_024), retirementSpending: known(4_096) }
  return { plan, home, purchase, evidence }
}

function findRow(rows: AnnualSheetRow[], id: string): AnnualSheetRow {
  const found = rows.flatMap(function flatten(row): AnnualSheetRow[] {
    return [row, ...(row.children ?? []).flatMap(flatten)]
  }).find(row => row.id === id)
  if (!found) throw new Error(`Missing annual sheet row ${id}`)
  return found
}

describe('FE-53 independently calculated household cash home purchase', () => {
  it.each(['sole title', 'unequal title'] as const)('acquires once on the self clock with %s', title => {
    const { plan, home, purchase, evidence } = fixture()
    if (title === 'unequal title') {
      const shares = { [SELF]: 0.75, [PARTNER]: 0.25 }
      home.taxableOwnerShares = { status: 'known', shares }
      purchase.householdTitle.shares = { ...shares }
      home.plannedMortgage = null
    }
    const original = structuredClone({ plan, evidence })
    const result = ok(projectCanonicalCoverage(plan, evidence, 7))
    expect(result).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false,
      evaluationBasis: 'canonical-continuous' })
    expect(result.rows.map(row => row.year)).toEqual([2026, 2027, 2028, 2029, 2030, 2031, 2032])
    expect(result.rows.map(row => row.workingSettlement && 'household' in row.workingSettlement
      ? row.workingSettlement.household.phase : null))
      .toEqual(['both-working', 'mixed', 'both-retired', 'both-retired', 'both-retired', 'both-retired', 'both-retired'])
    // The annual TFSA factor is (1 + .26 − .01) × 9/8 = 45/32.
    // Reached living bills before purchase use the transition and retirement budgets.
    const beforePurchase = [
      [65_536, 0, 26_624, 92_160, atom('92160')],
      [92_160, 1_152, 36_972, 127_980, atom('127980')],
      [127_980, 5_184, 49_885.875, 172_681.875, atom('172681875', 3)],
    ] as const
    for (const [index, [opening, withdrawal, returnAmount, closing, exact]] of beforePurchase.entries()) {
      const row = result.rows[index]
      const prefix = ok(projectCanonicalCoverage(plan, evidence, index + 1))
      expect(row.byAccount[TFSA]).toMatchObject({ ownerId: PARTNER, opening, contribution: 0, withdrawal, returnAmount, closing })
      expect(row.cashLedger).toMatchObject({ spending: withdrawal, voluntaryContributions: 0, debtPayments: 0 })
      expect(row.byProperty[HOME]).toEqual({ held: false, opening: PRICE, closing: PRICE, growth: 0 })
      expect(row.retirementSettlement?.primaryHomePurchase).toBeUndefined()
      expect(prefix.rows).toEqual(result.rows.slice(0, index + 1))
      expect(prefix.state.prospectivePurchaseExactBalances).toEqual({ [TFSA]: exact })
      expect(sumNetWorth(prefix.state)).toBe(closing)
    }
    const bought = result.rows[3]
    expect(bought.byPerson[SELF].age).toBe(60)
    expect(bought.byPerson[PARTNER].age).toBe(62)
    const receipt = { propertyId: HOME, year: YEAR, priceBasis: 'purchase-year-nominal', price: PRICE,
      qualifyingAcquisitionCosts: 999.75, totalCost: 171_000, acb: 171_000, tax: 0 }
    expect(bought.retirementSettlement?.primaryHomePurchase).toEqual(receipt)
    expect(bought.retirementSettlement?.primaryHomePurchaseEvidence).toEqual(purchase)
    expect(bought.retirementSettlement?.primaryHomePurchaseArithmetic).toMatchObject({
      price: atom('17000025', 2), qualifyingAcquisitionCosts: atom('99975', 2), totalCost: atom('171000'),
      withdrawals: { [TFSA]: atom('171000') }, spendingDue: atom('729'), spendingFunded: atom('729'), spendingUnmet: atom('0'),
    })
    // Acquisition consumes 171,000 before the first indexed bill of 729.
    // Property grows from price alone at (9/8)². ACB includes the fees.
    const afterPurchase = [
      [172_681.875, 171_729, 729, 729, 0, 387.10546875, 1_339.98046875, 215_156.56640625, atom('133998046875', 8)],
      [1_339.98046875, 820.125, 820.125, 820.125, 0, 211.1912841796875, 731.0467529296875, 272_307.52935791015625, atom('7310467529296875', 13)],
      [731.0467529296875, 731.0467529296875, 922.640625, 731.0467529296875, 191.5938720703125, 0, 0, 344_639.21684360504150390625, atom('0')],
      [0, 0, 1_037.970703125, 0, 1_037.970703125, 0, 0, 436_184.0088176876306533813477, atom('0')],
    ] as const
    for (const [offset, [opening, withdrawal, due, funded, unmet, returnAmount, closing, property, exact]] of afterPurchase.entries()) {
      const row = result.rows[offset + 3]
      expect(row.byAccount[TFSA]).toMatchObject({ ownerId: PARTNER, opening, withdrawal, contribution: 0, returnAmount, closing })
      expect(row.byDebt).toEqual({})
      expect(row.cashLedger).toMatchObject({ income: 0, benefits: 0, tax: 0, spending: funded,
        debtPayments: 0, voluntaryContributions: 0, unallocated: 0 })
      expect(row.byPerson[SELF].spending).toBe(0)
      expect(row.byPerson[PARTNER].spending).toBe(0)
      expect(row.householdWithdrawalSettlement).toMatchObject({
        accountId: withdrawal ? TFSA : null, ownerId: withdrawal ? PARTNER : null,
        postings: withdrawal ? [{ accountId: TFSA, ownerId: PARTNER, kind: 'tfsa', amount: withdrawal }] : [],
        withdrawal, spendingDue: due, spendingFunded: funded, spendingUnmet: unmet, taxIncrement: 0,
      })
      expect(row.byProperty[HOME]).toMatchObject({ held: true, closing: close(property) })
      expect(row.taxLedger).toEqual({ [SELF]: { taxableIncome: 0, tax: 0 }, [PARTNER]: { taxableIncome: 0, tax: 0 } })
      const prefix = ok(projectCanonicalCoverage(plan, evidence, offset + 4))
      expect(prefix.rows).toEqual(result.rows.slice(0, offset + 4))
      expect(prefix.state.primaryHomePurchase).toMatchObject({ receipt, evidence: purchase, exactAccountBalances: { [TFSA]: exact } })
      expect(prefix.state.prospectivePurchaseExactBalances).toBeUndefined()
      expect(prefix.state.byProperty[HOME]).toMatchObject({ held: true, value: close(property), acb: known(171_000) })
      expect(sumInvestableAssets(prefix.state)).toBe(closing)
      expect(sumNetWorth(prefix.state)).toBeCloseTo(property + closing, 8)
      if (offset) {
        expect(row.retirementSettlement?.primaryHomePurchase).toBeUndefined()
        expect(row.retirementSettlement?.primaryHomePurchaseArithmetic?.withdrawals).toEqual({ [TFSA]: atom('0') })
      }
    }
    expect(bought.byProperty[HOME]).toEqual({ held: true, opening: PRICE, closing: 215_156.56640625, growth: 45_156.31640625 })
    expect(result.state.tfsaWithdrawalHistory).toEqual([
      [2027, 1_152], [2028, 5_184], [2029, 171_729], [2030, 820.125], [2031, 731.0467529296875],
    ].map(([calendarYear, amount]) => ({ id: `annual:${calendarYear}:withdrawal:${TFSA}`, personId: PARTNER, calendarYear, amount })))
    expect(result.rows[4].tfsaLedger[PARTNER].restored).toEqual(known(171_729))
    expect(result.rows[4].tfsaLedger[SELF].restored).toEqual(known(0))
    expect({ plan, evidence }).toEqual(original)
  })

  it.each([2_681.625000000001, 2_681.635])('refuses a true acquisition shortfall at nominal costs %s', costs => {
    const { plan, purchase, evidence } = fixture()
    purchase.qualifyingAcquisitionCostsNominal = known(costs)
    if (costs < 2_681.63) expect(PRICE + costs).toBe(172_681.875)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(prefix.state.prospectivePurchaseExactBalances).toEqual({ [TFSA]: atom('172681875', 3) })
    const original = structuredClone({ plan, evidence })
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(stopped).toMatchObject({ blocked: { year: YEAR, status: 'unsupported', causes: ['propertyPurchase'] },
      uncomputedYears: [2030, 2031] })
    expect(stopped.rows).toStrictEqual(prefix.rows)
    expect(stopped.state).toStrictEqual(prefix.state)
    expect(stopped.state.primaryHomePurchase).toBeUndefined()
    expect(stopped.state.byProperty[HOME].held).toBe(false)
    const sheet = canonicalAnnualSheet(stopped, CONTEXT)
    const cells = findRow(sheet.rows, canonicalSheetId('value', 'netWorth')).cells!
    for (const [locale, shortfall, atomic] of [
      ['en', /TFSA funding is insufficient.*full nominal purchase price.*qualifying acquisition costs/i, /no acquisition or account debit/i],
      ['fr', /CELI est insuffisant.*prix d’achat nominal.*frais d’acquisition admissibles/i, /aucun achat ni débit/i],
      ['zh', /TFSA 筹资不足.*名义购房价格全额.*合资格购置费用/, /未购入房产.*未提交账户扣款/],
    ] as const) {
      const reason = annualSheetText(cells[YEAR].reason!, locale)
      expect(reason).toMatch(shortfall)
      expect(reason).toMatch(atomic)
      expect(annualSheetText(sheet.resolveExplanation!(cells[YEAR].explanationRefs![0])!.summary!, locale)).toBe(reason)
    }
    expect({ plan, evidence }).toEqual(original)
  })

  it.each([[2_681.625, 172_681.875, 0], [2_681.5, 172_681.75, 0.125]])(
    'settles mandatory costs of %s before allocating any residual to living', (costs, totalCost, funded) => {
      const { plan, purchase, evidence } = fixture()
      purchase.qualifyingAcquisitionCostsNominal = known(costs)
      const result = ok(projectCanonicalCoverage(plan, evidence, 5))
      expect(result.blocked).toBeNull()
      expect(result.rows[3].retirementSettlement?.primaryHomePurchase).toMatchObject({ totalCost, acb: totalCost })
      expect(result.rows[3].householdWithdrawalSettlement).toMatchObject({ withdrawal: 172_681.875,
        spendingDue: 729, spendingFunded: funded, spendingUnmet: 729 - funded })
      expect(result.rows[3].cashLedger.spending).toBe(funded)
      expect(result.rows[3].byAccount[TFSA]).toMatchObject({ withdrawal: 172_681.875, returnAmount: 0, closing: 0 })
      expect(result.rows[4].householdWithdrawalSettlement).toMatchObject({ withdrawal: 0, spendingFunded: 0, spendingUnmet: 820.125 })
      expect(result.state.byProperty[HOME]).toMatchObject({ held: true, acb: known(totalCost) })
    },
  )

  it('compares the true indexed quote and exact funded carry at the acquisition boundary', () => {
    const { plan, home, purchase, evidence } = fixture()
    plan.inflation = 0.02
    Object.assign(home, { value: 120_000.25, plannedDownPayment: 120_000.25 })
    const optIn = plan.annualPrimaryHomePurchaseEvidence![HOME]
    optIn.priceBasis = 'base-year-real-indexed'
    purchase.priceNominal = known(127_345.225302)
    purchase.qualifyingAcquisitionCostsNominal = known(1_358.080938)
    // Carry uses 1.25 × 1.02 = 1.275. The exact mixed and retired
    // debits are 1,024 × 1.02 and 4,096 × 1.0404.
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(prefix.rows.map(row => row.byAccount[TFSA].withdrawal)).toEqual([0, 1_044.48, 4_261.4784])
    expect(prefix.rows.map(row => row.byAccount[TFSA].closing)).toEqual([83_558.4, 105_205.248, 128_703.30624])
    expect(prefix.state.prospectivePurchaseExactBalances).toEqual({ [TFSA]: atom('12870330624', 5) })
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.blocked).toBeNull()
    const bought = result.rows[3]
    // 120,000.25 × 1.061208 + 1,358.080938 = 128,703.30624.
    expect(bought.retirementSettlement?.primaryHomePurchase).toEqual({
      propertyId: HOME, year: YEAR, priceBasis: 'base-year-real-indexed', price: 127_345.225302,
      qualifyingAcquisitionCosts: 1_358.080938, totalCost: 128_703.30624, acb: 128_703.30624, tax: 0,
    })
    expect(bought.retirementSettlement?.primaryHomePurchaseArithmetic).toMatchObject({
      price: atom('127345225302', 6), qualifyingAcquisitionCosts: atom('1358080938', 6),
      totalCost: atom('12870330624', 5), spendingDue: atom('543338496', 6),
    })
    expect(bought.householdWithdrawalSettlement).toMatchObject({ withdrawal: 128_703.30624,
      spendingDue: 543.338496, spendingFunded: 0, spendingUnmet: 543.338496 })
    expect(bought.byProperty[HOME].opening).toBe(127_345.225302)
    expect(result.state.primaryHomePurchase?.exactAccountBalances).toEqual({ [TFSA]: atom('0') })
    expect(127_345.225302 + 1_358.080938000001).toBe(128_703.30624)
    purchase.qualifyingAcquisitionCostsNominal = known(1_358.080938000001)
    const short = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(short.blocked).toMatchObject({ year: YEAR, causes: ['propertyPurchase'] })
    expect(short.rows).toStrictEqual(prefix.rows)
    expect(short.state).toStrictEqual(prefix.state)
  })

  it('exhausts TFSA for pre-purchase living before refusing the following purchase', () => {
    const { plan, evidence } = fixture()
    plan.inflation = 0.02
    Object.assign(plan.accounts[0], { balance: 65_536.02, realReturn: 0.263, annualFee: 0.0123 })
    evidence.transitionSpending = known(0)
    evidence.retirementSpending = known(1_000_000)
    plan.budget = { kind: 'incomeBudget', workingSpending: 0, retirementSpending: 1_000_000 }
    const throughMixed = ok(projectCanonicalCoverage(plan, evidence, 2))
    // 65,536.02 × 1.275714² is below the numeric representation used for display.
    const exactDebit = atom('10665634735411485192', 14)
    const displayedDebit = 106_656.34735411486
    expect(throughMixed.state.byAccount[TFSA].balance).toBe(displayedDebit)
    expect(throughMixed.state.prospectivePurchaseExactBalances).toEqual({ [TFSA]: exactDebit })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows[2].householdWithdrawalSettlement).toMatchObject({ withdrawal: displayedDebit, spendingDue: 1_040_400,
      spendingFunded: displayedDebit, spendingUnmet: close(933_743.6526458851) })
    expect(prefix.rows[2].byAccount[TFSA]).toMatchObject({ withdrawal: displayedDebit, closing: 0,
      primaryHomePurchaseExactWithdrawal: exactDebit, primaryHomePurchaseWithdrawalReconciliation: -0.00000000000808 })
    expect(prefix.state.prospectivePurchaseExactBalances).toEqual({ [TFSA]: atom('0') })
    expect(prefix.state.tfsaWithdrawalHistory?.at(-1)).toMatchObject({ personId: PARTNER, amount: displayedDebit, calendarYear: 2028 })
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(stopped.blocked).toMatchObject({ year: YEAR, causes: ['propertyPurchase'] })
    expect(stopped.rows).toStrictEqual(prefix.rows)
    expect(stopped.state).toStrictEqual(prefix.state)
  })
})

describe('household purchase precision and scope regressions', () => {
  it('commits partial mixed living on exact TFSA exhaustion before refusing the later purchase', () => {
    const { plan, home, purchase, evidence } = fixture()
    Object.assign(plan.accounts[0], { balance: 100_000.01, realReturn: 0.03, annualFee: 0 })
    plan.inflation = 0.02
    plan.people[0].retirementAge = 63
    plan.people[1].retirementAge = 60
    for (const person of plan.people) person.earnedIncome = known(12_000)
    plan.budget = { kind: 'incomeBudget', workingSpending: 22_597.30, retirementSpending: 4_096 }
    evidence.workingSpending = known(22_597.30)
    evidence.transitionSpending = known(1_000_000)
    home.plannedPurchaseAge = 61
    purchase.effectiveYear = 2030

    const beforeMixed = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(beforeMixed.blocked).toBeNull()
    // 100,000.01 × (1.03 × 1.02)^3 = 115,961.07501770634216.
    // The numeric opening rounds up. The draw must empty the exact backing.
    const exactDebit = atom('11596107501770634216', 14)
    const visibleDebit = 115_961.07501770635
    expect(beforeMixed.state.prospectivePurchaseExactBalances).toEqual({ [TFSA]: exactDebit })
    expect(beforeMixed.state.byAccount[TFSA].balance).toBe(visibleDebit)
    const mixed = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(mixed.blocked).toBeNull()
    expect(mixed.rows.slice(0, 3)).toStrictEqual(beforeMixed.rows)
    const row = mixed.rows[3]
    expect(row.workingSettlement).toMatchObject({ household: { phase: 'mixed' } })
    expect(row.byAccount[TFSA]).toMatchObject({ opening: visibleDebit, withdrawal: visibleDebit, returnAmount: 0, closing: 0,
      primaryHomePurchaseExactWithdrawal: exactDebit })
    // This year's wage nets 11,298.65 × 1.061208 = 11,990.2177692.
    // Wage plus the exact debit funds 127,951.29278690634216 of 1,061,208.
    expect(row.householdWithdrawalSettlement).toMatchObject({ withdrawal: visibleDebit, ownerId: PARTNER,
      postings: [{ accountId: TFSA, ownerId: PARTNER, kind: 'tfsa', amount: visibleDebit }],
      spendingDue: close(1_061_208), spendingFunded: close(127_951.29278690634216), spendingUnmet: close(933_256.70721309365784),
    })
    expect(row.cashLedger).toMatchObject({ spending: close(127_951.29278690634216), unallocated: 0 })
    expect(mixed.state.prospectivePurchaseExactBalances).toEqual({ [TFSA]: atom('0') })
    expect(mixed.state.tfsaWithdrawalHistory).toEqual([
      { id: `annual:2029:withdrawal:${TFSA}`, personId: PARTNER, calendarYear: 2029, amount: visibleDebit },
    ])
    const sheet = canonicalAnnualSheet(mixed, CONTEXT)
    const memo = findRow(sheet.rows, canonicalSheetId('value', 'account', TFSA, 'primaryHomePurchaseWithdrawalReconciliation'))
    const details = sheet.resolveExplanation!(memo.cells![2029].explanationRefs![0])!
    const exactSource = details.sources!.find(source => source.field === 'primaryHomePurchaseExactWithdrawal')!
    for (const locale of ['en', 'fr', 'zh'] as const) {
      expect(annualSheetText(exactSource.displayReference!, locale)).toBe('115961.07501770634216')
    }
    const result = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(result.blocked).toMatchObject({ year: 2030, status: 'unsupported', causes: ['propertyPurchase'] })
    expect(result.uncomputedYears).toEqual([2031])
    expect(result.rows).toStrictEqual(mixed.rows)
    expect(result.state).toStrictEqual(mixed.state)
  })

  it('refuses a 0.00000000000001 CAD acquisition deficit after an exact mixed withdrawal', () => {
    const { plan, home, purchase, evidence } = fixture()
    Object.assign(plan.accounts[0], { balance: 100_000, realReturn: 0, annualFee: 0 })
    plan.inflation = 0.02
    for (const person of plan.people) person.earnedIncome = known(12_000)
    plan.budget = { kind: 'incomeBudget', workingSpending: 22_597.30, retirementSpending: 4_096 }
    evidence.workingSpending = known(22_597.30)
    evidence.transitionSpending = known(11_301.98)
    Object.assign(home, { value: 104_036.25, plannedDownPayment: 104_036.25, plannedPurchaseAge: 59 })
    purchase.effectiveYear = 2028
    purchase.priceNominal = known(104_036.25)
    purchase.qualifyingAcquisitionCostsNominal = known(0.28546800000001)

    // The mixed wage after CPP/EI is 11,298.65 real. Funding the 3.33
    // difference requires 3.3966 nominal. (102,000 − 3.3966) × 1.02 = 104,036.535468.
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(104_036.25 + 0.28546800000001).toBe(104_036.535468)
    const refused = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(refused.blocked).toMatchObject({ year: 2028, status: 'unsupported', causes: ['propertyPurchase'] })
    expect(refused.rows).toStrictEqual(prefix.rows)
    expect(refused.state).toStrictEqual(prefix.state)
    expect(refused.state.byProperty[HOME].held).toBe(false)
    expect(prefix.rows[1].householdWithdrawalSettlement).toMatchObject({ withdrawal: 3.3966, spendingUnmet: 0 })
    expect(prefix.state.prospectivePurchaseExactBalances).toEqual({ [TFSA]: atom('104036535468', 6) })
    expect(prefix.state.tfsaWithdrawalHistory).toEqual([
      { id: `annual:2027:withdrawal:${TFSA}`, personId: PARTNER, calendarYear: 2027, amount: 3.3966 },
    ])

    purchase.qualifyingAcquisitionCostsNominal = known(0.285468)
    const exact = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(exact.blocked).toBeNull()
    expect(exact.rows[2].retirementSettlement?.primaryHomePurchaseArithmetic?.totalCost).toEqual(atom('104036535468', 6))
    expect(exact.rows[2].householdWithdrawalSettlement).toMatchObject({ withdrawal: 104_036.535468, spendingFunded: 0 })
  })

  it('preserves ordinary CPP-funded living and owner history before an incompatible purchase is refused', () => {
    const { plan, home, evidence } = fixture()
    Object.assign(plan.accounts[0], { balance: 100_000, realReturn: 0, annualFee: 0 })
    plan.inflation = 0.02
    Object.assign(plan.people[0], { ageInBaseYear: 60, retirementAge: 62, earnedIncome: known(12_000) })
    Object.assign(plan.people[1], { ageInBaseYear: 61, retirementAge: 62, earnedIncome: known(12_000), cppAnnualAt65: 4_000 })
    plan.incomeSources = [cppStart(SELF, 62, 4_000)]
    plan.budget = { kind: 'incomeBudget', workingSpending: 22_597.30, retirementSpending: 10_000 }
    evidence.workingSpending = known(22_597.30)
    evidence.transitionSpending = known(15_434.65)
    evidence.retirementSpending = known(10_000)
    home.plannedPurchaseAge = 64
    const control = structuredClone(plan)
    control.properties = []
    delete control.annualPrimaryHomePurchaseEvidence
    const ordinary = ok(projectCanonicalCoverage(control, evidence, 3))
    expect(ordinary.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(result.blocked).toMatchObject({ year: YEAR, status: 'unsupported', causes: ['propertyPurchase'] })
    expect(result.rows).toHaveLength(3)
    const retired = result.rows[2]
    // 4,000 × (1 − 36 × .006) × 1.0404 = 3,262.6944 in CPP cash.
    // The remaining 10,404 − 3,262.6944 comes from this account owner.
    expect(retired.cashLedger).toMatchObject({ income: close(3_262.6944), tax: 0, spending: close(10_404), unallocated: 0 })
    expect(retired.byAccount[TFSA]).toMatchObject({ withdrawal: close(7_141.3056), closing: close(97_775.460288) })
    expect(result.rows.map(row => row.byAccount)).toStrictEqual(ordinary.rows.map(row => row.byAccount))
    expect(result.rows.map(row => row.cashLedger)).toStrictEqual(ordinary.rows.map(row => row.cashLedger))
    expect(result.state.tfsaWithdrawalHistory).toStrictEqual(ordinary.state.tfsaWithdrawalHistory)
    expect(result.state.tfsaWithdrawalHistory).toEqual([
      { id: `annual:2027:withdrawal:${TFSA}`, personId: PARTNER, calendarYear: 2027, amount: 1_020 },
      { id: `annual:2028:withdrawal:${TFSA}`, personId: PARTNER, calendarYear: 2028, amount: close(7_141.3056) },
    ])
    expect(result.state.prospectivePurchaseExactBalances).toBeUndefined()
  })

  it.each([69, 70])('retains the household age limit with purchase planned at self age %s', age => {
    const { plan, home, purchase, evidence } = fixture()
    Object.assign(plan.people[0], { ageInBaseYear: 65, retirementAge: 67 })
    Object.assign(plan.people[1], { ageInBaseYear: 66, retirementAge: 67 })
    plan.lifeExpectancy = 75
    home.plannedPurchaseAge = age
    purchase.effectiveYear = BASE_YEAR + age - 66
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(prefix.blocked).toBeNull()
    if (age === 69) {
      expect(prefix.rows[3].retirementSettlement?.primaryHomePurchase).toMatchObject({ year: 2029 })
      expect(prefix.state.byProperty[HOME].held).toBe(true)
    } else {
      expect(prefix.state.byProperty[HOME].held).toBe(false)
      expect(prefix.state.primaryHomePurchase).toBeUndefined()
    }
    const result = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(result.blocked).toMatchObject({ year: 2030, status: 'unsupported',
      issues: [{ detail: 'household working chain supports ages 19 through 69' }],
    })
    expect(result.rows).toStrictEqual(prefix.rows)
    expect(result.state).toStrictEqual(prefix.state)
  })
})

describe('household purchase annual sheet and entry points', () => {
  it.each(['purchase-year-nominal', 'base-year-real-indexed'] as const)(
    'explains %s, owner permission and nominal ACB in each locale', priceBasis => {
      const { plan, home, purchase, evidence } = fixture()
      const indexed = priceBasis === 'base-year-real-indexed'
      const price = indexed ? 170_859.375 : PRICE
      const costs = indexed ? 140.625 : 999.75
      // The indexed amount has more digits than the sheet cell can represent.
      // 120000.00000000001 × (9/8)^3 = 170859.37500000001423828125.
      if (indexed) Object.assign(home, { value: 120_000.00000000001, plannedDownPayment: 120_000.00000000001 })
      plan.annualPrimaryHomePurchaseEvidence![HOME].priceBasis = priceBasis
      purchase.priceNominal = known(price)
      purchase.qualifyingAcquisitionCostsNominal = known(costs)
      const result = ok(projectCanonicalCoverage(plan, evidence, 5))
      expect(result.blocked).toBeNull()
      const sheet = canonicalAnnualSheet(result, CONTEXT)
      const get = (...parts: string[]) => findRow(sheet.rows, canonicalSheetId('value', ...parts))
      const column = sheet.years.find(item => item.year === YEAR)!
      const group = findRow(sheet.rows, canonicalSheetId('group', 'primaryHomePurchase'))
      const fields = [['price', price], ['qualifyingAcquisitionCosts', costs], ['totalCost', 171_000], ['acb', 171_000], ['tax', 0]] as const
      expect(group.children?.map(row => row.id)).toEqual(fields.map(([field]) => canonicalSheetId('value', 'primaryHomePurchase', field)))
      for (const [field, nominal] of fields) {
        const row = get('primaryHomePurchase', field)
        const cell = row.cells![YEAR]
        expect(cell).toMatchObject({ value: nominal, basis: field === 'acb' ? 'nominal-tax-basis' : 'nominal-CAD' })
        expect(annualSheetDisplayValue(cell, column, 'nominal')).toBe(nominal)
        expect(annualSheetDisplayValue(cell, column, 'real')).toBeCloseTo(field === 'acb' ? nominal : nominal * 512 / 729, 8)
        for (const year of [2026, 2027, 2028, 2030]) expect(row.cells![year]).toMatchObject({ status: 'not-applicable', value: null })
      }
      const details = (...parts: string[]) => sheet.resolveExplanation!(get(...parts).cells![YEAR].explanationRefs![0])!
      const acb = details('primaryHomePurchase', 'acb')
      expect(acb.formula).toEqual([
        expect.objectContaining({ field: 'price', value: price, basis: 'nominal-tax-basis', direction: 'add' }),
        expect.objectContaining({ field: 'qualifyingAcquisitionCosts', value: costs, basis: 'nominal-tax-basis', direction: 'add' }),
      ])
      const source = (field: string) => acb.sources!.find(item => item.field === `annualPrimaryHomePurchaseEvidence.${field}`)!
      for (const [locale, heading, timing, title, owner, basis, indexedLabel, nominalLabel, titleMember, fundedAccount, priceReference] of [
        ['en', /primary residence purchase/i, /start of year/i, /household title/i, /actual TFSA owner/i, /nominal ACB/i,
          /exact CPI/i, /no price indexation/i, /Person 2.*100%/, /Person 1.*Account 1/, /purchase-year nominal/i],
        ['fr', /achat de résidence principale/i, /début d’année/i, /titre proposé du ménage/i, /titulaire réel du CELI/i, /PBR nominal/i,
          /IPC exact/i, /sans indexation/i, /Personne 2.*100\s%/, /Personne 1.*Compte 1/, /nominaux à l’achat|nominal de l’année d’achat/i],
        ['zh', /主要住所购入/, /年初/, /家庭产权/, /实际 TFSA 持有人/, /名义 ACB/,
          /精确 CPI/, /不再指数化/, /人员 2.*100%/, /人员 1.*账户 1/, /购房年名义/],
      ] as const) {
        expect(annualSheetText(group.label, locale)).toMatch(heading)
        expect(annualSheetText(acb.summary!, locale)).toMatch(timing)
        expect(annualSheetText(acb.summary!, locale)).toMatch(basis)
        for (const [field, evidenceLabel, referenceLabel] of [
          ['householdTitle', title, titleMember],
          ['fundingAuthorization', owner, fundedAccount],
        ] as const) {
          const evidenceSource = source(field)
          const label = annualSheetText(evidenceSource.label, locale)
          const reference = annualSheetText(evidenceSource.displayReference!, locale)
          const rendered = [label, reference].join(' ')
          expect(label).toMatch(evidenceLabel)
          expect(reference).toMatch(referenceLabel)
          expect(reference).toContain(String(BASE_YEAR))
          expect(rendered).not.toMatch(/[{}"]|accountId|ownerId|sourceYear|user-verified-title|household-primary-home-purchase/)
          for (const id of [SELF, PARTNER, HOME, TFSA]) expect(rendered).not.toContain(id)
        }
        expect(annualSheetText(source('priceBasis').label, locale)).toMatch(indexed ? indexedLabel : nominalLabel)
        expect(annualSheetText(source('priceBasis').displayReference!, locale)).toMatch(priceReference)
        const exactPrice = acb.sources!.find(item => item.field === 'primaryHomePurchaseArithmetic.price')!
        expect(annualSheetText(exactPrice.displayReference!, locale)).toBe(indexed ? '170859.37500000001423828125' : '170000.25')
      }
      const funded = details('retirement', 'spendingFunded')
      expect(funded.sources).toContainEqual(expect.objectContaining({
        field: 'annualPrimaryHomePurchaseEvidence.postPurchaseAnnualSpendingReal',
      }))
      expect(funded.formula).toContainEqual(expect.objectContaining({ field: 'primaryHomePurchase.totalCost', value: 171_000, direction: 'subtract' }))
      expect(funded.formula?.reduce((sum, term) => sum + (term.direction === 'subtract' ? -1 : 1) * (term.value ?? 0), 0)).toBe(729)
      expect(get('account', TFSA, 'withdrawal').cells![YEAR].value).toBe(171_729)
      expect(get('retirement', 'spendingDue').cells![YEAR].value).toBe(729)
      expect(annualSheetDisplayValue(get('retirement', 'spendingDue').cells![YEAR], column, 'real')).toBe(512)
      expect(get('netWorth').cells![YEAR].value).toBeCloseTo(price * 81 / 64 + 1_339.98046875, 8)
    },
  )

  it('formats split title shares in each locale without changing the recorded shares', () => {
    const { plan, home, purchase, evidence } = fixture()
    const shares = { [SELF]: 0.29, [PARTNER]: 0.71 }
    home.taxableOwnerShares = { status: 'known', shares }
    purchase.householdTitle.shares = { ...shares }
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.blocked).toBeNull()
    expect(result.state.primaryHomePurchase?.evidence.householdTitle?.shares).toEqual(shares)

    const sheet = canonicalAnnualSheet(result, CONTEXT)
    const cell = findRow(sheet.rows, canonicalSheetId('value', 'primaryHomePurchase', 'acb')).cells![YEAR]
    const detail = sheet.resolveExplanation!(cell.explanationRefs![0])!
    const source = detail.sources!.find(item => item.field === 'annualPrimaryHomePurchaseEvidence.householdTitle')!
    for (const [locale, displayedShares] of [
      ['en', /Person 2: 29%; Person 1: 71%/],
      ['fr', /Personne 2: 29\s%; Personne 1: 71\s%/],
      ['zh', /人员 2: 29%; 人员 1: 71%/],
    ] as const) {
      expect(annualSheetText(source.displayReference!, locale)).toMatch(displayedShares)
    }
  })

  it('retains solo purchase without household title or authorization', () => {
    const { plan, evidence, purchase } = fixture()
    plan.people = plan.people.filter(person => person.id === SELF)
    Object.assign(plan.accounts[0], { balance: 100_000, ownerId: SELF, taxableOwnerShares: { status: 'known', shares: { [SELF]: 1 } } })
    delete plan.tfsaStatement![PARTNER]
    const optIn = plan.annualPrimaryHomePurchaseEvidence![HOME]
    delete optIn.householdTitle
    delete optIn.fundingAuthorization
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.blocked).toBeNull()
    expect(result.rows[3].retirementSettlement?.primaryHomePurchase).toMatchObject({ year: YEAR, totalCost: 171_000, acb: 171_000 })
    expect(result.rows[3].householdWithdrawalSettlement).toBeUndefined()
    expect(result.state.tfsaWithdrawalHistory?.at(-1)).toMatchObject({ personId: SELF, amount: 171_729 })
    expect(result.state.primaryHomePurchase?.evidence).toEqual(purchase)
  })

  it('keeps household plans without opt-in on the pre-existing coverage boundary', () => {
    const { plan, evidence } = fixture()
    delete plan.annualPrimaryHomePurchaseEvidence
    const opening = ok(initializeState(plan))
    const result = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(result).toMatchObject({ rows: [], state: opening, blocked: { year: BASE_YEAR, status: 'unsupported',
      issues: [{ detail: 'household passive home requires one wholly household-owned held primary residence without debt, rent, purchase or holding cost changes' }],
    }, uncomputedYears: [2027, 2028, 2029, 2030] })
    const sheet = canonicalAnnualSheet(result, CONTEXT)
    expect(sheet.rows.some(row => row.id === canonicalSheetId('group', 'primaryHomePurchase'))).toBe(false)
  })

  it('keeps provider runs, direct pricing and standalone retirement outside the generated purchase path', () => {
    const { plan } = fixture()
    const withoutEvidence = structuredClone(plan)
    delete withoutEvidence.annualPrimaryHomePurchaseEvidence
    const providers = { evaluate: () => ({ byPerson: Object.fromEntries(plan.people.map(person => [person.id, {
      income: 0, earnedIncome: 0, benefits: 0, tax: 0, spending: 0, taxableIncome: 0, benefitIncomeForNextYear: known(0),
    }])) }), returns: () => 0 }
    for (const candidate of [plan, withoutEvidence]) {
      candidate.budget = { kind: 'savingsBudget', annualNetSavings: 0, retirementSpending: 0,
        debtIncluded: known(true), taxBenefitIncluded: known(true) }
      for (const person of candidate.people) person.retirementAge = 67
    }
    const supplied = ok(projectAnnualCoverage(plan, ok(initializeState(plan)), 5, providers))
    expect(supplied).toStrictEqual(ok(projectAnnualCoverage(withoutEvidence, ok(initializeState(withoutEvidence)), 5, providers)))
    expect(supplied).toMatchObject({ evaluationBasis: 'provider-supplied',
      blocked: { year: YEAR, status: 'unsupported', causes: ['propertyPurchase'] } })
    expect(supplied.state.primaryHomePurchase).toBeUndefined()
    expect(supplied.state.prospectivePurchaseExactBalances).toBeUndefined()
    expect(supplied.state.byProperty[HOME].held).toBe(false)

    const continuous = fixture()
    expect(evaluateCanonicalHouseholdWorkingYear(continuous.plan, continuous.evidence, BASE_YEAR).status).toBe('unsupported')
    for (const years of [3, 4]) {
      const opening = ok(projectCanonicalCoverage(continuous.plan, continuous.evidence, years)).state
      expect(annualRetirementContinuation(continuous.plan, opening, continuous.evidence).status).toBe('invalid')
      expect(annualRetirementStep(continuous.plan, structuredClone(opening)).status).toBe('invalid')
      expect(projectRetirementCoverage(continuous.plan, structuredClone(opening), 1).status).not.toBe('ok')
    }
    for (const person of continuous.plan.people) person.retirementAge = person.ageInBaseYear
    expect(projectCanonicalCoverage(continuous.plan, continuous.evidence, 5).status).toBe('unsupported')
  })

  it('preserves the traced legacy sheet and production fixed and sampled runs', () => {
    const { plan, home } = fixture()
    const inputs = legacyRetirement({ currentAge: 57, fireAge: 58, lifeExpectancy: 64, inflation: 0.125,
      balances: { tfsa: 350_000, rrsp: 0, nonReg: 0 }, retirementSpending: 4_096, strategy: 'tfsaFirst',
      principalResidence: { mode: 'planned', buyAtAge: 60, price: PRICE, downPayment: PRICE,
        appreciation: home.appreciation, netHoldingCostChange: 0, sellAtAge: null },
      partner: { currentAge: 59, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 } })
    plan.legacyProjection = inputs
    const control = structuredClone(plan)
    delete control.annualPrimaryHomePurchaseEvidence
    const reference = runProjection(inputs, undefined, control, { captureAnnualDetails: true })
    const traced = runProjection(inputs, undefined, plan, { captureAnnualDetails: true })
    expect(reference.rows[3].purchaseFunding).toBeDefined()
    expect(traced).toStrictEqual(reference)
    expect(legacyAnnualSheet(traced, inputs, CONTEXT).rows).toStrictEqual(legacyAnnualSheet(reference, inputs, CONTEXT).rows)
    expect(runProjection(inputs, undefined, plan)).toStrictEqual(runProjection(inputs, undefined, control))
    const sample = vi.fn(() => -0.03)
    const referenceSample = vi.fn(() => -0.03)
    expect(runProjection(inputs, sample, plan)).toStrictEqual(runProjection(inputs, referenceSample, control))
    expect(sample).toHaveBeenCalled()
    expect(sample.mock.calls).toEqual(referenceSample.mock.calls)
  })
})

describe('household purchase admission and isolation', () => {
  type Fixture = ReturnType<typeof fixture>
  const refusals: [string, (input: Fixture) => void][] = [
    ['solo purchase terms only', ({ plan }) => {
      delete plan.annualPrimaryHomePurchaseEvidence![HOME].householdTitle
      delete plan.annualPrimaryHomePurchaseEvidence![HOME].fundingAuthorization
    }],
    ['a mismatched title', ({ purchase }) => { purchase.householdTitle.shares = { [PARTNER]: 1 } }],
    ['a title proof with an extra zero entry', ({ purchase }) => { purchase.householdTitle.shares[PARTNER] = 0 }],
    ['future-dated title evidence', ({ plan }) => {
      plan.annualPrimaryHomePurchaseEvidence![HOME].householdTitle!.provenance = { ...recorded, sourceYear: YEAR }
    }],
    ['an inherited title verification', ({ purchase }) => {
      Reflect.deleteProperty(purchase.householdTitle, 'verified')
      Object.setPrototypeOf(purchase.householdTitle, { verified: true })
    }],
    ['authorization from the title owner instead of the account owner', ({ purchase }) => {
      purchase.fundingAuthorization.ownerId = SELF
    }],
    ['authorization for a different account', ({ purchase }) => { purchase.fundingAuthorization.accountId = TFSA + '#' }],
    ['authorization without a date', ({ purchase }) => { Reflect.deleteProperty(purchase.fundingAuthorization, 'provenance') }],
    ['a description of authorization without affirmative permission', ({ purchase }) => {
      Reflect.set(purchase.fundingAuthorization, 'authorized', false)
    }],
    ['an effective year on the wrong clock', ({ purchase }) => { purchase.effectiveYear = 2027 }],
    ['a positive quoted loan principal', ({ home }) => { home.plannedMortgage!.principal = 1 }],
    ['a scheduled payment on a zero-principal loan', ({ home }) => { home.plannedMortgage!.annualPayment = 1 }],
    ['unverified living expenses', ({ plan }) => {
      plan.annualPrimaryHomePurchaseEvidence![HOME].postPurchaseAnnualSpendingReal = { status: 'unknown', reason: 'Missing budget' }
    }],
  ]
  it.each(refusals)('preserves the opening snapshot with %s', (_, mutate) => {
    const input = fixture()
    mutate(input)
    const prefix = ok(projectCanonicalCoverage(input.plan, input.evidence, 3))
    expect(prefix.blocked).toBeNull()
    const stopped = ok(projectCanonicalCoverage(input.plan, input.evidence, 6))
    expect(stopped).toMatchObject({ blocked: { year: YEAR, status: 'unsupported', causes: ['propertyPurchase'] },
      uncomputedYears: [2030, 2031] })
    expect(stopped.rows).toStrictEqual(prefix.rows)
    expect(stopped.state).toStrictEqual(prefix.state)
    expect(stopped.state.byProperty[HOME].held).toBe(false)
  })

  it.each([
    ['missing', null],
    ['estimated and undated', { origin: 'estimated', sourceYear: null }],
    ['user supplied and undated', { origin: 'user', sourceYear: null }],
    ['future dated', { origin: 'user', sourceYear: BASE_YEAR + 1 }],
    ['legacy', { origin: 'legacy', sourceYear: BASE_YEAR }],
  ] as const)('refuses a purchase-only debit when the actual owner statement is %s', (_, provenance) => {
    const { plan, evidence, purchase } = fixture()
    if (provenance) plan.tfsaStatement![PARTNER].provenance = provenance
    else delete plan.tfsaStatement![PARTNER]
    evidence.transitionSpending = known(0)
    evidence.retirementSpending = known(0)
    plan.budget = { kind: 'incomeBudget', workingSpending: 0, retirementSpending: 0 }
    purchase.postPurchaseAnnualSpendingReal = known(0)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(prefix.blocked).toBeNull()
    expect(prefix.state.tfsaWithdrawalHistory).toEqual([])
    expect(prefix.rows[2].byAccount[TFSA].closing).toBe(182_250)
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(stopped.blocked).toMatchObject({ year: YEAR, status: 'unsupported' })
    expect(stopped.blocked?.issues.map(issue => issue.detail).join(' ')).toMatch(/TFSA.*statement|statement.*TFSA/i)
    expect(stopped.rows).toStrictEqual(prefix.rows)
    expect(stopped.state).toStrictEqual(prefix.state)
  })

  it('preserves ordinary living draws with an estimated statement until the purchase requires verified evidence', () => {
    const { plan, evidence } = fixture()
    plan.tfsaStatement![PARTNER].provenance = { origin: 'estimated', sourceYear: null }
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(prefix.blocked).toBeNull()
    expect(prefix.state.tfsaWithdrawalHistory?.map(event => event.amount)).toEqual([1_152, 5_184])
    const result = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(result.blocked).toMatchObject({ year: YEAR, causes: ['propertyPurchase'] })
    const detail = result.blocked?.issues[0].detail
    expect(detail).toMatch(/dated user/i)
    expect(detail).toMatch(/TFSA statement|statement.*TFSA/i)
    expect(result.rows).toStrictEqual(prefix.rows)
    expect(result.state).toStrictEqual(prefix.state)
  })

  it('keeps an empty second ordinary TFSA inert through the one-recorded-account purchase boundary', () => {
    const { plan, evidence } = fixture()
    const EMPTY = 'empty-ordinary-tfsa'
    plan.accounts.unshift({ ...structuredClone(plan.accounts[0]), id: EMPTY, ownerId: SELF,
      balance: 0, taxableOwnerShares: { status: 'known', shares: { [SELF]: 1 } } })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(prefix.blocked).toBeNull()
    for (const row of prefix.rows) {
      expect(row.byAccount[EMPTY]).toMatchObject({ ownerId: SELF, contribution: 0, withdrawal: 0, closing: 0 })
    }
    const result = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(result.blocked).toMatchObject({ year: YEAR, causes: ['propertyPurchase'] })
    expect(result.rows).toStrictEqual(prefix.rows)
    expect(result.state).toStrictEqual(prefix.state)
    expect(result.state.byProperty[HOME].held).toBe(false)
  })

  it.each([57, 58])('refuses reached purchases at self age %s while a member is working', age => {
    const { plan, home, purchase, evidence } = fixture()
    home.plannedPurchaseAge = age
    purchase.effectiveYear = BASE_YEAR + age - 57
    const prefix = ok(projectCanonicalCoverage(plan, evidence, age - 57))
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(stopped.blocked).toMatchObject({ year: purchase.effectiveYear, status: 'unsupported', causes: ['propertyPurchase'] })
    expect(stopped.rows).toStrictEqual(prefix.rows)
    expect(stopped.state).toStrictEqual(prefix.state)
  })

  it('does not spend unallocated positive working cash on the future purchase', () => {
    const { plan, evidence } = fixture()
    const self = plan.people.find(person => person.role === 'self')!
    self.earnedIncome = known(12_000)
    // Zero household spending leaves $11,298.65 after CPP/EI. The existing
    // household contribution rule does not attribute that surplus to an owner.
    const opening = ok(initializeState(plan))
    const result = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(result.blocked).toMatchObject({ year: BASE_YEAR, causes: ['contributionAttribution'] })
    expect(result.rows).toEqual([])
    expect(result.state).toStrictEqual(opening)
  })

  it('carries returns and an owner debit only after settling actual working wages and payroll', () => {
    const { plan, evidence } = fixture()
    for (const person of plan.people) person.earnedIncome = known(12_000)
    plan.budget = { kind: 'incomeBudget', workingSpending: 22_597.30, retirementSpending: 4_096 }
    evidence.workingSpending = known(22_597.30)
    evidence.transitionSpending = known(12_322.65)
    // Each wage nets 11,298.65 after 701.35 in CPP/EI.
    // The mixed deficit is (12,322.65 − 11,298.65) × 9/8 = 1,152.
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.blocked).toBeNull()
    const [working, mixed, retired, bought] = result.rows
    expect(working.cashLedger).toMatchObject({ income: 24_000, tax: 0, spending: 22_597.30, voluntaryContributions: 0 })
    expect(working.payrollContributions).toBeCloseTo(1_402.70, 8)
    expect(mixed.cashLedger).toMatchObject({ income: 13_500, tax: 0, spending: close(13_862.98125), voluntaryContributions: 0 })
    expect(mixed.byPerson[SELF].income).toBe(0)
    expect(mixed.byPerson[PARTNER].income).toBe(13_500)
    expect(mixed.payrollContributions).toBeCloseTo(789.01875, 8)
    expect(mixed.householdWithdrawalSettlement).toMatchObject({ ownerId: PARTNER, withdrawal: 1_152, spendingUnmet: 0 })
    expect(result.rows.map(row => row.byAccount[TFSA].contribution)).toEqual([0, 0, 0, 0])
    expect(retired.byAccount[TFSA].closing).toBe(172_681.875)
    expect(bought.householdWithdrawalSettlement?.withdrawal).toBe(171_729)
  })

  it('handles literal prototype-like property and account IDs in the opted-in flow', () => {
    const { plan, evidence } = fixture({ self: SELF, partner: PARTNER, tfsa: '__proto__', home: '__proto__' })
    const result = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(result.blocked).toBeNull()
    expect(Object.keys(result.state.byAccount)).toEqual(['__proto__'])
    expect(Object.keys(result.state.byProperty)).toEqual(['__proto__'])
    expect(Object.entries(result.rows[3].retirementSettlement?.primaryHomePurchaseArithmetic?.withdrawals ?? {}))
      .toEqual([['__proto__', atom('171000')]])
    expect(result.rows[3].householdWithdrawalSettlement?.postings).toEqual([
      { accountId: '__proto__', ownerId: PARTNER, kind: 'tfsa', amount: 171_729 },
    ])
    const sheet = canonicalAnnualSheet(result, CONTEXT)
    const account = findRow(sheet.rows, canonicalSheetId('value', 'account', '__proto__', 'withdrawal'))
    const home = findRow(sheet.rows, canonicalSheetId('value', 'property', '__proto__', 'closing'))
    expect(account.id).not.toBe(home.id)
    expect(account.cells![YEAR].value).toBe(171_729)
    expect(home.cells![YEAR].value).toBe(215_156.56640625)
  })
})
