import type { Inputs, InvestmentProperty } from './types'
import type { Account, Debt, IncomeSource, InputsV2, Person, Property, Provenance, TaxShares } from './model'
import { fhsaPlanRowId } from './fhsaPlan'
import { assertLegacyInputs } from './modelValidation'

const unknown = (reason: string): { status: 'unknown'; reason: string } => ({ status: 'unknown', reason })
const known = <T>(value: T): { status: 'known'; value: T } => ({ status: 'known', value })
const source: Provenance = { origin: 'legacy', sourceYear: null }
const shares = (ownerId: string | null): TaxShares => ownerId ? { status: 'known', shares: { [ownerId]: 1 } } : unknown('legacy household tax ownership')
const finite = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const legacyId = (kind: string, index?: number) => `legacy:${kind}${index === undefined ? '' : `:${index}`}`
const normalizeListIds = <T extends { id?: string }>(items: T[], kind: string): T[] => {
  const result = items.map((item, index) => ({ ...item, id: item.id ?? legacyId(kind, index) }))
  if (new Set(result.map(item => item.id)).size !== result.length) throw new Error(`Duplicate ${kind} ID`)
  return result
}

/** Deterministic id of the second person's account when a household total is split. */
export const derivedAccountId = (baseId: string): string => `${baseId}:partner`

/** Base account ids whose household total can be recorded per person. */
const SPLIT_BASE_IDS = ['legacy:account:tfsa', 'legacy:account:rrsp', 'legacy:account:locked', 'legacy:account:fhsa'] as const
/**
 * The registered kinds whose household total can be recorded per person.
 * An FHSA belongs here for the same reason an RRSP does: it is one person's
 * account, never jointly owned, so a household total that two people hold is
 * two accounts. BE-36 A prices at most one active FHSA, so a recorded two-way
 * split is refused with its own typed reason by the ledger, not silently
 * attributed to one holder.
 */
const SPLIT_KINDS: readonly Account['kind'][] = ['tfsa', 'rrsp', 'spousalRrsp', 'rrif', 'lif', 'lira', 'fhsa']
const userOrigin: Provenance = { origin: 'user', sourceYear: null }

const assertSplitAmounts = (selfAmount: number, partnerAmount: number): void => {
  if (!Number.isFinite(selfAmount) || selfAmount < 0 || !Number.isFinite(partnerAmount) || partnerAmount < 0)
    throw new Error('split amounts must be finite and non-negative')
}

/** Two per-person amounts count as a recorded split of a household total when
 * their sum matches within a tolerance scaled to the total. The scale matches
 * the 1e-8 share-sum validation: amounts that pass here produce shares whose
 * sum deviates by less than 1e-8, for sub-dollar totals included. */
export const splitAmountsMatch = (selfAmount: number, partnerAmount: number, total: number): boolean => {
  if (!Number.isFinite(selfAmount) || !Number.isFinite(partnerAmount) || !Number.isFinite(total)) return false
  if (total === 0) return selfAmount === 0 && partnerAmount === 0
  return Math.abs(selfAmount + partnerAmount - total) < 1e-8 * Math.abs(total)
}

const requireSplitMatch = (selfAmount: number, partnerAmount: number, total: number): void => {
  if (!splitAmountsMatch(selfAmount, partnerAmount, total))
    throw new Error(`split amounts ${selfAmount} + ${partnerAmount} do not match the household total ${total}`)
}

/** The id the sole surviving account keeps when a split collapses to one
 * owner: always the base id. The row keeps one stable canonical id across
 * collapse and re-split, contribution rows that pin the base id stay live,
 * and the shared panel can keep rendering the row's registered-type control
 * for a partner-owned account. */
const collapsedAccountId = (baseId: string): string => baseId

const recheckOwnership = (plan: InputsV2): void => {
  plan.migration = { ...plan.migration, ownershipNeedsConfirmation: plan.accounts.some(account =>
    account.kind !== 'nonReg' && !account.ownerId || account.taxableOwnerShares.status === 'unknown') ||
    plan.properties.some(property => property.taxableOwnerShares.status === 'unknown') }
}

/**
 * Record how much of one household account total belongs to each spouse.
 * Registered/locked kinds become person-owned canonical accounts (two when
 * both amounts are positive, exactly one otherwise); the non-registered
 * account keeps one account with proportional `taxableOwnerShares`. The two
 * amounts must add up to the account's current balance — nothing is ever
 * split silently. Mutates `plan` in place for use inside a store transaction.
 */
export function applyAccountSplit(plan: InputsV2, baseId: string, selfAmount: number, partnerAmount: number,
  options: { zeroOwnerId?: string | null } = {}): void {
  assertSplitAmounts(selfAmount, partnerAmount)
  const derivedId = derivedAccountId(baseId)
  const base = plan.accounts.find(account => account.id === baseId)
  const existingDerived = plan.accounts.find(account => account.id === derivedId)
  const template = base ?? existingDerived
  if (!template) throw new Error(`account not found: ${baseId}`)
  // The household total is the sum of the row's accounts; in a previously
  // recorded split the base account only holds one person's amount.
  const total = (base?.balance ?? 0) + (existingDerived?.balance ?? 0)
  requireSplitMatch(selfAmount, partnerAmount, total)
  const self = plan.people.find(person => person.role === 'self')
  const partner = plan.people.find(person => person.role === 'partner')
  if (!self || !partner) throw new Error(`account split requires two people: ${baseId}`)
  if (template.kind === 'nonReg') {
    if (total === 0 && selfAmount === 0 && partnerAmount === 0) return
    plan.accounts = plan.accounts.map(account => account.id === baseId ? {
      ...account,
      ownerId: selfAmount === total ? self.id : partnerAmount === total ? partner.id : null,
      taxableOwnerShares: { status: 'known', shares: { [self.id]: selfAmount / total, [partner.id]: partnerAmount / total } },
    } : account)
    recheckOwnership(plan)
    return
  }
  if (!SPLIT_KINDS.includes(template.kind)) throw new Error(`account kind cannot be split: ${template.kind}`)
  const owned = (account: Account, id: string, ownerId: string, balance: number): Account => ({
    ...account, id, ownerId, balance,
    taxableOwnerShares: { status: 'known', shares: { [ownerId]: 1 } },
    provenance: { ...account.provenance, ownerId: userOrigin, balance: userOrigin },
  })
  const next: Account[] = plan.accounts.filter(account => account.id !== baseId && account.id !== derivedId)
  if (selfAmount > 0) next.push(owned(template, baseId, self.id, selfAmount))
  if (partnerAmount > 0) next.push(owned(template, selfAmount === 0 ? collapsedAccountId(baseId) : derivedId, partner.id, partnerAmount))
  if (selfAmount === 0 && partnerAmount === 0) {
    const ownerId = options.zeroOwnerId && plan.people.some(person => person.id === options.zeroOwnerId) ? options.zeroOwnerId : null
    next.push({ ...template, id: baseId, balance: 0, ownerId,
      taxableOwnerShares: ownerId ? { status: 'known', shares: { [ownerId]: 1 } } : unknown('zero-balance household account ownership not assigned'),
      provenance: { ...template.provenance, balance: userOrigin } })
  }
  plan.accounts = next
  plan.ownershipAmounts = { ...(plan.ownershipAmounts ?? {}), [baseId]: { [self.id]: selfAmount, [partner.id]: partnerAmount } }
  recheckOwnership(plan)
}

/** Pure copy of {@link applyAccountSplit}; rejects a mismatch without writing. */
export function recordAccountSplit(plan: InputsV2, baseId: string, selfAmount: number, partnerAmount: number,
  options?: { zeroOwnerId?: string | null }): InputsV2 {
  const next = structuredClone(plan)
  applyAccountSplit(next, baseId, selfAmount, partnerAmount, options)
  return next
}

/**
 * Record each spouse's share of one investment property's value as
 * proportional `taxableOwnerShares`. The two amounts must add up to the
 * property's current value. Mutates `plan` in place.
 */
export function applyPropertySplit(plan: InputsV2, propertyId: string, selfAmount: number, partnerAmount: number): void {
  assertSplitAmounts(selfAmount, partnerAmount)
  const property = plan.properties.find(item => item.id === propertyId)
  if (!property) throw new Error(`property not found: ${propertyId}`)
  if (property.value === 0 && selfAmount === 0 && partnerAmount === 0) return
  requireSplitMatch(selfAmount, partnerAmount, property.value)
  const self = plan.people.find(person => person.role === 'self')
  const partner = plan.people.find(person => person.role === 'partner')
  if (!self || !partner) throw new Error(`property split requires two people: ${propertyId}`)
  plan.properties = plan.properties.map(item => item.id === propertyId ? { ...item,
    taxableOwnerShares: { status: 'known', shares: { [self.id]: selfAmount / property.value, [partner.id]: partnerAmount / property.value } } } : item)
  recheckOwnership(plan)
}

/** Pure copy of {@link applyPropertySplit}; rejects a mismatch without writing. */
export function recordPropertySplit(plan: InputsV2, propertyId: string, selfAmount: number, partnerAmount: number): InputsV2 {
  const next = structuredClone(plan)
  applyPropertySplit(next, propertyId, selfAmount, partnerAmount)
  return next
}

/** Restore, suspend or collapse a recorded per-person split of one household
 * account total after the legacy form edited the plan. The recorded amounts
 * are the fact; when the new household total no longer equals their sum (or a
 * person was removed and re-added, or the locked-account owner was reasserted
 * in the legacy form), the single migrated account keeps the conserved total
 * with unconfirmed ownership while the recorded amounts stay visible. */
function reconcileOwnershipSplit(prior: InputsV2, next: InputsV2, baseId: string,
  options: { expandedHousehold: boolean; lockedOwnerReset: boolean }): void {
  const base = next.accounts.find(account => account.id === baseId)
  const entry = next.ownershipAmounts?.[baseId]
  if (!base) {
    if (entry) {
      const { [baseId]: _dropped, ...rest } = next.ownershipAmounts!
      next.ownershipAmounts = Object.keys(rest).length ? rest : undefined
    }
    return
  }
  const derivedId = derivedAccountId(baseId)
  const priorBase = prior.accounts.find(account => account.id === baseId)
  const priorDerived = prior.accounts.find(account => account.id === derivedId)
  const self = next.people.find(person => person.role === 'self')
  const partner = next.people.find(person => person.role === 'partner')
  // Recorded amounts come from the entry; a defensive fallback reads the two
  // prior owned accounts' balances when an entry is missing.
  const recorded = entry ?? (priorBase && priorDerived && priorBase.ownerId && priorDerived.ownerId && self && partner
    ? { [self.id]: priorBase.ownerId === self.id ? priorBase.balance : priorDerived.balance,
        [partner.id]: priorBase.ownerId === partner.id ? priorBase.balance : priorDerived.balance }
    : undefined)
  if (!recorded) return
  const selfAmount = self ? recorded[self.id] : undefined
  const partnerAmount = partner ? recorded[partner.id] : undefined
  const matches = selfAmount !== undefined && partnerAmount !== undefined &&
    splitAmountsMatch(selfAmount, partnerAmount, base.balance)
  if (matches && !options.expandedHousehold && !options.lockedOwnerReset) {
    if (!self || !partner) return
    next.accounts = next.accounts.filter(account => account.id !== baseId && account.id !== derivedId)
    const template = priorBase ?? base
    const partnerTemplate = priorDerived ?? template
    const owned = (account: Account, id: string, ownerId: string, balance: number): Account => ({
      ...account, id, ownerId, balance,
      taxableOwnerShares: { status: 'known', shares: { [ownerId]: 1 } },
      provenance: { ...account.provenance, ownerId: userOrigin, balance: userOrigin },
    })
    if (selfAmount > 0) next.accounts.push(owned(template, baseId, self.id, selfAmount))
    if (partnerAmount > 0) next.accounts.push(owned(partnerTemplate, selfAmount === 0 ? collapsedAccountId(baseId) : derivedId, partner.id, partnerAmount))
    if (selfAmount === 0 && partnerAmount === 0) {
      const ownerId = priorBase?.ownerId && next.people.some(person => person.id === priorBase.ownerId) ? priorBase.ownerId : null
      next.accounts.push({ ...template, id: baseId, balance: 0, ownerId,
        taxableOwnerShares: ownerId ? { status: 'known', shares: { [ownerId]: 1 } } : unknown('zero-balance household account ownership not assigned'),
        provenance: { ...template.provenance, balance: userOrigin } })
    }
    next.ownershipAmounts ??= {}
    next.ownershipAmounts[baseId] = recorded
    return
  }
  // Mismatch, guarded re-add or an explicit locked-owner reset: keep the
  // migrated single account (the conserved household total) and suspend
  // ownership, but never drop or rewrite the recorded amounts.
  next.accounts = next.accounts.filter(account => account.id !== derivedId)
  if (options.lockedOwnerReset && base.ownerId && self && partner) {
    next.ownershipAmounts ??= {}
    next.ownershipAmounts[baseId] = { [self.id]: base.ownerId === self.id ? base.balance : 0,
      [partner.id]: base.ownerId === partner.id ? base.balance : 0 }
  } else {
    base.ownerId = null
    base.taxableOwnerShares = unknown('household total no longer matches the recorded per-person amounts')
    next.ownershipAmounts ??= {}
    next.ownershipAmounts[baseId] = recorded
  }
}

/** Pure, deterministic migration of a previously supported persisted plan. */
export function migratePersistedPlan(raw: unknown, persistVersion: number, baseYear: number): InputsV2 {
  if (persistVersion > 10 || persistVersion < 0) throw new Error('Unsupported persisted version')
  if (!raw || typeof raw !== 'object') throw new Error('Invalid persisted state')
  const state = raw as { inputs?: Inputs; canonical?: InputsV2 }
  if (state.canonical?.schemaVersion === 2) return state.canonical
  const legacyInput = state.inputs as (Inputs & { withdrawalOrder?: string[]; investmentProperty?: InvestmentProperty | null }) | undefined
  if (!legacyInput || typeof legacyInput !== 'object' || !legacyInput.balances || typeof legacyInput.balances !== 'object') throw new Error('Invalid legacy inputs')
  const input: Inputs = { ...legacyInput,
    strategy: legacyInput.strategy ?? (legacyInput.withdrawalOrder?.[0] === 'tfsa' ? 'tfsaFirst' : legacyInput.withdrawalOrder?.[0] === 'nonReg' ? 'nonRegFirst' : 'meltdownPaced'),
    investmentProperties: normalizeListIds(legacyInput.investmentProperties ?? (legacyInput.investmentProperty ? [legacyInput.investmentProperty] : []), 'property:investment'),
    debts: normalizeListIds(legacyInput.debts ?? [], 'debt:other'),
  }
  assertLegacyInputs(input)
  const requireAmount = (value: unknown, label: string) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid legacy amount: ${label}`)
  }
  for (const kind of ['tfsa', 'rrsp', 'nonReg'] as const) requireAmount(input.balances[kind], `balances.${kind}`)
  if (input.nonRegBook !== undefined) requireAmount(input.nonRegBook, 'nonRegBook')
  if (input.fhsa) requireAmount(input.fhsa.balance, 'fhsa.balance')
  if (input.lockedRetirement) requireAmount(input.lockedRetirement.balance, 'lockedRetirement.balance')
  for (const [index, property] of (input.investmentProperties ?? []).entries()) {
    requireAmount(property.value, `investmentProperties.${index}.value`)
    requireAmount(property.acb, `investmentProperties.${index}.acb`)
    if (property.saleExpenses !== undefined) requireAmount(property.saleExpenses, `investmentProperties.${index}.saleExpenses`)
    if (property.mortgage) requireAmount(property.mortgage.balance, `investmentProperties.${index}.mortgage.balance`)
  }
  for (const [index, debt] of (input.debts ?? []).entries()) requireAmount(debt.balance, `debts.${index}.balance`)
  const couple = !!input.partner
  const selfId = legacyId('person:self')
  const partnerId = legacyId('person:partner')
  const person = (id: string, role: 'self' | 'partner', age: number, cpp: number, oas: number, pension: import('./types').Pension | null): Person => ({
    id, role, ageInBaseYear: finite(age), retirementAge: role === 'self' ? finite(input.fireAge) : finite(input.fireAge) - finite(input.currentAge) + finite(age),
    earnedIncome: unknown('not present in legacy plan'), previousYearEarnedIncome: unknown('not present in legacy plan'),
    rrspDeductionLimit: unknown('CRA statement not supplied'), rrspAvailableRoom: unknown('CRA statement not supplied'),
    rrspUnusedUndeducted: unknown('CRA statement not supplied'), rrspPensionAdjustment: unknown('CRA statement not supplied'),
    rrspPspa: unknown('CRA statement not supplied'), rrspPar: unknown('CRA statement not supplied'),
    tfsaAvailableRoom: unknown('CRA statement not supplied'),
    cppAnnualAt65: finite(cpp), oasAnnualAt65: finite(oas), pensionAnnual: finite(pension?.annualAmount), pension,
    cppWork: role === 'self' ? input.cppWork ?? null : input.partner?.cppWork ?? null,
    provenance: { ageInBaseYear: source, retirementAge: source, cppAnnualAt65: source, oasAnnualAt65: source, pensionAnnual: source },
  })
  const people = [person(selfId, 'self', input.currentAge, input.cppAnnualAt65, input.oasAnnualAt65, input.pension ?? null)]
  if (input.partner) people.push(person(partnerId, 'partner', input.partner.currentAge, input.partner.cppAnnualAt65, input.partner.oasAnnualAt65, input.partner.pension ?? null))
  const ownerId = couple ? null : selfId
  const account = (id: string, kind: Account['kind'], balance: number, acb?: number, actualOwner?: string | null): Account => {
    const owner = actualOwner === undefined ? ownerId : actualOwner
    const returnKind = kind === 'tfsa' ? 'tfsa' : kind === 'nonReg' ? 'nonReg' : 'rrsp'
    return { id, kind, ownerId: owner, balance: finite(balance), realReturn: finite(input.returns?.[returnKind]), volatility: input.volatilities?.[returnKind] ?? null, annualFee: finite(input.fees), acb: acb === undefined ? unknown('basis not supplied') : known(finite(acb)), taxableOwnerShares: shares(owner), contributionRoom: unknown('statement not supplied'), openedYear: unknown('opening year not supplied'), rrifFactorCategory: unknown('RRIF qualification history not supplied'), openedYearsAgoAtBaseYear: null, provenance: { balance: source, ownerId: owner ? source : { ...source, origin: 'unknown', note: 'Legacy household balance' }, acb: acb === undefined ? { origin: 'unknown', sourceYear: null } : source } }
  }
  const accounts: Account[] = [
    account(legacyId('account:tfsa'), 'tfsa', input.balances.tfsa),
    account(legacyId('account:rrsp'), 'rrsp', input.balances.rrsp),
    account(legacyId('account:nonReg'), 'nonReg', input.balances.nonReg, input.nonRegBook),
  ]
  if (input.fhsa) {
    const a = account(legacyId('account:fhsa'), 'fhsa', input.fhsa.balance)
    a.openedYear = unknown('legacy years-ago opening needs calendar-year confirmation')
    a.openedYearsAgoAtBaseYear = input.fhsa.openedYearsAgo
    accounts.push(a)
  }
  if (input.lockedRetirement) {
    const owner = input.lockedRetirement.owner === 'partner' ? (couple ? partnerId : null) : selfId
    const a = account(legacyId('account:locked'), 'lira', input.lockedRetirement.balance, undefined, owner)
    a.jurisdiction = input.lockedRetirement.jurisdiction
    a.accessibleAge = input.lockedRetirement.accessibleAge
    a.accessibleAgeConfirmed = false
    accounts.push(a)
  }
  const debts: Debt[] = []
  const addDebt = (id: string, kind: Debt['kind'], value: { balance: number; annualPayment: number; yearsRemaining: number }, propertyId: string | null) => {
    debts.push({ id, kind, principal: finite(value.balance), annualPayment: finite(value.annualPayment), yearsRemaining: finite(value.yearsRemaining), propertyId, provenance: source })
    return id
  }
  const properties: Property[] = []
  if (input.principalResidence && ('value' in input.principalResidence)) {
    const p = input.principalResidence
    const id = legacyId('property:principal')
    properties.push({ id, kind: 'principal', value: finite(p.value), acb: unknown('principal residence basis not supplied'), annualRent: known(0), appreciation: finite(p.appreciation), sellAtAge: p.sellAtAge, plannedPurchaseAge: null, plannedDownPayment: null, plannedMortgage: null, annualHoldingCostChange: 0, taxableOwnerShares: shares(ownerId), mortgageDebtId: p.mortgage ? addDebt(`${id}:mortgage`, 'mortgage', p.mortgage, id) : null, provenance: { value: source } })
  } else if (input.principalResidence?.mode === 'planned') {
    const p = input.principalResidence
    properties.push({ id: legacyId('property:principal'), kind: 'principal', value: finite(p.price), acb: known(finite(p.price)), annualRent: known(0), appreciation: finite(p.appreciation), sellAtAge: p.sellAtAge, plannedPurchaseAge: p.buyAtAge, plannedDownPayment: finite(p.downPayment), plannedMortgage: { principal: Math.max(0, finite(p.price) - finite(p.downPayment)), annualPayment: p.annualMortgagePayment ?? null, yearsRemaining: p.mortgageYears ?? null }, annualHoldingCostChange: finite(p.netHoldingCostChange), taxableOwnerShares: shares(ownerId), mortgageDebtId: null, provenance: { value: source, plannedPurchaseAge: source, plannedMortgage: source, annualHoldingCostChange: source } })
  }
  const investmentProperties: InvestmentProperty[] = input.investmentProperties ?? []
  investmentProperties.forEach((p, i) => {
    const id = p.id ?? legacyId('property:investment', i)
    properties.push({ id, kind: 'investment', value: finite(p.value), acb: known(finite(p.acb)), saleExpenses: p.saleExpenses === undefined ? unknown('selling expenses not supplied') : known(finite(p.saleExpenses)), annualRent: known(finite(p.annualRent)), appreciation: finite(p.appreciation), sellAtAge: p.sellAtAge, plannedPurchaseAge: null, plannedDownPayment: null, plannedMortgage: null, annualHoldingCostChange: 0, taxableOwnerShares: shares(ownerId), mortgageDebtId: p.mortgage ? addDebt(`${id}:mortgage`, 'mortgage', p.mortgage, id) : null, provenance: { value: source, acb: source, annualRent: source } })
  })
  ;(input.debts ?? []).forEach((d, i) => addDebt(d.id ?? legacyId('debt:other', i), d.kind, d, null))
  const incomeSources: IncomeSource[] = []
  for (const p of people) {
    incomeSources.push({ id: `${p.id}:cpp`, kind: 'cpp', recipientId: p.id, annualAmount: known(p.cppAnnualAt65), startAge: p.role === 'self' ? input.cppStartAge : input.partner?.cppStartAge, provenance: source })
    incomeSources.push({ id: `${p.id}:oas`, kind: 'oas', recipientId: p.id, annualAmount: known(p.oasAnnualAt65), startAge: p.role === 'self' ? input.oasStartAge : input.partner?.oasStartAge, provenance: source })
    incomeSources.push({ id: `${p.id}:pension`, kind: 'pension', recipientId: p.id, annualAmount: known(p.pensionAnnual), startAge: p.pension?.startAge, provenance: source })
  }
  if (input.extraIncome) incomeSources.push({ id: legacyId('income:extra'), kind: 'other', recipientId: selfId, annualAmount: known(finite(input.extraIncome.annual)), fromAge: input.extraIncome.fromAge, toAge: input.extraIncome.toAge, provenance: source })
  return {
    schemaVersion: 2, baseYear, province: input.province, inflation: finite(input.inflation, 0.021),
    budget: { kind: 'savingsBudget', annualNetSavings: finite(input.annualSavings), retirementSpending: finite(input.retirementSpending), debtIncluded: unknown('legacy savings/debt treatment needs confirmation'), taxBenefitIncluded: unknown('legacy tax benefit treatment needs confirmation') },
    people, accounts, contributions: [], recurringContributions: [
      ...(input.fhsa ? [{ id: fhsaPlanRowId(legacyId('account:fhsa')), accountId: legacyId('account:fhsa'), contributorId: couple ? null : selfId, annualAmount: input.fhsa.annualContribution, funding: 'fromSavings' as const, provenance: source }] : []),
      ...(input.lockedRetirement ? [
        { id: legacyId('contribution:lira:employee'), accountId: legacyId('account:locked'), contributorId: input.lockedRetirement.owner === 'partner' ? (couple ? partnerId : null) : selfId, annualAmount: input.lockedRetirement.employeeContribution, funding: 'fromSavings' as const, provenance: source },
        { id: legacyId('contribution:lira:employer'), accountId: legacyId('account:locked'), contributorId: input.lockedRetirement.owner === 'partner' ? (couple ? partnerId : null) : selfId, annualAmount: input.lockedRetirement.employerContribution, funding: 'employerAdditional' as const, provenance: source },
      ] : []),
    ], savingsAllocation: { shares: { ...input.savingsSplit }, provenance: source }, projectionAssumptions: { nonRegDistributionYield: finite(input.nonRegDistributionYield), accumulationMarginalRate: finite(input.accumulationMarginalRate, .35), meltdownBracketCap: input.meltdownBracketCap ?? 'bracket1' }, properties, debts, incomeSources,
    dependents: (input.children ?? []).map((child, index) => ({ id: legacyId('dependent', index), ageInBaseYear: finite(child.age), provenance: source })),
    strategy: input.strategy, goal: input.goal ?? 'legacy', lifeExpectancy: finite(input.lifeExpectancy), targetAssets: input.fireTargetAssets == null ? unknown('target not supplied') : known(finite(input.fireTargetAssets)), legacyProjection: input,
    taxProfile: { spouseSupported: unknown('spouse support/cohabitation not confirmed'), pensionSplit: null },
    migration: { sourcePersistVersion: persistVersion, ownershipNeedsConfirmation: couple, ageBasisNeedsConfirmation: true, savingsBasisNeedsConfirmation: true },
  }
}

/** Keep stable ownership and references while the legacy form remains the editor. */
export function refreshCanonicalFromLegacy(previous: InputsV2 | null, inputs: Inputs): InputsV2 {
  const attachIds = <T extends { id?: string }>(incoming: T[], old: T[], kind: string): T[] => {
    const used = new Set<string>()
    const allOld = new Set(old.map(item => item.id).filter((id): id is string => !!id))
    let serial = 0
    const allocate = () => {
      let id = legacyId(kind, serial++)
      while (allOld.has(id) || used.has(id)) id = legacyId(kind, serial++)
      return id
    }
    const fingerprint = (item: T) => JSON.stringify({ ...item, id: undefined })
    return incoming.map((item) => {
      let id = item.id && !used.has(item.id) ? item.id : undefined
      if (!id) {
        const matching = old.filter(candidate => candidate.id && !used.has(candidate.id) && fingerprint(candidate) === fingerprint(item))
        if (matching.length === 1) id = matching[0].id
      }
      id ??= allocate()
      used.add(id)
      return { ...item, id }
    })
  }
  const returningPartner = inputs.partner && previous?.orphanedPeople?.find(person => person.role === 'partner')
  const restoredPartner = returningPartner && inputs.partner ? {
    ...inputs.partner,
    currentAge: returningPartner.ageInBaseYear,
    cppAnnualAt65: returningPartner.cppAnnualAt65,
    oasAnnualAt65: returningPartner.oasAnnualAt65,
    pension: returningPartner.pension,
    cppWork: returningPartner.cppWork,
    cppStartAge: previous?.incomeSources.find(source => source.id === `${returningPartner.id}:cpp`)?.startAge ?? inputs.partner.cppStartAge,
    oasStartAge: previous?.incomeSources.find(source => source.id === `${returningPartner.id}:oas`)?.startAge ?? inputs.partner.oasStartAge,
  } : inputs.partner
  const normalized: Inputs = previous ? {
    ...inputs,
    partner: restoredPartner,
    investmentProperties: attachIds(inputs.investmentProperties ?? [], previous.legacyProjection.investmentProperties ?? [], 'property:investment'),
    debts: attachIds(inputs.debts ?? [], previous.legacyProjection.debts ?? [], 'debt:other'),
  } : inputs
  const next = migratePersistedPlan({ inputs: normalized }, 10, previous?.baseYear ?? new Date().getFullYear())
  if (!previous) {
    // A plan first entered in this UI has no pre-v11 age or savings wording to
    // migrate. Keep unresolved budget facts unknown; do not turn assumptions
    // into user confirmations merely to allow the existing preview.
    next.migration = { ...next.migration, sourcePersistVersion: 11, ageBasisNeedsConfirmation: false, savingsBasisNeedsConfirmation: false }
    return next
  }
  if (returningPartner) next.people = next.people.map(person => person.id === returningPartner.id ? {
    ...person,
    earnedIncome: returningPartner.earnedIncome,
    previousYearEarnedIncome: returningPartner.previousYearEarnedIncome,
    rrspDeductionLimit: returningPartner.rrspDeductionLimit,
    rrspAvailableRoom: returningPartner.rrspAvailableRoom,
    rrspUnusedUndeducted: returningPartner.rrspUnusedUndeducted,
    rrspPensionAdjustment: returningPartner.rrspPensionAdjustment,
    rrspPspa: returningPartner.rrspPspa,
    rrspPar: returningPartner.rrspPar,
    tfsaAvailableRoom: returningPartner.tfsaAvailableRoom,
    provenance: { ...returningPartner.provenance, ...person.provenance },
  } : person)
  const removedPartner = previous.people.find(person => person.role === 'partner' && !next.people.some(current => current.id === person.id))
  const prior = removedPartner ? removePerson(previous, removedPartner.id) : previous
  // Canonical tax facts are edited by the shared tax panel, not the legacy
  // numeric form. Keep them across ordinary form edits and mode switches.
  next.people = next.people.map(person => {
    const old = prior.people.find(item => item.id === person.id)
    return old ? { ...person, earnedIncome: old.earnedIncome,
      previousYearEarnedIncome: old.previousYearEarnedIncome,
      // CRA statement facts are entered by the shared tax panel. An ordinary
      // legacy-form edit or a mode switch must not reset them to unknown.
      rrspDeductionLimit: old.rrspDeductionLimit,
      rrspAvailableRoom: old.rrspAvailableRoom,
      rrspUnusedUndeducted: old.rrspUnusedUndeducted ?? person.rrspUnusedUndeducted,
      rrspPensionAdjustment: old.rrspPensionAdjustment ?? person.rrspPensionAdjustment,
      rrspPspa: old.rrspPspa ?? person.rrspPspa,
      rrspPar: old.rrspPar ?? person.rrspPar,
      tfsaAvailableRoom: old.tfsaAvailableRoom } : person
  })
  const expandedHousehold = prior.people.length === 1 && next.people.length === 2
  const live = new Set(next.people.map(person => person.id))
  const previousAccounts = new Map(prior.accounts.map(account => [account.id, account]))
  const lockedOwnerChanged = previous.legacyProjection.lockedRetirement?.owner !== inputs.lockedRetirement?.owner
  next.accounts = next.accounts.map(account => {
    const old = previousAccounts.get(account.id)
    if (!old) return account
    const useExplicitLockedOwner = account.kind === 'lira' && (lockedOwnerChanged || !!returningPartner)
    const sourceOwner = useExplicitLockedOwner ? account.ownerId : old.ownerId
    // The form's ordinary account values become household totals when a
    // partner is added. A prior single-owner ID cannot attribute that total.
    const ownerId = expandedHousehold && account.kind !== 'lira' ? null : sourceOwner && live.has(sourceOwner) ? sourceOwner : null
    return {
      ...account,
      ownerId,
      taxableOwnerShares: expandedHousehold && account.kind !== 'lira' ? unknown('new combined household balance needs owner allocation') : useExplicitLockedOwner ? shares(ownerId) : old.taxableOwnerShares.status === 'known' && Object.keys(old.taxableOwnerShares.shares).every(id => live.has(id))
        ? old.taxableOwnerShares : unknown('owner reference requires confirmation'),
      acb: account.kind === 'nonReg' && old.acb.status === 'unknown' &&
        previous.legacyProjection.nonRegBook === inputs.nonRegBook ? old.acb
        : account.acb.status === 'unknown' ? old.acb : account.acb,
      contributionRoom: old.contributionRoom,
      openedYear: old.openedYear,
      rrifFactorCategory: old.rrifFactorCategory,
      kind: old.kind === 'rrif' || old.kind === 'spousalRrsp' || old.kind === 'lif' ? old.kind : account.kind,
      rrifAgeElection: old.rrifAgeElection,
      accessibleAgeConfirmed: useExplicitLockedOwner ? false : old.accessibleAgeConfirmed,
    }
  })
  // Side-account toggles and list removals are explicit deletions. Partner removal
  // changes ownership references, never the existence of the legacy account.
  next.properties = next.properties.map(property => {
    const old = prior.properties.find(item => item.id === property.id)
    if (!old) return property
    return { ...property, saleExpenses: property.saleExpenses?.status === 'unknown' ? old.saleExpenses ?? property.saleExpenses : property.saleExpenses,
      taxableOwnerShares: expandedHousehold ? unknown('new combined household property needs owner allocation') : old.taxableOwnerShares.status === 'known' && Object.keys(old.taxableOwnerShares.shares).every(id => live.has(id))
      ? old.taxableOwnerShares : unknown('owner reference requires confirmation') }
  })
  // A recorded per-person split is a canonical fact that survives legacy form
  // edits: re-apply it while the household total still matches, otherwise keep
  // the conserved total with unconfirmed ownership and the amounts visible.
  // Only an explicit change of the legacy lockedRetirement.owner field may
  // re-record a locked split as 100% to that owner (a real user action, and
  // documented in the panel); a partner being removed and re-added is a
  // guarded household change, so the recorded amounts must survive it exactly
  // like the RRSP/TFSA rows instead of being silently rewritten.
  next.ownershipAmounts = prior.ownershipAmounts ? { ...prior.ownershipAmounts } : undefined
  for (const baseId of SPLIT_BASE_IDS) {
    reconcileOwnershipSplit(prior, next, baseId, {
      expandedHousehold,
      lockedOwnerReset: baseId === 'legacy:account:locked' && lockedOwnerChanged,
    })
  }
  next.contributions = prior.contributions.map(c => ({ ...c, contributorId: c.contributorId && live.has(c.contributorId) ? c.contributorId : null }))
  // A recorded spousal premium-history claim is a canonical fact like the
  // recorded contributions it describes; an ordinary form edit or a mode
  // switch must not drop it back to unknown.
  next.spousalHistory = prior.spousalHistory ? structuredClone(prior.spousalHistory) : undefined
  // BE-36 A: an FHSA's opening year, participation-room statement line and
  // contribution history are canonical statement facts entered by the shared
  // tax panel, exactly like the CRA RRSP statement lines above. The legacy form
  // carries only a balance and a years-ago count, so an ordinary form edit or a
  // mode switch must re-apply the recorded canonical facts instead of resetting
  // them to unknown. A legacy account with no recorded calendar opening year
  // keeps that unknown: a years-ago count is not an opening year.
  next.fhsaStatementHistory = prior.fhsaStatementHistory ? structuredClone(prior.fhsaStatementHistory) : undefined
  if (prior.fhsaStatementHistory) {
    next.fhsaStatementHistory = Object.fromEntries(Object.entries(next.fhsaStatementHistory ?? {})
      .filter(([accountId]) => next.accounts.some(account => account.id === accountId)))
  }
  for (const account of next.accounts) {
    if (account.kind !== 'fhsa') continue
    const old = previousAccounts.get(account.id)
    if (!old) continue
    account.openedYear = old.openedYear
    account.contributionRoom = old.contributionRoom
  }
  // BE-27 A: a person's TFSA withdrawal history is a canonical statement fact
  // entered by the shared tax panel, exactly like the CRA RRSP and FHSA
  // statement lines above; the legacy form has no field for it, so an ordinary
  // form edit or a mode switch must carry it over rather than reset it to an
  // absent history. An entry for a person who is no longer in the household is
  // dropped, so a stale id can never restore room for someone else.
  next.tfsaStatement = prior.tfsaStatement
    ? Object.fromEntries(Object.entries(structuredClone(prior.tfsaStatement)).filter(([personId]) => live.has(personId)))
    : undefined
  if (next.tfsaStatement && Object.keys(next.tfsaStatement).length === 0) next.tfsaStatement = undefined
  next.recurringContributions = next.recurringContributions.map(c => ({ ...c, contributorId: c.contributorId && live.has(c.contributorId) ? c.contributorId : null }))
  // BE-36 A: the legacy form mirrors exactly one FHSA account, so a recorded
  // per-person split's partner-owned account has no legacy field to rebuild its
  // plan from. Its rows are canonical facts the form cannot express; carry them
  // over so an unrelated legacy or shared-field edit cannot silently drop a
  // recorded plan (the account itself is restored by `reconcileOwnershipSplit`).
  const mirroredRecurringAccounts = new Set(next.recurringContributions.map(row => row.accountId))
  const carriedFhsaRows = prior.recurringContributions.filter(row =>
    !mirroredRecurringAccounts.has(row.accountId) &&
    next.accounts.some(account => account.id === row.accountId && account.kind === 'fhsa'))
  if (carriedFhsaRows.length > 0) next.recurringContributions.push(...carriedFhsaRows.map(row => ({
    ...row,
    contributorId: row.contributorId && live.has(row.contributorId) ? row.contributorId : null,
    provenance: { ...row.provenance },
  })))
  // BE-36 A: exactly one recorded FHSA plan per account, under the canonical id
  // the shared tax panel writes. Migration already emits that id, so a
  // panel-recorded plan survives an unrelated legacy or shared-field edit. A
  // plan saved by an earlier build could carry two rows for one account (a
  // legacy mirror plus the recorded row); the recorded row is the plan, so the
  // duplicate is dropped and the legacy mirror is rewritten to the recorded
  // amount. The two can then never both be priced and the recorded amount is
  // not lost on the next edit.
  const recordedFhsaOverrides = new Map<string, number>()
  for (const account of next.accounts) {
    if (account.kind !== 'fhsa') continue
    const rows = prior.recurringContributions.filter(item => item.accountId === account.id)
    const recorded = rows.find(item => item.id === fhsaPlanRowId(account.id))
    if (recorded && rows.length > 1) recordedFhsaOverrides.set(account.id, recorded.annualAmount)
  }
  if (recordedFhsaOverrides.size > 0) {
    next.recurringContributions = next.recurringContributions.map(item => {
      const recorded = recordedFhsaOverrides.get(item.accountId)
      return recorded === undefined ? item : { ...item, id: fhsaPlanRowId(item.accountId), annualAmount: recorded }
    })
    const legacyFhsaId = legacyId('account:fhsa')
    const recordedLegacy = recordedFhsaOverrides.get(legacyFhsaId)
    if (recordedLegacy !== undefined && next.legacyProjection?.fhsa)
      next.legacyProjection = { ...next.legacyProjection, fhsa: { ...next.legacyProjection.fhsa, annualContribution: recordedLegacy } }
  }
  next.orphanedPeople = prior.orphanedPeople?.filter(person => !live.has(person.id))
  next.taxProfile = prior.taxProfile && !expandedHousehold ? prior.taxProfile : {
    spouseSupported: unknown('spouse support/cohabitation not confirmed'), pensionSplit: null,
    qcPensionSplit: null,
    qcDrugCoverage: prior.taxProfile?.qcDrugCoverage
      ? Object.fromEntries(Object.entries(prior.taxProfile.qcDrugCoverage).filter(([id]) => live.has(id))) : undefined,
  }
  const nextIncomeIds = new Set(next.incomeSources.map(income => income.id))
  next.incomeSources.push(...prior.incomeSources.filter(income => !nextIncomeIds.has(income.id) && income.recipientId === null))
  next.migration = { ...prior.migration, ownershipNeedsConfirmation: next.accounts.some(a => a.kind !== 'nonReg' && a.ownerId === null || a.taxableOwnerShares.status === 'unknown') || next.properties.some(p => p.taxableOwnerShares.status === 'unknown') }
  return next
}

/** Swap display roles without changing legal ownership or source references. */
export function swapPersonRoles(plan: InputsV2): InputsV2 {
  if (plan.people.length !== 2) return plan
  return { ...plan, people: plan.people.map(person => ({ ...person, role: person.role === 'self' ? 'partner' : 'self' })) }
}

/** Delete a person without deleting their balances or inventing a new owner. */
export function removePerson(plan: InputsV2, personId: string): InputsV2 {
  if (!plan.people.some(person => person.id === personId)) return plan
  return {
    ...plan,
    taxProfile: { spouseSupported: unknown('household changed; spouse support requires review'), pensionSplit: null,
      qcPensionSplit: null, qcDrugCoverage: plan.taxProfile?.qcDrugCoverage
        ? Object.fromEntries(Object.entries(plan.taxProfile.qcDrugCoverage).filter(([id]) => id !== personId)) : undefined },
    people: plan.people.filter(person => person.id !== personId),
    orphanedPeople: [...(plan.orphanedPeople ?? []), ...plan.people.filter(person => person.id === personId)],
    accounts: plan.accounts.map(account => account.ownerId === personId || (account.taxableOwnerShares.status === 'known' && personId in account.taxableOwnerShares.shares)
      ? { ...account, ownerId: null, taxableOwnerShares: unknown('removed person owned this asset') } : account),
    contributions: plan.contributions.map(c => c.contributorId === personId ? { ...c, contributorId: null } : c),
    recurringContributions: plan.recurringContributions.map(c => c.contributorId === personId ? { ...c, contributorId: null } : c),
    properties: plan.properties.map(property => property.taxableOwnerShares.status === 'known' && personId in property.taxableOwnerShares.shares ? { ...property, taxableOwnerShares: unknown('removed person owned this property') } : property),
    incomeSources: plan.incomeSources.map(source => source.recipientId === personId ? { ...source, recipientId: null } : source),
    migration: { ...plan.migration, ownershipNeedsConfirmation: true },
  }
}

/** Populate facts introduced after early v11 snapshots without altering saved ownership. */
export function completeCanonicalFacts(plan: InputsV2, inputs: Inputs): InputsV2 {
  if (!plan || !Array.isArray(plan.people) || !Array.isArray(plan.accounts) || !Array.isArray(plan.properties) || !Number.isInteger(plan.baseYear)) throw new Error('Invalid canonical plan')
  const facts = migratePersistedPlan({ inputs }, 10, plan.baseYear)
  return {
    ...plan,
    savingsAllocation: plan.savingsAllocation ?? facts.savingsAllocation,
    recurringContributions: plan.recurringContributions ?? facts.recurringContributions,
    projectionAssumptions: plan.projectionAssumptions ?? facts.projectionAssumptions,
    taxProfile: plan.taxProfile ?? facts.taxProfile,
    people: plan.people.map(person => ({ ...person, cppWork: person.cppWork === undefined ? facts.people.find(item => item.id === person.id)?.cppWork ?? null : person.cppWork,
      rrspUnusedUndeducted: person.rrspUnusedUndeducted ?? unknown('CRA statement not supplied'),
      rrspPensionAdjustment: person.rrspPensionAdjustment ?? unknown('CRA statement not supplied'),
      rrspPspa: person.rrspPspa ?? unknown('CRA statement not supplied'),
      rrspPar: person.rrspPar ?? unknown('CRA statement not supplied') })),
    orphanedPeople: plan.orphanedPeople?.map(person => ({ ...person, cppWork: person.cppWork ?? null,
      rrspUnusedUndeducted: person.rrspUnusedUndeducted ?? unknown('CRA statement not supplied'),
      rrspPensionAdjustment: person.rrspPensionAdjustment ?? unknown('CRA statement not supplied'),
      rrspPspa: person.rrspPspa ?? unknown('CRA statement not supplied'),
      rrspPar: person.rrspPar ?? unknown('CRA statement not supplied') })),
    accounts: plan.accounts.map(account => ({ ...account, openedYearsAgoAtBaseYear: account.openedYearsAgoAtBaseYear === undefined ? facts.accounts.find(item => item.id === account.id)?.openedYearsAgoAtBaseYear ?? null : account.openedYearsAgoAtBaseYear })),
    properties: plan.properties.map(property => {
      const fact = facts.properties.find(item => item.id === property.id)
      return { ...property, plannedMortgage: property.plannedMortgage === undefined ? fact?.plannedMortgage ?? null : property.plannedMortgage, annualHoldingCostChange: property.annualHoldingCostChange === undefined ? fact?.annualHoldingCostChange ?? 0 : property.annualHoldingCostChange }
    }),
  }
}
