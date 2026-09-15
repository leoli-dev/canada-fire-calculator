import { expect, it } from 'vitest'
import en from '../en.json'
import fr from '../fr.json'
import zh from '../zh.json'
// The component's own source, so the key check cannot drift from what it calls.
import surfaceSource from '../../components/RuleAssumptions.tsx?raw'
import { BLOCKED_SOURCES, COVERAGE_JURISDICTIONS, coverageLimitationIds, coverageMatrix } from '../../engine/rules/coverageMatrix'
import { PLAN_TAX_YEAR } from '../../engine/planYear'
import { PLAN_BENEFIT_PERIOD } from '../../engine/benefits'
import { selectBenefitRules, selectGisRules, selectTaxRules } from '../../engine/rules'

/** The three catalogues as plain maps: each value is a string keyed by its own
 *  name, so the engine-derived keys below can index them. */
const EN = en as unknown as Record<string, string>
const FR = fr as unknown as Record<string, string>
const ZH = zh as unknown as Record<string, string>
/** The round-4 blocked entry: PE's own page, whose gate only appears under a
 * real navigation. Repeated here so the assertion reads against the URL. */
const PE_2026_GOV = 'https://www.princeedwardisland.ca/en/information/finance-and-affordability/provincial-personal-income-tax'

it('has native failure, bound and assumption messages in all three languages', () => {
  const keys = [
    'solver_infeasible', 'solver_invalid', 'solver_unsupported', 'solver_searchLimit',
    'solverCheckedAssets', 'solverCheckedSpending', 'solverCheckedAge',
    'solverWhenAssumptions', 'solverNumberAssumptions',
    'solverReason_plannedPurchase', 'solverReason_unfundedTransaction',
    'solverReason_zeroSpendingFails', 'solverReason_noFailingUpperBound',
    'solverReason_projectionError', 'solverReason_invalidField',
    'solverReason_nominalCapitalBasis', 'solverReason_investmentPropertySale',
  ] as const
  for (const key of keys) {
    expect(en[key]).toBeTruthy()
    expect(zh[key]).toBeTruthy()
    expect(fr[key]).toBeTruthy()
  }
  expect(fr.whenNever).toContain('{{age}}')
  expect(fr.whenNever).not.toContain('75')
})

it('gives every unmodelled GIS path a reason a caller can render in all three languages', () => {
  // The pack names its unmodelled paths; each one needs a native string, so a
  // surface can show the reason instead of an English placeholder or nothing.
  const ids = ['prior-year-base-period', 'retirement-year-income-estimate',
    'ccb-historical-income', 'provincial-top-ups']
  for (const id of ids) {
    const key = `gisUnsupported.${id}` as keyof typeof en
    expect(en[key], key).toBeTruthy()
    expect(fr[key], key).toBeTruthy()
    expect(zh[key], key).toBeTruthy()
    // No English placeholder leaking into fr/zh: the translated strings differ.
    expect(fr[key]).not.toBe(en[key])
    expect(zh[key]).not.toBe(en[key])
  }
})

it('gives every tax figure the pack does not year-switch a native reason', () => {
  // BE-38 B1: the tax pack names each participating figure it does not
  // year-switch. Each one needs a native string, so the surface can show the
  // scope instead of an English placeholder or nothing.
  const ids = ['federal-age-pension-amounts', 'provincial-age-pension-amounts',
    'spouse-credit', 'low-income-tax-reductions', 'capital-gains-inclusion',
    'probate-fees', 'gst-hst-and-cash-benefits', 'provincial-premiums-and-levies']
  for (const id of ids) {
    const key = `taxUnsupported.${id}` as keyof typeof en
    expect(en[key], key).toBeTruthy()
    expect(fr[key], key).toBeTruthy()
    expect(zh[key], key).toBeTruthy()
    expect(fr[key]).not.toBe(en[key])
    expect(zh[key]).not.toBe(en[key])
  }
  // The year/policy headline, the not-modelled heading and the refusal text.
  for (const key of ['ruleAssumptionsTaxPolicy', 'ruleAssumptionsTaxPolicyPublished',
    'ruleAssumptionsTaxPolicyAssumed', 'ruleAssumptionsTaxNotModelled',
    'ruleAssumptionsRefused', 'ruleAssumptionsLimit'] as const) {
    expect(en[key], key).toBeTruthy()
    expect(fr[key], key).toBeTruthy()
    expect(zh[key], key).toBeTruthy()
  }
})

/** The ids the matrix declares, derived from the matrix itself rather than from
 * a hand-written list: the previous hard-coded list both omitted a live row
 * (`provincial-age-pension-amounts`) and kept a dead one in `en.json`. */
const coverageIds = (pick: 'implemented' | 'unsupported'): string[] => [...new Set(
  coverageMatrix.jurisdictions.flatMap(row => Object.keys(row[pick])))].sort()

/** Every dynamic `t()` prefix the assumptions surface can render, resolved to
 * the ids the engine actually declares. */
const SURFACE_TEMPLATES: Record<string, string[]> = {
  coverageImplemented: coverageIds('implemented'),
  coverageUnsupported: coverageIds('unsupported'),
  coverageLimitation: coverageLimitationIds(),
  ccbUnsupported: selectBenefitRules('CCB', PLAN_BENEFIT_PERIOD).unsupportedPaths.map(path => path.id),
  gisUnsupported: selectGisRules().unsupportedPaths.map(path => path.id),
  taxUnsupported: [...new Set(COVERAGE_JURISDICTIONS.flatMap(jurisdiction =>
    selectTaxRules(jurisdiction, PLAN_TAX_YEAR).unsupportedPaths.map(path => path.id)))].sort(),
}

/**
 * Every translation key a component's `t()` calls use, read from its source so
 * the check cannot drift from the component. Only the first argument is read
 * (a trailing options object holds literals that are not keys), and a literal
 * must start lower-case so a ternary like `t('PE' === x ? ...)` cannot smuggle
 * a non-key in.
 */
function surfaceKeys(source: string, templates: Record<string, string[]>): string[] {
  const keys = new Set<string>()
  for (const call of source.matchAll(/\bt\(/g)) {
    let depth = 1
    let index = call.index + call[0].length
    const start = index
    while (index < source.length && depth > 0) {
      const character = source[index]
      if (character === '(') depth += 1
      else if (character === ')') depth -= 1
      else if (character === ',' && depth === 1) break
      index += 1
    }
    const argument = source.slice(start, index)
    for (const literal of argument.matchAll(/'([a-z][A-Za-z0-9_.]*)'/g)) keys.add(literal[1])
    for (const template of argument.matchAll(/`([A-Za-z][A-Za-z0-9_]*)\.\$\{/g))
      for (const id of templates[template[1]] ?? []) keys.add(`${template[1]}.${id}`)
  }
  return [...keys].sort()
}

it('gives every coverage-matrix row a native string in all three languages', () => {
  // BE-38 B3: the matrix names credits in both directions, so every row needs a
  // string or the panel would render a raw key. Both directions are derived
  // from the matrix, and a translation is not allowed to be the English text.
  const declared: [string, string[]][] = [
    ['coverageImplemented', coverageIds('implemented')],
    ['coverageUnsupported', coverageIds('unsupported')],
  ]
  for (const [prefix, ids] of declared) {
    expect(ids.length, prefix).toBeGreaterThan(10)
    for (const id of ids) {
      const key = `${prefix}.${id}`
      expect(EN[key], `en ${key}`).toBeTruthy()
      expect(FR[key], `fr ${key}`).toBeTruthy()
      expect(ZH[key], `zh ${key}`).toBeTruthy()
      expect(FR[key], `fr ${key} is an English placeholder`).not.toBe(EN[key])
      expect(ZH[key], `zh ${key} is an English placeholder`).not.toBe(EN[key])
    }
  }
  // The other half of the same defect: a coverage key no row uses is dead
  // weight that makes the next hand-written list look complete.
  const used = new Set([
    ...coverageIds('implemented').map(id => `coverageImplemented.${id}`),
    ...coverageIds('unsupported').map(id => `coverageUnsupported.${id}`),
  ])
  for (const key of Object.keys(EN))
    if (key.startsWith('coverageImplemented.') || key.startsWith('coverageUnsupported.'))
      expect(used.has(key), `orphan translation key ${key}`).toBe(true)
})

it('renders no raw key: the assumptions surface uses only keys all three languages define', () => {
  // B1: the coverage panel called three `ruleCoverage*` keys that no language
  // file defined and rendered the identifiers verbatim. Reading the component's
  // own source keeps this honest when a key is renamed or added.
  const source = surfaceSource
  const used = surfaceKeys(source, SURFACE_TEMPLATES)
  expect(used.length).toBeGreaterThan(20)
  for (const key of ['ruleCoverageImplemented', 'ruleCoverageUnsupported', 'ruleCoverageNotModelled'])
    expect(used, key).toContain(key)
  for (const key of used) {
    expect(EN[key], `en ${key}`).toBeTruthy()
    expect(FR[key], `fr ${key}`).toBeTruthy()
    expect(ZH[key], `zh ${key}`).toBeTruthy()
  }
  // The extractor resolves dynamic prefixes through `SURFACE_TEMPLATES`; a new
  // prefix it does not know would be skipped silently, so fail instead.
  for (const prefix of source.matchAll(/`([A-Za-z][A-Za-z0-9_]*)\.\$\{/g))
    expect(SURFACE_TEMPLATES[prefix[1]], `unknown template prefix ${prefix[1]}`).toBeDefined()
})

it('gives every CCB gap the pack names a native reason in all three languages', () => {
  // BE-38 B2: the CCB pack carries its own unsupported list, so it needs its own
  // native strings rather than borrowing the GIS or tax ones.
  const ids = ['ccb-prior-year-afni', 'ccb-shared-custody', 'ccb-child-disability-benefit',
    'ccb-provincial-top-ups', 'ccb-eligibility-and-residence']
  for (const id of ids) {
    const key = `ccbUnsupported.${id}` as keyof typeof en
    expect(en[key], key).toBeTruthy()
    expect(fr[key], key).toBeTruthy()
    expect(zh[key], key).toBeTruthy()
    expect(fr[key]).not.toBe(en[key])
    expect(zh[key]).not.toBe(en[key])
  }
  for (const key of ['ruleAssumptionsCcbPolicy', 'ruleAssumptionsCcbPolicyPublished',
    'ruleAssumptionsCcbPolicyAssumed', 'ruleAssumptionsCcbNotModelled',
    'ruleAssumptionsBenefitRefused'] as const) {
    expect(en[key], key).toBeTruthy()
    expect(fr[key], key).toBeTruthy()
    expect(zh[key], key).toBeTruthy()
    expect(fr[key]).not.toBe(en[key])
    expect(zh[key]).not.toBe(en[key])
  }
})

it('renders the coverage caveat natively, with the English copy tied to the artifact', () => {
  // BE-38 B3 review (NB4): the panel used to render `coverageMatrix.caveat`
  // verbatim, so a French or Chinese user got an English paragraph. It now goes
  // through the catalogue, and the English string is pinned to the artifact's
  // own copy so the two cannot drift.
  expect(EN.ruleCoverageCaveat).toBeTruthy()
  expect(EN.ruleCoverageCaveat).toBe(coverageMatrix.caveat)
  expect(FR.ruleCoverageCaveat, 'fr caveat is an English placeholder').not.toBe(EN.ruleCoverageCaveat)
  expect(ZH.ruleCoverageCaveat, 'zh caveat is an English placeholder').not.toBe(EN.ruleCoverageCaveat)
  expect(FR.ruleCoverageCaveat).toMatch(/TPS\/TVH/)
  expect(ZH.ruleCoverageCaveat).toMatch(/GST\/HST/)
  // BE-38 B3 review (round 4, H1): the caveat listed "the province-specific
  // spouse worksheets" as not modelled while the matrix renders an implemented
  // spouse row. It now names the one thing that is genuinely absent — the
  // net-income base those worksheets use — so the caveat and the row agree.
  expect(coverageMatrix.caveat).not.toMatch(/spouse worksheets,/)
  expect(coverageMatrix.caveat).toMatch(/net-income base/)
  expect(FR.ruleCoverageCaveat).toMatch(/base de revenu net/)
  expect(ZH.ruleCoverageCaveat).toMatch(/净收入基数/)
  // The rendered spouse limitation says the same thing, so the two surfaces the
  // review put side by side no longer read as a contradiction.
  expect(EN['coverageLimitation.provincialSpouseAmount']).toMatch(/net-income base/)
})

it('renders every declared coverage limitation natively, with no orphan key', () => {
  // BE-38 B3 review (round 3, B1): a declared limit that is never rendered is
  // what let the panel claim more than the cited document supported. Every row's
  // `limitationId` is now a catalogue key the panel renders; the ids come from
  // the matrix, so a new row cannot ship an untranslated or raw qualification.
  const ids = coverageLimitationIds()
  expect(ids.length).toBeGreaterThan(20)
  for (const id of ids) {
    const key = `coverageLimitation.${id}`
    expect(EN[key], `en ${key}`).toBeTruthy()
    expect(FR[key], `fr ${key}`).toBeTruthy()
    expect(ZH[key], `zh ${key}`).toBeTruthy()
    expect(FR[key], `fr ${key} is an English placeholder`).not.toBe(EN[key])
    expect(ZH[key], `zh ${key} is an English placeholder`).not.toBe(EN[key])
  }
  const used = new Set(ids.map(id => `coverageLimitation.${id}`))
  for (const key of Object.keys(EN))
    if (key.startsWith('coverageLimitation.'))
      expect(used.has(key), `orphan translation key ${key}`).toBe(true)
  // The labels the rendered list needs in both directions.
  for (const key of ['ruleCoverageAdditionalSource', 'ruleCoverageImplemented',
    'ruleCoverageUnsupported', 'ruleCoverageNotModelled'] as const) {
    expect(EN[key], key).toBeTruthy()
    expect(FR[key], key).toBeTruthy()
    expect(ZH[key], key).toBeTruthy()
  }
  expect(FR.ruleCoverageAdditionalSource).not.toBe(EN.ruleCoverageAdditionalSource)
  expect(ZH.ruleCoverageAdditionalSource).not.toBe(EN.ruleCoverageAdditionalSource)
})

it('states the bot gate in every language for a row that cites a blocked authority', () => {
  // BE-38 B3 review (round 3, B2; round 4, B2): rendering an
  // `additionalSourceURLs` entry that blocks automated readers is only honest if
  // the row's own rendered qualification says so. The marker comes from the
  // registry entry rather than a hard-coded `/403/`, because round 4 added a
  // gate that answers **200** to curl and to an API request context and only
  // reveals itself as a Radware CAPTCHA to a real navigation — a status code
  // cannot name it. Deriving the ids from the matrix keeps this honest when the
  // blocked-source record changes.
  const qualified = new Map<string, string>()
  for (const row of coverageMatrix.jurisdictions)
    for (const credit of Object.values(row.implemented))
      for (const url of credit.additionalSourceURLs ?? [])
        if (BLOCKED_SOURCES[url] && credit.limitationId)
          qualified.set(credit.limitationId, BLOCKED_SOURCES[url].gateMarker)
  expect([...qualified.keys()].sort()).toEqual([
    'peProvincialIncomeTaxBrackets', 'quebecBasicPersonalAmount', 'quebecIncomeTaxBrackets',
  ])
  for (const [id, marker] of qualified)
    for (const [lang, catalogue] of [['en', EN], ['fr', FR], ['zh', ZH]] as const)
      expect(catalogue[`coverageLimitation.${id}`], `${lang} ${id} must name the gate "${marker}"`)
        .toContain(marker)
  // The gate marker for the round-4 entry is a CAPTCHA, not a status code —
  // pinning that keeps a future editor from "fixing" it to a 403 that the page
  // never returns.
  expect(BLOCKED_SOURCES[PE_2026_GOV]?.gateMarker).toBe('CAPTCHA')
  expect(BLOCKED_SOURCES[PE_2026_GOV]?.reason).toMatch(/200/)
})

it('renders the content-checked and merely-listed states natively in every language', () => {
  // BE-38 B3 review (round 4): the panel now states what each authority is —
  // content-checked (with the date and the figures a person read) or listed only
  // with its content unchecked — so the two labels and the gate label must exist
  // natively, or the disclosure would regress to an English placeholder or a raw
  // key exactly where the round-4 claim lives.
  for (const key of ['ruleCoverageAuthorityChecked', 'ruleCoverageAuthorityListed',
    'ruleCoverageAuthorityBlocked'] as const) {
    expect(EN[key], key).toBeTruthy()
    expect(FR[key], key).toBeTruthy()
    expect(ZH[key], key).toBeTruthy()
    expect(FR[key], `fr ${key} is an English placeholder`).not.toBe(EN[key])
    expect(ZH[key], `zh ${key} is an English placeholder`).not.toBe(EN[key])
  }
  expect(EN.ruleCoverageAuthorityChecked).toContain('{{date}}')
  expect(EN.ruleCoverageAuthorityChecked).toContain('{{figures}}')
  expect(FR.ruleCoverageAuthorityBlocked).toContain('{{gate}}')
  expect(ZH.ruleCoverageAuthorityBlocked).toContain('{{gate}}')
  // The claim text may only promise what the suite enforces: the checked/listed
  // distinction and the rendered limit. It must not resurrect the round-3
  // sentence promising a read that did not happen.
  expect(EN.ruleAssumptionsLimit).toMatch(/content-checked/)
  expect(EN.ruleAssumptionsLimit).toMatch(/listed only/)
  expect(EN.ruleAssumptionsLimit).toMatch(/stated next to the link/)
})

it('pins the moved limitation prose to the catalogue rather than to the engine strings', () => {
  // The prose used to live on the matrix rows (and was asserted there). It now
  // lives in the catalogues because the panel renders it; these are the same
  // claims, pinned where the panel reads them.
  expect(EN['coverageLimitation.probateFees']).toMatch(/TaxTips\.ca/)
  // BE-38 B4: the territories are priced from their own regulations now, so the
  // rendered text may no longer say the build charges Yukon's fee. Review B2:
  // it may also no longer say the fee is nil at or below $250,000 — both
  // instruments charge $30/$110/$215/$325 there. The rendered claim must match
  // what the build now models: the full published ladder.
  const LADDER_TEXT = { NT: 435, NU: 425 } as const
  for (const [province, top] of Object.entries(LADDER_TEXT)) {
    const key = `coverageLimitation.probateFeesApprox${province}`
    // Every published band is named, in every language, not just the top tier.
    for (const [catalogue, fees] of [[EN, /\$30.*\$110.*\$215.*\$325/],
      [FR, /30 \$.*110 \$.*215 \$.*325 \$/], [ZH, /30 加元.*110 加元.*215 加元.*325 加元/]] as const)
      expect(catalogue[key], `${province} ${key}`).toMatch(fees)
    expect(EN[key]).toContain(`$${top}`)
    expect(EN[key]).not.toMatch(/Yukon/)
    // The false claim the review found, in each language, must stay gone.
    expect(EN[key], `${key} must not say the fee is nil below the boundary`)
      .not.toMatch(/not charged|no band|is not charged/i)
    expect(FR[key]).not.toMatch(/aucune somme n’est facturée|n’est facturée/i)
    expect(ZH[key]).not.toMatch(/不收取费用|不收费用/)
    // And it says plainly that the build approximates no band.
    expect(EN[key]).toMatch(/none is approximated/)
    expect(FR[key]).toMatch(/aucun n’est approximé/)
    expect(ZH[key]).toMatch(/未作任何近似处理/)
  }
  expect(EN['coverageLimitation.probateFeesApproxNT'])
    .toMatch(/Court Services Fees Regulations \(R-120-93, Part 2, item 1\)/)
  expect(EN['coverageLimitation.probateFeesApproxNU'])
    .toMatch(/Court Fees Regulations \(C\.R\.Nu\. R-042-2021, Schedule C, item 5\)/)
  // BE-38 B4 follow-up: Nunavut's instrument is recorded in `BLOCKED_SOURCES`
  // with gate marker `403`, so every language's qualification must carry that
  // literal — the engine-side guard and the rendered disclosure name the same
  // gate.
  for (const [lang, catalogue] of [['en', EN], ['fr', FR], ['zh', ZH]] as const)
    expect(catalogue['coverageLimitation.probateFeesApproxNU'], `${lang} NU gate marker`)
      .toContain('403')
  // BE-38 B4 follow-up: Yukon's row now cites its own fee schedule and renders
  // its own qualification. The text must state both priced values — the $25,000
  // exemption and the $140 above it — because that is what the engine charges,
  // and the claim that caused the defect (an unconditional $140 for every
  // estate) must not come back in any language.
  for (const [lang, catalogue] of [['en', EN], ['fr', FR], ['zh', ZH]] as const) {
    const text = catalogue['coverageLimitation.probateFeesYT']
    expect(text, `${lang} YT qualification`).toBeTruthy()
    expect(text, `${lang} YT exemption`).toMatch(/25[ ,]000/)
    expect(text, `${lang} YT fee`).toMatch(/140/)
    expect(text, `${lang} YT authority`).toMatch(/Supreme Court Rules|Cour suprême|最高法院规则/)
  }
  expect(EN['coverageLimitation.probateFeesYT']).toMatch(/does not exceed \$25,000/)
  expect(EN['coverageLimitation.probateFeesYT']).toMatch(/Neither value is inferred or approximated/)
  expect(FR['coverageLimitation.probateFeesYT']).not.toBe(EN['coverageLimitation.probateFeesYT'])
  expect(ZH['coverageLimitation.probateFeesYT']).not.toBe(EN['coverageLimitation.probateFeesYT'])
  expect(EN['coverageLimitation.probateFeesMB']).toMatch(/abolished its probate fee/)
  expect(EN['coverageLimitation.provincialAgeAmount']).toMatch(/Pinned 2026 figures/)
})

it('claims no more than the rendered entries support', () => {
  // BE-38 B3 review (round 3, B1(c)): the old sentence promised that every
  // implemented entry linked the authority its figures were *read from*, which
  // was false for the QC RAMQ approximation. The claim now matches what the
  // panel does: it links every cited authority and renders the row's own limit
  // where one is recorded.
  expect(EN.ruleAssumptionsLimit).not.toMatch(/links to the authority its figures were read from/)
  expect(EN.ruleAssumptionsLimit).toMatch(/stated next to the link/)
  for (const [lang, catalogue] of [['en', EN], ['fr', FR], ['zh', ZH]] as const) {
    expect(catalogue.ruleAssumptionsLimit, lang).toBeTruthy()
    expect(catalogue.ruleAssumptionsLimit, lang).not.toMatch(/were read from/)
  }
  expect(FR.ruleAssumptionsLimit).not.toBe(EN.ruleAssumptionsLimit)
  expect(ZH.ruleAssumptionsLimit).not.toBe(EN.ruleAssumptionsLimit)
})
