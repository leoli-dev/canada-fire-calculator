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
import { BASE_YEAR, known, legacyRetirement, recorded, retirementPlan, RETIREE, TFSA } from './fixtures/retirementSettlement'

const SELF = 'legacy:person:self'
const PARTNER = 'legacy:person:partner'
const HOME = 'debt-free-household-home'
const SALE_YEAR = 2028
const CONTEXT = { scenarioId: 'household-sale-independent', revision: 1 }
const close = (value: number) => expect.closeTo(value, 8)
const atom = (coefficient: string, scale = 0) => ({ coefficient, scale })
type SaleEvidence = NonNullable<InputsV2['annualPrimaryHomeSaleEvidence']>[string]

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function fixture(inflation = 0.125) {
  const plan = retirementPlan({ tfsa: 10_000, rrsp: 0, spending: 0, inflation, strategy: 'tfsaFirst' })
  const self = plan.people[0]
  self.id = SELF
  self.retirementAge = 58
  const partner = { ...structuredClone(self), id: PARTNER, role: 'partner' as const, ageInBaseYear: 59, retirementAge: 61 }
  // Both the array order and the title owner disagree with the sale clock.
  plan.people = [partner, self]
  plan.accounts = plan.accounts.filter(account => account.id === TFSA)
  plan.accounts[0].ownerId = SELF
  plan.accounts[0].taxableOwnerShares = { status: 'known', shares: { [SELF]: 1 } }
  plan.tfsaStatement![SELF] = plan.tfsaStatement![RETIREE]
  delete plan.tfsaStatement![RETIREE]
  plan.tfsaStatement![PARTNER] = { withdrawals: [], provenance: recorded }
  plan.taxProfile = { spouseSupported: known(false), pensionSplit: null }
  plan.budget = { kind: 'incomeBudget', workingSpending: 0, retirementSpending: 0 }
  plan.lifeExpectancy = 95
  const home: Property = {
    id: HOME, kind: 'principal', value: 81_920, acb: known(74_000.01), annualRent: known(0),
    appreciation: 0.125, sellAtAge: 59, plannedPurchaseAge: null, plannedDownPayment: null,
    plannedMortgage: null, annualHoldingCostChange: 0, mortgageDebtId: null,
    taxableOwnerShares: { status: 'known', shares: { [PARTNER]: 1, [SELF]: 0 } },
    provenance: { value: recorded, acb: { ...recorded, sourceYear: 2015 }, annualRent: recorded, taxableOwnerShares: recorded },
  }
  plan.properties.push(home)
  const sale: SaleEvidence = {
    provenance: recorded, wholePropertyFullyExcluded: true, salePriceBasis: 'opening-year-nominal-value',
    effectiveYear: SALE_YEAR, timing: 'start-of-sale-year',
    ownerExclusions: { [PARTNER]: { fullyExcluded: true, provenance: { ...recorded, sourceYear: 2025 } } },
    allSaleCashAvailableForJointSpending: true,
    sellingCostsNominal: known(1_220.03), postSaleAnnualSpendingReal: known(45_000),
  }
  plan.annualPrimaryHomeSaleEvidence = { [HOME]: sale }
  plan.legacyProjection = legacyRetirement({ currentAge: 57, fireAge: 58, lifeExpectancy: 95, inflation,
    strategy: 'tfsaFirst', retirementSpending: 0, balances: { tfsa: 10_000, rrsp: 0, nonReg: 0 },
    principalResidence: { value: home.value, appreciation: home.appreciation, sellAtAge: home.sellAtAge },
    partner: { currentAge: 59, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 } })
  const evidence = { workingSpending: known(0), transitionSpending: known(0), retirementSpending: known(0) }
  return { plan, home, sale, evidence }
}

function heldControl(plan: InputsV2) {
  const held = structuredClone(plan)
  held.properties[0].sellAtAge = null
  delete held.annualPrimaryHomeSaleEvidence
  return held
}

function flatten(rows: AnnualSheetRow[]): AnnualSheetRow[] {
  return rows.flatMap(row => [row, ...flatten(row.children ?? [])])
}

describe('FE-53 independently calculated household debt-free home sale', () => {
  it.each(['partner sole', 'unequal split'] as const)('sells once on the self clock with %s title', title => {
    const { plan, home, sale, evidence } = fixture()
    if (title === 'unequal split') {
      home.taxableOwnerShares = { status: 'known', shares: { [PARTNER]: 0.75, [SELF]: 0.25 } }
      sale.ownerExclusions![SELF] = { fullyExcluded: true, provenance: recorded }
    }
    const before = structuredClone({ plan, evidence })
    const held = ok(projectCanonicalCoverage(heldControl(plan), evidence, 6))
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(coverage).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false,
      evaluationBasis: 'canonical-continuous' })
    expect(coverage.rows.map(row => row.year)).toEqual([2026, 2027, 2028, 2029, 2030, 2031])
    expect(coverage.rows.map(row => row.workingSettlement && 'household' in row.workingSettlement
      ? row.workingSettlement.household.phase : undefined))
      .toEqual(['both-working', 'mixed', 'both-retired', 'both-retired', 'both-retired', 'both-retired'])
    expect(coverage.rows.slice(0, 2)).toEqual(held.rows.slice(0, 2))
    expect(coverage.rows[0].byPerson[PARTNER].age).toBe(59)
    expect(coverage.rows[2].byPerson[SELF].age).toBe(59)

    // Two prior years of 81/64 nominal growth give 131,220 at opening.
    // Fixed nominal fees are 1,220.03 and the independent ACB is 74,000.01.
    const receipt = { propertyId: HOME, year: SALE_YEAR, grossProceeds: 131_220, sellingCosts: 1_220.03,
      netProceeds: 129_999.97, acb: 74_000.01, realizedGain: 55_999.96, taxableGain: 0 }
    const exactReceipt = { grossProceeds: atom('131220'), sellingCosts: atom('122003', 2),
      netProceeds: atom('12999997', 2), acb: atom('7400001', 2), realizedGain: atom('5599996', 2) }
    expect(coverage.rows[2].retirementSettlement?.primaryHomeSale).toEqual(receipt)
    expect(coverage.rows[2].retirementSettlement?.primaryHomeSaleAcbSource).toEqual({
      propertyId: HOME, acb: known(74_000.01), provenance: home.provenance.acb,
    })
    expect(coverage.rows[2].byProperty[HOME]).toEqual({ held: false, opening: 131_220, closing: 0, growth: 0 })
    expect(coverage.rows[1].byProperty[HOME].closing).toBe(131_220)
    expect(held.rows[2].byProperty[HOME].growth).toBeGreaterThan(0)

    // Living is 45,000 × (9/8)^elapsed. The TFSA earns no real return
    // and remains whole until the third spending year of the cash pool.
    const schedule = [
      { opening: 0, added: 129_999.97, used: 56_953.125, closing: 73_046.845, due: 56_953.125, draw: 0, tfsa: 14_238.28125 },
      { opening: 73_046.845, added: 0, used: 64_072.265625, closing: 8_974.579375, due: 64_072.265625, draw: 0, tfsa: 16_018.06640625 },
      { opening: 8_974.579375, added: 0, used: 8_974.579375, closing: 0, due: 72_081.298828125, draw: 16_018.06640625, tfsa: 0 },
      { opening: 0, added: 0, used: 0, closing: 0, due: 81_091.461181640625, draw: 0, tfsa: 0 },
    ]
    for (const [offset, expected] of schedule.entries()) {
      const row = coverage.rows[offset + 2]
      const { opening, added, used, closing, due, draw, tfsa } = expected
      const funded = used + draw
      if (offset) {
        expect(row.retirementSettlement?.primaryHomeSale).toBeUndefined()
        expect(row.byProperty[HOME]).toEqual({ held: false, opening: 0, closing: 0, growth: 0 })
      }
      expect(row.retirementSettlement?.primaryHomeSaleCash).toEqual({ opening, proceedsAdded: added, spendingUsed: used, closing })
      expect(row.retirementSettlement?.primaryHomeSaleArithmetic?.receipt).toEqual(exactReceipt)
      expect(row.retirementSettlement?.primaryHomeSaleEvidence).toEqual(sale)
      expect(row.householdWithdrawalSettlement).toMatchObject({ spendingDue: due, spendingFunded: close(funded),
        spendingUnmet: close(due - funded), withdrawal: draw })
      expect(row.byAccount[TFSA]).toMatchObject({ ownerId: SELF, withdrawal: draw, contribution: 0, closing: tfsa })
      expect(row.taxLedger).toEqual(held.rows[offset + 2].taxLedger)
      expect(row.byPerson[SELF]).toMatchObject({ income: 0, tax: 0, spending: 0 })
      expect(row.byPerson[PARTNER]).toMatchObject({ income: 0, tax: 0, spending: 0 })
      expect(row.cashLedger).toMatchObject({ spending: close(funded), income: 0, tax: 0, benefits: 0,
        debtPayments: 0, voluntaryContributions: 0, unallocated: 0 })
      expect(row.cashLedger.spending - row.byAccount[TFSA].withdrawal).toBeCloseTo(used, 8)

      const prefix = ok(projectCanonicalCoverage(plan, evidence, offset + 3))
      expect(prefix.rows).toEqual(coverage.rows.slice(0, offset + 3))
      expect(prefix.state.byProperty[HOME]).toMatchObject({ held: false, value: 0 })
      expect(prefix.state.primaryHomeSaleCash).toMatchObject({ balance: closing, receipt, exactReceipt, evidence: sale })
      expect(sumInvestableAssets(prefix.state)).toBe(tfsa)
      expect(sumNetWorth(prefix.state)).toBe(closing + tfsa)
    }
    expect(coverage.state.tfsaWithdrawalHistory).toEqual([
      { id: `annual:2030:withdrawal:${TFSA}`, calendarYear: 2030, personId: SELF, amount: 16_018.06640625 },
    ])
    expect(coverage.rows[5].tfsaLedger[SELF].restored).toEqual(known(16_018.07))
    expect(coverage.rows[5].tfsaLedger[PARTNER].restored).toEqual(known(0))
    expect({ plan, evidence }).toEqual(before)
  })

  it('keeps exact nominal cash and indexed living for a thirty-year projection with 2% CPI', () => {
    const { plan, home, sale, evidence } = fixture(0.02)
    home.value = 500_000
    home.appreciation = 0
    sale.sellingCostsNominal = known(200.13)
    sale.postSaleAnnualSpendingReal = known(7_000.01)
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 30))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows[2].retirementSettlement?.primaryHomeSale).toMatchObject({
      grossProceeds: 520_200, netProceeds: 519_999.87, realizedGain: 445_999.86,
    })

    // Work in integer units of 1/100^30 CAD. Compute cumulative spending
    // using the closed-form sum for the geometric series from powers 2 to 29.
    const indexedSum = 102n ** 2n * (102n ** 28n - 100n ** 28n) / 2n
    const closing = 51_999_987n * 100n ** 29n - 700_001n * indexedSum
    const lastDue = 700_001n * 102n ** 29n
    const arithmetic = coverage.rows[29].retirementSettlement?.primaryHomeSaleArithmetic
    expect(arithmetic?.spendingDue).toEqual(atom(lastDue.toString(), 60))
    expect(arithmetic?.cash.closing).toEqual(atom(closing.toString(), 60))
    expect(coverage.state.primaryHomeSaleCash?.exactBalance).toEqual(atom(closing.toString(), 60))
    expect(coverage.rows.slice(2).every(row => row.byAccount[TFSA].withdrawal === 0)).toBe(true)
    expect(coverage.rows.slice(2).every(row => row.householdWithdrawalSettlement?.spendingUnmet === 0)).toBe(true)
    expect(coverage.state.tfsaWithdrawalHistory).toEqual([])
    expect(sumNetWorth(coverage.state) - sumInvestableAssets(coverage.state))
      .toBeCloseTo(Number(`${closing}e-60`), 8)
  })

  it.each(['constructor', 'toString'])('preserves exhausted TFSA postings for the opaque ID %s', accountId => {
    const { plan, evidence } = fixture()
    const ordinary = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(ordinary.blocked).toBeNull()
    plan.accounts[0].id = accountId
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows.map(row => row.byAccount[accountId])).toEqual(ordinary.rows.map(row => row.byAccount[TFSA]))
    expect(coverage.rows.map(row => row.cashLedger)).toEqual(ordinary.rows.map(row => row.cashLedger))
    expect(coverage.rows[4].byAccount[accountId]).toMatchObject({ withdrawal: 16_018.06640625, closing: 0 })
    expect(coverage.rows[4].retirementSettlement?.primaryHomeSaleArithmetic?.withdrawals[accountId])
      .toEqual(ordinary.rows[4].retirementSettlement?.primaryHomeSaleArithmetic?.withdrawals[TFSA])
    expect(Object.keys(coverage.rows[5].retirementSettlement!.primaryHomeSaleArithmetic!.withdrawals)).toEqual([])
    expect(coverage.rows[5].byAccount[accountId].withdrawal).toBe(0)
    expect(coverage.state.primaryHomeSaleCash?.exactAccountBalances[accountId]).toEqual(atom('0'))
    expect(coverage.state.tfsaWithdrawalHistory).toEqual([
      { id: `annual:2030:withdrawal:${accountId}`, calendarYear: 2030, personId: SELF, amount: 16_018.06640625 },
    ])
  })

  it.each(['constructor', 'toString'])('ignores the empty partner TFSA with opaque ID %s', accountId => {
    const { plan, evidence } = fixture()
    const empty = { ...structuredClone(plan.accounts[0]), id: 'empty-partner-tfsa', ownerId: PARTNER, balance: 0,
      taxableOwnerShares: { status: 'known' as const, shares: { [PARTNER]: 1 } } }
    plan.accounts.push(empty)
    const ordinary = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(ordinary.blocked).toBeNull()
    empty.id = accountId
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(coverage.blocked).toBeNull()
    for (const [index, row] of coverage.rows.entries()) {
      expect(row.byAccount[accountId]).toEqual(ordinary.rows[index].byAccount['empty-partner-tfsa'])
      expect(row.byAccount[accountId]).toMatchObject({ ownerId: PARTNER, opening: 0, withdrawal: 0, closing: 0 })
      expect(row.byAccount[TFSA]).toEqual(ordinary.rows[index].byAccount[TFSA])
      expect(row.retirementSettlement?.primaryHomeSaleArithmetic).toEqual(ordinary.rows[index].retirementSettlement?.primaryHomeSaleArithmetic)
      expect(Object.keys(row.retirementSettlement?.primaryHomeSaleArithmetic?.withdrawals ?? {})).not.toContain(accountId)
    }
    expect(coverage.state.primaryHomeSaleCash?.exactAccountBalances[accountId]).toEqual(atom('0'))
    expect(coverage.state.tfsaWithdrawalHistory).toEqual(ordinary.state.tfsaWithdrawalHistory)
    expect(coverage.state.tfsaWithdrawalHistory).toHaveLength(1)
  })

  it.each(['funded', 'exhausted before sale', 'empty second'] as const)(
    'settles the authenticated sale with a literal __proto__ TFSA that is %s', status => {
      const { plan, evidence } = fixture()
      let target = plan.accounts[0]
      if (status === 'exhausted before sale') {
        target.balance = 1
        evidence.transitionSpending = known(1)
      } else if (status === 'empty second') {
        target = { ...structuredClone(target), id: 'empty-partner-tfsa', ownerId: PARTNER, balance: 0,
          taxableOwnerShares: { status: 'known', shares: { [PARTNER]: 1 } } }
        plan.accounts.push(target)
      }
      const ordinary = ok(projectCanonicalCoverage(plan, evidence, 6))
      expect(ordinary.blocked).toBeNull()
      const ordinaryId = target.id
      target.id = '__proto__'
      const coverage = ok(projectCanonicalCoverage(plan, evidence, 6))
      expect(coverage.blocked).toBeNull()
      const [,, sold] = coverage.rows
      expect(sold.retirementSettlement?.primaryHomeSale).toMatchObject({ propertyId: HOME, year: SALE_YEAR, netProceeds: 129_999.97 })
      const expectedDraws = {
        funded: [0, 0, 0, 0, 16_018.06640625, 0],
        'exhausted before sale': [0, 1.125, 0, 0, 0, 0],
        'empty second': [0, 0, 0, 0, 0, 0],
      }
      expect(coverage.rows.map(row => row.byAccount['__proto__'].withdrawal)).toEqual(expectedDraws[status])
      for (const [index, row] of coverage.rows.entries()) {
        expect(Object.keys(row.byAccount)).toContain('__proto__')
        const exactDraws = row.retirementSettlement?.primaryHomeSaleArithmetic?.withdrawals ?? {}
        if (status !== 'funded' || index === 5) expect(Object.keys(exactDraws)).not.toContain('__proto__')
        else if (index === 4) expect(Object.getOwnPropertyDescriptor(exactDraws, '__proto__')?.value)
          .toEqual(atom('1601806640625', 8))
      }
      expect(Object.getOwnPropertyDescriptor(coverage.state.primaryHomeSaleCash!.exactAccountBalances, '__proto__')?.value)
        .toEqual(atom('0'))
      // The account ID is also embedded in withdrawal event IDs.
      expect(JSON.stringify(coverage).replaceAll('__proto__', ordinaryId)).toBe(JSON.stringify(ordinary))
    },
  )

  it('preserves the committed prefix when the indexed sale budget exceeds decimal precision', () => {
    const { plan, evidence } = fixture(1e-300)
    // The exact CPI power has scale 300 per year, so exponent 27 fits
    // within 8,192 places and exponent 28 reaches scale 8,400.
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 28))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows).toHaveLength(28)
    expect(prefix.rows.at(-1)?.year).toBe(2053)
    // The 45,000 CAD budget removes three trailing decimal places.
    expect(prefix.rows.at(-1)?.retirementSettlement?.primaryHomeSaleArithmetic?.spendingDue.scale).toBe(8097)
    expect(prefix.state.primaryHomeSaleCash?.receipt.year).toBe(SALE_YEAR)
    expect(prefix.state.byProperty[HOME].held).toBe(false)

    const coverage = ok(projectCanonicalCoverage(plan, evidence, 36))
    expect(coverage.blocked).toMatchObject({ year: 2054, status: 'unsupported', causes: ['propertySale'],
      issues: [{ code: 'unsupported', detail: expect.stringMatching(/decimal precision boundary/i) }] })
    expect(coverage.uncomputedYears).toEqual([2055, 2056, 2057, 2058, 2059, 2060, 2061])
    expect(coverage.rows).toStrictEqual(prefix.rows)
    expect(coverage.state).toStrictEqual(prefix.state)

    const sheet = canonicalAnnualSheet(coverage, CONTEXT)
    const due = flatten(sheet.rows).find(row => row.id === canonicalSheetId('value', 'retirement', 'spendingDue'))!.cells!
    expect(due[2053].value).toBe(45_000)
    const boundary = sheet.resolveExplanation!(due[2054].explanationRefs![0])!
    expect(boundary.sources?.[0].code).toBe('propertySale')
    for (const [locale, precision, preserved] of [
      ['en', /exact decimal precision limit/i, /any completed sale are preserved/i],
      ['fr', /limite de précision décimale exacte/i, /vente déjà comptabilisées sont conservées/i],
      ['zh', /精确十进制精度上限/, /已完成的出售均予保留/],
    ] as const) {
      const message = annualSheetText(boundary.summary!, locale)
      expect(message).toMatch(precision)
      expect(message).toMatch(preserved)
    }
    for (let year = 2054; year <= 2061; year++) {
      expect(due[year]).toMatchObject({ value: null, status: 'not-computed' })
      if (year > 2054) expect(sheet.resolveExplanation!(due[year].explanationRefs![0])!.sources?.[0].code).toBe('suffix')
    }
  })

  it.each([
    { living: 99.999999999, cash: 0.000000001, draw: 0, unmet: 0 },
    { living: 100, cash: 0, draw: 0, unmet: 0 },
    { living: 100.000000001, cash: 0, draw: 0.000000001, unmet: 0 },
    { living: 100.109999999, cash: 0, draw: 0.109999999, unmet: 0 },
    { living: 100.11, cash: 0, draw: 0.11, unmet: 0 },
    { living: 100.110000001, cash: 0, draw: 0.11, unmet: 0.000000001 },
  ])('settles the exact cash and TFSA neighbors at $living CAD', ({ living, cash, draw, unmet }) => {
    const { plan, home, sale, evidence } = fixture(0)
    home.value = 100.11
    home.acb = known(100)
    home.appreciation = 0
    plan.accounts[0].balance = 0.11
    sale.sellingCostsNominal = known(0.11)
    sale.postSaleAnnualSpendingReal = known(living)
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(coverage.blocked).toBeNull()
    const row = coverage.rows[2]
    expect(row.retirementSettlement?.primaryHomeSale).toMatchObject({ netProceeds: 100, realizedGain: 0 })
    expect(row.retirementSettlement?.primaryHomeSaleCash?.closing).toBe(cash)
    expect(row.householdWithdrawalSettlement).toMatchObject({ spendingDue: living, spendingUnmet: unmet, withdrawal: draw })
    expect(row.byAccount[TFSA].withdrawal).toBe(draw)
    const tiny = atom('1', 9)
    const zero = atom('0')
    expect(row.retirementSettlement?.primaryHomeSaleArithmetic?.spendingUnmet).toEqual(unmet ? tiny : zero)
    expect(coverage.state.primaryHomeSaleCash?.exactBalance).toEqual(cash ? tiny : zero)
  })

  it('exposes the signed household cash uses and source statements in English, French, and Chinese', () => {
    const { plan, home, sale, evidence } = fixture()
    home.taxableOwnerShares = { status: 'known', shares: { [PARTNER]: 0.75, [SELF]: 0.25 } }
    sale.ownerExclusions![SELF] = { fullyExcluded: true, provenance: { ...recorded, sourceYear: 2024 } }
    plan.budget = { kind: 'incomeBudget', workingSpending: 0, retirementSpending: 1_200 }
    evidence.retirementSpending = known(1_200)
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(coverage.blocked).toBeNull()
    const sheet = canonicalAnnualSheet(coverage, CONTEXT)
    const rows = flatten(sheet.rows)
    const cell = (year: number, ...path: string[]) => {
      const result = rows.find(row => row.id === canonicalSheetId('value', ...path))?.cells?.[year]
      if (!result) throw new Error(`Missing ${year} cell ${path.join('/')}`)
      return result
    }
    const saleYear = sheet.years[2]
    const gross = cell(SALE_YEAR, 'primaryHomeSale', 'grossProceeds')
    const acb = cell(SALE_YEAR, 'primaryHomeSale', 'acb')
    const cash = cell(SALE_YEAR, 'primaryHomeSaleCash', 'closing')
    expect(gross.value).toBe(131_220)
    expect(annualSheetDisplayValue(gross, saleYear, 'real')).toBeCloseTo(131_220 / 1.125 ** 2, 8)
    expect(annualSheetDisplayValue(acb, saleYear, 'real')).toBe(74_000.01)
    expect(annualSheetDisplayValue(cash, saleYear, 'real')).toBeCloseTo(73_046.845 / 1.125 ** 3, 8)
    expect(cell(SALE_YEAR, 'assets').value).toBe(14_238.28125)
    expect(cell(SALE_YEAR, 'netWorth').value).toBe(73_046.845 + 14_238.28125)
    expect(gross.value).toBe(cell(SALE_YEAR - 1, 'property', HOME, 'closing').value)
    expect(cell(SALE_YEAR + 1, 'primaryHomeSale', 'grossProceeds').value).toBeNull()
    expect(cell(SALE_YEAR + 1, 'primaryHomeSaleCash', 'proceedsAdded').value).toBe(0)
    for (const person of [SELF, PARTNER]) expect(cell(SALE_YEAR, 'person', person, 'spending').value).toBeNull()

    const explanation = sheet.resolveExplanation!(cash.explanationRefs![0])!
    expect(explanation.formula).toMatchObject([
      { field: 'opening', value: 0, direction: 'add' },
      { field: 'proceedsAdded', value: 129_999.97, direction: 'add' },
      { field: 'spendingUsed', value: 56_953.125, direction: 'subtract' },
    ])
    const acbExplanation = sheet.resolveExplanation!(acb.explanationRefs![0])!
    expect(acbExplanation.sources).toContainEqual(expect.objectContaining({ field: 'property.acb', id: HOME }))
    const [funded, fundedLater] = [SALE_YEAR, 2030].map(year => {
      const spending = cell(year, 'retirement', 'spendingFunded')
      return sheet.resolveExplanation!(spending.explanationRefs![0])!
    })
    const livingFields = ['retirementSpending', 'budget.retirementSpending', 'annualPrimaryHomeSaleEvidence.postSaleAnnualSpendingReal']
    for (const detail of [funded, fundedLater]) {
      expect(detail.sources?.filter(source => livingFields.includes(source.field ?? '') && source.granularity === 'input')
        .map(source => source.field)).toEqual(['annualPrimaryHomeSaleEvidence.postSaleAnnualSpendingReal'])
      expect(detail.sources).toContainEqual(expect.objectContaining({
        field: 'annualPrimaryHomeSaleEvidence.allSaleCashAvailableForJointSpending', granularity: 'input',
      }))
    }
    expect(fundedLater.formula?.filter(term => term.field === 'retirementSettlement.primaryHomeSaleCash.spendingUsed'))
      .toMatchObject([{ value: 8_974.579375, direction: 'add' }])
    expect(fundedLater.formula?.filter(term => term.field === 'withdrawal'))
      .toMatchObject([{ value: 16_018.06640625, direction: 'add', sourceId: `annual:2030:withdrawal:${TFSA}` }])
    const ownerSources = explanation.sources?.filter(source => source.field?.startsWith('annualPrimaryHomeSaleEvidence.ownerExclusions'))
    expect(ownerSources).toHaveLength(2)
    const cashSource = explanation.sources?.find(source =>
      source.field === 'annualPrimaryHomeSaleEvidence.allSaleCashAvailableForJointSpending')
    expect(cashSource).toBeDefined()
    for (const { locale, reporting, order, netWorth, owners, joint, confirmed } of [
      { locale: 'en', reporting: /T2091.*IND/i, order: /before.*TFSA/i, netWorth: /once.*net worth/i,
        owners: /exclu/i, joint: /joint household living/i, confirmed: /confirmed by user/i },
      { locale: 'fr', reporting: /T2091.*IND/i, order: /avant.*CELI/i, netWorth: /une fois.*valeur nette/i,
        owners: /exclu/i, joint: /dépenses communes/i, confirmed: /confirmée par l’utilisateur/i },
      { locale: 'zh', reporting: /T2091.*IND/i, order: /先.*TFSA/, netWorth: /净资产.*一次/,
        owners: /豁免|排除/, joint: /家庭共同生活/, confirmed: /用户已确认/ },
    ] as const) {
      const summary = annualSheetText(explanation.summary!, locale)
      expect(summary).toMatch(reporting)
      expect(summary).toMatch(order)
      expect(summary).toMatch(netWorth)
      for (const [personId, sourceYear] of [[SELF, 2024], [PARTNER, 2025]] as const) {
        const owner = ownerSources?.find(source => source.id === personId)
        expect(owner).toMatchObject({ field: `annualPrimaryHomeSaleEvidence.ownerExclusions.${personId}`, granularity: 'input' })
        const label = annualSheetText(owner!.label, locale)
        const displayed = annualSheetText(owner!.displayReference!, locale)
        const person = rows.find(row => row.id === canonicalSheetId('group', 'person', personId))!
        expect(label).toMatch(owners)
        expect(displayed.startsWith(annualSheetText(person.label, locale))).toBe(true)
        expect(displayed).toMatch(confirmed)
        expect(displayed.match(/\b20\d{2}\b/g)).toEqual([String(sourceYear)])
        expect(`${label} ${displayed}`).not.toMatch(/legacy:person:|fullyExcluded|\btrue\b/i)
      }
      expect(annualSheetText(cashSource!.label, locale)).toMatch(joint)
      const authorization = annualSheetText(cashSource!.displayReference!, locale)
      expect(authorization).toContain(String(BASE_YEAR))
      expect(authorization).toContain(String(SALE_YEAR))
    }
  })
})

describe('FE-53 household home sale admission and entry-point parity', () => {
  type Fixture = ReturnType<typeof fixture>
  const refusals: [string, (input: Fixture) => void][] = [
    ['no opt-in', ({ plan }) => { delete plan.annualPrimaryHomeSaleEvidence }],
    ['only the solo exemption', ({ sale }) => {
      delete sale.allSaleCashAvailableForJointSpending
      delete sale.ownerExclusions
      delete sale.effectiveYear
      delete sale.timing
    }],
    ['evidence keyed to a different property', ({ plan, sale }) => { plan.annualPrimaryHomeSaleEvidence = { other: sale } }],
    ['undated event proof', ({ sale }) => { delete sale.effectiveYear }],
    ['an effective year one year late', ({ sale }) => { sale.effectiveYear = 2029 }],
    ['missing opening timing', ({ sale }) => { delete sale.timing }],
    ['missing joint availability', ({ sale }) => { delete sale.allSaleCashAvailableForJointSpending }],
    ['inherited joint availability', ({ sale }) => {
      delete sale.allSaleCashAvailableForJointSpending
      Object.setPrototypeOf(sale, { allSaleCashAvailableForJointSpending: true })
    }],
    ['an owner proof naming the wrong resident', ({ sale }) => { sale.ownerExclusions = { [SELF]: sale.ownerExclusions![PARTNER] } }],
    ['a surplus proof for a zero-title person', ({ sale }) => { sale.ownerExclusions![SELF] = sale.ownerExclusions![PARTNER] }],
    ['one positive title lacks designation', ({ home }) => {
      home.taxableOwnerShares = { status: 'known', shares: { [SELF]: 0.125, [PARTNER]: 0.875 } }
    }],
    ['an estimated owner designation', ({ sale }) => {
      sale.ownerExclusions![PARTNER].provenance = { ...recorded, origin: 'estimated' }
    }],
    ['a future-dated owner designation', ({ sale }) => {
      sale.ownerExclusions![PARTNER].provenance = { ...recorded, sourceYear: BASE_YEAR + 1 }
    }],
    ['an explicit owner denial', ({ sale }) => { Reflect.set(sale.ownerExclusions![PARTNER], 'fullyExcluded', false) }],
    ['unknown fees', ({ sale }) => { sale.sellingCostsNominal = { status: 'unknown', reason: 'Missing invoice' } }],
    ['unknown ACB', ({ home }) => { home.acb = { status: 'unknown', reason: 'Missing acquisition statement' } }],
    ['unknown post-sale living', ({ sale }) => { sale.postSaleAnnualSpendingReal = { status: 'unknown', reason: 'Missing budget' } }],
    ['an exact capital loss of one billionth CAD', ({ home, sale }) => {
      home.acb = known(129_999.970000001)
      sale.postSaleAnnualSpendingReal = known(0)
    }],
  ]
  it.each(refusals)('protects the complete opening state when there is %s', (_, mutate) => {
    const input = fixture()
    mutate(input)
    const { plan, evidence } = input
    const before = structuredClone({ plan, evidence })
    const held = ok(projectCanonicalCoverage(heldControl(plan), evidence, 2))
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(coverage).toMatchObject({ rows: held.rows, state: held.state, blocked: {
      year: SALE_YEAR, status: 'unsupported', causes: ['propertySale'],
    }, uncomputedYears: [2029, 2030], overallConclusionAvailable: false })
    expect(coverage.state.primaryHomeSaleCash).toBeUndefined()
    expect(coverage.state.byProperty[HOME]).toMatchObject({ held: true, value: 131_220 })
    expect(structuredClone({ plan, evidence })).toEqual(before)
  })

  it('preserves held-home parity when an unreached sale has no opt-in and stops a mixed-year sale', () => {
    const { plan, home, sale, evidence } = fixture()
    const held = ok(projectCanonicalCoverage(heldControl(plan), evidence, 5))
    delete plan.annualPrimaryHomeSaleEvidence
    expect(ok(projectCanonicalCoverage(plan, evidence, 2)).rows).toEqual(held.rows.slice(0, 2))
    home.sellAtAge = 58
    sale.effectiveYear = 2027
    plan.annualPrimaryHomeSaleEvidence = { [HOME]: sale }
    expect(ok(projectCanonicalCoverage(plan, evidence, 5))).toMatchObject({
      rows: held.rows.slice(0, 1), blocked: { year: 2027, status: 'unsupported', causes: ['propertySale'] },
      uncomputedYears: [2028, 2029, 2030],
    })
  })

  it('localizes the prior-year held-home detail for a settled sale and a no-opt-in sale', () => {
    const { plan, evidence } = fixture()
    const sold = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(sold.blocked).toBeNull()
    expect(sold.rows[2].retirementSettlement?.primaryHomeSale).toMatchObject({ propertyId: HOME, year: SALE_YEAR })
    const laterStop = ok(projectCanonicalCoverage({ ...plan, lifeExpectancy: 61 }, evidence, 6))
    expect(laterStop.rows.slice(0, 3)).toEqual(sold.rows.slice(0, 3))
    expect(laterStop.blocked?.year).toBe(2030)
    const heldOnly = ok(projectCanonicalCoverage(heldControl(plan), evidence, 4))
    expect(heldOnly.blocked).toBeNull()
    delete plan.annualPrimaryHomeSaleEvidence
    const blocked = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(blocked.blocked).toMatchObject({ year: SALE_YEAR, causes: ['propertySale'] })

    const details = [sold, laterStop, blocked, heldOnly].map(coverage => {
      const sheet = canonicalAnnualSheet(coverage, CONTEXT)
      const propertyRow = flatten(sheet.rows).find(row => row.id === canonicalSheetId('value', 'property', HOME, 'closing'))!
      const cell = propertyRow.cells![SALE_YEAR - 1]
      expect(cell.value).toBe(131_220)
      return sheet.resolveExplanation!(cell.explanationRefs![0])!.summary!
    })
    for (const { locale, held, settled, stop } of [
      { locale: 'en', held: /included once in household net worth/i, settled: /sale[^.]*cash|cash[^.]*sale/i,
        stop: /a reached planned sale stops coverage without settlement/i },
      { locale: 'fr', held: /incluse une fois dans la valeur nette du ménage/i, settled: /vente[^.]*(?:produit|trésorerie)|(?:produit|trésorerie)[^.]*vente/i,
        stop: /une vente prévue atteinte arrête la couverture sans règlement/i },
      { locale: 'zh', held: /仅在家庭净资产中计入一次/, settled: /出售[^。]*现金|售房现金/,
        stop: /达到计划出售年龄时停止推演，不结算出售/ },
    ] as const) {
      const [settledDetail, settledBeforeLaterStop, blockedDetail, heldOnlyDetail] = details.map(detail => annualSheetText(detail, locale))
      for (const detail of [settledDetail, settledBeforeLaterStop]) {
        expect(detail).toMatch(held)
        expect(detail).toMatch(settled)
        expect(detail).not.toMatch(stop)
      }
      expect(blockedDetail).toMatch(held)
      expect(blockedDetail).toMatch(stop)
      expect(heldOnlyDetail).toBe(blockedDetail)
    }
  })

  it('commits cash-only years without a TFSA statement and refuses the first actual draw', () => {
    const { plan, evidence } = fixture()
    delete plan.tfsaStatement![SELF]
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows.slice(2).map(row => row.byAccount[TFSA].withdrawal)).toEqual([0, 0])
    expect(prefix.state.primaryHomeSaleCash).toMatchObject({
      balance: 8_974.579375, exactBalance: atom('8974579375', 6),
    })
    expect(prefix.state.tfsaWithdrawalHistory).toEqual([])
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 6))
    expect(coverage.blocked).toMatchObject({ year: 2030, status: 'unsupported' })
    expect(coverage.blocked?.issues.map(issue => issue.detail).join(' ')).toMatch(/TFSA.*statement|statement.*TFSA/i)
    expect(coverage.uncomputedYears).toEqual([2031])
    expect(coverage.rows).toStrictEqual(prefix.rows)
    expect(coverage.state).toStrictEqual(prefix.state)
  })

  it.each([
    { living: 80_000_000_000_000, allowedYears: 2, firstDue: 101_250_000_000_000, stopDue: 101_250_000_000_000 },
    { living: 65_000_000_000_000, allowedYears: 3, firstDue: 82_265_625_000_000, stopDue: 92_548_828_125_000 },
  ])('stops at the first unsafe indexed bill for $living base-real CAD', ({ living, allowedYears, firstDue, stopDue }) => {
    const { plan, sale, evidence } = fixture()
    const safeNominal = Number.MAX_SAFE_INTEGER / 100
    expect(living).toBeLessThan(safeNominal)
    expect(stopDue).toBeGreaterThan(safeNominal)
    sale.postSaleAnnualSpendingReal = known(living)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, allowedYears))
    expect(prefix.blocked).toBeNull()
    if (allowedYears === 2) {
      expect(prefix.state.primaryHomeSaleCash).toBeUndefined()
      expect(prefix.state.byProperty[HOME].held).toBe(true)
    } else {
      expect(firstDue).toBeLessThan(safeNominal)
      expect(prefix.rows[2].retirementSettlement?.primaryHomeSaleArithmetic?.spendingDue).toEqual(atom(String(firstDue)))
      expect(prefix.state.primaryHomeSaleCash?.exactBalance).toEqual(atom('0'))
    }
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(coverage.blocked).toMatchObject({ year: BASE_YEAR + allowedYears, status: 'invalid', causes: ['propertySale'] })
    expect(coverage.blocked?.issues.map(issue => issue.detail).join(' ')).toMatch(/unsafe.*(?:living|spending)|(?:living|spending).*unsafe/i)
    expect(coverage.uncomputedYears).toEqual(allowedYears === 2 ? [2029, 2030] : [2030])
    expect(coverage.rows).toStrictEqual(prefix.rows)
    expect(coverage.state).toStrictEqual(prefix.state)

    const sheet = canonicalAnnualSheet(coverage, CONTEXT)
    const stopYear = BASE_YEAR + allowedYears
    const dueCells = flatten(sheet.rows).find(row => row.id === canonicalSheetId('value', 'retirement', 'spendingDue'))!.cells!
    const dueCell = dueCells[stopYear]
    expect(dueCell).toMatchObject({ value: null, status: 'not-computed' })
    const column = sheet.years.find(year => year.year === stopYear)!
    for (const mode of ['real', 'nominal'] as const) expect(annualSheetDisplayValue(dueCell, column, mode)).toBeNull()
    const detail = sheet.resolveExplanation!(dueCell.explanationRefs![0])!
    expect(detail.sources?.[0].code).toBe('propertySale')
    expect(sheet.resolveExplanation!(dueCells[stopYear + 1].explanationRefs![0])!.sources?.[0].code).toBe('suffix')
    if (allowedYears === 3) {
      expect(dueCells[SALE_YEAR].value).toBe(firstDue)
      const gross = flatten(sheet.rows).find(row => row.id === canonicalSheetId('value', 'primaryHomeSale', 'grossProceeds'))!.cells!
      expect(gross[SALE_YEAR].value).toBe(131_220)
    }
    for (const { locale, indexed, limit, preserved, generic } of [
      { locale: 'en', indexed: /CPI-indexed household living/i, limit: /nominal CAD limit/i,
        preserved: /including any completed sale, are preserved/i, generic: /this sale requires/i },
      { locale: 'fr', indexed: /dépenses de vie du ménage indexé à l’IPC/i, limit: /limite nominale.*CAD/i,
        preserved: /y compris toute vente réalisée, sont conservées/i, generic: /cette vente exige/i },
      { locale: 'zh', indexed: /按CPI换算的家庭生活支出/, limit: /名义加元上限/,
        preserved: /任何已完成的出售均予保留/, generic: /此次出售需要/ },
    ] as const) {
      const message = annualSheetText(detail.summary!, locale)
      expect(annualSheetText(dueCell.reason!, locale)).toBe(message)
      expect(message).toMatch(indexed)
      expect(message).toMatch(limit)
      expect(message).toMatch(preserved)
      expect(message).not.toMatch(generic)
    }
  })

  it('refuses an exact nominal bill that Number rounding hides at the safe-money ceiling', () => {
    const inflation = 1e-17
    const { plan, sale, evidence } = fixture(inflation)
    const ceiling = Number.MAX_SAFE_INTEGER / 100
    sale.postSaleAnnualSpendingReal = known(ceiling)
    // The positive exact rate makes the bill exceed the ceiling, while
    // the Number representation of the factor loses the increase entirely.
    expect(ceiling * (1 + inflation) ** 2).toBe(ceiling)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(coverage.blocked).toMatchObject({ year: SALE_YEAR, status: 'invalid', causes: ['propertySale'] })
    expect(coverage.rows).toStrictEqual(prefix.rows)
    expect(coverage.state).toStrictEqual(prefix.state)
  })

  it('localizes why a household sale with incomplete proof stops the sale year and suffix', () => {
    const { plan, sale, evidence } = fixture()
    delete sale.ownerExclusions
    const sheet = canonicalAnnualSheet(ok(projectCanonicalCoverage(plan, evidence, 4)), CONTEXT)
    const cells = flatten(sheet.rows).find(row => row.id === canonicalSheetId('value', 'netWorth'))!.cells!
    expect(cells[SALE_YEAR]).toMatchObject({ value: null, status: 'not-computed' })
    expect(cells[SALE_YEAR + 1]).toMatchObject({ value: null, status: 'not-computed' })
    const reason = sheet.resolveExplanation!(cells[SALE_YEAR].explanationRefs![0])!
    const suffix = sheet.resolveExplanation!(cells[SALE_YEAR + 1].explanationRefs![0])!
    expect(reason.sources?.[0].code).toBe('propertySale')
    expect(suffix.sources?.[0].code).toBe('suffix')
    for (const { locale, clock, title, cash } of [
      { locale: 'en', clock: /self member’s clock/i, title: /every positive title interest/i, cash: /joint household living/i },
      { locale: 'fr', clock: /âge du membre principal/i, title: /chaque intérêt positif/i, cash: /dépenses communes/i },
      { locale: 'zh', clock: /本人达到/, title: /每项正产权/, cash: /共同开支授权/ },
    ] as const) {
      const message = annualSheetText(reason.summary!, locale)
      expect(message).toMatch(clock)
      expect(message).toMatch(title)
      expect(message).toMatch(cash)
    }
  })

  it('keeps externally supplied household states outside the authenticated continuous chain', () => {
    const { plan, evidence } = fixture()
    const opening = ok(projectCanonicalCoverage(plan, evidence, 2)).state
    const sold = ok(projectCanonicalCoverage(plan, evidence, 3)).state
    const returns = vi.fn(() => 0)
    for (const state of [opening, sold, structuredClone(opening), structuredClone(sold)]) {
      const before = structuredClone(state)
      expect(evaluateCanonicalHouseholdWorkingYear(plan, evidence, state.year, state)).toMatchObject({ status: 'unsupported' })
      expect(annualRetirementContinuation(plan, state, evidence)).toMatchObject({ status: 'invalid' })
      expect(annualRetirementStep(plan, state, returns)).toMatchObject({
        status: state.primaryHomeSaleCash ? 'invalid' : 'unsupported',
      })
      expect(projectRetirementCoverage(plan, state, 1, returns)).not.toMatchObject({
        status: 'ok', value: { rows: [expect.anything()] },
      })
      expect(state).toEqual(before)
    }
    expect(returns).not.toHaveBeenCalled()
  })

  it('preserves provider sale refusal and the legacy and production projections', () => {
    const { plan } = fixture()
    const control = structuredClone(plan)
    delete control.annualPrimaryHomeSaleEvidence
    const input = plan.legacyProjection
    const traced = runProjection(input, undefined, plan, { captureAnnualDetails: true })
    const reference = runProjection(input, undefined, control, { captureAnnualDetails: true })
    expect(traced).toStrictEqual(reference)
    expect(legacyAnnualSheet(traced, input, CONTEXT).rows).toStrictEqual(legacyAnnualSheet(reference, input, CONTEXT).rows)
    expect(runProjection(input, undefined, plan)).toStrictEqual(runProjection(input, undefined, control))
    const sample = vi.fn(() => -0.03)
    const controlSample = vi.fn(() => -0.03)
    expect(runProjection(input, sample, plan)).toStrictEqual(runProjection(input, controlSample, control))
    expect(sample).toHaveBeenCalled()
    expect(sample.mock.calls).toEqual(controlSample.mock.calls)

    const budget = { kind: 'savingsBudget' as const, annualNetSavings: 0, retirementSpending: 0,
      debtIncluded: known(true as const), taxBenefitIncluded: known(true as const) }
    for (const candidate of [plan, control]) {
      candidate.budget = budget
      for (const person of candidate.people) person.retirementAge = 67
    }
    const evaluate = vi.fn(() => ({ byPerson: Object.fromEntries(plan.people.map(person => [person.id, {
      income: 0, earnedIncome: 0, benefits: 0, tax: 0, spending: 0, taxableIncome: 0, benefitIncomeForNextYear: known(0),
    }])) }))
    const providers = { evaluate, returns: () => 0 }
    const prefix = ok(projectAnnualCoverage(control, ok(initializeState(control)), 2, providers))
    const withEvidence = ok(projectAnnualCoverage(plan, ok(initializeState(plan)), 4, providers))
    expect(withEvidence).toStrictEqual(ok(projectAnnualCoverage(control, ok(initializeState(control)), 4, providers)))
    expect(withEvidence).toMatchObject({ evaluationBasis: 'provider-supplied', rows: prefix.rows, state: prefix.state,
      blocked: { year: SALE_YEAR, status: 'unsupported', causes: ['propertySale'] }, uncomputedYears: [2029] })
  })

  it('preserves the pre-sale account refusal for literal __proto__ without authenticated opt-in', () => {
    const { plan, evidence } = fixture()
    const optIn = plan.annualPrimaryHomeSaleEvidence
    delete plan.annualPrimaryHomeSaleEvidence
    plan.accounts[0].id = '__proto__'
    const opening = ok(initializeState(plan))
    expect(Object.keys(opening.byAccount)).toEqual(['__proto__'])
    const canonical = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(canonical.blocked).toMatchObject({ year: BASE_YEAR, status: 'invalid', causes: ['invalidState'] })
    expect(canonical.rows).toEqual([])
    expect(canonical.state).toEqual(opening)

    plan.annualPrimaryHomeSaleEvidence = optIn
    plan.budget = { kind: 'savingsBudget', annualNetSavings: 0, retirementSpending: 0,
      debtIncluded: known(true), taxBenefitIncluded: known(true) }
    for (const person of plan.people) person.retirementAge = 67
    const providers = { evaluate: () => ({ byPerson: Object.fromEntries(plan.people.map(person => [person.id, {
      income: 0, earnedIncome: 0, benefits: 0, tax: 0, spending: 0, taxableIncome: 0, benefitIncomeForNextYear: known(0),
    }])) }), returns: () => 0 }
    const providerOpening = ok(initializeState(plan))
    const supplied = ok(projectAnnualCoverage(plan, providerOpening, 4, providers))
    expect(supplied).toMatchObject({ evaluationBasis: 'provider-supplied', rows: [], state: providerOpening,
      blocked: { year: BASE_YEAR, status: 'invalid', causes: ['invalidState'] } })
  })

  it('preserves the pre-existing solo opt-in without household proof', () => {
    const { plan, home, sale, evidence } = fixture()
    plan.people = plan.people.filter(person => person.role === 'self')
    delete plan.tfsaStatement![PARTNER]
    home.taxableOwnerShares = { status: 'known', shares: { [SELF]: 1 } }
    delete sale.allSaleCashAvailableForJointSpending
    delete sale.ownerExclusions
    delete sale.effectiveYear
    delete sale.timing
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows[2].retirementSettlement?.primaryHomeSale).toMatchObject({
      propertyId: HOME, year: SALE_YEAR, grossProceeds: 131_220, netProceeds: 129_999.97, taxableGain: 0,
    })
    expect(coverage.rows[2].householdWithdrawalSettlement).toBeUndefined()
  })
})
