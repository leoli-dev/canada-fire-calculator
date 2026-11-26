import { prepareProfessionalTarget } from './fixtures/professional'
import { revealProfessionalEditor } from './fixtures/professional'
import { chooseLanguage } from './fixtures/app-bar'
import { existsSync } from 'node:fs'
import { expect, test, type Locator } from '@playwright/test'
import { canonicalAppPlan } from './fixtures/canonical-app-plan'

const executablePath = process.env.THORIUM_EXECUTABLE_PATH ?? '/Applications/Thorium.app/Contents/MacOS/Thorium'
test.use({ browserName: 'chromium', launchOptions: { executablePath } })
test.skip(!existsSync(executablePath), 'This suite requires the Thorium executable')

for (const browserLocale of ['en-US', 'fr-CA']) {
  test.describe(`French App, ${browserLocale} browser`, () => {
    test.use({ locale: browserLocale, permissions: ['clipboard-read', 'clipboard-write'] })

    test('budget evidence preserves typed decimal marks, pasted amounts and the difference between blank and zero', async ({ page }) => {
      await page.goto('/')
      await page.evaluate(envelope => {
        localStorage.setItem('fire-inputs', JSON.stringify(envelope))
      }, canonicalAppPlan())
      await page.reload()
      expect(await page.evaluate(() => navigator.language)).toBe(browserLocale)
      await chooseLanguage(page, 'FR')
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
      const evidence = page.getByTestId('canonical-evidence')
      const working = page.getByTestId('canonical-working-spending')
      const retirement = page.getByTestId('canonical-retirement-spending')
      const mixed = page.getByTestId('canonical-transition-spending')
      const mortgage = page.getByTestId('canonical-mortgage-excluded')
      const record = page.getByTestId('canonical-enable')
      const summary = evidence.locator('summary')
      await expect(summary).toHaveText('Registre annuel canonique')
      const open = async () => {
        await revealProfessionalEditor(page, evidence)
        if (!await evidence.evaluate(element => (element as HTMLDetailsElement).open)) await (await prepareProfessionalTarget(summary)).press('Enter')
      }
      const persistedSpending = () => page.evaluate(() =>
        JSON.parse(localStorage.getItem('fire-inputs')!).state.canonical.deterministicProjection.spending)
      await open()
      await expect(working).toHaveValue('')
      await expect(retirement).toHaveValue('')
      await expect(mixed).toHaveValue('')
      await expect(record).toBeDisabled()
      await (await prepareProfessionalTarget(working)).pressSequentially('11298,65')
      await (await prepareProfessionalTarget(retirement)).pressSequentially('12000,50')
      await (await prepareProfessionalTarget(mixed)).pressSequentially('350,25')
      await (await prepareProfessionalTarget(mortgage)).check()
      await (await prepareProfessionalTarget(record)).click()
      expect(await persistedSpending()).toEqual({
        workingSpending: { status: 'known', value: 11_298.65 },
        retirementSpending: { status: 'known', value: 12_000.50 },
        transitionSpending: { status: 'known', value: 350.25 },
        scheduledMortgagePaymentsExcluded: { status: 'known', value: true },
      })

      const paste = async (field: Locator, value: string) => {
        await page.evaluate(text => navigator.clipboard.writeText(text), value)
        await (await prepareProfessionalTarget(field)).focus()
        await (await prepareProfessionalTarget(field)).press('ControlOrMeta+V')
      }
      await open()
      await (await prepareProfessionalTarget(working)).pressSequentially('0')
      await paste(retirement, '12\u202f000,50')
      await paste(mixed, '35,0,25')
      await (await prepareProfessionalTarget(mortgage)).check()
      await expect(record).toBeDisabled()
      await (await prepareProfessionalTarget(mixed)).fill('')
      await expect(record).toBeDisabled()
      await paste(mixed, '350.25')
      await expect(record).toBeEnabled()
      await (await prepareProfessionalTarget(retirement)).fill('')
      await expect(record).toBeDisabled()
      await paste(retirement, '12\u202f000,50')
      await (await prepareProfessionalTarget(record)).click()
      expect(await persistedSpending()).toMatchObject({
        workingSpending: { status: 'known', value: 0 },
        retirementSpending: { status: 'known', value: 12_000.50 },
        transitionSpending: { status: 'known', value: 350.25 },
      })

      await open()
      await (await prepareProfessionalTarget(working)).pressSequentially('11,298')
      await chooseLanguage(page, 'EN')
      await expect(page.locator('html')).toHaveAttribute('lang', 'en')
      await expect(summary).toHaveText('Canonical annual ledger')
      await open()
      await expect(working).toHaveValue('')
      await expect(record).toBeDisabled()
      expect((await persistedSpending()).workingSpending).toEqual({ status: 'known', value: 0 })
    })
  })
}
