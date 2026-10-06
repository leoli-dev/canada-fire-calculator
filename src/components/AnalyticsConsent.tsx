import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { getAnalyticsConsent, privacySignal, setAnalyticsConsent, subscribeAnalyticsConsent, type AnalyticsConsent } from '../analytics'

function useConsent(): [AnalyticsConsent, (consent: 'granted' | 'denied') => void] {
  const consent = useSyncExternalStore(subscribeAnalyticsConsent, getAnalyticsConsent)
  return [consent, setAnalyticsConsent]
}

/** FE-48: asked once, in the page flow; nothing loads until "Allow". */
export function AnalyticsPrompt() {
  const { t } = useTranslation()
  const [consent, choose] = useConsent()
  if (consent !== null) return null
  return <section className="analytics-prompt" aria-label={t('analyticsPromptLabel')} data-testid="analytics-prompt">
    <p>{t('analyticsPrompt')}</p>
    <div>
      <button type="button" onClick={() => choose('granted')}>{t('analyticsAllow')}</button>
      <button type="button" onClick={() => choose('denied')}>{t('analyticsDecline')}</button>
    </div>
  </section>
}

/** The footer line, with a way to change the answer later. */
export function AnalyticsFooter() {
  const { t } = useTranslation()
  const [consent, choose] = useConsent()
  return <p className="privacy-note" data-testid="analytics-footer">
    {t('privacyNote')}{' '}
    {privacySignal() ? t('analyticsSignal') : consent === 'granted' ? <>
      {t('analyticsOn')}{' '}<button type="button" className="text-action" onClick={() => choose('denied')}>{t('analyticsTurnOff')}</button>
    </> : <>
      {t('analyticsOff')}{' '}<button type="button" className="text-action" onClick={() => choose('granted')}>{t('analyticsTurnOn')}</button>
    </>}
  </p>
}
