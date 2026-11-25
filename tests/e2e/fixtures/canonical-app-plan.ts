import { integratedHeldHomeEstateFixture } from '../../../src/engine/__tests__/fixtures/annualIntegratedHeldHomeEstate'
import { BASE_YEAR } from '../../../src/engine/__tests__/fixtures/retirementSettlement'
import { QUESTION_CATALOG } from '../../../src/guided/questionCatalog'

export type AppPlanVariant = 'settled' | 'inflation' | 'partial' | 'no-opt-in' | 'legacy-funding' | 'unsupported-province'

export function canonicalAppPlan(variant: AppPlanVariant = 'settled') {
  const { plan, spending } = integratedHeldHomeEstateFixture()
  if (variant === 'inflation') {
    plan.inflation = 0.02
    plan.legacyProjection.inflation = 0.02
  }
  if (variant === 'partial') {
    plan.lifeExpectancy = 61
    plan.legacyProjection.lifeExpectancy = 61
    Object.assign(plan.annualHouseholdExpenseEvidence!, { allowPartialPayment: false })
  }
  if (variant === 'legacy-funding') {
    // Same unsupported reached sale in both representations. Legacy's
    // underwater payoff check and the canonical sale proof gate are distinct.
    plan.properties[0].sellAtAge = 58
    Object.assign(plan.debts[0], { principal: 600_000, annualPayment: 220_000 })
    plan.properties[0].value = 180_000
    plan.legacyProjection.principalResidence = {
      value: 180_000, appreciation: 0.1, sellAtAge: 58,
      mortgage: { balance: 600_000, annualPayment: 220_000, yearsRemaining: 3 },
    }
  }
  if (variant === 'unsupported-province') {
    plan.province = 'BC'
    plan.legacyProjection.province = 'BC'
  }
  if (variant !== 'no-opt-in') {
    plan.deterministicProjection = {
      mode: 'canonical', spending, provenance: { origin: 'user', sourceYear: BASE_YEAR },
    }
  }
  // Restored Guide answers describe this fixture; projection facts come only
  // from the canonical plan above. Actual generation is still through Review.
  const answerMeta = Object.fromEntries(QUESTION_CATALOG.flatMap(page =>
    page.fieldBindings.map(field => [field, { status: 'confirmed', origin: 'user', updatedAt: '2026-01-01T00:00:00.000Z' }]),
  ))
  const questionAnswers = {
    'family.people': 'couple', 'family.children': 'no', 'time.work.target': 'no',
    'work.after': 'no', 'assets.identify': ['tfsa'], 'home.situation': 'own',
    'home.mortgage': 'yes', 'housing.other.rentals': 'no', 'housing.other.debts': 'no',
    'spending.method': 'total', 'pension.self': 'none', 'pension.partner': 'none',
    'intent.legacy': 'none', 'intent.spending': 'maintain',
    'invest.mix': 'balanced', 'invest.strategy': 'tfsaFirst',
  }
  return {
    version: 11,
    state: {
      inputs: plan.legacyProjection, canonical: plan, entryMode: 'professional',
      inputRevision: 23, resultRevision: null, answerMeta, questionAnswers,
    },
  }
}
