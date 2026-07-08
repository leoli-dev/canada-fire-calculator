import { create } from 'zustand'
import { track } from './analytics'

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
  { id: 'withholding', patterns: ['预扣税', 'withholding tax', 'Withholding tax', 'withholding', 'Withholding', 'retenue à la source', 'Retenue à la source'] },
  { id: 'tfsa', patterns: ['TFSA', 'CELI'] },
  { id: 'nonreg', patterns: ['非注册', 'Non-registered', 'non-registered', 'Non enregistré', 'non enregistré'] },
  { id: 'acb', patterns: ['ACB', 'PBR', '成本基础'] },
  { id: 'cpp', patterns: ['CPP', 'QPP', 'RPC', 'RRQ'] },
  { id: 'oas', patterns: ['OAS', 'SV'] },
  { id: 'gic', patterns: ['GIC', 'CPG', '定存'] },
  { id: 'gis', patterns: ['GIS', 'SRG'] },
  { id: 'ympe', patterns: ['YMPE', 'MGA'] },
  { id: 'meltdown', patterns: ['meltdown', 'Meltdown'] },
  { id: 'clawback', patterns: ['clawback', 'Clawback'] },
  { id: 'fire', patterns: ['FIRE'] },
  { id: 'dwz', patterns: ['Die with Zero', 'Die With Zero'] },
  { id: 'montecarlo', patterns: ['蒙特卡洛', 'Monte Carlo', 'Monte-Carlo'] },
  { id: 'estate', patterns: ['税后遗产价值', '遗产税', '遗产', 'Estate value', 'estate value', 'estate', 'Valeur successorale', 'valeur successorale', 'succession'] },
  { id: 'principalresidence', patterns: ['主要住宅', 'Principal residence', 'principal residence', 'Résidence principale', 'résidence principale'] },
  { id: 'withdrawalorder', patterns: ['取钱顺序', 'Withdrawal order', 'withdrawal order', 'Ordre de décaissement', 'ordre de décaissement', 'ordres de décaissement'] },
  { id: 'bridge', patterns: ['桥接期', 'bridge period', 'Bridge period', 'bridge years', 'années-pont'] },
  { id: 'sequencerisk', patterns: ['收益顺序风险', 'sequence-of-returns risk', 'sequence-of-returns', 'sequence of returns', 'séquence des rendements'] },
  { id: 'realdollars', patterns: ['今日购买力', "today's purchasing power", 'purchasing power', "pouvoir d'achat", 'pouvoir d’achat', 'real dollars'] },
  { id: 'marginalrate', patterns: ['边际税率', 'marginal rate', 'Marginal rate', 'taux marginal', 'Taux marginal'] },
  { id: 'splitting', patterns: ['收入分割', 'income splitting', 'Income splitting', 'fractionnement de revenu', 'Fractionnement de revenu'] },
  { id: 'correlation', patterns: ['收益相关性', '同涨同跌', 'correlation', 'Correlation', 'corrélation', 'Corrélation'] },
  { id: 'mer', patterns: ['MER', 'RFG', '管理费率'] },
  { id: 'taxdrag', patterns: ['税拖累', 'tax drag', 'Tax drag', 'frein fiscal', 'Frein fiscal'] },
  { id: 'agecredit', patterns: ['年龄额度', 'age amount', 'Age amount', "montant en raison de l'âge", "Montant en raison de l'âge"] },
  { id: 'pensioncredit', patterns: ['养老金收入抵免', 'pension income credit', 'Pension income credit', 'crédit pour revenu de pension', 'Crédit pour revenu de pension'] },
  { id: 'dbpension', patterns: ['雇主养老金', 'Employer pension', 'employer pension', "Régime de retraite d'employeur", "régime de retraite d'employeur", "Rente d'employeur", "rente d'employeur", 'pension statement', 'DB pension'] },
  { id: 'bridgebenefit', patterns: ['过桥金', 'Bridge benefit', 'bridge benefit', 'Prestation de raccordement', 'prestation de raccordement'] },
  { id: 'surtax', patterns: ['surtax', 'Surtax', '附加税', 'surtaxe', 'Surtaxe'] },
  { id: 'rent', patterns: ['净租金', '租金', 'Net rent', 'net rent', 'Rent', 'rent', 'Loyer net', 'loyer net', 'Loyer', 'loyer', 'revenu locatif', 'Revenu locatif'] },
  { id: 'baristafire', patterns: ['Barista FIRE', 'barista FIRE', '额外收入', 'Side income', 'side income', 'revenu d’appoint', 'Revenu d’appoint', "revenu d'appoint", "Revenu d'appoint"] },
  { id: 'debt', patterns: ['负债', '房贷', '还贷', 'Debts', 'debts', 'Debt', 'debt', 'Mortgage', 'mortgage', 'Dettes', 'dettes', 'Dette', 'dette', 'Hypothèque', 'hypothèque'] },
  { id: 'qclevies', patterns: ['RAMQ', 'FSS', 'Fonds des services de santé', 'régime d’assurance médicaments', "régime d'assurance médicaments"] },
  { id: 'fhsa', patterns: ['FHSA', 'CELIAPP', '首套房储蓄账户'] },
  { id: 'hbp', patterns: ['HBP', 'RAP', '购房计划', "Home Buyers' Plan", "home buyers' plan", "Régime d'accession à la propriété", "régime d'accession à la propriété"] },
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
  history: string[]
  term: string | null
  open: (id: string) => void
  back: () => void
  close: () => void
}

export const useGlossary = create<GlossaryState>((set) => ({
  history: [],
  term: null,
  open: (id) =>
    set((s) => {
      if (s.history[s.history.length - 1] === id) return s
      track('glossary_open', { term: id })
      const history = [...s.history, id]
      return { history, term: id }
    }),
  back: () =>
    set((s) => {
      const history = s.history.slice(0, -1)
      return { history, term: history[history.length - 1] ?? null }
    }),
  close: () => set({ history: [], term: null }),
}))
