import { describe, expect, it } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetModel, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { projectCanonicalCoverage, sumNetWorth, type AnnualCoverage } from '../annualState'
import type { TerminalHeldHomeEvidence } from '../annualTerminalEstate'
import { estateYear, heldHomeEstateIds, integratedHeldHomeEstateFixture } from './fixtures/annualIntegratedHeldHomeEstate'
import { BASE_YEAR, known } from './fixtures/retirementSettlement'

const { self, partner, selfTfsa, partnerTfsa, home, debt, expense } = heldHomeEstateIds
const context = { scenarioId: 'integrated-held-home-estate', revision: 1 }
const near = (n: number) => expect.closeTo(n, 6)
type Fixture = ReturnType<typeof integratedHeldHomeEstateFixture>

function run({ plan, spending }: Fixture, years = 3) {
  const result = projectCanonicalCoverage(plan, spending, years)
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function terminalProof({ plan }: Fixture) {
  return plan.annualTerminalEstateEvidence![estateYear]
}

function ordinaryLedger({ rows, state, blocked, uncomputedYears }: AnnualCoverage) {
  return { rows: rows.map(({ terminalEstateEstimate: _estate, ...row }) => row), state, blocked, uncomputedYears }
}

function sheetRow(sheet: AnnualSheetModel, ...path: string[]): AnnualSheetRow {
  const flatten = (rows: AnnualSheetRow[]): AnnualSheetRow[] => rows.flatMap(row => [row, ...flatten(row.children ?? [])])
  const id = canonicalSheetId(...path)
  const row = flatten(sheet.rows).find(candidate => candidate.id === id)
  if (!row) throw new Error(`Missing annual sheet row ${id}`)
  return row
}

// Three annual $1,331 payments amortize $3,310 at 10%; each interest
// amount is 10% of opening principal, and principal is payment less interest.
// The $2,500/$500 wages fall below the CPP basic exemption and income tax
// thresholds. EI is 1.63% of wages. Working surplus is $3,000 - $48.90
// - $1,520.10 - $1,331 = $100, assigned $25.04/$74.96 to the owners.
// Mixed: $1,331 + $350 - ($500 - $8.15) = $1,189.15, funded by $675.04
// self and $514.11 partner. The partner's $2,214.11 drops to $1,700.
// Terminal: $1,700 pays $1,331 debt, then $300 living, then $69 of the
// $100 repair. Both TFSAs close at zero and the repair alone is $31 short.
const expectedYears = [
  { phase: 'both-working', ages: [57, 55], wages: [2_500, 500], payroll: 48.90, living: 1_520.10,
    mortgage: [3_310, 331, 1_000, 2_310], property: [480_000, 48_000, 528_000],
    selfAccount: [650, 25.04, 0, 675.04], partnerAccount: [2_139.15, 74.96, 0, 2_214.11],
    restored: [0, 0], netWorth: 528_579.15 },
  { phase: 'mixed', ages: [58, 56], wages: [0, 500], payroll: 8.15, living: 350,
    mortgage: [2_310, 231, 1_100, 1_210], property: [528_000, 52_800, 580_800],
    selfAccount: [675.04, 0, 675.04, 0], partnerAccount: [2_214.11, 0, 514.11, 1_700],
    restored: [0, 0], netWorth: 581_290 },
  { phase: 'both-retired', ages: [59, 57], wages: [0, 0], payroll: 0, living: 300,
    mortgage: [1_210, 121, 1_210, 0], property: [580_800, 58_080, 638_880],
    selfAccount: [0, 0, 0, 0], partnerAccount: [1_700, 0, 1_700, 0],
    restored: [675.04, 514.11], netWorth: 638_880 },
]

// Projected endpoint FMV is $480,000 × 1.10³ = $638,880. The verified
// 25/75 title allocates $159,720 to the certificate and $479,160 to the
// survivor memo. The whole-home gain is $638,880 - $240,000 = $398,880.
// The model takes the evidenced full exclusion as an input. TFSA draws are
// tax-free and there is no registered FMV taxable at death or other income.
// EAT is $15 × ceil(($159,720 - $50,000)/$1,000) = $1,650.
const estateValue = { closingFairMarketValue: 638_880, estateIncludedFairMarketValue: 159_720,
  excludedSurvivorFairMarketValue: 479_160, excludedTerminalGain: 398_880 }

describe('FE-53 integrated working-to-held-home estate ledger', () => {
  it('carries both owners through wages, ordered TFSA activity, discharge, and the certified closing', () => {
    const fixture = integratedHeldHomeEstateFixture()
    const before = structuredClone(fixture)
    const coverage = run(fixture)
    expect(coverage).toMatchObject({ terminalYear: estateYear, blocked: null, uncomputedYears: [],
      evaluationBasis: 'canonical-continuous', overallConclusionAvailable: false })
    expect(coverage.rows.map(row => row.year)).toEqual([BASE_YEAR, BASE_YEAR + 1, estateYear])
    const sheet = canonicalAnnualSheet(coverage, context)
    for (const [index, row] of coverage.rows.entries()) {
      const expected = expectedYears[index]
      const terminal = index === 2
      const prefix = run(fixture, index + 1)
      expect(prefix.rows).toStrictEqual(coverage.rows.slice(0, index + 1))
      const [openingDebt, interest, principal, closingDebt] = expected.mortgage
      const [openingHome, growth, closingHome] = expected.property
      expect(row).toMatchObject({ workingSettlement: { household: { phase: expected.phase } },
        cashLedger: { income: expected.wages[0] + expected.wages[1], benefits: 0, tax: 0,
          spending: expected.living, debtPayments: 1_331, voluntaryContributions: index === 0 ? 100 : 0,
          unallocated: 0 }, payrollContributions: near(expected.payroll),
        householdWithdrawalSettlement: { spendingDue: expected.living, spendingFunded: expected.living,
          spendingUnmet: 0, taxIncrement: 0, withdrawal: expected.selfAccount[2] + expected.partnerAccount[2] },
        byDebt: { [debt]: { propertyId: home, opening: near(openingDebt), interest: near(interest),
          principal: near(principal), payment: 1_331, closing: near(closingDebt) } },
        byProperty: { [home]: { opening: near(openingHome), growth: near(growth), closing: near(closingHome), held: true } },
      })
      expect(prefix.state.byDebt[debt]).toMatchObject({ principal: near(closingDebt), yearsRemaining: 2 - index })
      expect(prefix.state.byProperty[home]).toMatchObject({ value: near(closingHome), held: true, acb: known(240_000) })
      expect(sumNetWorth(prefix.state)).toBeCloseTo(expected.netWorth, 6)
      expect(sheetRow(sheet, 'value', 'netWorth').cells![row.year].value).toBeCloseTo(expected.netWorth, 6)
      const owners = [
        [self, selfTfsa, expected.selfAccount], [partner, partnerTfsa, expected.partnerAccount],
      ] as const
      for (const [ownerIndex, [ownerId, accountId, amounts]] of owners.entries()) {
        const [opening, contribution, withdrawal, closing] = amounts
        expect(row.byPerson[ownerId]).toMatchObject({ age: expected.ages[ownerIndex],
          income: expected.wages[ownerIndex], earnedIncome: expected.wages[ownerIndex], benefits: 0,
          taxableIncome: expected.wages[ownerIndex], tax: 0 })
        expect(row.taxLedger[ownerId]).toEqual({ taxableIncome: expected.wages[ownerIndex], tax: 0 })
        expect(row.byAccount[accountId]).toMatchObject({ ownerId, opening, contribution, withdrawal, closing, returnAmount: 0 })
        expect(prefix.state.byAccount[accountId]).toMatchObject({ ownerId, balance: closing })
        expect(row.tfsaLedger[ownerId]).toMatchObject({ restored: known(expected.restored[ownerIndex]),
          applied: contribution, retained: 0 })
        const initialRoom = ownerIndex === 0 ? 100 : 250
        const remainingRoom = ownerIndex === 0 ? 74.96 : 175.04
        if (index === 0) expect(row.tfsaLedger[ownerId]).toMatchObject({ openingRoom: known(initialRoom),
          annualAddition: known(0), closingRoom: known(remainingRoom) })
        else expect(row.tfsaLedger[ownerId].closingRoom.status).toBe('unknown')
        if (index === 1) expect(row.tfsaLedger[ownerId].openingRoom).toEqual(known(remainingRoom))
        expect(prefix.state.byPerson[ownerId].tfsaRoom).toEqual(row.tfsaLedger[ownerId].closingRoom)
      }
      if (!terminal) {
        expect(row.terminalEstateEstimate).toBeUndefined()
        expect(row.householdExpense).toBeUndefined()
        expect(prefix.state.unfundedEvents).toEqual([])
      }
    }
    const [working, mixed, terminal] = coverage.rows
    expect(working.householdWorkingTfsaSettlement?.arithmetic.surplus).toEqual({ coefficient: '100', scale: 0 })
    expect(working.contributionLedger.postings.map(({ accountId, ownerId, contributorId, amount }) =>
      [accountId, ownerId, contributorId, amount])).toEqual([[selfTfsa, self, self, 25.04], [partnerTfsa, partner, partner, 74.96]])
    expect(mixed.householdWithdrawalSettlement?.postings).toEqual([
      { accountId: selfTfsa, ownerId: self, kind: 'tfsa', amount: 675.04 },
      { accountId: partnerTfsa, ownerId: partner, kind: 'tfsa', amount: 514.11 },
    ])
    expect(terminal.householdWithdrawalSettlement?.postings).toEqual([
      { accountId: partnerTfsa, ownerId: partner, kind: 'tfsa', amount: 1_700 },
    ])
    expect(terminal.byDebt[debt].closing).toBe(0)
    expect(coverage.state.byDebt[debt].principal).toBe(0)
    expect(terminal.householdExpense).toMatchObject({ eventId: expense, due: 100, paid: 69, unmet: 31,
      postings: [{ accountId: partnerTfsa, ownerId: partner, amount: 69 }] })
    expect(terminal.cashLedger.expensePayments).toBe(69)
    expect(coverage.state.unfundedEvents).toEqual([{ eventId: expense, amount: 31,
      field: 'annualHouseholdExpenseEvidence.amountNominal', reason: 'householdExpense' }])
    expect(coverage.state.tfsaWithdrawalHistory?.map(({ calendarYear, personId, amount }) => [calendarYear, personId, amount]))
      .toEqual([[BASE_YEAR + 1, self, 675.04], [BASE_YEAR + 1, partner, 514.11], [estateYear, partner, 1_700]])
    expect(terminal.terminalEstateEstimate).toMatchObject({ status: 'estimated', scope: 'self-estate-only',
      personId: self, survivingPersonId: partner, closingNetWorth: near(159_720),
      estateAdministrationTaxBase: near(159_720), closingRegisteredFairMarketValue: 0, incrementalFinalReturnIncomeTax: 0,
      estateAdministrationTax: 1_650, netEstate: near(158_070), householdClosingNetWorth: near(638_880),
      excludedSurvivorClosingNetWorth: near(479_160), startCpi: 1, endCpi: 1, taxBasis: 'start-CPI-annual-return',
      heldHome: { propertyId: home, decedentShare: 0.25, survivorShare: 0.75, evidence: fixture.heldHome,
        closingFairMarketValue: near(638_880), estateIncludedFairMarketValue: near(159_720),
        excludedSurvivorFairMarketValue: near(479_160), excludedTerminalGain: near(398_880) },
    })
    const receipt = terminal.terminalEstateEstimate
    if (receipt?.status !== 'estimated' || !receipt.heldHome) throw new Error('Missing closing home estate receipt')
    const amounts = [receipt.heldHome.arithmetic.closingFairMarketValue,
      receipt.heldHome.arithmetic.estateIncludedFairMarketValue, receipt.heldHome.arithmetic.excludedSurvivorFairMarketValue]
    const scale = Math.max(...amounts.map(amount => amount.scale))
    const [whole, included, excluded] = amounts.map(amount => BigInt(amount.coefficient) * 10n ** BigInt(scale - amount.scale))
    expect(whole).toBe(included + excluded)
    expect(whole).toBe(included * 4n)
    expect(fixture).toStrictEqual(before)
  })

  it('keeps event cash, living coverage, whole-home FMV, and estate memos distinct in all three locales', () => {
    const sheet = canonicalAnnualSheet(run(integratedHeldHomeEstateFixture()), context)
    const column = sheet.years.at(-1)!
    for (const [field, value] of Object.entries(estateValue)) {
      const row = sheetRow(sheet, 'terminalEstate', 'heldHome', field)
      expect(row.cells![BASE_YEAR + 1]).toMatchObject({ value: null, status: 'not-applicable' })
      const cell = row.cells![estateYear]
      expect(cell).toMatchObject({ status: 'estimated', timing: 'terminal', basis: 'nominal-CAD' })
      expect(annualSheetDisplayValue(cell, column, 'nominal')).toBeCloseTo(value, 6)
      expect(new Set(['en', 'fr', 'zh'].map(locale => annualSheetText(row.label, locale))).size).toBe(3)
    }
    const cell = sheetRow(sheet, 'value', 'estate').cells![estateYear]
    expect(annualSheetDisplayValue(cell, column, 'nominal')).toBeCloseTo(158_070, 6)
    const explanation = sheet.resolveExplanation!(cell.explanationRefs![0])!
    expect(explanation).toMatchObject({ projectionYear: estateYear, taxYear: BASE_YEAR, rulePackage: 'CA-ON-tax-2026-legacy-v1' })
    expect(explanation.formula?.map(({ direction, value }) => [direction, value]))
      .toEqual([['add', near(159_720)], ['subtract', 0], ['subtract', 1_650]])
    const source = explanation.sources!.find(item => item.field === 'annualTerminalEstateEvidence.heldHome')!
    expect(source).toMatchObject({ id: home, granularity: 'input' })
    expect(explanation.sources?.map(item => item.displayReference)).toEqual(expect.arrayContaining([
      'https://www.ontario.ca/page/estate-administration-tax',
      'https://laws-lois.justice.gc.ca/eng/acts/I-3.3/section-70.html',
      'https://laws-lois.justice.gc.ca/eng/acts/I-3.3/section-40.html',
    ]))
    const expenseRow = sheetRow(sheet, 'value', 'event', expense, 'expenseUnmet')
    expect(expenseRow.cells![estateYear]).toMatchObject({ value: 31, status: 'estimated', timing: 'during-year' })
    expect(sheetRow(sheet, 'value', 'retirement', 'spendingUnmet').cells![estateYear].value).toBe(0)
    for (const [locale, certificate, title, filing] of [
      ['en', /certificate/i, /title/i, /filing/i],
      ['fr', /certificat/i, /titre/i, /déclaration/i],
      ['zh', /认证/, /产权/, /申报/],
    ] as const) {
      const localized = annualSheetText(source.label, locale)
      expect(localized).toMatch(certificate)
      expect(localized).toMatch(title)
      expect(localized).toMatch(filing)
      expect(annualSheetText(source.displayReference!, locale)).toMatch(/2025.*2028.*0\.25.*0\.75/)
    }
  })

  const malformedProofs: [string, (proof: TerminalHeldHomeEvidence) => TerminalHeldHomeEvidence][] = [
    ['wrong property', proof => ({ ...proof, propertyId: 'other-home' })],
    ['wrong title shares', proof => ({ ...proof, ownerShares: { [self]: 0.75, [partner]: 0.25 } })],
    ['missing self title', proof => ({ ...proof, ownerShares: { [partner]: 0.75 } })],
    ['inherited self title', proof => ({ ...proof, ownerShares: Object.assign(Object.create({ [self]: 0.25 }), { [partner]: 0.75 }) })],
    ['missing Ontario location', proof => { const { locatedInOntario: _location, ...remaining } = proof; return remaining as TerminalHeldHomeEvidence }],
    ['false Ontario location', proof => Object.assign(proof, { locatedInOntario: false })],
    ['inherited Ontario location', proof => { const { locatedInOntario, ...remaining } = proof; return Object.assign(Object.create({ locatedInOntario }), remaining) }],
    ['missing certificate inclusion', proof => Object.assign(proof, { decedentShareEstateIncluded: undefined })],
    ['missing full gain exclusion', proof => Object.assign(proof, { wholeTerminalGainExcluded: undefined })],
    ['future evidence date', proof => ({ ...proof, provenance: { origin: 'user', sourceYear: estateYear } })],
    ['missing user evidence', proof => ({ ...proof, provenance: { origin: 'legacy', sourceYear: BASE_YEAR } })],
  ]

  it.each(malformedProofs)('withholds the estate on %s and preserves every settled annual posting', (_name, change) => {
    const fixture = integratedHeldHomeEstateFixture()
    const affirmed = run(fixture)
    const proof = terminalProof(fixture)
    proof.heldHome = change(proof.heldHome!)
    const invalid = run(fixture)
    expect(invalid.rows[2].terminalEstateEstimate).toEqual({ status: 'unavailable', reason: 'evidence-invalid' })
    expect(ordinaryLedger(invalid)).toStrictEqual(ordinaryLedger(affirmed))
    const sheet = canonicalAnnualSheet(invalid, context)
    expect(sheetRow(sheet, 'value', 'estate').cells![estateYear]).toMatchObject({ value: null, status: 'unknown' })
  })

  it('preserves the settled ledger on missing subproof and retains the existing no-opt-in endpoint gate', () => {
    const fixture = integratedHeldHomeEstateFixture()
    const affirmed = run(fixture)
    delete terminalProof(fixture).heldHome
    expect(run(fixture).rows[2].terminalEstateEstimate).toEqual({ status: 'unavailable', reason: 'unsupported-estate' })
    expect(ordinaryLedger(run(fixture))).toStrictEqual(ordinaryLedger(affirmed))
    fixture.plan.annualTerminalEstateEvidence = {}
    const empty = run(fixture)
    expect(empty.rows[2].terminalEstateEstimate).toEqual({ status: 'unavailable', reason: 'unsupported-estate' })
    expect(ordinaryLedger(empty)).toStrictEqual(ordinaryLedger(affirmed))
    delete fixture.plan.annualTerminalEstateEvidence
    const noOptIn = run(fixture)
    expect(noOptIn.rows).toStrictEqual(affirmed.rows.slice(0, 2))
    expect(noOptIn.state).toStrictEqual(run(fixture, 2).state)
    expect(noOptIn.blocked).toMatchObject({ year: estateYear, status: 'unsupported',
      issues: [expect.objectContaining({ detail: 'household end-life settlement not yet wired' })] })
    fixture.plan.lifeExpectancy += 1
    expect(ordinaryLedger(run(fixture))).toStrictEqual(ordinaryLedger(affirmed))
  })

  it.each([
    ['zero interest for the decedent', 0, 1],
    ['shares whose floating sum rounds to one', 0.25, 0.7499999999999999],
  ] as const)('rejects %s even when the matching title can settle ordinary years', (_name, selfShare, partnerShare) => {
    const fixture = integratedHeldHomeEstateFixture()
    const shares = { [self]: selfShare, [partner]: partnerShare }
    fixture.plan.properties[0].taxableOwnerShares = { status: 'known', shares }
    terminalProof(fixture).heldHome!.ownerShares = { ...shares }
    const coverage = run(fixture)
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows[2].terminalEstateEstimate).toEqual({ status: 'unavailable', reason: 'evidence-invalid' })
    expect(ordinaryLedger(coverage)).toStrictEqual(ordinaryLedger(run(integratedHeldHomeEstateFixture())))
  })

  it.each([false, true])('shows an excluded gain of unknown size without recorded ACB (known amount %s)', amountKnown => {
    const fixture = integratedHeldHomeEstateFixture()
    if (!amountKnown) fixture.plan.properties[0].acb = { status: 'unknown', reason: 'basis not available' }
    delete fixture.plan.properties[0].provenance.acb
    const coverage = run(fixture)
    expect(coverage.rows[2].terminalEstateEstimate).toMatchObject({ status: 'estimated', incrementalFinalReturnIncomeTax: 0,
      netEstate: near(158_070), heldHome: { excludedTerminalGain: null } })
    const sheet = canonicalAnnualSheet(coverage, context)
    expect(sheetRow(sheet, 'terminalEstate', 'heldHome', 'excludedTerminalGain').cells![estateYear])
      .toMatchObject({ value: null, status: 'unknown' })
  })

  it('requires recorded canonical title separately from the terminal proof', () => {
    const fixture = integratedHeldHomeEstateFixture()
    const affirmed = run(fixture)
    delete fixture.plan.properties[0].provenance.taxableOwnerShares
    const unrecorded = run(fixture)
    expect(unrecorded.rows[2].terminalEstateEstimate).toEqual({ status: 'unavailable', reason: 'evidence-invalid' })
    expect(ordinaryLedger(unrecorded)).toStrictEqual(ordinaryLedger(affirmed))
  })

  it('uses closing nominal FMV for the certificate and end CPI for purchasing-power display', () => {
    const fixture = integratedHeldHomeEstateFixture()
    fixture.plan.inflation = 0.02
    const coverage = run(fixture)
    expect(coverage.blocked).toBeNull()
    // The exhausted self TFSA leaves only one quarter of $480,000 × (1.1 × 1.02)³.
    const nominal = 120_000 * 1.122 ** 3
    const fee = 15 * Math.ceil((nominal - 50_000) / 1_000)
    expect(fee).toBe(1_800)
    expect(coverage.rows[2].terminalEstateEstimate).toMatchObject({ status: 'estimated',
      estateAdministrationTaxBase: near(nominal), startCpi: near(1.02 ** 2), endCpi: near(1.02 ** 3),
      estateAdministrationTax: fee, incrementalFinalReturnIncomeTax: 0, netEstate: near(nominal - fee) })
    const sheet = canonicalAnnualSheet(coverage, context)
    const column = sheet.years.at(-1)!
    const cell = sheetRow(sheet, 'terminalEstate', 'heldHome', 'estateIncludedFairMarketValue').cells![estateYear]
    expect(annualSheetDisplayValue(cell, column, 'nominal')).toBeCloseTo(nominal, 6)
    expect(annualSheetDisplayValue(cell, column, 'real')).toBeCloseTo(159_720, 6)
  })

  it('stops the estate memo for exactly one cent of principal and one year remaining at closing', () => {
    const fixture = integratedHeldHomeEstateFixture()
    Object.assign(fixture.plan.debts[0], { principal: 0.04, annualPayment: 0.01, yearsRemaining: 4 })
    // Same $100 working surplus with $1,330.99 removed from mandatory debt cash.
    fixture.spending.workingSpending = known(2_851.09)
    fixture.spending.transitionSpending = known(500)
    fixture.plan.budget = { kind: 'incomeBudget', workingSpending: 2_851.09, retirementSpending: 300 }
    const coverage = run(fixture)
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows[2].byDebt[debt].closing).toBe(0.01)
    expect(coverage.state.byDebt[debt]).toMatchObject({ principal: 0.01, yearsRemaining: 1 })
    expect(coverage.rows[2].terminalEstateEstimate).toEqual({ status: 'unavailable', reason: 'unsupported-estate' })
    fixture.plan.annualTerminalEstateEvidence = {}
    expect(ordinaryLedger(coverage)).toStrictEqual(ordinaryLedger(run(fixture)))
  })

  it('accepts a prior-year maturity and excludes the partner’s retained TFSA alongside their title', () => {
    const fixture = integratedHeldHomeEstateFixture()
    Object.assign(fixture.plan.debts[0], { principal: 2_662, yearsRemaining: 2 })
    const coverage = run(fixture)
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows[1].byDebt[debt]).toMatchObject({ payment: 1_331, closing: 0 })
    const terminal = coverage.rows[2]
    expect(terminal.byDebt[debt]).toMatchObject({ opening: 0, payment: 0, closing: 0 })
    expect(coverage.state.byDebt[debt]).toMatchObject({ principal: 0, yearsRemaining: 0 })
    // The closing partner TFSA retains $1,700 - $300 living - $100 expense.
    expect(terminal.byAccount[partnerTfsa].closing).toBe(1_300)
    expect(terminal.terminalEstateEstimate).toMatchObject({ status: 'estimated', closingNetWorth: near(159_720),
      estateAdministrationTax: 1_650, excludedSurvivorClosingNetWorth: near(479_160 + 1_300),
      householdClosingNetWorth: near(638_880 + 1_300) })
  })

  it.each([[199_724, 50_000, 0], [199_724.04, 50_000.01, 15]])(
    'prices home FMV %d at the exact aggregate certificate boundary %d', (fmv, estateBase, fee) => {
      const fixture = integratedHeldHomeEstateFixture()
      Object.assign(fixture.plan.properties[0], { value: fmv, appreciation: 0, acb: known(100_000) })
      // Partner-first draws use the same total cash. With no expense, the
      // partner TFSA is exhausted first and $69 remains in the self TFSA.
      fixture.plan.annualHouseholdMortgageFundingEvidence!.orderedAccounts.reverse()
      delete fixture.plan.annualHouseholdExpenseEvidence
      const coverage = run(fixture)
      expect(coverage.blocked).toBeNull()
      expect(coverage.rows[2].byAccount[selfTfsa].closing).toBe(69)
      expect(coverage.rows[2].byAccount[partnerTfsa].closing).toBe(0)
      expect(coverage.rows[2].terminalEstateEstimate).toMatchObject({ status: 'estimated', estateAdministrationTaxBase: estateBase,
        estateAdministrationTax: fee, incrementalFinalReturnIncomeTax: 0, netEstate: estateBase - fee })
    },
  )

  it('distinguishes a settled living gap from an unsupported expense posting and estate proof', () => {
    const fixture = integratedHeldHomeEstateFixture()
    // $80 less cash than the main fixture leaves $1,620 in the final TFSA.
    fixture.plan.accounts[1].balance = 2_059.15
    const coverage = run(fixture)
    const terminal = coverage.rows[2]
    expect(terminal.householdWithdrawalSettlement).toMatchObject({ spendingDue: 300, spendingFunded: 289, spendingUnmet: 11 })
    expect(terminal.householdExpense).toMatchObject({ due: 100, paid: 0, unmet: 100, postings: [] })
    expect(terminal.terminalEstateEstimate).toMatchObject({ status: 'estimated', netEstate: near(158_070) })
    delete terminalProof(fixture).heldHome
    const missing = run(fixture)
    expect(missing.rows[2].terminalEstateEstimate).toEqual({ status: 'unavailable', reason: 'unsupported-estate' })
    expect(ordinaryLedger(missing)).toStrictEqual(ordinaryLedger(coverage))

    const prefix = run(fixture, 2)
    Object.assign(fixture.plan.annualHouseholdExpenseEvidence!, { allowPartialPayment: false })
    const unsupported = run(fixture, 4)
    expect(unsupported).toMatchObject({ blocked: { year: estateYear, status: 'unsupported', causes: ['householdExpense'] },
      uncomputedYears: [estateYear + 1] })
    expect(unsupported.rows).toStrictEqual(prefix.rows)
    expect(unsupported.state).toStrictEqual(prefix.state)
  })

  it('preserves the prior account-only estate memo’s ledger-key summation order', () => {
    const fixture = integratedHeldHomeEstateFixture()
    const { plan, spending } = fixture
    plan.properties = []
    plan.debts = []
    delete plan.annualHouseholdExpenseEvidence
    delete plan.annualHouseholdMortgageFundingEvidence
    delete plan.annualHouseholdWorkingTfsaEvidence
    const [selfAccount, partnerAccount] = plan.accounts
    Object.assign(selfAccount, { id: '4', balance: 60_000_000_000_000 })
    Object.assign(partnerAccount, { id: '1', balance: 0.01 })
    plan.accounts.push({ ...selfAccount, id: '2', kind: 'rrsp', balance: 0.01 },
      { ...partnerAccount, id: '3', kind: 'rrsp' })
    plan.budget = { kind: 'incomeBudget', workingSpending: 2_951.10, retirementSpending: 0 }
    Object.assign(spending, { workingSpending: known(2_951.10), transitionSpending: known(491.85), retirementSpending: known(0) })
    const proof = terminalProof(fixture)
    delete proof.heldHome
    proof.accounts = { '4': { ownerId: self, estateIncluded: true, noBeneficiaryRollover: true, tfsaNoDeathIncome: true },
      '2': { ownerId: self, estateIncluded: true, noBeneficiaryRollover: true } }
    const coverage = run(fixture)
    expect(coverage.blocked).toBeNull()
    const terminal = coverage.rows[2]
    expect(plan.accounts.map(account => account.id)).toEqual(['4', '1', '2', '3'])
    expect(Object.keys(terminal.byAccount)).toEqual(['1', '2', '3', '4'])
    // The prior account-only memo sums the three cents before adding the
    // large account. Summing the plan order loses a cent to double rounding.
    expect(terminal.terminalEstateEstimate).toMatchObject({ status: 'estimated',
      householdClosingNetWorth: 60_000_000_000_000.03, excludedSurvivorClosingNetWorth: 0.02 })
  })
})
