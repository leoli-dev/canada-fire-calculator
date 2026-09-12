import type { Inputs } from '../engine'
import type { CategoryDefinition, QuestionAnswers, QuestionDefinition } from './schema'

export const QUESTION_CATEGORIES: readonly CategoryDefinition[] = [
  { id: 'family', contentKey: 'family' },
  { id: 'saving', contentKey: 'saving' },
  { id: 'assets', contentKey: 'assets' },
  { id: 'housing', contentKey: 'housing' },
  { id: 'spending', contentKey: 'spending' },
  { id: 'income', contentKey: 'income' },
  { id: 'preferences', contentKey: 'preferences' },
]

const page = (
  id: string,
  categoryId: QuestionDefinition['categoryId'],
  questions: readonly string[],
  fieldBindings: readonly string[],
  options: Partial<Pick<QuestionDefinition, 'estimatePolicy' | 'applicableWhen' | 'prerequisitePageId'>> = {},
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
  page('family.children', 'family', ['children'], ['children']),
  page('family.province', 'family', ['province'], ['province']),
  page('time.work', 'family', ['workStyle', 'targetAssets'], ['fireAge', 'fireTargetAssets']),
  page('time.horizon', 'family', ['lifeExpectancy'], ['lifeExpectancy']),

  page('saving.method', 'saving', ['savingUnit'], []),
  page('saving.amount', 'saving', ['annualSavings'], ['annualSavings']),
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
  page('account.nonReg.balance', 'assets', ['balance', 'nonRegBook'], ['balances.nonReg', 'nonRegBook'], { applicableWhen: (_i, a) => accountSelected(a, 'nonReg'), prerequisitePageId: 'assets.identify' }),
  page('allocation.tfsa', 'assets', ['allocation'], ['savingsSplit.tfsa', 'savingsSplit.rrsp', 'savingsSplit.nonReg'], { estimatePolicy: 'assumption' }),
  page('fhsa.details', 'assets', ['fhsaBalance', 'fhsaContribution'], ['fhsa.balance', 'fhsa.annualContribution'], { applicableWhen: (i) => !!i.fhsa, prerequisitePageId: 'assets.identify' }),
  page('fhsa.open', 'assets', ['fhsaOpened'], ['fhsa.openedYearsAgo'], { applicableWhen: (i) => !!i.fhsa, prerequisitePageId: 'assets.identify' }),
  page('locked.balance', 'assets', ['lockedBalance'], ['lockedRetirement.balance'], { applicableWhen: (i) => !!i.lockedRetirement, prerequisitePageId: 'assets.identify' }),
  page('locked.access', 'assets', ['lockedAccess', 'lockedOwner'], ['lockedRetirement.accessibleAge', 'lockedRetirement.owner'], { applicableWhen: (i) => !!i.lockedRetirement, prerequisitePageId: 'assets.identify' }),
  page('locked.contributions', 'assets', ['lockedEmployee', 'lockedEmployer'], ['lockedRetirement.employeeContribution', 'lockedRetirement.employerContribution'], { applicableWhen: (i) => !!i.lockedRetirement, prerequisitePageId: 'assets.identify' }),

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
  page('rental.0.income', 'housing', ['rentalIncome', 'rentalSale'], ['investmentProperties.0.annualRent', 'investmentProperties.0.sellAtAge'], { applicableWhen: (i) => (i.investmentProperties?.length ?? 0) > 0, prerequisitePageId: 'housing.other' }),
  page('rental.0.mortgage', 'housing', ['rentalMortgage'], ['investmentProperties.0.mortgage'], { applicableWhen: (i) => (i.investmentProperties?.length ?? 0) > 0, prerequisitePageId: 'housing.other' }),
  page('rental.0.loan', 'housing', ['rentalLoanBalance', 'rentalLoanPayment'], ['investmentProperties.0.mortgage.balance', 'investmentProperties.0.mortgage.annualPayment'], { applicableWhen: (i) => !!i.investmentProperties?.[0]?.mortgage, prerequisitePageId: 'rental.0.mortgage' }),
  page('rental.0.term', 'housing', ['rentalLoanTerm'], ['investmentProperties.0.mortgage.yearsRemaining'], { applicableWhen: (i) => !!i.investmentProperties?.[0]?.mortgage, prerequisitePageId: 'rental.0.mortgage' }),
  page('debt.0.type', 'housing', ['debtType'], ['debts.0.kind'], { applicableWhen: (i) => (i.debts?.length ?? 0) > 0, prerequisitePageId: 'housing.other' }),
  page('debt.0.balance', 'housing', ['debtBalance'], ['debts.0.balance'], { applicableWhen: (i) => (i.debts?.length ?? 0) > 0, prerequisitePageId: 'housing.other' }),
  page('debt.0.payment', 'housing', ['debtPayment', 'debtTerm'], ['debts.0.annualPayment', 'debts.0.yearsRemaining'], { applicableWhen: (i) => (i.debts?.length ?? 0) > 0, prerequisitePageId: 'housing.other' }),

  page('spending.method', 'spending', ['spendingMethod'], []),
  page('spending.total', 'spending', ['retirementSpending'], ['retirementSpending']),
  page('spending.homeFood', 'spending', ['wsHousing', 'wsGroceries'], ['worksheet.wsHousing', 'worksheet.wsGroceries'], { applicableWhen: (_i, a) => answerIs(a, 'spending.method', 'estimate'), prerequisitePageId: 'spending.method' }),
  page('spending.travelHealth', 'spending', ['wsTravel', 'wsHealth'], ['worksheet.wsTravel', 'worksheet.wsHealth'], { applicableWhen: (_i, a) => answerIs(a, 'spending.method', 'estimate'), prerequisitePageId: 'spending.method' }),
  page('spending.utilitiesTransport', 'spending', ['wsUtilities', 'wsTransport'], ['worksheet.wsUtilities', 'worksheet.wsTransport'], { applicableWhen: (_i, a) => answerIs(a, 'spending.method', 'estimate'), prerequisitePageId: 'spending.method' }),
  page('spending.funOther', 'spending', ['wsEntertainment', 'wsOther'], ['worksheet.wsEntertainment', 'worksheet.wsOther'], { applicableWhen: (_i, a) => answerIs(a, 'spending.method', 'estimate'), prerequisitePageId: 'spending.method' }),

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
]

export function visibleQuestionPages(inputs: Inputs, answers: QuestionAnswers): QuestionDefinition[] {
  return QUESTION_CATALOG.filter((definition) => definition.applicableWhen?.(inputs, answers) ?? true)
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
  }
  const resolvedId = aliases[id] ?? id
  return QUESTION_CATALOG.find((definition) => definition.id === resolvedId)
}
