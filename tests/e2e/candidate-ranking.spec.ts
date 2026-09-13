import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const pending = JSON.parse(readFileSync(new URL('../../src/engine/__tests__/fixtures/pending-audit.json', import.meta.url), 'utf8'))
const p17 = pending.cases.find((item) => item.id === 'P17')!

async function openPlan(page: import('@playwright/test').Page, mode: 'guided' | 'professional', allFail = false) {
  await page.goto('/')
  await page.evaluate(({ inputs, mode, allFail }) => {
    const plan = allFail ? { ...inputs, balances: { tfsa: 0, rrsp: 0, nonReg: 0 }, cppAnnualAt65: 0, oasAnnualAt65: 0 } : inputs
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 10, state: {
      inputs: plan, entryMode: mode, guidedView: 'results', inputRevision: 0, resultRevision: 0,
    } }))
  }, { inputs: p17.inputs, mode, allFail })
  await page.reload()
}

for (const mode of ['guided', 'professional'] as const) {
  test(`${mode} timing recommends a funded P17 preview and applies the same ages`, async ({ page }) => {
    await openPlan(page, mode)
    const timing = page.locator('details').filter({ hasText: 'CPP/OAS timing suggestion' })
    await timing.locator('summary').click()
    await expect(timing.locator('.combo')).toContainText('Best combination')
    await expect(timing.locator('.combo')).not.toContainText('70 + OAS at 70')
    const combined = timing.locator('.card-head .use-strategy')
    await expect(combined).toBeVisible()
    const combo = (await timing.locator('.combo').innerText()).match(/CPP at (\d+) \+ OAS at (\d+)/)!
    await combined.click()
    const applied = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.inputs)
    expect([applied.cppStartAge, applied.oasStartAge]).toEqual([Number(combo[1]), Number(combo[2])])
    if (mode === 'guided') await page.getByRole('button', { name: 'Professional', exact: true }).click()
    await expect(timing.locator('.combo')).toContainText('already optimal')
  })

  test(`${mode} all-fail state offers no recommended application`, async ({ page }) => {
    await openPlan(page, mode, true)
    const timing = page.locator('details').filter({ hasText: 'CPP/OAS timing suggestion' })
    const strategy = page.locator('details').filter({ hasText: 'Withdrawal-order comparison' })
    await timing.locator('summary').click()
    await strategy.locator('summary').click()
    await expect(timing.locator('.combo')).toContainText('No valid, funded candidate')
    await expect(timing.locator('.combo')).toContainText('shortfall')
    await expect(timing.locator('.use-strategy')).toHaveCount(0)
    await expect(strategy).toContainText('No valid, funded candidate')
    await expect(strategy.locator('.use-strategy')).toHaveCount(0)
  })
}

async function openFundedUnranked(page: import('@playwright/test').Page,
  mode: 'guided' | 'professional', kind: 'searchLimit' | 'unsupported') {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await page.evaluate(({ mode, kind }) => {
    const saved = JSON.parse(localStorage.getItem('fire-inputs')!)
    saved.state.inputs.goal = 'dieWithZero'
    saved.state.inputs.balances.tfsa = kind === 'searchLimit' ? 10_000_000_000 : 5_000_000
    if (kind === 'unsupported') saved.state.inputs.principalResidence = {
      mode: 'planned', buyAtAge: 45, price: 500_000, downPayment: 500_000,
      appreciation: 0, netHoldingCostChange: 0, sellAtAge: null,
    }
    saved.state.entryMode = mode
    saved.state.guidedView = 'results'
    saved.state.resultRevision = saved.state.inputRevision
    localStorage.setItem('fire-inputs', JSON.stringify(saved))
  }, { mode, kind })
  await page.reload()
}

for (const mode of ['guided', 'professional'] as const) {
  for (const kind of ['searchLimit', 'unsupported'] as const) {
    test(`${mode} funded ${kind} objective stays unranked without a failure claim`, async ({ page }) => {
      await openFundedUnranked(page, mode, kind)
      const timing = page.locator('details').filter({ hasText: 'CPP/OAS timing suggestion' })
      const strategy = page.locator('details').filter({ hasText: 'Withdrawal-order comparison' })
      await timing.locator('summary').click()
      await strategy.locator('summary').click()
      await expect(timing.locator('.combo')).toContainText('funds the planned spending')
      await expect(strategy).toContainText('funds the planned spending')
      await expect(timing.locator('.combo')).not.toContainText('shortfall')
      await expect(timing.locator('.combo')).not.toContainText('failed plan')
      await expect(timing.locator('.use-strategy')).toHaveCount(0)
      await expect(strategy.locator('.use-strategy')).toHaveCount(0)
      await expect(timing.locator('.tag.best')).toHaveCount(0)
      await expect(strategy.locator('.tag.best')).toHaveCount(0)
      await expect(page.locator('.withdrawal-order-card')).not.toContainText('failed scenario')
    })
  }
}

test('unranked funded explanation is localized in French and Chinese', async ({ page }) => {
  await openFundedUnranked(page, 'professional', 'searchLimit')
  await page.getByRole('button', { name: 'FR', exact: true }).click()
  const frenchTiming = page.locator('details').filter({ hasText: 'Suggestion de calendrier RPC/SV' })
  await frenchTiming.locator('summary').click()
  await expect(frenchTiming.locator('.combo')).toContainText('Au moins une option finance les dépenses prévues')
  await page.getByRole('button', { name: '中文' }).click()
  const chineseTiming = page.locator('details').filter({ hasText: 'CPP/OAS 开领时机建议' })
  await expect(chineseTiming.locator('.combo')).toContainText('至少有一个候选能支付计划支出')
})
