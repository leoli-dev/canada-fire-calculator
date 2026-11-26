import { expect, test, type Locator, type Page } from '@playwright/test'

const harness = '/tests/e2e/fixtures/ui-foundation-harness.html'

async function tokenColor(locator: Locator, token: string) {
  return locator.evaluate((element, name) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    const host = element.parentElement ?? document.body
    host.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, token)
}

async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 20; index++) {
    await page.keyboard.press('Tab')
    if (await target.evaluate(element => element === document.activeElement)) return
  }
  await expect(target).toBeFocused()
}

test('directory controls and row grids preserve desktop geometry and mobile visibility', async ({ page }, testInfo) => {
  await page.goto('/')
  const measurements = []
  for (const width of [1440, 1280, 1100]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.locator('.mobile-directory-trigger')).toBeHidden()
    await expect(page.locator('.directory-close')).toBeHidden()
    await page.evaluate(() => window.scrollTo(0, 0))
    const layout = await page.locator('.questionnaire-layout').boundingBox()
    const directory = await page.locator('.directory-shell').boundingBox()
    const question = await page.locator('.questionnaire-main').boundingBox()
    expect(directory!.width).toBe(240)
    expect(question!.width).toBeCloseTo(Math.min(720, layout!.width - 296), 0)
    expect(question!.x - directory!.x).toBe(296)
    expect(question!.y).toBe(directory!.y)
    const title = await page.locator('#question-title').boundingBox()
    expect(title!.y).toBeLessThan(400)
    const rows = page.locator('.category-navigation details[open] > div > button')
    expect(await rows.count()).toBeGreaterThan(0)
    for (const row of await rows.all()) {
      await expect(row).toHaveCSS('display', 'grid')
      expect((await row.boundingBox())!.width).toBeLessThanOrEqual(directory!.width)
    }
    measurements.push({ width, directory, question, title })
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('.mobile-directory-trigger')).toBeVisible()
    await expect(page.locator('.directory-shell')).toBeHidden()
    await page.locator('.mobile-directory-trigger').click()
    await expect(page.locator('.directory-close')).toBeVisible()
    await page.locator('.directory-close').click()
    await expect(page.locator('.directory-shell')).toBeHidden()
  }
  await testInfo.attach('desktop-geometry.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
})

test('loading buttons retain their accessible name, width and caller busy state under real CSS', async ({ page }) => {
  await page.goto(harness)
  const calculate = page.getByRole('button', { name: 'Calculate', exact: true })
  const width = (await calculate.boundingBox())!.width
  await expect(page.getByRole('button', { name: 'Caller busy' })).toHaveAttribute('aria-busy', 'true')
  await page.getByRole('button', { name: 'Start calculation' }).click()
  await expect(calculate).toHaveAccessibleName('Calculate')
  await expect(calculate).toBeDisabled()
  await expect(calculate).toHaveAttribute('aria-busy', 'true')
  expect((await calculate.boundingBox())!.width).toBe(width)
})

test('keyboard focus paints an accent ring above its halo and survives forced colors', async ({ page }, testInfo) => {
  await page.goto(harness)
  const controls = [page.getByRole('button', { name: 'Calculate', exact: true }), page.getByRole('button', { name: 'Selected option' }), page.getByRole('textbox', { name: 'Amount', exact: true })]
  for (const control of controls) {
    await tabTo(page, control)
    expect(await control.evaluate(element => element.matches(':focus-visible'))).toBe(true)
    const shadow = await control.evaluate(element => getComputedStyle(element).boxShadow)
    expect(shadow.startsWith(await tokenColor(control, '--accent'))).toBe(true)
    expect(shadow).toContain('0px 0px 0px 2px')
  }
  await page.getByRole('button', { name: 'Open sheet' }).click()
  const close = page.getByRole('button', { name: 'Close sheet' })
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(close).toBeFocused()
  expect((await close.evaluate(element => getComputedStyle(element).boxShadow)).startsWith(await tokenColor(close, '--accent'))).toBe(true)
  await testInfo.attach('dialog-focus.png', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
  await page.emulateMedia({ forcedColors: 'active' })
  await expect(close).toHaveCSS('outline-style', 'solid')
  await expect(close).toHaveCSS('outline-width', '2px')
  await page.keyboard.press('Escape')
  for (const control of controls) {
    await tabTo(page, control)
    await expect(control).toHaveCSS('outline-style', 'solid')
    await expect(control).toHaveCSS('outline-width', '2px')
  }
})

test('sheet follows effective native tab order through conditional and disclosure content', async ({ page }) => {
  await page.goto(harness)
  const trigger = page.getByRole('button', { name: 'Open sheet' })
  await trigger.click()
  const close = page.getByRole('button', { name: 'Close sheet' })
  await expect(close).toBeFocused()
  await expect(page.getByText('Hidden action', { exact: true })).toBeHidden()
  await expect(page.getByText('CSS hidden action', { exact: true })).toBeHidden()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Last visible action' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Visible action', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.locator('summary').filter({ hasText: 'Closed details' })).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Conditional action' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.locator('summary').filter({ hasText: 'Closed details' })).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

for (const position of ['middle', 'trailing']) {
  for (const selected of [false, true]) {
    test(`sheet traverses ${selected ? 'a selected' : 'an unchecked'} radio group in the ${position} position`, async ({ page }) => {
      await page.goto(`${harness}?radios=${position}${selected ? '&selected=one' : ''}`)
      const trigger = page.getByRole('button', { name: 'Open sheet' })
      await trigger.click()
      const close = page.getByRole('button', { name: 'Close sheet' })
      const first = page.getByRole('button', { name: 'First action' })
      const final = page.getByRole('button', { name: 'Final action' })
      const one = page.getByRole('radio', { name: 'One', exact: true })
      const two = page.getByRole('radio', { name: 'Two', exact: true })
      await expect(close).toBeFocused()

      // Enter backwards using native traversal in the middle, or the trap at the trailing boundary.
      if (position === 'middle') await final.focus()
      await page.keyboard.press('Shift+Tab')
      await expect(selected ? one : two).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(first).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(close).toBeFocused()

      // Reopen fresh controls: Thorium can remember an unchecked group's last focused member.
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
      await trigger.click()
      await expect(close).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(first).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(one).toBeFocused()
      if (selected) {
        await page.keyboard.press('ArrowRight')
        await expect(two).toBeFocused()
        await expect(two).toBeChecked()
        await expect(one).not.toBeChecked()
      } else {
        await expect(one).not.toBeChecked()
        await expect(two).not.toBeChecked()
      }
      await page.keyboard.press('Tab')
      await expect(position === 'middle' ? final : close).toBeFocused()
      if (position === 'middle') {
        await page.keyboard.press('Shift+Tab')
        // An unchecked group re-enters at its most recently focused member in Thorium.
        await expect(selected ? two : one).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(final).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(close).toBeFocused()
      }
      await page.keyboard.press('Shift+Tab')
      await expect(position === 'middle' ? final : two).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
    })
  }
}

test('guided sibling fields use 48px inputs and professional errors retain semantic borders', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    const { DEFAULT_INPUTS } = await import('/src/store.ts')
    const { refreshCanonicalFromLegacy } = await import('/src/engine/migration.ts')
    localStorage.setItem('fire-inputs', JSON.stringify({ version: 11, state: {
      inputs: DEFAULT_INPUTS, canonical: refreshCanonicalFromLegacy(null, DEFAULT_INPUTS), entryMode: 'guided', guidedView: 'questionnaire',
      questionAnswers: { 'assets.identify': ['tfsa', 'rrsp', 'nonReg'] }, inputRevision: 0, resultRevision: null,
    } }))
  })
  await page.reload()
  await page.getByRole('button', { name: '中文' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans')
  async function checkInput(input: Locator) {
    await expect(input).toBeVisible()
    await expect(input).toHaveCSS('font-size', '16px')
    expect((await input.boundingBox())!.height).toBe(48)
    expect(await input.evaluate(element => (element as HTMLInputElement).labels?.[0]?.textContent?.trim())).toBeTruthy()
  }
  await page.goto('/#/guided/saving/saving.earned')
  await checkInput(page.getByTestId('earned-self'))
  await page.goto('/#/guided/assets/account.rrsp.type')
  await page.getByTestId('registered-type-legacy:account:rrsp-rrif').check()
  await page.goto('/#/guided/assets/account.rrif.details')
  await checkInput(page.getByTestId('guided-rrif-opened-legacy:account:rrsp'))
  await page.goto('/#/guided/taxDetails/tax.tfsaRoom')
  await checkInput(page.getByTestId('tfsa-available-room-self'))
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const field = page.locator('label.field').filter({ hasText: 'Target FIRE age' })
  const age = field.locator('input')
  await age.fill('21')
  await expect(age).toHaveClass(/invalid-error/)
  await expect(age).toHaveAttribute('aria-invalid', 'true')
  await expect(age).toHaveCSS('border-top-color', await tokenColor(field, '--critical'))
  await expect(age).toHaveAccessibleDescription(await field.locator('.field-issue.error').innerText())
  await page.goto(harness)
  const warning = page.getByRole('textbox', { name: 'Warning' })
  await expect(warning).toHaveCSS('border-top-color', await tokenColor(warning, '--caution'))
})
