import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import { i18nReady } from './i18n'
import './styles.css'
import App from './App'
import { initAnalytics } from './analytics'

initAnalytics()

// Render after the saved language is loaded, so French or Chinese users never
// see an English first frame.
i18nReady.then(() => ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
))
