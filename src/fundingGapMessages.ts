import type { FundingGap } from './engine/funding'

/** Shared validation-message mapping; never expose engine field/reason diagnostics as copy. */
export function fundingGapMessageKey(reason: FundingGap['reason']) {
  return ({
    invalidPurchase: 'valPurchaseInvalid', missingMortgage: 'valPurchaseMortgageRequired',
    fhsaContribution: 'valFhsaContributionUnfunded', employeeContribution: 'valContributionsUnfunded',
    saleDischarge: 'valSaleDischargeUnfunded', saleTax: 'valSaleTaxUnfunded',
    hbpRepaymentTax: 'valHbpTaxUnfunded', purchaseCost: 'valPurchaseCostUnfunded',
    downPayment: 'valDownPaymentUnfunded',
  } as const)[reason] ?? 'valDownPaymentUnfunded'
}
