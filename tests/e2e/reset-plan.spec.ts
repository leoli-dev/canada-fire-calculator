import { expect, test, type Page } from '@playwright/test'

/** FE-21: one confirmed reset in both modes; cancel changes nothing. */
async function seedWithScenario(page: Page) {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    localStorage.setItem('fire-inputs:pre-v11-backup', '{"old":true}')
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, annualSavings: 55_555, province: 'QC' }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, scenarioA: inputs, scenarioACanonical: canonical, entryMode: 'professional', displayMode: 'nominal',
      inputRevision: 7, resultRevision: null, questionAnswers: { 'spending.method': 'estimate' },
      worksheet: { wsHousing: 20_000 },
    } }))
  })
  await page.reload()
}
const stored = (page: Page) => page.evaluate(() => ({
  state: JSON.parse(localStorage.getItem('fire-inputs')!).state, backup: localStorage.getItem('fire-inputs:pre-v11-backup'),
}))

test('cancelling leaves the plan, Scenario A and storage untouched', async ({ page }) => {
  await seedWithScenario(page)
  const before = await stored(page)
  await page.getByTestId('reset-plan').click()
  await expect(page.getByRole('alertdialog')).toContainText('Scenario A')
  await expect(page.getByTestId('reset-cancel')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByTestId('reset-plan')).toBeFocused()
  expect(await stored(page)).toEqual(before)
})

test('confirming clears both plans and the backup, keeps preferences, and survives reload', async ({ page }) => {
  await seedWithScenario(page)
  await page.getByTestId('reset-plan').click()
  await page.getByTestId('reset-confirm').click()
  let { state, backup } = await stored(page)
  expect(state.inputs.annualSavings).toBe(40_000)
  expect(state.inputs.province).toBe('ON')
  expect(state.scenarioA).toBeNull()
  expect(state.scenarioACanonical).toBeNull()
  expect(state.questionAnswers).toEqual({})
  expect(state.worksheet.wsHousing).toBe(0)
  expect(state.inputRevision).toBeGreaterThan(7)
  expect(state.entryMode).toBe('professional')
  expect(state.displayMode).toBe('nominal')
  expect(backup).toBeNull()
  await page.reload()
  ;({ state } = await stored(page))
  expect(state.inputs.annualSavings).toBe(40_000)
  expect(state.scenarioA).toBeNull()
})

test('guided review offers the same reset', async ({ page }) => {
  await seedWithScenario(page)
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  await page.getByTestId('reset-plan').click()
  await page.getByTestId('reset-confirm').click()
  await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'family.people')
  expect((await stored(page)).state.scenarioA).toBeNull()
})
