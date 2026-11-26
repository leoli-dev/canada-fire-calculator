// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Button, Callout, ChoiceCard, Disclosure, Field, Segmented, Sheet, StatusChip } from '..'

afterEach(cleanup)
describe('shared controls', () => {
  it('keeps button content and name while loading, blocks duplicate actions, and forwards refs', async () => {
    const click = vi.fn(), ref = { current: null as HTMLButtonElement | null }
    const view = render(<Button ref={ref} loading onClick={click}>Calculate</Button>)
    const button = screen.getByRole('button', { name: 'Calculate' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(ref.current).toBe(button)
    await userEvent.click(button)
    expect(click).not.toHaveBeenCalled()
    view.rerender(<Button onClick={click}>Calculate</Button>)
    await userEvent.click(button)
    expect(click).toHaveBeenCalledOnce()
  })
  it('renders each button variant and disabled state', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger', 'link'] as const) {
      render(<Button variant={variant} disabled>{variant}</Button>)
      const button = screen.getByRole('button', { name: variant }) as HTMLButtonElement
      expect(button.classList.contains(`ui-button-${variant}`)).toBe(true)
      expect(button.disabled).toBe(true)
    }
  })
  it('exposes selected button state and preserves caller handlers', async () => {
    const click = vi.fn()
    render(<Segmented aria-label="Language"><Button className="active">EN</Button><Button onClick={click}>FR</Button></Segmented>)
    expect(screen.getByRole('button', { name: 'EN' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'FR' }).getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(screen.getByRole('button', { name: 'FR' }))
    expect(click).toHaveBeenCalledOnce()
  })
  it('supports roving tab focus, wrapping arrows, Home, End and disabled tabs', async () => {
    function Tabs() {
      const [value, setValue] = useState('First')
      return <Segmented mode="tab" aria-label="Question">{['First', 'Unavailable', 'Last'].map(name => <Button key={name} disabled={name === 'Unavailable'} aria-selected={value === name} onClick={() => setValue(name)}>{name}</Button>)}</Segmented>
    }
    render(<Tabs />)
    const first = screen.getByRole('tab', { name: 'First' }), last = screen.getByRole('tab', { name: 'Last' })
    first.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(last)
    expect(last.getAttribute('aria-selected')).toBe('true')
    expect(first.tabIndex).toBe(-1)
    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(first)
    await userEvent.keyboard('{End}')
    expect(document.activeElement).toBe(last)
    await userEvent.keyboard('{Home}')
    expect(document.activeElement).toBe(first)
  })
  it('retains field labels, validation descriptions, and native choice keyboard behavior', async () => {
    render(<><Field className="field">Amount<input aria-invalid="true" aria-describedby="error" /></Field><p id="error">Required</p><ChoiceCard><input type="checkbox" />Include pension</ChoiceCard></>)
    expect(screen.getByRole('textbox', { name: 'Amount' }).getAttribute('aria-describedby')).toBe('error')
    const checkbox = screen.getByRole('checkbox', { name: 'Include pension' }) as HTMLInputElement
    checkbox.focus()
    await userEvent.keyboard(' ')
    expect(checkbox.checked).toBe(true)
  })
  it('keeps status text and non-color indicators, callout content, and native disclosure state', async () => {
    render(<><StatusChip status="ok">Confirmed</StatusChip><StatusChip status="bad">Shortfall</StatusChip><Callout variant="warn">Check the source</Callout><Disclosure><summary>Assumptions</summary><p>Existing explanation</p></Disclosure></>)
    expect(screen.getByText('Confirmed').textContent).toBe('Confirmed')
    expect(screen.getByText('Shortfall').textContent).toBe('Shortfall')
    expect(screen.getByText('Confirmed').querySelector('.ui-status-icon')?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('Shortfall').querySelector('.ui-status-icon')?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('Check the source').classList.contains('ui-callout-warn')).toBe(true)
    const summary = screen.getByText('Assumptions')
    await userEvent.click(summary)
    expect((summary.parentElement as HTMLDetailsElement).open).toBe(true)
    await userEvent.click(summary)
    expect((summary.parentElement as HTMLDetailsElement).open).toBe(false)
  })
  it('traps sheet focus, closes with Escape or scrim, and restores the trigger and scrolling', async () => {
    function Example() {
      const [open, setOpen] = useState(false)
      return <><Button onClick={() => setOpen(true)}>Help</Button><Sheet open={open} onClose={() => setOpen(false)} title="Field source" closeLabel="Close"><Button>Last action</Button></Sheet></>
    }
    render(<Example />)
    const trigger = screen.getByRole('button', { name: 'Help' })
    await userEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Field source' }).getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last action' }))
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(document.body.style.overflow).toBe('')
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('dialog').parentElement!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
