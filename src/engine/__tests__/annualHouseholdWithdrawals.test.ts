import { describe, expect, it, vi } from 'vitest'
import { annualSheetDisplayValue, annualSheetText } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { annualRetirementContinuation, annualRetirementStep } from '../annualRetirement'
import { annualStep, initializeState, isCanonicalGeneratedState, projectAnnualCoverage, projectCanonicalCoverage, projectFromState, type KernelResult } from '../annualState'
import { evaluateCanonicalHouseholdWorkingYear } from '../annualWorking'
import { runProjection } from '../projection'
import { phaseReference, phaseTransitionPlan, phaseTransitionSpending } from './fixtures/phaseTransition'
import { BASE_YEAR, known, RETIREE, RRSP, TFSA } from './fixtures/retirementSettlement'
import { PARTNER, staggeredHouseholdPlan, staggeredReference as ref, staggeredSpending } from './fixtures/staggeredHousehold'

const mixedYear = BASE_YEAR + 1
const retiredYear = BASE_YEAR + 2
const mixedShortfallReal = 250
const unknown = { status: 'unknown', reason: 'Spending evidence has not been recorded' } as const
const close = (value: number) => expect.closeTo(value, 8)

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function mixedDeficitFixture(retirementSpending = ref.retirementSpending, mixedShortfall = mixedShortfallReal) {
  const plan = staggeredHouseholdPlan()
  plan.strategy = 'tfsaFirst'
  plan.legacyProjection.strategy = 'tfsaFirst'
  if (plan.budget.kind !== 'incomeBudget') throw new Error('Expected an income budget')
  plan.budget.retirementSpending = retirementSpending
  const evidence = {
    ...staggeredSpending(),
    transitionSpending: known(ref.mixed.spending + mixedShortfall),
    retirementSpending: known(retirementSpending),
  }
  return { plan, evidence }
}

function addSecondFundedRrsp(plan: ReturnType<typeof staggeredHouseholdPlan>) {
  const partnerRrsp = plan.accounts.find(account => account.id === RRSP)!
  plan.accounts.push({ ...structuredClone(partnerRrsp), id: 'second-rrsp', ownerId: RETIREE,
    taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 1 } } })
}

describe('canonical household TFSA withdrawals', () => {
  it('funds the mixed-year gap with gross cash from the unique TFSA owner after payroll and tax', () => {
    const { plan, evidence } = mixedDeficitFixture()
    const working = ok(projectCanonicalCoverage(plan, evidence, 1))
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    const [work, mixed] = result.rows
    const openingCpi = 1.02
    const due = (63_162.87056 + 250) * openingCpi
    const grossWithdrawal = 255
    const wage = ref.mixed.partner.wage * openingCpi
    const payroll = ref.mixed.partner.payroll * openingCpi
    const tax = ref.mixed.partner.tax * openingCpi

    expect(result).toMatchObject({ evaluationBasis: 'canonical-continuous', blocked: null, uncomputedYears: [],
      overallConclusionAvailable: false, state: { year: retiredYear } })
    expect(work).toEqual(working.rows[0])
    expect(mixed).toMatchObject({
      year: mixedYear, payrollContributions: close(payroll),
      workingSettlement: { startCpi: openingCpi, netCash: close(-grossWithdrawal), household: { phase: 'mixed', spendingSource: 'transitionSpending' } },
      householdWithdrawalSettlement: { accountId: TFSA, ownerId: RETIREE, startCpi: openingCpi,
        withdrawal: close(grossWithdrawal), spendingDue: close(due), spendingFunded: close(due), spendingUnmet: 0 },
      byPerson: {
        [RETIREE]: { income: 0, earnedIncome: 0, taxableIncome: 0, tax: 0, spending: 0 },
        [PARTNER]: { income: wage, earnedIncome: wage, taxableIncome: close(ref.mixed.partner.taxable * openingCpi), tax: close(tax), spending: 0 },
      },
      cashLedger: { income: wage, tax: close(tax), benefits: 0, spending: close(due), unallocated: 0 },
      byAccount: {
        [TFSA]: { ownerId: RETIREE, opening: 1_020, contribution: 0, withdrawal: close(grossWithdrawal), returnAmount: close(15.3), closing: close(780.3) },
        [RRSP]: { ownerId: PARTNER, opening: 20_400, contribution: 0, withdrawal: 0, closing: close(20_808) },
      },
      tfsaLedger: { [RETIREE]: { restored: known(0) } },
    })
    const { income, benefits, spending, tax: postedTax } = mixed.cashLedger
    const preWithdrawalCash = income + benefits - mixed.payrollContributions! - postedTax - due
    expect(preWithdrawalCash).toBeCloseTo(-grossWithdrawal, 8)
    expect(income + benefits - mixed.payrollContributions! - postedTax + mixed.byAccount[TFSA].withdrawal - spending).toBeCloseTo(0, 8)
    expect(result.state.tfsaWithdrawalHistory).toEqual([
      expect.objectContaining({ personId: RETIREE, calendarYear: mixedYear, amount: close(grossWithdrawal) }),
    ])
    expect(result.state.contributionHistory).toEqual([])
    expect(result.state.byAccount[TFSA].balance).toBeCloseTo(780.3, 8)
  })

  it('honours TFSA-first through both-retired spending and draws the RRSP only for the remaining gap', () => {
    const { plan, evidence } = mixedDeficitFixture(400)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(prefix.blocked).toBeNull()
    const retired = prefix.rows[2]
    expect(retired).toMatchObject({ year: retiredYear,
      householdWithdrawalSettlement: { withdrawal: close(416.16), spendingFunded: close(416.16), spendingUnmet: 0 },
      byAccount: { [TFSA]: { closing: close(371.4228) }, [RRSP]: { withdrawal: 0, closing: close(21_224.16) } },
    })
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.rows.slice(0, 3)).toEqual(prefix.rows)
    expect(result).toMatchObject({ overallConclusionAvailable: false, blocked: null, uncomputedYears: [],
      state: { byAccount: { [TFSA]: { balance: 0 }, [RRSP]: { balance: close((21_224.16 - 53.0604) * 1.02) } } },
    })
    expect(result.rows[3]).toMatchObject({ year: retiredYear + 1,
      householdWithdrawalSettlement: { withdrawal: close(424.4832), spendingFunded: close(424.4832), spendingUnmet: 0 },
      cashLedger: { tax: 0, spending: close(424.4832) },
      byAccount: { [TFSA]: { withdrawal: close(371.4228), closing: 0 }, [RRSP]: { withdrawal: close(53.0604) } },
      tfsaLedger: { [RETIREE]: { restored: { status: 'known', value: close(416.16) } }, [PARTNER]: { restored: known(0) } },
    })
  })

  it('blocks a retired deficit atomically when two owners have funded RRSPs', () => {
    const { plan, evidence } = mixedDeficitFixture(1_000, 400)
    addSecondFundedRrsp(plan)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows[1].householdWithdrawalSettlement).toMatchObject({ withdrawal: close(408), spendingUnmet: 0 })
    expect(prefix.state.byAccount).toMatchObject({ [TFSA]: { balance: close(624.24) }, [RRSP]: { balance: close(20_808) } })
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.rows).toEqual(prefix.rows)
    expect(result.state).toEqual(prefix.state)
    expect(result).toMatchObject({ overallConclusionAvailable: false,
      blocked: { year: retiredYear, status: 'unsupported', causes: ['withdrawalOwnership'] },
      uncomputedYears: [retiredYear + 1],
    })
  })

  it('settles the exact mixed-year TFSA target and exposes ambiguous RRSP funding for a one-cent residual', () => {
    const { plan, evidence } = mixedDeficitFixture(1_000, 400)
    addSecondFundedRrsp(plan)
    const account = plan.accounts.find(account => account.id === TFSA)!
    // The $400 real shortfall and opening TFSA both become $408 nominal.
    // Subtraction against five-digit wage and spending terms can put the
    // computed shortfall a few trillionths above that opening balance.
    account.balance = 400
    const funded = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(funded.blocked).toBeNull()
    expect(funded.rows[1]).toMatchObject({ year: mixedYear,
      householdWithdrawalSettlement: { accountId: TFSA, ownerId: RETIREE, withdrawal: 408, spendingUnmet: 0,
        spendingDue: close((ref.mixed.spending + 400) * 1.02), spendingFunded: close((ref.mixed.spending + 400) * 1.02) },
      byAccount: { [TFSA]: { opening: 408, withdrawal: 408, returnAmount: 0, closing: 0 },
        [RRSP]: { opening: 20_400, withdrawal: 0, closing: close(20_808) } },
    })
    expect(funded.state.tfsaWithdrawalHistory).toEqual([
      expect.objectContaining({ calendarYear: mixedYear, personId: RETIREE, amount: 408 }),
    ])

    account.balance = 407.99 / 1.02
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    expect(prefix.state.byAccount[TFSA].balance).toBeCloseTo(407.99, 8)
    const short = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(short.rows).toEqual(prefix.rows)
    expect(short.state).toEqual(prefix.state)
    expect(short.state.tfsaWithdrawalHistory).toEqual([])
    expect(short).toMatchObject({ blocked: { year: mixedYear, status: 'unsupported', causes: ['withdrawalOwnership'] },
      uncomputedYears: [retiredYear], overallConclusionAvailable: false,
    })

    plan.accounts = plan.accounts.filter(account => account.id !== 'second-rrsp')
    const covered = ok(projectCanonicalCoverage(plan, evidence, 2))
    const rrspGross = 0.01 / (1 - 0.205 - 0.0915)
    expect(covered.blocked).toBeNull()
    expect(covered.rows[1]).toMatchObject({
      byAccount: { [TFSA]: { withdrawal: close(407.99), closing: 0 }, [RRSP]: { withdrawal: close(rrspGross) } },
      householdWithdrawalSettlement: { spendingUnmet: 0 },
    })
  })

  it('prices the TFSA-only prefix and blocks when the draw reaches an RRSP with incompatible tax evidence', () => {
    const { plan, evidence } = mixedDeficitFixture(1_000)
    plan.spousalHistory = { [RRSP]: { status: 'complete' } }
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows[1]).toMatchObject({
      householdWithdrawalSettlement: { withdrawal: close(255), taxIncrement: 0, spendingUnmet: 0 },
      byAccount: { [TFSA]: { closing: close(780.3) }, [RRSP]: { withdrawal: 0, closing: close(20_808) } },
    })

    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.rows).toEqual(prefix.rows)
    expect(result.state).toEqual(prefix.state)
    expect(result).toMatchObject({ blocked: { year: retiredYear, status: 'unsupported',
      issues: [{ detail: expect.stringMatching(/spousal premium history.*ordinary RRSP/i) }] },
      uncomputedYears: [retiredYear + 1], overallConclusionAvailable: false,
    })
  })

  it('does not draw TFSA under the unsupported paced meltdown strategy', () => {
    const { plan, evidence } = mixedDeficitFixture(400)
    plan.strategy = 'meltdownPaced'
    plan.legacyProjection.strategy = 'meltdownPaced'
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.rows).toEqual(prefix.rows)
    expect(result.state).toEqual(prefix.state)
    expect(result).toMatchObject({ blocked: { year: mixedYear, status: 'unsupported', causes: ['withdrawalFunding'] },
      uncomputedYears: [retiredYear, retiredYear + 1] })
  })

  it('carries generated history into both-retired spending and preserves valid balances through exhaustion', () => {
    const { plan, evidence } = mixedDeficitFixture(400)
    // Isolate TFSA exhaustion from the unsupported taxable funding policy.
    plan.accounts.find(account => account.id === RRSP)!.balance = 0
    const mixedPrefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    const firstRetiredPrefix = ok(projectCanonicalCoverage(plan, evidence, 3))
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false,
      state: { year: retiredYear + 2, byAccount: { [TFSA]: { balance: 0 }, [RRSP]: { balance: 0 } } } })
    expect(result.rows.slice(0, 3)).toEqual(firstRetiredPrefix.rows)
    expect(result.rows.slice(0, 2)).toEqual(mixedPrefix.rows)

    // Opening CPI sets today's bill. The following CPI applies only to the
    // investment left after paying it. The second retired year exhausts it.
    const firstDue = 400 * 1.02 ** 2
    const firstClosing = (780.3 - firstDue) * 1.02
    const lastDue = 400 * 1.02 ** 3
    const restoredFromMixed = mixedPrefix.state.tfsaWithdrawalHistory?.[0]
    const restoredFromFirstRetired = firstRetiredPrefix.state.tfsaWithdrawalHistory?.[1]
    if (!restoredFromMixed || !restoredFromFirstRetired) throw new Error('Missing committed TFSA withdrawals')

    for (const expected of [
      { year: retiredYear, startCpi: 1.02 ** 2, opening: 780.3, due: firstDue, paid: firstDue, closing: firstClosing, restored: 255 },
      { year: retiredYear + 1, startCpi: 1.02 ** 3, opening: firstClosing, due: lastDue, paid: firstClosing, closing: 0, restored: 416.16 },
    ]) {
      const row = result.rows[expected.year - BASE_YEAR]
      expect(row).toMatchObject({ year: expected.year, payrollContributions: 0,
        workingSettlement: { startCpi: close(expected.startCpi), netCash: close(-expected.due), household: { phase: 'both-retired', spendingSource: 'retirementSpending' } },
        householdWithdrawalSettlement: { accountId: TFSA, ownerId: RETIREE, startCpi: close(expected.startCpi),
          withdrawal: close(expected.paid), spendingDue: close(expected.due), spendingFunded: close(expected.paid),
          spendingUnmet: close(expected.due - expected.paid) },
        cashLedger: { income: 0, tax: 0, benefits: 0, spending: close(expected.paid), unallocated: 0 },
        taxLedger: { [RETIREE]: { tax: 0, taxableIncome: 0 }, [PARTNER]: { tax: 0, taxableIncome: 0 } },
        byAccount: { [TFSA]: { ownerId: RETIREE, opening: close(expected.opening), withdrawal: close(expected.paid),
          returnAmount: close(expected.closing - (expected.opening - expected.paid)), closing: close(expected.closing) },
          [RRSP]: { ownerId: PARTNER, opening: 0, withdrawal: 0, closing: 0 } },
        tfsaLedger: { [RETIREE]: { restored: known(expected.restored), closingRoom: { status: 'unknown' } } },
      })
      expect(row.tfsaLedger[PARTNER]?.restored).toEqual(known(0))
      expect(row.byAccount[TFSA].withdrawal - row.cashLedger.spending).toBeCloseTo(0, 8)
    }
    expect(restoredFromMixed).toMatchObject({ calendarYear: mixedYear, personId: RETIREE, amount: close(255) })
    expect(restoredFromFirstRetired).toMatchObject({ calendarYear: retiredYear, personId: RETIREE, amount: close(firstDue) })
    expect(lastDue - firstClosing).toBeCloseTo(53.0604, 8)
    expect(result.state.tfsaWithdrawalHistory).toEqual([
      restoredFromMixed, restoredFromFirstRetired,
      expect.objectContaining({ calendarYear: retiredYear + 1, personId: RETIREE, amount: close(firstClosing) }),
    ])
    expect(new Set(result.state.tfsaWithdrawalHistory?.map(withdrawal => withdrawal.id)).size).toBe(3)
  })

  it('continues with fully unmet spending and restores an exhausted withdrawal once', () => {
    const { plan, evidence } = mixedDeficitFixture(1_000)
    plan.accounts.find(account => account.id === RRSP)!.balance = 0
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.blocked).toBeNull()
    const firstRetired = result.rows[2]
    const nextRetired = result.rows[3]
    expect(firstRetired.householdWithdrawalSettlement).toMatchObject({ withdrawal: close(780.3),
      spendingDue: close(1_040.4), spendingFunded: close(780.3), spendingUnmet: close(260.1) })
    expect(nextRetired.householdWithdrawalSettlement).toMatchObject({ accountId: null, ownerId: null, withdrawal: 0,
      spendingDue: close(1_061.208), spendingFunded: 0, spendingUnmet: close(1_061.208) })
    expect(nextRetired.byAccount[TFSA]).toMatchObject({ opening: 0, withdrawal: 0, returnAmount: 0, closing: 0 })
    expect(nextRetired.tfsaLedger[RETIREE].restored).toEqual(known(780.3))
    expect(result.state.tfsaWithdrawalHistory).toHaveLength(2)
  })

  it('records a tiny actual withdrawal as spending paid against a large retired bill', () => {
    const { plan, evidence } = mixedDeficitFixture(1_000_000_000_000)
    evidence.transitionSpending = known(ref.mixed.spending)
    plan.accounts.find(account => account.id === RRSP)!.balance = 0
    plan.accounts.find(account => account.id === TFSA)!.balance = 0.01
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    const row = result.rows[2]
    const available = 0.01 * 1.02 ** 2
    expect(row.householdWithdrawalSettlement).toMatchObject({ withdrawal: close(available), spendingFunded: close(available) })
    expect(row.cashLedger.spending).toBeCloseTo(available, 8)
    expect(row.byAccount[TFSA]).toMatchObject({ withdrawal: close(available), closing: 0 })
  })

  it.each([[0.00001, 0], [0.007, 0], [0.01, 0], [0.01, -0.5]] as const)('refuses a $%s TFSA target at inflation %s when the debit is unrepresentable', (realDue, inflation) => {
    const capacity = Number.MAX_SAFE_INTEGER / 100
    const { plan, evidence } = mixedDeficitFixture(realDue, 0)
    plan.inflation = inflation
    plan.legacyProjection.inflation = inflation
    plan.people[1].retirementAge = 55
    plan.accounts.find(account => account.id === RRSP)!.balance = 0
    plan.accounts.find(account => account.id === TFSA)!.balance = capacity
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    const cpi = 1 + inflation
    const opening = prefix.state.byAccount[TFSA].balance
    const nominalDebit = opening - (opening - realDue * cpi)
    expect(nominalDebit / cpi).not.toBeCloseTo(realDue, 7)
    expect(result).toMatchObject({ rows: prefix.rows, state: prefix.state,
      blocked: { year: mixedYear, status: 'unsupported', issues: [{ detail: expect.stringMatching(/debit precision/i) }] } })
    expect(result.state.tfsaWithdrawalHistory).toEqual([])
  })

  it.each([TFSA, RRSP])('settles a tiny exactly representable payment from %s', accountId => {
    const due = 2 ** -46
    const { plan, evidence } = mixedDeficitFixture(due, 0)
    plan.inflation = 0
    plan.legacyProjection.inflation = 0
    for (const account of plan.accounts) account.balance = account.id === accountId ? 64 : 0
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    expect(result.rows[2]).toMatchObject({ cashLedger: { spending: due, tax: 0 },
      householdWithdrawalSettlement: { withdrawal: due, spendingDue: due, spendingFunded: due, spendingUnmet: 0 },
      byAccount: { [accountId]: { opening: 64, withdrawal: due, closing: 64 - due } },
    })
    expect(result.state.tfsaWithdrawalHistory).toEqual(accountId === TFSA
      ? [expect.objectContaining({ calendarYear: retiredYear, amount: due })] : [])
  })

  it.each([TFSA, RRSP])('refuses to turn an unrepresentable tiny payment into cash from %s', accountId => {
    const { plan, evidence } = mixedDeficitFixture(1e-14, 0)
    plan.inflation = 0
    plan.legacyProjection.inflation = 0
    for (const account of plan.accounts) account.balance = account.id === accountId ? 100 : 0
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result).toMatchObject({ rows: prefix.rows, state: prefix.state,
      blocked: { year: retiredYear, status: 'unsupported', issues: [{ detail: expect.stringMatching(/debit precision/i) }] } })
    expect(result.state.tfsaWithdrawalHistory).toEqual([])
  })

  it('preserves a real $0.0390625 TFSA remnant when the opening CPI is close to 0.1', () => {
    const capacity = 1_000_000_000_000
    const realDue = capacity - 0.0390625
    const { plan, evidence } = mixedDeficitFixture(realDue, 0)
    plan.inflation = -0.9
    plan.legacyProjection.inflation = -0.9
    plan.people[1].retirementAge = 55
    plan.accounts.find(account => account.id === RRSP)!.balance = 0
    plan.accounts.find(account => account.id === TFSA)!.balance = capacity
    const openingCpi = 1 + plan.inflation
    const due = realDue * openingCpi
    const opening = capacity + capacity * plan.inflation
    const remnant = opening - due
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    expect(result.rows[1]).toMatchObject({ year: mixedYear,
      householdWithdrawalSettlement: { startCpi: openingCpi, withdrawal: due, spendingDue: due, spendingFunded: due, spendingUnmet: 0 },
      byAccount: { [TFSA]: { opening, withdrawal: due, closing: close(remnant * openingCpi) } },
    })
    expect(result.state.byAccount[TFSA].balance).toBeGreaterThan(0)
  })

  it('shows known zero spending and retirement labels when both people retire with no bill', () => {
    const { plan, evidence } = mixedDeficitFixture(0)
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    expect(result.rows[2]).toMatchObject({ year: retiredYear,
      workingSettlement: { netCash: 0, household: { phase: 'both-retired', spendingSource: 'retirementSpending' } },
      householdWithdrawalSettlement: { accountId: null, ownerId: null, withdrawal: 0, spendingDue: 0, spendingFunded: 0, spendingUnmet: 0 },
      cashLedger: { spending: 0 },
      byAccount: { [TFSA]: { withdrawal: 0, closing: close(795.906) }, [RRSP]: { withdrawal: 0, closing: close(21_224.16) } },
    })
    expect(result.state.tfsaWithdrawalHistory).toHaveLength(1)
    const sheet = canonicalAnnualSheet(result, { scenarioId: 'zero-retirement-spending', revision: 1 })
    const group = sheet.rows.find(row => row.id === canonicalSheetId('group', 'household'))
    const rounding = group?.children?.find(row => row.id === canonicalSheetId('value', 'cash', 'contributionRounding'))
    expect(rounding?.cells?.[BASE_YEAR]).toMatchObject({ status: 'estimated', value: 0 })
    expect(rounding?.cells?.[retiredYear]).toMatchObject({ status: 'not-applicable', value: null })
    for (const field of ['spendingDue', 'spendingFunded', 'spendingUnmet']) {
      const cell = group?.children?.find(row => row.id === canonicalSheetId('value', 'retirement', field))?.cells?.[retiredYear]
      expect(cell).toMatchObject({ status: 'estimated', value: 0 })
      expect(annualSheetText(cell!.nativeBasis!, 'en')).toMatch(/household/i)
      const reference = cell?.explanationRefs?.[0]
      const explanation = reference ? sheet.resolveExplanation?.(reference) : undefined
      expect(explanation?.sources).toContainEqual(expect.objectContaining({ field: 'retirementSpending', granularity: 'input',
        label: expect.objectContaining({ en: expect.stringMatching(/both retired/i), fr: expect.stringMatching(/deux personnes à la retraite/i) }) }))
    }
  })

  it('discloses that spouse age-credit transfers are unmodeled once the supported spouse reaches 65', () => {
    const { plan, evidence } = mixedDeficitFixture(400)
    Object.assign(plan.people[0], { ageInBaseYear: 64, retirementAge: 65 })
    Object.assign(plan.legacyProjection, { currentAge: 64, fireAge: 65, lifeExpectancy: 68 })
    plan.lifeExpectancy = 68
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    expect(result.rows[1]).toMatchObject({ byPerson: { [RETIREE]: { age: 65 } },
      workingSettlement: { household: { phase: 'mixed', taxLimitations: ['spouse-age-credit-transfer-unmodeled'] } },
      householdWithdrawalSettlement: { withdrawal: close(255) },
    })
    const sheet = canonicalAnnualSheet(result, { scenarioId: 'spouse-age-credit', revision: 1 })
    const group = sheet.rows.find(row => row.id === canonicalSheetId('group', 'household'))
    const tax = group?.children?.find(row => row.id === canonicalSheetId('value', 'cash', 'tax'))
    const limitations = (y: number) => {
      const ref = tax?.cells?.[y]?.explanationRefs?.[0]
      if (!ref) throw new Error(`Missing tax explanation in ${y}`)
      return sheet.resolveExplanation?.(ref)?.limitations?.map(label => annualSheetText(label, 'en')) ?? []
    }
    expect(tax?.cells?.[mixedYear]?.status).toBe('estimated')
    expect(limitations(BASE_YEAR)).not.toContainEqual(expect.stringMatching(/age.credit/i))
    expect(limitations(mixedYear)).toContainEqual(expect.stringMatching(/spouse age.credit transfers.*tax.*draw.*shortfall/i))
  })

  it('explains nominal household cash with signed inputs and displays opening versus closing CPI', () => {
    const { plan, evidence } = mixedDeficitFixture(400)
    plan.accounts.find(account => account.id === RRSP)!.balance = 0
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    const sheet = canonicalAnnualSheet(coverage, { scenarioId: 'household-withdrawals', revision: 1 })
    const group = sheet.rows.find(row => row.id === canonicalSheetId('group', 'household'))
    const year = sheet.years.find(column => column.year === mixedYear)!
    const cell = (y: number, ...id: string[]) => {
      const found = group?.children?.find(row => row.id === canonicalSheetId('value', ...id))?.cells?.[y]
      if (!found) throw new Error(`Missing ${id.join('/')} in ${y}`)
      return found
    }
    const explain = (y: number, field: string) => {
      const [reference] = cell(y, 'retirement', field).explanationRefs ?? []
      const explanation = reference ? sheet.resolveExplanation?.(reference) : undefined
      if (!explanation?.formula) throw new Error(`Missing ${field} formula in ${y}`)
      return { ...explanation, formula: explanation.formula }
    }
    const mixedDue = (63_162.87056 + 250) * 1.02
    const fundedExplanation = explain(mixedYear, 'spendingFunded')
    const funding = fundedExplanation.formula
    expect(fundedExplanation.sources).toContainEqual(expect.objectContaining({ field: 'transitionSpending', granularity: 'input' }))
    expect(funding).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'income', direction: 'add', value: 81_600 }),
      expect.objectContaining({ field: 'payrollContributions', direction: 'subtract', value: close(ref.mixed.partner.payroll * 1.02) }),
      expect.objectContaining({ field: 'tax', direction: 'subtract', value: close(ref.mixed.partner.tax * 1.02) }),
      expect.objectContaining({ field: 'withdrawal', direction: 'add', value: close(255), sourceId: `annual:${mixedYear}:withdrawal:${TFSA}` }),
    ]))
    expect(funding.reduce((total, term) => total + (term.direction === 'add' ? term.value : -term.value), 0)).toBeCloseTo(mixedDue, 8)
    expect(cell(mixedYear, 'retirement', 'spendingFunded')).toMatchObject({ status: 'estimated', value: close(mixedDue) })
    expect(cell(BASE_YEAR, 'retirement', 'spendingUnmet')).toMatchObject({ status: 'not-applicable', value: null })
    expect(annualSheetDisplayValue(cell(mixedYear, 'retirement', 'spendingDue'), year, 'real')).toBeCloseTo(63_412.87056, 8)
    expect(annualSheetDisplayValue(cell(mixedYear, 'assets'), year, 'real')).toBeCloseTo(780.3 / 1.02 ** 2, 8)
    const unmetExplanation = explain(retiredYear + 1, 'spendingUnmet')
    expect(unmetExplanation.sources).toContainEqual(expect.objectContaining({ field: 'retirementSpending', granularity: 'input' }))
    expect(unmetExplanation.formula).toMatchObject([
      { field: 'spendingDue', direction: 'add', value: close(424.4832) },
      { field: 'spendingFunded', direction: 'subtract', value: close(371.4228) },
    ])
  })

  it('keeps the committed working prefix when transition spending is missing', () => {
    const { plan, evidence } = mixedDeficitFixture()
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    const facts = { ...evidence, transitionSpending: unknown }
    const result = ok(projectCanonicalCoverage(plan, facts, 4))
    expect(result.rows).toEqual(prefix.rows)
    expect(result.state).toEqual(prefix.state)
    expect(result).toMatchObject({ overallConclusionAvailable: false,
      blocked: { year: mixedYear, status: 'unsupported', issues: [{ detail: expect.stringMatching(/transitionSpending|transition spending/i) }] },
      uncomputedYears: [retiredYear, retiredYear + 1] })
  })

  it('keeps the committed prefix when two owners have funded TFSAs', () => {
    const { plan, evidence } = mixedDeficitFixture()
    const firstTfsa = plan.accounts.find(account => account.id === TFSA)!
    plan.accounts.push({ ...structuredClone(firstTfsa), id: 'partner-tfsa', ownerId: PARTNER,
      taxableOwnerShares: { status: 'known', shares: { [PARTNER]: 1 } } })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()

    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.rows).toEqual(prefix.rows)
    expect(result.state).toEqual(prefix.state)
    expect(result.state.tfsaWithdrawalHistory).toEqual([])
    expect(result).toMatchObject({ overallConclusionAvailable: false,
      blocked: { year: mixedYear, status: 'unsupported', causes: ['withdrawalOwnership'], issues: [{ detail: expect.stringMatching(/TFSA|funding/i) }] },
      uncomputedYears: [retiredYear, retiredYear + 1] })
  })

  it('keeps the committed prefix when the funded owner has no recorded TFSA statement', () => {
    const { plan, evidence } = mixedDeficitFixture()
    delete plan.tfsaStatement![RETIREE]
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.rows).toEqual(prefix.rows)
    expect(result.state).toEqual(prefix.state)
    expect(result).toMatchObject({ overallConclusionAvailable: false,
      blocked: { year: mixedYear, status: 'unsupported', causes: ['tfsaWithdrawalEvidence'], issues: [{ detail: expect.stringMatching(/TFSA.*statement/i) }] },
      uncomputedYears: [retiredYear, retiredYear + 1] })
  })

  it('preserves the legacy and solo paths and rejects external continuation of a funded household', () => {
    const { plan, evidence } = mixedDeficitFixture()
    const planBefore = structuredClone(plan)
    const evidenceBefore = structuredClone(evidence)
    const legacy = runProjection(plan.legacyProjection, undefined, plan)
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    expect(plan).toEqual(planBefore)
    expect(evidence).toEqual(evidenceBefore)
    expect(runProjection(plan.legacyProjection, undefined, plan)).toEqual(legacy)

    const solo = ok(projectCanonicalCoverage(phaseTransitionPlan(), phaseTransitionSpending(), 2))
    expect(solo.blocked).toBeNull()
    expect(solo.rows[1].retirementSettlement).toMatchObject({
      spendingDue: close(phaseReference.spendingDue), spendingFunded: close(phaseReference.spendingFunded),
      spendingUnmet: close(phaseReference.deficit),
    })

    const opening = ok(initializeState(plan))
    const providers = { evaluate: vi.fn(), returns: vi.fn() }
    const strict = annualStep(plan, opening, providers)
    expect(strict.status).toBe('unsupported')
    expect(projectFromState(plan, opening, 2, providers)).toEqual(strict)
    expect(ok(projectAnnualCoverage(plan, opening, 2, providers))).toMatchObject({
      evaluationBasis: 'provider-supplied', rows: [], state: opening,
      blocked: { year: BASE_YEAR, status: 'unsupported' }, uncomputedYears: [mixedYear],
    })
    const committedState = structuredClone(result.state)
    for (const state of [result.state, structuredClone(result.state)]) {
      expect(isCanonicalGeneratedState(plan, state)).toBe(false)
      expect(evaluateCanonicalHouseholdWorkingYear(plan, evidence, retiredYear, state)).toMatchObject({ status: 'unsupported' })
      expect(evaluateCanonicalHouseholdWorkingYear(plan, evidence, mixedYear, { ...state, year: mixedYear })).toMatchObject({ status: 'unsupported' })
      expect(annualRetirementContinuation(plan, state)).toMatchObject({ status: 'invalid' })
      expect(annualRetirementStep(plan, state, providers.returns)).toMatchObject({ status: 'unsupported' })
    }
    expect(result.state).toEqual(committedState)
    expect(providers.evaluate).not.toHaveBeenCalled()
    expect(providers.returns).not.toHaveBeenCalled()
  })
})
