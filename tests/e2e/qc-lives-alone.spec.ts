import { expect, test } from '@playwright/test'

/** BE-44: the Québec living-alone fact is asked in guided and editable in professional. */
test('a single Québec user records living alone in guided and sees it in professional', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, province: 'QC' }
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical: refreshCanonicalFromLegacy(null, inputs), entryMode: 'guided', guidedView: 'questionnaire', inputRevision: 0, resultRevision: null,
    } }))
  })
  await page.reload()
  await page.goto('/#/guided/family/family.livesAlone')
  await expect(page.getByTestId('guided-lives-alone')).toContainText('2,172')
  await page.getByTestId('guided-lives-alone-choice-yes').check()
  const fact = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.canonical.taxProfile.livesAlone)
  expect(fact).toEqual({ status: 'known', value: true })
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId('lives-alone')).toHaveValue('true')
})
