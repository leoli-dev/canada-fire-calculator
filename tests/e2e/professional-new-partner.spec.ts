import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { chooseMode } from './fixtures/app-bar'
import { revealProfessionalEditor } from './fixtures/professional'
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('fire-inputs')!).state)
async function enter(page: Page, path: string, field: string, value: string) {
  await page.goto(`/#/guided/${path}`)
  const input = page.locator(`[data-field="${field}"] input`)
  await input.fill(value)
  await input.blur()
}
async function confirmPartner(page: Page, age: string, cpp: string, oas: string) {
  await enter(page, 'family/family.ages', 'partner.currentAge', age)
  await enter(page, 'income/cpp.partner', 'partner.cppAnnualAt65', cpp)
  await enter(page, 'income/oas.partner', 'partner.oasAnnualAt65', oas)
}
const partner = (state: any) => state.canonical.people.find((person: any) => person.role === 'partner')
const sources = (state: any, id: string) => state.canonical.incomeSources.filter((source: any) => source.recipientId === id || source.id.startsWith(`${id}:`))
const amounts = (rows: any[]) => Object.fromEntries(rows.filter(row => row.kind === 'cpp' || row.kind === 'oas').map(row => [row.kind, row.annualAmount]))
const partnerMeta = (state: any) => Object.fromEntries(Object.entries(state.answerMeta).filter(([key]) => key.startsWith('partner.')))


// Genuine fire-inputs bytes captured from de44b23 through Guided 52/975/875
// -> Professional Single -> native migration-settle-single; never hand-edited.
const historicalEnvelope = readFileSync(new URL('./fixtures/pre-fix-settled-single.json', import.meta.url), 'utf8')
for (const mode of ['professional', 'guided'] as const) test(
  'old settled single creates an unconfirmed new counterpart through ' + mode + ' and persists fresh confirmations',
  async ({ page }, info) => {
    await page.addInitScript(raw => { if (!localStorage.getItem('fire-inputs')) localStorage.setItem('fire-inputs', raw) }, historicalEnvelope)
    await page.goto('/#/guided/family/family.people')
    const artifact = JSON.parse(historicalEnvelope).state
    const before = await saved(page)
    expect(before.inputs.partner).toBeNull()
    expect(before.canonical.people).toHaveLength(1)
    expect(before.canonical.orphanedPeople).toBeUndefined()
    expect(before.canonical.people.some((person: any) => person.role === 'partner')).toBe(false)
    expect(before.canonical).toEqual(artifact.canonical)
    expect(before.answerMeta).toEqual(artifact.answerMeta)
    for (const key of ['partner.currentAge', 'partner.cppAnnualAt65', 'partner.oasAnnualAt65']) expect(before.answerMeta[key]).toMatchObject({ status: 'confirmed', origin: 'user' })
    await chooseMode(page, mode)
    const profile = page.locator('[data-group="profile"]')
    if (mode === 'professional') {
      await revealProfessionalEditor(page, profile)
      await profile.locator('select').last().selectOption('couple')
    } else {
      await page.goto('/#/guided/family/family.people')
      // This old Pro save still has the earlier Couple questionnaire choice;
      // make the explicit native Single -> Couple change rather than re-check it.
      await page.getByRole('radio', { name: 'Single Plan for me', exact: true }).check()
      expect(partnerMeta(await saved(page))).toEqual(partnerMeta(before))
      await page.getByRole('radio', { name: 'Couple (combined) Plan with my partner', exact: true }).check()
    }
    const created = await saved(page)
    expect(created.inputs.partner).toMatchObject({ currentAge: 35, cppAnnualAt65: 10000, oasAnnualAt65: 8700 })
    const newPerson = partner(created)
    expect(newPerson).toMatchObject({ ageInBaseYear: 35, cppAnnualAt65: 10000, oasAnnualAt65: 8700 })
    expect(newPerson.cppAmountSource).toBeUndefined()
    expect(newPerson.oasAmountSource).toBeUndefined()
    expect(amounts(sources(created, newPerson.id))).toEqual({ cpp: { status: 'known', value: 10000 }, oas: { status: 'known', value: 8700 } })
    await info.attach('historical-single-new-counterpart', { body: JSON.stringify({ oldCanonical: before.canonical, oldPartnerMeta: partnerMeta(before), newPerson, newRows: sources(created, newPerson.id), newPartnerMeta: partnerMeta(created) }), contentType: 'application/json' })
    for (const meta of Object.values(partnerMeta(created)) as Array<{ status: string }>) expect(['confirmed', 'estimated']).not.toContain(meta.status)
    for (const [key, meta] of Object.entries(before.answerMeta)) if (!key.startsWith('partner.') && key !== 'household') expect(created.answerMeta[key]).toEqual(meta)
    expect(created.draftByField).toEqual(before.draftByField)
    for (const key of ['scenarioA', 'scenarioACanonical', 'scenarioAAnswerMeta']) expect(created[key]).toEqual(before[key])
    await page.reload()
    const reloaded = await saved(page)
    expect(reloaded.inputs).toEqual(created.inputs)
    expect(reloaded.canonical).toEqual(created.canonical)
    expect(reloaded.answerMeta).toEqual(created.answerMeta)
    await chooseMode(page, 'professional')
    await expect(profile.locator(':scope > summary small')).toContainText('1 of 6 tracked answers confirmed')
    const benefits = page.locator('[data-group="benefits"] > summary small')
    await expect(benefits).toHaveText('Needs review')
    await chooseMode(page, 'guided')
    await confirmPartner(page, '44', '1250', '1125')
    const fresh = await saved(page)
    expect(partner(fresh)).toMatchObject({ ageInBaseYear: 44, cppAnnualAt65: 1250, oasAnnualAt65: 1125, cppAmountSource: { source: 'manual' }, oasAmountSource: { source: 'manual' } })
    expect(amounts(sources(fresh, newPerson.id))).toEqual({ cpp: { status: 'known', value: 1250 }, oas: { status: 'known', value: 1125 } })
    for (const key of ['partner.currentAge', 'partner.cppAnnualAt65', 'partner.oasAnnualAt65']) {
      expect(fresh.answerMeta[key]).toMatchObject({ status: 'confirmed', origin: 'user' })
      expect(fresh.answerMeta[key].updatedAt).not.toBe(before.answerMeta[key].updatedAt)
    }
    await chooseMode(page, 'professional')
    await expect(profile.locator(':scope > summary small')).toContainText('2 of 6 tracked answers confirmed')
    await expect(benefits).toContainText('2 of 8 tracked answers confirmed')
    await page.reload()
    const final = await saved(page)
    expect(final.inputs).toEqual(fresh.inputs)
    expect(final.canonical).toEqual(fresh.canonical)
    expect(final.answerMeta).toEqual(fresh.answerMeta)
    await expect(profile.locator(':scope > summary small')).toContainText('2 of 6 tracked answers confirmed')
    await expect(benefits).toContainText('2 of 8 tracked answers confirmed')
  })
