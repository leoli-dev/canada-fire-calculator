import { Button, Callout, Sheet } from '../ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { validateInputs } from '../engine'
import { accountSummary } from '../guidedReview'
import { pageIsComplete } from '../guided/pageState'
import { pageById, QUESTION_CATEGORIES, questionForField, questionShortKey, questionTitleKey, visibleQuestionPages } from '../guided/questionCatalog'
import type { QuestionDefinition } from '../guided/schema'
import { useStore } from '../store'
import { useCad } from '../format'
import { QuestionPage, QuestionHelpRail } from './guided/QuestionPage'
import { RuleAssumptions } from './RuleAssumptions'
import { ResetPlan } from './ResetPlan'

function CategoryNavigation({ pages, onNavigate, onReview }: { pages: QuestionDefinition[]; onNavigate: (id: string) => void; onReview?: () => void }) {
  const { t } = useTranslation()
  const state = useStore()
  const completed = pages.filter(page => pageIsComplete(page, state)).length
  const percent = Math.round(completed / pages.length * 100)
  return <nav className="category-navigation" aria-label={t('questionnaire.directory')}>
    <div className="directory-progress"><div><span>{t('ui.questionCount', { current: Math.max(0, pages.findIndex(page => page.id === state.activePageId)) + 1, total: pages.length })}</span><span>{percent}%</span></div><progress aria-label={t('ui.overallProgress')} value={completed} max={pages.length} /></div>
    {QUESTION_CATEGORIES.map((category) => {
      const categoryPages = pages.filter((page) => page.categoryId === category.id)
      // An unanswered optional page is not outstanding work.
      const answered = categoryPages.filter((page) => page.optional || pageIsComplete(page, state)).length
      const active = categoryPages.some(page => page.id === state.activePageId)
      const status = active ? 'now' : answered === categoryPages.length ? 'done' : 'todo'
      return <details key={category.id} open={categoryPages.some((page) => page.id === state.activePageId)}>
        <summary><i className={`category-status ${status}`} aria-hidden="true">{status === 'done' ? '✓' : ''}</i><span>{t(`questionnaire.categories.${category.contentKey}`)}</span><small>{answered}/{categoryPages.length}</small></summary>
        <div>{categoryPages.map((page) => <Button variant="ghost" type="button" key={page.id} aria-current={page.id === state.activePageId ? 'page' : undefined} onClick={() => onNavigate(page.id)}><i className={`page-status ${pageIsComplete(page, state) ? 'done' : 'todo'}`} aria-hidden="true" /><span>{t(questionShortKey(page, state.inputs))}</span><small className="sr-only">{pageIsComplete(page, state) ? t('questionnaire.status.answered') : page.optional ? t('questionnaire.status.optional') : t('questionnaire.status.pending')}</small></Button>)}</div>
      </details>
    })}
    <Button type="button" className="review-link" onClick={onReview ?? (() => { state.setGuidedView('review'); window.location.hash = '#/guided/review' })}>{t('questionnaire.reviewAnswers')}</Button>
  </nav>
}

function AnswerReview({ pages }: { pages: QuestionDefinition[] }) {
  const { i18n, t } = useTranslation()
  const cad = useCad()
  const state = useStore()
  const issues = validateInputs(state.inputs, { canonical: !!state.canonical?.deterministicProjection }).filter((issue) => issue.severity === 'error')
  const incomplete = pages.filter((page) => !page.optional && !pageIsComplete(page, state))
  const accounts = accountSummary(state.inputs)
  const canGenerate = issues.length === 0 && incomplete.length === 0
  const formatNumber = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language, { maximumFractionDigits: 2 })
  const percent = (value: number) => `${formatNumber.format(value * 100)}%`
  const chosenMix = state.questionAnswers['invest.mix']
  const chosenStrategy = state.questionAnswers['invest.strategy']
  const assumptionRows = [
    {
      id: 'invest.mix',
      title: t('questionnaire.reviewMixTitle'),
      value: typeof chosenMix === 'string'
        ? t('questionnaire.reviewMixValue', { mix: t(`questionnaire.mixNames.${chosenMix}`), real: percent(state.inputs.returns.tfsa), volatility: percent(state.inputs.volatilities?.tfsa ?? 0) })
        : t('questionnaire.reviewNotChosen'),
    },
    { id: 'invest.fees', title: t('questionnaire.reviewFeesTitle'), value: t('questionnaire.reviewFeesValue', { fees: percent(state.inputs.fees ?? 0), inflation: percent(state.inputs.inflation ?? 0.021) }) },
    { id: 'invest.tax', title: t('questionnaire.reviewTaxTitle'), value: t('questionnaire.reviewTaxValue', { distributions: percent(state.inputs.nonRegDistributionYield ?? 0.02), rate: percent(state.inputs.accumulationMarginalRate ?? 0.35) }) },
    {
      id: 'invest.strategy',
      title: t('questionnaire.reviewStrategyTitle'),
      value: typeof chosenStrategy === 'string'
        ? (state.inputs.strategy === 'meltdownPaced'
          ? t('questionnaire.reviewStrategyWithCap', { strategy: t('questionnaire.reviewPacedStrategy'), cap: t(`meltdownCap_${state.inputs.meltdownBracketCap ?? 'bracket1'}`) })
          : t(`strat_${state.inputs.strategy}`))
        : t('questionnaire.reviewNotChosen'),
    },
  ]
  const editPage = (id: string) => {
    const definition = pageById(id)
    if (!definition) return
    state.setActivePage(definition.id)
    window.location.hash = `#/guided/${definition.categoryId}/${definition.id}`
  }
  return <section className="answer-review">
    <Button variant="link" type="button" className="text-action" onClick={() => editPage(state.activePageId)}>{t('questionnaire.backToQuestions')}</Button>
    <h2 tabIndex={-1}>{t('questionnaire.reviewTitle')}</h2><p>{t('questionnaire.reviewIntro')}</p>
    <section className="review-assumptions" aria-labelledby="review-assumptions-title">
      <h3 id="review-assumptions-title">{t('questionnaire.reviewAssumptionsTitle')}</h3>
      <p>{t('questionnaire.reviewAssumptionsIntro')}</p>
      <div>{assumptionRows.map((row) => {
        const definition = pages.find((page) => page.id === row.id)
        const complete = definition ? pageIsComplete(definition, state) : false
        const containsEstimate = definition?.fieldBindings.some((field) => state.answerMeta[field]?.status === 'estimated') ?? false
        const statusKey = !complete ? 'reviewAssumptionPending' : containsEstimate ? 'reviewAssumptionEstimated' : 'reviewAssumptionSet'
        return <div className="review-assumption-row" key={row.id}>
          <div><strong>{row.title}</strong><p>{row.value}</p><small>{t(`questionnaire.${statusKey}`)}</small></div>
          <Button type="button" onClick={() => editPage(row.id)} aria-label={t('questionnaire.reviewEditAssumption', { topic: row.title })}>{t('guidedEdit')}</Button>
        </div>
      })}</div>
      <p className="review-assumptions-note">{t('questionnaire.reviewAssumptionsNote')}</p>
      <RuleAssumptions province={state.inputs.province} inflation={state.inputs.inflation ?? 0.021} />
    </section>
    <div className="review-category-list">{QUESTION_CATEGORIES.map((category) => {
      const first = pages.find((page) => page.categoryId === category.id); if (!first) return null
      const categoryPages = pages.filter((page) => page.categoryId === category.id)
      const value = category.id === 'taxDetails'
        ? (state.questionAnswers['tax.intro'] === 'skip' ? t('questionnaire.taxDetails.reviewSkipped')
          : t('questionnaire.taxDetails.reviewRecorded', { answered: categoryPages.filter((page) => page.id !== 'tax.intro' && pageIsComplete(page, state)).length, total: categoryPages.filter((page) => page.id !== 'tax.intro').length }))
        : category.id === 'family' ? `${state.inputs.province} · ${state.inputs.partner ? t('couple') : t('single')}` : category.id === 'saving' ? cad(state.inputs.annualSavings) : category.id === 'assets' ? cad(accounts.totalAccounts) : category.id === 'housing' ? (state.inputs.principalResidence ? t('questionnaire.hasHome') : t('guidedRent')) : category.id === 'spending' ? cad(state.inputs.retirementSpending) : category.id === 'income' ? `${t('cppStartAge')} ${state.inputs.cppStartAge}` : t(`questionnaire.intentSummary.${state.planningIntent.spendingPreference === 'exploreCeiling' ? 'spending' : state.planningIntent.legacyPreference === 'maxRemaining' ? 'legacy' : 'sustainability'}`, { spending: cad(state.inputs.retirementSpending) })
      return <article key={category.id}><div><h3>{t(`questionnaire.categories.${category.contentKey}`)}</h3><Button type="button" onClick={() => editPage(first.id)}>{t('guidedEdit')}</Button></div><p>{value}</p></article>
    })}</div>
    {(incomplete.length > 0 || issues.length > 0) && <Callout variant="warn" className="review-blockers" role="status"><h3>{t('questionnaire.needsAttention')}</h3><ul>
      {incomplete.map((page) => <li key={page.id}><Button type="button" onClick={() => editPage(page.id)}>{t(questionTitleKey(page, state.inputs))}</Button></li>)}
      {issues.map((issue) => { const page = questionForField(issue.field); return <li key={`${issue.field}-${issue.key}`}><Button type="button" onClick={() => editPage(page?.id ?? 'family.people')}>{t(issue.key, issue.params)}</Button></li> })}
    </ul></Callout>}
    <Button variant="primary" type="button" className="generate-results" disabled={!canGenerate} onClick={() => { state.generateGuidedResults(); window.location.hash = '#/guided/results' }}>{t('questionnaire.generateResults')}</Button>
    <ResetPlan onDone={() => { window.location.hash = '#/guided/family/family.people' }} />
  </section>
}

export function GuidedFlow() {
  const { t } = useTranslation()
  const state = useStore()
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 640px)').matches)
  const pendingDestination = useRef<string | null>(null)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)')
    const update = () => { setPhone(media.matches); setDirectoryOpen(false) }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  // Let Sheet restore the trigger before navigation focuses the next question.
  useEffect(() => {
    if (directoryOpen || !pendingDestination.current) return
    const id = pendingDestination.current
    pendingDestination.current = null
    if (id === 'review') {
      state.setGuidedView('review')
      window.location.hash = '#/guided/review'
    } else {
      state.setActivePage(id)
      window.location.hash = `#/guided/${pageById(id)?.categoryId}/${id}`
    }
  }, [directoryOpen])
  const directoryNavigate = (id: string) => { pendingDestination.current = id; setDirectoryOpen(false) }
  const pages = useMemo(() => visibleQuestionPages(state.inputs, state.questionAnswers, state.canonical), [state.inputs, state.questionAnswers, state.canonical])
  const current = pages.find((page) => page.id === state.activePageId) ?? pages[0]
  const index = Math.max(0, pages.findIndex((page) => page.id === current.id))
  // FE-46: progress within the current category; the overall count grows as
  // answers open branches, which read as going backwards.
  const categoryPages = pages.filter((page) => page.categoryId === current.categoryId)
  const navigate = (id: string) => { state.setActivePage(id); window.location.hash = `#/guided/${pageById(id)?.categoryId}/${id}`; setDirectoryOpen(false) }

  useEffect(() => {
    const applyHash = () => {
      const latest = useStore.getState()
      const latestPages = visibleQuestionPages(latest.inputs, latest.questionAnswers, latest.canonical)
      const hash = window.location.hash
      if (hash === '#/guided/review' || hash.endsWith('/assumptions.review')) {
        latest.setGuidedView('review')
        if (hash !== '#/guided/review') window.location.hash = '#/guided/review'
        return
      }
      if (hash === '#/guided/results') return latest.resultRevision === latest.inputRevision ? latest.setGuidedView('results') : latest.setGuidedView('review')
      const id = hash.split('/').at(-1)
      const resolved = id ? pageById(id) : undefined
      if (resolved && latestPages.some((page) => page.id === resolved.id)) latest.setActivePage(resolved.id)
    }
    applyHash(); window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [])

  useEffect(() => {
    if (!pages.some((page) => page.id === state.activePageId)) {
      const resolved = pageById(state.activePageId)
      const fallback = (resolved && pages.find((page) => page.id === resolved.id)) ?? pages.find((page) => page.categoryId === resolved?.categoryId) ?? pages[0]
      if (fallback) navigate(fallback.id)
    }
  }, [pages, state.activePageId])

  useEffect(() => {
    if (state.guidedView === 'results' && state.resultRevision !== state.inputRevision) {
      state.setGuidedView('review')
      window.location.hash = '#/guided/review'
    }
  }, [state.guidedView, state.inputRevision, state.resultRevision])

  useEffect(() => {
    const target = document.querySelector<HTMLElement>('#question-title, .answer-review h2, .results-intro h2')
    if (!target) return
    target.dataset.programmaticFocus = 'true'
    target.focus()
    const clear = () => { delete target.dataset.programmaticFocus }
    target.addEventListener('blur', clear, { once: true })
    return () => { target.removeEventListener('blur', clear); clear() }
  }, [state.activePageId, state.guidedView])

  if (state.guidedView === 'results' && state.resultRevision === state.inputRevision) return <section className="results-intro"><Button variant="link" type="button" className="text-action" onClick={() => { state.setGuidedView('questionnaire'); window.location.hash = `#/guided/${current.categoryId}/${current.id}` }}>{t('questionnaire.modifyAnswers')}</Button><h2 tabIndex={-1}>{t('questionnaire.resultsTitle')}</h2><p>{t('questionnaire.resultsIntro')}</p></section>
  if (state.guidedView === 'review') return <AnswerReview pages={pages} />

  return <div className="questionnaire-layout">
    <div className="mobile-question-progress">
      <div><span>{t('ui.mobileCategoryProgress', { category: t(`questionnaire.categories.${QUESTION_CATEGORIES.find(category => category.id === current.categoryId)?.contentKey}`), current: categoryPages.findIndex(page => page.id === current.id) + 1, total: categoryPages.length })}</span>
        <Button variant="ghost" className="mobile-directory-trigger" aria-haspopup={phone ? 'dialog' : undefined} aria-controls="question-directory" aria-expanded={directoryOpen} onClick={() => setDirectoryOpen(!directoryOpen)}>{t('ui.contents')}</Button></div>
      <progress aria-label={t('ui.overallProgress')} value={pages.filter(page => pageIsComplete(page, state)).length} max={pages.length} />
    </div>
    {phone ? <>{!directoryOpen && <div id="question-directory" className="directory-shell" hidden><CategoryNavigation pages={pages} onNavigate={navigate} /></div>}<Sheet closeButtonClassName="directory-close" id="question-directory" open={directoryOpen} onClose={() => setDirectoryOpen(false)} title={t('ui.contents')} closeLabel={t('questionnaire.closeDirectory')}>
      <CategoryNavigation pages={pages} onNavigate={directoryNavigate} onReview={() => directoryNavigate('review')} />
    </Sheet></> : <div id="question-directory" className={`directory-shell ${directoryOpen ? 'open' : ''}`}><CategoryNavigation pages={pages} onNavigate={navigate} /><Button type="button" className="directory-close" onClick={() => setDirectoryOpen(false)}>{t('questionnaire.closeDirectory')}</Button></div>}
    <div className="questionnaire-main"><QuestionPage definition={current} categoryProgress={t('ui.categoryProgress', { current: categoryPages.findIndex(page => page.id === current.id) + 1, total: categoryPages.length })} /><div className="question-pager"><Button type="button" disabled={index === 0} onClick={() => navigate(pages[index - 1].id)}>{t('guidedBack')}</Button><span data-testid="guided-progress"><span className="pager-category-progress">{t('questionnaire.pagerProgress', { category: t(`questionnaire.categories.${QUESTION_CATEGORIES.find((category) => category.id === current.categoryId)?.contentKey}`), current: categoryPages.findIndex((page) => page.id === current.id) + 1, total: categoryPages.length })}</span><span className="pager-next-label">{index < pages.length - 1 ? t('ui.nextQuestion', { label: t(questionShortKey(pages[index + 1], state.inputs)) }) : t('questionnaire.reviewAnswers')}</span></span><Button variant="primary" type="button" onClick={() => { if (index === pages.length - 1) { state.setGuidedView('review'); window.location.hash = '#/guided/review' } else navigate(pages[index + 1].id) }}>{index === pages.length - 1 ? t('questionnaire.reviewAnswers') : <><span className="pager-desktop-button-label">{t('guidedNext')}</span><span className="pager-mobile-button-label">{pages[index + 1]?.categoryId !== current.categoryId ? t('questionnaire.nextCategory') : t('guidedNext')}</span></>}</Button></div></div>
    <QuestionHelpRail guidanceKey={current.guidanceKey} />
  </div>
}
