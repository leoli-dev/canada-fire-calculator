import type { Inputs, InvestmentProperty } from './types'
import type { Account, Debt, IncomeSource, InputsV2, Person, Property, Provenance, TaxShares } from './model'

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
    if (property.mortgage) requireAmount(property.mortgage.balance, `investmentProperties.${index}.mortgage.balance`)
  }
  for (const [index, debt] of (input.debts ?? []).entries()) requireAmount(debt.balance, `debts.${index}.balance`)
  const couple = !!input.partner
  const selfId = legacyId('person:self')
  const partnerId = legacyId('person:partner')
  const person = (id: string, role: 'self' | 'partner', age: number, cpp: number, oas: number, pension: import('./types').Pension | null): Person => ({
    id, role, ageInBaseYear: finite(age), retirementAge: role === 'self' ? finite(input.fireAge) : finite(input.fireAge) - finite(input.currentAge) + finite(age),
    earnedIncome: unknown('not present in legacy plan'), previousYearEarnedIncome: unknown('not present in legacy plan'),
    rrspDeductionLimit: unknown('CRA statement not supplied'), rrspAvailableRoom: unknown('CRA statement not supplied'), tfsaAvailableRoom: unknown('CRA statement not supplied'),
    cppAnnualAt65: finite(cpp), oasAnnualAt65: finite(oas), pensionAnnual: finite(pension?.annualAmount), pension,
    provenance: { ageInBaseYear: source, retirementAge: source, cppAnnualAt65: source, oasAnnualAt65: source, pensionAnnual: source },
  })
  const people = [person(selfId, 'self', input.currentAge, input.cppAnnualAt65, input.oasAnnualAt65, input.pension ?? null)]
  if (input.partner) people.push(person(partnerId, 'partner', input.partner.currentAge, input.partner.cppAnnualAt65, input.partner.oasAnnualAt65, input.partner.pension ?? null))
  const ownerId = couple ? null : selfId
  const account = (id: string, kind: Account['kind'], balance: number, acb?: number, actualOwner?: string | null): Account => {
    const owner = actualOwner === undefined ? ownerId : actualOwner
    const returnKind = kind === 'tfsa' ? 'tfsa' : kind === 'nonReg' ? 'nonReg' : 'rrsp'
    return { id, kind, ownerId: owner, balance: finite(balance), realReturn: finite(input.returns?.[returnKind]), volatility: input.volatilities?.[returnKind] ?? null, annualFee: finite(input.fees), acb: acb === undefined ? unknown('basis not supplied') : known(finite(acb)), taxableOwnerShares: shares(owner), contributionRoom: unknown('statement not supplied'), openedYear: unknown('opening year not supplied'), provenance: { balance: source, ownerId: owner ? source : { ...source, origin: 'unknown', note: 'Legacy household balance' }, acb: acb === undefined ? { origin: 'unknown', sourceYear: null } : source } }
  }
  const accounts: Account[] = [
    account(legacyId('account:tfsa'), 'tfsa', input.balances.tfsa),
    account(legacyId('account:rrsp'), 'rrsp', input.balances.rrsp),
    account(legacyId('account:nonReg'), 'nonReg', input.balances.nonReg, input.nonRegBook),
  ]
  if (input.fhsa) {
    const a = account(legacyId('account:fhsa'), 'fhsa', input.fhsa.balance)
    a.openedYear = unknown('legacy years-ago opening needs calendar-year confirmation')
    accounts.push(a)
  }
  if (input.lockedRetirement) {
    const owner = input.lockedRetirement.owner === 'partner' && couple ? partnerId : selfId
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
    properties.push({ id, kind: 'principal', value: finite(p.value), acb: unknown('principal residence basis not supplied'), annualRent: known(0), appreciation: finite(p.appreciation), sellAtAge: p.sellAtAge, plannedPurchaseAge: null, plannedDownPayment: null, taxableOwnerShares: shares(ownerId), mortgageDebtId: p.mortgage ? addDebt(`${id}:mortgage`, 'mortgage', p.mortgage, id) : null, provenance: { value: source } })
  } else if (input.principalResidence?.mode === 'planned') {
    const p = input.principalResidence
    properties.push({ id: legacyId('property:principal'), kind: 'principal', value: finite(p.price), acb: known(finite(p.price)), annualRent: known(0), appreciation: finite(p.appreciation), sellAtAge: p.sellAtAge, plannedPurchaseAge: p.buyAtAge, plannedDownPayment: finite(p.downPayment), taxableOwnerShares: shares(ownerId), mortgageDebtId: null, provenance: { value: source, plannedPurchaseAge: source } })
  }
  const investmentProperties: InvestmentProperty[] = input.investmentProperties ?? []
  investmentProperties.forEach((p, i) => {
    const id = p.id ?? legacyId('property:investment', i)
    properties.push({ id, kind: 'investment', value: finite(p.value), acb: known(finite(p.acb)), annualRent: known(finite(p.annualRent)), appreciation: finite(p.appreciation), sellAtAge: p.sellAtAge, plannedPurchaseAge: null, plannedDownPayment: null, taxableOwnerShares: shares(ownerId), mortgageDebtId: p.mortgage ? addDebt(`${id}:mortgage`, 'mortgage', p.mortgage, id) : null, provenance: { value: source, acb: source, annualRent: source } })
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
    people, accounts, contributions: [], properties, debts, incomeSources,
    dependents: (input.children ?? []).map((child, index) => ({ id: legacyId('dependent', index), ageInBaseYear: finite(child.age), provenance: source })),
    strategy: input.strategy, goal: input.goal ?? 'legacy', lifeExpectancy: finite(input.lifeExpectancy), targetAssets: input.fireTargetAssets == null ? unknown('target not supplied') : known(finite(input.fireTargetAssets)), legacyProjection: input,
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
  const normalized: Inputs = previous ? {
    ...inputs,
    investmentProperties: attachIds(inputs.investmentProperties ?? [], previous.legacyProjection.investmentProperties ?? [], 'property:investment'),
    debts: attachIds(inputs.debts ?? [], previous.legacyProjection.debts ?? [], 'debt:other'),
  } : inputs
  const next = migratePersistedPlan({ inputs: normalized }, 10, previous?.baseYear ?? new Date().getFullYear())
  if (!previous) return next
  const live = new Set(next.people.map(person => person.id))
  const previousAccounts = new Map(previous.accounts.map(account => [account.id, account]))
  const lockedOwnerChanged = previous.legacyProjection.lockedRetirement?.owner !== inputs.lockedRetirement?.owner
  next.accounts = next.accounts.map(account => {
    const old = previousAccounts.get(account.id)
    if (!old) return account
    const useExplicitLockedOwner = account.kind === 'lira' && lockedOwnerChanged
    const sourceOwner = useExplicitLockedOwner ? account.ownerId : old.ownerId
    const ownerId = sourceOwner && live.has(sourceOwner) ? sourceOwner : null
    return {
      ...account,
      ownerId,
      taxableOwnerShares: useExplicitLockedOwner ? shares(ownerId) : old.taxableOwnerShares.status === 'known' && Object.keys(old.taxableOwnerShares.shares).every(id => live.has(id))
        ? old.taxableOwnerShares : unknown('owner reference requires confirmation'),
      acb: account.acb.status === 'unknown' ? old.acb : account.acb,
      contributionRoom: old.contributionRoom,
      openedYear: old.openedYear,
      accessibleAgeConfirmed: useExplicitLockedOwner ? false : old.accessibleAgeConfirmed,
    }
  })
  const currentAccountIds = new Set(next.accounts.map(account => account.id))
  // A removed side account with nonzero value cannot silently disappear.
  for (const old of previous.accounts) if (!currentAccountIds.has(old.id) && old.balance !== 0) next.accounts.push({ ...old, ownerId: old.ownerId && live.has(old.ownerId) ? old.ownerId : null })
  // Removed list entities are intentional deletions; never revive or reassign them by position.
  next.properties = next.properties.map(property => {
    const old = previous.properties.find(item => item.id === property.id)
    return old && old.taxableOwnerShares.status === 'known' && Object.keys(old.taxableOwnerShares.shares).every(id => live.has(id))
      ? { ...property, taxableOwnerShares: old.taxableOwnerShares }
      : property
  })
  next.contributions = previous.contributions.map(c => ({ ...c, contributorId: c.contributorId && live.has(c.contributorId) ? c.contributorId : null }))
  next.migration = { ...previous.migration, ownershipNeedsConfirmation: next.accounts.some(a => a.ownerId === null || a.taxableOwnerShares.status === 'unknown') }
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
    people: plan.people.filter(person => person.id !== personId),
    accounts: plan.accounts.map(account => account.ownerId === personId || (account.taxableOwnerShares.status === 'known' && personId in account.taxableOwnerShares.shares)
      ? { ...account, ownerId: null, taxableOwnerShares: unknown('removed person owned this asset') } : account),
    contributions: plan.contributions.map(c => c.contributorId === personId ? { ...c, contributorId: null } : c),
    properties: plan.properties.map(property => property.taxableOwnerShares.status === 'known' && personId in property.taxableOwnerShares.shares ? { ...property, taxableOwnerShares: unknown('removed person owned this property') } : property),
    incomeSources: plan.incomeSources.map(source => source.recipientId === personId ? { ...source, recipientId: null } : source),
    migration: { ...plan.migration, ownershipNeedsConfirmation: true },
  }
}
