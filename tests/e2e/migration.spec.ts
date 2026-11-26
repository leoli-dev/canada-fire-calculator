import { prepareProfessionalTarget } from './fixtures/professional'
import { chooseMode, chooseLanguage } from './fixtures/app-bar'
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function expectComparisonUnavailableInThreeLanguages(page: import('@playwright/test').Page) {
  for (const [language, label] of [
    ['EN', 'Comparison unavailable'],
    ['FR', 'Comparaison indisponible'],
    ['中文', '比较暂不可用'],
  ] as const) {
    await chooseLanguage(page, language)
    const rows = page.getByTestId('scenario-comparison').locator('.compare-table tbody tr')
    await expect((await prepareProfessionalTarget(rows))).toHaveCount(2)
    for (const row of await rows.all()) {
      await expect((await prepareProfessionalTarget(row.locator('td').nth(1)))).toHaveText(label)
      await expect((await prepareProfessionalTarget(row.locator('td').nth(2)))).toHaveText('—')
    }
  }
  await chooseLanguage(page, 'EN')
}

async function seedV10(page: import('@playwright/test').Page) {
  await page.goto('/')
  await chooseMode(page, 'professional')
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

test('v10 missing ACB remains unknown in current and Scenario A after hydration and refresh', async ({ page }) => {
  await page.goto('/')
  await chooseMode(page, 'professional')
  const original = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('fire-inputs')!)
    saved.version = 10
    delete saved.state.canonical
    delete saved.state.scenarioACanonical
    saved.state.inputs.balances = { tfsa: 0, rrsp: 0, nonReg: 500_000 }
    delete saved.state.inputs.nonRegBook
    saved.state.scenarioA = structuredClone(saved.state.inputs)
    localStorage.removeItem('fire-inputs:pre-v11-backup')
    const original = JSON.stringify(saved)
    localStorage.setItem('fire-inputs', original)
    return original
  })
  await page.reload()
  for (const mode of ['Professional', 'Guided'] as const) {
    await chooseMode(page, mode === 'Professional' ? 'professional' : 'guided')
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
    for (const plan of [state.canonical, state.scenarioACanonical]) {
      expect(plan.accounts.find((a: { kind: string }) => a.kind === 'nonReg').acb.status).toBe('unknown')
    }
    expect(state.answerMeta.nonRegBook.status).toBe('unknown')
    expect(state.scenarioAAnswerMeta.nonRegBook.status).toBe('unknown')
    expect(state.draftByField.nonRegBook).toBe('')
    expect(state.inputs.nonRegBook).toBe(0)
    expect(state.scenarioA.nonRegBook).toBe(0)
    if (mode === 'Professional') await expect((await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: 'Non-registered cost base (ACB)' }).locator('input')))).toHaveValue('')
    await page.reload()
  }
  const restored = await page.evaluate(async () => {
    const { useStore } = await import('/src/store.ts')
    useStore.getState().restoreScenarioA()
    const state = useStore.getState()
    return { canonical: state.canonical, draftByField: state.draftByField }
  })
  expect(restored.canonical.accounts.find((a: { kind: string }) => a.kind === 'nonReg').acb.status).toBe('unknown')
  expect(restored.draftByField.nonRegBook).toBe('')
  expect(await page.evaluate(() => localStorage.getItem('fire-inputs:pre-v11-backup'))).toBe(original)
})

test('single balance edited then combined with partner stays unassigned in both modes and after reload', async ({ page }) => {
  await page.goto('/')
  await chooseMode(page, 'professional')
  const tfsa = page.locator('label.field').filter({ hasText: /^TFSA$/ }).locator('input').first()
  await (await prepareProfessionalTarget(tfsa)).fill('120000')
  const scenario = page.locator('details:not(.professional-group)').filter({ hasText: 'Scenario comparison' })
  await (await prepareProfessionalTarget(scenario.locator('summary'))).press('Enter')
  await (await prepareProfessionalTarget(scenario.getByRole('button', { name: 'Save current as A' }))).click()
  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: 'Household' }).locator('select'))).selectOption('couple')
  await (await prepareProfessionalTarget(tfsa)).fill('220000')
  await expect((await prepareProfessionalTarget(page.getByTestId('migration-gate')))).toContainText('TFSA: 220,000 CAD unassigned')
  await expect(page.getByRole('tab', { name: 'When can I retire?' })).toHaveCount(0)
  await chooseMode(page, 'guided')
  await expect((await prepareProfessionalTarget(page.getByTestId('migration-gate')))).toContainText('TFSA: 220,000 CAD unassigned')
  await page.reload()
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(state.canonical.people).toHaveLength(2)
  expect(state.canonical.accounts.find((a: { kind: string }) => a.kind === 'tfsa')).toMatchObject({ balance: 220000, ownerId: null, taxableOwnerShares: { status: 'unknown' } })
  expect(state.canonical.migration.ownershipNeedsConfirmation).toBe(true)
  expect(state.scenarioACanonical.people).toHaveLength(1)
  expect(state.scenarioACanonical.accounts.find((a: { kind: string }) => a.kind === 'tfsa')).toMatchObject({ balance: 120000, ownerId: state.scenarioACanonical.people[0].id })
  await chooseMode(page, 'professional')
  const currentScenario = page.locator('details:not(.professional-group)').filter({ hasText: 'Scenario comparison' })
  await (await prepareProfessionalTarget(currentScenario.locator('summary'))).press('Enter')
  await expect((await prepareProfessionalTarget(currentScenario))).toContainText('Household estimate')
  await (await prepareProfessionalTarget(currentScenario.getByRole('button', { name: 'Restore A as current inputs' }))).click()
  await expect(page.getByTestId('migration-gate')).toHaveCount(0)
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(restored.canonical.people).toHaveLength(1)
  expect(restored.canonical.accounts.find((a: { kind: string }) => a.kind === 'tfsa').ownerId).toBe(restored.canonical.people[0].id)
})

test('v10 couple and Scenario A migrate once with shared mode gate and round trip', async ({ page }) => {
  const original = await seedV10(page)
  await expect((await prepareProfessionalTarget(page.getByTestId('migration-gate')))).toContainText('120,000 CAD unassigned')
  await expect((await prepareProfessionalTarget(page.getByTestId('migration-gate')))).toContainText('basis 210,000 CAD')
  const stored = await page.evaluate(() => ({ backup: localStorage.getItem('fire-inputs:pre-v11-backup'), plan: JSON.parse(localStorage.getItem('fire-inputs')!) }))
  expect(stored.backup).toBe(original)
  expect(stored.plan.version).toBe(11)
  expect(stored.plan.state.canonical.accounts.slice(0, 3).map((a: { ownerId: string | null }) => a.ownerId)).toEqual([null, null, null])
  expect(stored.plan.state.scenarioACanonical.accounts.slice(0, 3).map((a: { balance: number }) => a.balance)).toEqual([1, 2, 3])
  await chooseMode(page, 'guided')
  await expect((await prepareProfessionalTarget(page.getByTestId('migration-gate')))).toContainText('120,000 CAD unassigned')
  await page.reload()
  await expect((await prepareProfessionalTarget(page.getByTestId('migration-gate')))).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('fire-inputs:pre-v11-backup'))).toBe(original)
})

test('Scenario A ownership gate stays separate from a singly owned current plan across modes and refresh', async ({ page }) => {
  await page.goto('/')
  await chooseMode(page, 'professional')
  const original = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.version = 10
    delete stored.state.canonical
    delete stored.state.scenarioACanonical
    stored.state.scenarioA = structuredClone(stored.state.inputs)
    stored.state.scenarioA.partner = { currentAge: 33, cppStartAge: 65, cppAnnualAt65: 6000, oasStartAge: 65, oasAnnualAt65: 8000 }
    stored.state.scenarioA.balances.tfsa = 220000
    localStorage.removeItem('fire-inputs:pre-v11-backup')
    const bytes = JSON.stringify(stored)
    localStorage.setItem('fire-inputs', bytes)
    return bytes
  })
  await page.reload()
  const gate = page.getByTestId('migration-gate')
  await expect((await prepareProfessionalTarget(gate.getByTestId('migration-current')))).toContainText('Current')
  await expect((await prepareProfessionalTarget(gate.getByTestId('migration-current')))).not.toContainText('220,000')
  await expect((await prepareProfessionalTarget(gate.getByTestId('migration-scenario-a')))).toContainText('TFSA: 220,000 CAD unassigned')
  const comparison = page.locator('details:not(.professional-group)').filter({ hasText: 'Scenario comparison' })
  await (await prepareProfessionalTarget(comparison.locator('summary'))).press('Enter')
  await expect((await prepareProfessionalTarget(comparison))).toContainText('Precise Scenario A comparison is unavailable')
  await expect((await prepareProfessionalTarget(comparison.getByRole('row', { name: /Scenario A/ })))).toContainText('—')
  await expect((await prepareProfessionalTarget(comparison.getByRole('row', { name: /Current/ })))).toContainText('—')
  await chooseMode(page, 'guided')
  await expect((await prepareProfessionalTarget(gate.getByTestId('migration-scenario-a')))).toContainText('220,000 CAD unassigned')
  await page.reload()
  await expect((await prepareProfessionalTarget(gate.getByTestId('migration-scenario-a')))).toContainText('220,000 CAD unassigned')
  const state = await page.evaluate(() => ({ stored: JSON.parse(localStorage.getItem('fire-inputs')!), backup: localStorage.getItem('fire-inputs:pre-v11-backup') }))
  expect(state.backup).toBe(original)
  expect(state.stored.state.canonical.accounts.find((account: { kind: string }) => account.kind === 'tfsa').ownerId).not.toBeNull()
  expect(state.stored.state.scenarioACanonical.accounts.find((account: { kind: string }) => account.kind === 'tfsa').ownerId).toBeNull()
})

test('single-person v10 age and savings uncertainty limits exact current advice in both modes', async ({ page }) => {
  await page.goto('/')
  await chooseMode(page, 'professional')
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.version = 10
    delete stored.state.canonical
    delete stored.state.scenarioACanonical
    stored.state.inputs.partner = null
    stored.state.scenarioA = null
    localStorage.setItem('fire-inputs', JSON.stringify(stored))
  })
  await page.reload()
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(state.canonical.migration).toMatchObject({ ownershipNeedsConfirmation: false, ageBasisNeedsConfirmation: true, savingsBasisNeedsConfirmation: true })
  await expect((await prepareProfessionalTarget(page.getByTestId('migration-gate').getByTestId('migration-current')))).toContainText('estimates')
  await expect((await prepareProfessionalTarget(page.getByTestId('legacy-estimate')))).toBeVisible()
  await expect((await prepareProfessionalTarget(page.getByTestId('legacy-estimate')))).not.toContainText('ownership is unconfirmed')
  await expect(page.getByRole('tab', { name: 'When can I retire?' })).toHaveCount(0)
  await (await prepareProfessionalTarget(page.getByLabel('Annual after-tax savings'))).fill('42000')
  await expect((await prepareProfessionalTarget(page.getByTestId('legacy-estimate')))).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.canonical.migration.sourcePersistVersion)).toBe(10)
  await chooseMode(page, 'guided')
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.state.guidedView = 'results'
    stored.state.resultRevision = stored.state.inputRevision
    localStorage.setItem('fire-inputs', JSON.stringify(stored))
  })
  await page.reload()
  await expect((await prepareProfessionalTarget(page.getByTestId('migration-gate').getByTestId('migration-current')))).toContainText('estimates')
  await expect((await prepareProfessionalTarget(page.getByTestId('legacy-estimate')))).toBeVisible()
  await expect(page.getByRole('tab', { name: 'When can I retire?' })).toHaveCount(0)
})

test('age/savings-only legacy comparison uses neutral outcome labels in three languages', async ({ page }) => {
  await page.goto('/')
  await chooseMode(page, 'professional')
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.version = 10
    delete stored.state.canonical
    delete stored.state.scenarioACanonical
    stored.state.scenarioA = structuredClone(stored.state.inputs)
    localStorage.setItem('fire-inputs', JSON.stringify(stored))
  })
  await page.reload()
  const gate = page.getByTestId('migration-gate')
  await expect((await prepareProfessionalTarget(gate.getByTestId('migration-current')))).toContainText('estimates')
  await expect((await prepareProfessionalTarget(gate.getByTestId('migration-scenario-a')))).toContainText('estimates')
  const card = page.locator('details:not(.professional-group)').filter({ hasText: 'Scenario comparison' })
  await (await prepareProfessionalTarget(card.locator('summary'))).press('Enter')
  await expectComparisonUnavailableInThreeLanguages(page)
})

test('fresh Scenario A saves canonical snapshots; a missing saved snapshot stays gated through restore', async ({ page }) => {
  await page.goto('/')
  await chooseMode(page, 'professional')
  const card = page.locator('details:not(.professional-group)').filter({ hasText: 'Scenario comparison' })
  await (await prepareProfessionalTarget(card.locator('summary'))).press('Enter')
  await (await prepareProfessionalTarget(card.getByRole('button', { name: 'Save current as A' }))).click()
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(before.canonical.migration.sourcePersistVersion).toBe(11)
  expect(before.scenarioACanonical).toEqual(before.canonical)
  expect(before.scenarioACanonical.budget).toMatchObject({ debtIncluded: { status: 'unknown' }, taxBenefitIncluded: { status: 'unknown' } })
  await expect((await prepareProfessionalTarget(card))).not.toContainText('Precise Scenario A comparison is unavailable')
  await expect((await prepareProfessionalTarget(card.getByRole('row', { name: /Scenario A/ })))).toContainText('CA$')
  await chooseMode(page, 'guided')
  await expect(page.getByTestId('migration-gate')).toHaveCount(0)
  await chooseMode(page, 'professional')
  await (await prepareProfessionalTarget(card.locator('summary'))).press('Enter')
  await (await prepareProfessionalTarget(card.getByRole('button', { name: 'Restore A as current inputs' }))).click()
  await expect((await prepareProfessionalTarget(page.getByRole('button', { name: 'Run 1,000 simulations' })))).toBeVisible()
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.state.scenarioACanonical = null
    localStorage.setItem('fire-inputs', JSON.stringify(stored))
  })
  await page.reload()
  await expect((await prepareProfessionalTarget(page.getByTestId('migration-gate').getByTestId('migration-scenario-a')))).toContainText('cannot be verified')
  await expect((await prepareProfessionalTarget(card))).toContainText('Precise Scenario A comparison is unavailable')
  await (await prepareProfessionalTarget(card.locator('summary'))).press('Enter')
  await expectComparisonUnavailableInThreeLanguages(page)
  await chooseMode(page, 'guided')
  await expect((await prepareProfessionalTarget(page.getByTestId('migration-gate').getByTestId('migration-scenario-a')))).toContainText('cannot be verified')
  await chooseMode(page, 'professional')
  await (await prepareProfessionalTarget(card.locator('summary'))).press('Enter')
  await (await prepareProfessionalTarget(card.getByRole('button', { name: 'Restore A as current inputs' }))).click()
  if ((await card.getAttribute('open')) === null) await (await prepareProfessionalTarget(card.locator('summary'))).press('Enter')
  await expect((await prepareProfessionalTarget(card.getByRole('row', { name: /Scenario A/ })))).toContainText('—')
})

test('future-version and corrupt bytes are not overwritten', async ({ page }) => {
  await page.goto('/')
  for (const value of ['{broken', JSON.stringify({ version: 999, state: { inputs: {} } })]) {
    await page.evaluate(value => localStorage.setItem('fire-inputs', value), value)
    await page.reload()
    await expect((await prepareProfessionalTarget(page.getByRole('alert')))).toBeVisible()
    await chooseMode(page, 'professional')
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
  await expect((await prepareProfessionalTarget(page.getByRole('alert')))).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Download original saved plan' }))).click()
  const download = await downloadPromise
  expect(readFileSync((await download.path())!, 'utf8')).toBe(malformed)
  await chooseMode(page, 'professional')
  expect(await page.evaluate(() => localStorage.getItem('fire-inputs'))).toBe(malformed)
})

test('structurally shallow v11 canonical or Scenario A canonical cannot hydrate or overwrite', async ({ page }) => {
  await page.goto('/')
  await chooseMode(page, 'professional')
  for (const target of ['canonical', 'scenarioACanonical'] as const) {
    const original = await page.evaluate(target => {
      const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
      if (target === 'scenarioACanonical') {
        stored.state.scenarioA = structuredClone(stored.state.inputs)
        stored.state.canonical ??= null
      }
      stored.state[target] = { schemaVersion: 2 }
      const bytes = JSON.stringify(stored)
      localStorage.setItem('fire-inputs', bytes)
      return bytes
    }, target)
    await page.reload()
    await expect((await prepareProfessionalTarget(page.getByRole('alert')))).toBeVisible()
    const downloadPromise = page.waitForEvent('download')
    await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Download original saved plan' }))).click()
    expect(readFileSync((await (await downloadPromise).path())!, 'utf8')).toBe(original)
    expect(await page.evaluate(() => localStorage.getItem('fire-inputs'))).toBe(original)
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await chooseMode(page, 'professional')
  }
})

test('unassigned couple has no precise quick answer or Monte Carlo in either mode', async ({ page }) => {
  await seedV10(page)
  await expect((await prepareProfessionalTarget(page.getByTestId('migration-gate')))).toBeVisible()
  await expect(page.getByRole('tab', { name: 'When can I retire?' })).toHaveCount(0)
  await expect(page.getByText('Monte Carlo simulation', { exact: true })).toHaveCount(0)
  await chooseMode(page, 'guided')
  await expect((await prepareProfessionalTarget(page.getByTestId('migration-gate')))).toBeVisible()
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
  await expect((await prepareProfessionalTarget(rentals))).toHaveCount(2)
  await expect(page.locator('#inputs > [data-testid="migration-gate"]')).toBeVisible()
  const editorBounds = await page.locator('#inputs').boundingBox()
  expect(editorBounds!.height).toBeGreaterThan(page.viewportSize()!.height / 2)
  await (await prepareProfessionalTarget(rentals.first().getByRole('button', { name: 'Remove' }))).click()
  await chooseMode(page, 'guided')
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
  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: 'Account owner' }).locator('select'))).selectOption('partner')
  await chooseMode(page, 'guided')
  await expect((await prepareProfessionalTarget(page.getByTestId('migration-gate')))).toContainText('Locked retirement account: 85,000 CAD partner')
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(state.canonical.accounts.find((a: { kind: string }) => a.kind === 'lira').ownerId).toBe(state.canonical.people[1].id)
})

test('professional couple to single keeps partner rental but makes its ownership unknown in both modes', async ({ page }) => {
  await seedV10(page)
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.version = 10
    stored.state.inputs.investmentProperties = [{ value: 900000, acb: 600000, appreciation: .03, sellAtAge: 75, mortgage: { balance: 300000, annualPayment: 22000, yearsRemaining: 18 } }]
    delete stored.state.canonical
    delete stored.state.scenarioACanonical
    localStorage.setItem('fire-inputs', JSON.stringify(stored))
  })
  await page.reload()
  const before = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    const plan = stored.state.canonical
    const rental = plan.properties.find((p: { kind: string }) => p.kind === 'investment')
    rental.taxableOwnerShares = { status: 'known', shares: { [plan.people[1].id]: 1 } }
    localStorage.setItem('fire-inputs', JSON.stringify(stored))
    return { propertyId: rental.id, mortgageId: rental.mortgageDebtId }
  })
  await page.reload()
  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: 'Household' }).locator('select'))).selectOption('single')
  await expect((await prepareProfessionalTarget(page.getByTestId('migration-gate')))).toBeVisible()
  await chooseMode(page, 'guided')
  await page.reload()
  await expect((await prepareProfessionalTarget(page.getByTestId('migration-gate')))).toBeVisible()
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(after.canonical.people).toHaveLength(1)
  expect(after.canonical.properties.find((p: { id: string }) => p.id === before.propertyId)).toMatchObject({
    value: 900000, acb: { status: 'known', value: 600000 }, mortgageDebtId: before.mortgageId, taxableOwnerShares: { status: 'unknown' },
  })
  expect(after.canonical.debts.find((d: { id: string }) => d.id === before.mortgageId)?.principal).toBe(300000)
})

test('professional FHSA and LIRA toggles delete nonzero canonical assets through reload', async ({ page }) => {
  await seedV10(page)
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.version = 10
    stored.state.inputs.partner = null
    stored.state.inputs.fhsa = { balance: 28000, annualContribution: 8000, openedYearsAgo: 3 }
    stored.state.inputs.lockedRetirement = { balance: 85000, employeeContribution: 0, employerContribution: 0, accessibleAge: 55, jurisdiction: 'ON', owner: 'self' }
    delete stored.state.canonical
    delete stored.state.scenarioACanonical
    localStorage.setItem('fire-inputs', JSON.stringify(stored))
  })
  await page.reload()
  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: 'Use a locked DC pension' }).locator('input'))).uncheck()
  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: 'Use an FHSA' }).locator('input'))).uncheck()
  await chooseMode(page, 'guided')
  await page.reload()
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(state.inputs.fhsa).toBeNull()
  expect(state.inputs.lockedRetirement).toBeNull()
  expect(state.canonical.accounts.filter((a: { kind: string }) => a.kind === 'fhsa' || a.kind === 'lira')).toEqual([])
  expect(state.canonical.accounts.reduce((sum: number, a: { balance: number }) => sum + a.balance, 0)).toBe(690000)
})

test('professional Couple to Single to Couple remains readable after reload', async ({ page }) => {
  await seedV10(page)
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.version = 10
    stored.state.inputs.lockedRetirement = { balance: 85000, employeeContribution: 4000, employerContribution: 6000, accessibleAge: 55, jurisdiction: 'ON', owner: 'partner' }
    delete stored.state.canonical
    delete stored.state.scenarioACanonical
    localStorage.setItem('fire-inputs', JSON.stringify(stored))
  })
  await page.reload()
  const household = page.locator('label.field').filter({ hasText: 'Household' }).locator('select')
  await (await prepareProfessionalTarget(household)).selectOption('single')
  await (await prepareProfessionalTarget(household)).selectOption('couple')
  await page.reload()
  await expect((await prepareProfessionalTarget(page.locator('.input-form')))).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  const canonical = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.canonical)
  expect(canonical.people).toHaveLength(2)
  expect(canonical.orphanedPeople ?? []).toEqual([])
  expect(new Set(canonical.people.map((p: { id: string }) => p.id)).size).toBe(2)
  expect(canonical.accounts.find((a: { kind: string }) => a.kind === 'lira').ownerId).toBe(canonical.people[1].id)
})

test('null legacy returns in v10 or v11 recover without a blank document or overwritten bytes', async ({ page }) => {
  for (const version of [10, 11]) {
    await seedV10(page)
    const original = await page.evaluate(version => {
      const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
      stored.version = version
      stored.state.inputs.returns = null
      if (version === 10) { delete stored.state.canonical; delete stored.state.scenarioACanonical }
      const bytes = JSON.stringify(stored)
      localStorage.setItem('fire-inputs', bytes)
      return bytes
    }, version)
    await page.reload()
    await expect((await prepareProfessionalTarget(page.getByRole('alert')))).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('fire-inputs'))).toBe(original)
    const downloadPromise = page.waitForEvent('download')
    await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Download original saved plan' }))).click()
    expect(readFileSync((await (await downloadPromise).path())!, 'utf8')).toBe(original)
    await page.evaluate(() => localStorage.clear())
  }
})

test('v11 Scenario A malformed returns cannot hydrate or overwrite the save', async ({ page }) => {
  await seedV10(page)
  const original = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.state.scenarioA.returns = null
    const bytes = JSON.stringify(stored)
    localStorage.setItem('fire-inputs', bytes)
    return bytes
  })
  await page.reload()
  await expect((await prepareProfessionalTarget(page.getByRole('alert')))).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('fire-inputs'))).toBe(original)
})

test('early v11 canonical snapshots load and carry new cash-flow facts through an edit', async ({ page }) => {
  await seedV10(page)
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.state.inputs.lockedRetirement = { balance: 85000, employeeContribution: 4000, employerContribution: 6000, accessibleAge: 55, jurisdiction: 'ON', owner: 'partner' }
    stored.state.canonical = null
    localStorage.setItem('fire-inputs', JSON.stringify(stored))
  })
  await page.reload()
  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: 'Annual after-tax savings' }).locator('input'))).fill('41000')
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    for (const key of ['savingsAllocation', 'recurringContributions', 'projectionAssumptions']) delete stored.state.canonical[key]
    for (const account of stored.state.canonical.accounts) delete account.openedYearsAgoAtBaseYear
    for (const person of stored.state.canonical.people) delete person.cppWork
    for (const property of stored.state.canonical.properties) { delete property.plannedMortgage; delete property.annualHoldingCostChange }
    localStorage.setItem('fire-inputs', JSON.stringify(stored))
  })
  await page.reload()
  await expect((await prepareProfessionalTarget(page.locator('.input-form')))).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: 'Annual after-tax savings' }).locator('input'))).fill('42000')
  const canonical = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.canonical)
  expect(canonical.recurringContributions.map((c: { annualAmount: number }) => c.annualAmount)).toEqual([4000, 6000])
  expect(canonical.accounts.find((a: { kind: string }) => a.kind === 'lira').ownerId).toBe(canonical.people[1].id)
})

test('v10 shallow embedded canonical cannot replace the validated migrated plan', async ({ page }) => {
  await seedV10(page)
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.version = 10
    stored.state.canonical = { schemaVersion: 2 }
    delete stored.state.scenarioACanonical
    localStorage.setItem('fire-inputs', JSON.stringify(stored))
  })
  await page.reload()
  await expect((await prepareProfessionalTarget(page.locator('.input-form')))).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!))
  expect(stored.version).toBe(11)
  expect(stored.state.canonical.accounts[0].balance).toBe(120000)
})

test('single current and unassigned couple Scenario A cannot show an uncaveated outcome', async ({ page }) => {
  await seedV10(page)
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.version = 10
    stored.state.inputs.partner = null
    delete stored.state.canonical
    delete stored.state.scenarioACanonical
    localStorage.setItem('fire-inputs', JSON.stringify(stored))
  })
  await page.reload()
  const card = page.locator('details:not(.professional-group)').filter({ hasText: 'Scenario comparison' })
  await (await prepareProfessionalTarget(card.locator('summary'))).press('Enter')
  await expect((await prepareProfessionalTarget(card))).toContainText('Household estimate')
  await expect((await prepareProfessionalTarget(card.getByRole('cell', { name: 'Scenario A' })))).toBeVisible()
  await expect((await prepareProfessionalTarget(card.locator('.compare-table')))).not.toContainText('Lasts')
  await expect((await prepareProfessionalTarget(card.locator('.compare-table')))).not.toContainText('CA$')
  await chooseMode(page, 'guided')
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.state.guidedView = 'results'
    stored.state.resultRevision = stored.state.inputRevision
    localStorage.setItem('fire-inputs', JSON.stringify(stored))
  })
  await page.reload()
  await expect((await prepareProfessionalTarget(card.locator('summary')))).toBeVisible()
  await (await prepareProfessionalTarget(card.locator('summary'))).press('Enter')
  await expect((await prepareProfessionalTarget(card))).toContainText('Household estimate')
  await expect((await prepareProfessionalTarget(card.locator('.compare-table')))).not.toContainText('Lasts')
  await expect((await prepareProfessionalTarget(card.locator('.compare-table')))).not.toContainText('CA$')
})

test('professional TFSA mix preset synchronizes canonical and legacy projection after reload', async ({ page }) => {
  await seedV10(page)
  const mix = page.locator('details:not(.professional-group)').filter({ hasText: 'Asset mix per account' })
  await (await prepareProfessionalTarget(mix.locator('summary'))).press('Enter')
  await (await prepareProfessionalTarget(mix.locator('label.field').filter({ hasText: 'TFSA' }).locator('select'))).selectOption('gic')
  await page.reload()
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(state.inputs.returns.tfsa).toBe(.008)
  expect(state.canonical.accounts.find((a: { kind: string }) => a.kind === 'tfsa').realReturn).toBe(.008)
  expect(state.canonical.legacyProjection.returns.tfsa).toBe(.008)
})

test('guided mix preset synchronizes every account and legacy projection after reload', async ({ page }) => {
  await seedV10(page)
  await chooseMode(page, 'guided')
  await page.goto('/#/guided/preferences/invest.mix')
  await (await prepareProfessionalTarget(page.getByRole('radio', { name: /GIC/ }))).check()
  await page.reload()
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  for (const kind of ['tfsa', 'rrsp', 'nonReg']) {
    expect(state.inputs.returns[kind]).toBe(.008)
    expect(state.canonical.accounts.find((a: { kind: string }) => a.kind === kind).realReturn).toBe(.008)
    expect(state.canonical.legacyProjection.returns[kind]).toBe(.008)
  }
})

test('invalid v10 rental sale age stays read-only on first load, before any v11 write', async ({ page }) => {
  await seedV10(page)
  const original = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.version = 10
    stored.state.inputs.investmentProperties = [{ value: 900000, acb: 600000, appreciation: .03, sellAtAge: 'bad', mortgage: { balance: 300000, annualPayment: 22000, yearsRemaining: 18 } }]
    delete stored.state.canonical
    delete stored.state.scenarioACanonical
    const bytes = JSON.stringify(stored)
    localStorage.setItem('fire-inputs', bytes)
    return bytes
  })
  await page.reload()
  await expect((await prepareProfessionalTarget(page.getByRole('alert')))).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('fire-inputs'))).toBe(original)
  const downloadPromise = page.waitForEvent('download')
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Download original saved plan' }))).click()
  expect(readFileSync((await (await downloadPromise).path())!, 'utf8')).toBe(original)
})

test('invalid v10 Scenario A sale age also blocks backup and upgraded commit', async ({ page }) => {
  await seedV10(page)
  const original = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('fire-inputs')!)
    stored.version = 10
    stored.state.scenarioA.investmentProperties = [{ value: 900000, acb: 600000, appreciation: .03, sellAtAge: 'bad', mortgage: { balance: 300000, annualPayment: 22000, yearsRemaining: 18 } }]
    delete stored.state.canonical
    delete stored.state.scenarioACanonical
    localStorage.removeItem('fire-inputs:pre-v11-backup')
    const bytes = JSON.stringify(stored)
    localStorage.setItem('fire-inputs', bytes)
    return bytes
  })
  await page.reload()
  await expect((await prepareProfessionalTarget(page.getByRole('alert')))).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('fire-inputs'))).toBe(original)
  expect(await page.evaluate(() => localStorage.getItem('fire-inputs:pre-v11-backup'))).toBeNull()
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
  await expect((await prepareProfessionalTarget(page.getByRole('alert')))).toBeVisible()
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
