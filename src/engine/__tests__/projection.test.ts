import { describe, expect, it } from 'vitest'
import { runProjection } from '../projection'
import type { Inputs } from '../types'

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

describe('runProjection', () => {
  it('produces one row per year of life', () => {
    const r = runProjection(base)
    expect(r.rows).toHaveLength(90 - 35 + 1)
    expect(r.rows[0].age).toBe(35)
    expect(r.rows.at(-1)!.age).toBe(90)
  })

  it('labels the three phases correctly', () => {
    const r = runProjection(base)
    expect(r.rows.find((x) => x.age === 44)!.phase).toBe('accumulation')
    expect(r.rows.find((x) => x.age === 55)!.phase).toBe('bridge')
    expect(r.rows.find((x) => x.age === 70)!.phase).toBe('pension')
  })

  it('succeeds with ample assets', () => {
    const r = runProjection(base)
    expect(r.success).toBe(true)
    expect(r.depletedAge).toBeNull()
  })

  it('detects depletion with tiny assets and huge spending', () => {
    const r = runProjection({
      ...base,
      balances: { tfsa: 10000, rrsp: 20000, nonReg: 0 },
      nonRegBook: 0,
      annualSavings: 0,
      retirementSpending: 80000,
    })
    expect(r.success).toBe(false)
    expect(r.depletedAge).not.toBeNull()
    expect(r.depletedAge!).toBeLessThan(90)
  })

  it('fees reduce growth: final net worth drops when an MER is charged', () => {
    const noFees = runProjection(base)
    const withFees = runProjection({ ...base, fees: 0.02 })
    expect(withFees.finalNetWorth).toBeLessThan(noFees.finalNetWorth)
  })

  it('never lets balances go negative', () => {
    const r = runProjection({ ...base, retirementSpending: 200000 })
    for (const row of r.rows) {
      expect(row.balances.tfsa).toBeGreaterThanOrEqual(-1e-6)
      expect(row.balances.rrsp).toBeGreaterThanOrEqual(-1e-6)
      expect(row.balances.nonReg).toBeGreaterThanOrEqual(-1e-6)
    }
  })

  it('meets the spending target after tax in funded years', () => {
    const r = runProjection(base)
    for (const row of r.rows) {
      if (row.phase === 'accumulation') continue
      expect(row.netCash).toBeGreaterThanOrEqual(base.retirementSpending - 1)
    }
  })

  it('withdrawal order changes the outcome (meltdown vs TFSA-first)', () => {
    const meltdown = runProjection(base)
    const tfsaFirst = runProjection({
      ...base,
      strategy: 'tfsaFirst' as const,
    })
    expect(meltdown.finalNetWorth).not.toBeCloseTo(tfsaFirst.finalNetWorth, 0)
  })

  it('forces RRIF minimums: RRSP is drawn after 72 even with TFSA-first order', () => {
    const r = runProjection({
      ...base,
      strategy: 'tfsaFirst' as const,
      balances: { tfsa: 2000000, rrsp: 500000, nonReg: 500000 },
      nonRegBook: 400000,
    })
    const row75 = r.rows.find((x) => x.age === 75)!
    expect(row75.withdrawals.rrsp).toBeGreaterThan(0)
  })

  it('couple mode pays less tax than single for the same household withdrawals', () => {
    const single = runProjection(base)
    const couple = runProjection({
      ...base,
      partner: {
        currentAge: 35,
        cppStartAge: 65,
        cppAnnualAt65: 0,
        oasStartAge: 71,
        oasAnnualAt65: 0,
      },
    })
    // identical benefits, but taxable income splits across two bracket sets
    expect(couple.finalNetWorth).toBeGreaterThan(single.finalNetWorth)
  })

  it("partner benefits start on the partner's own timeline", () => {
    const r = runProjection({
      ...base,
      cppAnnualAt65: 10000,
      partner: {
        currentAge: 30, // 5 years younger; their CPP at 65 = primary age 70
        cppStartAge: 65,
        cppAnnualAt65: 6000,
        oasStartAge: 65,
        oasAnnualAt65: 8700,
      },
    })
    const at69 = r.rows.find((x) => x.age === 69)!
    const at70 = r.rows.find((x) => x.age === 70)!
    expect(at69.cpp).toBeCloseTo(10000)
    expect(at70.cpp).toBeCloseTo(16000)
  })

  it('tax drag: distributions are taxed yearly and lower the final net worth', () => {
    const noDrag = runProjection(base)
    const dragged = runProjection({ ...base, nonRegDistributionYield: 0.03 })
    expect(dragged.finalNetWorth).toBeLessThan(noDrag.finalNetWorth)
    // even a TFSA-first bridge year shows tax once distributions exist
    const bridge = runProjection({
      ...base,
      strategy: 'tfsaFirst' as const,
      balances: { tfsa: 1500000, rrsp: 0, nonReg: 1500000 },
      nonRegBook: 1500000,
      nonRegDistributionYield: 0.03,
    })
    const bridgeRow = bridge.rows.find((x) => x.phase === 'bridge')!
    expect(bridgeRow.tax).toBeGreaterThan(0)
  })

  it('tax drag raises the ACB: reinvested distributions are not taxed twice', () => {
    // all-interest portfolio never sold until death: with the yield fully
    // distributed and reinvested, book value tracks the balance and the
    // estate has no unrealized gain left to tax
    const r = runProjection({
      ...base,
      strategy: 'tfsaFirst' as const,
      savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 },
      returns: { tfsa: 0.05, rrsp: 0.05, nonReg: 0.03 },
      balances: { tfsa: 3000000, rrsp: 0, nonReg: 500000 },
      nonRegBook: 500000,
      nonRegDistributionYield: 0.03,
      cppAnnualAt65: 0,
      oasAnnualAt65: 0,
    })
    expect(r.estateTax).toBeCloseTo(0, -2)
  })

  it('OAS rises 10% automatically at 75', () => {
    const r = runProjection(base)
    const at74 = r.rows.find((x) => x.age === 74)!
    const at75 = r.rows.find((x) => x.age === 75)!
    expect(at75.oas).toBeCloseTo(at74.oas * 1.1, 0)
  })

  it('GIS: a TFSA-funded retiree receives it from 65; RRSP income claws it back', () => {
    const tfsaLiving = runProjection({
      ...base,
      strategy: 'tfsaFirst' as const,
      savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 },
      balances: { tfsa: 3000000, rrsp: 0, nonReg: 0 },
      nonRegBook: 0,
      cppAnnualAt65: 0,
      oasAnnualAt65: 9024,
    })
    const at64 = tfsaLiving.rows.find((r) => r.age === 64)!
    const at70 = tfsaLiving.rows.find((r) => r.age === 70)!
    expect(at64.gis).toBe(0) // GIS requires OAS
    expect(at70.gis).toBeCloseTo(13478, -1) // zero taxable income -> full single GIS

    const rrspLiving = runProjection({
      ...base,
      strategy: 'rrspFirst' as const,
      balances: { tfsa: 0, rrsp: 3000000, nonReg: 0 },
      nonRegBook: 0,
      savingsSplit: { tfsa: 0, rrsp: 1, nonReg: 0 },
      oasAnnualAt65: 9024,
    })
    const rrsp70 = rrspLiving.rows.find((r) => r.age === 70)!
    expect(rrsp70.gis).toBe(0) // ~$60k taxable income is far past the cutoff
  })

  it('TFSA-only withdrawals pay no tax in the bridge with no other income', () => {
    const r = runProjection({
      ...base,
      strategy: 'tfsaFirst' as const,
      balances: { tfsa: 3000000, rrsp: 0, nonReg: 0 },
      nonRegBook: 0,
    })
    const bridgeRow = r.rows.find((x) => x.phase === 'bridge')!
    expect(bridgeRow.tax).toBe(0)
    expect(bridgeRow.withdrawals.tfsa).toBeCloseTo(base.retirementSpending, 0)
  })

  it('benefits claimed before FIRE are collected, taxed, and saved', () => {
    // still working 60→68, CPP claimed at 65: ages 65-67 must not vanish
    const late = {
      ...base,
      currentAge: 60,
      fireAge: 68,
      lifeExpectancy: 80,
      cppStartAge: 65,
      oasStartAge: 66,
    }
    const r = runProjection(late)
    const at65 = r.rows.find((x) => x.age === 65)!
    const at66 = r.rows.find((x) => x.age === 66)!
    expect(at65.phase).toBe('accumulation')
    expect(at65.cpp).toBeGreaterThan(0)
    expect(at66.oas).toBeGreaterThan(0)
    // the money actually lands: net worth beats an identical plan claiming at FIRE
    const claimAtFire = runProjection({ ...late, cppStartAge: 68, oasStartAge: 68 })
    expect(r.finalNetWorth).not.toBe(claimAtFire.finalNetWorth)
  })

  it('tolerates fractional ages without NaN (RRIF factor floors the age)', () => {
    const r = runProjection({ ...base, currentAge: 35.5 })
    expect(Number.isFinite(r.finalNetWorth)).toBe(true)
    for (const row of r.rows) {
      expect(Number.isFinite(row.netCash)).toBe(true)
      expect(Number.isFinite(row.balances.rrsp)).toBe(true)
    }
  })

  it('meltdown bracket cap: bracket2 lets more RRSP out per year than bracket1', () => {
    // ON: bracket1 top = min(58,523 fed, 53,891 ON) = 53,891;
    // bracket2 top = min(117,045 fed, 107,785 ON) = 107,785 — a spending
    // target between the two only fully clears the bracket if capped at 2
    const big = {
      ...base,
      strategy: 'meltdownPaced' as const,
      retirementSpending: 70000,
      balances: { tfsa: 0, rrsp: 2_000_000, nonReg: 500000 },
      nonRegBook: 500000,
      cppAnnualAt65: 0,
      oasAnnualAt65: 0,
    }
    const bracket1 = runProjection({ ...big, meltdownBracketCap: 'bracket1' })
    const bracket2 = runProjection({ ...big, meltdownBracketCap: 'bracket2' })
    const rrspAt50 = (r: typeof bracket1) => r.rows.find((x) => x.age === 50)!.withdrawals.rrsp
    expect(rrspAt50(bracket2)).toBeGreaterThan(rrspAt50(bracket1))
    // bracket1 still meets spending (from non-registered) — just less from RRSP
    expect(bracket1.rows.find((x) => x.age === 50)!.netCash).toBeGreaterThanOrEqual(70000 - 0.01)
  })

  it('meltdown bracket cap: default (undefined) matches explicit bracket1', () => {
    const big = {
      ...base,
      strategy: 'meltdownPaced' as const,
      retirementSpending: 70000,
      balances: { tfsa: 0, rrsp: 2_000_000, nonReg: 500000 },
      nonRegBook: 500000,
      cppAnnualAt65: 0,
      oasAnnualAt65: 0,
    }
    const withDefault = runProjection(big)
    const explicit = runProjection({ ...big, meltdownBracketCap: 'bracket1' })
    expect(withDefault.finalNetWorth).toBeCloseTo(explicit.finalNetWorth, 0)
  })

  it('meltdown bracket cap: oasClawback uses the clawback threshold, between ON brackets 1 and 2', () => {
    // ON: bracket1=53,891 < clawback=95,323 < bracket2=107,785 — a target in
    // that gap clears fully under oasClawback but not under bracket1
    const big = {
      ...base,
      strategy: 'meltdownPaced' as const,
      retirementSpending: 90000,
      balances: { tfsa: 0, rrsp: 2_000_000, nonReg: 500000 },
      nonRegBook: 500000,
      cppAnnualAt65: 0,
      oasAnnualAt65: 0,
    }
    const bracket1 = runProjection({ ...big, meltdownBracketCap: 'bracket1' })
    const clawback = runProjection({ ...big, meltdownBracketCap: 'oasClawback' })
    const rrspAt50 = (r: typeof bracket1) => r.rows.find((x) => x.age === 50)!.withdrawals.rrsp
    expect(rrspAt50(clawback)).toBeGreaterThan(rrspAt50(bracket1))
  })

  it('handles multiple investment properties selling at different ages', () => {
    const r = runProjection({
      ...base,
      investmentProperties: [
        { value: 400000, acb: 300000, appreciation: 0, sellAtAge: 50 },
        { value: 600000, acb: 200000, appreciation: 0, sellAtAge: 60 },
      ],
    })
    const at49 = r.rows.find((x) => x.age === 49)!
    const at50 = r.rows.find((x) => x.age === 50)!
    const at60 = r.rows.find((x) => x.age === 60)!
    expect(at49.propertyValue).toBeCloseTo(1000000, 0)
    expect(at50.propertyValue).toBeCloseTo(600000, 0)
    expect(at60.propertyValue).toBe(0)
    const noProps = runProjection(base)
    expect(r.finalNetWorth).toBeGreaterThan(noProps.finalNetWorth + 800000)
  })

  it('rent flows in while held and stops the year the property sells', () => {
    const r = runProjection({
      ...base,
      investmentProperties: [
        { value: 500000, acb: 400000, appreciation: 0, sellAtAge: 60, annualRent: 24000 },
      ],
    })
    expect(r.rows.find((x) => x.age === 55)!.rent).toBe(24000)
    expect(r.rows.find((x) => x.age === 60)!.rent).toBe(0)
  })

  it('rent reduces the portfolio withdrawals needed in retirement', () => {
    const withRent = runProjection({
      ...base,
      investmentProperties: [
        { value: 500000, acb: 400000, appreciation: 0, sellAtAge: null, annualRent: 30000 },
      ],
    })
    const without = runProjection(base)
    const wr = withRent.rows.find((x) => x.age === 50)!
    const wo = without.rows.find((x) => x.age === 50)!
    const total = (row: typeof wr) =>
      row.withdrawals.tfsa + row.withdrawals.rrsp + row.withdrawals.nonReg
    expect(total(wr)).toBeLessThan(total(wo))
    // rent is taxable: spending target is still met after tax
    expect(wr.netCash).toBeGreaterThanOrEqual(base.retirementSpending - 0.01)
    expect(wr.tax).toBeGreaterThan(0)
  })

  it('rent during accumulation is saved after tax at the working marginal rate', () => {
    const inputs = {
      ...base,
      annualSavings: 0,
      returns: { tfsa: 0, rrsp: 0, nonReg: 0 },
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 },
      nonRegBook: 0,
      accumulationMarginalRate: 0.4,
      investmentProperties: [
        { value: 500000, acb: 400000, appreciation: 0, sellAtAge: null, annualRent: 10000 },
      ],
    }
    const r = runProjection(inputs)
    const firstYear = r.rows[0]
    expect(firstYear.balances.nonReg).toBeCloseTo(10000 * 0.6, 0)
    expect(firstYear.tax).toBeCloseTo(10000 * 0.4, 0)
  })

  it('Barista income reduces withdrawals within its age window only', () => {
    const r = runProjection({
      ...base,
      extraIncome: { annual: 20000, fromAge: 45, toAge: 55 },
    })
    const plain = runProjection(base)
    const total = (row: (typeof r.rows)[number]) =>
      row.withdrawals.tfsa + row.withdrawals.rrsp + row.withdrawals.nonReg
    expect(total(r.rows.find((x) => x.age === 50)!)).toBeLessThan(
      total(plain.rows.find((x) => x.age === 50)!),
    )
    expect(r.rows.find((x) => x.age === 50)!.extraIncome).toBe(20000)
    expect(r.rows.find((x) => x.age === 56)!.extraIncome).toBe(0)
    // never earlier than FIRE even if fromAge says so
    const early = runProjection({
      ...base,
      extraIncome: { annual: 20000, fromAge: 40, toAge: 55 },
    })
    expect(early.rows.find((x) => x.age === 44)!.extraIncome).toBe(0)
    expect(early.rows.find((x) => x.age === 45)!.extraIncome).toBe(20000)
  })

  it('GIS work exemption: side income bites less than the same rent', () => {
    const gisScenario = {
      ...base,
      currentAge: 64,
      fireAge: 64,
      lifeExpectancy: 70,
      cppStartAge: 70,
      oasStartAge: 65,
      cppAnnualAt65: 0,
      retirementSpending: 30000,
      strategy: 'tfsaFirst' as const,
      balances: { tfsa: 1000000, rrsp: 0, nonReg: 0 },
      nonRegBook: 0,
    }
    const withWork = runProjection({
      ...gisScenario,
      extraIncome: { annual: 8000, fromAge: 64, toAge: 70 },
    })
    const withRent = runProjection({
      ...gisScenario,
      investmentProperties: [
        { value: 300000, acb: 300000, appreciation: 0, sellAtAge: null, annualRent: 8000 },
      ],
    })
    const gisAt66 = (r: ReturnType<typeof runProjection>) =>
      r.rows.find((x) => x.age === 66)!.gis
    // first $5,000 of work income is exempt, plus half the next $10,000:
    // $8,000 of work counts as $1,500; $8,000 of rent counts in full
    expect(gisAt66(withWork)).toBeGreaterThan(gisAt66(withRent))
  })

  it('rent counts against the GIS income test', () => {
    const gisBase = {
      ...base,
      currentAge: 64,
      fireAge: 64,
      lifeExpectancy: 70,
      cppStartAge: 70,
      oasStartAge: 65,
      cppAnnualAt65: 0,
      retirementSpending: 30000,
      strategy: 'tfsaFirst' as const,
      balances: { tfsa: 1000000, rrsp: 0, nonReg: 0 },
      nonRegBook: 0,
    }
    const noRent = runProjection(gisBase)
    const withRent = runProjection({
      ...gisBase,
      investmentProperties: [
        { value: 300000, acb: 300000, appreciation: 0, sellAtAge: null, annualRent: 12000 },
      ],
    })
    const gisAt66 = (r: ReturnType<typeof runProjection>) =>
      r.rows.find((x) => x.age === 66)!.gis
    expect(gisAt66(noRent)).toBeGreaterThan(0)
    expect(gisAt66(withRent)).toBeLessThan(gisAt66(noRent))
  })
})
