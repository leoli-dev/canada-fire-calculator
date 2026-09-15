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
    50_000, 50_001, 100_000, 125_000, 200_000, 250_000, 250_001, 500_000, 1_000_000, 5_000_000]
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

/** JSON with every number at full precision; the sweep compares one revision's
 * file against the other's byte for byte after this normalisation. */
const normalise = (value: unknown) => JSON.stringify(value, (_key, item) =>
  typeof item === 'number' && !Number.isFinite(item) ? String(item) : item, 1)

it('prints the confinement sweep for one runtime', () => {
  const report: Record<string, unknown> = { probate: {}, incomeTax: {}, projection: {} }
  for (const province of PROVINCES) {
    ;(report.probate as Record<string, unknown>)[province] = probateGrid(province)
    ;(report.incomeTax as Record<string, unknown>)[province] = incomeTaxGrid(province)
    const result = runProjection(planFor(province))
    // The whole priced result, so income tax, benefits, balances, estate value
    // and every derived field are compared rather than a hand-picked subset.
    ;(report.projection as Record<string, unknown>)[province] = result
  }
  // eslint-disable-next-line no-console
  console.log(`CONFINEMENT_SWEEP ${normalise(report)}`)
  expect(PROVINCES).toHaveLength(13)
})
