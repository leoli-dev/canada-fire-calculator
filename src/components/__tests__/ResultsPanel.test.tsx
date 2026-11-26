// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n'
import { DEFAULT_INPUTS, useStore } from '../../store'
import { runProjection } from '../../engine'
import { ResultsPanel } from '../ResultsPanel'

const solvers = vi.hoisted(() => ({
  earliest: { status: 'solved', value: 52 },
  number: { status: 'solved', value: 900000, assumptions: [] },
  target: { status: 'supported', assetsAtFire: 650000, reachedAge: 55 as number | null },
}))
vi.mock('../../engine', async importOriginal => ({
  ...await importOriginal<typeof import('../../engine')>(),
  findEarliestFireAge: () => solvers.earliest,
  requiredFireAssets: () => solvers.number,
  targetReport: () => solvers.target,
}))
const inputs = { ...DEFAULT_INPUTS, fireTargetAssets: 750000 }
const result = runProjection(inputs)
beforeEach(() => { useStore.setState({ canonical: null }); solvers.earliest.status = 'solved'; solvers.number.status = 'solved'; solvers.target.status = 'supported'; solvers.target.reachedAge = 55 })
afterEach(cleanup)
const values = () => Array.from(document.querySelectorAll('.conclusion-metrics dd')).map(node => node.textContent)

it('keeps the verdict, three existing last-branch values and all closing-tax copy in a disclosure', async () => {
  render(<ResultsPanel inputs={inputs} result={{ ...result, terminalTaxStatus: 'unsupported' }} />)
  expect(values()).toHaveLength(3)
  expect(values()[0]).toBe(String(result.success ? inputs.lifeExpectancy : result.depletedAge))
  expect(values()[2]).toBe('Not computed')
  const disclosure = document.querySelector<HTMLDetailsElement>('.conclusion-estate')!
  expect(disclosure.open).toBe(false)
  await userEvent.click(screen.getByText('How the estate value is calculated'))
  expect(disclosure.open).toBe(true)
  expect(disclosure.textContent).toContain('adds remaining registered balances')
  expect(disclosure.textContent).toContain('not a complete final return')
})

it('retains tab names, panel linkage, one tab stop and wrapping arrow/Home/End behavior', async () => {
  render(<ResultsPanel inputs={inputs} result={result} />)
  const tabs = screen.getAllByRole('tab')
  expect(tabs.map(tab => tab.textContent)).toEqual(['Will my money last?', 'When can I retire?', "What's my FIRE number?", 'Will I hit my target?'])
  tabs[0].focus()
  for (const [key, selected] of [['{End}', 3], ['{ArrowRight}', 0], ['{ArrowLeft}', 3], ['{Home}', 0]] as const) {
    await userEvent.keyboard(key)
    expect(document.activeElement).toBe(tabs[selected])
    expect(tabs.filter(tab => tab.tabIndex === 0)).toEqual([tabs[selected]])
    expect(tabs[selected].getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[selected].id)
  }
})

it('uses each question’s own displayed values and never fills unavailable metrics from another branch', async () => {
  render(<ResultsPanel inputs={inputs} result={result} />)
  await userEvent.click(screen.getByRole('tab', { name: 'When can I retire?' }))
  expect(values()[0]).toBe('52')
  expect(values()[2]).toContain('50,000')
  await userEvent.click(screen.getByRole('tab', { name: "What's my FIRE number?" }))
  expect(values()).toEqual(['CA$900,000', 'CA$650,000', 'CA$250,000'])
  await userEvent.click(screen.getByRole('tab', { name: 'Will I hit my target?' }))
  expect(values()).toEqual(['CA$750,000', 'CA$650,000', '55'])
})

it('uses Not computed for unsupported quick estimates and unset targets', async () => {
  solvers.number.status = 'unsupported'
  render(<ResultsPanel inputs={{ ...inputs, fireTargetAssets: null }} result={result} />)
  await userEvent.click(screen.getByRole('tab', { name: "What's my FIRE number?" }))
  expect(values()).toEqual(['Not computed', 'Not computed', 'Not computed'])
  await userEvent.click(screen.getByRole('tab', { name: 'Will I hit my target?' }))
  expect(values()).toEqual(['Not computed', 'Not computed', 'Not computed'])
})

it.each(['legacyEstimate', 'taxEstimate', 'personTax'] as const)('preserves the %s gate and exposes only its existing final-net-worth metric', flag => {
  render(<ResultsPanel inputs={inputs} result={result} {...{ [flag]: true }} />)
  expect(screen.queryByRole('tablist')).toBeNull()
  expect(values()).toHaveLength(1)
  expect(document.querySelector('.verdict')?.textContent).toContain(result.success ? 'age' : 'runs out')
})

it('keeps needs-checks between verdict and metrics and preserves the warning items', () => {
  render(<ResultsPanel inputs={inputs} result={{ ...result, success: true, terminalTaxStatus: 'unsupported' }} taxWarning />)
  const checks = screen.getByTestId('needs-checks')
  expect(checks.closest('.ui-callout-warn')).not.toBeNull()
  expect(checks.textContent).toContain('tax')
  expect(checks.compareDocumentPosition(document.querySelector('.conclusion-metrics')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it.each([true, false])('keeps a reached accumulation target distinct from sustainability with tax uncertainty %s', async taxWarning => {
  solvers.target.reachedAge = 40
  render(<ResultsPanel inputs={inputs} result={result} taxWarning={taxWarning} />)
  await userEvent.click(screen.getByRole('tab', { name: 'Will I hit my target?' }))
  expect(document.querySelector('.conclusion-heading .ui-status')?.textContent).toBe(taxWarning ? 'Needs checks' : 'Target reached')
  expect(document.querySelector('.verdict')?.textContent).toContain('On track: the CA$750,000 target is first reached at age 40')
  expect(values()).toEqual(['CA$750,000', 'CA$650,000', '40'])
})

it('keeps an unsupported target labelled Needs checks without reporting computed metrics', async () => {
  solvers.target.status = 'unsupported'
  render(<ResultsPanel inputs={inputs} result={result} taxWarning />)
  await userEvent.click(screen.getByRole('tab', { name: 'Will I hit my target?' }))
  expect(document.querySelector('.conclusion-heading .ui-status')?.textContent).toBe('Needs checks')
  expect(values()).toEqual(['Not computed', 'Not computed', 'Not computed'])
})

it.each([
  { uncertainty: 'tax', reachedAge: 55 }, { uncertainty: 'tax', reachedAge: null },
  { uncertainty: 'locked', reachedAge: 55 }, { uncertainty: 'locked', reachedAge: null },
])('keeps definite target failure prominent with $uncertainty uncertainty and reached age $reachedAge', async ({ uncertainty, reachedAge }) => {
  solvers.target.reachedAge = reachedAge
  const targetInputs = uncertainty === 'locked' ? { ...inputs, lockedRetirement: { balance: 300000, employeeContribution: 0, employerContribution: 0, accessibleAge: 55, jurisdiction: 'ON' as const, owner: 'self' as const } } : inputs
  render(<ResultsPanel inputs={targetInputs} result={result} taxWarning={uncertainty === 'tax'} />)
  await userEvent.click(screen.getByRole('tab', { name: 'Will I hit my target?' }))
  const chip = document.querySelector('.conclusion-heading .ui-status')!
  expect(chip.textContent).toBe('Shortfall')
  expect(chip.classList.contains('ui-status-bad')).toBe(true)
  expect(chip.classList.contains('ui-status-est')).toBe(false)
  expect(document.querySelector('.summary')?.className).toContain('uncertain bad')
  expect(document.querySelector('.verdict')?.classList.contains('verdict-bad')).toBe(true)
  expect(document.querySelector('.verdict')?.textContent).toContain(reachedAge === null ? 'never reached' : 'Short:')
  expect(values()).toEqual(reachedAge === null ? ['CA$750,000', 'Not computed', 'Not computed'] : ['CA$750,000', 'CA$650,000', '55'])
  if (uncertainty === 'locked') expect(document.querySelector('.summary')?.textContent).toContain('LIF limits and transfer rules have not been verified')
})
