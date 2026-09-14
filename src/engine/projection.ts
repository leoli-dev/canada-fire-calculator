import {
  ACCOUNT_TYPES,
  type AccountType,
  type Inputs,
  type Phase,
  type ProjectionResult,
  type Strategy,
  type TaxBySource,
  type YearRow,
} from './types'
import { incomeTax, probateTax } from './tax'
import { CAPITAL_GAINS_INCLUSION, FEDERAL, PROVINCIAL } from './taxData'
import { terminalTax, type TerminalTaxPerson } from './terminalTax'
import {
  OAS_CLAWBACK_THRESHOLD,
  basisAnnualAmount,
  benefitIncomeBasis,
  ccbAnnual,
  oasAfterClawback,
  type BenefitBasis,
} from './benefits'
import { inputsCppAnnual, inputsOasAnnual } from './pensionProvenance'
import { minimumForRrif, rrifMinFactor } from './rrif'
import type { InputsV2 } from './model'
import { openingSpousalAttributionLedger, type SpousalAttributionLedger } from './spousalAttribution'
import { personProjectionTax } from './personProjectionTax'
import { pensionPaid } from './pensionPaid'
export { pensionPaid } from './pensionPaid'
import { buildDebtStream, impliedRate, releasedMortgagePayment, yearStartSale } from './debts'
import { allocateContributions, planAnnualHousingFunding, planPurchaseFunding, reconcileMortgagePayment, type FundingGap } from './funding'
import { disposeHolding, nominalFactor, toNominal, toReal } from './capitalGains'

/** Per-year, per-account return override; default uses inputs.returns. */
export type ReturnSampler = (age: number, account: AccountType) => number

/**
 * Employer pension paid at a given age: the lifetime annuity plus the bridge
 * benefit (which ends at 65), in today's dollars. A partially-indexed pension
 * loses real value every payment year: its nominal amount grows at only
 * indexation × CPI, so in this real-dollar frame it shrinks by the gap.
 */
/**
 * BE-39 A. The current retirement age of each person in the plan. The canonical
 * model stores one `retirementAge` per person; when it is not available this
 * falls back to the legacy `fireAge`, and to the age the partner has reached
 * when the primary retires (the same relation the canonical migration records).
 * This is the age the CPP/QPP early-claim dilution relief is computed from, so
 * both the cash projection and the personal tax ledger use one answer.
 */
function retirementAgeFor(inputs: Inputs, canonical?: InputsV2): (role: 'self' | 'partner') => number {
  return (role) => {
    if (canonical) {
      const person = canonical.people.find(item => item.role === role)
      if (person) return person.retirementAge
    }
    return role === 'self'
      ? inputs.fireAge
      : (inputs.partner?.currentAge ?? inputs.currentAge) + (inputs.fireAge - inputs.currentAge)
  }
}

/** Annual tax context for a withdrawal whose cash must exist at year start. */
function purchaseTaxIncrement(inputs: Inputs, age: number, rent: number, canonical?: InputsV2): (taxable: number, rrspGross: number) => number {
  const partnerAge = inputs.partner ? inputs.partner.currentAge + age - inputs.currentAge : null
  const ages = partnerAge === null ? [age] : [age, partnerAge]
  const retirementAge = retirementAgeFor(inputs, canonical)
  // BE-39 A: one shared formula, and the current retirement age for the relief.
  const cppFor = (person: Inputs | NonNullable<Inputs['partner']>, role: 'self' | 'partner') =>
    inputsCppAnnual(person, person.cppStartAge, inputs.province, retirementAge(role))
  const cpp = (age >= inputs.cppStartAge ? cppFor(inputs, 'self') : 0) +
    (inputs.partner && partnerAge !== null && partnerAge >= inputs.partner.cppStartAge
      ? cppFor(inputs.partner, 'partner') : 0)
  const pension = pensionPaid(inputs.pension, age, inputs.inflation ?? 0.021) +
    (inputs.partner && partnerAge !== null ? pensionPaid(inputs.partner.pension, partnerAge, inputs.inflation ?? 0.021) : 0)
  const oasGross = [age >= inputs.oasStartAge
    ? inputsOasAnnual(inputs, inputs.oasStartAge) * (age >= 75 ? 1.1 : 1) : 0]
  if (inputs.partner && partnerAge !== null) oasGross.push(partnerAge >= inputs.partner.oasStartAge
    ? inputsOasAnnual(inputs.partner, inputs.partner.oasStartAge) * (partnerAge >= 75 ? 1.1 : 1) : 0)
  const ei = inputs.extraIncome
  const extraIncome = ei && age >= Math.max(ei.fromAge, inputs.fireAge) && age <= ei.toAge ? ei.annual : 0
  const totalTax = (purchaseTaxable: number, rrspGross: number) => {
    const share = (cpp + pension + rent + purchaseTaxable) / ages.length
    return ages.reduce((sum, personAge, i) => {
      const personTaxable = share + (i === 0 ? extraIncome : 0)
      const oas = oasAfterClawback(oasGross[i], personTaxable)
      return sum + incomeTax(personTaxable + oas, inputs.province, {
        age: personAge,
        pensionIncome: pension / ages.length + (personAge >= 65 ? rrspGross / ages.length : 0),
      })
    }, 0)
  }
  const base = totalTax(0, 0)
  return (taxable, rrspGross) => Math.max(0, totalTax(taxable, rrspGross) - base)
}

/** Fallback funding order once the strategy's planned RRSP draw is taken. */
const STRATEGY_ORDER: Record<Strategy, AccountType[]> = {
  meltdownPaced: ['nonReg', 'tfsa', 'rrsp'],
  rrspFirst: ['rrsp', 'nonReg', 'tfsa'],
  nonRegFirst: ['nonReg', 'rrsp', 'tfsa'],
  tfsaFirst: ['tfsa', 'nonReg', 'rrsp'],
}

interface WithdrawalOutcome {
  withdrawals: Record<AccountType, number>
  tax: number
  taxablePerPerson?: number
  /** portion of the year's tax attributable to RRSP/RRIF withdrawals */
  rrspTax: number
  oasNet: number
  /** GIS received (tax-free, income-tested on taxable income excl. OAS) */
  gis: number
  /** The basis the GIS/Allowance were priced from (BE-26 A). */
  gisBasis?: Extract<BenefitBasis, { status: 'modeled' }>
  /** CCB received (tax-free, income-tested on taxable income incl. OAS) */
  ccb: number
  netCash: number
  taxPeople: TerminalTaxPerson[]
  byPersonTax?: YearRow['byPersonTax']
  taxUnsupportedReason?: string
  /** The year's post-payment spousal attribution state, for the next year. */
  spousalAttribution?: SpousalAttributionLedger
}

/**
 * Distribute a total gross withdrawal G across accounts (RRIF minimum first,
 * then along the configured order) and compute the resulting after-tax cash.
 *
 * Household mode splits taxable income equally between spouses (approximates
 * ideal income splitting via spousal RRSPs / pension splitting); OAS clawback
 * is applied per person on their share.
 */
export interface Step {
  account: AccountType
  /** cumulative ceiling on this account's withdrawal for the year */
  cap?: number
}

function evaluate(
  G: number,
  balances: Record<AccountType, number>,
  forcedRrsp: number,
  gainFraction: number,
  cpp: number,
  pension: number,
  oasGrossPerPerson: number[],
  agesPerPerson: number[],
  extraTaxable: number,
  nonRegDistributions: number,
  rent: number,
  extraIncome: number,
  nUnder6: number,
  n6to17: number,
  steps: Step[],
  inputs: Inputs,
  prepaidPurchaseTax: number,
  purchaseRrspWithdrawal: number,
  purchaseNonRegTaxable: number,
  propertySaleTaxable: number,
  canonical?: InputsV2,
  taxYear?: number,
  spousalAttribution?: SpousalAttributionLedger,
): WithdrawalOutcome {
  const w: Record<AccountType, number> = { tfsa: 0, rrsp: 0, nonReg: 0 }
  let remaining = G

  const fromRrif = Math.min(remaining, forcedRrsp)
  w.rrsp += fromRrif
  remaining -= fromRrif

  for (const s of steps) {
    let capacity = balances[s.account] - w[s.account]
    if (s.cap !== undefined) capacity = Math.min(capacity, Math.max(0, s.cap - w[s.account]))
    const take = Math.min(remaining, capacity)
    w[s.account] += take
    remaining -= take
    if (remaining <= 0) break
  }

  const persons = oasGrossPerPerson.length
  // extraTaxable is taxable but not cash-in-hand (reinvested distributions,
  // sale gains whose proceeds land in non-registered); rent is both taxable
  // and spendable, and splits like any jointly-held asset. extraIncome
  // (Barista/side income) cannot: employment-type income is taxed entirely
  // on whoever earned it — pension splitting and spousal RRSPs don't apply
  // to it — so it's attributed in full to person 0 instead of pooled.
  // employer pension pools like the rest: RPP annuities are splittable at
  // any age federally (Quebec's provincial 65+ rule is a known simplification)
  const pooledTaxable =
    cpp + pension + extraTaxable + rent + w.rrsp +
    w.nonReg * gainFraction * CAPITAL_GAINS_INCLUSION
  const share = pooledTaxable / persons
  let oasNet = 0
  let tax = 0
  const taxPeople: TerminalTaxPerson[] = []
  for (let i = 0; i < persons; i++) {
    const personExtra = i === 0 ? extraIncome : 0
    const personTaxable = share + personExtra
    const personOas = oasAfterClawback(oasGrossPerPerson[i], personTaxable)
    oasNet += personOas
    // eligible pension income: employer RPP annuities at any age; RRIF
    // withdrawals only at 65+
    const pensionIncome =
      pension / persons + (agesPerPerson[i] >= 65 ? (w.rrsp + purchaseRrspWithdrawal) / persons : 0)
    const credits = {
      age: agesPerPerson[i],
      pensionIncome,
    }
    const taxableIncome = personTaxable + personOas
    taxPeople.push({ taxableIncome, credits, oasGross: oasGrossPerPerson[i], oasNet: personOas })
    tax += incomeTax(taxableIncome, inputs.province, credits)
  }
  // GIS: requires receiving OAS; income test is on combined household income
  // excl. OAS (TFSA withdrawals are invisible to it; work income gets an
  // exemption) — a couple's GIS eligibility is assessed on family income
  // regardless of which spouse earned what. BE-26 A: the household category
  // (single / both pensioners / one pensioner with an Allowance spouse / one
  // pensioner whose spouse has neither) picks both the maximum and the
  // cut-off, and the Allowance is computed inside that same category rather
  // than added from a household-wide helper.
  const receivingOas = oasGrossPerPerson.map((o) => o > 0)
  const gisIncome = pooledTaxable + extraIncome
  // One classification decides the row, the amount and the Allowance in pay.
  // The projection always has both spouses' ages and OAS flags, so the only
  // non-modelled outcome here is `none` (nobody draws OAS, so neither the GIS
  // nor the Allowance is payable) — a real zero, via `basisAnnualAmount`.
  const legacyBasis = benefitIncomeBasis(receivingOas, agesPerPerson, gisIncome, {
    workIncome: extraIncome,
  })
  const gis = basisAnnualAmount(legacyBasis)
  // CCB's AFNI approximation, unlike GIS, includes OAS
  const totalTaxable = pooledTaxable + extraIncome + oasNet
  const ccb = ccbAnnual(nUnder6, n6to17, totalTaxable)
  let netCash =
    cpp + pension + oasNet + gis + ccb + rent + extraIncome + w.tfsa + w.rrsp + w.nonReg - tax + prepaidPurchaseTax
  let rrspTax = totalTaxable > 0 ? tax * (w.rrsp / totalTaxable) : 0
  let taxablePerPerson = totalTaxable / persons
  if (canonical && taxYear !== undefined) {
    const person = personProjectionTax({ plan: canonical, inputs, year: taxYear,
      selfAge: agesPerPerson[0], withdrawals: w, registeredBalance: balances.rrsp,
      nonRegGainFraction: gainFraction,
      nonRegDistributions, rent, otherWork: extraIncome,
      oasGross: oasGrossPerPerson, purchaseRrspWithdrawal,
      purchaseNonRegTaxable, propertySaleTaxable, spousalAttribution })
    if (person.status === 'ok') {
      tax = person.tax.total
      oasNet = person.oasNet
      const householdTaxable = Object.values(person.tax.byPerson).reduce((sum, row) => sum + row.taxableIncome, 0)
      taxablePerPerson = householdTaxable / persons
      rrspTax = householdTaxable > 0 ? tax * (w.rrsp / householdTaxable) : 0
      taxPeople.length = 0
      for (const row of Object.values(person.tax.byPerson)) {
        const personAge = canonical.people.find(p => p.id === row.personId)!.ageInBaseYear + taxYear - canonical.baseYear
        taxPeople.push({ taxableIncome: row.taxableIncome, credits: { age: personAge,
          pensionIncome: row.federalPensionEligible },
          oasGross: person.oasByPerson[row.personId]?.gross ?? 0,
          oasNet: person.oasByPerson[row.personId]?.net ?? 0 })
      }
      // The same basis object the legacy path uses, so the year row's category
      // and cut-off describe whichever income basis was actually priced.
      const personBasis = benefitIncomeBasis(receivingOas, agesPerPerson, person.taxableExOas,
        { workIncome: person.earnedWork })
      const personGis = basisAnnualAmount(personBasis)
      const personCcb = ccbAnnual(nUnder6, n6to17, householdTaxable)
      netCash = cpp + pension + oasNet + personGis + personCcb + rent + extraIncome + w.tfsa + w.rrsp + w.nonReg - tax + prepaidPurchaseTax
      return { withdrawals: w, tax, rrspTax, oasNet, gis: personGis, gisBasis: personBasis.status === 'modeled' ? personBasis : undefined, ccb: personCcb,
        netCash, taxablePerPerson, taxPeople, byPersonTax: person.tax.byPerson,
        spousalAttribution: person.spousalAttribution }
    }
    return { withdrawals: w, tax, rrspTax, oasNet, gis,
      gisBasis: legacyBasis.status === 'modeled' ? legacyBasis : undefined,
      ccb, netCash, taxablePerPerson, taxPeople, taxUnsupportedReason: person.reason }
  }
  return { withdrawals: w, tax, rrspTax, oasNet, gis,
    gisBasis: legacyBasis.status === 'modeled' ? legacyBasis : undefined,
    ccb, netCash, taxablePerPerson, taxPeople }
}

/** Binary-search the gross withdrawal needed to hit the spending target. */
function solveWithdrawals(
  target: number,
  balances: Record<AccountType, number>,
  forcedRrsp: number,
  gainFraction: number,
  cpp: number,
  pension: number,
  oasGrossPerPerson: number[],
  agesPerPerson: number[],
  extraTaxable: number,
  nonRegDistributions: number,
  rent: number,
  extraIncome: number,
  nUnder6: number,
  n6to17: number,
  steps: Step[],
  inputs: Inputs,
  prepaidPurchaseTax = 0,
  purchaseRrspWithdrawal = 0,
  purchaseNonRegTaxable = 0,
  propertySaleTaxable = 0,
  canonical?: InputsV2,
  taxYear?: number,
  spousalAttribution?: SpousalAttributionLedger,
): WithdrawalOutcome {
  const total = balances.tfsa + balances.rrsp + balances.nonReg
  const run = (G: number) =>
    evaluate(G, balances, forcedRrsp, gainFraction, cpp, pension, oasGrossPerPerson, agesPerPerson, extraTaxable, nonRegDistributions, rent, extraIncome, nUnder6, n6to17, steps, inputs, prepaidPurchaseTax, purchaseRrspWithdrawal, purchaseNonRegTaxable, propertySaleTaxable, canonical, taxYear, spousalAttribution)

  const atMin = run(forcedRrsp)
  if (atMin.netCash >= target) return atMin

  const atMax = run(total)
  if (atMax.netCash < target) return atMax

  let lo = forcedRrsp
  let hi = total
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (run(mid).netCash < target) lo = mid
    else hi = mid
  }
  return run(hi)
}

/** Primary-timeline age at which the first government benefit begins. */
export function pensionStartAge(inputs: Inputs): number {
  let start = Math.min(inputs.cppStartAge, inputs.oasStartAge)
  if (inputs.partner) {
    const offset = inputs.currentAge - inputs.partner.currentAge
    start = Math.min(
      start,
      inputs.partner.cppStartAge + offset,
      inputs.partner.oasStartAge + offset,
    )
  }
  return start
}

export function runProjection(inputs: Inputs, sample?: ReturnSampler, canonical?: InputsV2): ProjectionResult {
  const bal: Record<AccountType, number> = { ...inputs.balances }
  // ACB stays in nominal dollars; liquid balances and public charts remain in
  // base-year purchasing power until the annual-state consumer migration.
  let nonRegBook = inputs.nonRegBook
  const pensionAge = pensionStartAge(inputs)
  const partner = inputs.partner ?? null
  const rows: YearRow[] = []
  let depletedAge: number | null = null
  let rrspTaxTotal = 0
  let finalYearPeople: TerminalTaxPerson[] = []
  const unfundedObligations: FundingGap[] = []
  let taxUnsupportedReason: string | undefined
  let investmentSaleTaxUnsupported = false
  let nonRegLossTaxUnverified = false
  // Review fix B2: the spousal premiums' already-attributed state lives for the
  // whole projection (per account, per premium), is seeded once at the plan's
  // base year, and is advanced by each settled year. It is never written back
  // into the canonical plan, so `runProjection` stays pure and re-runnable.
  let spousalAttribution: SpousalAttributionLedger = canonical ? openingSpousalAttributionLedger(canonical) : {}
  if (canonical && inputs.fireAge > inputs.currentAge && canonical.accounts.some(account => account.kind === 'rrif' && account.balance > 0))
    taxUnsupportedReason = 'working RRIF minimum requires BE-14 B cash and tax settlement'

  // debt payments are fixed in nominal dollars — inflation erodes them in
  // this real-dollar frame. During accumulation they're assumed already
  // netted out of annualSavings; in retirement they add to the spending
  // target until each loan is paid off.
  const years = inputs.lifeExpectancy - inputs.currentAge + 1
  const inflation = inputs.inflation ?? 0.021
  const debtStream = buildDebtStream(inputs.debts ?? [], years, inflation)

  const pr = inputs.principalResidence
  const plannedPurchase = pr && pr.mode === 'planned' ? pr : null
  // clamp for safety; validation flags a buy age before currentAge
  const buyYearIdx = plannedPurchase
    ? Math.max(0, plannedPurchase.buyAtAge - inputs.currentAge)
    : null
  const purchaseTerms = plannedPurchase
    ? planPurchaseFunding(plannedPurchase, Math.max(inputs.currentAge, plannedPurchase.buyAtAge)) : null

  // a property-linked mortgage amortizes on its own precomputed stream (same
  // math as the household debts array) so it can be discharged in full from
  // sale proceeds instead of continuing forever. A future purchase's mortgage
  // is built the same way but starting from buyYearIdx: since the engine
  // works entirely in today's-dollar real terms, a fixed real payment at a
  // future origination decays from *that* year exactly like an existing
  // mortgage decays from year 0 — so the stream is just time-shifted, no
  // extra deflation math needed. Zero-padding the front makes every existing
  // per-year access to opening and closing balances uses the same offset.
  const prMortgage = (() => {
    if (plannedPurchase) {
      const principal = purchaseTerms?.mortgagePrincipal ?? 0
      const payment = plannedPurchase.annualMortgagePayment ?? 0
      if (principal <= 0 || payment <= 0 || !plannedPurchase.mortgageYears) return null
      const startIdx = buyYearIdx!
      const stream = buildDebtStream(
        [{ kind: 'mortgage', balance: principal, annualPayment: payment, yearsRemaining: plannedPurchase.mortgageYears }],
        Math.max(0, years - startIdx),
        inflation,
      )
      const zeros = new Array(Math.min(startIdx, years)).fill(0)
      return {
        payment: [...zeros, ...stream.payment].slice(0, years),
        openingBalance: [...zeros, ...stream.openingBalance].slice(0, years),
        closingBalance: [...zeros, ...stream.closingBalance].slice(0, years),
        interest: [...zeros, ...stream.interest].slice(0, years),
      }
    }
    return pr && pr.mode !== 'planned' && pr.mortgage
      ? buildDebtStream([{ kind: 'mortgage', ...pr.mortgage }], years, inflation)
      : null
  })()

  let fhsaBal = inputs.fhsa?.balance ?? 0
  let fhsaActive = !!inputs.fhsa
  let lockedBal = inputs.lockedRetirement?.balance ?? 0
  let unpaidPlannedMortgage = 0
  let unpaidSaleDebt = 0
  let prSold = false
  const plannedMortgageRate = plannedPurchase && plannedPurchase.mortgageYears && plannedPurchase.annualMortgagePayment
    ? impliedRate(plannedPurchase.price - plannedPurchase.downPayment,
      plannedPurchase.annualMortgagePayment, plannedPurchase.mortgageYears)
    : 0

  // a planned purchase doesn't exist until buyAtAge
  let prValue = plannedPurchase ? 0 : pr && pr.mode !== 'planned' ? pr.value : 0
  const ips = (inputs.investmentProperties ?? []).map((p) => ({
    value: p.value,
    acb: p.acb,
    saleExpenses: p.saleExpenses ?? 0,
    appreciation: p.appreciation,
    sellAtAge: p.sellAtAge,
    sold: false,
    rent: p.annualRent ?? 0,
    mortgage: p.mortgage
      ? buildDebtStream([{ kind: 'mortgage', ...p.mortgage }], years, inflation)
      : null,
  }))

  for (let age = inputs.currentAge; age <= inputs.lifeExpectancy; age++) {
    const phase: Phase =
      age < inputs.fireAge ? 'accumulation' : age < pensionAge ? 'bridge' : 'pension'

    let withdrawals: Record<AccountType, number> = { tfsa: 0, rrsp: 0, nonReg: 0 }
    let cpp = 0
    let oas = 0
    let gis = 0
    let gisBasisOut: Extract<BenefitBasis, { status: 'modeled' }> | undefined
    let ccb = 0
    let tax = 0
    let netCash = 0
    let shortfall = 0
    let extraTaxable = 0
    let saleGainsTaxable = 0
    let accumulationSaleTax = 0
    const saleTaxObligations: { amount: number; propertyIdx: number }[] = []
    let taxablePerPerson = 0
    let yearTaxPeople: TerminalTaxPerson[] = []
    let byPersonTax: YearRow['byPersonTax']
    let taxBySource: TaxBySource = { rrsp: 0, nonReg: 0, cpp: 0, oas: 0, property: 0, extraIncome: 0, pension: 0 }
    let taxableBySource: TaxBySource = { rrsp: 0, nonReg: 0, cpp: 0, oas: 0, property: 0, extraIncome: 0, pension: 0 }
    let dpAccumTax = 0
    let purchaseTaxable = 0
    let purchaseTaxPaid = 0
    let purchaseNonRegTaxable = 0
    let purchaseRrspWithdrawal = 0
    let purchaseFunding: YearRow['purchaseFunding'] = null
    let housingFunding: YearRow['housingFunding'] = null
    const yearGaps: FundingGap[] = []
    const yearIdx = age - inputs.currentAge
    const factor = nominalFactor(inflation, yearIdx)
    const nonRegBookReal = () => toReal(nonRegBook, factor)
    // A purchase or housing-funding disposal can realize an unverified loss in
    // either phase; the funding planner reports it so no year's tax is called
    // exact when the loss treatment is unknown.
    const noteFundingLoss = (allocation: { nonRegLossRealized?: boolean } | null | undefined) => {
      if (!allocation?.nonRegLossRealized) return
      taxUnsupportedReason ??= 'non-registered capital loss needs superficial-loss confirmation and owner-specific carry'
      nonRegLossTaxUnverified = true
    }
    if (plannedPurchase && yearIdx > buyYearIdx! && unpaidPlannedMortgage > 0) {
      const sellingAtOpen = plannedPurchase.sellAtAge !== null && age >= plannedPurchase.sellAtAge && prValue > 0
      unpaidPlannedMortgage *= sellingAtOpen ? 1 : (1 + plannedMortgageRate) / (1 + inflation)
    }

    // v1 boundary model: the balance keeps compounding while locked, then
    // joins the ordinary taxable registered bucket at the user-supplied age.
    // This occurs before the year's withdrawal solve, so that age is usable.
    if (inputs.lockedRetirement && lockedBal > 0 && age >= inputs.lockedRetirement.accessibleAge) {
      bal.rrsp += lockedBal
      lockedBal = 0
    }

    // CCB-eligible children this year (see Child); only used in the
    // retirement branch below — accumulation-year CCB is assumed already
    // folded into annualSavings
    const childAges = (inputs.children ?? [])
      .map((c) => c.age + yearIdx)
      .filter((a) => a >= 0 && a < 18)
    const nUnder6 = childAges.filter((a) => a < 6).length
    const n6to17 = childAges.length - nUnder6

    // future home purchase: the down payment is funded FHSA → TFSA →
    // non-registered → RRSP (fixed order, not configurable). FHSA collapses
    // in full (a qualifying withdrawal); any leftover funding need is taxed
    // at the working marginal rate pre-FIRE. Retirement purchases use the
    // annual tax context for gross-up, but only opening assets may close the
    // year-start transaction. Later income can fund ordinary annual costs.
    if (plannedPurchase && yearIdx === buyYearIdx) {
      if (phase === 'accumulation') {
        const plan = planPurchaseFunding(plannedPurchase, age, {
          balances: bal, fhsaBalance: fhsaActive ? fhsaBal : 0, nonRegBook: nonRegBookReal(),
          marginalRate: inputs.accumulationMarginalRate ?? 0.35,
          annualSavings: inputs.annualSavings,
          firstYearCost: (prMortgage?.payment[yearIdx] ?? 0) + plannedPurchase.netHoldingCostChange,
        })
        if (plan.gap) yearGaps.push(plan.gap)
        else if (plan.allocation) {
          Object.assign(bal, plan.allocation.balances)
          noteFundingLoss(plan.allocation)
          nonRegBook = toNominal(plan.allocation.nonRegBook, factor)
          dpAccumTax = plan.allocation.withdrawalTax
          purchaseNonRegTaxable = plan.allocation.nonRegTaxable
          purchaseRrspWithdrawal = plan.allocation.rrspWithdrawal
          purchaseFunding = {
            eventId: `purchase:${age}`, price: plannedPurchase.price,
            mortgagePrincipal: plan.mortgagePrincipal,
            downPaymentFromFhsa: plan.allocation.downPaymentFromFhsa,
            downPaymentFromAccounts: plan.allocation.downPaymentFromAccounts,
            grossWithdrawals: plan.allocation.grossWithdrawals,
            firstYearCostFromSavings: plan.allocation.firstYearCostFromSavings,
            firstYearCostFromOpening: plan.allocation.firstYearCostFromOpening,
            withdrawalTax: plan.allocation.withdrawalTax,
          }
          fhsaBal = 0
          fhsaActive = false
          prValue = plannedPurchase.price
        }
      } else {
        const purchaseYearRent = ips.reduce((sum, p) => sum + (p.value > 0 ? p.rent : 0), 0)
        const plan = planPurchaseFunding(plannedPurchase, age, {
          balances: bal, fhsaBalance: fhsaActive ? fhsaBal : 0, nonRegBook: nonRegBookReal(),
          marginalRate: inputs.accumulationMarginalRate ?? 0.35,
          taxOnWithdrawal: purchaseTaxIncrement(inputs, age, purchaseYearRent, canonical),
          annualSavings: 0, firstYearCost: 0,
        })
        if (plan.gap) yearGaps.push(plan.gap)
        else if (plan.allocation) {
          Object.assign(bal, plan.allocation.balances)
          noteFundingLoss(plan.allocation)
          nonRegBook = toNominal(plan.allocation.nonRegBook, factor)
          purchaseTaxable = plan.allocation.taxableWithdrawal
          purchaseTaxPaid = plan.allocation.withdrawalTax
          purchaseNonRegTaxable = plan.allocation.nonRegTaxable
          purchaseRrspWithdrawal = plan.allocation.rrspWithdrawal
          purchaseFunding = {
            eventId: `purchase:${age}`, price: plannedPurchase.price,
            mortgagePrincipal: plan.mortgagePrincipal,
            downPaymentFromFhsa: plan.allocation.downPaymentFromFhsa,
            downPaymentFromAccounts: plan.allocation.downPaymentFromAccounts,
            grossWithdrawals: plan.allocation.grossWithdrawals,
            firstYearCostFromSavings: 0, firstYearCostFromOpening: 0,
            withdrawalTax: plan.allocation.withdrawalTax,
          }
          fhsaBal = 0
          fhsaActive = false
          prValue = plannedPurchase.price
        }
      }
    }

    // FHSA matures into the RRSP (tax-free, no room impact) the moment it
    // hits its 15-year clock or age 71, whichever comes first — from then on
    // it's ordinary RRSP money, so no separate withdrawal/tax path is needed.
    if (fhsaActive && inputs.fhsa) {
      const yearsOpen = inputs.fhsa.openedYearsAgo + yearIdx
      if (yearsOpen >= 15 || age >= 71) {
        bal.rrsp += fhsaBal
        fhsaBal = 0
        fhsaActive = false
      }
    }

    // All planned sales close at the opening of the year, before interest,
    // rent, appreciation or the scheduled mortgage installment. If the lien
    // exceeds the sale price, draw only opening liquid assets. Any unpaid
    // remainder remains a debt and an explicit funding gap.
    const settleSale = (sale: ReturnType<typeof yearStartSale>, field: string) => {
      if (sale.proceeds > 0) {
        bal.nonReg += sale.proceeds
        nonRegBook += toNominal(sale.proceeds, factor)
      }
      if (sale.cashNeeded > 0) {
        const plan = planAnnualHousingFunding(age, sale.cashNeeded, {
          balances: bal, nonRegBook: nonRegBookReal(), annualSavings: 0,
          marginalRate: inputs.accumulationMarginalRate ?? 0.35,
          taxOnWithdrawal: phase === 'accumulation' ? undefined : purchaseTaxIncrement(inputs, age, 0, canonical),
        })
        if (plan.allocation) {
          Object.assign(bal, plan.allocation.balances)
          noteFundingLoss(plan.allocation)
          nonRegBook = toNominal(plan.allocation.nonRegBook, factor)
          if (phase === 'accumulation') dpAccumTax += plan.allocation.withdrawalTax
          else {
            purchaseTaxable += plan.allocation.taxableWithdrawal
            purchaseTaxPaid += plan.allocation.withdrawalTax
          }
          purchaseNonRegTaxable += plan.allocation.nonRegTaxable
          purchaseRrspWithdrawal += plan.allocation.rrspWithdrawal
        }
        if (plan.gap) {
          yearGaps.push({ ...plan.gap, eventId: `sale:${age}:${field}`, field, reason: 'saleDischarge' })
          unpaidSaleDebt += plan.gap.amount
        }
      }
    }
    if (pr && pr.sellAtAge !== null && age >= pr.sellAtAge && prValue > 0) {
      const sale = yearStartSale(prValue, prMortgage, yearIdx, unpaidPlannedMortgage)
      settleSale(sale, 'principalResidence.sellAtAge')
      prValue = 0
      prSold = true
      unpaidPlannedMortgage = 0
    }
    for (let propertyIdx = 0; propertyIdx < ips.length; propertyIdx++) {
      const p = ips[propertyIdx]
      if (p.sellAtAge !== null && age >= p.sellAtAge && p.value > 0) {
        investmentSaleTaxUnsupported = true
        taxUnsupportedReason ??= 'investment-property sale requires verified building/land and CCA tax facts'
        if (p.saleExpenses > p.value)
          taxUnsupportedReason ??= 'projected selling expenses exceed property value'
        const effectiveExpenses = Math.min(p.saleExpenses, p.value)
        const sale = yearStartSale(p.value - effectiveExpenses, p.mortgage, yearIdx)
        const disposal = disposeHolding({ marketValue: toNominal(p.value, factor), acb: p.acb },
          toNominal(p.value, factor), toNominal(effectiveExpenses, factor))
        if (disposal.status !== 'ok') taxUnsupportedReason ??= disposal.reason
        // The legacy cash preview can still run, but a loss without verified
        // CCA/land-building and superficial-loss facts is not a tax deduction.
        const gain = disposal.status === 'ok' ? toReal(disposal.value.gain * CAPITAL_GAINS_INCLUSION, factor) : 0
        extraTaxable += gain
        saleGainsTaxable += gain
        settleSale(sale, `investmentProperties.${propertyIdx}.sellAtAge`)
        p.value = 0
        p.sold = true
        if (phase === 'accumulation' && gain > 0) {
          const amount = gain * (inputs.accumulationMarginalRate ?? 0.35)
          accumulationSaleTax += amount
          saleTaxObligations.push({ amount, propertyIdx })
        }
      }
    }
    const releasedPayments =
      releasedMortgagePayment(prMortgage, prSold && !plannedPurchase, yearIdx) +
      ips.reduce((sum, p) => sum + releasedMortgagePayment(p.mortgage, p.sold, yearIdx), 0)
    const workingSavings = inputs.annualSavings + releasedPayments
    let savingsAfterSaleTax = workingSavings
    // A same-year planned home's installment/holding cost already has a
    // claim on these savings. Do not let sale tax spend that cash and then
    // let the purchase ledger spend it again.
    const committedHousingCost = plannedPurchase && prValue > 0
      ? Math.max(0, (prMortgage?.payment[yearIdx] ?? 0) + plannedPurchase.netHoldingCostChange)
      : 0
    let freeSavingsForSaleTax = Math.max(0, workingSavings - committedHousingCost)
    // Gains tax is an annual cash obligation. Current-year savings can pay
    // it before new contributions; any remainder draws sale proceeds or
    // other liquid assets through the BE-30 funding allocator. A final
    // shortage remains a visible liability rather than negative cash.
    for (const obligation of saleTaxObligations) {
      const plan = planAnnualHousingFunding(age, obligation.amount, {
        balances: bal, nonRegBook: nonRegBookReal(), annualSavings: freeSavingsForSaleTax,
        marginalRate: inputs.accumulationMarginalRate ?? 0.35,
      })
      if (plan.allocation) {
        Object.assign(bal, plan.allocation.balances)
        noteFundingLoss(plan.allocation)
        nonRegBook = toNominal(plan.allocation.nonRegBook, factor)
        savingsAfterSaleTax -= plan.allocation.firstYearCostFromSavings
        freeSavingsForSaleTax -= plan.allocation.firstYearCostFromSavings
        dpAccumTax += plan.allocation.withdrawalTax
        purchaseNonRegTaxable += plan.allocation.nonRegTaxable
        purchaseRrspWithdrawal += plan.allocation.rrspWithdrawal
      }
      if (plan.gap) {
        yearGaps.push({ ...plan.gap, eventId: `sale:${age}:tax:${obligation.propertyIdx}`,
          field: `investmentProperties.${obligation.propertyIdx}.sellAtAge`, reason: 'saleTax' })
        unpaidSaleDebt += plan.gap.amount
      }
    }
    // net rent from properties still held (stops the year a property sells);
    // a linked mortgage's interest (not principal) is deductible against it,
    // capped at the rent itself — this model doesn't carry forward a rental
    // loss to shelter other income
    const rent = ips.reduce((s, p) => s + (p.value > 0 ? p.rent : 0), 0)
    const rentMortgageInterest = Math.min(
      rent,
      ips.reduce((s, p) => s + (p.value > 0 ? (p.mortgage?.interest[yearIdx] ?? 0) : 0), 0),
    )
    extraTaxable -= rentMortgageInterest

    // debt payments/balances shown and charged against spending: the
    // household's general debts plus any property-linked mortgage still
    // outstanding (properties already sold this year stop contributing —
    // their mortgage was just discharged from the sale proceeds above)
    let debtPayment =
      (debtStream.payment[yearIdx] ?? 0) +
      (prValue > 0 ? prMortgage?.payment[yearIdx] ?? 0 : 0) +
      ips.reduce((s, p) => s + (p.value > 0 ? p.mortgage?.payment[yearIdx] ?? 0 : 0), 0)
    let debtBalance =
      (debtStream.closingBalance[yearIdx] ?? 0) + unpaidSaleDebt +
      (prValue > 0 ? (prMortgage?.closingBalance[yearIdx] ?? 0) + unpaidPlannedMortgage : 0) +
      ips.reduce((s, p) => s + (p.value > 0 ? p.mortgage?.closingBalance[yearIdx] ?? 0 : 0), 0)
    // net change in living costs from a future purchase (rent saved, property
    // tax/insurance/maintenance added, etc. — excludes the mortgage payment
    // itself, already in debtPayment above); stops once sold like the mortgage
    const netHoldingCost = plannedPurchase && prValue > 0 ? plannedPurchase.netHoldingCostChange : 0
    // Barista FIRE: side income between fromAge (no earlier than FIRE) and toAge
    const ei = inputs.extraIncome
    const extraIncome =
      ei && age >= Math.max(ei.fromAge, inputs.fireAge) && age <= ei.toAge ? ei.annual : 0

    // non-registered tax drag: yearly distributions are taxable when paid,
    // then reinvest (raising the ACB so they aren't taxed again at sale)
    const dist = bal.nonReg * (inputs.nonRegDistributionYield ?? 0)

    // government benefits accrue on each person's own timeline, whether or
    // not the household has FIRE'd yet (an older partner can be collecting
    // CPP/OAS during the primary's accumulation years)
    const partnerAge = partner ? partner.currentAge + (age - inputs.currentAge) : null
    // BE-39 A: the early-claim dilution relief runs off the person's *current*
    // retirement age. The `cppWork.retireAge` the estimator captured at apply
    // time is no longer read here — it never moved when the FIRE age did, so a
    // stale snapshot silently drove the relief factor.
    const reliefAge = retirementAgeFor(inputs, canonical)
    // `age` is the calendar year's age; the *claim* age is the person's own
    // start age, and `inputsCppAnnual` gates on it. Passing the calendar age
    // as the claim age would have re-priced the benefit every year.
    // The claim *age* is the person's own start age; the row's calendar age is
    // only the gate. `inputsCppAnnual` takes the claim age, so the gate is
    // explicit here — passing the calendar age as the claim age would re-price
    // the benefit every year.
    if (age >= inputs.cppStartAge) {
      cpp += inputsCppAnnual(inputs, inputs.cppStartAge, inputs.province, reliefAge('self'))
    }
    if (partner && partnerAge! >= partner.cppStartAge) {
      cpp += inputsCppAnnual(partner, partner.cppStartAge, inputs.province, reliefAge('partner'))
    }

    // employer pension runs on each person's own timeline, like CPP/OAS
    const pension =
      pensionPaid(inputs.pension, age, inflation) +
      (partner ? pensionPaid(partner.pension, partnerAge!, inflation) : 0)

    // OAS rises 10% automatically at 75
    const oasGrossPerPerson = [age >= inputs.oasStartAge
      ? inputsOasAnnual(inputs, inputs.oasStartAge) * (age >= 75 ? 1.1 : 1) : 0]
    const agesPerPerson = [age]
    if (partner) {
      oasGrossPerPerson.push(partnerAge! >= partner.oasStartAge
        ? inputsOasAnnual(partner, partner.oasStartAge) * (partnerAge! >= 75 ? 1.1 : 1) : 0)
      agesPerPerson.push(partnerAge!)
    }

    if (phase === 'accumulation') {
      // FHSA contribution is carved out of annualSavings before the
      // remainder is split across the three accounts
      const futureMortgagePayment = plannedPurchase && prValue > 0 ? prMortgage?.payment[yearIdx] ?? 0 : 0
      const housingCost = futureMortgagePayment + netHoldingCost
      if (plannedPurchase && prValue > 0 && yearIdx !== buyYearIdx && housingCost > 0) {
        // Reuse the purchase cash ledger for every later installment. Annual
        // savings arrive before the payment; only then are liquid assets sold.
        const plan = planAnnualHousingFunding(age, housingCost, {
          balances: bal, nonRegBook: nonRegBookReal(), marginalRate: inputs.accumulationMarginalRate ?? 0.35,
          annualSavings: savingsAfterSaleTax,
        })
        if (plan.allocation) {
          Object.assign(bal, plan.allocation.balances)
          noteFundingLoss(plan.allocation)
          nonRegBook = toNominal(plan.allocation.nonRegBook, factor)
          dpAccumTax += plan.allocation.withdrawalTax
          purchaseNonRegTaxable += plan.allocation.nonRegTaxable
          purchaseRrspWithdrawal += plan.allocation.rrspWithdrawal
          housingFunding = {
            eventId: `purchase:${age}`, cost: housingCost,
            fromSavings: plan.allocation.firstYearCostFromSavings,
            fromOpening: plan.allocation.firstYearCostFromOpening,
            grossWithdrawals: plan.allocation.grossWithdrawals,
            withdrawalTax: plan.allocation.withdrawalTax,
          }
        }
        if (plan.gap) {
          yearGaps.push(plan.gap)
          const funded = (plan.allocation?.firstYearCostFromSavings ?? 0) +
            (plan.allocation?.firstYearCostFromOpening ?? 0)
          const { unpaid: unpaidMortgage } = reconcileMortgagePayment(futureMortgagePayment, funded)
          debtPayment -= unpaidMortgage
          unpaidPlannedMortgage += unpaidMortgage
          debtBalance += unpaidMortgage
        }
      }
      const budget = Math.max(0, savingsAfterSaleTax - housingCost)
      const allocation = allocateContributions({
        age, budget,
        fhsa: fhsaActive && inputs.fhsa ? inputs.fhsa.annualContribution : 0,
        employee: inputs.lockedRetirement?.employeeContribution ?? 0,
        employer: inputs.lockedRetirement?.employerContribution ?? 0,
        split: inputs.savingsSplit,
      })
      yearGaps.push(...allocation.gaps)
      fhsaBal += allocation.fhsa
      const lockedEmployee = allocation.employee
      const lockedEmployer = allocation.employer
      if (inputs.lockedRetirement && age >= inputs.lockedRetirement.accessibleAge)
        bal.rrsp += lockedEmployee + lockedEmployer
      else
        lockedBal += lockedEmployee + lockedEmployer
      // a future mortgage/holding-cost change isn't already netted out of
      // annualSavings the way existing debts are assumed to be (the user set
      // that figure before this purchase existed)
      for (const t of ACCOUNT_TYPES) {
        const c = allocation.voluntary[t]
        bal[t] += c
        if (t === 'nonReg') nonRegBook += toNominal(c, factor)
      }
      const marginal = inputs.accumulationMarginalRate ?? 0.35
      // working years: distributions taxed at the assumed marginal rate,
      // with the tax paid out of the account
      const dragTax = dist * marginal
      bal.nonReg -= dragTax
      nonRegBook += toNominal(dist - dragTax, factor)
      // net rent, taxed at the same marginal rate (after any mortgage
      // interest deduction), is saved on top of annualSavings (whose hint
      // tells the user to exclude rent)
      const rentTax = (rent - rentMortgageInterest) * marginal
      bal.nonReg += rent - rentTax
      nonRegBook += toNominal(rent - rentTax, factor)
      // benefits already being collected pre-FIRE are saved after tax at the
      // working marginal rate (no clawback/GIS modelling here — employment
      // income is unknown, so this leans simple; high earners drawing OAS
      // while working would really face the recovery tax)
      const oasGross = oasGrossPerPerson.reduce((s, x) => s + x, 0)
      const benefitBase = cpp + oasGross + pension
      const benefitTax = benefitBase * marginal
      bal.nonReg += benefitBase - benefitTax
      nonRegBook += toNominal(benefitBase - benefitTax, factor)
      oas = oasGross
      tax = dragTax + rentTax + benefitTax + dpAccumTax + accumulationSaleTax
      const marginalPurchaseTax = inputs.accumulationMarginalRate ?? 0.35
      const rrspWithdrawalTax = purchaseRrspWithdrawal * marginalPurchaseTax
      const nonRegWithdrawalTax = purchaseNonRegTaxable * marginalPurchaseTax
      rrspTaxTotal += rrspWithdrawalTax
      const cppTax = benefitBase > 0 ? benefitTax * (cpp / benefitBase) : 0
      const pensionTax = benefitBase > 0 ? benefitTax * (pension / benefitBase) : 0
      taxBySource = {
        rrsp: rrspWithdrawalTax, nonReg: dragTax + nonRegWithdrawalTax,
        cpp: cppTax, oas: benefitTax - cppTax - pensionTax,
        property: rentTax + accumulationSaleTax, extraIncome: 0, pension: pensionTax,
      }
      taxableBySource = {
        rrsp: purchaseRrspWithdrawal, nonReg: dist + purchaseNonRegTaxable,
        cpp, oas: oasGross,
        property: rent - rentMortgageInterest + saleGainsTaxable, extraIncome: 0, pension,
      }
      // Salary is not modeled in accumulation. Preserve the prior known-
      // income approximation for direct-engine callers of invalid plans, but
      // mark it unsupported below rather than calling it an actual tax base.
      const knownTaxable = Object.values(taxableBySource).reduce((sum, value) => sum + value, 0)
      yearTaxPeople = agesPerPerson.map((personAge) => ({
        taxableIncome: knownTaxable / agesPerPerson.length,
        credits: { age: personAge, pensionIncome: pension / agesPerPerson.length },
      }))
    } else {
      extraTaxable += dist + purchaseTaxable

      // spousal age election: RRIF minimums may be computed from the younger
      // spouse's age — always optimal (lower forced withdrawals, more tax
      // deferral), so auto-applied rather than exposed as an input
      const rrifAge = Math.min(...agesPerPerson)
      let rrifMin = bal.rrsp * rrifMinFactor(rrifAge)
      if (canonical) {
        const registered = canonical.accounts.filter(account => ['rrsp', 'spousalRrsp', 'rrif', 'lif'].includes(account.kind) && account.balance > 0)
        if (registered.length === 1 && registered[0].kind === 'rrif') {
          const minimum = minimumForRrif(registered[0], canonical.people, canonical.baseYear,
            canonical.baseYear + yearIdx, bal.rrsp)
          if (minimum.status === 'ok') rrifMin = minimum.amount
          else {
            taxUnsupportedReason ??= minimum.reason
            // Do not invent a mandatory withdrawal from the legacy factor
            // when the actual RRIF category/factor is unconfirmed.
            rrifMin = 0
          }
        } else if (registered.length === 1 && registered[0].kind === 'rrsp') {
          // Keep the old cash preview until the user confirms a legal
          // conversion. The person-tax capability gate rejects age 72+.
        }
        else if (registered.length > 1) taxUnsupportedReason ??= 'multiple registered accounts need BE-14 B funding allocation'
      }
      const forcedRrsp = Math.min(bal.rrsp, rrifMin)
      // bracket-capped meltdown: the RRSP funds spending first, but only as
      // much as spending needs and never beyond the room left in the chosen
      // ceiling (per person) after CPP/OAS — the first bracket by default,
      // or the second bracket / OAS clawback threshold for large RRSPs where
      // staying in bracket 1 forever just strands money into RRIF-forced
      // withdrawals and a fully-taxable estate. Nothing is withdrawn just to
      // prepay tax; the remainder rides past 71 and exits via RRIF minimums.
      // If the other accounts run dry, the RRSP is the uncapped last resort.
      let steps: Step[]
      if (inputs.strategy === 'meltdownPaced') {
        const capMode = inputs.meltdownBracketCap ?? 'bracket1'
        const bIdx = capMode === 'bracket2' ? 1 : 0
        const bracketTop =
          capMode === 'oasClawback'
            ? OAS_CLAWBACK_THRESHOLD
            : Math.min(FEDERAL.brackets[bIdx].upTo, PROVINCIAL[inputs.province].brackets[bIdx].upTo)
        const persons = partner ? 2 : 1
        const committedTaxable =
          cpp + pension + extraTaxable + rent + extraIncome +
          oasGrossPerPerson.reduce((s, x) => s + x, 0)
        const rrspCap = Math.max(rrifMin, bracketTop * persons - committedTaxable)
        steps = [
          { account: 'rrsp', cap: rrspCap },
          { account: 'nonReg' },
          { account: 'tfsa' },
          { account: 'rrsp' },
        ]
      } else {
        steps = STRATEGY_ORDER[inputs.strategy].map((account) => ({ account }))
      }
      // The legacy withdrawal solver accepts a nonnegative gain fraction, so a
      // holding whose cost exceeds its value is previewed as tax-free. The fact
      // only becomes a tax limit once a withdrawal actually settles the loss:
      // merely holding an unrealized loss is not a disposition. A sub-dollar
      // balance or withdrawal is drain residue, not a real disposal.
      const nonRegLossPreview = bal.nonReg > 1 && nonRegBookReal() > bal.nonReg + 1e-8
      const gainFraction = bal.nonReg > 0 ? Math.max(0, (bal.nonReg - nonRegBookReal()) / bal.nonReg) : 0

      // The purchase-year down payment has already been paid from opening
      // assets. The ordinary annual solver funds living costs, loan payments,
      // and ongoing home costs from the remaining assets and this year's
      // income, while reconciling purchase-withdrawal tax paid at closing.
      const spendTarget = inputs.retirementSpending + debtPayment + netHoldingCost
      const out = solveWithdrawals(
        spendTarget, bal, forcedRrsp, gainFraction, cpp, pension,
        oasGrossPerPerson, agesPerPerson, extraTaxable, dist, rent,
        extraIncome, nUnder6, n6to17, steps, inputs, purchaseTaxPaid, purchaseRrspWithdrawal,
        purchaseNonRegTaxable, saleGainsTaxable,
        canonical, canonical ? canonical.baseYear + yearIdx : undefined,
        spousalAttribution,
      )
      // The accepted solve's ledger is the year's post-payment state; the
      // rejected binary-search candidates each started from the same
      // year-opening ledger, so this move is deterministic and cannot
      // double-count. An unsupported year returns no ledger and leaves it
      // untouched rather than fabricating an attribution.
      if (out.spousalAttribution) spousalAttribution = out.spousalAttribution
      if (out.taxUnsupportedReason) taxUnsupportedReason ??= out.taxUnsupportedReason
      byPersonTax = out.byPersonTax
      if (nonRegLossPreview && out.withdrawals.nonReg > 1) {
        taxUnsupportedReason ??= 'non-registered capital loss needs superficial-loss confirmation and owner-specific carry'
        nonRegLossTaxUnverified = true
      }
      if (canonical && (saleGainsTaxable || purchaseTaxable || purchaseNonRegTaxable || rentMortgageInterest))
        taxUnsupportedReason ??= 'property sale, purchase or rental mortgage tax needs BE-14 B event settlement'
      withdrawals = out.withdrawals
      yearTaxPeople = out.taxPeople
      tax = out.tax
      rrspTaxTotal += out.rrspTax
      oas = out.oasNet
      gis = out.gis
      gisBasisOut = out.gisBasis
      ccb = out.ccb
      netCash = out.netCash
      taxablePerPerson = out.taxablePerPerson ?? 0

      // proportional allocation of this year's tax across taxable
      // components (each component's share of total taxable income) —
      // sums exactly to `tax`; see TaxBySource
      const persons = partner ? 2 : 1
      const totalTaxable = taxablePerPerson * persons
      const nonRegGainTaxable = withdrawals.nonReg * gainFraction * CAPITAL_GAINS_INCLUSION
      const propertyTaxable = saleGainsTaxable + rent - rentMortgageInterest
      const taxShare = (component: number) => (totalTaxable > 0 ? tax * (component / totalTaxable) : 0)
      rrspTaxTotal += taxShare(purchaseRrspWithdrawal)
      taxBySource = {
        rrsp: taxShare(withdrawals.rrsp + purchaseRrspWithdrawal),
        nonReg: taxShare(dist + nonRegGainTaxable + purchaseNonRegTaxable),
        cpp: taxShare(cpp),
        oas: taxShare(oas),
        property: taxShare(propertyTaxable),
        extraIncome: taxShare(extraIncome),
        pension: taxShare(pension),
      }
      taxableBySource = {
        rrsp: withdrawals.rrsp + purchaseRrspWithdrawal,
        nonReg: dist + nonRegGainTaxable + purchaseNonRegTaxable,
        cpp,
        oas,
        property: propertyTaxable,
        extraIncome,
        pension,
      }

      if (netCash < spendTarget - 0.01) {
        shortfall = spendTarget - netCash
        if (depletedAge === null) depletedAge = age
      }

      // The annual solver can exhaust the accounts before a planned-home
      // installment is fully paid. Other annual costs take priority here;
      // only cash left for this mortgage may reduce its principal. The
      // existing total shortfall remains the all-costs spending deficit.
      const plannedMortgagePayment = plannedPurchase && prValue > 0
        ? (prMortgage?.payment[yearIdx] ?? 0) : 0
      if (plannedMortgagePayment > 0) {
        const cashForMortgage = netCash - (spendTarget - plannedMortgagePayment)
        const { unpaid } = reconcileMortgagePayment(plannedMortgagePayment, cashForMortgage)
        if (unpaid > 0.01) {
          unpaidPlannedMortgage += unpaid
          debtPayment -= unpaid
          debtBalance += unpaid
          yearGaps.push({ eventId: `purchase:${age}`,
            field: 'principalResidence.annualMortgagePayment',
            amount: unpaid, reason: 'purchaseCost' })
        }
      }

      // Reduce ACB proportionally to the non-registered withdrawal. The gross
      // withdrawal funds its own tax, so it can exceed the balance; a disposal
      // never removes more than the whole pool, and a drained pool keeps no
      // cost residue that would later read as an unrealized loss.
      if (withdrawals.nonReg > 0 && bal.nonReg > 0) {
        const disposed = Math.min(1, withdrawals.nonReg / bal.nonReg)
        nonRegBook = disposed >= 1 ? 0 : nonRegBook * (1 - disposed)
      }
      for (const t of ACCOUNT_TYPES) bal[t] -= withdrawals[t]
      if (bal.nonReg < 0.005) bal.nonReg = 0

      // surplus cash (e.g. forced RRIF minimum above spending) reinvests taxed
      const surplus = netCash - spendTarget
      if (surplus > 0) {
        bal.nonReg += surplus
        nonRegBook += toNominal(surplus, factor)
      }
      // The distribution is taxable but not spendable in evaluate(): it is
      // automatically reinvested inside the account. Add its full amount to
      // ACB once; the cash tax is funded separately by the withdrawal solve.
      nonRegBook += toNominal(dist, factor)
    }

    for (const t of ACCOUNT_TYPES) {
      bal[t] *= 1 + (sample ? sample(age, t) : inputs.returns[t]) - (inputs.fees ?? 0)
    }
    // FHSA piggybacks on the RRSP return/volatility assumption (same asset mix)
    if (fhsaActive) {
      fhsaBal *= 1 + (sample ? sample(age, 'rrsp') : inputs.returns.rrsp) - (inputs.fees ?? 0)
    }
    if (lockedBal > 0) {
      lockedBal *= 1 + (sample ? sample(age, 'rrsp') : inputs.returns.rrsp) - (inputs.fees ?? 0)
    }
    if (prValue > 0 && pr) prValue *= 1 + pr.appreciation
    for (const p of ips) {
      if (p.value > 0) p.value *= 1 + p.appreciation
    }
    const ipTotal = ips.reduce((s, p) => s + p.value, 0)

    if (yearGaps.length) {
      unfundedObligations.push(...yearGaps)
      if (depletedAge === null) depletedAge = age
    }

    rows.push({
      age, phase, unfundedObligations: yearGaps, purchaseFunding, housingFunding,
      balances: { ...bal },
      withdrawals, cpp, oas, gis, ccb, rent,
      gisCategory: gisBasisOut?.category ?? 'unsupported',
      gisAnnualCutoff: gisBasisOut?.annualCutoff ?? 0,
      allowance: gisBasisOut?.allowance ?? 0,
      extraIncome: phase === 'accumulation' ? 0 : extraIncome,
      pension,
      tax, netCash, shortfall,
      propertyValue: prValue + ipTotal,
      fhsaBalance: fhsaBal,
      lockedRetirementBalance: lockedBal,
      debtPayment, debtBalance,
      taxablePerPerson, taxBySource, taxableBySource,
      byPersonTax,
      taxCapability: canonical && !taxUnsupportedReason && phase !== 'accumulation' ? 'person' : 'legacyEstimate',
    })
    finalYearPeople = yearTaxPeople
  }

  const ipTotal = ips.reduce((s, p) => s + p.value, 0)
  const lastYearIdx = inputs.lifeExpectancy - inputs.currentAge
  // any property-linked mortgage still outstanding on a held property at
  // life expectancy — same components as the per-row debtBalance above,
  // which the generic debtStream-only figure used to omit (estate looked
  // richer than the balances/Monte Carlo charts, which do subtract it)
  const finalPropertyDebt =
    (prValue > 0 ? (prMortgage?.closingBalance[lastYearIdx] ?? 0) + unpaidPlannedMortgage : 0) +
    ips.reduce((s, p) => s + (p.value > 0 ? p.mortgage?.closingBalance[lastYearIdx] ?? 0 : 0), 0)
  const finalDebt = (debtStream.closingBalance[lastYearIdx] ?? 0) + finalPropertyDebt + unpaidSaleDebt
  // in the rare case life expectancy is reached before the FHSA's 15-year
  // clock or age 71 (it must mature by one of those), its balance is still
  // tax-free like an on-time rollover would have been
  const finalNetWorth = bal.tfsa + bal.rrsp + bal.nonReg + fhsaBal + lockedBal + prValue + ipTotal - finalDebt
  // deemed disposition at death: RRSP/RRIF fully taxable, gains half taxable;
  // TFSA and the principal residence pass tax-free
  const finalFactor = nominalFactor(inflation, inputs.lifeExpectancy - inputs.currentAge)
  const terminalNonReg = bal.nonReg > 0
    ? disposeHolding({ marketValue: toNominal(bal.nonReg, finalFactor), acb: nonRegBook }, toNominal(bal.nonReg, finalFactor)) : null
  const terminalProperties = ips.filter(p => p.value > 0).map(p =>
    disposeHolding({ marketValue: toNominal(p.value, finalFactor), acb: p.acb }, toNominal(p.value, finalFactor)))
  const terminalBasisUnknown = canonical?.accounts.some(account => account.kind === 'nonReg' && account.balance > 0 && account.acb.status !== 'known') ?? false
  const terminalCapitalUnsupported = terminalNonReg?.status !== 'ok' && terminalNonReg !== null ||
    terminalBasisUnknown || terminalProperties.some(item => item.status !== 'ok') ||
    ips.some(p => p.value > 0) || investmentSaleTaxUnsupported
  const nonRegGain = terminalNonReg?.status === 'ok' ? toReal(terminalNonReg.value.gain, finalFactor)
    : bal.nonReg > 0 ? bal.nonReg - toReal(nonRegBook, finalFactor) : 0
  const ipGain = ips.reduce((sum, p) => sum + (p.value > 0 ? p.value - toReal(p.acb, finalFactor) : 0), 0)
  const terminal = finalYearPeople.length > 0 ? terminalTax({
    province: inputs.province,
    people: finalYearPeople,
    remainingRegistered: bal.rrsp + lockedBal,
    nonRegisteredGain: nonRegGain,
    investmentPropertyGain: ipGain,
  }) : null
  // probate applies to the net value of non-registered holdings and unsold
  // real estate (a registered mortgage against the property reduces the
  // probatable estate); RRSP/RRIF/TFSA bypass it via named beneficiaries
  const probateFee = probateTax(
    bal.nonReg + Math.max(0, prValue + ipTotal - finalPropertyDebt),
    inputs.province,
  )
  return {
    taxCapability: { status: canonical && !taxUnsupportedReason && inputs.fireAge <= inputs.currentAge ? 'person' : 'legacyEstimate',
      reason: taxUnsupportedReason ?? (inputs.fireAge > inputs.currentAge ? 'working-year tax uses an unverified marginal-rate approximation' : undefined) },
    capitalTaxLimit: investmentSaleTaxUnsupported ? 'investmentPropertySale'
      : nonRegLossTaxUnverified ? 'nonRegisteredLoss' : undefined,
    rows,
    unfundedObligations,
    success: depletedAge === null,
    depletedAge,
    finalNetWorth,
    // The terminal allocator still calls legacy incomeTax(), whose Quebec
    // Schedule F/K approximations cannot establish owner-specific closing tax.
    terminalTaxStatus: terminal && !terminalCapitalUnsupported && rows.at(-1)?.phase !== 'accumulation' && inputs.province !== 'QC' && (!canonical || canonical.people.length === 1) ? 'estimated' : 'unsupported',
    estateTax: terminal?.incrementalTax ?? Number.NaN,
    terminalOasRecovery: terminal?.oasRecoveryIncrement ?? Number.NaN,
    terminalRegisteredIncome: terminal?.registeredIncome ?? Number.NaN,
    terminalCapitalGainsIncome: terminal?.taxableCapitalGains ?? Number.NaN,
    probateFee,
    estateValue: terminal ? finalNetWorth - terminal.incrementalTax - probateFee : Number.NaN,
    rrspTax: terminal ? rrspTaxTotal + terminal.registeredTaxShare : Number.NaN,
  }
}
