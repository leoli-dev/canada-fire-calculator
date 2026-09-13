import type { InputsV2 } from './model'
import { incomeTax } from './tax'
import { calculatePersonIncome, type IncomeEvent, type PersonIncome } from './personIncome'

export interface PersonTaxRow {
  personId: string
  grossIncome: number
  netIncome: number
  taxableIncome: number
  federalPensionEligible: number
  provincialPensionEligible: number
  tax: number
  bySource: PersonIncome['bySource']
}
export type HouseholdTaxResult = { status: 'ok'; total: number; byPerson: Record<string, PersonTaxRow>; ruleYear: 2026; coverage: 'estimated' } |
  { status: 'unsupported' | 'invalid'; reason: string }

/**
 * Tax attribution follows the event's actual recipient/account/property. The
 * elective split is applied only to an identified eligible pension event;
 * ordinary RRSP, CPP and OAS cannot be elected into a 50/50 household pool.
 * Current 2026 bracket/credit values are a real-dollar projection assumption
 * for future years until BE-38 supplies year-specific full return rules.
 */
export function calculateHouseholdTax(plan: InputsV2, year: number, events: IncomeEvent[]): HouseholdTaxResult {
  const income = calculatePersonIncome(plan, year, events)
  if (income.status !== 'ok') return income
  if (plan.province === 'QC') return { status: 'unsupported', reason: 'BE-35 QC family credits, FSS and RAMQ are not modeled by person' }
  const people = structuredClone(income.byPerson)
  const election = plan.taxProfile?.pensionSplit
  if (election) {
    const from = people[election.transferorId]
    const to = people[election.recipientId]
    if (!from || !to || from.personId === to.personId || people && Object.keys(people).length !== 2 || !Number.isFinite(election.amount) || election.amount < 0)
      return { status: 'invalid', reason: 'pension split election invalid' }
    // CRA T1032 limits the elected annual amount to 50% of the transferor's
    // eligible pension income in aggregate. A taxpayer can have DB and RRIF
    // income in the same year; a single source-specific cap would reject a
    // legal election. `federalPensionEligible` excludes CPP/OAS/plain RRSP.
    if (election.amount > from.federalPensionEligible / 2 + 1e-8)
      return { status: 'invalid', reason: 'pension split exceeds 50 percent of eligible income' }
    from.netIncome -= election.amount
    from.taxableIncome -= election.amount
    to.netIncome += election.amount
    to.taxableIncome += election.amount
    // T1032 Step 4, Note 1: under 65, the recipient may use the pension
    // amount for the RPP life-annuity portion, not RRIF/LIF-derived split.
    // Where both sources exist the form allocates the election in proportion
    // to eligible source income; the taxable transfer itself remains whole.
    const recipientCredit = to.age >= 65 ? election.amount :
      election.amount === 0 ? 0 : election.amount * (from.bySource.dbPension ?? 0) / from.federalPensionEligible
    from.federalPensionEligible -= election.amount
    to.federalPensionEligible += recipientCredit
    from.provincialPensionEligible -= election.amount
    to.provincialPensionEligible += recipientCredit
  }
  const ids = Object.keys(people)
  const support = plan.taxProfile?.spouseSupported
  if (ids.length === 2 && (!support || support.status === 'unknown') &&
      Math.min(people[ids[0]].netIncome, people[ids[1]].netIncome) < 23_000)
    return { status: 'unsupported', reason: 'spouse support/cohabitation not confirmed' }
  const claimant = ids.length === 2 && support?.status === 'known' && support.value
    ? ids.reduce((a, b) => people[a].netIncome >= people[b].netIncome ? a : b) : null
  const byPerson: Record<string, PersonTaxRow> = {}
  for (const id of ids) {
    const person = people[id]
    const other = ids.find(item => item !== id)
    const spouseNetIncome = claimant === id && other ? people[other].netIncome : undefined
    const tax = incomeTax(person.taxableIncome, plan.province, { age: person.age,
      pensionIncome: person.federalPensionEligible,
      provincialPensionIncome: person.provincialPensionEligible, spouseNetIncome })
    byPerson[id] = { personId: id, grossIncome: person.gross, netIncome: person.netIncome,
      taxableIncome: person.taxableIncome, federalPensionEligible: person.federalPensionEligible,
      provincialPensionEligible: person.provincialPensionEligible,
      tax, bySource: person.bySource }
  }
  return { status: 'ok', total: Object.values(byPerson).reduce((sum, row) => sum + row.tax, 0),
    byPerson, ruleYear: 2026, coverage: 'estimated' }
}
