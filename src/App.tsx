import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { pensionStartAge, runProjection, validateInputs } from './engine'
import { setLanguage } from './i18n'
import { useGlossary } from './glossary'
import { getStorageReadOnlyReason, useStore } from './store'
import { precisionGate } from './engine/model'
import { InputForm } from './components/InputForm'
import { GuidedFlow } from './components/GuidedFlow'
import { WithdrawalOrderCard } from './components/WithdrawalOrderCard'
import { ProjectionChart } from './components/ProjectionChart'
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
  const storageIssue = getStorageReadOnlyReason()
  const unresolvedHousehold = canonical
    ? canonical.accounts.some((account) => account.ownerId === null || account.taxableOwnerShares.status === 'unknown') || canonical.properties.some((property) => property.taxableOwnerShares.status === 'unknown')
    : !!inputs.partner
  const precision = canonical ? precisionGate(canonical) : null
  const ownershipAccounts = canonical?.accounts ?? []
  const displayMode = useStore((s) => s.displayMode)
  const entryMode = useStore((s) => s.entryMode)
  const setEntryMode = useStore((s) => s.setEntryMode)
  const guidedView = useStore((s) => s.guidedView)
  const inputRevision = useStore((s) => s.inputRevision)
  const resultRevision = useStore((s) => s.resultRevision)
  const showGuidedResults = entryMode === 'guided' && guidedView === 'results' && resultRevision === inputRevision
  const result = useMemo(() => !storageIssue && (entryMode === 'professional' || showGuidedResults) ? runProjection(inputs) : null, [entryMode, showGuidedResults, inputs, storageIssue])
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

      {storageIssue && <div role="alert" className="hint">{t(storageIssue === 'futureVersion' ? 'storageFuture' : 'storageCorrupt')}</div>}
      {unresolvedHousehold && <div role="status" className="hint" data-testid="migration-gate">
        {t('migrationOwnershipWarning')}
        <ul>{ownershipAccounts.map((account) => <li key={account.id}>{account.kind}: {account.balance.toLocaleString()} CAD {account.ownerId === null ? t('migrationUnassigned') : t(canonical?.people.find((person) => person.id === account.ownerId)?.role === 'partner' ? 'migrationOwnerPartner' : 'migrationOwnerSelf')}{account.acb.status === 'known' ? `, ${t('migrationBasis')} ${account.acb.value.toLocaleString()} CAD` : ''}</li>)}</ul>
        {t('migrationSharedPlan')}
      </div>}
      {!unresolvedHousehold && precision && !precision.allowed && <div role="status" className="hint">{t('migrationApproximate')}</div>}
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
          <ResultsPanel inputs={inputs} result={result} />
          <WithdrawalOrderCard inputs={inputs} />
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
          {!unresolvedHousehold && <TaxChart result={result} inputs={inputs} scale={scale} />}
          <YearTable result={result} inputs={inputs} />
          {!unresolvedHousehold && <StrategyCard inputs={inputs} />}
          {!unresolvedHousehold && <TimingCard inputs={inputs} />}
          <MonteCarloCard key={`${entryMode}:${inputRevision}:${MC_RULE_VERSION}`} inputs={inputs}
            inputRevision={inputRevision} ruleVersion={MC_RULE_VERSION} scale={scale} />
          <ScenarioCard />
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
