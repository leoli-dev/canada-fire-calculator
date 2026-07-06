import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { pensionStartAge, runProjection } from './engine'
import { setLanguage } from './i18n'
import { useGlossary } from './glossary'
import { useStore } from './store'
import { InputForm } from './components/InputForm'
import { WithdrawalOrderCard } from './components/WithdrawalOrderCard'
import { ProjectionChart } from './components/ProjectionChart'
import { IncomeChart } from './components/IncomeChart'
import { TaxChart } from './components/TaxChart'
import { YearTable } from './components/YearTable'
import { ResultsPanel } from './components/ResultsPanel'
import { MonteCarloCard } from './components/MonteCarloCard'
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
  const displayMode = useStore((s) => s.displayMode)
  const result = useMemo(() => runProjection(inputs), [inputs])
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

      <main>
        <aside>
          <InputForm />
        </aside>
        <section>
          <ResultsPanel inputs={inputs} result={result} />
          <WithdrawalOrderCard inputs={inputs} />
          <ProjectionChart
            result={result}
            fireAge={inputs.fireAge}
            pensionAge={pensionAge}
            saleAges={[
              inputs.principalResidence?.sellAtAge,
              ...(inputs.investmentProperties ?? []).map((p) =>
                p.sellAtAge != null ? Math.max(p.sellAtAge, inputs.fireAge) : null,
              ),
            ].filter((a): a is number => a != null)}
            scale={scale}
          />
          {displayMode === 'nominal' && (
            <p className="hint nominal-note">
              {t('nominalNote', { pct: (inflation * 100).toFixed(1) })}
            </p>
          )}
          <IncomeChart result={result} fireAge={inputs.fireAge} scale={scale} />
          <TaxChart result={result} inputs={inputs} scale={scale} />
          <YearTable result={result} inputs={inputs} />
          <StrategyCard inputs={inputs} />
          <TimingCard inputs={inputs} />
          <MonteCarloCard inputs={inputs} scale={scale} />
          <ScenarioCard />
        </section>
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
