import { Button } from '../ui'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useGlossary } from '../glossary'
import { Jargon } from './Jargon'

export function GlossaryDrawer() {
  const { t } = useTranslation()
  const term = useGlossary((s) => s.term)
  const history = useGlossary((s) => s.history)
  const back = useGlossary((s) => s.back)
  const close = useGlossary((s) => s.close)

  const panel = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const isOpen = !!term
  useEffect(() => {
    if (!isOpen) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusables = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]') ?? []).filter(element => !element.matches(':disabled') && element.getClientRects().length > 0)
    closeButton.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
      if (event.key === 'Tab') {
        const items = focusables()
        const index = items.indexOf(document.activeElement as HTMLElement)
        if (!items.length) { event.preventDefault(); panel.current?.focus() }
        else if (event.shiftKey && index <= 0) { event.preventDefault(); items[items.length - 1].focus() }
        else if (!event.shiftKey && (index < 0 || index === items.length - 1)) { event.preventDefault(); items[0].focus() }
      }
    }
    const onFocus = (event: FocusEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) closeButton.current?.focus()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('focusin', onFocus)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusin', onFocus)
      document.body.style.overflow = overflow
      if (previous?.isConnected) previous.focus()
    }
  }, [isOpen, close])

  if (!term) return null

  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <aside ref={panel} className="drawer" role="dialog" aria-modal="true" aria-labelledby="glossary-title" tabIndex={-1}>
        <header>
          <div className="drawer-title-row">
            {history.length > 1 && (
              <Button type="button" className="drawer-back" onClick={back} aria-label={t('drawerBack')}>
                ‹
              </Button>
            )}
            <h2 id="glossary-title">{t(`glossary.${term}.title`)}</h2>
          </div>
          <Button type="button" ref={closeButton} className="drawer-close" onClick={close} aria-label={t('close')}>
            ×
          </Button>
        </header>
        <div className="drawer-body">
          <Jargon text={t(`glossary.${term}.body`)} />
        </div>
      </aside>
    </>
  )
}
