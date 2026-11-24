import { describe, expect, it } from 'vitest'
import { projectCanonicalCoverage, type KernelResult } from '../annualState'
import { calculateHouseholdTax } from '../householdTax'
import { sideIncomeDeductions } from '../payroll'
import { householdRrspFixture, householdRrspReference as rrsp } from './fixtures/householdRrsp'
import { BASE_YEAR, known, RETIREE, RRSP, TFSA } from './fixtures/retirementSettlement'
import { PARTNER, staggeredReference as staggered } from './fixtures/staggeredHousehold'

const mixedYear = BASE_YEAR + 1
const retiredYear = BASE_YEAR + 2
const mixedCpi = 1.02
const retiredCpi = 1.02 ** 2
const moneyLimit = Number.MAX_SAFE_INTEGER / 100
const close = (amount: number) => expect.closeTo(amount, 7)

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function extremeWageFixture(rrspBalance: number, changeSpending: (wageNet: number) => number) {
  const { plan, evidence } = householdRrspFixture({ owner: PARTNER, rrspBalance })
  plan.inflation = 0
  plan.legacyProjection.inflation = 0
  plan.people[0].earnedIncome = known(0)
  plan.people[1].earnedIncome = known(moneyLimit)
  const payroll = sideIncomeDeductions(moneyLimit, 'employment', 'ON', 54)
  // Set a break-even opening year from the standard wage-only tax path. The
  // assertion in each test concerns only what the new RRSP draw may commit.
  const wageOnly = calculateHouseholdTax(plan, BASE_YEAR, [
    { id: 'fixture-wage', personId: PARTNER, kind: 'employment', amount: moneyLimit },
  ], { payroll: { [PARTNER]: payroll } })
  if (wageOnly.status !== 'ok') throw new Error(wageOnly.reason)
  const wageNet = moneyLimit - payroll.contributions - wageOnly.total
  if (plan.budget.kind !== 'incomeBudget') throw new Error('Expected an income budget')
  plan.budget.workingSpending = wageNet
  evidence.workingSpending = known(wageNet)
  const transitionSpending = changeSpending(wageNet)
  evidence.transitionSpending = known(transitionSpending)
  return { plan, evidence, wageNet, transitionSpending }
}

describe('canonical household ordinary RRSP withdrawals', () => {
  it.each(['missing statement', 'two funded accounts', 'valid statement'] as const)('reaches a later TFSA with %s only for a true RRSP shortfall', scenario => {
    const { plan, evidence } = householdRrspFixture({ tfsaBalance: 1_000, rrspBalance: 1_000 })
    if (scenario === 'missing statement') delete plan.tfsaStatement![RETIREE]
    if (scenario === 'two funded accounts') {
      const tfsa = plan.accounts.find(account => account.id === TFSA)!
      plan.accounts.push({ ...structuredClone(tfsa), id: 'partner-tfsa', ownerId: PARTNER,
        taxableOwnerShares: { status: 'known', shares: { [PARTNER]: 1 } } })
    }
    // A $1,000 real draw loses $140 of federal spouse credit. The Ontario
    // spouse amount stays at its maximum below $1,103 of spouse income.
    const exactSpending = staggered.mixed.spending + 860
    evidence.transitionSpending = known(exactSpending)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    const exact = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(exact.blocked).toBeNull()
    expect(exact.rows[1]).toMatchObject({
      householdWithdrawalSettlement: { withdrawal: 1_020, spendingDue: close(exactSpending * mixedCpi),
        spendingFunded: close(exactSpending * mixedCpi), spendingUnmet: 0, taxIncrement: close(142.8),
        postings: [{ accountId: RRSP, ownerId: RETIREE, kind: 'rrsp', amount: 1_020 }] },
      byAccount: { [RRSP]: { opening: 1_020, closing: 0 }, [TFSA]: { withdrawal: 0, closing: close(1_040.4) } },
    })
    expect(exact.state.tfsaWithdrawalHistory).toEqual([])

    evidence.transitionSpending = known(exactSpending + 0.01 / mixedCpi)
    if (scenario === 'valid statement') {
      const covered = ok(projectCanonicalCoverage(plan, evidence, 2))
      expect(covered.blocked).toBeNull()
      expect(covered.rows[1]).toMatchObject({
        householdWithdrawalSettlement: { spendingUnmet: 0, postings: [
          { accountId: RRSP, ownerId: RETIREE, kind: 'rrsp', amount: 1_020 },
          { accountId: TFSA, ownerId: RETIREE, kind: 'tfsa', amount: close(0.01) },
        ] },
        byAccount: { [TFSA]: { withdrawal: close(0.01) } },
      })
      return
    }
    const short = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(short.rows).toEqual(prefix.rows)
    expect(short.state).toEqual(prefix.state)
    expect(short).toMatchObject({ blocked: { year: mixedYear, status: 'unsupported',
      causes: [scenario === 'missing statement' ? 'tfsaWithdrawalEvidence' : 'withdrawalOwnership'] }, uncomputedYears: [retiredYear] })
  })

  it('rejects an unpriceable small RRSP draw at extreme wages or settles it without a false shortfall', () => {
    const { plan, evidence, wageNet, transitionSpending } = extremeWageFixture(0.125, net => net + 0.015625)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    if (result.blocked) {
      expect(result.blocked.year).toBe(mixedYear)
      expect(result.rows).toEqual(prefix.rows)
      expect(result.state).toEqual(prefix.state)
      return
    }
    const row = result.rows[1]
    const gap = transitionSpending - wageNet
    // Federal 33%, Ontario 13.16% plus both surtax layers, no change to CPP/EI.
    const gross = gap / (1 - 0.33 - 0.1316 * (1 + 0.2 + 0.36))
    expect(row.byAccount[RRSP].withdrawal).toBeCloseTo(gross, 5)
    expect(row.householdWithdrawalSettlement).toMatchObject({ taxIncrement: expect.closeTo(gross - gap, 5),
      spendingFunded: transitionSpending, spendingUnmet: 0 })
  })

  it('blocks before extreme wages plus the accepted RRSP draw can overflow taxable income or benefit lag', () => {
    const { plan, evidence } = extremeWageFixture(moneyLimit, () => moneyLimit)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result).toMatchObject({ rows: prefix.rows, state: prefix.state,
      blocked: { year: mixedYear }, uncomputedYears: [retiredYear], overallConclusionAvailable: false })
  })

  it.each([0, 0.01])('uses the quoted extreme-wage gap when $%s of TFSA cash is available', tfsaBalance => {
    const gap = 0.015625
    const { plan, evidence, wageNet } = extremeWageFixture(0, net => net + gap)
    plan.accounts.find(account => account.id === TFSA)!.balance = tfsaBalance
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    if (result.blocked) {
      expect(tfsaBalance).toBeGreaterThan(0)
      expect(result.blocked).toMatchObject({ year: mixedYear, status: 'unsupported',
        issues: [{ detail: expect.stringMatching(/cash precision/i) }] })
      expect(result.rows).toEqual(prefix.rows)
      expect(result.state).toEqual(prefix.state)
      return
    }
    expect(result.rows[1]).toMatchObject({ workingSettlement: { netCash: -gap },
      householdWithdrawalSettlement: { withdrawal: tfsaBalance, spendingDue: wageNet + gap,
        spendingUnmet: expect.closeTo(gap - tfsaBalance, 12) },
      byAccount: { [TFSA]: { withdrawal: tfsaBalance, closing: 0 } },
    })
    const settlement = result.rows[1].householdWithdrawalSettlement!
    expect(settlement.spendingFunded + settlement.spendingUnmet).toBe(settlement.spendingDue)
    expect(result.state.tfsaWithdrawalHistory).toEqual(tfsaBalance > 0
      ? [expect.objectContaining({ calendarYear: mixedYear, amount: tfsaBalance })] : [])
  })

  it.each([RETIREE, PARTNER] as const)('reprices mixed-year household tax with the ordinary RRSP assigned to %s', owner => {
    const { plan, evidence } = householdRrspFixture({ owner })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false })
    expect(result.rows[0]).toEqual(prefix.rows[0])
    const mixed = result.rows[1]
    const gross = (owner === RETIREE ? rrsp.mixedGross : rrsp.mixedWorkerGross) * mixedCpi
    const payroll = staggered.mixed.partner.payroll * mixedCpi
    const taxIncrement = owner === RETIREE ? rrsp.mixedIncrementalTax * mixedCpi : gross * (0.205 + 0.0915)
    const tax = staggered.mixed.partner.tax * mixedCpi + taxIncrement
    const due = (staggered.mixed.spending + rrsp.mixedGap) * mixedCpi
    const closing = (51_000 - gross) * 1.02

    expect(mixed).toMatchObject({ year: mixedYear, payrollContributions: close(payroll),
      workingSettlement: { startCpi: mixedCpi, netCash: close(-rrsp.mixedGap * mixedCpi), household: { phase: 'mixed' } },
      byPerson: {
        [RETIREE]: { earnedIncome: 0, taxableIncome: close(owner === RETIREE ? gross : 0), tax: 0 },
        [PARTNER]: { earnedIncome: 81_600, taxableIncome: close(staggered.mixed.partner.taxable * mixedCpi + (owner === PARTNER ? gross : 0)), tax: close(tax) },
      },
      taxLedger: { [PARTNER]: { tax: close(tax) }, [RETIREE]: { tax: 0 } },
      cashLedger: { income: 81_600, tax: close(tax), benefits: 0, spending: close(due), unallocated: 0 },
      byAccount: { [RRSP]: { ownerId: owner, opening: 51_000, withdrawal: close(gross), contribution: 0,
        returnAmount: close((51_000 - gross) * 0.02), closing: close(closing) } },
      householdWithdrawalSettlement: { accountId: RRSP, ownerId: owner, withdrawal: close(gross),
        postings: [{ accountId: RRSP, ownerId: owner, kind: 'rrsp', amount: close(gross) }],
        taxIncrement: close(taxIncrement), taxTotal: close(tax),
        spendingDue: close(due), spendingFunded: close(due), spendingUnmet: 0 },
    })
    expect(mixed.cashLedger.income + mixed.byAccount[RRSP].withdrawal - mixed.payrollContributions! - mixed.cashLedger.tax).toBeCloseTo(due, 7)
    expect(result.state).toMatchObject({ year: retiredYear, byAccount: { [RRSP]: { balance: close(closing) } },
      byPerson: { [RETIREE]: { previousYearEarnedIncome: known(0) }, [PARTNER]: { previousYearEarnedIncome: known(81_600) } },
      benefitIncomeLag: {
        [RETIREE]: { status: 'known', value: close(owner === RETIREE ? gross : 0) },
        [PARTNER]: { status: 'known', value: close(staggered.mixed.partner.taxable * mixedCpi + (owner === PARTNER ? gross : 0)) },
      },
      contributionHistory: [], tfsaWithdrawalHistory: [],
    })
  })

  it.each(['rrspFirst', 'nonRegFirst'] as const)('prices both-retired spending and carries the RRSP to exhaustion under %s', strategy => {
    const { plan, evidence } = householdRrspFixture({ strategy, rrspBalance: 44_000, mixedDeficit: false })
    plan.accounts = plan.accounts.filter(account => account.id !== TFSA)
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false })
    const retired = result.rows[2]
    const exhausted = result.rows[3]
    const gross = rrsp.retiredGross * retiredCpi
    const tax = rrsp.retiredTax * retiredCpi
    const due = rrsp.retiredSpending * retiredCpi
    const opening = 44_000 * retiredCpi
    const closing = (opening - gross) * 1.02

    expect(retired).toMatchObject({ year: retiredYear, payrollContributions: 0,
      workingSettlement: { startCpi: retiredCpi, household: { phase: 'both-retired' } },
      byPerson: {
        [RETIREE]: { earnedIncome: 0, taxableIncome: close(gross), tax: close(tax) },
        [PARTNER]: { earnedIncome: 0, taxableIncome: 0, tax: 0 },
      },
      cashLedger: { income: 0, tax: close(tax), spending: close(due) },
      byAccount: { [RRSP]: { ownerId: RETIREE, opening: close(opening), withdrawal: close(gross), closing: close(closing) } },
      householdWithdrawalSettlement: { withdrawal: close(gross), taxIncrement: close(tax), taxTotal: close(tax),
        spendingDue: close(due), spendingFunded: close(due), spendingUnmet: 0 },
    })
    // The carried $4,000 real has no income tax in the next retired year.
    expect(exhausted).toMatchObject({ year: retiredYear + 1, payrollContributions: 0,
      cashLedger: { income: 0, tax: 0, spending: close(closing) },
      byAccount: { [RRSP]: { opening: close(closing), withdrawal: close(closing), contribution: 0, returnAmount: 0, closing: 0 } },
      householdWithdrawalSettlement: { spendingDue: close(due * 1.02), spendingFunded: close(closing), spendingUnmet: close(due * 1.02 - closing) },
    })
    expect(result.state).toMatchObject({ byAccount: { [RRSP]: { balance: 0 } }, tfsaWithdrawalHistory: [] })
  })

  it.each(['rrspFirst', 'nonRegFirst'] as const)('uses TFSA cash after the RRSP exhausts under %s', strategy => {
    const { plan, evidence } = householdRrspFixture({ strategy, rrspBalance: 35_000, tfsaBalance: 8_000, mixedDeficit: false })
    // The full $35,000 RRSP draw is still in both first brackets, and the
    // Ontario health premium is $300 from $25,000 through $36,000.
    const tax = ((35_000 - 2 * 16_452) * 0.14 + (35_000 - 12_989 - 11_029) * 0.0505 + 300) * retiredCpi
    const rrspGross = 35_000 * retiredCpi
    const tfsaGross = rrsp.retiredSpending * retiredCpi - rrspGross + tax
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))

    expect(result.blocked).toBeNull()
    expect(result.rows[2]).toMatchObject({ year: retiredYear,
      cashLedger: { tax: close(tax), spending: close(rrsp.retiredSpending * retiredCpi) },
      householdWithdrawalSettlement: { taxIncrement: close(tax), taxTotal: close(tax), spendingUnmet: 0,
        postings: [{ accountId: RRSP, ownerId: RETIREE, kind: 'rrsp', amount: close(rrspGross) },
          { accountId: TFSA, ownerId: RETIREE, kind: 'tfsa', amount: close(tfsaGross) }] },
      byAccount: { [RRSP]: { opening: close(rrspGross), withdrawal: close(rrspGross), returnAmount: 0, closing: 0 },
        [TFSA]: { opening: close(8_000 * retiredCpi), withdrawal: close(tfsaGross), closing: close((8_000 * retiredCpi - tfsaGross) * 1.02) } },
    })
  })

  it('follows the selected account order and restores only the actual TFSA draw the following year', () => {
    const tfsaFirst = householdRrspFixture({ owner: PARTNER, tfsaBalance: 1_000, strategy: 'tfsaFirst' })
    const rrspFirst = householdRrspFixture({ owner: PARTNER, tfsaBalance: 1_000 })
    // Same mixed-year cash gap and owner. Net RRSP cash is gross less tax in
    // the worker's second federal and Ontario brackets.
    const tfsaGross = 1_020
    const rrspGross = (rrsp.mixedGap - 1_000) / (1 - 0.205 - 0.0915) * mixedCpi
    const wageTax = staggered.mixed.partner.tax * mixedCpi
    const due = (staggered.mixed.spending + rrsp.mixedGap) * mixedCpi
    const before = ok(projectCanonicalCoverage(rrspFirst.plan, rrspFirst.evidence, 3))
    // List order is immaterial. Put the selected TFSA after the RRSP.
    tfsaFirst.plan.accounts.reverse()
    const after = ok(projectCanonicalCoverage(tfsaFirst.plan, tfsaFirst.evidence, 3))
    expect(before.blocked).toBeNull()
    expect(after.blocked).toBeNull()
    expect(before.rows[1]).toMatchObject({ cashLedger: { spending: close(due) },
      byAccount: { [RRSP]: { withdrawal: close(rrsp.mixedWorkerGross * mixedCpi) }, [TFSA]: { withdrawal: 0, closing: close(1_040.4) } } })
    expect(after.rows[1]).toMatchObject({ cashLedger: { tax: close(wageTax + rrspGross + tfsaGross - rrsp.mixedGap * mixedCpi), spending: close(due) },
      householdWithdrawalSettlement: { accountId: null, ownerId: null, withdrawal: close(tfsaGross + rrspGross),
        postings: [{ accountId: TFSA, ownerId: RETIREE, kind: 'tfsa', amount: tfsaGross },
          { accountId: RRSP, ownerId: PARTNER, kind: 'rrsp', amount: close(rrspGross) }] },
      byAccount: { [RRSP]: { withdrawal: close(rrspGross), closing: close((51_000 - rrspGross) * 1.02) },
        [TFSA]: { opening: 1_020, withdrawal: 1_020, returnAmount: 0, closing: 0 } },
      tfsaLedger: { [RETIREE]: { restored: known(0) }, [PARTNER]: { restored: known(0) } },
    })
    expect(before.rows[2].tfsaLedger[RETIREE].restored).toEqual(known(0))
    expect(after.rows[2].tfsaLedger[RETIREE].restored).toEqual(known(1_020))
    expect(after.rows[2].tfsaLedger[PARTNER].restored).toEqual(known(0))
    expect(before.state.tfsaWithdrawalHistory).toEqual([])
    expect(after.state.tfsaWithdrawalHistory).toEqual([
      expect.objectContaining({ personId: RETIREE, calendarYear: mixedYear, amount: 1_020 }),
    ])
  })
})
