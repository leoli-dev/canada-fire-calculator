import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { track } from '../analytics'
import en from './en.json'
import fr from './fr.json'
import zh from './zh.json'

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    zh: { translation: zh },
  },
  lng: localStorage.getItem('fire-lang') ?? 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export function setLanguage(lang: string) {
  localStorage.setItem('fire-lang', lang)
  i18n.changeLanguage(lang)
  track('language_switch', { language: lang })
}

export default i18n
