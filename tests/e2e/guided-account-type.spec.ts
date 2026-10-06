import { expect, test, type Page } from '@playwright/test'

/** FE-43 B: employment income and the registered-account type get their own
 * short guided pages; a RRIF asks its minimum-withdrawal facts next. */
async function seed(page: Page, options: { couple?: boolean } = {}) {
  await page.goto('/')
  await page.evaluate(async ({ couple }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS, DEFAULT_PARTNER } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 66, fireAge: 66, partner: couple ? { ...DEFAULT_PARTNER, currentAge: 63 } : null }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: 'guided', guidedView: 'questionnaire', inputRevision: 0, resultRevision: null,
      questionAnswers: { 'assets.identify': ['tfsa', 'rrsp', 'nonReg'] },
    } }))
  }, options)
  await page.reload()
}

const canonical = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.canonical)
// The pager shows progress within a category, so count the directory's pages.
const pageCount = (page: Page) => page.locator('.category-navigation details > div > button').count()

test('choosing RRIF adds its own page; the facts are shared with professional mode', async ({ page }) => {
  await seed(page)
  await page.goto('/#/guided/assets/account.rrsp.type')
  const type = page.getByTestId('registered-type-legacy:account:rrsp')
  await expect(type).toBeVisible()
  // The plain-RRSP default is an example, not an answer, and a single person has no spousal plan.
  await expect(type.locator('input:checked')).toHaveCount(0)
  await expect(page.getByTestId('registered-type-legacy:account:rrsp-spousalRrsp')).toHaveCount(0)
  const before = await pageCount(page)
  await page.getByTestId('registered-type-legacy:account:rrsp-rrif').check()
  await expect.poll(() => pageCount(page)).toBe(before + 1)
  await page.locator('.question-pager button').last().click()
  await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'account.rrif.details')
  const opened = page.getByTestId('guided-rrif-opened-legacy:account:rrsp')
  await opened.fill('2024')
  await opened.blur()
  // A calendar year is never shown with a thousands separator.
  await expect(opened).toHaveValue('2024')
  await page.getByTestId('guided-rrif-category-legacy:account:rrsp-allOther').check()
  // A single person has no age election to make.
  await expect(page.getByTestId('guided-rrif-election-legacy:account:rrsp')).toHaveCount(0)
  const rrsp = (await canonical(page)).accounts.find((account: { id: string }) => account.id === 'legacy:account:rrsp')
  expect(rrsp).toMatchObject({ kind: 'rrif', openedYear: { status: 'known', value: 2024 }, rrifFactorCategory: { status: 'known', value: 'allOther' } })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId('registered-type-legacy:account:rrsp')).toHaveValue('rrif')
  await expect(page.getByTestId('rrif-opened-year')).toHaveValue('2024')
  await expect(page.getByTestId('rrif-factor-category-legacy:account:rrsp')).toHaveValue('allOther')
  // Back to a plain RRSP in professional mode removes the guided RRIF page.
  await page.getByTestId('registered-type-legacy:account:rrsp').selectOption('rrsp')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/assets/account.rrsp.type')
  await expect.poll(() => pageCount(page)).toBe(before)
})

test('a couple can record a spousal RRSP and a RRIF age election', async ({ page }) => {
  await seed(page, { couple: true })
  await page.goto('/#/guided/assets/account.rrsp.type')
  await page.getByTestId('registered-type-legacy:account:rrsp-spousalRrsp').check()
  expect((await canonical(page)).accounts.find((account: { id: string }) => account.id === 'legacy:account:rrsp').kind).toBe('spousalRrsp')
  await page.getByTestId('registered-type-legacy:account:rrsp-rrif').check()
  await page.goto('/#/guided/assets/account.rrif.details')
  await page.getByTestId('guided-rrif-election-legacy:account:rrsp-legacy:person:partner').check()
  expect((await canonical(page)).accounts.find((account: { id: string }) => account.id === 'legacy:account:rrsp').rrifAgeElection)
    .toEqual({ personId: 'legacy:person:partner', electedAtOpening: true })
})

test('employment income is optional, per person, and clearable', async ({ page }) => {
  await seed(page, { couple: true })
  await page.goto('/#/guided/saving/saving.earned')
  await expect(page.getByTestId('guided-earned-income')).toBeVisible()
  await page.getByTestId('earned-self').fill('92000')
  await page.getByTestId('earned-partner').fill('55000')
  await page.getByTestId('earned-partner').blur()
  await expect(page.getByTestId('earned-self')).toHaveValue('92,000')
  let people = (await canonical(page)).people
  expect(people.map((person: { earnedIncome: unknown }) => person.earnedIncome)).toEqual([
    { status: 'known', value: 92_000 }, { status: 'known', value: 55_000 },
  ])
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByTestId('earned-self')).toHaveValue('92,000')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/saving/saving.earned')
  await page.getByTestId('guided-earned-income').getByRole('button', { name: 'Clear' }).first().click()
  people = (await canonical(page)).people
  expect(people[0].earnedIncome.status).toBe('unknown')
  await expect(page.getByTestId('earned-self')).toHaveValue('')
})

test('the new pages are translated in EN, FR and ZH', async ({ page }) => {
  await seed(page, { couple: true })
  await page.goto('/#/guided/assets/account.rrsp.type')
  await page.getByTestId('registered-type-legacy:account:rrsp-rrif').check()
  const titles: Record<string, string[]> = {}
  for (const language of ['EN', 'FR', '中文']) {
    await page.getByRole('button', { name: language, exact: true }).click()
    titles[language] = []
    for (const path of ['saving/saving.earned', 'assets/account.rrsp.type', 'assets/account.rrif.details']) {
      await page.goto(`/#/guided/${path}`)
      const title = (await page.locator('.question-page h2').first().textContent())?.trim() ?? ''
      expect(title.length, `${language} ${path}`).toBeGreaterThan(5)
      expect(title, `${language} ${path}`).not.toContain('questionnaire.')
      expect(await page.locator('.question-page').innerText(), `${language} ${path}`).not.toMatch(/questionnaire\.|be11\./)
      titles[language].push(title)
    }
  }
  expect(titles.FR).not.toEqual(titles.EN)
  expect(titles['中文']).not.toEqual(titles.EN)
})
