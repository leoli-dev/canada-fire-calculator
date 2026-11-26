import type { Page } from '@playwright/test'

/** Existing ledger regressions explicitly exercise the comparison grid on phones. */
export async function showAnnualTable(page: Page) {
  const table = page.locator('.annual-sheet-view button').last()
  if (await table.isVisible()) {
    await table.click()
    await page.locator('.annual-sheet-header > button').focus()
  }
}
