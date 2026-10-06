import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { track } from '../analytics'
import en from './en.json'

// FE-47: English ships with the app; French and Chinese load on demand, so
// the first screen does not download three full translation files.
const LOADERS: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  fr: () => import('./fr.json'),
  zh: () => import('./zh.json'),
}

// FE-48: storage can throw (private mode, blocked site data); the language
// then falls back to English for the session instead of breaking startup.
function storedLanguage(): string {
  try {
    const lang = localStorage.getItem('fire-lang')
    return lang && (lang === 'en' || lang in LOADERS) ? lang : 'en'
  } catch { return 'en' }
}

// FE-45: screen readers pick a voice from <html lang>, so it follows the UI.
function syncDocumentLanguage(lang: string) {
  document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : lang
}

async function loadLanguage(lang: string) {
  if (lang === 'en' || i18n.hasResourceBundle(lang, 'translation')) return
  const bundle = await LOADERS[lang]()
  i18n.addResourceBundle(lang, 'translation', bundle.default)
}

i18n.on('languageChanged', syncDocumentLanguage)

i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  partialBundledLanguages: true,
  interpolation: { escapeValue: false },
})

syncDocumentLanguage(i18n.language)

/** Resolves once the saved language is ready; a failed load keeps English. */
export const i18nReady: Promise<unknown> = (async () => {
  const lang = storedLanguage()
  if (lang === 'en') return
  try {
    await loadLanguage(lang)
    await i18n.changeLanguage(lang)
  } catch { /* stay in English */ }
})()

export async function setLanguage(lang: string) {
  try { localStorage.setItem('fire-lang', lang) } catch { /* the choice lasts for this session only */ }
  try { await loadLanguage(lang) } catch { return } // offline: keep the current language
  await i18n.changeLanguage(lang)
  track('language_switch', { language: lang })
}

export default i18n
