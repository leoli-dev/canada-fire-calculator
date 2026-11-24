import { describe, expect, it } from 'vitest'
import { annualSheetDisplayValue, annualSheetText } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { initializeState, projectAnnualCoverage, projectCanonicalCoverage, type KernelResult } from '../annualState'
import type { InputsV2 } from '../model'
import { runProjection } from '../projection'
import { householdOasFixture, householdOasReference as ref } from './fixtures/annualHouseholdOas'
import { known, recorded, RETIREE, RRSP } from './fixtures/retirementSettlement'
import { PARTNER } from './fixtures/staggeredHousehold'

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

const close = (value: number) => expect.closeTo(value, 4)
const workingClaimIssue = { code: 'unsupported', detail: 'household OAS recipient must be retired before payable OAS settlement' }

function oasMemo(result: ReturnType<typeof projectCanonicalCoverage>, personId: string, year: number, field: 'oasGross' | 'oasRecovery' | 'oasNet') {
  const sheet = canonicalAnnualSheet(ok(result), { scenarioId: 'household-oas', revision: 1 })
  const group = sheet.rows.find(row => row.id === canonicalSheetId('group', 'person', personId))
  const cell = group?.children?.find(row => row.id === canonicalSheetId('value', 'person', personId, field))?.cells?.[year]
  const column = sheet.years.find(item => item.year === year)
  const explanation = cell?.explanationRefs && sheet.resolveExplanation?.(cell.explanationRefs[0])
  if (!cell || !column || !explanation) throw new Error(`Missing ${field} memo for ${personId} in ${year}`)
  return { amount: annualSheetDisplayValue(cell, column, 'real'), explanation }
}

type CorruptEvidence = (plan: InputsV2) => void
const invalidEvidence: { label: string; mutate: CorruptEvidence; reason: RegExp }[] = [
  { label: 'no partner exclusions', mutate: plan => { delete plan.annualBenefitsEvidence![PARTNER] }, reason: /GIS.*Allowance.*other.benefit.*evidence/i },
  { label: 'missing Allowance exclusion', mutate: plan => { Reflect.deleteProperty(plan.annualBenefitsEvidence![PARTNER], 'allowance') }, reason: /GIS.*Allowance.*other.benefit.*evidence/i },
  { label: 'unknown GIS exclusion', mutate: plan => { Reflect.set(plan.annualBenefitsEvidence![PARTNER].gis, 'status', 'unknown') }, reason: /GIS.*Allowance.*other.benefit.*evidence/i },
  { label: 'estimated other-benefit exclusion', mutate: plan => { plan.annualBenefitsEvidence![PARTNER].otherBenefits.provenance = { ...recorded, origin: 'estimated' } }, reason: /GIS.*Allowance.*other.benefit.*evidence/i },
  { label: 'stale partner statement', mutate: plan => { plan.people[1].oasAmountSource!.premises = { retirementAge: 64 } }, reason: /OAS.*premise/i },
  { label: 'stale zero partner statement', mutate: plan => {
    plan.people[1].oasAnnualAt65 = 0
    plan.people[1].oasAmountSource!.premisesNeedReview = true
    plan.incomeSources = plan.incomeSources.filter(source => source.id !== `${PARTNER}:oas`)
  }, reason: /OAS.*premise/i },
]

describe('canonical two-person Ontario OAS', () => {
  it('prices each recipient and regular tax separately through a mixed year and full retirement', () => {
    const { plan, evidence } = householdOasFixture()
    const input = structuredClone({ plan, evidence })
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result).toMatchObject({ blocked: null, uncomputedYears: [], overallConclusionAvailable: false })
    const [working, mixed, retired] = result.rows
    expect(working).toMatchObject({
      year: 2026, cashLedger: { income: 120_000, benefits: 0, spending: ref.working.spending, unallocated: 0 },
      byAccount: { [RRSP]: { opening: ref.opening, closing: ref.opening * 1.02, withdrawal: 0 } },
    })

    for (const [index, row] of [mixed, retired].entries()) {
      const cpi = (1 + ref.inflation) ** (index + 1)
      const isMixed = index === 0
      const owner = isMixed ? ref.partial : ref.full
      const partner = isMixed ? ref.working.partner : { wage: 0, taxable: ref.partnerGross + ref.partnerCpp, payroll: 0, tax: 0 }
      const partnerOas = isMixed ? 0 : ref.partnerGross
      const partnerCpp = isMixed ? 0 : ref.partnerCpp
      const income = ref.ownerCpp + partner.wage + partnerCpp
      const benefits = owner.net + partnerOas
      const spending = isMixed ? ref.transitionSpending : ref.retirementSpending
      const tax = owner.tax + partner.tax
      expect(row).toMatchObject({
        year: 2027 + index,
        byPerson: {
          [RETIREE]: { age: 65 + index, earnedIncome: 0, income: close(ref.ownerCpp * cpi), cpp: close(ref.ownerCpp * cpi),
            benefits: close(owner.net * cpi), oasGross: close(ref.ownerGross * cpi), oasRecovery: close(owner.recovery * cpi), oasNet: close(owner.net * cpi) },
          [PARTNER]: { age: 64 + index, earnedIncome: close(partner.wage * cpi), income: close((partner.wage + partnerCpp) * cpi),
            cpp: close(partnerCpp * cpi), benefits: close(partnerOas * cpi),
            oasGross: close(partnerOas * cpi), oasRecovery: 0, oasNet: close(partnerOas * cpi) },
        },
        taxLedger: {
          [RETIREE]: { taxableIncome: close(owner.taxable * cpi), tax: close(owner.tax * cpi) },
          [PARTNER]: { taxableIncome: close(partner.taxable * cpi), tax: close(partner.tax * cpi) },
        },
        cashLedger: { income: close(income * cpi), benefits: close(benefits * cpi), tax: close(tax * cpi), spending: close(spending * cpi), unallocated: 0 },
        payrollContributions: close(partner.payroll * cpi),
        byAccount: { [RRSP]: { ownerId: RETIREE, opening: close((ref.opening - (isMixed ? 0 : ref.partial.draw)) * cpi), withdrawal: close(owner.draw * cpi) } },
        workingSettlement: {
          evaluationPhase: 'pre-withdrawal-baseline',
          evaluation: { byPerson: {
            [RETIREE]: { benefits: close(ref.ownerGross * cpi), taxableIncome: close((ref.ownerCpp + ref.ownerGross) * cpi) },
            [PARTNER]: { benefits: close(partnerOas * cpi), taxableIncome: close(partner.taxable * cpi) },
          } },
          household: { phase: isMixed ? 'mixed' : 'both-retired', byPerson: {
            [RETIREE]: { phase: 'retired', oas: { recoveryReal: close(owner.recovery), netReal: close(owner.net) } },
            [PARTNER]: { phase: isMixed ? 'working' : 'retired', oas: { recoveryReal: 0, netReal: close(partnerOas) } },
          } },
        },
        householdWithdrawalSettlement: {
          startCpi: cpi, accountId: RRSP, ownerId: RETIREE, withdrawal: close(owner.draw * cpi), taxTotal: close(tax * cpi),
          baselineBenefits: close((ref.ownerGross + partnerOas) * cpi), settledBenefits: close(benefits * cpi),
          spendingDue: close(spending * cpi), spendingFunded: close(spending * cpi), spendingUnmet: close(0),
          postings: [{ accountId: RRSP, ownerId: RETIREE, kind: 'rrsp', amount: close(owner.draw * cpi) }],
        },
      })
      const cash = row.cashLedger
      expect(cash.income + cash.benefits + row.byAccount[RRSP].withdrawal - cash.tax - row.payrollContributions!).toBeCloseTo(cash.spending, 4)
    }
    expect(result.state.benefitIncomeLag).toEqual({
      [RETIREE]: known(close(ref.full.taxable * 1.02 ** 2)),
      [PARTNER]: known(close(ref.partnerCpp * 1.02 ** 2)),
    })
    expect(result.state.byAccount[RRSP].balance).toBeCloseTo((ref.opening - ref.partial.draw - ref.full.draw) * 1.02 ** 3, 4)
    expect({ plan, evidence }).toEqual(input)
  })

  it('shows household OAS source, exclusions and post-withdrawal recovery income on the correct person', () => {
    const { plan, evidence } = householdOasFixture()
    const result = projectCanonicalCoverage(plan, evidence, 3)
    for (const [id, recovery, income] of [[RETIREE, ref.full.recovery, ref.full.recoveryIncome], [PARTNER, 0, 16_000]] as const) {
      const { amount, explanation } = oasMemo(result, id, 2028, 'oasRecovery')
      expect(amount).toBeCloseTo(recovery, 4)
      expect(explanation).toMatchObject({ projectionYear: 2028, taxYear: 2026, rulePackage: 'CA-ON-tax-2026-legacy-v1' })
      const sources = explanation.sources!
      const oasSource = sources.find(source => source.field === 'incomeSources.oas')
      expect(oasSource?.id).toBe(`${id}:oas`)
      expect(annualSheetText(oasSource!.label, 'en')).toContain(String(income))
      expect(sources.filter(source => source.field?.startsWith('annualBenefitsEvidence.')).map(source => [source.id, source.field]))
        .toEqual(['gis', 'allowance', 'otherBenefits'].map(field => [id, `annualBenefitsEvidence.${field}`]))
      const gis = sources.find(source => source.field === 'annualBenefitsEvidence.gis')!
      expect(annualSheetText(gis.label, 'fr')).toMatch(/SRG.*exclu/)
      expect(annualSheetText(gis.label, 'zh')).toMatch(/GIS 补助.*已排除/)
      const allowance = sources.find(source => source.field === 'annualBenefitsEvidence.allowance')!
      expect(annualSheetText(allowance.label, 'fr')).toMatch(/Allocation.*sans objet/)
      expect(annualSheetText(allowance.label, 'zh')).toMatch(/配偶津贴.*不适用/)
    }
  })

  it('keeps a retired partner deferred until the verified age-66 claim', () => {
    const { plan, evidence } = householdOasFixture()
    const partnerSource = plan.incomeSources.find(source => source.id === `${PARTNER}:oas`)!
    partnerSource.startAge = 66
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result.blocked).toBeNull()
    const [, , deferred, receiving] = result.rows
    expect(deferred.byPerson[PARTNER]).toMatchObject({ age: 65, earnedIncome: 0, benefits: 0, oasGross: 0, oasRecovery: 0, oasNet: 0 })
    const amount = ref.partnerGross * 1.072 * 1.02 ** 3
    expect(receiving.byPerson[PARTNER]).toMatchObject({ age: 66, earnedIncome: 0, benefits: close(amount), oasGross: close(amount), oasRecovery: 0, oasNet: close(amount) })
    expect(deferred.workingSettlement).toMatchObject({ household: { byPerson: {
      [PARTNER]: { oas: { sourceId: `${PARTNER}:oas`, startAge: 66, source: 'statement', grossReal: 0 } },
    } } })
  })

  function workingClaimFixture({ baseAge, startAge, spending }: { baseAge: number; startAge: number; spending: number }) {
    const { plan, evidence } = householdOasFixture()
    const [self, partner] = plan.people
    Object.assign(self, { ageInBaseYear: baseAge, retirementAge: 67, cppAnnualAt65: 0, earnedIncome: known(0) })
    Object.assign(partner, { ageInBaseYear: baseAge - 1, retirementAge: 66, cppAnnualAt65: 0, oasAnnualAt65: 0, earnedIncome: known(0) })
    partner.oasAmountSource!.premises = { retirementAge: 66 }
    plan.incomeSources = plan.incomeSources.filter(source => source.id === `${RETIREE}:oas`)
    plan.incomeSources[0].startAge = startAge
    plan.budget = { kind: 'incomeBudget', workingSpending: spending, retirementSpending: ref.retirementSpending }
    evidence.workingSpending = known(spending)
    return { plan, evidence }
  }

  it('refuses a working recipient even when OAS alone would exactly fund working spending', () => {
    const { plan, evidence } = workingClaimFixture({ baseAge: 65, startAge: 65, spending: ref.ownerGross })
    const opening = ok(initializeState(plan))
    const input = structuredClone({ plan, evidence })
    expect(ok(projectCanonicalCoverage(plan, evidence, 3))).toMatchObject({
      rows: [], state: opening, uncomputedYears: [2027, 2028], overallConclusionAvailable: false,
      blocked: { year: 2026, status: 'unsupported', issues: [workingClaimIssue] },
    })
    expect({ plan, evidence }).toEqual(input)
  })

  it('commits deferred and known-zero working years, but preserves the prior row when a working claim starts', () => {
    const { plan, evidence } = workingClaimFixture({ baseAge: 64, startAge: 67, spending: 0 })
    const deferred = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(deferred.blocked).toBeNull()
    expect(deferred.rows[1]).toMatchObject({
      year: 2027, cashLedger: { income: 0, benefits: 0, tax: 0, spending: 0 },
      byPerson: { [RETIREE]: { age: 65, oasNet: 0 }, [PARTNER]: { age: 64, oasNet: 0 } },
      workingSettlement: { household: { phase: 'both-working', byPerson: {
        [RETIREE]: { oas: { sourceId: `${RETIREE}:oas`, startAge: 67, grossReal: 0 } },
        [PARTNER]: { oas: { sourceId: null, startAge: null, grossReal: 0 } },
      } } },
    })
    plan.incomeSources[0].startAge = 65
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 1))
    expect(prefix.blocked).toBeNull()
    expect(prefix.rows[0].cashLedger).toEqual(deferred.rows[0].cashLedger)
    expect(ok(projectCanonicalCoverage(plan, evidence, 3))).toMatchObject({
      rows: prefix.rows,
      state: prefix.state, uncomputedYears: [2028], overallConclusionAvailable: false,
      blocked: { year: 2027, status: 'unsupported', issues: [workingClaimIssue] },
    })
  })

  it.each(invalidEvidence)('leaves the opening ledger intact with $label', ({ mutate, reason }) => {
    const { plan, evidence } = householdOasFixture()
    mutate(plan)
    const opening = ok(initializeState(plan))
    const input = structuredClone({ plan, evidence })
    const result = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(result).toMatchObject({
      rows: [], state: opening, uncomputedYears: [2027, 2028],
      blocked: { year: 2026, status: 'unsupported', issues: [{ detail: expect.stringMatching(reason) }] },
    })
    expect({ plan, evidence }).toEqual(input)
  })

  it('keeps a verified source-less zero equivalent to a dated zero without erasing the other recipient', () => {
    const { plan, evidence } = householdOasFixture()
    plan.people[1].oasAnnualAt65 = 0
    const partnerSource = plan.incomeSources.find(source => source.id === `${PARTNER}:oas`)!
    partnerSource.annualAmount = known(0)
    const dated = ok(projectCanonicalCoverage(plan, evidence, 3))
    plan.incomeSources = plan.incomeSources.filter(source => source.id !== partnerSource.id)
    const absent = ok(projectCanonicalCoverage(plan, evidence, 3))
    for (const result of [dated, absent]) {
      expect(result.blocked).toBeNull()
      expect(result.rows[1].byPerson[RETIREE].oasRecovery).toBeCloseTo(ref.partial.recovery * 1.02, 4)
      expect(result.rows[2].byPerson[PARTNER]).toMatchObject({ oasGross: 0, oasRecovery: 0, oasNet: 0, cpp: close(ref.partnerCpp * 1.02 ** 2) })
    }
    expect(dated.rows.map(row => row.cashLedger)).toEqual(absent.rows.map(row => row.cashLedger))
    expect(dated.rows.map(row => row.taxLedger)).toEqual(absent.rows.map(row => row.taxLedger))
    expect(dated.state).toEqual(absent.state)
    expect(absent.rows[2].workingSettlement).toMatchObject({ household: { byPerson: {
      [PARTNER]: { oas: { sourceId: null, startAge: null, source: 'statement', grossReal: 0 } },
    } } })
  })

  it('reconciles the spending funded and pre-withdrawal cash explanation terms', () => {
    const { plan, evidence } = householdOasFixture()
    const sheet = canonicalAnnualSheet(ok(projectCanonicalCoverage(plan, evidence, 3)), { scenarioId: 'household-oas-formulas', revision: 1 })
    const household = sheet.rows.find(row => row.id === canonicalSheetId('group', 'household'))
    for (const [domain, field, oasAmounts] of [
      ['retirement', 'spendingFunded', [ref.partial.net, ref.partnerGross]],
      ['cash', 'canonicalNetCash', [ref.ownerGross, ref.ownerGross + ref.partnerGross]],
    ] as const) {
      const row = household?.children?.find(item => item.id === canonicalSheetId('value', domain, field))
      for (const [index, year] of [2027, 2028].entries()) {
        const cell = row?.cells?.[year]
        const formula = cell?.explanationRefs && sheet.resolveExplanation?.(cell.explanationRefs[0])?.formula
        if (!cell || !formula) throw new Error(`Missing ${field} formula in ${year}`)
        expect(formula.filter(term => term.field === 'benefits')).toMatchObject([
          { direction: 'add', value: close(oasAmounts[index] * (1 + ref.inflation) ** (index + 1)) },
        ])
        expect(formula.some(term => term.field === 'oasRecovery')).toBe(false)
        const total = formula.reduce((sum, term) => sum + (term.direction === 'add' ? term.value : -term.value), 0)
        expect(total).toBeCloseTo(cell.value!, 4)
      }
    }
  })

  it('does not commit the first year with an active unknown receipt', () => {
    const { plan, evidence } = householdOasFixture()
    const prefix = ok(projectCanonicalCoverage(plan, evidence, 2))
    expect(prefix.blocked).toBeNull()
    plan.incomeSources.push({ id: 'partner-unconfirmed-other', kind: 'other', recipientId: PARTNER, startAge: 65,
      annualAmount: { status: 'unknown', reason: 'No amount recorded' }, provenance: recorded })
    const input = structuredClone({ plan, evidence })
    const result = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(result).toMatchObject({
      rows: prefix.rows, state: prefix.state, uncomputedYears: [2029], overallConclusionAvailable: false,
      blocked: { year: 2028, status: 'unsupported', issues: [{ detail: expect.stringMatching(/active.*income source/i) }] },
    })
    expect({ plan, evidence }).toEqual(input)
  })

  it('isolates the annual OAS evidence from legacy projections and provider-supplied ledgers', () => {
    const { plan } = householdOasFixture()
    const withoutEvidence = structuredClone(plan)
    delete withoutEvidence.annualBenefitsEvidence
    expect(runProjection(plan.legacyProjection, undefined, plan, { captureAnnualDetails: true }))
      .toEqual(runProjection(withoutEvidence.legacyProjection, undefined, withoutEvidence, { captureAnnualDetails: true }))

    for (const candidate of [plan, withoutEvidence]) candidate.budget = {
      kind: 'savingsBudget', annualNetSavings: 0, retirementSpending: ref.retirementSpending,
      debtIncluded: known(true), taxBenefitIncluded: known(true),
    }
    const entry = (income: number, tax: number, benefits: number) => ({
      income, earnedIncome: income, tax, benefits, spending: income - tax + benefits, taxableIncome: income, benefitIncomeForNextYear: known(income),
    })
    const providers = {
      evaluate: () => ({ byPerson: { [RETIREE]: entry(400, 40, 0), [PARTNER]: entry(200, 20, 10) } }),
      returns: () => 0,
    }
    const provided = ok(projectAnnualCoverage(plan, ok(initializeState(plan)), 3, providers))
    expect(provided).toEqual(ok(projectAnnualCoverage(withoutEvidence, ok(initializeState(withoutEvidence)), 3, providers)))
    expect(provided).toMatchObject({
      evaluationBasis: 'provider-supplied',
      rows: [{ cashLedger: { income: 600, tax: 60, benefits: 10, spending: 550 } }],
      blocked: { year: 2027, status: 'unsupported', causes: ['retirement'] }, uncomputedYears: [2028],
    })
    expect(provided.rows[0].byPerson[PARTNER].oasNet).toBeUndefined()
  })
})
