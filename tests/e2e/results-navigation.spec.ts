import { expect, test, type Page } from '@playwright/test'
import { showProfessionalResults } from './fixtures/professional'
import { canonicalAppPlan } from './fixtures/canonical-app-plan'

async function seed(page: Page, mode: 'professional' | 'guided' = 'professional', couple = false) {
  await page.goto('/')
  await page.evaluate(async ({ mode, couple }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS, DEFAULT_PARTNER } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, retirementSpending: 160000, partner: couple ? { ...DEFAULT_PARTNER } : null }
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical: refreshCanonicalFromLegacy(null, inputs), entryMode: mode,
      guidedView: 'results', inputRevision: 0, resultRevision: 0,
    } }))
  }, { mode, couple })
  await page.reload()
  if (mode === 'guided') await page.goto('/#/guided/results')
  await showProfessionalResults(page)
  await expect(page.locator('#results .results-navigation')).toBeVisible()
}

for (const mode of ['guided', 'professional'] as const) {
  test(`${mode} section anchors focus content and observer follows its scrollport`, async ({ page }, info) => {
    await seed(page, mode)
    const nav = page.getByRole('navigation', { name: 'Result sections' })
    const income = nav.getByRole('link', { name: 'Income', exact: true })
    await income.click()
    await expect(page.locator('#results-income')).toBeFocused()
    await expect(income).toHaveAttribute('aria-current', 'true')
    const heading = page.locator('#results-income h3')
    await expect(heading).toBeInViewport()
    if (info.project.name === 'mobile-320') expect((await page.locator('.app-bar').boundingBox())!.y).toBe(0)
    const bounds = await nav.boundingBox()
    if (mode === 'professional' || info.project.name === 'mobile-320') expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(bounds!.y + bounds!.height - 1)
    // Scroll without clicking navigation, requiring the IntersectionObserver to update state.
    await page.locator('#results-benefits').evaluate(element => {
      const pane = document.getElementById('results')!
      const nav = document.querySelector('.results-navigation')!
      const line = getComputedStyle(nav).flexDirection === 'column' ? 24 : nav.getBoundingClientRect().bottom + 4
      if (getComputedStyle(pane).overflowY === 'auto') pane.scrollBy(0, element.getBoundingClientRect().top - line)
      else window.scrollBy(0, element.getBoundingClientRect().top - line)
    })
    await expect(nav.getByRole('link', { name: 'Benefits', exact: true })).toHaveAttribute('aria-current', 'true')
    if (mode === 'professional') {
      expect(await page.locator('#results').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      expect(await page.evaluate(() => scrollY)).toBe(0)
    } else expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0)
    await nav.getByRole('link', { name: 'Overview', exact: true }).click()
    await expect(page.locator('#results-overview')).toBeFocused()
    await expect(page.locator('.summary')).toBeInViewport()
  })
}

test('legend toggles preserve totals, tooltip values, neutral FIRE and all reference lines', async ({ page }) => {
  await seed(page)
  const chart = page.locator('#results-balances .chart-card')
  await page.getByRole('navigation', { name: 'Result sections' }).getByRole('link', { name: 'Balances' }).click()
  const rrsp = chart.locator('button[data-series="rrsp"]')
  const refs = await chart.locator('.recharts-reference-line').count()
  const fireStroke = await chart.locator('.recharts-reference-line').filter({ hasText: 'FIRE' }).locator('line').getAttribute('stroke')
  expect(fireStroke).toBe(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ink-2').trim()))
  const areas = await chart.locator('.recharts-area').count()
  const plot = chart.locator('.recharts-wrapper')
  await plot.hover({ position: { x: 120, y: 100 } })
  await expect(chart.locator('.recharts-tooltip-wrapper')).toBeVisible()
  const before = await chart.locator('.recharts-tooltip-wrapper').innerText()
  await rrsp.click()
  await expect(rrsp).toHaveAttribute('aria-pressed', 'false')
  await expect(chart.locator('.recharts-area')).toHaveCount(areas - 1)
  await expect(chart.locator('.recharts-reference-line')).toHaveCount(refs)
  await plot.hover({ position: { x: 120, y: 100 } })
  await expect.poll(() => chart.locator('.recharts-tooltip-wrapper').innerText()).toBe(before)
  await rrsp.focus()
  await page.keyboard.press('Space')
  await expect(rrsp).toHaveAttribute('aria-pressed', 'true')
  await expect(chart.locator('.recharts-area')).toHaveCount(areas)
  const swatches = await page.locator('[data-series="rrsp"] .chart-swatch').evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor))
  expect(swatches).toHaveLength(3)
  expect(new Set(swatches).size).toBe(1)
  await expect(page.getByTestId('income-unfunded')).toContainText('Unfunded from')
  await expect(page.locator('#results-income pattern')).toHaveCount(1)
  await expect(page.locator('#results-income .recharts-area-area[fill^="url("]')).toHaveCount(1)
})

test('gated and canonical navigation never advertise withheld charts or tools', async ({ page }) => {
  await seed(page, 'professional', true)
  const nav = page.getByRole('navigation', { name: 'Result sections' })
  await expect(nav.getByRole('link', { name: 'Tax', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('legacy-estimate')).toBeVisible()
  await page.evaluate(envelope => localStorage.setItem('fire-inputs', JSON.stringify(envelope)), canonicalAppPlan('settled'))
  await page.reload()
  await showProfessionalResults(page)
  await expect(nav.getByRole('link')).toHaveText(['Overview', 'Strategies', 'Risk', 'Scenarios'])
  await expect(page.locator('.results-column .recharts-wrapper, .results-column .summary')).toHaveCount(0)
  await expect(page.getByTestId('canonical-mc')).toBeVisible()
})

test('income and tax tooltips retain the original values even with every visible series hidden', async ({ page }) => {
  await seed(page)
  const conclusion = await page.locator('.summary').innerText()
  for (const id of ['income', 'tax']) {
    await page.locator(`.results-navigation a[href="#results-${id}"]`).click()
    const chart = page.locator(`#results-${id} .chart-card`).filter({ has: page.locator('.chart-legend') })
    const plot = chart.locator('.recharts-wrapper')
    await plot.hover({ position: { x: 120, y: 100 } })
    const tooltip = chart.locator('.recharts-tooltip-wrapper')
    await expect(tooltip).toBeVisible()
    const original = await tooltip.innerText()
    const referenceLines = await chart.locator('.recharts-reference-line').count()
    for (const button of await chart.locator('.chart-legend button').all()) {
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed', 'false')
    }
    await expect(chart.locator('.recharts-area')).toHaveCount(0)
    await plot.hover({ position: { x: 120, y: 100 } })
    await expect(tooltip).toBeVisible()
    await expect.poll(() => tooltip.innerText()).toBe(original)
    await expect(chart.locator('.recharts-reference-line')).toHaveCount(referenceLines)
  }
  expect(await page.locator('.summary').innerText()).toBe(conclusion)
})

test('phone result peek still opens and focuses #results after navigating away', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seed(page)
  await page.getByRole('navigation', { name: 'Result sections' }).getByRole('link', { name: 'Income', exact: true }).click()
  await page.locator('#phone-inputs-tab').click()
  await page.getByTestId('result-peek').getByRole('button').click()
  await expect(page.locator('#results')).toBeFocused()
  expect(await page.locator('#results').evaluate(element => element.scrollTop)).toBe(0)
  await expect(page.locator('.results-navigation a').first()).toHaveAttribute('aria-current', 'true')
})

test('resizing rebinds active-section observation between pane and document scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seed(page)
  const nav = page.getByRole('navigation', { name: 'Result sections' })
  for (const width of [1440, 1099, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await showProfessionalResults(page)
    const balances = nav.getByRole('link', { name: 'Balances', exact: true })
    await balances.click()
    await expect(balances).toHaveAttribute('aria-current', 'true')
    await page.locator('#results-income').evaluate(element => {
      const pane = document.getElementById('results')!
      const nav = document.querySelector('.results-navigation')!
      const line = getComputedStyle(nav).flexDirection === 'column' ? 24 : nav.getBoundingClientRect().bottom + 4
      if (getComputedStyle(pane).overflowY === 'auto') pane.scrollBy(0, element.getBoundingClientRect().top - line)
      else window.scrollBy(0, element.getBoundingClientRect().top - line)
    })
    await expect(nav.getByRole('link', { name: 'Income', exact: true })).toHaveAttribute('aria-current', 'true')
    expect(await page.locator('#results').evaluate(element => element.scrollTop > 0)).toBe(width !== 1099)
    expect(await page.evaluate(() => scrollY > 0)).toBe(width === 1099)
  }
})

for (const language of ['en', 'fr', 'zh']) {
  test(`results chart sizing and navigation contract in ${language}`, async ({ page }, info) => {
    if (language === 'zh' && info.project.name === 'mobile-320') await page.setViewportSize({ width: 390, height: 844 })
    await seed(page)
    await page.evaluate(async language => {
      const { setLanguage } = await import('/src/i18n/index.ts')
      await setLanguage(language)
    }, language)
    const nav = page.locator('.results-navigation')
    await expect(nav.getByRole('link')).toHaveCount(8)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    for (const plot of await page.locator('.chart-plot').all()) {
      const height = (await plot.boundingBox())!.height
      expect(height).toBeGreaterThanOrEqual(info.project.name === 'desktop' ? 220 : 170)
      expect(height).toBeLessThanOrEqual(info.project.name === 'desktop' ? 260 : 220)
    }
    if (info.project.name === 'mobile-320') {
      for (const target of await page.locator('.results-navigation a, .chart-legend button').all()) expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await nav.getByRole('link').nth(7).click()
      await expect(nav.getByRole('link').nth(7)).toBeInViewport()
    }
  })
}

test('reading-line crossings track short Benefits and Tax sections in both scrollports', async ({ page }) => {
  for (const mode of ['guided', 'professional'] as const) {
    await page.setViewportSize({ width: 390, height: 844 })
    await seed(page, mode)
    const nav = page.locator('.results-navigation')
    await nav.locator('[href="#results-income"]').click()
    for (const id of ['benefits', 'tax']) {
      // Place the new heading four pixels below the sticky strip, as in the review probe.
      await page.locator(`#results-${id}`).evaluate(element => {
        const pane = document.getElementById('results')!
        const top = document.querySelector('.results-navigation')!.getBoundingClientRect().bottom + 4
        const amount = element.getBoundingClientRect().top - top
        if (getComputedStyle(pane).overflowY === 'auto') pane.scrollBy(0, amount)
        else window.scrollBy(0, amount)
      })
      await expect(nav.locator(`[href="#results-${id}"]`)).toHaveAttribute('aria-current', 'true')
    }
  }
})

test('clamped anchor jumps retain the focused destination until actual scrolling resumes', async ({ page }) => {
  for (const [mode, width] of [['guided', 1440], ['professional', 1440], ['professional', 1099], ['guided', 390], ['professional', 390]] as const) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await seed(page, mode)
    const nav = page.locator('.results-navigation')
    for (const id of ['strategies', 'risk', 'scenarios']) {
      await nav.locator(`[href="#results-${id}"]`).click()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await expect(page.locator(`#results-${id}`)).toBeFocused()
      await expect(nav.locator(`[href="#results-${id}"]`)).toHaveAttribute('aria-current', 'true')
    }
    await page.locator('#results-balances').evaluate(element => {
      const pane = document.getElementById('results')!
      const nav = document.querySelector('.results-navigation')!
      const paneScrolls = getComputedStyle(pane).overflowY === 'auto'
      const readingTop = getComputedStyle(nav).flexDirection === 'column' ? 24 : nav.getBoundingClientRect().bottom + 4
      const amount = element.getBoundingClientRect().top - readingTop
      if (paneScrolls) pane.scrollBy(0, amount)
      else window.scrollBy(0, amount)
    })
    await expect(nav.locator('[href="#results-balances"]')).toHaveAttribute('aria-current', 'true')
  }
})

test('Guided phone legend tab stops clear both sticky UI edges including safe-area sized insets', async ({ page }) => {
  for (const inset of [false, true]) {
    await page.setViewportSize({ width: inset ? 320 : 390, height: inset ? 740 : 844 })
    await seed(page, 'guided')
    if (inset) await page.addStyleTag({ content: '.app:has(.guided-results) > .app-bar { height:72px; padding-top:20px } .guided-results .results-navigation { top:72px } .app .phone-result-tabs { min-height:98px; padding-bottom:32px }' })
    await page.locator('.results-navigation a[href="#results-balances"]').focus()
    await page.keyboard.press('Enter')
    const seen = new Set<string>()
    for (let index = 0; index < 60 && seen.size < 4; index++) {
      await page.keyboard.press('Tab')
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const measurement = await page.evaluate(() => {
        const control = document.activeElement as HTMLElement
        if (!control.matches('.chart-legend button')) return null
        const box = control.getBoundingClientRect()
        const top = Math.max(document.querySelector('.app-bar')!.getBoundingClientRect().bottom, document.querySelector('.results-navigation')!.getBoundingClientRect().bottom)
        const bottom = document.querySelector('.phone-result-tabs')!.getBoundingClientRect().top
        const peer = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        return { top: box.top, bottom: box.bottom, clearTop: top, clearBottom: bottom, hit: !!peer && control.contains(peer), taxSeries: control.closest('#results-tax') ? control.dataset.series : null }
      })
      if (!measurement) continue
      expect(measurement.top).toBeGreaterThanOrEqual(measurement.clearTop)
      expect(measurement.bottom).toBeLessThanOrEqual(measurement.clearBottom)
      expect(measurement.hit).toBe(true)
      if (measurement.taxSeries) seen.add(measurement.taxSeries)
    }
    expect([...seen]).toEqual(['rrsp', 'nonReg', 'cpp', 'oas'])
  }
})
