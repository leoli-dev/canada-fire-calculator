import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { showProfessionalResults } from './fixtures/professional'

const executablePath = process.env.THORIUM_EXECUTABLE_PATH ?? '/Applications/Thorium.app/Contents/MacOS/Thorium'
test.use({ browserName: 'chromium', launchOptions: { executablePath }, headless: true })
test.skip(!existsSync(executablePath), 'This suite requires the Thorium executable')

async function seed(page: Page, mode: string, language: string) {
  await page.goto('/')
  await page.evaluate(async ({ mode, language }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const { QUESTION_CATALOG } = await import('/src/guided/questionCatalog.ts')
    const answerMeta = Object.fromEntries(QUESTION_CATALOG.flatMap(page =>
      page.fieldBindings.map(field => [field, {
        status: 'confirmed', origin: 'user', updatedAt: '2026-01-01T00:00:00.000Z',
      }]),
    ))
    const questionAnswers = {
      'family.people': 'single', 'family.children': 'no', 'time.work.target': 'no',
      'work.after': 'no', 'assets.identify': ['tfsa', 'rrsp', 'nonReg'], 'home.situation': 'rent',
      'housing.other.rentals': 'no', 'housing.other.debts': 'no', 'spending.method': 'total',
      'pension.self': 'none', 'intent.legacy': 'none', 'intent.spending': 'maintain',
      'invest.mix': 'balanced', 'invest.strategy': 'meltdownPaced',
    }
    const inputs = { ...DEFAULT_INPUTS, strategy: 'meltdownPaced' }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    canonical.budget = { ...canonical.budget, kind: 'savingsBudget',
      debtIncluded: { status: 'known', value: true },
      taxBenefitIncluded: { status: 'known', value: true } }
    localStorage.setItem('fire-lang', language)
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, answerMeta, questionAnswers, entryMode: mode, guidedView: 'results', inputRevision: 0, resultRevision: 0,
    } }))
  }, { mode, language })
  await page.reload()
  await page.goto('/#/guided/results')
  await showProfessionalResults(page)
  await expect(page.locator('html')).toHaveAttribute('lang', language === 'zh' ? 'zh-Hans' : language)
  await expect(page.locator('.withdrawal-order-card select')).toHaveCount(2)
}

async function geometry(page: Page) {
  return page.locator('.withdrawal-order-card').evaluate(card => {
    const rect = card.getBoundingClientRect()
    const css = getComputedStyle(card)
    const left = rect.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft)
    const right = rect.right - parseFloat(css.borderRightWidth) - parseFloat(css.paddingRight)
    return { cardWidth: rect.width, contentWidth: right - left, viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      controls: [...card.querySelectorAll('label.field')].map(field => {
        const label = field.querySelector(':scope > span')!.getBoundingClientRect()
        const select = field.querySelector('select')!.getBoundingClientRect()
        return { label: label.toJSON(), select: select.toJSON(), left, right,
          labelText: field.querySelector(':scope > span')!.textContent }
      }) }
  })
}

for (const mode of ['guided', 'professional']) {
  for (const language of ['en', 'fr', 'zh']) {
    test(`${mode} ${language}: both controls fit their card and keep usable tracks`, async ({ page }, testInfo) => {
      expect(existsSync(executablePath), 'Physical Thorium is required').toBe(true)
      await seed(page, mode, language)
      const evidence = []
      for (const width of [1440, 1100, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 })
        await showProfessionalResults(page)
        const card = page.locator('.withdrawal-order-card')
        await card.evaluate(element => element.scrollIntoView({ block: 'center' }))
        // Charts elsewhere in Results resize asynchronously after a viewport change.
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        const measured = await geometry(page)
        evidence.push(measured)
        await testInfo.attach(`geometry-${width}`, { body: JSON.stringify(measured, null, 2), contentType: 'application/json' })
        await card.screenshot({ path: testInfo.outputPath(`card-${width}.png`) })
        expect(measured.documentWidth).toBeLessThanOrEqual(width)
        for (const control of measured.controls) {
          expect(control.labelText).toBeTruthy()
          expect(control.select.left).toBeGreaterThanOrEqual(control.left - 1)
          expect(control.select.right).toBeLessThanOrEqual(control.right + 1)
          expect(control.label.right).toBeLessThanOrEqual(control.right + 1)
          expect(control.select.height).toBeGreaterThanOrEqual(width <= 640 ? 48 : 40)
          if (measured.contentWidth <= 480) {
            expect(control.select.top).toBeGreaterThanOrEqual(control.label.bottom)
            expect(control.select.width).toBeCloseTo(measured.contentWidth, 0)
          } else {
            expect(control.select.left).toBeGreaterThanOrEqual(control.label.right + 9)
            expect(control.select.width).toBeCloseTo(260, 0)
          }
        }
      }
      // Keep the viewport desktop-sized: stacking must follow the actual card.
      await page.setViewportSize({ width: 1440, height: 1000 })
      for (const contentWidth of [280, 480, 481]) {
        await page.locator('.withdrawal-order-card').evaluate((card, width) => {
          const css = getComputedStyle(card)
          ;(card as HTMLElement).style.width = `${width + parseFloat(css.paddingLeft) + parseFloat(css.paddingRight) + 2}px`
        }, contentWidth)
        const measured = await geometry(page)
        evidence.push(measured)
        await page.locator('.withdrawal-order-card').screenshot({ path: testInfo.outputPath(`card-content-${contentWidth}.png`) })
        for (const control of measured.controls) {
          expect(control.label.left).toBeGreaterThanOrEqual(control.left - 1)
          expect(control.label.right).toBeLessThanOrEqual(control.right + 1)
          expect(control.select.right).toBeLessThanOrEqual(control.right + 1)
          expect(control.select.left).toBeGreaterThanOrEqual(control.left - 1)
          if (contentWidth <= 480) {
            expect(control.select.top).toBeGreaterThanOrEqual(control.label.bottom)
            expect(control.select.width).toBeCloseTo(contentWidth, 0)
          } else {
            expect(control.select.left).toBeGreaterThanOrEqual(control.label.right + 9)
          }
        }
      }
      await testInfo.attach('geometry-matrix', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' })
      if (mode === 'professional') {
        const selects = page.locator('.withdrawal-order-card select')
        await selects.nth(1).selectOption('bracket2')
        await expect(selects.nth(1)).toHaveValue('bracket2')
        await selects.first().selectOption('tfsaFirst')
        await expect(selects).toHaveCount(1)
        await expect(selects.first()).toHaveValue('tfsaFirst')
        const inputs = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.inputs)
        expect(inputs).toMatchObject({ strategy: 'tfsaFirst', meltdownBracketCap: 'bracket2' })
      }
    })
  }
}
