import { expect, test, type Page } from '@playwright/test'

async function seed(page: Page, kind: 'nonReg' | 'property', mode: 'guided' | 'professional') {
  await page.goto('/')
  await page.evaluate(async ({ kind, mode }) => {
    localStorage.clear()
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    const inputs = { ...DEFAULT_INPUTS, currentAge: 40, fireAge: 60, lifeExpectancy: 60,
      annualSavings: 0, retirementSpending: kind === 'nonReg' ? 500_000 : 0,
      inflation: .02, returns: { tfsa: 0, rrsp: 0, nonReg: 0 }, fees: 0,
      nonRegDistributionYield: 0, cppAnnualAt65: 0, oasAnnualAt65: 0,
      balances: { tfsa: 0, rrsp: 0, nonReg: kind === 'nonReg' ? 500_000 : 0 },
      nonRegBook: kind === 'nonReg' ? 500_000 : 0,
      savingsSplit: { tfsa: kind === 'nonReg' ? 0 : 1, rrsp: 0, nonReg: kind === 'nonReg' ? 1 : 0 },
      strategy: 'nonRegFirst' as const, fireTargetAssets: kind === 'property' ? 475_000 : null,
      investmentProperties: kind === 'property' ? [{ value: 500_000, acb: 500_000,
        saleExpenses: 20_000, appreciation: 0, annualRent: 0, sellAtAge: 60 }] : [] }
    const canonical = refreshCanonicalFromLegacy(null, inputs)
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs, canonical, entryMode: mode, guidedView: mode === 'guided' ? 'results' : 'questionnaire',
      inputRevision: 0, resultRevision: mode === 'guided' ? 0 : null,
    } }))
  }, { kind, mode })
  await page.reload()
  await expect(page.locator('.results-column')).toBeVisible()
}

for (const mode of ['guided', 'professional'] as const) {
  test(`${mode} same-year unknown and loss ACB cannot produce a FIRE number`, async ({ page }) => {
    await seed(page, 'nonReg', mode)
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('fire-inputs')!)
      saved.state.inputs.currentAge = 60
      saved.state.inputs.inflation = 0
      saved.state.canonical.people[0].ageInBaseYear = 60
      saved.state.canonical.accounts.find((a: { kind: string }) => a.kind === 'nonReg').acb =
        { status: 'unknown', reason: 'broker record unavailable' }
      localStorage.setItem('fire-inputs', JSON.stringify(saved))
    })
    await page.reload()
    await page.getByRole('tab', { name: "What's my FIRE number?" }).click()
    await expect(page.locator('.summary')).not.toContainText('Your FIRE number:')
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('fire-inputs')!)
      saved.state.inputs.nonRegBook = 700_000
      saved.state.canonical.accounts.find((a: { kind: string }) => a.kind === 'nonReg').acb =
        { status: 'known', value: 700_000 }
      localStorage.setItem('fire-inputs', JSON.stringify(saved))
    })
    await page.reload()
    await page.getByRole('tab', { name: "What's my FIRE number?" }).click()
    await expect(page.locator('.summary')).not.toContainText('Your FIRE number:')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })

  test(`${mode} zero-gain rental sale withholds after-tax estate and Scenario A comparison`, async ({ page }) => {
    await seed(page, 'property', mode)
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('fire-inputs')!)
      saved.state.inputs.currentAge = 60
      saved.state.inputs.fireAge = 60
      saved.state.inputs.investmentProperties[0].saleExpenses = 0
      saved.state.inputs.fireTargetAssets = null
      const property = saved.state.canonical.properties.find((p: { kind: string }) => p.kind === 'investment')
      property.saleExpenses = { status: 'known', value: 0 }
      saved.state.canonical.people[0].ageInBaseYear = 60
      saved.state.canonical.people[0].retirementAge = 60
      saved.state.scenarioA = structuredClone(saved.state.inputs)
      saved.state.scenarioACanonical = structuredClone(saved.state.canonical)
      localStorage.setItem('fire-inputs', JSON.stringify(saved))
    })
    await page.reload()
    await expect(page.locator('.summary')).not.toContainText('Estate value (after tax):')
    await expect(page.locator('.summary')).toContainText('required income or capital-gain tax facts')
    for (const [language, phrase] of [['FR', 'gains en capital'], ['中文', '资本利得税务事实']] as const) {
      await page.getByRole('button', { name: language, exact: true }).click()
      await expect(page.locator('.summary')).toContainText(phrase)
    }
    await page.getByRole('button', { name: 'EN', exact: true }).click()
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('fire-inputs')!)
      saved.state.inputs.investmentProperties = []
      saved.state.canonical.properties = []
      localStorage.setItem('fire-inputs', JSON.stringify(saved))
    })
    await page.reload()
    const comparison = page.getByTestId('scenario-comparison')
    await comparison.locator('summary').click()
    await expect(comparison).toContainText('Comparison unavailable')
    await expect(comparison.getByRole('row', { name: /Scenario A/ })).toContainText('—')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })
  test(`${mode} FIRE-number tab withholds P06 false sufficiency at desktop and 320px`, async ({ page }) => {
    await seed(page, 'nonReg', mode)
    await page.getByRole('tab', { name: "What's my FIRE number?" }).click()
    await expect(page.locator('.summary .verdict')).toContainText('cannot preserve the verified nominal cost history')
    await expect(page.locator('.summary')).not.toContainText('Your FIRE number:')
    for (const [language, phrase] of [['FR', "ne peut pas conserver l'historique"], ['中文', '无法保留非注册投资']] as const) {
      await page.getByRole('button', { name: language, exact: true }).click()
      await expect(page.locator('.summary .verdict')).toContainText(phrase)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })

  test(`${mode} target tab withholds investment-property sale verdict and amount`, async ({ page }) => {
    await seed(page, 'property', mode)
    await page.getByRole('tab', { name: 'Will I hit my target?' }).click()
    await expect(page.locator('.summary .verdict')).toContainText('needs verified nominal cost, selling expenses')
    await expect(page.locator('.summary .verdict')).not.toContainText('475,000')
    for (const [language, phrase] of [['FR', 'frais de vente'], ['中文', '出售费用']] as const) {
      await page.getByRole('button', { name: language, exact: true }).click()
      await expect(page.locator('.summary .verdict')).toContainText(phrase)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })

  test(`${mode} retirement age and spending ceiling withhold an untaxed property sale`, async ({ page }) => {
    await seed(page, 'property', mode)
    await page.getByRole('tab', { name: 'When can I retire?' }).click()
    await expect(page.locator('.summary .verdict')).toContainText('investment-property sale')
    await expect(page.locator('.summary')).not.toContainText('Earliest successful FIRE age:')
    for (const [language, phrase] of [['FR', 'immeuble de placement'], ['中文', '投资房出售']] as const) {
      await page.getByRole('button', { name: language, exact: true }).click()
      await expect(page.locator('.summary .verdict')).toContainText(phrase)
    }
    await page.getByRole('button', { name: 'EN', exact: true }).click()
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('fire-inputs')!)
      saved.state.inputs.goal = 'dieWithZero'
      localStorage.setItem('fire-inputs', JSON.stringify(saved))
    })
    await page.reload()
    await expect(page.locator('.summary')).toContainText('investment-property sale')
    await expect(page.locator('.summary')).not.toContainText('Max sustainable after-tax spending')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })

  test(`${mode} retirement age withholds a funded plan that realizes a non-registered loss`, async ({ page }) => {
    await seed(page, 'nonReg', mode)
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('fire-inputs')!)
      // A funded plan (so the withheld positive verdict is what is under test),
      // funded by disposing of a holding whose cost exceeds its value.
      saved.state.inputs.currentAge = 60
      saved.state.inputs.fireAge = 60
      saved.state.inputs.lifeExpectancy = 62
      saved.state.inputs.retirementSpending = 40_000
      saved.state.inputs.inflation = 0
      saved.state.inputs.nonRegBook = 700_000
      saved.state.canonical.people[0].ageInBaseYear = 60
      saved.state.canonical.people[0].retirementAge = 60
      saved.state.canonical.accounts.find((a: { kind: string }) => a.kind === 'nonReg').acb =
        { status: 'known', value: 700_000 }
      localStorage.setItem('fire-inputs', JSON.stringify(saved))
    })
    await page.reload()
    await page.getByRole('tab', { name: 'When can I retire?' }).click()
    await expect(page.locator('.summary .verdict')).toContainText('verified nominal cost history')
    await expect(page.locator('.summary')).not.toContainText('Earliest successful FIRE age:')
  })
}
