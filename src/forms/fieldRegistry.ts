import type { Inputs } from '../engine'

export type SharedFieldId = 'currentAge' | 'fireAge' | 'lifeExpectancy' | 'annualSavings' | 'retirementSpending' | 'nonRegBook' | 'balances.tfsa' | 'balances.rrsp' | 'balances.nonReg' | 'principalResidence.annualMortgagePayment'
export type FieldUnit = 'years' | 'annualCad' | 'cad'
export interface FieldDefinition {
  id: SharedFieldId
  unit: FieldUnit
  min: number
  max: number
  integer?: boolean
  guidedBinding: string
  professionalBinding: string
  estimatePolicy: 'none' | 'explicit'
  capability: 'supported'
  read: (inputs: Inputs) => number
  write: (inputs: Inputs, value: number) => Inputs
}

const scalar = (id: 'currentAge' | 'fireAge' | 'lifeExpectancy' | 'annualSavings' | 'retirementSpending', unit: FieldUnit, min: number, max: number, integer = false): FieldDefinition => ({
  id, unit, min, max, integer, guidedBinding: id, professionalBinding: id,
  estimatePolicy: 'explicit', capability: 'supported',
  read: (inputs) => inputs[id],
  write: (inputs, value) => ({ ...inputs, [id]: value }),
})

export const fieldRegistry: Record<SharedFieldId, FieldDefinition> = {
  currentAge: scalar('currentAge', 'years', 0, 120, true),
  fireAge: scalar('fireAge', 'years', 0, 120, true),
  lifeExpectancy: scalar('lifeExpectancy', 'years', 0, 120, true),
  annualSavings: scalar('annualSavings', 'annualCad', 0, 1e12),
  retirementSpending: scalar('retirementSpending', 'annualCad', 0, 1e12),
  nonRegBook: { id: 'nonRegBook', unit: 'cad', min: 0, max: 1e12,
    guidedBinding: 'nonRegBook', professionalBinding: 'nonRegBook', estimatePolicy: 'none', capability: 'supported',
    read: inputs => inputs.nonRegBook,
    write: (inputs, value) => ({ ...inputs, nonRegBook: value }) },
  'balances.tfsa': balance('tfsa'),
  'balances.rrsp': balance('rrsp'),
  'balances.nonReg': balance('nonReg'),
  'principalResidence.annualMortgagePayment': {
    id: 'principalResidence.annualMortgagePayment', unit: 'annualCad', min: 0, max: 1e12,
    guidedBinding: 'principalResidence.annualMortgagePayment', professionalBinding: 'principalResidence.annualMortgagePayment',
    estimatePolicy: 'explicit', capability: 'supported',
    read: (inputs) => inputs.principalResidence?.mode === 'planned' ? inputs.principalResidence.annualMortgagePayment ?? 0 : 0,
    write: (inputs, value) => inputs.principalResidence?.mode === 'planned' ? { ...inputs, principalResidence: { ...inputs.principalResidence, annualMortgagePayment: value } } : inputs,
  },
}

function balance(account: 'tfsa' | 'rrsp' | 'nonReg'): FieldDefinition {
  const id = `balances.${account}` as SharedFieldId
  return { id, unit: 'cad', min: 0, max: 1e12, guidedBinding: id, professionalBinding: id,
    estimatePolicy: 'explicit', capability: 'supported',
    read: (inputs) => inputs.balances[account],
    write: (inputs, value) => ({ ...inputs, balances: { ...inputs.balances, [account]: value } }),
  }
}

export function isSharedField(id: string): id is SharedFieldId {
  return Object.prototype.hasOwnProperty.call(fieldRegistry, id)
}

export function parseField(id: SharedFieldId, raw: string, displayUnit: 'canonical' | 'monthly' = 'canonical'):
  { status: 'valid'; value: number } | { status: 'draft'; reason: 'empty' | 'incomplete' | 'invalid' } {
  const trimmed = raw.trim()
  if (!trimmed) return { status: 'draft', reason: 'empty' }
  if (trimmed === '-' || trimmed === '.' || trimmed === '-.') return { status: 'draft', reason: 'incomplete' }
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return { status: 'draft', reason: 'invalid' }
  const definition = fieldRegistry[id]
  const entered = Number(trimmed)
  // Annual CAD is stored to cents after an intentional monthly edit. Display
  // rounding alone must never be written back (NumberInput guards no-edit blur).
  const value = displayUnit === 'monthly' && definition.unit === 'annualCad'
    ? Math.round(entered * 12 * 100) / 100 : entered
  if (!Number.isFinite(value) || value < definition.min || value > definition.max || (definition.integer && !Number.isInteger(value))) return { status: 'draft', reason: 'invalid' }
  return { status: 'valid', value }
}

export function formatField(id: SharedFieldId, inputs: Inputs, displayUnit: 'canonical' | 'monthly' = 'canonical'): number {
  const value = fieldRegistry[id].read(inputs)
  return displayUnit === 'monthly' && fieldRegistry[id].unit === 'annualCad' ? value / 12 : value
}
