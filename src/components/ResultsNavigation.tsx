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
  const destination = useRef<{ id: ResultSectionId; root: HTMLElement | null; offset: number } | null>(null)
  const signature = sections.join(',')
  useEffect(() => {
    const element = nav.current
    if (!element) return
    const scope = element.closest('#results')!
    let dispose = () => {}
    const setup = () => {
      dispose()
      const root = resultScrollport(element)
      const currentSections = signature.split(',') as ResultSectionId[]
      const targets = currentSections.map(id => scope.querySelector<HTMLElement>(`#${resultSectionAnchor(id)}`)).filter((node): node is HTMLElement => !!node)
      let frame = 0
      let observer: IntersectionObserver | undefined
      let observedLine = -1
      let observedHeight = -1
      const scrollElement = root ?? document.documentElement
      const scrollTarget = root ?? window
      const sample = () => {
        frame = 0
        const rootTop = root?.getBoundingClientRect().top ?? 0
        const height = root?.clientHeight ?? window.innerHeight
        const horizontal = getComputedStyle(element).flexDirection !== 'column'
        const line = horizontal ? Math.max(rootTop, element.getBoundingClientRect().bottom) + 8 : rootTop + 24
        // Observe the same one-pixel reading line used to choose the current section.
        const inset = Math.max(0, Math.min(height - 1, line - rootTop))
        if (!observer || Math.abs(inset - observedLine) > 1 || height !== observedHeight) {
          observedLine = inset
          observedHeight = height
          observer?.disconnect()
          observer = new IntersectionObserver(schedule, { root, rootMargin: `-${inset}px 0px -${Math.max(0, height - inset - 1)}px 0px`, threshold: 0 })
          targets.forEach(target => observer!.observe(target))
        }
        const pinned = destination.current
        if (pinned && pinned.root === root && pinned.offset === scrollElement.scrollTop && currentSections.includes(pinned.id)) {
          setActive(pinned.id)
          return
        }
        destination.current = null
        const current = targets.filter(target => target.getBoundingClientRect().top <= line + 1).at(-1) ?? targets[0]
        if (current) setActive(current.dataset.resultSection as ResultSectionId)
      }
      function schedule() { if (!frame) frame = requestAnimationFrame(sample) }
      // Scroll sampling also handles section gaps and fast jumps that cross the reading line in one frame.
      scrollTarget.addEventListener('scroll', schedule, { passive: true })
      sample()
      dispose = () => { observer?.disconnect(); cancelAnimationFrame(frame); scrollTarget.removeEventListener('scroll', schedule) }
    }
    setup()
    window.addEventListener('resize', setup)
    return () => { dispose(); window.removeEventListener('resize', setup) }
  // The signature represents the gated section list, independent of array identity.
  }, [signature])
  useEffect(() => {
    const scope = nav.current?.closest<HTMLElement>('#results')
    if (!scope) return
    let frame = 0
    const reveal = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || !target.closest('.chart-legend') || !scope.closest('.guided-results') || !window.matchMedia('(max-width: 640px)').matches) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const top = Math.max(nav.current?.getBoundingClientRect().bottom ?? 0, document.querySelector('.app-bar')?.getBoundingClientRect().bottom ?? 0) + 8
        const bottom = (document.querySelector('.phone-result-tabs')?.getBoundingClientRect().top ?? window.innerHeight) - 8
        const bounds = target.getBoundingClientRect()
        if (bounds.top < top) window.scrollBy(0, bounds.top - top)
        else if (bounds.bottom > bottom) window.scrollBy(0, bounds.bottom - bottom)
      })
    }
    scope.addEventListener('focusin', reveal)
    return () => { cancelAnimationFrame(frame); scope.removeEventListener('focusin', reveal) }
  }, [])
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
      if (target) {
        focusResultTarget(target)
        const root = resultScrollport(target)
        destination.current = { id, root, offset: (root ?? document.documentElement).scrollTop }
      }
      setActive(id)
    }}>{t(`ui.results.${id}`)}</a>)}
    {annualAction && <Button size="sm" className="results-nav-annual" onClick={annualAction}>{t('ui.results.annual')}</Button>}
  </nav>
}
