export * from './types'
export { incomeTax, marginalRate, probateTax, qcFssContribution, qcRamqPremium } from './tax'
// BE-38 B1: the plan-anchored, versioned tax rule selection the computation
// reads, its refusals and the provenance every priced result carries.
export {
  PLAN_TAX_YEAR,
  anchorTaxRules,
  selectPlanTaxRules,
  trySelectPlanTaxRules,
  taxRuleProvenance,
  type TaxRuleContext,
  type TaxRuleRequest,
  type TaxRuleSelection,
  type TaxRuleProvenance,
} from './tax'
export { calculateQuebecTax, scheduleB2026, scheduleF2026, ramqPremium2026, ramqScheduleK2025,
  ramqMonthlyPeriodMaximum, qcCoverageUniform, qcCoverageAnnualStatus, applyQcAnnualCoverage,
  QC_DRUG_MONTHS_PER_YEAR, type QuebecTaxResult, type QuebecTaxRow } from './quebecTax'
export {
  cppAnnual,
  cppAgeFactor,
  cppAnnualAtBasis,
  oasAnnual,
  oasAgeFactor,
  oasAnnualAtBasis,
  oasAfterClawback,
  estimateCppAt65,
  estimateOasAt65,
  earlyClaimDilutionRelief,
  allowanceAnnual,
  gisAnnual,
  basisAnnualAmount,
  benefitIncomeBasis,
  gisHouseholdCategory,
  gisWorkExemption,
  ccbAnnual,
  CPP_MAX_AT_65,
  CPP_OAS_UNSUPPORTED_PATHS,
  type BenefitUnsupportedPath,
  OAS_FULL_AT_65,
  OAS_GIS_ALLOWANCE_2026_Q3,
  GIS_HOUSEHOLD_CATEGORIES,
  CCB,
  type BenefitBasis,
  type BenefitIncomeBasis,
  type GisHouseholdClassification,
} from './benefits'
// BE-39 A: CPP/QPP and OAS amount provenance and retirement-age dependency
// invalidation; `personCppAnnual` is the one shared annual-benefit formula.
export {
  normalizePensionAmount,
  pensionAmountDisplay,
  pensionAmountFromDisplay,
  pensionAmountWarning,
  syncPensionAmounts,
  refreshPensionProvenance,
  refreshPensionProvenanceReport,
  deriveCppAmount,
  deriveOasAmount,
  cppEstimatorProvenance,
  oasEstimatorProvenance,
  manualProvenance,
  provenanceForTypedAmount,
  typedAmountSource,
  statementProvenance,
  reconfirmStatementAmount,
  personCppAnnual,
  personOasAnnual,
  inputsCppAnnual,
  inputsOasAnnual,
  type PensionAmountReading,
  type PensionAmountDerivation,
  type PensionAmountWarning,
  type PensionBenefitField,
  type PensionBenefitRewrite,
  type PensionProvenanceRefresh,
} from './pensionProvenance'
export { rrifMinFactor } from './rrif'
export { validateInputs, type ValidationIssue, type Severity } from './validate'
export { buildDebtStream, impliedRate, rollDebtsForward } from './debts'
export { pensionPaid, pensionStartAge, runProjection, type ReturnSampler } from './projection'
// BE-14 A state API; UI, solvers, strategy and MC consumers move in BE-14 B.
export {
  initializeState, annualStep, projectFromState, fixedReturnProvider,
  sumInvestableAssets, sumNetWorth, sumWithdrawals,
  type AnnualState, type AnnualProviders, type AnnualEvaluation, type AnnualContext,
  type AnnualIssue, type AnnualStepValue, type KernelResult, type YearRow as AnnualStateYearRow,
} from './annualState'
export {
  compareStrategies,
  rankCandidates,
  findEarliestFireAge,
  maxSustainableSpending,
  requiredFireAssets,
  scanBenefitTiming,
  targetReport,
  type StrategyResult,
  type RankedCandidate,
  type CandidateRankingStatus,
  type SolverResult,
  type SolverStatus,
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
