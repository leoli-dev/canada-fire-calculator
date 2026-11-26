// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n'
import { ProfessionalGroup, ProfessionalInputs } from '../ProfessionalInputs'
import { Field } from '../../ui'

beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const editor = () => render(<ProfessionalInputs>
  <ProfessionalGroup name="profile" title={'Profile'}><Field>Age<input defaultValue="35" /></Field></ProfessionalGroup>
  <ProfessionalGroup name="accounts" title={'Accounts'}><details><summary>Asset mix</summary><Field>Allocation<input defaultValue="50" /></Field></details></ProfessionalGroup>
</ProfessionalInputs>)

describe('Professional input groups', () => {
  it('searches field labels, expands nested disclosures and preserves uncommitted values', async () => {
    editor()
    const age = screen.getByLabelText('Age')
    await userEvent.clear(age)
    await userEvent.type(age, '4.')
    await userEvent.type(screen.getByRole('searchbox'), 'Allocation')
    const allocation = screen.getByLabelText('Allocation')
    expect(allocation.closest('details')?.open).toBe(true)
    expect(allocation.closest('.professional-group')?.hasAttribute('open')).toBe(true)
    expect(age.closest('.professional-group')?.hasAttribute('hidden')).toBe(true)
    await userEvent.clear(screen.getByRole('searchbox'))
    expect((age as HTMLInputElement).value).toBe('4.')
  })
  it('keeps one phone group open and Collapse all does not destroy editors', async () => {
    const view = editor()
    await userEvent.click(screen.getByText('Accounts', { selector: 'summary span' }))
    await waitFor(() => expect(view.container.querySelectorAll('.professional-group[open]').length).toBe(1))
    expect(screen.getByLabelText('Age').closest('details')?.open).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(view.container.querySelectorAll('.professional-group[open]').length).toBe(0)
    expect(view.container.querySelectorAll('input').length).toBe(3)
  })
  it('keeps native select semantics and displays the complete selected wording', () => {
    render(<ProfessionalInputs><Field>Strategy<select value="long" onChange={() => {}}><option value="long">A long strategy with every word available</option></select></Field></ProfessionalInputs>)
    expect(screen.getByRole('combobox', { name: 'Strategy' })).toBeTruthy()
    expect(document.querySelector('.selected-value')?.textContent).toBe('A long strategy with every word available')
  })
  it('exposes complete choices in the shared Sheet and invokes the native change handler once', async () => {
    const values: string[] = []
    render(<ProfessionalInputs><Field>Strategy<select value="a" onChange={event => values.push(event.target.value)}><option value="a">Current choice</option><option value="b">Every word of a much longer alternative remains readable</option></select></Field></ProfessionalInputs>)
    const trigger = screen.getByRole('button', { name: 'All choices' })
    await userEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Every word of a much longer alternative remains readable' }))
    expect(values).toEqual(['b'])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
