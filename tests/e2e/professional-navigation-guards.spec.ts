import { expect, test } from '@playwright/test'
import { chooseMode } from './fixtures/app-bar'
import { prepareProfessionalTarget, showProfessionalResults } from './fixtures/professional'

test('preparing an exact Housing action never explores unrelated panes, disclosures, workers or storage', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  const workers: string[] = []
  page.on('worker', worker => workers.push(worker.url()))
  await page.goto('/')
  await chooseMode(page, 'professional')
  const snapshot = () => page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage },
    nested: [...document.querySelectorAll('.professional-group details[open], .results-column details[open]')].map(element => element.outerHTML),
    selected: document.querySelector('.phone-result-tabs [aria-selected="true"]')?.getAttribute('aria-controls') }))
  const before = await snapshot()
  const workerCount = workers.length
  const target = page.getByRole('button', { name: '+ Principal residence', exact: true })
  await prepareProfessionalTarget(target, page.getByRole('button', { name: '+ Principal residence', exact: true, includeHidden: true }))
  await expect(target).toBeVisible()
  expect(await snapshot()).toEqual(before)
  expect(workers.slice(workerCount)).toEqual([])
  await expect(page.locator('.professional-group[open]')).toHaveCount(1)
  expect(await page.locator('.professional-group[open]').getAttribute('data-group')).toBe('housing')
  const afterHousing = await snapshot()
  await prepareProfessionalTarget(page.getByRole('button', { name: 'Missing input control', exact: true }), page.getByRole('button', { name: 'Missing input control', exact: true, includeHidden: true }))
  expect(await snapshot()).toEqual(afterHousing)
  expect(workers.slice(workerCount)).toEqual([])
})

test('negative precise Results guard rejects a legitimate precise tab while Inputs is active', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/')
  await chooseMode(page, 'professional')
  const visibleOnly = page.getByRole('tab', { name: 'When can I retire?' })
  const actualGuard = page.getByRole('tab', { name: 'When can I retire?', includeHidden: true })
  await expect(page.locator('#phone-inputs-tab')).toHaveAttribute('aria-selected', 'true')
  await expect(visibleOnly).toHaveCount(0)
  await expect(actualGuard).toHaveCount(1)
  const rejection = await expect(actualGuard).toHaveCount(0, { timeout: 100 }).then(() => null, error => error)
  expect(rejection, 'The exact negative migration guard must fail for an erroneously present hidden precise tab').not.toBeNull()
  const annualGuard = page.locator('#results-overview').getByRole('button', { name: 'Annual financial details', exact: true, includeHidden: true })
  await expect(annualGuard).toHaveCount(1)
  const annualRejection = await expect(annualGuard).toHaveCount(0, { timeout: 100 }).then(() => null, error => error)
  expect(annualRejection, 'The annual capability guard must also reject an existing hidden control').not.toBeNull()
  await showProfessionalResults(page)
  await expect(visibleOnly).toHaveCount(1)
  await expect(actualGuard).toHaveCount(1)
})
