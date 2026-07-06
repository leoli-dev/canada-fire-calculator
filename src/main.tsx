import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import './i18n'
import './styles.css'
import App from './App'
import { initAnalytics } from './analytics'

initAnalytics()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
