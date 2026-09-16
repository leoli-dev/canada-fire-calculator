// BE-38 B4 follow-up: the confinement sweep, written so the *same file* runs in
// the base worktree and in the head worktree and prints the same shape. It is a
// harness, not an assertion: the comparison happens outside the suite (see the
// slice's PR evidence), so neither revision's expectation can hide a move.
//
// It reads the output path from `CONFINEMENT_OUT` and falls back to stdout, so
// no Node type declarations are needed in this browser-targeted tsconfig.
import { it, expect } from 'vitest'
import { runProjection } from '../projection'
import { incomeTax, probateTax } from '../tax'
import { DEFAULT_INPUTS } from '../../store'
import type { Inputs, Province } from '../types'

const PROVINCES: Province[] = ['ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'PE', 'NL', 'YT', 'NT', 'NU']

/** Probate across a grid that straddles $25,000, one million and the other
 * jurisdiction boundaries, so a changed boundary or rate shows up as a delta
 * rather than as a single sample. */
function probateGrid(province: Province): [number, number][] {
  const values = [0, 1, 100, 5_000, 10_000, 10_001, 20_000, 24_999, 25_000, 25_001,
    30_000, 35_000, 40_000, 50_000, 50_001, 55_000, 100_000, 125_000, 200_000, 250_000, 250_001,
    500_000, 1_000_000, 5_000_000]
  return values.map(value => [value, probateTax(value, province)])
}

/** Income tax at a spread of taxable incomes, for every jurisdiction: the other
 * priced surface this slice must not touch. */
function incomeTaxGrid(province: Province): [number, number][] {
  return [0, 20_000, 50_000, 100_000, 200_000, 500_000]
    .map(taxable => [taxable, incomeTax(taxable, province)])
}

/** A deterministic plan per jurisdiction, built from the shipped defaults with a
 * positive non-registered balance and an owned home so probate is charged. */
function planFor(province: Province): Inputs {
  return {
    ...structuredClone(DEFAULT_INPUTS),
    province,
    balances: { tfsa: 150_000, rrsp: 300_000, nonReg: 250_000 },
    nonRegBook: 200_000,
    principalResidence: { mode: 'owned', value: 600_000, appreciation: 0.03, sellAtAge: null,
      mortgage: { balance: 100_000, annualPayment: 12_000, yearsRemaining: 10 } },
  }
}

/**
 * BE-38 B4 review (the vacuous-sweep defect): the sweep above ran one plan whose
 * probate base sat far above every boundary this slice moved, so it reported
 * "no projection delta" and proved nothing about the bands that changed. These
 * plans put the probate base *inside* the bands a probate change can move — the
 * published exemption, the $25,000–$50,000 band, and just above $50,000 — for
 * every jurisdiction, so a boundary or rate move shows up as an `estateValue` /
 * `probateFee` delta here instead of hiding behind a large estate.
 *
 * The base is the non-registered balance the projection closes on: with no
 * principal residence, no investment property and no mortgage, the engine prices
 * `bal.nonReg` alone. Fees, distributions, returns, CPP and OAS are all zero, so
 * that balance neither grows nor shrinks and the constructed `nonReg` *is* the
 * base at the terminal year — asserted below, not assumed: an earlier draft kept
 * fees, distributions, CPP and OAS, and the balance drifted out of every band.
 */
const BAND_TARGETS = [
  { tag: 'exemptUnder25k', nonReg: 10_000 },
  { tag: 'band25kTo50k', nonReg: 35_000 },
  { tag: 'justOver50k', nonReg: 55_000 },
] as const

/** The published BC ladder, hand-keyed from the two instruments the row cites —
 * the Probate Fee Act s. 2(2)(b)–(3)(b) ("does not exceed $25 000"; "$6 for
 * every $1 000 or part of $1 000" to $50 000; "$14 ..." above) and the Supreme
 * Court Civil Rules, Appendix C, Schedule 1, item 1 ($200 to file for the grant,
 * waived at or below $25 000) — never from `PROBATE_RATES`/`probateTax`. */
const BC_EXEMPT_UP_TO = 25_000
const BC_BAND_1_RATE = 6
const BC_TOP_RATE = 14
const BC_FILING_FEE = 200
const bcPublishedFee = (value: number) => value <= BC_EXEMPT_UP_TO ? 0
  : BC_FILING_FEE + (BC_BAND_1_RATE / 1_000) * (Math.min(value, 50_000) - BC_EXEMPT_UP_TO)
    + (BC_TOP_RATE / 1_000) * Math.max(0, value - 50_000)

function planForBand(province: Province, nonReg: number): Inputs {
  // Built from `planFor` so the horizon is the terminal one the main plan uses,
  // then frozen: no savings, spending, growth, fees, distributions or public
  // pension, and the only probatable asset is the non-registered balance. The
  // three plans therefore straddle the published bands exactly instead of
  // compounding out of them.
  return {
    ...planFor(province),
    annualSavings: 0,
    retirementSpending: 0,
    returns: { tfsa: 0, rrsp: 0, nonReg: 0 },
    fees: 0,
    nonRegDistributionYield: 0,
    cppAnnualAt65: 0,
    oasAnnualAt65: 0,
    balances: { tfsa: 0, rrsp: 0, nonReg },
    nonRegBook: nonReg,
    principalResidence: null,
  }
}

/** JSON with every number at full precision; the sweep compares one revision's
 * file against the other's byte for byte after this normalisation. */
const normalise = (value: unknown) => JSON.stringify(value, (_key, item) =>
  typeof item === 'number' && !Number.isFinite(item) ? String(item) : item, 1)

it('prints the confinement sweep for one runtime', () => {
  const report: Record<string, unknown> = { probate: {}, incomeTax: {}, projection: {}, inBand: {} }
  for (const province of PROVINCES) {
    ;(report.probate as Record<string, unknown>)[province] = probateGrid(province)
    ;(report.incomeTax as Record<string, unknown>)[province] = incomeTaxGrid(province)
    const result = runProjection(planFor(province))
    // The whole priced result, so income tax, benefits, balances, estate value
    // and every derived field are compared rather than a hand-picked subset.
    ;(report.projection as Record<string, unknown>)[province] = result
    // A plan inside each band a probate change can move, for every
    // jurisdiction. The whole result is recorded, not just the fee, so a derived
    // `estateValue` move is caught as well as the direct one.
    const inBand: Record<string, unknown> = {}
    for (const { tag, nonReg } of BAND_TARGETS) inBand[tag] = runProjection(planForBand(province, nonReg))
    ;(report.inBand as Record<string, unknown>)[province] = inBand
  }
  // eslint-disable-next-line no-console
  console.log(`CONFINEMENT_SWEEP ${normalise(report)}`)
  expect(PROVINCES).toHaveLength(13)
  // The in-band plans are only useful if they put the probate base inside the
  // bands they claim: assert the *base*, not the fee, so a future edit that lets
  // the balance drift out of its band fails loudly instead of silently making
  // the sweep vacuous again. The frozen plan has no other asset, so the base is
  // the net worth the projection closes on, and it is the plan's own `nonReg` —
  // never read from `PROBATE_RATES`.
  const probesFor = (province: Province) =>
    (report.inBand as Record<string, Record<string, { probateFee: number; finalNetWorth: number }>>)[province]
  for (const province of PROVINCES)
    for (const { tag, nonReg } of BAND_TARGETS) {
      const probe = probesFor(province)[tag]
      expect(probe.finalNetWorth, `${province}/${tag} closes on its constructed base`)
        .toBeCloseTo(nonReg, 6)
      expect(probe.probateFee, `${province}/${tag} priced`).toBeGreaterThanOrEqual(0)
    }
  // The three plans really do straddle every band BC's published ladder has, so
  // a BC boundary or rate move cannot leave this sweep unchanged: nothing in the
  // exemption, the filing fee plus $6 per $1,000 in the middle band, and the
  // $14 tier above $50,000. The expectation is the hand-keyed ladder above, not
  // `probateTax`, so this is an instrument reading rather than an echo.
  const bc = probesFor('BC')
  for (const { tag, nonReg } of BAND_TARGETS)
    expect(bc[tag].probateFee, `BC/${tag} vs the published ladder`)
      .toBeCloseTo(bcPublishedFee(nonReg), 6)
  expect(bc.exemptUnder25k.probateFee, 'BC exemption').toBe(0)
  expect(bc.band25kTo50k.probateFee, 'BC middle band is not the old flat $200')
    .not.toBeCloseTo(200, 6)
})
