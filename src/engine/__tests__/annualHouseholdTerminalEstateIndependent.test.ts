import { describe, expect, it } from 'vitest'
import { annualSheetDisplayValue, annualSheetText, type AnnualSheetRow } from '../../annualSheet'
import { canonicalAnnualSheet, canonicalSheetId } from '../../canonicalAnnualSheet'
import { legacyAnnualSheet } from '../../legacyAnnualSheet'
import { projectRetirementCoverage } from '../annualRetirement'
import {
  initializeState, projectAnnualCoverage, projectCanonicalCoverage, sumNetWorth,
  type AnnualCoverage, type AnnualProviders, type KernelResult,
} from '../annualState'
import { annualTerminalEstate, type AnnualTerminalEstateEvidence } from '../annualTerminalEstate'
import { evaluateCanonicalHouseholdWorkingYear } from '../annualWorking'
import type { InputsV2 } from '../model'
import { runProjection } from '../projection'
import { householdBenefitExclusions } from './fixtures/annualHouseholdOas'
import { BASE_YEAR, known, recorded, retirementPlan, RETIREE, RRSP, TFSA } from './fixtures/retirementSettlement'

const SURVIVOR = 'surviving:partner'
const SURVIVOR_TFSA = 'survivor/tfsa'
const YEAR = BASE_YEAR + 2
const context = { scenarioId: 'independent-household-estate', revision: 1 }
const money = (value: number) => expect.closeTo(value, 6)

// 2026 Ontario anchor. The test incomes stay below the first surtax,
// above the low-income reduction whenever tax is positive, and below age 65.
// No employment, dependent, spouse, or pension credits on the final return.
function retirementTax(income: number) {
  const federal = Math.max(0, Math.min(income, 58_523) - 16_452) * 0.14
    + Math.max(0, income - 58_523) * 0.205
  const ontario = Math.max(0, Math.min(income, 53_891) - 12_989) * 0.0505
    + Math.max(0, income - 53_891) * 0.0915
  const health = Math.min(300, Math.max(0, income - 20_000) * 0.06)
    + Math.min(150, Math.max(0, income - 36_000) * 0.06)
    + Math.min(150, Math.max(0, income - 48_000) * 0.25)
    + Math.min(150, Math.max(0, income - 72_000) * 0.25)
  return federal + ontario + health
}

function ok<T>(result: KernelResult<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  return result.value
}

function fixture({
  inflation = 0.04, rrsp = 102_000, tfsa = 38_000, partnerTfsa = 90_000, grossDraw = 30_000,
  rrspId = RRSP, tfsaId = TFSA,
} = {}) {
  const spending = grossDraw - retirementTax(grossDraw)
  const plan = retirementPlan({ inflation, rrsp, tfsa, spending })
  const [self] = plan.people
  Object.assign(self, { retirementAge: 58, earnedIncome: known(12_000) })
  const partner = { ...structuredClone(self), id: SURVIVOR, role: 'partner' as const, ageInBaseYear: 55, retirementAge: 56 }
  plan.people.push(partner)
  const [selfTfsa, selfRrsp] = plan.accounts
  selfTfsa.id = tfsaId
  selfRrsp.id = rrspId
  plan.accounts.push({ ...structuredClone(selfTfsa), id: SURVIVOR_TFSA, ownerId: SURVIVOR, balance: partnerTfsa,
    taxableOwnerShares: { status: 'known', shares: { [SURVIVOR]: 1 } } })
  for (const account of plan.accounts) {
    account.provenance = { balance: recorded, ownerId: recorded, taxableOwnerShares: recorded }
  }
  plan.tfsaStatement![SURVIVOR] = { withdrawals: [], provenance: recorded }
  plan.taxProfile = { spouseSupported: known(false), pensionSplit: null }
  // Two $12,000 wages. Each has ($12,000 - $3,500) × 5.95% CPP
  // and $12,000 × 1.63% EI, and neither owes income tax.
  const workingSpending = 24_000 - 2 * (8_500 * 0.0595 + 12_000 * 0.0163)
  plan.budget = { kind: 'incomeBudget', workingSpending, retirementSpending: spending }
  plan.legacyProjection.fireAge = 58
  plan.legacyProjection.partner = { currentAge: 55, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 }
  const certification: AnnualTerminalEstateEvidence = {
    provenance: recorded, effectiveYear: YEAR, personId: RETIREE, timing: 'end-of-terminal-year',
    modeledDecedent: 'self-only', survivingPersonId: SURVIVOR, noSurvivorProjection: true,
    certificateRequired: true, completeEstate: true, noDeathBenefitsOrOtherTerminalIncome: true,
    accounts: {
      [rrspId]: { ownerId: RETIREE, estateIncluded: true, noBeneficiaryRollover: true },
      [tfsaId]: { ownerId: RETIREE, estateIncluded: true, noBeneficiaryRollover: true, tfsaNoDeathIncome: true },
    },
  }
  plan.annualTerminalEstateEvidence = { [YEAR]: certification }
  return { plan, certification, spendingEvidence: { workingSpending: known(workingSpending), retirementSpending: known(spending) } }
}

function withoutEstate(plan: InputsV2): InputsV2 {
  const { annualTerminalEstateEvidence: _estate, ...rest } = plan
  return rest
}

function ordinaryLedger(coverage: AnnualCoverage) {
  return {
    rows: coverage.rows.map(({ terminalEstateEstimate: _estate, ...row }) => row),
    state: coverage.state, blocked: coverage.blocked, uncomputedYears: coverage.uncomputedYears,
  }
}

function sheetRows(rows: AnnualSheetRow[]): AnnualSheetRow[] {
  return rows.flatMap(row => [row, ...sheetRows(row.children ?? [])])
}

function sheetRow(rows: AnnualSheetRow[], ...path: string[]): AnnualSheetRow {
  const row = sheetRows(rows).find(item => item.id === canonicalSheetId(...path))
  if (!row) throw new Error(`Missing annual sheet row ${path.join('/')}`)
  return row
}

describe('FE-53 household self-only terminal estate', () => {
  it.each([
    [RRSP, TFSA, false, 55],
    ['rrsp:owner/甲', 'tfsa owner.乙', true, 61],
    ['401', 'owner/[=] 🔒', true, 55],
  ] as const)('reconciles account %s and %s with reordered ledger %s and partner age %s', (rrspId, tfsaId, reverse, partnerAge) => {
    const { plan, certification, spendingEvidence } = fixture({ rrspId, tfsaId })
    Object.assign(plan.people[1], { ageInBaseYear: partnerAge, retirementAge: partnerAge + 1 })
    if (reverse) {
      plan.people.reverse()
      plan.accounts.reverse()
      certification.accounts = Object.fromEntries(Object.entries(certification.accounts).reverse())
    }
    const before = structuredClone(plan)
    const coverage = ok(projectCanonicalCoverage(plan, spendingEvidence, 3))
    // Move the reference horizon one year out so the same ordinary rows are
    // independently reachable through the established household path.
    const reference = ok(projectCanonicalCoverage({ ...withoutEstate(plan), lifeExpectancy: 60 }, spendingEvidence, 3))
    expect(coverage).toMatchObject({ blocked: null, terminalYear: YEAR,
      overallConclusionAvailable: false, evaluationBasis: 'canonical-continuous' })
    expect(ordinaryLedger(coverage)).toEqual(ordinaryLedger(reference))
    expect(coverage.rows.map(row => row.year)).toEqual([2026, 2027, 2028])
    const [working, retired, terminal] = coverage.rows
    expect(working).toMatchObject({
      workingSettlement: { household: { phase: 'both-working' } }, payrollContributions: money(1_402.70),
      cashLedger: { income: 24_000, benefits: 0, tax: 0, spending: money(22_597.30), unallocated: 0 },
    })
    expect(working.terminalEstateEstimate).toBeUndefined()
    expect(retired.terminalEstateEstimate).toBeUndefined()
    const annualTax = retirementTax(30_000)
    for (const [offset, row] of [retired, terminal].entries()) {
      const startCpi = 1.04 ** (offset + 1)
      const endCpi = startCpi * 1.04
      const gross = 30_000 * startCpi
      const spending = (30_000 - annualTax) * startCpi
      expect(row.workingSettlement).toMatchObject({ household: { phase: 'both-retired' }, startCpi: money(startCpi) })
      expect(row.householdWithdrawalSettlement).toMatchObject({ ownerId: RETIREE, accountId: rrspId,
        withdrawal: money(gross), taxIncrement: money(annualTax * startCpi), spendingFunded: money(spending), spendingUnmet: 0 })
      expect(row.byPerson[RETIREE]).toMatchObject({ age: 58 + offset, earnedIncome: 0, benefits: 0,
        taxableIncome: money(gross), tax: money(annualTax * startCpi) })
      expect(row.byPerson[SURVIVOR]).toMatchObject({ age: partnerAge + 1 + offset, taxableIncome: 0, tax: 0 })
      expect(row.cashLedger).toMatchObject({ income: 0, benefits: 0, tax: money(annualTax * startCpi),
        spending: money(spending), debtPayments: 0, unallocated: money(0) })
      expect(row.byAccount[rrspId]).toMatchObject({ ownerId: RETIREE, contribution: 0, withdrawal: money(gross),
        opening: money((102_000 - 30_000 * offset) * startCpi), closing: money((72_000 - 30_000 * offset) * endCpi) })
      expect(row.byAccount[tfsaId]).toMatchObject({ ownerId: RETIREE, withdrawal: 0, closing: money(38_000 * endCpi) })
      expect(row.byAccount[SURVIVOR_TFSA]).toMatchObject({ ownerId: SURVIVOR, withdrawal: 0, closing: money(90_000 * endCpi) })
    }
    const startCpi = 1.04 ** 2
    const endCpi = 1.04 ** 3
    const closingRegisteredFairMarketValue = 42_000 * endCpi
    const selfGross = 80_000 * endCpi
    const excluded = 90_000 * endCpi
    const incrementalTax = (retirementTax(30_000 + 42_000 * 1.04) - annualTax) * startCpi
    // $89,989.12 certified gross nominal absorbs 40 $1,000 portions at $15 each.
    expect(terminal.terminalEstateEstimate).toMatchObject({
      status: 'estimated', scope: 'self-estate-only', personId: RETIREE, survivingPersonId: SURVIVOR,
      closingRegisteredFairMarketValue: money(closingRegisteredFairMarketValue),
      closingNetWorth: money(selfGross), estateAdministrationTaxBase: money(selfGross),
      estateAdministrationTax: 600, incrementalFinalReturnIncomeTax: money(incrementalTax),
      netEstate: money(selfGross - incrementalTax - 600), excludedSurvivorClosingNetWorth: money(excluded),
      householdClosingNetWorth: money(selfGross + excluded), taxBasis: 'start-CPI-annual-return',
      startCpi: money(startCpi), endCpi: money(endCpi), evidence: certification, taxRules: terminal.workingSettlement!.taxRules,
    })
    expect(sumNetWorth(coverage.state)).toBeCloseTo(selfGross + excluded, 6)
    expect(plan).toEqual(before)
  })

  it.each([[50_000, 0], [50_000.01, 15], [51_000, 15], [51_000.01, 30]])(
    'prices the Ontario certificate boundary at $%s nominal with an excluded $175,781.25 survivor', (gross, eat) => {
      const { plan, spendingEvidence } = fixture({ grossDraw: 0, rrsp: 0, tfsa: gross / 1.25 ** 3, inflation: 0.25 })
      const coverage = ok(projectCanonicalCoverage(plan, spendingEvidence, 3))
      expect(coverage.blocked).toBeNull()
      expect(coverage.rows[2].terminalEstateEstimate).toMatchObject({
        status: 'estimated', estateAdministrationTaxBase: money(gross), estateAdministrationTax: eat,
        incrementalFinalReturnIncomeTax: 0, netEstate: money(gross - eat),
        excludedSurvivorClosingNetWorth: 175_781.25,
      })
    },
  )

  it('requires an explicit empty own asset map for a zero self estate and keeps the survivor ledger', () => {
    const { plan, spendingEvidence, certification } = fixture({ grossDraw: 0 })
    plan.accounts = plan.accounts.filter(account => account.ownerId === SURVIVOR)
    certification.accounts = {}
    const coverage = ok(projectCanonicalCoverage(plan, spendingEvidence, 3))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows[2].terminalEstateEstimate).toMatchObject({ status: 'estimated',
      closingNetWorth: 0, closingRegisteredFairMarketValue: 0, estateAdministrationTaxBase: 0,
      incrementalFinalReturnIncomeTax: 0, estateAdministrationTax: 0, netEstate: 0,
      excludedSurvivorClosingNetWorth: money(90_000 * 1.04 ** 3),
    })
    expect(coverage.state.byAccount[SURVIVOR_TFSA].balance).toBeCloseTo(90_000 * 1.04 ** 3, 6)
  })

  it('prices a zero estate after a successful annual posting with unmet spending', () => {
    const { plan, spendingEvidence, certification } = fixture({ grossDraw: 1_000, partnerTfsa: 0 })
    plan.accounts = []
    certification.accounts = {}
    const coverage = ok(projectCanonicalCoverage(plan, spendingEvidence, 3))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows[2]).toMatchObject({
      householdWithdrawalSettlement: { spendingDue: money(1_081.6), spendingFunded: 0, spendingUnmet: money(1_081.6) },
      terminalEstateEstimate: { status: 'estimated', closingNetWorth: 0, netEstate: 0 },
    })
    expect(coverage.overallConclusionAvailable).toBe(false)
  })

  it('preserves the original no-section stop and settles a supplied section missing the terminal year', () => {
    const { plan, spendingEvidence, certification } = fixture()
    const settled = ok(projectCanonicalCoverage(plan, spendingEvidence, 4))
    const absent = ok(projectCanonicalCoverage(withoutEstate(plan), spendingEvidence, 4))
    expect(absent).toMatchObject({ rows: settled.rows.slice(0, 2), blocked: { year: YEAR }, uncomputedYears: [YEAR + 1] })
    expect(settled).toMatchObject({ blocked: { year: YEAR + 1 }, uncomputedYears: [] })
    expect(settled.rows[2].terminalEstateEstimate?.status).toBe('estimated')
    // The runner's input copy drops inherited year records.
    for (const evidence of [{}, { [YEAR - 1]: certification }, Object.create({ [YEAR]: certification })]) {
      plan.annualTerminalEstateEvidence = evidence
      const missing = ok(projectCanonicalCoverage(plan, spendingEvidence, 4))
      expect(missing.rows[2].terminalEstateEstimate).toEqual({ status: 'unavailable', reason: 'evidence-missing' })
      expect(ordinaryLedger(missing)).toEqual(ordinaryLedger(settled))
      const sheet = canonicalAnnualSheet(missing, context)
      const cell = sheetRow(sheet.rows, 'value', 'estate').cells![YEAR]
      expect(cell).toMatchObject({ status: 'unknown', value: null })
      expect(new Set(['en', 'fr', 'zh'].map(locale => annualSheetText(cell.reason!, locale))).size).toBe(3)
    }
  })

  type AdmissionFixture = ReturnType<typeof fixture>
  const invalidEvidence: [string, (input: AdmissionFixture) => void][] = [
    ['null year record', ({ plan }) => { Object.assign(plan, { annualTerminalEstateEvidence: { [YEAR]: null } }) }],
    ['undated user provenance', ({ certification }) => {
      certification.provenance = { ...recorded }
      Reflect.deleteProperty(certification.provenance, 'sourceYear')
    }],
    ['future-dated user provenance', ({ certification }) => { certification.provenance = { ...recorded, sourceYear: YEAR } }],
    ['estimated provenance', ({ certification }) => { certification.provenance = { ...recorded, origin: 'estimated' } }],
    ['wrong effective year', ({ certification }) => { certification.effectiveYear = YEAR - 1 }],
    ['survivor as decedent', ({ certification }) => { certification.personId = SURVIVOR }],
    ['self as survivor', ({ certification }) => { certification.survivingPersonId = RETIREE }],
    ['absent self-only scope', ({ certification }) => { delete certification.modeledDecedent }],
    ['inherited no-survivor proof', ({ certification }) => {
      delete certification.noSurvivorProjection
      Object.setPrototypeOf(certification, { noSurvivorProjection: true })
    }],
    ['inherited certificate proof', ({ certification }) => {
      Reflect.deleteProperty(certification, 'certificateRequired')
      Object.setPrototypeOf(certification, { certificateRequired: true })
    }],
    ['incomplete estate', ({ certification }) => { Object.assign(certification, { completeEstate: false }) }],
    ['extra terminal income not excluded', ({ certification }) => {
      Object.assign(certification, { noDeathBenefitsOrOtherTerminalIncome: false })
    }],
    ['missing owned TFSA', ({ certification }) => { delete certification.accounts[TFSA] }],
    ['wrongly matched account owner', ({ certification }) => { certification.accounts[RRSP].ownerId = SURVIVOR }],
    ['extra survivor account', ({ certification }) => {
      certification.accounts[SURVIVOR_TFSA] = { ownerId: SURVIVOR, estateIncluded: true, noBeneficiaryRollover: true, tfsaNoDeathIncome: true }
    }],
    ['inherited asset map key', ({ certification }) => {
      const { [RRSP]: rrsp, ...rest } = certification.accounts
      certification.accounts = Object.assign(Object.create({ [RRSP]: rrsp }), rest)
    }],
    ['non-record asset evidence', ({ certification }) => { Object.assign(certification, { accounts: [] }) }],
    ['asset outside the certificate', ({ certification }) => {
      Object.assign(certification.accounts[TFSA], { estateIncluded: false })
    }],
    ['unproven rollover exclusion', ({ certification }) => {
      Object.assign(certification.accounts[RRSP], { noBeneficiaryRollover: false })
    }],
    ['inherited rollover exclusion', ({ certification }) => {
      const { noBeneficiaryRollover, ...proof } = certification.accounts[RRSP]
      certification.accounts[RRSP] = Object.assign(Object.create({ noBeneficiaryRollover }), proof)
    }],
    ['unproven tax-free date-of-death TFSA', ({ certification }) => { delete certification.accounts[TFSA].tfsaNoDeathIncome }],
  ]

  it.each(invalidEvidence)('keeps the annual ledger with invalid evidence for %s', (_name, mutate) => {
    const input = fixture()
    const { plan, spendingEvidence } = input
    const baseline = ok(projectCanonicalCoverage(plan, spendingEvidence, 3))
    mutate(input)
    const invalid = ok(projectCanonicalCoverage(plan, spendingEvidence, 3))
    expect(invalid.rows[2].terminalEstateEstimate).toEqual({ status: 'unavailable', reason: 'evidence-invalid' })
    expect(ordinaryLedger(invalid)).toEqual(ordinaryLedger(baseline))
  })

  it.each(['absent', 'supported', 'inherited'] as const)('refuses estate pricing with %s spouse-support evidence', kind => {
    const { plan, spendingEvidence } = fixture({ grossDraw: 0 })
    if (kind === 'absent') delete plan.taxProfile
    if (kind === 'supported') plan.taxProfile!.spouseSupported = known(true)
    if (kind === 'inherited') plan.taxProfile!.spouseSupported = Object.assign(Object.create({ value: false }), { status: 'known' })
    const unavailable = ok(projectCanonicalCoverage(plan, spendingEvidence, 3))
    const baseline = ok(projectCanonicalCoverage({ ...withoutEstate(plan), lifeExpectancy: 60 }, spendingEvidence, 3))
    expect(ordinaryLedger(unavailable)).toEqual(ordinaryLedger(baseline))
    if (kind === 'supported') {
      expect(unavailable.rows[2].terminalEstateEstimate).toEqual({ status: 'unavailable', reason: 'unsupported-estate' })
    } else {
      expect(unavailable.blocked).toMatchObject({ year: BASE_YEAR })
    }
  })

  it.each(['both-working', 'mixed'] as const)('keeps a %s terminal row without an estate estimate', phase => {
    const { plan, spendingEvidence } = fixture({ grossDraw: 0 })
    plan.people[1].retirementAge = 58
    if (phase === 'both-working') plan.people[0].retirementAge = 60
    const evidence = { ...spendingEvidence, transitionSpending: known(11_298.65) }
    const coverage = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(coverage.blocked).toBeNull()
    expect(coverage.rows[2]).toMatchObject({
      workingSettlement: { household: { phase } },
      terminalEstateEstimate: { status: 'unavailable', reason: 'unsupported-estate' },
    })
  })

  it('preserves the existing ordinary pension-split rejection before terminal pricing', () => {
    const { plan, spendingEvidence } = fixture()
    plan.taxProfile!.pensionSplit = { transferorId: SURVIVOR, recipientId: RETIREE, amount: 1_000 }
    const coverage = ok(projectCanonicalCoverage(plan, spendingEvidence, 3))
    expect(coverage).toMatchObject({ rows: [], blocked: { year: BASE_YEAR,
      issues: [expect.objectContaining({ detail: expect.stringMatching(/tax election/i) })] } })
    expect(coverage).toEqual(ok(projectCanonicalCoverage(withoutEstate(plan), spendingEvidence, 3)))
  })

  it.each([['constructor', '__proto__'], ['__proto__', 'toString']])(
    'preserves the existing ordinary runner rejection for prototype-sensitive IDs %s and %s', (rrspId, tfsaId) => {
      const { plan, spendingEvidence } = fixture({ rrspId, tfsaId })
      const result = ok(projectCanonicalCoverage(plan, spendingEvidence, 3))
      const baseline = ok(projectCanonicalCoverage(withoutEstate(plan), spendingEvidence, 3))
      expect(result).toEqual(baseline)
      expect(result).toMatchObject({ rows: [], blocked: { year: BASE_YEAR, status: 'invalid',
        issues: [expect.objectContaining({ detail: 'year-end state: snapshot balance or debt term' })] } })
    },
  )

  it('keeps funded survivor registered assets and partner final-return tax out of the self estimate', () => {
    const { plan, spendingEvidence } = fixture({ grossDraw: 0, rrsp: 20_000, tfsa: 20_000 })
    const survivorRrsp = 'survivor:ordinary/RRSP'
    plan.accounts.push({ ...structuredClone(plan.accounts.find(account => account.id === RRSP)!),
      id: survivorRrsp, ownerId: SURVIVOR, balance: 120_000, taxableOwnerShares: { status: 'known', shares: { [SURVIVOR]: 1 } } })
    const coverage = ok(projectCanonicalCoverage(plan, spendingEvidence, 3))
    expect(coverage.blocked).toBeNull()
    const terminal = coverage.rows[2]
    const endCpi = 1.04 ** 3
    const startCpi = 1.04 ** 2
    const selfFinalTax = retirementTax(20_800) * startCpi
    expect(terminal.byAccount[survivorRrsp]).toMatchObject({ ownerId: SURVIVOR, closing: money(120_000 * endCpi), withdrawal: 0 })
    expect(terminal.terminalEstateEstimate).toMatchObject({
      status: 'estimated', closingRegisteredFairMarketValue: money(20_000 * endCpi),
      incrementalFinalReturnIncomeTax: money(selfFinalTax), estateAdministrationTax: 0,
      excludedSurvivorClosingNetWorth: money(210_000 * endCpi), netEstate: money(40_000 * endCpi - selfFinalTax),
    })
    expect(terminal.cashLedger.tax).toBe(0)
  })

  it('preserves the self age-65 credits on the final return with a surviving partner', () => {
    const { plan, certification, spendingEvidence } = fixture({ rrsp: 70_000, tfsa: 20_000, inflation: 0.10 })
    Object.assign(plan.people[0], { ageInBaseYear: 64, retirementAge: 65 })
    plan.lifeExpectancy = 65
    certification.effectiveYear = YEAR - 1
    plan.annualTerminalEstateEvidence = { [YEAR - 1]: certification }
    // Real annual RRSP income is $30,000 and final-return income is $74,000.
    // Federal age amount $9,208 phases out at 15% above $46,432;
    // Ontario's $6,342 phases out at 15% above $47,210.
    const spending = 28_553.6155
    if (plan.budget.kind !== 'incomeBudget') throw new Error('Expected income budget')
    plan.budget.retirementSpending = spending
    const coverage = ok(projectCanonicalCoverage(plan, { ...spendingEvidence, retirementSpending: known(spending) }, 2))
    expect(coverage.blocked).toBeNull()
    const terminal = coverage.rows[1]
    expect(terminal.byPerson[RETIREE]).toMatchObject({ age: 65, taxableIncome: money(33_000), tax: money(1_591.02295) })
    expect(terminal.terminalEstateEstimate).toMatchObject({
      status: 'estimated', closingNetWorth: money(72_600), closingRegisteredFairMarketValue: money(48_400),
      estateAdministrationTax: 345, incrementalFinalReturnIncomeTax: money(12_588.769875), netEstate: money(59_666.230125),
      excludedSurvivorClosingNetWorth: money(108_900),
    })
  })

  it('cannot authenticate a caller-supplied opening or terminal snapshot', () => {
    const { plan, spendingEvidence } = fixture()
    const prefix = ok(projectCanonicalCoverage(plan, spendingEvidence, 2))
    const settled = ok(projectCanonicalCoverage(plan, spendingEvidence, 3))
    const terminal = settled.rows[2]
    expect(terminal.terminalEstateEstimate?.status).toBe('estimated')
    expect(evaluateCanonicalHouseholdWorkingYear(plan, spendingEvidence, YEAR, prefix.state)).toMatchObject({ status: 'unsupported' })
    for (const state of [settled.state, structuredClone(settled.state)]) {
      expect(annualTerminalEstate(plan, state, terminal)).toEqual({ status: 'unavailable', reason: 'unsupported-estate' })
    }
    plan.people.forEach(person => { person.retirementAge = person.ageInBaseYear })
    expect(projectCanonicalCoverage(plan, spendingEvidence, 3)).toMatchObject({ status: 'unsupported' })
  })

  it('keeps provider, standalone retirement and legacy projection paths independent of the estimate', () => {
    const { plan, certification } = fixture()
    const baseline = withoutEstate(plan)
    const opening = ok(initializeState(plan))
    const providers: AnnualProviders = {
      evaluate: () => ({ byPerson: Object.fromEntries(plan.people.map(person => [person.id, {
        income: 0, earnedIncome: 0, benefits: 0, tax: 0, spending: 0, taxableIncome: 0, benefitIncomeForNextYear: known(0),
      }])) }),
      returns: () => 0,
    }
    const providerResult = ok(projectAnnualCoverage(plan, opening, 3, providers))
    expect(providerResult).toEqual(ok(projectAnnualCoverage(baseline, opening, 3, providers)))
    expect(providerResult.rows.every(row => !Object.hasOwn(row, 'terminalEstateEstimate'))).toBe(true)
    expect(projectRetirementCoverage(plan, opening, 3)).toEqual(projectRetirementCoverage(baseline, opening, 3))

    const legacyInputs = plan.legacyProjection
    const legacy = runProjection(legacyInputs, undefined, plan, { captureAnnualDetails: true })
    const legacyBaseline = runProjection(legacyInputs, undefined, baseline, { captureAnnualDetails: true })
    expect(legacy).toEqual(legacyBaseline)
    expect(legacyAnnualSheet(legacy, legacyInputs, context).rows).toEqual(legacyAnnualSheet(legacyBaseline, legacyInputs, context).rows)
    expect(runProjection(legacyInputs, () => -0.1, plan)).toEqual(runProjection(legacyInputs, () => -0.1, baseline))

    const { modeledDecedent: _scope, noSurvivorProjection: _survival, survivingPersonId: _survivor, ...soloEvidence } = certification
    const solo = retirementPlan({ rrsp: 20_000, tfsa: 40_000, inflation: 0 })
    solo.people[0].retirementAge = 58
    solo.budget = { kind: 'incomeBudget', workingSpending: 0, retirementSpending: 0 }
    solo.annualTerminalEstateEvidence = { [YEAR]: soloEvidence }
    const soloResult = ok(projectCanonicalCoverage(solo, { workingSpending: known(0), retirementSpending: known(0) }, 3))
    const receipt = soloResult.rows[2].terminalEstateEstimate
    expect(receipt).toMatchObject({ status: 'estimated', closingNetWorth: 60_000, estateAdministrationTax: 150 })
    expect(receipt).not.toHaveProperty('scope')
    expect(receipt).not.toHaveProperty('excludedSurvivorClosingNetWorth')
    expect(sheetRows(canonicalAnnualSheet(soloResult, context).rows).map(row => row.id))
      .not.toContain(canonicalSheetId('terminalEstate', 'excludedSurvivorClosingNetWorth'))
  })

  it('localizes the self-only endpoint, evidence and memo while showing household wealth separately', () => {
    const { plan, spendingEvidence } = fixture()
    const coverage = ok(projectCanonicalCoverage(plan, spendingEvidence, 3))
    const sheet = canonicalAnnualSheet(coverage, context)
    const startCpi = 1.04 ** 2
    const endCpi = 1.04 ** 3
    const selfGross = 80_000 * endCpi
    const tax = (retirementTax(73_680) - retirementTax(30_000)) * startCpi
    const household = 170_000 * endCpi
    const estate = sheetRow(sheet.rows, 'value', 'estate')
    const column = sheet.years.find(year => year.year === YEAR)!
    for (const [path, nominal] of [
      [['value', 'estate'], selfGross - tax - 600],
      [['value', 'netWorth'], household],
      [['terminalEstate', 'closingNetWorth'], selfGross],
      [['terminalEstate', 'closingRegisteredFairMarketValue'], 42_000 * endCpi],
      [['terminalEstate', 'estateAdministrationTaxBase'], selfGross],
      [['terminalEstate', 'incrementalFinalReturnIncomeTax'], tax],
      [['terminalEstate', 'estateAdministrationTax'], 600],
      [['terminalEstate', 'excludedSurvivorClosingNetWorth'], 90_000 * endCpi],
      [['terminalEstate', 'householdClosingNetWorth'], household],
    ] as const) {
      const cells = sheetRow(sheet.rows, ...path).cells!
      if (path[1] !== 'netWorth') {
        expect(cells[YEAR - 1]).toMatchObject({ status: 'not-applicable', value: null })
        expect(cells[YEAR]).toMatchObject({ status: 'estimated', timing: 'terminal', basis: 'nominal-CAD' })
      }
      expect(annualSheetDisplayValue(cells[YEAR], column, 'nominal')).toBeCloseTo(nominal, 6)
      expect(annualSheetDisplayValue(cells[YEAR], column, 'real')).toBeCloseTo(nominal / endCpi, 6)
    }
    const explanation = sheet.resolveExplanation!(estate.cells![YEAR].explanationRefs![0])!
    expect(explanation).toMatchObject({ projectionYear: YEAR, taxYear: BASE_YEAR, rulePackage: 'CA-ON-tax-2026-legacy-v1' })
    expect(explanation.sources!.filter(source => source.field === 'annualTerminalEstateEvidence.accounts')
      .map(source => source.id).sort()).toEqual([RRSP, TFSA].sort())
    expect(explanation.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'terminalEstateEstimate.scope' }),
      expect.objectContaining({ field: 'annualTerminalEstateEvidence', granularity: 'input' }),
      expect.objectContaining({ displayReference: 'https://www.ontario.ca/page/estate-administration-tax' }),
    ]))
    expect(explanation.formula?.map(step => [step.direction, step.value])).toEqual([
      ['add', money(selfGross)], ['subtract', money(tax)], ['subtract', 600],
    ])
    for (const [locale, self, excluded] of [
      ['en', /self/i, /surviv.*excluded/i],
      ['fr', /membre principal/i, /survi.*exclus/i],
      ['zh', /本人/, /存活.*排除/],
    ] as const) {
      expect(annualSheetText(estate.label, locale)).toMatch(self)
      expect(annualSheetText(explanation.summary!, locale)).toMatch(excluded)
      for (const source of explanation.sources!.filter(item => item.field === 'terminalEstateEstimate.scope' || item.field === 'annualTerminalEstateEvidence')) {
        expect(new Set(['en', 'fr', 'zh'].map(language => annualSheetText(source.label, language))).size).toBe(3)
      }
    }
  })
})

const HOME = 'joint-home'
const MORTGAGE = 'home-fixed-debt'
type HousingCase = 'mortgage' | 'purchase' | 'purchase carry' | 'sale' | 'sale cash carry'

function housingFixture(kind: HousingCase) {
  const { plan, certification, spendingEvidence } = fixture({ inflation: 0, tfsa: 40_000, grossDraw: 0 })
  const carry = kind === 'purchase carry' || kind === 'sale cash carry'
  const endpoint = YEAR + Number(carry)
  if (carry) plan.lifeExpectancy += 1
  certification.effectiveYear = endpoint
  plan.annualTerminalEstateEvidence = { [endpoint]: certification }
  plan.accounts = plan.accounts.filter(account => account.id === TFSA)
  delete certification.accounts[RRSP]
  plan.strategy = 'tfsaFirst'
  const title = { [RETIREE]: 0.75, [SURVIVOR]: 0.25 }
  const home: InputsV2['properties'][number] = {
    id: HOME, kind: 'principal', value: 10_000, acb: known(9_000), annualRent: known(0), appreciation: 0,
    sellAtAge: null, plannedPurchaseAge: null, plannedDownPayment: null, plannedMortgage: null,
    annualHoldingCostChange: 0, mortgageDebtId: null, taxableOwnerShares: { status: 'known', shares: title },
    provenance: { value: recorded, acb: recorded, taxableOwnerShares: recorded },
  }
  plan.properties = [home]
  if (kind === 'mortgage') {
    home.mortgageDebtId = MORTGAGE
    plan.debts = [{ id: MORTGAGE, kind: 'mortgage', principal: 3_000, annualPayment: 1_000,
      yearsRemaining: 3, propertyId: HOME, provenance: recorded }]
    plan.budget = { kind: 'incomeBudget', workingSpending: 21_597.30, retirementSpending: 500 }
    return { plan, endpoint, spendingEvidence: { workingSpending: known(21_597.30), retirementSpending: known(500),
      scheduledMortgagePaymentsExcluded: known(true as const) } }
  }
  if (kind === 'purchase' || kind === 'purchase carry') {
    Object.assign(home, { plannedPurchaseAge: 59, plannedDownPayment: 10_000 })
    plan.annualPrimaryHomePurchaseEvidence = { [HOME]: {
      provenance: recorded, effectiveYear: YEAR, timing: 'start-of-purchase-year', priceNominal: known(10_000),
      qualifyingAcquisitionCostsNominal: known(125), postPurchaseAnnualSpendingReal: known(500), excludesOneTimeCosts: true,
      householdTitle: { shares: title, verified: true, policy: 'user-verified-title', provenance: recorded },
      fundingAuthorization: { accountId: TFSA, ownerId: RETIREE, authorized: true, purpose: 'household-primary-home-purchase', provenance: recorded },
    } }
  } else {
    home.sellAtAge = 59
    plan.annualPrimaryHomeSaleEvidence = { [HOME]: {
      provenance: recorded, effectiveYear: YEAR, timing: 'start-of-sale-year', wholePropertyFullyExcluded: true,
      salePriceBasis: 'opening-year-nominal-value', sellingCostsNominal: known(175), postSaleAnnualSpendingReal: known(500),
      allSaleCashAvailableForJointSpending: true, ownerExclusions: {
        [RETIREE]: { fullyExcluded: true, provenance: recorded }, [SURVIVOR]: { fullyExcluded: true, provenance: recorded },
      },
    } }
  }
  return { plan, endpoint, spendingEvidence }
}

describe('FE-53 housing and benefit estate isolation', () => {
  it.each(['mortgage', 'purchase', 'purchase carry', 'sale', 'sale cash carry'] as const)(
    'keeps the supported %s ledger with incompatible estate evidence', kind => {
      const { plan, endpoint, spendingEvidence } = housingFixture(kind)
      const years = endpoint - BASE_YEAR + 1
      const reference = ok(projectCanonicalCoverage({ ...withoutEstate(plan), lifeExpectancy: plan.lifeExpectancy + 1 }, spendingEvidence, years))
      expect(reference.blocked).toBeNull()

      // Independently reconcile the event amounts before comparing the full ledger.
      // The mortgage is interest-free. Cash purchase draws price, fees and $500
      // living. A sale adds $9,825 to a distinct pool before drawing $500 living.
      const event = reference.rows[2]
      const terminal = reference.rows.at(-1)!
      if (kind === 'mortgage') {
        expect(reference.rows.map(row => row.byDebt[MORTGAGE].closing)).toEqual([2_000, 1_000, 0])
        expect(reference.rows.map(row => row.cashLedger.debtPayments)).toEqual([1_000, 1_000, 1_000])
        expect(reference.rows.map(row => row.byAccount[TFSA].closing)).toEqual([40_000, 38_500, 37_000])
        expect(event.byProperty[HOME]).toMatchObject({ held: true, closing: 10_000 })
      } else if (kind === 'purchase' || kind === 'purchase carry') {
        expect(event.retirementSettlement?.primaryHomePurchase).toMatchObject({ year: YEAR, price: 10_000, totalCost: 10_125, acb: 10_125 })
        expect(event.byAccount[TFSA]).toMatchObject({ opening: 40_000, withdrawal: 10_625, closing: 29_375 })
        expect(event.byProperty[HOME]).toMatchObject({ held: true, closing: 10_000 })
        if (kind === 'purchase carry') {
          expect(terminal.retirementSettlement?.primaryHomePurchase).toBeUndefined()
          expect(terminal.byAccount[TFSA]).toMatchObject({ opening: 29_375, withdrawal: 500, closing: 28_875 })
        }
      } else {
        expect(event.retirementSettlement?.primaryHomeSale).toMatchObject({ year: YEAR, grossProceeds: 10_000,
          netProceeds: 9_825, realizedGain: 825, taxableGain: 0 })
        expect(event.retirementSettlement?.primaryHomeSaleCash).toEqual({ opening: 0, proceedsAdded: 9_825, spendingUsed: 500, closing: 9_325 })
        expect(event.byProperty[HOME]).toMatchObject({ held: false, closing: 0 })
        expect(terminal.byAccount[TFSA]).toMatchObject({ withdrawal: 0, closing: 40_000 })
        if (kind === 'sale cash carry') {
          expect(terminal.retirementSettlement?.primaryHomeSale).toBeUndefined()
          expect(terminal.retirementSettlement?.primaryHomeSaleCash)
            .toEqual({ opening: 9_325, proceedsAdded: 0, spendingUsed: 500, closing: 8_825 })
        }
      }

      const optedIn = ok(projectCanonicalCoverage(plan, spendingEvidence, years))
      expect(optedIn.blocked).toBeNull()
      expect(ordinaryLedger(optedIn)).toEqual(ordinaryLedger(reference))
      expect(optedIn.rows.slice(0, -1).every(row => !Object.hasOwn(row, 'terminalEstateEstimate'))).toBe(true)
      expect(optedIn.rows.at(-1)?.terminalEstateEstimate).toEqual({ status: 'unavailable', reason: 'unsupported-estate' })
      const cells = sheetRow(canonicalAnnualSheet(optedIn, context).rows, 'value', 'estate').cells!
      expect(cells[endpoint - 1]).toMatchObject({ value: null, status: 'not-applicable' })
      expect(cells[endpoint]).toMatchObject({ value: null, status: 'unknown' })
    },
  )

  function benefitsFixture() {
    const input = fixture({ grossDraw: 0, rrsp: 42_000 })
    input.plan.annualBenefitsEvidence = Object.fromEntries(
      input.plan.people.map(person => [person.id, householdBenefitExclusions(person.id)]),
    )
    return input
  }

  const incompatibleBenefits: [string, (plan: InputsV2) => void][] = [
    ['stale zero CPP statement', plan => {
      plan.people[0].cppAmountSource = { ...plan.people[0].cppAmountSource!, source: 'statement',
        premises: { retirementAge: 58 }, premisesNeedReview: true }
    }],
    ['future-dated partner GIS exclusion', plan => {
      plan.annualBenefitsEvidence![SURVIVOR].gis.provenance = { ...recorded, sourceYear: BASE_YEAR + 1 }
    }],
    ['positive GIS eligibility with zero OAS and GIS excluded', plan => {
      plan.annualGisEvidence = { [RETIREE]: { [YEAR]: { eligible: true, residentInCanada: true,
        notSponsored: true, fullOasInPay: true, provenance: recorded } } }
    }],
    ['special RRIF factor proof on the self RRSP', plan => {
      plan.accounts.find(account => account.id === RRSP)!.rrifFactorCategory = known('qualifying')
    }],
    ['special RRIF age election on a surviving partner RRSP', plan => {
      const rrsp = plan.accounts.find(account => account.id === RRSP)!
      plan.accounts.push({ ...structuredClone(rrsp), id: 'survivor-rrsp-special', balance: 0, ownerId: SURVIVOR,
        taxableOwnerShares: { status: 'known', shares: { [SURVIVOR]: 1 } },
        rrifAgeElection: { personId: RETIREE, electedAtOpening: true } })
    }],
  ]

  it.each(incompatibleBenefits)('keeps the zero-benefit ledger with %s', (_name, mutate) => {
    const { plan, spendingEvidence } = benefitsFixture()
    mutate(plan)
    const reference = ok(projectCanonicalCoverage({ ...withoutEstate(plan), lifeExpectancy: 60 }, spendingEvidence, 3))
    expect(reference.blocked).toBeNull()
    const optedIn = ok(projectCanonicalCoverage(plan, spendingEvidence, 3))
    expect(ordinaryLedger(optedIn)).toEqual(ordinaryLedger(reference))
    expect(optedIn.rows[2].cashLedger).toMatchObject({ benefits: 0, income: 0, tax: 0 })
    expect(optedIn.rows[2].terminalEstateEstimate).toEqual({ status: 'unavailable', reason: 'unsupported-estate' })
  })

  const contradictoryEligibility = {
    [YEAR]: { eligible: true, residentInCanada: true, notSponsored: true, fullOasInPay: true, provenance: recorded },
  }

  it.each([
    ['Map with terminal eligibility', new Map([[RETIREE, contradictoryEligibility]])],
    ['empty Map', new Map()],
    ['Date', new Date('2026-01-01T00:00:00.000Z')],
    ['empty Set', new Set()],
  ] as const)('distinguishes a non-record GIS value (%s) from a genuinely empty record', (_name, malformed) => {
    const { plan, spendingEvidence } = benefitsFixture()
    const absent = ok(projectCanonicalCoverage(plan, spendingEvidence, 3))
    plan.annualGisEvidence = {}
    const empty = ok(projectCanonicalCoverage(plan, spendingEvidence, 3))
    Object.assign(plan, { annualGisEvidence: malformed })
    const invalid = ok(projectCanonicalCoverage(plan, spendingEvidence, 3))

    expect(empty.blocked).toBeNull()
    expect(empty.rows[2].terminalEstateEstimate).toMatchObject({
      status: 'estimated', scope: 'self-estate-only', closingNetWorth: money(89_989.12),
      incrementalFinalReturnIncomeTax: money(6_286.0596448), estateAdministrationTax: 600,
      netEstate: money(83_103.0603552),
    })
    expect(empty).toEqual(absent)
    expect(ordinaryLedger(invalid)).toEqual(ordinaryLedger(empty))
    expect(invalid.rows.map(row => row.year)).toEqual([BASE_YEAR, YEAR - 1, YEAR])
    expect(invalid.rows.slice(0, -1).every(row => !Object.hasOwn(row, 'terminalEstateEstimate'))).toBe(true)
    expect(invalid.rows[2].terminalEstateEstimate).toEqual({ status: 'unavailable', reason: 'unsupported-estate' })
    const sheet = canonicalAnnualSheet(invalid, context)
    expect(sheetRow(sheet.rows, 'value', 'estate').cells![YEAR]).toMatchObject({ value: null, status: 'unknown' })
  })

  it.each(['manual', 'statement'] as const)('accepts confirmed zero %s CPP with dated benefit exclusions', source => {
    const { plan, spendingEvidence } = benefitsFixture()
    for (const person of plan.people) {
      person.cppAmountSource = { ...person.cppAmountSource!, source, premises: { retirementAge: person.retirementAge } }
    }
    // Migration records unknown qualification history on otherwise ordinary RRSPs.
    const rrsp = plan.accounts.find(account => account.id === RRSP)!
    rrsp.rrifFactorCategory = { status: 'unknown', reason: 'RRIF qualification history not supplied' }
    rrsp.rrifAgeElection = null
    const optedIn = ok(projectCanonicalCoverage(plan, spendingEvidence, 3))
    expect(optedIn.blocked).toBeNull()
    const terminal = optedIn.rows[2]
    expect(terminal.cashLedger).toMatchObject({ benefits: 0, income: 0, tax: 0 })
    // $80,000 grows to $89,989.12. The certificate pays 40 × $15.
    const gross = 80_000 * 1.04 ** 3
    const delta = retirementTax(42_000 * 1.04) * 1.04 ** 2
    expect(terminal.terminalEstateEstimate).toMatchObject({
      status: 'estimated', closingNetWorth: money(gross), estateAdministrationTax: 600,
      incrementalFinalReturnIncomeTax: money(delta), netEstate: money(gross - delta - 600),
    })
  })

  it('keeps paid survivor OAS in the ordinary ledger and leaves the estimate unavailable', () => {
    const { plan, spendingEvidence } = benefitsFixture()
    Object.assign(plan.people[1], { ageInBaseYear: 63, retirementAge: 64, oasAnnualAt65: 4_000 })
    plan.incomeSources.push({ id: 'survivor-oas-receipt', kind: 'oas', recipientId: SURVIVOR,
      startAge: 65, annualAmount: known(4_000), provenance: recorded })
    if (plan.budget.kind !== 'incomeBudget') throw new Error('Expected income budget')
    plan.budget.retirementSpending = 4_000
    const evidence = { ...spendingEvidence, retirementSpending: known(4_000) }
    const reference = ok(projectCanonicalCoverage({ ...withoutEstate(plan), lifeExpectancy: 60 }, evidence, 3))
    const optedIn = ok(projectCanonicalCoverage(plan, evidence, 3))
    expect(optedIn.blocked).toBeNull()
    expect(ordinaryLedger(optedIn)).toEqual(ordinaryLedger(reference))
    expect(optedIn.rows[2]).toMatchObject({
      byPerson: { [SURVIVOR]: { age: 65, oasGross: money(4_326.40), oasNet: money(4_326.40), tax: 0 } },
      cashLedger: { benefits: money(4_326.40), spending: money(4_326.40), tax: 0 },
      householdWithdrawalSettlement: { withdrawal: 0 },
      terminalEstateEstimate: { status: 'unavailable', reason: 'unsupported-estate' },
    })
  })
})
