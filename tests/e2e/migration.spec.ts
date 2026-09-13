import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

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

test('malformed Scenario A cannot make a valid v10 primary plan writable', async ({ page }) => {
  const original = await seedV10(page)
  const malformed = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.version = 10
    delete stored.state.canonical
    delete stored.state.scenarioACanonical
    stored.state.scenarioA.balances.tfsa = null
    const bytes = JSON.stringify(stored)
    localStorage.setItem('fire-inputs', bytes)
    return bytes
  })
  expect(malformed).not.toBe(original)
  await page.reload()
  await expect(page.getByRole('alert')).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download original saved plan' }).click()
  const download = await downloadPromise
  expect(readFileSync((await download.path())!, 'utf8')).toBe(malformed)
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  expect(await page.evaluate(() => localStorage.getItem('fire-inputs'))).toBe(malformed)
})

test('unassigned couple has no precise quick answer or Monte Carlo in either mode', async ({ page }) => {
  await seedV10(page)
  await expect(page.getByTestId('migration-gate')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'When can I retire?' })).toHaveCount(0)
  await expect(page.getByText('Monte Carlo simulation', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await expect(page.getByTestId('migration-gate')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'When can I retire?' })).toHaveCount(0)
})

test('rental deletion keeps B identity, tax owner and linked mortgage through mode switch and reload', async ({ page }) => {
  await seedV10(page)
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    const rentals = [
      { value: 400000, acb: 250000, appreciation: .01, sellAtAge: 70, mortgage: { balance: 100000, annualPayment: 10000, yearsRemaining: 12 } },
      { value: 900000, acb: 600000, appreciation: .03, sellAtAge: 75, mortgage: { balance: 300000, annualPayment: 22000, yearsRemaining: 18 } },
    ]
    stored.version = 10
    stored.state.inputs.investmentProperties = rentals
    stored.state.scenarioA.investmentProperties = rentals
    delete stored.state.canonical
    delete stored.state.scenarioACanonical
    localStorage.setItem('fire-inputs', JSON.stringify(stored))
  })
  await page.reload()
  const before = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('fire-inputs')!)
    const people = saved.state.canonical.people
    const rentals = saved.state.canonical.properties.filter((p: { kind: string }) => p.kind === 'investment')
    rentals[0].taxableOwnerShares = { status: 'known', shares: { [people[0].id]: 1 } }
    rentals[1].taxableOwnerShares = { status: 'known', shares: { [people[1].id]: 1 } }
    localStorage.setItem('fire-inputs', JSON.stringify(saved))
    return { bId: rentals[1].id, partnerId: people[1].id }
  })
  await page.reload()
  const rentals = page.locator('.input-form .property-card').filter({ hasText: 'Investment property' })
  await expect(rentals).toHaveCount(2)
  await rentals.first().getByRole('button', { name: 'Remove' }).click()
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.reload()
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(after.canonical.properties.filter((p: { kind: string }) => p.kind === 'investment')).toMatchObject([
    { id: before.bId, value: 900000, acb: { status: 'known', value: 600000 }, taxableOwnerShares: { status: 'known', shares: { [before.partnerId]: 1 } } },
  ])
  expect(after.canonical.debts.filter((d: { propertyId: string }) => d.propertyId === before.bId)).toMatchObject([{ principal: 300000 }])
  expect(after.scenarioACanonical.properties.filter((p: { kind: string }) => p.kind === 'investment')).toHaveLength(2)
})

test('professional locked owner edit updates the same canonical owner seen after guided switch', async ({ page }) => {
  await seedV10(page)
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.version = 10
    stored.state.inputs.lockedRetirement = { balance: 85000, employeeContribution: 0, employerContribution: 0, accessibleAge: 55, jurisdiction: 'ON', owner: 'self' }
    delete stored.state.canonical
    delete stored.state.scenarioACanonical
    localStorage.setItem('fire-inputs', JSON.stringify(stored))
  })
  await page.reload()
  await page.locator('label.field').filter({ hasText: 'Account owner' }).locator('select').selectOption('partner')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await expect(page.getByTestId('migration-gate')).toContainText('lira: 85,000 CAD partner')
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(state.canonical.accounts.find((a: { kind: string }) => a.kind === 'lira').ownerId).toBe(state.canonical.people[1].id)
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
