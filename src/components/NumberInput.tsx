import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

function seps(lang: string) {
  const parts = new Intl.NumberFormat(lang).formatToParts(1234.5)
  return {
    group: parts.find((p) => p.type === 'group')?.value ?? ',',
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
  }
}

/** Normalize typed text to a plain "-1234.5" string: strips group separators
 * (and plain spaces, since fr groups with narrow no-break space), maps the
 * locale decimal mark to '.', drops stray characters, and removes leading
 * zeros so typing over a 0 can't produce "030". */
function sanitize(text: string, lang: string): string {
  const { group, decimal } = seps(lang)
  let s = text.split(group).join('').replace(/[\s  ]/g, '')
  if (decimal !== '.') s = s.split(decimal).join('.')
  s = s.replace(/[^0-9.-]/g, '')
  const neg = s.startsWith('-')
  s = s.replace(/-/g, '')
  const dot = s.indexOf('.')
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '')
  s = s.replace(/^0+(?=\d)/, '')
  return (neg ? '-' : '') + s
}

/** "-1234.5" -> "-1,234.5" / "-1 234,5" depending on locale. No rounding. */
function formatRaw(raw: string, lang: string): string {
  if (raw === '' || raw === '-') return raw
  if (/[a-z]/i.test(raw)) return raw
  const { group, decimal } = seps(lang)
  const neg = raw.startsWith('-')
  const [int, frac] = (neg ? raw.slice(1) : raw).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, group)
  return (neg ? '-' : '') + grouped + (frac !== undefined ? decimal + frac : '')
}

/** Drop float noise like 5.500000000000001 before displaying a stored value. */
function toRaw(value: number): string {
  return String(Number(value.toFixed(4)))
}

/**
 * Text-based numeric input: clearable with a draft supplied by the field adapter
 * when available, no leading zeros, live
 * locale-aware thousands separators, ArrowUp/Down stepping. Replaces
 * type="number" everywhere (user feedback #1/#2/#4).
 */
export function NumberInput(props: {
  value: number | null
  onChange: (v: number | null) => void
  draft?: string
  /** Return true when the field adapter handled this text as a draft. */
  onDraftChange?: (raw: string) => boolean | void
  preserveInvalidDraft?: boolean
  step?: number
  className?: string
  placeholder?: string
  id?: string
}) {
  const { i18n } = useTranslation()
  const lang = i18n.language
  const ref = useRef<HTMLInputElement>(null)
  const edited = useRef(false)
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')
  const caretUnits = useRef<number | null>(null)

  const display = focused
    ? formatRaw(text, lang)
    : props.draft !== undefined
      ? formatRaw(props.draft, lang)
      : props.value === null
      ? ''
      : formatRaw(toRaw(props.value), lang)

  // After formatting inserts/removes separators, restore the caret to sit
  // after the same count of significant characters it was at before.
  useLayoutEffect(() => {
    if (caretUnits.current === null || !ref.current) return
    const target = caretUnits.current
    caretUnits.current = null
    const val = ref.current.value
    const { decimal } = seps(lang)
    let pos = 0
    let seen = 0
    while (pos < val.length && seen < target) {
      const ch = val[pos]
      if (/[0-9-]/.test(ch) || ch === decimal) seen++
      pos++
    }
    ref.current.setSelectionRange(pos, pos)
  })

  function commit(raw: string) {
    if (raw === '' || raw === '-') {
      props.onChange(null)
      return
    }
    const n = Number(raw)
    if (Number.isFinite(n)) props.onChange(n)
  }

  return (
    <input
      ref={ref}
      id={props.id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={props.className}
      placeholder={props.placeholder}
      value={display}
      onFocus={() => {
        edited.current = false
        setText(props.draft ?? (props.value === null ? '' : toRaw(props.value)))
        setFocused(true)
      }}
      onBlur={() => {
        // Valid text was committed on change; adapters handled drafts there too.
        // Only legacy nullable controls need a deferred empty commit.
        if (edited.current && !props.onDraftChange && (text === '' || text === '-')) commit(text)
        edited.current = false
        setFocused(false)
      }}
      onChange={(e) => {
        edited.current = true
        const el = e.target
        const before = el.value.slice(0, el.selectionStart ?? el.value.length)
        caretUnits.current = sanitize(before, lang).length
        const raw = props.preserveInvalidDraft && /[a-z]/i.test(el.value) ? el.value : sanitize(el.value, lang)
        setText(raw)
        const handledAsDraft = props.onDraftChange?.(raw) === true
        if (!handledAsDraft && raw !== '' && raw !== '-') commit(raw)
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault()
        const step = props.step ?? 1
        const next = (props.value ?? 0) + (e.key === 'ArrowUp' ? step : -step)
        setText(toRaw(next))
        props.onChange(next)
      }}
    />
  )
}
