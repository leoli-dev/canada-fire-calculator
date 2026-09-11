import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { validateInputs } from '../engine'
import { accountSummary, answerIsUsable } from '../guidedReview'
import { pageById, QUESTION_CATEGORIES, questionForField, visibleQuestionPages } from '../guided/questionCatalog'
import type { QuestionDefinition } from '../guided/schema'
import { useStore } from '../store'
import { useCad } from '../format'
import { QuestionPage } from './guided/QuestionPage'

function requiredFields(definition: QuestionDefinition, partner: boolean): string[] {
  return definition.fieldBindings.filter((field) => partner || !field.startsWith('partner.'))
}

function pageIsComplete(definition: QuestionDefinition, state: ReturnType<typeof useStore.getState>): boolean {
  if (definition.id === 'intent.confirm') return state.planningIntent.understandingAcknowledged
  if (definition.id === 'housing.other') {
    return state.questionAnswers['housing.other.rentals'] !== undefined && state.questionAnswers['housing.other.debts'] !== undefined
  }
  const choicePages = ['family.people', 'family.children', 'saving.method', 'work.after', 'assets.identify', 'home.situation', 'home.mortgage', 'rental.0.mortgage', 'debt.0.type', 'spending.method', 'pension.self', 'pension.partner', 'intent.legacy', 'intent.spending', 'invest.mix', 'invest.strategy']
  if (choicePages.includes(definition.id)) return state.questionAnswers[definition.id] !== undefined
  const fields = requiredFields(definition, !!state.inputs.partner)
  if (!fields.length) return true
  return fields.every((field) => answerIsUsable(state.answerMeta[field]) || Object.entries(state.answerMeta).some(([candidate, meta]) => candidate.startsWith(`${field}.`) && answerIsUsable(meta)))
}

function CategoryNavigation({ pages, onNavigate }: { pages: QuestionDefinition[]; onNavigate: (id: string) => void }) {
  const { t } = useTranslation()
  const state = useStore()
  return <nav className="category-navigation" aria-label={t('questionnaire.directory')}>
    {QUESTION_CATEGORIES.map((category) => {
      const categoryPages = pages.filter((page) => page.categoryId === category.id)
      const answered = categoryPages.filter((page) => pageIsComplete(page, state)).length
      return <details key={category.id} open={categoryPages.some((page) => page.id === state.activePageId)}>
        <summary><span>{t(`questionnaire.categories.${category.contentKey}`)}</span><small>{answered}/{categoryPages.length}</small></summary>
        <div>{categoryPages.map((page) => <button type="button" key={page.id} aria-current={page.id === state.activePageId ? 'page' : undefined} onClick={() => onNavigate(page.id)}><span>{t(`questionnaire.pages.${page.contentKey}.question`)}</span><small>{pageIsComplete(page, state) ? t('questionnaire.status.answered') : t('questionnaire.status.pending')}</small></button>)}</div>
      </details>
    })}
    <button type="button" className="review-link" onClick={() => { state.setGuidedView('review'); window.location.hash = '#/guided/review' }}>{t('questionnaire.reviewAnswers')}</button>
  </nav>
}

function AnswerReview({ pages }: { pages: QuestionDefinition[] }) {
  const { t } = useTranslation()
  const cad = useCad()
  const state = useStore()
  const issues = validateInputs(state.inputs).filter((issue) => issue.severity === 'error')
  const incomplete = pages.filter((page) => !pageIsComplete(page, state))
  const accounts = accountSummary(state.inputs)
  const canGenerate = issues.length === 0 && incomplete.length === 0 && state.planningIntent.understandingAcknowledged
  return <section className="answer-review">
    <button type="button" className="text-action" onClick={() => state.setGuidedView('questionnaire')}>{t('questionnaire.backToQuestions')}</button>
    <h2 tabIndex={-1}>{t('questionnaire.reviewTitle')}</h2><p>{t('questionnaire.reviewIntro')}</p>
    <div className="review-category-list">{QUESTION_CATEGORIES.map((category) => {
      const first = pages.find((page) => page.categoryId === category.id); if (!first) return null
      const value = category.id === 'family' ? `${state.inputs.province} · ${state.inputs.partner ? t('couple') : t('single')}` : category.id === 'saving' ? cad(state.inputs.annualSavings) : category.id === 'assets' ? cad(accounts.totalAccounts) : category.id === 'housing' ? (state.inputs.principalResidence ? t('questionnaire.hasHome') : t('guidedRent')) : category.id === 'spending' ? cad(state.inputs.retirementSpending) : category.id === 'income' ? `${t('cppStartAge')} ${state.inputs.cppStartAge}` : t(`questionnaire.intentSummary.${state.planningIntent.spendingPreference === 'exploreCeiling' ? 'spending' : state.planningIntent.legacyPreference === 'maxRemaining' ? 'legacy' : 'sustainability'}`, { spending: cad(state.inputs.retirementSpending) })
      return <article key={category.id}><div><h3>{t(`questionnaire.categories.${category.contentKey}`)}</h3><button type="button" onClick={() => state.setActivePage(first.id)}>{t('guidedEdit')}</button></div><p>{value}</p></article>
    })}</div>
    {(incomplete.length > 0 || issues.length > 0) && <div className="review-blockers" role="status"><h3>{t('questionnaire.needsAttention')}</h3><ul>
      {incomplete.map((page) => <li key={page.id}><button type="button" onClick={() => state.setActivePage(page.id)}>{t(`questionnaire.pages.${page.contentKey}.question`)}</button></li>)}
      {issues.map((issue) => { const page = questionForField(issue.field); return <li key={`${issue.field}-${issue.key}`}><button type="button" onClick={() => state.setActivePage(page?.id ?? 'family.people')}>{t(issue.key, issue.params)}</button></li> })}
    </ul></div>}
    <button type="button" className="generate-results" disabled={!canGenerate} onClick={() => { state.generateGuidedResults(); window.location.hash = '#/guided/results' }}>{t('questionnaire.generateResults')}</button>
  </section>
}

export function GuidedFlow() {
  const { t } = useTranslation()
  const state = useStore()
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const pages = useMemo(() => visibleQuestionPages(state.inputs, state.questionAnswers), [state.inputs, state.questionAnswers])
  const current = pages.find((page) => page.id === state.activePageId) ?? pages[0]
  const index = Math.max(0, pages.findIndex((page) => page.id === current.id))
  const navigate = (id: string) => { state.setActivePage(id); window.location.hash = `#/guided/${pageById(id)?.categoryId}/${id}`; setDirectoryOpen(false) }

  useEffect(() => {
    const applyHash = () => {
      const latest = useStore.getState()
      const latestPages = visibleQuestionPages(latest.inputs, latest.questionAnswers)
      const hash = window.location.hash
      if (hash === '#/guided/review') return latest.setGuidedView('review')
      if (hash === '#/guided/results') return latest.resultRevision === latest.inputRevision ? latest.setGuidedView('results') : latest.setGuidedView('review')
      const id = hash.split('/').at(-1)
      if (id && latestPages.some((page) => page.id === id)) latest.setActivePage(id)
    }
    applyHash(); window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [])

  useEffect(() => {
    if (!pages.some((page) => page.id === state.activePageId)) {
      const fallback = pages.find((page) => page.categoryId === pageById(state.activePageId)?.categoryId) ?? pages[0]
      if (fallback) navigate(fallback.id)
    }
  }, [pages, state.activePageId])

  useEffect(() => {
    if (state.guidedView === 'results' && state.resultRevision !== state.inputRevision) {
      state.setGuidedView('review')
      window.location.hash = '#/guided/review'
    }
  }, [state.guidedView, state.inputRevision, state.resultRevision])

  useEffect(() => { document.querySelector<HTMLElement>('#question-title, .answer-review h2, .results-intro h2')?.focus() }, [state.activePageId, state.guidedView])

  if (state.guidedView === 'results' && state.resultRevision === state.inputRevision) return <section className="results-intro"><button type="button" className="text-action" onClick={() => { state.setGuidedView('questionnaire'); window.location.hash = `#/guided/${current.categoryId}/${current.id}` }}>{t('questionnaire.modifyAnswers')}</button><h2 tabIndex={-1}>{t('questionnaire.resultsTitle')}</h2><p>{t('questionnaire.resultsIntro')}</p></section>
  if (state.guidedView === 'review') return <AnswerReview pages={pages} />

  return <div className="questionnaire-layout">
    <button type="button" className="mobile-directory-trigger" aria-expanded={directoryOpen} onClick={() => setDirectoryOpen(!directoryOpen)}>{t('questionnaire.directory')} · {t('questionnaire.categoryCount', { current: QUESTION_CATEGORIES.findIndex((category) => category.id === current.categoryId) + 1, total: QUESTION_CATEGORIES.length })}</button>
    <div className={`directory-shell ${directoryOpen ? 'open' : ''}`}><CategoryNavigation pages={pages} onNavigate={navigate} /><button type="button" className="directory-close" onClick={() => setDirectoryOpen(false)}>{t('questionnaire.closeDirectory')}</button></div>
    <div className="questionnaire-main"><QuestionPage definition={current} /><div className="question-pager"><button type="button" disabled={index === 0} onClick={() => navigate(pages[index - 1].id)}>{t('guidedBack')}</button><span>{index + 1} / {pages.length}</span><button type="button" disabled={index === pages.length - 1} onClick={() => navigate(pages[index + 1].id)}>{pages[index + 1]?.categoryId !== current.categoryId ? t('questionnaire.nextCategory') : t('guidedNext')}</button></div></div>
  </div>
}
