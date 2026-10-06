import { describe, expect, it } from 'vitest'
import { DEVIATION_TOLERANCE } from '../rules'
import { OAS_GIS_ALLOWANCE_2026_Q4, benefitIncomeBasis } from '../benefits'

/**
 * BE-45: the October-December 2026 GIS/Allowance pack against its own
 * published tables. Every literal below is transcribed from ESDC sources,
 * never produced by the code under test:
 *
 *   ESDC, quarterly amounts October to December 2026, Table 5
 *   https://www.canada.ca/en/employment-social-development/programs/pensions/pension/statistics/2026-quarterly-october-december.html
 *   ESDC open data, OAS table of benefit amounts, October 2026 CSVs (tables 1-4)
 *   https://open.canada.ca/data/en/dataset/dfa4daf1-669e-4514-82cd-982f27707ed0
 *
 * Table 5, monthly maximum / annual income cut-off / top-up cut-off:
 *   single pensioner ........ 1,138.90 / 23,112 / 10,496
 *   spouse receives OAS .....   685.56 / 30,528 /  8,800 (per pensioner)
 *   spouse receives Allowance   685.56 / 42,768 /  8,800
 *   spouse receives neither . 1,138.90 / 55,392 / 20,992
 *   Allowance ............... 1,448.06 / 42,768 /  8,800
 *
 * Rows: [incomeFrom, nextIncomeFrom, ...monthlyCents]. The sample keeps each
 * table's first and last brackets, a 960-dollar sweep, a window around every
 * modelled breakpoint, and the bracket where the fit is furthest from the
 * table, so the bounds measured here are the full-range maxima.
 */
const ANNUAL = 12
const Q4 = { gisPack: OAS_GIS_ALLOWANCE_2026_Q4 }
type PublishedRow = [number, number, ...number[]]

const TABLE_1_SINGLE: PublishedRow[] = [
  [0, 24, 113890],[24, 48, 113790],[48, 72, 113690],[72, 96, 113590],[960, 984, 109890],[1920, 1944, 105890],
  [2016, 2040, 105490],[2040, 2048, 105390],[2048, 2064, 105290],[2064, 2088, 105190],[2088, 2096, 105090],
  [2880, 2904, 100090],[3840, 3864, 94090],[4800, 4824, 88090],[5760, 5784, 82090],[6720, 6744, 76090],
  [7680, 7704, 70090],[8640, 8664, 64090],[9600, 9624, 58090],[10464, 10488, 52690],[10488, 10496, 52590],
  [10496, 10512, 52549],[10512, 10536, 52449],[10536, 10560, 52349],[10560, 10584, 52249],
  [11520, 11544, 48249],[12480, 12504, 44249],[13440, 13464, 40249],[14400, 14424, 36249],
  [15360, 15384, 32249],[16320, 16344, 28249],[17280, 17304, 24249],[18240, 18264, 20249],
  [19200, 19224, 16249],[20160, 20184, 12249],[21120, 21144, 8249],[22080, 22104, 4249],[23040, 23064, 249],
  [23064, 23088, 149],[23088, 23112, 49],
]
const TABLE_2_BOTH: PublishedRow[] = [
  [0, 48, 68556],[48, 96, 68456],[96, 144, 68356],[144, 192, 68256],[960, 1008, 66556],[1920, 1968, 64556],
  [2880, 2928, 62556],[3840, 3888, 60556],[4032, 4080, 60156],[4080, 4096, 60056],[4096, 4128, 59956],
  [4128, 4176, 59856],[4176, 4192, 59756],[4800, 4848, 57756],[5760, 5808, 54756],[6720, 6768, 51756],
  [7680, 7728, 48756],[8640, 8688, 45756],[8736, 8784, 45456],[8784, 8800, 45356],[8800, 8832, 45257],
  [8832, 8880, 45157],[8880, 8928, 45057],[9600, 9648, 43557],[10560, 10608, 41557],[11520, 11568, 39557],
  [12480, 12528, 37557],[13440, 13488, 35557],[14400, 14448, 33557],[15360, 15408, 31557],
  [16320, 16368, 29557],[17280, 17328, 27557],[18240, 18288, 25557],[19200, 19248, 23557],
  [20160, 20208, 21557],[21120, 21168, 19557],[22080, 22128, 17557],[23040, 23088, 15557],
  [24000, 24048, 13557],[24960, 25008, 11557],[25920, 25968, 9557],[26880, 26928, 7557],[27840, 27888, 5557],
  [28800, 28848, 3557],[29760, 29808, 1557],[30384, 30432, 257],[30432, 30480, 157],[30480, 30528, 57],
]
const TABLE_3_NO_OAS: PublishedRow[] = [
  [0, 4096, 113890],[4096, 4192, 113790],[4192, 4288, 113690],[4288, 4384, 113590],[9088, 9184, 108590],
  [9184, 9216, 108490],[9216, 9264, 108390],[9264, 9280, 108290],[9280, 9312, 108190],[9600, 9648, 107190],
  [10560, 10608, 104190],[11520, 11568, 101190],[12480, 12528, 98190],[13440, 13488, 95190],
  [14400, 14448, 92190],[15360, 15408, 89190],[16320, 16368, 86190],[17280, 17328, 83190],
  [18240, 18288, 80190],[19200, 19248, 77190],[20160, 20208, 74190],[20928, 20976, 71790],
  [20976, 20992, 71690],[20992, 21024, 71649],[21024, 21072, 71549],[21072, 21120, 71449],
  [21120, 21168, 71349],[22080, 22128, 69349],[23040, 23088, 67349],[24000, 24048, 65349],
  [24960, 25008, 63349],[25920, 25968, 61349],[26880, 26928, 59349],[27840, 27888, 57349],
  [28800, 28848, 55349],[29760, 29808, 53349],[30720, 30768, 51349],[31680, 31728, 49349],
  [32640, 32688, 47349],[33600, 33648, 45349],[34560, 34608, 43349],[35520, 35568, 41349],
  [36480, 36528, 39349],[37440, 37488, 37349],[38400, 38448, 35349],[39360, 39408, 33349],
  [40320, 40368, 31349],[41280, 41328, 29349],[42240, 42288, 27349],[42672, 42720, 26449],
  [42720, 42768, 26349],[42768, 42816, 26249],[42816, 42864, 26149],[42864, 42912, 26049],
  [43200, 43248, 25349],[44160, 44208, 23349],[45120, 45168, 21349],[46080, 46128, 19349],
  [47040, 47088, 17349],[48000, 48048, 15349],[48960, 49008, 13349],[49920, 49968, 11349],[50880, 50928, 9349],
  [51840, 51888, 7349],[52800, 52848, 5349],[53760, 53808, 3349],[54720, 54768, 1349],[55248, 55296, 249],
  [55296, 55344, 149],[55344, 55392, 49],
]
const TABLE_4_ALLOWANCE: PublishedRow[] = [
  [0, 48, 68556, 144806],[48, 96, 68556, 144506],[96, 144, 68556, 144206],[144, 192, 68556, 143906],
  [960, 1008, 68556, 138806],[1920, 1968, 68556, 132806],[2880, 2928, 68556, 126806],
  [3840, 3888, 68556, 120806],[3984, 4032, 68556, 119906],[4032, 4080, 68556, 119606],
  [4080, 4096, 68556, 119306],[4096, 4128, 68456, 119206],[4128, 4176, 68456, 118906],
  [4800, 4848, 67756, 114006],[5760, 5808, 66756, 107006],[6720, 6768, 65756, 100006],
  [7680, 7728, 64756, 93006],[8640, 8688, 63756, 86006],[8736, 8784, 63656, 85306],[8784, 8800, 63656, 85006],
  [8800, 8832, 63557, 84907],[8832, 8880, 63557, 84607],[8880, 8928, 63557, 84307],[9600, 9648, 63557, 79807],
  [10560, 10608, 63557, 73807],[11520, 11568, 63557, 67807],[12048, 12096, 63557, 64507],
  [12096, 12144, 63557, 64207],[12144, 12192, 63557, 63907],[12192, 12240, 63557, 63607],
  [12240, 12288, 63557, 63557],[12480, 12528, 63057, 63057],[13440, 13488, 61057, 61057],
  [14400, 14448, 59057, 59057],[15360, 15408, 57057, 57057],[16320, 16368, 55057, 55057],
  [17280, 17328, 53057, 53057],[18240, 18288, 51057, 51057],[19200, 19248, 49057, 49057],
  [20160, 20208, 47057, 47057],[21120, 21168, 45057, 45057],[22080, 22128, 43057, 43057],
  [23040, 23088, 41057, 41057],[24000, 24048, 39057, 39057],[24960, 25008, 37057, 37057],
  [25920, 25968, 35057, 35057],[26880, 26928, 33057, 33057],[27840, 27888, 31057, 31057],
  [28800, 28848, 29057, 29057],[29760, 29808, 27057, 27057],[30000, 30048, 26557, 26557],
  [30048, 30096, 26457, 26457],[30096, 30144, 26357, 26357],[30144, 30192, 26292, 26257],
  [30192, 30240, 26292, 26157],[30720, 30768, 26292, 25057],[31680, 31728, 26292, 23057],
  [32640, 32688, 26292, 21057],[33600, 33648, 26292, 19057],[34560, 34608, 26292, 17057],
  [35520, 35568, 26292, 15057],[36480, 36528, 26292, 13057],[37440, 37488, 26292, 11057],
  [38400, 38448, 26292, 9057],[39360, 39408, 26292, 7057],[40320, 40368, 26292, 5057],
  [41280, 41328, 26292, 3057],[42240, 42288, 26292, 1057],[42624, 42672, 26292, 257],
  [42672, 42720, 26292, 157],[42720, 42768, 26292, 57],
]

function worst(rows: PublishedRow[], kind: 'gis' | 'allowance' | 'total', oas: boolean[], ages: number[],
  options: { receivingAllowance?: boolean; agesPerPerson?: number[] } = {}, perPensioner = false): number {
  let deviation = 0
  for (const [from, to, ...cents] of rows) {
    for (const income of [from, to]) {
      const basis = benefitIncomeBasis(oas, ages, income, { ...Q4, ...options })
      if (basis.status !== 'modeled') throw new Error(`unsupported at ${income}`)
      const published = kind === 'allowance' ? cents[1] / 100
        : kind === 'gis' ? cents[0] / 100 * (perPensioner ? 2 : 1) : (cents[0] + cents[1]) / 100
      const modelled = (kind === 'allowance' ? basis.allowance : kind === 'gis' ? basis.gis : basis.gis + basis.allowance) / ANNUAL
      deviation = Math.max(deviation, Math.abs(modelled - published))
    }
  }
  return deviation
}

describe('BE-45 October-December 2026 GIS/Allowance pack', () => {
  const pack = OAS_GIS_ALLOWANCE_2026_Q4

  it('reproduces the published Table 5 maximums and cut-offs', () => {
    expect([pack.id, pack.paymentPeriod]).toEqual(['CA-OAS-GIS-2026-Q4-v1', '2026-10/2026-12'])
    expect(pack.categories.single).toMatchObject({ maxMonthly: 1138.90, annualCutoff: 23112 })
    expect(pack.categories['couple-both-pensioners']).toMatchObject({ maxMonthly: 2 * 685.56, annualCutoff: 30528 })
    expect(pack.categories['couple-partner-allowance']).toMatchObject({ maxMonthly: 685.56, annualCutoff: 42768 })
    expect(pack.categories['couple-partner-no-oas-no-allowance']).toMatchObject({ maxMonthly: 1138.90, annualCutoff: 55392 })
    expect(pack.allowance).toMatchObject({ maxMonthly: 1448.06, annualCutoff: 42768, topUpIncome: 8800 })
  })

  it('tracks each published table within the bound the pack records', () => {
    const measured: [string, number, number][] = [
      ['single', worst(TABLE_1_SINGLE, 'gis', [true], [67]), pack.categories.single.maxMonthlyDeviation],
      ['both', worst(TABLE_2_BOTH, 'gis', [true, true], [67, 66], {}, true), pack.categories['couple-both-pensioners'].maxMonthlyDeviation],
      ['no-oas', worst(TABLE_3_NO_OAS, 'gis', [true, false], [67, 60], { receivingAllowance: false }),
        pack.categories['couple-partner-no-oas-no-allowance'].maxMonthlyDeviation],
      ['allowance household', worst(TABLE_4_ALLOWANCE, 'total', [true, false], [67, 62], { agesPerPerson: [67, 62] }),
        pack.categories['couple-partner-allowance'].maxMonthlyDeviation],
      ['allowance', worst(TABLE_4_ALLOWANCE, 'allowance', [true, false], [67, 62], { agesPerPerson: [67, 62] }), pack.allowance.maxMonthlyDeviation],
    ]
    for (const [name, deviation, recorded] of measured) {
      expect(deviation, name).toBeLessThanOrEqual(recorded + 1e-9)
      // The recorded bound is the measurement, not a loose ceiling.
      expect(recorded - deviation, name).toBeLessThan(0.01)
      expect(deviation, name).toBeLessThanOrEqual(DEVIATION_TOLERANCE)
    }
  })

  it('reaches zero at every published cut-off', () => {
    const at = (oas: boolean[], ages: number[], income: number, options = {}) => {
      const basis = benefitIncomeBasis(oas, ages, income, { ...Q4, ...options })
      if (basis.status !== 'modeled') throw new Error('unsupported')
      return basis
    }
    expect(at([true], [67], 23112).gis).toBe(0)
    expect(at([true, true], [67, 66], 30528).gis).toBe(0)
    expect(at([true, false], [67, 60], 55392, { receivingAllowance: false }).gis).toBe(0)
    expect(at([true, false], [67, 62], 42768, { agesPerPerson: [67, 62] }).allowance).toBe(0)
    expect(at([true, false], [67, 62], 42767, { agesPerPerson: [67, 62] }).allowance).toBeGreaterThan(0)
  })

  it('hands off from the Allowance row to the spouse-with-neither row without a rise', () => {
    const household = (income: number) => {
      const basis = benefitIncomeBasis([true, false], [67, 62], income, Q4)
      if (basis.status !== 'modeled') throw new Error('unsupported')
      return basis.gis + basis.allowance
    }
    let previous = household(41_000)
    for (let income = 41_001; income <= 46_000; income += 1) {
      const current = household(income)
      expect(current, `income ${income}`).toBeLessThanOrEqual(previous + 1e-9)
      previous = current
    }
    expect(household(42_767) - household(42_768)).toBeLessThanOrEqual(ANNUAL)
  })
})
