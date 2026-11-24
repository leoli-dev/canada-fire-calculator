import type { InputsV2, Provenance } from './model'
import type { AnnualState, YearRow } from './annualState'
import { isCanonicalGeneratedState } from './annualState'
import { anchorTaxRules, incomeTax, rulesForCalendarYear, taxRuleProvenance, type TaxRuleProvenance } from './tax'
import { terminalTax } from './terminalTax'

export interface AnnualTerminalEstateEvidence {
  provenance: Provenance
  effectiveYear: number
  personId: string
  timing: 'end-of-terminal-year'
  certificateRequired: true
  completeEstate: true
  noDeathBenefitsOrOtherTerminalIncome: true
  accounts: Record<string, { ownerId: string; estateIncluded: true; noBeneficiaryRollover: true; tfsaNoDeathIncome?: true }>
}
export type TerminalEstateEstimate =
  | { status: 'unavailable'; reason: 'evidence-missing' | 'evidence-invalid' | 'unsupported-estate' | 'tax-basis-unavailable' }
  | { status: 'estimated'; closingNetWorth: number; closingRegisteredFairMarketValue: number;
      estateAdministrationTaxBase: number; incrementalFinalReturnIncomeTax: number;
      estateAdministrationTax: number; netEstate: number; evidence: AnnualTerminalEstateEvidence;
      taxRules: TaxRuleProvenance; taxBasis: 'start-CPI-annual-return'; startCpi: number; endCpi: number }

/** Pinned 2020+ Ontario certificate schedule, verified 2026-11-24.
 * https://www.ontario.ca/page/estate-administration-tax
 * Gross nominal certified estate value, BEFORE final-return income tax.
 * Deliberately separate from the legacy continuous probateTax approximation. */
export function ontarioEstateAdministrationTax(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 100) throw new RangeError('unsafe estate value')
  // Snap only representation dust at a statutory thousand-dollar boundary;
  // never round to dollars or cents (a real one-cent excess is taxable).
  const boundary = Math.round(value / 1_000) * 1_000
  const priced = Math.abs(value - boundary) <= Math.min(0.004, 4 * Number.EPSILON * Math.max(1, value)) ? boundary : value
  return priced <= 50_000 ? 0 : 15 * Math.ceil((priced - 50_000) / 1_000)
}

/** Internal receipt builder: called exclusively by the authenticated continuous
 * runner after a committed working prefix and a successful terminal retirement
 * settlement. Never mutates annual cash, accounts, or affordability. */
export function annualTerminalEstate(plan: InputsV2, state: AnnualState, row: YearRow): TerminalEstateEstimate {
  const unavailable = (reason: Extract<TerminalEstateEstimate, { status: 'unavailable' }>['reason']): TerminalEstateEstimate => ({ status: 'unavailable', reason })
  try {
    const person = plan.people[0]
    const settlement = row.retirementSettlement
    const annual = row.byPerson[person.id]
    const verifiedExclusion = (e: unknown): boolean => {
      if (!e || typeof e !== 'object' || Array.isArray(e)) return false
      const fact = e as { status?: string; reason?: string; provenance?: Provenance }
      return ['excluded', 'not-applicable'].includes(fact.status ?? '') && typeof fact.reason === 'string' && !!fact.reason.trim() &&
        fact.provenance?.origin === 'user' && Number.isSafeInteger(fact.provenance.sourceYear) && fact.provenance.sourceYear! >= 0 && fact.provenance.sourceYear! <= plan.baseYear
    }
    const zeroOas = !settlement?.oas || settlement.oas.grossReal === 0 && settlement.oas.netReal === 0 && settlement.oas.recoveryReal === 0 &&
      [settlement.oas.evidence.gis, settlement.oas.evidence.allowance, settlement.oas.evidence.otherBenefits].every(verifiedExclusion)
    // A historical ordinary source can remain in the plan. The annual runner
    // still owns every earlier year's activity/funding gates; this does not
    // introduce an income source into the final return.
    const outsideIncome = plan.incomeSources.some(s => {
      if (s.annualAmount.status === 'known' && s.annualAmount.value === 0) return false
      return !(s.kind === 'other' && s.recipientId === person.id && s.annualAmount.status === 'known' &&
        Number.isFinite(s.annualAmount.value) && s.annualAmount.value >= 0 &&
        Number.isSafeInteger(s.toAge) && s.toAge! >= 0 && s.toAge! < annual.age &&
        [s.fromAge, s.startAge].every(age => age === undefined || Number.isSafeInteger(age) && age >= 0 && age <= s.toAge!) &&
        s.provenance.origin === 'user' && Number.isSafeInteger(s.provenance.sourceYear) && s.provenance.sourceYear! >= 0 && s.provenance.sourceYear! <= plan.baseYear)
    })
    if (!isCanonicalGeneratedState(plan, state) || plan.people.length !== 1 || plan.province !== 'ON' || !settlement || state.year !== row.year + 1 ||
        row.year !== plan.baseYear + plan.lifeExpectancy - person.ageInBaseYear ||
        plan.debts.length || plan.properties.length || plan.dependents.length ||
        state.rrifConversions && Object.keys(state.rrifConversions).length ||
        person.cppAnnualAt65 !== 0 || person.oasAnnualAt65 !== 0 || person.pensionAnnual !== 0 || person.pension || person.cppWork ||
        outsideIncome || !zeroOas || annual.income !== 0 || annual.earnedIncome !== 0 || annual.benefits !== 0 ||
        [annual.cpp, annual.oasGross, annual.oasNet, annual.oasRecovery, annual.gis].some(amount => amount !== undefined && amount !== 0) ||
        settlement.cpp && settlement.cpp.amountReal !== 0 || settlement.gis || settlement.rrif ||
        plan.accounts.some(a => !['tfsa', 'rrsp'].includes(a.kind) || a.ownerId !== person.id || a.jurisdiction || a.accessibleAge !== undefined ||
          state.byAccount[a.id].kind !== a.kind || row.byAccount[a.id].ownerId !== person.id)) return unavailable('unsupported-estate')
    const evidence = plan.annualTerminalEstateEvidence?.[row.year]
    if (evidence === undefined) return unavailable('evidence-missing')
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return unavailable('evidence-invalid')
    const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key)
    const p = evidence.provenance
    if (!own(plan.annualTerminalEstateEvidence!, String(row.year)) || !p || !own(evidence, 'provenance') ||
        !own(p, 'origin') || p.origin !== 'user' || !own(p, 'sourceYear') || !Number.isInteger(p.sourceYear) || p.sourceYear! < 0 || p.sourceYear! > plan.baseYear ||
        p.note !== undefined && typeof p.note !== 'string' || evidence.effectiveYear !== row.year || evidence.personId !== person.id ||
        evidence.timing !== 'end-of-terminal-year' || evidence.certificateRequired !== true || evidence.completeEstate !== true ||
        !own(evidence, 'noDeathBenefitsOrOtherTerminalIncome') || evidence.noDeathBenefitsOrOtherTerminalIncome !== true ||
        !own(evidence, 'accounts') || !evidence.accounts || typeof evidence.accounts !== 'object' || Array.isArray(evidence.accounts) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(evidence.accounts)) || Object.keys(evidence.accounts).length !== plan.accounts.length ||
        plan.accounts.some(a => !own(evidence.accounts, a.id) || evidence.accounts[a.id]?.ownerId !== person.id ||
          evidence.accounts[a.id].estateIncluded !== true || evidence.accounts[a.id].noBeneficiaryRollover !== true ||
          a.kind === 'tfsa' && evidence.accounts[a.id].tfsaNoDeathIncome !== true)) return unavailable('evidence-invalid')
    const startCpi = settlement.startCpi
    const endCpi = startCpi * (1 + plan.inflation)
    const rules = rulesForCalendarYear(anchorTaxRules('ON'), row.year)
    const taxRules = taxRuleProvenance(rules)
    const credits = { age: annual.age, pensionIncome: 0, provincialPensionIncome: 0 }
    if (!Number.isFinite(startCpi) || startCpi <= 0 || !Number.isFinite(endCpi) || endCpi <= 0 ||
        taxRules.rulePackId !== settlement.taxRules.rulePackId || taxRules.ruleYear !== settlement.taxRules.ruleYear ||
        Math.abs(incomeTax(annual.taxableIncome / startCpi, 'ON', credits, rules) * startCpi - annual.tax) > 0.005) return unavailable('tax-basis-unavailable')
    const closingNetWorth = Object.values(row.byAccount).reduce((s, a) => s + a.closing, 0)
    const closingRegisteredFairMarketValue = plan.accounts.filter(a => a.kind === 'rrsp').reduce((s, a) => s + row.byAccount[a.id].closing, 0)
    const incrementalFinalReturnIncomeTax = terminalTax({ province: 'ON', people: [{ taxableIncome: annual.taxableIncome / startCpi, credits }], remainingRegistered: closingRegisteredFairMarketValue / startCpi, nonRegisteredGain: 0, investmentPropertyGain: 0, rules }).incrementalTax * startCpi
    const estateAdministrationTax = ontarioEstateAdministrationTax(closingNetWorth)
    const netEstate = closingNetWorth - incrementalFinalReturnIncomeTax - estateAdministrationTax
    if (![closingNetWorth, closingRegisteredFairMarketValue, incrementalFinalReturnIncomeTax, netEstate].every(Number.isFinite)) return unavailable('tax-basis-unavailable')
    return { status: 'estimated', closingNetWorth, closingRegisteredFairMarketValue, estateAdministrationTaxBase: closingNetWorth,
      incrementalFinalReturnIncomeTax, estateAdministrationTax, netEstate, evidence: structuredClone(evidence), taxRules,
      taxBasis: 'start-CPI-annual-return', startCpi, endCpi }
  } catch { return unavailable('evidence-invalid') }
}
