import { expect, test } from '@playwright/test'

async function seedV10(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const original = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.version = 10
    delete stored.state.canonical
    delete stored.state.scenarioACanonical
    stored.state.inputs.partner = { currentAge: 33, cppStartAge: 65, cppAnnualAt65: 6000, oasStartAge: 65, oasAnnualAt65: 8000 }
    stored.state.inputs.balances = { tfsa: 120000, rrsp: 230000, nonReg: 340000 }
    stored.state.inputs.nonRegBook = 210000
    stored.state.scenarioA = { ...stored.state.inputs, balances: { tfsa: 1, rrsp: 2, nonReg: 3 } }
    localStorage.removeItem('fire-inputs:pre-v11-backup')
    const bytes = JSON.stringify(stored)
    localStorage.setItem('fire-inputs', bytes)
    return bytes
  })
  await page.reload()
  return original
}

test('v10 couple and Scenario A migrate once with shared mode gate and round trip', async ({ page }) => {
  const original = await seedV10(page)
  await expect(page.getByTestId('migration-gate')).toContainText('120,000 CAD unassigned')
  await expect(page.getByTestId('migration-gate')).toContainText('basis 210,000 CAD')
  const stored = await page.evaluate(() => ({ backup: localStorage.getItem('fire-inputs:pre-v11-backup'), plan: JSON.parse(localStorage.getItem('fire-inputs')!) }))
  expect(stored.backup).toBe(original)
  expect(stored.plan.version).toBe(11)
  expect(stored.plan.state.canonical.accounts.slice(0, 3).map((a: { ownerId: string | null }) => a.ownerId)).toEqual([null, null, null])
  expect(stored.plan.state.scenarioACanonical.accounts.slice(0, 3).map((a: { balance: number }) => a.balance)).toEqual([1, 2, 3])
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await expect(page.getByTestId('migration-gate')).toContainText('120,000 CAD unassigned')
  await page.reload()
  await expect(page.getByTestId('migration-gate')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('fire-inputs:pre-v11-backup'))).toBe(original)
})

test('future-version and corrupt bytes are not overwritten', async ({ page }) => {
  await page.goto('/')
  for (const value of ['{broken', JSON.stringify({ version: 999, state: { inputs: {} } })]) {
    await page.evaluate(value => localStorage.setItem('fire-inputs', value), value)
    await page.reload()
    await expect(page.getByRole('alert')).toBeVisible()
    await page.getByRole('button', { name: 'Professional', exact: true }).click()
    expect(await page.evaluate(() => localStorage.getItem('fire-inputs'))).toBe(value)
  }
})

test('backup write failure leaves v10 original bytes intact', async ({ page }) => {
  const original = await seedV10(page)
  await page.evaluate(original => {
    localStorage.setItem('fire-inputs', original)
    localStorage.removeItem('fire-inputs:pre-v11-backup')
  }, original)
  await page.addInitScript(() => {
    const originalSet = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'fire-inputs:pre-v11-backup') throw new Error('quota')
      return originalSet.call(this, key, value)
    }
  })
  await page.reload()
  await expect(page.getByRole('alert')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('fire-inputs'))).toBe(original)
})

test('primary commit failure preserves original bytes and the one-time backup', async ({ page }) => {
  const original = await seedV10(page)
  await page.evaluate(original => {
    localStorage.setItem('fire-inputs', original)
    localStorage.removeItem('fire-inputs:pre-v11-backup')
  }, original)
  await page.addInitScript(() => {
    const originalSet = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'fire-inputs') throw new Error('quota')
      return originalSet.call(this, key, value)
    }
  })
  await page.reload()
  expect(await page.evaluate(() => localStorage.getItem('fire-inputs'))).toBe(original)
  expect(await page.evaluate(() => localStorage.getItem('fire-inputs:pre-v11-backup'))).toBe(original)
})
