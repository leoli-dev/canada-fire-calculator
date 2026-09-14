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

/**
 * A plan whose FHSA contribution arrives as a scheduled `plan.contributions`
 * row instead of a recurring row. No UI path creates this shape; it is what
 * persisted or imported canonical data can carry, and it is the shape that
 * Blocking B-1 silently routed through the RRSP ledger.
 */
async function seedScheduledFhsa(page: Page, options: { history: boolean }) {
  await page.goto('/')
  await page.evaluate(async ({ history }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 40, fireAge: 60, lifeExpectancy: 90,
      annualSavings: 40_000, retirementSpending: 40_000,
      savingsSplit: { tfsa: 0, rrsp: 0, nonReg: 1 },
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
      cppAnnualAt65: 0, oasAnnualAt65: 0, fhsa: null, partner: null }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    // The kernel refuses an unconfirmed ownership/age/savings basis before it
    // prices anything; that is the plan's own confirmation, not a BE-36 fact.
    canonical.migration.ownershipNeedsConfirmation = false
    canonical.migration.ageBasisNeedsConfirmation = false
    canonical.migration.savingsBasisNeedsConfirmation = false
    canonical.budget = { kind: 'savingsBudget', annualNetSavings: inputs.annualSavings, retirementSpending: inputs.retirementSpending,
      debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } }
    const person = canonical.people.find((item: { role: string }) => item.role === 'self')
    const account = {
      id: 'e2e:fhsa:scheduled', kind: 'fhsa', ownerId: person.id, balance: 0, realReturn: 0.043,
      volatility: null, annualFee: 0.002, acb: { status: 'unknown', reason: 'not applicable' },
      taxableOwnerShares: { status: 'known', shares: { [person.id]: 1 } },
      contributionRoom: { status: 'known', value: 0 }, openedYear: { status: 'known', value: 2026 },
      rrifFactorCategory: { status: 'unknown', reason: 'not applicable' },
      openedYearsAgoAtBaseYear: null, provenance: {},
    }
    canonical.accounts.push(account)
    if (history) canonical.fhsaStatementHistory = { [account.id]: {
      cumulativePriorContributions: { status: 'known', value: 0 }, provenance: { origin: 'user', sourceYear: 2026 } } }
    canonical.contributions.push({ id: 'e2e:scheduled:fhsa', accountId: account.id, contributorId: person.id,
      calendarYear: 2026, amount: 8000, deductionYear: null, provenance: { origin: 'user', sourceYear: 2026 } })
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: 'professional', guidedView: 'questionnaire', inputRevision: 0, resultRevision: null,
    } }))
  }, options)
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

/**
 * Run the kernel's own base-year step on the stored canonical plan, so a panel
 * assertion can be backed by the number the projection actually prices. The
 * evaluated cash equals the plan's net savings, which is the kernel's own
 * consistency requirement.
 */
const kernelStatus = (page: Page) => page.evaluate(async () => {
  const { useStore } = await import('/src/store.ts')
  const { annualStep, initializeState } = await import('/src/engine/annualState.ts')
  const empty = {
    details: [] as string[], fhsaLedgerPlanned: null as number | null, fhsaApplied: null as number | null,
    rrspPlanned: null as number | null, rrspLineIds: [] as string[], fhsaContribution: null as number | null,
    rrspContribution: null as number | null, cashFhsa: null as number | null,
  }
  const plan = useStore.getState().canonical!
  const opening = initializeState(plan)
  if (opening.status !== 'ok') return { ...empty, status: opening.status, details: opening.issues.map(item => item.detail) }
  const savings = plan.budget.kind === 'savingsBudget' ? plan.budget.annualNetSavings : 0
  const providers = {
    evaluate: ({ state }: { state: { byPerson: Record<string, unknown> } }) => ({
      byPerson: Object.fromEntries(Object.keys(state.byPerson).map(id => [id, {
        income: savings * 2, earnedIncome: savings * 2, benefits: 0, tax: 0, spending: savings,
        taxableIncome: savings * 2, benefitIncomeForNextYear: { status: 'known' as const, value: savings * 2 },
      }])),
    }),
    returns: () => 0,
  }
  const result = annualStep(plan, opening.value, providers as never)
  if (result.status !== 'ok') return { ...empty, status: result.status, details: result.issues.map(item => item.detail) }
  const row = result.value.row
  const person = plan.people.find(item => item.role === 'self')!
  const fhsa = plan.accounts.find(item => item.kind === 'fhsa')
  const rrsp = plan.accounts.find(item => item.kind === 'rrsp')
  return {
    ...empty,
    status: 'ok' as const,
    fhsaLedgerPlanned: fhsa ? row.fhsaLedger[person.id]?.planned ?? null : null,
    fhsaApplied: fhsa ? row.fhsaLedger[person.id]?.applied ?? null : null,
    rrspPlanned: row.rrspLedger[person.id]?.planned ?? null,
    rrspLineIds: (row.rrspLedger[person.id]?.lines ?? []).map(item => item.id),
    fhsaContribution: fhsa ? row.byAccount[fhsa.id].contribution : null,
    rrspContribution: rrsp ? row.byAccount[rrsp.id].contribution : null,
    cashFhsa: row.cashLedger.fhsaContributions,
  }
})

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
    canonical.migration.ownershipNeedsConfirmation = false
    canonical.migration.ageBasisNeedsConfirmation = false
    canonical.migration.savingsBasisNeedsConfirmation = false
    canonical.budget = { kind: 'savingsBudget', annualNetSavings: inputs.annualSavings, retirementSpending: inputs.retirementSpending,
      debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } }
    const self = canonical.people.find((person: { role: string }) => person.role === 'self')
    const partner = canonical.people.find((person: { role: string }) => person.role === 'partner')
    // A household account has no recorded owner; the kernel refuses an
    // unowned registered account before it prices anything, which is not a
    // BE-36 fact. Attribute them so the FHSA refusal can be reached.
    for (const item of canonical.accounts) {
      item.ownerId = self.id
      item.taxableOwnerShares = { status: 'known', shares: { [self.id]: 1 } }
    }
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
  // With a plan on each person's own account the plan has two active FHSAs.
  // BE-36 A prices at most one, so the panel says so where the user records the
  // accounts, and the kernel refuses the year with the typed reason instead of
  // a conservation failure.
  await recordStatement(page, 'self', { planned: '6000' })
  await expect(page.getByTestId('fhsa-multiple-active')).toBeVisible()
  await expect(page.getByTestId('fhsa-multiple-active')).toContainText('one active FHSA per plan')
  const refused = await kernelStatus(page)
  expect(refused.status).toBe('unsupported')
  expect(refused.details.join(' ')).toContain('more than one active FHSA')
  expect(refused.details.join(' ')).not.toContain('conservation')
  expect(await inViewport(page)).toBe(true)
})

/**
 * Blocking B-1: a scheduled FHSA row used to be priced as an RRSP line, spend
 * RRSP room and skip participation room entirely. This seeds the exact shape
 * the reviewer built — a scheduled canonical row with no recurring plan — and
 * checks the panel, the allocation and the kernel all agree.
 */
test('a scheduled FHSA row is priced by participation room, never by the RRSP ledger', async ({ page }) => {
  await seedScheduledFhsa(page, { history: true })
  // The panel box shows the whole year's plan, which is what the ledger prices.
  await expect(page.getByTestId('fhsa-planned-self')).toHaveValue('8000')
  await expect(page.getByTestId('fhsa-scheduled-self')).toBeVisible()
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText('contributions 8,000')
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText('closing room 0')
  await expect(page.getByTestId('fhsa-lifetime-self')).toContainText('8,000 used')
  const kernel = await kernelStatus(page)
  expect(kernel.status).toBe('ok')
  expect(kernel.fhsaLedgerPlanned).toBe(8000)
  expect(kernel.fhsaApplied).toBe(8000)
  // The FHSA row consumes no RRSP room and is not an RRSP planned line, while
  // the FHSA account receives exactly what the participation ledger applied.
  expect(kernel.rrspPlanned).toBe(0)
  expect(kernel.rrspLineIds).toEqual([])
  expect(kernel.fhsaContribution).toBe(8000)
  expect(kernel.rrspContribution).toBe(0)
  expect(kernel.cashFhsa).toBe(8000)
  // An explicit edit owns the plan year: the scheduled row is replaced, not
  // added to or left behind for the ledger to price alongside the box.
  const planned = page.getByTestId('fhsa-planned-self')
  await planned.fill('3000')
  await planned.blur()
  await expect(planned).toHaveValue('3000')
  await expect(page.getByTestId('fhsa-scheduled-self')).toHaveCount(0)
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText('contributions 3,000')
  const edited = await kernelStatus(page)
  expect(edited.status).toBe('ok')
  expect(edited.fhsaApplied).toBe(3000)
  expect(edited.rrspPlanned).toBe(0)
  expect(await inViewport(page)).toBe(true)
})

test('a scheduled FHSA row with no statement history is refused, never executed', async ({ page }) => {
  await seedScheduledFhsa(page, { history: false })
  // The room stays unknown, so nothing is priced against it.
  await expect(page.getByTestId('fhsa-room-unknown-self')).toBeVisible()
  const kernel = await kernelStatus(page)
  expect(kernel.status).toBe('unsupported')
  expect(kernel.details.join(' ')).toContain('FHSA participation room not verified')
  expect(kernel.details.join(' ')).toContain('contribution history is not confirmed')
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

/**
 * Round 3 blocking defect: the panel offered a couple an owner selector for the
 * household FHSA account, but `applyAccountSplit` rejected the kind, so the
 * control threw `account kind cannot be split: fhsa`, discarded the selection
 * and left the account unowned. A couple could not record a single FHSA fact.
 *
 * An FHSA is one person's account like an RRSP, so a recorded holder is one
 * account with that owner, and a genuine two-way split is two FHSAs — which
 * BE-36 A refuses with its typed multiple-active reason instead of pricing one.
 *
 * `ageBasis`/`savingsBasis` are the plan's own confirmations, not BE-36 facts,
 * and are pre-cleared so the ownership gate this test exercises is the one that
 * stays closed until the holder is actually recorded.
 */
async function seedCoupleFhsa(page: Page, options: { balance: number; guided?: boolean }) {
  await page.goto('/')
  await page.evaluate(async ({ balance, guided }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 40, fireAge: 60, lifeExpectancy: 90,
      annualSavings: 40_000, retirementSpending: 40_000,
      savingsSplit: { tfsa: 0.3, rrsp: 0.5, nonReg: 0.2 },
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
      cppAnnualAt65: 0, oasAnnualAt65: 0,
      fhsa: { balance, annualContribution: 0, openedYearsAgo: 0 },
      partner: { currentAge: 38, cppStartAge: 65, cppAnnualAt65: 0, oasStartAge: 65, oasAnnualAt65: 0 } }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    canonical.migration.ageBasisNeedsConfirmation = false
    canonical.migration.savingsBasisNeedsConfirmation = false
    canonical.budget = { kind: 'savingsBudget', annualNetSavings: inputs.annualSavings, retirementSpending: inputs.retirementSpending,
      debtIncluded: { status: 'known', value: true }, taxBenefitIncluded: { status: 'known', value: true } }
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: guided ? 'guided' : 'professional', guidedView: guided ? 'results' : 'questionnaire',
      inputRevision: 0, resultRevision: guided ? 0 : null,
    } }))
  }, options)
  await page.reload()
}

/**
 * Round 4 blocking defect: a migrated legacy plan records its FHSA opening
 * answer only in the legacy `openedYearsAgo` field, because migration leaves the
 * canonical opening year unknown (`14` is a years-ago count, not a calendar
 * year — `migration.ts` deliberately refuses to invent one). Any tax-panel edit
 * must leave that recorded answer untouched.
 */
async function seedLegacyOpenedYearsAgo(page: Page, openedYearsAgo: number, options: { guided?: boolean } = {}) {
  await page.goto('/')
  await page.evaluate(async ({ openedYearsAgo, guided }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 40, fireAge: 60, lifeExpectancy: 90,
      annualSavings: 40_000, retirementSpending: 40_000,
      savingsSplit: { tfsa: 0.3, rrsp: 0.5, nonReg: 0.2 },
      balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, nonRegBook: 0,
      cppAnnualAt65: 0, oasAnnualAt65: 0,
      fhsa: { balance: 100000, annualContribution: 4000, openedYearsAgo }, partner: null }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: guided ? 'guided' : 'professional', guidedView: guided ? 'results' : 'questionnaire',
      inputRevision: 0, resultRevision: guided ? 0 : null,
    } }))
  }, { openedYearsAgo, guided: options.guided ?? false })
  await page.reload()
}

/**
 * The recorded legacy answer and the validation it drives, read from the live
 * store. `validationKeys` is what `validateInputs` says about
 * `fhsa.openedYearsAgo` after the edit, so an erased error is visible here.
 */
const legacyFhsaAnswer = (page: Page) => page.evaluate(async () => {
  const { useStore } = await import('/src/store.ts')
  const { validateInputs } = await import('/src/engine/validate.ts')
  const inputs = useStore.getState().inputs
  const plan = useStore.getState().canonical
  return {
    openedYearsAgo: inputs.fhsa?.openedYearsAgo,
    validationKeys: validateInputs(inputs)
      .filter((issue: { field: string }) => issue.field === 'fhsa.openedYearsAgo')
      .map((issue: { key: string }) => issue.key),
    canonicalOpenedYear: plan?.accounts.find((account: { kind: string }) => account.kind === 'fhsa')?.openedYear ?? null,
  }
})

/** Edit one unrelated field in the shared tax panel and blur, the reviewer's
 * exact reproduction, and return the plan's answer afterwards. */
async function editUnrelatedEarned(page: Page) {
  const earned = page.getByTestId('earned-self')
  await earned.fill('90000')
  await earned.blur()
  await expect(earned).toHaveValue('90000')
  return legacyFhsaAnswer(page)
}

for (const guided of [false, true] as const) {
  const mode = guided ? 'guided' : 'professional'
  test(`${mode}: an unrelated panel edit preserves the recorded legacy FHSA opening age`, async ({ page }) => {
    await seedLegacyOpenedYearsAgo(page, 14, { guided })
    if (guided) await page.goto('/#/guided/income/income.taxFacts')
    await expect(page.getByTestId('fhsa-statement-self')).toBeVisible()
    // Precondition: migration carries the answer in the legacy field and leaves
    // the canonical calendar year explicitly unknown.
    const before = await legacyFhsaAnswer(page)
    expect(before.openedYearsAgo).toBe(14)
    expect(before.canonicalOpenedYear).toMatchObject({ status: 'unknown' })
    // The reviewer's probe: 14 must survive an unrelated edit and blur.
    const after = await editUnrelatedEarned(page)
    expect(after.openedYearsAgo).toBe(14)
    expect(after.canonicalOpenedYear).toMatchObject({ status: 'unknown' })
  })

  test(`${mode}: an unrelated panel edit does not erase valFhsaExpired`, async ({ page }) => {
    await seedLegacyOpenedYearsAgo(page, 15, { guided })
    if (guided) await page.goto('/#/guided/income/income.taxFacts')
    await expect(page.getByTestId('fhsa-statement-self')).toBeVisible()
    const before = await legacyFhsaAnswer(page)
    expect(before.openedYearsAgo).toBe(15)
    expect(before.validationKeys).toContain('valFhsaExpired')
    const after = await editUnrelatedEarned(page)
    expect(after.openedYearsAgo).toBe(15)
    expect(after.validationKeys).toContain('valFhsaExpired')
  })
}

/** The FHSA accounts and ownership facts the panel recorded in the stored plan. */
const ownershipState = (page: Page) => page.evaluate(async () => {
  const { useStore } = await import('/src/store.ts')
  const plan = useStore.getState().canonical!
  const fhsa = plan.accounts.filter((account: { kind: string }) => account.kind === 'fhsa')
  return {
    ownerIds: fhsa.map((account: { ownerId: string | null }) => account.ownerId).sort(),
    total: fhsa.reduce((sum: number, account: { balance: number }) => sum + account.balance, 0),
    rowIds: plan.contributions.filter((row: { accountId: string }) =>
      fhsa.some((account: { id: string }) => account.id === row.accountId)).map((row: { id: string }) => row.id),
    ownershipNeedsConfirmation: plan.migration.ownershipNeedsConfirmation,
  }
})

/** Attribute the household's other registered accounts so the ownership gate
 * the FHSA control closes is the one under test. */
async function attributeHouseholdAccounts(page: Page) {
  await page.getByTestId('owner-legacy:account:tfsa').selectOption('legacy:person:self')
  await page.getByTestId('owner-legacy:account:rrsp').selectOption('legacy:person:partner')
  await page.getByTestId('owner-legacy:account:nonReg').selectOption('legacy:person:self')
}

test('professional records a couple FHSA holder and can then enter its statement', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error)))
  await seedCoupleFhsa(page, { balance: 0 })
  // The row is offered and starts unowned: the control's whole job.
  await expect(page.getByTestId('owner-legacy:account:fhsa')).toHaveValue('')
  await attributeHouseholdAccounts(page)
  await page.getByTestId('owner-legacy:account:fhsa').selectOption('legacy:person:self')
  // The control itself must never escape an exception.
  await page.waitForTimeout(50)
  expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([])
  expect(await ownershipState(page)).toMatchObject({
    ownerIds: ['legacy:person:self'], total: 0, ownershipNeedsConfirmation: false })
  // The holder owns the account, so the holder's block is usable and the other
  // person's says plainly that they have none.
  await expect(page.getByTestId('fhsa-no-account-self')).toHaveCount(0)
  await expect(page.getByTestId('fhsa-no-account-partner')).toHaveCount(1)
  await recordStatement(page, 'self', { openedYear: '2026', prior: '0', opening: '0', planned: '6000' })
  await expect(page.getByTestId('fhsa-ledger-self')).toContainText('contributions 6,000')
  await expect(page.getByTestId('fhsa-lifetime-self')).toContainText('6,000 used')
  // The holder and the recorded fact survive reload.
  await page.reload()
  await expect(page.getByTestId('owner-legacy:account:fhsa')).toHaveValue('legacy:person:self')
  await expect(page.getByTestId('fhsa-planned-self')).toHaveValue('6000')
  expect(await ownershipState(page)).toMatchObject({ ownerIds: ['legacy:person:self'] })
  expect(errors).toEqual([])
  expect(await inViewport(page)).toBe(true)
})

test('guided records the same couple FHSA holder and survives the mode switch', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error)))
  await seedCoupleFhsa(page, { balance: 0, guided: true })
  await page.goto('/#/guided/income/income.taxFacts')
  await expect(page.getByTestId('person-tax-facts')).toBeVisible()
  await expect(page.getByTestId('owner-legacy:account:fhsa')).toHaveValue('')
  await attributeHouseholdAccounts(page)
  await page.getByTestId('owner-legacy:account:fhsa').selectOption('legacy:person:partner')
  await page.waitForTimeout(50)
  expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([])
  expect(await ownershipState(page)).toMatchObject({
    ownerIds: ['legacy:person:partner'], ownershipNeedsConfirmation: false })
  await expect(page.getByTestId('fhsa-no-account-self')).toHaveCount(1)
  await expect(page.getByTestId('fhsa-no-account-partner')).toHaveCount(0)
  await recordStatement(page, 'partner', { openedYear: '2026', prior: '0', opening: '0', planned: '6000' })
  await expect(page.getByTestId('fhsa-ledger-partner')).toContainText('contributions 6,000')
  await page.reload()
  await expect(page.getByTestId('owner-legacy:account:fhsa')).toHaveValue('legacy:person:partner')
  await expect(page.getByTestId('fhsa-planned-partner')).toHaveValue('6000')
  // The holder survives the guided/professional switch, which rebuilds the
  // canonical plan from the legacy form.
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId('owner-legacy:account:fhsa')).toHaveValue('legacy:person:partner')
  await expect(page.getByTestId('fhsa-planned-partner')).toHaveValue('6000')
  expect(await ownershipState(page)).toMatchObject({
    ownerIds: ['legacy:person:partner'], ownershipNeedsConfirmation: false })
  expect(errors).toEqual([])
  expect(await inViewport(page)).toBe(true)
})

test('a genuine couple FHSA split reaches the typed multiple-active refusal, never an exception', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error)))
  await seedCoupleFhsa(page, { balance: 12000 })
  await attributeHouseholdAccounts(page)
  // The user records a genuine per-person split: 6,000 to each spouse.
  await page.getByTestId('account-self-amount-legacy:account:fhsa').fill('6000')
  await page.getByTestId('account-partner-amount-legacy:account:fhsa').fill('6000')
  await page.getByTestId('account-partner-amount-legacy:account:fhsa').blur()
  await page.waitForTimeout(50)
  expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([])
  // Two person-owned FHSAs, the household total conserved to the cent.
  expect(await ownershipState(page)).toMatchObject({
    ownerIds: ['legacy:person:partner', 'legacy:person:self'], total: 12000, ownershipNeedsConfirmation: false })
  // Both per-person blocks are usable, and the panel says where the user acts
  // that BE-36 A prices at most one active FHSA.
  await expect(page.getByTestId('fhsa-no-account-self')).toHaveCount(0)
  await expect(page.getByTestId('fhsa-no-account-partner')).toHaveCount(0)
  await expect(page.getByTestId('fhsa-multiple-active')).toBeVisible()
  await expect(page.getByTestId('fhsa-multiple-active')).toContainText('one active FHSA per plan')
  // The kernel refuses the year with the typed reason instead of a conservation
  // failure, exactly as the hand-seeded case did.
  const refused = await kernelStatus(page)
  expect(refused.status).toBe('unsupported')
  expect(refused.details.join(' ')).toContain('more than one active FHSA')
  expect(refused.details.join(' ')).not.toContain('conservation')
  expect(errors).toEqual([])
  expect(await inViewport(page)).toBe(true)
})

test('a two-way FHSA split keeps both balances and the partner plan across a legacy edit', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error)))
  await seedCoupleFhsa(page, { balance: 12000 })
  await attributeHouseholdAccounts(page)
  await page.getByTestId('account-self-amount-legacy:account:fhsa').fill('6000')
  await page.getByTestId('account-partner-amount-legacy:account:fhsa').fill('6000')
  await page.getByTestId('account-partner-amount-legacy:account:fhsa').blur()
  // Record a plan on the partner-owned account, then edit an unrelated shared
  // field: the legacy form can mirror only one FHSA, so the partner row must be
  // carried across the rebuild instead of silently disappearing.
  await recordStatement(page, 'partner', { openedYear: '2026', prior: '0', opening: '0', planned: '3000' })
  await expect(page.getByTestId('fhsa-planned-partner')).toHaveValue('3000')
  await page.evaluate(async () => {
    const { useStore } = await import('/src/store.ts')
    useStore.getState().editSharedField('annualSavings', '41000')
  })
  const edited = await ownershipState(page)
  expect(edited.total).toBe(12000)
  expect(edited.ownerIds).toEqual(['legacy:person:partner', 'legacy:person:self'])
  await expect(page.getByTestId('fhsa-planned-partner')).toHaveValue('3000')
  await page.reload()
  expect((await ownershipState(page)).total).toBe(12000)
  await expect(page.getByTestId('fhsa-planned-partner')).toHaveValue('3000')
  expect(errors).toEqual([])
  expect(await inViewport(page)).toBe(true)
})
