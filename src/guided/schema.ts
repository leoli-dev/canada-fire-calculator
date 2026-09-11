import type { Inputs } from '../engine'

export type CategoryId = 'family' | 'saving' | 'assets' | 'housing' | 'spending' | 'income' | 'preferences'
export type QuestionAnswer = string | boolean | string[]
export type QuestionAnswers = Record<string, QuestionAnswer>

export interface QuestionDefinition {
  id: string
  categoryId: CategoryId
  contentKey: string
  questions: readonly string[]
  fieldBindings: readonly string[]
  estimatePolicy: 'none' | 'fact-only' | 'assumption'
  applicableWhen?: (inputs: Inputs, answers: QuestionAnswers) => boolean
  prerequisitePageId?: string
}

export interface CategoryDefinition {
  id: CategoryId
  contentKey: string
}
