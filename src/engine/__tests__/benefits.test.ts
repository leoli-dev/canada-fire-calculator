import { describe, expect, it } from 'vitest'
import { runProjection } from '../projection'
import type { Inputs } from '../types'
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
 * The tabled GIS answers are exactly 1/2 (single), 1/4 (both pensioners) and
 * 1/8 (spouse with neither) of the annual joint income, so those shapes are
 * linear in income; only the "spouse receives the Allowance" shape has a flat
 * GIS. Keep these as literals: a helper here would only re-derive the code.
 */
const ANNUAL = 12
const SINGLE_MAX = 1123.17 * ANNUAL // 13,478.04
const PENSIONER_COUPLE_MAX_EACH = 676.09 * ANNUAL // 8,113.08
const ALLOWANCE_MAX = 1428.06 * ANNUAL // 17,136.72

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
      [[true, false], [67, 62], { spouseWillReceiveOas: false }, 'couple-partner-no-oas-no-allowance'],
    ]
    for (const [oas, ages, options, expected] of cases) {
      expect([oas, ages, options, categoryOf(gisHouseholdCategory(oas, ages, options))])
        .toEqual([oas, ages, options, expected])
    }
    // Nobody receives OAS: the supplement requires it.
    expect(gisHouseholdCategory([false, false], [64, 62]).status).toBe('unsupported')
    expect(gisHouseholdCategory([], []).status).toBe('unsupported')
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
    expect(pack.categories['couple-both-pensioners'].maxMonthly * ANNUAL).toBeCloseTo(2 * PENSIONER_COUPLE_MAX_EACH, 6)
    expect(pack.categories['couple-both-pensioners'].annualCutoff).toBe(30096)
    expect(pack.categories['couple-partner-allowance'].maxMonthly).toBe(676.09)
    expect(pack.categories['couple-partner-allowance'].annualCutoff).toBe(42144)
    expect(pack.categories['couple-partner-no-oas-no-allowance'].maxMonthly).toBe(1123.17)
    expect(pack.categories['couple-partner-no-oas-no-allowance'].annualCutoff).toBe(54624)
    // The modelled reduction is flat through the published top-up band and
    // then one line to the published cut-off, so the two published endpoints
    // are exact. `+Infinity` closes the last segment.
    expect(pack.categories.single.reductionSegments).toEqual([
      { rate: 0, upTo: 4096 },
      { rate: (1123.17 * ANNUAL) / (22800 - 4096), upTo: Infinity },
    ])
    expect(pack.categories['couple-both-pensioners'].reductionSegments).toEqual([
      { rate: (2 * 676.09 * ANNUAL) / 30096, upTo: Infinity },
    ])
    expect(pack.categories['couple-partner-no-oas-no-allowance'].reductionSegments).toEqual([
      { rate: 0, upTo: 4096 },
      { rate: (1123.17 * ANNUAL) / (54624 - 4096), upTo: Infinity },
    ])
    expect(pack.categories['couple-partner-allowance'].reductionSegments)
      .toEqual([{ rate: 0, upTo: Infinity }])
    expect(pack.allowance.maxMonthly).toBe(1428.06)
    expect(pack.allowance.annualCutoff).toBe(42144)
  })

  it('carries a citation and a limitation for every amount it publishes', () => {
    const pack = OAS_GIS_ALLOWANCE_2026_Q3
    expect(pack.sourceURL).toContain('2026-quarterly-july-september')
    expect(pack.additionalSourceURLs?.join(' ')).toContain('open.canada.ca')
    expect(Object.values(pack.fieldSources).every(url => url.startsWith('https://'))).toBe(true)
    expect(pack.fieldSources.topUpIncome).toContain('open.canada.ca')
    expect(pack.fieldSources.allowanceMaxMonthly).toContain('allowance/benefit-amount')
    expect(pack.limitation).toContain('Not modelled')
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
    expect(gisAnnual([true, false], 22800, 0, options)).toBeCloseTo(8488.86, 1)
    expect(gisAnnual([true, false], 30000, 0, options)).toBeCloseTo(6568.30, 1)
    expect(gisAnnual([true, false], 54624, 0, options)).toBe(0)
    expect(gisAnnual([true, false], 54625, 0, options)).toBe(0)
    // Exactly S(income) = maximum x (1 - (income - 4,096)/(54,624 - 4,096)).
    const noOasAt = (income: number) => SINGLE_MAX * (1 - (income - 4096) / (54624 - 4096))
    expect(gisAnnual([true, false], 20000, 0, options)).toBeCloseTo(noOasAt(20000), 6)
    expect(gisAnnual([true, false], 40000, 0, options)).toBeCloseTo(noOasAt(40000), 6)
  })

  it('chooses each category cut-off instead of applying one cut-off to every shape', () => {
    // At 35,000 joint income the both-pensioners shape is already out, the
    // Allowance shape is still paying its flat GIS, and the no-Allowance shape
    // is only partway down its own 54,624 cut-off. One cut-off cannot give all
    // three answers.
    expect(gisAnnual([true, true], 35000)).toBe(0)
    expect(gisAnnual([true, false], 35000, 0, { agesPerPerson: [67, 62] }))
      .toBeCloseTo(PENSIONER_COUPLE_MAX_EACH + allowanceAnnual([true, false], [67, 62], 35000), 6)
    // At 30,096 the both-pensioners row is exactly out; the one-pensioner rows
    // are not. One cut-off cannot give both answers.
    expect(gisAnnual([true, false], 30096, 0, { receivingAllowance: false })).toBeCloseTo(6542.70, 0)
    expect(gisAnnual([true, false], 30096, 0, { agesPerPerson: [67, 62] }))
      .toBeCloseTo(PENSIONER_COUPLE_MAX_EACH + allowanceAnnual([true, false], [67, 62], 30096), 6)
    expect(gisAnnual([true], 20000)).toBeCloseTo(2017.67, 0)
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

  it('pays nothing when neither spouse receives OAS', () => {
    expect(gisAnnual([false, false], 0)).toBe(0)
    expect(allowanceAnnual([false, false], [64, 62], 0)).toBe(0)
    expect(gisAnnual([], 0)).toBe(0)
    expect(allowanceAnnual([true], [67], 0)).toBe(0)
  })
})

describe('top-up breakpoints and the phased reduction', () => {
  it('single: reduces to zero at the published 22,800 cut-off', () => {
    expect(gisAnnual([true], 0)).toBeCloseTo(SINGLE_MAX, 2)
    expect(gisAnnual([true], 22800)).toBe(0)
    expect(gisAnnual([true], 22801)).toBe(0)
    // Flat through the published 4,096 band, then a single line: at 8,192 the
    // modelled amount is 10,526.48, and the reduction is the same amount for
    // every further dollar of income.
    expect(gisAnnual([true], 4096)).toBe(SINGLE_MAX)
    expect(gisAnnual([true], 8192)).toBeCloseTo(10526.48, 2)
    expect(gisAnnual([true], 8192) - gisAnnual([true], 8193))
      .toBeCloseTo(SINGLE_MAX / (22800 - 4096), 6)
    expect(gisAnnual([true], 15000)).toBeGreaterThan(0)
  })

  it('both pensioners: reduces to zero at the published 30,096 cut-off', () => {
    expect(gisAnnual([true, true], 0)).toBeCloseTo(2 * PENSIONER_COUPLE_MAX_EACH, 2)
    expect(gisAnnual([true, true], 30096)).toBe(0)
    expect(gisAnnual([true, true], 30097)).toBe(0)
    // Two pensioners reduce from the first dollar (the table publishes no
    // top-up band for them) at the household rate.
    const bothRate = (2 * PENSIONER_COUPLE_MAX_EACH) / 30096
    expect(gisAnnual([true, true], 48)).toBeCloseTo(2 * PENSIONER_COUPLE_MAX_EACH - 48 * bothRate, 6)
    expect(gisAnnual([true, true], 10000)).toBeCloseTo(2 * PENSIONER_COUPLE_MAX_EACH - 10000 * bothRate, 6)
    expect(gisAnnual([true, true], 15048)).toBeCloseTo(2 * PENSIONER_COUPLE_MAX_EACH - 15048 * bothRate, 6)
  })

  it('one pensioner / spouse with no OAS and no Allowance: the 4,096 top-up band', () => {
    const options = { receivingAllowance: false }
    // Just below, at, and just above the published 4,096 top-up income the
    // tabled amount is still the maximum: the first segment runs from 4,096 to
    // 20,832, so 4,097 has not visibly moved yet.
    expect(gisAnnual([true, false], 4095, 0, options)).toBeCloseTo(SINGLE_MAX, 2)
    expect(gisAnnual([true, false], 4096, 0, options)).toBeCloseTo(SINGLE_MAX, 2)
    // The first dollar above the band starts the line.
    const noOasRate = SINGLE_MAX / (54624 - 4096)
    expect(gisAnnual([true, false], 4097, 0, options)).toBeCloseTo(SINGLE_MAX - noOasRate, 6)
    expect(gisAnnual([true, false], 4196, 0, options)).toBeCloseTo(SINGLE_MAX - 100 * noOasRate, 6)
    expect(gisAnnual([true, false], 20704, 0, options)).toBeCloseTo(SINGLE_MAX - (20704 - 4096) * noOasRate, 6)
  })

  it('one pensioner / Allowance spouse: the 8,800 top-up band', () => {
    // Ages let the engine decide Allowance receipt from the income test, which
    // is the shape a projection takes.
    const options = { agesPerPerson: [67, 62] }
    // `gisAnnual` is the household GIS + Allowance slot the projection adds;
    // `benefitIncomeBasis` splits the same figure into the two amounts.
    const total = (income: number) => gisAnnual([true, false], income, 0, options)
    // The published 8,800 top-up income is where the Allowance starts reducing;
    // below it the household receives 676.09 + 1,428.06 a month.
    expect(total(8799)).toBeCloseTo(PENSIONER_COUPLE_MAX_EACH + ALLOWANCE_MAX, 6)
    expect(total(8800)).toBeCloseTo(PENSIONER_COUPLE_MAX_EACH + ALLOWANCE_MAX, 6)
    expect(total(8801)).toBeLessThan(PENSIONER_COUPLE_MAX_EACH + ALLOWANCE_MAX)
    // The projection slot returns GIS + Allowance; the basis splits them.
    expect(gisAnnual([true, false], 20000, 0, options))
      .toBeCloseTo(PENSIONER_COUPLE_MAX_EACH + allowanceAnnual([true, false], [67, 62], 20000), 6)
    expect(basis([true, false], [67, 62], 20000).gis).toBeCloseTo(PENSIONER_COUPLE_MAX_EACH, 6)
    // Past the Allowance's own 42,144 cut-off it is no longer in pay and the
    // pensioner's GIS moves to the 54,624 row, so the household total does not
    // drop to zero at the Allowance's cut-off.
    expect(basis([true, false], [67, 62], 42144).allowance).toBe(0)
    expect(total(42144)).toBeCloseTo(SINGLE_MAX * (1 - (42144 - 4096) / (54624 - 4096)), 6)
    expect(total(54624)).toBe(0)
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
    const gis = (work: number) => gisAnnual([true], 10000, work)
    const singleRate = SINGLE_MAX / (22800 - 4096)
    const expected = (work: number) => {
      const countable = Math.max(0, 10000 - gisWorkExemption(work))
      return SINGLE_MAX - Math.max(0, countable - 4096) * singleRate
    }
    // Just below, at, and just above the 5,000 boundary of the exemption.
    expect(gis(9999)).toBeCloseTo(expected(9999), 6)
    expect(gis(10000)).toBeCloseTo(expected(10000), 6)
    expect(gis(10001)).toBeCloseTo(expected(10001), 6)
    // The exemption never exceeds 10,000, so 20,000 of work income leaves
    // 10,000 countable and the household is still below its 22,800 cut-off.
    expect(gis(20000)).toBeCloseTo(expected(20000), 6)
    expect(gis(20000)).toBeCloseTo(gisAnnual([true], 0), 6)
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
    expect(basis([true, false], [65, 60], 30096, { receivingAllowance: false }).gis)
      .toBeCloseTo(6542.70, 2)
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
