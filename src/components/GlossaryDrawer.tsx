import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useGlossary } from '../glossary'
import { Jargon } from './Jargon'

export function GlossaryDrawer() {
  const { t } = useTranslation()
  const term = useGlossary((s) => s.term)
  const close = useGlossary((s) => s.close)

  useEffect(() => {
    if (!term) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [term, close])

  if (!term) return null

  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <header>
          <h2>{t(`glossary.${term}.title`)}</h2>
          <button type="button" className="drawer-close" onClick={close} aria-label="Close">
            ×
          </button>
        </header>
        <div className="drawer-body">
          <Jargon text={t(`glossary.${term}.body`)} />
        </div>
      </aside>
    </>
  )
}
