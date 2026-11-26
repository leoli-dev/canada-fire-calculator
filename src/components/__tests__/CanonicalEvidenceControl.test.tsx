// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import '../../i18n'
import { CanonicalEvidenceControl } from '../CanonicalEvidenceControl'

afterEach(cleanup)
it('adds only a visible review Optional marker while retaining the exact canonical accessible name and opt-in copy', () => {
  const view = render(<CanonicalEvidenceControl showOptional />)
  const summary = view.container.querySelector('summary')!
  expect(summary.getAttribute('aria-label')).toBe('Canonical annual ledger')
  const marker = summary.querySelector('.canonical-optional')!
  expect(marker.textContent).toBe('Optional')
  expect(marker.getAttribute('aria-hidden')).toBe('true')
  expect(view.container.querySelector('details')!.open).toBe(false)
  expect(view.container.textContent).toContain('The existing planning estimate remains selected until you record these answers.')
  view.rerender(<CanonicalEvidenceControl />)
  expect(view.container.querySelector('.canonical-optional')).toBeNull()
  expect(summary.textContent).toBe('Canonical annual ledger')
  expect(summary.hasAttribute('aria-label')).toBe(false)
})
