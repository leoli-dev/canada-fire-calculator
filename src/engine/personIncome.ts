import type { InputsV2, TaxShares } from './model'
import { ageReachedInYear, precisionGate } from './model'
import { CAPITAL_GAINS_INCLUSION } from './taxData'
import { attributeSpousalPayment, spousalPremiumLines, type SpousalPremium } from './spousalAttribution'

export type IncomeKind = 'employment' | 'cpp' | 'oas' | 'dbPension' | 'rrspWithdrawal' | 'rrifWithdrawal' |
  'lifWithdrawal' | 'rent' | 'interest' | 'realizedGain' | 'other'
const INCOME_KINDS: readonly IncomeKind[] = ['employment', 'cpp', 'oas', 'dbPension', 'rrspWithdrawal',
  'rrifWithdrawal', 'lifWithdrawal', 'rent', 'interest', 'realizedGain', 'other']
export interface IncomeEvent {
  id: string
  kind: IncomeKind
  amount: number
  personId?: string
  accountId?: string
  propertyId?: string
}
export interface PersonIncome {
  personId: string
  age: number
  gross: number
  netIncome: number
  taxableIncome: number
  earnedWork: number
  oasGross: number
  gisIncomeBase: number
  fssIncomeBase: number
  federalPensionEligible: number
  provincialPensionEligible: number
  bySource: Partial<Record<IncomeKind, number>>
  entries: { eventId: string; kind: IncomeKind; gross: number; taxable: number }[]
}
export type IncomeResult = { status: 'ok'; byPerson: Record<string, PersonIncome> } |
  { status: 'invalid' | 'unsupported'; reason: string }
const fail = (status: 'invalid' | 'unsupported', reason: string): IncomeResult => ({ status, reason })

/**
 * Unknown ownership is a tax-capability limit, never a cue to divide by
 * household size. `spousalPremiums` carries the per-account premium state for
 * one year's events so a second payment cannot re-attribute a premium that an
 * earlier payment already attributed (ITA s.146(8.6)).
 */
function sharesForEvent(plan: InputsV2, event: IncomeEvent, year: number, spousalPremiums: Map<string, SpousalPremium[]>): { status: 'ok'; shares: Record<string, number> } | { status: 'invalid' | 'unsupported'; reason: string } {
  if (event.personId && (event.accountId || event.propertyId) || event.accountId && event.propertyId) return { status: 'invalid', reason: `income ownership ambiguous: ${event.id}` }
  if (event.personId && ['rent', 'interest', 'realizedGain', 'rrspWithdrawal', 'rrifWithdrawal', 'lifWithdrawal'].includes(event.kind))
    return { status: 'invalid', reason: `asset income must cite asset ownership: ${event.id}` }
  if (event.personId && event.kind === 'dbPension' && !plan.people.find(person => person.id === event.personId)?.pension)
    return { status: 'unsupported', reason: `DB pension source not confirmed: ${event.id}` }
  if (event.personId) return plan.people.some(person => person.id === event.personId)
    ? { status: 'ok', shares: { [event.personId]: 1 } } : { status: 'invalid', reason: `person missing: ${event.id}` }
  let shares: TaxShares
  if (event.accountId) {
    const account = plan.accounts.find(item => item.id === event.accountId)
    if (!account) return { status: 'invalid', reason: `account missing: ${event.id}` }
    if (['rrspWithdrawal', 'rrifWithdrawal', 'lifWithdrawal'].includes(event.kind)) {
      const required = event.kind === 'rrspWithdrawal' ? ['rrsp', 'spousalRrsp'] : event.kind === 'rrifWithdrawal' ? ['rrif'] : ['lif']
      if (!required.includes(account.kind)) return { status: 'invalid', reason: `account type mismatch: ${event.id}` }
      if (account.kind === 'spousalRrsp') {
        // BE-12 B (ITA s.146(8.3)): the contributor is the annuitant's spouse,
        // and only premiums recorded for this plan can attribute. Unknown
        // history is refused rather than assumed to be the annuitant's money.
        if (!account.ownerId || !plan.people.some(person => person.id === account.ownerId))
          return { status: 'unsupported', reason: `spousal RRSP holder not identified: ${event.id}` }
        const spouse = plan.people.find(person => person.id !== account.ownerId)
        if (!spouse) return { status: 'unsupported', reason: `spousal RRSP attribution needs the annuitant's spouse in the plan: ${event.id}` }
        const history = plan.spousalHistory?.[account.id]
        if (history?.status !== 'complete')
          return { status: 'unsupported', reason: `spousal RRSP contribution history is not recorded, so the payment is not assumed to be the annuitant's: ${event.id}` }
        const premiums = spousalPremiums.get(account.id) ?? spousalPremiumLines(plan.contributions, account.id)
        const attribution = attributeSpousalPayment({
          paymentId: event.id, payment: event.amount, paymentYear: year,
          contributorId: spouse.id, annuitantId: account.ownerId, premiums,
          // A spousal RRSP has no required minimum; a spousal RRIF is not
          // identified by the account model yet, so it stays on the owner path.
          rrifMinimum: null, annuitantIncomeBefore: 0,
        })
        if (attribution.status !== 'ok') return { status: attribution.status, reason: `${attribution.reason}: ${event.id}` }
        spousalPremiums.set(account.id, attribution.premiumsAfter)
        if (event.amount === 0) return { status: 'ok', shares: { [account.ownerId]: 1 } }
        const contributorShare = attribution.attributedToContributor / event.amount
        if (contributorShare <= 0) return { status: 'ok', shares: { [account.ownerId]: 1 } }
        if (contributorShare >= 1) return { status: 'ok', shares: { [spouse.id]: 1 } }
        return { status: 'ok', shares: { [spouse.id]: contributorShare, [account.ownerId]: 1 - contributorShare } }
      }
      if (account.ownerId && !plan.people.some(person => person.id === account.ownerId)) return { status: 'invalid', reason: `account owner missing: ${event.id}` }
      return account.ownerId ? { status: 'ok', shares: { [account.ownerId]: 1 } } : { status: 'unsupported', reason: `account owner unknown: ${event.id}` }
    }
    if (!['interest', 'realizedGain'].includes(event.kind) || account.kind !== 'nonReg') return { status: 'invalid', reason: `account type mismatch: ${event.id}` }
    shares = account.taxableOwnerShares
  } else if (event.propertyId) {
    const property = plan.properties.find(item => item.id === event.propertyId)
    if (!property || !['rent', 'realizedGain'].includes(event.kind)) return { status: 'invalid', reason: `property type mismatch: ${event.id}` }
    shares = property.taxableOwnerShares
  } else return { status: 'invalid', reason: `income owner missing: ${event.id}` }
  if (shares.status === 'unknown') return { status: 'unsupported', reason: `taxable shares unknown: ${event.id}` }
  if (Object.entries(shares.shares).some(([id, share]) => !plan.people.some(person => person.id === id) || !Number.isFinite(share) || share < 0) ||
      Math.abs(Object.values(shares.shares).reduce((total, share) => total + share, 0) - 1) > 1e-8) return { status: 'invalid', reason: `taxable shares invalid: ${event.id}` }
  return { status: 'ok', shares: shares.shares }
}

export function calculatePersonIncome(plan: InputsV2, year: number, events: IncomeEvent[]): IncomeResult {
  if (!Number.isInteger(year) || year < plan.baseYear || !Array.isArray(events)) return fail('invalid', 'tax year or events invalid')
  const gate = precisionGate(plan)
  if (!gate.allowed) return fail('unsupported', `precision gate: ${gate.reasons.join(', ')}`)
  const byPerson: Record<string, PersonIncome> = Object.fromEntries(plan.people.map(person => [person.id, {
    personId: person.id, age: ageReachedInYear(person, plan.baseYear, year), gross: 0, netIncome: 0, taxableIncome: 0,
    earnedWork: 0, oasGross: 0, gisIncomeBase: 0, fssIncomeBase: 0, federalPensionEligible: 0, provincialPensionEligible: 0,
    bySource: {}, entries: [],
  }]))
  const ids = new Set<string>()
  // Premium attribution is consumed once per (account, year) event sequence.
  const spousalPremiums = new Map<string, SpousalPremium[]>()
  for (const event of events) {
    if (!event || !event.id || ids.has(event.id) || !INCOME_KINDS.includes(event.kind) || !Number.isFinite(event.amount) || event.amount < 0) return fail('invalid', 'income event invalid or duplicate')
    ids.add(event.id)
    const ownership = sharesForEvent(plan, event, year, spousalPremiums)
    if (ownership.status !== 'ok') return fail(ownership.status, ownership.reason)
    for (const [id, share] of Object.entries(ownership.shares)) {
      const person = byPerson[id]
      const gross = event.amount * share
      const taxable = event.kind === 'realizedGain' ? gross * CAPITAL_GAINS_INCLUSION : gross
      person.gross += gross
      person.netIncome += taxable
      person.taxableIncome += taxable
      person.bySource[event.kind] = (person.bySource[event.kind] ?? 0) + taxable
      person.entries.push({ eventId: event.id, kind: event.kind, gross, taxable })
      if (event.kind === 'employment') person.earnedWork += gross
      if (event.kind === 'oas') person.oasGross += gross
      else person.gisIncomeBase += taxable
      // Schedule F starts at total income and subtracts wages and OAS, among
      // other specific items. CPP/QPP is not one of those exclusions.
      if (['cpp', 'rent', 'interest', 'realizedGain', 'rrspWithdrawal', 'rrifWithdrawal', 'lifWithdrawal', 'dbPension'].includes(event.kind)) person.fssIncomeBase += taxable
      if (event.kind === 'dbPension' || (['rrifWithdrawal', 'lifWithdrawal'].includes(event.kind) && person.age >= 65)) {
        person.federalPensionEligible += taxable
        if (plan.province !== 'QC') person.provincialPensionEligible += taxable
      }
      // Québec Schedule B uses income on lines 122/123 even for under-65
      // recipients; ordinary RRSP is line 122 but is not federal T1032 income.
      if (plan.province === 'QC' && ['dbPension', 'rrspWithdrawal', 'rrifWithdrawal', 'lifWithdrawal'].includes(event.kind))
        person.provincialPensionEligible += taxable
    }
  }
  return { status: 'ok', byPerson }
}

/** A known source amount stays with its recipient. Unknown source amounts gate exact tax. */
export function incomeEventsFromPlan(plan: InputsV2, year: number): { status: 'ok'; events: IncomeEvent[] } | { status: 'unsupported'; reason: string } {
  const events: IncomeEvent[] = []
  for (const person of plan.people) if (person.earnedIncome.status === 'known' && ageReachedInYear(person, plan.baseYear, year) < person.retirementAge)
    events.push({ id: `${person.id}:earned:${year}`, kind: 'employment', personId: person.id, amount: person.earnedIncome.value })
  for (const source of plan.incomeSources) {
    const recipient = plan.people.find(person => person.id === source.recipientId)
    if (!recipient) return { status: 'unsupported', reason: `income recipient unknown: ${source.id}` }
    const age = ageReachedInYear(recipient, plan.baseYear, year)
    if (source.startAge !== undefined && age < source.startAge || source.fromAge !== undefined && age < source.fromAge || source.toAge !== undefined && age > source.toAge) continue
    if (source.annualAmount.status === 'unknown') return { status: 'unsupported', reason: `income amount unknown: ${source.id}` }
    if (source.annualAmount.value === 0) continue
    if (source.kind === 'rent') return { status: 'unsupported', reason: `rent requires property taxable shares: ${source.id}` }
    const kind = source.kind === 'pension' ? 'dbPension' : source.kind === 'other' ? 'other' : source.kind
    if (kind === 'dbPension' && !recipient.pension) return { status: 'unsupported', reason: `pension type unconfirmed: ${source.id}` }
    if (kind === 'employment' && recipient.earnedIncome.status === 'known') continue
    events.push({ id: `${source.id}:${year}`, kind, personId: recipient.id, amount: source.annualAmount.value })
  }
  return { status: 'ok', events }
}
