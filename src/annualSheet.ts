/** View contract only: adapters must normalize monetary values to nominal CAD once. */
export type AnnualSheetText = string | { en: string; fr: string; zh: string }
export type AnnualSheetStatus = 'calculated' | 'estimated' | 'unknown' | 'not-computed' | 'not-applicable'
export type AnnualSheetUnit = 'CAD' | 'number' | 'percent' | 'years'
export interface AnnualSheetExplanation {
  summary?: AnnualSheetText
  sources?: { label: AnnualSheetText; id?: string; granularity: 'input' | 'event' | 'year' | 'run' }[]
  /** CAD components use normalized nominal CAD, independently of display mode.
   * References must use the same normalization as cells; tax bases opt out explicitly.
   */
  formula?: { label: AnnualSheetText; value: number; direction: 'add' | 'subtract'; unit: AnnualSheetUnit; basis?: 'nominal-CAD' | 'nominal-tax-basis' }[]
  rulePackage?: string
  taxYear?: number
  /** Calendar year being evaluated; separate from the source pack tax year. */
  projectionYear?: number
  formulaBasis?: AnnualSheetText
  forwardAssumption?: AnnualSheetText
  limitations?: AnnualSheetText[]
}
export interface AnnualSheetCell {
  /** null/nonfinite computed values normalize to unknown at the view boundary.
   * Unavailable statuses never expose a numeric value, even if supplied by an adapter.
   * Zero is a computed value, never a missing-value sentinel.
   */
  value: number | null
  unit: AnnualSheetUnit
  status: AnnualSheetStatus
  timing: 'opening' | 'during-year' | 'closing' | 'terminal'
  /** Nominal tax bases stay nominal in either display mode. */
  basis?: 'nominal-CAD' | 'nominal-tax-basis'
  /** Override for a native stream whose settlement clock differs from the column. */
  realFactor?: number
  /** Explicit real-basis difference for presentation bridges only (never a cash flow). */
  realValue?: number
  nativeBasis?: AnnualSheetText
  conversion?: AnnualSheetText
  reason?: AnnualSheetText
  explanationRefs?: string[]
}
export interface AnnualSheetRow {
  id: string
  label: AnnualSheetText
  kind?: 'group' | 'value'
  entity?: { kind: 'person' | 'account' | 'debt' | 'property' | 'event' | 'policy' | 'contract'; id: string }
  children?: AnnualSheetRow[]
  initiallyExpanded?: boolean
  cells?: Record<number, AnnualSheetCell>
}
export interface AnnualSheetYear {
  year: number
  /** Multiply normalized nominal CAD by this factor to express base-year CAD. */
  openingRealFactor?: number
  realFactor: number
}
export interface AnnualSheetJump {
  id: string
  label: AnnualSheetText
  year: number
  kind: 'retirement' | 'living-shortfall' | 'event-shortfall' | 'terminal' | 'benefit' | 'property' | 'other'
  rowId?: string
  reason?: AnnualSheetText
  entityId?: string
}
export interface AnnualSheetModel {
  scenarioId: string
  revision: string | number
  title: AnnualSheetText
  scope: AnnualSheetText
  baseYear: number
  years: AnnualSheetYear[]
  rows: AnnualSheetRow[]
  jumps?: AnnualSheetJump[]
  /** Invoked only when details are opened, never during simulation or table rendering. */
  resolveExplanation?: (reference: string) => AnnualSheetExplanation | undefined
}

export function annualSheetText(text: AnnualSheetText, language: string): string {
  return typeof text === 'string' ? text : text[language.startsWith('fr') ? 'fr' : language.startsWith('zh') ? 'zh' : 'en']
}

export function annualSheetDisplayValue(cell: AnnualSheetCell, year: AnnualSheetYear, mode: 'real' | 'nominal'): number | null {
  if (!['calculated', 'estimated'].includes(cell.status) || cell.value === null || !Number.isFinite(cell.value)) return null
  if (cell.unit !== 'CAD' || cell.basis === 'nominal-tax-basis' || mode === 'nominal') return cell.value
  if (cell.realValue !== undefined) return Number.isFinite(cell.realValue) ? cell.realValue : null
  const factor = cell.realFactor ?? (cell.timing === 'opening' ? year.openingRealFactor ?? year.realFactor : year.realFactor)
  const converted = cell.value * factor
  return Number.isFinite(factor) && factor > 0 && Number.isFinite(converted) ? converted : null
}

/** Defensive normalization also covers older/untyped adapters without changing their API. */
export function annualSheetCellStatus(cell: AnnualSheetCell | undefined, year: AnnualSheetYear | undefined, mode: 'real' | 'nominal'): AnnualSheetStatus {
  if (!cell) return 'not-computed'
  if (cell.status !== 'calculated' && cell.status !== 'estimated') return ['unknown', 'not-computed', 'not-applicable'].includes(cell.status) ? cell.status : 'unknown'
  return year && annualSheetDisplayValue(cell, year, mode) !== null ? cell.status : 'unknown'
}
