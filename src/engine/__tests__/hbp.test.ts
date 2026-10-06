import { describe, expect, it } from 'vitest'
import { DEFAULT_INPUTS, DEFAULT_PARTNER } from '../../store'
import { HBP_LIMIT_PER_BUYER, hbpBuyers, hbpGraceYears, hbpLimitFor, planPurchaseFunding } from '../funding'
import { applyAccountSplit, refreshCanonicalFromLegacy } from '../migration'
import { personProjectionTax } from '../personProjectionTax'
import { runProjection } from '../projection'
import type { Inputs, PlannedResidence } from '../types'

const home = (downPayment: number, extra: Partial<PlannedResidence> = {}): PlannedResidence => ({
  mode: 'planned', buyAtAge: 41, price: downPayment, downPayment, appreciation: 0,
  netHoldingCostChange: 0, sellAtAge: null, ...extra,
})
const zero = { returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, fees: 0, nonRegDistributionYield: 0, inflation: 0 }
const funds = (rrsp: number, hbpLimit: number) => ({
  balances: { tfsa: 0, rrsp, nonReg: 0 }, fhsaBalance: 0, nonRegBook: 0, marginalRate: 0.35,
  annualSavings: 0, firstYearCost: 0, hbpLimit,
})

describe("BE-47 Home Buyers' Plan", () => {
  it('takes the RRSP part of a down payment tax-free up to the limit', () => {
    expect(HBP_LIMIT_PER_BUYER).toBe(60_000)
    const plan = planPurchaseFunding(home(50_000), 41, funds(100_000, 60_000))
    expect(plan.allocation).toMatchObject({ hbpWithdrawal: 50_000, rrspWithdrawal: 0, withdrawalTax: 0 })
    expect(plan.allocation!.balances.rrsp).toBe(50_000)
  })

  it('taxes only what goes past the limit, grossed up at the marginal rate', () => {
    // 80,000 down: 60,000 under the HBP, then 20,000 net needs 20,000 / 0.65 gross.
    const plan = planPurchaseFunding(home(80_000), 41, funds(200_000, 60_000))
    expect(plan.allocation!.hbpWithdrawal).toBe(60_000)
    expect(plan.allocation!.rrspWithdrawal).toBeCloseTo(20_000 / 0.65, 2)
    expect(plan.allocation!.withdrawalTax).toBeCloseTo(20_000 / 0.65 * 0.35, 2)
  })

  it('repays 1/15 a year into the RRSP from savings once the grace period ends', () => {
    const inputs: Inputs = { ...DEFAULT_INPUTS, inflation: 0, currentAge: 40, fireAge: 60, lifeExpectancy: 62,
      annualSavings: 10_000, savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 },
      balances: { tfsa: 0, rrsp: 100_000, nonReg: 0 }, nonRegBook: 0,
      returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, fees: 0, nonRegDistributionYield: 0,
      principalResidence: home(50_000) }
    const rows = runProjection(inputs).rows
    const at = (age: number) => rows.find(row => row.age === age)!
    // Bought at 41: the 10,000 saved at 40 in the TFSA goes first (fixed
    // order), then 40,000 of HBP money from the RRSP, with no tax on it.
    expect(at(41).purchaseFunding?.grossWithdrawals).toEqual({ tfsa: 10_000, nonReg: 0, rrsp: 40_000 })
    expect(at(41).balances.rrsp).toBeCloseTo(60_000, 6)
    // Withdrawn in 2027, so CRA's temporary relief starts repaying in 2032 (age 46).
    expect(at(45).balances.rrsp).toBeCloseTo(60_000, 6)
    expect(at(46).balances.rrsp).toBeCloseTo(60_000 + 40_000 / 15, 6)
    expect(at(46).balances.tfsa - at(45).balances.tfsa).toBeCloseTo(10_000 - 40_000 / 15, 6)
    // Without the plan the same purchase pays tax on a grossed-up withdrawal.
    const taxed = runProjection({ ...inputs, principalResidence: home(50_000, { hbp: false }) }).rows
    expect(taxed.find(row => row.age === 41)!.balances.rrsp).toBeLessThan(60_000)
  })

  it('starts repaying in the fifth following year for a first withdrawal from 2022 to 2028, else the second', () => {
    expect([2021, 2022, 2026, 2028, 2029].map(hbpGraceYears)).toEqual([2, 5, 5, 5, 2])
  })
})

describe("BE-47 review: each buyer's own RRSP and limit", () => {
  const couple: Inputs = { ...DEFAULT_INPUTS, ...zero, currentAge: 40, fireAge: 60, lifeExpectancy: 62, annualSavings: 0,
    partner: { ...DEFAULT_PARTNER, currentAge: 40 }, balances: { tfsa: 0, rrsp: 200_000, nonReg: 0 }, nonRegBook: 0,
    principalResidence: home(100_000, { buyAtAge: 40 }) }

  it('does not lend a partner’s unused limit to the other’s RRSP', () => {
    const plan = refreshCanonicalFromLegacy(null, couple)
    applyAccountSplit(plan, 'legacy:account:rrsp', 200_000, 0)
    expect(hbpLimitFor(hbpBuyers(200_000, true, plan))).toBe(60_000)
    // 40,000 of the 100,000 down payment is a taxable withdrawal, grossed up at 35%.
    expect(runProjection(couple, undefined, plan).rows[0].purchaseFunding?.withdrawalTax).toBeCloseTo(40_000 / 0.65 * 0.35, 4)
  })

  it('lets two buyers who each hold an RRSP withdraw up to the limit each', () => {
    const plan = refreshCanonicalFromLegacy(null, couple)
    applyAccountSplit(plan, 'legacy:account:rrsp', 100_000, 100_000)
    expect(hbpBuyers(200_000, true, plan).map(buyer => buyer.capacity)).toEqual([100_000, 100_000])
    expect(runProjection(couple, undefined, plan).rows[0].purchaseFunding?.withdrawalTax).toBe(0)
  })

  it('assumes one buyer when the plan does not say whose RRSP it is', () => {
    expect(hbpBuyers(200_000, true)).toEqual([{ personId: null, capacity: 200_000 }])
    expect(runProjection(couple).rows[0].purchaseFunding?.withdrawalTax).toBeCloseTo(40_000 / 0.65 * 0.35, 4)
  })
})

describe('BE-47 review: an unpaid instalment', () => {
  const single = (rrsp: number): Inputs => ({ ...DEFAULT_INPUTS, ...zero, currentAge: 40, fireAge: 60, lifeExpectancy: 62,
    partner: undefined, annualSavings: 0, balances: { tfsa: 0, rrsp, nonReg: 0 }, nonRegBook: 0,
    principalResidence: home(60_000, { buyAtAge: 40 }) })

  it('pays its tax from liquid assets with a gross-up, never from a negative account', () => {
    // 4,000 is included in income from 45; its 1,400 tax is raised by selling 1,400 / 0.65 of RRSP.
    const rows = runProjection(single(200_000)).rows
    const at = (age: number) => rows.find(row => row.age === age)!
    expect(at(45).balances.nonReg).toBe(0)
    expect(at(44).balances.rrsp - at(45).balances.rrsp).toBeCloseTo(1_400 / 0.65, 6)
    expect(at(45).unfundedObligations).toEqual([])
  })

  it('is a funding gap when nothing is left to pay the tax', () => {
    const row = runProjection(single(60_000)).rows.find(row => row.age === 45)!
    expect(row.balances.nonReg).toBe(0)
    expect(row.unfundedObligations).toEqual([{ eventId: 'hbp:45', field: 'principalResidence.hbp', amount: 1_400, reason: 'hbpRepaymentTax' }])
  })

  it('is taxed on the borrower’s own return in the person ledger', () => {
    const inputs: Inputs = { ...single(600_000), currentAge: 65, fireAge: 65, lifeExpectancy: 70, cppStartAge: 70, oasStartAge: 70,
      extraIncome: null, retirementSpending: 30_000, principalResidence: null }
    const plan = refreshCanonicalFromLegacy(null, inputs)
    const self = plan.people.find(person => person.role === 'self')!.id
    const facts = { plan, inputs, year: plan.baseYear, selfAge: 65, withdrawals: { rrsp: 30_000, nonReg: 0 },
      registeredBalance: 600_000, nonRegGainFraction: 0, nonRegDistributions: 0, rent: 0, otherWork: 0,
      oasGross: [0], purchaseRrspWithdrawal: 0, purchaseNonRegTaxable: 0, propertySaleTaxable: 0 }
    const without = personProjectionTax(facts)
    const withInstalment = personProjectionTax({ ...facts, hbpIncome: [{ personId: self, amount: 4_000 }] })
    expect(without.status).toBe('ok')
    expect(withInstalment.status).toBe('ok')
    if (without.status !== 'ok' || withInstalment.status !== 'ok') return
    expect(withInstalment.tax.byPerson[self].taxableIncome - without.tax.byPerson[self].taxableIncome).toBeCloseTo(4_000, 6)
    expect(withInstalment.tax.total).toBeGreaterThan(without.tax.total)
    expect(personProjectionTax({ ...facts, hbpIncome: [{ personId: null, amount: 4_000 }] }))
      .toEqual({ status: 'unsupported', reason: "Home Buyers' Plan borrower is not recorded" })
  })
})

describe('BE-47 review round 2', () => {
  it('gives a recorded RRIF no HBP capacity, and a mixed couple only the RRSP owner’s share', () => {
    const single: Inputs = { ...DEFAULT_INPUTS, ...zero, currentAge: 60, fireAge: 60, lifeExpectancy: 62, partner: undefined,
      balances: { tfsa: 0, rrsp: 200_000, nonReg: 0 }, nonRegBook: 0, principalResidence: home(60_000, { buyAtAge: 60 }) }
    const rrifPlan = refreshCanonicalFromLegacy(null, single)
    const account = rrifPlan.accounts.find(item => item.id === 'legacy:account:rrsp')!
    account.kind = 'rrif'
    expect(hbpBuyers(200_000, false, rrifPlan)).toEqual([])
    expect(hbpLimitFor(hbpBuyers(200_000, false, rrifPlan))).toBe(0)

    const couple: Inputs = { ...single, partner: { ...DEFAULT_PARTNER, currentAge: 60 }, balances: { tfsa: 0, rrsp: 210_000, nonReg: 0 } }
    const mixed = refreshCanonicalFromLegacy(null, couple)
    applyAccountSplit(mixed, 'legacy:account:rrsp', 200_000, 10_000)
    const selfAccount = mixed.accounts.find(item => item.ownerId === mixed.people.find(person => person.role === 'self')!.id && item.balance === 200_000)!
    selfAccount.kind = 'rrif'
    const buyers = hbpBuyers(210_000, true, mixed)
    expect(buyers).toHaveLength(1)
    expect(buyers[0].capacity).toBeCloseTo(10_000, 6)
    expect(hbpLimitFor(buyers)).toBeCloseTo(10_000, 6)
  })

  it('gives no capacity to an RRSP owner past the year they turn 71', () => {
    const plan = refreshCanonicalFromLegacy(null, { ...DEFAULT_INPUTS, currentAge: 70, partner: undefined, balances: { tfsa: 0, rrsp: 100_000, nonReg: 0 } })
    expect(hbpLimitFor(hbpBuyers(100_000, false, plan, plan.baseYear + 1))).toBe(60_000)
    expect(hbpBuyers(100_000, false, plan, plan.baseYear + 2)).toEqual([])
  })

  it('owes each instalment in nominal dollars, deflated to the row’s real dollars', () => {
    const inputs: Inputs = { ...DEFAULT_INPUTS, ...zero, inflation: 0.021, currentAge: 40, fireAge: 60, lifeExpectancy: 62,
      partner: undefined, annualSavings: 20_000, savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 },
      balances: { tfsa: 0, rrsp: 200_000, nonReg: 0 }, nonRegBook: 0, principalResidence: home(60_000, { buyAtAge: 40 }) }
    const rows = runProjection(inputs).rows
    const at = (age: number) => rows.find(row => row.age === age)!
    // 4,000 a year is owed in dollars; in 2031 that is 4,000 / 1.021^5 of 2026 purchasing power.
    expect(at(45).balances.rrsp - at(44).balances.rrsp).toBeCloseTo(4_000 / 1.021 ** 5, 6)
    expect(at(46).balances.rrsp - at(45).balances.rrsp).toBeCloseTo(4_000 / 1.021 ** 6, 6)
  })
})

describe('BE-47 review round 3', () => {
  it('caps a future purchase at 60,000 dollars, not 60,000 of today’s purchasing power', () => {
    const inputs: Inputs = { ...DEFAULT_INPUTS, ...zero, inflation: 0.021, currentAge: 40, fireAge: 60, lifeExpectancy: 62,
      partner: undefined, annualSavings: 0, balances: { tfsa: 0, rrsp: 200_000, nonReg: 0 }, nonRegBook: 0,
      principalResidence: home(60_000, { buyAtAge: 45 }) }
    const row = runProjection(inputs).rows.find(item => item.age === 45)!
    // 60,000 in 2031 is 54,078.24 of 2026 purchasing power; the rest is a taxable, grossed-up withdrawal.
    const capReal = 60_000 / 1.021 ** 5
    expect(capReal).toBeCloseTo(54_078.24, 2)
    expect(row.purchaseFunding!.withdrawalTax).toBeCloseTo((60_000 - capReal) / 0.65 * 0.35, 4)
  })

  it('includes an HBP balance still owed at death on the final return', () => {
    const inputs: Inputs = { ...DEFAULT_INPUTS, ...zero, province: 'ON', currentAge: 60, fireAge: 60, lifeExpectancy: 60,
      partner: undefined, pension: undefined, children: [], debts: [], investmentProperties: [], extraIncome: null,
      cppStartAge: 70, oasStartAge: 70, retirementSpending: 0, annualSavings: 0,
      balances: { tfsa: 0, rrsp: 200_000, nonReg: 0 }, nonRegBook: 0, principalResidence: home(60_000, { buyAtAge: 60 }) }
    const result = runProjection(inputs)
    expect(result.rows[0].balances.rrsp).toBeCloseTo(140_000, 6)
    // The 60,000 still owed is income on the final return, as if 200,000 of RRSP were left.
    const asIfRegistered = runProjection({ ...inputs, principalResidence: null }).estateTax
    expect(result.estateTax).toBeCloseTo(asIfRegistered, 6)
    expect(result.estateTax).toBeCloseTo(64_721.98, 2)
  })
})
