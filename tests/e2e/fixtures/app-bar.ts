import { expect, type Page } from '@playwright/test'

/** Follow the mobile shell's visible entry points instead of clicking hidden desktop controls. */
export async function chooseMode(page: Page, mode: 'guided' | 'professional') {
  const menu = page.getByTestId('app-menu')
  if (await menu.isVisible()) await menu.click()
  await page.locator('.entry-mode:visible button').nth(mode === 'guided' ? 0 : 1).click()
}

export async function expectMode(page: Page, mode: 'guided' | 'professional') {
  const menu = page.getByTestId('app-menu')
  if (await menu.isVisible()) await menu.click()
  await expect(page.locator('.entry-mode:visible button').nth(mode === 'guided' ? 0 : 1)).toHaveAttribute('aria-pressed', 'true')
  if (await menu.isVisible()) await page.keyboard.press('Escape')
}

export async function openLanguages(page: Page) {
  const trigger = page.getByTestId('app-language')
  if (await trigger.isVisible()) await trigger.click()
  return page.locator('.langs:visible')
}

export async function chooseLanguage(page: Page, language: string) {
  const languages = await openLanguages(page)
  await languages.getByRole('button', { name: language, exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', language === 'FR' ? 'fr' : language === '中文' ? 'zh-Hans' : 'en')
}

export async function expectSelectedLanguage(page: Page, language: string) {
  const languages = await openLanguages(page)
  const selected = languages.getByRole('button', { name: language, exact: true })
  await expect(selected).toHaveAttribute('aria-pressed', 'true')
  await expect(selected).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  if (await page.getByTestId('app-language').isVisible()) await page.keyboard.press('Escape')
}
