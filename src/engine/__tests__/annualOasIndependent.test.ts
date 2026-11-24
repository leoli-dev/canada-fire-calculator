import { describe, expect, it } from 'vitest'
import { annualSheetDisplayValue, annualSheetText } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { projectCanonicalCoverage, type KernelResult } from '../annualState'
import { cppStart } from './fixtures/annualCpp'
import { known, recorded, RETIREE, RRSP, TFSA } from './fixtures/retirementSettlement'
import { PARTNER, staggeredHouseholdPlan, staggeredReference, staggeredSpending } from './fixtures/staggeredHousehold'

// ESDC October–December 2026 Table 5 and footnotes 7–8. The plan annualizes
// that quarter's published monthly maximum as a user-recorded anchor amount.
// https://www.canada.ca/en/employment-social-development/programs/pensions/pension/statistics/2026-quarterly-october-december.html
const grossOas = 762.50 * 12
const recoveryThreshold = 95_323
const recoveryRate = 0.15
const inflation = 0.02
const close = (value: number) => expect.closeTo(value, 4)

// Independent calculations using the 2026 ON rules at c866f489. Ordinary
// RRSP withdrawals, CPP and OAS do not earn a pension credit. This fixture
// stays under the federal BPA phase-out and below the $200,000 premium step.
const seniorAgeBase = (income: number, max: number, threshold: number) => Math.max(0, max - 0.15 * Math.max(0, income - threshold))
function regularTax(income: number) {
  const federal = (Math.min(income, 58_523) - 16_452 - seniorAgeBase(income, 9_208, 46_432)) * 0.14
    + Math.max(0, Math.min(income, 117_045) - 58_523) * 0.205
    + Math.max(0, income - 117_045) * 0.26
  const provincial = (Math.min(income, 53_891) - 12_989 - seniorAgeBase(income, 6_342, 47_210)) * 0.0505
    + Math.max(0, Math.min(income, 107_785) - 53_891) * 0.0915
    + Math.max(0, Math.min(income, 150_000) - 107_785) * 0.1116
    + Math.max(0, income - 150_000) * 0.1216
  const surtax = Math.max(0, provincial - 5_818) * 0.20 + Math.max(0, provincial - 7_446) * 0.36
  const healthPremium = income < 51_000 ? Math.min(600, 450 + Math.max(0, income - 48_000) * 0.25) : 750
  return federal + provincial + surtax + healthPremium
}

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

const benefitExclusions = () => ({
  gis: { status: 'excluded' as const, reason: 'GIS explicitly excluded from this scenario', provenance: recorded },
  allowance: { status: 'not-applicable' as const, reason: 'No Allowance receipt recorded', provenance: recorded },
  otherBenefits: { status: 'excluded' as const, reason: 'Other benefit receipts explicitly excluded', provenance: recorded },
})

function scenario({ spending, cpp = 0, oas = grossOas, claimAge = 65, rrsp = 350_000, baseAge = 64, retirementAge = 65 }: {
  spending: number; cpp?: number; oas?: number; claimAge?: number; rrsp?: number; baseAge?: number; retirementAge?: number;
}) {
  const plan = staggeredHouseholdPlan()
  const self = plan.people[0]
  plan.people = [self]
  Object.assign(self, { ageInBaseYear: baseAge, retirementAge, cppAnnualAt65: cpp, oasAnnualAt65: oas })
  plan.lifeExpectancy = 74
  delete plan.tfsaStatement![PARTNER]
  plan.annualBenefitsEvidence = { [RETIREE]: benefitExclusions() }
  const rrspAccount = plan.accounts.find(account => account.id === RRSP)!
  Object.assign(rrspAccount, { balance: rrsp, ownerId: RETIREE, taxableOwnerShares: { status: 'known', shares: { [RETIREE]: 1 } } })
  plan.accounts.find(account => account.id === TFSA)!.balance = 150_000
  if (cpp) plan.incomeSources.push(cppStart(RETIREE, 65, cpp))
  if (oas) plan.incomeSources.push({ id: 'recorded-oas', kind: 'oas', recipientId: RETIREE, startAge: claimAge, annualAmount: known(oas), provenance: recorded })
  const working = staggeredReference.working.self
  const workingSpending = working.wage - working.payroll - working.tax
  plan.budget = { kind: 'incomeBudget', workingSpending, retirementSpending: spending }
  return { plan, evidence: { workingSpending: known(workingSpending), retirementSpending: known(spending) } }
}

describe('independent annual OAS settlement vectors', () => {
  it.each([
    { label: 'no recovery below threshold', draw: 40_000, cpp: 0, expectedRecovery: 0 },
    { label: 'exactly zero recovery at threshold', draw: 86_173, cpp: 0, expectedRecovery: 0 },
    { label: 'partial recovery after adding owner CPP and withdrawal', draw: 88_000, cpp: 12_000, expectedRecovery: 2_074.05 },
    { label: 'full recovery capped at the OAS receipt', draw: 155_000, cpp: 0, expectedRecovery: 9_150 },
  ])('settles $label', ({ draw, cpp, expectedRecovery }) => {
    const recoveryIncome = draw + cpp + grossOas
    const recovery = Math.min(grossOas, Math.max(0, recoveryIncome - recoveryThreshold) * recoveryRate)
    expect(recovery).toBeCloseTo(expectedRecovery, 6)
    const netOas = grossOas - recovery
    const taxable = draw + cpp + netOas
    const tax = regularTax(taxable)
    const spending = taxable - tax
    const { plan, evidence } = scenario({ spending, cpp })
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false })
    const [before, year] = result.rows
    expect(before.cashLedger.benefits).toBe(0)
    const cpi = 1 + inflation
    expect(year).toMatchObject({
      year: 2027,
      byPerson: { [RETIREE]: { age: 65, oasGross: close(grossOas * cpi), oasRecovery: close(recovery * cpi), oasNet: close(netOas * cpi), income: close(cpp * cpi), benefits: close(netOas * cpi) } },
      retirementSettlement: { startCpi: cpi, spendingUnmet: close(0), oas: {
        grossReal: close(grossOas), recoveryReal: close(recovery), netReal: close(netOas), recoveryIncomeReal: close(recoveryIncome), sourceId: 'recorded-oas', startAge: 65, sourceYear: 2026,
      } },
      taxLedger: { [RETIREE]: { taxableIncome: close(taxable * cpi), tax: close(tax * cpi) } },
      cashLedger: { income: close(cpp * cpi), benefits: close(netOas * cpi), tax: close(tax * cpi), spending: close(spending * cpi), unallocated: close(0) },
      byAccount: { [RRSP]: { opening: before.byAccount[RRSP].closing, withdrawal: close(draw * cpi) }, [TFSA]: { withdrawal: 0 } },
    })
    const ledger = year.cashLedger
    expect(ledger.income + ledger.benefits + year.byAccount[RRSP].withdrawal - ledger.tax).toBeCloseTo(ledger.spending, 4)
  })

  it.each([65, 66])('uses age-%i recorded basis for a claim at 66 and indexes each receipt at start CPI', (ageBasis) => {
    const age66Oas = grossOas * (1 + 0.006 * 12)
    const { plan, evidence } = scenario({ spending: 20_000, claimAge: 66, rrsp: 0, oas: ageBasis === 65 ? grossOas : age66Oas })
    plan.people[0].oasAmountSource!.ageBasis = ageBasis
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.blocked).toBeNull()
    expect(result.rows.slice(0, 2).map(row => row.cashLedger.benefits)).toEqual([0, 0])
    for (const [index, row] of result.rows.slice(2).entries()) {
      const cpi = (1 + inflation) ** (index + 2)
      expect(row.retirementSettlement?.oas).toMatchObject({ grossReal: close(age66Oas), recoveryReal: 0, netReal: close(age66Oas), startAge: 66, ageBasis })
      expect(row.cashLedger.benefits).toBeCloseTo(age66Oas * cpi, 4)
      expect(row.byAccount[TFSA].withdrawal).toBeCloseTo((20_000 - age66Oas) * cpi, 4)
    }
  })

  it('settles wages and payroll at working age 65 when OAS starts at retirement age 66', () => {
    const { plan, evidence } = scenario({ spending: 20_000, baseAge: 65, claimAge: 66, retirementAge: 66, rrsp: 0 })
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false })
    const [age65, age66] = result.rows
    const working = staggeredReference.working.self
    // At $39,635 both 2026 age amounts are still available in full.
    const ageCredit = 9_208 * 0.14 + 6_342 * 0.0505
    expect(age65).toMatchObject({
      year: 2026, workingSettlement: { age: 65, payrollContributions: close(working.payroll) },
      cashLedger: { income: 40_000, benefits: 0, tax: close(working.tax - ageCredit) },
      taxLedger: { [RETIREE]: { taxableIncome: 39_635 } },
      byAccount: { [TFSA]: { opening: 150_000, contribution: Math.round(ageCredit * 100) / 100 } },
    })
    const age66Oas = grossOas * 1.072
    expect(age66).toMatchObject({
      year: 2027, cashLedger: { income: 0, benefits: close(age66Oas * 1.02), tax: 0 },
      retirementSettlement: { oas: { startAge: 66, grossReal: close(age66Oas), recoveryReal: 0 } },
      byAccount: { [TFSA]: { opening: age65.byAccount[TFSA].closing, withdrawal: close((20_000 - age66Oas) * 1.02) } },
    })
  })

  it('preserves the age-64 prefix when unknown outside income starts during age-65 work with deferred OAS', () => {
    const { plan, evidence } = scenario({ spending: 20_000, claimAge: 66, retirementAge: 66, rrsp: 0 })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    plan.incomeSources.push({ id: 'uncertain-while-working', kind: 'other', recipientId: RETIREE, startAge: 65, annualAmount: { status: 'unknown', reason: 'Receipt unconfirmed' }, provenance: recorded })
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result).toMatchObject({ rows: prefix.rows, state: prefix.state, uncomputedYears: [2028], blocked: {
      year: 2027, status: 'unsupported', issues: [{ detail: expect.stringMatching(/active working income source/i) }],
    } })
  })

  it('retains CPP at 65 with the recorded exclusions and preserves the prior state when exclusions are missing', () => {
    const { plan, evidence } = scenario({ spending: 20_000, cpp: 12_000, oas: 0, rrsp: 0 })
    const complete = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(complete.blocked).toBeNull()
    expect(complete.rows[1].byPerson[RETIREE]).toMatchObject({ age: 65, cpp: 12_240, benefits: 0 })
    expect(complete.rows[1].retirementSettlement?.oas).toMatchObject({ sourceId: null, startAge: null, grossReal: 0, recoveryReal: 0, netReal: 0 })
    const dated = structuredClone(plan)
    dated.incomeSources.push({ id: 'dated-oas-zero', kind: 'oas', recipientId: RETIREE, startAge: 65, annualAmount: known(0), provenance: recorded })
    const datedResult = ok(projectCanonicalCoverage(dated, evidence, 2))
    expect(datedResult.blocked).toBeNull()
    expect(datedResult.rows[1].cashLedger).toEqual(complete.rows[1].cashLedger)
    expect(datedResult.rows[1].taxLedger).toEqual(complete.rows[1].taxLedger)
    expect(datedResult.state).toEqual(complete.state)
    delete plan.annualBenefitsEvidence
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result).toMatchObject({ rows: prefix.rows, state: prefix.state, blocked: { year: 2027, status: 'unsupported' }, uncomputedYears: [2028], overallConclusionAvailable: false })
  })

  it('exposes one signed OAS benefit with annual policy, owner and tax source details in the sheet', () => {
    const taxable = 107_075.95
    const { plan, evidence } = scenario({ spending: taxable - regularTax(taxable), cpp: 12_000 })
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    const sheet = canonicalAnnualSheet(result, { scenarioId: 'independent-oas', revision: 1 })
    const person = sheet.rows.find(row => row.id === canonicalSheetId('group', 'person', RETIREE))
    const repayment = person?.children?.find(row => row.id === canonicalSheetId('value', 'person', RETIREE, 'oasRecovery'))?.cells?.[2027]
    const column = sheet.years.find(year => year.year === 2027)
    if (!repayment || !column) throw new Error('OAS repayment cell or claim year missing')
    expect(annualSheetDisplayValue(repayment, column, 'real')).toBeCloseTo(2_074.05, 4)
    const explanation = sheet.resolveExplanation?.(repayment.explanationRefs![0])
    expect(explanation).toMatchObject({ projectionYear: 2027, taxYear: 2026, rulePackage: 'CA-ON-tax-2026-legacy-v1', sources: expect.arrayContaining([
      expect.objectContaining({ id: 'recorded-oas', field: 'incomeSources.oas' }),
      expect.objectContaining({ id: RETIREE, field: 'annualBenefitsEvidence.gis' }),
    ]) })
    const policy = explanation?.summary
    if (!policy) throw new Error('OAS annual policy missing')
    expect(annualSheetText(policy, 'en')).toMatch(/annual estimate.*monthly withholding/i)
    expect(annualSheetText(policy, 'fr')).toMatch(/estimation annuelle.*retenues mensuelles/i)
    expect(annualSheetText(policy, 'zh')).toMatch(/年度估算.*月度预扣/)
    const household = sheet.rows.find(row => row.id === canonicalSheetId('group', 'household'))
    const funded = household?.children?.find(row => row.id === canonicalSheetId('value', 'retirement', 'spendingFunded'))?.cells?.[2027]
    const formula = funded && sheet.resolveExplanation?.(funded.explanationRefs![0])?.formula
    if (!formula) throw new Error('OAS funded cash formula missing')
    expect(formula.filter(term => term.field === 'benefits')).toMatchObject([{ direction: 'add', value: close(7_075.95 * 1.02) }])
    expect(formula.filter(term => term.field === 'tax')).toMatchObject([{ direction: 'subtract', value: close(regularTax(taxable) * 1.02) }])
    expect(formula.reduce((sum, term) => sum + (term.direction === 'add' ? term.value : -term.value), 0)).toBeCloseTo(funded.value!, 4)
  })

  it('resolves the OAS cell using the three validated exclusions when an extra entry is null', () => {
    const { plan, evidence } = scenario({ spending: 20_000 })
    Object.assign(plan.annualBenefitsEvidence![RETIREE], { unrecognized: null })
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    const sheet = canonicalAnnualSheet(result, { scenarioId: 'extra-oas-evidence', revision: 1 })
    const person = sheet.rows.find(row => row.id === canonicalSheetId('group', 'person', RETIREE))
    const netOas = person?.children?.find(row => row.id === canonicalSheetId('value', 'person', RETIREE, 'oasNet'))?.cells?.[2027]
    const reference = netOas?.explanationRefs?.[0]
    if (!reference) throw new Error('Net OAS explanation missing')
    const explanation = sheet.resolveExplanation?.(reference)
    const fields = explanation?.sources?.map(source => source.field).filter(field => field?.startsWith('annualBenefitsEvidence.'))
    expect(fields?.sort()).toEqual(['annualBenefitsEvidence.allowance', 'annualBenefitsEvidence.gis', 'annualBenefitsEvidence.otherBenefits'])
  })

  it.each([0, grossOas])('refuses a numeric zero statement review flag with $%i recorded OAS', (oas) => {
    const { plan, evidence } = scenario({ spending: 20_000, oas })
    Object.assign(plan.people[0].oasAmountSource!, { source: 'statement', premises: { retirementAge: 65 }, premisesNeedReview: 0 })
    const result = projectCanonicalCoverage(plan, evidence, 2)
    if (result.status !== 'ok') {
      expect(result.status).toBe('invalid')
    } else {
      const opening = ok(projectCanonicalCoverage(plan, evidence, 0))
      expect(result.value).toMatchObject({ rows: [], state: opening.state, blocked: { year: 2026 } })
    }
  })

  it('keeps the pre-claim prefix when an active unknown receipt contradicts the exclusion scope', () => {
    const { plan, evidence } = scenario({ spending: 20_000 })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    plan.incomeSources.push({ id: 'unknown-other', kind: 'other', recipientId: RETIREE, startAge: 65, annualAmount: { status: 'unknown', reason: 'Unverified receipt' }, provenance: recorded })
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result).toMatchObject({ rows: prefix.rows, state: prefix.state, blocked: { year: 2027, status: 'unsupported' }, uncomputedYears: [2028] })
  })

  it.each([
    { label: 'claiming OAS while working at age 65', retirementAge: 66, years: 3, committed: 1, reason: /working OAS/i },
    { label: 'retired at age 75', retirementAge: 65, years: 13, committed: 11, reason: /75.*monthly/i },
  ])('keeps a committed prefix for an out-of-scope recipient $label', ({ retirementAge, years, committed, reason }) => {
    const { plan, evidence } = scenario({ spending: 20_000, retirementAge, rrsp: 0 })
    if (committed > 1) {
      plan.lifeExpectancy = 76
      plan.accounts.find(account => account.id === TFSA)!.balance = 250_000
    }
    const prefix = ok(projectCanonicalCoverage(plan, evidence, committed))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, years))
    expect(result).toMatchObject({
      rows: prefix.rows, state: prefix.state, blocked: { year: 2026 + committed, status: 'unsupported', issues: [{ detail: expect.stringMatching(reason) }] },
      uncomputedYears: [2027 + committed], overallConclusionAvailable: false,
    })
  })

  it('preserves the working state atomically when retirement has OAS surplus with no carry account', () => {
    const { plan, evidence } = scenario({ spending: 5_000 })
    const input = structuredClone({ plan, evidence })
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result).toMatchObject({ rows: prefix.rows, state: prefix.state, blocked: { year: 2027, status: 'unsupported' }, uncomputedYears: [2028], overallConclusionAvailable: false })
    expect({ plan, evidence }).toEqual(input)
  })

  it.each(['duplicate source', 'mismatched amount', 'unknown amount', 'wrong recipient', 'before 65', 'unconfirmed source', 'claim age range', 'conflicting source year', 'estimated exclusion', 'stale statement'])(
    'never posts a positive OAS receipt with %s', (problem) => {
      const { plan, evidence } = scenario({ spending: 20_000 })
      const source = plan.incomeSources[0]
      switch (problem) {
        case 'duplicate source': plan.incomeSources.push({ ...source, id: 'conflicting-oas' }); break
        case 'mismatched amount': source.annualAmount = known(9_000); break
        case 'unknown amount': source.annualAmount = { status: 'unknown', reason: 'No amount record' }; break
        case 'wrong recipient': source.recipientId = null; break
        case 'before 65': source.startAge = 64; break
        case 'unconfirmed source': plan.people[0].oasAmountSource!.source = 'estimator'; break
        case 'claim age range': source.toAge = 66; break
        case 'conflicting source year': source.provenance = { ...recorded, sourceYear: 2025 }; break
        case 'estimated exclusion': plan.annualBenefitsEvidence![RETIREE].gis.provenance = { ...recorded, origin: 'estimated' }; break
        case 'stale statement': Object.assign(plan.people[0].oasAmountSource!, { source: 'statement', premises: { retirementAge: 66 } }); break
      }
      const result = projectCanonicalCoverage(plan, evidence, 3)
      if (result.status === 'ok') {
        expect(result.value.blocked).not.toBeNull()
        expect(result.value.rows.every(row => row.cashLedger.benefits === 0)).toBe(true)
      } else expect(['invalid', 'unsupported']).toContain(result.status)
    },
  )

  it('settles two simultaneous claims from the both-working prefix', () => {
    const plan = staggeredHouseholdPlan()
    const { evidence } = scenario({ spending: 70_000 })
    for (const person of plan.people) Object.assign(person, { ageInBaseYear: 64, retirementAge: 65, oasAnnualAt65: grossOas })
    plan.lifeExpectancy = 68
    plan.annualBenefitsEvidence = { [RETIREE]: benefitExclusions(), [PARTNER]: benefitExclusions() }
    plan.incomeSources = plan.people.map(person => ({ id: `${person.id}:oas`, kind: 'oas', recipientId: person.id, startAge: 65, annualAmount: known(grossOas), provenance: recorded }))
    const workingSpending = staggeredReference.working.spending
    plan.budget = { kind: 'incomeBudget', workingSpending, retirementSpending: 70_000 }
    const result = ok(projectCanonicalCoverage(plan, { ...staggeredSpending(), ...evidence, workingSpending: known(workingSpending) }, 3))
    expect(result.blocked).toBeNull()
    expect(result.rows[0].cashLedger.benefits).toBe(0)
    for (const [index, row] of result.rows.slice(1).entries()) {
      const receipt = grossOas * (1 + inflation) ** (index + 1)
      expect(row.byPerson).toMatchObject({
        [RETIREE]: { oasGross: close(receipt), oasRecovery: 0, oasNet: close(receipt) },
        [PARTNER]: { oasGross: close(receipt), oasRecovery: 0, oasNet: close(receipt) },
      })
      expect(row.cashLedger.benefits).toBeCloseTo(2 * receipt, 4)
    }
  })
})
