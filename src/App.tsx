import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { pensionStartAge, runProjection, validateInputs } from './engine'
import { setLanguage } from './i18n'
import { useGlossary } from './glossary'
import { downloadStoredPlan, getStorageReadOnlyReason, useStore } from './store'
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
import { MonteCarloCard } from './components/MonteCarloCard'
import { MC_RULE_VERSION } from './mcProtocol'
import { StrategyCard } from './components/StrategyCard'
import { TimingCard } from './components/TimingCard'
import { ScenarioCard } from './components/ScenarioCard'
import { GlossaryDrawer } from './components/GlossaryDrawer'
import { GithubCorner } from './components/GithubCorner'
import { hasUnusableSharedFields } from './forms/fieldState'
import { migrationReview } from './engine/migrationReview'
import { MigrationReview } from './components/MigrationReview'
import { PersonTaxTable } from './components/PersonTaxTable'

const LANGS = [
  { code: 'en', label: 'EN' },
  { code: 'fr', label: 'FR' },
  { code: 'zh', label: '中文' },
]

export default function App() {
  const { t, i18n } = useTranslation()
  const openGlossary = useGlossary((s) => s.open)
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
  const setEntryMode = useStore((s) => s.setEntryMode)
  const guidedView = useStore((s) => s.guidedView)
  const inputRevision = useStore((s) => s.inputRevision)
  const resultRevision = useStore((s) => s.resultRevision)
  const sharedFieldsPending = useStore(hasUnusableSharedFields)
  const showGuidedResults = entryMode === 'guided' && guidedView === 'results' && resultRevision === inputRevision && !sharedFieldsPending
  const result = useMemo(() => !storageIssue && !sharedFieldsPending && (entryMode === 'professional' || showGuidedResults) ? runProjection(inputs, undefined, canonical ?? undefined) : null, [entryMode, showGuidedResults, inputs, canonical, storageIssue, sharedFieldsPending])
  const precisionBlocked = migrationBlocked
  // Keep the existing single-person planning preview usable while BE-14 B
  // wires working-year tax. Couples and QC never get a disguised pooled tax.
  const singleLegacyPreview = !inputs.partner && (!canonical || canonical.people.length === 1) && inputs.province !== 'QC'
  const taxBlocked = result?.taxCapability?.status !== 'person' && !singleLegacyPreview
  const taxWarning = result?.taxCapability?.status !== 'person'
  const oldSingleTools = singleLegacyPreview
  const hasBlockingIssues = useMemo(
    () => validateInputs(inputs).some((issue) => issue.severity === 'error'),
    [inputs],
  )
  const pensionAge = pensionStartAge(inputs)
  const inflation = inputs.inflation ?? 0.021
  const scale = useMemo(
    () =>
      displayMode === 'nominal'
        ? (age: number) => Math.pow(1 + inflation, age - inputs.currentAge)
        : undefined,
    [displayMode, inflation, inputs.currentAge],
  )

  return (
    <div className="app">
      <GithubCorner href="https://github.com/leoli-dev/canada-fire-calculator" />
      <header>
        <div>
          <h1>{t('title')}</h1>
          <p className="tagline">{t('tagline')}</p>
          <p className="header-disclaimer">
            <strong>{t('disclaimer')}</strong>
          </p>
          <p className="simplifications-note">
            {t('simplificationsNote')}{' '}
            <button type="button" className="term" onClick={() => openGlossary('simplifications')}>
              {t('simplificationsLink')}
            </button>
          </p>
        </div>
        <nav className="langs">
          {LANGS.map((l) => (
            <button
              key={l.code}
              className={i18n.language === l.code ? 'active' : ''}
              onClick={() => setLanguage(l.code)}
            >
              {l.label}
            </button>
          ))}
        </nav>
      </header>

      {storageIssue && <div role="alert" className="hint">
        {t(storageIssue === 'futureVersion' ? 'storageFuture' : 'storageCorrupt')}
        <button type="button" onClick={downloadStoredPlan}>{t('storageDownloadOriginal')}</button>
      </div>}
      <MigrationReview current={canonical} scenarioA={scenarioACanonical} scenarioAExists={scenarioA !== null} />
      {sharedFieldsPending && <div role="status" className="hint">{t('questionnaire.pendingSaved')}</div>}
      <main className={entryMode === 'guided' ? (showGuidedResults ? 'guided-results' : 'guided-only') : undefined}>
        <aside>
          <div className="entry-mode" aria-label={t('entryModeLabel')}>
            <button type="button" className={entryMode === 'guided' ? 'active' : ''} onClick={() => setEntryMode('guided')}>
              {t('guidedMode')}
            </button>
            <button type="button" className={entryMode === 'professional' ? 'active' : ''} onClick={() => setEntryMode('professional')}>
              {t('professionalMode')}
            </button>
          </div>
          {!storageIssue && (entryMode === 'guided' ? <GuidedFlow /> : <InputForm />)}
        </aside>
        {result && !hasBlockingIssues && <section className="results-column">
          <ResultsPanel inputs={inputs} result={result} legacyEstimate={precisionBlocked} legacyOwnershipPending={unresolvedHousehold}
            budgetBasisExcluded={precision?.reasons.includes('budgetBasisExcluded') ?? false}
            taxEstimate={taxBlocked} taxWarning={taxWarning} personTax={result.taxCapability?.status === 'person'} />
          {precisionBlocked ? <ScenarioCard /> : <>
          {taxWarning && <p role="status" className="hint" data-testid="person-tax-limit">{t(inputs.province === 'QC' ? 'be11QcLimit' : singleLegacyPreview ? 'be11SingleEstimate' : 'be11TaxLimit')}</p>}
          {!taxBlocked && oldSingleTools && <WithdrawalOrderCard inputs={inputs} />}
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
          {!taxBlocked && canonical && <PersonTaxTable plan={canonical} result={result} />}
          {!taxBlocked && oldSingleTools && <TaxChart result={result} inputs={inputs} scale={scale} />}
          {!taxBlocked && oldSingleTools && <YearTable result={result} inputs={inputs} />}
          {oldSingleTools && result.taxCapability?.status === 'person' && <p className="hint">{t('be11AuxiliaryEstimate')}</p>}
          {!taxBlocked && oldSingleTools && <StrategyCard inputs={inputs} />}
          {!taxBlocked && oldSingleTools && <TimingCard inputs={inputs} />}
          {!taxBlocked && oldSingleTools && <MonteCarloCard key={`${entryMode}:${inputRevision}:${MC_RULE_VERSION}`} inputs={inputs}
            inputRevision={inputRevision} ruleVersion={MC_RULE_VERSION} scale={scale} />
          }
          <ScenarioCard />
          </>}
        </section>}
      </main>

      <footer>
        <p className="credit">
          {t('createdBy')}{' '}
          <a href="https://xiaojieli.com" target="_blank" rel="noopener noreferrer">
            Leo Li
          </a>
        </p>
        <p className="privacy-note">{t('privacyNote')}</p>
      </footer>
      <GlossaryDrawer />
    </div>
  )
}
