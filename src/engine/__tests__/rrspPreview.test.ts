import { describe, expect, it } from 'vitest'
import { DEFAULT_INPUTS } from '../../store'
import { migratePersistedPlan } from '../migration'
import type { InputsV2 } from '../model'
import { previewRrspRoomYear } from '../rrspRoom'
import { annualStep, initializeState, type AnnualProviders } from '../annualState'

/**
 * B1: the panel ledger and the kernel ledger must be the same computation.
 * `previewRrspRoomYear` is exactly what `TaxFactsPanel` renders, so comparing
 * it with `annualStep`'s `rrspLedger` pins the parity the review found broken.
 */

/** The project's own default plan. `DEFAULT_INPUTS.savingsSplit` is
 * `{ tfsa: .3, rrsp: .5, nonReg: .2 }` with 40,000 of net savings, so the
 * default voluntary split sends 24,000 * .5 = 12,000 to the RRSP on top of any
 * recorded contribution. */
function defaultPlan(): InputsV2 {
  const plan = migratePersistedPlan({ inputs: DEFAULT_INPUTS }, 10, 2026)
  plan.migration = { sourcePersistVersion: 11, ownershipNeedsConfirmation: false, ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
  plan.budget = { kind: 'savingsBudget', annualNetSavings: DEFAULT_INPUTS.annualSavings, retirementSpending: DEFAULT_INPUTS.retirementSpending,
    debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } }
  // Statement vector: deduction limit 20,000, 5,000 already contributed but not
  // deducted, so 15,000 of room is available.
  for (const account of plan.accounts) account.contributionRoom = { status: 'known', value: 1_000_000 }
  const self = plan.people.find(person => person.role === 'self')!
  self.tfsaAvailableRoom = { status: 'known', value: 1_000_000 }
  self.rrspDeductionLimit = { status: 'known', value: 20000 }
  self.rrspUnusedUndeducted = { status: 'known', value: 5000 }
  self.rrspAvailableRoom = { status: 'unknown', reason: 'available room not typed separately' }
  const rrsp = plan.accounts.find(account => account.kind === 'rrsp')!
  plan.contributions = [{ id: `be12:${self.id}:${rrsp.id}:${plan.baseYear}`, accountId: rrsp.id, contributorId: self.id,
    calendarYear: plan.baseYear, amount: 16000, deductionYear: null, provenance: { origin: 'user', sourceYear: plan.baseYear } }]
  return plan
}

const providers = (cash: number): AnnualProviders => ({
  evaluate: ({ state }) => ({ byPerson: Object.fromEntries(Object.keys(state.byPerson).map(id => [id, {
    income: cash, earnedIncome: cash, benefits: 0, tax: 0, spending: 0, taxableIncome: cash,
    benefitIncomeForNextYear: { status: 'known' as const, value: cash },
  }])) }),
  returns: () => 0,
})

describe('BE-12 A panel/kernel RRSP ledger parity', () => {
  it('prices the DEFAULT plan once, so the panel ledger equals the kernel ledger', () => {
    const plan = defaultPlan()
    const self = plan.people.find(person => person.role === 'self')!
    const opening = initializeState(plan)
    expect(opening.status).toBe('ok')
    if (opening.status !== 'ok') throw new Error('expected an initialized plan')
    const step = annualStep(plan, opening.value, providers(40000))
    expect(step.status).toBe('ok')
    if (step.status !== 'ok') throw new Error('expected a settled year')
    const kernel = step.value.row.rrspLedger[self.id]
    // Hand calculation for the reviewed default plan: 16,000 recorded plus
    // 12,000 from the savings split of the remaining 24,000 is 28,000 planned
    // against 15,000 of room, so 15,000 applies and 13,000 is retained.
    expect(kernel.planned).toBe(28000)
    expect(kernel.applied).toBe(15000)
    expect(kernel.retained).toBe(13000)
    expect(kernel.lines.map(line => [line.id, line.planned])).toEqual([
      [`be12:${self.id}:${plan.accounts.find(account => account.kind === 'rrsp')!.id}:${plan.baseYear}`, 16000],
      [`annual:${plan.baseYear}:rrsp`, 12000],
    ])
    // The panel's own function, not a copy of it, must produce that same row.
    const preview = previewRrspRoomYear(plan, self)
    expect(preview.savingsShare).toBe(12000)
    expect(preview.ledger).toEqual(kernel)
    // The preview prices the statement year only; a later year still needs the
    // sourced cap/18% rule, which the kernel reports as unsupported.
    expect(preview.ledger.year).toBe(plan.baseYear)
  })
})
