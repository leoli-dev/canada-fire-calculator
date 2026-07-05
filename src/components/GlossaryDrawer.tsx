import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useGlossary } from '../glossary'
import { Jargon } from './Jargon'

export function GlossaryDrawer() {
  const { t } = useTranslation()
  const term = useGlossary((s) => s.term)
  const history = useGlossary((s) => s.history)
  const back = useGlossary((s) => s.back)
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
          <div className="drawer-title-row">
            {history.length > 1 && (
              <button type="button" className="drawer-back" onClick={back} aria-label={t('drawerBack')}>
                ‹
              </button>
            )}
            <h2>{t(`glossary.${term}.title`)}</h2>
          </div>
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
