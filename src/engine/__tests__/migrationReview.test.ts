import { describe, expect, it } from 'vitest'
import { DEFAULT_INPUTS } from '../../store'
import { migratePersistedPlan, refreshCanonicalFromLegacy } from '../migration'
import { canComparePrecisely, migrationReview } from '../migrationReview'

describe('shared migration review', () => {
  it('keeps a coupled legacy total unassigned and never infers a half split', () => {
    const inputs = { ...structuredClone(DEFAULT_INPUTS), partner: { currentAge: 33, cppStartAge: 65, cppAnnualAt65: 6000, oasStartAge: 65, oasAnnualAt65: 8000 } }
    const plan = migratePersistedPlan({ inputs }, 10, 2026)
    const review = migrationReview(plan)!
    expect(review.ownershipPending).toBe(true)
    expect(review.precisionAllowed).toBe(false)
    expect(review.unassignedAccounts.find(account => account.kind === 'tfsa')).toMatchObject({ balance: 100000, ownerId: null, taxableOwnerShares: { status: 'unknown' } })
    expect(plan.accounts.find(account => account.kind === 'tfsa')?.balance).toBe(100000)
    expect(migrationReview(migratePersistedPlan({ canonical: plan, inputs }, 10, 2030))).toEqual(review)
  })

  it('reports current and Scenario A from their own canonical records', () => {
    const current = migratePersistedPlan({ inputs: structuredClone(DEFAULT_INPUTS) }, 10, 2026)
    const scenarioInputs = { ...structuredClone(DEFAULT_INPUTS), partner: { currentAge: 33, cppStartAge: 65, cppAnnualAt65: 6000, oasStartAge: 65, oasAnnualAt65: 8000 }, balances: { tfsa: 220000, rrsp: 200000, nonReg: 100000 } }
    const scenario = migratePersistedPlan({ inputs: scenarioInputs }, 10, 2026)
    expect(migrationReview(current)?.ownershipPending).toBe(false)
    expect(migrationReview(scenario)?.ownershipPending).toBe(true)
    expect(migrationReview(scenario)?.unassignedAccounts.find(account => account.kind === 'tfsa')?.balance).toBe(220000)
    expect(canComparePrecisely(current, scenario)).toBe(false)
    expect(canComparePrecisely(scenario, current)).toBe(false)
  })

  it('withholds a comparison when either canonical snapshot is missing', () => {
    const plan = migratePersistedPlan({ inputs: structuredClone(DEFAULT_INPUTS) }, 10, 2026)
    expect(canComparePrecisely(null, null)).toBe(false)
    expect(canComparePrecisely(plan, null)).toBe(false)
    expect(canComparePrecisely(null, plan)).toBe(false)
  })

  it('keeps single-person legacy age and savings uncertainty distinct from ownership', () => {
    const plan = migratePersistedPlan({ inputs: structuredClone(DEFAULT_INPUTS) }, 10, 2026)
    const review = migrationReview(plan)!
    expect(review.ownershipPending).toBe(false)
    expect(review.precisionAllowed).toBe(false)
    expect(canComparePrecisely(plan, plan)).toBe(false)
  })

  it('distinguishes a new UI plan from persisted legacy uncertainty without inventing confirmed budget facts', () => {
    const fresh = refreshCanonicalFromLegacy(null, structuredClone(DEFAULT_INPUTS))
    expect(fresh.migration).toMatchObject({ sourcePersistVersion: 11, ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false })
    expect(fresh.budget).toMatchObject({ debtIncluded: { status: 'unknown' }, taxBenefitIncluded: { status: 'unknown' } })
    expect(migrationReview(fresh)?.precisionAllowed).toBe(true)
    const edited = refreshCanonicalFromLegacy(fresh, { ...fresh.legacyProjection, annualSavings: 42000 })
    expect(edited.migration.sourcePersistVersion).toBe(11)
    expect(migrationReview(edited)?.precisionAllowed).toBe(true)
  })
})
