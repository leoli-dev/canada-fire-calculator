import { Button, Segmented } from './ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { pensionStartAge, validateInputs } from './engine'
import { downloadStoredPlan, getStorageReadOnlyReason, isStorageUnavailable, useStore } from './store'
import { AnalyticsFooter, AnalyticsPrompt } from './components/AnalyticsConsent'
import { precisionGate } from './engine/model'
import { InputForm } from './components/InputForm'
import { GuidedFlow } from './components/GuidedFlow'
import { WithdrawalOrderCard } from './components/WithdrawalOrderCard'
import { ProjectionChart } from './components/ProjectionChart'
import { BenefitCategoryPanel } from './components/BenefitCategoryPanel'
import { IncomeChart } from './components/IncomeChart'
import { TaxChart } from './components/TaxChart'
import { YearTable } from './components/YearTable'
import { ResultsPanel } from './components/ResultsPanel'
import { ResultPeek } from './components/ResultPeek'
import { MonteCarloCard } from './components/MonteCarloCard'
import { CanonicalMonteCarloCard } from './components/CanonicalMonteCarloCard'
import { MC_RULE_VERSION } from './mcProtocol'
import { StrategyCard } from './components/StrategyCard'
import { TimingCard } from './components/TimingCard'
import { ScenarioCard } from './components/ScenarioCard'
import { GlossaryDrawer } from './components/GlossaryDrawer'
import { AppBar, CompactDisclaimer } from './components/AppBar'
import { hasUnusableSharedFields } from './forms/fieldState'
import { migrationReview } from './engine/migrationReview'
import { MigrationReview } from './components/MigrationReview'
import { AnnualSheetDialog } from './components/AnnualSheetDialog'
import { annualSheetText } from './annualSheet'
import { annualDetailsTitle, legacyAnnualSheet } from './legacyAnnualSheet'
import { ProfessionalInputs } from './components/ProfessionalInputs'
import { CanonicalResults } from './components/CanonicalResults'
import { CanonicalPlanningTool } from './components/CanonicalPlanningTool'
import { selectDeterministicResult } from './deterministicResult'
import { canonicalAnnualSheet } from './canonicalAnnualSheet'
import { PersonTaxTable } from './components/PersonTaxTable'

/** Precision reasons the pooled household tools do not depend on. */
const POOLED_IGNORES = new Set(['ownershipUnknown', 'recipientUnknown'])

export default function App() {
  const { t, i18n } = useTranslation()
  const inputs = useStore((s) => s.inputs)
  const canonical = useStore((s) => s.canonical)
  const scenarioACanonical = useStore((s) => s.scenarioACanonical)
  const scenarioA = useStore((s) => s.scenarioA)
  const storageIssue = getStorageReadOnlyReason()
  const unresolvedHousehold = migrationReview(canonical)?.ownershipPending ?? !!inputs.partner
  const precision = canonical ? precisionGate(canonical) : null
  const migrationBlocked = precision ? !precision.allowed : !!inputs.partner
  const displayMode = useStore((s) => s.displayMode)
  const entryMode = useStore((s) => s.entryMode)
  const guidedView = useStore((s) => s.guidedView)
  const inputRevision = useStore((s) => s.inputRevision)
  const resultRevision = useStore((s) => s.resultRevision)
  const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 640px)').matches)
  const pendingPaneFocus = useRef(false)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)')
    const update = () => setPhone(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const [phonePane, setPhonePane] = useState<'inputs' | 'results'>('inputs')
  const inputsPane = useRef<HTMLElement>(null)
  const paneScroll = useRef({ inputs: 0, results: 0 })
  const guidedScroll = useRef({ review: 0, results: 0 })
  const sharedFieldsPending = useStore(hasUnusableSharedFields)
  const guidedTabs = entryMode === 'guided' && (guidedView === 'review' || guidedView === 'results') && resultRevision === inputRevision && !sharedFieldsPending && !storageIssue
  const professional = entryMode === 'professional'
  const activePane = professional ? phonePane : guidedView === 'results' ? 'results' : 'inputs'
  const switchPane = (pane: 'inputs' | 'results') => {
    if (pane === activePane) return
    pendingPaneFocus.current = phone
    if (professional) {
      const current = activePane === 'inputs' ? inputsPane.current : document.getElementById('results')
      paneScroll.current[activePane] = current?.scrollTop ?? 0
      setPhonePane(pane)
    } else {
      guidedScroll.current[guidedView === 'results' ? 'results' : 'review'] = window.scrollY
      useStore.getState().setGuidedView(pane === 'results' ? 'results' : 'review')
      window.location.hash = pane === 'results' ? '#/guided/results' : '#/guided/review'
    }
  }
  const openCanonicalResults = () => {
    switchPane('results')
    requestAnimationFrame(() => {
      const pane = document.getElementById('results')
      if (pane) pane.scrollTop = 0
      pane?.focus({ preventScroll: true })
    })
  }
  useEffect(() => {
    if (!window.matchMedia('(max-width: 640px)').matches) return
    if (professional) {
      const pane = activePane === 'inputs' ? inputsPane.current : document.getElementById('results')
      if (pane) pane.scrollTop = paneScroll.current[activePane]
    } else if (guidedTabs && pendingPaneFocus.current) window.scrollTo(0, guidedScroll.current[guidedView === 'results' ? 'results' : 'review'])
    if (pendingPaneFocus.current) document.getElementById(activePane === 'inputs' ? 'phone-inputs-tab' : 'phone-results-tab')?.focus({ preventScroll: true })
    pendingPaneFocus.current = false
  }, [activePane, professional, guidedTabs, phone])
  // Input editing must leave the existing conclusion available, even after the results were scrolled.
  useEffect(() => {
    if (professional && window.matchMedia('(min-width: 1100px)').matches) document.getElementById('results')?.scrollTo({ top: 0 })
  }, [inputRevision, professional, displayMode])
  const showGuidedResults = entryMode === 'guided' && guidedView === 'results' && resultRevision === inputRevision && !sharedFieldsPending
  const nonRegMeta = useStore(s => s.answerMeta['balances.nonReg'])
  const nonRegAbsent = nonRegMeta?.status === 'notApplicable' && nonRegMeta.origin === 'user'
  const selected = useMemo(() => !storageIssue && !sharedFieldsPending && (entryMode === 'professional' || showGuidedResults) ? selectDeterministicResult(inputs, canonical, { nonRegAbsent }) : null, [entryMode, showGuidedResults, inputs, canonical, nonRegAbsent, storageIssue, sharedFieldsPending])
  const canonicalModel = useMemo(() => selected?.route === 'canonical' && selected.coverage ? canonicalAnnualSheet(selected.coverage, { scenarioId: 'current', revision: inputRevision }) : null, [selected, inputRevision])
  const result = selected?.route === 'legacy' ? selected.result : null
  const canonicalResult = selected?.route === 'canonical' ? selected : null
  const [annualToken, setAnnualToken] = useState<{ revision: number; result: typeof selected; entryMode: typeof entryMode } | null>(null)
  const annualOpen = annualToken?.revision === inputRevision && annualToken.result === selected && annualToken.entryMode === entryMode
  // Adapt only for an explicitly opened, current result. An old token cannot
  // render even one frame of a revised scenario before effect cleanup.
  const precisionBlocked = migrationBlocked
  // Keep the existing single-person planning preview usable while BE-14 B
  // wires working-year tax. Couples never get a disguised pooled tax. BE-43:
  // one Quebec owner gets the same tools as estimates, disclosed as resting on
  // simplified Quebec rules, instead of nothing.
  const singleLegacyPreview = !inputs.partner && (!canonical || canonical.people.length === 1)
  const taxBlocked = result?.taxCapability?.status !== 'person' && !singleLegacyPreview
  const taxWarning = result?.taxCapability?.status !== 'person'
  const oldSingleTools = singleLegacyPreview
  // Couples get the planning tools too, priced on the pooled household
  // approximation and labelled as such, instead of losing them until person
  // tax covers every year (BE-14 B). The pooled approximation never reads who
  // owns an account or receives an income, so those two open facts do not
  // withhold them; any other precision reason (e.g. a savings figure that
  // excludes debt payments) still does. Only the tax tables stay single-only.
  const coupleTools = !!inputs.partner && !singleLegacyPreview && !!precision &&
    precision.reasons.every((reason) => POOLED_IGNORES.has(reason))
  const planningTools = (!precisionBlocked && !taxBlocked && oldSingleTools) || coupleTools
  const annualModel = useMemo(() => annualOpen && result ? legacyAnnualSheet(result, inputs, {
    scenarioId: 'current', revision: inputRevision,
    disclosures: [
      ...(precision?.reasons.includes('budgetBasisExcluded') ? [t('budget.estimateExcluded')] : []),
      ...(migrationBlocked ? [t('estimateChartsNote')] : []),
      ...(coupleTools ? [t('coupleToolsEstimate')] : []),
      ...(!migrationBlocked && taxWarning && inputs.province === 'QC' ? [t('be11QcLimit')] : []),
    ],
  }) : null, [annualOpen, result, inputs, inputRevision, migrationBlocked, coupleTools, taxWarning, precision?.reasons.join(','), t])

  const hasBlockingIssues = useMemo(
    () => validateInputs(inputs, { canonical: !!canonical?.deterministicProjection }).some((issue) => issue.severity === 'error'),
    [inputs, canonical],
  )
  useEffect(() => {
    if (!professional) return
    const pane = inputsPane.current
    const reveal = (event: FocusEvent) => {
      const target = event.target
      if (!window.matchMedia('(max-width: 640px)').matches || !(target instanceof HTMLElement) || target.closest('[role="dialog"]') || !pane || target === pane) return
      const bounds = pane.getBoundingClientRect()
      const peek = pane.querySelector('.result-peek, .professional-canonical-peek')?.getBoundingClientRect()
      const top = (peek?.bottom ?? bounds.top) + 8
      const box = target.getBoundingClientRect()
      if (box.top < top) pane.scrollTop -= top - box.top
      else if (box.bottom > bounds.bottom - 8) pane.scrollTop += box.bottom - bounds.bottom + 8
    }
    const peek = pane?.querySelector('.result-peek, .professional-canonical-peek')
    const updateClearance = () => pane?.style.setProperty('--professional-peek-clearance', `${(peek?.getBoundingClientRect().height ?? 0) + 8}px`)
    const observer = new ResizeObserver(updateClearance)
    if (peek) observer.observe(peek)
    updateClearance()
    pane?.addEventListener('focusin', reveal)
    return () => { observer.disconnect(); pane?.removeEventListener('focusin', reveal) }
  }, [professional, !!result, !!canonicalResult, hasBlockingIssues])
  const pensionAge = pensionStartAge(inputs)
  const inflation = inputs.inflation ?? 0.021
  const scale = useMemo(
    () =>
      displayMode === 'nominal'
        ? (age: number) => Math.pow(1 + inflation, age - inputs.currentAge)
        : undefined,
    [displayMode, inflation, inputs.currentAge],
  )

  const planFooter = (
      <footer>
        <p className="credit">
          {t('createdBy')}{' '}
          <a href="https://xiaojieli.com" target="_blank" rel="noopener noreferrer">
            Leo Li
          </a>
        </p>
        <AnalyticsFooter />
      </footer>
  )

  return (
    <div className={`app${professional ? ' app-professional' : ''}${guidedTabs ? ' has-result-tabs' : ''}`}>
      <AppBar showResults={!!canonicalResult || (!!result && !hasBlockingIssues)} />
      {/* Match GuidedFlow's question branch, including a stale-result transition. */}
      {!(entryMode === 'guided' && !storageIssue && guidedView !== 'review' && (guidedView !== 'results' || resultRevision !== inputRevision)) && <AnalyticsPrompt />}

      {isStorageUnavailable() && <div role="status" className="hint" data-testid="storage-unavailable">{t('storageUnavailable')}</div>}
      {storageIssue && <div role="alert" className="hint">
        {t(storageIssue === 'futureVersion' ? 'storageFuture' : 'storageCorrupt')}
        <Button type="button" onClick={downloadStoredPlan}>{t('storageDownloadOriginal')}</Button>
      </div>}
      {!professional && <MigrationReview current={canonical} scenarioA={scenarioACanonical} scenarioAExists={scenarioA !== null} />}
      {sharedFieldsPending && <div role="status" className="hint">{t('questionnaire.pendingSaved')}</div>}
      {(professional || guidedTabs) && <Segmented as="nav" mode="tab" className="phone-result-tabs" aria-label={t('ui.professional.panes')}>
        <Button id="phone-inputs-tab" aria-selected={activePane === 'inputs'} aria-controls={professional ? 'inputs' : 'guided-phone-panel'} onClick={() => switchPane('inputs')}>{t(professional ? 'ui.professional.inputs' : 'ui.professional.answers')}</Button>
        <Button id="phone-results-tab" aria-selected={activePane === 'results'} aria-controls={professional ? 'results' : 'guided-phone-panel'} onClick={() => switchPane('results')}>{t('ui.professional.results')}</Button>
      </Segmented>}

      <main id={phone && guidedTabs ? 'guided-phone-panel' : undefined} role={phone && guidedTabs ? 'tabpanel' : undefined} aria-labelledby={phone && guidedTabs ? (activePane === 'inputs' ? 'phone-inputs-tab' : 'phone-results-tab') : undefined} tabIndex={phone && guidedTabs ? 0 : undefined} data-phone-pane={activePane} className={entryMode === 'guided' ? (showGuidedResults ? 'guided-results' : 'guided-only') : 'professional-layout'}>
        <aside role={phone && professional ? 'tabpanel' : undefined} aria-labelledby={phone && professional ? 'phone-inputs-tab' : undefined} tabIndex={phone && professional ? 0 : undefined} ref={inputsPane} className={professional ? 'professional-input-pane' : undefined} id="inputs">
          {entryMode === 'professional' && result && !hasBlockingIssues && <ResultPeek inputs={inputs} result={result}
            estimate={precisionBlocked || taxBlocked} personTax={result.taxCapability?.status === 'person'} taxWarning={taxWarning} onOpen={() => switchPane('results')} />}
          {professional && canonicalResult && <div className="professional-canonical-peek" role="status"><span>{t(`canonical.status.${canonicalResult.status}`)}</span><Button variant="link" onClick={openCanonicalResults}>{t('resultPeekJump')}</Button></div>}
          {professional && <MigrationReview current={canonical} scenarioA={scenarioACanonical} scenarioAExists={scenarioA !== null} />}
          {!storageIssue && (entryMode === 'guided' ? <GuidedFlow /> : <ProfessionalInputs><InputForm />{planFooter}</ProfessionalInputs>)}
          {professional && storageIssue && planFooter}
        </aside>
        {professional && !canonicalResult && !(result && !hasBlockingIssues) && <section className="professional-results-unavailable" id="results" role={phone && professional ? 'tabpanel' : undefined} aria-labelledby={phone && professional ? 'phone-results-tab' : undefined} tabIndex={phone && professional ? 0 : -1}><p role="status">{t('ui.professional.unavailable')}</p></section>}
        {canonicalResult && <section className="results-column" id="results" role={phone && professional ? 'tabpanel' : undefined} aria-labelledby={phone && professional ? 'phone-results-tab' : undefined} tabIndex={phone && professional ? 0 : -1}>
          <CanonicalResults result={canonicalResult} model={canonicalModel} />
          <div className="mobile-results-disclaimer"><CompactDisclaimer /></div>
          {canonicalResult.coverage && <><Button type="button" onClick={() => setAnnualToken({ revision: inputRevision, result: selected, entryMode })}>{annualSheetText(annualDetailsTitle, i18n.language)}</Button>
          {annualOpen && canonicalModel && <AnnualSheetDialog key={inputRevision} open={true} model={canonicalModel} moneyMode={displayMode} onClose={() => setAnnualToken(null)} />}</>}
          {canonical && <CanonicalPlanningTool key={`${entryMode}:${inputRevision}:${i18n.language}`} inputs={inputs} plan={canonical} nonRegAbsent={nonRegAbsent} revision={inputRevision} entryMode={entryMode} />}
          {canonical && <CanonicalMonteCarloCard inputs={inputs} plan={canonical} nonRegAbsent={nonRegAbsent} revision={inputRevision} entryMode={entryMode} />}
          <ScenarioCard />
        </section>}
        {result && !hasBlockingIssues && <section className="results-column" id="results" role={phone && professional ? 'tabpanel' : undefined} aria-labelledby={phone && professional ? 'phone-results-tab' : undefined} tabIndex={phone && professional ? 0 : -1}>
          <ResultsPanel inputs={inputs} result={result} legacyEstimate={precisionBlocked} legacyOwnershipPending={unresolvedHousehold}
            annualAction={<Button size="sm" type="button" onClick={() => setAnnualToken({ revision: inputRevision, result: selected, entryMode })}>{annualSheetText(annualDetailsTitle, i18n.language)}</Button>}
            budgetBasisExcluded={precision?.reasons.includes('budgetBasisExcluded') ?? false}
            taxEstimate={taxBlocked} taxWarning={taxWarning} personTax={result.taxCapability?.status === 'person'} />
          <div className="mobile-results-disclaimer"><CompactDisclaimer /></div>
          {annualModel && <AnnualSheetDialog key={inputRevision} open={true} model={annualModel} moneyMode={displayMode} onClose={() => setAnnualToken(null)} />}
          {/* FE-37: gates withhold precise tax tools, never the charts. */}
          {!precisionBlocked && taxWarning && <p role="status" className="hint" data-testid="person-tax-limit">{t(inputs.province === 'QC' ? 'be11QcLimit' : singleLegacyPreview ? 'be11SingleEstimate' : 'be11TaxLimit')}</p>}
          {precisionBlocked && <p role="status" className="hint" data-testid="estimate-charts-note">{t('estimateChartsNote')}</p>}
          {coupleTools && <p role="status" className="hint" data-testid="couple-tools-estimate">{t('coupleToolsEstimate')}</p>}
          {planningTools && <WithdrawalOrderCard inputs={inputs} />}
          <ProjectionChart
            result={result}
            fireAge={inputs.fireAge}
            pensionAge={pensionAge}
            saleAges={[
              inputs.principalResidence?.sellAtAge,
              ...(inputs.investmentProperties ?? []).map((p) => p.sellAtAge),
            ].filter((a): a is number => a != null)}
            scale={scale}
          />
          {displayMode === 'nominal' && (
            <p className="hint nominal-note">
              {t('nominalNote', { pct: (inflation * 100).toFixed(1) })}
            </p>
          )}
          <IncomeChart result={result} fireAge={inputs.fireAge} scale={scale} />
          {/* BE-26 A: the GIS/Allowance household row is stated, not implied. */}
          <BenefitCategoryPanel inputs={inputs} result={result} />
          {!precisionBlocked && <>
          {!taxBlocked && canonical && <PersonTaxTable plan={canonical} result={result} />}
          {!taxBlocked && oldSingleTools && <TaxChart result={result} inputs={inputs} scale={scale} />}
          {!taxBlocked && oldSingleTools && <YearTable result={result} inputs={inputs} />}
          {oldSingleTools && result.taxCapability?.status === 'person' && <p className="hint">{t('be11AuxiliaryEstimate')}</p>}
          </>}
          {planningTools && <StrategyCard inputs={inputs} />}
          {planningTools && <TimingCard inputs={inputs} />}
          {planningTools && <MonteCarloCard key={`${entryMode}:${inputRevision}:${MC_RULE_VERSION}`} inputs={inputs}
            inputRevision={inputRevision} ruleVersion={MC_RULE_VERSION} scale={scale} />}
          <ScenarioCard />
        </section>}
      </main>
      {!professional && planFooter}
      <GlossaryDrawer />
    </div>
  )
}
