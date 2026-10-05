import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'

/**
 * FE-21: the one "reset all data" action, shared by the professional toolbar
 * and the guided pages. Nothing changes until the user confirms; cancelling
 * returns focus to the button that opened the confirmation.
 */
export function ResetPlan({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation()
  const reset = useStore((s) => s.reset)
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (open) cancel.current?.focus() }, [open])
  const close = () => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()) }
  return <div className="reset-plan">
    <button ref={trigger} type="button" className="reset" aria-expanded={open} data-testid="reset-plan" onClick={() => setOpen(true)}>{t('resetAll')}</button>
    {open && <div role="alertdialog" aria-labelledby="reset-plan-title" aria-describedby="reset-plan-body" className="reset-confirm"
      onKeyDown={(event) => { if (event.key === 'Escape') close() }}>
      <strong id="reset-plan-title">{t('resetConfirmTitle')}</strong>
      <p id="reset-plan-body">{t('resetConfirmBody')}</p>
      <div className="reset-confirm-actions">
        <button ref={cancel} type="button" onClick={close} data-testid="reset-cancel">{t('resetCancel')}</button>
        <button type="button" className="danger" data-testid="reset-confirm" onClick={() => { reset(); setOpen(false); onDone?.() }}>{t('resetConfirm')}</button>
      </div>
    </div>}
  </div>
}
