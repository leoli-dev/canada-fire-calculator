// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n'
import { GuidedFlow } from '../GuidedFlow'
import { useStore } from '../../store'

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  window.location.hash = '#/guided/family/family.people'
  useStore.getState().setActivePage('family.people')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('opens the current category in one Sheet and returns keyboard focus on Escape', async () => {
  render(<GuidedFlow />)
  const trigger = screen.getByRole('button', { name: 'Contents' })
  trigger.focus()
  await userEvent.keyboard('{Enter}')
  const dialog = screen.getByRole('dialog', { name: 'Contents' })
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(dialog.querySelectorAll('details[open]')).toHaveLength(1)
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close directory' }))
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('closes Contents before navigation focuses the destination heading', async () => {
  render(<GuidedFlow />)
  await userEvent.click(screen.getByRole('button', { name: 'Contents' }))
  const dialog = screen.getByRole('dialog')
  const destination = dialog.querySelectorAll<HTMLButtonElement>('details[open] button')[1]
  await userEvent.click(destination)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(useStore.getState().activePageId).toBe('family.ages')
  expect(document.activeElement?.id).toBe('question-title')
})

it('returns focus on backdrop dismissal', async () => {
  render(<GuidedFlow />)
  const trigger = screen.getByRole('button', { name: 'Contents' })
  await userEvent.click(trigger)
  await userEvent.click(document.querySelector('.ui-sheet-backdrop')!)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})
