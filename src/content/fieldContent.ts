import type { Inputs } from '../engine'
import { fieldRegistry, type SharedFieldId } from '../forms/fieldRegistry'
import { pageById } from '../guided/questionCatalog'
import { guidanceForPage, type PageGuidance } from '../guided/pageGuidance'
import type { QuestionAnswers } from '../guided/schema'

export const FIELD_CONTENT_VERSION = 1

type Applicability = 'always' | 'selectedAccount' | 'plannedHome'
type CapabilityMeaning = 'projectionInput' | 'plannedMortgage'
export interface FieldContent {
  fieldId: SharedFieldId
  guidedPageId: string
  unitKey: 'fieldContent.unitYears' | 'fieldContent.unitAnnualCad' | 'fieldContent.unitCad'
  unknownKey: 'fieldContent.unknownBlocksResults'
  applicabilityKey: 'fieldContent.appliesAlways' | 'fieldContent.appliesSelectedAccount' | 'fieldContent.appliesPlannedHome'
  capabilityKey: 'fieldContent.capabilityProjectionInput' | 'fieldContent.capabilityPlannedMortgage'
  applicability: Applicability
  capabilityMeaning: CapabilityMeaning
}

const bind = (fieldId: SharedFieldId, guidedPageId: string, applicability: Applicability = 'always', capabilityMeaning: CapabilityMeaning = 'projectionInput'): FieldContent => ({
  fieldId, guidedPageId,
  unitKey: `fieldContent.unit${fieldRegistry[fieldId].unit === 'years' ? 'Years' : fieldRegistry[fieldId].unit === 'cad' ? 'Cad' : 'AnnualCad'}`,
  unknownKey: 'fieldContent.unknownBlocksResults',
  applicabilityKey: `fieldContent.applies${applicability === 'always' ? 'Always' : applicability === 'selectedAccount' ? 'SelectedAccount' : 'PlannedHome'}`,
  capabilityKey: `fieldContent.capability${capabilityMeaning === 'projectionInput' ? 'ProjectionInput' : 'PlannedMortgage'}`,
  applicability, capabilityMeaning,
})

/** Implement 02 A: actual FE-14 shared fields only. B adds the remaining form and entity fields. */
export const FIELD_CONTENT: readonly FieldContent[] = [
  bind('currentAge', 'family.ages'),
  bind('fireAge', 'time.work'),
  bind('lifeExpectancy', 'time.horizon'),
  bind('annualSavings', 'saving.amount'),
  bind('retirementSpending', 'spending.total'),
  bind('balances.tfsa', 'account.tfsa.balance', 'selectedAccount'),
  bind('balances.rrsp', 'account.rrsp.balance', 'selectedAccount'),
  bind('balances.nonReg', 'account.nonReg.balance', 'selectedAccount'),
  bind('principalResidence.annualMortgagePayment', 'purchase.loan', 'plannedHome', 'plannedMortgage'),
]

export function contentForField(id: string): FieldContent | undefined {
  return FIELD_CONTENT.find(content => content.fieldId === id)
}

export function contentForPage(pageId: string): FieldContent | undefined {
  return FIELD_CONTENT.find(content => content.guidedPageId === pageId)
}

export function contentGuidance(content: FieldContent, language: string): PageGuidance {
  return guidanceForPage(content.guidedPageId, language)
}

export function guidedContentApplies(content: FieldContent, inputs: Inputs, answers: QuestionAnswers): boolean {
  const page = pageById(content.guidedPageId)
  return page ? page.applicableWhen?.(inputs, answers) ?? true : false
}

export function professionalContentApplies(content: FieldContent, inputs: Inputs): boolean {
  return content.applicability !== 'plannedHome' || inputs.principalResidence?.mode === 'planned'
}
