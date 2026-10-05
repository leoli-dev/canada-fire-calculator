import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { track } from '../analytics'
import en from './en.json'
import fr from './fr.json'
import zh from './zh.json'

// FE-48: storage can throw (private mode, blocked site data); the language
// then falls back to English for the session instead of breaking startup.
function storedLanguage(): string | null {
  try { return localStorage.getItem('fire-lang') } catch { return null }
}

// FE-45: screen readers pick a voice from <html lang>, so it follows the UI.
function syncDocumentLanguage(lang: string) {
  document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : lang
}

i18n.on('languageChanged', syncDocumentLanguage)

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    zh: { translation: zh },
  },
  lng: storedLanguage() ?? 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

syncDocumentLanguage(i18n.language)

export function setLanguage(lang: string) {
  try { localStorage.setItem('fire-lang', lang) } catch { /* the choice lasts for this session only */ }
  i18n.changeLanguage(lang)
  track('language_switch', { language: lang })
}

export default i18n
