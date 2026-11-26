// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n'
import { AnnualSheetDialog } from '../AnnualSheetDialog'
import type { AnnualSheetModel } from '../../annualSheet'

const model: AnnualSheetModel = {
  scenarioId: 'test', revision: 1, title: 'Ledger', scope: 'Recorded scope', baseYear: 2030,
  years: [{ year: 2030, realFactor: 1 }, { year: 2031, realFactor: .5 }],
  rows: [{ id: 'cash', label: 'Cash', cells: {
    2030: { value: 0, unit: 'CAD', status: 'calculated', timing: 'closing' },
    2031: { value: 123.45, unit: 'CAD', status: 'estimated', timing: 'closing' },
  } }], jumps: [{ id: 'final', label: 'Final', year: 2031, kind: 'terminal' }],
}
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(callback, 0))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('defaults to Year, steps and jumps through the same ledger and opens precise Sheet details', async () => {
  render(<AnnualSheetDialog open model={model} moneyMode="real" onClose={vi.fn()} />)
  expect(screen.getByRole('button', { name: /^Year$/ }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.getByRole('button', { name: 'Inspect row: Cash, 2030' }).textContent).toContain('0')
  const initialRow = screen.getByRole('button', { name: 'Inspect row: Cash, 2030' })
  expect(document.getElementById(initialRow.getAttribute('aria-describedby')!)?.textContent).toBe('CA$0Calculated')
  expect((screen.getByRole('button', { name: 'Previous year' }) as HTMLButtonElement).disabled).toBe(true)
  await userEvent.click(screen.getByRole('button', { name: 'Next year' }))
  const row = screen.getByRole('button', { name: 'Inspect row: Cash, 2031' })
  expect(document.getElementById(row.getAttribute('aria-describedby')!)?.textContent).toBe('≈ CA$62Estimated')
  await userEvent.click(row)
  const details = screen.getByRole('complementary', { name: 'Cell details' })
  expect(within(details).getByRole('heading').textContent).toContain('61.73')
  expect(details.textContent).toContain('123.45')
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('complementary')).toBeNull()
  expect(document.activeElement).toBe(row)
  await userEvent.click(screen.getByRole('button', { name: 'Previous year' }))
  await userEvent.click(screen.getByRole('button', { name: 'Final (2031)' }))
  expect((screen.getByRole('combobox', { name: 'Jump to year' }) as HTMLSelectElement).value).toBe('2031')
  await userEvent.click(screen.getByRole('button', { name: /^Table$/ }))
  expect(screen.getByRole('table')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Inspect row: Cash, 2031' })).toHaveLength(1)
})

it('labels the scope disclosure and preserves its complete dialog description when expanded', async () => {
  render(<AnnualSheetDialog open model={model} moneyMode="nominal" onClose={vi.fn()} />)
  const dialog = screen.getByRole('dialog', { name: 'Ledger' })
  const description = document.getElementById(dialog.getAttribute('aria-describedby')!)!
  const original = description.textContent
  expect(original).toBe('Recorded scope · Deterministic projection · Nominal CAD')
  const summary = screen.getByText('Scope and limitations').closest('summary')!
  await userEvent.click(summary)
  expect(summary.parentElement!.hasAttribute('open')).toBe(true)
  expect(description.textContent).toBe(original)
})

it('resets the year and selected details on revision changes', async () => {
  const view = render(<AnnualSheetDialog open model={model} moneyMode="nominal" onClose={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Final (2031)' }))
  await userEvent.click(screen.getByRole('button', { name: 'Inspect row: Cash, 2031' }))
  view.rerender(<AnnualSheetDialog open model={{ ...model, revision: 2 }} moneyMode="nominal" onClose={vi.fn()} />)
  expect(screen.queryByRole('complementary')).toBeNull()
  expect(screen.getByRole('button', { name: 'Inspect row: Cash, 2030' })).toBeTruthy()
})
