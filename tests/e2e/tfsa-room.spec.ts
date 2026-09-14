import { expect, test } from '@playwright/test'

/** BE-27 A: TFSA room belongs to the person, so the CRA room figure and the
 * withdrawal history that restores room are recorded in the shared tax panel.
 * Guided and professional mount that panel, so both must show the same priced
 * row, the same retained remainder, and the same unknown state. A TFSA-only
 * savings split keeps the planned contribution attributable to one person's
 * room instead of being sent to the non-registered account unallocated. */
async function seed(page: import('@playwright/test').Page, options: { guided?: boolean } = {}) {
  await page.goto('/')
  await page.evaluate(async ({ guided }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 40, fireAge: 60, lifeExpectancy: 90,
      annualSavings: 8000, retirementSpending: 40_000, inflation: 0,
      returns: { tfsa: 0, rrsp: 0, nonReg: 0 },
      savingsSplit: { tfsa: 1, rrsp: 0, nonReg: 0 },
      balances: { tfsa: 1000, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
      cppAnnualAt65: 0, oasAnnualAt65: 0, partner: null }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: guided ? 'guided' : 'professional', guidedView: guided ? 'results' : 'questionnaire',
      inputRevision: 0, resultRevision: guided ? 0 : null,
    } }))
  }, options)
  await page.reload()
}

const inViewport = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

/** The stored canonical plan, so a claim about persistence reads the record. */
const storedPlan = (page: import('@playwright/test').Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.canonical)

test('professional mode prices the stated room, clips the plan and retains the remainder', async ({ page }) => {
  await seed(page)
  const panel = page.getByTestId('tfsa-statement-self')
  await expect(panel).toBeVisible()
  // Unknown room is a visible state: it is never unlimited room and never zero.
  await expect(page.getByTestId('tfsa-room-unknown-self')).toBeVisible()
  await expect(page.getByTestId('tfsa-ledger-self')).toContainText('Not confirmed')
  // 5,000 of room against the plan's 8,000: 5,000 executes, 3,000 is retained.
  await page.getByTestId('tfsa-available-room-self').fill('5000')
  await page.getByTestId('tfsa-available-room-self').blur()
  await expect(page.getByTestId('tfsa-room-unknown-self')).toHaveCount(0)
  await expect(page.getByTestId('tfsa-ledger-self')).toContainText('5,000')
  await expect(page.getByTestId('tfsa-savings-share-self')).toContainText('8,000')
  await expect(page.getByTestId('tfsa-retained-self')).toContainText('3,000')
  await expect(page.getByTestId('tfsa-retained-self')).toContainText('non-registered')
  const person = (await storedPlan(page)).people.find((item: { role: string }) => item.role === 'self')
  expect(person.tfsaAvailableRoom).toEqual({ status: 'known', value: 5000 })
  // Reload keeps the recorded room and the priced row.
  await page.reload()
  await expect(page.getByTestId('tfsa-available-room-self')).toHaveValue('5000')
  await expect(page.getByTestId('tfsa-retained-self')).toContainText('3,000')
  // The same recorded fact prices identically in guided mode.
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/income/income.taxFacts')
  await expect(page.getByTestId('tfsa-available-room-self')).toHaveValue('5000')
  await expect(page.getByTestId('tfsa-ledger-self')).toContainText('5,000')
  await expect(page.getByTestId('tfsa-retained-self')).toContainText('3,000')
  expect(await inViewport(page)).toBe(true)
})

test('guided mode records the room and a withdrawal, and both survive a mode switch', async ({ page }) => {
  await seed(page, { guided: true })
  await page.goto('/#/guided/income/income.taxFacts')
  await expect(page.getByTestId('tfsa-statement-self')).toBeVisible()
  await page.getByTestId('tfsa-available-room-self').fill('5000')
  await page.getByTestId('tfsa-available-room-self').blur()
  await expect(page.getByTestId('tfsa-retained-self')).toContainText('3,000')
  // A withdrawal made this year does not restore room this year: the row says
  // when it will, so the rule is visible rather than implied.
  await page.getByTestId('tfsa-withdrawal-add-self').click()
  const baseYear = (await storedPlan(page)).baseYear
  const amount = page.locator('[data-testid^="tfsa-withdrawal-amount-"]')
  await expect(amount).toHaveCount(1)
  await amount.fill('10000')
  await amount.blur()
  await expect(page.getByTestId('tfsa-ledger-self')).toContainText('closing room 0 CAD')
  await expect(page.getByTestId('tfsa-restored-next-self')).toContainText('10,000')
  await expect(page.getByTestId('tfsa-restored-next-self')).toContainText(`not in ${baseYear}`)
  // Guided does not auto-run: recording facts leaves results stale.
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)).resultRevision).toBeNull()
  const saved = await storedPlan(page)
  const person = saved.people.find((item: { role: string }) => item.role === 'self')
  expect(person.tfsaAvailableRoom).toEqual({ status: 'known', value: 5000 })
  expect(saved.tfsaStatement[person.id].withdrawals).toHaveLength(1)
  expect(saved.tfsaStatement[person.id].withdrawals[0]).toMatchObject({ calendarYear: saved.baseYear, amount: 10000 })
  await page.reload()
  await expect(page.getByTestId('tfsa-available-room-self')).toHaveValue('5000')
  await expect(page.getByTestId('tfsa-restored-next-self')).toContainText('10,000')
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId('tfsa-available-room-self')).toHaveValue('5000')
  await expect(page.getByTestId('tfsa-restored-next-self')).toContainText('10,000')
  expect(await inViewport(page)).toBe(true)
})

test('a known zero room is a real zero, and an unknown is not treated as one', async ({ page }) => {
  await seed(page)
  await expect(page.getByTestId('tfsa-room-unknown-self')).toBeVisible()
  await page.getByTestId('tfsa-available-room-self').fill('0')
  await page.getByTestId('tfsa-available-room-self').blur()
  // Zero is priceable: nothing executes and the whole plan is retained.
  await expect(page.getByTestId('tfsa-room-unknown-self')).toHaveCount(0)
  await expect(page.getByTestId('tfsa-ledger-self')).toContainText('Opening room 0')
  await expect(page.getByTestId('tfsa-retained-self')).toContainText('8,000')
  // Clearing it returns an explicit unknown, not a zero.
  await page.getByTestId('tfsa-available-room-self').fill('')
  await page.getByTestId('tfsa-available-room-self').blur()
  await expect(page.getByTestId('tfsa-room-unknown-self')).toBeVisible()
  await expect(page.getByTestId('tfsa-ledger-self')).toContainText('Not confirmed')
  expect(await inViewport(page)).toBe(true)
})

test('the TFSA room block explains itself in EN, FR and ZH', async ({ page }) => {
  await seed(page)
  const panel = page.getByTestId('tfsa-statement-self')
  await expect(panel).toContainText('Available TFSA contribution room')
  await page.getByRole('button', { name: 'FR', exact: true }).click()
  await expect(panel).toContainText('Droits de cotisation CELI disponibles')
  await page.getByRole('button', { name: '中文' }).click()
  await expect(panel).toContainText('可用 TFSA 供款空间')
  expect(await inViewport(page)).toBe(true)
})
