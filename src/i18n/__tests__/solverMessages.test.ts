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
