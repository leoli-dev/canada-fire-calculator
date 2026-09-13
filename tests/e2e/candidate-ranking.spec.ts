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
    await expect(timing.locator('.combo')).toContainText('No feasible candidate')
    await expect(timing.locator('.combo')).toContainText('shortfall')
    await expect(timing.locator('.use-strategy')).toHaveCount(0)
    await expect(strategy).toContainText('No feasible candidate')
    await expect(strategy.locator('.use-strategy')).toHaveCount(0)
  })
}
