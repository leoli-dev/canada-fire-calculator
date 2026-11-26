import { expect, test, type Locator } from '@playwright/test'

async function tokenColor(locator: Locator, token: string) {
  return locator.evaluate((element, name) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    element.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, token)
}

async function appearance(locator: Locator) {
  return locator.evaluate(element => {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height, display: style.display, background: style.backgroundColor, color: style.color, border: style.borderColor, minHeight: style.minHeight }
  })
}

test('complete allocation is info, incomplete allocation warns, and unknown answers remain links', async ({ page }, testInfo) => {
  await page.goto('/#/guided/assets/allocation.tfsa')
  const total = page.locator('.allocation-total')
  await expect(total).toHaveClass(/\bui-callout-info\b/)
  await expect(total).toHaveCSS('background-color', await tokenColor(total, '--accent-tint'))
  await expect(total.locator('.ui-callout-icon')).toHaveText('i')
  const complete = await appearance(total)

  const field = page.locator('[data-field="savingsSplit.nonReg"]')
  await field.locator('input').fill('30')
  await expect(total).toHaveClass(/\bui-callout-warn\b/)
  await expect(total).toHaveCSS('background-color', await tokenColor(total, '--caution-tint'))
  await expect(total).toHaveCSS('color', await tokenColor(total, '--caution'))
  await expect(total.locator('.ui-callout-icon')).toHaveText('!')
  const incomplete = await appearance(total)
  await field.locator('input').fill('40')
  await expect(total).toHaveClass(/\bui-callout-info\b/)

  const unknown = field.getByRole('button', { name: 'I don’t know yet', exact: true })
  await expect(unknown).toHaveClass(/\bui-button-link\b/)
  await expect(unknown).toHaveCSS('padding', '0px')
  await expect(unknown).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
  await expect(unknown).toHaveCSS('text-decoration-line', 'underline')
  if (page.viewportSize()!.width <= 640) expect((await unknown.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  else expect((await unknown.boundingBox())!.height).toBeLessThan(40)
  const link = await appearance(unknown)
  await unknown.click()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state.answerMeta['savingsSplit.nonReg'].status)).toBe('unknown')
  await testInfo.attach('allocation-and-unknown.json', { body: JSON.stringify({ complete, incomplete, link }, null, 2), contentType: 'application/json' })
})

test('directory rows are unboxed and current-page styling follows keyboard navigation without changing the grid', async ({ page }, testInfo) => {
  await page.goto('/')
  const trigger = page.locator('.mobile-directory-trigger')
  if (await trigger.isVisible()) await trigger.click()
  const rows = page.locator('.category-navigation details[open] > div > button')
  const first = rows.nth(0), second = rows.nth(1)
  await expect(first).toHaveAttribute('aria-current', 'page')
  await expect(first).toHaveCSS('background-color', await tokenColor(first, '--accent-tint'))
  await expect(first).toHaveCSS('color', await tokenColor(first, '--accent'))
  await expect(second).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(second).toHaveCSS('color', await tokenColor(second, '--ink-2'))
  for (const row of [first, second]) {
    await expect(row).toHaveCSS('display', 'grid')
    await expect(row).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
    expect((await row.boundingBox())!.width).toBeLessThanOrEqual((await page.locator('.category-navigation').boundingBox())!.width)
  }
  const initial = { current: await appearance(first), other: await appearance(second) }
  await second.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.question-page')).toHaveAttribute('data-page-id', 'family.ages')
  if (await trigger.isVisible()) await trigger.click()
  await expect(first).not.toHaveAttribute('aria-current', 'page')
  await expect(second).toHaveAttribute('aria-current', 'page')
  await expect(second).toHaveCSS('background-color', await tokenColor(second, '--accent-tint'))
  await expect(first).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await testInfo.attach('directory-states.json', { body: JSON.stringify({ initial, next: await appearance(second) }, null, 2), contentType: 'application/json' })
})

test('mobile disclaimer keeps inline text while questionnaire footer and pager meet touch targets', async ({ page }, testInfo) => {
  // Show the existing footer link in this test context; application privacy handling is unchanged.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, get: () => false })
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, get: () => null })
    localStorage.setItem('fire-analytics-consent', 'denied')
  })
  await page.goto('/')
  const measurements = []
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    const header = page.locator('.header-disclaimer .term')
    const footer = page.getByTestId('analytics-footer').getByRole('button')
    for (const link of [header]) {
      await expect(link).toHaveClass(/\bui-button-link\b/)
      await expect(link).toHaveCSS('min-height', '0px')
      const size = await appearance(link)
      const lineHeight = await link.evaluate(element => parseFloat(getComputedStyle(element.closest('p')!).lineHeight))
      expect(size.height).toBeLessThan(44)
      expect(size.height).toBeLessThanOrEqual(lineHeight + 2)
    }
    await expect(footer).toHaveClass(/\bui-button-link\b/)
    expect((await footer.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect((await footer.boundingBox())!.width).toBeGreaterThanOrEqual(44)
    const back = page.locator('.question-pager button').first(), next = page.locator('.question-pager button').last()
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(48)
    measurements.push({ width, header: await appearance(header), footer: await appearance(footer), back: await appearance(back), next: await appearance(next) })
  }
  await testInfo.attach('inline-and-touch-sizes.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
})
