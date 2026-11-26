import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui'

export type ResultSectionId = 'overview' | 'balances' | 'income' | 'benefits' | 'tax' | 'strategies' | 'risk' | 'scenarios'
export const resultSectionAnchor = (id: ResultSectionId) => `results-${id}`

/** An overflow pane is the root only while it actually scrolls (desktop/phone Professional). */
export function resultScrollport(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent
  }
  return null
}

/** Native scrollIntoView also scrolls overflow:hidden app shells. Move only the reading pane. */
export function focusResultTarget(target: HTMLElement) {
  const root = target.id === 'results' && /(auto|scroll)/.test(getComputedStyle(target).overflowY) ? target : resultScrollport(target)
  const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0
  if (root) root.scrollTo({ top: target === root ? 0 : root.scrollTop + target.getBoundingClientRect().top - root.getBoundingClientRect().top - margin, behavior: 'instant' })
  else window.scrollTo({ top: scrollY + target.getBoundingClientRect().top - margin, behavior: 'instant' })
  target.focus({ preventScroll: true })
}

export function ResultSection({ id, children }: { id: ResultSectionId; children: ReactNode }) {
  return <div className="result-section" id={resultSectionAnchor(id)} data-result-section={id} tabIndex={-1}>{children}</div>
}

export function ResultsNavigation({ sections, annualAction }: { sections: ResultSectionId[]; annualAction?: () => void }) {
  const { t } = useTranslation()
  const nav = useRef<HTMLElement>(null)
  const [active, setActive] = useState<ResultSectionId>('overview')
  const signature = sections.join(',')
  useEffect(() => {
    const element = nav.current
    if (!element) return
    const scope = element.closest('#results')!
    let observer: IntersectionObserver | undefined
    const setup = () => {
      observer?.disconnect()
      const root = resultScrollport(element)
      const currentSections = signature.split(',') as ResultSectionId[]
      const targets = currentSections.map(id => scope.querySelector<HTMLElement>(`#${resultSectionAnchor(id)}`)).filter((node): node is HTMLElement => !!node)
      const visible = new Set<Element>()
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target)
          else visible.delete(entry.target)
        }
        // A tall section remains current until the next section enters the reading band.
        const horizontal = getComputedStyle(element).flexDirection !== 'column'
        // Scroll offsets round to pixels while section bounds can retain fractional font metrics.
        const top = (root?.getBoundingClientRect().top ?? (horizontal ? element.getBoundingClientRect().top : 0)) + (horizontal ? element.offsetHeight : 0) + 33
        const candidates = targets.filter(target => visible.has(target))
        const scrollElement = root ?? document.documentElement
        const atEnd = scrollElement.scrollTop > 0 && scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight <= 2
        const current = atEnd ? targets.at(-1) : candidates.filter(target => target.getBoundingClientRect().top <= top).at(-1) ?? candidates[0]
        if (current) setActive(current.dataset.resultSection as ResultSectionId)
      }, { root, rootMargin: '0px 0px -55% 0px', threshold: 0 })
      targets.forEach(target => observer!.observe(target))
    }
    setup()
    window.addEventListener('resize', setup)
    return () => { observer?.disconnect(); window.removeEventListener('resize', setup) }
  // The signature represents the gated section list, independent of array identity.
  }, [signature])
  useEffect(() => {
    const link = nav.current?.querySelector<HTMLElement>('[aria-current="true"]')
    // Scroll only the chip strip. scrollIntoView would move the results pane as well.
    if (link && nav.current && nav.current.scrollWidth > nav.current.clientWidth) {
      nav.current.scrollTo({ left: link.offsetLeft - nav.current.clientWidth / 2 + link.offsetWidth / 2, behavior: 'instant' })
    }
  }, [active])
  return <nav ref={nav} className="results-navigation" aria-label={t('ui.results.navigation')}>
    {sections.map(id => <a key={id} href={`#${resultSectionAnchor(id)}`} aria-current={active === id ? 'true' : undefined} onClick={event => {
      event.preventDefault()
      const target = document.getElementById(resultSectionAnchor(id))
      if (target) focusResultTarget(target)
      setActive(id)
    }}>{t(`ui.results.${id}`)}</a>)}
    {annualAction && <Button size="sm" className="results-nav-annual" onClick={annualAction}>{t('ui.results.annual')}</Button>}
  </nav>
}
