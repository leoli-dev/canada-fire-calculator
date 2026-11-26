import { Button } from '../ui'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { getAnalyticsConsent, privacySignal, setAnalyticsConsent, subscribeAnalyticsConsent, type AnalyticsConsent } from '../analytics'

function useConsent(): [AnalyticsConsent, (consent: 'granted' | 'denied') => void] {
  const consent = useSyncExternalStore(subscribeAnalyticsConsent, getAnalyticsConsent)
  return [consent, setAnalyticsConsent]
}

/** FE-48: asked once, in the page flow; nothing loads until "Allow". */
export function AnalyticsPrompt({ testId = 'analytics-prompt', includeDenied = false }: { testId?: string; includeDenied?: boolean }) {
  const { t } = useTranslation()
  const [consent, choose] = useConsent()
  if (privacySignal() || consent === 'granted' || (consent === 'denied' && !includeDenied)) return null
  return <section className="analytics-prompt" aria-label={t('analyticsPromptLabel')} data-testid={testId}>
    <p>{t('analyticsPrompt')}</p>
    <div>
      <Button variant="primary" type="button" onClick={() => choose('granted')}>{t('analyticsAllow')}</Button>
      <Button type="button" onClick={() => choose('denied')}>{t('analyticsDecline')}</Button>
    </div>
  </section>
}

/** The footer line, with a way to change the answer later. */
export function AnalyticsFooter({ testId = 'analytics-footer', hideGrant = false }: { testId?: string; hideGrant?: boolean }) {
  const { t } = useTranslation()
  const [consent, choose] = useConsent()
  return <p className="privacy-note" data-testid={testId}>
    {t('privacyNote')}{' '}
    {privacySignal() ? t('analyticsSignal') : consent === 'granted' ? <>
      {t('analyticsOn')}{' '}<Button variant="link" type="button" className="text-action" onClick={() => choose('denied')}>{t('analyticsTurnOff')}</Button>
    </> : <>
      {t('analyticsOff')}{' '}{!hideGrant && <Button variant="link" type="button" className="text-action" onClick={() => choose('granted')}>{t('analyticsTurnOn')}</Button>}
    </>}
  </p>
}
