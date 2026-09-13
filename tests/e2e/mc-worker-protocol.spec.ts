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
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Run 1,000 simulations' })).toBeVisible()
}

test('late A cannot replace B after an ordinary professional edit', async ({ page }) => {
  await installWorkerGate(page)
  await openProfessional(page)
  await page.getByRole('button', { name: 'Run 1,000 simulations' }).click()
  await page.getByLabel('Current age').fill('36')
  await page.getByLabel('Current age').press('Tab')
  await expect(page.getByRole('button', { name: 'Run 1,000 simulations' })).toBeEnabled()
  await page.getByRole('button', { name: 'Run 1,000 simulations' }).click()
  await page.evaluate(() => (window as any).__mcGate.reply(1))
  await expect(page.locator('.mc-rate')).toContainText('93%')
  await page.evaluate(() => (window as any).__mcGate.reply(0))
  await expect(page.locator('.mc-rate')).toContainText('93%')
})

test('same revision with different rule version is rejected', async ({ page }) => {
  await installWorkerGate(page)
  await openProfessional(page)
  await page.getByRole('button', { name: 'Run 1,000 simulations' }).click()
  await page.evaluate(() => (window as any).__mcGate.reply(0, { ruleVersion: 'obsolete-tax-rules' }))
  await expect(page.locator('.mc-rate')).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('Simulation failed')
  await expect(page.getByRole('button', { name: 'Run 1,000 simulations' })).toBeEnabled()
  await page.getByRole('button', { name: 'Run 1,000 simulations' }).click()
  await page.evaluate(() => (window as any).__mcGate.reply(1))
  await expect(page.locator('.mc-rate')).toContainText('93%')
  await expect(page.locator('.mc-rate')).toContainText('Pass rate under these model assumptions')
})

test('cancel, worker error, and retry recover the run control', async ({ page }) => {
  await installWorkerGate(page)
  await openProfessional(page)
  const run = page.getByRole('button', { name: 'Run 1,000 simulations' })
  await run.click()
  await page.getByRole('button', { name: 'Cancel simulation' }).click()
  await expect(run).toBeEnabled()
  await page.evaluate(() => (window as any).__mcGate.reply(0))
  await expect(page.locator('.mc-rate')).toHaveCount(0)
  await run.click()
  await page.evaluate(() => (window as any).__mcGate.fail(1))
  await expect(page.getByRole('alert')).toContainText('Simulation failed')
  await expect(run).toBeEnabled()
  await run.click()
  await page.evaluate(() => (window as any).__mcGate.reply(2, { status: 'error', error: 'controlled worker error' }))
  await expect(page.getByRole('alert')).toContainText('Simulation failed')
  await expect(run).toBeEnabled()
  await run.click()
  await page.evaluate(() => (window as any).__mcGate.reply(3))
  await expect(page.locator('.mc-rate')).toContainText('93%')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('switching out of results terminates the worker and discards its response', async ({ page }) => {
  await installWorkerGate(page)
  await openProfessional(page)
  await page.getByRole('button', { name: 'Run 1,000 simulations' }).click()
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await expect(page.locator('.mc-rate')).toHaveCount(0)
  await page.evaluate(() => (window as any).__mcGate.reply(0))
  await expect(page.locator('.mc-rate')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__mcGate.jobs[0].worker.terminated)).toBe(true)
})

test('French and Chinese show the conditional rate and recovery controls', async ({ page }) => {
  await installWorkerGate(page)
  await openProfessional(page)
  await page.getByRole('button', { name: 'FR', exact: true }).click()
  await page.getByRole('button', { name: 'Lancer 1 000 simulations' }).click()
  await expect(page.getByRole('button', { name: 'Annuler la simulation' })).toBeVisible()
  await page.evaluate(() => (window as any).__mcGate.reply(0))
  await expect(page.locator('.mc-rate')).toContainText('Taux de réussite selon ces hypothèses du modèle')
  await page.getByRole('button', { name: '中文' }).click()
  await expect(page.locator('.mc-rate')).toContainText('当前模型假设下的通过比例')
})

test('scenario restore invalidates the running request without starting another', async ({ page }) => {
  await installWorkerGate(page)
  await openProfessional(page)
  const scenario = page.locator('details').filter({ hasText: 'Scenario comparison' })
  await scenario.locator('summary').click()
  await scenario.getByRole('button', { name: 'Save current as A' }).click()
  await page.getByLabel('Current age').fill('36')
  await page.getByLabel('Current age').press('Tab')
  await page.getByRole('button', { name: 'Run 1,000 simulations' }).click()
  await scenario.getByRole('button', { name: 'Restore A' }).click()
  await expect(page.getByRole('button', { name: 'Run 1,000 simulations' })).toBeEnabled()
  expect(await page.evaluate(() => (window as any).__mcGate.jobs.length)).toBe(1)
  await page.evaluate(() => (window as any).__mcGate.reply(0))
  await expect(page.locator('.mc-rate')).toHaveCount(0)
  await page.getByRole('button', { name: 'Run 1,000 simulations' }).click()
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
    if (id === 'family.people') await page.getByRole('radio', {
      name: options.couple ? /Plan with my partner/ : /Plan for me/,
    }).check()
    else if (id === 'family.children') await page.getByRole('radio', { name: /No children/ }).check()
    else if (id === 'family.province') await page.getByLabel('Province').selectOption('BC')
    else if (id === 'time.work') {
      for (const input of await page.locator('.question-page .question-number:visible').all()) {
        const value = await input.inputValue()
        await input.fill('')
        await input.fill(value)
      }
      await page.getByRole('radio', { name: 'I do not have a target yet' }).check()
    }
    else if (id === 'saving.method') await page.getByRole('radio', { name: /monthly amount/ }).check()
    else if (id === 'work.after') await page.getByRole('radio', { name: /No work income/ }).check()
    else if (id === 'assets.identify') {
      await page.getByRole('checkbox', { name: 'TFSA' }).check()
      await page.getByRole('checkbox', { name: 'RRSP' }).check()
      await page.getByRole('checkbox', { name: /Non-registered/ }).check()
      if (options.locked) await page.getByRole('checkbox', { name: /Locked retirement account/ }).check()
    }
    else if (id === 'locked.balance') await page.locator('[data-field="lockedRetirement.balance"] input').fill('500000')
    else if (id === 'locked.access' && options.couple) {
      const age = page.locator('[data-field="lockedRetirement.accessibleAge"] input')
      const value = await age.inputValue()
      await age.fill('')
      await age.fill(value)
      const owner = page.getByLabel('Account owner')
      await expect(owner).toHaveValue('')
      if (options.ownerChoice) await owner.selectOption(options.ownerChoice)
    }
    else if (id === 'home.situation') await page.getByRole('radio', { name: 'Rent' }).check()
    else if (id === 'housing.other') {
      await page.getByRole('radio', { name: 'No rental property' }).check()
      await page.getByRole('radio', { name: 'No other loans' }).check()
    }
    else if (id === 'spending.method') await page.getByRole('radio', { name: /overall budget/ }).check()
    else if (id === 'pension.self' || id === 'pension.partner')
      await page.getByRole('radio', { name: 'No employer pension' }).check()
    else if (id === 'intent.legacy') await page.getByRole('radio', { name: /do not need to reserve/ }).check()
    else if (id === 'intent.spending') await page.getByRole('radio', { name: /Keep my current/ }).check()
    else if (id === 'invest.mix') await page.getByRole('radio', { name: /Balanced 60\/40/ }).check()
    else if (id === 'invest.strategy') await page.getByRole('radio', { name: /Paced RRSP withdrawals/ }).check()
    else {
      for (const input of await page.locator('.question-page .question-number:visible').all()) {
        const value = await input.inputValue()
        await input.fill('')
        await input.fill(value)
      }
    }
    const next = page.locator('.question-pager button').last()
    if (await next.innerText() === 'Review answers') { await next.click(); break }
    await next.click()
  }
  expect(visited.size).toBeGreaterThan(20)
  await expect(page.locator('.results-column')).toHaveCount(0)
  const generate = page.getByRole('button', { name: 'Generate my results' })
  if (options.stopAtReview) return
  if (await generate.isDisabled()) throw new Error(await page.locator('.review-blockers').innerText())
  await generate.click()
  await expect(page.locator('.results-column')).toBeVisible()
}

test('guided generation stays explicit and ordinary editing never starts Monte Carlo', async ({ page }) => {
  test.setTimeout(90_000)
  await installWorkerGate(page)
  await generateGuidedThroughUi(page)
  expect(await page.evaluate(() => (window as any).__mcGate.jobs.length)).toBe(0)
  await page.getByRole('button', { name: 'Run 1,000 simulations' }).click()
  await page.getByRole('button', { name: 'Modify answers' }).click()
  await page.goto('/#/guided/family/family.ages')
  const age = page.getByLabel('Current age')
  await age.fill('36')
  await age.press('Tab')
  await expect(page.locator('.results-column')).toHaveCount(0)
  await page.evaluate(() => (window as any).__mcGate.reply(0))
  await expect(page.locator('.mc-rate')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__mcGate.jobs.length)).toBe(1)
  await page.goto('/#/guided/review')
  await page.getByRole('button', { name: 'Generate my results' }).click()
  expect(await page.evaluate(() => (window as any).__mcGate.jobs.length)).toBe(1)
  await page.getByRole('button', { name: 'Run 1,000 simulations' }).click()
  await page.evaluate(() => (window as any).__mcGate.reply(1))
  await expect(page.locator('.mc-rate')).toContainText('93%')
  await page.evaluate(() => (window as any).__mcGate.reply(0))
  await expect(page.locator('.mc-rate')).toContainText('93%')
})

test('known locked withdrawal gap blocks deterministic recommendations', async ({ page }) => {
  await openProfessional(page)
  await page.locator('label.field').filter({ hasText: 'Use a locked DC pension' }).locator('input[type=checkbox]').check()
  await page.getByLabel('Current locked balance').fill('500000')
  await page.getByLabel('Current locked balance').press('Tab')
  await expect(page.locator('.summary')).toContainText('LIF limits and transfer rules have not been verified')
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await page.getByRole('tab', { name: 'When can I retire?' }).click()
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await expect(page.locator('.summary')).toContainText('Locked-account withdrawal limits are unverified')
  await expect(page.locator('.summary')).not.toContainText('Earliest successful FIRE age:')
  await page.getByRole('tab', { name: "What's my FIRE number?" }).click()
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await expect(page.locator('.summary')).toContainText('Locked-account withdrawal limits are unverified')
  await expect(page.locator('.summary')).not.toContainText('Your FIRE number:')
  await page.getByRole('tab', { name: 'Will I hit my target?' }).click()
  await page.locator('.target-field input').fill('100000')
  await page.locator('.target-field input').press('Tab')
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await expect(page.locator('.summary')).toContainText('LIF limits and transfer rules have not been verified')
  const strategy = page.locator('details').filter({ hasText: 'Withdrawal-order comparison' })
  const timing = page.locator('details').filter({ hasText: 'CPP/OAS timing suggestion' })
  await strategy.locator('summary').click()
  await timing.locator('summary').click()
  await expect(strategy).toContainText('No strategy or start-age recommendation')
  await expect(timing).toContainText('No strategy or start-age recommendation')
  await expect(strategy.locator('.use-strategy')).toHaveCount(0)
  await expect(timing.locator('.use-strategy')).toHaveCount(0)
})

test('guided locked account cannot regain a green quick answer', async ({ page }) => {
  test.setTimeout(90_000)
  await generateGuidedThroughUi(page, { locked: true })
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await page.getByRole('tab', { name: 'When can I retire?' }).click()
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await expect(page.locator('.summary')).toContainText('Locked-account withdrawal limits are unverified')
  await expect(page.locator('.summary')).not.toContainText('Earliest successful FIRE age:')
  await page.getByRole('tab', { name: "What's my FIRE number?" }).click()
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
    await page.getByRole('button', { name: 'Professional', exact: true }).click()
    await expect(page.locator('.results-column')).toBeVisible()
    await page.getByRole('button', { name: 'Guided', exact: true }).click()
    await expect(page.locator('.results-column')).toBeVisible()
    if (owner === 'partner') {
      await page.getByRole('button', { name: 'Professional', exact: true }).click()
      await page.getByLabel('Account owner').selectOption('self')
      await page.getByRole('button', { name: 'Guided', exact: true }).click()
      await expect(page.locator('.results-column')).toHaveCount(0)
      await page.goto('/#/guided/review')
      await expect(page.getByRole('button', { name: 'Generate my results' })).toBeDisabled()
      await page.goto('/#/guided/assets/locked.access')
      await expect(page.getByLabel('Account owner')).toHaveValue('')
      await page.getByLabel('Account owner').selectOption('self')
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
  await page.getByLabel('Account owner').selectOption('self')
  await page.goto('/#/guided/review')
  await expect(page.getByRole('button', { name: 'Generate my results' })).toBeEnabled()
})

test('real worker completes a seeded request and re-enables Run', async ({ page }) => {
  test.setTimeout(60_000)
  await openProfessional(page)
  await page.getByRole('button', { name: 'Run 1,000 simulations' }).click()
  await expect(page.locator('.mc-rate')).toContainText('Pass rate under these model assumptions', { timeout: 45_000 })
  await expect(page.getByRole('button', { name: 'Run 1,000 simulations' })).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('locked quick-answer boundary is localized in French and Chinese', async ({ page }) => {
  await openProfessional(page)
  await page.locator('label.field').filter({ hasText: 'Use a locked DC pension' }).locator('input[type=checkbox]').check()
  await page.getByLabel('Current locked balance').fill('500000')
  await page.getByLabel('Current locked balance').press('Tab')
  await page.getByRole('button', { name: 'FR', exact: true }).click()
  await page.getByRole('tab', { name: 'Quand puis-je me retirer ?' }).click()
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await expect(page.locator('.summary')).toContainText('Les limites de retrait des comptes immobilisés restent à vérifier')
  await page.getByRole('tab', { name: 'Mon chiffre FIRE ?' }).click()
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await expect(page.locator('.summary')).toContainText('Les limites de retrait des comptes immobilisés restent à vérifier')
  await page.getByRole('button', { name: '中文' }).click()
  await page.getByRole('tab', { name: '我几岁能退休？' }).click()
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await expect(page.locator('.summary')).toContainText('锁定账户提款限制尚未核验')
  await page.getByRole('tab', { name: '我的 FIRE 数字？' }).click()
  await expect(page.locator('.summary')).toHaveClass(/uncertain/)
  await expect(page.locator('.summary')).toContainText('锁定账户提款限制尚未核验')
})
