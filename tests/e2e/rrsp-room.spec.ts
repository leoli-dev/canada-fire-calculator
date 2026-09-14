import { expect, test } from '@playwright/test'

/** BE-12 A: the CRA statement facts and the recomputed RRSP room row are
 * entered in the shared tax panel, so guided and professional show the same
 * numbers. A single self-owned RRSP account keeps the planned contribution
 * attributable to the person whose room pays for it. */
async function seed(page: import('@playwright/test').Page, options: { guided?: boolean } = {}) {
  await page.goto('/')
  await page.evaluate(async ({ guided }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 40, fireAge: 60, lifeExpectancy: 90,
      annualSavings: 40_000, retirementSpending: 40_000,
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
      cppAnnualAt65: 0, oasAnnualAt65: 0, partner: null }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: guided ? 'guided' : 'professional', guidedView: guided ? 'results' : 'questionnaire',
      inputRevision: 0, resultRevision: guided ? 0 : null,
    } }))
  }, options)
  await page.reload()
}

async function enterStatement(page: import('@playwright/test').Page, values: { limit?: string; unused?: string; room?: string; planned?: string }) {
  for (const [testId, value] of [['rrsp-deduction-limit-self', values.limit], ['rrsp-available-room-self', values.room],
    ['rrsp-unused-undeducted-self', values.unused], ['rrsp-planned-self', values.planned]] as const) {
    if (value === undefined) continue
    await page.getByTestId(testId).fill(value)
    await page.getByTestId(testId).blur()
  }
}

const inViewport = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

test('professional mode prices a stated 20k/5k statement and retains the clipped 13k of the default split', async ({ page }) => {
  await seed(page)
  const panel = page.getByTestId('rrsp-statement-self')
  await expect(panel).toBeVisible()
  // Unknown room is a visible state, never zero and never unlimited.
  await expect(page.getByTestId('rrsp-room-unknown-self')).toBeVisible()
  await enterStatement(page, { limit: '20000', unused: '5000', planned: '16000' })
  // Available room is the statement's own arithmetic: 20,000 - 5,000 = 15,000.
  await expect(page.getByTestId('rrsp-ledger-self')).toContainText('15,000')
  // The default savings split {tfsa .3, rrsp .5, nonReg .2} of the remaining
  // 24,000 sends another 12,000 to the RRSP, so the plan contributes 28,000
  // against 15,000 of room and 13,000 is retained. The panel must show the
  // kernel's figure, not a partial 1,000 from the recorded row alone.
  await expect(page.getByTestId('rrsp-retained-self')).toContainText('13,000')
  await expect(page.getByTestId('rrsp-savings-share-self')).toContainText('12,000')
  await expect(page.getByTestId('rrsp-room-unknown-self')).toHaveCount(0)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  const person = saved.canonical.people.find((item: { role: string }) => item.role === 'self')
  expect(person.rrspDeductionLimit).toEqual({ status: 'known', value: 20000 })
  expect(person.rrspUnusedUndeducted).toEqual({ status: 'known', value: 5000 })
  expect(person.rrspAvailableRoom.status).toBe('unknown')
  expect(saved.canonical.contributions).toHaveLength(1)
  expect(saved.canonical.contributions[0]).toMatchObject({ calendarYear: saved.canonical.baseYear, amount: 16000, contributorId: person.id, deductionYear: null })
  // Reload keeps the statement facts.
  await page.reload()
  await expect(page.getByTestId('rrsp-deduction-limit-self')).toHaveValue('20000')
  await expect(page.getByTestId('rrsp-planned-self')).toHaveValue('16000')
  await expect(page.getByTestId('rrsp-retained-self')).toContainText('13,000')
  // The same recorded facts show in guided mode; guided keeps explicit generate.
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/income/income.taxFacts')
  await expect(page.getByTestId('rrsp-deduction-limit-self')).toHaveValue('20000')
  await expect(page.getByTestId('rrsp-planned-self')).toHaveValue('16000')
  await expect(page.getByTestId('rrsp-retained-self')).toContainText('13,000')
  const guidedState = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(guidedState.resultRevision).toBeNull()
  expect(await inViewport(page)).toBe(true)
})

test('guided mode records the statement and keeps it through reload and a mode switch', async ({ page }) => {
  await seed(page, { guided: true })
  await page.goto('/#/guided/income/income.taxFacts')
  await expect(page.getByTestId('rrsp-statement-self')).toBeVisible()
  await enterStatement(page, { room: '15000', planned: '16000' })
  await expect(page.getByTestId('rrsp-ledger-self')).toContainText('15,000')
  await expect(page.getByTestId('rrsp-retained-self')).toContainText('13,000')
  // Guided does not auto-run: the recorded plan changes, results stay stale.
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)).resultRevision).toBeNull()
  await page.reload()
  await expect(page.getByTestId('rrsp-available-room-self')).toHaveValue('15000')
  await expect(page.getByTestId('rrsp-planned-self')).toHaveValue('16000')
  await expect(page.getByTestId('rrsp-retained-self')).toContainText('13,000')
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId('rrsp-available-room-self')).toHaveValue('15000')
  await expect(page.getByTestId('rrsp-ledger-self')).toContainText('15,000')
  await expect(page.getByTestId('rrsp-retained-self')).toContainText('13,000')
  expect(await inViewport(page)).toBe(true)
})

test('unknown, zero and a contradictory statement stay distinguishable', async ({ page }) => {
  await seed(page)
  await expect(page.getByTestId('rrsp-room-unknown-self')).toBeVisible()
  await expect(page.getByTestId('rrsp-ledger-self')).toContainText('Not confirmed')
  // A real zero room is priced: planned money is retained, room is not "unknown".
  await enterStatement(page, { room: '0', planned: '5000' })
  await expect(page.getByTestId('rrsp-room-unknown-self')).toHaveCount(0)
  await expect(page.getByTestId('rrsp-ledger-self')).toContainText('0')
  // 5,000 recorded leaves 35,000 to split, so the default RRSP share is 17,500
  // and none of the 22,500 planned can execute against zero room.
  await expect(page.getByTestId('rrsp-savings-share-self')).toContainText('17,500')
  await expect(page.getByTestId('rrsp-retained-self')).toContainText('22,500')
  // Two statement lines that disagree are refused instead of guessing.
  await enterStatement(page, { limit: '20000', unused: '5000', room: '12000' })
  await expect(page.getByTestId('rrsp-mismatch-self')).toBeVisible()
  await expect(page.getByTestId('rrsp-room-unknown-self')).toBeVisible()
  await expect(page.getByTestId('rrsp-retained-self')).toContainText('22,500')
  expect(await inViewport(page)).toBe(true)
})

test('an over-contributed statement keeps a real zero room and surfaces the excess', async ({ page }) => {
  await seed(page)
  // All three lines come from one CRA statement: deduction limit 20,000,
  // unused undeducted 25,000, available room 0. The statement's own arithmetic
  // floors at zero, so the 0 line agrees and the 5,000 excess is an
  // over-contribution, not a contradictory statement.
  await enterStatement(page, { limit: '20000', unused: '25000', room: '0' })
  await expect(page.getByTestId('rrsp-mismatch-self')).toHaveCount(0)
  await expect(page.getByTestId('rrsp-room-unknown-self')).toHaveCount(0)
  await expect(page.getByTestId('rrsp-over-contribution-self')).toBeVisible()
  await expect(page.getByTestId('rrsp-over-contribution-self')).toContainText('5,000')
  await expect(page.getByTestId('rrsp-ledger-self')).toContainText('Opening room 0')
  // The same statement with the available-room line left blank gives the same
  // answer: a known zero, not an unknown.
  await enterStatement(page, { room: '' })
  await expect(page.getByTestId('rrsp-mismatch-self')).toHaveCount(0)
  await expect(page.getByTestId('rrsp-room-unknown-self')).toHaveCount(0)
  await expect(page.getByTestId('rrsp-over-contribution-self')).toContainText('5,000')
  await expect(page.getByTestId('rrsp-ledger-self')).toContainText('Opening room 0')
  expect(await inViewport(page)).toBe(true)
})

test('a later deduction year is stored separately from the contribution year', async ({ page }) => {
  await seed(page)
  const baseYear = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.canonical.baseYear)
  await enterStatement(page, { room: '15000', planned: '4000' })
  await expect(page.getByTestId('rrsp-statement-self')).toContainText(`is deducted in ${baseYear}`)
  await page.getByTestId('rrsp-deduct-later-self').check()
  await expect(page.getByTestId('rrsp-statement-self')).toContainText(`is deducted in ${baseYear + 1}`)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
  expect(saved.canonical.contributions[0].calendarYear).toBe(baseYear)
  expect(saved.canonical.contributions[0].deductionYear).toBe(baseYear + 1)
  await page.reload()
  await expect(page.getByTestId('rrsp-deduct-later-self')).toBeChecked()
  await expect(page.getByTestId('rrsp-ledger-self')).toContainText('15,000')
  expect(await inViewport(page)).toBe(true)
})

test('the RRSP room block explains itself in EN, FR and ZH', async ({ page }) => {
  await seed(page)
  const panel = page.getByTestId('rrsp-statement-self')
  await expect(panel).toContainText('RRSP deduction limit (CRA statement)')
  await expect(panel).toContainText('not a CRA rule')
  await page.getByRole('button', { name: 'FR', exact: true }).click()
  await expect(panel).toContainText('Maximum déductible au titre des REER')
  await expect(panel).toContainText('Droits de cotisation disponibles')
  await page.getByRole('button', { name: '中文' }).click()
  await expect(panel).toContainText('RRSP 扣除上限')
  await expect(panel).toContainText('可用供款空间')
  expect(await inViewport(page)).toBe(true)
})
