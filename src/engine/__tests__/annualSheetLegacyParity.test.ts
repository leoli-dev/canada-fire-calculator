import { describe, expect, it } from 'vitest'
import { annualSheetCellStatus, annualSheetDisplayValue, annualSheetText } from '../../annualSheet'
import type { AnnualSheetRow } from '../../annualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { refreshCanonicalFromLegacy } from '../migration'
import { runProjection } from '../projection'
import { validateInputs } from '../validate'
import type { AccountType, Inputs, ProjectionResult } from '../types'
import households from './fixtures/households.json'
import audit from './fixtures/pending-audit.json'
import propertySales from './fixtures/property-sales.json'
import { annualSheetUnderwaterSale } from './fixtures/annualSheetUnderwaterSale'

const cash = households.households[1].inputs as Inputs
const purchase = audit.cases.find((entry) => entry.id === 'P03')!.inputs as Inputs
const sale = propertySales.cases[0].inputs as Inputs
const plannedHome = purchase.principalResidence
if (plannedHome?.mode !== 'planned') throw new Error('P03 requires a planned home purchase')

const cases = {
  'cash through retirement': cash,
  'couple benefits and taxable withdrawals under inflation': {
    ...cash,
    currentAge: 64,
    fireAge: 65,
    lifeExpectancy: 67,
    inflation: 0.03,
    annualSavings: 15_000,
    savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 },
    balances: { tfsa: 5_000, rrsp: 280_000, nonReg: 65_000 },
    nonRegBook: 58_000,
    nonRegDistributionYield: 0.03,
    returns: { tfsa: 0.04, rrsp: 0.04, nonReg: 0.04 },
    strategy: 'rrspFirst',
    retirementSpending: 84_000,
    cppAnnualAt65: 10_000,
    oasAnnualAt65: 8_700,
    partner: { currentAge: 63, cppStartAge: 65, cppAnnualAt65: 6_000, oasStartAge: 65, oasAnnualAt65: 8_700 },
  },
  'RRSP-funded purchase and later installments': {
    ...purchase,
    lifeExpectancy: 52,
    annualSavings: 0,
    extraIncome: null,
    balances: { tfsa: 100_000, rrsp: 250_000, nonReg: 0 },
    principalResidence: { ...plannedHome, hbp: false },
  },
  'sale discharging a linked mortgage': sale,
  'failed purchase then depleted living budget': {
    ...purchase,
    lifeExpectancy: 52,
    annualSavings: 0,
    extraIncome: null,
    retirementSpending: 10_000,
    balances: { tfsa: 0, rrsp: 0, nonReg: 0 },
  },
} satisfies Record<string, Inputs>

// Canonicalize key order while preserving the exact values and field presence
// of each legacy row and the result summary. One digest per year localizes
// changes without checking in repeated tax metadata or many decimal strings.
async function digest(value: unknown): Promise<string> {
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (item === undefined) return { $undefined: true }
    if (typeof item === 'number' && !Number.isFinite(item)) return { $number: String(item) }
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  })
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function legacyFingerprints(result: ProjectionResult) {
  const { rows, ...summary } = result
  return {
    summary: await digest(summary),
    years: await Promise.all(rows.map(async (row) => ({ age: row.age, digest: await digest(row) }))),
  }
}

describe('FE-53 legacy projection parity', () => {
  // Captured from a git archive of merged S0, 648077ad90521c2b859e8758dd71c368333c295a.
  // To reproduce, run the fingerprint assertion with ordinary runProjection
  // on that revision, omitting the S1 adapter imports and telemetry assertions.
  it.each(Object.entries(cases))('%s retains the S0 projection output', async (_name, inputs) => {
    const ordinary = runProjection(inputs)
    expect(await legacyFingerprints(ordinary)).toMatchSnapshot()
    expect(ordinary.rows.every(row => !Object.hasOwn(row, 'annualDetails'))).toBe(true)
    const observed = runProjection(inputs, undefined, undefined, { captureAnnualDetails: true })
    expect(observed.rows.every(row => row.annualDetails)).toBe(true)
    const rows = observed.rows.map(({ annualDetails: _details, ...row }) => row)
    expect({ ...observed, rows }).toStrictEqual(ordinary)
  })

  it('covers zero tax across both phases and the hand-calculated cash fixture', () => {
    const result = runProjection(cash)
    expect(result.rows.map((row) => row.phase)).toEqual(['accumulation', 'accumulation', 'bridge'])
    expect(result.rows.map((row) => row.tax)).toEqual([0, 0, 0])
    expect(result.rows.map((row) => row.balances)).toEqual(households.households[1].expected.rowBalances)
  })

  it('covers a working-year taxable purchase and a taxed retirement installment', () => {
    const [working, retired] = runProjection(cases['RRSP-funded purchase and later installments']).rows
    expect(working.purchaseFunding?.withdrawalTax).toBeGreaterThan(0)
    expect(working.purchaseFunding?.price).toBe(500_000)
    expect(working.debtBalance).toBeCloseTo(360_000, 2)
    expect(retired.withdrawals.rrsp).toBeGreaterThan(40_000)
    expect(retired.taxBySource.rrsp).toBeGreaterThan(0)
    expect(retired.debtPayment).toBeCloseTo(40_000, 2)
  })

  it('covers staggered CPP/OAS start ages and positive retirement tax', () => {
    const [, first, second] = runProjection(cases['couple benefits and taxable withdrawals under inflation']).rows
    expect(first.cpp).toBe(10_000)
    expect(second.cpp).toBe(16_000)
    expect(second.oas).toBeGreaterThan(first.oas)
    expect(first.tax).toBeGreaterThan(0)
    expect(second.tax).toBeGreaterThan(0)
  })

  it('keeps an event-only gap separate from a later living-only shortfall', () => {
    const result = runProjection(cases['failed purchase then depleted living budget'])
    const [working, retired] = result.rows
    expect(working.unfundedObligations).toEqual([
      expect.objectContaining({ eventId: 'purchase:50', amount: 100_000 }),
    ])
    expect(working.shortfall).toBe(0)
    expect(retired.shortfall).toBe(10_000)
    expect(retired.unfundedObligations).toEqual([])
  })
})

function observe(inputs: Inputs, canonical?: Parameters<typeof runProjection>[2]) {
  const result = runProjection(inputs, undefined, canonical, { captureAnnualDetails: true })
  const sheet = legacyAnnualSheet(result, inputs, { scenarioId: 'current', revision: 19 })
  const flatten = (rows: AnnualSheetRow[]): AnnualSheetRow[] =>
    rows.flatMap(row => [row, ...flatten(row.children ?? [])])
  const lookup = flatten(sheet.rows)
  const row = (id: string) => {
    const found = lookup.find(candidate => candidate.id === id)
    if (!found) throw new Error(`Missing sheet row ${id}`)
    return found
  }
  return { result, sheet, row }
}

describe('FE-53 household annual telemetry', () => {
  it('uses the canonical calendar and preserves the return sampler call sequence', () => {
    const input = cases['couple benefits and taxable withdrawals under inflation']
    const canonical = { ...refreshCanonicalFromLegacy(null, input), baseYear: 2031 }
    const sampleCalls: [number, AccountType][] = []
    const sample = (age: number, account: AccountType) => {
      sampleCalls.push([age, account])
      return (account === 'tfsa' ? 0.02 : 0.05) + sampleCalls.length / 1000
    }
    const ordinary = runProjection(input, sample, canonical)
    const expectedCalls = sampleCalls.splice(0)
    const observed = runProjection(input, sample, canonical, { captureAnnualDetails: true })
    expect(sampleCalls).toEqual(expectedCalls)
    expect(observed.rows.map(row => row.annualDetails!.year)).toEqual([2031, 2032, 2033, 2034])
    expect({ ...observed, rows: observed.rows.map(({ annualDetails: _details, ...row }) => row) }).toStrictEqual(ordinary)
  })

  it.each(Object.entries(cases))('%s reconciles each position across recorded changes', (_name, inputs) => {
    const { result, sheet, row } = observe(inputs)
    expect(sheet).toMatchObject({ scenarioId: 'current', revision: 19 })
    result.rows.forEach((legacy, index) => {
      const detail = legacy.annualDetails!
      const year = sheet.years[index]
      expect(year.year).toBe(sheet.baseYear + index)
      const close = { ...legacy.balances, fhsa: legacy.fhsaBalance, locked: legacy.lockedRetirementBalance, property: legacy.propertyValue }
      const factor = (1 + (inputs.inflation ?? 0.021)) ** index
      const openingFactor = (1 + (inputs.inflation ?? 0.021)) ** Math.max(index - 1, 0)
      for (const [position, balance] of Object.entries(close)) {
        const group = row(position)
        const opening = row(`${position}.opening`).cells![year.year]
        const closing = row(`${position}.closing`).cells![year.year]
        const changes = detail.changes.reduce((sum, entry) => sum + entry.amounts[position], 0)
        expect(detail.opening[position] + changes, `${position} ${year.year} real`).toBeCloseTo(balance, 7)
        const nominalChanges = group.children!
          .filter(entry => entry.id !== `${position}.opening` && entry.id !== `${position}.closing`)
          .reduce((sum, entry) => sum + (entry.cells![year.year].value ?? 0), 0)
        expect(opening.value! + nominalChanges, `${position} ${year.year} nominal`).toBeCloseTo(balance * factor, 7)
        expect(annualSheetDisplayValue(closing, year, 'real')).toBeCloseTo(balance, 7)
        expect(annualSheetDisplayValue(opening, year, 'real')).toBeCloseTo(detail.opening[position], 7)
        expect(annualSheetDisplayValue(opening, year, 'nominal')).toBeCloseTo(detail.opening[position] * openingFactor, 7)
        if (index > 0) expect(opening.value).toBeCloseTo(row(`${position}.closing`).cells![year.year - 1].value!, 7)
      }
    })
  })

  it('pins contribution, direct tax, growth and unconverted tax basis to their recording points', () => {
    const inputs = cases['couple benefits and taxable withdrawals under inflation']
    const { result, sheet, row } = observe(inputs)
    const working = result.rows[0].annualDetails!
    const change = (label: string) => {
      const found = working.changes.find(entry => entry.label === label)
      if (!found) throw new Error(`Missing recording point ${label}`)
      return found.amounts
    }
    const grossDistribution = 65_000 * 0.03
    const distributionTax = grossDistribution * 0.35
    expect(change('Savings contributions including employer contributions').nonReg).toBe(15_000)
    expect(change('Distribution tax deducted from account').nonReg).toBeCloseTo(-distributionTax, 7)
    const growth = change('Investment return net of fees')
    expect(growth.tfsa).toBeCloseTo(5_000 * 0.04, 7)
    expect(growth.rrsp).toBeCloseTo(280_000 * 0.04, 7)
    expect(growth.nonReg).toBeCloseTo((65_000 + 15_000 - distributionTax) * 0.04, 7)
    expect(working.nonRegAcbNominal).toBeCloseTo(58_000 + 15_000 + grossDistribution - distributionTax, 7)

    const later = result.rows[2]
    const year = sheet.years[2]
    const acb = row('acb').cells![year.year]
    expect(acb.basis).toBe('nominal-tax-basis')
    expect(acb.value).toBeCloseTo(later.nonRegBook! * 1.03 ** 2, 7)
    expect(annualSheetDisplayValue(acb, year, 'nominal')).toBe(acb.value)
    expect(annualSheetDisplayValue(acb, year, 'real')).toBe(acb.value)
    expect(acb.value).toBeGreaterThan(later.nonRegBook!)
  })

  it('distinguishes known zero, unavailable facts, and years outside the projection', () => {
    const { sheet, row } = observe(cash)
    const [year] = sheet.years
    const status = (id: string) => annualSheetCellStatus(row(id).cells?.[year.year], year, 'real')
    expect(status('salary')).toBe('unknown')
    expect(status('partnerAge')).toBe('not-applicable')
    expect(status('netCash')).toBe('unknown')
    expect(status('target')).toBe('unknown')
    expect(status('savings')).toBe('estimated')
    expect(status('cpp')).toBe('estimated')
    expect(row('cpp').cells![year.year].value).toBe(0)
    expect(annualSheetCellStatus(row('savings').cells![year.year - 1], undefined, 'real')).toBe('not-computed')
    expect(annualSheetCellStatus(row('estateTax').cells![sheet.years.at(-1)!.year + 1], undefined, 'real')).toBe('not-computed')
  })

  it('distinguishes working benefit inputs from priced cash and marks estate timing', () => {
    const { sheet, row } = observe({
      ...cash, currentAge: 60, fireAge: 61, lifeExpectancy: 62,
      children: [{ age: 4 }],
      partner: { currentAge: 65, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 8_700 },
    })
    const [working] = sheet.years
    const cell = (id: string) => row(id).cells![working.year]
    expect(cell('age')).toMatchObject({ value: 60, status: 'calculated' })
    expect(cell('partnerAge')).toMatchObject({ value: 65, status: 'calculated' })
    expect(cell('cpp').value).toBe(0)
    expect(cell('oasGross').value).toBe(8_700)
    expect(cell('oas')).toMatchObject({ status: 'not-applicable', value: null })
    expect(cell('gis')).toMatchObject({ status: 'unknown', value: null })
    expect(cell('ccb')).toMatchObject({ status: 'unknown', value: null })
    expect(annualSheetDisplayValue(cell('gis'), working, 'real')).toBeNull()
    expect(annualSheetDisplayValue(cell('ccb'), working, 'real')).toBeNull()
    const ccbExplanation = sheet.resolveExplanation?.(cell('ccb').explanationRefs![0])
    expect(annualSheetText(ccbExplanation!.summary!, 'en')).toMatch(/(?:folded into|included in|reflected in).*net savings/i)
    expect(cell('estateTax')).toMatchObject({ value: null, status: 'not-applicable' })
    expect(cell('estateValue')).toMatchObject({ value: null, status: 'not-applicable' })
  })

  it('funds a 24,000 retirement target with 10,000 CPP and 14,000 TFSA', () => {
    const { result, sheet, row } = observe({
      ...cash, currentAge: 65, fireAge: 65, lifeExpectancy: 66,
      annualSavings: 0, retirementSpending: 24_000, cppAnnualAt65: 10_000,
      balances: { tfsa: 40_000, rrsp: 0, nonReg: 0 },
    })
    const [year] = sheet.years
    const cell = (id: string) => row(id).cells![year.year]
    expect(cell('cpp').value).toBe(10_000)
    expect(cell('withdrawals.tfsa').value).toBeCloseTo(14_000, 2)
    expect(cell('tax').value).toBe(0)
    expect(cell('netCash').value).toBeCloseTo(24_000, 2)
    expect(cell('target').value).toBe(24_000)
    expect(cell('shortfall').value).toBe(0)
    const cashExplanation = sheet.resolveExplanation?.(cell('netCash').explanationRefs![0])
    expect(cashExplanation).toMatchObject({
      rulePackage: result.taxRules!.rulePackId,
      taxYear: result.taxRules!.ruleYear,
    })
    const parts = cashExplanation!.formula!
    const positive = parts.filter(part => part.direction === 'add' && part.value > 0).map(part => part.value).sort((a, b) => a - b)
    expect(positive).toHaveLength(2)
    expect(positive[0]).toBe(10_000)
    expect(positive[1]).toBeCloseTo(14_000, 2)
    const reconciled = parts.reduce((sum, part) => sum + (part.direction === 'add' ? part.value : -part.value), 0)
    expect(reconciled).toBeCloseTo(24_000, 2)
    const targetExplanation = sheet.resolveExplanation?.(cell('target').explanationRefs![0])
    expect(targetExplanation?.formula).toContainEqual(expect.objectContaining({ value: 24_000, direction: 'add' }))
  })

  it('cites the 2033 working marginal approximation and the 2026 pack used in 2035 retirement', () => {
    const { result, sheet, row } = observe({
      ...cash, currentAge: 60, fireAge: 69, lifeExpectancy: 70, annualSavings: 0,
      retirementSpending: 50_000, children: [{ age: 4 }],
      balances: { tfsa: 0, rrsp: 200_000, nonReg: 80_000 }, nonRegBook: 0,
      nonRegDistributionYield: 0.10, accumulationMarginalRate: 0.25, strategy: 'rrspFirst',
    })
    const explanation = (id: string, year: number) =>
      sheet.resolveExplanation?.(row(id).cells![year].explanationRefs![0])!
    expect(row('tax').cells![2033].value).toBeCloseTo(80_000 * 0.975 ** 7 * 0.025, 2)
    const workingTax = explanation('tax', 2033)
    expect(workingTax.projectionYear).toBe(2033)
    expect(workingTax.rulePackage).toBeUndefined()
    expect(workingTax.taxYear).toBeUndefined()
    expect(annualSheetText(workingTax.summary!, 'en')).toMatch(/marginal/i)
    expect(workingTax.sources?.map(source => source.id)).toContain('accumulationMarginalRate')

    const workingCcb = explanation('ccb', 2033)
    expect(row('ccb').cells![2033]).toMatchObject({ status: 'unknown', value: null })
    expect(workingCcb.rulePackage).toBeUndefined()
    expect(workingCcb.sources?.map(source => source.id)).not.toContain(result.benefitRules!.rulePackId)

    expect(result.taxRules!.ruleYear).toBe(2026)
    expect(row('tax').cells![2035].value).toBeGreaterThan(0)
    expect(explanation('tax', 2035)).toMatchObject({
      projectionYear: 2035, taxYear: 2026, rulePackage: result.taxRules!.rulePackId,
    })
    expect(explanation('ccb', 2035).rulePackage).toBe(result.benefitRules!.rulePackId)
  })

  it('keeps working-year tax limitations off a later person-priced retirement row', () => {
    const inputs: Inputs = {
      ...cash, currentAge: 60, fireAge: 66, lifeExpectancy: 67,
      annualSavings: 0, retirementSpending: 50_000, strategy: 'rrspFirst',
      balances: { tfsa: 0, rrsp: 300_000, nonReg: 40_000 },
      nonRegBook: 0, nonRegDistributionYield: 0.02,
    }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    const { result, sheet, row } = observe(inputs, canonical)
    expect(result.taxCapability?.reason).toMatch(/working-year tax/i)
    expect(result.rows[0].taxCapability).toBe('legacyEstimate')
    expect(result.rows[6].taxCapability).toBe('person')
    expect(result.rows[6].tax).toBeGreaterThan(0)
    const explainTax = (year: number) => sheet.resolveExplanation?.(row('tax').cells![year].explanationRefs![0])!
    const working = explainTax(sheet.baseYear)
    const retired = explainTax(sheet.baseYear + 6)
    expect(retired.rulePackage).toBe(result.taxRules?.rulePackId)
    expect(retired.limitations ?? []).toEqual([])
    const localized = (language: string) => working.limitations?.map(limit => annualSheetText(limit, language)).join(' ') ?? ''
    expect(localized('fr')).toMatch(/marginal/i)
    expect(localized('zh')).toMatch(/边际/)
    for (const language of ['en', 'fr', 'zh']) {
      expect(localized(language)).not.toContain(result.taxCapability!.reason!)
    }
  })

  it('limits an accepted underwater sale caveat to its year despite the legacy run flag', () => {
    const inputs = annualSheetUnderwaterSale
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    const { result, sheet, row } = observe(inputs, canonical)
    expect(validateInputs(inputs).filter(issue => issue.severity === 'error')).toEqual([])
    expect(result.taxCapability?.status).toBe('legacyEstimate')
    const saleYear = sheet.baseYear
    const eventId = 'sale:60:principalResidence.sellAtAge'
    expect(result.rows[0].annualDetails?.funding).toContainEqual(expect.objectContaining({
      eventId, field: 'principalResidence.sellAtAge',
    }))
    const funding = row(`funding.${eventId}.withdrawalTax`).cells![saleYear]
    const eventExplanation = sheet.resolveExplanation?.(funding.explanationRefs![0])
    expect(eventExplanation?.sources).toContainEqual(expect.objectContaining({
      id: eventId, granularity: 'event',
    }))
    const tax = (year: number) => sheet.resolveExplanation?.(row('tax').cells![year].explanationRefs![0])!
    const limitations = (year: number) => tax(year).limitations?.map(limit => annualSheetText(limit, 'en')).join(' ') ?? ''
    for (const index of [1, 2]) {
      expect(result.rows[index].taxCapability).toBe('legacyEstimate')
      expect(result.rows[index].tax).toBeCloseTo(9_171.64, 2)
      expect(Object.values(result.rows[index].byPersonTax ?? {}).map(person => person.tax))
        .toEqual([expect.closeTo(9_171.64, 2)])
      expect(limitations(saleYear + index)).not.toMatch(/household tax estimate|sale|lien/i)
    }
    expect(limitations(saleYear)).toMatch(/sale-lien funding.*legacy household tax estimate/i)
  })

  it('omits the simplified Quebec estimate notice when a couple estate is unsupported', () => {
    const inputs: Inputs = {
      ...cash, province: 'QC', fireAge: cash.currentAge,
      partner: { currentAge: 40, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 },
    }
    const { result, sheet, row } = observe(inputs, refreshCanonicalFromLegacy(null, inputs))
    expect(result.terminalTaxStatus).toBe('unsupported')
    expect(result.terminalTaxDisclosure).toBe('quebecSimplified')
    for (const id of ['estateTax', 'estateValue']) {
      const terminal = row(id).cells![sheet.years.at(-1)!.year]
      expect(terminal).toMatchObject({ status: 'unknown', value: null })
      const explanation = sheet.resolveExplanation?.(terminal.explanationRefs![0])
      expect(explanation).toBeDefined()
      expect(explanation?.limitations?.map(limit => annualSheetText(limit, 'en')).join(' ') ?? '')
        .not.toMatch(/simplified Quebec rules/i)
    }
  })

  it('displays separate first-gap years and actual modeled purchase and debt amounts', () => {
    const blockedPurchase = cases['failed purchase then depleted living budget']
    const gaps = observe(blockedPurchase)
    const [year, next] = gaps.sheet.years
    expect(gaps.sheet.jumps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'event-shortfall', year: year.year }),
      expect.objectContaining({ kind: 'living-shortfall', year: next.year }),
    ]))
    expect(gaps.row('eventGap').cells![year.year].value).toBe(100_000)
    const eventJump = gaps.sheet.jumps!.find(jump => jump.kind === 'event-shortfall')!
    const eventCell = gaps.row('eventGap').cells![year.year]
    const eventExplanation = gaps.sheet.resolveExplanation?.(eventCell.explanationRefs![0])!
    const eventSource = eventExplanation.sources!.find(source => source.id === 'purchase:50')!
    expect(eventJump.entityId).toBe('purchase:50')
    expect(eventExplanation.formula).toContainEqual(expect.objectContaining({
      value: 100_000, direction: 'add', sourceId: 'purchase:50', code: 'downPayment',
    }))
    expect(eventSource).toMatchObject({ code: 'downPayment', field: 'principalResidence.downPayment' })
    expect(validateInputs(blockedPurchase)).toContainEqual(expect.objectContaining({
      key: 'valDownPaymentUnfunded', eventId: 'purchase:50', params: { age: 50, amount: 100_000 },
    }))
    for (const [language, downPayment] of [['fr', /mise de fonds/i], ['zh', /首付/]] as const) {
      const labels = [eventJump.reason!, eventExplanation.formula![0].label, eventSource.label]
      for (const label of labels) {
        const localized = annualSheetText(label, language)
        expect(localized).toMatch(downPayment)
        expect(localized).not.toMatch(/principalResidence\.|downPayment|purchase:50/)
      }
    }
    const workingShortfall = gaps.row('shortfall').cells![year.year]
    expect(annualSheetCellStatus(workingShortfall, year, 'real')).toBe('not-computed')
    expect(workingShortfall.value).toBeNull()
    expect(annualSheetText(workingShortfall.reason!, 'en')).toMatch(/uses net savings and has no modeled living-cost target/i)
    const unavailable = gaps.sheet.resolveExplanation?.(workingShortfall.explanationRefs![0])
    expect(unavailable).toBeDefined()
    expect(unavailable?.formula ?? []).toHaveLength(0)
    expect(gaps.result.rows[0].shortfall).toBe(0)
    expect(gaps.row('eventGap').cells![next.year].value).toBe(0)
    expect(gaps.row('shortfall').cells![next.year].value).toBe(10_000)

    const funded = observe(cases['RRSP-funded purchase and later installments'])
    const openingYear = funded.sheet.baseYear
    expect(funded.row('purchaseFunding.price').cells![openingYear].value).toBe(500_000)
    expect(funded.row('purchaseFunding.mortgagePrincipal').cells![openingYear].value).toBe(400_000)
    expect(funded.row('debtPayment').cells![openingYear + 1].value).toBeCloseTo(40_000, 2)
    expect(funded.row('debtBalance').cells![openingYear + 1].value).toBeCloseTo(320_000, 2)
    const sold = observe(sale)
    const saleYear = sold.sheet.baseYear
    expect(sold.row('property.opening').cells![saleYear].value).toBe(500_000)
    expect(sold.row('property.closing').cells![saleYear].value).toBe(0)
    expect(sold.row('debtPayment').cells![saleYear].value).toBe(0)
    expect(sold.row('nonReg.closing').cells![saleYear].value).toBe(100_000)
    expect(sold.row('sale.principalResidence.sellAtAge.owed').cells![saleYear].value).toBe(400_000)
    expect(sold.row('sale.principalResidence.sellAtAge.proceeds').cells![saleYear].value).toBe(100_000)
    expect(sold.row('debtContractSaleDischarge').cells![saleYear].value).toBe(400_000)
    expect(sold.result.rows[0].annualDetails!.sales).toContainEqual({
      field: 'principalResidence.sellAtAge', owed: 400_000, proceeds: 100_000, cashNeeded: 0,
    })
  })

  it('keeps the unfunded HBP tax visible as an event with its own identity', () => {
    const { result, sheet, row } = observe({
      ...cash, fireAge: 46, lifeExpectancy: 46, annualSavings: 0,
      balances: { tfsa: 0, rrsp: 60_000, nonReg: 0 },
      principalResidence: { ...plannedHome, buyAtAge: 40, price: 60_000, downPayment: 60_000, annualMortgagePayment: 0, mortgageYears: 0, hbp: true },
    })
    const purchaseYear = sheet.baseYear
    expect(row('purchaseFunding.gross.rrsp').cells![purchaseYear].value).toBe(60_000)
    expect(row('purchaseFunding.withdrawalTax').cells![purchaseYear].value).toBe(0)
    expect(result.rows[0].annualDetails?.funding).toContainEqual(expect.objectContaining({
      eventId: 'purchase:40', allocation: expect.objectContaining({ hbpWithdrawal: 60_000, withdrawalTax: 0 }),
    }))
    expect(row('funding.purchase:40.hbpWithdrawal').cells![purchaseYear].value).toBe(60_000)
    const repaymentYear = purchaseYear + 5
    expect(result.rows[5].unfundedObligations).toEqual([
      expect.objectContaining({ eventId: 'hbp:45', amount: 1_400, reason: 'hbpRepaymentTax' }),
    ])
    expect(result.rows[5].annualDetails?.hbp).toEqual({ due: 4_000, repaid: 0, unpaidTax: 1_400 })
    expect(row('hbp.due').cells![repaymentYear].value).toBe(4_000)
    expect(row('hbp.repaid').cells![repaymentYear].value).toBe(0)
    expect(row('hbp.unpaidTax').cells![repaymentYear].value).toBe(1_400)
    const event = row('eventGap').cells![repaymentYear]
    expect(event.value).toBe(1_400)
    const explanation = sheet.resolveExplanation?.(event.explanationRefs![0])
    expect(explanation?.sources).toContainEqual(expect.objectContaining({ id: 'hbp:45', granularity: 'event' }))
  })

  it('keeps the TFSA investment return row keyed across working and retired plans', () => {
    const input = { ...cash, returns: { ...cash.returns, tfsa: 0.05 } }
    const working = observe(input)
    const retired = observe({ ...input, fireAge: input.currentAge })
    const isGrowth = (label: AnnualSheetRow['label']) => /investment return/i.test(annualSheetText(label, 'en'))
    const growth = (plan: ReturnType<typeof observe>) => plan.row('tfsa').children!.find(child => isGrowth(child.label))!
    expect(growth(retired).id).toBe(growth(working).id)
    for (const plan of [working, retired]) {
      const year = plan.sheet.baseYear
      const close = plan.row('tfsa.closing').cells![year]
      const expectedGrowth = growth(plan).cells![year].value!
      const explanation = plan.sheet.resolveExplanation?.(close.explanationRefs![0])
      expect(expectedGrowth).toBeGreaterThan(0)
      expect(explanation?.formula?.find(part => isGrowth(part.label))?.value).toBe(expectedGrowth)
    }
  })

  it('bridges the contractual 0% mortgage to legacy chart debt with 2% inflation', () => {
    const { result, sheet, row } = observe({
      ...cases['RRSP-funded purchase and later installments'],
      inflation: 0.02,
    })
    const [origin, following] = sheet.years
    const value = (id: string, year = origin.year) => row(id).cells![year].value
    const scheduled = result.rows[0].annualDetails!.debtSchedule.find(entry => entry.id === 'principalResidence.mortgage')!
    expect(scheduled.opening).toBe(0)
    expect(scheduled.borrowing).toBe(400_000)
    expect(scheduled.interest).toBe(0)
    expect(scheduled.payment).toBeCloseTo(40_000 / 1.02, 2)
    // The legacy stream deflates cash and close by one extra CPI period.
    expect(scheduled.closing * 1.02).toBeCloseTo(360_000, 2)
    expect(value('debtOpening')).toBe(0)
    expect(value('debtInterest')).toBe(0)
    expect(value('debtPrincipal')).toBeCloseTo(40_000 / 1.02, 2)
    expect(value('debtBalance')).toBeCloseTo(360_000 / 1.02, 2)
    expect(value('debtOpening', following.year)).toBeCloseTo(value('debtBalance')!, 7)
    expect(value('debtBalance', following.year)).toBeCloseTo(320_000 / 1.02, 2)
    expect(value('debtContractOpening')).toBe(0)
    expect(value('debtContractBorrowing')).toBe(400_000)
    expect(value('debtContractPayment')).toBeCloseTo(40_000, 2)
    expect(value('debtContractInterest')).toBe(0)
    expect(value('debtContractClosing')).toBeCloseTo(360_000, 2)
    expect(value('debtContractOpening', following.year)).toBeCloseTo(360_000, 2)
    expect(value('debtOpening', following.year)! + value('debtOpeningTranslation', following.year)!)
      .toBeCloseTo(360_000, 2)
    expect(value('debtContractClosing', following.year)).toBeCloseTo(320_000, 2)
    for (const year of [origin.year, following.year]) {
      expect(value('debtScheduleAdjustment', year)).toBeCloseTo(0, 2)
      expect(value('debtDisplayTranslation', year)).toBeLessThan(0)
      expect(value('debtContractClosing', year)! + value('debtDisplayTranslation', year)!)
        .toBeCloseTo(value('debtBalance', year)!, 2)
      const chartDebt = row('debtBalance').cells![year]
      const bridge = sheet.resolveExplanation?.(chartDebt.explanationRefs![0])?.formula
      expect(bridge?.find(part => part.value < 0)?.value).toBe(value('debtDisplayTranslation', year))
    }
  })

  it.each([
    { phase: 'retirement', fireAge: 50, opening: 100_000 },
    { phase: 'accumulation', fireAge: 51, opening: 140_000 },
  ])('records origination and discharge for a same-year purchase and sale in $phase', ({ fireAge, opening }) => {
    const input = {
      ...cases['RRSP-funded purchase and later installments'],
      fireAge, lifeExpectancy: 51,
      balances: { tfsa: opening, rrsp: 0, nonReg: 0 },
      principalResidence: { ...plannedHome, sellAtAge: 50, hbp: false },
    }
    const { result, sheet, row } = observe(input)
    const purchaseAndSale = result.rows[0]
    expect(purchaseAndSale.purchaseFunding?.mortgagePrincipal).toBe(400_000)
    expect(purchaseAndSale.unfundedObligations).toEqual([])
    expect(purchaseAndSale).toMatchObject({ propertyValue: 0, debtPayment: 0, debtBalance: 0, balances: { nonReg: 100_000 } })
    expect(purchaseAndSale.annualDetails?.sales).toContainEqual(expect.objectContaining({ owed: 400_000, proceeds: 100_000 }))
    expect(purchaseAndSale.annualDetails?.debtEvents).toEqual([
      expect.objectContaining({ id: 'principalResidence.mortgage', eventId: 'purchase:50', kind: 'borrowing', amount: 400_000 }),
      expect.objectContaining({ id: 'principalResidence.mortgage', eventId: 'sale:50:principalResidence.sellAtAge', kind: 'sale-discharge', amount: 400_000 }),
    ])
    expect(purchaseAndSale.annualDetails?.debtSchedule).toContainEqual({
      id: 'principalResidence.mortgage', opening: 0, borrowing: 400_000, saleDischarge: 400_000,
      payment: 0, interest: 0, closing: 0,
    })
    const value = (id: string) => row(id).cells![sheet.baseYear].value
    expect(value('debtContractBorrowing')).toBe(400_000)
    expect(value('debtContractSaleDischarge')).toBe(400_000)
    expect(value('debtContractClosing')).toBe(0)
    expect(value('debtScheduleAdjustment')).toBeCloseTo(0, 2)
  })

  it('uses separate contractual and chart CPI timing for a future mortgage close and next opening', () => {
    const { sheet, row } = observe({
      ...cases['RRSP-funded purchase and later installments'],
      inflation: 0.02,
      principalResidence: { ...plannedHome, buyAtAge: 51, hbp: false },
    })
    const [, origin, next] = sheet.years
    const value = (id: string, year: typeof origin, mode: 'real' | 'nominal') =>
      annualSheetDisplayValue(row(id).cells![year.year], year, mode)
    // A year-1 principal of 400,000 base-year CAD is 408,000 nominal.
    // One 40,800 nominal installment leaves 367,200 nominal at close.
    expect(value('debtContractBorrowing', origin, 'nominal')).toBeCloseTo(408_000, 2)
    expect(value('debtContractClosing', origin, 'nominal')).toBeCloseTo(367_200, 2)
    expect(value('debtContractOpening', next, 'nominal')).toBeCloseTo(367_200, 2)
    expect(value('debtBalance', origin, 'nominal')).toBeCloseTo(360_000, 2)
    expect(value('debtOpening', next, 'nominal')).toBeCloseTo(360_000, 2)
    expect(value('debtDisplayTranslation', origin, 'nominal')).toBeCloseTo(-7_200, 2)
    expect(value('debtOpeningTranslation', next, 'nominal')).toBeCloseTo(7_200, 2)
    // Contractual closing and next opening use F(2); chart close and its carry use F(1).
    const baseYearClose = 360_000 / 1.02
    expect(value('debtContractClosing', origin, 'real')).toBeCloseTo(baseYearClose, 2)
    expect(value('debtContractOpening', next, 'real')).toBeCloseTo(baseYearClose, 2)
    expect(value('debtSource.principalResidence.mortgage.closing', origin, 'real')).toBeCloseTo(baseYearClose, 2)
    expect(value('debtSource.principalResidence.mortgage.opening', next, 'real')).toBeCloseTo(baseYearClose, 2)
    expect(value('debtContractPayment', origin, 'real')).toBeCloseTo(40_000 / 1.02, 2)
    expect(value('debtDisplayTranslation', origin, 'real')).toBeCloseTo(0, 2)
    expect(value('debtOpeningTranslation', next, 'real')).toBeCloseTo(0, 2)
    expect(value('debtContractInflation', origin, 'real')).toBeCloseTo(400_000 / 1.02 - 400_000, 2)
    expect(value('debtBalance', origin, 'real')).toBeCloseTo(baseYearClose, 2)
    expect(value('debtOpening', next, 'real')).toBeCloseTo(baseYearClose, 2)
  })

  it('keeps the unfunded planned mortgage in debt when event and all-cost gaps overlap', () => {
    const { sheet, row } = observe({
      ...purchase, annualSavings: 0, extraIncome: null, retirementSpending: 10_000,
      balances: { tfsa: 140_000, rrsp: 0, nonReg: 0 },
    })
    const year = sheet.years[1].year
    const value = (id: string) => row(id).cells![year].value
    expect(value('eventGap')).toBe(40_000)
    expect(value('shortfall')).toBe(50_000)
    expect(value('debtPayment')).toBe(0)
    expect(value('debtBalance')).toBe(360_000)
    expect(value('debtRetainedMortgage')).toBe(40_000)
    expect(value('debtContractClosing')! + value('debtRetainedMortgage')!).toBe(value('debtBalance'))
  })

  it('marks ordinary debt as scheduled when no resources can settle the payment', () => {
    const { sheet, row } = observe({
      ...cash, fireAge: cash.currentAge, lifeExpectancy: cash.currentAge,
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 },
      debts: [{ kind: 'other', balance: 80_000, annualPayment: 40_000, yearsRemaining: 2 }],
    })
    const value = (id: string) => row(id).cells![sheet.baseYear].value
    expect(value('debtPayment')).toBe(40_000)
    expect(value('debtPrincipal')).toBe(40_000)
    expect(row('debtFundedPrincipal').cells![sheet.baseYear]).toMatchObject({ value: null, status: 'unknown' })
    expect(value('netCash')).toBe(0)
    expect(value('shortfall')).toBe(40_000)
    expect(value('eventGap')).toBe(0)
    expect(row('debtPayment').label).toMatchObject({ en: expect.stringMatching(/scheduled/i) })
  })

  it('forwards surplus purchase proceeds with new ACB and carries locked balances with zero real return', () => {
    const { sheet, row } = observe({
      ...purchase, annualSavings: 0, extraIncome: null, inflation: 0.02,
      fhsa: { balance: 150_000, annualContribution: 0, openedYearsAgo: 0 },
      lockedRetirement: { balance: 35_000, employeeContribution: 0, employerContribution: 0, accessibleAge: 65, jurisdiction: 'ON', owner: 'self' },
      principalResidence: { ...plannedHome, price: 100_000, annualMortgagePayment: 0, mortgageYears: 0, hbp: false },
    })
    const [first, next] = sheet.years
    const value = (id: string, year = first.year) => row(id).cells![year].value
    expect(value('fhsa.opening')).toBe(150_000)
    expect(value('fhsa.closing')).toBe(0)
    expect(value('purchaseFunding.downPaymentFromFhsa')).toBe(100_000)
    expect(value('nonReg.closing')).toBe(50_000)
    expect(value('nonReg.opening', next.year)).toBe(50_000)
    expect(value('acb')).toBe(50_000)
    expect(value('locked.closing')).toBe(35_000)
    expect(value('locked.opening', next.year)).toBe(35_000)
    expect(value('locked.closing', next.year)).toBe(35_700)
    expect(value('locked.inflation', next.year)).toBeCloseTo(700, 7)
  })

  it('masks the unsupported ending estate estimate and preserves a modeled two-cent shortfall', () => {
    const unsupported = observe({ ...cash, lifeExpectancy: cash.currentAge })
    const end = unsupported.sheet.years[0]
    expect(unsupported.result.terminalTaxStatus).toBe('unsupported')
    for (const id of ['estateTax', 'estateValue']) {
      const cell = unsupported.row(id).cells![end.year]
      expect(annualSheetDisplayValue(cell, end, 'real')).toBeNull()
    }
    const small = observe({
      ...cash, fireAge: cash.currentAge, lifeExpectancy: cash.currentAge,
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, retirementSpending: 0.02,
    })
    expect(small.row('shortfall').cells![small.sheet.baseYear].value).toBe(0.02)
    expect(small.sheet.jumps).toContainEqual(expect.objectContaining({ kind: 'living-shortfall', year: small.sheet.baseYear }))
  })
})
