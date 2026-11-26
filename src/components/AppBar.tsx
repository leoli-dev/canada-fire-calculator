import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setLanguage } from '../i18n'
import { useGlossary } from '../glossary'
import { useStore } from '../store'
import { Button, Segmented, Sheet } from '../ui'
import { AnalyticsFooter } from './AnalyticsConsent'

const LANGS = [{ code: 'en', label: 'EN' }, { code: 'fr', label: 'FR' }, { code: 'zh', label: '中文' }]
const github = 'https://github.com/leoli-dev/canada-fire-calculator'

export function CompactDisclaimer() {
  const { t } = useTranslation()
  const openGlossary = useGlossary(s => s.open)
  return <p className="header-disclaimer"><strong>{t('disclaimer')}</strong>{' '}<Button variant="link" className="term" onClick={() => openGlossary('simplifications')}>{t('simplificationsLink')}</Button></p>
}

export function AppBar({ showResults }: { showResults: boolean }) {
  const { t, i18n } = useTranslation()
  const [panel, setPanel] = useState<'menu' | 'language' | null>(null)
  const entryMode = useStore(s => s.entryMode)
  const setEntryMode = useStore(s => s.setEntryMode)
  const displayMode = useStore(s => s.displayMode)
  const setDisplayMode = useStore(s => s.setDisplayMode)
  const openGlossary = useGlossary(s => s.open)
  const modes = <Segmented className="entry-mode" aria-label={t('entryModeLabel')}>
    {(['guided', 'professional'] as const).map(mode => <Button key={mode} className={entryMode === mode ? 'active' : undefined} aria-pressed={entryMode === mode} onClick={() => { setEntryMode(mode); setPanel(null) }}>{t(mode === 'guided' ? 'guidedMode' : 'professionalMode')}</Button>)}
  </Segmented>
  const languages = <Segmented as="nav" className="langs" aria-label={t('ui.language')}>
    {LANGS.map(language => <Button key={language.code} aria-pressed={i18n.language === language.code} onClick={() => { setLanguage(language.code); setPanel(null) }}>{language.label}</Button>)}
  </Segmented>
  const terms = () => openGlossary('fire')
  const disclaimer = <CompactDisclaimer />
  return <>
    <header className="app-bar">
      <h1 className="app-brand"><span aria-hidden="true" className="brand-mark">CA</span><span className="brand-desktop">{t('ui.brand')}</span><span className="brand-mobile">{t('ui.mobileBrand')}</span></h1>
      <div className="app-bar-desktop app-modes">{modes}</div>
      <div className="app-bar-actions app-bar-desktop">
        {showResults && <Segmented className="app-display-basis" aria-label={t('displayModeLabel')}><Button aria-pressed={displayMode === 'real'} onClick={() => setDisplayMode('real')}>{t('ui.real')}</Button><Button aria-pressed={displayMode === 'nominal'} onClick={() => setDisplayMode('nominal')}>{t('ui.nominal')}</Button></Segmented>}
        {languages}
        <Button variant="ghost" className="app-icon" aria-label={t('ui.terms')} onClick={terms}><span aria-hidden="true">▣</span></Button>
        <a className="app-icon" href={github} target="_blank" rel="noopener noreferrer" aria-label={t('githubSource')}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03A9.6 9.6 0 0 1 12 6.82c.85 0 1.71.12 2.51.34 1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" /></svg></a>
      </div>
      <div className="app-bar-mobile">
        <Button data-testid="app-language" aria-label={t('ui.language')} aria-expanded={panel === 'language'} onClick={() => setPanel('language')}>{LANGS.find(language => language.code === i18n.language)?.label ?? 'EN'}</Button>
        <Button data-testid="app-menu" variant="ghost" aria-label={t('ui.menu')} aria-expanded={panel === 'menu'} onClick={() => setPanel('menu')}><span aria-hidden="true">☰</span></Button>
      </div>
    </header>
    <div className="desktop-disclaimer">{disclaimer}</div>
    <Sheet open={panel !== null} onClose={() => setPanel(null)} title={t(panel === 'language' ? 'ui.language' : 'ui.menu')} closeLabel={t('ui.close')}>
      {panel === 'language' ? languages : <div className="app-menu-content">{modes}<Button onClick={() => { setPanel(null); requestAnimationFrame(terms) }}>{t('ui.terms')}</Button><a href={github} target="_blank" rel="noopener noreferrer">{t('githubSource')}</a><section aria-label={t('ui.privacy')}><h3>{t('ui.privacy')}</h3><AnalyticsFooter /></section>{disclaimer}</div>}
    </Sheet>
  </>
}
