import { describe, expect, it } from 'vitest'
import { annualSheetDisplayValue, annualSheetText } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { projectCanonicalCoverage, type KernelResult } from '../annualState'
import { cppPlan, cppReference as ref, cppSpending, cppStart } from './fixtures/annualCpp'
import { known, recorded, RETIREE, RRSP, TFSA } from './fixtures/retirementSettlement'
import { PARTNER, staggeredReference } from './fixtures/staggeredHousehold'

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

const close = (value: number) => expect.closeTo(value, 4)

function soloCppPlan(retirementSpending: number) {
  const plan = cppPlan()
  plan.people = [plan.people[0]]
  plan.incomeSources = [plan.incomeSources[0]]
  delete plan.tfsaStatement![PARTNER]
  const { wage, payroll, tax } = staggeredReference.working.self
  const workingSpending = wage - payroll - tax
  plan.budget = { kind: 'incomeBudget', workingSpending, retirementSpending }
  return { plan, evidence: { workingSpending: known(workingSpending), retirementSpending: known(retirementSpending) } }
}

function cppPlanWithZeroPartner() {
  const plan = cppPlan()
  plan.people[1].cppAnnualAt65 = 0
  plan.incomeSources = [plan.incomeSources[0]]
  return plan
}

describe('canonical Ontario CPP starts', () => {
  it('keeps a true zero-CPP plan on the pre-S2 cash, account and tax baseline', () => {
    const result = ok(projectCanonicalCoverage(cppPlan(false), cppSpending(), 3))
    expect(result.blocked).toBeNull()
    // Snapshot generated with the unmodified d0261bd projection and this fixture.
    expect(result.rows.map(({ year, cashLedger, byPerson, byAccount, taxLedger, payrollContributions }) => ({
      year, cashLedger, byPerson, byAccount, taxLedger, payrollContributions,
    }))).toMatchSnapshot()
  })

  it('keeps the zero-CPP cash baseline through age 65 with a recorded zero amount', () => {
    const noSource = cppPlan(false)
    const [self, partner] = noSource.people
    Object.assign(self, { ageInBaseYear: 63, retirementAge: 64 })
    Object.assign(partner, { ageInBaseYear: 63, retirementAge: 65 })
    noSource.lifeExpectancy = 67
    const plan = structuredClone(noSource)
    plan.incomeSources.push(cppStart(PARTNER, 64, 0))
    const evidence = cppSpending()
    const baseline = ok(projectCanonicalCoverage(noSource, evidence, 3))
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toBeNull()
    expect(result.rows[2].byPerson[PARTNER].age).toBe(65)
    expect(result.rows.map(row => row.cashLedger)).toEqual(baseline.rows.map(row => row.cashLedger))
    expect(result.rows.map(row => row.taxLedger)).toEqual(baseline.rows.map(row => row.taxLedger))
    expect(result.state).toEqual(baseline.state)
  })

  it('rejects a negative CPP amount in an otherwise known-zero household before posting any year', () => {
    const plan = cppPlan(false)
    plan.people[1].cppAnnualAt65 = -1
    expect(projectCanonicalCoverage(plan, cppSpending(), 3)).toEqual({
      status: 'invalid', issues: [{ code: 'invalid', detail: expect.stringMatching(/CPP.*nonnegative/i) }],
    })
  })

  it('settles positive CPP for one person with a confirmed zero and no CPP source for their spouse', () => {
    const plan = cppPlanWithZeroPartner()
    const result = ok(projectCanonicalCoverage(plan, cppSpending(), 3))
    expect(result).toMatchObject({ blocked: null, uncomputedYears: [] })
    expect(result.rows).toHaveLength(3)
    expect(result.rows[1].byPerson[RETIREE].cpp).toBeCloseTo(7833.60, 8)
    expect(result.rows[2]).toMatchObject({
      byPerson: { [PARTNER]: { income: 0, earnedIncome: 0, cpp: 0, taxableIncome: 0, tax: 0 } },
      workingSettlement: { household: { byPerson: { [PARTNER]: { cpp: { status: 'known-none', sourceId: null, startAge: null } } } } },
      cashLedger: { income: close(7990.272), benefits: 0 },
    })
  })

  it.each([
    { label: 'has a review flag despite a matching retirement age', statement: { premisesNeedReview: true } },
    { label: 'records retirement at 62 instead of 61', statement: { premises: { retirementAge: 62 } } },
  ])('refuses a source-less zero CPP statement that $label', ({ statement }) => {
    const plan = cppPlanWithZeroPartner()
    Object.assign(plan.people[1].cppAmountSource!, statement)
    const evidence = cppSpending()
    const opening = ok(projectCanonicalCoverage(cppPlanWithZeroPartner(), evidence, 0))
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result.blocked).toMatchObject({
      year: 2026, status: 'unsupported', issues: [{ detail: expect.stringMatching(/statement|premise/i) }],
    })
    expect(result.rows).toEqual([])
    expect(result.state).toEqual(opening.state)
    expect(result.uncomputedYears).toEqual([2027, 2028])
  })

  it('starts each person in their own year and uses CPP once in cash and RRSP repricing', () => {
    const plan = cppPlan()
    const evidence = cppSpending()
    const original = structuredClone({ plan, evidence })
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false })
    const [before, first, second] = result.rows
    const baseline = ok(projectCanonicalCoverage(cppPlan(false), evidence, 3))
    for (const id of [RETIREE, PARTNER]) {
      expect(before.byPerson[id]).toMatchObject(baseline.rows[0].byPerson[id])
      expect(before.byPerson[id].cpp).toBe(0)
    }
    expect(before.cashLedger).toEqual(baseline.rows[0].cashLedger)
    expect(before.byAccount).toEqual(baseline.rows[0].byAccount)

    const workingPartner = staggeredReference.working.partner
    expect(first).toMatchObject({ year: 2027,
      byPerson: {
        [RETIREE]: { age: 60, income: close(ref.manualAt60 * 1.02), earnedIncome: 0, cpp: close(ref.manualAt60 * 1.02), taxableIncome: close(ref.mixedTaxable * 1.02), tax: close(ref.mixedTax * 1.02) },
        [PARTNER]: { age: 60, income: workingPartner.wage * 1.02, earnedIncome: workingPartner.wage * 1.02, cpp: 0, taxableIncome: close(workingPartner.taxable * 1.02), tax: close(workingPartner.tax * 1.02) },
      },
      cashLedger: { income: close((workingPartner.wage + ref.manualAt60) * 1.02), benefits: 0 },
      payrollContributions: close(workingPartner.payroll * 1.02),
      householdWithdrawalSettlement: { ownerId: RETIREE, accountId: RRSP, withdrawal: close(ref.mixedWithdrawal * 1.02),
        taxIncrement: close(ref.mixedTax * 1.02), spendingDue: close(ref.transitionSpending * 1.02), spendingUnmet: close(0) },
    })
    expect(first.payrollContributions).toBe(baseline.rows[1].payrollContributions)
    expect(first.workingSettlement).toMatchObject({ household: { byPerson: {
      [RETIREE]: { payrollReal: null },
      [PARTNER]: { payrollReal: { contributions: close(workingPartner.payroll), taxDeduction: close(927), creditAmount: close(4642.52), employmentAmount: 1501 } },
    } } })

    const cpi = 1.02 ** 2
    expect(second).toMatchObject({ year: 2028,
      byPerson: {
        [RETIREE]: { age: 61, income: close(ref.manualAt60 * cpi), earnedIncome: 0, cpp: close(ref.manualAt60 * cpi), taxableIncome: close(ref.retiredTaxable * cpi), tax: close(ref.retiredTax * cpi) },
        [PARTNER]: { age: 61, income: close(ref.statementAt61 * cpi), earnedIncome: 0, cpp: close(ref.statementAt61 * cpi), taxableIncome: close(ref.statementAt61 * cpi), tax: 0 },
      },
      cashLedger: { income: close((ref.manualAt60 + ref.statementAt61) * cpi), benefits: 0 },
      payrollContributions: 0,
      householdWithdrawalSettlement: { ownerId: RETIREE, accountId: RRSP, withdrawal: close(ref.retiredWithdrawal * cpi),
        taxIncrement: close(ref.retiredTax * cpi), spendingDue: close(ref.retirementSpending * cpi), spendingUnmet: close(0) },
    })
    expect(result.state.benefitIncomeLag).toMatchObject({
      [RETIREE]: known(close(ref.retiredTaxable * cpi)), [PARTNER]: known(close(ref.statementAt61 * cpi)),
    })
    for (const row of [first, second]) {
      const { income, benefits, tax, spending } = row.cashLedger
      const account = row.byAccount[RRSP]
      expect(tax).toBeCloseTo(row.byPerson[RETIREE].tax + row.byPerson[PARTNER].tax, 8)
      for (const id of [RETIREE, PARTNER]) {
        const person = row.byPerson[id]
        expect(row.taxLedger[id]).toEqual({ tax: person.tax, taxableIncome: person.taxableIncome })
      }
      expect(income + benefits - tax - row.payrollContributions! + account.withdrawal).toBeCloseTo(spending, 4)
      expect(account.closing).toBeCloseTo((account.opening - account.withdrawal) * 1.02, 4)
      expect(row.byAccount[TFSA].withdrawal).toBe(0)
    }
    expect(second.byAccount[RRSP].opening).toBe(first.byAccount[RRSP].closing)
    expect({ plan, evidence }).toEqual(original)
  })

  it.each(['missing', 'duplicate'] as const)('blocks a %s CPP start before committing a row', (issue) => {
    const plan = cppPlan()
    const [start] = plan.incomeSources
    if (issue === 'missing') delete start.startAge
    else plan.incomeSources.push({ ...start, id: 'second-claim', startAge: 63 })
    const evidence = cppSpending()
    const opening = ok(projectCanonicalCoverage(plan, evidence, 0))
    expect(ok(projectCanonicalCoverage(plan, evidence, 3))).toMatchObject({
      rows: [], state: opening.state,
      blocked: { year: 2026, status: 'unsupported', issues: [{ detail: expect.stringMatching(/CPP.*(?:source|start)/i) }] },
      uncomputedYears: [2027, 2028], overallConclusionAvailable: false,
    })
  })

  it('refuses to post a statement whose retirement-age premise requires reconfirmation', () => {
    const plan = cppPlan()
    plan.people[1].cppAmountSource!.premises = { retirementAge: 62 }
    expect(ok(projectCanonicalCoverage(plan, cppSpending(), 2))).toMatchObject({
      rows: [], blocked: { year: 2026, status: 'unsupported', issues: [{ detail: expect.stringMatching(/statement|premise/i) }] },
      uncomputedYears: [2027],
    })
  })

  it('refuses a malformed statement source year before it can break the annual sheet details', () => {
    const plan = cppPlan()
    const malformed = { toString: null, valueOf: null }
    plan.people[1].cppAmountSource!.sourceYear = malformed as unknown as number
    // Preflight refusal leaves no annual coverage from which to render details.
    expect(projectCanonicalCoverage(plan, cppSpending(), 3)).toEqual({
      status: 'invalid', issues: [{ code: 'invalid', detail: expect.stringMatching(/CPP.*provenance/i) }],
    })
  })

  it('carries CPP through the single-person retirement handoff and ordinary RRSP draw', () => {
    const retirementSpending = ref.mixedTaxable - ref.mixedTax
    const { plan, evidence } = soloCppPlan(retirementSpending)
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    const [working, retired] = result.rows
    expect(working.byPerson[RETIREE].cpp).toBe(0)
    const cpi = 1.02
    expect(retired).toMatchObject({
      year: 2027,
      byPerson: { [RETIREE]: { cpp: close(ref.manualAt60 * cpi), earnedIncome: 0, taxableIncome: close(ref.mixedTaxable * cpi), tax: close(ref.mixedTax * cpi) } },
      cashLedger: { income: close(ref.manualAt60 * cpi), benefits: 0, spending: close(retirementSpending * cpi) },
      byAccount: { [RRSP]: { opening: working.byAccount[RRSP].closing, withdrawal: close(ref.mixedWithdrawal * cpi) } },
      retirementSettlement: { startCpi: cpi, spendingUnmet: 0, cpp: { amountReal: ref.manualAt60, status: 'paying' } },
    })
  })

  it('reconciles the solo funded-spending formula with one signed CPP cash component', () => {
    const { plan, evidence } = soloCppPlan(10_000)
    const result = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(result.blocked).toBeNull()
    const sheet = canonicalAnnualSheet(result, { scenarioId: 'cpp-solo-formula', revision: 1 })
    const household = sheet.rows.find(row => row.id === canonicalSheetId('group', 'household'))
    const cell = household?.children?.find(row => row.id === canonicalSheetId('value', 'retirement', 'spendingFunded'))?.cells?.[2027]
    const reference = cell?.explanationRefs?.[0]
    const formula = reference && sheet.resolveExplanation?.(reference)?.formula
    if (!formula) throw new Error('Missing solo funded-spending formula')
    expect(cell?.value).toBe(10_200)
    expect(formula.filter(term => term.direction === 'add' && term.value > 0)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'income', value: close(7833.60) }),
      expect.objectContaining({ field: 'withdrawal', sourceId: `annual:2027:withdrawal:${RRSP}`, value: close(2366.40) }),
    ]))
    const total = formula.reduce((sum, term) => sum + (term.direction === 'add' ? term.value : -term.value), 0)
    expect(total).toBeCloseTo(10_200, 8)
    expect(formula.filter(term => term.direction === 'add' && term.value > 0)).toHaveLength(2)
  })

  it('stops the solo handoff when $7,833.60 CPP would exceed $5,100 spending without a cash carry account', () => {
    const { plan, evidence } = soloCppPlan(5_000)
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(prefix.blocked).toBeNull()
    expect(result).toMatchObject({
      rows: prefix.rows, state: prefix.state,
      blocked: { year: 2027, status: 'unsupported', issues: [{ detail: expect.stringMatching(/surplus|cash carry/i) }] },
      uncomputedYears: [2028], overallConclusionAvailable: false,
    })
  })

  it('describes CPP in the pre-withdrawal tax baseline of the localized household memo', () => {
    const result = ok(projectCanonicalCoverage(cppPlan(), cppSpending(), 3))
    const sheet = canonicalAnnualSheet(result, { scenarioId: 'cpp-tax-baseline', revision: 1 })
    const household = sheet.rows.find(row => row.id === canonicalSheetId('group', 'household'))
    const cell = household?.children?.find(row => row.id === canonicalSheetId('value', 'cash', 'withdrawalTaxIncrement'))?.cells?.[2027]
    const reference = cell?.explanationRefs?.[0]
    const summary = reference && sheet.resolveExplanation?.(reference)?.summary
    if (!summary) throw new Error('Missing household withdrawal tax explanation')
    expect(cell?.value).toBeCloseTo(ref.mixedTax * 1.02, 8)
    expect(annualSheetText(summary, 'en')).toMatch(/CPP.*income baseline before withdrawals/i)
    expect(annualSheetText(summary, 'fr')).toMatch(/RPC.*revenu avant retraits/i)
    expect(annualSheetText(summary, 'zh')).toMatch(/CPP.*提款前收入基线/)
  })

  it('links the calculated CPP display to the correct localized owner and amount provenance', () => {
    const result = ok(projectCanonicalCoverage(cppPlan(), cppSpending(), 3))
    const sheet = canonicalAnnualSheet(result, { scenarioId: 'cpp-fixture', revision: 1 })
    const locales = ['en', 'fr', 'zh']
    const check = (id: string, year: number, realAmount: number, labels: RegExp[]) => {
      const group = sheet.rows.find(row => row.id === canonicalSheetId('group', 'person', id))
      const row = group?.children?.find(row => row.id === canonicalSheetId('value', 'person', id, 'cpp'))
      const cell = row?.cells?.[year]
      const column = sheet.years.find(item => item.year === year)
      const reference = cell?.explanationRefs?.[0]
      const explanation = reference && sheet.resolveExplanation?.(reference)
      if (!cell || !column || !explanation) throw new Error(`Missing CPP explanation for ${id} in ${year}`)
      expect(cell).toMatchObject({ value: close(realAmount * 1.02 ** (year - 2026)), timing: 'during-year', basis: 'nominal-CAD' })
      expect(annualSheetDisplayValue(cell, column, 'real')).toBeCloseTo(realAmount, 8)
      expect(explanation).toMatchObject({ projectionYear: year, taxYear: 2026, rulePackage: 'CA-ON-tax-2026-legacy-v1' })
      const sources = explanation.sources?.filter(source => source.field === 'incomeSources.cpp')
      expect(sources).toMatchObject([{ id: `${id}:cpp`, granularity: 'input' }])
      const texts = locales.map(locale => annualSheetText(sources![0].label, locale))
      expect(new Set(texts).size).toBe(3)
      for (const [index, label] of labels.entries()) expect(texts[index]).toMatch(label)
      return explanation.summary
    }

    check(RETIREE, 2026, 0, [/manual.*2026.*60.*65.*before start/i, /manuelle.*2026.*60.*65.*avant le début/i, /手填.*2026.*60.*65.*尚未启领/])
    const method = check(RETIREE, 2027, ref.manualAt60, [/manual.*2026.*60.*65.*paying/i, /manuelle.*2026.*60.*65.*en paiement/i, /手填.*2026.*60.*65.*领取中/])
    if (!method) throw new Error('Missing CPP age adjustment explanation')
    expect(annualSheetText(method, 'en')).toMatch(/age.factor estimate.*same claim.age basis preserves the recorded amount/i)
    expect(annualSheetText(method, 'fr')).toMatch(/estimation par facteur d’âge.*base identique conserve le montant/i)
    expect(annualSheetText(method, 'zh')).toMatch(/年龄系数估算.*同启领年龄基准则保留原金额/)
    check(PARTNER, 2027, 0, [/statement.*2025.*61.*61.*before start/i, /relevé.*2025.*61.*61.*avant le début/i, /对账单.*2025.*61.*61.*尚未启领/])
    check(PARTNER, 2028, ref.statementAt61, [/statement.*2025.*61.*61.*paying/i, /relevé.*2025.*61.*61.*en paiement/i, /对账单.*2025.*61.*61.*领取中/])
  })

  it.each([known(800), { status: 'unknown', reason: 'PRIVATE benefit information' } as const])(
    'preserves the committed CPP prefix when an external benefit becomes active with amount $status', (annualAmount) => {
      const plan = cppPlan()
      const evidence = cppSpending()
      plan.incomeSources.push({ id: 'external-benefit', kind: 'pension', recipientId: PARTNER, startAge: 61, annualAmount, provenance: recorded })
      const cleanPrefix = ok(projectCanonicalCoverage(cppPlan(), evidence, 2))
      const result = ok(projectCanonicalCoverage(plan, evidence, 4))
      expect(cleanPrefix.blocked).toBeNull()
      expect(result).toMatchObject({
        rows: cleanPrefix.rows, state: cleanPrefix.state,
        blocked: { year: 2028, status: 'unsupported' },
        uncomputedYears: [2029], overallConclusionAvailable: false,
      })
    },
  )

  it('keeps the committed prefix when the household first reaches age 65', () => {
    const plan = cppPlan()
    const [self, partner] = plan.people
    Object.assign(self, { ageInBaseYear: 62, retirementAge: 63 })
    Object.assign(partner, { ageInBaseYear: 61, retirementAge: 63 })
    plan.lifeExpectancy = 68
    const [manual, statement] = plan.incomeSources
    manual.startAge = 63
    statement.startAge = 63
    partner.cppAmountSource!.premises = { retirementAge: 63 }
    const evidence = cppSpending()
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 3))
    const result = ok(projectCanonicalCoverage(plan, evidence, 5))
    expect(prefix.blocked).toBeNull()
    expect(result).toMatchObject({
      rows: prefix.rows, state: prefix.state,
      blocked: { year: 2029, status: 'unsupported', issues: [{ detail: expect.stringMatching(/65.*(?:OAS|GIS)/) }] },
      uncomputedYears: [2030], overallConclusionAvailable: false,
    })
  })

  it('stops when a CPP recipient would still draw employment wages', () => {
    const plan = cppPlan()
    plan.incomeSources[1].startAge = 60
    const evidence = cppSpending()
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(prefix.blocked).toBeNull()
    expect(result).toMatchObject({
      rows: prefix.rows, state: prefix.state,
      blocked: { year: 2027, status: 'unsupported', issues: [{ detail: expect.stringMatching(/payroll|working CPP/i) }] },
      uncomputedYears: [2028], overallConclusionAvailable: false,
    })
  })
})
