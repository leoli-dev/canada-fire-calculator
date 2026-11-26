// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n'
import { AppBar } from '../AppBar'
import { useStore } from '../../store'

afterEach(cleanup)
describe('AppBar', () => {
  it('only presents display basis controls with results and updates the existing store', async () => {
    const view = render(<AppBar showResults={false} />)
    expect(screen.queryByRole('group', { name: 'Amount display' })).toBeNull()
    view.rerender(<AppBar showResults />)
    const display = screen.getByRole('group', { name: 'Amount display' })
    await userEvent.click(within(display).getByRole('button', { name: 'Nominal' }))
    expect(useStore.getState().displayMode).toBe('nominal')
    await userEvent.click(within(display).getByRole('button', { name: 'Real' }))
    expect(useStore.getState().displayMode).toBe('real')
  })
  it('opens the menu by keyboard, traps focus, closes on Escape and restores its trigger', async () => {
    render(<AppBar showResults={false} />)
    const trigger = screen.getByRole('button', { name: 'Menu' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    const dialog = screen.getByRole('dialog', { name: 'Menu' })
    expect(within(dialog).getByText('Privacy settings')).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: /GitHub/ })).toBeTruthy()
    const close = within(dialog).getByRole('button', { name: 'Close' })
    expect(document.activeElement).toBe(close)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
  it('selects an entry mode through the menu without introducing separate state', async () => {
    render(<AppBar showResults={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Professional' }))
    expect(useStore.getState().entryMode).toBe('professional')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
