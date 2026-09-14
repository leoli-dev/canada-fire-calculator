import type { Inputs } from './types'
import type { InputsV2 } from './model'
import { calculateHouseholdTax, type HouseholdTaxResult } from './householdTax'
import type { IncomeEvent, IncomeYearContext } from './personIncome'
import { cppAnnual, earlyClaimDilutionRelief, oasAfterClawback } from './benefits'
import { pensionPaid } from './pensionPaid'
import { minimumForRrif } from './rrif'

export interface ProjectionTaxFacts {
  plan: InputsV2
  inputs: Inputs
  year: number
  selfAge: number
  withdrawals: { rrsp: number; nonReg: number }
  registeredBalance: number
  nonRegGainFraction: number
  nonRegDistributions: number
  rent: number
  otherWork: number
  oasGross: number[]
  purchaseRrspWithdrawal: number
  purchaseNonRegTaxable: number
  propertySaleTaxable: number
}
export type ProjectionTaxResult = { status: 'ok'; tax: HouseholdTaxResult & { status: 'ok' }; oasNet: number;
  oasByPerson: Record<string, { gross: number; net: number }>;
  grossCpp: number; grossPension: number; taxableExOas: number; earnedWork: number } |
  { status: 'unsupported' | 'invalid'; reason: string }

/** Build an annual tax ledger from legal recipients. This is called inside the
 * withdrawal solver, so the tax change also changes gross draws and cash.
 * Unsupported ownership or funding events never silently fall back to a
 * 50/50 tax result. */
export function personProjectionTax(f: ProjectionTaxFacts): ProjectionTaxResult {
  const { plan, inputs, selfAge } = f
  if (plan.province !== inputs.province) return { status: 'invalid', reason: 'canonical and legacy tax jurisdictions differ' }
  if (inputs.fhsa || inputs.lockedRetirement)
    return { status: 'unsupported', reason: 'FHSA/LIRA ownership transfer requires BE-12 and BE-14 B' }
  if (f.purchaseRrspWithdrawal || f.purchaseNonRegTaxable || f.propertySaleTaxable)
    return { status: 'unsupported', reason: 'purchase/sale tax needs person-owned event settlement (BE-14 B)' }
  const self = plan.people.find(person => person.role === 'self')
  const partner = plan.people.find(person => person.role === 'partner')
  if (!self || Boolean(partner) !== Boolean(inputs.partner)) return { status: 'invalid', reason: 'canonical people do not match inputs' }
  const annualEvents: IncomeEvent[] = []
  const legacyPeople = [{ canonical: self, input: inputs, age: selfAge },
    ...(partner && inputs.partner ? [{ canonical: partner, input: inputs.partner, age: partner.ageInBaseYear + f.year - plan.baseYear }] : [])]
  let grossCpp = 0
  let grossPension = 0
  for (const [index, item] of legacyPeople.entries()) {
    const cpp = item.age >= item.input.cppStartAge
      ? cppAnnual(item.input.cppAnnualAt65, item.input.cppStartAge, inputs.province === 'QC' ? 72 : 70) *
        (item.input.cppWork ? earlyClaimDilutionRelief(item.input.cppWork.startWorkAge, item.input.cppWork.retireAge, item.input.cppStartAge) : 1)
      : 0
    const pension = pensionPaid(item.input.pension, item.age, inputs.inflation ?? .021)
    grossCpp += cpp
    grossPension += pension
    if (cpp) annualEvents.push({ id: `${item.canonical.id}:cpp:${f.year}`, kind: 'cpp', personId: item.canonical.id, amount: cpp })
    if (pension) annualEvents.push({ id: `${item.canonical.id}:pension:${f.year}`, kind: 'dbPension', personId: item.canonical.id, amount: pension })
    if (index === 0 && f.otherWork) annualEvents.push({ id: `${item.canonical.id}:other:${f.year}`, kind: 'employment', personId: item.canonical.id, amount: f.otherWork })
  }
  const nonReg = plan.accounts.filter(account => account.kind === 'nonReg')
  if ((f.nonRegDistributions || f.withdrawals.nonReg) && nonReg.length !== 1)
    return { status: 'unsupported', reason: 'multiple or missing non-registered accounts need BE-14 B allocation' }
  if (nonReg[0]) {
    if ((f.nonRegDistributions || f.withdrawals.nonReg) && nonReg[0].acb.status !== 'known')
      return { status: 'unsupported', reason: 'non-registered adjusted cost base is unknown' }
    if (f.nonRegDistributions) annualEvents.push({ id: `nonreg:distribution:${f.year}`, kind: 'interest', accountId: nonReg[0].id, amount: f.nonRegDistributions })
    const gain = f.withdrawals.nonReg * f.nonRegGainFraction
    if (gain) annualEvents.push({ id: `nonreg:gain:${f.year}`, kind: 'realizedGain', accountId: nonReg[0].id, amount: gain })
  }
  const registered = plan.accounts.filter(account => ['rrsp', 'spousalRrsp', 'rrif', 'lif'].includes(account.kind))
  // A genuine two-owner registered split must never be attributed through the
  // single-account path below: any household registered balance or withdrawal
  // with more than one registered account is BE-14 B territory.
  if ((f.withdrawals.rrsp || f.registeredBalance > 0) && registered.length !== 1)
    return { status: 'unsupported', reason: 'multiple or missing registered accounts need BE-14 B allocation' }
  if (registered.length === 1 && registered[0].kind === 'rrif' && f.registeredBalance > 0) {
    const minimum = minimumForRrif(registered[0], plan.people, plan.baseYear, f.year, f.registeredBalance)
    if (minimum.status !== 'ok') return minimum
  }
  if (registered.length === 1 && f.registeredBalance > 0) {
    if (registered[0].kind === 'lif') return { status: 'unsupported', reason: 'LIF minimum and maximum withdrawals require BE-36 rules' }
    const owner = plan.people.find(person => person.id === registered[0].ownerId)
    if (!owner) return { status: 'unsupported', reason: 'registered account owner unknown' }
    const ownerAge = owner.ageInBaseYear + f.year - plan.baseYear
    if ((registered[0].kind === 'rrsp' || registered[0].kind === 'spousalRrsp') && ownerAge >= 72)
      return { status: 'unsupported', reason: 'RRSP must be converted or closed by the end of age 71' }
  }
  if (registered[0] && f.withdrawals.rrsp) {
    const owner = plan.people.find(person => person.id === registered[0].ownerId)
    if (!owner) return { status: 'unsupported', reason: 'registered account owner unknown' }
    const kind = registered[0].kind === 'rrif' ? 'rrifWithdrawal' : registered[0].kind === 'lif' ? 'lifWithdrawal' : 'rrspWithdrawal'
    annualEvents.push({ id: `registered:draw:${f.year}`, kind, accountId: registered[0].id, amount: f.withdrawals.rrsp })
  }
  if (f.rent) {
    const rented = plan.properties.filter(property => property.kind === 'investment' && property.annualRent.status === 'known' && property.annualRent.value > 0)
    if (rented.length !== 1 || rented[0].mortgageDebtId)
      return { status: 'unsupported', reason: 'rental allocation or mortgage deduction needs BE-14 B' }
    annualEvents.push({ id: `rent:${f.year}`, kind: 'rent', propertyId: rented[0].id, amount: f.rent })
  }
  // Review fix B1: the spousal attribution's s.146.3(5.1) minimum must be the
  // same figure as the year's mandatory RRIF withdrawal, which is computed from
  // this year's opening registered balance (the caller's `registeredBalance`),
  // never from the frozen canonical `account.balance`. The single-account path
  // above is the only one that reaches an RRIF event, so the balance maps to
  // that one account.
  const yearContext: IncomeYearContext = {
    registeredOpeningBalances: registered.length === 1 ? { [registered[0].id]: f.registeredBalance } : undefined,
  }
  // OAS recovery uses each person's net income after the same elected pension
  // split used by final tax, but before adding their own OAS event. CRA notes
  // that the election changes individual OAS repayment.
  const before = calculateHouseholdTax(plan, f.year, annualEvents, yearContext)
  if (before.status !== 'ok') return before
  let oasNet = 0
  const oasByPerson: Record<string, { gross: number; net: number }> = {}
  for (const [index, item] of legacyPeople.entries()) {
    const oas = oasAfterClawback(f.oasGross[index] ?? 0, before.byPerson[item.canonical.id].netIncome)
    oasNet += oas
    oasByPerson[item.canonical.id] = { gross: f.oasGross[index] ?? 0, net: oas }
    if (oas) annualEvents.push({ id: `${item.canonical.id}:oas:${f.year}`, kind: 'oas', personId: item.canonical.id, amount: oas })
  }
  const tax = calculateHouseholdTax(plan, f.year, annualEvents, yearContext)
  if (tax.status !== 'ok') return tax
  return { status: 'ok', tax, oasNet, oasByPerson, grossCpp, grossPension,
    taxableExOas: Object.values(tax.byPerson).reduce((sum, row) => sum + row.taxableIncome, 0) - oasNet,
    earnedWork: f.otherWork }
}
