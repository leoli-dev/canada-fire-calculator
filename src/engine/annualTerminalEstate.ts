import type { InputsV2, Provenance } from './model'
import type { AnnualState, YearRow } from './annualState'
import { isCanonicalGeneratedState } from './annualState'
import { anchorTaxRules, incomeTax, rulesForCalendarYear, taxRuleProvenance, type TaxRuleProvenance } from './tax'
import { terminalTax } from './terminalTax'
import { annualCpp } from './annualCpp'
import { annualHouseholdOas } from './annualOas'
import { mortgageAdd, mortgageDecimal, mortgageMultiply, mortgageSubtract, mortgageNegative, mortgageNumber, type MortgageDecimal } from './mortgageDecimal'

export interface TerminalHeldHomeEvidence {
  propertyId: string
  locatedInOntario: true
  ownerShares: Record<string, number>
  decedentShareEstateIncluded: true
  /** User modeling assumption, not an eligibility or filing determination. */
  wholeTerminalGainExcluded: true
  provenance: Provenance
}
export interface TerminalHeldHomeReceipt {
  propertyId: string; closingFairMarketValue: number; decedentShare: number; survivorShare: number
  estateIncludedFairMarketValue: number; excludedSurvivorFairMarketValue: number
  /** Whole-property nominal gain, only when canonical ACB is recorded. */
  excludedTerminalGain: number | null
  arithmetic: { closingFairMarketValue: MortgageDecimal; estateIncludedFairMarketValue: MortgageDecimal; excludedSurvivorFairMarketValue: MortgageDecimal }
  evidence: TerminalHeldHomeEvidence
}

export interface AnnualTerminalEstateEvidence {
  modeledDecedent?: 'self-only'
  survivingPersonId?: string
  noSurvivorProjection?: true
  provenance: Provenance
  effectiveYear: number
  personId: string
  timing: 'end-of-terminal-year'
  certificateRequired: true
  completeEstate: true
  noDeathBenefitsOrOtherTerminalIncome: true
  accounts: Record<string, { ownerId: string; estateIncluded: true; noBeneficiaryRollover: true; tfsaNoDeathIncome?: true }>
  heldHome?: TerminalHeldHomeEvidence
}
export type TerminalEstateEstimate =
  | { status: 'unavailable'; reason: 'evidence-missing' | 'evidence-invalid' | 'unsupported-estate' | 'tax-basis-unavailable' }
  | { status: 'estimated'; scope?: 'self-estate-only'; personId?: string; survivingPersonId?: string;
      excludedSurvivorClosingNetWorth?: number; householdClosingNetWorth?: number; closingNetWorth: number; closingRegisteredFairMarketValue: number;
      estateAdministrationTaxBase: number; incrementalFinalReturnIncomeTax: number;
      estateAdministrationTax: number; netEstate: number; evidence: AnnualTerminalEstateEvidence;
      heldHome?: TerminalHeldHomeReceipt;
      taxRules: TaxRuleProvenance; taxBasis: 'start-CPI-annual-return'; startCpi: number; endCpi: number }

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value))
const fields = (value: unknown, keys: string[]): value is Record<string, unknown> => record(value) && keys.every(key => own(value, key))
const safeMoney = (value: number) => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 100
/** Conversion may disclose representation dust, never lose a substantive
 * amount or a small positive interest. Title arithmetic itself is exact. */
function estateNumber(exact: MortgageDecimal): number {
  const value = mortgageNumber(exact)
  const error = mortgageSubtract(exact, mortgageDecimal(value))
  const absoluteError = mortgageNegative(error) ? mortgageSubtract(mortgageDecimal(0), error) : error
  if (!safeMoney(value) || value === 0 && exact.coefficient !== '0' ||
      mortgageNegative(mortgageSubtract(mortgageDecimal(Math.min(0.0001, value * 1e-8)), absoluteError))) throw new RangeError('unsafe estate arithmetic')
  return value
}

/** Estate-only composition. Ordinary mortgage/home settlement remains the
 * authority; malformed evidence can only make this memo unavailable.
 * Verified 2026-11-24: ITA 70(5)(a), 40(2)(b), CRA final-return capital gains
 * guidance, Ontario EAT Act 1 and 2(6.1). No survivorship/rollover inference. */
function terminalHeldHome(plan: InputsV2, state: AnnualState, row: YearRow, evidence: AnnualTerminalEstateEvidence,
  personId: string, survivorId: string): TerminalHeldHomeReceipt | 'unsupported-estate' | 'evidence-invalid' {
  const home = plan.properties[0]
  if (plan.properties.length !== 1 || home.kind !== 'principal' || home.sellAtAge !== null || home.plannedPurchaseAge !== null ||
      home.plannedDownPayment !== null || home.plannedMortgage !== null || home.annualHoldingCostChange !== 0 ||
      home.annualRent.status !== 'known' || home.annualRent.value !== 0 || plan.annualPrimaryHomeSaleEvidence !== undefined ||
      plan.annualPrimaryHomePurchaseEvidence !== undefined || state.primaryHomeSaleCash || state.primaryHomePurchase ||
      row.retirementSettlement?.primaryHomeSale || row.retirementSettlement?.primaryHomePurchase ||
      !own(state.byProperty, home.id) || !own(row.byProperty, home.id) || state.byProperty[home.id].held !== true ||
      row.byProperty[home.id].held !== true || state.byProperty[home.id].value !== row.byProperty[home.id].closing ||
      !safeMoney(row.byProperty[home.id].closing)) return 'unsupported-estate'
  // A historical loan is allowed only after actual scheduled discharge. No
  // epsilon forgiveness, including a one-cent lien or unexpired loan term.
  if (plan.debts.length > 1 || plan.debts.length === 0 && home.mortgageDebtId !== null ||
      plan.debts.some(debt => debt.kind !== 'mortgage' || debt.propertyId !== home.id || home.mortgageDebtId !== debt.id ||
        !own(state.byDebt, debt.id) || !own(row.byDebt, debt.id) || state.byDebt[debt.id].propertyId !== home.id ||
        row.byDebt[debt.id].propertyId !== home.id || state.byDebt[debt.id].principal !== 0 ||
        state.byDebt[debt.id].yearsRemaining !== 0 || row.byDebt[debt.id].closing !== 0)) return 'unsupported-estate'
  const proof = evidence.heldHome
  // Absent composition retains the pre-existing held-property refusal.
  if (proof === undefined) return 'unsupported-estate'
  const dated = (source: unknown) => fields(source, ['origin', 'sourceYear']) && source.origin === 'user' &&
    Number.isSafeInteger(source.sourceYear) && (source.sourceYear as number) >= 0 && (source.sourceYear as number) <= plan.baseYear &&
    (source.note === undefined || own(source, 'note') && typeof source.note === 'string')
  const recordedSource = (source: unknown) => fields(source, ['origin', 'sourceYear']) && ['user', 'legacy'].includes(source.origin as string) &&
    (source.sourceYear === null || Number.isSafeInteger(source.sourceYear) && (source.sourceYear as number) >= 0 && (source.sourceYear as number) <= plan.baseYear) &&
    (source.note === undefined || own(source, 'note') && typeof source.note === 'string')
  if (!own(evidence, 'heldHome') || !fields(proof, ['propertyId', 'locatedInOntario', 'ownerShares', 'decedentShareEstateIncluded', 'wholeTerminalGainExcluded', 'provenance']) ||
      proof.propertyId !== home.id || proof.locatedInOntario !== true || proof.decedentShareEstateIncluded !== true || proof.wholeTerminalGainExcluded !== true || !dated(proof.provenance) ||
      !record(proof.ownerShares) || !own(home, 'taxableOwnerShares') || !fields(home.taxableOwnerShares, ['status', 'shares']) || home.taxableOwnerShares.status !== 'known' ||
      !record(home.taxableOwnerShares.shares)) return 'evidence-invalid'
  if (!fields(home.provenance, ['value', 'taxableOwnerShares']) || !recordedSource(home.provenance.value) ||
      !recordedSource(home.provenance.taxableOwnerShares)) return 'evidence-invalid'
  const title = home.taxableOwnerShares.shares
  const ids = Object.keys(title)
  const totalShare = ids.reduce((sum, id) => mortgageAdd(sum, mortgageDecimal(title[id])), mortgageDecimal(0))
  if (!ids.length || ids.some(id => ![personId, survivorId].includes(id)) || Object.keys(proof.ownerShares).length !== ids.length ||
      ids.some(id => !own(proof.ownerShares, id) || proof.ownerShares[id] !== title[id] || !Number.isFinite(title[id]) || title[id] < 0 || title[id] > 1) ||
      !own(title, personId) || title[personId] <= 0 ||
      totalShare.coefficient !== '1' || totalShare.scale !== 0) return 'evidence-invalid'
  const fmv = row.byProperty[home.id].closing
  const selfValue = mortgageMultiply(mortgageDecimal(fmv), mortgageDecimal(title[personId]))
  const survivorShare = own(title, survivorId) ? title[survivorId] : 0
  const survivorValue = mortgageMultiply(mortgageDecimal(fmv), mortgageDecimal(survivorShare))
  if (mortgageSubtract(mortgageAdd(selfValue, survivorValue), mortgageDecimal(fmv)).coefficient !== '0') return 'evidence-invalid'
  const acb = state.byProperty[home.id].acb
  const acbSource = home.provenance.acb
  const recordedAcb = home.acb.status === 'known' && acb.status === 'known' && acb.value === home.acb.value && safeMoney(acb.value) &&
    own(home.provenance, 'acb') && recordedSource(acbSource)
  return { propertyId: home.id, closingFairMarketValue: fmv, decedentShare: title[personId], survivorShare,
    estateIncludedFairMarketValue: estateNumber(selfValue), excludedSurvivorFairMarketValue: estateNumber(survivorValue),
    excludedTerminalGain: recordedAcb && acb.status === 'known' ? fmv >= acb.value ? estateNumber(mortgageSubtract(mortgageDecimal(fmv), mortgageDecimal(acb.value))) : null : null,
    arithmetic: { closingFairMarketValue: mortgageDecimal(fmv), estateIncludedFairMarketValue: selfValue, excludedSurvivorFairMarketValue: survivorValue },
    evidence: structuredClone(proof) }
}

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

/** Estate-only passport checks. Never feed these stricter evidence gates back
 * into ordinary annual pricing: a settled zero receipt is not proof of absence. */
function householdTerminalBenefitsSupported(plan: InputsV2, row: YearRow): boolean {
  const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  const dated = (value: unknown) => record(value) && own(value, 'origin') && value.origin === 'user' && own(value, 'sourceYear') &&
    Number.isSafeInteger(value.sourceYear) && (value.sourceYear as number) >= 0 && (value.sourceYear as number) <= plan.baseYear && (value.note === undefined || typeof value.note === 'string')
  const excluded = (value: unknown) => record(value) && ['status', 'reason', 'provenance'].every(key => own(value, key)) &&
    ['excluded', 'not-applicable'].includes(value.status as string) && typeof value.reason === 'string' && !!value.reason.trim() && dated(value.provenance)
  try {
    // A positive eligibility record contradicts the explicit zero OAS/GIS
    // passport even when the ordinary household path does not price GIS.
    if (plan.annualGisEvidence !== undefined && (!own(plan, 'annualGisEvidence') || !record(plan.annualGisEvidence) || Reflect.ownKeys(plan.annualGisEvidence).length !== 0)) return false
    const benefits = plan.annualBenefitsEvidence
    if (benefits !== undefined && (!record(benefits) || Object.keys(benefits).length !== plan.people.length)) return false
    for (const person of plan.people) {
      for (const field of ['cppAmountSource', 'oasAmountSource'] as const) {
        const proof = person[field]
        if (!own(person, field) || !record(proof) || !['source', 'sourceYear', 'basis', 'dollarBasis', 'ageBasis'].every(key => own(proof, key)) ||
            !['manual', 'statement'].includes(proof.source) || !Number.isSafeInteger(proof.sourceYear) || proof.sourceYear! < 0 || proof.sourceYear! > plan.baseYear ||
            !['annual', 'monthly'].includes(proof.basis) || proof.dollarBasis !== 'today' ||
            !(proof.ageBasis === null || Number.isInteger(proof.ageBasis) && proof.ageBasis >= (field === 'cppAmountSource' ? 60 : 65) && proof.ageBasis <= 70) ||
            proof.premisesNeedReview !== undefined && (!own(proof, 'premisesNeedReview') || proof.premisesNeedReview !== false) ||
            proof.premises !== undefined && (!own(proof, 'premises') || !record(proof.premises) || !own(proof.premises, 'retirementAge') || !Number.isSafeInteger(proof.premises.retirementAge) ||
              [proof.premises.startWorkAge, proof.premises.avgEarningsRatio, proof.premises.residenceYearsBy65].some(value => value !== undefined && (typeof value !== 'number' || !Number.isFinite(value)))) ||
            proof.source === 'statement' && proof.premises?.retirementAge !== person.retirementAge) return false
      }
      // Reuse the ordinary CPP statement/premise validator, including zeros.
      if (annualCpp(plan, person, row.byPerson[person.id].age).amountReal !== 0) return false
      if (benefits !== undefined) {
        const proof = benefits[person.id]
        if (!own(benefits, person.id) || !record(proof) || !(['gis', 'allowance', 'otherBenefits'] as const).every(key => own(proof, key) && excluded(proof[key]))) return false
        const oas = annualHouseholdOas(plan, person, row.byPerson[person.id].age)
        if (oas.grossReal !== 0 || oas.netReal !== 0 || oas.recoveryReal !== 0) return false
      }
    }
    return true
  } catch { return false }
}

/** Internal receipt builder: called exclusively by the authenticated continuous
 * runner after a committed working prefix and a successful terminal retirement
 * settlement. Never mutates annual cash, accounts, or affordability. */
export function annualTerminalEstate(plan: InputsV2, state: AnnualState, row: YearRow): TerminalEstateEstimate {
  const unavailable = (reason: Extract<TerminalEstateEstimate, { status: 'unavailable' }>['reason']): TerminalEstateEstimate => ({ status: 'unavailable', reason })
  try {
    const household = plan.people.length === 2
    const person = household ? plan.people.find(p => p.role === 'self')! : plan.people[0]
    const survivor = household ? plan.people.find(p => p.role === 'partner') : undefined
    const working = row.workingSettlement
    const settlement = household ? working : row.retirementSettlement
    const accounts = household ? plan.accounts.filter(a => a.ownerId === person.id) : plan.accounts
    const annual = row.byPerson[person.id]
    const verifiedExclusion = (e: unknown): boolean => {
      if (!e || typeof e !== 'object' || Array.isArray(e)) return false
      const fact = e as { status?: string; reason?: string; provenance?: Provenance }
      return ['excluded', 'not-applicable'].includes(fact.status ?? '') && typeof fact.reason === 'string' && !!fact.reason.trim() &&
        fact.provenance?.origin === 'user' && Number.isSafeInteger(fact.provenance.sourceYear) && fact.provenance.sourceYear! >= 0 && fact.provenance.sourceYear! <= plan.baseYear
    }
    const soloSettlement = row.retirementSettlement
    const zeroOas = !soloSettlement?.oas || soloSettlement.oas.grossReal === 0 && soloSettlement.oas.netReal === 0 && soloSettlement.oas.recoveryReal === 0 &&
      [soloSettlement.oas.evidence.gis, soloSettlement.oas.evidence.allowance, soloSettlement.oas.evidence.otherBenefits].every(verifiedExclusion)
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
    const evidence = plan.annualTerminalEstateEvidence?.[row.year]
    const heldHomeOptIn = record(evidence) && own(evidence, 'heldHome')
    if (!isCanonicalGeneratedState(plan, state) || ![1, 2].includes(plan.people.length) || plan.province !== 'ON' || !settlement || state.year !== row.year + 1 ||
        row.year !== plan.baseYear + plan.lifeExpectancy - person.ageInBaseYear ||
        ((!household || !plan.properties.length) && plan.debts.length) || (plan.properties.length && (!household || !heldHomeOptIn)) || plan.dependents.length ||
        state.rrifConversions && Object.keys(state.rrifConversions).length ||
        person.cppAnnualAt65 !== 0 || person.oasAnnualAt65 !== 0 || person.pensionAnnual !== 0 || person.pension || person.cppWork ||
        outsideIncome || !zeroOas || !household && annual.income !== 0 || annual.earnedIncome !== 0 || annual.benefits !== 0 ||
        [annual.cpp, annual.oasGross, annual.oasNet, annual.oasRecovery, annual.gis].some(amount => amount !== undefined && amount !== 0) ||
        soloSettlement?.cpp && soloSettlement.cpp.amountReal !== 0 || soloSettlement?.gis || soloSettlement?.rrif ||
        plan.accounts.some(a => !['tfsa', 'rrsp'].includes(a.kind) || (!household && a.ownerId !== person.id || household && !plan.people.some(p => p.id === a.ownerId)) || a.jurisdiction || a.accessibleAge !== undefined ||
          state.byAccount[a.id].kind !== a.kind || row.byAccount[a.id].ownerId !== a.ownerId)) return unavailable('unsupported-estate')
    if (household) {
      const support = plan.taxProfile?.spouseSupported
      if (!householdTerminalBenefitsSupported(plan, row) || !survivor || person.id === survivor.id || !working || !('household' in working) ||
          working.household.phase !== 'both-retired' || !row.householdWithdrawalSettlement ||
          !support || !Object.prototype.hasOwnProperty.call(support, 'value') || support.status !== 'known' || support.value !== false || plan.taxProfile?.pensionSplit ||
          plan.people.some(p => p.cppAnnualAt65 !== 0 || p.oasAnnualAt65 !== 0 || p.pensionAnnual !== 0 || p.pension || p.cppWork ||
            row.byPerson[p.id].earnedIncome !== 0 || row.byPerson[p.id].benefits !== 0 ||
            [row.byPerson[p.id].cpp, row.byPerson[p.id].oasGross, row.byPerson[p.id].oasNet, row.byPerson[p.id].oasRecovery, row.byPerson[p.id].gis].some(n => n !== undefined && n !== 0)) ||
          plan.accounts.some(a => a.rrifFactorCategory !== undefined && (a.rrifFactorCategory?.status !== 'unknown' || !a.rrifFactorCategory.reason?.trim()) || a.rrifAgeElection != null || a.taxableOwnerShares.status !== 'known' || Object.keys(a.taxableOwnerShares.shares).length !== 1 || a.taxableOwnerShares.shares[a.ownerId!] !== 1) ||
          plan.people.some(p => {
            const posted = (row.householdWithdrawalSettlement?.postings ?? []).filter(a => a.ownerId === p.id && a.kind === 'rrsp').reduce((sum, a) => sum + a.amount, 0)
            return row.byPerson[p.id].income !== 0 || Math.abs(row.byPerson[p.id].taxableIncome - posted) > 0.005
          })) return unavailable('unsupported-estate')
    }
    if (evidence === undefined) return unavailable('evidence-missing')
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return unavailable('evidence-invalid')
    const p = evidence.provenance
    if (!own(plan.annualTerminalEstateEvidence!, String(row.year)) || !p || !own(evidence, 'provenance') ||
        !own(p, 'origin') || p.origin !== 'user' || !own(p, 'sourceYear') || !Number.isInteger(p.sourceYear) || p.sourceYear! < 0 || p.sourceYear! > plan.baseYear ||
        p.note !== undefined && typeof p.note !== 'string' || evidence.effectiveYear !== row.year || evidence.personId !== person.id ||
        evidence.timing !== 'end-of-terminal-year' || evidence.certificateRequired !== true || evidence.completeEstate !== true ||
        !own(evidence, 'noDeathBenefitsOrOtherTerminalIncome') || evidence.noDeathBenefitsOrOtherTerminalIncome !== true ||
        !own(evidence, 'accounts') || !evidence.accounts || typeof evidence.accounts !== 'object' || Array.isArray(evidence.accounts) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(evidence.accounts)) || Object.keys(evidence.accounts).length !== accounts.length ||
        accounts.some(a => !own(evidence.accounts, a.id) || evidence.accounts[a.id]?.ownerId !== person.id ||
          evidence.accounts[a.id].estateIncluded !== true || evidence.accounts[a.id].noBeneficiaryRollover !== true ||
          a.kind === 'tfsa' && evidence.accounts[a.id].tfsaNoDeathIncome !== true)) return unavailable('evidence-invalid')
    if (household && (['effectiveYear', 'personId', 'timing', 'certificateRequired', 'completeEstate'].some(key => !own(evidence, key)) ||
        accounts.some(a => { const proof = evidence.accounts[a.id]; return !proof || typeof proof !== 'object' || Array.isArray(proof) ||
          ['ownerId', 'estateIncluded', 'noBeneficiaryRollover', ...(a.kind === 'tfsa' ? ['tfsaNoDeathIncome'] : [])].some(key => !own(proof, key)) }) ||
        !own(evidence, 'modeledDecedent') || evidence.modeledDecedent !== 'self-only' ||
        !own(evidence, 'survivingPersonId') || evidence.survivingPersonId !== survivor!.id ||
        !own(evidence, 'noSurvivorProjection') || evidence.noSurvivorProjection !== true)) return unavailable('evidence-invalid')
    let heldHome: TerminalHeldHomeReceipt | undefined
    if (household && plan.properties.length) {
      const receipt = terminalHeldHome(plan, state, row, evidence, person.id, survivor!.id)
      if (typeof receipt === 'string') return unavailable(receipt)
      heldHome = receipt
    } else if (household && evidence.heldHome !== undefined) return unavailable('evidence-invalid')
    const startCpi = settlement.startCpi
    const endCpi = startCpi * (1 + plan.inflation)
    const rules = rulesForCalendarYear(anchorTaxRules('ON'), row.year)
    const taxRules = taxRuleProvenance(rules)
    const credits = { age: annual.age, pensionIncome: 0, provincialPensionIncome: 0 }
    if (!Number.isFinite(startCpi) || startCpi <= 0 || !Number.isFinite(endCpi) || endCpi <= 0 ||
        taxRules.rulePackId !== settlement.taxRules.rulePackId || taxRules.ruleYear !== settlement.taxRules.ruleYear ||
        Math.abs(incomeTax(annual.taxableIncome / startCpi, 'ON', credits, rules) * startCpi - annual.tax) > 0.005) return unavailable('tax-basis-unavailable')
    const sumClosing = (owned: typeof accounts, homeValue?: MortgageDecimal) => heldHome
      ? estateNumber(owned.reduce((sum, account) => mortgageAdd(sum, mortgageDecimal(row.byAccount[account.id].closing)), homeValue ?? mortgageDecimal(0)))
      : owned.reduce((sum, account) => sum + row.byAccount[account.id].closing, 0)
    const closingNetWorth = sumClosing(accounts, heldHome?.arithmetic.estateIncludedFairMarketValue)
    const closingRegisteredFairMarketValue = accounts.filter(a => a.kind === 'rrsp').reduce((s, a) => s + row.byAccount[a.id].closing, 0)
    const incrementalFinalReturnIncomeTax = terminalTax({ province: 'ON', people: [{ taxableIncome: annual.taxableIncome / startCpi, credits }], remainingRegistered: closingRegisteredFairMarketValue / startCpi, nonRegisteredGain: 0, investmentPropertyGain: 0, rules }).incrementalTax * startCpi
    const estateAdministrationTax = ontarioEstateAdministrationTax(closingNetWorth)
    const netEstate = closingNetWorth - incrementalFinalReturnIncomeTax - estateAdministrationTax
    if (![closingNetWorth, closingRegisteredFairMarketValue, incrementalFinalReturnIncomeTax, netEstate].every(Number.isFinite)) return unavailable('tax-basis-unavailable')
    // Account-only estates retain their original ledger-key reduction order.
    // Integer-like IDs need not enumerate in plan account order.
    const householdClosingNetWorth = heldHome ? sumClosing(plan.accounts, heldHome.arithmetic.closingFairMarketValue)
      : Object.values(row.byAccount).reduce((sum, account) => sum + account.closing, 0)
    return { status: 'estimated', ...(heldHome ? { heldHome } : {}), ...(household ? { scope: 'self-estate-only' as const, personId: person.id, survivingPersonId: survivor!.id, excludedSurvivorClosingNetWorth: sumClosing(plan.accounts.filter(a => a.ownerId === survivor!.id), heldHome?.arithmetic.excludedSurvivorFairMarketValue), householdClosingNetWorth } : {}), closingNetWorth, closingRegisteredFairMarketValue, estateAdministrationTaxBase: closingNetWorth,
      incrementalFinalReturnIncomeTax, estateAdministrationTax, netEstate, evidence: structuredClone(evidence), taxRules,
      taxBasis: 'start-CPI-annual-return', startCpi, endCpi }
  } catch { return unavailable('evidence-invalid') }
}
