import type { Inputs } from '../engine'
import type { InputsV2 } from '../engine/model'
import { hasRecordedRegisteredType } from './accountFacts'
import { spousalPlanAccounts, taxDetailsSkipped } from './taxDetails'
import type { CategoryDefinition, QuestionAnswers, QuestionDefinition } from './schema'

export const QUESTION_CATEGORIES: readonly CategoryDefinition[] = [
  { id: 'family', contentKey: 'family' },
  { id: 'saving', contentKey: 'saving' },
  { id: 'assets', contentKey: 'assets' },
  { id: 'housing', contentKey: 'housing' },
  { id: 'spending', contentKey: 'spending' },
  { id: 'income', contentKey: 'income' },
  { id: 'preferences', contentKey: 'preferences' },
  { id: 'taxDetails', contentKey: 'taxDetails' },
]

const page = (
  id: string,
  categoryId: QuestionDefinition['categoryId'],
  questions: readonly string[],
  fieldBindings: readonly string[],
  options: Partial<Pick<QuestionDefinition, 'estimatePolicy' | 'applicableWhen' | 'prerequisitePageId' | 'optional'>> = {},
): QuestionDefinition => ({
  id,
  categoryId,
  contentKey: id.replaceAll('.', '_'),
  guidanceKey: id,
  questions,
  fieldBindings,
  estimatePolicy: options.estimatePolicy ?? 'fact-only',
  ...options,
})

const answerIs = (answers: QuestionAnswers, id: string, value: string) => answers[id] === value
const accountSelected = (answers: QuestionAnswers, kind: string) =>
  ((answers['assets.identify'] as string[] | undefined) ?? []).includes(kind)

export const QUESTION_CATALOG: readonly QuestionDefinition[] = [
  page('family.people', 'family', ['household'], ['household']),
  page('family.ages', 'family', ['currentAge', 'partnerAge'], ['currentAge', 'partner.currentAge']),
  // FE-43 A: household tax facts live where the user is already thinking about them.
  page('family.spouseSupport', 'family', ['spouseSupport'], [], { applicableWhen: (i) => !!i.partner, estimatePolicy: 'none', optional: true }),
  page('family.children', 'family', ['children'], ['children']),
  page('family.province', 'family', ['province'], ['province']),
  page('family.qcDrug', 'family', ['qcDrugCoverage'], [], { applicableWhen: (i) => i.province === 'QC', estimatePolicy: 'none', optional: true }),
  page('time.work', 'family', ['workStyle', 'targetAssets'], ['fireAge', 'fireTargetAssets']),
  page('time.horizon', 'family', ['lifeExpectancy'], ['lifeExpectancy']),

  page('saving.method', 'saving', ['savingUnit'], []),
  page('saving.amount', 'saving', ['annualSavings'], ['annualSavings']),
  // BE-13 A: what the saving figure means. Placed right after the amount so the
  // basis is decided next to the number it reinterprets.
  page('budget.method', 'saving', ['budgetMode'], ['budget.method', 'budget.debtIncluded', 'budget.taxBenefitIncluded']),
  // FE-43 B: current employment income per person; optional, it only feeds the
  // RRSP room preview.
  page('saving.earned', 'saving', ['earnedIncome'], [], { estimatePolicy: 'none', optional: true }),
  page('work.after', 'saving', ['extraIncome'], ['extraIncome']),
  page('work.amount', 'saving', ['extraIncomeAnnual'], ['extraIncome.annual'], {
    applicableWhen: (_inputs, answers) => answerIs(answers, 'work.after', 'yes'),
    prerequisitePageId: 'work.after',
  }),
  page('work.period', 'saving', ['extraIncomeFrom', 'extraIncomeTo'], ['extraIncome.fromAge', 'extraIncome.toAge'], {
    applicableWhen: (_inputs, answers) => answerIs(answers, 'work.after', 'yes'),
    prerequisitePageId: 'work.after',
  }),

  page('assets.identify', 'assets', ['accounts'], ['balances', 'fhsa', 'lockedRetirement']),
  page('account.tfsa.balance', 'assets', ['balance'], ['balances.tfsa'], { applicableWhen: (_i, a) => accountSelected(a, 'tfsa'), prerequisitePageId: 'assets.identify' }),
  page('account.rrsp.balance', 'assets', ['balance'], ['balances.rrsp'], { applicableWhen: (_i, a) => accountSelected(a, 'rrsp'), prerequisitePageId: 'assets.identify' }),
  // FE-43 B: the account type defaults to a plain RRSP; a RRIF asks its own
  // minimum-withdrawal facts on the next page.
  page('account.rrsp.type', 'assets', ['registeredType'], [], { applicableWhen: (_i, a, plan) => accountSelected(a, 'rrsp') || hasRecordedRegisteredType(plan), prerequisitePageId: 'assets.identify', estimatePolicy: 'none', optional: true }),
  page('account.rrif.details', 'assets', ['rrifOpened', 'rrifCategory'], [], { applicableWhen: (_i, _a, plan) => !!plan?.accounts.some((account) => account.kind === 'rrif'), prerequisitePageId: 'account.rrsp.type', estimatePolicy: 'none', optional: true }),
  page('account.nonReg.balance', 'assets', ['balance', 'nonRegBook'], ['balances.nonReg', 'nonRegBook'], { applicableWhen: (_i, a) => accountSelected(a, 'nonReg'), prerequisitePageId: 'assets.identify' }),
  page('allocation.tfsa', 'assets', ['allocation'], ['savingsSplit.tfsa', 'savingsSplit.rrsp', 'savingsSplit.nonReg'], { estimatePolicy: 'assumption' }),
  page('fhsa.details', 'assets', ['fhsaBalance', 'fhsaContribution'], ['fhsa.balance', 'fhsa.annualContribution'], { applicableWhen: (i) => !!i.fhsa, prerequisitePageId: 'assets.identify' }),
  page('fhsa.open', 'assets', ['fhsaOpened'], ['fhsa.openedYearsAgo'], { applicableWhen: (i) => !!i.fhsa, prerequisitePageId: 'assets.identify' }),
  page('locked.balance', 'assets', ['lockedBalance'], ['lockedRetirement.balance'], { applicableWhen: (i) => !!i.lockedRetirement, prerequisitePageId: 'assets.identify' }),
  page('locked.access', 'assets', ['lockedAccess', 'lockedOwner'], ['lockedRetirement.accessibleAge', 'lockedRetirement.owner'], { applicableWhen: (i) => !!i.lockedRetirement, prerequisitePageId: 'assets.identify' }),
  page('locked.contributions', 'assets', ['lockedEmployee', 'lockedEmployer'], ['lockedRetirement.employeeContribution', 'lockedRetirement.employerContribution'], { applicableWhen: (i) => !!i.lockedRetirement, prerequisitePageId: 'assets.identify' }),
  page('assets.ownership', 'assets', ['accountOwnership'], [], { applicableWhen: (i) => !!i.partner, estimatePolicy: 'none' }),

  page('home.situation', 'housing', ['homeSituation'], ['housingMode']),
  page('home.value', 'housing', ['homeValue', 'homeFuture'], ['principalResidence.value', 'principalResidence.sellAtAge'], { applicableWhen: (i) => !!i.principalResidence && i.principalResidence.mode !== 'planned', prerequisitePageId: 'home.situation' }),
  page('home.mortgage', 'housing', ['hasMortgage'], ['principalResidence.mortgage'], { applicableWhen: (i) => !!i.principalResidence && i.principalResidence.mode !== 'planned', prerequisitePageId: 'home.situation' }),
  page('mortgage.balance', 'housing', ['mortgageBalance'], ['principalResidence.mortgage.balance'], { applicableWhen: (i) => !!i.principalResidence && i.principalResidence.mode !== 'planned' && !!i.principalResidence.mortgage, prerequisitePageId: 'home.mortgage' }),
  page('mortgage.payment', 'housing', ['mortgagePayment', 'mortgageTerm'], ['principalResidence.mortgage.annualPayment', 'principalResidence.mortgage.yearsRemaining'], { applicableWhen: (i) => !!i.principalResidence && i.principalResidence.mode !== 'planned' && !!i.principalResidence.mortgage, prerequisitePageId: 'home.mortgage' }),
  page('purchase.time', 'housing', ['purchaseAge'], ['principalResidence.buyAtAge'], { applicableWhen: (i) => i.principalResidence?.mode === 'planned', prerequisitePageId: 'home.situation' }),
  page('purchase.price', 'housing', ['purchasePrice', 'downPayment'], ['principalResidence.price', 'principalResidence.downPayment'], { applicableWhen: (i) => i.principalResidence?.mode === 'planned', prerequisitePageId: 'home.situation' }),
  page('purchase.loan', 'housing', ['purchasePayment', 'purchaseTerm'], ['principalResidence.annualMortgagePayment', 'principalResidence.mortgageYears'], { applicableWhen: (i) => i.principalResidence?.mode === 'planned', prerequisitePageId: 'home.situation' }),
  page('housing.other', 'housing', ['rentals', 'otherDebt'], ['investmentProperties', 'debts']),
  page('rental.0.value', 'housing', ['rentalValue', 'rentalCost'], ['investmentProperties.0.value', 'investmentProperties.0.acb'], { applicableWhen: (i) => (i.investmentProperties?.length ?? 0) > 0, prerequisitePageId: 'housing.other' }),
  page('rental.0.income', 'housing', ['rentalIncome', 'rentalSale'], ['investmentProperties.0.annualRent', 'investmentProperties.0.sellAtAge', 'investmentProperties.0.saleExpenses'], { applicableWhen: (i) => (i.investmentProperties?.length ?? 0) > 0, prerequisitePageId: 'housing.other' }),
  page('rental.0.mortgage', 'housing', ['rentalMortgage'], ['investmentProperties.0.mortgage'], { applicableWhen: (i) => (i.investmentProperties?.length ?? 0) > 0, prerequisitePageId: 'housing.other' }),
  page('rental.0.loan', 'housing', ['rentalLoanBalance', 'rentalLoanPayment'], ['investmentProperties.0.mortgage.balance', 'investmentProperties.0.mortgage.annualPayment'], { applicableWhen: (i) => !!i.investmentProperties?.[0]?.mortgage, prerequisitePageId: 'rental.0.mortgage' }),
  page('rental.0.term', 'housing', ['rentalLoanTerm'], ['investmentProperties.0.mortgage.yearsRemaining'], { applicableWhen: (i) => !!i.investmentProperties?.[0]?.mortgage, prerequisitePageId: 'rental.0.mortgage' }),
  page('debt.0.type', 'housing', ['debtType'], ['debts.0.kind'], { applicableWhen: (i) => (i.debts?.length ?? 0) > 0, prerequisitePageId: 'housing.other' }),
  page('debt.0.balance', 'housing', ['debtBalance'], ['debts.0.balance'], { applicableWhen: (i) => (i.debts?.length ?? 0) > 0, prerequisitePageId: 'housing.other' }),
  page('debt.0.payment', 'housing', ['debtPayment', 'debtTerm'], ['debts.0.annualPayment', 'debts.0.yearsRemaining'], { applicableWhen: (i) => (i.debts?.length ?? 0) > 0, prerequisitePageId: 'housing.other' }),
  page('housing.ownership', 'housing', ['propertyOwnership'], [], { applicableWhen: (i) => !!i.partner && (!!i.principalResidence || (i.investmentProperties?.length ?? 0) > 0), estimatePolicy: 'none' }),

  page('spending.method', 'spending', ['spendingMethod'], []),
  page('spending.homeFood', 'spending', ['wsHousing', 'wsGroceries'], ['worksheet.wsHousing', 'worksheet.wsGroceries'], { applicableWhen: (_i, a) => answerIs(a, 'spending.method', 'estimate'), prerequisitePageId: 'spending.method' }),
  page('spending.travelHealth', 'spending', ['wsTravel', 'wsHealth'], ['worksheet.wsTravel', 'worksheet.wsHealth'], { applicableWhen: (_i, a) => answerIs(a, 'spending.method', 'estimate'), prerequisitePageId: 'spending.method' }),
  page('spending.utilitiesTransport', 'spending', ['wsUtilities', 'wsTransport'], ['worksheet.wsUtilities', 'worksheet.wsTransport'], { applicableWhen: (_i, a) => answerIs(a, 'spending.method', 'estimate'), prerequisitePageId: 'spending.method' }),
  page('spending.funOther', 'spending', ['wsEntertainment', 'wsOther'], ['worksheet.wsEntertainment', 'worksheet.wsOther'], { applicableWhen: (_i, a) => answerIs(a, 'spending.method', 'estimate'), prerequisitePageId: 'spending.method' }),
  // FE-39: the total comes after the categories, so the category path ends on
  // the sum it applies instead of asking for a total first.
  page('spending.total', 'spending', ['retirementSpending'], ['retirementSpending']),

  page('cpp.self', 'income', ['cppAmount', 'cppClaim'], ['cppAnnualAt65', 'cppStartAge']),
  page('oas.self', 'income', ['oasAmount', 'oasClaim'], ['oasAnnualAt65', 'oasStartAge']),
  page('cpp.partner', 'income', ['cppAmount', 'cppClaim'], ['partner.cppAnnualAt65', 'partner.cppStartAge'], { applicableWhen: (i) => !!i.partner }),
  page('oas.partner', 'income', ['oasAmount', 'oasClaim'], ['partner.oasAnnualAt65', 'partner.oasStartAge'], { applicableWhen: (i) => !!i.partner }),
  page('pension.self', 'income', ['pensionKind'], ['pension']),
  page('pension.self.details', 'income', ['pensionAmount', 'pensionStart'], ['pension.annualAmount', 'pension.startAge'], { applicableWhen: (i) => !!i.pension, prerequisitePageId: 'pension.self' }),
  page('pension.self.indexing', 'income', ['pensionIndexing', 'pensionBridge'], ['pension.indexation', 'pension.bridgeAnnual'], { applicableWhen: (i) => !!i.pension, prerequisitePageId: 'pension.self' }),
  page('pension.partner', 'income', ['pensionKind'], ['partner.pension'], { applicableWhen: (i) => !!i.partner }),
  page('pension.partner.details', 'income', ['pensionAmount', 'pensionStart'], ['partner.pension.annualAmount', 'partner.pension.startAge'], { applicableWhen: (i) => !!i.partner?.pension, prerequisitePageId: 'pension.partner' }),
  page('pension.partner.indexing', 'income', ['pensionIndexing', 'pensionBridge'], ['partner.pension.indexation', 'partner.pension.bridgeAnnual'], { applicableWhen: (i) => !!i.partner?.pension, prerequisitePageId: 'pension.partner' }),

  page('intent.legacy', 'preferences', ['legacyPreference'], [], { estimatePolicy: 'none' }),
  page('intent.spending', 'preferences', ['spendingPreference'], ['goal'], { estimatePolicy: 'none' }),
  page('invest.mix', 'preferences', ['investmentMix'], ['returns', 'volatilities'], { estimatePolicy: 'assumption' }),
  page('invest.fees', 'preferences', ['investmentFees', 'inflation'], ['fees', 'inflation'], { estimatePolicy: 'assumption' }),
  page('invest.tax', 'preferences', ['distributions', 'workingTaxRate'], ['nonRegDistributionYield', 'accumulationMarginalRate'], { estimatePolicy: 'assumption' }),
  page('invest.strategy', 'preferences', ['withdrawalStrategy'], ['strategy'], { estimatePolicy: 'assumption' }),

  // FE-43 C: CRA room figures and the remaining tax elections, in one optional
  // last category. Skipping it hides the rest of it and never blocks results.
  page('tax.intro', 'taxDetails', ['taxDetailsChoice'], [], { estimatePolicy: 'none', optional: true }),
  page('tax.tfsaRoom', 'taxDetails', ['tfsaRoom'], [], { applicableWhen: (_i, a) => !taxDetailsSkipped(a), prerequisitePageId: 'tax.intro', estimatePolicy: 'none', optional: true }),
  page('tax.rrspRoom', 'taxDetails', ['rrspRoom'], [], { applicableWhen: (_i, a) => !taxDetailsSkipped(a), prerequisitePageId: 'tax.intro', estimatePolicy: 'none', optional: true }),
  page('tax.fhsaRoom', 'taxDetails', ['fhsaRoom'], [], { applicableWhen: (i, a, plan) => !taxDetailsSkipped(a) && (!!i.fhsa || !!plan?.accounts.some((account) => account.kind === 'fhsa')), prerequisitePageId: 'tax.intro', estimatePolicy: 'none', optional: true }),
  page('tax.pensionSplit', 'taxDetails', ['pensionSplit'], [], { applicableWhen: (i, a) => !taxDetailsSkipped(a) && !!i.partner, prerequisitePageId: 'tax.intro', estimatePolicy: 'none', optional: true }),
  page('tax.spousalHistory', 'taxDetails', ['spousalHistory'], [], { applicableWhen: (_i, a, plan) => !taxDetailsSkipped(a) && !!plan && spousalPlanAccounts(plan).length > 0, prerequisitePageId: 'tax.intro', estimatePolicy: 'none', optional: true }),
]

export function visibleQuestionPages(inputs: Inputs, answers: QuestionAnswers, plan?: InputsV2 | null): QuestionDefinition[] {
  return QUESTION_CATALOG.filter((definition) => definition.applicableWhen?.(inputs, answers, plan) ?? true)
}

export function questionForField(field: string): QuestionDefinition | undefined {
  return QUESTION_CATALOG.find((definition) => definition.fieldBindings.some(
    (binding) => field === binding || field.startsWith(`${binding}.`) || binding.startsWith(`${field}.`),
  ))
}

export function pageById(id: string): QuestionDefinition | undefined {
  const aliases: Record<string, string> = {
    'assets.cost': 'account.nonReg.balance',
    'allocation.rrsp': 'allocation.tfsa',
    'allocation.nonReg': 'allocation.tfsa',
    'intent.confirm': 'intent.spending',
    'assumptions.review': 'invest.strategy',
    // FE-43 C: the old all-in-one tax page now opens the optional category.
    'income.taxFacts': 'tax.intro',
  }
  const resolvedId = aliases[id] ?? id
  return QUESTION_CATALOG.find((definition) => definition.id === resolvedId)
}
