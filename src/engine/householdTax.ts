import type { InputsV2 } from './model'
import { incomeTax, PLAN_TAX_YEAR, taxRuleProvenance, trySelectPlanTaxRules, type TaxRuleContext, type TaxRuleProvenance } from './tax'
import { calculatePersonIncome, type IncomeEvent, type IncomeYearContext, type PersonIncome } from './personIncome'
import type { SpousalAttributionLedger } from './spousalAttribution'
import { calculateQuebecTax } from './quebecTax'

export interface PersonTaxRow {
  personId: string
  grossIncome: number
  netIncome: number
  taxableIncome: number
  federalPensionEligible: number
  provincialPensionEligible: number
  tax: number
  qc?: import('./quebecTax').QuebecTaxRow
  bySource: PersonIncome['bySource']
}
export type HouseholdTaxResult = { status: 'ok'; total: number; byPerson: Record<string, PersonTaxRow>;
  /** The year's spousal attribution state, advanced for the next projected year. */
  spousalAttribution?: SpousalAttributionLedger } & TaxRuleProvenance |
  { status: 'unsupported' | 'invalid'; reason: string }

/**
 * Tax attribution follows the event's actual recipient/account/property. The
 * elective split is applied only to an identified eligible pension event;
 * ordinary RRSP, CPP and OAS cannot be elected into a 50/50 household pool.
 * The bracket ladder and basic personal amount come from the plan's selected,
 * versioned rule pack — never from a literal — and every result carries that
 * pack's id, year and whether the year was assumed. The projection is
 * expressed in the anchor year's real dollars, so it is priced from the anchor
 * year's published pack (`PLAN_TAX_YEAR`) whatever projected calendar year is
 * being solved: a projected year is not a nominal-dollar year here, and
 * re-indexing the ladder for it would inflate it a second time. Recomputing any
 * projected year therefore gives the same tax as any other, and advancing the
 * anchor constant is a deliberate, reviewed number change rather than drift.
 */
export function calculateHouseholdTax(plan: InputsV2, year: number, events: IncomeEvent[], context?: IncomeYearContext): HouseholdTaxResult {
  const selection = trySelectPlanTaxRules({ jurisdiction: plan.province, taxYear: PLAN_TAX_YEAR })
  if (selection.status !== 'ok') return selection
  const rules: TaxRuleContext = selection.context
  const provenance = taxRuleProvenance(rules)
  const income = calculatePersonIncome(plan, year, events, context)
  if (income.status !== 'ok') return income
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
    // CRA T1032 Step 4 Note 1 excludes RRIF/LIF-derived split income from
    // an under-65 recipient's pension amount. It does NOT allocate the credit
    // pro rata: if qualifying RPP life-annuity income is at least $4,000,
    // line 33 uses the elected amount (line 30), then the $2,000 tax-credit
    // ceiling applies. Below $4,000 a recalculation is required; defer the
    // mixed-source edge until those form details are represented explicitly.
    const dbIncome = from.bySource.dbPension ?? 0
    const otherEligible = from.federalPensionEligible - dbIncome
    if (to.age < 65 && election.amount > 0 && dbIncome > 0 && dbIncome < 4_000 && otherEligible > 0)
      return { status: 'unsupported', reason: 'under-65 mixed pension split below T1032 four-thousand threshold requires form recalculation' }
    const recipientCredit = to.age >= 65 || dbIncome > 0 ? election.amount : 0
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
  if (plan.province === 'QC') {
    const qc = calculateQuebecTax(plan, income.byPerson, people)
    if (qc.status !== 'ok') return qc
    const byPerson: Record<string, PersonTaxRow> = {}
    for (const id of ids) {
      const person = people[id]
      const row = qc.byPerson[id]
      byPerson[id] = { personId: id, grossIncome: person.gross, netIncome: person.netIncome,
        taxableIncome: person.taxableIncome, federalPensionEligible: person.federalPensionEligible,
        provincialPensionEligible: row.qcRetirementEligible,
        tax: row.federalTax + row.provincialIncomeTax + row.fss + row.ramq,
        bySource: person.bySource, qc: row }
    }
    return { status: 'ok', total: qc.total, byPerson, ...provenance,
      spousalAttribution: income.spousalAttribution }
  }
  const byPerson: Record<string, PersonTaxRow> = {}
  for (const id of ids) {
    const person = people[id]
    const other = ids.find(item => item !== id)
    const spouseNetIncome = claimant === id && other ? people[other].netIncome : undefined
    const tax = incomeTax(person.taxableIncome, plan.province, { age: person.age,
      pensionIncome: person.federalPensionEligible,
      provincialPensionIncome: person.provincialPensionEligible, spouseNetIncome }, rules)
    byPerson[id] = { personId: id, grossIncome: person.gross, netIncome: person.netIncome,
      taxableIncome: person.taxableIncome, federalPensionEligible: person.federalPensionEligible,
      provincialPensionEligible: person.provincialPensionEligible,
      tax, bySource: person.bySource }
  }
  return { status: 'ok', total: Object.values(byPerson).reduce((sum, row) => sum + row.tax, 0),
    byPerson, ...provenance, spousalAttribution: income.spousalAttribution }
}
