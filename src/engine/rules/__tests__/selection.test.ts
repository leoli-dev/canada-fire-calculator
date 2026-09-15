import { describe, expect, it } from 'vitest'
import { selectTaxRules, selectBenefitRules, selectGisRules, publishRulePack } from '../index'

// Independent published boundary fixture, not calculated from taxData.ts.
// CRA 2025/2026 tax-rate pages and CCB payment-period pages are linked in the pack.
describe('dated rule selection', () => {
  it('selects the published cross-year boundaries rather than relabelling 2026', () => {
    const on25 = selectTaxRules('ON', 2025)
    const on26 = selectTaxRules('ON', 2026)
    expect(on25.federal.brackets[0]).toEqual({ upTo: 57375, rate: 0.145 })
    expect(on25.provincial.brackets.slice(0, 2)).toEqual([
      { upTo: 52886, rate: 0.0505 }, { upTo: 105775, rate: 0.0915 },
    ])
    expect(on26.federal.brackets[0]).toEqual({ upTo: 58523, rate: 0.14 })
    expect(on26.provincial.brackets.slice(0, 2)).toEqual([
      { upTo: 53891, rate: 0.0505 }, { upTo: 107785, rate: 0.0915 },
    ])
    expect(on25.assumedFutureRule).toBe(false)
    expect(on26.assumedFutureRule).toBe(false)
    expect(selectBenefitRules('CCB', '2025-07/2026-06').values.maxUnder6).toBe(7997)
    expect(selectBenefitRules('CCB', '2026-07/2027-06').values).toEqual({
      maxUnder6: 8157, max6to17: 6883, th1: 38237, th2: 82847,
      rate1: [0.07, 0.135, 0.19, 0.23], rate2: [0.032, 0.057, 0.08, 0.095],
      basePhaseOutAmounts: [3123, 6022, 8476, 10260],
    })
  })

  it('publishes each CCB parameter with its own dated source', () => {
    // BE-38 B2: the pack is now what the computation reads, so `rate1`/`rate2`
    // and the published phase-out amounts must be sourced like the amounts and
    // thresholds rather than implied by a limitation string.
    const packs = [selectBenefitRules('CCB', '2025-07/2026-06'), selectBenefitRules('CCB', '2026-07/2027-06')]
    for (const pack of packs) {
      expect(pack.values.rate1).toHaveLength(4)
      expect(pack.values.rate2).toHaveLength(4)
      expect(pack.values.basePhaseOutAmounts).toHaveLength(4)
      // The retired 2025 ESDC news release now returns HTTP 404, so neither
      // pack cites it: the 2025 amounts come from the live CRA indexation page
      // and the 2026 ones from the live ESDC 2026 release.
      expect(pack.fieldSources.amounts).toMatch(/adjustment-personal-income-tax-benefit-amounts|\/news\/2026\/07\//)
      expect(pack.fieldSources.thresholds).toContain('adjustment-personal-income-tax-benefit-amounts')
      expect(pack.fieldSources.rates).toContain('laws-lois.justice.gc.ca')
      expect(pack.unsupportedPaths.map(path => path.id)).toContain('ccb-prior-year-afni')
      expect(pack.unsupportedPaths.map(path => path.id)).toContain('ccb-provincial-top-ups')
    }
    // The 2025-26 calculation sheet corroborates the 2025 amounts.
    expect(packs[0].additionalSourceURLs).toContain(
      'https://www.canada.ca/en/revenue-agency/services/child-family-benefits/canada-child-benefit/canada-child-benefit-ccb-calculation-sheet-july-2025-june-2026-payments-2024-tax-year.html')
    expect(packs[1].fieldSources.amounts).toContain('/news/2026/07/')
  })

  it('refuses an unknown benefit program and an unpublished period with distinct reasons', () => {
    // An unknown program is never answered with the CCB pack, and never with a
    // generic message that reads the same as a malformed period.
    expect(() => selectBenefitRules('GST', '2026-07/2027-06')).toThrow(/unknown benefit program "GST".*CCB/)
    // A period that is not a whole July-June program year is never shifted into
    // one; the reason says which shape was expected.
    for (const malformed of ['2026', '2026-07', '2026-07/2028-06', '2026-06/2027-07', '2026-07/2026-06']) {
      expect(() => selectBenefitRules('CCB', malformed)).toThrow(/not a whole July-to-June program year/)
    }
    // A period before the published ones is refused with the published list,
    // not priced at the first published period's amounts.
    expect(() => selectBenefitRules('CCB', '2024-07/2025-06')).toThrow(/published periods are 2025-07\/2026-06, 2026-07\/2027-06/)
    // A later period without a rate is refused; the refusal names the latest
    // published period and the rate it needs.
    expect(() => selectBenefitRules('CCB', '2027-07/2028-06')).toThrow(/not published \(latest published period 2026-07\/2027-06\)/)
    expect(() => selectBenefitRules('CCB', '2027-07/2028-06', { annualRate: -1 })).toThrow(/between 0 and 1/)
  })

  it('projects a beyond-publication period from the latest published pack, once per year', () => {
    const assumed = selectBenefitRules('CCB', '2027-07/2028-06', { annualRate: 0.02 })
    const published = selectBenefitRules('CCB', '2026-07/2027-06')
    expect(assumed.assumedFutureRule).toBe(true)
    expect(assumed.basedOnRuleId).toBe('CA-CCB-2026-07-v1')
    expect(assumed.basedOnPaymentPeriod).toBe('2026-07/2027-06')
    expect(assumed.incomeTaxYear).toBe(2026)
    // Exactly one elapsed program year: the published figures × 1.02, once.
    expect(assumed.values.maxUnder6).toBe(Math.round(published.values.maxUnder6 * 1.02))
    expect(assumed.values.max6to17).toBe(Math.round(published.values.max6to17 * 1.02))
    expect(assumed.values.th1).toBe(Math.round(published.values.th1 * 1.02))
    expect(assumed.values.th2).toBe(Math.round(published.values.th2 * 1.02))
    // The rates and the published-year phase-out amounts are not indexed.
    expect(assumed.values.rate1).toEqual(published.values.rate1)
    expect(assumed.values.rate2).toEqual(published.values.rate2)
    expect(assumed.values.basePhaseOutAmounts).toEqual(published.values.basePhaseOutAmounts)
    // Two program years means two applications, from the published pack — the
    // projection never starts from an already-indexed pack.
    const later = selectBenefitRules('CCB', '2028-07/2029-06', { annualRate: 0.02 })
    expect(later.values.maxUnder6).toBe(Math.round(published.values.maxUnder6 * 1.02 ** 2))
    // A frozen pack carries its values across unchanged: a frozen value does
    // not inflate in an assumed period.
    expect(selectBenefitRules('CCB', '2026-07/2027-06').indexationRule).toBe('cpi-assumption')
  })

  it('rejects a CCB pack whose rates or unsupported list are incomplete', () => {
    const ccb = selectBenefitRules('CCB', '2026-07/2027-06')
    // A malformed pack is a publication-time failure, so the fixture is built
    // as a loose record rather than by lying about the type.
    const packWith = (values: Record<string, unknown>, rest: Record<string, unknown> = {}) =>
      ({ ...ccb, values: { ...ccb.values, ...values }, ...rest })
    expect(() => publishRulePack(ccb)).not.toThrow()
    // A short rate row would price a larger family off `undefined`.
    expect(() => publishRulePack(packWith({ rate1: [0.07, 0.135] }))).toThrow()
    expect(() => publishRulePack(packWith({ rate2: [0.032, 0.057, 0.08, 0.095, 0.1] }))).toThrow()
    // A second-threshold rate above the first would accelerate the reduction.
    expect(() => publishRulePack(packWith({ rate2: [0.5, 0.057, 0.08, 0.095] }))).toThrow()
    // Rates must be ordered by family size and strictly positive.
    expect(() => publishRulePack(packWith({ rate1: [0.135, 0.07, 0.19, 0.23] }))).toThrow()
    expect(() => publishRulePack(packWith({ rate1: [0, 0.135, 0.19, 0.23] }))).toThrow()
    expect(() => publishRulePack(packWith({ basePhaseOutAmounts: [0, 6022, 8476, 10260] }))).toThrow()
    // The known gaps have to be named, and the rate source has to be a URL.
    expect(() => publishRulePack({ ...ccb, unsupportedPaths: [] })).toThrow()
    expect(() => publishRulePack({ ...ccb, fieldSources: { ...ccb.fieldSources, rates: '' } })).toThrow()
    // An assumed pack must say which published period it was indexed from.
    const assumed = selectBenefitRules('CCB', '2027-07/2028-06', { annualRate: 0.02 })
    expect(() => publishRulePack({ ...assumed, basedOnPaymentPeriod: undefined })).toThrow()
  })

  it('rejects unknown past periods and jurisdictions, marks future assumptions', () => {
    expect(() => selectTaxRules('ON', 2024)).toThrow()
    expect(() => selectTaxRules('ZZ', 2026)).toThrow()
    const future = selectTaxRules('ON', 2028, { annualRate: 0.02 })
    expect(future.assumedFutureRule).toBe(true)
    expect(future.provincial.brackets[2].upTo).toBe(150000)
    expect(future.provincial.brackets[3].upTo).toBe(220000)
    expect(future.federal.brackets[0].upTo).toBe(Math.round(58523 * 1.02 ** 2))
    expect(selectTaxRules('ON', 2026).federal.brackets[0].upTo).toBe(58523)
    expect(selectTaxRules('ON', 2028, { annualRate: 0.02 })).toEqual(future)
    expect(future.basedOnRuleId).toBe('CA-ON-tax-2026-legacy-v1')
    expect(selectTaxRules('MB', 2028, { annualRate: 0.02 }).provincial.brackets[0].upTo).toBe(47000)
    // The indexed second Ontario threshold must never overtake its frozen $150,000 successor.
    const beforeCollision = selectTaxRules('ON', 2041, { annualRate: 0.021 })
    expect(beforeCollision.provincial.brackets[1].upTo).toBe(Math.round(107785 * 1.021 ** 15))
    expect(beforeCollision.provincial.brackets[2].upTo).toBe(150000)
    expect(() => publishRulePack(beforeCollision)).not.toThrow()
    expect(() => selectTaxRules('ON', 2042, { annualRate: 0.021 })).toThrow(/collision|overlap|ordered/i)
    expect(() => selectBenefitRules('CCB', '2024-07/2025-06')).toThrow(/published periods are 2025-07\/2026-06, 2026-07\/2027-06/)
    expect(selectBenefitRules('CCB', '2027-07/2028-06', { annualRate: 0.02 }).values.maxUnder6).toBe(8320)
  })

  it('selects the published GIS quarter and refuses one that is not published', () => {
    const gis = selectGisRules()
    expect([gis.id, gis.paymentPeriod, gis.basedOnIncomeYear])
      .toEqual(['CA-OAS-GIS-2026-Q3-v1', '2026-07/2026-09', 2025])
    expect(gis.categories.single).toMatchObject({ maxMonthly: 1123.17, annualCutoff: 22800 })
    expect(gis.categories['couple-both-pensioners']).toMatchObject({ maxMonthly: 2 * 676.09, annualCutoff: 30096 })
    expect(gis.categories['couple-partner-allowance']).toMatchObject({ maxMonthly: 676.09, annualCutoff: 42144 })
    expect(gis.categories['couple-partner-no-oas-no-allowance']).toMatchObject({ maxMonthly: 1123.17, annualCutoff: 54624 })
    expect(gis.allowance).toMatchObject({ maxMonthly: 1428.06, annualCutoff: 42144, topUpIncome: 8800 })
    expect(gis.unsupportedPaths.map(p => p.id)).toContain('prior-year-base-period')
    // A quarter the pack does not publish has no amounts at all: there is no
    // indexation mechanism for a quarterly table, so a new quarter needs a new
    // pack rather than an interpolated number.
    expect(() => selectGisRules('2026-10/2026-12')).toThrow()
    // The selector hands back a copy, so a caller cannot mutate the pinned pack.
    selectGisRules().categories.single.annualCutoff = 1
    expect(selectGisRules().categories.single.annualCutoff).toBe(22800)
  })

  it('rejects a GIS pack whose categories, cut-offs or sources are incomplete', () => {
    const gis = selectGisRules()
    const withSingle = (single: object) => ({
      ...gis, categories: { ...gis.categories, single: { ...gis.categories.single, ...single } },
    })
    expect(() => publishRulePack(gis)).not.toThrow()
    expect(() => publishRulePack({ ...gis, categories: {} })).toThrow()
    expect(() => publishRulePack(withSingle({ annualCutoff: 0 }))).toThrow()
    expect(() => publishRulePack(withSingle({ reductionSegments: [] }))).toThrow()
    expect(() => publishRulePack(withSingle({ reductionSegments: [{ rate: -1, upTo: Infinity }] }))).toThrow()
    expect(() => publishRulePack(withSingle({
      reductionSegments: [{ rate: 0, upTo: 100 }, { rate: 0.5, upTo: 50 }],
    }))).toThrow()
    expect(() => publishRulePack({ ...gis, allowance: { ...gis.allowance, topUpIncome: 99999 } })).toThrow()
    expect(() => publishRulePack({ ...gis, allowance: { ...gis.allowance, reductionSegments: [] } })).toThrow()
    // A fitted reduction must cite the table it was fitted to, and its
    // recorded bound must be a small finite number.
    expect(() => publishRulePack(withSingle({ fieldSources: { ...gis.categories.single.fieldSources, reductionSegments: '' } }))).toThrow()
    expect(() => publishRulePack(withSingle({ maxMonthlyDeviation: 0 }))).toThrow()
    expect(() => publishRulePack(withSingle({ maxMonthlyDeviation: 99 }))).toThrow()
    // Every path the pack does not model needs a machine-readable reason.
    expect(() => publishRulePack({ ...gis, unsupportedPaths: [] })).toThrow()
    expect(() => publishRulePack({ ...gis, unsupportedPaths: [{ id: 'x', reason: '' }] })).toThrow()
    expect(() => publishRulePack({ ...gis, unsupportedPaths: [{ id: 'x', reason: 'y' }, { id: 'x', reason: 'z' }] })).toThrow()
    expect(() => publishRulePack({ ...gis, basedOnIncomeYear: 2024 })).toThrow()
    expect(() => publishRulePack({ ...gis, paymentPeriod: '2026-10/2026-12' })).toThrow()
    // Exactly one shape discriminator per pack: a GIS pack is never accepted
    // through the CCB or FHSA branch.
    expect(() => publishRulePack({ ...gis, program: 'CCB' })).toThrow()
    expect(() => publishRulePack({ ...gis, annualLimit: 8000 })).toThrow()
  })

  it('blocks publication without complete provenance and policy metadata', () => {
    expect(() => publishRulePack({ id: 'broken', jurisdiction: 'ON', taxYear: 2026 })).toThrow()
  })

  it('rejects malformed pack content before publication', () => {
    const valid = selectTaxRules('ON', 2026)
    expect(() => publishRulePack({ ...valid, jurisdiction: 'ZZ' })).toThrow()
    expect(() => publishRulePack({ ...valid, federal: { bpa: NaN, brackets: [] } })).toThrow()
    expect(() => publishRulePack({ ...valid, effectiveDate: '2026-02-31' })).toThrow()
    expect(() => publishRulePack({ ...valid, verifiedAt: '2026-13-01' })).toThrow()
    expect(() => publishRulePack({ ...valid, fieldSources: { ...valid.fieldSources, federalBpa: '' } })).toThrow()
    expect(() => publishRulePack({ ...valid, fieldAdditionalSources: { federalBrackets: [''] } })).toThrow()
    expect(() => publishRulePack({ ...valid, federal: { ...valid.federal, brackets: [
      { upTo: Number.NaN, rate: 0.1 }, { upTo: Infinity, rate: 0.2 },
    ] } })).toThrow()
    expect(() => publishRulePack({ ...valid, provincial: { ...valid.provincial, brackets: [
      { upTo: 1000, rate: 0.2 }, { upTo: 500, rate: 0.1 }, { upTo: Infinity, rate: 0.3 },
    ] } })).toThrow()
    expect(() => selectTaxRules('ON', 2027, { annualRate: -1 })).toThrow()
    expect(() => selectBenefitRules('CCB', '2027-07/2028-06', { annualRate: -1 })).toThrow()
    expect(() => selectBenefitRules('CCB', '3060-07/3061-06', { annualRate: 1 })).toThrow()
    expect(() => publishRulePack(selectBenefitRules('CCB', '2027-07/2028-06', { annualRate: 0.02 }))).not.toThrow()
    const ccb = selectBenefitRules('CCB', '2026-07/2027-06')
    expect(() => publishRulePack({ ...ccb, paymentPeriod: '2026-07/2026-06' })).toThrow()
    expect(() => publishRulePack({ ...ccb, values: { ...ccb.values, th1: Infinity } })).toThrow()
  })

  it('links each pinned field to dated official evidence and records MB conflict', () => {
    const on25 = selectTaxRules('ON', 2025)
    const on26 = selectTaxRules('ON', 2026)
    expect(on25.fieldSources.federalBrackets).toContain('/2025/')
    expect(on25.fieldSources.federalBpa).toContain('/2025/')
    expect(on25.fieldSources.provincialBrackets).toContain('/2025/')
    expect(on25.fieldSources.provincialBpa).toContain('/2025/')
    expect(on26.fieldSources.federalBrackets).toContain('/2026/')
    expect(on26.fieldSources.provincialBpa).toContain('/2026/')
    expect(selectBenefitRules('CCB', '2025-07/2026-06').fieldSources.amounts)
      .toContain('adjustment-personal-income-tax-benefit-amounts')
    expect(selectBenefitRules('CCB', '2026-07/2027-06').fieldSources.amounts).toContain('/2026/')
    expect(selectTaxRules('MB', 2026).sourceConflict).toContain('$47,564')
    expect(selectTaxRules('MB', 2026).sourceConflict).toMatch(/Resolved 2026-09-15/)
    const bc = selectTaxRules('BC', 2026)
    const nl = selectTaxRules('NL', 2026)
    const pe = selectTaxRules('PE', 2026)
    expect(bc.provincial.brackets[0].rate).toBe(0.056)
    expect(bc.fieldSources.provincialBrackets).toContain('t4032bc-july')
    expect(nl.provincial.bpa).toBe(13094)
    expect(nl.fieldSources.provincialBpa).toContain('t4008nl-july')
    // BE-38 B3 resolved the two recorded conflicts, so this pins the resolved
    // values rather than the open question the earlier slices carried.
    expect(pe.provincial.brackets[3].upTo).toBe(142520)
    expect(pe.provincial.brackets.at(-1)).toEqual({ upTo: Infinity, rate: 0.2 })
    expect(pe.sourceConflict).toMatch(/Resolved 2026-09-15/)
    expect(pe.sourceConflict).toMatch(/142,520/)
    expect(pe.sourceConflict).toMatch(/20% for 2026 and subsequent years/)
    expect(pe.sourceConflict).toMatch(/\$3\.726/)
    expect(pe.sourceConflict).not.toMatch(/must reconcile|awaits review|neither|absent|unsupported/i)
    expect(pe.fieldSources.provincialBrackets).toContain('/2026/t4032-pe-7-26e.pdf')
    expect(pe.fieldAdditionalSources?.provincialBrackets).toContain('https://www.princeedwardisland.ca/en/information/finance-and-affordability/provincial-personal-income-tax')
    expect(on25.fieldAdditionalSources?.federalBrackets).toContain(on25.fieldSources.federalBpa)
  })
})
