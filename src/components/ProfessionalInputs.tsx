import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ReadableFieldValues, StatusChip } from '../ui'
import { useStore } from '../store'

const Search = createContext('')

export function ProfessionalInputs({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)')
    const enforce = () => {
      if (!media.matches) return
      const groups = root.current?.querySelectorAll<HTMLDetailsElement>('.professional-group[open]')
      groups?.forEach((group, index) => { if (index) group.open = false })
    }
    const toggle = (event: Event) => {
      const target = event.target
      if (!media.matches || !(target instanceof HTMLDetailsElement) || !target.matches('.professional-group[open]')) return
      root.current?.querySelectorAll<HTMLDetailsElement>('.professional-group').forEach(group => { if (group !== target) group.open = false })
    }
    enforce()
    root.current?.addEventListener('toggle', toggle, true)
    media.addEventListener('change', enforce)
    const node = root.current
    return () => { node?.removeEventListener('toggle', toggle, true); media.removeEventListener('change', enforce) }
  }, [])
  return <ReadableFieldValues.Provider value={{ options: t('ui.professional.options'), close: t('ui.close') }}><Search.Provider value={search}><div ref={root} className="professional-inputs">
    <div className="professional-tools">
      <label className="professional-search"><span className="sr-only">{t('ui.professional.search')}</span><input type="search" value={search} placeholder={t('ui.professional.search')} onChange={event => setSearch(event.target.value)} /></label>
      <Button onClick={() => { setSearch(''); root.current?.querySelectorAll<HTMLDetailsElement>('.professional-group').forEach(group => { group.open = false }) }}>{t('ui.professional.collapse')}</Button>
    </div>
    {children}
  </div></Search.Provider></ReadableFieldValues.Provider>
}

/** Keep editors mounted when a group closes or a search hides it, including uncommitted drafts. */
export function ProfessionalGroup({ name, title, summary, fields = [], children }: { name: string; title: string; summary?: string; fields?: readonly string[]; children: ReactNode }) {
  const { t } = useTranslation()
  const answerMeta = useStore(state => state.answerMeta)
  const [nestedFields, setNestedFields] = useState<string[]>([])
  const available = [...new Set([...fields, ...nestedFields])].filter(field => answerMeta[field]?.status !== 'notApplicable')
  const confirmed = available.filter(field => answerMeta[field]?.status === 'confirmed' && answerMeta[field]?.origin === 'user').length
  const estimated = available.filter(field => answerMeta[field]?.status === 'estimated').length
  const status = available.length && available.some(field => answerMeta[field])
    ? t('ui.professional.confirmed', { count: confirmed, total: available.length })
    : t('ui.professional.needsReview')
  const query = useContext(Search).trim().toLocaleLowerCase()
  const root = useRef<HTMLDetailsElement>(null)
  const [matches, setMatches] = useState(true)
  useLayoutEffect(() => { if (root.current) root.current.open = name === "profile" || !window.matchMedia("(max-width: 640px)").matches }, [])
  useLayoutEffect(() => {
    const group = root.current
    if (!group) return
    const update = () => {
      const next: string[] = []
      group.querySelectorAll<HTMLDetailsElement>('details[data-status-fields]').forEach(details => {
        for (let parent: HTMLElement | null = details; parent && parent !== group; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement && !parent.open) return
        }
        next.push(...(details.dataset.statusFields ?? '').split(' ').filter(Boolean))
      })
      setNestedFields(previous => previous.join(' ') === next.join(' ') ? previous : next)
    }
    update()
    group.addEventListener('toggle', update, true)
    return () => group.removeEventListener('toggle', update, true)
  }, [children])
  useLayoutEffect(() => {
    const group = root.current
    if (!group) return
    const containsQuery = (text: string) => query.split(/\s+/).every(word => text.toLocaleLowerCase().includes(word))
    const titleMatches = containsQuery(title)
    let found = !query || titleMatches
    group.querySelectorAll<HTMLElement>('.ui-field, label.ui-choice').forEach(field => {
      // Option lists are values, not field labels. Search only the visible label wording.
      const copy = field.cloneNode(true) as HTMLElement
      copy.querySelectorAll('input, select, textarea, .selected-value').forEach(node => node.remove())
      const match = !query || titleMatches || containsQuery(copy.textContent ?? '')
      field.dataset.searchHidden = String(!match)
      if (match) {
        found = true
        if (query) for (let parent = field.parentElement; parent && parent !== group; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement) parent.open = true
        }
      }
    })
    setMatches(found)
    if (query && found) group.open = true
  }, [query, title, children])
  return <details ref={root} className="ui-disclosure professional-group" data-group={name} hidden={!matches} open={undefined}>
    <summary><span>{title}</span><small>{summary ?? <>{status}{estimated > 0 && <> · <StatusChip status="est">{t('ui.professional.estimates', { count: estimated })}</StatusChip></>}</>}</small></summary>
    <div role="group" aria-label={title} className="professional-group-body">{children}</div>
  </details>
}
