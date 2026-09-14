import type { InputsV2 } from './model'
import type { Inputs } from './types'

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
/** A CRA room/adjustment amount is a finite nonnegative nominal figure. */
function knownNonnegative(value: unknown, path: string) {
  known(value, path)
  const fact = value as { status: string; value?: number }
  requireShape(fact.status === 'unknown' || (fact.value as number) >= 0, `${path}.value`)
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

/** Structural preflight for the projection/form adapter after old-version defaults are applied. */
export function assertLegacyInputs(value: unknown): asserts value is Inputs {
  requireShape(object(value), 'legacy.inputs')
  const input = value as unknown as Inputs
  const amount = (entry: unknown, path: string) => requireShape(finite(entry), `legacy.${path}`)
  const optionalAmount = (entry: unknown, path: string) => { if (entry !== undefined) amount(entry, path) }
  for (const key of ['currentAge', 'fireAge', 'lifeExpectancy', 'annualSavings', 'retirementSpending', 'nonRegBook', 'cppStartAge', 'cppAnnualAt65', 'oasStartAge', 'oasAnnualAt65'] as const) amount(input[key], key)
  for (const key of ['fees', 'inflation', 'nonRegDistributionYield', 'accumulationMarginalRate'] as const) optionalAmount(input[key], key)
  if (input.fireTargetAssets !== null) optionalAmount(input.fireTargetAssets, 'fireTargetAssets')
  const provinces = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']
  requireShape(provinces.includes(input.province) && ['meltdownPaced', 'rrspFirst', 'nonRegFirst', 'tfsaFirst'].includes(input.strategy), 'legacy.province/strategy')
  requireShape(input.goal === undefined || ['legacy', 'dieWithZero'].includes(input.goal), 'legacy.goal')
  requireShape(input.meltdownBracketCap === undefined || ['bracket1', 'bracket2', 'oasClawback'].includes(input.meltdownBracketCap), 'legacy.meltdownBracketCap')
  for (const [key, map] of [['balances', input.balances], ['returns', input.returns], ['savingsSplit', input.savingsSplit]] as const) {
    requireShape(object(map), `legacy.${key}`)
    for (const account of ['tfsa', 'rrsp', 'nonReg'] as const) amount(map[account], `${key}.${account}`)
  }
  if (input.volatilities !== undefined) {
    requireShape(object(input.volatilities), 'legacy.volatilities')
    for (const account of ['tfsa', 'rrsp', 'nonReg'] as const) amount(input.volatilities[account], `volatilities.${account}`)
  }
  const pension = (p: unknown, path: string) => {
    if (p == null) return
    requireShape(object(p), path)
    for (const key of ['annualAmount', 'startAge', 'indexation', 'bridgeAnnual'] as const) amount(p[key], `${path}.${key}`)
  }
  const work = (w: unknown, path: string) => {
    if (w == null) return
    requireShape(object(w), path)
    amount(w.startWorkAge, `${path}.startWorkAge`)
    amount(w.retireAge, `${path}.retireAge`)
  }
  pension(input.pension, 'pension')
  work(input.cppWork, 'cppWork')
  if (input.partner != null) {
    requireShape(object(input.partner), 'legacy.partner')
    for (const key of ['currentAge', 'cppStartAge', 'cppAnnualAt65', 'oasStartAge', 'oasAnnualAt65'] as const) amount(input.partner[key], `partner.${key}`)
    pension(input.partner.pension, 'partner.pension')
    work(input.partner.cppWork, 'partner.cppWork')
  }
  if (input.fhsa != null) {
    requireShape(object(input.fhsa), 'legacy.fhsa')
    for (const key of ['balance', 'annualContribution', 'openedYearsAgo'] as const) amount(input.fhsa[key], `fhsa.${key}`)
  }
  if (input.lockedRetirement != null) {
    requireShape(object(input.lockedRetirement), 'legacy.lockedRetirement')
    for (const key of ['balance', 'employeeContribution', 'employerContribution', 'accessibleAge'] as const) amount(input.lockedRetirement[key], `lockedRetirement.${key}`)
    requireShape(['self', 'partner'].includes(input.lockedRetirement.owner) && ['federal', ...provinces].includes(input.lockedRetirement.jurisdiction), 'legacy.lockedRetirement.owner/jurisdiction')
  }
  if (input.extraIncome != null) {
    requireShape(object(input.extraIncome), 'legacy.extraIncome')
    for (const key of ['annual', 'fromAge', 'toAge'] as const) amount(input.extraIncome[key], `extraIncome.${key}`)
  }
  if (input.principalResidence != null) {
    requireShape(object(input.principalResidence), 'legacy.principalResidence')
    const p = input.principalResidence
    requireShape(p.mode === undefined || p.mode === 'owned' || p.mode === 'planned', 'legacy.principalResidence.mode')
    if (p.mode === 'planned') {
      for (const key of ['buyAtAge', 'price', 'downPayment', 'appreciation', 'netHoldingCostChange'] as const) amount(p[key], `principalResidence.${key}`)
      optionalAmount(p.annualMortgagePayment, 'principalResidence.annualMortgagePayment')
      optionalAmount(p.mortgageYears, 'principalResidence.mortgageYears')
    } else {
      for (const key of ['value', 'appreciation'] as const) amount(p[key], `principalResidence.${key}`)
      if (p.mortgage != null) {
        requireShape(object(p.mortgage), 'legacy.principalResidence.mortgage')
        for (const key of ['balance', 'annualPayment', 'yearsRemaining'] as const) amount(p.mortgage[key], `principalResidence.mortgage.${key}`)
      }
    }
    requireShape(p.sellAtAge === null || finite(p.sellAtAge), 'legacy.principalResidence.sellAtAge')
  }
  for (const [listName, items] of [['investmentProperties', input.investmentProperties], ['debts', input.debts]] as const) {
    if (items == null) continue
    requireShape(Array.isArray(items), `legacy.${listName}`)
    for (const [index, item] of items.entries()) {
      requireShape(object(item), `legacy.${listName}.${index}`)
      if (listName === 'debts') requireShape(typeof item.kind === 'string' && ['mortgage', 'carLoan', 'other'].includes(item.kind), `legacy.${listName}.${index}.kind`)
      for (const key of listName === 'debts' ? ['balance', 'annualPayment', 'yearsRemaining'] : ['value', 'acb', 'appreciation']) amount(item[key as keyof typeof item], `${listName}.${index}.${key}`)
      if (listName === 'investmentProperties') {
        optionalAmount(item.annualRent, `${listName}.${index}.annualRent`)
        requireShape(item.sellAtAge === null || finite(item.sellAtAge), `legacy.${listName}.${index}.sellAtAge`)
        if (item.mortgage != null) {
          requireShape(object(item.mortgage), `legacy.${listName}.${index}.mortgage`)
          for (const key of ['balance', 'annualPayment', 'yearsRemaining'] as const) amount(item.mortgage[key], `${listName}.${index}.mortgage.${key}`)
        }
      }
    }
  }
  if (input.children != null) {
    requireShape(Array.isArray(input.children), 'legacy.children')
    input.children.forEach((child, index) => { requireShape(object(child), `legacy.children.${index}`); amount(child.age, `children.${index}.age`) })
  }
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
    for (const key of ['earnedIncome', 'previousYearEarnedIncome'] as const) known(person[key], `people.${index}.${key}`)
    for (const key of ['rrspDeductionLimit', 'rrspAvailableRoom', 'tfsaAvailableRoom', 'rrspUnusedUndeducted', 'rrspPensionAdjustment', 'rrspPspa', 'rrspPar'] as const) knownNonnegative(person[key], `people.${index}.${key}`)
    requireShape(person.pension === null || object(person.pension), `people.${index}.pension`)
    requireShape(person.cppWork === null || object(person.cppWork) && finite(person.cppWork.startWorkAge) && finite(person.cppWork.retireAge), `people.${index}.cppWork`)
    if (person.pension) for (const key of ['annualAmount', 'startAge', 'indexation', 'bridgeAnnual']) requireShape(finite(person.pension[key]), `people.${index}.pension.${key}`)
    provenanceMap(person.provenance, `people.${index}.provenance`)
  }
  requireShape(roles.has('self'), 'people.self')
  const orphanIds = plan.orphanedPeople !== undefined ? uniqueIds(plan.orphanedPeople, 'orphanedPeople') : new Set<string>()
  if (plan.orphanedPeople !== undefined) {
    for (const [index, person] of plan.orphanedPeople.entries()) {
      requireShape(!people.has(person.id) && orphanIds.has(person.id), `orphanedPeople.${index}.id`)
      requireShape(['self', 'partner'].includes(person.role) && finite(person.ageInBaseYear) && finite(person.retirementAge), `orphanedPeople.${index}.identity`)
      requireShape(finite(person.cppAnnualAt65) && finite(person.oasAnnualAt65) && finite(person.pensionAnnual), `orphanedPeople.${index}.amounts`)
      for (const key of ['earnedIncome', 'previousYearEarnedIncome'] as const) known(person[key], `orphanedPeople.${index}.${key}`)
      for (const key of ['rrspDeductionLimit', 'rrspAvailableRoom', 'tfsaAvailableRoom', 'rrspUnusedUndeducted', 'rrspPensionAdjustment', 'rrspPspa', 'rrspPar'] as const) knownNonnegative(person[key], `orphanedPeople.${index}.${key}`)
      requireShape(person.pension === null || object(person.pension), `orphanedPeople.${index}.pension`)
      requireShape(person.cppWork === null || object(person.cppWork) && finite(person.cppWork.startWorkAge) && finite(person.cppWork.retireAge), `orphanedPeople.${index}.cppWork`)
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
    requireShape(account.openedYearsAgoAtBaseYear === null || finite(account.openedYearsAgoAtBaseYear), `accounts.${index}.openedYearsAgoAtBaseYear`)
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
    requireShape(finite(property.annualHoldingCostChange), `properties.${index}.annualHoldingCostChange`)
    requireShape(property.plannedMortgage === null || object(property.plannedMortgage) && finite(property.plannedMortgage.principal) && (property.plannedMortgage.annualPayment === null || finite(property.plannedMortgage.annualPayment)) && (property.plannedMortgage.yearsRemaining === null || finite(property.plannedMortgage.yearsRemaining)), `properties.${index}.plannedMortgage`)
    requireShape(property.mortgageDebtId === null || debts.has(property.mortgageDebtId), `properties.${index}.mortgageDebtId`)
    known(property.acb, `properties.${index}.acb`)
    if (property.saleExpenses !== undefined) known(property.saleExpenses, `properties.${index}.saleExpenses`)
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
  uniqueIds(plan.recurringContributions, 'recurringContributions')
  for (const [index, contribution] of plan.recurringContributions.entries()) {
    requireShape(accounts.has(contribution.accountId) && (contribution.contributorId === null || people.has(contribution.contributorId)), `recurringContributions.${index}.references`)
    requireShape(finite(contribution.annualAmount) && ['fromSavings', 'employerAdditional'].includes(contribution.funding), `recurringContributions.${index}.amounts`)
    provenance(contribution.provenance, `recurringContributions.${index}.provenance`)
  }
  requireShape(object(plan.savingsAllocation) && object(plan.savingsAllocation.shares), 'savingsAllocation')
  for (const kind of ['tfsa', 'rrsp', 'nonReg'] as const) requireShape(finite(plan.savingsAllocation.shares[kind]), `savingsAllocation.${kind}`)
  provenance(plan.savingsAllocation.provenance, 'savingsAllocation.provenance')
  requireShape(object(plan.projectionAssumptions) && finite(plan.projectionAssumptions.nonRegDistributionYield) && finite(plan.projectionAssumptions.accumulationMarginalRate) && ['bracket1', 'bracket2', 'oasClawback'].includes(plan.projectionAssumptions.meltdownBracketCap), 'projectionAssumptions')
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
  if (plan.ownershipAmounts !== undefined) {
    requireShape(object(plan.ownershipAmounts), 'ownershipAmounts')
    for (const [baseId, amounts] of Object.entries(plan.ownershipAmounts)) {
      requireShape(object(amounts), `ownershipAmounts.${baseId}`)
      for (const [personId, amount] of Object.entries(amounts)) {
        // A recorded split may stay keyed by a removed person's id so that
        // re-adding the partner can restore it; those ids live on in
        // orphanedPeople. Ids that reference nobody at all are still rejected.
        requireShape(people.has(personId) || orphanIds.has(personId), `ownershipAmounts.${baseId}.${personId}.owner`)
        requireShape(finite(amount) && (amount as number) >= 0, `ownershipAmounts.${baseId}.${personId}`)
      }
    }
  }
  assertLegacyInputs(plan.legacyProjection)
  if (plan.spousalHistory !== undefined) {
    requireShape(object(plan.spousalHistory), 'spousalHistory')
    for (const [accountId, entry] of Object.entries(plan.spousalHistory)) {
      requireShape(accounts.has(accountId), `spousalHistory.${accountId}.account`)
      requireShape(object(entry), `spousalHistory.${accountId}`)
      if (entry.status === 'unknown') requireShape(text(entry.reason), `spousalHistory.${accountId}.reason`)
      else requireShape(entry.status === 'complete', `spousalHistory.${accountId}.status`)
    }
  }
  // BE-36 A: optional, so an old persisted envelope without it still hydrates.
  // An entry that is present must be a real FHSA statement fact; an absent
  // entry means the history is unknown, never a real zero.
  if (plan.fhsaStatementHistory !== undefined) {
    requireShape(object(plan.fhsaStatementHistory), 'fhsaStatementHistory')
    for (const [accountId, entry] of Object.entries(plan.fhsaStatementHistory)) {
      requireShape(accounts.has(accountId), `fhsaStatementHistory.${accountId}.account`)
      requireShape(plan.accounts.some(account => account.id === accountId && account.kind === 'fhsa'), `fhsaStatementHistory.${accountId}.kind`)
      requireShape(object(entry), `fhsaStatementHistory.${accountId}`)
      knownNonnegative(entry.cumulativePriorContributions, `fhsaStatementHistory.${accountId}.cumulativePriorContributions`)
      provenance(entry.provenance, `fhsaStatementHistory.${accountId}.provenance`)
    }
  }
  // BE-27 A: optional, so an old persisted envelope without it still hydrates.
  // An entry that is present must be a real per-person TFSA statement fact; an
  // absent entry means the history is unknown, never a real zero.
  if (plan.tfsaStatement !== undefined) {
    requireShape(object(plan.tfsaStatement), 'tfsaStatement')
    for (const [personId, entry] of Object.entries(plan.tfsaStatement)) {
      requireShape(people.has(personId), `tfsaStatement.${personId}.person`)
      requireShape(object(entry), `tfsaStatement.${personId}`)
      requireShape(Array.isArray(entry.withdrawals), `tfsaStatement.${personId}.withdrawals`)
      const withdrawalIds = new Set<string>()
      for (const [index, withdrawal] of entry.withdrawals.entries()) {
        requireShape(object(withdrawal) && text(withdrawal.id) && !withdrawalIds.has(withdrawal.id), `tfsaStatement.${personId}.withdrawals.${index}.id`)
        withdrawalIds.add(withdrawal.id)
        requireShape(integer(withdrawal.calendarYear) && finite(withdrawal.amount) && withdrawal.amount >= 0, `tfsaStatement.${personId}.withdrawals.${index}.amounts`)
      }
      provenance(entry.provenance, `tfsaStatement.${personId}.provenance`)
    }
  }
  requireShape(object(plan.migration) && integer(plan.migration.sourcePersistVersion) && typeof plan.migration.ownershipNeedsConfirmation === 'boolean' && typeof plan.migration.ageBasisNeedsConfirmation === 'boolean' && typeof plan.migration.savingsBasisNeedsConfirmation === 'boolean', 'migration')
}
