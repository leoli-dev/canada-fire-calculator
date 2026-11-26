import { prepareProfessionalTarget, showProfessionalResults } from './fixtures/professional'
import { chooseMode, chooseLanguage } from './fixtures/app-bar'
import { expect, test, type Page } from '@playwright/test'

async function installWorkerGate(page: Page) {
  await page.addInitScript(() => {
    const jobs: Array<{ worker: MockWorker; request: any }> = []
    class MockWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      onmessageerror: ((event: MessageEvent) => void) | null = null
      terminated = false
      constructor(_url: URL, _options?: WorkerOptions) {}
      postMessage(request: any) { jobs.push({ worker: this, request }) }
      terminate() { this.terminated = true }
    }
    ;(window as any).Worker = MockWorker
    ;(window as any).__mcGate = {
      jobs,
      reply(index: number, changes = {}) {
        const job = jobs[index]
        job.worker.onmessage?.({ data: {
          ...job.request, status: 'success', result: {
            trials: 1000, successRate: index === 0 ? 0.12 : 0.93, bands: [],
            failures: { count: 0, earliestDepletedAge: null, medianDepletedAge: null,
              avgEarlyReturnFailed: null, avgEarlyReturnSuccess: null, worstTrajectory: null },
          }, ...changes,
        } } as MessageEvent)
      },
      fail(index: number) { jobs[index].worker.onerror?.({ message: 'controlled failure' } as ErrorEvent) },
    }
  })
}

async function openProfessional(page: Page) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await chooseMode(page, 'professional')
  await showProfessionalResults(page)
  await expect(page.getByRole('button', { name: 'Run 1,000 simulations' })).toBeVisible()
}

test('late A cannot replace B after an ordinary professional edit', async ({ page }) => {
  await installWorkerGate(page)
  await openProfessional(page)
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Run 1,000 simulations' }), page.getByRole('button', { name: 'Run 1,000 simulations', includeHidden: true }))).click()
  await (await prepareProfessionalTarget(page.getByLabel('Current age'))).fill('36')
  await (await prepareProfessionalTarget(page.getByLabel('Current age'))).press('Tab')
  await showProfessionalResults(page)
  await expect(page.getByRole('button', { name: 'Run 1,000 simulations' })).toBeEnabled()
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Run 1,000 simulations' }), page.getByRole('button', { name: 'Run 1,000 simulations', includeHidden: true }))).click()
  await page.evaluate(() => (window as any).__mcGate.reply(1))
  await expect(page.locator('.mc-rate')).toContainText('93%')
  await page.evaluate(() => (window as any).__mcGate.reply(0))
  await expect(page.locator('.mc-rate')).toContainText('93%')
})

test('same revision with different rule version is rejected', async ({ page }) => {
  await installWorkerGate(page)
  await openProfessional(page)
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Run 1,000 simulations' }), page.getByRole('button', { name: 'Run 1,000 simulations', includeHidden: true }))).click()
  await page.evaluate(() => (window as any).__mcGate.reply(0, { ruleVersion: 'obsolete-tax-rules' }))
  await expect(page.locator('.mc-rate')).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('Simulation failed')
  await showProfessionalResults(page)
  await expect(page.getByRole('button', { name: 'Run 1,000 simulations' })).toBeEnabled()
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Run 1,000 simulations' }), page.getByRole('button', { name: 'Run 1,000 simulations', includeHidden: true }))).click()
  await page.evaluate(() => (window as any).__mcGate.reply(1))
  await expect(page.locator('.mc-rate')).toContainText('93%')
  await expect(page.locator('.mc-rate')).toContainText('Pass rate under these model assumptions')
})

test('cancel, worker error, and retry recover the run control', async ({ page }) => {
  await installWorkerGate(page)
  await openProfessional(page)
  const run = page.getByRole('button', { name: 'Run 1,000 simulations' })
  await (await prepareProfessionalTarget(run)).click()
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Cancel simulation' }), page.getByRole('button', { name: 'Cancel simulation', includeHidden: true }))).click()
  await expect(run).toBeEnabled()
  await page.evaluate(() => (window as any).__mcGate.reply(0))
  await expect(page.locator('.mc-rate')).toHaveCount(0)
  await (await prepareProfessionalTarget(run)).click()
  await page.evaluate(() => (window as any).__mcGate.fail(1))
  await expect(page.getByRole('alert')).toContainText('Simulation failed')
  await expect(run).toBeEnabled()
  await (await prepareProfessionalTarget(run)).click()
  await page.evaluate(() => (window as any).__mcGate.reply(2, { status: 'error', error: 'controlled worker error' }))
  await expect(page.getByRole('alert')).toContainText('Simulation failed')
  await expect(run).toBeEnabled()
  await (await prepareProfessionalTarget(run)).click()
  await page.evaluate(() => (window as any).__mcGate.reply(3))
  await expect(page.locator('.mc-rate')).toContainText('93%')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('switching out of results terminates the worker and discards its response', async ({ page }) => {
  await installWorkerGate(page)
  await openProfessional(page)
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Run 1,000 simulations' }), page.getByRole('button', { name: 'Run 1,000 simulations', includeHidden: true }))).click()
  await chooseMode(page, 'guided')
  await expect(page.locator('.mc-rate')).toHaveCount(0)
  await page.evaluate(() => (window as any).__mcGate.reply(0))
  await expect(page.locator('.mc-rate')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__mcGate.jobs[0].worker.terminated)).toBe(true)
})

test('French and Chinese show the conditional rate and recovery controls', async ({ page }) => {
  await installWorkerGate(page)
  await openProfessional(page)
  await chooseLanguage(page, 'FR')
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Lancer 1 000 simulations' }), page.getByRole('button', { name: 'Lancer 1 000 simulations', includeHidden: true }))).click()
  await expect(page.getByRole('button', { name: 'Annuler la simulation' })).toBeVisible()
  await page.evaluate(() => (window as any).__mcGate.reply(0))
  await expect(page.locator('.mc-rate')).toContainText('Taux de réussite selon ces hypothèses du modèle')
  await chooseLanguage(page, '中文')
  await expect(page.locator('.mc-rate')).toContainText('当前模型假设下的通过比例')
})

test('scenario restore invalidates the running request without starting another', async ({ page }) => {
  await installWorkerGate(page)
  await openProfessional(page)
  const scenario = page.locator('details:not(.professional-group)').filter({ hasText: 'Scenario comparison' })
  await (await prepareProfessionalTarget(scenario.locator('summary'))).press('Enter')
  await (await prepareProfessionalTarget(scenario.getByRole('button', { name: 'Save current as A' }), scenario.getByRole('button', { name: 'Save current as A', includeHidden: true }))).click()
  await (await prepareProfessionalTarget(page.getByLabel('Current age'))).fill('36')
  await (await prepareProfessionalTarget(page.getByLabel('Current age'))).press('Tab')
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Run 1,000 simulations' }), page.getByRole('button', { name: 'Run 1,000 simulations', includeHidden: true }))).click()
  await (await prepareProfessionalTarget(scenario.getByRole('button', { name: 'Restore A' }), scenario.getByRole('button', { name: 'Restore A', includeHidden: true }))).click()
  await showProfessionalResults(page)
  await expect(page.getByRole('button', { name: 'Run 1,000 simulations' })).toBeEnabled()
  expect(await page.evaluate(() => (window as any).__mcGate.jobs.length)).toBe(1)
  await page.evaluate(() => (window as any).__mcGate.reply(0))
  await expect(page.locator('.mc-rate')).toHaveCount(0)
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Run 1,000 simulations' }), page.getByRole('button', { name: 'Run 1,000 simulations', includeHidden: true }))).click()
  await page.evaluate(() => (window as any).__mcGate.reply(1))
  await expect(page.locator('.mc-rate')).toContainText('93%')
})

async function generateGuidedThroughUi(page: Page, options: {
  locked?: boolean
  couple?: boolean
  ownerChoice?: 'self' | 'partner'
  stopAtReview?: boolean
} = {}) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.locator('.results-column')).toHaveCount(0)
  const visited = new Set<string>()
  while (true) {
    const article = page.locator('.question-page')
    const id = await article.getAttribute('data-page-id')
    if (!id || visited.has(id)) throw new Error(`Unexpected guided page ${id}`)
    visited.add(id)
    if (id === 'family.people') await (await prepareProfessionalTarget(page.getByRole('radio', {
      name: options.couple ? /Plan with my partner/ : /Plan for me/,
    }), page.getByRole('radio', { name: options.couple ? /Plan with my partner/ : /Plan for me/, includeHidden: true }))).check()
    else if (id === 'family.children') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /No children/ }), page.getByRole('radio', { name: /No children/, includeHidden: true }))).check()
    else if (id === 'family.province') await (await prepareProfessionalTarget(page.getByLabel('Province'))).selectOption('BC')
    else if (id === 'time.work') {
      for (const input of await page.locator('.question-page .question-number:visible').all()) {
        const value = await input.inputValue()
        await (await prepareProfessionalTarget(input)).fill('')
        await (await prepareProfessionalTarget(input)).fill(value)
      }
      await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'I do not have a target yet' }), page.getByRole('radio', { name: 'I do not have a target yet', includeHidden: true }))).check()
    }
    else if (id === 'saving.method') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /monthly amount/ }), page.getByRole('radio', { name: /monthly amount/, includeHidden: true }))).check()
    else if (id === 'budget.method') {
      await (await prepareProfessionalTarget(page.getByTestId('budget-debt-yes'))).check()
      await (await prepareProfessionalTarget(page.getByTestId('budget-tax-yes'))).check()
    }
    else if (id === 'work.after') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /No work income/ }), page.getByRole('radio', { name: /No work income/, includeHidden: true }))).check()
    else if (id === 'assets.identify') {
      await (await prepareProfessionalTarget(page.getByRole('checkbox', { name: 'TFSA' }), page.getByRole('checkbox', { name: 'TFSA', includeHidden: true }))).check()
      await (await prepareProfessionalTarget(page.getByRole('checkbox', { name: 'RRSP' }), page.getByRole('checkbox', { name: 'RRSP', includeHidden: true }))).check()
      await (await prepareProfessionalTarget(page.getByRole('checkbox', { name: /Non-registered/ }), page.getByRole('checkbox', { name: /Non-registered/, includeHidden: true }))).check()
      if (options.locked) await (await prepareProfessionalTarget(page.getByRole('checkbox', { name: /Locked retirement account/ }), page.getByRole('checkbox', { name: /Locked retirement account/, includeHidden: true }))).check()
    }
    else if (id === 'locked.balance') await (await prepareProfessionalTarget(page.locator('[data-field="lockedRetirement.balance"] input'))).fill('500000')
    else if (id === 'locked.access' && options.couple) {
      const age = page.locator('[data-field="lockedRetirement.accessibleAge"] input')
      const value = await age.inputValue()
      await (await prepareProfessionalTarget(age)).fill('')
      await (await prepareProfessionalTarget(age)).fill(value)
      const owner = page.getByLabel('Account owner')
      await expect(owner).toHaveValue('')
      if (options.ownerChoice) await (await prepareProfessionalTarget(owner)).selectOption(options.ownerChoice)
    }
    else if (id === 'assets.ownership') {
      // FE-43 A: every unanswered account row is named as the user's own.
      for (const group of await page.locator('.ownership-row .owner-choices').all()) {
        if (await group.locator('input:checked').count() === 0) await (await prepareProfessionalTarget(group.locator('input[value="self"]'))).check()
      }
    }
    else if (id === 'home.situation') await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'Rent' }), page.getByRole('radio', { name: 'Rent', includeHidden: true }))).check()
    else if (id === 'housing.other') {
      await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'No rental property' }), page.getByRole('radio', { name: 'No rental property', includeHidden: true }))).check()
      await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'No other loans' }), page.getByRole('radio', { name: 'No other loans', includeHidden: true }))).check()
    }
    else if (id === 'spending.method') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /overall budget/ }), page.getByRole('radio', { name: /overall budget/, includeHidden: true }))).check()
    else if (id === 'pension.self' || id === 'pension.partner')
      await (await prepareProfessionalTarget(page.getByRole('radio', { name: 'No employer pension' }), page.getByRole('radio', { name: 'No employer pension', includeHidden: true }))).check()
    else if (id === 'intent.legacy') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /do not need to reserve/ }), page.getByRole('radio', { name: /do not need to reserve/, includeHidden: true }))).check()
    else if (id === 'intent.spending') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /Keep my current/ }), page.getByRole('radio', { name: /Keep my current/, includeHidden: true }))).check()
    else if (id === 'invest.mix') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /Balanced 60\/40/ }), page.getByRole('radio', { name: /Balanced 60\/40/, includeHidden: true }))).check()
    else if (id === 'invest.strategy') await (await prepareProfessionalTarget(page.getByRole('radio', { name: /Paced RRSP withdrawals/ }), page.getByRole('radio', { name: /Paced RRSP withdrawals/, includeHidden: true }))).check()
    else {
      for (const input of await page.locator('.question-page .question-number:visible').all()) {
        const value = await input.inputValue()
        await (await prepareProfessionalTarget(input)).fill('')
        await (await prepareProfessionalTarget(input)).fill(value)
      }
    }
    const next = page.locator('.question-pager button').last()
    if (await (await prepareProfessionalTarget(next)).innerText() === 'Review answers') { await (await prepareProfessionalTarget(next)).click(); break }
    await (await prepareProfessionalTarget(next)).click()
  }
  expect(visited.size).toBeGreaterThan(20)
  await expect(page.locator('.results-column')).toHaveCount(0)
  const generate = page.getByRole('button', { name: 'Generate my results' })
  if (options.stopAtReview) return
  if (await generate.isDisabled()) throw new Error(await (await prepareProfessionalTarget(page.locator('.review-blockers'))).innerText())
  await (await prepareProfessionalTarget(generate)).click()
  await showProfessionalResults(page)
  await expect(page.locator('.results-column')).toBeVisible()
}

test('guided generation stays explicit and ordinary editing never starts Monte Carlo', async ({ page }) => {
  test.setTimeout(90_000)
  await installWorkerGate(page)
  await generateGuidedThroughUi(page)
  expect(await page.evaluate(() => (window as any).__mcGate.jobs.length)).toBe(0)
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Run 1,000 simulations' }), page.getByRole('button', { name: 'Run 1,000 simulations', includeHidden: true }))).click()
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Modify answers' }), page.getByRole('button', { name: 'Modify answers', includeHidden: true }))).click()
  await page.goto('/#/guided/family/family.ages')
  const age = page.getByLabel('Current age')
  await (await prepareProfessionalTarget(age)).fill('36')
  await (await prepareProfessionalTarget(age)).press('Tab')
  await expect(page.locator('.results-column')).toHaveCount(0)
  await page.evaluate(() => (window as any).__mcGate.reply(0))
  await expect(page.locator('.mc-rate')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__mcGate.jobs.length)).toBe(1)
  await page.goto('/#/guided/review')
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Generate my results' }), page.getByRole('button', { name: 'Generate my results', includeHidden: true }))).click()
  expect(await page.evaluate(() => (window as any).__mcGate.jobs.length)).toBe(1)
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Run 1,000 simulations' }), page.getByRole('button', { name: 'Run 1,000 simulations', includeHidden: true }))).click()
  await page.evaluate(() => (window as any).__mcGate.reply(1))
  await expect(page.locator('.mc-rate')).toContainText('93%')
  await page.evaluate(() => (window as any).__mcGate.reply(0))
  await expect(page.locator('.mc-rate')).toContainText('93%')
})

test('known locked withdrawal gap blocks deterministic recommendations', async ({ page }) => {
  await openProfessional(page)
  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: 'Use a locked DC pension' }).locator('input[type=checkbox]'))).check()
  await (await prepareProfessionalTarget(page.getByLabel('Current locked balance'))).fill('500000')
  await (await prepareProfessionalTarget(page.getByLabel('Current locked balance'))).press('Tab')
  await expect(page.locator('.summary')).toContainText('LIF limits and transfer rules have not been verified')
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: 'When can I retire?' }), page.getByRole('tab', { name: 'When can I retire?', includeHidden: true }))).click()
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await expect(page.locator('.summary')).toContainText('Locked-account withdrawal limits are unverified')
  await expect(page.locator('.summary')).not.toContainText('Earliest successful FIRE age:')
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: "What's my FIRE number?" }), page.getByRole('tab', { name: "What's my FIRE number?", includeHidden: true }))).click()
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await expect(page.locator('.summary')).toContainText('Locked-account withdrawal limits are unverified')
  await expect(page.locator('.summary')).not.toContainText('Your FIRE number:')
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: 'Will I hit my target?' }), page.getByRole('tab', { name: 'Will I hit my target?', includeHidden: true }))).click()
  await (await prepareProfessionalTarget(page.locator('.target-field input'))).fill('100000')
  await (await prepareProfessionalTarget(page.locator('.target-field input'))).press('Tab')
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await expect(page.locator('.summary')).toContainText('LIF limits and transfer rules have not been verified')
  const strategy = page.locator('details:not(.professional-group)').filter({ hasText: 'Withdrawal-order comparison' })
  const timing = page.locator('details:not(.professional-group)').filter({ hasText: 'CPP/OAS timing suggestion' })
  await (await prepareProfessionalTarget(strategy.locator('summary'))).press('Enter')
  await (await prepareProfessionalTarget(timing.locator('summary'))).press('Enter')
  await expect(strategy).toContainText('No strategy or start-age recommendation')
  await expect(timing).toContainText('No strategy or start-age recommendation')
  await expect(strategy.locator('.use-strategy')).toHaveCount(0)
  await expect(timing.locator('.use-strategy')).toHaveCount(0)
})

test('guided locked account cannot regain a green quick answer', async ({ page }) => {
  test.setTimeout(90_000)
  await generateGuidedThroughUi(page, { locked: true })
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: 'When can I retire?' }), page.getByRole('tab', { name: 'When can I retire?', includeHidden: true }))).click()
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await expect(page.locator('.summary')).toContainText('Locked-account withdrawal limits are unverified')
  await expect(page.locator('.summary')).not.toContainText('Earliest successful FIRE age:')
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: "What's my FIRE number?" }), page.getByRole('tab', { name: "What's my FIRE number?", includeHidden: true }))).click()
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await expect(page.locator('.summary')).toContainText('Locked-account withdrawal limits are unverified')
  await expect(page.locator('.summary')).not.toContainText('Your FIRE number:')
})

for (const owner of ['self', 'partner'] as const) {
  test(`guided couple explicitly confirms locked owner ${owner} and can generate results`, async ({ page }) => {
    test.setTimeout(90_000)
    await generateGuidedThroughUi(page, { locked: true, couple: true, ownerChoice: owner })
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
    expect(saved.inputs.lockedRetirement.owner).toBe(owner)
    expect(saved.answerMeta['lockedRetirement.owner']).toMatchObject({ status: 'confirmed', origin: 'user' })
    await expect(page.locator('.summary')).toHaveClass(/uncertain/)
    await chooseMode(page, 'professional')
    await showProfessionalResults(page)
  await expect(page.locator('.results-column')).toBeVisible()
    await chooseMode(page, 'guided')
    await showProfessionalResults(page)
  await expect(page.locator('.results-column')).toBeVisible()
    if (owner === 'partner') {
      await chooseMode(page, 'professional')
      await (await prepareProfessionalTarget(page.getByLabel('Account owner'))).selectOption('self')
      await chooseMode(page, 'guided')
      await expect(page.locator('.results-column')).toHaveCount(0)
      await page.goto('/#/guided/review')
      await expect(page.getByRole('button', { name: 'Generate my results' })).toBeDisabled()
      await page.goto('/#/guided/assets/locked.access')
      await expect(page.getByLabel('Account owner')).toHaveValue('')
      await (await prepareProfessionalTarget(page.getByLabel('Account owner'))).selectOption('self')
      await page.goto('/#/guided/review')
      await expect(page.getByRole('button', { name: 'Generate my results' })).toBeEnabled()
    }
  })
}

test('guided couple cannot accept default locked owner without choosing it', async ({ page }) => {
  test.setTimeout(90_000)
  await generateGuidedThroughUi(page, { locked: true, couple: true, stopAtReview: true })
  await expect(page.getByRole('button', { name: 'Generate my results' })).toBeDisabled()
  await expect(page.locator('.review-blockers')).toContainText('When can the locked money first be used')
  await page.goto('/#/guided/assets/locked.access')
  await (await prepareProfessionalTarget(page.getByLabel('Account owner'))).selectOption('self')
  await page.goto('/#/guided/review')
  await expect(page.getByRole('button', { name: 'Generate my results' })).toBeEnabled()
})

test('real worker completes a seeded request and re-enables Run', async ({ page }) => {
  test.setTimeout(60_000)
  await openProfessional(page)
  await (await prepareProfessionalTarget(page.getByRole('button', { name: 'Run 1,000 simulations' }), page.getByRole('button', { name: 'Run 1,000 simulations', includeHidden: true }))).click()
  await expect(page.locator('.mc-rate')).toContainText('Pass rate under these model assumptions', { timeout: 45_000 })
  await showProfessionalResults(page)
  await expect(page.getByRole('button', { name: 'Run 1,000 simulations' })).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('locked quick-answer boundary is localized in French and Chinese', async ({ page }) => {
  await openProfessional(page)
  await (await prepareProfessionalTarget(page.locator('label.field').filter({ hasText: 'Use a locked DC pension' }).locator('input[type=checkbox]'))).check()
  await (await prepareProfessionalTarget(page.getByLabel('Current locked balance'))).fill('500000')
  await (await prepareProfessionalTarget(page.getByLabel('Current locked balance'))).press('Tab')
  await chooseLanguage(page, 'FR')
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: 'Quand puis-je me retirer ?' }), page.getByRole('tab', { name: 'Quand puis-je me retirer ?', includeHidden: true }))).click()
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await expect(page.locator('.summary')).toContainText('Les limites de retrait des comptes immobilisés restent à vérifier')
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: 'Mon chiffre FIRE ?' }), page.getByRole('tab', { name: 'Mon chiffre FIRE ?', includeHidden: true }))).click()
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await expect(page.locator('.summary')).toContainText('Les limites de retrait des comptes immobilisés restent à vérifier')
  await chooseLanguage(page, '中文')
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: '我几岁能退休？' }), page.getByRole('tab', { name: '我几岁能退休？', includeHidden: true }))).click()
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await expect(page.locator('.summary')).toContainText('锁定账户提款限制尚未核验')
  await (await prepareProfessionalTarget(page.getByRole('tab', { name: '我的 FIRE 数字？' }), page.getByRole('tab', { name: '我的 FIRE 数字？', includeHidden: true }))).click()
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await expect(page.locator('.summary')).toContainText('锁定账户提款限制尚未核验')
})
