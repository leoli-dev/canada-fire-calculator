// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n'
import { ResultSection, ResultsNavigation } from '../ResultsNavigation'
import { ChartLegend, useChartSeries } from '../ChartLegend'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('observes the actual overflow pane, updates the current link, and preserves keyboard anchor focus', async () => {
  let receive: IntersectionObserverCallback = () => {}
  const observe = vi.fn(), disconnect = vi.fn(), options = vi.fn()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback, config: IntersectionObserverInit) { receive = callback; options(config) }
    observe = observe
    disconnect = disconnect
  })
  HTMLElement.prototype.scrollTo = vi.fn()
  let taxTop = 200
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return new DOMRect(0, this.id === 'results-tax' ? taxTop : 0, 100, 100) })
  const annual = vi.fn()
  const view = render(<section id="results" style={{ overflowY: 'auto' }}><ResultsNavigation sections={['overview', 'tax']} annualAction={annual} /><ResultSection id="overview">Conclusion</ResultSection><ResultSection id="tax">Tax details</ResultSection></section>)
  expect(options.mock.calls[0][0].root).toBe(document.getElementById('results'))
  expect(observe).toHaveBeenCalledTimes(2)
  const tax = screen.getByRole('link', { name: 'Tax' })
  expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('true')
  const target = document.getElementById('results-tax')!
  const entry: IntersectionObserverEntry = { target, isIntersecting: true, boundingClientRect: target.getBoundingClientRect(), intersectionRect: target.getBoundingClientRect(), rootBounds: null, intersectionRatio: 1, time: 0 }
  taxTop = 4
  act(() => receive([entry], {} as IntersectionObserver))
  await waitFor(() => expect(tax.getAttribute('aria-current')).toBe('true'))
  tax.focus()
  await userEvent.keyboard('{Enter}')
  expect(document.activeElement).toBe(document.getElementById('results-tax'))
  expect(HTMLElement.prototype.scrollTo).toHaveBeenCalledWith({ top: 4, behavior: 'instant' })
  await userEvent.click(screen.getByRole('button', { name: 'Annual financial details' }))
  expect(annual).toHaveBeenCalledOnce()
  view.unmount()
  expect(disconnect).toHaveBeenCalled()
})

it('uses the viewport for document-scrolling Guided results and only renders supplied gates', () => {
  const options = vi.fn()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(_callback: IntersectionObserverCallback, config: IntersectionObserverInit) { options(config) }
    observe() {}
    disconnect() {}
  })
  render(<section id="results"><ResultsNavigation sections={['overview', 'scenarios']} /><ResultSection id="overview">Conclusion</ResultSection><ResultSection id="scenarios">Compare</ResultSection></section>)
  expect(options.mock.calls[0][0].root).toBeNull()
  expect(screen.queryByRole('link', { name: 'Tax' })).toBeNull()
  expect(screen.getAllByRole('link')).toHaveLength(2)
})

it('toggles individual series with native button keyboard controls and retains their labels and colors', async () => {
  function Legend() {
    const state = useChartSeries()
    return <ChartLegend title="Balances" series={[{ key: 'rrsp', label: 'RRSP', color: 'blue' }, { key: 'tfsa', label: 'TFSA', color: 'green' }]} {...state} />
  }
  render(<Legend />)
  const rrsp = screen.getByRole('button', { name: 'RRSP' }), tfsa = screen.getByRole('button', { name: 'TFSA' })
  rrsp.focus()
  await userEvent.keyboard(' ')
  expect(rrsp.getAttribute('aria-pressed')).toBe('false')
  expect(tfsa.getAttribute('aria-pressed')).toBe('true')
  expect((rrsp.querySelector('span') as HTMLElement).style.getPropertyValue('--series-color')).toBe('blue')
  await userEvent.keyboard('{Enter}')
  expect(rrsp.getAttribute('aria-pressed')).toBe('true')
})
