import { describe, expect, it } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetExplanation, type AnnualSheetRow } from '../../annualSheet'
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
import { cppStart } from './fixtures/annualCpp'
import { householdBenefitExclusions } from './fixtures/annualHouseholdOas'
import { BASE_YEAR, known, legacyRetirement, recorded, retirementPlan, RETIREE, RRSP, TFSA } from './fixtures/retirementSettlement'

const PARTNER = 'mortgage-benefit-partner'
const PARTNER_TFSA = 'mortgage-benefit-partner-tfsa'
const HOME = 'held-benefit-home'
const DEBT = 'fixed-benefit-mortgage'
const EVENT = 'one-time-overhead'
const MIXED = BASE_YEAR + 1
const RETIRED = BASE_YEAR + 2
const context = { scenarioId: 'mortgage-benefits', revision: 1 }

function replay(formula: AnnualSheetExplanation['formula']) {
  return formula!.reduce((cash, term) => cash + (term.direction === 'add' ? term.value : -term.value), 0)
}

const close = (value: number) => expect.closeTo(value, 7)
const authorization = {
  authorized: true,
  purpose: 'household-held-mortgage-with-verified-public-benefits',
  provenance: { origin: 'user', sourceYear: BASE_YEAR - 1 },
} as const

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function decimal(text: string) {
  const [integer, fraction = ''] = text.split('.')
  const significant = fraction.replace(/0+$/, '')
  return { coefficient: BigInt(integer + significant).toString(), scale: significant.length }
}

type BenefitFact = readonly [amount: number, claimAge: number]
function setClaims(plan: InputsV2, index: number, retirementAge: number, cpp: BenefitFact, oas: BenefitFact) {
  const person = plan.people[index]
  Object.assign(person, { retirementAge, cppAnnualAt65: cpp[0], oasAnnualAt65: oas[0] })
  plan.incomeSources = plan.incomeSources.filter(source => source.recipientId !== person.id)
  if (cpp[0]) plan.incomeSources.push(cppStart(person.id, cpp[1], cpp[0]))
  if (oas[0]) plan.incomeSources.push({
    id: person.id + ':oas', kind: 'oas', recipientId: person.id, startAge: oas[1], annualAmount: known(oas[0]), provenance: recorded,
  })
}

function fixture({
  inflation = 0.125, selfBalance = 20_000, partnerBalance = 0, partnerFirst = false,
  selfWage = 9_500, working = 219, mixed = 2_000, retired = 10_000, payment = 9_261, principal = 25_220,
} = {}) {
  const plan = retirementPlan({ age: 65, tfsa: selfBalance, rrsp: 0, inflation, spending: retired, strategy: 'tfsaFirst' })
  const self = plan.people[0]
  Object.assign(self, { earnedIncome: known(selfWage), tfsaAvailableRoom: known(8_321) })
  plan.people.push({
    ...structuredClone(self), id: PARTNER, role: 'partner', ageInBaseYear: 63,
    earnedIncome: known(500), tfsaAvailableRoom: known(5_432),
  })
  setClaims(plan, 0, 66, [5_000, 66], [2_000, 66])
  setClaims(plan, 1, 65, [2_000, 65], [300, 66])
  plan.people[1].oasAmountSource = {
    source: 'statement', sourceYear: BASE_YEAR, ageBasis: 66, basis: 'monthly', dollarBasis: 'today',
    premises: { retirementAge: 65 },
  }
  plan.accounts = plan.accounts.filter(account => account.id === TFSA)
  if (partnerBalance > 0) {
    plan.accounts.push({
      ...structuredClone(plan.accounts[0]), id: PARTNER_TFSA, ownerId: PARTNER, balance: partnerBalance,
      taxableOwnerShares: { status: 'known', shares: { [PARTNER]: 1 } },
    })
    const selfRef = { accountId: TFSA, ownerId: RETIREE }
    const partnerRef = { accountId: PARTNER_TFSA, ownerId: PARTNER }
    plan.annualHouseholdMortgageFundingEvidence = {
      orderedAccounts: partnerFirst ? [partnerRef, selfRef] : [selfRef, partnerRef], authorized: true,
      purpose: 'household-held-mortgage-and-living', provenance: recorded,
    }
  }
  plan.tfsaStatement![PARTNER] = { withdrawals: [], provenance: recorded }
  plan.annualBenefitsEvidence = {
    [RETIREE]: householdBenefitExclusions(RETIREE), [PARTNER]: householdBenefitExclusions(PARTNER),
  }
  plan.annualHouseholdMortgageBenefitsEvidence = structuredClone(authorization)
  plan.taxProfile = { spouseSupported: known(false), pensionSplit: null }
  plan.lifeExpectancy = 71
  plan.budget = { kind: 'incomeBudget', workingSpending: working, retirementSpending: retired }
  plan.properties.push({
    id: HOME, kind: 'principal', value: 480_000, acb: known(240_000), annualRent: known(0),
    appreciation: 0, annualHoldingCostChange: 0, sellAtAge: null, plannedPurchaseAge: null,
    plannedDownPayment: null, plannedMortgage: null, mortgageDebtId: DEBT,
    taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 0.375, [PARTNER]: 0.625 } },
    provenance: { value: recorded, acb: recorded, taxableOwnerShares: recorded },
  })
  plan.debts.push({ id: DEBT, propertyId: HOME, kind: 'mortgage', principal,
    annualPayment: payment, yearsRemaining: 3, provenance: recorded })
  plan.legacyProjection = legacyRetirement({
    currentAge: 65, fireAge: 66, lifeExpectancy: 69, inflation, retirementSpending: retired, strategy: 'tfsaFirst',
    cppStartAge: 66, cppAnnualAt65: 5_000, oasStartAge: 66, oasAnnualAt65: 2_000,
    balances: { tfsa: selfBalance + partnerBalance, rrsp: 0, nonReg: 0 },
    partner: { currentAge: 63, cppStartAge: 65, cppAnnualAt65: 2_000, oasStartAge: 66, oasAnnualAt65: 300 },
    principalResidence: { value: 480_000, appreciation: 0, sellAtAge: null,
      mortgage: { balance: principal, annualPayment: payment, yearsRemaining: 3 } },
  })
  const evidence: WorkingSpendingEvidence = {
    workingSpending: known(working), transitionSpending: known(mixed), retirementSpending: known(retired),
    scheduledMortgagePaymentsExcluded: known(true),
  }
  return { plan, evidence }
}

function sheetRow(rows: AnnualSheetRow[], ...path: string[]) {
  const id = canonicalSheetId('value', ...path)
  const found = rows.flatMap(row => [row, ...(row.children ?? [])]).find(row => row.id === id)
  if (!found) throw new Error('Missing annual sheet row ' + id)
  return found
}

function debit(accountId: string, ownerId: string, amount: number) {
  return { accountId, ownerId, kind: 'tfsa', amount }
}

function history(calendarYear: number, accountId: string, personId: string, amount: number) {
  return { id: 'annual:' + calendarYear + ':withdrawal:' + accountId, personId, calendarYear, amount }
}

describe('FE-53 S2 verified benefits with a held mortgage', () => {
  const clock = ['1', '1.125', '1.265625', '1.423828125']
  // Work back from zero at maturity at 5% annual interest. The mortgage
  // remains nominal while income, expenses, and zero-real-return balances grow.
  const schedule = [
    [25_220, 1_261, 8_000, 17_220], [17_220, 861, 8_400, 8_820], [8_820, 441, 8_820, 0], [0, 0, 0, 0],
  ]
  // Self defers the age-65 amounts by 12 months. CPP gains 8.4%, OAS 7.2%.
  // Partner's recorded $300 OAS is already an age-66 figure and starts one year after retirement.
  // The $9,500 and $500 salaries pay $357 CPP plus $163 EI, then only $8.15 EI.
  // All regular tax is zero at these individual taxable amounts.
  const anchorIncome = [10_000, 5_920, 7_420, 7_420]
  const anchorSpending = [219, 2_000, 10_000, 10_000]
  const exactCpp = ['0', '6097.5', '9390.9375', '10564.8046875']
  const exactOas = ['0', '2412', '2713.5', '3479.8359375']
  const exactDraws = ['0', '2448.16875', '9812.8125', '193.640625']

  it('uses the existing person receipts and start CPI before fixed amortization, with a single funded owner', () => {
    const { plan, evidence } = fixture()
    const original = structuredClone({ plan, evidence })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false })
    const sheet = canonicalAnnualSheet(coverage, context)
    const closing = ['22500', '22558.31015625', '14338.68486328125', '15913.17476806640625']
    const selfAmounts = [
      ['0', '0'], ['6097.5', '2412'], ['6859.6875', '2713.5'], ['7717.1484375', '3052.6875'],
    ]
    const partnerAmounts = [
      ['0', '0'], ['0', '0'], ['2531.25', '0'], ['2847.65625', '427.1484375'],
    ]
    const entries: ReturnType<typeof history>[] = []
    for (const [index, row] of coverage.rows.entries()) {
      const cpi = Number(clock[index])
      const [opening, interest, principal, debtClosing] = schedule[index]
      const payment = index < 3 ? 9_261 : 0
      const payroll = [520, 8.15, 0, 0][index] * cpi
      const living = anchorSpending[index] * cpi
      const withdrawal = Number(exactDraws[index])
      expect(row).toMatchObject({
        year: BASE_YEAR + index, payrollContributions: close(payroll),
        byDebt: { [DEBT]: { propertyId: HOME, opening: close(opening), interest: close(interest),
          principal: close(principal), payment, closing: close(debtClosing) } },
        byPerson: {
          [RETIREE]: { cpp: Number(selfAmounts[index][0]), benefits: Number(selfAmounts[index][1]) },
          [PARTNER]: { cpp: Number(partnerAmounts[index][0]), benefits: Number(partnerAmounts[index][1]) },
        },
        cashLedger: { income: anchorIncome[index] * cpi, benefits: Number(exactOas[index]), debtPayments: payment,
          tax: 0, spending: living, unallocated: 0 },
        householdWithdrawalSettlement: {
          startCpi: cpi, taxIncrement: 0, taxTotal: 0,
          withdrawal, spendingDue: living, spendingFunded: living, spendingUnmet: 0,
          postings: withdrawal ? [debit(TFSA, RETIREE, withdrawal)] : [],
          publicBenefitsCash: {
            evidence: authorization, basis: 'anchor-real-quote-times-serialized-start-CPI', startCpi: decimal(clock[index]),
            cpp: decimal(exactCpp[index]), oasNet: decimal(exactOas[index]),
            byPerson: {
              [RETIREE]: { cppReal: decimal(index ? '5420' : '0'), oasNetReal: decimal(index ? '2144' : '0'),
                cpp: decimal(selfAmounts[index][0]), oasNet: decimal(selfAmounts[index][1]),
                postedIncome: [9_500, 5_420, 5_420, 5_420][index] * cpi,
                postedBenefits: Number(selfAmounts[index][1]), postedTax: 0 },
              [PARTNER]: { cppReal: decimal(index >= 2 ? '2000' : '0'), oasNetReal: decimal(index === 3 ? '300' : '0'),
                cpp: decimal(partnerAmounts[index][0]), oasNet: decimal(partnerAmounts[index][1]),
                postedIncome: (index < 2 ? 500 : 2_000) * cpi,
                postedBenefits: Number(partnerAmounts[index][1]), postedTax: 0 },
            },
          },
        },
        byAccount: { [TFSA]: { opening: index ? Number(closing[index - 1]) : 20_000,
          withdrawal, closing: Number(closing[index]), contribution: 0, ownerId: RETIREE } },
      })
      expect(row.byAccount[TFSA].mortgageExactWithdrawal).toEqual(withdrawal ? decimal(exactDraws[index]) : undefined)
      if (withdrawal) entries.push(history(row.year, TFSA, RETIREE, withdrawal))
      const prefix = ok(projectCanonicalCoverage(plan, evidence, index + 1))
      expect(prefix.rows).toStrictEqual(coverage.rows.slice(0, index + 1))
      expect(prefix.state.mortgageExactBalances).toStrictEqual({ [TFSA]: decimal(closing[index]) })
      expect(prefix.state.tfsaWithdrawalHistory).toStrictEqual(entries)
      expect(row.tfsaLedger).toMatchObject({
        [RETIREE]: { restored: known([0, 0, 2_448.17, 9_812.81][index]), applied: 0 },
        [PARTNER]: { restored: known(0), applied: 0 },
      })
      const paymentCell = sheetRow(sheet.rows, 'debt', DEBT, 'payment').cells![row.year]
      expect(annualSheetDisplayValue(paymentCell, sheet.years[index], 'real')).toBeCloseTo(payment / cpi, 7)
      const balanceCell = sheetRow(sheet.rows, 'account', TFSA, 'closing').cells![row.year]
      expect(annualSheetDisplayValue(balanceCell, sheet.years[index], 'real')).toBeCloseTo(Number(closing[index]) / (cpi * 1.125), 7)
    }
    expect({ plan, evidence }).toStrictEqual(original)
  })

  it('uses the serialized 2% start CPI when finite-decimal cash differs from the posted Number', () => {
    const { plan, evidence } = fixture({ inflation: 0.02 })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage.blocked).toBeNull()
    const row = coverage.rows[3]
    // At offset three the existing numeric clock serializes as 1.0612080000000002.
    // The worksheet multiplies 7,420 CPP, 2,444 net OAS and the 136 living gap
    // separately by that decimal after the last nominal installment has cleared.
    expect(row.householdWithdrawalSettlement!.publicBenefitsCash).toMatchObject({
      startCpi: decimal('1.0612080000000002'),
      cpp: decimal('7874.163360000001484'),
      oasNet: decimal('2593.5923520000004888'),
      netCashBeforeWithdrawals: decimal('-144.3242880000000272'),
      byPerson: {
        [RETIREE]: { cpp: decimal('5751.747360000001084'), oasNet: decimal('2275.2299520000004288') },
        [PARTNER]: { cpp: decimal('2122.4160000000004'), oasNet: decimal('318.36240000000006') },
      },
    })
    expect(row.byAccount[TFSA].mortgageExactWithdrawal).toStrictEqual(decimal('144.3242880000000272'))
  })

  it.each([false, true])('carries exact balances and restores the two actual owners in authorized order, partner first=%s', partnerFirst => {
    const { plan, evidence } = fixture({
      selfBalance: partnerFirst ? 16_000 : 2_500, partnerBalance: partnerFirst ? 2_500 : 16_000, partnerFirst,
    })
    // Neither the people list nor the accounts list authorizes order.
    plan.people.reverse()
    plan.accounts.reverse()
    const first = partnerFirst ? [PARTNER_TFSA, PARTNER] as const : [TFSA, RETIREE] as const
    const second = partnerFirst ? [TFSA, RETIREE] as const : [PARTNER_TFSA, PARTNER] as const
    const years = [
      { draws: ['0', '0'], balances: ['2812.5', '18000'], restores: [0, 0] },
      { draws: ['2448.16875', '0'], balances: ['409.87265625', '20250'], restores: [0, 0] },
      { draws: ['409.87265625', '9402.93984375'], balances: ['0', '12202.94267578125'], restores: [2_448.17, 0] },
      { draws: ['0', '193.640625'], balances: ['0', '13510.46480712890625'], restores: [409.87, 9_402.94] },
    ]
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage.blocked).toBeNull()
    const entries: ReturnType<typeof history>[] = []
    for (const [index, { draws, balances, restores }] of years.entries()) {
      const row = coverage.rows[index]
      const prefix = ok(projectCanonicalCoverage(plan, evidence, index + 1))
      const postings = []
      for (const [j, [accountId, ownerId]] of [first, second].entries()) {
        const amount = Number(draws[j])
        if (amount) {
          postings.push(debit(accountId, ownerId, amount))
          entries.push(history(row.year, accountId, ownerId, amount))
        }
        expect(row.byAccount[accountId]).toMatchObject({ ownerId, withdrawal: amount, closing: Number(balances[j]), contribution: 0 })
        expect(row.byAccount[accountId].mortgageExactWithdrawal).toEqual(amount ? decimal(draws[j]) : undefined)
        expect(prefix.state.mortgageExactBalances![accountId]).toStrictEqual(decimal(balances[j]))
        // The history and carry are unrounded, but the existing room ledger operates in cents.
        expect(row.tfsaLedger[ownerId]).toMatchObject({ restored: known(restores[j]), applied: 0 })
      }
      expect(row.householdWithdrawalSettlement).toMatchObject({
        orderedFundingAuthorization: plan.annualHouseholdMortgageFundingEvidence, postings,
        withdrawal: Number(exactDraws[index]), spendingUnmet: 0, taxIncrement: 0,
        accountId: postings.length === 1 ? postings[0].accountId : null,
        ownerId: postings.length === 1 ? postings[0].ownerId : null,
      })
      expect(prefix.state.tfsaWithdrawalHistory).toStrictEqual(entries)
    }
  })
})

describe('ordinary claim income, recipient recovery and regular tax', () => {
  it('deducts OAS recovery before tax and cash, once in each mixed and both-retired settlement', () => {
    const { plan, evidence } = fixture({ selfBalance: 40_000, mixed: 85_000, retired: 100_000 })
    setClaims(plan, 0, 66, [100_000, 66], [9_150, 66])
    setClaims(plan, 1, 65, [8_000, 65], [8_000, 65])
    plan.people[0].cppAmountSource!.ageBasis = 66
    plan.people[0].oasAmountSource!.ageBasis = 66
    plan.people[1].oasAmountSource!.ageBasis = 65

    // Recipient income for recovery is $100,000 CPP + $9,150 gross OAS.
    // 2026 anchor recovery starts at $95,323 and takes 15% of the excess.
    // Compute regular federal and Ontario taxes on income after recovery.
    const recovered = (109_150 - 95_323) * 0.15
    const netOas = 9_150 - recovered
    const taxable = 100_000 + netOas
    const federalAge = 9_208 - (taxable - 46_432) * 0.15
    const federal = (58_523 - 16_452 - federalAge) * 0.14 + (taxable - 58_523) * 0.205
    const provincial = (53_891 - 12_989) * 0.0505 + (taxable - 53_891) * 0.0915
    const tax = federal + provincial + (provincial - 5_818) * 0.20 + 750
    expect(tax).toBeCloseTo(23_732.46641, 7)

    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage.blocked).toBeNull()
    const sheet = canonicalAnnualSheet(coverage, context)
    for (const row of coverage.rows.slice(1, 3)) {
      const mixed = row.year === MIXED
      const cpi = mixed ? 1.125 : 1.265625
      const income = (mixed ? 100_500 : 108_000) * cpi
      const benefits = (netOas + (mixed ? 0 : 8_000)) * cpi
      const payroll = (mixed ? 8.15 : 0) * cpi
      const due = (mixed ? 85_000 : 100_000) * cpi
      const draw = due + 9_261 - (income + benefits - tax * cpi - payroll)
      expect(row).toMatchObject({
        workingSettlement: { household: { phase: mixed ? 'mixed' : 'both-retired', byPerson: {
          [RETIREE]: { oas: { recoveryIncomeReal: 109_150, recoveryReal: close(recovered) } },
        } } },
        byPerson: {
          [RETIREE]: { income: 100_000 * cpi, cpp: 100_000 * cpi, oasGross: 9_150 * cpi, oasRecovery: close(recovered * cpi),
            oasNet: close(netOas * cpi), taxableIncome: close(taxable * cpi), tax: close(tax * cpi) },
          [PARTNER]: { earnedIncome: mixed ? 500 * cpi : 0, oasRecovery: 0, tax: 0 },
        },
        cashLedger: { income, benefits: close(benefits), tax: close(tax * cpi), spending: due, debtPayments: 9_261, unallocated: 0 },
        payrollContributions: close(payroll),
        householdWithdrawalSettlement: { withdrawal: close(draw), taxTotal: close(tax * cpi), taxIncrement: 0,
          spendingFunded: due, spendingUnmet: 0, postings: [{ ...debit(TFSA, RETIREE, 0), amount: close(draw) }],
          publicBenefitsCash: { byPerson: { [RETIREE]: {
            // The existing recovery calculation serializes the quote one ULP
            // above the independent $7,075.95 economic result.
            cppReal: decimal('100000'), oasNetReal: decimal('7075.950000000001'),
            oasNet: decimal(mixed ? '7960.443750000001125' : '8955.499218750001265625'),
            postedTax: close(tax * cpi),
          } } },
        },
      })
      const cell = sheetRow(sheet.rows, 'retirement', 'spendingFunded').cells![row.year]
      expect(replay(sheet.resolveExplanation!(cell.explanationRefs![0])!.formula)).toBe(due)
    }

    const auth = sheetRow(sheet.rows, 'household', 'mortgageBenefitsAuthorization')
    const cpp = sheetRow(sheet.rows, 'person', RETIREE, 'mortgageCppCash')
    const oas = sheetRow(sheet.rows, 'person', RETIREE, 'mortgageOasNetCash')
    expect(auth.cells![MIXED]).toMatchObject({ value: 1, unit: 'number', timing: 'during-year' })
    expect(cpp.cells![MIXED]).toMatchObject({ value: 112_500, basis: 'nominal-CAD', timing: 'during-year' })
    expect(oas.cells![MIXED]).toMatchObject({ value: close(7_960.44375), basis: 'nominal-CAD', timing: 'during-year' })
    const explanation = sheet.resolveExplanation!(oas.cells![MIXED].explanationRefs![0])!
    const source = explanation.sources!.find(entry => entry.field === 'incomeSources.oas')!
    expect(source.id).toBe(RETIREE + ':oas')
    const authSource = sheet.resolveExplanation!(auth.cells![MIXED].explanationRefs![0])!.sources!
      .find(entry => entry.field === 'annualHouseholdMortgageBenefitsEvidence')!
    expect(authSource).toBeDefined()
    for (const [locale, scope, label, recovery, authorizationLabel] of [
      ['en', /mandatory mortgage before living/i, /exact mortgage net OAS cash/i, /recovery is removed once/i, /dated user composition authorization/i],
      ['fr', /hypothèque obligatoire avant les dépenses courantes/i, /SV nettes hypothécaires exactes/i, /récupération retirée une fois/i, /autorisation de composition datée/i],
      ['zh', /先付必需房贷，再付生活支出/, /精确 OAS 净现金/, /扣回在净现金前仅扣一次/, /用户注明日期的组合授权/],
    ] as const) {
      expect(annualSheetText(sheet.scope, locale)).toMatch(scope)
      expect(annualSheetText(oas.label, locale)).toMatch(label)
      expect(annualSheetText(explanation.summary!, locale)).toMatch(recovery)
      expect(annualSheetText(authSource.label, locale)).toMatch(authorizationLabel)
      expect(annualSheetText(authSource.displayReference!, locale)).toContain(String(BASE_YEAR - 1))
    }
  })
})

describe('debt-first settlement and exact tiny receipts', () => {
  it.each([1_205.14, 1_205.1499])('rejects a true mortgage shortfall with $%s of available TFSA', selfBalance => {
    const { plan, evidence } = fixture({ inflation: 0, selfBalance })
    // Mixed wage + CPP + OAS − EI nets $8,055.85 against $9,261 mandatory debt.
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result).toMatchObject({
      rows: prefix.rows, state: prefix.state, uncomputedYears: [RETIRED, RETIRED + 1],
      blocked: { year: MIXED, status: 'unsupported', issues: [{ detail: 'mortgage scheduled payment cannot be fully funded' }] },
    })
    expect(result.state.tfsaWithdrawalHistory).toStrictEqual([])
  })

  it('commits exact debt-only coverage and leaves the whole living balance unpaid', () => {
    const { plan, evidence } = fixture({ inflation: 0, selfBalance: 1_205.15 })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows[1]).toMatchObject({
      cashLedger: { debtPayments: 9_261, spending: 0, unallocated: 0 },
      householdWithdrawalSettlement: { withdrawal: 1_205.15, spendingFunded: 0, spendingUnmet: 2_000,
        publicBenefitsCash: { beforeDrawsAfterDebt: decimal('-1205.15'), afterDebt: decimal('0') } },
    })
    expect(coverage.state.tfsaWithdrawalHistory).toStrictEqual([history(MIXED, TFSA, RETIREE, 1_205.15)])
  })

  it.each([
    { tinyKind: 'oasNet', retired: 1e-12, funded: 1e-14 },
    { tinyKind: 'cpp', retired: 1e-12, funded: 1e-14 },
    { tinyKind: 'oasNet', retired: 0, funded: 0 },
  ] as const)('preserves $tinyKind cash against $1,000 debt with living due $retired', ({ tinyKind, retired, funded }) => {
    const { plan, evidence } = fixture({
      inflation: 0, selfWage: 2_500, selfBalance: 0, working: 1_459.25, mixed: 1e-12, retired, payment: 1_000, principal: 3_000,
    })
    plan.people[1].earnedIncome = known(0)
    setClaims(plan, 0, 66, [tinyKind === 'cpp' ? 1e-14 : 1_000, 66], [tinyKind === 'oasNet' ? 1e-14 : 1_000, 66])
    setClaims(plan, 1, 65, [0, 65], [0, 66])
    plan.people[0].cppAmountSource!.ageBasis = 66
    plan.people[0].oasAmountSource!.ageBasis = 66
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows[2]).toMatchObject({
      cashLedger: { debtPayments: 1_000, spending: funded, unallocated: 0 },
      householdWithdrawalSettlement: {
        withdrawal: 0, spendingDue: retired, spendingFunded: funded, spendingUnmet: retired ? 9.9e-13 : 0,
        publicBenefitsCash: { [tinyKind]: decimal('0.00000000000001'), afterDebt: decimal('0.00000000000001'),
          netCashBeforeWithdrawals: decimal(retired ? '-0.00000000000099' : '0.00000000000001') },
      },
    })
    const sheet = canonicalAnnualSheet(coverage, context)
    const cell = sheetRow(sheet.rows, 'retirement', 'spendingFunded').cells![RETIRED]
    const formula = sheet.resolveExplanation!(cell.explanationRefs![0])!.formula
    expect(cell.value).toBe(funded)
    expect(replay(formula)).toBe(funded)
    const beforeDraws = sheetRow(sheet.rows, 'cash', 'canonicalNetCash').cells![RETIRED]
    expect(beforeDraws.value).toBe(retired ? -9.9e-13 : 1e-14)
    expect(replay(sheet.resolveExplanation!(beforeDraws.explanationRefs![0])!.formula)).toBe(beforeDraws.value)
    const residual = sheetRow(sheet.rows, 'cash', 'mortgageBenefitsFundingResidual')
    expect(residual.cells![RETIRED].value).toBe(retired ? 0 : 1e-14)
    for (const [locale, label] of [
      ['en', /signed exact funding residual/i], ['fr', /résidu exact signé du financement/i], ['zh', /精确带符号筹资残余/],
    ] as const) {
      expect(annualSheetText(residual.label, locale)).toMatch(label)
    }
  })
})
function expenseFixture(amount = 300, effectiveYear = RETIRED, cashFirst = true, twoOwners = false) {
  const { plan, evidence } = fixture({
    inflation: 0, selfWage: 2_500, selfBalance: cashFirst ? 15.15 : twoOwners ? 613.15 : 615.15,
    partnerBalance: twoOwners ? 2 : 0, working: 1_951.1, mixed: cashFirst ? 100 : 0,
    retired: 4, payment: 1_000, principal: 3_000,
  })
  const cpp = cashFirst ? 600 : 300
  setClaims(plan, 0, 66, [cpp, 66], [0, 66])
  setClaims(plan, 1, 65, [cpp, 65], [0, 66])
  plan.people[0].cppAmountSource!.ageBasis = 66
  plan.annualHouseholdExpenseEvidence = {
    id: EVENT, effectiveYear, timing: 'after-mortgage-and-living',
    amountNominal: known(amount), amountBasis: 'event-year-nominal-CAD',
    noncapital: true, nonDeductible: true, allowPartialPayment: true,
    excludesFromLivingBudget: true, useExistingFundingOrder: true, provenance: recorded,
  }
  return { plan, evidence }
}

describe('the reached expense uses cash and then ordered debits after mortgage and living', () => {
  it('funds $203 of $300 from $196 remaining CPP and $7 TFSA, and explains the $104 pre-draw gap', () => {
    const { plan, evidence } = expenseFixture()
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(coverage.blocked).toBeNull()
    const row = coverage.rows[2]
    expect(row).toMatchObject({
      cashLedger: { income: 1_200, debtPayments: 1_000, spending: 4, expensePayments: 203, unallocated: 0 },
      householdWithdrawalSettlement: {
        postings: [debit(TFSA, RETIREE, 7)], withdrawal: 7, spendingFunded: 4, spendingUnmet: 0,
        publicBenefitsCash: { beforeDrawsAfterDebt: decimal('200'), afterDebt: decimal('207'),
          livingDue: decimal('4'), expenseDue: decimal('300'), netCashBeforeWithdrawals: decimal('-104') },
      },
      householdExpense: { eventId: EVENT, year: RETIRED, due: 300, paid: 203, unmet: 97,
        postings: [{ accountId: TFSA, ownerId: RETIREE, amount: 7 }] },
    })
    expect(row.workingSettlement?.netCash).toBe(0)
    expect(coverage.state.tfsaWithdrawalHistory).toStrictEqual([
      history(MIXED, TFSA, RETIREE, 8.15), history(RETIRED, TFSA, RETIREE, 7),
    ])
    expect(coverage.state.unfundedEvents).toStrictEqual([
      { eventId: EVENT, field: 'annualHouseholdExpenseEvidence.amountNominal', amount: 97, reason: 'householdExpense' },
    ])
    const sheet = canonicalAnnualSheet(coverage, context)
    const gap = sheetRow(sheet.rows, 'cash', 'canonicalNetCash').cells![RETIRED]
    const funded = sheetRow(sheet.rows, 'retirement', 'spendingFunded').cells![RETIRED]
    const explanation = sheet.resolveExplanation!(gap.explanationRefs![0])!
    expect(gap.value).toBe(-104)
    expect(replay(explanation.formula)).toBe(-104)
    const due = explanation.formula!.filter(term => term.field?.endsWith('.expenseDue'))
    expect(due).toMatchObject([{ value: 300, direction: 'subtract' }])
    const fundedFormula = sheet.resolveExplanation!(funded.explanationRefs![0])!.formula
    expect(replay(fundedFormula)).toBe(4)
    expect(fundedFormula!.filter(term => term.field === 'expensePayments')).toMatchObject([{ value: 203, direction: 'subtract' }])
    for (const [locale, timing] of [
      ['en', /expense due after mortgage and living/i],
      ['fr', /due après hypothèque et dépenses courantes/i],
      ['zh', /房贷及生活支出后到期已核实事件应付额/],
    ] as const) {
      expect(annualSheetText(due[0].label, locale)).toMatch(timing)
    }
  })

  it.each([false, true])('attributes only actual event debits after debt and living, two owners=%s', twoOwners => {
    const { plan, evidence } = expenseFixture(10, RETIRED, false, twoOwners)
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(coverage.blocked).toBeNull()
    const row = coverage.rows[2]
    expect(row).toMatchObject({
      cashLedger: { income: 600, debtPayments: 1_000, spending: 4, expensePayments: 3, unallocated: 0 },
      householdWithdrawalSettlement: { withdrawal: 407, spendingUnmet: 0, postings: twoOwners
        ? [debit(TFSA, RETIREE, 405), debit(PARTNER_TFSA, PARTNER, 2)]
        : [debit(TFSA, RETIREE, 407)] },
      householdExpense: { due: 10, paid: 3, unmet: 7, postings: [
        { accountId: TFSA, ownerId: RETIREE, amount: twoOwners ? 1 : 3 },
        ...(twoOwners ? [{ accountId: PARTNER_TFSA, ownerId: PARTNER, amount: 2 }] : []),
      ] },
    })
    expect(coverage.state.tfsaWithdrawalHistory).toStrictEqual([
      history(MIXED, TFSA, RETIREE, 208.15), history(RETIRED, TFSA, RETIREE, twoOwners ? 405 : 407),
      ...(twoOwners ? [history(RETIRED, PARTNER_TFSA, PARTNER, 2)] : []),
    ])
  })

  it('continues covered years without retrying the separate expense shortfall', () => {
    const { plan, evidence } = expenseFixture(10, RETIRED, false)
    Object.assign(plan.debts[0], { principal: 4_000, yearsRemaining: 4 })
    setClaims(plan, 1, 65, [300, 65], [404, 66])
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(prefix.rows[2].householdExpense).toMatchObject({ paid: 3, unmet: 7 })
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.blocked).toBeNull()
    expect(result.rows.slice(0, 3)).toStrictEqual(prefix.rows)
    expect(result.rows[3]).toMatchObject({
      cashLedger: { income: 600, benefits: 404, debtPayments: 1_000, spending: 4 },
      householdWithdrawalSettlement: { withdrawal: 0, spendingUnmet: 0 },
      tfsaLedger: { [RETIREE]: { restored: known(407) }, [PARTNER]: { restored: known(0) } },
    })
    expect(result.rows[3]).not.toHaveProperty('householdExpense')
    expect(result.state.unfundedEvents).toStrictEqual([])
    expect(result.state.householdExpenseReceipt).toStrictEqual(prefix.state.householdExpenseReceipt)
    expect(result.state.tfsaWithdrawalHistory).toStrictEqual(prefix.state.tfsaWithdrawalHistory)
  })

  it.each([
    ['under-sized', 195, RETIRED],
    ['future', 300, RETIRED + 1],
    ['absent', 300, RETIRED],
    ['malformed', 300, RETIRED],
  ] as const)('leaves a %s event unable to absorb otherwise unassigned surplus', (kind, amount, year) => {
    const { plan, evidence } = expenseFixture(amount, year)
    if (kind === 'absent') delete plan.annualHouseholdExpenseEvidence
    if (kind === 'malformed') Reflect.set(plan.annualHouseholdExpenseEvidence!, 'noncapital', false)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result).toMatchObject({
      rows: prefix.rows, state: prefix.state, uncomputedYears: [RETIRED + 1],
      blocked: { year: RETIRED, status: 'unsupported', issues: [
        { detail: expect.stringMatching(kind === 'malformed' ? /household expense/i : /positive household cash/i) },
      ] },
    })
    expect(result.state.householdExpenseReceipt).toBeUndefined()
  })
})

const compositionRefusal = 'household mortgage benefits require explicit dated composition authorization and existing verified claims'

describe('the opt-in retains evidence checks and blocks unsupported combinations atomically', () => {
  const denied: [string, (plan: InputsV2) => void][] = [
    ['non-user consent', plan => { Reflect.set(plan.annualHouseholdMortgageBenefitsEvidence!.provenance, 'origin', 'estimated') }],
    ['future consent', plan => { plan.annualHouseholdMortgageBenefitsEvidence!.provenance.sourceYear = BASE_YEAR + 1 }],
    ['undated consent', plan => { Reflect.deleteProperty(plan.annualHouseholdMortgageBenefitsEvidence!.provenance, 'sourceYear') }],
    ['fractional consent date', plan => { plan.annualHouseholdMortgageBenefitsEvidence!.provenance.sourceYear = BASE_YEAR - 0.5 }],
    ['inherited consent', plan => { Reflect.set(plan, 'annualHouseholdMortgageBenefitsEvidence', Object.create(authorization)) }],
    ['denied consent', plan => { Reflect.set(plan.annualHouseholdMortgageBenefitsEvidence!, 'authorized', false) }],
    ['changed purpose', plan => { Reflect.set(plan.annualHouseholdMortgageBenefitsEvidence!, 'purpose', 'household-held-mortgage') }],
    ['a planned sale', plan => { plan.properties[0].sellAtAge = 67 }],
    ['a separate purchase composition', plan => { Reflect.set(plan, 'annualPrimaryHomePurchaseEvidence', {}) }],
    ['a separate estate composition', plan => { Reflect.set(plan, 'annualTerminalEstateEvidence', {}) }],
    ['a positive RRSP', plan => { plan.accounts.push(retirementPlan({ rrsp: 1 }).accounts.find(account => account.id === RRSP)!) }],
    ['positive outside income', plan => {
      plan.incomeSources.push({ id: 'outside', kind: 'other', recipientId: RETIREE, annualAmount: known(1), provenance: recorded })
    }],
    ['missing household benefit exclusions', plan => { delete plan.annualBenefitsEvidence }],
  ]

  it.each(denied)('refuses %s before committing the first row', (_name, change) => {
    const { plan, evidence } = fixture()
    change(plan)
    const before = structuredClone({ plan, evidence })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(coverage).toMatchObject({
      rows: [], state: ok(initializeState(plan)), uncomputedYears: [MIXED, RETIRED],
      blocked: { year: BASE_YEAR, status: 'unsupported', causes: ['mortgageBenefits'], issues: [{ detail: compositionRefusal }] },
    })
    expect({ plan, evidence }).toEqual(before)
  })

  it('discloses typed stopped coverage and the uncomputed suffix in all three locales', () => {
    const { plan, evidence } = fixture()
    plan.annualHouseholdMortgageBenefitsEvidence!.provenance.sourceYear = BASE_YEAR + 1
    const sheet = canonicalAnnualSheet(ok(projectCanonicalCoverage(plan, evidence, 3)), context)
    const row = sheetRow(sheet.rows, 'retirement', 'spendingFunded')
    for (const [locale, reason, suffix] of [
      ['en', /dated explicit composition authorization.*verified CPP\/OAS claims/i, /after the first blocked year/i],
      ['fr', /autorisation explicite datée.*demandes RPC\/SV/i, /après la première année bloquée/i],
      ['zh', /注明日期的明确授权.*核实 CPP\/OAS 领取/, /首个受阻年度之后/],
    ] as const) {
      expect(row.cells![BASE_YEAR]).toMatchObject({ value: null, status: 'not-computed' })
      expect(annualSheetText(row.cells![BASE_YEAR].reason!, locale)).toMatch(reason)
      expect(annualSheetText(row.cells![MIXED].reason!, locale)).toMatch(suffix)
    }
  })

  const invalidClaims: [string, (plan: InputsV2) => void, RegExp][] = [
    ['mismatched CPP amount', plan => { plan.incomeSources.find(source => source.id === RETIREE + ':cpp')!.annualAmount = known(4_999) }, /CPP requires unique/i],
    ['duplicate OAS source', plan => {
      const source = plan.incomeSources.find(entry => entry.id === RETIREE + ':oas')!
      plan.incomeSources.push({ ...source, id: 'second-oas' })
    }, /OAS requires unique/i],
    ['GIS annual estimate', plan => { plan.annualBenefitsEvidence![PARTNER].gis.status = 'annual-estimate' }, /exclusion evidence/i],
    ['missing recipient exclusion', plan => { delete plan.annualBenefitsEvidence![PARTNER] }, /exclusion evidence/i],
    ['stale OAS statement premise', plan => { plan.people[1].oasAmountSource!.premises!.retirementAge = 66 }, /OAS requires unique/i],
    ['unconfirmed CPP statement with known zero', plan => {
      setClaims(plan, 0, 66, [0, 66], [2_000, 66])
      setClaims(plan, 1, 65, [0, 65], [300, 66])
      plan.people[0].cppAmountSource = {
        source: 'statement', sourceYear: BASE_YEAR, basis: 'annual', dollarBasis: 'today',
        ageBasis: 65, premises: { retirementAge: 67 },
      }
    }, /CPP statement retirement premise/i],
    ['pension split', plan => { plan.taxProfile!.pensionSplit = { transferorId: RETIREE, recipientId: PARTNER, amount: 1 } }, /working tax elections/i],
  ]

  it.each(invalidClaims)('preserves the underlying refusal for %s', (_label, change, detail) => {
    const { plan, evidence } = fixture()
    change(plan)
    expect(ok(projectCanonicalCoverage(plan, evidence, 3))).toMatchObject({
      rows: [], state: ok(initializeState(plan)), uncomputedYears: [MIXED, RETIRED],
      blocked: { year: BASE_YEAR, status: 'unsupported', issues: [{ detail: expect.stringMatching(detail) }] },
    })
  })

  it.each([
    ['CPP', 'cpp', /working CPP recipient/i],
    ['OAS', 'oas', /OAS recipient must be retired/i],
  ] as const)('stops the first working-year %s receipt, preserving the committed prefix', (_name, kind, detail) => {
    const { plan, evidence } = fixture()
    plan.people[0].retirementAge = 67
    if (kind === 'cpp') setClaims(plan, 0, 67, [5_000, 66], [2_000, 67])
    else setClaims(plan, 0, 67, [5_000, 67], [2_000, 66])
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    expect(ok(projectCanonicalCoverage(plan, evidence, 3))).toMatchObject({
      rows: prefix.rows, state: prefix.state, uncomputedYears: [RETIRED],
      blocked: { year: MIXED, status: 'unsupported', issues: [{ detail: expect.stringMatching(detail) }] },
    })
  })

  it('stops at household age 70 with an intact age-69 prefix', () => {
    const { plan, evidence } = fixture({ selfBalance: 70_000 })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows[4].byPerson[RETIREE].age).toBe(69)
    expect(ok(projectCanonicalCoverage(plan, evidence, 7))).toMatchObject({
      rows: prefix.rows, state: prefix.state, uncomputedYears: [2032],
      blocked: { year: 2031, status: 'unsupported', issues: [{ detail: expect.stringMatching(/ages 19 through 69/i) }] },
    })
  })

  it('requires consent for both funded accounts and a verified statement when the second debit is reached', () => {
    const { plan, evidence } = fixture({ selfBalance: 2_500, partnerBalance: 16_000 })
    const unapproved = structuredClone(plan)
    delete unapproved.annualHouseholdMortgageFundingEvidence
    expect(ok(projectCanonicalCoverage(unapproved, evidence, 3))).toMatchObject({
      rows: [], state: ok(initializeState(unapproved)),
      blocked: { year: BASE_YEAR, status: 'unsupported', issues: [{ detail: expect.stringMatching(/single funded TFSA/i) }] },
    })

    delete plan.tfsaStatement![PARTNER]
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(prefix.state.tfsaWithdrawalHistory).toStrictEqual([history(MIXED, TFSA, RETIREE, 2_448.16875)])
    expect(ok(projectCanonicalCoverage(plan, evidence, 4))).toMatchObject({
      rows: prefix.rows, state: prefix.state, uncomputedYears: [RETIRED + 1],
      blocked: { year: RETIRED, status: 'unsupported', causes: ['tfsaWithdrawalEvidence'] },
    })
  })
})

describe('legacy and external entry points retain their prior coverage', () => {
  function withoutOptIn(plan: InputsV2) {
    const ordinary = structuredClone(plan)
    delete ordinary.annualHouseholdMortgageBenefitsEvidence
    return ordinary
  }

  it('keeps positive benefits with a mortgage gated without opt-in and admits the ordinary mortgage and benefit-only paths', () => {
    const { plan, evidence } = fixture()
    const ordinary = withoutOptIn(plan)
    const blocked = ok(projectCanonicalCoverage(ordinary, evidence, 3))
    expect(blocked).toMatchObject({
      rows: [], state: ok(initializeState(ordinary)),
      blocked: { year: BASE_YEAR, status: 'unsupported', issues: [{ detail: expect.stringMatching(/explicit zero public benefits only/i) }] },
    })
    const noMortgage = structuredClone(ordinary)
    noMortgage.debts = []
    noMortgage.properties[0].mortgageDebtId = null
    noMortgage.budget = { kind: 'incomeBudget', workingSpending: 9_480, retirementSpending: 10_000 }
    const benefitOnly = ok(projectCanonicalCoverage(noMortgage, {
      workingSpending: known(9_480), transitionSpending: known(9_000), retirementSpending: known(10_000),
    }, 3))
    expect(benefitOnly.blocked).toBeNull()
    expect(benefitOnly.rows[1]).toMatchObject({ byPerson: { [RETIREE]: { cpp: 6_097.5, oasNet: 2_412 } },
      cashLedger: { income: 6_660, benefits: 2_412, debtPayments: 0, spending: 10_125 } })
    expect(benefitOnly.rows[1].householdWithdrawalSettlement).not.toHaveProperty('publicBenefitsCash')

    setClaims(ordinary, 0, 66, [0, 66], [0, 66])
    setClaims(ordinary, 1, 65, [0, 65], [0, 66])
    delete ordinary.annualBenefitsEvidence
    const mortgageOnly = ok(projectCanonicalCoverage(ordinary, evidence, 3))
    expect(mortgageOnly.blocked).toBeNull()
    expect(mortgageOnly.rows[1]).toMatchObject({ cashLedger: { benefits: 0, debtPayments: 9_261 },
      householdWithdrawalSettlement: { withdrawal: 10_957.66875 } })
    expect(mortgageOnly.rows[1].householdWithdrawalSettlement).not.toHaveProperty('publicBenefitsCash')
    const sheet = canonicalAnnualSheet(mortgageOnly, context)
    const funded = sheetRow(sheet.rows, 'retirement', 'spendingFunded').cells![MIXED]
    expect(sheet.resolveExplanation!(funded.explanationRefs![0])!.formula).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'debtPayments', value: 9_261, direction: 'subtract' }),
    ]))
  })

  it('keeps the external and provider entry points unchanged and rejects an exported generated snapshot', () => {
    const { plan, evidence } = fixture()
    const baseline = withoutOptIn(plan)
    expect(evaluateCanonicalHouseholdWorkingYear(plan, evidence, BASE_YEAR))
      .toStrictEqual(evaluateCanonicalHouseholdWorkingYear(baseline, evidence, BASE_YEAR))
    const generated = ok(projectCanonicalCoverage(plan, evidence, 2)).state
    const providers: AnnualProviders = {
      evaluate: () => ({ byPerson: Object.fromEntries(plan.people.map(person => [person.id, {
        income: person.role === 'self' ? 9_261 : 0, earnedIncome: 0, tax: 0, benefits: 0,
        spending: 0, taxableIncome: 0, benefitIncomeForNextYear: known(0),
      }])) }),
      returns: () => 0,
    }
    expect(annualRetirementContinuation(plan, generated, evidence)).toMatchObject({ status: 'invalid' })
    expect(annualStep(plan, generated, providers)).toMatchObject({ status: 'invalid' })

    plan.budget = { kind: 'savingsBudget', annualNetSavings: 0, retirementSpending: 0,
      debtIncluded: known(true), taxBenefitIncluded: known(true) }
    const providerBaseline = withoutOptIn(plan)
    const opening = ok(initializeState(plan))
    const before = structuredClone(opening)
    expect(annualRetirementStep(plan, opening)).toStrictEqual(annualRetirementStep(providerBaseline, opening))
    expect(annualStep(plan, opening, providers)).toStrictEqual(annualStep(providerBaseline, opening, providers))
    expect(projectFromState(plan, opening, 1, providers)).toStrictEqual(projectFromState(providerBaseline, opening, 1, providers))
    const external = ok(projectAnnualCoverage(plan, opening, 2, providers))
    expect(external).toStrictEqual(ok(projectAnnualCoverage(providerBaseline, opening, 2, providers)))
    expect(external.rows[0]).toMatchObject({ cashLedger: { benefits: 0, debtPayments: 9_261 } })
    expect(opening).toStrictEqual(before)
  })

  it('keeps ordinary solo held debt available and gives no mortgage-benefit authority to a solo plan', () => {
    const { plan, evidence } = fixture({ selfWage: 12_000, working: 2_037.65 })
    plan.people.pop()
    setClaims(plan, 0, 66, [0, 66], [0, 66])
    plan.incomeSources = []
    delete plan.annualBenefitsEvidence
    delete plan.tfsaStatement![PARTNER]
    delete plan.legacyProjection.partner
    plan.properties[0].taxableOwnerShares = { status: 'known', shares: { [RETIREE]: 1 } }
    const ordinarySolo = withoutOptIn(plan)
    const solo = ok(projectCanonicalCoverage(ordinarySolo, evidence, 2))
    expect(solo.blocked).toBeNull()
    expect(solo.rows[1]).toMatchObject({ cashLedger: { debtPayments: 9_261, benefits: 0 } })
    expect(ok(projectCanonicalCoverage(plan, evidence, 2))).toMatchObject({
      rows: [], state: ok(initializeState(plan)),
      blocked: { year: BASE_YEAR, status: 'unsupported', causes: ['mortgageBenefits'] },
    })
  })

  it('preserves full legacy projections and production S1 annual sheet rows', () => {
    const { plan } = fixture()
    const ordinary = withoutOptIn(plan)
    const inputs = plan.legacyProjection
    for (const sample of [undefined, () => -0.04]) {
      const baseline = runProjection(inputs, sample, ordinary, { captureAnnualDetails: true })
      const actual = runProjection(inputs, sample, plan, { captureAnnualDetails: true })
      expect(actual).toStrictEqual(baseline)
      expect(baseline.rows.length).toBeGreaterThan(2)
      const actualSheet = legacyAnnualSheet(actual, inputs, context)
      const baselineSheet = legacyAnnualSheet(baseline, inputs, context)
      expect(actualSheet.rows).toStrictEqual(baselineSheet.rows)
      expect(actualSheet.years).toStrictEqual(baselineSheet.years)
    }
  })
})
