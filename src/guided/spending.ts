import { WORKSHEET_KEYS } from '../store'

/** The retirement-spending categories added up, the figure the category path applies. */
export function worksheetTotal(worksheet: Record<string, number> | undefined): number {
  return WORKSHEET_KEYS.reduce((sum, key) => sum + Math.max(0, worksheet?.[key] ?? 0), 0)
}
