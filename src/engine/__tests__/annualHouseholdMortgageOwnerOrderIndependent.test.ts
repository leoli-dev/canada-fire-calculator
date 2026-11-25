import { describe, expect, it, vi } from 'vitest'
import { annualSheetText, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { annualRetirementContinuation, annualRetirementStep } from '../annualRetirement'
import {
  annualStep, initializeState, projectAnnualCoverage, projectCanonicalCoverage, projectFromState,
  type AnnualProviders, type KernelResult,
} from '../annualState'
import { evaluateCanonicalHouseholdWorkingYear, type WorkingSpendingEvidence } from '../annualWorking'
import type { InputsV2, Provenance } from '../model'
import { runProjection } from '../projection'
import { integratedHouseholdFixture, integratedHouseholdIds, integratedHouseholdVariant } from './fixtures/annualIntegratedHousehold'
import { BASE_YEAR, known, recorded, retirementPlan, RETIREE } from './fixtures/retirementSettlement'

// Vitest's strict equality treats an own constructor key as type metadata.
const { deepStrictEqual } = await vi.importActual<{
  deepStrictEqual(actual: unknown, expected: unknown): void
}>('node:assert/strict')

const PARTNER = 'partner-owner'
const SELF_ACCOUNT = 'self-private-account'
const PARTNER_ACCOUNT = 'partner-private-account'
const HOME = 'held-house'
const DEBT = 'linked-debt'
const context = { scenarioId: 'ordered-mortgage', revision: 1 }
const authorizationCause = 'mortgageFundingAuthorization'
type Authorization = NonNullable<InputsV2['annualHouseholdMortgageFundingEvidence']>

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function fixture({
  selfBalance = 650, partnerBalance = 1_450, selfAccount = SELF_ACCOUNT, partnerAccount = PARTNER_ACCOUNT,
  installments = 3, payment = 1_000, mixed = 350, retired = 300, age = 42, working = 1_951.1,
  partnerFirst = false, partnerId = PARTNER,
} = {}) {
  // The $2,500 and $500 wages incur only EI (1.63%). Net cash is
  // $2,951.10 in employment and $491.85 once only the partner works.
  const plan = retirementPlan({ age, spending: retired, strategy: 'tfsaFirst', tfsa: selfBalance })
  const self = plan.people[0]
  Object.assign(self, { retirementAge: age + 1, earnedIncome: known(2_500), tfsaAvailableRoom: known(8_321) })
  plan.people.push({
    ...structuredClone(self), id: partnerId, role: 'partner', ageInBaseYear: age - 1,
    earnedIncome: known(500), tfsaAvailableRoom: known(5_432),
  })
  const tfsa = plan.accounts[0]
  tfsa.id = selfAccount
  plan.accounts = [tfsa, { ...structuredClone(tfsa), id: partnerAccount, ownerId: partnerId, balance: partnerBalance,
    taxableOwnerShares: { status: 'known', shares: { [partnerId]: 1 } } }]
  plan.tfsaStatement![partnerId] = { withdrawals: [], provenance: { ...recorded } }
  plan.taxProfile = { spouseSupported: known(false), pensionSplit: null }
  plan.lifeExpectancy = age + 21
  plan.budget = { kind: 'incomeBudget', workingSpending: working, retirementSpending: retired }
  plan.properties.push({
    id: HOME, kind: 'principal', value: 480_000, acb: known(240_000), annualRent: known(0),
    appreciation: 0, annualHoldingCostChange: 0, sellAtAge: null, plannedPurchaseAge: null,
    plannedDownPayment: null, plannedMortgage: null, mortgageDebtId: DEBT,
    taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 1 } },
    provenance: { value: recorded, acb: recorded, taxableOwnerShares: recorded },
  })
  plan.debts.push({
    id: DEBT, propertyId: HOME, kind: 'mortgage', principal: Math.round(payment * 100) * installments / 100,
    annualPayment: payment, yearsRemaining: installments, provenance: recorded,
  })
  const selfRef = { accountId: selfAccount, ownerId: RETIREE }
  const partnerRef = { accountId: partnerAccount, ownerId: partnerId }
  const authorization: Authorization = {
    orderedAccounts: partnerFirst ? [partnerRef, selfRef] : [selfRef, partnerRef],
    authorized: true, purpose: 'household-held-mortgage-and-living',
    provenance: { origin: 'user', sourceYear: BASE_YEAR - 1, note: 'Both owners confirmed' },
  }
  plan.annualHouseholdMortgageFundingEvidence = authorization
  plan.legacyProjection = {
    ...plan.legacyProjection, fireAge: age + 1, lifeExpectancy: age + 4,
    principalResidence: { value: 480_000, appreciation: 0, sellAtAge: null,
      mortgage: { balance: plan.debts[0].principal, annualPayment: payment, yearsRemaining: installments } },
    partner: { currentAge: age - 1, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
  }
  const evidence: WorkingSpendingEvidence = {
    workingSpending: known(working), transitionSpending: known(mixed), retirementSpending: known(retired),
    scheduledMortgagePaymentsExcluded: known(true),
  }
  return { plan, evidence, authorization }
}

function posting(accountId: string, ownerId: string, amount: number) {
  return { accountId, ownerId, kind: 'tfsa', amount }
}

function sheetRow(rows: AnnualSheetRow[], ...path: string[]): AnnualSheetRow {
  const id = canonicalSheetId('value', ...path)
  const row = rows.find(entry => entry.id === id) ?? rows.flatMap(entry => entry.children ?? []).find(entry => entry.id === id)
  if (!row) throw new Error(`Missing annual sheet row ${id}`)
  return row
}

describe('independent ordered household mortgage TFSA cash and room', () => {
  it.each([false, true])('follows the dated order independently of both input listings (partner first=%s)', partnerFirst => {
    const { plan, evidence, authorization } = fixture({ partnerFirst })
    const original = structuredClone({ plan, evidence })
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false })

    // Mixed: $491.85 wages after EI + $858.15 withdrawals pays $1,000
    // debt and $350 living. At maturity the remaining $1,241.85 allows
    // only $241.85 of the $300 living budget after the last installment.
    const self = (amount: number) => posting(SELF_ACCOUNT, RETIREE, amount)
    const partner = (amount: number) => posting(PARTNER_ACCOUNT, PARTNER, amount)
    const ledger = partnerFirst ? [
      [partner(858.15)], [partner(591.85), self(650)],
    ] : [
      [self(650), partner(208.15)], [partner(1_241.85)],
    ]
    const expected = [
      { debt: 1_000, principal: 2_000, income: 3_000, payroll: 48.9, funded: 1_951.1, due: 1_951.1, unmet: 0, debits: [], phase: 'both-working' },
      { debt: 1_000, principal: 1_000, income: 500, payroll: 8.15, funded: 350, due: 350, unmet: 0, debits: ledger[0], phase: 'mixed' },
      { debt: 1_000, principal: 0, income: 0, payroll: 0, funded: 241.85, due: 300, unmet: 58.15, debits: ledger[1], phase: 'both-retired' },
      { debt: 0, principal: 0, income: 0, payroll: 0, funded: 0, due: 300, unmet: 300, debits: [], phase: 'both-retired' },
    ]
    const history: { id: string; personId: string; calendarYear: number; amount: number }[] = []
    const balances = { [SELF_ACCOUNT]: 65_000, [PARTNER_ACCOUNT]: 145_000 }
    for (const [index, fact] of expected.entries()) {
      const year = BASE_YEAR + index
      const row = result.rows[index]
      const prefix = ok(projectCanonicalCoverage(plan, evidence, index + 1))
      expect(prefix.rows).toStrictEqual(result.rows.slice(0, index + 1))
      expect(row).toMatchObject({
        year, payrollContributions: expect.closeTo(fact.payroll, 10),
        workingSettlement: { household: { phase: fact.phase } },
        byDebt: { [DEBT]: { opening: fact.principal + fact.debt, closing: fact.principal,
          payment: fact.debt, interest: 0, principal: fact.debt } },
        cashLedger: { income: fact.income, tax: 0, benefits: 0,
          debtPayments: fact.debt, spending: fact.funded, unallocated: 0 },
        householdWithdrawalSettlement: { orderedFundingAuthorization: authorization,
          postings: fact.debits, withdrawal: [0, 858.15, 1_241.85, 0][index], taxIncrement: 0,
          spendingDue: fact.due, spendingFunded: fact.funded, spendingUnmet: fact.unmet },
      })
      expect(row.householdWithdrawalSettlement!.orderedFundingAuthorization).not.toBe(authorization)
      for (const { ownerId, accountId } of authorization.orderedAccounts) {
        const opening = balances[accountId as keyof typeof balances]
        const debit = fact.debits.find(item => item.accountId === accountId)?.amount ?? 0
        const closing = opening - Math.round(debit * 100)
        expect(row.byAccount[accountId]).toMatchObject({
          ownerId, opening: opening / 100, closing: closing / 100,
          withdrawal: debit, contribution: 0, returnAmount: 0,
        })
        const exact = row.byAccount[accountId].mortgageExactWithdrawal
        if (debit) {
          const scale = Number.isInteger(debit) ? 0 : 2
          expect(exact).toEqual({ coefficient: String(Math.round(debit * 10 ** scale)), scale })
        } else expect(exact).toBeUndefined()
        expect(prefix.state.byAccount[accountId].balance).toBe(closing / 100)
        balances[accountId as keyof typeof balances] = closing
        const restored = expected[index - 1]?.debits.find(item => item.ownerId === ownerId)?.amount ?? 0
        expect(row.tfsaLedger[ownerId]).toMatchObject({ restored: known(restored), applied: 0,
          closingRoom: index === 0 ? known(ownerId === RETIREE ? 8_321 : 5_432) : { status: 'unknown' } })
      }
      history.push(...fact.debits.map(({ accountId, ownerId, amount }) => ({
        id: `annual:${year}:withdrawal:${accountId}`, personId: ownerId, calendarYear: year, amount,
      })))
      expect(prefix.state.tfsaWithdrawalHistory).toStrictEqual(history)
      expect(prefix.state.contributionHistory).toStrictEqual([])
      expect(row.contributionLedger.postings).toStrictEqual([])
    }
    expect({ plan, evidence }).toStrictEqual(original)
    for (const [reversePeople, reverseAccounts] of [[true, false], [false, true], [true, true]]) {
      const reordered = structuredClone(plan)
      if (reversePeople) reordered.people.reverse()
      if (reverseAccounts) reordered.accounts.reverse()
      expect(ok(projectCanonicalCoverage(reordered, evidence, 4))).toEqual(result)
    }
  })
})

describe('ordered mortgage authorization boundaries', () => {
  it('preserves the existing refusal when both balances are funded and there is no authorization', () => {
    const { plan, evidence } = fixture()
    delete plan.annualHouseholdMortgageFundingEvidence
    expect(ok(projectCanonicalCoverage(plan, evidence, 3))).toMatchObject({
      rows: [], state: ok(initializeState(plan)), uncomputedYears: [2027, 2028],
      blocked: { year: 2026, status: 'unsupported', issues: [
        { detail: 'household mortgage requires ordinary single funded TFSA and no special slice evidence' },
      ] },
    })
  })

  it.each([false, true])('attributes singular account and owner only to a sole posting (partner first=%s)', partnerFirst => {
    const { plan, evidence } = fixture({ partnerFirst })
    const { rows, blocked } = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(blocked).toBeNull()
    expect(rows.map(row => {
      const settlement = row.householdWithdrawalSettlement!
      return [settlement.accountId, settlement.ownerId]
    })).toStrictEqual(partnerFirst ? [
      [null, null], [PARTNER_ACCOUNT, PARTNER], [null, null], [null, null],
    ] : [
      [null, null], [null, null], [PARTNER_ACCOUNT, PARTNER], [null, null],
    ])
  })

  const invalidFacts: [string, (fact: Authorization) => unknown][] = [
    ['future date', fact => ({ ...fact, provenance: { origin: 'user', sourceYear: BASE_YEAR + 1 } })],
    ['absent date', fact => ({ ...fact, provenance: { origin: 'user', sourceYear: null } })],
    ['fractional date', fact => ({ ...fact, provenance: { origin: 'user', sourceYear: BASE_YEAR - 0.5 } })],
    ['inherited date', fact => ({ ...fact, provenance: Object.assign(Object.create({ sourceYear: BASE_YEAR }), { origin: 'user' }) })],
    ['legacy provenance', fact => ({ ...fact, provenance: { ...fact.provenance, origin: 'legacy' } })],
    ['denied consent', fact => ({ ...fact, authorized: false })],
    ['wrong purpose', fact => ({ ...fact, purpose: 'household-held-mortgage' })],
    ['one account', fact => ({ ...fact, orderedAccounts: [fact.orderedAccounts[0]] })],
    ['duplicate account and owner', fact => ({ ...fact, orderedAccounts: [fact.orderedAccounts[0], fact.orderedAccounts[0]] })],
    ['missing account', fact => ({ ...fact, orderedAccounts: [fact.orderedAccounts[0], { accountId: '__proto__', ownerId: PARTNER }] })],
    ['cross-wired account and owner', fact => ({ ...fact, orderedAccounts: fact.orderedAccounts.map(ref => ({
      ...ref, ownerId: ref.ownerId === PARTNER ? RETIREE : PARTNER,
    })) })],
    ['inherited account reference', fact => ({ ...fact, orderedAccounts: [fact.orderedAccounts[0], Object.create(fact.orderedAccounts[1])] })],
    ['array-shaped object', fact => ({ ...fact, orderedAccounts: { ...fact.orderedAccounts, length: 2 } })],
  ]

  it.each(invalidFacts)('stops atomically for %s', (_label, change) => {
    const { plan, evidence, authorization } = fixture()
    plan.annualHouseholdMortgageFundingEvidence = change(authorization) as Authorization
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result).toMatchObject({
      rows: [], state: ok(initializeState(plan)), uncomputedYears: [2027, 2028],
      blocked: { year: 2026, status: 'unsupported', causes: [authorizationCause] },
    })
    const sheet = canonicalAnnualSheet(result, context)
    const stopped = sheetRow(sheet.rows, 'retirement', 'spendingFunded').cells![2026]
    expect(stopped).toMatchObject({ value: null, status: 'not-computed' })
    for (const [locale, message] of [
      ['en', /dated consent from both owners.*both TFSA accounts in order/],
      ['fr', /consentement daté des deux titulaires.*deux CELI dans l’ordre/],
      ['zh', /双方持有人注明日期同意.*按顺序列明两个 TFSA 账户/],
    ] as const) {
      expect(annualSheetText(stopped.reason!, locale)).toMatch(message)
    }
  })

  const unsupportedStatements: [string, Provenance | undefined][] = [
    ['missing', undefined],
    ['unknown', { origin: 'unknown', sourceYear: null }],
    ['estimated', { origin: 'estimated', sourceYear: BASE_YEAR }],
    ['future-dated', { origin: 'user', sourceYear: BASE_YEAR + 1 }],
    ['undated', { origin: 'user', sourceYear: null }],
  ]

  it.each(unsupportedStatements)('requires the %s statement only when reaching a positive second debit', (_name, provenance) => {
    const { plan, evidence } = fixture({ partnerFirst: true })
    if (provenance) plan.tfsaStatement![RETIREE].provenance = provenance
    else delete plan.tfsaStatement![RETIREE]

    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows[1].householdWithdrawalSettlement?.postings).toStrictEqual([
      posting(PARTNER_ACCOUNT, PARTNER, 858.15),
    ])
    expect(prefix.state.byAccount[SELF_ACCOUNT].balance).toBe(650)
    expect(prefix.state.byAccount[PARTNER_ACCOUNT].balance).toBe(591.85)
    const full = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(full).toMatchObject({
      blocked: { year: 2028, status: 'unsupported', causes: ['tfsaWithdrawalEvidence'] },
      uncomputedYears: [2029],
    })
    expect(full.rows).toStrictEqual(prefix.rows)
    expect(full.state).toStrictEqual(prefix.state)
  })

  it.each(['constructor', 'toString'])('treats the inherited %s statement key as absent and preserves the working prefix', partnerId => {
    const { plan, evidence } = fixture({ partnerId })
    const withStatement = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(withStatement.blocked).toBeNull()
    expect(withStatement.rows[1].householdWithdrawalSettlement?.postings).toEqual([
      posting(SELF_ACCOUNT, RETIREE, 650), posting(PARTNER_ACCOUNT, partnerId, 208.15),
    ])
    delete plan.tfsaStatement![partnerId]
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    deepStrictEqual(prefix.rows, withStatement.rows.slice(0, 1))
    const full = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(full).toMatchObject({
      blocked: { year: 2027, status: 'unsupported', causes: ['tfsaWithdrawalEvidence'] },
      uncomputedYears: [2028],
    })
    deepStrictEqual(full.rows, prefix.rows)
    deepStrictEqual(full.state, prefix.state)
    for (const record of [full.rows[0].byPerson, full.rows[0].tfsaLedger, full.state.byPerson]) {
      expect(Object.getPrototypeOf(record)).toBe(Object.prototype)
      expect(Object.getOwnPropertyDescriptor(record, partnerId)).toMatchObject({
        value: expect.any(Object), enumerable: true, writable: true, configurable: true,
      })
    }
  })

  it('refuses known account shares that contradict the authorized individual owner', () => {
    const { plan, evidence } = fixture()
    plan.accounts[0].taxableOwnerShares = { status: 'known', shares: { [RETIREE]: 0.75, [PARTNER]: 0.25 } }
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result).toMatchObject({
      rows: [], state: ok(initializeState(plan)), uncomputedYears: [2027, 2028],
      blocked: { year: 2026, status: 'unsupported', causes: [authorizationCause] },
    })
  })
})

describe('ordered mortgage exact debt funding', () => {
  it.each([108.14, 108.14999999999999, 108.15])('settles mixed-year debt atomically at $%s in the second account', partnerBalance => {
    const { plan, evidence } = fixture({ selfBalance: 400, partnerBalance, installments: 2, mixed: 90 })
    const before = structuredClone({ plan, evidence })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    const full = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(full.rows[0]).toStrictEqual(prefix.rows[0])
    if (partnerBalance < 108.15) {
      // Even a binary sum that prints as the full installment is short in decimal CAD.
      if (partnerBalance > 108.14) expect(491.85 + 400 + partnerBalance).toBe(1_000)
      expect(full).toMatchObject({
        blocked: { year: 2027, status: 'unsupported', issues: [
          { detail: 'mortgage scheduled payment cannot be fully funded' },
        ] },
        uncomputedYears: [2028],
      })
      expect(full.rows).toStrictEqual(prefix.rows)
      expect(full.state).toStrictEqual(prefix.state)
    } else {
      expect(full.blocked).toBeNull()
      expect(full.rows[1]).toMatchObject({
        byDebt: { [DEBT]: { payment: 1_000, closing: 0 } },
        byAccount: { [SELF_ACCOUNT]: { closing: 0 }, [PARTNER_ACCOUNT]: { closing: 0 } },
        householdWithdrawalSettlement: { spendingDue: 90, spendingFunded: 0, spendingUnmet: 90,
          postings: [posting(SELF_ACCOUNT, RETIREE, 400), posting(PARTNER_ACCOUNT, PARTNER, 108.15)] },
        cashLedger: { debtPayments: 1_000, spending: 0, unallocated: 0 },
      })
      expect(full.rows[2].cashLedger.debtPayments).toBe(0)
    }
    expect({ plan, evidence }).toStrictEqual(before)
  })

  it.each([737.16, 737.1699999999998, 737.17])('carries the exact first-account remainder to late maturity with $%s in the second account', partnerBalance => {
    const installment = 1_237.17
    const { plan, evidence } = fixture({
      age: 25, selfBalance: 22_769.06, partnerBalance, installments: 20, payment: installment,
      working: 1_713.93, mixed: 491.85, retired: 0,
    })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 19))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows.map(row => row.cashLedger.debtPayments)).toEqual(Array(19).fill(installment))
    // 18 prior TFSA-funded installments leave exactly $500 in the first account.
    for (const [index, row] of prefix.rows.entries()) {
      expect(row.byAccount[SELF_ACCOUNT]).toMatchObject({
        closing: (2_276_906 - index * 123_717) / 100, withdrawal: index === 0 ? 0 : installment,
      })
      expect(row.byAccount[PARTNER_ACCOUNT]).toMatchObject({ withdrawal: 0, closing: partnerBalance })
    }
    expect(prefix.state.byDebt[DEBT]).toMatchObject({ principal: installment, yearsRemaining: 1 })
    const full = ok(projectCanonicalCoverage(plan, evidence, 21))
    expect(full.rows.slice(0, 19)).toStrictEqual(prefix.rows)
    if (partnerBalance < 737.17) {
      expect(full).toMatchObject({
        blocked: { year: 2045, status: 'unsupported', issues: [
          { detail: 'mortgage scheduled payment cannot be fully funded' },
        ] },
        uncomputedYears: [2046],
      })
      expect(full.rows).toStrictEqual(prefix.rows)
      expect(full.state).toStrictEqual(prefix.state)
    } else {
      expect(full.blocked).toBeNull()
      expect(full.rows[19]).toMatchObject({
        byDebt: { [DEBT]: { payment: installment, closing: 0 } },
        byAccount: { [SELF_ACCOUNT]: { closing: 0 }, [PARTNER_ACCOUNT]: { closing: 0 } },
        householdWithdrawalSettlement: { postings: [
          posting(SELF_ACCOUNT, RETIREE, 500), posting(PARTNER_ACCOUNT, PARTNER, 737.17),
        ] },
      })
      expect(full.rows[20]).toMatchObject({
        cashLedger: { debtPayments: 0, spending: 0 },
        tfsaLedger: { [RETIREE]: { restored: known(500) }, [PARTNER]: { restored: known(737.17) } },
      })
      expect(full.state.tfsaWithdrawalHistory?.slice(-2).map(({ calendarYear, personId, amount }) => (
        { calendarYear, personId, amount }
      ))).toEqual([
        { calendarYear: 2045, personId: RETIREE, amount: 500 },
        { calendarYear: 2045, personId: PARTNER, amount: 737.17 },
      ])
    }
  })
})

describe('ordered mortgage sheet and route boundaries', () => {
  it('keeps opaque account IDs in metadata and explains funding and posting in all three locales', () => {
    const { plan, evidence } = fixture({ selfAccount: '__proto__', partnerAccount: 'constructor' })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage.blocked).toBeNull()
    const row = coverage.rows[1]
    expect(Object.keys(row.byAccount).sort()).toEqual(['__proto__', 'constructor'])
    expect(row.householdWithdrawalSettlement?.postings).toStrictEqual([
      posting('__proto__', RETIREE, 650), posting('constructor', PARTNER, 208.15),
    ])
    expect(Object.keys(coverage.state.mortgageExactBalances!).sort()).toEqual(['__proto__', 'constructor'])
    expect(coverage.state.tfsaWithdrawalHistory?.map(entry => entry.id)).toEqual([
      'annual:2027:withdrawal:__proto__', 'annual:2027:withdrawal:constructor', 'annual:2028:withdrawal:constructor',
    ])

    const sheet = canonicalAnnualSheet(coverage, context)
    const order = sheetRow(sheet.rows, 'household', 'mortgageFundingAuthorization')
    const debits = sheetRow(sheet.rows, 'household', 'withdrawalPosting')
    const living = sheetRow(sheet.rows, 'retirement', 'spendingFunded')
    expect(order.cells![2027]).toMatchObject({ value: 2, timing: 'during-year', unit: 'number' })
    expect(debits.cells![2027]).toMatchObject({ value: 858.15, timing: 'during-year', basis: 'nominal-CAD' })
    expect(living.cells![2027]).toMatchObject({ value: 350, basis: 'nominal-CAD' })
    const explain = (sheetEntry: AnnualSheetRow) => sheet.resolveExplanation!(sheetEntry.cells![2027].explanationRefs![0])!
    const orderExplanation = explain(order)
    const debitExplanation = explain(debits)
    const orderSource = orderExplanation.sources?.find(source => source.field === 'household.mortgageFundingAuthorization')
    const debitSource = debitExplanation.sources?.find(source => source.field === 'household.withdrawalPosting')
    const formula = explain(living).formula!
    expect(formula.filter(term => term.field === 'debtPayments')).toEqual([
      expect.objectContaining({ value: 1_000, direction: 'subtract' }),
    ])
    expect(formula.filter(term => term.field === 'withdrawal').map(({ sourceId, value }) => ({ sourceId, value })))
      .toEqual(expect.arrayContaining([
        { sourceId: 'annual:2027:withdrawal:__proto__', value: 650 },
        { sourceId: 'annual:2027:withdrawal:constructor', value: 208.15 },
      ]))
    expect(formula.filter(term => term.field === 'withdrawal')).toHaveLength(2)
    expect(formula.reduce((cash, term) => cash + (term.direction === 'add' ? term.value : -term.value), 0)).toBeCloseTo(350, 10)
    for (const [locale, authorized, restoration, orderLabel, debitLabel] of [
      ['en', /both owners explicitly authorized.*mortgage is paid before living/i, /owner’s TFSA room next year/, /dated authorization from both owners/i, /ordered owner debit receipts/i],
      ['fr', /deux titulaires.*l’ordre.*précède les dépenses courantes/i, /droits CELI l’année suivante/, /autorisation datée des deux titulaires/i, /reçus des débits ordonnés par titulaire/i],
      ['zh', /双方持有人已明确授权记录的账户顺序.*先支付到期房贷，再支付生活支出/, /次年恢复该持有人的 TFSA 额度/, /双方持有人注明日期的授权/, /按顺序记录的持有人扣款凭证/],
    ] as const) {
      expect(annualSheetText(orderExplanation.summary!, locale)).toMatch(authorized)
      expect(annualSheetText(debitExplanation.summary!, locale)).toMatch(restoration)
      expect(annualSheetText(orderSource!.label, locale)).toMatch(orderLabel)
      expect(annualSheetText(debitSource!.label, locale)).toMatch(debitLabel)
      const visible = [sheet.scope, order.label, debits.label, orderExplanation.summary!, debitExplanation.summary!,
        ...[...orderExplanation.sources!, ...debitExplanation.sources!].flatMap(source => (
          source.displayReference ? [source.label, source.displayReference] : [source.label]
        )), ...formula.map(term => term.label)]
      expect(visible.map(value => annualSheetText(value, locale)).join(' ')).not.toMatch(/__proto__|constructor/)
    }
  })

  it('describes the admitted two-owner funding in the scope in all three locales', () => {
    const { plan, evidence } = fixture()
    const sheet = canonicalAnnualSheet(ok(projectCanonicalCoverage(plan, evidence, 3)), context)
    for (const [locale, twoOwner] of [
      ['en', /two (?:ordinary |funded )*TFSA|both owners/i],
      ['fr', /deux (?:CELI|titulaires)/i],
      ['zh', /两个\s*(?:普通\s*)?TFSA|双方持有人/],
    ] as const) {
      expect(annualSheetText(sheet.scope, locale)).toMatch(twoOwner)
    }
  })

  it('shows the dated order and each actual debit in localized account and owner detail', () => {
    const { plan, evidence } = fixture({ partnerFirst: true })
    const sheet = canonicalAnnualSheet(ok(projectCanonicalCoverage(plan, evidence, 4)), context)
    const authorization = sheetRow(sheet.rows, 'household', 'mortgageFundingAuthorization')
    const postings = sheetRow(sheet.rows, 'household', 'withdrawalPosting')
    const sources = (entry: AnnualSheetRow, year: number, field: string) => (
      sheet.resolveExplanation!(entry.cells![year].explanationRefs![0])!.sources!.filter(source => source.field === field)
    )
    const authorized = sources(authorization, 2027, 'household.mortgageFundingAuthorization')
    const mixedDebits = sources(postings, 2027, 'household.withdrawalPosting')
    const retiredDebits = sources(postings, 2028, 'household.withdrawalPosting')
    for (const [year, total, amounts] of [
      [2027, 858.15, [858.15]],
      [2028, 1_241.85, [591.85, 650]],
    ] as const) {
      const cell = postings.cells![year]
      expect(cell).toMatchObject({ value: total, unit: 'CAD', basis: 'nominal-CAD' })
      const terms = sheet.resolveExplanation!(cell.explanationRefs![0])!.formula!
      expect(terms.map(term => ({ field: term.field, value: term.value, unit: term.unit, basis: term.basis })))
        .toStrictEqual(amounts.map(value => ({ field: 'household.withdrawalPosting', value, unit: 'CAD', basis: 'nominal-CAD' })))
      const signedTotal = terms.reduce((sum, term) => sum + (term.direction === 'add' ? term.value : -term.value), 0)
      expect(signedTotal).toBe(total)
    }
    for (const [locale, account, person, order] of [
      ['en', '[Aa]ccount', '[Pp]erson', 'Order'],
      ['fr', '[Cc]ompte(?:\\s+CELI)?', '[Pp]ersonne', 'Ordre'],
      ['zh', '账户', '人员', '顺序'],
    ] as const) {
      const visible = (entries: typeof authorized) => entries.map(source => [
        annualSheetText(source.label, locale),
        source.displayReference ? annualSheetText(source.displayReference, locale) : '',
      ].join(' '))
      const ownerAndAccount = (number: number) => {
        const accountLabel = new RegExp(`${account}\\s*#?${number}(?!\\d)`)
        const personLabel = new RegExp(`${person}\\s*#?${number}(?!\\d)`)
        return (line: string) => accountLabel.test(line) && personLabel.test(line)
      }
      const owners = [2, 1]
      const namedOrder = visible(authorized).filter(line => owners.some(number => ownerAndAccount(number)(line)))
      expect(namedOrder, locale).toHaveLength(2)
      expect(namedOrder[0]).toSatisfy(ownerAndAccount(2))
      expect(namedOrder[1]).toSatisfy(ownerAndAccount(1))
      expect(namedOrder[0]).toMatch(new RegExp(`${order}\\s+1\\b`))
      expect(namedOrder[1]).toMatch(new RegExp(`${order}\\s+2\\b`))
      for (const line of namedOrder) expect(line).toMatch(/\b2025\b/)
      const namedMixedDebits = visible(mixedDebits).filter(line => owners.some(number => ownerAndAccount(number)(line)))
      expect(namedMixedDebits).toHaveLength(1)
      expect(namedMixedDebits[0]).toSatisfy(ownerAndAccount(2))
      expect(namedMixedDebits[0]).toMatch(/858[.,]15/)
      const namedRetiredDebits = visible(retiredDebits).filter(line => owners.some(number => ownerAndAccount(number)(line)))
      expect(namedRetiredDebits).toHaveLength(2)
      expect(namedRetiredDebits[0]).toSatisfy(ownerAndAccount(2))
      expect(namedRetiredDebits[0]).toMatch(/591[.,]85/)
      expect(namedRetiredDebits[1]).toSatisfy(ownerAndAccount(1))
      expect(namedRetiredDebits[1]).toMatch(/\b650\b/)
      expect(visible([...authorized, ...mixedDebits, ...retiredDebits]).join(' '))
        .not.toMatch(/self-private-account|partner-private-account|partner-owner|retiree/)
    }
  })

  it('explains the exact reached-sale account restriction even after the first authorized TFSA is exhausted', () => {
    const { plan, evidence, years } = integratedHouseholdFixture()
    const { self, partner, tfsa, debt, home } = integratedHouseholdIds
    const singleOwner = ok(projectCanonicalCoverage(plan, evidence, years))
    expect(singleOwner.blocked).toBeNull()
    expect(singleOwner.rows[2].retirementSettlement?.primaryHomeSale?.mortgagePayoff)
      .toMatchObject({ debtId: debt })

    plan.accounts[0].balance = 0.1
    plan.accounts.push({ ...structuredClone(plan.accounts[0]), id: PARTNER_ACCOUNT, ownerId: partner, balance: 9_999,
      taxableOwnerShares: { status: 'known', shares: { [partner]: 1 } } })
    plan.annualHouseholdMortgageFundingEvidence = {
      orderedAccounts: [{ accountId: tfsa, ownerId: self }, { accountId: PARTNER_ACCOUNT, ownerId: partner }],
      authorized: true, purpose: 'household-held-mortgage-and-living', provenance: recorded,
    }
    // The extra ten cents of mixed spending consumes the first balance.
    evidence.transitionSpending = known(9_967.75)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows[1].householdWithdrawalSettlement?.postings).toStrictEqual([posting(tfsa, self, 0.1)])
    expect(prefix.state.byAccount[tfsa].balance).toBe(0)
    expect(prefix.state.byAccount[PARTNER_ACCOUNT].balance).toBe(9_999)
    expect(prefix.state.byDebt[debt].principal).toBe(1_210)
    expect(prefix.state.byProperty[home]).toMatchObject({ held: true, value: 12_500 })

    const result = ok(projectCanonicalCoverage(plan, evidence, years))
    expect(result.blocked).toMatchObject({ year: 2028, status: 'unsupported', causes: ['propertySale'] })
    expect(result.uncomputedYears).toEqual([2029, 2030, 2031])
    expect(result.rows).toStrictEqual(prefix.rows)
    expect(result.state).toStrictEqual(prefix.state)
    expect(result.state.primaryHomeSaleCash).toBeUndefined()

    const sheet = canonicalAnnualSheet(result, context)
    const netWorth = sheetRow(sheet.rows, 'netWorth').cells!
    expect(netWorth[2028]).toMatchObject({ value: null, status: 'not-computed' })
    expect(netWorth[2029]).toMatchObject({ value: null, status: 'not-computed' })
    const explanation = sheet.resolveExplanation!(netWorth[2028].explanationRefs![0])!
    expect(explanation.sources?.[0].code).toBe('propertySale')
    for (const [locale, reason, suffix] of [
      ['en', /two initially funded TFSA accounts.*after one is exhausted.*single funded account.*no sale or mortgage payoff/i, 'Not computed after the first blocked year.'],
      ['fr', /deux CELI initialement approvisionnés.*après épuisement.*un seul compte approvisionné.*aucun produit de vente ni remboursement/i, 'Non calculé après la première année bloquée.'],
      ['zh', /最初有两个有余额的 TFSA.*一个后来耗尽.*仅一个有余额的账户.*不记录出售或房贷清偿/, '首个受阻年度之后未计算。'],
    ] as const) {
      expect(annualSheetText(netWorth[2028].reason!, locale)).toMatch(reason)
      expect(annualSheetText(explanation.summary!, locale)).toBe(annualSheetText(netWorth[2028].reason!, locale))
      expect(annualSheetText(netWorth[2029].reason!, locale)).toBe(suffix)
    }
  })

  it.each([
    ['missing-sale-payoff', [
      /matching dated opening mortgage payoff terms.*missing or incompatible/i,
      /modalités datées concordantes.*manquants ou incompatibles/i,
      /注明日期的期初房贷偿还条款.*缺失或不符/,
    ]],
    ['event-financing-gap', [
      /net sale proceeds cannot repay the quoted opening mortgage principal/i,
      /produit net de vente ne suffit pas à rembourser le capital hypothécaire initial/i,
      /出售净所得不足以偿还期初房贷报价本金/,
    ]],
    ['missing-owner-exclusions', [
      /proof for every positive title interest.*joint cash authorization/i,
      /preuve pour chaque intérêt positif.*autorisation des liquidités communes/i,
      /每项正产权证明.*现金共同开支授权/,
    ]],
  ] as const)('preserves the legacy one-owner reached-sale reason for %s', (kind, reasons) => {
    const { plan, evidence, years } = kind === 'missing-owner-exclusions'
      ? integratedHouseholdFixture() : integratedHouseholdVariant(kind)
    if (kind === 'missing-owner-exclusions') delete plan.annualPrimaryHomeSaleEvidence![integratedHouseholdIds.home].ownerExclusions
    const result = ok(projectCanonicalCoverage(plan, evidence, years))
    expect(result.blocked).toMatchObject({ year: 2028, status: 'unsupported', causes: ['propertySale'] })
    const cell = sheetRow(canonicalAnnualSheet(result, context).rows, 'netWorth').cells![2028]
    expect(cell).toMatchObject({ value: null, status: 'not-computed' })
    for (const [index, locale] of ['en', 'fr', 'zh'].entries()) {
      expect(annualSheetText(cell.reason!, locale)).toMatch(reasons[index])
    }
  })

  it('does not authorize the ordinary debt-free route or alter its ownership refusal', () => {
    const { plan, evidence } = fixture({ working: 2_951.1, mixed: 650 })
    plan.debts = []
    plan.properties = []
    const ordinary = structuredClone(plan)
    delete ordinary.annualHouseholdMortgageFundingEvidence
    const expected = ok(projectCanonicalCoverage(ordinary, evidence, 3))
    expect(expected).toMatchObject({ blocked: { year: 2027, status: 'unsupported', causes: ['withdrawalOwnership'] } })
    expect(ok(projectCanonicalCoverage(plan, evidence, 3))).toStrictEqual(expected)
  })

  it('preserves standalone, provider, solo and legacy outputs with the additive authorization', () => {
    const { plan, evidence } = fixture()
    const baseline = structuredClone(plan)
    delete baseline.annualHouseholdMortgageFundingEvidence
    const opening = ok(initializeState(plan))
    const before = structuredClone(opening)
    const providers: AnnualProviders = {
      evaluate: () => ({ byPerson: Object.fromEntries(plan.people.map(person => [person.id, {
        income: person.role === 'self' ? 1_000 : 0, earnedIncome: 0, benefits: 0, tax: 0, spending: 0,
        taxableIncome: 0, benefitIncomeForNextYear: known(0),
      }])) }),
      returns: () => 0,
    }
    expect(annualStep(plan, opening, providers)).toStrictEqual(annualStep(baseline, opening, providers))
    expect(projectFromState(plan, opening, 2, providers)).toStrictEqual(projectFromState(baseline, opening, 2, providers))
    expect(projectAnnualCoverage(plan, opening, 2, providers))
      .toStrictEqual(projectAnnualCoverage(baseline, opening, 2, providers))
    expect(evaluateCanonicalHouseholdWorkingYear(plan, evidence, BASE_YEAR))
      .toStrictEqual(evaluateCanonicalHouseholdWorkingYear(baseline, evidence, BASE_YEAR))
    expect(annualRetirementStep(plan, opening)).toStrictEqual(annualRetirementStep(baseline, opening))
    expect(opening).toStrictEqual(before)
    const generated = ok(projectCanonicalCoverage(plan, evidence, 2)).state
    expect(annualRetirementContinuation(plan, generated, evidence)).toMatchObject({ status: 'invalid' })
    expect(annualStep(plan, generated, providers)).toMatchObject({ status: 'invalid' })

    const solo = fixture({ selfBalance: 3_000, installments: 2, working: 1_459.25 })
    solo.plan.people.pop()
    solo.plan.accounts.pop()
    delete solo.plan.tfsaStatement![PARTNER]
    const ordinarySolo = structuredClone(solo.plan)
    delete ordinarySolo.annualHouseholdMortgageFundingEvidence
    const soloResult = ok(projectCanonicalCoverage(solo.plan, solo.evidence, 3))
    expect(soloResult.blocked).toBeNull()
    expect(soloResult.rows[1]).toMatchObject({
      cashLedger: { debtPayments: 1_000, spending: 300 },
      byAccount: { [SELF_ACCOUNT]: { withdrawal: 1_300, closing: 1_700 } },
    })
    expect(soloResult).toStrictEqual(ok(projectCanonicalCoverage(ordinarySolo, solo.evidence, 3)))

    for (const sample of [undefined, () => -0.04]) {
      const inputs = plan.legacyProjection
      const legacy = runProjection(inputs, sample, plan, { captureAnnualDetails: true })
      const legacyBaseline = runProjection(inputs, sample, baseline, { captureAnnualDetails: true })
      expect(legacy).toStrictEqual(legacyBaseline)
      expect(legacyAnnualSheet(legacy, inputs, context).rows).toStrictEqual(legacyAnnualSheet(legacyBaseline, inputs, context).rows)
    }
  })
})
