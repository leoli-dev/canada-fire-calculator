import type { InputsV2, QcDrugCoverage } from './model'
import type { PersonIncome } from './personIncome'
import { federalIncomeTax, ordinaryQuebecIncomeTax } from './tax'
import { PROV_AGE_PENSION, PROVINCIAL, QC_FSS } from './taxData'

export interface QuebecTaxRow {
  federalTax: number
  provincialIncomeTax: number
  scheduleBCredit: number
  fss: number
  ramq: number
  qcTaxableIncome: number
  qcRetirementEligible: number
  qcFssBase: number
}
export type QuebecTaxResult = { status: 'ok'; byPerson: Record<string, QuebecTaxRow>; total: number } |
  { status: 'unsupported' | 'invalid'; reason: string }

/** Calendar-month rate-period maximum, not a tax-year premium. Schedule K
 * applies separate income and exemption tests before an actual amount exists.
 * Sources: RAMQ rates in effect (July 2025–June 2026 $766;
 * July 2026–June 2027 $789). */
export function ramqMonthlyPeriodMaximum(taxYear: number, month: number): number | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  const period = month <= 6 ? taxYear - 1 : taxYear
  return period === 2025 ? 766 / 12 : period === 2026 ? 789 / 12 : null
}

/** Historical, tax-year-2025 Schedule K fixture. This is never called by the
 * 2026 projection. It records the family-income and two insurance-period
 * calculations required to verify the implementation when 2026 is released.
 * Official 2025 Schedule K, lines 40–48 and 77–90 (source below).
 * `dependents` means one or at least two eligible dependent children. */
export function ramqScheduleK2025(familyNetIncome: number, hasSpouse: boolean,
  months: QcDrugCoverage[], dependents: 0 | 1 | 2 = 0):
  { status: 'ok'; premium: number; familyExcess: number; publicMonthsJanJun: number; publicMonthsJulDec: number } |
  { status: 'invalid' | 'unsupported'; reason: string } {
  if (!Number.isFinite(familyNetIncome) || familyNetIncome < 0 || ![0, 1, 2].includes(dependents))
    return { status: 'invalid', reason: 'Schedule K family income/dependents invalid' }
  if (!Array.isArray(months) || months.length !== 12 || months.some(month => !['public', 'private', 'waived', 'unknown'].includes(month)))
    return { status: 'invalid', reason: 'Schedule K coverage months invalid' }
  if (months.includes('unknown')) return { status: 'unsupported', reason: 'Schedule K coverage month unknown' }
  const childAdjustment = hasSpouse ? [0, 4_220, 8_120][dependents] : [0, 12_350, 16_570][dependents]
  const familyExcess = Math.max(0, familyNetIncome - (hasSpouse ? 32_240 : 19_890) - childAdjustment)
  const publicMonthsJanJun = months.slice(0, 6).filter(month => month === 'public').length
  const publicMonthsJulDec = months.slice(6).filter(month => month === 'public').length
  const publicMonths = publicMonthsJanJun + publicMonthsJulDec
  const firstRate = hasSpouse ? .0393 : .0784
  const secondRate = hasSpouse ? .0589 : .1176
  const annualIncomeAmount = Math.min(766, familyExcess <= 5_000
    ? familyExcess * firstRate : 5_000 * firstRate + (familyExcess - 5_000) * secondRate)
  const incomeProrated = annualIncomeAmount * publicMonths / 12
  const calendarCap = Math.max(0, 755 - (6 - publicMonthsJanJun) * 62 - (6 - publicMonthsJulDec) * 63.83)
  return { status: 'ok', premium: Math.max(0, Math.min(incomeProrated, calendarCap)),
    familyExcess, publicMonthsJanJun, publicMonthsJulDec }
}

/** An all-private or verified-waived year has no Schedule K premium. A public
 * month is deliberately unsupported for 2026: RQ has published only the 2025
 * Schedule K; RAMQ's July–June tariff maximum cannot replace its tax-year
 * family-income formula or January–June/July–December reconciliation.
 * RQ 2025 Schedule K: https://www.revenuquebec.ca/documents/en/formulaires/tp/2025-12/TP-1.D.K-V%282025-12%29.pdf
 * RAMQ: https://www.ramq.gouv.qc.ca/en/citizens/prescription-drug-insurance/rates-effect */
export function ramqPremium2026(months: QcDrugCoverage[] | undefined):
  { status: 'ok'; premium: 0 } | { status: 'unsupported' | 'invalid'; reason: string } {
  if (!months) return { status: 'unsupported', reason: 'Quebec prescription coverage not confirmed for all calendar months' }
  if (!Array.isArray(months) || months.length !== 12 || months.some(month => !['public', 'private', 'waived', 'unknown'].includes(month)))
    return { status: 'invalid', reason: 'Quebec prescription coverage months invalid' }
  if (months.includes('unknown')) return { status: 'unsupported', reason: 'Quebec prescription coverage has unknown months' }
  if (months.includes('public')) return { status: 'unsupported', reason: '2026 Quebec Schedule K public premium worksheet not published' }
  return { status: 'ok', premium: 0 }
}

/** 2026 Schedule F: wages and OAS are subtracted from line 199, but CPP/QPP,
 * registered withdrawals, pension, rent and taxable investment income remain.
 * A generic `other` event cannot establish its Schedule F line and is gated.
 * 2026 indexed thresholds: Québec Finance 2026 Table 3. Form mechanics:
 * https://www.revenuquebec.ca/documents/en/formulaires/tp/2025-12/TP-1.D.F-V%282025-12%29.pdf */
export function scheduleF2026(person: PersonIncome): { status: 'ok'; base: number; contribution: number } |
  { status: 'unsupported'; reason: string } {
  if ((person.bySource.other ?? 0) !== 0) return { status: 'unsupported', reason: 'other income has no confirmed Schedule F category' }
  const base = person.fssIncomeBase
  const { t1, t2, cap1, cap2 } = QC_FSS
  const contribution = base <= t1 ? 0 : base <= t2
    ? Math.min(cap1, .01 * (base - t1))
    : Math.min(cap2, cap1 + .01 * (base - t2))
  return { status: 'ok', base, contribution }
}

/** The federal T1032 election and Québec Schedule Q election are independent.
 * The latter requires a transferor 65+ at year end and is capped at half of
 * their line-122/123 eligible retirement income. */
function provincialPeople(plan: InputsV2, original: Record<string, PersonIncome>):
  { status: 'ok'; people: Record<string, PersonIncome> } | { status: 'invalid'; reason: string } {
  const people = structuredClone(original)
  const election = plan.taxProfile?.qcPensionSplit
  if (!election) return { status: 'ok', people }
  const from = people[election.transferorId]
  const to = people[election.recipientId]
  if (!from || !to || from === to || Object.keys(people).length !== 2 ||
      !Number.isFinite(election.amount) || election.amount < 0 ||
      (election.amount > 0 && from.age < 65) ||
      election.amount > from.provincialPensionEligible / 2 + 1e-8)
    return { status: 'invalid', reason: 'Quebec Schedule Q pension election invalid' }
  from.netIncome -= election.amount
  from.taxableIncome -= election.amount
  from.provincialPensionEligible -= election.amount
  to.netIncome += election.amount
  to.taxableIncome += election.amount
  to.provincialPensionEligible += election.amount
  // Schedule F line 46 deducts retirement income transferred by the payer;
  // recipient line 123 includes it. Keep each person's source-specific base.
  from.fssIncomeBase -= election.amount
  to.fssIncomeBase += election.amount
  return { status: 'ok', people }
}

/** Québec Schedule B line 30 combines both spouses' age and retirement
 * amounts; line 31 applies one 18.75% reduction against family net income.
 * It is then a non-refundable credit at the 2026 lowest provincial rate.
 * Source form mechanics: https://www.revenuquebec.ca/documents/en/formulaires/tp/2025-12/TP-1.D.B-V%282025-12%29.pdf
 * 2026 amounts/threshold: Québec Finance 2026 Table 3. */
export function scheduleB2026(people: Record<string, PersonIncome>): { availableAmount: number; credit: number; familyIncome: number } {
  const rows = Object.values(people)
  const p = PROV_AGE_PENSION.QC
  const familyIncome = rows.reduce((sum, row) => sum + row.netIncome, 0)
  const beforeReduction = rows.reduce((sum, row) => sum + (row.age >= 65 ? p.ageMax : 0) +
    Math.min(p.pension, row.provincialPensionEligible * 1.25), 0)
  const availableAmount = Math.max(0, beforeReduction - p.ageRate * Math.max(0, familyIncome - p.ageThreshold))
  return { availableAmount, credit: availableAmount * PROVINCIAL.QC.brackets[0].rate, familyIncome }
}

export function calculateQuebecTax(plan: InputsV2, original: Record<string, PersonIncome>, federalPeople: Record<string, PersonIncome>): QuebecTaxResult {
  const provincial = provincialPeople(plan, original)
  if (provincial.status !== 'ok') return provincial
  const people = provincial.people
  const ids = Object.keys(people)
  const support = plan.taxProfile?.spouseSupported
  if (ids.length === 2 && (!support || support.status === 'unknown') &&
      Math.min(...ids.map(id => federalPeople[id].netIncome)) < 23_000)
    return { status: 'unsupported', reason: 'spouse support/cohabitation not confirmed' }
  const claimant = ids.length === 2 && support?.status === 'known' && support.value
    ? ids.reduce((a, b) => federalPeople[a].netIncome >= federalPeople[b].netIncome ? a : b) : null
  // Credit belongs to the household once; assign it to the highest-tax
  // claimant, then pass any unusable remainder to the spouse (Schedule B 33).
  const b = scheduleB2026(people)
  const ordinary = Object.fromEntries(ids.map(id => [id, ordinaryQuebecIncomeTax(people[id].taxableIncome)]))
  const claims: Record<string, number> = Object.fromEntries(ids.map(id => [id, 0]))
  let remaining = b.credit
  for (const id of [...ids].sort((a, z) => ordinary[z] - ordinary[a])) {
    claims[id] = Math.min(ordinary[id], remaining)
    remaining -= claims[id]
  }
  const byPerson: Record<string, QuebecTaxRow> = {}
  for (const id of ids) {
    const source = people[id]
    const fss = scheduleF2026(source)
    if (fss.status !== 'ok') return fss
    const ramq = ramqPremium2026(plan.taxProfile?.qcDrugCoverage?.[id])
    if (ramq.status !== 'ok') return ramq
    const federal = federalPeople[id]
    byPerson[id] = { federalTax: federalIncomeTax(federal.taxableIncome, {
      age: federal.age, pensionIncome: federal.federalPensionEligible,
      spouseNetIncome: claimant === id ? federalPeople[ids.find(other => other !== id)!].netIncome : undefined,
    }, true), provincialIncomeTax: ordinary[id] - claims[id], scheduleBCredit: claims[id],
    fss: fss.contribution, ramq: ramq.premium, qcTaxableIncome: source.taxableIncome,
    qcRetirementEligible: source.provincialPensionEligible, qcFssBase: fss.base }
  }
  return { status: 'ok', byPerson, total: Object.values(byPerson).reduce((sum, row) =>
    sum + row.federalTax + row.provincialIncomeTax + row.fss + row.ramq, 0) }
}
