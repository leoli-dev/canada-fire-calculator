import { Children, cloneElement, createElement, forwardRef, isValidElement, useEffect, useId, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, DetailsHTMLAttributes, HTMLAttributes, LabelHTMLAttributes, ReactElement, ReactNode } from 'react'
import './ui.css'

const classes = (...values: (string | undefined | false)[]) => values.filter(Boolean).join(' ')
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'; size?: 'md' | 'sm'; loading?: boolean }
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', loading, disabled, className, children, type = 'button', ...props }, ref) {
  return <button {...props} ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={classes('ui-button', `ui-button-${variant}`, `ui-button-${size}`, className)}>{loading ? <><span className="ui-button-label-loading">{children}</span><span className="ui-spinner" aria-hidden="true" /></> : children}</button>
})

type BoxProps = HTMLAttributes<HTMLElement> & { as?: 'div' | 'nav' | 'p' | 'section' | 'fieldset' | 'aside' }
export function Segmented({ as = 'div', className, children, mode = 'button', ...props }: BoxProps & { mode?: 'button' | 'tab' }) {
  const root = useRef<HTMLElement>(null)
  function keyDown(event: React.KeyboardEvent<HTMLElement>) {
    props.onKeyDown?.(event)
    if (event.defaultPrevented || mode !== 'tab' || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const tabs = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? [])
    if (!tabs.length) return
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    event.preventDefault(); tabs[next].focus(); tabs[next].click()
  }
  return createElement(as, { ...props, ref: root, role: mode === 'tab' ? 'tablist' : props.role ?? (as === 'nav' ? undefined : 'group'), onKeyDown: keyDown, className: classes('ui-segmented', className) }, Children.map(children, child => {
    if (!isValidElement(child)) return child
    const item = child as ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>
    const value = item.props['aria-selected'] ?? item.props['aria-pressed'] ?? item.props.className?.split(' ').includes('active') ?? false
    const selected = value === true || value === 'true'
    return cloneElement(item, mode === 'tab' ? { role: 'tab', 'aria-selected': selected, tabIndex: selected ? 0 : -1 } : { 'aria-pressed': selected })
  }))
}

export function Field({ as = 'label', className, children, ...props }: LabelHTMLAttributes<HTMLLabelElement> & { as?: 'label' | 'div' }) {
  return createElement(as, { ...props, className: classes('ui-field', className) }, children)
}
export function ChoiceCard({ as = 'label', className, children, ...props }: LabelHTMLAttributes<HTMLLabelElement> & { as?: 'label' | 'button'; type?: 'button'; 'aria-pressed'?: boolean }) {
  return createElement(as, { ...props, className: classes('ui-choice', className) }, children)
}
export function StatusChip({ as = 'span', className, children, status, ...props }: HTMLAttributes<HTMLSpanElement> & { as?: 'span' | 'small'; status?: 'ok' | 'est' | 'unknown' | 'bad' | 'info' }) {
  const kind = status ?? (/confirmed|best/.test(className ?? '') ? 'ok' : /poor-tag/.test(className ?? '') ? 'bad' : /unknown/.test(className ?? '') ? 'unknown' : /estimated|legacy/.test(className ?? '') ? 'est' : 'info')
  return createElement(as, { ...props, className: classes('ui-status', `ui-status-${kind}`, className) }, <>{(kind === 'ok' || kind === 'bad') && <span className="ui-status-icon" aria-hidden="true" />}{children}</>)
}
export function Callout({ as = 'div', className, children, variant = 'info', ...props }: BoxProps & { variant?: 'info' | 'warn' | 'example' }) {
  return createElement(as, { ...props, className: classes('ui-callout', `ui-callout-${variant}`, className) }, <><span className="ui-callout-icon" aria-hidden="true">{variant === 'warn' ? '!' : variant === 'example' ? '◇' : 'i'}</span>{children}</>)
}
export function Disclosure({ className, ...props }: DetailsHTMLAttributes<HTMLDetailsElement>) {
  return <details {...props} className={classes('ui-disclosure', className)} />
}

export function Sheet({ open, onClose, title, closeLabel, children, id }: { open: boolean; onClose: () => void; title: ReactNode; closeLabel: string; children: ReactNode; id?: string }) {
  const generatedId = useId()
  const titleId = `${id ?? generatedId}-title`
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])
    ;(focusable()[0] ?? panel.current)?.focus()
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current() }
      if (event.key === 'Tab') {
        const items = focusable()
        const index = items.indexOf(document.activeElement as HTMLElement)
        if (!items.length) { event.preventDefault(); panel.current?.focus() }
        else if (event.shiftKey && index <= 0) { event.preventDefault(); items[items.length - 1].focus() }
        else if (!event.shiftKey && (index < 0 || index === items.length - 1)) { event.preventDefault(); items[0].focus() }
      }
    }
    const focusIn = (event: FocusEvent) => { if (panel.current && !panel.current.contains(event.target as Node)) (focusable()[0] ?? panel.current).focus() }
    document.addEventListener('keydown', keyDown, true)
    document.addEventListener('focusin', focusIn)
    return () => { document.removeEventListener('keydown', keyDown, true); document.removeEventListener('focusin', focusIn); document.body.style.overflow = overflow; previous?.focus() }
  }, [open])
  if (!open) return null
  return <div className="ui-sheet-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}><div ref={panel} id={id} className="ui-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><div className="ui-sheet-handle" aria-hidden="true" /><div className="ui-sheet-header"><h2 id={titleId}>{title}</h2><Button aria-label={closeLabel} variant="ghost" onClick={onClose}>×</Button></div><div className="ui-sheet-body">{children}</div></div></div>
}

/** Kept outside its label to avoid nested interactive controls. */
export function FieldHelp({ title, closeLabel, children }: { title: string; closeLabel: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return <span className="ui-field-help-container"><Button className="ui-field-help" aria-expanded={open} aria-controls={id} aria-label={title} onClick={() => setOpen(true)}>i</Button><Sheet id={id} open={open} onClose={() => setOpen(false)} title={title} closeLabel={closeLabel}>{children}</Sheet></span>
}
