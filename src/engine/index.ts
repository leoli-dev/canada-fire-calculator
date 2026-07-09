export * from './types'
export { incomeTax, marginalRate, probateTax, qcFssContribution, qcRamqPremium } from './tax'
export {
  cppAnnual,
  oasAnnual,
  oasAfterClawback,
  estimateCppAt65,
  estimateOasAt65,
  allowanceAnnual,
  gisAnnual,
  ccbAnnual,
  CPP_MAX_AT_65,
  OAS_FULL_AT_65,
  GIS_SINGLE,
  GIS_COUPLE,
  ALLOWANCE,
  CCB,
} from './benefits'
export { rrifMinFactor } from './rrif'
export { validateInputs, type ValidationIssue, type Severity } from './validate'
export { buildDebtStream, impliedRate, rollDebtsForward } from './debts'
export { pensionPaid, pensionStartAge, runProjection, type ReturnSampler } from './projection'
export {
  compareStrategies,
  findEarliestFireAge,
  maxSustainableSpending,
  requiredFireAssets,
  scanBenefitTiming,
  targetReport,
  type StrategyResult,
  type TargetReport,
  type TimingResult,
} from './solvers'
export {
  ASSET_ASSUMPTIONS,
  ASSET_CLASSES,
  blendedReturn,
  blendedVolatility,
  type AssetClass,
  type AssetMix,
} from './assets'
