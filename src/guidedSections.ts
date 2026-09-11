export interface GuidedSection {
  id: number
  key: string
  fields: string[]
}

/** Stable guided-flow registry. Field paths are also used to scope validation. */
export const GUIDED_SECTIONS: GuidedSection[] = [
  { id: 1, key: 'household', fields: ['currentAge', 'fireAge', 'lifeExpectancy', 'fireTargetAssets', 'partner.currentAge', 'children'] },
  { id: 2, key: 'income', fields: ['annualSavings', 'extraIncome'] },
  { id: 3, key: 'accounts', fields: ['balances', 'nonRegBook', 'lockedRetirement', 'fhsa', 'savingsSplit'] },
  { id: 4, key: 'housing', fields: ['principalResidence', 'investmentProperties', 'debts'] },
  { id: 5, key: 'spending', fields: ['retirementSpending'] },
  { id: 6, key: 'benefits', fields: ['cppStartAge', 'cppAnnualAt65', 'oasStartAge', 'oasAnnualAt65', 'pension', 'partner.cpp', 'partner.oas', 'partner.pension'] },
  { id: 7, key: 'review', fields: [] },
]

export function issueBelongsToStep(field: string, step: number): boolean {
  const section = GUIDED_SECTIONS[step - 1]
  return section.fields.some((prefix) => field === prefix || field.startsWith(`${prefix}.`))
}
