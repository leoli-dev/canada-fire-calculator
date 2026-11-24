import type { InputsV2 } from './model'
import type { AnnualState, PrimaryHomeSaleReceipt } from './annualState'
import { passiveHomeProblem, householdPassiveHomeProblem } from './annualProperty'
import { mortgageDecimal, mortgageSubtract, mortgageAdd, mortgageMultiply, mortgageNegative, mortgageNumber, type MortgageDecimal } from './mortgageDecimal'

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const money = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER / 100
export type HomeSaleExactReceipt = Record<'grossProceeds' | 'sellingCosts' | 'netProceeds' | 'acb' | 'realizedGain', MortgageDecimal> & Partial<Record<'mortgagePrincipalPaid' | 'residualCash' | 'recordedOpeningValue' | 'saleValueReconciliation' | 'recordedOpeningPrincipal' | 'mortgagePrincipalReconciliation', MortgageDecimal>>
export function exactHomeReceipt(r: PrimaryHomeSaleReceipt): HomeSaleExactReceipt {
  const grossProceeds = r.valuation?.modeledGrossProceeds ?? mortgageDecimal(r.grossProceeds), sellingCosts = mortgageDecimal(r.sellingCosts), acb = mortgageDecimal(r.acb)
  const netProceeds = mortgageSubtract(grossProceeds, sellingCosts)
  return { grossProceeds, sellingCosts, acb, netProceeds, realizedGain: mortgageSubtract(netProceeds, acb), ...(r.mortgagePayoff ? { recordedOpeningValue: mortgageDecimal(r.valuation!.recordedOpeningValue), saleValueReconciliation: mortgageSubtract(grossProceeds, mortgageDecimal(r.valuation!.recordedOpeningValue)), recordedOpeningPrincipal: mortgageDecimal(r.mortgagePayoff.recordedOpeningPrincipal), mortgagePrincipalReconciliation: mortgageSubtract(mortgageDecimal(r.mortgagePayoff.openingPrincipal), mortgageDecimal(r.mortgagePayoff.recordedOpeningPrincipal)), mortgagePrincipalPaid: mortgageDecimal(r.mortgagePayoff.openingPrincipal), residualCash: mortgageSubtract(netProceeds, mortgageDecimal(r.mortgagePayoff.openingPrincipal)) } : {}) }
}
export const decimalMin = (a: MortgageDecimal, b: MortgageDecimal) => mortgageNegative(mortgageSubtract(a, b)) ? a : b
export function homeLivingDecimal(amount: number, inflation: number, elapsed: number): MortgageDecimal {
  let result = mortgageDecimal(amount)
  const factor = mortgageAdd(mortgageDecimal(1), mortgageDecimal(inflation))
  for (let i = 0; i < elapsed; i++) result = mortgageMultiply(result, factor)
  return result
}
/** No designation is inferred from property kind. This is a user assumption,
 * not a filing or eligibility determination. ITA 40(2)(b), 54; CRA requires
 * reporting the disposition and designation even for a fully exempt gain.
 * https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/personal-income/line-12700-capital-gains/principal-residence-other-real-estate.html
 * https://laws-lois.justice.gc.ca/eng/acts/I-3.3/section-40.html
 * https://laws-lois.justice.gc.ca/eng/acts/I-3.3/section-54.html
 */
export function primaryHomeSale(plan: InputsV2, opening: AnnualState, household = false): PrimaryHomeSaleReceipt {
  const refuse = (detail: string): never => { throw { status: 'unsupported', reason: `primary home sale: ${detail}` } }
  const problem = (household ? householdPassiveHomeProblem : passiveHomeProblem)(plan.debts.length ? { ...plan, debts: [], properties: plan.properties.map(p => ({ ...p, mortgageDebtId: null })) } : plan)
  if (problem) refuse(problem)
  const p = plan.properties[0], person = plan.people.find(p => p.role === 'self')!, held = opening.byProperty[p.id]
  if (plan.accounts.some(a => a.kind !== 'tfsa' || a.jurisdiction || a.accessibleAge !== undefined) ||
      plan.dependents.length || person.pension || person.pensionAnnual !== 0 || person.cppWork || plan.taxProfile?.pensionSplit || plan.taxProfile?.qcPensionSplit ||
      !['manual', 'statement'].includes(person.cppAmountSource?.source ?? '') || !['manual', 'statement'].includes(person.oasAmountSource?.source ?? '') ||
      person.cppAnnualAt65 !== 0 || person.oasAnnualAt65 !== 0 || plan.annualBenefitsEvidence || plan.annualGisEvidence || plan.annualNonRegEvidence ||
      plan.incomeSources.some(i => i.annualAmount.status !== 'known' || i.annualAmount.value !== 0))
    refuse('requires ordinary TFSA only and verified excluded benefits and other income')
  if (p.sellAtAge !== opening.byPerson[person.id].age || !held.held || opening.primaryHomeSaleCash)
    refuse('requires exact planned opening year of a held home')
  const records = plan.annualPrimaryHomeSaleEvidence
  const e = records && own(records, p.id) ? records[p.id] : undefined
  if (!e || !own(e, 'provenance') || !e.provenance || !own(e.provenance, 'origin') || e.provenance.origin !== 'user' ||
      !own(e.provenance, 'sourceYear') || !Number.isInteger(e.provenance.sourceYear) ||
      !own(e, 'wholePropertyFullyExcluded') || e.wholePropertyFullyExcluded !== true ||
      !own(e, 'salePriceBasis') || e.salePriceBasis !== 'opening-year-nominal-value' ||
      !own(e, 'sellingCostsNominal') || e.sellingCostsNominal?.status !== 'known' || !money(e.sellingCostsNominal.value) ||
      !own(e, 'postSaleAnnualSpendingReal') || e.postSaleAnnualSpendingReal?.status !== 'known' || !money(e.postSaleAnnualSpendingReal.value))
    refuse('requires explicit user event designation, opening valuation, known nominal fees and post-sale living spending')
  if (household) {
    const dated = (v: unknown): boolean => {
      if (!v || typeof v !== 'object') return false
      const p = v as { origin?: string; sourceYear?: number }
      return own(p, 'origin') && p.origin === 'user' && own(p, 'sourceYear') && Number.isInteger(p.sourceYear) && p.sourceYear! >= 0 && p.sourceYear! <= plan.baseYear
    }
    const owners = p.taxableOwnerShares.status === 'known' ? Object.entries(p.taxableOwnerShares.shares).filter(([, share]) => share > 0).map(([id]) => id).sort() : []
    const exclusions = e!.ownerExclusions
    if (!own(e!, 'effectiveYear') || e!.effectiveYear !== opening.year || !own(e!, 'timing') || e!.timing !== 'start-of-sale-year' ||
        !dated(e!.provenance) || !own(e!, 'allSaleCashAvailableForJointSpending') || e!.allSaleCashAvailableForJointSpending !== true ||
        !own(e!, 'ownerExclusions') || !exclusions || Object.keys(exclusions).sort().join('|') !== owners.join('|') ||
        owners.some(id => !own(exclusions, id) || !own(exclusions[id], 'fullyExcluded') || exclusions[id].fullyExcluded !== true || !own(exclusions[id], 'provenance') || !dated(exclusions[id].provenance)) ||
        !own(held.acb, 'status') || !own(held.acb, 'value') || !own(e!.sellingCostsNominal, 'status') || !own(e!.sellingCostsNominal, 'value') || !own(e!.postSaleAnnualSpendingReal, 'status') || !own(e!.postSaleAnnualSpendingReal, 'value') ||
        plan.people.some(p => opening.byPerson[p.id].age < p.retirementAge || p.pension || p.pensionAnnual !== 0 || p.cppWork || p.cppAnnualAt65 !== 0 || p.oasAnnualAt65 !== 0 || !['manual', 'statement'].includes(p.cppAmountSource?.source ?? '') || !['manual', 'statement'].includes(p.oasAmountSource?.source ?? '')) ||
        plan.accounts.filter(a => a.kind === 'tfsa' && a.balance > 0).length !== 1 || plan.accounts.some(a => a.kind !== 'tfsa' || a.jurisdiction || a.accessibleAge !== undefined) ||
        plan.annualPrimaryHomePurchaseEvidence || plan.annualTerminalEstateEvidence || (!plan.debts.length && e!.mortgagePayoff) || plan.strategy === 'meltdownPaced')
      refuse('requires dated complete owner exclusions and authorization of all cash for joint living in a both-retired ordinary TFSA household')
  }
  if (held.acb.status !== 'known' || !money(held.acb.value) || !money(held.value)) refuse('requires known nominal ACB and opening value')
  const sellingCosts = e!.sellingCostsNominal.status === 'known' ? e!.sellingCostsNominal.value : NaN
  const acb = held.acb.status === 'known' ? held.acb.value : NaN
  let exactGross = mortgageDecimal(held.value)
  if (plan.debts.length) {
    exactGross = mortgageDecimal(p.value)
    const factor = mortgageMultiply(mortgageAdd(mortgageDecimal(1), mortgageDecimal(p.appreciation)), mortgageAdd(mortgageDecimal(1), mortgageDecimal(plan.inflation)))
    for (let y = plan.baseYear; y < opening.year; y++) exactGross = mortgageMultiply(exactGross, factor)
    if (!money(mortgageNumber(exactGross)) || household && mortgageNegative(mortgageSubtract(mortgageDecimal(Number.MAX_SAFE_INTEGER / 100), exactGross))) refuse('modeled sale valuation outside supported nominal range')
  }
  const exactNet = mortgageSubtract(exactGross, mortgageDecimal(sellingCosts))
  const exactGain = mortgageSubtract(exactNet, mortgageDecimal(acb))
  if (mortgageNegative(exactNet) || mortgageNegative(exactGain)) refuse('sale losses or fees exceeding proceeds are unsupported')
  const netProceeds = mortgageNumber(exactNet), realizedGain = mortgageNumber(exactGain)
  let mortgagePayoff: PrimaryHomeSaleReceipt['mortgagePayoff']
  if (plan.debts.length) {
    const debt = plan.debts[0], terms = e!.mortgagePayoff
    // FCAC: an early full repayment on sale may incur penalties and fees.
    // https://www.canada.ca/en/financial-consumer-agency/services/mortgages/reduce-prepayment-penalties.html
    if (plan.debts.length !== 1 || debt.kind !== 'mortgage' || debt.propertyId !== p.id || p.mortgageDebtId !== debt.id ||
        !terms || !own(e!, 'mortgagePayoff') || !own(terms, 'debtId') || terms.debtId !== debt.id ||
        !own(terms, 'timing') || terms.timing !== 'start-of-sale-year' || !own(terms, 'effectiveYear') || terms.effectiveYear !== opening.year ||
        !own(terms, 'provenance') || !terms.provenance || !own(terms.provenance, 'origin') || terms.provenance.origin !== 'user' ||
        !own(terms.provenance, 'sourceYear') || !Number.isInteger(terms.provenance.sourceYear) || terms.provenance.sourceYear! < 0 || terms.provenance.sourceYear! > plan.baseYear ||
        !(['additionalAccruedInterestNominal', 'prepaymentPenaltyNominal', 'dischargeFeesNominal'] as const).every(key => own(terms, key) && terms[key]?.status === 'known' && own(terms[key], 'status') && own(terms[key], 'value') && terms[key].value === 0))
      refuse('requires explicit matching user start-of-sale-year payoff terms with known zero accrued interest, penalty and discharge fees')
    const quote = terms!.openingPrincipalNominal
    if (!own(terms!, 'openingPrincipalNominal') || !quote || !own(quote, 'status') || quote.status !== 'known' || !own(quote, 'value') || !money(quote.value))
      refuse('requires explicit known safe nominal opening principal payoff quote')
    const openingPrincipal = quote!.status === 'known' ? quote!.value : NaN
    const recordedOpeningPrincipal = opening.byDebt[debt.id].principal
    // An exactly settled balance cannot acquire a new payoff through the
    // operand-scale solver allowance; nor can a positive balance be forgiven.
    if ((recordedOpeningPrincipal === 0) !== (openingPrincipal === 0))
      refuse('payoff quote inconsistent with exactly zero opening principal')
    const principalReconciliation = mortgageNumber(mortgageSubtract(mortgageDecimal(openingPrincipal), mortgageDecimal(recordedOpeningPrincipal)))
    // 64 machine epsilons cover the bounded annuity PV solver and input operands.
    // No absolute floor: tiny loans retain tiny bounds; cap in nominal and anchor-real CAD.
    const startCpi = (1 + plan.inflation) ** (opening.year - plan.baseYear)
    const bound = Math.min(0.000001, 0.000001 * startCpi, 64 * Number.EPSILON * Math.max(recordedOpeningPrincipal, openingPrincipal, debt.principal, debt.annualPayment))
    if (!Number.isFinite(bound) || Math.abs(principalReconciliation) > bound) refuse('payoff quote inconsistent with recorded opening principal')
    const residual = mortgageSubtract(exactNet, mortgageDecimal(openingPrincipal))
    if (mortgageNegative(residual)) refuse('net sale proceeds cannot cover opening mortgage principal')
    mortgagePayoff = { recordedOpeningPrincipal, principalReconciliation, debtId: debt.id, openingPrincipal, additionalAccruedInterest: 0, prepaymentPenalty: 0, dischargeFees: 0, totalPayoff: openingPrincipal, residualCash: mortgageNumber(residual), terms: structuredClone(terms!) }
  }
  return { propertyId: p.id, year: opening.year, grossProceeds: mortgageNumber(exactGross), sellingCosts, netProceeds, acb, realizedGain, taxableGain: 0, ...(mortgagePayoff ? { mortgagePayoff, valuation: { recordedOpeningValue: held.value, modeledGrossProceeds: exactGross, reconciliation: mortgageNumber(mortgageSubtract(exactGross, mortgageDecimal(held.value))) } } : {}) }
}
