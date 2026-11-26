import { Children, cloneElement, createContext, createElement, forwardRef, isValidElement, useContext, useEffect, useId, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, DetailsHTMLAttributes, HTMLAttributes, LabelHTMLAttributes, ReactElement, ReactNode, RefObject, SelectHTMLAttributes } from 'react'
import './ui.css'

const classes = (...values: (string | undefined | false)[]) => values.filter(Boolean).join(' ')
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'; size?: 'md' | 'sm'; loading?: boolean }
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', loading, disabled, className, children, type = 'button', ...props }, ref) {
  return <button {...props} ref={ref} type={type} disabled={disabled || loading} aria-busy={loading ? true : props['aria-busy']} className={classes('ui-button', `ui-button-${variant}`, `ui-button-${size}`, className)}>{loading ? <><span className="ui-button-label-loading">{children}</span><span className="ui-spinner" aria-hidden="true" /></> : children}</button>
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

export const ReadableFieldValues = createContext<{ options: string; close: string } | null>(null)
type SelectOption = ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>
const selectOptions = (nodes: ReactNode): SelectOption[] => Children.toArray(nodes).flatMap(node => !isValidElement(node) ? [] : node.type === 'option' ? [node as SelectOption] : selectOptions((node.props as { children?: ReactNode }).children))

/** Native selection stays available; the Sheet also makes every long option readable at phone widths. */
function FieldOptions({ field, select, labels }: { field: RefObject<HTMLElement>; select: ReactElement<SelectHTMLAttributes<HTMLSelectElement>>; labels: { options: string; close: string } }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return <div className="professional-select-options"><Button size="sm" aria-expanded={open} aria-controls={id} disabled={select.props.disabled} onClick={() => setOpen(true)}>{labels.options}</Button>
    <Sheet id={id} open={open} onClose={() => setOpen(false)} title={labels.options} closeLabel={labels.close}>
      <div className="professional-option-list">{selectOptions(select.props.children).map((option, index) => <Button key={index} disabled={option.props.disabled} aria-pressed={String(option.props.value) === String(select.props.value)} onClick={() => {
        const control = field.current?.querySelector('select')
        if (!control) return
        control.selectedIndex = index
        control.dispatchEvent(new Event('change', { bubbles: true }))
        setOpen(false)
      }}>{option.props.children}</Button>)}</div>
    </Sheet>
  </div>
}
export function Field({ as = 'label', className, children, ...props }: LabelHTMLAttributes<HTMLLabelElement> & { as?: 'label' | 'div' }) {
  const readable = useContext(ReadableFieldValues)
  const field = useRef<HTMLElement>(null)
  const select = readable ? Children.toArray(children).find(child => isValidElement(child) && child.type === 'select') as ReactElement<SelectHTMLAttributes<HTMLSelectElement>> | undefined : undefined
  const selected = select && selectOptions(select.props.children).find(option => String(option.props.value) === String(select.props.value))
  return <>{createElement(as, { ...props, ref: field, className: classes('ui-field', className) }, <>{children}{selected && <span className="selected-value" aria-hidden="true">{selected.props.children}</span>}</>)}{select && readable && <FieldOptions field={field} select={select} labels={readable} />}</>
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

/** Match native sequential focus, rather than all elements that can be focused by script. */
function tabbableElements(root: HTMLElement | null): HTMLElement[] {
  const candidates = Array.from(root?.querySelectorAll<HTMLElement>('a[href], area[href], button, input, select, textarea, summary, iframe, [contenteditable], [tabindex]') ?? [])
  const visible = candidates.filter(element => {
    const tabIndex = !element.hasAttribute('tabindex') && element.isContentEditable ? 0 : element.tabIndex
    if (tabIndex < 0 || element.matches(':disabled, input[type="hidden"], [data-ui-focus-guard]') || element.closest('[hidden], [inert]')) return false
    if (element.tagName === 'SUMMARY' && element.parentElement?.querySelector(':scope > summary') !== element) return false
    const visibility = getComputedStyle(element).visibility
    if (visibility === 'hidden' || visibility === 'collapse') return false
    for (let ancestor: HTMLElement | null = element; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      if (style.display === 'none') return false
      if (ancestor instanceof HTMLDetailsElement && !ancestor.open && !ancestor.querySelector(':scope > summary')?.contains(element)) return false
    }
    // checkVisibility also handles content-visibility and missing layout boxes in real browsers.
    return !element.checkVisibility || element.checkVisibility()
  })
  return visible.filter(element => {
    if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || !element.name) return true
    const group = visible.filter((other): other is HTMLInputElement => other instanceof HTMLInputElement && other.type === 'radio' && other.name === element.name && other.form === element.form)
    const checked = group.find(radio => radio.checked)
    // Any unchecked member can receive native focus, depending on direction and focus history.
    return !checked || element === checked
  }).sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : Infinity) - (b.tabIndex > 0 ? b.tabIndex : Infinity))
}

function sameRadioGroup(a: HTMLElement, b: HTMLElement): boolean {
  return a instanceof HTMLInputElement && b instanceof HTMLInputElement && a.type === 'radio' && b.type === 'radio'
    && !!a.name && a.name === b.name && a.form === b.form
}

export function Sheet({ open, onClose, title, closeLabel, children, id, closeButtonClassName, lockScroll = true }: { closeButtonClassName?: string; open: boolean; onClose: () => void; title: ReactNode; closeLabel: string; children: ReactNode; id?: string; lockScroll?: boolean }) {
  const generatedId = useId()
  const titleId = `${id ?? generatedId}-title`
  const panel = useRef<HTMLDivElement>(null)
  const backwards = useRef(false)
  // Native radio traversal can skip remaining group members and reach a guard instead of a listed boundary.
  const focusBoundary = () => {
    const items = tabbableElements(panel.current)
    ;(backwards.current ? items[items.length - 1] : items[0])?.focus()
  }
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    backwards.current = false
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    if (lockScroll) document.body.style.overflow = 'hidden'
    const focusable = () => tabbableElements(panel.current)
    ;(focusable()[0] ?? panel.current)?.focus()
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current() }
      if (event.key === 'Tab') {
        backwards.current = event.shiftKey
        const items = focusable()
        const startGuard = panel.current?.querySelector<HTMLElement>('[data-ui-focus-guard="start"]')
        // A positive tabindex must not precede the reverse-wrap guard in native tab order.
        if (startGuard) startGuard.tabIndex = items[0]?.tabIndex > 0 ? items[0].tabIndex : 0
        const active = document.activeElement as HTMLElement
        const index = items.indexOf(active)
        if (!items.length) { event.preventDefault(); panel.current?.focus() }
        else {
          // A programmatically focused heading can sit between native tab stops.
          const preceding = index < 0 ? items.filter(item => active.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_PRECEDING) : items.slice(0, index)
          const following = index < 0 ? items.filter(item => active.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) : items.slice(index + 1)
          if (event.shiftKey && preceding.every(item => sameRadioGroup(active, item))) { event.preventDefault(); items[items.length - 1].focus() }
          else if (!event.shiftKey && following.every(item => sameRadioGroup(active, item))) { event.preventDefault(); items[0].focus() }
        }
      }
    }
    const focusIn = (event: FocusEvent) => { if (panel.current && !panel.current.contains(event.target as Node)) (focusable()[0] ?? panel.current).focus() }
    document.addEventListener('keydown', keyDown, true)
    document.addEventListener('focusin', focusIn)
    return () => { document.removeEventListener('keydown', keyDown, true); document.removeEventListener('focusin', focusIn); if (lockScroll) document.body.style.overflow = overflow; previous?.focus() }
  }, [open, lockScroll])
  if (!open) return null
  return <div className="ui-sheet-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}><div ref={panel} id={id} className="ui-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><span className="sr-only" tabIndex={0} data-ui-focus-guard="start" onFocus={focusBoundary} /><div className="ui-sheet-handle" aria-hidden="true" /><div className="ui-sheet-header"><h2 id={titleId}>{title}</h2><Button className={closeButtonClassName} aria-label={closeLabel} variant="ghost" onClick={onClose}>×</Button></div><div className="ui-sheet-body">{children}</div><span className="sr-only" tabIndex={0} data-ui-focus-guard="end" onFocus={focusBoundary} /></div></div>
}

/** Kept outside its label to avoid nested interactive controls. */
export function FieldHelp({ title, closeLabel, children }: { title: string; closeLabel: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return <span className="ui-field-help-container"><Button className="ui-field-help" aria-expanded={open} aria-controls={id} aria-label={title} onClick={() => setOpen(true)}>i</Button><Sheet id={id} open={open} onClose={() => setOpen(false)} title={title} closeLabel={closeLabel}>{children}</Sheet></span>
}
