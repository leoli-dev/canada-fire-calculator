import { describe, expect, it } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { projectRetirementCoverage } from '../annualRetirement'
import { initializeState, projectAnnualCoverage, projectCanonicalCoverage, sumNetWorth, type KernelResult } from '../annualState'
import type { AnnualTerminalEstateEvidence } from '../annualTerminalEstate'
import type { InputsV2 } from '../model'
import { runProjection } from '../projection'
import { cppStart } from './fixtures/annualCpp'
import { BASE_YEAR, known, recorded, retirementPlan, RETIREE, RRSP, TFSA } from './fixtures/retirementSettlement'

const terminalYear = BASE_YEAR + 2
const context = { scenarioId: 'ontario-estate-oracle', revision: 1 }
const money = (value: number) => expect.closeTo(value, 2)

// Hand-keyed 2026 tax inputs from CRA T4127, 122nd edition. The test person is under 65 with only ordinary
// RRSP income. The test incomes use at most the first two brackets in each
// jurisdiction and remain below the first Ontario surtax threshold.
function ordinaryTax(income: number): number {
  const federal = Math.max(0, Math.min(income, 58_523) - 16_452) * 0.14
    + Math.max(0, income - 58_523) * 0.205
  const ontario = Math.max(0, Math.min(income, 53_891) - 12_989) * 0.0505
    + Math.max(0, income - 53_891) * 0.0915
  const premium = Math.min(300, Math.max(0, income - 20_000) * 0.06)
    + Math.min(150, Math.max(0, income - 36_000) * 0.06)
    + Math.min(150, Math.max(0, income - 48_000) * 0.25)
    + Math.min(150, Math.max(0, income - 72_000) * 0.25)
  return federal + ontario + premium
}

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function fixture({ rrsp = 102_000, tfsa = 38_000, inflation = 0.04, grossDraw = 30_000 } = {}) {
  const spending = grossDraw - ordinaryTax(grossDraw)
  const plan = retirementPlan({ rrsp, tfsa, spending, inflation })
  plan.people[0].retirementAge = 58
  plan.legacyProjection.fireAge = 58
  plan.budget = { kind: 'incomeBudget', workingSpending: 0, retirementSpending: spending }
  for (const account of plan.accounts) account.provenance = { balance: recorded, taxableOwnerShares: recorded }
  const certification: AnnualTerminalEstateEvidence = {
    effectiveYear: terminalYear, personId: RETIREE, timing: 'end-of-terminal-year',
    certificateRequired: true, completeEstate: true, noDeathBenefitsOrOtherTerminalIncome: true, provenance: recorded,
    accounts: {
      [RRSP]: { ownerId: RETIREE, estateIncluded: true, noBeneficiaryRollover: true },
      [TFSA]: { ownerId: RETIREE, estateIncluded: true, noBeneficiaryRollover: true, tfsaNoDeathIncome: true },
    },
  }
  plan.annualTerminalEstateEvidence = { [terminalYear]: certification }
  return { plan, certification, evidence: { workingSpending: known(0), retirementSpending: known(spending) } }
}

function withoutEstate(plan: InputsV2): InputsV2 {
  const { annualTerminalEstateEvidence: _evidence, ...baseline } = plan
  return baseline
}

function age65Fixture() {
  const { plan, certification } = fixture({ rrsp: 70_000, tfsa: 20_000, inflation: 0.10 })
  const spending = 28_553.6155
  plan.people[0].ageInBaseYear = 64
  plan.people[0].retirementAge = 65
  plan.lifeExpectancy = 65
  plan.budget = { kind: 'incomeBudget', workingSpending: 0, retirementSpending: spending }
  plan.annualTerminalEstateEvidence = { [2027]: { ...certification, effectiveYear: 2027 } }
  return { plan, evidence: { workingSpending: known(0), retirementSpending: known(spending) } }
}

function benefitExclusions(): NonNullable<InputsV2['annualBenefitsEvidence']>[string] {
  return {
    gis: { status: 'excluded', reason: 'GIS explicitly excluded', provenance: recorded },
    allowance: { status: 'not-applicable', reason: 'No Allowance', provenance: recorded },
    otherBenefits: { status: 'excluded', reason: 'Other benefits explicitly excluded', provenance: recorded },
  }
}

function findRow(rows: AnnualSheetRow[], ...path: string[]): AnnualSheetRow {
  const id = canonicalSheetId(...(path[0] === 'terminalEstate' ? path : ['value', ...path]))
  const search = (items: AnnualSheetRow[]): AnnualSheetRow | undefined => {
    for (const row of items) {
      if (row.id === id) return row
      const child = search(row.children ?? [])
      if (child) return child
    }
  }
  const row = search(rows)
  if (!row) throw new Error(`Missing sheet row ${path.join('/')}`)
  return row
}

function assertLocalized(reason: Parameters<typeof annualSheetText>[0]) {
  const labels = ['en', 'fr', 'zh'].map(locale => annualSheetText(reason, locale))
  expect(new Set(labels).size).toBe(3)
  expect(labels[0]).toMatch(/estate|terminal/i)
  expect(labels[1]).toMatch(/success|final/i)
  expect(labels[2]).toMatch(/遗产|终年/)
}

describe('independent Ontario solo terminal estate', () => {
  it('adds only the closing RRSP to the final return and reconciles both CPI clocks', () => {
    const { plan, certification, evidence } = fixture()
    const original = structuredClone(plan)
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    const baseline = ok(projectCanonicalCoverage(withoutEstate(plan), evidence, 3))
    expect(coverage).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false })
    expect(coverage.rows.map(row => row.year)).toEqual([2026, 2027, 2028])
    expect(coverage.rows.slice(0, 2)).toEqual(baseline.rows.slice(0, 2))

    const [working, firstRetirement, terminal] = coverage.rows
    expect(working.workingSettlement).toBeDefined()
    const annualTax = ordinaryTax(30_000)
    for (const [index, row] of [firstRetirement, terminal].entries()) {
      const start = 1.04 ** (index + 1)
      expect(row.byAccount[RRSP].withdrawal).toBeCloseTo(30_000 * start, 2)
      expect(row.byAccount[TFSA].withdrawal).toBe(0)
      expect(row.taxLedger[RETIREE]).toMatchObject({ taxableIncome: money(30_000 * start), tax: money(annualTax * start) })
      expect(row.cashLedger).toMatchObject({ income: 0, benefits: 0, tax: money(annualTax * start),
        spending: money((30_000 - annualTax) * start), debtPayments: 0, unallocated: money(0) })
    }

    const startCpi = 1.04 ** 2
    const endCpi = 1.04 ** 3
    const closingRrsp = 42_000 * endCpi
    const closingTfsa = 38_000 * endCpi
    const closingNetWorth = closingRrsp + closingTfsa
    const incomeTaxIncrement = (ordinaryTax(30_000 + closingRrsp / startCpi) - annualTax) * startCpi
    // $89,989.12 nominal rounds up to $90,000, so 40 taxable $1,000 portions.
    const eat = 600
    const netEstate = closingNetWorth - incomeTaxIncrement - eat
    const { terminalEstateEstimate, ...ordinaryTerminal } = terminal
    expect(ordinaryTerminal).toEqual(baseline.rows[2])
    expect(coverage.state).toEqual(baseline.state)
    expect(terminal.byAccount[RRSP].closing).toBeCloseTo(closingRrsp, 2)
    expect(terminal.byAccount[TFSA].closing).toBeCloseTo(closingTfsa, 2)
    expect(sumNetWorth(coverage.state)).toBeCloseTo(closingNetWorth, 2)
    expect(terminalEstateEstimate).toMatchObject({ status: 'estimated',
      closingNetWorth: money(closingNetWorth), closingRegisteredFairMarketValue: money(closingRrsp),
      incrementalFinalReturnIncomeTax: money(incomeTaxIncrement), estateAdministrationTax: eat,
      estateAdministrationTaxBase: money(closingNetWorth), netEstate: money(netEstate),
      taxBasis: 'start-CPI-annual-return', startCpi: expect.closeTo(startCpi, 12), endCpi: expect.closeTo(endCpi, 12),
      evidence: certification, taxRules: terminal.retirementSettlement!.taxRules,
    })

    const sheet = canonicalAnnualSheet(coverage, context)
    const year = sheet.years.at(-1)!
    for (const [path, nominal] of [['netWorth', closingNetWorth], ['estate', netEstate]] as const) {
      const cell = findRow(sheet.rows, path).cells![terminalYear]
      expect(annualSheetDisplayValue(cell, year, 'nominal')).toBeCloseTo(nominal, 2)
      expect(annualSheetDisplayValue(cell, year, 'real')).toBeCloseTo(nominal / endCpi, 2)
    }
    const estate = findRow(sheet.rows, 'estate').cells!
    expect(estate[terminalYear]).toMatchObject({ status: 'estimated', timing: 'terminal', basis: 'nominal-CAD' })
    expect(estate[2027]).toMatchObject({ value: null, status: 'not-applicable' })
    assertLocalized(estate[2027].reason!)
    for (const [field, expected] of Object.entries({ closingNetWorth,
      closingRegisteredFairMarketValue: closingRrsp, estateAdministrationTaxBase: closingNetWorth,
      incrementalFinalReturnIncomeTax: incomeTaxIncrement, estateAdministrationTax: eat })) {
      const cells = findRow(sheet.rows, 'terminalEstate', field).cells!
      expect(cells[2027]).toMatchObject({ value: null, status: 'not-applicable' })
      expect(cells[terminalYear]).toMatchObject({ value: money(expected), timing: 'terminal', status: 'estimated' })
    }
    const explanation = sheet.resolveExplanation!(estate[terminalYear].explanationRefs![0])!
    expect(explanation).toMatchObject({ projectionYear: 2028, taxYear: 2026, rulePackage: 'CA-ON-tax-2026-legacy-v1',
      sources: expect.arrayContaining([
        expect.objectContaining({ field: 'annualTerminalEstateEvidence', granularity: 'input' }),
        expect.objectContaining({ field: 'terminalEstateEstimate.taxBasis' }),
        expect.objectContaining({ field: 'annualTerminalEstateEvidence.accounts', id: RRSP }),
        expect.objectContaining({ field: 'annualTerminalEstateEvidence.accounts', id: TFSA }),
        expect.objectContaining({ displayReference: 'https://www.ontario.ca/page/estate-administration-tax' }),
        expect.objectContaining({ displayReference: expect.stringMatching(/canada\.ca\/.*\/rrsp\.html$/) }),
        expect.objectContaining({ displayReference: expect.stringMatching(/canada\.ca\/.*\/tfsa\.html$/) }),
      ]),
    })
    assertLocalized(explanation.summary!)
    expect(explanation.formula).toHaveLength(3)
    expect(explanation.formula).toEqual(expect.arrayContaining([
      expect.objectContaining({ direction: 'add', value: money(closingNetWorth), basis: 'nominal-CAD' }),
      expect.objectContaining({ direction: 'subtract', value: money(incomeTaxIncrement), basis: 'nominal-CAD' }),
      expect.objectContaining({ direction: 'subtract', value: eat, basis: 'nominal-CAD' }),
    ]))
    const basis = findRow(sheet.rows, 'terminalEstate', 'estateAdministrationTaxBase').label
    for (const [locale, timing, certificate] of [
      ['en', /end of (?:the )?terminal year.*after annual posting/i, /subject to (?:the )?certificate/i],
      ['fr', /fin de l’année finale.*après.*écritures/i, /assujetti|soumi/i],
      ['zh', /终年.*(?:年底|年末|结束时).*入账.*后/, /须.*认证|受.*认证|需.*认证/],
    ] as const) {
      expect(annualSheetText(explanation.summary!, locale)).toMatch(timing)
      expect(annualSheetText(basis, locale)).toMatch(certificate)
    }
    for (const source of explanation.sources!.filter(source => source.field?.startsWith('annualTerminalEstateEvidence') || source.displayReference)) {
      expect(new Set(['en', 'fr', 'zh'].map(locale => annualSheetText(source.label, locale))).size).toBe(3)
    }
    expect(plan).toEqual(original)
  })

  it('reprices both age credits at age 65 and retains a committed terminal estimate before a later stop', () => {
    // Independent age-65 vector from CRA T4032 Ontario and the EAT schedule.
    // Real taxable income is $30,000 annually and $74,000 on the final return.
    // Federal age amount: $9,208 less 15% of income above $46,432.
    // Ontario age amount: $6,342 less 15% of income above $47,210.
    const { plan, evidence } = age65Fixture()
    const settled = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(settled.blocked).toBeNull()
    const terminal = settled.rows[1]
    expect(terminal.byPerson[RETIREE]).toMatchObject({ age: 65, taxableIncome: money(33_000), tax: money(1_591.02295) })
    expect(terminal.byAccount[RRSP]).toMatchObject({ closing: money(48_400), withdrawal: money(33_000) })
    expect(terminal.byAccount[TFSA]).toMatchObject({ closing: money(24_200), withdrawal: 0 })
    expect(terminal.terminalEstateEstimate).toMatchObject({ status: 'estimated', closingNetWorth: money(72_600),
      closingRegisteredFairMarketValue: money(48_400), incrementalFinalReturnIncomeTax: money(12_588.769875),
      estateAdministrationTaxBase: money(72_600), estateAdministrationTax: 345, netEstate: money(59_666.230125),
    })
    const later = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(later).toMatchObject({ rows: settled.rows, state: settled.state, blocked: { year: 2028 }, uncomputedYears: [2029] })
    const sheet = canonicalAnnualSheet(later, context)
    const cells = findRow(sheet.rows, 'estate').cells!
    expect(cells[2027]).toMatchObject({ status: 'estimated', value: money(59_666.230125) })
    expect(annualSheetDisplayValue(cells[2027], sheet.years[1], 'real')).toBeCloseTo(59_666.230125 / 1.21, 2)
    expect(cells[2028]).toMatchObject({ status: 'not-computed', value: null })
    expect(cells[2029]).toMatchObject({ status: 'not-computed', value: null })
  })

  it('uses a verified zero OAS receipt and ignores known historical income that already ended', () => {
    const { plan, evidence } = age65Fixture()
    const baseline = ok(projectCanonicalCoverage(plan, evidence, 2))
    plan.annualBenefitsEvidence = { [RETIREE]: benefitExclusions() }
    const withExclusions = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(withExclusions.rows[1].retirementSettlement?.oas).toMatchObject({
      grossReal: 0, netReal: 0, recoveryReal: 0, evidence: benefitExclusions(),
    })
    expect(withExclusions.rows[1].terminalEstateEstimate).toEqual(baseline.rows[1].terminalEstateEstimate)
    const ended = { id: 'ended-other-income', kind: 'other' as const, annualAmount: known(3_000),
      recipientId: RETIREE, fromAge: 60, toAge: 63, provenance: recorded }
    plan.incomeSources.push(ended)
    const withHistory = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(withHistory).toEqual(withExclusions)
    const { terminalEstateEstimate, ...ordinaryTerminal } = withHistory.rows[1]
    expect(terminalEstateEstimate).toMatchObject({ status: 'estimated', netEstate: money(59_666.230125) })
    expect({ ...withHistory, rows: [withHistory.rows[0], ordinaryTerminal] }).toEqual(ok(projectCanonicalCoverage(withoutEstate(plan), evidence, 2)))

    plan.incomeSources[0] = { ...ended, provenance: { ...recorded, origin: 'estimated' } }
    const unverified = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(unverified.blocked).toBeNull()
    expect(unverified.rows[1].terminalEstateEstimate).toEqual({ status: 'unavailable', reason: 'unsupported-estate' })

    plan.incomeSources[0] = { ...ended, fromAge: 65, toAge: 65 }
    const active = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(active).toMatchObject({ rows: withExclusions.rows.slice(0, 1), blocked: { year: 2027, status: 'unsupported' } })
  })

  it.each(['OAS', 'CPP', 'GIS'] as const)('keeps positive %s in the annual row and leaves the estate unavailable', benefit => {
    const { plan, evidence } = age65Fixture()
    const exclusions = benefitExclusions()
    plan.annualBenefitsEvidence = { [RETIREE]: exclusions }
    if (benefit === 'CPP') {
      plan.people[0].cppAnnualAt65 = 4_800
      plan.incomeSources.push(cppStart(RETIREE, 65, 4_800))
    } else {
      plan.people[0].oasAnnualAt65 = 9_150
      plan.incomeSources.push({ id: 'explicit-oas', kind: 'oas', recipientId: RETIREE, startAge: 65,
        annualAmount: known(9_150), provenance: recorded })
    }
    if (benefit === 'GIS') {
      exclusions.gis = { ...exclusions.gis, status: 'annual-estimate' }
      plan.annualGisEvidence = { [RETIREE]: { 2027: { eligible: true, residentInCanada: true,
        notSponsored: true, fullOasInPay: true, provenance: recorded } } }
      plan.people[0].provenance.earnedIncome = recorded
    }
    const baseline = ok(projectCanonicalCoverage(withoutEstate(plan), evidence, 2))
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(coverage.blocked).toBeNull()
    const { terminalEstateEstimate, ...ordinaryTerminal } = coverage.rows[1]
    const person = ordinaryTerminal.byPerson[RETIREE]
    expect(benefit === 'OAS' ? person.oasGross : benefit === 'CPP' ? person.cpp : person.gis).toBeGreaterThan(0)
    expect(terminalEstateEstimate).toEqual({ status: 'unavailable', reason: 'unsupported-estate' })
    expect({ ...coverage, rows: [coverage.rows[0], ordinaryTerminal] }).toEqual(baseline)
  })

  it.each([true, 1, 'accounts', [], null, undefined, new Map(), new Date(0)])(
    'rejects malformed account map %j and accepts an explicit empty record for a zero estate', (accounts: unknown) => {
      const { plan, certification, evidence } = fixture({ rrsp: 0, tfsa: 0, grossDraw: 0 })
      plan.accounts = []
      certification.accounts = {}
      const empty = ok(projectCanonicalCoverage(plan, evidence, 3))
      expect(empty.rows[2].terminalEstateEstimate).toMatchObject({ status: 'estimated', closingNetWorth: 0,
        estateAdministrationTaxBase: 0, estateAdministrationTax: 0, incrementalFinalReturnIncomeTax: 0, netEstate: 0,
      })
      certification.accounts = accounts as AnnualTerminalEstateEvidence['accounts']
      const malformed = ok(projectCanonicalCoverage(plan, evidence, 3))
      const baseline = ok(projectCanonicalCoverage(withoutEstate(plan), evidence, 3))
      const { terminalEstateEstimate, ...ordinaryTerminal } = malformed.rows[2]
      expect(terminalEstateEstimate).toEqual({ status: 'unavailable', reason: 'evidence-invalid' })
      expect({ ...malformed, rows: [...malformed.rows.slice(0, 2), ordinaryTerminal] }).toEqual(baseline)
    },
  )

  // Ontario Estate Administration Tax: $0 through $50,000, then $15 for
  // each $1,000 or part thereof. See ontario.ca/page/estate-administration-tax.
  it.each([[50_000, 0], [50_000.01, 15], [51_000, 15], [51_000.01, 30]])(
    'uses the statutory nominal boundary for $%s of certified closing assets', (gross, fee) => {
      // 25% inflation for three years moves an exactly representable $25,600
      // (or $26,112) real estate to the nominal statutory threshold. Varying
      // only TFSA leaves final-return income tax constant.
      const { plan, evidence } = fixture({ rrsp: 10_240, tfsa: (gross - 20_000) / 1.25 ** 3,
        inflation: 0.25, grossDraw: 0 })
      const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
      expect(coverage.blocked).toBeNull()
      const terminal = coverage.rows[2]
      const tax = ordinaryTax(12_800) * 1.25 ** 2
      expect(terminal.cashLedger.tax).toBe(0)
      expect(terminal.terminalEstateEstimate).toMatchObject({ status: 'estimated',
        closingRegisteredFairMarketValue: 20_000, estateAdministrationTaxBase: money(gross),
        incrementalFinalReturnIncomeTax: money(tax), estateAdministrationTax: fee, netEstate: money(gross - fee - tax),
      })
    },
  )

  it('preserves a genuine cent above a large statutory threshold', () => {
    const { plan, evidence } = fixture({ rrsp: 0, tfsa: 50_000_000_000_000.01, inflation: 0, grossDraw: 0 })
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(coverage.blocked).toBeNull()
    // 49,999,999,950 whole $1,000 portions plus one partial portion.
    expect(coverage.rows[2].terminalEstateEstimate).toMatchObject({ status: 'estimated',
      incrementalFinalReturnIncomeTax: 0, estateAdministrationTax: 749_999_999_265,
    })
  })

  it.each([[0.03, 50_000, 0], [0.04, 51_000, 15]])(
    'preserves the nominal boundary at inflation %s and gross estate $%s despite floating-point residue', (inflation, gross, fee) => {
      const rrsp = 10_000
      const { plan, evidence } = fixture({ rrsp, tfsa: gross / (1 + inflation) ** 3 - rrsp, inflation, grossDraw: 0 })
      const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
      expect(coverage.blocked).toBeNull()
      expect(coverage.rows[2].terminalEstateEstimate).toMatchObject({ status: 'estimated',
        estateAdministrationTaxBase: money(gross), estateAdministrationTax: fee,
      })
    },
  )

  it.each<[string, (certification: AnnualTerminalEstateEvidence) => unknown]>([
    ['missing terminal-year certification', () => undefined],
    ['null certification', () => null],
    ['incomplete estate', cert => ({ ...cert, completeEstate: false })],
    ['certificate requirement denied', cert => ({ ...cert, certificateRequired: false })],
    ['unconfirmed absence of death benefits', ({ noDeathBenefitsOrOtherTerminalIncome: _exclusion, ...cert }) => cert],
    ['potential death benefits', cert => ({ ...cert, noDeathBenefitsOrOtherTerminalIncome: false })],
    ['wrong person', cert => ({ ...cert, personId: 'another-person' })],
    ['wrong effective year', cert => ({ ...cert, effectiveYear: terminalYear - 1 })],
    ['wrong timing', cert => ({ ...cert, timing: 'start-of-terminal-year' })],
    ['unverified provenance', cert => ({ ...cert, provenance: { origin: 'estimated', sourceYear: BASE_YEAR } })],
    ['malformed provenance', cert => ({ ...cert, provenance: { origin: 'user', sourceYear: String(BASE_YEAR) } })],
    ['inherited provenance', ({ provenance, ...cert }) => Object.assign(Object.create({ provenance }), cert)],
    ['future-dated provenance', cert => ({ ...cert, provenance: { origin: 'user', sourceYear: BASE_YEAR + 1 } })],
    ['missing TFSA', cert => ({ ...cert, accounts: { [RRSP]: cert.accounts[RRSP] } })],
    ['inherited TFSA', cert => ({ ...cert, accounts: Object.assign(Object.create({ [TFSA]: cert.accounts[TFSA] }), { [RRSP]: cert.accounts[RRSP] }) })],
    ['extra account', cert => ({ ...cert, accounts: { ...cert.accounts, other: cert.accounts[RRSP] } })],
    ['excluded RRSP', cert => ({ ...cert, accounts: { ...cert.accounts, [RRSP]: { ...cert.accounts[RRSP], estateIncluded: false } } })],
    ['RRSP rollover', cert => ({ ...cert, accounts: { ...cert.accounts, [RRSP]: { ...cert.accounts[RRSP], noBeneficiaryRollover: false } } })],
    ['wrong TFSA owner', cert => ({ ...cert, accounts: { ...cert.accounts, [TFSA]: { ...cert.accounts[TFSA], ownerId: 'another-person' } } })],
    ['unconfirmed TFSA tax treatment', cert => ({ ...cert, accounts: { ...cert.accounts, [TFSA]: { ...cert.accounts[TFSA], tfsaNoDeathIncome: false } } })],
  ])('keeps annual coverage and localizes estate unavailability with %s', (_, alter) => {
    const { plan, certification, evidence } = fixture()
    const next = alter(certification)
    plan.annualTerminalEstateEvidence = next === undefined ? {} : { [terminalYear]: next as AnnualTerminalEstateEvidence }
    const before = structuredClone(plan)
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    const baseline = ok(projectCanonicalCoverage(withoutEstate(plan), evidence, 3))
    const { terminalEstateEstimate, ...ordinaryTerminal } = coverage.rows[2]
    expect(terminalEstateEstimate).toEqual({ status: 'unavailable', reason: next === undefined ? 'evidence-missing' : 'evidence-invalid' })
    expect({ ...coverage, rows: [...coverage.rows.slice(0, 2), ordinaryTerminal] }).toEqual(baseline)
    const sheet = canonicalAnnualSheet(coverage, context)
    const cell = findRow(sheet.rows, 'estate').cells![terminalYear]
    expect(cell).toMatchObject({ value: null, status: 'unknown' })
    expect(annualSheetDisplayValue(cell, sheet.years[2], 'nominal')).toBeNull()
    assertLocalized(cell.reason!)
    const explanation = sheet.resolveExplanation!(cell.explanationRefs![0])!
    expect(explanation.sources).toEqual(expect.arrayContaining([expect.objectContaining({ code: terminalEstateEstimate?.status === 'unavailable' ? terminalEstateEstimate.reason : undefined })]))
    expect(plan).toEqual(before)
  })

  it('keeps a preterminal prefix and the same prefix when the terminal year is blocked', () => {
    const { plan, evidence } = fixture()
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows.map(row => row.year)).toEqual([2026, 2027])
    expect(prefix.rows.every(row => !row.terminalEstateEstimate)).toBe(true)
    const preterminal = canonicalAnnualSheet(prefix, context)
    const cell = findRow(preterminal.rows, 'estate').cells![2027]
    expect(cell).toMatchObject({ value: null, status: 'not-applicable' })
    assertLocalized(cell.reason!)

    plan.incomeSources.push({ id: 'unmodeled-income', kind: 'other', recipientId: RETIREE,
      annualAmount: known(100), fromAge: 59, provenance: recorded })
    const blocked = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(blocked).toMatchObject({ rows: prefix.rows, state: prefix.state, blocked: { year: terminalYear } })
    const sheet = canonicalAnnualSheet(blocked, context)
    expect(findRow(sheet.rows, 'estate').cells![terminalYear]).toMatchObject({ value: null, status: 'not-computed' })
    expect(findRow(sheet.rows, 'netWorth').cells![2027].value).toBeGreaterThan(0)
  })

  it('keeps the working terminal year without pricing a retirement estate', () => {
    const { plan, evidence } = fixture()
    plan.people[0].retirementAge = 60
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    const baseline = ok(projectCanonicalCoverage(withoutEstate(plan), evidence, 3))
    const last = coverage.rows[2]
    expect(coverage.blocked).toBeNull()
    expect(last.workingSettlement).toBeDefined()
    const { terminalEstateEstimate, ...ordinaryTerminal } = last
    if (terminalEstateEstimate) expect(terminalEstateEstimate.status).toBe('unavailable')
    expect(ordinaryTerminal).toEqual(baseline.rows[2])
    const sheet = canonicalAnnualSheet(coverage, context)
    expect(findRow(sheet.rows, 'estate').cells![terminalYear].value).toBeNull()
  })

  it('keeps the age-71 rollover in the ordinary ledger and refuses an ordinary RRSP estate', () => {
    const { plan, evidence } = fixture({ inflation: 0, grossDraw: 0 })
    plan.people[0].ageInBaseYear = 69
    plan.people[0].retirementAge = 70
    plan.lifeExpectancy = 71
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    const baseline = ok(projectCanonicalCoverage(withoutEstate(plan), evidence, 3))
    const { terminalEstateEstimate, ...ordinaryTerminal } = coverage.rows[2]
    expect(coverage).toMatchObject({ blocked: null, state: baseline.state })
    expect(ordinaryTerminal.retirementSettlement?.rrif?.conversion).toMatchObject({ year: terminalYear })
    expect(ordinaryTerminal).toEqual(baseline.rows[2])
    expect(terminalEstateEstimate).toEqual({ status: 'unavailable', reason: 'unsupported-estate' })
  })

  it('keeps the canonical no-opt-in terminal placeholder and annual row shape', () => {
    const { plan, evidence } = fixture()
    const coverage = ok(projectCanonicalCoverage(withoutEstate(plan), evidence, 3))
    expect(coverage.rows.every(row => !Object.hasOwn(row, 'terminalEstateEstimate'))).toBe(true)
    const sheet = canonicalAnnualSheet(coverage, context)
    const cell = findRow(sheet.rows, 'estate').cells![terminalYear]
    expect(cell).toMatchObject({ status: 'unknown', value: null })
    const explanation = sheet.resolveExplanation!(cell.explanationRefs![0])!
    expect(explanation.sources?.some(source => source.field === 'annualTerminalEstateEvidence')).toBe(false)
  })

  it('keeps provider, standalone retirement and the App projection and annual sheet on their existing paths', () => {
    const { plan } = fixture()
    const baseline = withoutEstate(plan)
    const inputs = plan.legacyProjection
    const appProjection = runProjection(inputs, undefined, plan, { captureAnnualDetails: true })
    const appBaseline = runProjection(inputs, undefined, baseline, { captureAnnualDetails: true })
    expect(appProjection).toEqual(appBaseline)
    expect(legacyAnnualSheet(appProjection, inputs, context).rows).toEqual(legacyAnnualSheet(appBaseline, inputs, context).rows)
    expect(runProjection(inputs, () => -0.10, plan)).toEqual(runProjection(inputs, () => -0.10, baseline))

    const standalone: InputsV2 = { ...plan, people: [{ ...plan.people[0], retirementAge: 55 }],
      budget: { kind: 'savingsBudget', annualNetSavings: 0, retirementSpending: inputs.retirementSpending,
        debtIncluded: known(true), taxBenefitIncluded: known(true) } }
    const standaloneBaseline = withoutEstate(standalone)
    const provider = {
      evaluate: () => ({ byPerson: { [RETIREE]: { income: 0, earnedIncome: 0, benefits: 0, tax: 0,
        spending: 0, taxableIncome: 0, benefitIncomeForNextYear: known(0) } } }),
      returns: () => 0,
    }
    const providerPlan = { ...standalone, people: [{ ...plan.people[0], retirementAge: 60 }] }
    const providerOpening = ok(initializeState(providerPlan))
    const opening = ok(initializeState(standalone))
    const providerRows = ok(projectAnnualCoverage(providerPlan, providerOpening, 3, provider))
    const standaloneRows = ok(projectRetirementCoverage(standalone, opening, 3))
    for (const result of [providerRows, standaloneRows]) {
      expect(result).toMatchObject({ blocked: null, overallConclusionAvailable: false })
      expect(result.rows).toHaveLength(3)
      expect(result.rows.every(row => !Object.hasOwn(row, 'terminalEstateEstimate'))).toBe(true)
    }
    expect(providerRows).toEqual(ok(projectAnnualCoverage(withoutEstate(providerPlan), providerOpening, 3, provider)))
    expect(standaloneRows).toEqual(ok(projectRetirementCoverage(standaloneBaseline, opening, 3)))
  })
})
