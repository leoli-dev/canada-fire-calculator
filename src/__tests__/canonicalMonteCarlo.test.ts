import { describe, expect, it, vi } from 'vitest'
import { CANONICAL_MC_BUDGET_MS, CANONICAL_MC_MAX_TRIALS, createSampledReturnProvider, runCanonicalMonteCarlo, runCanonicalMonteCarloTrial } from '../canonicalMonteCarlo'
import { CANONICAL_MC_VERSION, matchesCanonicalMcRequest, type CanonicalMcRequest, type CanonicalMcResponse } from '../canonicalMcProtocol'
import { selectDeterministicResult } from '../deterministicResult'
import { annualRetirementContinuation, annualRetirementStep, projectRetirementCoverage } from '../engine/annualRetirement'
import { fixedReturnProvider, initializeState, projectCanonicalCoverageWithReturns, annualStep, type KernelResult } from '../engine/annualState'
import { heldHomeEstateIds as ids } from '../engine/__tests__/fixtures/annualIntegratedHeldHomeEstate'
import { deeplyFreeze, sampledHousehold, sampledPurchase, sampledSolo } from '../engine/__tests__/fixtures/canonicalMonteCarlo'
import { phaseReference } from '../engine/__tests__/fixtures/phaseTransition'
import { known, RRSP, TFSA } from '../engine/__tests__/fixtures/retirementSettlement'
import type { InputsV2 } from '../engine/model'
import { seededRandom } from '../mcProtocol'

const seed = 0x5eed2026
// Unsigned 32-bit xorshift (13, 17, 5), with consecutive two-word
// Box–Muller cosine pairs, evaluated independently in Python.
const shocks = [0.13977662936332116, 0.3064081574241468, 1.840136061770019]
const evidence = { nonRegAbsent: false }

function volatilityByAccount(plan: InputsV2) {
  return Object.fromEntries(plan.accounts.map(account => [account.id, account.volatility]))
}

function request(plan: InputsV2, overrides: Partial<CanonicalMcRequest> = {}): CanonicalMcRequest {
  return {
    requestId: 'request-A', sourceId: 'scenario-A', inputRevision: 23, ruleVersion: CANONICAL_MC_VERSION,
    seed, inputs: plan.legacyProjection, plan, evidence, trials: 4, volatilityByAccount: volatilityByAccount(plan),
    ...overrides,
  }
}

function ok<T>(result: KernelResult<T>) {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result.issues))
  return result.value
}

function elected(plan: InputsV2) {
  const result = selectDeterministicResult(plan.legacyProjection, plan, evidence)
  if (result.route !== 'canonical') throw new Error('Expected the elected canonical ledger')
  return result
}

describe('canonical sampled return boundary', () => {
  it('uses one seeded shock per calendar year across owners regardless of quote order', () => {
    const plan = sampledHousehold()
    plan.inflation = 0.025
    Object.assign(plan.accounts[0], { realReturn: 0.045, annualFee: 0.007, volatility: 0.10 })
    Object.assign(plan.accounts[1], { realReturn: 0.019, annualFee: 0.003, volatility: 0.22 })
    const state = ok(initializeState(plan))
    const rand = seededRandom(seed)
    let draws = 0
    const provider = createSampledReturnProvider(deeplyFreeze(plan), volatilityByAccount(plan), () => {
      draws++
      return rand()
    })
    expect(draws).toBe(2 * shocks.length)
    for (const [offset, shock] of shocks.entries()) {
      const context = { plan, state: { ...state, year: state.year + offset } }
      const second = provider(context, ids.partnerTfsa)
      const first = provider(context, ids.selfTfsa)
      expect(first).toBeCloseTo((1.038 + 0.10 * shock) * 1.025 - 1, 13)
      expect(second).toBeCloseTo((1.016 + 0.22 * shock) * 1.025 - 1, 13)
      expect(provider(context, ids.selfTfsa)).toBe(first)
      expect(provider(context, ids.partnerTfsa)).toBe(second)
      expect(draws).toBe(2 * shocks.length)
    }
  })

  it.each([
    ['working, transition, household retirement and terminal estate', () => sampledHousehold()],
    ['solo working and retirement with account-kind rates', () => {
      const plan = sampledSolo()
      Object.assign(plan.accounts[0], { realReturn: 0.037, annualFee: 0.004 })
      Object.assign(plan.accounts[1], { realReturn: 0.021, annualFee: 0.002 })
      plan.legacyProjection.returns.tfsa = 0.037
      plan.legacyProjection.returns.rrsp = 0.021
      return plan
    }],
  ] as const)('reproduces the complete elected ledger for %s with zero volatility', (_name, makePlan) => {
    const plan = deeplyFreeze(makePlan())
    const before = structuredClone(plan)
    const deterministic = elected(plan)
    expect(deterministic.status).toBe('complete')
    expect(deterministic.coverage?.rows).toHaveLength(3)
    expect(deterministic.coverage?.rows[0]).toHaveProperty('workingSettlement')
    const last = deterministic.coverage!.rows.at(-1)!
    if (plan.people.length === 2) {
      expect(last.terminalEstateEstimate).toBeDefined()
      expect(last.householdExpense).toMatchObject({ due: 100, paid: 69, unmet: 31 })
      expect(last.householdWithdrawalSettlement?.spendingUnmet).toBe(0)
    } else {
      expect(last.retirementSettlement?.spendingUnmet).toBeGreaterThan(0)
    }
    const provider = createSampledReturnProvider(plan, volatilityByAccount(plan), seededRandom(seed))
    const trial = runCanonicalMonteCarloTrial(plan.legacyProjection, plan, evidence, provider)
    expect(trial).toStrictEqual(deterministic)
    expect(plan).toStrictEqual(before)
  })

  it('prices sampled gains after cash flows on both sides of the solo handoff', () => {
    const plan = sampledSolo()
    plan.deterministicProjection!.spending.retirementSpending = known(6_000)
    plan.budget.retirementSpending = 6_000
    plan.legacyProjection.retirementSpending = 6_000
    const provider = createSampledReturnProvider(plan, { [TFSA]: 0.10, [RRSP]: 0.22 }, seededRandom(seed))
    const trial = runCanonicalMonteCarloTrial(plan.legacyProjection, plan, evidence, provider)
    const rows = trial.coverage?.rows ?? []
    expect(rows).toHaveLength(3)
    for (const [index, row] of rows.entries()) {
      const prior = rows[index - 1]
      for (const [id, volatility] of [[TFSA, 0.10], [RRSP, 0.22]] as const) {
        const account = row.byAccount[id]
        if (prior) expect(account.opening).toBe(prior.byAccount[id].closing)
        const carried = account.opening + account.contribution - account.withdrawal
        expect(carried).toBeGreaterThan(0)
        expect(account.closing).toBeCloseTo(carried * (1 + volatility * shocks[index]) * 1.02, 7)
      }
    }
    expect(rows[0].workingSettlement).toBeDefined()
    expect(rows[1].retirementSettlement?.spendingFunded).toBeCloseTo(6_120, 7)
  })

  it('carries sampled gains through staggered household mortgage and retirement funding', () => {
    const plan = sampledHousehold('zero-gaps')
    const provider = createSampledReturnProvider(plan, { [ids.selfTfsa]: 0.04, [ids.partnerTfsa]: 0.02 }, seededRandom(seed))
    const trial = runCanonicalMonteCarloTrial(plan.legacyProjection, plan, evidence, provider)
    const rows = trial.coverage?.rows ?? []
    expect(rows).toHaveLength(3)
    expect(rows[0].householdWorkingTfsaSettlement).toBeDefined()
    expect(rows[1].householdWithdrawalSettlement?.postings).toHaveLength(2)
    expect(rows[2].terminalEstateEstimate?.status).toBe('estimated')
    for (const [index, row] of rows.entries()) {
      for (const [id, vol] of [[ids.selfTfsa, 0.04], [ids.partnerTfsa, 0.02]] as const) {
        const account = row.byAccount[id]
        if (index > 0) expect(account.opening).toBe(rows[index - 1].byAccount[id].closing)
        expect(account.closing).toBeCloseTo((account.opening + account.contribution - account.withdrawal) * (1 + vol * shocks[index]), 7)
      }
    }
  })

  it('cannot use the sampled provider to authorize a supplied retirement state', () => {
    const plan = sampledSolo()
    const opening = ok(initializeState(plan))
    const supplied = structuredClone(opening)
    const result = annualRetirementContinuation(plan, supplied, plan.deterministicProjection!.spending, fixedReturnProvider)
    expect(result).toMatchObject({ status: 'invalid', issues: [{ detail: 'retirement continuation requires internally generated state' }] })
  })

  it('stops atomically after a bad retirement quote and preserves the committed working row', () => {
    const plan = sampledSolo()
    const deterministic = elected(plan)
    const observed: number[] = []
    const result = runCanonicalMonteCarloTrial(plan.legacyProjection, plan, evidence, (context, id) => {
      observed.push(context.state.year)
      return context.state.year === 2027 ? NaN : fixedReturnProvider(context, id)
    })
    expect(result).toMatchObject({ status: 'partial', coverage: {
      rows: deterministic.coverage!.rows.slice(0, 1),
      blocked: { year: 2027, status: 'invalid' }, uncomputedYears: [2028],
    } })
    expect(observed).toContain(2027)
    expect(observed).not.toContain(2028)
  })

  it('can cap a legitimately sampled loss at -100% nominal', () => {
    const plan = sampledSolo()
    const draws = [Math.exp(-2), 0.5, 0.5, 0.25, 0.5, 0.25]
    const provider = createSampledReturnProvider(plan, { [TFSA]: 1, [RRSP]: 0 }, () => draws.shift()!)
    const state = ok(initializeState(plan))
    expect(provider({ plan, state }, TFSA)).toBe(-1)
    expect(provider({ plan, state }, RRSP)).toBeCloseTo(0.02, 14)
  })
})

describe('canonical Monte Carlo aggregation', () => {
  it('derives the first working-year bands from trial-major seeded draws and paid-in balances', () => {
    const plan = sampledSolo()
    const result = runCanonicalMonteCarlo(request(plan, { volatilityByAccount: { [TFSA]: 0.10, [RRSP]: 0.22 } }))
    // Trial i starts at zero-based draw pair i*3 for the three-year horizon.
    const firstShocks = [0.13977662936332116, 1.1516723347628444, 0.6860519516771332, -0.6398129727739308]
    const yearOne = firstShocks.map(z => (
      (phaseReference.tfsaOpening + phaseReference.contribution) * (1 + 0.10 * z)
      + phaseReference.rrspOpening * (1 + 0.22 * z)
    ) * 1.02).sort((a, b) => a - b)
    expect(result.bands[0]).toEqual({ year: 2026, n: 4,
      p10: expect.closeTo(yearOne[0], 7), p50: expect.closeTo(yearOne[2], 7), p90: expect.closeTo(yearOne[3], 7) })
  })

  it.each([
    ['event gap only', () => sampledHousehold(), 'completeWithGaps', [], [2028], 0, 638_880],
    ['zero gaps', () => sampledHousehold('zero-gaps'), 'completeZeroGaps', [], [], 1, 639_149],
    ['living gaps only', () => sampledSolo(), 'completeWithGaps', [2027, 2028], [], 0, 0],
  ] as const)('reports the exact fixed-return denominator and terminal values with %s', (_name, makePlan, status, livingGapYears, eventGapYears, rate, terminal) => {
    const source = deeplyFreeze(request(makePlan()))
    const before = structuredClone(source)
    const result = runCanonicalMonteCarlo(source)
    expect(result).toMatchObject({ trials: 4, completed: 4, successRate: rate, counts: {
      completeZeroGaps: status === 'completeZeroGaps' ? 4 : 0, completeWithGaps: status === 'completeWithGaps' ? 4 : 0,
      partial: 0, blocked: 0, invalid: 0, uncomputed: 0,
    } })
    expect(result.outcomes).toEqual(Array(4).fill({ status, livingGapYears, eventGapYears, computedYears: 3,
      terminalNetWorth: expect.closeTo(terminal, 8), blockedYear: null }))
    expect(result.bands).toHaveLength(3)
    expect(result.bands.at(-1)).toEqual({ year: 2028, n: 4,
      p10: expect.closeTo(terminal, 8), p50: expect.closeTo(terminal, 8), p90: expect.closeTo(terminal, 8) })
    expect(source).toStrictEqual(before)
  })

  it('keeps stopped trials distinct and publishes only the actually committed cohort', () => {
    const result = runCanonicalMonteCarlo(request(sampledHousehold('partial')))
    expect(result).toMatchObject({ trials: 4, completed: 0, successRate: null, counts: {
      completeZeroGaps: 0, completeWithGaps: 0, partial: 4, blocked: 0, invalid: 0, uncomputed: 0,
    } })
    expect(result.outcomes).toEqual(Array(4).fill({ status: 'partial', livingGapYears: [], eventGapYears: [],
      computedYears: 2, blockedYear: 2028, terminalNetWorth: null }))
    expect(result.bands).toEqual([
      { year: 2026, n: 4, p10: expect.closeTo(528_579.15, 8), p50: expect.closeTo(528_579.15, 8), p90: expect.closeTo(528_579.15, 8) },
      { year: 2027, n: 4, p10: 581_290, p50: 581_290, p90: 581_290 },
    ])
  })

  it('keeps the expense fully funded in the inflation control and stores closing bands in nominal CAD', () => {
    const plan = sampledHousehold()
    plan.inflation = 0.02
    plan.legacyProjection.inflation = 0.02
    const last = elected(plan).coverage!.rows.at(-1)!
    expect(last.householdExpense).toMatchObject({ due: 100, paid: 100, unmet: 0 })
    expect(last.householdWithdrawalSettlement?.spendingUnmet).toBe(0)
    const cpi = 1.02
    const nominalHome = 480_000 * (1.1 * cpi) ** 3
    // Working accounts receive the evidenced $100 before growth. In the
    // handoff the indexed partner wages, less EI and living, reduce a fixed
    // nominal mortgage draw. The terminal mortgage and expense are unindexed.
    const workClosing = (650 + 2_139.15 + 100) * cpi
    const transitionDraw = 1_331 - (500 * cpi * (1 - 0.0163) - 350 * cpi)
    const terminalOpening = (workClosing - transitionDraw) * cpi
    const nominalInvestments = (terminalOpening - 1_331 - 300 * cpi ** 2 - 100) * cpi
    expect(nominalInvestments).toBeCloseTo(53.766648, 8)
    const result = runCanonicalMonteCarlo(request(plan))
    expect(result).toMatchObject({ completed: 4, successRate: 1, counts: { completeZeroGaps: 4, completeWithGaps: 0 } })
    const closingBand = result.bands.at(-1)!
    expect(closingBand.p50).toBeCloseTo(nominalHome + nominalInvestments, 8)
    expect(closingBand.p50 / cpi ** 3).toBeCloseTo(638_930.67, 2)
  })

  it('shrinks a mixed cohort after the stopped year without classifying missing rows as financial gaps', () => {
    const plan = sampledHousehold('zero-gaps')
    delete plan.annualHouseholdExpenseEvidence
    // A thinner opening cushion lets the same mortgage settle for the
    // stronger market paths while market losses leave others short.
    plan.accounts[1].balance -= 369
    plan.legacyProjection.balances.tfsa -= 369
    const source = deeplyFreeze(request(plan, {
      trials: 20, volatilityByAccount: { [ids.selfTfsa]: 0.1, [ids.partnerTfsa]: 0.1 },
    }))
    const result = runCanonicalMonteCarlo(source)
    expect(result.counts.partial).toBeGreaterThan(0)
    expect(result.counts.completeZeroGaps).toBeGreaterThan(0)
    expect(result.counts.partial + result.counts.completeZeroGaps).toBe(20)
    expect(result.counts.completeWithGaps).toBe(0)
    expect(result.successRate).toBeNull()
    expect(result.bands.map(({ year, n }) => [year, n])).toEqual([[2026, 20], [2027, 20], [2028, result.counts.completeZeroGaps]])
    const first = result.bands[0]
    expect(first.p10).toBeLessThan(first.p50)
    expect(first.p50).toBeLessThan(first.p90)
    for (const outcome of result.outcomes.filter(outcome => outcome.status === 'partial')) {
      expect(outcome).toMatchObject({ computedYears: 2, blockedYear: 2028, terminalNetWorth: null, eventGapYears: [] })
    }
    const { elapsedMs: _time, ...statistics } = result
    const { elapsedMs: _repeatTime, ...repeat } = runCanonicalMonteCarlo(source)
    expect(repeat).toStrictEqual(statistics)
  })

  it('respects the work budget and withholds a rate even if the one completed trial has no gap', () => {
    const now = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(CANONICAL_MC_BUDGET_MS + 1)
    try {
      const result = runCanonicalMonteCarlo(request(sampledHousehold('zero-gaps')))
      expect(result).toMatchObject({ trials: 4, completed: 1, successRate: null, stopReason: 'budget',
        counts: { completeZeroGaps: 1, completeWithGaps: 0, partial: 0, blocked: 0, invalid: 0, uncomputed: 3 } })
      expect(result.bands.map(({ year, n }) => [year, n])).toEqual([[2026, 1], [2027, 1], [2028, 1]])
      expect(result.outcomes.slice(1)).toEqual(Array(3).fill({ status: 'uncomputed', computedYears: 0, blockedYear: null,
        terminalNetWorth: null, livingGapYears: [], eventGapYears: [] }))
    } finally {
      now.mockRestore()
    }
  })

  it.each([null, undefined, Number.NaN, Infinity, -0.01, 1.01])('requires explicit and valid account volatility (%s)', bad => {
    const source = request(sampledSolo())
    if (bad === undefined) delete source.volatilityByAccount[TFSA]
    else source.volatilityByAccount[TFSA] = bad
    expect(runCanonicalMonteCarlo(source)).toMatchObject({ completed: 0, successRate: null, stopReason: 'assumptions',
      counts: { invalid: 4, completeZeroGaps: 0, completeWithGaps: 0 }, bands: [] })
  })

  it.each([-2, NaN, Infinity])('does not clip inadmissible deterministic rate evidence (%s) into a priced year', bad => {
    const plan = sampledSolo()
    plan.accounts[0].realReturn = bad
    const deterministic = elected(plan)
    expect(deterministic.status).toBe('invalid')
    expect(deterministic.coverage?.rows ?? []).toEqual([])
    const source = request(plan, { volatilityByAccount: { [TFSA]: 0.01, [RRSP]: 0.01 } })
    expect(runCanonicalMonteCarlo(source)).toMatchObject({ completed: 0, successRate: null, bands: [],
      counts: { invalid: 4, completeZeroGaps: 0, completeWithGaps: 0 } })
  })

  it('omits only the deterministic selector’s expressly absent zero migration placeholder', () => {
    const plan = sampledSolo()
    const nonReg = structuredClone(plan.accounts[0])
    Object.assign(nonReg, { id: 'legacy:account:nonReg', kind: 'nonReg', balance: 0, volatility: null })
    plan.accounts.push(nonReg)
    const before = structuredClone(plan)
    const allowAbsence = { nonRegAbsent: true }
    const vol = { [TFSA]: 0, [RRSP]: 0 }
    expect(selectDeterministicResult(plan.legacyProjection, plan, allowAbsence)).toStrictEqual(elected(sampledSolo()))
    expect(runCanonicalMonteCarlo(request(plan, { evidence: allowAbsence, volatilityByAccount: vol }))).toMatchObject({
      completed: 4, counts: { completeWithGaps: 4, invalid: 0 }, successRate: 0,
    })
    expect(plan).toStrictEqual(before)
    expect(runCanonicalMonteCarlo(request(plan, { volatilityByAccount: vol }))).toMatchObject({
      completed: 0, successRate: null, counts: { invalid: 4 }, bands: [],
    })
    nonReg.id = 'recorded-zero-taxable-account'
    expect(runCanonicalMonteCarlo(request(plan, { evidence: allowAbsence, volatilityByAccount: vol }))).toMatchObject({
      completed: 0, successRate: null, counts: { invalid: 4 }, bands: [],
    })
    nonReg.id = 'legacy:account:nonReg'
    nonReg.balance = 1
    expect(runCanonicalMonteCarlo(request(plan, { evidence: allowAbsence, volatilityByAccount: vol }))).toMatchObject({
      completed: 0, successRate: null, counts: { invalid: 4 }, bands: [],
    })
  })

  it('accepts the deterministic taxable unit ledger and refuses to fabricate a sampled quote', () => {
    const plan = sampledSolo()
    const id = 'taxable-investment'
    plan.accounts.push({ ...structuredClone(plan.accounts[0]), id, kind: 'nonReg', balance: 150_000, acb: known(150_000) })
    plan.annualNonRegEvidence = {
      accountId: id, holdingId: 'unit-class', ownership: 'individual-whole', propertyKind: 'capital-identical-pool',
      units: 1_000, pooledAcbNominal: 150_000, distributions: 0, interest: 0, returnOfCapital: 0,
      saleFees: 0, provenance: 'user-supplied',
    }
    plan.strategy = 'nonRegFirst'
    plan.legacyProjection.strategy = 'nonRegFirst'
    plan.legacyProjection.balances.nonReg = 150_000
    plan.legacyProjection.nonRegBook = 150_000
    const deterministic = elected(plan)
    expect(deterministic.status).toBe('complete')
    expect(deterministic.coverage?.rows[1].byAccount[id].nonRegSale?.openingUnits).toBe(1_000)
    expect(runCanonicalMonteCarlo(request(plan))).toMatchObject({ completed: 4, successRate: 1,
      counts: { completeZeroGaps: 4 }, bands: expect.any(Array) })
    const taxableVols = { [TFSA]: 0, [RRSP]: 0, [id]: 0.1 }
    const provider = createSampledReturnProvider(plan, taxableVols, seededRandom(seed))
    const direct = runCanonicalMonteCarloTrial(plan.legacyProjection, plan, evidence, provider)
    expect(direct).toMatchObject({ status: 'blocked', issues: [expect.objectContaining({ code: 'unsupported' })] })
    expect(direct.coverage?.rows ?? []).toEqual([])
    const sampled = runCanonicalMonteCarlo(request(plan, { volatilityByAccount: taxableVols }))
    expect(sampled).toMatchObject({ completed: 0, successRate: null, stopReason: 'scope',
      counts: { completeZeroGaps: 0, completeWithGaps: 0, blocked: 4 }, bands: [] })
    expect(sampled.outcomes.every(outcome => outcome.terminalNetWorth === null)).toBe(true)
    expect(runCanonicalMonteCarloTrial(plan.legacyProjection, plan, evidence, provider)).toMatchObject({
      status: 'blocked', coverage: null, issues: [{ code: 'unsupported', detail: 'sampled-return-scope-unavailable' }],
    })
    for (const fixed of [undefined, fixedReturnProvider, createSampledReturnProvider(plan, volatilityByAccount(plan), seededRandom(seed))])
      expect(runCanonicalMonteCarloTrial(plan.legacyProjection, plan, evidence, fixed)).toStrictEqual(deterministic)

  })

  it('treats an empty purchase map as dormant and fails closed for actual sampled exact purchase pricing', () => {
    const plan = sampledSolo()
    const vol = { [TFSA]: 0.12, [RRSP]: 0.12 }
    const ordinary = runCanonicalMonteCarlo(request(plan, { volatilityByAccount: vol }))
    plan.annualPrimaryHomePurchaseEvidence = {}
    const dormant = runCanonicalMonteCarlo(request(plan, { volatilityByAccount: vol }))
    expect(dormant).toMatchObject({ completed: 4, stopReason: null, bands: ordinary.bands, outcomes: ordinary.outcomes })

    const purchase = sampledPurchase()
    const deterministic = elected(purchase)
    expect(deterministic.status).toBe('complete')
    expect(deterministic.coverage?.rows[1].retirementSettlement?.primaryHomePurchase?.totalCost).toBe(101_300)
    const fixed = createSampledReturnProvider(purchase, { [TFSA]: 0 }, seededRandom(seed))
    expect(runCanonicalMonteCarloTrial(purchase.legacyProjection, purchase, evidence, fixed)).toStrictEqual(deterministic)
    expect(runCanonicalMonteCarloTrial(purchase.legacyProjection, purchase, evidence, fixedReturnProvider)).toStrictEqual(deterministic)
    const volatilityByAccount = { [TFSA]: 0.12 }
    const provider = createSampledReturnProvider(purchase, volatilityByAccount, seededRandom(seed))
    const direct = runCanonicalMonteCarloTrial(purchase.legacyProjection, purchase, evidence, provider)
    expect(direct).toMatchObject({ status: 'blocked', issues: [expect.objectContaining({ code: 'unsupported' })] })
    expect(direct.coverage?.rows ?? []).toEqual([])
    expect(runCanonicalMonteCarlo(request(purchase, { volatilityByAccount }))).toMatchObject({
      completed: 0, successRate: null, stopReason: 'scope', bands: [], counts: { blocked: 4, completeWithGaps: 0 },
    })
  })

  it('shares typed exact-purchase refusal across single, batch and exported annual entry points', () => {
    const plan = sampledPurchase()
    plan.accounts[0].balance = 120_000
    plan.legacyProjection.balances.tfsa = 120_000
    plan.lifeExpectancy = 60
    plan.legacyProjection.lifeExpectancy = 60
    const before = structuredClone(plan)
    const deterministic = elected(plan)
    expect(deterministic.status).toBe('complete')
    expect(deterministic.coverage!.rows.map(row => row.byAccount[TFSA].closing)).toEqual([123_420, 21_522, 20_891.232, 20_226.62448])
    const provider = createSampledReturnProvider(plan, { [TFSA]: .12 }, seededRandom(42))
    const opening = ok(initializeState(plan))
    expect(provider({ plan, state: opening }, TFSA)).toBeCloseTo(-.2052709792510724, 14)
    const single = runCanonicalMonteCarloTrial(plan.legacyProjection, plan, evidence, provider)
    expect(single).toMatchObject({ route: 'canonical', status: 'blocked', coverage: null,
      issues: [{ code: 'unsupported', detail: 'sampled-return-scope-unavailable' }] })
    expect(projectCanonicalCoverageWithReturns(plan, plan.deterministicProjection!.spending, 4, provider)).toMatchObject({
      status: 'unsupported', issues: [{ detail: 'sampled-return-scope-unavailable' }],
    })
    expect(annualStep(plan, opening, { evaluate: () => { throw new Error('must not evaluate') }, returns: provider })).toMatchObject({
      status: 'unsupported', issues: [{ detail: 'sampled-return-scope-unavailable' }],
    })
    expect(annualRetirementStep(plan, opening, provider)).toMatchObject({
      status: 'unsupported', issues: [{ detail: 'sampled-return-scope-unavailable' }],
    })
    const standalone = projectRetirementCoverage(plan, opening, 4, provider)
    expect(standalone).toMatchObject({ status: 'ok', value: { rows: [], blocked: {
      year: 2026, status: 'unsupported', issues: [{ detail: 'sampled-return-scope-unavailable' }],
    } } })
    const batch = runCanonicalMonteCarlo(request(plan, { seed: 42, trials: 2, volatilityByAccount: { [TFSA]: .12 } }))
    expect(batch).toMatchObject({ completed: 0, successRate: null, stopReason: 'scope', bands: [], counts: { blocked: 2 } })
    expect(batch.outcomes).toEqual(Array(2).fill({ status: 'blocked', computedYears: 0, terminalNetWorth: null,
      livingGapYears: [], eventGapYears: [], blockedYear: 2026 }))
    for (const fixed of [undefined, fixedReturnProvider, createSampledReturnProvider(plan, { [TFSA]: 0 }, seededRandom(42))])
      expect(runCanonicalMonteCarloTrial(plan.legacyProjection, plan, evidence, fixed)).toStrictEqual(deterministic)
    const fixedBatch = runCanonicalMonteCarlo(request(plan, { seed: 42, trials: 2, volatilityByAccount: { [TFSA]: 0 } }))
    expect(fixedBatch).toMatchObject({ completed: 2, stopReason: null, counts: { blocked: 0, invalid: 0 } })
    expect(fixedBatch.outcomes.every(outcome => outcome.computedYears === 4 && outcome.terminalNetWorth !== null)).toBe(true)
    // An arbitrary wrapper cannot claim proven fixed rates on the exact path.
    expect(runCanonicalMonteCarloTrial(plan.legacyProjection, plan, evidence, (context, id) => provider(context, id))).toMatchObject({
      status: 'blocked', coverage: null, issues: [{ detail: 'sampled-return-scope-unavailable' }],
    })
    expect(plan).toStrictEqual(before)
  })

  it('bounds requests and authenticates every echoed canonical identity field', () => {
    const source = request(sampledSolo())
    for (const trials of [0, 1.5, CANONICAL_MC_MAX_TRIALS + 1])
      expect(() => runCanonicalMonteCarlo({ ...source, trials })).toThrow()
    for (const invalidSeed of [-1, 0x1_0000_0000, 1.5])
      expect(() => runCanonicalMonteCarlo({ ...source, seed: invalidSeed })).toThrow()
    const tooLong = sampledSolo()
    tooLong.lifeExpectancy = tooLong.people[0].ageInBaseYear + 120
    expect(elected(tooLong)).toMatchObject({ status: 'invalid', requestedYears: 0 })
    expect(runCanonicalMonteCarlo(request(tooLong))).toMatchObject({ completed: 0, successRate: null,
      counts: { invalid: 4, completeWithGaps: 0 }, bands: [] })
    const reply: CanonicalMcResponse = {
      status: 'error', requestId: source.requestId, sourceId: source.sourceId,
      inputRevision: source.inputRevision, ruleVersion: source.ruleVersion, seed: source.seed,
    }
    expect(matchesCanonicalMcRequest(reply, source)).toBe(true)
    for (const changed of [{ requestId: 'prior-run' }, { sourceId: 'prior-plan' }, { inputRevision: 24 },
      { ruleVersion: 'legacy' as typeof CANONICAL_MC_VERSION }, { seed: 1 }]) {
      expect(matchesCanonicalMcRequest({ ...reply, ...changed }, source)).toBe(false)
    }
  })
})
