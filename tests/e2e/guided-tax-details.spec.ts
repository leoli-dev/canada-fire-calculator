import { expect, test, type Page } from '@playwright/test'

/** FE-43 C: contribution room and the remaining tax elections live in one
 * optional last category. Skipping it never blocks results. */
async function seed(page: Page, options: { couple?: boolean; tfsaRoom?: number } = {}) {
  await page.goto('/')
  await page.evaluate(async ({ couple, tfsaRoom }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS, DEFAULT_PARTNER } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, partner: couple ? { ...DEFAULT_PARTNER } : null }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    if (tfsaRoom !== undefined) canonical.people.forEach(person => { person.tfsaAvailableRoom = { status: 'known', value: tfsaRoom } })
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: 'guided', guidedView: 'questionnaire', inputRevision: 0, resultRevision: null,
      questionAnswers: { 'assets.identify': ['tfsa', 'rrsp', 'nonReg'] },
    } }))
  }, options)
  await page.reload()
}

const categoryPages = (page: Page) =>
  page.locator('.category-navigation details').filter({ hasText: 'Tax details (optional)' }).locator('div button')

test('the old all-in-one link opens the optional category, and skipping collapses it', async ({ page }) => {
  await seed(page)
  await page.goto('/#/guided/income/income.taxFacts')
  await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'tax.intro')
  await expect(page.getByTestId('guided-tax-intro')).toContainText('results stay the same')
  await expect(categoryPages(page)).toHaveCount(3)
  // Unanswered optional pages read as optional, never as outstanding work.
  await expect(categoryPages(page).first()).toContainText('optional')
  await page.getByTestId('guided-tax-intro-choice-skip').check()
  await expect(categoryPages(page)).toHaveCount(1)
  const next = page.locator('.question-pager button').last()
  await expect(next).toHaveText('Review answers')
  await next.click()
  await expect(page.locator('.answer-review')).toBeVisible()
  await expect(page.locator('.review-category-list')).toContainText('Skipped')
  // The optional category never appears among the blockers.
  await expect(page.locator('.review-blockers')).not.toContainText('contribution room')
})

test('a room page asks one number and says whether this year’s plan fits', async ({ page }) => {
  await seed(page)
  await page.goto('/#/guided/taxDetails/tax.tfsaRoom')
  await expect(page.getByTestId('guided-tfsa-room').locator('.ownership-row')).toHaveCount(1)
  await expect(page.getByTestId('tfsa-statement-self')).toBeHidden()
  await page.getByTestId('tfsa-available-room-self').fill('50000')
  await page.getByTestId('tfsa-available-room-self').blur()
  await expect(page.getByTestId('guided-tfsa-feedback-self')).toContainText('within the room')
  await page.getByTestId('tfsa-available-room-self').fill('5000')
  await page.getByTestId('tfsa-available-room-self').blur()
  // The example split sends 15% of 40,000 = 6,000 to the TFSA.
  await expect(page.getByTestId('guided-tfsa-feedback-self')).toContainText('1,000 more than the room')
})

test('a couple records room per person and can answer pension splitting', async ({ page }) => {
  await seed(page, { couple: true })
  await page.goto('/#/guided/taxDetails/tax.tfsaRoom')
  await expect(page.getByTestId('guided-tfsa-room').locator('.ownership-row')).toHaveCount(2)
  await page.getByTestId('tfsa-available-room-self').fill('50000')
  await page.getByTestId('tfsa-available-room-self').blur()
  // The household split is not divided between the two people, and the page says so.
  await expect(page.getByTestId('guided-tfsa-feedback-self')).toContainText('not divided')
  await page.getByTestId('tfsa-available-room-partner').fill('0')
  await page.getByTestId('tfsa-available-room-partner').blur()
  const people = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.canonical.people)
  expect(people.map((person: { tfsaAvailableRoom: unknown }) => person.tfsaAvailableRoom)).toEqual([
    { status: 'known', value: 50_000 }, { status: 'known', value: 0 },
  ])
  await expect(categoryPages(page).nth(1)).toContainText('answered')
  // Pension splitting is a couple's choice; "no" is an answer and clears any election.
  await page.goto('/#/guided/taxDetails/tax.pensionSplit')
  await expect(page.getByTestId('split-transferor')).toHaveCount(0)
  await page.getByTestId('guided-pension-split-choice-yes').check()
  await page.getByTestId('split-transferor').selectOption('legacy:person:self')
  await page.getByTestId('guided-pension-split-choice-no').check()
  await expect(page.getByTestId('split-transferor')).toHaveCount(0)
  const taxProfile = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.canonical.taxProfile)
  expect(taxProfile.pensionSplit).toBeNull()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})

test('the savings-split page warns softly when a split exceeds recorded room', async ({ page }) => {
  await seed(page, { tfsaRoom: 5_000 })
  await page.goto('/#/guided/assets/allocation.tfsa')
  // The example split sends 15% of 40,000 = 6,000 to the TFSA, more than 5,000 of room.
  const hint = page.getByTestId('guided-allocation-room-hint')
  await expect(hint).toContainText('6,000')
  await expect(hint).toContainText('5,000')
  const tfsa = page.locator('[data-field="savingsSplit.tfsa"] input')
  await tfsa.fill('10')
  await page.locator('[data-field="savingsSplit.nonReg"] input').fill('45')
  await expect(hint).toHaveCount(0)
})

test('a plan with no recorded room shows no allocation warning', async ({ page }) => {
  await seed(page)
  await page.goto('/#/guided/assets/allocation.tfsa')
  await expect(page.locator('.allocation-total')).toBeVisible()
  await expect(page.getByTestId('guided-allocation-room-hint')).toHaveCount(0)
})

test('the optional category is translated in EN, FR and ZH', async ({ page }) => {
  await seed(page, { couple: true })
  const titles: Record<string, string[]> = {}
  for (const language of ['EN', 'FR', '中文']) {
    await page.getByRole('button', { name: language, exact: true }).click()
    titles[language] = []
    for (const id of ['tax.intro', 'tax.tfsaRoom', 'tax.rrspRoom', 'tax.pensionSplit']) {
      await page.goto(`/#/guided/taxDetails/${id}`)
      const title = (await page.locator('.question-page h2').first().textContent())?.trim() ?? ''
      expect(title.length, `${language} ${id}`).toBeGreaterThan(5)
      expect(await page.locator('.question-page').innerText(), `${language} ${id}`).not.toMatch(/questionnaire\.|be1\d\.|be2\d\.|be3\d\./)
      titles[language].push(title)
    }
  }
  expect(titles.FR).not.toEqual(titles.EN)
  expect(titles['中文']).not.toEqual(titles.EN)
})
