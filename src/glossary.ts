import { create } from 'zustand'

/**
 * Glossary terms and the surface forms (per language) that become clickable.
 * Longest pattern wins; ASCII matches additionally require word boundaries.
 */
export interface TermDef {
  id: string
  patterns: string[]
}

export const TERMS: TermDef[] = [
  { id: 'rrsp', patterns: ['RRSP', 'REER'] },
  { id: 'rrif', patterns: ['RRIF', 'FERR'] },
  { id: 'tfsa', patterns: ['TFSA', 'CELI'] },
  { id: 'nonreg', patterns: ['非注册', 'Non-registered', 'non-registered', 'Non enregistré', 'non enregistré'] },
  { id: 'acb', patterns: ['ACB', 'PBR', '成本基础'] },
  { id: 'cpp', patterns: ['CPP', 'QPP', 'RPC', 'RRQ'] },
  { id: 'oas', patterns: ['OAS', 'SV'] },
  { id: 'gic', patterns: ['GIC', 'CPG', '定存'] },
  { id: 'ympe', patterns: ['YMPE', 'MGA'] },
  { id: 'meltdown', patterns: ['meltdown', 'Meltdown'] },
  { id: 'clawback', patterns: ['clawback', 'Clawback'] },
  { id: 'fire', patterns: ['FIRE'] },
  { id: 'dwz', patterns: ['Die with Zero', 'Die With Zero'] },
  { id: 'montecarlo', patterns: ['蒙特卡洛', 'Monte Carlo', 'Monte-Carlo'] },
  { id: 'estate', patterns: ['税后遗产价值', '遗产税', '遗产', 'Estate value', 'estate value', 'estate', 'Valeur successorale', 'valeur successorale', 'succession'] },
  { id: 'principalresidence', patterns: ['主要住宅', 'Principal residence', 'principal residence', 'Résidence principale', 'résidence principale'] },
]

const ALL = TERMS.flatMap((t) => t.patterns.map((p) => ({ p, id: t.id }))).sort(
  (a, b) => b.p.length - a.p.length,
)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const TERM_REGEX = new RegExp(ALL.map((x) => escapeRe(x.p)).join('|'), 'gu')

export function termIdFor(match: string): string | undefined {
  return ALL.find((x) => x.p === match)?.id
}

interface GlossaryState {
  term: string | null
  open: (id: string) => void
  close: () => void
}

export const useGlossary = create<GlossaryState>((set) => ({
  term: null,
  open: (id) => set({ term: id }),
  close: () => set({ term: null }),
}))
