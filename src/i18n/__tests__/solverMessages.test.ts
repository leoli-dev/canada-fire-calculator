import { expect, it } from 'vitest'
import en from '../en.json'
import fr from '../fr.json'
import zh from '../zh.json'
// The component's own source, so the key check cannot drift from what it calls.
import surfaceSource from '../../components/RuleAssumptions.tsx?raw'
import { COVERAGE_JURISDICTIONS, coverageMatrix } from '../../engine/rules/coverageMatrix'
import { PLAN_TAX_YEAR } from '../../engine/planYear'
import { PLAN_BENEFIT_PERIOD } from '../../engine/benefits'
import { selectBenefitRules, selectGisRules, selectTaxRules } from '../../engine/rules'

/** The three catalogues as plain maps: each value is a string keyed by its own
 *  name, so the engine-derived keys below can index them. */
const EN = en as unknown as Record<string, string>
const FR = fr as unknown as Record<string, string>
const ZH = zh as unknown as Record<string, string>

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
