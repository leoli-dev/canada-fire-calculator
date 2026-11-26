import { prepareProfessionalTarget } from './fixtures/professional'
import { expect, test, type Page } from '@playwright/test'

/** FE-37: gates lower the wording to an estimate; they never hide the verdict or the charts. */
async function seed(page: Page, options: { province: 'ON' | 'QC'; couple?: boolean }) {
  await page.goto('/')
  await page.evaluate(async ({ province, couple }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS, DEFAULT_PARTNER } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    // A plan that clearly fails: spending far above what the savings support.
    const inputs = { ...DEFAULT_INPUTS, province, retirementSpending: 160_000, partner: couple ? { ...DEFAULT_PARTNER } : null }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: 'professional', inputRevision: 0, resultRevision: null,
    } }))
  }, options)
  await page.reload()
}

test('a failing single Quebec plan gets the full results as disclosed estimates', async ({ page }) => {
  await seed(page, { province: 'QC' })
  // BE-43: one Quebec owner is no longer reduced to an estimate summary.
  const summary = page.locator('.summary')
  await expect((await prepareProfessionalTarget(summary.locator('.verdict')))).toContainText('Money runs out at age')
  await expect((await prepareProfessionalTarget(summary))).toHaveClass(/uncertain/)
  await expect((await prepareProfessionalTarget(summary))).toHaveClass(/bad/)
  await expect((await prepareProfessionalTarget(page.getByTestId('person-tax-limit')))).toContainText('simplified Quebec rules')
  await expect((await prepareProfessionalTarget(page.locator('.results-column .recharts-wrapper').first()))).toBeVisible()
  await expect((await prepareProfessionalTarget(page.locator('details:not(.professional-group)').filter({ hasText: 'Withdrawal-order comparison' })))).toHaveCount(1)
})

test('a couple with unconfirmed ownership sees an estimate verdict and the charts', async ({ page }) => {
  await seed(page, { province: 'ON', couple: true })
  await expect((await prepareProfessionalTarget(page.getByTestId('legacy-estimate')))).toBeVisible()
  await expect((await prepareProfessionalTarget(page.getByTestId('estimate-verdict')))).toContainText('runs out at age')
  await expect((await prepareProfessionalTarget(page.getByTestId('estimate-charts-note')))).toBeVisible()
  await expect((await prepareProfessionalTarget(page.locator('.results-column .recharts-wrapper').first()))).toBeVisible()
})

/** FE-44: a failure is prominent and comes with next steps. */
test('a failing plan offers next steps and shades the uncovered spending', async ({ page }) => {
  await seed(page, { province: 'ON' })
  const summary = page.locator('.summary')
  await expect((await prepareProfessionalTarget(summary))).toHaveClass(/bad/)
  const next = page.getByTestId('next-steps')
  await expect((await prepareProfessionalTarget(next))).toBeVisible()
  await (await prepareProfessionalTarget(page.getByTestId('next-step-sustainable'))).click()
  await expect((await prepareProfessionalTarget(page.getByTestId('next-step-sustainable-answer')))).toContainText('CA$')
  await expect((await prepareProfessionalTarget(page.locator('.results-column')))).toContainText('Not covered')
  await expect((await prepareProfessionalTarget(page.locator('.results-column')))).toContainText('Needed (spending plus tax)')
  // A single plan never sees the note about which partner dies first.
  await expect((await prepareProfessionalTarget(summary))).not.toContainText('which partner dies first')
  await (await prepareProfessionalTarget(next.getByRole('button', { name: 'See the earliest age this plan works' }))).click()
  await expect((await prepareProfessionalTarget(page.getByRole('tab', { name: 'When can I retire?' })))).toHaveAttribute('aria-selected', 'true')
})

test('a sustainable-spending answer is retired when the plan changes', async ({ page }) => {
  await seed(page, { province: 'ON' })
  await (await prepareProfessionalTarget(page.getByTestId('next-step-sustainable'))).click()
  const answer = page.getByTestId('next-step-sustainable-answer')
  await expect((await prepareProfessionalTarget(answer))).toContainText('CA$')
  const first = await (await prepareProfessionalTarget(answer)).innerText()
  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: /^TFSA$/ }).first().locator('input'))).fill('1000')
  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: /^TFSA$/ }).first().locator('input'))).press('Tab')
  await expect(answer).toHaveCount(0)
  // Asking again answers for the edited plan.
  await (await prepareProfessionalTarget(page.getByTestId('next-step-sustainable'))).click()
  await expect((await prepareProfessionalTarget(answer))).toBeVisible()
  expect(await (await prepareProfessionalTarget(answer)).innerText()).not.toBe(first)
})

test('the default CA$750,000 accumulation target keeps the existing tax uncertainty in its status', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs: { ...DEFAULT_INPUTS, fireTargetAssets: 750000 }, entryMode: 'professional', inputRevision: 0, resultRevision: null,
    } }))
  })
  await page.reload()
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: 'Will I hit my target?' }))).click()
  const card = page.locator('.summary')
  await expect((await prepareProfessionalTarget(card))).toHaveClass(/uncertain/)
  await expect((await prepareProfessionalTarget(card.locator('.conclusion-heading .ui-status')))).toHaveText('Needs checks')
  await expect((await prepareProfessionalTarget(card.locator('.verdict')))).toContainText('On track: the CA$750,000 target')
  await expect((await prepareProfessionalTarget(card.locator('.conclusion-metrics dd').first()))).toHaveText('CA$750,000')
  await expect((await prepareProfessionalTarget(page.getByTestId('person-tax-limit')))).toBeVisible()
})

for (const uncertainty of ['tax', 'locked'] as const) {
  for (const target of [1500000, 1e12]) {
    test(`uncertain ${uncertainty} target ${target} retains a bad Shortfall status when late or never reached`, async ({ page }) => {
      await page.goto('/')
      await page.evaluate(async ({ uncertainty, target }) => {
        localStorage.clear()
        const { DEFAULT_INPUTS } = await import('/src/store.ts')
        const inputs = { ...DEFAULT_INPUTS, fireAge: 40, fireTargetAssets: target,
          ...(uncertainty === 'locked' ? { lockedRetirement: { balance: 1000, employeeContribution: 0, employerContribution: 0, accessibleAge: 55, jurisdiction: 'ON', owner: 'self' } } : {}) }
        localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: { inputs, entryMode: 'professional', inputRevision: 0, resultRevision: null } }))
      }, { uncertainty, target })
      await page.reload()
      await (await prepareProfessionalTarget(page.getByRole('tab', { name: 'Will I hit my target?' }))).click()
      const card = page.locator('.summary')
      const chip = card.locator('.conclusion-heading .ui-status')
      await expect((await prepareProfessionalTarget(card))).toHaveClass(/uncertain bad/)
      await expect((await prepareProfessionalTarget(chip))).toHaveText('Shortfall')
      await expect((await prepareProfessionalTarget(chip))).toHaveClass(/ui-status-bad/)
      await expect((await prepareProfessionalTarget(chip))).not.toHaveClass(/ui-status-est/)
      await expect((await prepareProfessionalTarget(card.locator('.verdict')))).toHaveClass(/verdict-bad/)
      await expect((await prepareProfessionalTarget(card.locator('.verdict')))).toContainText(target === 1e12 ? 'never reached' : 'Short:')
      await expect((await prepareProfessionalTarget(page.getByTestId('person-tax-limit')))).toBeVisible()
      if (uncertainty === 'locked') await expect((await prepareProfessionalTarget(card))).toContainText('LIF limits and transfer rules have not been verified')
      const colors = await chip.evaluate(element => {
        const css = getComputedStyle(element), probe = document.createElement('span')
        probe.style.color = 'var(--critical)'; probe.style.backgroundColor = 'var(--critical-tint)'
        document.body.append(probe)
        const expected = getComputedStyle(probe)
        const value = { color: css.color, background: css.backgroundColor, expectedColor: expected.color, expectedBackground: expected.backgroundColor }
        probe.remove(); return value
      })
      expect(colors.color).toBe(colors.expectedColor)
      expect(colors.background).toBe(colors.expectedBackground)
      // The FIRE-number branch already gives a definite failure priority over tax uncertainty.
      if (uncertainty === 'tax' && target === 1500000) {
        await (await prepareProfessionalTarget(page.getByRole('tab', { name: "What's my FIRE number?" }))).click()
        await expect((await prepareProfessionalTarget(chip))).toHaveText('Shortfall')
        await expect((await prepareProfessionalTarget(chip))).toHaveClass(/ui-status-bad/)
        await expect((await prepareProfessionalTarget(page.getByTestId('person-tax-limit')))).toBeVisible()
      }
    })
  }
}
