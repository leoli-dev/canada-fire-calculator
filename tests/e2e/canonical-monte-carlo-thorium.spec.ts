import { prepareProfessionalTarget } from './fixtures/professional'
import { chooseMode, chooseLanguage } from './fixtures/app-bar'
import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { heldHomeEstateIds as ids } from '../../src/engine/__tests__/fixtures/annualIntegratedHeldHomeEstate'
import { canonicalAppPlan } from './fixtures/canonical-app-plan'

const executablePath = process.env.THORIUM_EXECUTABLE_PATH ?? '/Applications/Thorium.app/Contents/MacOS/Thorium'
test.use({ browserName: 'chromium', launchOptions: { executablePath } })
test.skip(!existsSync(executablePath), 'This suite requires the Thorium executable')

const card = (page: Page) => page.getByTestId('canonical-mc')
const run = (page: Page) => page.getByTestId('canonical-mc-run')
const cancel = (page: Page) => page.getByTestId('canonical-mc-cancel')
const counts = (page: Page) => page.getByTestId('canonical-mc-counts')
const rate = (page: Page) => page.getByTestId('canonical-mc-rate')
const status = (page: Page) => page.getByTestId('canonical-mc-status')
const bands = (page: Page) => page.getByTestId('canonical-mc-bands')
const volatility = (page: Page, account: string) => page.getByTestId(`canonical-mc-volatility-${account}`)
const overview = (page: Page) => page.getByTestId('canonical-coverage-table')
const seedInput = (page: Page) => page.getByTestId('canonical-mc-seed')
const trialsInput = (page: Page) => page.getByTestId('canonical-mc-trials')

async function recordExplicitVolatility(page: Page, percent: string) {
  for (const id of [ids.selfTfsa, ids.partnerTfsa]) {
    await (await prepareProfessionalTarget(volatility(page, id))).fill(percent)
    await (await prepareProfessionalTarget(volatility(page, id))).blur()
  }
}

async function persistedApp(page: Page, variant: Parameters<typeof canonicalAppPlan>[0] = 'settled') {
  await page.addInitScript(envelope => {
    if (!localStorage.getItem('fire-inputs')) localStorage.setItem('fire-inputs', JSON.stringify(envelope))
  }, canonicalAppPlan(variant))
  await page.goto('/')
}

async function chooseSeedAndTrials(page: Page, trials = 4) {
  await (await prepareProfessionalTarget(seedInput(page))).fill(String(0x5eed2026))
  await (await prepareProfessionalTarget(trialsInput(page))).fill(String(trials))
  await (await prepareProfessionalTarget(trialsInput(page))).blur()
}

// Leave every request on a real worker thread. Queue its actual response at
// the transport boundary so tests can deliver otherwise hard-to-time late replies.
async function holdCanonicalResponses(page: Page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    const deliveries = new WeakSet<Event>()
    const workers: { worker: Worker; request?: Record<string, unknown>; response?: Record<string, unknown>; terminated: boolean }[] = []
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker
        if (!String(args[0]).includes('canonicalMc.worker')) return worker
        const job: typeof workers[number] = { worker, terminated: false }
        workers.push(job)
        worker.addEventListener('message', event => {
          if (deliveries.has(event)) return
          event.stopImmediatePropagation()
          job.response = event.data
        })
        const post = worker.postMessage.bind(worker)
        const terminate = worker.terminate.bind(worker)
        worker.postMessage = (message: Record<string, unknown>) => {
          job.request = structuredClone(message)
          post(message)
        }
        worker.terminate = () => {
          job.terminated = true
          terminate()
        }
        return worker
      },
    })
    Object.assign(window, {
      __canonicalWorkerGate: {
        workers,
        deliver(index: number, changed: Record<string, unknown> = {}) {
          const job = workers[index]
          if (!job.response) throw new Error('No real worker response to deliver')
          const event = new MessageEvent('message', { data: { ...job.response, ...changed } })
          deliveries.add(event)
          job.worker.dispatchEvent(event)
        },
      },
    })
  })
}

test('persisted #78 requires explicit volatility and fixed draws preserve the App estate and event gap', async ({ page }) => {
  await persistedApp(page)
  await expect((await prepareProfessionalTarget(overview(page).locator('tbody tr')))).toHaveCount(3)
  await expect((await prepareProfessionalTarget(page.getByTestId('canonical-estate')))).toContainText('158,070')
  const before = await (await prepareProfessionalTarget(overview(page))).innerText()
  await expect((await prepareProfessionalTarget(card(page)))).toBeVisible()
  await expect((await prepareProfessionalTarget(volatility(page, ids.selfTfsa)))).toHaveValue('')
  await expect((await prepareProfessionalTarget(volatility(page, ids.partnerTfsa)))).toHaveValue('')
  await expect((await prepareProfessionalTarget(run(page)))).toBeDisabled()
  await expect(counts(page)).toHaveCount(0)

  await (await prepareProfessionalTarget(volatility(page, ids.selfTfsa))).fill('101')
  await (await prepareProfessionalTarget(volatility(page, ids.partnerTfsa))).fill('0')
  await expect((await prepareProfessionalTarget(run(page)))).toBeDisabled()
  await recordExplicitVolatility(page, '0')
  await chooseSeedAndTrials(page)
  await expect((await prepareProfessionalTarget(run(page)))).not.toContainText('1,000')
  await (await prepareProfessionalTarget(run(page))).click()
  await expect((await prepareProfessionalTarget(counts(page)))).toContainText('complete with zero gaps 0')
  await expect((await prepareProfessionalTarget(counts(page)))).toContainText('complete with actual gaps 4')
  await expect((await prepareProfessionalTarget(rate(page)))).toContainText('0 / 4')
  await expect((await prepareProfessionalTarget(rate(page)))).toContainText('0%')
  await expect((await prepareProfessionalTarget(bands(page)))).toContainText('2028')
  await expect((await prepareProfessionalTarget(bands(page)))).toContainText('638,880')
  await expect((await prepareProfessionalTarget(overview(page)))).toHaveText(before, { useInnerText: true })
  await expect((await prepareProfessionalTarget(page.getByTestId('canonical-estate')))).toContainText('158,070')
})

test('the actual Guide runs the selected household while the partial control retains its stopped ledger', async ({ page }) => {
  await persistedApp(page, 'partial')
  await expect((await prepareProfessionalTarget(page.getByTestId('canonical-blocked-year')))).toContainText('2028')
  await expect((await prepareProfessionalTarget(page.getByTestId('canonical-uncomputed')))).toContainText(/2029.*2030/)
  await chooseMode(page, 'guided')
  await page.goto('/#/guided/review')
  await expect(card(page)).toHaveCount(0)
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Generate my results' }))).click()
  await recordExplicitVolatility(page, '0')
  await chooseSeedAndTrials(page)
  await (await prepareProfessionalTarget(run(page))).click()
  await expect((await prepareProfessionalTarget(counts(page)))).toContainText('partial 4')
  await expect((await prepareProfessionalTarget(counts(page)))).toContainText('complete with actual gaps 0')
  await expect((await prepareProfessionalTarget(bands(page)))).toContainText('2027')
  for (const year of ['2028', '2029', '2030']) await expect(bands(page).getByText(year, { exact: true })).toHaveCount(0)
  await expect((await prepareProfessionalTarget(rate(page)))).toContainText('Overall zero-gap rate unavailable')
  await expect((await prepareProfessionalTarget(rate(page)))).not.toContainText('%')
  await expect((await prepareProfessionalTarget(page.getByTestId('canonical-blocked-year')))).toContainText('2028')
  await expect(page.getByTestId('canonical-estate')).toHaveCount(0)
})

test('the real canonical worker is cancellable and an older reply cannot replace the newer run', async ({ page }) => {
  await holdCanonicalResponses(page)
  await persistedApp(page)
  await recordExplicitVolatility(page, '0')
  await chooseSeedAndTrials(page)
  const hasWorkerResponse = (index: number) => page.waitForFunction(index => {
    const gate = (window as Window & { __canonicalWorkerGate?: { workers: { response?: unknown }[] } }).__canonicalWorkerGate
    return Boolean(gate?.workers[index]?.response)
  }, index)
  const deliver = (index: number, changed: Record<string, unknown> = {}) => page.evaluate(({ index, changed }) => {
    const gate = (window as Window & { __canonicalWorkerGate?: { deliver(index: number, changed: Record<string, unknown>): void } }).__canonicalWorkerGate
    gate!.deliver(index, changed)
  }, { index, changed })

  await (await prepareProfessionalTarget(run(page))).click()
  await expect((await prepareProfessionalTarget(cancel(page)))).toBeEnabled()
  await hasWorkerResponse(0)
  await (await prepareProfessionalTarget(cancel(page))).click()
  await deliver(0)
  await expect(counts(page)).toHaveCount(0)
  await expect((await prepareProfessionalTarget(status(page)))).toContainText(/Cancelled/)

  await (await prepareProfessionalTarget(run(page))).click()
  await hasWorkerResponse(1)
  await deliver(1, { sourceId: 'obsolete-source' })
  await expect((await prepareProfessionalTarget(status(page)))).toContainText(/unavailable/i)
  await expect(counts(page)).toHaveCount(0)

  await (await prepareProfessionalTarget(run(page))).click()
  await hasWorkerResponse(2)
  await deliver(2)
  await expect((await prepareProfessionalTarget(counts(page)))).toBeVisible()
  const before = await (await prepareProfessionalTarget(counts(page))).innerText()
  await deliver(0, { result: null })
  await expect((await prepareProfessionalTarget(counts(page)))).toHaveText(before)

  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: /^Life expectancy/ }).locator('input'))).fill('56')
  await expect(counts(page)).toHaveCount(0)
  await deliver(2)
  await expect(counts(page)).toHaveCount(0)
})

test('fixed #78 bands use closing CPI in real display and remain localized in French and Chinese', async ({ page }) => {
  await persistedApp(page, 'inflation')
  const results = page.getByTestId('canonical-results')
  await recordExplicitVolatility(page, '0')
  await chooseSeedAndTrials(page)
  await (await prepareProfessionalTarget(run(page))).click()
  const final = bands(page).getByRole('row').filter({ has: page.getByRole('rowheader', { name: '2028', exact: true }) })
  const fixed = overview(page).getByRole('row').filter({ has: page.getByRole('rowheader', { name: '2028', exact: true }) })
  for (const basis of ['Nominal', 'Real']) {
    await (await prepareProfessionalTarget(results.getByRole('button', { name: new RegExp(`^${basis}`) }))).click()
    await expect((await prepareProfessionalTarget(final.getByRole('cell').nth(2)))).toHaveText(await (await prepareProfessionalTarget(fixed.getByRole('cell').last())).innerText())
    await expect((await prepareProfessionalTarget(final.getByRole('cell').nth(2)))).toContainText(basis === 'Nominal' ? '678,038' : '638,930')
  }

  for (const [language, title, finished, label] of [
    ['FR', 'Monte Carlo canonique', /Simulation terminée|Échantillonnage terminé/, /centile/i],
    ['中文', '标准蒙特卡洛模拟', /抽样完成/, /百分位/],
  ] as const) {
    await chooseLanguage(page, language)
    await expect((await prepareProfessionalTarget(card(page).getByRole('heading', { name: title, exact: true })))).toBeVisible()
    await recordExplicitVolatility(page, '0')
    await chooseSeedAndTrials(page)
    await expect((await prepareProfessionalTarget(run(page)))).toContainText('4')
    await expect((await prepareProfessionalTarget(run(page)))).not.toContainText(/1[,.\s]?000/)
    await (await prepareProfessionalTarget(run(page))).click()
    await expect((await prepareProfessionalTarget(status(page)))).toContainText(finished)
    await expect((await prepareProfessionalTarget(bands(page).getByRole('columnheader', { name: label }).first()))).toBeVisible()
    await expect((await prepareProfessionalTarget(rate(page)))).toContainText('4 / 4')
  }
})

test('Pro authors a long Ontario solo plan and can interact with the App while the real worker samples', async ({ page }) => {
  test.setTimeout(60_000)
  await page.clock.setFixedTime(new Date('2026-11-25T12:00:00Z'))
  await page.goto('/')
  await chooseMode(page, 'professional')
  const fields = page.locator('label.field')
  for (const [label, value] of [
    [/^Current age/, '58'], [/^Target FIRE age/, '59'], [/^Life expectancy/, '85'],
    [/^Annual after-tax savings/, '0'], [/^TFSA$/, '190000'], [/^RRSP \/ RRIF$/, '0'],
    [/^Non-registered$/, '0'], [/^Non-registered cost base/, '0'], [/Estimated CPP\/QPP per year at 65/, '0'], [/OAS per year at 65/, '0'],
  ] as const) {
    await prepareProfessionalTarget(fields.filter({ hasText: label }))
    const input = fields.filter({ hasText: label }).locator('input:visible')
    await (await prepareProfessionalTarget(input)).fill(value)
    await (await prepareProfessionalTarget(input)).blur()
  }
  for (const [id, value] of [['earned-self', '12000'], ['rrsp-unused-undeducted-self', '0'], ['tfsa-available-room-self', '0']]) {
    const input = page.getByTestId(id)
    await (await prepareProfessionalTarget(input)).fill(value)
    await (await prepareProfessionalTarget(input)).blur()
  }
  await (await prepareProfessionalTarget(page.getByTestId('tfsa-withdrawal-add-self'))).click()
  await (await prepareProfessionalTarget(page.getByTestId(/^tfsa-withdrawal-remove-/))).click()
  const evidence = page.getByTestId('canonical-evidence')
  const showEvidence = async () => {
    if (!(await evidence.evaluate(panel => (panel as HTMLDetailsElement).open))) await (await prepareProfessionalTarget(evidence.locator('summary'))).press('Enter')
  }
  await showEvidence()
  await (await prepareProfessionalTarget(evidence.locator('select').filter({ has: page.locator('option[value="tfsaFirst"]') }))).selectOption('tfsaFirst')
  await showEvidence()
  await (await prepareProfessionalTarget(page.getByTestId('canonical-no-nonreg'))).click()
  await showEvidence()
  await (await prepareProfessionalTarget(page.getByTestId('canonical-working-spending'))).fill('11298.65')
  await (await prepareProfessionalTarget(page.getByTestId('canonical-retirement-spending'))).fill('12000')
  await (await prepareProfessionalTarget(page.getByTestId('canonical-enable'))).click()
  await expect((await prepareProfessionalTarget(overview(page).getByRole('rowheader')))).toHaveCount(28)
  await expect(volatility(page, 'legacy:account:nonReg')).toHaveCount(0)
  await expect((await prepareProfessionalTarget(volatility(page, 'legacy:account:tfsa')))).toBeVisible()
  for (const input of await card(page).getByTestId(/^canonical-mc-volatility-/).all()) {
    await (await prepareProfessionalTarget(input)).fill('10')
    await (await prepareProfessionalTarget(input)).blur()
  }

  await chooseSeedAndTrials(page, 200)
  const nominalButton = page.getByTestId('canonical-results').getByRole('button', { name: /^Nominal/ })
  await (await prepareProfessionalTarget(run(page))).click()
  await expect((await prepareProfessionalTarget(cancel(page)))).toBeEnabled()
  await (await prepareProfessionalTarget(nominalButton)).click()
  await expect((await prepareProfessionalTarget(nominalButton))).toHaveAttribute('aria-pressed', 'true')
  await expect((await prepareProfessionalTarget(cancel(page)))).toBeEnabled()
  await (await prepareProfessionalTarget(cancel(page))).click()
  await expect((await prepareProfessionalTarget(status(page)))).toContainText(/Cancelled/)
  await expect(bands(page)).toHaveCount(0)

  await chooseSeedAndTrials(page)
  await (await prepareProfessionalTarget(run(page))).click()
  await expect((await prepareProfessionalTarget(counts(page)))).toContainText('Requested 4')
  await expect((await prepareProfessionalTarget(bands(page).getByRole('rowheader')))).toHaveCount(28)
  const start = bands(page).getByRole('row').filter({ has: page.getByRole('rowheader', { name: '2026', exact: true }) })
  await expect((await prepareProfessionalTarget(start.getByRole('cell').first()))).toHaveText('4')
  const p10 = await (await prepareProfessionalTarget(start.getByRole('cell').nth(1))).innerText()
  const p90 = await (await prepareProfessionalTarget(start.getByRole('cell').nth(3))).innerText()
  expect(p10).not.toBe(p90)
})

test('ordinary Pro results keep the legacy mode and actual legacy worker output', async ({ page }) => {
  await page.goto('/')
  await chooseMode(page, 'professional')
  await expect(card(page)).toHaveCount(0)
  await expect((await prepareProfessionalTarget(page.locator('.summary')))).toBeVisible()
  const legacyRun = page.getByRole('button', { name: 'Run 1,000 simulations' })
  await (await prepareProfessionalTarget(legacyRun)).click()
  await expect((await prepareProfessionalTarget(page.locator('.mc-rate')))).toContainText('Pass rate under these model assumptions', { timeout: 45_000 })
  await expect((await prepareProfessionalTarget(legacyRun))).toBeEnabled()
  await expect(card(page)).toHaveCount(0)
})
