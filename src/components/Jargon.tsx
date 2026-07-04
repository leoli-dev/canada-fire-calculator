import type { ReactNode } from 'react'
import { TERM_REGEX, termIdFor, useGlossary } from '../glossary'

/**
 * Renders a string with every known jargon term turned into a clickable
 * element that opens the glossary drawer.
 */
export function Jargon(props: { text: string }) {
  const open = useGlossary((s) => s.open)
  const { text } = props
  const parts: ReactNode[] = []
  let last = 0

  for (const m of text.matchAll(TERM_REGEX)) {
    const start = m.index!
    const end = start + m[0].length
    if (start < last) continue
    // ASCII terms need word boundaries so e.g. "SV" never matches inside a word
    if (/^[A-Za-z]/.test(m[0])) {
      const before = text[start - 1]
      const after = text[end]
      if ((before && /[A-Za-z0-9]/.test(before)) || (after && /[A-Za-z0-9]/.test(after))) {
        continue
      }
    }
    const id = termIdFor(m[0])
    if (!id) continue
    if (start > last) parts.push(text.slice(last, start))
    parts.push(
      <button
        key={start}
        type="button"
        className="term"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          open(id)
        }}
      >
        {m[0]}
      </button>,
    )
    last = end
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
