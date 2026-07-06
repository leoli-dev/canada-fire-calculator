const GA_ID = 'G-3JMPWTVYPG'

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

/**
 * Loads gtag.js in production builds only, so local dev and tests never
 * pollute the analytics data. Financial inputs are never sent — only
 * anonymous interaction events (see track()).
 */
export function initAnalytics() {
  if (!import.meta.env.PROD) return
  window.dataLayer = window.dataLayer ?? []
  window.gtag = function gtag() {
    // GA requires the Arguments object itself, not a spread copy
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments)
  }
  window.gtag('js', new Date())
  window.gtag('config', GA_ID)
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.appendChild(script)
}

export function track(
  event: string,
  params?: Record<string, string | number | boolean>,
) {
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
