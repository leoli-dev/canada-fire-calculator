import type { InputsV2 } from './model'
import type { AnnualState, AnnualStepValue, PrimaryHomePurchaseState } from './annualState'
import { mortgageDecimal as d, mortgageAdd as add, mortgageSubtract as sub, mortgageMultiply as mul, mortgageNegative as negative, mortgageNumber as number } from './mortgageDecimal'
import { decimalMin, homeLivingDecimal } from './annualPrimaryHomeSale'

const money = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER / 100
export const PRIMARY_HOME_PURCHASE_SHORTFALL = 'primary home purchase: entire nominal price plus costs is not funded; no acquisition or debit committed'
export function prospectivePurchaseLivingScope(plan: InputsV2, opening: AnnualState): boolean {
  const person = plan.people[0], p = plan.properties[0]
  return !!(plan.annualPrimaryHomePurchaseEvidence && p && Object.prototype.hasOwnProperty.call(plan.annualPrimaryHomePurchaseEvidence, p.id) && p.plannedPurchaseAge !== null && opening.byPerson[person.id].age < p.plannedPurchaseAge && !opening.primaryHomePurchase && plan.people.length === 1 && plan.province === 'ON' && plan.accounts.length === 1 && plan.accounts[0].kind === 'tfsa' && !plan.accounts[0].jurisdiction && plan.accounts[0].accessibleAge === undefined && !plan.debts.length && !plan.annualBenefitsEvidence && !plan.annualGisEvidence && !plan.annualNonRegEvidence && !plan.annualPrimaryHomeSaleEvidence && person.cppAnnualAt65 === 0 && person.oasAnnualAt65 === 0 && plan.incomeSources.every(i => i.annualAmount.status === 'known' && i.annualAmount.value === 0))
}
/** Scoped modeled balance, from committed postings and the canonical input
 * factors. The signed numeric reconciliation is observable on the account row. */
export function carryProspectivePurchaseBalance(plan: InputsV2, opening: AnnualState, state: AnnualState, accountRows: AnnualStepValue['row']['byAccount']): void {
  if (!plan.annualPrimaryHomePurchaseEvidence || plan.people.length !== 1 || plan.properties.length !== 1 || plan.properties[0].plannedPurchaseAge === null || opening.primaryHomePurchase || plan.accounts.length !== 1 || plan.accounts[0].kind !== 'tfsa' || plan.debts.length) return
  if (!Object.prototype.hasOwnProperty.call(plan.annualPrimaryHomePurchaseEvidence, plan.properties[0].id)) return
  const account = plan.accounts[0], row = accountRows[account.id]
  const exactOpening = opening.prospectivePurchaseExactBalances?.[account.id] ?? d(opening.byAccount[account.id].balance)
  const principal = sub(add(exactOpening, d(row.contribution)), row.primaryHomePurchaseExactWithdrawal ?? d(row.withdrawal))
  const factor = mul(sub(add(d(1), d(account.realReturn)), d(account.annualFee)), add(d(1), d(plan.inflation)))
  const exact = mul(principal, factor), precise = number(exact)
  if (negative(principal) || negative(exact) || !money(precise)) throw { status: 'unsupported', reason: 'primary home purchase: unsupported prospective balance' }
  const correction = precise - state.byAccount[account.id].balance
  if (correction !== 0) row.primaryHomePurchaseReconciliation = correction
  state.prospectivePurchaseExactBalances = { [account.id]: exact }
  state.byAccount[account.id].balance = precise
  row.closing = precise
}
export function purchaseContext(plan: InputsV2, opening: AnnualState): PrimaryHomePurchaseState | undefined {
  if (!plan.annualPrimaryHomePurchaseEvidence) return undefined
  const p = plan.properties[0], person = plan.people[0]
  if (!p || p.plannedPurchaseAge === null || opening.byPerson[person.id].age < p.plannedPurchaseAge) return undefined
  const refuse = (s: string): never => { throw { status: 'unsupported', reason: `primary home purchase: ${s}` } }
  const e = Object.prototype.hasOwnProperty.call(plan.annualPrimaryHomePurchaseEvidence, p.id) ? plan.annualPrimaryHomePurchaseEvidence[p.id] : undefined
  if (e && (!["provenance", "effectiveYear", "timing", "priceNominal", "qualifyingAcquisitionCostsNominal", "postPurchaseAnnualSpendingReal", "excludesOneTimeCosts"].every(k => Object.prototype.hasOwnProperty.call(e, k)) || !e.provenance || !["origin", "sourceYear"].every(k => Object.prototype.hasOwnProperty.call(e.provenance, k)))) refuse("requires explicit own dated event evidence fields")
  if (plan.people.length !== 1 || plan.province !== 'ON' || plan.properties.length !== 1 || plan.debts.length || p.kind !== 'principal' || p.sellAtAge !== null || p.mortgageDebtId || p.annualHoldingCostChange !== 0 || p.annualRent.status !== 'known' || p.annualRent.value !== 0 || p.taxableOwnerShares.status !== 'known' || Object.keys(p.taxableOwnerShares.shares).length !== 1 || p.taxableOwnerShares.shares[person.id] !== 1 ||
      plan.accounts.length !== 1 || plan.accounts.some(a => a.kind !== 'tfsa' || a.jurisdiction || a.accessibleAge !== undefined) || plan.annualBenefitsEvidence || plan.annualGisEvidence || plan.annualNonRegEvidence || plan.annualPrimaryHomeSaleEvidence || person.cppAnnualAt65 !== 0 || person.oasAnnualAt65 !== 0 || !['manual', 'statement'].includes(person.cppAmountSource?.source ?? '') || !['manual', 'statement'].includes(person.oasAmountSource?.source ?? '') || plan.incomeSources.some(i => i.annualAmount.status !== 'known' || i.annualAmount.value !== 0)) refuse('requires one prospective wholly owned home and ordinary TFSA with explicit zero benefits and no other events')
  if (!e || e.provenance?.origin !== 'user' || !Number.isInteger(e.provenance.sourceYear) || e.provenance.sourceYear! < 0 || e.provenance.sourceYear! > plan.baseYear || e.timing !== 'start-of-purchase-year' || e.effectiveYear !== plan.baseYear + p.plannedPurchaseAge! - person.ageInBaseYear || e.excludesOneTimeCosts !== true ||
      ![e.priceNominal, e.qualifyingAcquisitionCostsNominal, e.postPurchaseAnnualSpendingReal].every(f => f?.status === 'known' && money(f.value))) refuse('requires dated user nominal price, qualifying costs and confirmed post-purchase living spending excluding one-time costs')
  const price = e!.priceNominal.status === 'known' ? e!.priceNominal.value : NaN
  const costs = e!.qualifyingAcquisitionCostsNominal.status === 'known' ? e!.qualifyingAcquisitionCostsNominal.value : NaN
  if (Object.prototype.hasOwnProperty.call(e!, "priceBasis") && e!.priceBasis !== "purchase-year-nominal" && e!.priceBasis !== "base-year-real-indexed") refuse("unsupported explicit price basis")
  const priceBasis = e!.priceBasis ?? "purchase-year-nominal"
  if (!["purchase-year-nominal", "base-year-real-indexed"].includes(priceBasis)) refuse("unsupported explicit price basis")
  const exactPrice = priceBasis === "base-year-real-indexed" ? homeLivingDecimal(p.value, plan.inflation, e!.effectiveYear - plan.baseYear) : d(p.value)
  if (price !== number(exactPrice) || p.plannedDownPayment !== p.value || p.plannedMortgage && (p.plannedMortgage.principal !== 0 || ![p.plannedMortgage.annualPayment, p.plannedMortgage.yearsRemaining].every(term => term === null || term === 0))) refuse("price, recorded valuation, down payment and zero financing must reconcile")
  if (opening.primaryHomePurchase) return structuredClone(opening.primaryHomePurchase)
  if (opening.year !== e!.effectiveYear || opening.byProperty[p.id].held) refuse('requires exact opening acquisition year of an unheld property')
  const total = add(exactPrice, d(costs))
  if (!money(number(total))) refuse('unsafe total acquisition cost')
  const balances = Object.fromEntries(plan.accounts.map(a => [a.id, opening.prospectivePurchaseExactBalances?.[a.id] ?? d(opening.byAccount[a.id].balance)]))
  const account = plan.accounts[0]
  if (negative(sub(balances[account.id], total))) throw { status: 'unsupported', reason: PRIMARY_HOME_PURCHASE_SHORTFALL }
  balances[account.id] = sub(balances[account.id], total)
  return { exactPrice, receipt: { propertyId: p.id, year: opening.year, priceBasis, price, qualifyingAcquisitionCosts: costs, totalCost: number(total), acb: number(total), tax: 0 }, evidence: structuredClone(e!), exactAccountBalances: balances }
}

/** CRA ACB includes purchase price and qualifying acquisition expenses; no fees
 * or rebates are inferred. Verified 2026-11-24, Transfers of capital property,
 * linked ACB definition: https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/personal-income/line-12700-capital-gains/transfers-capital-property.html */
export function settlePurchase(plan: InputsV2, opening: AnnualState, value: AnnualStepValue, context: PrimaryHomePurchaseState): void {
  const { state, row } = value, person = plan.people[0], a = plan.accounts[0], r = context.receipt
  const acquired = r.year === opening.year
  const spending = context.evidence.postPurchaseAnnualSpendingReal
  const due = homeLivingDecimal(spending.status === 'known' ? spending.value : NaN, plan.inflation, opening.year - plan.baseYear)
  const living = decimalMin(context.exactAccountBalances[a.id], due)
  const purchase = acquired ? add(context.exactPrice, d(r.qualifyingAcquisitionCosts)) : d(0)
  const withdrawal = add(purchase, living), residue = sub(context.exactAccountBalances[a.id], living)
  const factor = mul(sub(add(d(1), d(a.realReturn)), d(a.annualFee)), add(d(1), d(plan.inflation)))
  context.exactAccountBalances[a.id] = mul(residue, factor)
  state.byAccount[a.id].balance = number(context.exactAccountBalances[a.id])
  Object.assign(row.byAccount[a.id], { opening: opening.byAccount[a.id].balance, withdrawal: number(withdrawal), returnAmount: number(sub(context.exactAccountBalances[a.id], residue)), closing: state.byAccount[a.id].balance })
  state.tfsaWithdrawalHistory = [...(opening.tfsaWithdrawalHistory ?? []), ...(number(withdrawal) > 0 ? [{ id: `annual:${row.year}:withdrawal:${a.id}`, personId: person.id, calendarYear: row.year, amount: number(withdrawal) }] : [])]
  state.primaryHomePurchase = context
  delete state.prospectivePurchaseExactBalances
  const property = state.byProperty[r.propertyId]
  const start = acquired ? r.price : opening.byProperty[r.propertyId].value
  const growthFactor = (1 + plan.properties[0].appreciation) * (1 + plan.inflation)
  if (plan.properties[0].appreciation < -1 || plan.inflation < -1 || !Number.isFinite(growthFactor) || growthFactor < 0) throw { status: "unsupported", reason: "primary home purchase: unsupported property growth" }
  const closing = start * growthFactor
  if (!money(closing) || !money(state.byAccount[a.id].balance)) throw { status: "invalid", reason: "primary home purchase: unsafe closing amount" }
  Object.assign(property, { held: true, value: closing, acb: { status: 'known', value: r.acb } })
  row.byProperty[r.propertyId] = { held: true, opening: start, growth: closing - start, closing }
  row.byPerson[person.id].spending = number(living)
  row.cashLedger.spending = number(living)
  row.cashLedger.unallocated = 0
  Object.assign(row.retirementSettlement!, { spendingDue: number(due), spendingFunded: number(living), spendingUnmet: number(sub(due, living)), ...(acquired ? { primaryHomePurchase: r } : {}), primaryHomePurchaseEvidence: context.evidence, primaryHomePurchaseArithmetic: { price: context.exactPrice, qualifyingAcquisitionCosts: d(r.qualifyingAcquisitionCosts), totalCost: add(context.exactPrice, d(r.qualifyingAcquisitionCosts)), withdrawals: { [a.id]: purchase }, spendingDue: due, spendingFunded: living, spendingUnmet: sub(due, living) } })
}
