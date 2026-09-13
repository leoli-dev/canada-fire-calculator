import type { InputsV2 } from './model'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
const text = (value: unknown) => typeof value === 'string' && value.length > 0
const integer = (value: unknown) => finite(value) && Number.isInteger(value)
function requireShape(ok: unknown, path: string): asserts ok {
  if (!ok) throw new Error(`Invalid canonical plan: ${path}`)
}
function provenance(value: unknown, path: string) {
  requireShape(object(value), path)
  requireShape(['user', 'legacy', 'estimated', 'unknown'].includes(value.origin as string), `${path}.origin`)
  requireShape(value.sourceYear === null || integer(value.sourceYear), `${path}.sourceYear`)
  requireShape(value.note === undefined || typeof value.note === 'string', `${path}.note`)
}
function provenanceMap(value: unknown, path: string) {
  requireShape(object(value), path)
  for (const [key, entry] of Object.entries(value)) provenance(entry, `${path}.${key}`)
}
function known(value: unknown, path: string, kind: 'number' | 'boolean' = 'number') {
  requireShape(object(value), path)
  if (value.status === 'unknown') requireShape(text(value.reason), `${path}.reason`)
  else {
    requireShape(value.status === 'known', `${path}.status`)
    requireShape(kind === 'number' ? finite(value.value) : typeof value.value === 'boolean', `${path}.value`)
  }
}
function taxShares(value: unknown, people: Set<string>, path: string) {
  requireShape(object(value), path)
  if (value.status === 'unknown') { requireShape(text(value.reason), `${path}.reason`); return }
  requireShape(value.status === 'known' && object(value.shares), `${path}.shares`)
  const entries = Object.entries(value.shares)
  requireShape(entries.length > 0, `${path}.shares`)
  for (const [id, share] of entries) {
    requireShape(people.has(id), `${path}.shares.${id}.owner`)
    requireShape(finite(share) && (share as number) >= 0 && (share as number) <= 1, `${path}.shares.${id}`)
  }
  requireShape(Math.abs(entries.reduce((sum, [, share]) => sum + (share as number), 0) - 1) < 1e-8, `${path}.shares.total`)
}
function uniqueIds(values: unknown, path: string): Set<string> {
  requireShape(Array.isArray(values), path)
  const ids = new Set<string>()
  for (const [index, value] of values.entries()) {
    requireShape(object(value) && text(value.id), `${path}.${index}.id`)
    const id = value.id as string
    requireShape(!ids.has(id), `${path}.${index}.duplicateId`)
    ids.add(id)
  }
  return ids
}

/** Reject incomplete or cross-wired v11 snapshots before Zustand hydration. */
export function assertCanonicalPlan(value: unknown): asserts value is InputsV2 {
  requireShape(object(value) && value.schemaVersion === 2, 'schemaVersion')
  const plan = value as unknown as InputsV2
  requireShape(integer(plan.baseYear), 'baseYear')
  requireShape(text(plan.province) && finite(plan.inflation), 'province/inflation')
  requireShape(object(plan.budget) && ['incomeBudget', 'savingsBudget'].includes(plan.budget.kind as string), 'budget.kind')
  requireShape(finite(plan.budget.retirementSpending), 'budget.retirementSpending')
  if (plan.budget.kind === 'incomeBudget') requireShape(finite(plan.budget.workingSpending) && !('annualNetSavings' in plan.budget), 'budget.workingSpending')
  else {
    requireShape(finite(plan.budget.annualNetSavings) && !('workingSpending' in plan.budget), 'budget.annualNetSavings')
    known(plan.budget.debtIncluded, 'budget.debtIncluded', 'boolean')
    known(plan.budget.taxBenefitIncluded, 'budget.taxBenefitIncluded', 'boolean')
  }
  const people = uniqueIds(plan.people, 'people')
  requireShape(people.size >= 1 && people.size <= 2, 'people.count')
  const roles = new Set<string>()
  for (const [index, person] of plan.people.entries()) {
    requireShape(['self', 'partner'].includes(person.role), `people.${index}.role`)
    requireShape(!roles.has(person.role), `people.${index}.duplicateRole`)
    roles.add(person.role)
    requireShape(finite(person.ageInBaseYear) && finite(person.retirementAge) && finite(person.cppAnnualAt65) && finite(person.oasAnnualAt65) && finite(person.pensionAnnual), `people.${index}.amounts`)
    for (const key of ['earnedIncome', 'previousYearEarnedIncome', 'rrspDeductionLimit', 'rrspAvailableRoom', 'tfsaAvailableRoom'] as const) known(person[key], `people.${index}.${key}`)
    requireShape(person.pension === null || object(person.pension), `people.${index}.pension`)
    if (person.pension) for (const key of ['annualAmount', 'startAge', 'indexation', 'bridgeAnnual']) requireShape(finite(person.pension[key]), `people.${index}.pension.${key}`)
    provenanceMap(person.provenance, `people.${index}.provenance`)
  }
  requireShape(roles.has('self'), 'people.self')
  if (plan.orphanedPeople !== undefined) {
    const orphanIds = uniqueIds(plan.orphanedPeople, 'orphanedPeople')
    for (const [index, person] of plan.orphanedPeople.entries()) {
      requireShape(!people.has(person.id) && orphanIds.has(person.id), `orphanedPeople.${index}.id`)
      requireShape(['self', 'partner'].includes(person.role) && finite(person.ageInBaseYear) && finite(person.retirementAge), `orphanedPeople.${index}.identity`)
      requireShape(finite(person.cppAnnualAt65) && finite(person.oasAnnualAt65) && finite(person.pensionAnnual), `orphanedPeople.${index}.amounts`)
      for (const key of ['earnedIncome', 'previousYearEarnedIncome', 'rrspDeductionLimit', 'rrspAvailableRoom', 'tfsaAvailableRoom'] as const) known(person[key], `orphanedPeople.${index}.${key}`)
      requireShape(person.pension === null || object(person.pension), `orphanedPeople.${index}.pension`)
      if (person.pension) for (const key of ['annualAmount', 'startAge', 'indexation', 'bridgeAnnual'] as const) requireShape(finite(person.pension[key]), `orphanedPeople.${index}.pension.${key}`)
      provenanceMap(person.provenance, `orphanedPeople.${index}.provenance`)
    }
  }
  const accounts = uniqueIds(plan.accounts, 'accounts')
  for (const [index, account] of plan.accounts.entries()) {
    requireShape(['tfsa', 'rrsp', 'spousalRrsp', 'rrif', 'nonReg', 'fhsa', 'lira', 'lif'].includes(account.kind), `accounts.${index}.kind`)
    requireShape(account.ownerId === null || people.has(account.ownerId), `accounts.${index}.ownerId`)
    requireShape(finite(account.balance) && finite(account.realReturn) && (account.volatility === null || finite(account.volatility)) && finite(account.annualFee), `accounts.${index}.amounts`)
    known(account.acb, `accounts.${index}.acb`)
    known(account.contributionRoom, `accounts.${index}.contributionRoom`)
    known(account.openedYear, `accounts.${index}.openedYear`)
    taxShares(account.taxableOwnerShares, people, `accounts.${index}.taxableOwnerShares`)
    requireShape(account.accessibleAge === undefined || finite(account.accessibleAge), `accounts.${index}.accessibleAge`)
    requireShape(account.accessibleAgeConfirmed === undefined || typeof account.accessibleAgeConfirmed === 'boolean', `accounts.${index}.accessibleAgeConfirmed`)
    requireShape(account.rrifAgeElection === undefined || account.rrifAgeElection === null || object(account.rrifAgeElection) && people.has(account.rrifAgeElection.personId) && typeof account.rrifAgeElection.electedAtOpening === 'boolean', `accounts.${index}.rrifAgeElection`)
    provenanceMap(account.provenance, `accounts.${index}.provenance`)
  }
  const properties = uniqueIds(plan.properties, 'properties')
  const debts = uniqueIds(plan.debts, 'debts')
  for (const [index, property] of plan.properties.entries()) {
    requireShape(['principal', 'investment'].includes(property.kind), `properties.${index}.kind`)
    requireShape(finite(property.value) && finite(property.appreciation), `properties.${index}.amounts`)
    requireShape(property.sellAtAge === null || finite(property.sellAtAge), `properties.${index}.sellAtAge`)
    requireShape(property.plannedPurchaseAge === null || finite(property.plannedPurchaseAge), `properties.${index}.plannedPurchaseAge`)
    requireShape(property.plannedDownPayment === null || finite(property.plannedDownPayment), `properties.${index}.plannedDownPayment`)
    requireShape(property.mortgageDebtId === null || debts.has(property.mortgageDebtId), `properties.${index}.mortgageDebtId`)
    known(property.acb, `properties.${index}.acb`)
    known(property.annualRent, `properties.${index}.annualRent`)
    taxShares(property.taxableOwnerShares, people, `properties.${index}.taxableOwnerShares`)
    provenanceMap(property.provenance, `properties.${index}.provenance`)
  }
  for (const [index, debt] of plan.debts.entries()) {
    requireShape(['mortgage', 'carLoan', 'other'].includes(debt.kind), `debts.${index}.kind`)
    requireShape(debt.propertyId === null || properties.has(debt.propertyId), `debts.${index}.propertyId`)
    requireShape(finite(debt.principal) && finite(debt.annualPayment) && finite(debt.yearsRemaining), `debts.${index}.amounts`)
    provenance(debt.provenance, `debts.${index}.provenance`)
  }
  for (const [index, property] of plan.properties.entries()) if (property.mortgageDebtId !== null) {
    const debt = plan.debts.find(item => item.id === property.mortgageDebtId)
    requireShape(debt?.propertyId === property.id && debt.kind === 'mortgage', `properties.${index}.mortgageLink`)
  }
  uniqueIds(plan.contributions, 'contributions')
  for (const [index, contribution] of plan.contributions.entries()) {
    requireShape(accounts.has(contribution.accountId) && (contribution.contributorId === null || people.has(contribution.contributorId)), `contributions.${index}.references`)
    requireShape(integer(contribution.calendarYear) && finite(contribution.amount) && (contribution.deductionYear === null || integer(contribution.deductionYear)), `contributions.${index}.amounts`)
    provenance(contribution.provenance, `contributions.${index}.provenance`)
  }
  uniqueIds(plan.incomeSources, 'incomeSources')
  for (const [index, income] of plan.incomeSources.entries()) {
    requireShape(['cpp', 'oas', 'pension', 'employment', 'other', 'rent'].includes(income.kind), `incomeSources.${index}.kind`)
    requireShape(income.recipientId === null || people.has(income.recipientId), `incomeSources.${index}.recipientId`)
    known(income.annualAmount, `incomeSources.${index}.annualAmount`)
    for (const key of ['startAge', 'fromAge', 'toAge'] as const) requireShape(income[key] === undefined || finite(income[key]), `incomeSources.${index}.${key}`)
    provenance(income.provenance, `incomeSources.${index}.provenance`)
  }
  uniqueIds(plan.dependents, 'dependents')
  for (const [index, dependent] of plan.dependents.entries()) {
    requireShape(finite(dependent.ageInBaseYear), `dependents.${index}.ageInBaseYear`)
    provenance(dependent.provenance, `dependents.${index}.provenance`)
  }
  requireShape(['meltdownPaced', 'rrspFirst', 'nonRegFirst', 'tfsaFirst'].includes(plan.strategy as string), 'strategy')
  requireShape(['legacy', 'dieWithZero'].includes(plan.goal as string) && finite(plan.lifeExpectancy), 'goal/lifeExpectancy')
  known(plan.targetAssets, 'targetAssets')
  requireShape(object(plan.legacyProjection), 'legacyProjection')
  requireShape(object(plan.migration) && integer(plan.migration.sourcePersistVersion) && typeof plan.migration.ownershipNeedsConfirmation === 'boolean' && typeof plan.migration.ageBasisNeedsConfirmation === 'boolean' && typeof plan.migration.savingsBasisNeedsConfirmation === 'boolean', 'migration')
}
