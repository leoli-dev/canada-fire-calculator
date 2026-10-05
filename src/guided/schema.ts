import type { Inputs } from '../engine'
import type { InputsV2 } from '../engine/model'

export type CategoryId = 'family' | 'saving' | 'assets' | 'housing' | 'spending' | 'income' | 'preferences'
export type QuestionAnswer = string | boolean | string[]
export type QuestionAnswers = Record<string, QuestionAnswer>

export interface QuestionDefinition {
  id: string
  categoryId: CategoryId
  contentKey: string
  guidanceKey: string
  questions: readonly string[]
  fieldBindings: readonly string[]
  estimatePolicy: 'none' | 'fact-only' | 'assumption'
  /** `plan` is the recorded canonical plan, when there is one: some facts
   * (an account's registered type) exist only there. */
  applicableWhen?: (inputs: Inputs, answers: QuestionAnswers, plan?: InputsV2 | null) => boolean
  prerequisitePageId?: string
  /** An optional page never blocks generating results; left unanswered it
   * reads as optional rather than to do, and its facts stay unknown. */
  optional?: boolean
}

export interface CategoryDefinition {
  id: CategoryId
  contentKey: string
}
