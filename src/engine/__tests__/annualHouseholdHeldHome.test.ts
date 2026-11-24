import { describe, expect, it } from 'vitest'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { annualSheetText, type AnnualSheetRow } from '../../annualSheet'
import { initializeState, projectCanonicalCoverage, sumInvestableAssets, sumNetWorth, type KernelResult } from '../annualState'
import { evaluateCanonicalHouseholdWorkingYear } from '../annualWorking'
import type { Property } from '../model'
import { known, recorded, RETIREE } from './fixtures/retirementSettlement'
import { PARTNER, staggeredHouseholdPlan, staggeredSpending } from './fixtures/staggeredHousehold'

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}
function fixture(shares: Record<string, number> = { [RETIREE]: 0.4, [PARTNER]: 0.6 }) {
  const plan = staggeredHouseholdPlan()
  const home: Property = {
    id: '__proto__', kind: 'principal', value: 500_000, appreciation: 0.04,
    acb: { status: 'unknown', reason: 'No recorded basis' }, annualRent: known(0),
    sellAtAge: null, plannedPurchaseAge: null, plannedDownPayment: null,
    plannedMortgage: null, annualHoldingCostChange: 0, mortgageDebtId: null,
    taxableOwnerShares: { status: 'known', shares }, provenance: { value: recorded },
  }
  plan.properties = [home]
  return { plan, home, evidence: staggeredSpending() }
}
function find(rows: AnnualSheetRow[], id: string): AnnualSheetRow | undefined {
  for (const row of rows) {
    if (row.id === id) return row
    const child = find(row.children ?? [], id)
    if (child) return child
  }
}

describe('authenticated household passive held home', () => {
  it.each<Record<string, number>>([{ [RETIREE]: 1 }, { [PARTNER]: 1 }, { [RETIREE]: 0.4, [PARTNER]: 0.6 }])('carries title %j through all phases without cash or tax changes', shares => {
    const { plan, home, evidence } = fixture(shares)
    const before = structuredClone(plan)
    const held = ok(projectCanonicalCoverage(plan, evidence, 4))
    const baseline = ok(projectCanonicalCoverage({ ...plan, properties: [] }, evidence, 4))
    expect(held.blocked).toBeNull()
    expect(held.rows.map(row => row.workingSettlement && 'household' in row.workingSettlement && row.workingSettlement.household.phase))
      .toEqual(['both-working', 'mixed', 'both-retired', 'both-retired'])
    let opening = home.value
    for (const [index, row] of held.rows.entries()) {
      const closing = opening * ((1 + home.appreciation) * (1 + plan.inflation))
      expect(Object.keys(row.byProperty)).toEqual([home.id])
      expect(row.byProperty[home.id]).toEqual({ held: true, opening, growth: closing - opening, closing })
      expect({ ...row, byProperty: {} }).toEqual(baseline.rows[index])
      opening = closing
    }
    expect(sumInvestableAssets(held.state)).toBe(sumInvestableAssets(baseline.state))
    expect(sumNetWorth(held.state)).toBe(sumNetWorth(baseline.state) + opening)
    expect(held.state.byProperty[home.id].acb).toEqual(home.acb)
    expect(plan).toEqual(before)
    const sheet = canonicalAnnualSheet(held, { scenarioId: 'home', revision: 1 })
    expect(find(sheet.rows, canonicalSheetId('value', 'netWorth'))!.cells![2029].value).toBe(sumNetWorth(held.state))
    const cell = find(sheet.rows, canonicalSheetId('value', 'property', home.id, 'closing'))!.cells![2029]
    expect(cell.value).toBe(opening)
    for (const locale of ['en', 'fr', 'zh'] as const) expect(annualSheetText(sheet.resolveExplanation!(cell.explanationRefs![0])!.summary!, locale)).toBeTruthy()
  })

  it.each([57, 58, 59])('stops on the self clock at %i even with partner first and sole title', age => {
    const { plan, home, evidence } = fixture({ [PARTNER]: 1 })
    plan.people.reverse()
    home.sellAtAge = age
    const prefixYears = age - 56
    const prefix = ok(projectCanonicalCoverage(plan, evidence, prefixYears))
    const stopped = ok(projectCanonicalCoverage(plan, evidence, 4))
    expect(stopped).toMatchObject({ rows: prefix.rows, state: prefix.state, overallConclusionAvailable: false,
      blocked: { year: 2026 + prefixYears, status: 'unsupported', causes: ['propertySale'] } })
    expect(stopped.state.byProperty[home.id].held).toBe(true)
    expect(stopped.state.primaryHomeSaleCash).toBeUndefined()
  })

  it.each([
    (home: Property) => { home.provenance = Object.create({ value: recorded }) },
    (home: Property) => { home.provenance.value = Object.create(recorded) },
    (home: Property) => { home.provenance.value = { origin: 'estimated', sourceYear: 2026 } },
    (home: Property) => { home.taxableOwnerShares = Object.create(home.taxableOwnerShares) },
    (home: Property) => { home.taxableOwnerShares = { status: 'known', shares: { [RETIREE]: 0.999999999 } } },
    (home: Property) => { home.plannedDownPayment = 0 },
    (home: Property) => { home.plannedMortgage = { principal: 0, annualPayment: 0, yearsRemaining: 0 } },
    (home: Property) => { home.annualRent = known(1) },
    (home: Property) => { home.annualHoldingCostChange = 1 },
  ])('refuses unsupported or inherited evidence before any posting (%#)', change => {
    const { plan, home, evidence } = fixture()
    change(home)
    const coverage = projectCanonicalCoverage(plan, evidence, 4)
    if (coverage.status === 'invalid') {
      expect(coverage.issues).toEqual([{ code: 'invalid', detail: 'canonical plan shape' }])
      return
    }
    const result = ok(coverage)
    expect(result).toMatchObject({ rows: [], state: ok(initializeState(plan)), blocked: { year: 2026, status: 'unsupported' } })
  })

  it('keeps direct quotes and copied states outside the authenticated home path', () => {
    const { plan, evidence } = fixture()
    const state = ok(projectCanonicalCoverage(plan, evidence, 1)).state
    for (const opening of [undefined, state, structuredClone(state)]) {
      expect(evaluateCanonicalHouseholdWorkingYear(plan, evidence, opening?.year ?? 2026, opening).status).toBe('unsupported')
    }
  })
})
