import type { Inputs } from './types'
import { CPP_MAX_AT_65, OAS_FULL_AT_65 } from './benefits'

export type Severity = 'error' | 'warning'

export interface ValidationIssue {
  /** dotted path of the offending input, e.g. 'balances.nonReg' */
  field: string
  severity: Severity
  /** i18n message key (val*) */
  key: string
  params?: Record<string, string | number>
}

const AGE_MIN = 18
const AGE_MAX = 105

/**
 * Cross-field and range checks on the inputs. The engine itself is a total
 * function (it clamps or tolerates out-of-range values), so issues here never
 * block computation — they flag results the user shouldn't trust.
 */
export function validateInputs(inputs: Inputs): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const err = (field: string, key: string, params?: ValidationIssue['params']) =>
    issues.push({ field, severity: 'error', key, params })
  const warn = (field: string, key: string, params?: ValidationIssue['params']) =>
    issues.push({ field, severity: 'warning', key, params })

  // age chain: 18 ≤ current ≤ FIRE ≤ life expectancy ≤ 105
  if (inputs.currentAge < AGE_MIN || inputs.currentAge > AGE_MAX)
    err('currentAge', 'valAgeRange', { min: AGE_MIN, max: AGE_MAX })
  if (inputs.fireAge < inputs.currentAge) err('fireAge', 'valFireBeforeCurrent')
  if (inputs.fireAge > AGE_MAX) err('fireAge', 'valAgeRange', { min: AGE_MIN, max: AGE_MAX })
  if (inputs.lifeExpectancy < inputs.fireAge) err('lifeExpectancy', 'valLifeBeforeFire')
  if (inputs.lifeExpectancy > AGE_MAX)
    err('lifeExpectancy', 'valAgeRange', { min: AGE_MIN, max: AGE_MAX })

  const nonNegative: [string, number | undefined | null][] = [
    ['annualSavings', inputs.annualSavings],
    ['retirementSpending', inputs.retirementSpending],
    ['balances.tfsa', inputs.balances.tfsa],
    ['balances.rrsp', inputs.balances.rrsp],
    ['balances.nonReg', inputs.balances.nonReg],
    ['nonRegBook', inputs.nonRegBook],
    ['cppAnnualAt65', inputs.cppAnnualAt65],
    ['oasAnnualAt65', inputs.oasAnnualAt65],
    ['fireTargetAssets', inputs.fireTargetAssets],
  ]
  for (const [field, v] of nonNegative) {
    if (v != null && v < 0) err(field, 'valNegative')
  }

  // benefit claim windows (engine clamps, but silent clamping misleads)
  const cppCap = inputs.province === 'QC' ? 72 : 70
  if (inputs.cppStartAge < 60 || inputs.cppStartAge > cppCap)
    err('cppStartAge', 'valCppWindow', { min: 60, max: cppCap })
  if (inputs.oasStartAge < 65 || inputs.oasStartAge > 70)
    err('oasStartAge', 'valOasWindow', { min: 65, max: 70 })
  if (inputs.cppAnnualAt65 > CPP_MAX_AT_65)
    warn('cppAnnualAt65', 'valCppMax', { max: CPP_MAX_AT_65 })
  if (inputs.oasAnnualAt65 > OAS_FULL_AT_65)
    warn('oasAnnualAt65', 'valOasMax', { max: OAS_FULL_AT_65 })

  const split =
    (inputs.savingsSplit.tfsa ?? 0) +
    (inputs.savingsSplit.rrsp ?? 0) +
    (inputs.savingsSplit.nonReg ?? 0)
  if (inputs.annualSavings > 0 && Math.abs(split - 1) > 0.005)
    warn('savingsSplit', 'valSplitSum', { sum: Math.round(split * 100) })

  if (inputs.nonRegBook > inputs.balances.nonReg && inputs.balances.nonReg >= 0)
    warn('nonRegBook', 'valBookExceeds')

  const p = inputs.partner
  if (p) {
    if (p.currentAge < AGE_MIN || p.currentAge > AGE_MAX)
      err('partner.currentAge', 'valAgeRange', { min: AGE_MIN, max: AGE_MAX })
    if (p.cppStartAge < 60 || p.cppStartAge > cppCap)
      err('partner.cppStartAge', 'valCppWindow', { min: 60, max: cppCap })
    if (p.oasStartAge < 65 || p.oasStartAge > 70)
      err('partner.oasStartAge', 'valOasWindow', { min: 65, max: 70 })
    if (p.cppAnnualAt65 < 0) err('partner.cppAnnualAt65', 'valNegative')
    if (p.oasAnnualAt65 < 0) err('partner.oasAnnualAt65', 'valNegative')
    if (p.cppAnnualAt65 > CPP_MAX_AT_65)
      warn('partner.cppAnnualAt65', 'valCppMax', { max: CPP_MAX_AT_65 })
    if (p.oasAnnualAt65 > OAS_FULL_AT_65)
      warn('partner.oasAnnualAt65', 'valOasMax', { max: OAS_FULL_AT_65 })
  }

  const pr = inputs.principalResidence
  if (pr) {
    if (pr.value < 0) err('principalResidence.value', 'valNegative')
    if (pr.sellAtAge !== null && pr.sellAtAge < inputs.currentAge)
      warn('principalResidence.sellAtAge', 'valSellInPast')
  }
  const ip = inputs.investmentProperty
  if (ip) {
    if (ip.value < 0) err('investmentProperty.value', 'valNegative')
    if (ip.acb < 0) err('investmentProperty.acb', 'valNegative')
    if (ip.acb > ip.value) warn('investmentProperty.acb', 'valAcbAboveValue')
    if (ip.sellAtAge !== null && ip.sellAtAge < inputs.fireAge)
      warn('investmentProperty.sellAtAge', 'valSellBeforeFire')
  }

  return issues
}
