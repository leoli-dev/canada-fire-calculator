export * from './types'
export { incomeTax } from './tax'
export {
  cppAnnual,
  oasAnnual,
  oasAfterClawback,
  estimateCppAt65,
  estimateOasAt65,
  CPP_MAX_AT_65,
  OAS_FULL_AT_65,
} from './benefits'
export { rrifMinFactor } from './rrif'
export { pensionStartAge, runProjection, type ReturnSampler } from './projection'
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
