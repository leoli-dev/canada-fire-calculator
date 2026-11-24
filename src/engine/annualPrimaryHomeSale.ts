import type { InputsV2 } from './model'
import type { AnnualState, PrimaryHomeSaleReceipt } from './annualState'
import { passiveHomeProblem } from './annualProperty'
import { mortgageDecimal, mortgageSubtract, mortgageAdd, mortgageMultiply, mortgageNegative, mortgageNumber, type MortgageDecimal } from './mortgageDecimal'

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const money = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER / 100
export type HomeSaleExactReceipt = Record<'grossProceeds' | 'sellingCosts' | 'netProceeds' | 'acb' | 'realizedGain', MortgageDecimal>
export function exactHomeReceipt(r: PrimaryHomeSaleReceipt): HomeSaleExactReceipt {
  const grossProceeds = mortgageDecimal(r.grossProceeds), sellingCosts = mortgageDecimal(r.sellingCosts), acb = mortgageDecimal(r.acb)
  const netProceeds = mortgageSubtract(grossProceeds, sellingCosts)
  return { grossProceeds, sellingCosts, acb, netProceeds, realizedGain: mortgageSubtract(netProceeds, acb) }
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
export function primaryHomeSale(plan: InputsV2, opening: AnnualState): PrimaryHomeSaleReceipt {
  const refuse = (detail: string): never => { throw { status: 'unsupported', reason: `primary home sale: ${detail}` } }
  const problem = passiveHomeProblem(plan)
  if (problem) refuse(problem)
  const p = plan.properties[0], person = plan.people[0], held = opening.byProperty[p.id]
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
  if (held.acb.status !== 'known' || !money(held.acb.value) || !money(held.value)) refuse('requires known nominal ACB and opening value')
  const sellingCosts = e!.sellingCostsNominal.status === 'known' ? e!.sellingCostsNominal.value : NaN
  const acb = held.acb.status === 'known' ? held.acb.value : NaN
  const exactNet = mortgageSubtract(mortgageDecimal(held.value), mortgageDecimal(sellingCosts))
  const exactGain = mortgageSubtract(exactNet, mortgageDecimal(acb))
  if (mortgageNegative(exactNet) || mortgageNegative(exactGain)) refuse('sale losses or fees exceeding proceeds are unsupported')
  const netProceeds = mortgageNumber(exactNet), realizedGain = mortgageNumber(exactGain)
  return { propertyId: p.id, year: opening.year, grossProceeds: held.value, sellingCosts, netProceeds, acb, realizedGain, taxableGain: 0 }
}
