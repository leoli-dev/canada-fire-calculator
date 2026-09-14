import { expect, test, type Page } from '@playwright/test'

/**
 * BE-36 A: the FHSA opening year, statement history and planned contribution are
 * recorded in the shared tax panel, so guided and professional price the same
 * room row. The account and the holder come from the plan; the annual and
 * lifetime limits come from the published rule pack.
 */

async function seed(page: Page, options: { guided?: boolean; couple?: boolean } = {}) {
  await page.goto('/')
  await page.evaluate(async ({ guided, couple }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 40, fireAge: 60, lifeExpectancy: 90,
      annualSavings: 40_000, retirementSpending: 40_000,
      savingsSplit: { tfsa: 0.3, rrsp: 0.5, nonReg: 0.2 },
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
      cppAnnualAt65: 0, oasAnnualAt65: 0,
      fhsa: { balance: 0, annualContribution: 0, openedYearsAgo: 0 },
      partner: couple ? { currentAge: 38, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 } : null }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: guided ? 'guided' : 'professional', guidedView: guided ? 'results' : 'questionnaire',
      inputRevision: 0, resultRevision: guided ? 0 : null,
    } }))
  }, options)
  await page.reload()
}

/**
 * The legacy form's FHSA amount is the plan a user already has, with the
 * statement confirmed. B2 needs a plan that exists before the panel is touched.
 */
async function seedLegacyPlan(page: Page, annualContribution: number, openedYear = 2026) {
  await page.goto('/')
  await page.evaluate(async ({ annualContribution, openedYear }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 40, fireAge: 60, lifeExpectancy: 90,
      annualSavings: 40_000, retirementSpending: 40_000,
      savingsSplit: { tfsa: 0.3, rrsp: 0.5, nonReg: 0.2 },
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
      cppAnnualAt65: 0, oasAnnualAt65: 0,
      fhsa: { balance: 0, annualContribution, openedYearsAgo: 0 }, partner: null }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    const account = canonical.accounts.find((item: { kind: string }) => item.kind === 'fhsa')
    account.openedYear = { status: 'known', value: openedYear }
    account.contributionRoom = { status: 'known', value: 0 }
    canonical.fhsaStatementHistory = { [account.id]: {
      cumulativePriorContributions: { status: 'known', value: 0 }, provenance: { origin: 'user', sourceYear: 2026 } } }
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: 'professional', guidedView: 'questionnaire', inputRevision: 0, resultRevision: null,
    } }))
  }, { annualContribution, openedYear })
  await page.reload()
}

/** The plan the panel shows, the rows it is recorded in, and the amount the
 * kernel's own allocation and line builder price from the same plan. */
const fhsaPlanState = (page: Page) => page.evaluate(async () => {
  const { useStore } = await import('/src/store.ts')
  const { resolveYearAllocation } = await import('/src/engine/funding.ts')
  const { fhsaPlannedYearRequest } = await import('/src/engine/fhsa.ts')
  const { plannedFhsaContribution } = await import('/src/engine/fhsaPlan.ts')
  const plan = useStore.getState().canonical!
  const account = plan.accounts.find((item: { kind: string }) => item.kind === 'fhsa')!
  const rows = plan.recurringContributions.filter((item: { accountId: string }) => item.accountId === account.id)
  const request = fhsaPlannedYearRequest({ plan, account, year: plan.baseYear })
  return {
    accountId: account.id,
    rowIds: rows.map((item: { id: string }) => item.id),
    mirror: useStore.getState().inputs.fhsa?.annualContribution,
    panelPlan: plannedFhsaContribution(plan, account.id),
    kernelAllocation: resolveYearAllocation(plan, plan.baseYear).fhsa,
    kernelLines: request.request.lines.reduce((total: number, line: { amount: number }) => total + line.amount, 0),
  }
})

const inViewport = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

/** Record one person's statement: opening year, prior contributions and the plan. */
async function recordStatement(page: Page, role: string, values: { openedYear?: string; prior?: string; opening?: string; planned?: string }) {
  const fields = [
    [`fhsa-opened-year-${role}`, values.openedYear],
    [`fhsa-prior-contributions-${role}`, values.prior],
    [`fhsa-opening-room-${role}`, values.opening],
    [`fhsa-planned-${role}`, values.planned],
  ] as const
  for (const [testId, value] of fields) {
    if (value === undefined) continue
    const input = page.getByTestId(testId)
    await input.fill(value)
    await input.blur()
  }
}

test('professional records an FHSA statement and shows the clipped, retained remainder', async ({ page }) => {
  await seed(page)
  const panel = page.getByTestId('fhsa-statement-self')
  await expect(panel).toBeVisible()
  // Unknown statement lines are a visible state, never zero and never full room.
  await expect(panel).toContainText('not confirmed')
  // 2026 opened; nothing contributed before it. The account has reached its
  // opening year, so its carry-in room is a real zero.
  await recordStatement(page, 'self', { openedYear: '2026', prior: '0', opening: '0' })
  // Nothing is planned yet, so this year adds the published 8,000 and leaves it.
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText('Opening room 0')
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText("this year's room 8,000")
  await expect(page.getByTestId('fhsa-lifetime-self')).toContainText('40,000 remaining')
  await expect(page.getByTestId('fhsa-retained-self')).toContainText('Retained and not contributed: 0')
  await expect(page.getByTestId('fhsa-room-unknown-self')).toHaveCount(0)
  // Now plan 22,000 by hand: 8,000 executes and 14,000 is retained, not deleted.
  await recordStatement(page, 'self', { planned: '22000' })
  await expect(page.getByTestId('fhsa-planned-self')).toHaveValue('22000')
  await expect(page.getByTestId('fhsa-retained-self')).toContainText('14,000')
  // The executed 8,000 is the only amount that consumes lifetime room.
  await expect(page.getByTestId('fhsa-lifetime-self')).toContainText('8,000 used')
  await expect(page.getByTestId('fhsa-lifetime-self')).toContainText('32,000 remaining')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  const person = saved.canonical.people.find((item: { role: string }) => item.role === 'self')
  const account = saved.canonical.accounts.find((item: { kind: string }) => item.kind === 'fhsa')
  expect(account.openedYear).toEqual({ status: 'known', value: 2026 })
  expect(saved.canonical.fhsaStatementHistory[account.id].cumulativePriorContributions).toEqual({ status: 'known', value: 0 })
  expect(saved.canonical.recurringContributions.find((item: { id: string }) => item.id === `be36:fhsa:${account.id}`))
    .toMatchObject({ accountId: account.id, contributorId: person.id, annualAmount: 22000, funding: 'fromSavings' })
  // Reload keeps the statement facts and the plan.
  await page.reload()
  await expect(page.getByTestId('fhsa-opened-year-self')).toHaveValue('2026')
  await expect(page.getByTestId('fhsa-prior-contributions-self')).toHaveValue('0')
  await expect(page.getByTestId('fhsa-planned-self')).toHaveValue('22000')
  await expect(page.getByTestId('fhsa-retained-self')).toContainText('14,000')
  expect(await inViewport(page)).toBe(true)
})

test('guided mode records the same FHSA facts and keeps explicit generate', async ({ page }) => {
  await seed(page, { guided: true })
  await page.goto('/#/guided/income/income.taxFacts')
  await expect(page.getByTestId('fhsa-statement-self')).toBeVisible()
  await recordStatement(page, 'self', { openedYear: '2026', prior: '0', opening: '0' })
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText('8,000')
  // Guided does not auto-run: the recorded plan changes and results stay stale.
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)).resultRevision).toBeNull()
  await page.reload()
  await expect(page.getByTestId('fhsa-opened-year-self')).toHaveValue('2026')
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText('8,000')
  // The same recorded facts show in professional mode.
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId('fhsa-opened-year-self')).toHaveValue('2026')
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText('8,000')
  expect(await inViewport(page)).toBe(true)
})

test('unknown history, a known zero and a lifetime-exhausted account stay distinguishable', async ({ page }) => {
  await seed(page)
  // No statement at all: the room is unknown and nothing is priced.
  await expect(page.getByTestId('fhsa-room-unknown-self')).toBeVisible()
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText('Not confirmed')
  // An older account with a real zero of prior contributions still has this
  // year's 8,000 of published room.
  await recordStatement(page, 'self', { openedYear: '2020', prior: '0', opening: '0' })
  await expect(page.getByTestId('fhsa-room-unknown-self')).toHaveCount(0)
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText("this year's room 8,000")
  // 36,000 contributed already leaves 4,000 for the whole lifetime, so a 6,000
  // plan applies 4,000 and keeps 2,000 back.
  await recordStatement(page, 'self', { prior: '36000', planned: '6000' })
  await expect(page.getByTestId('fhsa-lifetime-self')).toContainText('40,000 used')
  await expect(page.getByTestId('fhsa-lifetime-self')).toContainText('0 remaining')
  await expect(page.getByTestId('fhsa-retained-self')).toContainText('2,000')
  expect(await inViewport(page)).toBe(true)
})

test('two people with different FHSA facts get independent room rows', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 40, fireAge: 60, lifeExpectancy: 90,
      annualSavings: 40_000, retirementSpending: 40_000,
      savingsSplit: { tfsa: 0.3, rrsp: 0.5, nonReg: 0.2 },
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
      cppAnnualAt65: 0, oasAnnualAt65: 0, fhsa: null,
      partner: { currentAge: 38, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 } }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    const self = canonical.people.find((person: { role: string }) => person.role === 'self')
    const partner = canonical.people.find((person: { role: string }) => person.role === 'partner')
    const fhsa = (id: string, ownerId: string, openedYear: number, room: number, prior: number) => ({
      id, kind: 'fhsa', ownerId, balance: 0, realReturn: 0.043, volatility: null, annualFee: 0.002,
      acb: { status: 'unknown', reason: 'not applicable' },
      taxableOwnerShares: { status: 'known', shares: { [ownerId]: 1 } },
      contributionRoom: { status: 'known', value: room },
      openedYear: { status: 'known', value: openedYear },
      rrifFactorCategory: { status: 'unknown', reason: 'not applicable' },
      openedYearsAgoAtBaseYear: null, provenance: {},
    })
    canonical.accounts.push(fhsa('e2e:fhsa:self', self.id, 2026, 0, 0))
    canonical.accounts.push(fhsa('e2e:fhsa:partner', partner.id, 2020, 4000, 0))
    canonical.fhsaStatementHistory = {
      'e2e:fhsa:self': { cumulativePriorContributions: { status: 'known', value: 0 }, provenance: { origin: 'user', sourceYear: 2026 } },
      'e2e:fhsa:partner': { cumulativePriorContributions: { status: 'known', value: 0 }, provenance: { origin: 'user', sourceYear: 2026 } },
    }
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: 'professional', guidedView: 'questionnaire', inputRevision: 0, resultRevision: null,
    } }))
  })
  await page.reload()
  // Each person's own account carries their own room: you are in your first
  // year, your partner has 4,000 of prior unused room.
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText('Opening room 0')
  await expect(page.getByTestId('fhsa-ledger-partner')).toContainText('Opening room 4,000')
  await expect(page.getByTestId('fhsa-ledger-partner')).toContainText("this year's room 8,000")
  await expect(page.getByTestId('fhsa-lifetime-partner')).toContainText('40,000 remaining')
  // Changing one person's statement leaves the other's row untouched.
  await recordStatement(page, 'partner', { planned: '6000' })
  await expect(page.getByTestId('fhsa-ledger-partner')).toContainText('6,000')
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText('Opening room 0')
  await expect(page.getByTestId('fhsa-lifetime-self')).toContainText('40,000 remaining')
  expect(await inViewport(page)).toBe(true)
})

test('the FHSA room block explains itself in EN, FR and ZH', async ({ page }) => {
  await seed(page)
  const panel = page.getByTestId('fhsa-statement-self')
  await expect(page.getByTestId('person-tax-facts')).toContainText('FHSA contribution room')
  await expect(panel).toContainText('FHSA participation room belongs to the account holder')
  await page.getByRole('button', { name: 'FR', exact: true }).click()
  await expect(page.getByTestId('person-tax-facts')).toContainText('Droits de cotisation au CELIAPP')
  await expect(panel).toContainText('titulaire du compte')
  await page.getByRole('button', { name: '中文' }).click()
  await expect(page.getByTestId('person-tax-facts')).toContainText('FHSA 供款空间')
  await expect(panel).toContainText('账户持有人')
  expect(await inViewport(page)).toBe(true)
})

/**
 * B2: the panel and the kernel price one recorded plan. Before the fix the
 * panel showed a blank plan while the kernel priced the legacy row, typing a
 * value produced two rows and a doubled mirror, and an unrelated shared-field
 * edit dropped the recorded row.
 */
test('the panel and the kernel price the same default legacy plan', async ({ page }) => {
  await seedLegacyPlan(page, 8000)
  await expect(page.getByTestId('fhsa-planned-self')).toHaveValue('8000')
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText('contributions 8,000')
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText('closing room 0')
  await expect(page.getByTestId('fhsa-lifetime-self')).toContainText('8,000 used')
  const state = await fhsaPlanState(page)
  expect(state.rowIds).toEqual([`be36:fhsa:${state.accountId}`])
  expect(state.mirror).toBe(8000)
  expect(state.panelPlan).toBe(8000)
  expect(state.kernelAllocation).toBe(8000)
  expect(state.kernelLines).toBe(8000)
})

test('recording a planned amount replaces the plan instead of adding to it', async ({ page }) => {
  await seedLegacyPlan(page, 8000)
  const planned = page.getByTestId('fhsa-planned-self')
  await planned.fill('6000')
  await planned.blur()
  await expect(planned).toHaveValue('6000')
  const state = await fhsaPlanState(page)
  // One row, mirrored once, priced once: 8,000 + 6,000 must never appear.
  expect(state.rowIds).toEqual([`be36:fhsa:${state.accountId}`])
  expect(state.mirror).toBe(6000)
  expect(state.panelPlan).toBe(6000)
  expect(state.kernelAllocation).toBe(6000)
  expect(state.kernelLines).toBe(6000)
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText('contributions 6,000')
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText('closing room 2,000')
  await expect(page.getByTestId('fhsa-retained-self')).toContainText('0')
})

test('a recorded plan survives an unrelated shared-field edit and a reload', async ({ page }) => {
  await seedLegacyPlan(page, 8000)
  const planned = page.getByTestId('fhsa-planned-self')
  await planned.fill('6000')
  await planned.blur()
  await expect(planned).toHaveValue('6000')
  // The reviewer's exact reproduction: edit only annualSavings through the
  // app's own shared-field command.
  await page.evaluate(async () => {
    const { useStore } = await import('/src/store.ts')
    useStore.getState().editSharedField('annualSavings', '41000')
  })
  await expect(planned).toHaveValue('6000')
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText('contributions 6,000')
  const edited = await fhsaPlanState(page)
  expect(edited.rowIds).toEqual([`be36:fhsa:${edited.accountId}`])
  expect(edited.mirror).toBe(6000)
  expect(edited.kernelAllocation).toBe(6000)
  expect(edited.kernelLines).toBe(6000)
  // A reload must not drop the recorded row either.
  await page.reload()
  await expect(page.getByTestId('fhsa-planned-self')).toHaveValue('6000')
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText('contributions 6,000')
  const reloaded = await fhsaPlanState(page)
  expect(reloaded.rowIds).toEqual([`be36:fhsa:${reloaded.accountId}`])
  expect(reloaded.kernelAllocation).toBe(6000)
  expect(await inViewport(page)).toBe(true)
})
