import type { InputsV2 } from './model'
import type { AnnualState } from './annualState'
import type { CanonicalHouseholdWorkingEvaluation } from './annualWorking'
import { settleHouseholdOas } from './annualOas'
import { mortgageAdd, mortgageDecimal, mortgageNegative, mortgageNumber, mortgageSubtract, type MortgageDecimal } from './mortgageDecimal'

export const HOUSEHOLD_MORTGAGE_RRSP_REFUSAL = 'household mortgage RRSP requires dated explicit sole-owner account authorization and TFSA-before-RRSP priority'
export interface HouseholdMortgageRrspReceipt {
  authorization: NonNullable<InputsV2['annualHouseholdMortgageRrspEvidence']>
  accountId: string; ownerId: string; gross: number; netCash: number; taxIncrement: number; oasRecoveryIncrement: number
  arithmetic: { gross: MortgageDecimal; netCash: MortgageDecimal; taxIncrement: MortgageDecimal; oasRecoveryIncrement: MortgageDecimal; availableAfterDraw: MortgageDecimal }
  cashProof?: { debtDue: MortgageDecimal; afterDebt: MortgageDecimal; livingDue: MortgageDecimal; livingFunded: MortgageDecimal; livingUnmet: MortgageDecimal; residual: MortgageDecimal }
  search: 'bounded-adjacent-funded-quote' | 'capacity-exhausted'
  /** Local quote evidence only: posted nominal atoms are not monotone. Null
   * means the predecessor quote was outside the supported pricing domain. */
  adjacentRecovery?: { anchorGross: number; window: 64; candidatesChecked: number; immediatePredecessorFunded: boolean | null }
}
const own = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k)
const fields = (v: unknown, keys: string[]): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && keys.every(k => own(v, k))
export function householdMortgageRrspProblem(plan: InputsV2, opening?: AnnualState): string | null {
  const e = plan.annualHouseholdMortgageRrspEvidence
  const accounts = plan.accounts.filter(a => a.kind === 'rrsp' && a.balance > 0)
  if (!own(plan, 'annualHouseholdMortgageRrspEvidence') || !fields(e, ['accountId', 'ownerId', 'authorized', 'purpose', 'priority', 'provenance']) ||
      typeof e.accountId !== 'string' || typeof e.ownerId !== 'string' || e.authorized !== true ||
      e.purpose !== 'household-held-mortgage-and-living' || e.priority !== 'tfsa-before-rrsp' ||
      !fields(e.provenance, ['origin', 'sourceYear']) || e.provenance.origin !== 'user' ||
      typeof e.provenance.sourceYear !== 'number' || !Number.isInteger(e.provenance.sourceYear) || e.provenance.sourceYear < 0 || e.provenance.sourceYear > plan.baseYear ||
      e.provenance.note !== undefined && (!own(e.provenance, 'note') || typeof e.provenance.note !== 'string') ||
      plan.people.length !== 2 || accounts.length !== 1 || !plan.people.some(p => p.id === e.ownerId) ||
      !accounts.some(a => fields(a, ['id', 'kind', 'ownerId']) && a.id === e.accountId && a.ownerId === e.ownerId && !a.jurisdiction && a.accessibleAge === undefined) ||
      opening && (!own(opening.byAccount, e.accountId) || opening.byAccount[e.accountId].ownerId !== e.ownerId) ||
      plan.accounts.filter(a => a.kind === 'tfsa').length < 1 || plan.accounts.filter(a => a.kind === 'tfsa').length > 2)
    return HOUSEHOLD_MORTGAGE_RRSP_REFUSAL
  const a = accounts[0]
  const title = a.taxableOwnerShares
  if (title !== undefined && (title.status !== 'known' || !fields(title, ['status', 'shares']) || !fields(title.shares, [e.ownerId]) || title.shares[e.ownerId] !== 1 ||
      Object.entries(title.shares).some(([id, share]) => typeof share !== 'number' || !Number.isFinite(share) || share < 0 || share > 1 || id !== e.ownerId && share !== 0)))
    return HOUSEHOLD_MORTGAGE_RRSP_REFUSAL
  return null
}

// Positive finite IEEE doubles have the same order as their unsigned bits.
// Searching that integer domain gives a deterministic local funding bracket
// even for a subnormal target or large account. Posted tax/OAS atoms can reverse
// at adjacent doubles, so the bracket does not establish a global minimum.
const bits = (n: number): bigint => { const v = new DataView(new ArrayBuffer(8)); v.setFloat64(0, n); return v.getBigUint64(0) }
const number = (n: bigint): number => { const v = new DataView(new ArrayBuffer(8)); v.setBigUint64(0, n); return v.getFloat64(0) }
const safeMoney = (n: number) => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER / 100
const zero = () => mortgageDecimal(0)
const sum = (values: MortgageDecimal[]) => values.reduce(mortgageAdd, zero())
const stop = (reason: string): never => { throw { status: 'unsupported', reason: `household mortgage RRSP ${reason}` } }

/** Candidate quotes never mutate state. Existing owner tax and OAS settlement
 * supply the exact posted nominal atoms. Failed speculative eligibility never
 * vetoes a valid quote; the final selected quote is repriced and validated for
 * posting. This is internal to the authenticated mortgage path. */
export function quoteHouseholdMortgageRrsp(plan: InputsV2, year: number, working: CanonicalHouseholdWorkingEvaluation,
  capacity: MortgageDecimal, available: MortgageDecimal, due: MortgageDecimal, baselineTax: MortgageDecimal, baselineOas: MortgageDecimal) {
  const e = plan.annualHouseholdMortgageRrspEvidence!
  if (working.household.byPerson[e.ownerId].phase !== 'retired') stop('owner must be retired when funding is reached')
  const cpi = working.startCpi
  const events: import('./personIncome').IncomeEvent[] = []
  for (const [id, p] of Object.entries(working.household.byPerson)) {
    if (p.phase === 'working') events.push({ id: `annual:${year}:wage:${id}`, personId: id, kind: 'employment', amount: p.grossWagesReal })
    if (p.cpp) events.push({ id: `annual:${year}:cpp:${id}`, personId: id, kind: 'cpp', amount: p.cpp.amountReal })
  }
  const payroll = Object.fromEntries(Object.entries(working.household.byPerson).flatMap(([id, p]) => p.payrollReal ? [[id, p.payrollReal]] : []))
  const oas = Object.fromEntries(Object.entries(working.household.byPerson).flatMap(([id, p]) => p.oas ? [[id, p.oas]] : []))
  const run = (gross: number) => {
    const settled = settleHouseholdOas(plan, year, [...events, { id: `annual:${year}:withdrawal:${e.accountId}`, kind: 'rrspWithdrawal', accountId: e.accountId, amount: gross / cpi }], payroll, oas)
    const tax = sum(Object.values(settled.priced.byPerson).map(p => mortgageDecimal(p.tax * cpi)))
    const netOas = sum(Object.values(settled.oas).map(b => mortgageDecimal(b.netReal * cpi)))
    const taxIncrement = mortgageSubtract(tax, baselineTax), oasRecoveryIncrement = mortgageSubtract(baselineOas, netOas)
    const netCash = mortgageSubtract(mortgageSubtract(mortgageDecimal(gross), taxIncrement), oasRecoveryIncrement)
    const availableAfterDraw = mortgageAdd(available, netCash)
    return { gross, settled, tax, netOas, taxIncrement, oasRecoveryIncrement, netCash, availableAfterDraw }
  }
  const funded = (q: ReturnType<typeof run>) => !mortgageNegative(mortgageSubtract(q.availableAfterDraw, due))
  const validate = (q: ReturnType<typeof run>, fullFunding: boolean) => {
    const amounts = [q.gross, q.gross / cpi, ...events.map(e => e.amount),
      ...Object.values(q.settled.priced.byPerson).flatMap(p => [p.tax, p.grossIncome, p.taxableIncome, p.netIncome, p.tax * cpi, p.grossIncome * cpi, p.taxableIncome * cpi, p.netIncome * cpi]),
      ...Object.values(q.settled.oas).flatMap(b => [b.netReal, b.grossReal, b.recoveryReal, b.recoveryIncomeReal, b.netReal * cpi, b.recoveryReal * cpi])]
    if (amounts.some(n => !safeMoney(n)) || 64 * Number.EPSILON * amounts.reduce((a, b) => a + b, 0) > 0.0001 * Math.min(1, cpi)) stop('accepted withdrawal tax precision cannot be upheld')
    if (fullFunding && (!funded(q) || mortgageNumber(mortgageSubtract(q.availableAfterDraw, due)) > 0.0001 * Math.min(1, cpi))) stop('selected funded quote leaves material excess cash or insufficient funding')
    const opening = mortgageNumber(capacity), closing = mortgageNumber(mortgageSubtract(capacity, mortgageDecimal(q.gross)))
    const debit = opening - closing
    if (debit <= 0 || Math.abs(debit - q.gross) > Math.min(0.0001, 0.0001 * cpi, q.gross * 1e-8, 4 * Number.EPSILON * (opening + q.gross))) stop('accepted withdrawal debit precision cannot be upheld')
  }
  // A failed speculative quote is not a verdict on an accepted lower quote.
  // Only the final chosen candidate must pass all pricing/posting validation.
  const trial = (gross: number) => { try { return run(gross) } catch { return undefined } }
  let maximum = mortgageNumber(capacity)
  if (!Number.isFinite(maximum) || maximum < 0) stop('capacity is outside finite tax pricing')
  if (mortgageNegative(mortgageSubtract(capacity, mortgageDecimal(maximum)))) maximum = number(bits(maximum) - 1n)
  if (maximum <= 0) stop('exhaustion cannot be proved: exact capacity has no positive representable gross')
  // Find a funded bracket without validating an irrelevant enormous endpoint.
  // The underlying ordinary schedule supplies the bracket's economic shape;
  // its serialized nominal tax/OAS atoms are locally nonmonotone.
  let high = Math.min(maximum, Math.max(1, mortgageNumber(mortgageSubtract(due, available))))
  let endpoint = trial(high)
  while (endpoint && !funded(endpoint) && high < maximum) {
    high = Math.min(maximum, high * 2)
    endpoint = trial(high)
  }
  let search: HouseholdMortgageRrspReceipt['search'] = 'bounded-adjacent-funded-quote'
  let adjacentRecovery: HouseholdMortgageRrspReceipt['adjacentRecovery']
  let accepted: ReturnType<typeof run>
  if (endpoint && !funded(endpoint)) {
    if (mortgageSubtract(capacity, mortgageDecimal(maximum)).coefficient !== '0') stop('exhaustion cannot be proved: exact capacity is not representable for tax pricing')
    search = 'capacity-exhausted'
    accepted = endpoint
  } else {
    let lo = 0n, hi = bits(high)
    let anchor = endpoint
    while (hi - lo > 1n) {
      const mid = (lo + hi) / 2n
      const quote = trial(number(mid))
      if (!quote) hi = mid
      else if (funded(quote)) { hi = mid; anchor = quote }
      else lo = mid
    }
    if (!anchor || !funded(anchor)) return stop('exhaustion cannot be proved: no funded quote within safe pricing bracket')
    accepted = anchor
    const candidates = [anchor]
    const anchorBits = bits(anchor.gross)
    let candidatesChecked = 0
    // Inspect the entire bounded window, including past failed cash predicates.
    // An earlier funded island may precede an insufficient immediate neighbor.
    for (let offset = 1n; offset <= 64n && offset < anchorBits; offset++) {
      candidatesChecked++
      const quote = trial(number(anchorBits - offset))
      if (quote && funded(quote)) candidates.push(quote)
    }
    // Try the lowest funded quote first, retaining the valid anchor as a
    // fallback. A speculative recovery with an unpostable debit must not
    // displace an otherwise valid funded quote or veto its settlement.
    let selected: ReturnType<typeof run> | undefined
    let selectionProblem: unknown
    for (const quote of candidates.reverse()) {
      try { validate(quote, true); selected = quote; break } catch (error) { selectionProblem = error }
    }
    if (!selected) throw selectionProblem
    accepted = selected
    const predecessor = trial(number(bits(accepted.gross) - 1n))
    adjacentRecovery = { anchorGross: anchor.gross, window: 64, candidatesChecked, immediatePredecessorFunded: predecessor ? funded(predecessor) : null }
    // Reprice the selected candidate once for final-only validation and posting.
    accepted = run(accepted.gross)
    if (!funded(accepted)) stop('selected local quote does not fully fund debt and living')
  }
  validate(accepted, search === 'bounded-adjacent-funded-quote')
  const receipt: HouseholdMortgageRrspReceipt = { authorization: structuredClone(e), accountId: e.accountId, ownerId: e.ownerId, gross: accepted.gross,
    netCash: mortgageNumber(accepted.netCash), taxIncrement: mortgageNumber(accepted.taxIncrement), oasRecoveryIncrement: mortgageNumber(accepted.oasRecoveryIncrement),
    arithmetic: { gross: mortgageDecimal(accepted.gross), netCash: accepted.netCash, taxIncrement: accepted.taxIncrement, oasRecoveryIncrement: accepted.oasRecoveryIncrement, availableAfterDraw: accepted.availableAfterDraw }, search, ...(adjacentRecovery ? { adjacentRecovery } : {}) }
  return { ...accepted, receipt }
}
