// Tax year 2025/2026 figures, today's dollars. Update annually.
// Known simplifications (see docs/PLAN.md): no ON surtax, no federal BPA
// phase-out for high income, no dividend gross-up/credit.
import type { Province } from './types'

export interface Bracket {
  upTo: number
  rate: number
}

export interface TaxTable {
  brackets: Bracket[]
  /** basic personal amount, credited at the lowest bracket rate */
  bpa: number
}

export const FEDERAL: TaxTable = {
  bpa: 16129,
  brackets: [
    { upTo: 57375, rate: 0.14 },
    { upTo: 114750, rate: 0.205 },
    { upTo: 177882, rate: 0.26 },
    { upTo: 253414, rate: 0.29 },
    { upTo: Infinity, rate: 0.33 },
  ],
}

/** Quebec residents get an abatement on federal tax */
export const QC_ABATEMENT = 0.165

export const PROVINCIAL: Record<Province, TaxTable> = {
  ON: {
    bpa: 12747,
    brackets: [
      { upTo: 52886, rate: 0.0505 },
      { upTo: 105775, rate: 0.0915 },
      { upTo: 150000, rate: 0.1116 },
      { upTo: 220000, rate: 0.1216 },
      { upTo: Infinity, rate: 0.1316 },
    ],
  },
  QC: {
    bpa: 18571,
    brackets: [
      { upTo: 53255, rate: 0.14 },
      { upTo: 106495, rate: 0.19 },
      { upTo: 129590, rate: 0.24 },
      { upTo: Infinity, rate: 0.2575 },
    ],
  },
  BC: {
    bpa: 12932,
    brackets: [
      { upTo: 49279, rate: 0.0506 },
      { upTo: 98560, rate: 0.077 },
      { upTo: 113158, rate: 0.105 },
      { upTo: 137407, rate: 0.1229 },
      { upTo: 186306, rate: 0.147 },
      { upTo: 259829, rate: 0.168 },
      { upTo: Infinity, rate: 0.205 },
    ],
  },
  AB: {
    bpa: 22323,
    brackets: [
      { upTo: 60000, rate: 0.08 },
      { upTo: 151234, rate: 0.1 },
      { upTo: 181481, rate: 0.12 },
      { upTo: 241974, rate: 0.13 },
      { upTo: 362961, rate: 0.14 },
      { upTo: Infinity, rate: 0.15 },
    ],
  },
}

export const CAPITAL_GAINS_INCLUSION = 0.5
