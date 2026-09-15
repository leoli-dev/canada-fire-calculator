import { expect, it } from 'vitest'
import en from '../en.json'
import fr from '../fr.json'
import zh from '../zh.json'

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
