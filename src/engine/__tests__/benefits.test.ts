import { describe, expect, it } from 'vitest'
import { runProjection } from '../projection'
import type { Inputs } from '../types'
import { DEVIATION_TOLERANCE } from '../rules'
import {
  OAS_GIS_ALLOWANCE_2026_Q3,
  allowanceAnnual,
  benefitIncomeBasis,
  gisAnnual,
  gisHouseholdCategory,
  gisWorkExemption,
  type BenefitIncomeBasis,
  type GisCategoryOptions,
} from '../benefits'

/** The modelled category, or a failed test when the household is unsupported. */
function categoryOf(result: ReturnType<typeof gisHouseholdCategory>) {
  if (result.status !== 'modeled') throw new Error(`unsupported: ${result.reason}`)
  return result.category
}

/**
 * Assert the engine is within the pack's own stated tolerance of a monthly
 * figure transcribed from a published table. Neither side re-derives the
 * other: the published figure is a literal and the bound is the pack's.
 */
function expectWithinPublished(actual: number | null, publishedMonthly: number, label: string) {
  expect(actual, label).not.toBeNull()
  expect(Math.abs((actual as number) - publishedMonthly * ANNUAL), label)
    .toBeLessThanOrEqual(DEVIATION_TOLERANCE * ANNUAL)
}

/** A modelled basis or a failed test: an unsupported category is never "zero". */
function basis(
  receivingOas: boolean[],
  ages: number[],
  income: number,
  options: GisCategoryOptions & { workIncome?: number } = {},
): BenefitIncomeBasis {
  const result = benefitIncomeBasis(receivingOas, ages, income, options)
  if (result.status !== 'modeled') throw new Error(`unsupported: ${result.reason}`)
  return result
}

/**
 * Independent expected values, transcribed by hand from the published
 * July-September 2026 OAS/GIS/Allowance tables — never produced by the code
 * under test:
 *
 *   ESDC, "Maximum Benefit Amounts and Related Figures - Canada Pension Plan
 *   (2026) and Old Age Security (July to September 2026)", Table 5
 *   https://www.canada.ca/en/employment-social-development/programs/pensions/pension/statistics/2026-quarterly-july-september.html
 *   ESDC open data, "OAS - Table of Benefit Amounts by marital status and
 *   income level", July-September 2026 CSVs (tables 1-4)
 *   https://open.canada.ca/data/en/dataset/dfa4daf1-669e-4514-82cd-982f27707ed0
 *   Old Age Security Act ss. 12, 12.1, 22
 *   https://laws-lois.justice.gc.ca/eng/acts/O-9/section-12.html
 *   https://laws-lois.justice.gc.ca/eng/acts/O-9/section-12.1.html
 *   https://laws-lois.justice.gc.ca/eng/acts/O-9/section-22.html
 *
 * Monthly maxima (Table 5) and the annual income cut-off, per household shape:
 *
 *   single pensioner ........................ 1,123.17 / 22,800
 *   spouse receives an OAS pension ..........   676.09 / 30,096
 *   spouse receives the Allowance ...........   676.09 / 42,144
 *   spouse receives neither ................. 1,123.17 / 54,624
 *   Allowance ............................... 1,428.06 / 42,144
 *
 * No published GIS row is linear in income and none of them is flat: each
 * table reduces from the first dollar (single, both pensioners), from its own
 * top-up band, or in the Allowance row's case only until the pensioner's GIS
 * reaches its own plateau. The engine's reduction is a piecewise-linear FIT to
 * those tables, so this file measures the fit against them rather than
 * restating it: `TABLE_1..TABLE_4` are transcribed published rows (income
 * bracket in dollars, monthly amount in cents) and the deviation tests below
 * fail if the modelled amount drifts past the bound the rule pack records.
 * Keep these as literals: a helper here would only re-derive the code.
 */
const ANNUAL = 12
const SINGLE_MAX = 1123.17 * ANNUAL // 13,478.04
const PENSIONER_COUPLE_MAX_EACH = 676.09 * ANNUAL // 8,113.08
const BOTH_PENSIONERS_MAX = 2 * PENSIONER_COUPLE_MAX_EACH // 16,226.16
const ALLOWANCE_MAX = 1428.06 * ANNUAL // 17,136.72

/**
 * One published income bracket: `[incomeFrom, incomeTo, ...monthlyCents]`.
 * Transcribed from the July-September 2026 ESDC CSVs cited above; every row's
 * amount is published, none is computed. Sampling follows the published
 * brackets themselves (all four tables' first and last brackets, a 960-dollar
 * sweep, and a five-bracket window around every modelled breakpoint), which
 * reproduces each table's full-range maximum exactly.
 */
type PublishedRow = [number, number, ...number[]]

/** ESDC Table 1 (GIS for a single OAS pensioner), July-September 2026, cents per month. */
const TABLE_1_SINGLE: PublishedRow[] = [
  [0, 24, 112317],[24, 48, 112217],[48, 72, 112117],[72, 96, 112017],[960, 984, 108317],
  [1920, 1944, 104317],[1992, 2016, 104017],[2016, 2040, 103917],[2040, 2048, 103817],
  [2048, 2064, 103717],[2064, 2088, 103617],[2880, 2904, 98517],[3840, 3864, 92517],
  [4800, 4824, 86517],[5760, 5784, 80517],[6720, 6744, 74517],[7680, 7704, 68517],
  [8640, 8664, 62517],[9600, 9624, 56517],[10304, 10320, 52117],[10320, 10344, 52017],
  [10344, 10352, 51917],[10352, 10368, 51820],[10368, 10392, 51720],[10560, 10584, 50920],
  [11520, 11544, 46920],[12480, 12504, 42920],[13440, 13464, 38920],[14400, 14424, 34920],
  [15360, 15384, 30920],[16320, 16344, 26920],[17280, 17304, 22920],[18240, 18264, 18920],
  [19200, 19224, 14920],[20160, 20184, 10920],[21120, 21144, 6920],[22080, 22104, 2920],
  [22728, 22752, 220],[22752, 22776, 120],[22776, 22800, 20],
]

/** ESDC Table 2 (GIS for the spouse of an OAS pensioner), per pensioner, cents per month. */
const TABLE_2_BOTH: PublishedRow[] = [
  [0, 48, 67609],[48, 96, 67509],[96, 144, 67409],[144, 192, 67309],[960, 1008, 65609],
  [1920, 1968, 63609],[2880, 2928, 61609],[3840, 3888, 59609],[3984, 4032, 59309],
  [4032, 4080, 59209],[4080, 4096, 59109],[4096, 4128, 59009],[4128, 4176, 58909],
  [4800, 4848, 56809],[5760, 5808, 53809],[6720, 6768, 50809],[7680, 7728, 47809],
  [8640, 8688, 44809],[8704, 8736, 44609],[8736, 8784, 44509],[8784, 8800, 44409],
  [8800, 8832, 44379],[8832, 8880, 44279],[9600, 9648, 42679],[10560, 10608, 40679],
  [11520, 11568, 38679],[12480, 12528, 36679],[13440, 13488, 34679],[14400, 14448, 32679],
  [15360, 15408, 30679],[16320, 16368, 28679],[17280, 17328, 26679],[18240, 18288, 24679],
  [19200, 19248, 22679],[20160, 20208, 20679],[21120, 21168, 18679],[22080, 22128, 16679],
  [23040, 23088, 14679],[24000, 24048, 12679],[24960, 25008, 10679],[25920, 25968, 8679],
  [26880, 26928, 6679],[27840, 27888, 4679],[28800, 28848, 2679],[29760, 29808, 679],
  [29952, 30000, 279],[30000, 30048, 179],[30048, 30096, 79],
]

/** ESDC Table 3 (GIS for the spouse of someone not receiving OAS), cents per month. */
const TABLE_3_NO_OAS: PublishedRow[] = [
  [0, 4096, 112317],[4096, 4192, 112217],[4192, 4288, 112117],[4288, 4384, 112017],
  [8704, 8800, 107417],[8800, 8896, 107317],[8896, 8992, 107217],[8992, 9072, 107117],
  [9072, 9088, 107017],[9600, 9648, 105317],[10560, 10608, 102317],[11520, 11568, 99317],
  [12480, 12528, 96317],[13440, 13488, 93317],[14400, 14448, 90317],[15360, 15408, 87317],
  [16320, 16368, 84317],[17280, 17328, 81317],[18240, 18288, 78317],[19200, 19248, 75317],
  [20160, 20208, 72317],[20608, 20640, 70917],[20640, 20688, 70817],[20688, 20704, 70717],
  [20704, 20736, 70620],[20736, 20784, 70520],[21120, 21168, 69720],[22080, 22128, 67720],
  [23040, 23088, 65720],[24000, 24048, 63720],[24960, 25008, 61720],[25920, 25968, 59720],
  [26880, 26928, 57720],[27840, 27888, 55720],[28800, 28848, 53720],[29760, 29808, 51720],
  [30720, 30768, 49720],[31680, 31728, 47720],[32640, 32688, 45720],[33600, 33648, 43720],
  [34560, 34608, 41720],[35520, 35568, 39720],[36480, 36528, 37720],[37440, 37488, 35720],
  [38400, 38448, 33720],[39360, 39408, 31720],[40320, 40368, 29720],[41280, 41328, 27720],
  [42240, 42288, 25720],[43200, 43248, 23720],[44160, 44208, 21720],[45120, 45168, 19720],
  [46080, 46128, 17720],[47040, 47088, 15720],[48000, 48048, 13720],[48960, 49008, 11720],
  [49920, 49968, 9720],[50880, 50928, 7720],[51840, 51888, 5720],[52800, 52848, 3720],
  [53760, 53808, 1720],[54480, 54528, 220],[54528, 54576, 120],[54576, 54624, 20],
]

/** ESDC Table 4 (GIS and Allowance for a couple), cents per month. */
const TABLE_4_ALLOWANCE: PublishedRow[] = [
  [0, 48, 67609, 142806],[48, 96, 67609, 142506],[96, 144, 67609, 142206],[144, 192, 67609, 141906],
  [960, 1008, 67609, 136806],[1920, 1968, 67609, 130806],[2880, 2928, 67609, 124806],
  [3840, 3888, 67609, 118806],[3984, 4032, 67609, 117906],[4032, 4080, 67609, 117606],
  [4080, 4096, 67609, 117306],[4096, 4128, 67509, 117206],[4128, 4176, 67509, 116906],
  [4800, 4848, 66809, 112006],[5760, 5808, 65809, 105006],[6720, 6768, 64809, 98006],
  [7680, 7728, 63809, 91006],[8640, 8688, 62809, 84006],[8704, 8736, 62709, 83606],
  [8736, 8784, 62709, 83306],[8784, 8800, 62709, 83006],[8800, 8832, 62679, 82976],
  [8832, 8880, 62679, 82676],[9600, 9648, 62679, 77876],[10560, 10608, 62679, 71876],
  [11520, 11568, 62679, 65876],[11904, 11952, 62679, 63476],[11952, 12000, 62679, 63176],
  [12000, 12048, 62679, 62876],[12048, 12096, 62679, 62679],[12096, 12144, 62579, 62579],
  [12480, 12528, 61779, 61779],[13440, 13488, 59779, 59779],[14400, 14448, 57779, 57779],
  [15360, 15408, 55779, 55779],[16320, 16368, 53779, 53779],[17280, 17328, 51779, 51779],
  [18240, 18288, 49779, 49779],[19200, 19248, 47779, 47779],[20160, 20208, 45779, 45779],
  [21120, 21168, 43779, 43779],[22080, 22128, 41779, 41779],[23040, 23088, 39779, 39779],
  [24000, 24048, 37779, 37779],[24960, 25008, 35779, 35779],[25920, 25968, 33779, 33779],
  [26880, 26928, 31779, 31779],[27840, 27888, 29779, 29779],[28800, 28848, 27779, 27779],
  [29568, 29616, 26179, 26179],[29616, 29664, 26079, 26079],[29664, 29712, 25979, 25979],
  [29712, 29760, 25941, 25879],[29760, 29808, 25941, 25779],[30720, 30768, 25941, 23779],
  [31680, 31728, 25941, 21779],[32640, 32688, 25941, 19779],[33600, 33648, 25941, 17779],
  [34560, 34608, 25941, 15779],[35520, 35568, 25941, 13779],[36480, 36528, 25941, 11779],
  [37440, 37488, 25941, 9779],[38400, 38448, 25941, 7779],[39360, 39408, 25941, 5779],
  [40320, 40368, 25941, 3779],[41280, 41328, 25941, 1779],[42000, 42048, 25941, 279],
  [42048, 42096, 25941, 179],[42096, 42144, 25941, 79],
]


const base: Inputs = {
  currentAge: 35,
  fireAge: 45,
  lifeExpectancy: 90,
  province: 'ON',
  annualSavings: 40000,
  savingsSplit: { tfsa: 0.3, rrsp: 0.5, nonReg: 0.2 },
  retirementSpending: 50000,
  returns: { tfsa: 0.05, rrsp: 0.05, nonReg: 0.05 },
  balances: { tfsa: 100000, rrsp: 200000, nonReg: 100000 },
  nonRegBook: 80000,
  cppStartAge: 65,
  cppAnnualAt65: 10000,
  oasStartAge: 65,
  oasAnnualAt65: 8700,
  strategy: 'rrspFirst' as const,
}

/**
 * A zero-taxable-income household: TFSA funds all spending, CPP is deferred to
 * 70 and there is no RRSP draw, so the GIS income test sees exactly $0 and the
 * result isolates the category rule. The partner's OAS start age controls
 * whether they are a pensioner at the age under test.
 */
function zeroIncomeCouple(partner: {
  currentAge: number
  oasStartAge: number
}): Inputs {
  return {
    ...base,
    currentAge: 65,
    fireAge: 65,
    lifeExpectancy: 75,
    cppStartAge: 70,
    cppAnnualAt65: 0,
    oasStartAge: 65,
    oasAnnualAt65: 9024,
    retirementSpending: 0,
    annualSavings: 0,
    savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 },
    balances: { tfsa: 500000, rrsp: 0, nonReg: 0 },
    nonRegBook: 0,
    strategy: 'tfsaFirst' as const,
    partner: {
      currentAge: partner.currentAge,
      cppStartAge: 70,
      cppAnnualAt65: 0,
      oasStartAge: partner.oasStartAge,
      oasAnnualAt65: 9024,
    },
  }
}

const rowAt = (r: ReturnType<typeof runProjection>, age: number) =>
  r.rows.find((row) => row.age === age)!

describe('benefit household categories', () => {
  it('classifies every supported household shape from age, OAS and Allowance status', () => {
    const cases: [boolean[], number[], GisCategoryOptions, string][] = [
      [[true], [67], {}, 'single'],
      [[true, true], [67, 66], {}, 'couple-both-pensioners'],
      // Exactly one pensioner, the other 60-64: the Allowance row.
      [[true, false], [67, 62], {}, 'couple-partner-allowance'],
      [[true, false], [67, 64], {}, 'couple-partner-allowance'],
      // ...unless receipt is pinned off or the income test says it is not in
      // pay: then the 54,624 row.
      [[true, false], [67, 62], { receivingAllowance: false }, 'couple-partner-no-oas-no-allowance'],
      [[true, false], [67, 60], { receivingAllowance: false }, 'couple-partner-no-oas-no-allowance'],
      [[true, false], [67, 59], {}, 'couple-partner-no-oas-no-allowance'],
      [[true, false], [67, 62], { grossIncome: 50000 }, 'couple-partner-no-oas-no-allowance'],
      [[true, false], [67, 62], { grossIncome: 1000 }, 'couple-partner-allowance'],
      [[true, false], [67, 62], { receivingAllowance: true }, 'couple-partner-allowance'],
      // A pin decides the row without ages; the ages alone decide it without a
      // pin. Neither is guessed.
      [[true, false], [], { receivingAllowance: false }, 'couple-partner-no-oas-no-allowance'],
    ]
    for (const [oas, ages, options, expected] of cases) {
      expect([oas, ages, options, categoryOf(gisHouseholdCategory(oas, ages, options))])
        .toEqual([oas, ages, options, expected])
    }
    // Nobody receives OAS: the supplement requires it, and that is a real zero
    // rather than an unknown.
    expect(gisHouseholdCategory([false, false], [64, 62]).status).toBe('none')
    expect(gisHouseholdCategory([], []).status).toBe('none')
    // A one-pensioner couple whose ages were not supplied is unknown, and the
    // reason names the fact that is missing.
    const unknown = gisHouseholdCategory([true, false], [])
    expect(unknown.status).toBe('unsupported')
    expect(unknown.status === 'unsupported' && unknown.reason).toContain('need both ages')
    // Pinning the Allowance *on* still needs both ages (its row's maximum is
    // the 60-64 spouse's), so that one is unknown too.
    expect(gisHouseholdCategory([true, false], [], { receivingAllowance: true }).status)
      .toBe('unsupported')
    // `gisAnnual` refuses the same household instead of inventing an age.
    expect(gisAnnual([true, false], 0, 0)).toBeNull()
    expect(gisAnnual([true, false], 0, 0, { agesPerPerson: [67, 62] }))
      .toBeCloseTo(PENSIONER_COUPLE_MAX_EACH + ALLOWANCE_MAX, 6)
  })

  it('pins the published July-September 2026 parameters with their category', () => {
    const pack = OAS_GIS_ALLOWANCE_2026_Q3
    expect(pack.paymentPeriod).toBe('2026-07/2026-09')
    expect(pack.basedOnIncomeYear).toBe(2025)
    expect(pack.categories.single.maxMonthly).toBe(1123.17)
    expect(pack.categories.single.annualCutoff).toBe(22800)
    // Published per pensioner (676.09); this pack stores the household figure,
    // which is two of them because each pensioner receives one.
    expect(pack.categories['couple-both-pensioners'].maxMonthly).toBe(2 * 676.09)
    expect(pack.categories['couple-both-pensioners'].maxMonthly * ANNUAL).toBeCloseTo(BOTH_PENSIONERS_MAX, 6)
    expect(pack.categories['couple-both-pensioners'].annualCutoff).toBe(30096)
    expect(pack.categories['couple-partner-allowance'].maxMonthly).toBe(676.09)
    expect(pack.categories['couple-partner-allowance'].annualCutoff).toBe(42144)
    expect(pack.categories['couple-partner-no-oas-no-allowance'].maxMonthly).toBe(1123.17)
    expect(pack.categories['couple-partner-no-oas-no-allowance'].annualCutoff).toBe(54624)
    expect(pack.allowance.maxMonthly).toBe(1428.06)
    expect(pack.allowance.annualCutoff).toBe(42144)
    expect(pack.allowance.topUpIncome).toBe(8800)
  })

  it('sources the published figures and the fitted segments separately', () => {
    const pack = OAS_GIS_ALLOWANCE_2026_Q3
    // Maximums, cut-offs and top-up incomes are Table 5 of the quarterly page;
    // a reduction segment is fitted, so it cites the table of monthly amounts
    // it was fitted to, never the page that publishes only the endpoints.
    for (const rule of Object.values(pack.categories)) {
      expect(rule.fieldSources.maxMonthly).toContain('2026-quarterly-july-september')
      expect(rule.fieldSources.annualCutoff).toContain('2026-quarterly-july-september')
      expect(rule.fieldSources.reductionSegments).toContain('open.canada.ca')
      expect(rule.fieldSources.reductionSegments).toMatch(/table[1-4]_/)
    }
    expect(pack.categories.single.fieldSources.reductionSegments).toContain('table1_')
    expect(pack.categories['couple-both-pensioners'].fieldSources.reductionSegments).toContain('table2_')
    expect(pack.categories['couple-partner-no-oas-no-allowance'].fieldSources.reductionSegments).toContain('table3_')
    expect(pack.categories['couple-partner-allowance'].fieldSources.reductionSegments).toContain('table4_')
    expect(pack.allowance.fieldSources.maxMonthly).toContain('allowance/benefit-amount')
    expect(pack.allowance.fieldSources.topUpIncome).toContain('2026-quarterly-july-september')
    expect(pack.allowance.fieldSources.reductionSegments).toContain('table4_')
  })

  it('names every path it does not model as an explicit unsupported reason', () => {
    const pack = OAS_GIS_ALLOWANCE_2026_Q3
    // The four BE-26 B paths, each machine-readable so a caller can surface it,
    // rather than prose buried in `limitation`.
    expect(pack.unsupportedPaths.map(path => path.id)).toEqual([
      'prior-year-base-period', 'retirement-year-income-estimate',
      'ccb-historical-income', 'provincial-top-ups',
    ])
    for (const path of pack.unsupportedPaths) {
      expect(path.reason.length).toBeGreaterThan(20)
    }
    // The limitation still describes the pack, and now states the fitted bound
    // it actually holds to rather than a hand-written number.
    expect(pack.limitation).toContain('Not modelled')
    for (const rule of Object.values(pack.categories)) {
      expect(pack.limitation).toContain(`$${rule.maxMonthlyDeviation.toFixed(2)}`)
    }
    expect(pack.limitation).toContain(`$${pack.allowance.maxMonthlyDeviation.toFixed(2)}`)
  })
})

describe('GIS by household category', () => {
  it('P15: the 65/60 zero-income couple gets the allowance-category GIS and the Allowance', () => {
    // One pensioner at 65, the other 60-64 drawing the Allowance: Table 5 row
    // "spouse receives the Allowance" -> 676.09/month, 42,144 income cut-off;
    // the Allowance is 1,428.06/month, same income cut-off.
    const r = runProjection(zeroIncomeCouple({ currentAge: 60, oasStartAge: 65 }))
    expect(rowAt(r, 65).gis).toBeCloseTo(PENSIONER_COUPLE_MAX_EACH + ALLOWANCE_MAX, 2) // 25,249.80
    expect(basis([true, false], [65, 60], 0).category).toBe('couple-partner-allowance')
    expect(basis([true, false], [65, 60], 0).gis).toBeCloseTo(8113.08, 2)
    expect(basis([true, false], [65, 60], 0).allowance).toBeCloseTo(17136.72, 2)
  })

  it('uses the single maximum for one person and one per pensioner for two', () => {
    const single = basis([true], [67], 0)
    expect([single.category, single.gis]).toEqual(['single', SINGLE_MAX])
    const both = basis([true, true], [67, 66], 0)
    expect(both.gis).toBeCloseTo(2 * PENSIONER_COUPLE_MAX_EACH, 2) // 16,226.16
    expect([both.category, both.allowance]).toEqual(['couple-both-pensioners', 0])
  })

  it('audit case: the one-pensioner spouse with no OAS and no Allowance uses the 54,624 cut-off', () => {
    const options = { receivingAllowance: false }
    const auditCase = basis([true, false], [67, 60], 0, options)
    expect(auditCase.category).toBe('couple-partner-no-oas-no-allowance')
    expect(auditCase.gis).toBeCloseTo(SINGLE_MAX, 2) // same maximum as a single
    expect(auditCase.allowance).toBe(0)
    // Applying the single 22,800 cut-off would zero this row at 22,800; the
    // audit measured that understatement. The row runs to its own 54,624.
    // Published Table 3 pays 662.20/month at 22,800 and 512.20 at 30,000 —
    // where the single table would already be at zero. The engine reproduces
    // both to the cent, and still runs to its own 54,624.
    expect(gisAnnual([true, false], 22800, 0, options)).toBeCloseTo(662.20 * ANNUAL, 0)
    expect(gisAnnual([true, false], 30000, 0, options)).toBeCloseTo(512.20 * ANNUAL, 0)
    expect(gisAnnual([true, false], 54624, 0, options)).toBe(0)
    expect(gisAnnual([true, false], 54625, 0, options)).toBe(0)
    expectWithinPublished(gisAnnual([true, false], 20000, 0, options), 729.17, 'Table 3 at 20,000')
    expectWithinPublished(gisAnnual([true, false], 40000, 0, options), 304.20, 'Table 3 at 40,000')
  })

  it('chooses each category cut-off instead of applying one cut-off to every shape', () => {
    // At 35,000 joint income the both-pensioners row is already out while both
    // one-pensioner rows are still paying: one shared cut-off cannot give all
    // three answers. Published Table 4 and Table 3 both pay 408.20/month
    // there, which is also why the two rows hand off continuously.
    expect(basis([true, false], [67, 62], 35000).category).toBe('couple-partner-allowance')
    expect(basis([true, false], [67, 60], 35000, { receivingAllowance: false }).category)
      .toBe('couple-partner-no-oas-no-allowance')
    expectWithinPublished(gisAnnual([true, false], 35000, 0, { agesPerPerson: [67, 62] }),
      408.20, 'Table 4 at 35,000')
    expectWithinPublished(gisAnnual([true, false], 35000, 0, { receivingAllowance: false }),
      408.20, 'Table 3 at 35,000')
    expect(gisAnnual([true, true], 35000)).toBe(0)
    // At 30,096 the both-pensioners row is exactly out; the one-pensioner rows
    // are not.
    expect(gisAnnual([true, false], 30096, 0, { receivingAllowance: false }))
      .toBeCloseTo(510.20 * ANNUAL, 0)
    expect(basis([true, false], [67, 62], 30096).category).toBe('couple-partner-allowance')
    expectWithinPublished(gisAnnual([true], 20000), 116.20, 'Table 1 at 20,000')
  })

  it('keeps the Allowance on its own maximum and cut-off, never a GIS maximum', () => {
    const allowanceCase = basis([true, false], [67, 62], 0)
    expect(allowanceCase.category).toBe('couple-partner-allowance')
    expect(allowanceCase.allowance).toBeCloseTo(ALLOWANCE_MAX, 2) // 17,136.72
    // The Allowance is neither the single GIS maximum nor the pensioner-couple one.
    expect(allowanceCase.allowance).not.toBeCloseTo(SINGLE_MAX, 2)
    expect(allowanceCase.allowance).not.toBeCloseTo(2 * PENSIONER_COUPLE_MAX_EACH, 2)
    expect(allowanceAnnual([true, false], [67, 62], 42144)).toBe(0)
    expect(allowanceAnnual([true, false], [67, 62], 100000)).toBe(0)
    expect(allowanceAnnual([true, false], [67, 62], 0)).toBeGreaterThan(17000)
  })

  it('pays nothing when neither spouse receives OAS, and never calls that unknown', () => {
    expect(gisAnnual([false, false], 0)).toBe(0)
    expect(allowanceAnnual([false, false], [64, 62], 0)).toBe(0)
    expect(gisAnnual([], 0)).toBe(0)
    // A single pensioner has no Allowance and never needed ages.
    expect(allowanceAnnual([true], [67], 0)).toBe(0)
    expect(benefitIncomeBasis([false, false], [64, 62], 0).status).toBe('none')
    // The Allowance's own zero at 42,144 is a real zero, but the same call for
    // a household whose ages are unknown is an unknown.
    expect(allowanceAnnual([true, false], [67, 62], 42144)).toBe(0)
    expect(allowanceAnnual([true, false], [], 0)).toBeNull()
  })
})

/**
 * The modelled monthly amount at an income, and the published one, for one
 * category. `published` returns cents for the bracket containing `income`.
 */
type BasisOptions = GisCategoryOptions & { agesPerPerson?: number[] }

function modelledMonthly(income: number, receivingOas: boolean[], ages: number[],
  options: BasisOptions = {}): number {
  const result = benefitIncomeBasis(receivingOas, ages, income, options)
  if (result.status !== 'modeled') throw new Error(`unsupported: ${result.reason}`)
  return result.gis + result.allowance
}

/**
 * The worst monthly gap between a modelled category and its published table,
 * measured at both ends of every published bracket. The tables are $1 step
 * functions, so a continuous fit that reproduces the published maximum
 * exactly is at most one step away inside the widest bracket; this measures
 * that honestly instead of sampling only bracket starts.
 */
function worstDeviation(rows: PublishedRow[], kind: 'gis' | 'allowance' | 'total',
  receivingOas: boolean[], ages: number[], options: BasisOptions = {},
  perPensioner = false): { deviation: number; income: number; published: number } {
  let worst = { deviation: 0, income: 0, published: 0 }
  for (const [from, to, ...cents] of rows) {
    for (const income of [from, to]) {
      const result = benefitIncomeBasis(receivingOas, ages, income, options)
      if (result.status !== 'modeled') throw new Error(`unsupported at ${income}: ${result.reason}`)
      const published = kind === 'allowance'
        ? cents[1] / 100 * (perPensioner ? 2 : 1)
        : kind === 'gis'
          ? cents[0] / 100 * (perPensioner ? 2 : 1)
          : (cents[0] + cents[1]) / 100
      const modelled = (kind === 'allowance' ? result.allowance
        : kind === 'gis' ? result.gis : result.gis + result.allowance) / ANNUAL
      const deviation = Math.abs(modelled - published)
      if (deviation > worst.deviation) worst = { deviation, income, published }
    }
  }
  return worst
}

describe('the fitted reduction tracks each published table across its whole range', () => {
  it('single pensioner, against published Table 1', () => {
    const worst = worstDeviation(TABLE_1_SINGLE, 'gis', [true], [67])
    const recorded = OAS_GIS_ALLOWANCE_2026_Q3.categories.single.maxMonthlyDeviation
    expect(worst.deviation).toBeLessThanOrEqual(recorded + 1e-9)
    expect(worst.deviation).toBeLessThanOrEqual(DEVIATION_TOLERANCE)
    // Regression bite: the model this replaced was $229.34 a month out at
    // 10,368 of income, and the old shared single line $95.22.
    expect(worstDeviation(TABLE_1_SINGLE, 'gis', [true], [67]).deviation).toBeLessThan(2)
  })

  it('two pensioners, against published Table 2 (per pensioner, doubled)', () => {
    const worst = worstDeviation(TABLE_2_BOTH, 'gis', [true, true], [67, 66], {}, true)
    const recorded = OAS_GIS_ALLOWANCE_2026_Q3.categories['couple-both-pensioners'].maxMonthlyDeviation
    expect(worst.deviation).toBeLessThanOrEqual(recorded + 1e-9)
    expect(worst.deviation).toBeLessThanOrEqual(DEVIATION_TOLERANCE)
  })

  it('one pensioner, spouse with neither OAS nor the Allowance, against published Table 3', () => {
    const worst = worstDeviation(TABLE_3_NO_OAS, 'gis', [true, false], [67, 60], { receivingAllowance: false })
    const recorded = OAS_GIS_ALLOWANCE_2026_Q3.categories['couple-partner-no-oas-no-allowance'].maxMonthlyDeviation
    expect(worst.deviation).toBeLessThanOrEqual(recorded + 1e-9)
    expect(worst.deviation).toBeLessThanOrEqual(DEVIATION_TOLERANCE)
  })

  it('one pensioner with an Allowance spouse, against published Table 4', () => {
    const pack = OAS_GIS_ALLOWANCE_2026_Q3
    const options = { agesPerPerson: [67, 62] }
    // Both columns, and the household total the projection adds to cash.
    const gis = worstDeviation(TABLE_4_ALLOWANCE, 'gis', [true, false], [67, 62], options)
    const allowance = worstDeviation(TABLE_4_ALLOWANCE, 'allowance', [true, false], [67, 62], options)
    const total = worstDeviation(TABLE_4_ALLOWANCE, 'total', [true, false], [67, 62], options)
    expect(gis.deviation).toBeLessThanOrEqual(pack.categories['couple-partner-allowance'].maxMonthlyDeviation + 1e-9)
    expect(allowance.deviation).toBeLessThanOrEqual(pack.allowance.maxMonthlyDeviation + 1e-9)
    // The category's recorded bound is the household total's, which is what the
    // projection actually pays and what used to be $711.55/month out.
    expect(total.deviation).toBeLessThanOrEqual(pack.categories['couple-partner-allowance'].maxMonthlyDeviation + 1e-9)
    expect(total.deviation).toBeLessThanOrEqual(DEVIATION_TOLERANCE)
  })

  it('records, for every category, the bound the test above just measured', () => {
    // The pack's `maxMonthlyDeviation` is a claim; this pins each claim to the
    // measurement so the limitation text cannot drift away from the model.
    const pack = OAS_GIS_ALLOWANCE_2026_Q3
    const measured: [string, number, number][] = [
      ['single', worstDeviation(TABLE_1_SINGLE, 'gis', [true], [67]).deviation,
        pack.categories.single.maxMonthlyDeviation],
      ['couple-both-pensioners', worstDeviation(TABLE_2_BOTH, 'gis', [true, true], [67, 66], {}, true).deviation,
        pack.categories['couple-both-pensioners'].maxMonthlyDeviation],
      ['couple-partner-no-oas-no-allowance',
        worstDeviation(TABLE_3_NO_OAS, 'gis', [true, false], [67, 60], { receivingAllowance: false }).deviation,
        pack.categories['couple-partner-no-oas-no-allowance'].maxMonthlyDeviation],
      ['couple-partner-allowance',
        worstDeviation(TABLE_4_ALLOWANCE, 'total', [true, false], [67, 62], { agesPerPerson: [67, 62] }).deviation,
        pack.categories['couple-partner-allowance'].maxMonthlyDeviation],
      ['allowance',
        worstDeviation(TABLE_4_ALLOWANCE, 'allowance', [true, false], [67, 62], { agesPerPerson: [67, 62] }).deviation,
        pack.allowance.maxMonthlyDeviation],
    ]
    for (const [name, measuredDeviation, recorded] of measured) {
      // Recorded is a small ceiling above the measurement, never a stale number.
      expect(measuredDeviation, name).toBeLessThanOrEqual(recorded + 1e-9)
      expect(recorded - measuredDeviation, name).toBeLessThan(0.25)
    }
  })
})

describe('every category reduces from the published maximum to its own cut-off', () => {
  it('single: the published 22,800 cut-off, with no flat band', () => {
    expect(gisAnnual([true], 0)).toBeCloseTo(SINGLE_MAX, 2)
    // The cited table falls from the first $24 bracket, so a flat band here
    // would be a fabrication: the model must reduce from the first dollar.
    expect(gisAnnual([true], 24)!).toBeLessThan(SINGLE_MAX)
    expect(gisAnnual([true], 22800)).toBe(0)
    expect(gisAnnual([true], 22801)).toBe(0)
    expect(gisAnnual([true], 15000)!).toBeGreaterThan(0)
  })

  it('both pensioners: the published 30,096 cut-off from the first dollar', () => {
    expect(gisAnnual([true, true], 0)).toBeCloseTo(BOTH_PENSIONERS_MAX, 2)
    expect(gisAnnual([true, true], 48)!).toBeLessThan(BOTH_PENSIONERS_MAX)
    expect(gisAnnual([true, true], 30096)).toBe(0)
    expect(gisAnnual([true, true], 30097)).toBe(0)
  })

  it('one pensioner / spouse with no OAS and no Allowance: the 54,624 cut-off', () => {
    const options = { receivingAllowance: false }
    expect(gisAnnual([true, false], 4096, 0, options)).toBeCloseTo(SINGLE_MAX, 2)
    expect(gisAnnual([true, false], 54624, 0, options)).toBe(0)
    expect(gisAnnual([true, false], 54625, 0, options)).toBe(0)
    // Its published top-up income cut-off is 20,704, and the fit passes through
    // the published amount there rather than treating 4,096 as a long flat band.
    expect(basis([true, false], [67, 60], 20704, options).gis / ANNUAL).toBeCloseTo(705.87, 1)
  })

  it('one pensioner / Allowance spouse: the Allowance ends at 42,144, the GIS does not', () => {
    const options: BasisOptions = { agesPerPerson: [67, 62] }
    const total = (income: number) => modelledMonthly(income, [true, false], [67, 62], options)
    expect(total(0)).toBeCloseTo(PENSIONER_COUPLE_MAX_EACH + ALLOWANCE_MAX, 6)
    // The Allowance's own 8,800 top-up income is where it starts reducing, and
    // the pensioner's GIS is already below its maximum by then.
    expect(basis([true, false], [67, 62], 8800, options).allowance).toBeLessThan(ALLOWANCE_MAX)
    expect(basis([true, false], [67, 62], 8800, options).gis).toBeLessThan(PENSIONER_COUPLE_MAX_EACH)
    expect(basis([true, false], [67, 62], 42144, options).allowance).toBe(0)
    expect(total(42144)).toBeGreaterThan(0)
    expect(total(54624)).toBe(0)
  })
})

describe('the household benefit is monotone non-increasing in income', () => {
  /** The projection's GIS + Allowance slot for one income, whatever row applies. */
  const household = (income: number, ages: number[]) =>
    modelledMonthly(income, [true, false], ages, { agesPerPerson: ages })

  it('sweeps every dollar across the Allowance cut-off with no increase', () => {
    // The defect: 42,143 paid 8,113.59 and 42,144 paid 3,328.96, so one extra
    // dollar of income cut the benefit by 4,784.63. The published tables are
    // continuous across the hand-off (Table 4 and Table 3 both pay the same
    // amount at 42,096), so the modelled curve must not rise either.
    let previous = household(40000, [67, 62])
    for (let income = 40001; income <= 46000; income += 1) {
      const current = household(income, [67, 62])
      expect(current, `income ${income}`).toBeLessThanOrEqual(previous + 1e-9)
      previous = current
    }
    // And the hand-off itself is the published one: a drop of one $1 step at
    // most, not the 4,784.63/yr cliff the model used to have.
    const justBelow = household(42143, [67, 62])
    const atCutoff = household(42144, [67, 62])
    expect(justBelow - atCutoff).toBeGreaterThanOrEqual(0)
    expect(justBelow - atCutoff).toBeLessThanOrEqual(ANNUAL)
  })

  it('stays non-increasing across every category whole income range', () => {
    const sweeps: [string, (income: number) => number, number][] = [
      ['single', (income) => basis([true], [67], income).gis, 22800],
      ['couple-both-pensioners', (income) => basis([true, true], [67, 66], income).gis, 30096],
      ['couple-partner-no-oas-no-allowance',
        (income) => basis([true, false], [67, 60], income, { receivingAllowance: false }).gis, 54624],
    ]
    for (const [name, amount, cutoff] of sweeps) {
      let previous = amount(0)
      for (let income = 1; income <= cutoff; income += 1) {
        const current = amount(income)
        expect(current, `${name} at ${income}`).toBeLessThanOrEqual(previous + 1e-9)
        previous = current
      }
      // Every one of these rows pays nothing at and past its own cut-off. The
      // Allowance row is the exception by design: it hands off to the
      // spouse-with-neither row, which is the sweep above.
      expect(amount(cutoff + 1), `${name} past its cut-off`).toBe(0)
    }
    expect(household(42143, [67, 62])).toBeGreaterThan(0)
  })
})

describe('GIS work-income exemption', () => {
  it('is the first 5,000 plus half of the next 10,000', () => {
    expect(gisWorkExemption(0)).toBe(0)
    expect(gisWorkExemption(4000)).toBe(4000)
    expect(gisWorkExemption(5000)).toBe(5000)
    expect(gisWorkExemption(5001)).toBe(5000.5)
    expect(gisWorkExemption(15000)).toBe(10000)
    expect(gisWorkExemption(20000)).toBe(10000)
    expect(gisWorkExemption(-100)).toBe(0)
  })

  it('applies just below, at, and just above the 5,000 and 15,000 boundaries', () => {
    // Household income 10,000 with only work income: the exemption removes it
    // all, so the countable income is 10,000 - exemption.
    // The expected amount is the engine's own amount at that countable income:
    // this pins the exemption arithmetic, not the reduction shape, which the
    // published-table tests above already cover.
    const gis = (work: number) => gisAnnual([true], 10000, work)
    const expected = (work: number) => {
      const countable = Math.max(0, 10000 - gisWorkExemption(work))
      return basis([true], [67], countable).gis
    }
    // Just below, at, and just above the 5,000 boundary of the exemption.
    expect(gis(9999)).toBeCloseTo(expected(9999), 6)
    expect(gis(10000)).toBeCloseTo(expected(10000), 6)
    expect(gis(10001)).toBeCloseTo(expected(10001), 6)
    // The exemption never exceeds 10,000, so 20,000 of work income leaves
    // 10,000 countable and the household is still below its 22,800 cut-off.
    expect(gis(20000)).toBeCloseTo(expected(20000), 6)
    expect(gis(20000)).toBeCloseTo(gisAnnual([true], 0)!, 6)
    expect(gisWorkExemption(15000)).toBe(gisWorkExemption(50000))
  })

  it('does not leak into a category it does not belong to', () => {
    // The exemption is the same statutory rule for every category, so the
    // comparison must be category-for-category, not shape-for-shape.
    const withWork = basis([true, false], [67, 60], 0, {
      workIncome: 10000, receivingAllowance: false,
    })
    expect(withWork.category).toBe('couple-partner-no-oas-no-allowance')
    expect(withWork.countableIncome).toBe(0)
    expect(withWork.gis).toBeCloseTo(SINGLE_MAX, 2)
  })
})

describe('runProjection carries the category through to the year rows', () => {
  it('states the household row and its cut-off on each benefit year', () => {
    const r = runProjection(zeroIncomeCouple({ currentAge: 60, oasStartAge: 65 }))
    const at65 = rowAt(r, 65)
    expect(at65.gisCategory).toBe('couple-partner-allowance')
    expect(at65.gisAnnualCutoff).toBe(42144)
    expect(at65.allowance).toBeCloseTo(17136.72, 2)
    expect(at65.gis - at65.allowance).toBeCloseTo(8113.08, 2)
    // Once the spouse turns 65 the row changes with its own cut-off.
    const at70 = rowAt(r, 70)
    expect(at70.gisCategory).toBe('couple-both-pensioners')
    expect(at70.gisAnnualCutoff).toBe(30096)
    expect(at70.allowance).toBe(0)
  })

  it('P15 reproduction: a 65/60 couple with no taxable income', () => {
    const r = runProjection(zeroIncomeCouple({ currentAge: 60, oasStartAge: 65 }))
    // The projection starts at 65 here, so every row is past the primary's
    // OAS start age; at 65 the partner is 60 and the household is the
    // allowance row.
    expect(rowAt(r, 65).gis).toBeCloseTo(25249.8, 2)
    expect(rowAt(r, 65).oas).toBeCloseTo(9024, 2)
  })

  it('the audit case, priced directly: no Allowance in pay, its own 54,624 cut-off', () => {
    // The engine cannot see a 60-64 spouse who declines the Allowance while
    // the income test says one would be payable, so the audit's household is
    // priced through the same basis the projection uses, with receipt pinned
    // off: the Allowance drops to zero and the pensioner's GIS takes the row
    // whose own cut-off is 54,624 rather than the single 22,800 or 30,096.
    const audit = basis([true, false], [65, 60], 0, { receivingAllowance: false })
    expect(audit.category).toBe('couple-partner-no-oas-no-allowance')
    expect(audit.allowance).toBe(0)
    expect(audit.annualCutoff).toBe(54624)
    expect(audit.gis).toBeCloseTo(13478.04, 2)
    // A household at the pensioners' 30,096 cut-off would already be at zero
    // under the wrong row; the right row is still paying.
    // Published Table 3 pays 510.20/month there, which the engine reproduces.
    expect(basis([true, false], [65, 60], 30096, { receivingAllowance: false }).gis)
      .toBeCloseTo(510.20 * ANNUAL, 2)
  })

  it('a single-person plan stays on the single row', () => {
    const r = runProjection({ ...base, currentAge: 67, fireAge: 67, lifeExpectancy: 70,
      cppStartAge: 70, cppAnnualAt65: 0, retirementSpending: 0, annualSavings: 0,
      savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 }, balances: { tfsa: 200000, rrsp: 0, nonReg: 0 },
      nonRegBook: 0, strategy: 'tfsaFirst' as const })
    const at67 = rowAt(r, 67)
    expect(at67.gisCategory).toBe('single')
    expect(at67.gisAnnualCutoff).toBe(22800)
    expect(at67.gis).toBeCloseTo(13478.04, 2)
    expect(at67.allowance).toBe(0)
  })
})
