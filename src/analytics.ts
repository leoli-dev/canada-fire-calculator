const GA_ID = 'G-3JMPWTVYPG'

const CONSENT_KEY = 'fire-analytics-consent'

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
  interface Navigator {
    globalPrivacyControl?: boolean
  }
}

export type AnalyticsConsent = 'granted' | 'denied' | null

/**
 * FE-48: analytics stay off until the visitor allows them (Quebec's Law 25
 * wants tracking off by default), and a Global Privacy Control or Do Not
 * Track signal counts as a refusal that is never asked about.
 */
export function privacySignal(): boolean {
  return navigator.globalPrivacyControl === true || navigator.doNotTrack === '1'
}

// The answer given this session, which holds even when storage is blocked.
let sessionConsent: AnalyticsConsent = null
const listeners = new Set<() => void>()

export function subscribeAnalyticsConsent(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getAnalyticsConsent(): AnalyticsConsent {
  if (privacySignal()) return 'denied'
  if (sessionConsent) return sessionConsent
  try {
    const stored = localStorage.getItem(CONSENT_KEY)
    return stored === 'granted' || stored === 'denied' ? stored : null
  } catch { return null }
}

export function setAnalyticsConsent(consent: 'granted' | 'denied') {
  sessionConsent = consent
  try { localStorage.setItem(CONSENT_KEY, consent) } catch { /* asked again next visit */ }
  if (consent === 'granted') loadAnalytics()
  else (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = true
  listeners.forEach((listener) => listener())
}

/** Loads analytics at startup only when the visitor already allowed them. */
export function initAnalytics() {
  if (getAnalyticsConsent() === 'granted') loadAnalytics()
}

/**
 * Loads gtag.js in production builds only, so local dev and tests never
 * pollute the analytics data. Financial inputs are never sent, only
 * anonymous interaction events (see track()).
 */
function loadAnalytics() {
  ;(window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = false
  if (!import.meta.env.PROD || window.gtag) return
  window.dataLayer = window.dataLayer ?? []
  window.gtag = function gtag() {
    // GA requires the Arguments object itself, not a spread copy
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments)
  }
  window.gtag('js', new Date())
  window.gtag('config', GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false })
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.appendChild(script)
}

export function track(
  event: string,
  params?: Record<string, string | number | boolean>,
) {
  if (getAnalyticsConsent() !== 'granted') return
  window.gtag?.('event', event, params)
}

const firedOnce = new Set<string>()

/** Fire an event at most once per page load (e.g. "user actually edited inputs"). */
export function trackOnce(
  event: string,
  params?: Record<string, string | number | boolean>,
) {
  if (firedOnce.has(event)) return
  firedOnce.add(event)
  track(event, params)
}
