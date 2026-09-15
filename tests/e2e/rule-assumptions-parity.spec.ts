import { expect, test } from '@playwright/test'
import { BLOCKED_SOURCES, coverageFor, rowAuthorities } from '../../src/engine/rules/coverageMatrix'

/** Every authority the panel should render for one jurisdiction: the rows'
 *  primary and additional URLs, and the additional sources the sources block
 *  lists for that pack. A blocked URL rendered as a row's *primary* is a guard
 *  failure, so it is recorded here rather than skipped. */
function renderedAuthorities(province: string): { url: string; rowId?: string; primary?: boolean }[] {
  const out: { url: string; rowId?: string; primary?: boolean }[] = []
  for (const [id, credit] of Object.entries(coverageFor(province).implemented))
    for (const authority of rowAuthorities(credit))
      out.push({ url: authority.url, rowId: id, primary: authority.primary })
  return out
}

test('guided and professional expose the same pinned rule versions, policy and sources', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const professional = page.getByTestId('rule-assumptions')
  await expect(professional).toContainText('CA-ON-tax-2026-legacy-v1')
  await expect(professional).toContainText('CA-CCB-2026-07-v1')
  await page.getByLabel('Province').selectOption('BC')
  await expect(professional).toContainText('CA-BC-tax-2026-legacy-v1')
  const text = await professional.innerText()
  const links = await professional.getByTestId('rule-sources').locator('a')
    .evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))
  // Four tax sources, three CCB sources (amounts, thresholds and, since BE-38
  // B2, the statutory rates the computation applies), and the three
  // GIS/Allowance ones the panel discloses: the quarterly page and the two
  // tables its fitted reduction is measured against. The per-entry coverage
  // links are a separate list and are asserted in the coverage test below.
  expect(links).toHaveLength(10)
  expect(links[0]).toContain('/2026/')
  expect(links[2]).toContain('t4032bc-july')
  expect(links[4]).toContain('/2026/')
  expect(links[6]).toContain('laws-lois.justice.gc.ca')
  expect(links[7]).toContain('2026-quarterly-july-september')
  expect(links[8]).toContain('table1_gis_for_single')
  expect(links[9]).toContain('allowance/benefit-amount')
  // The paths the pack does not price are named, not buried in a limitation
  // string nothing rendered.
  await expect(professional.getByTestId('rule-gis-not-modelled')).toContainText('prior-year base period')
  await expect(professional.getByTestId('rule-gis-not-modelled')).toContainText('provincial GIS or Allowance top-ups')
  // BE-38 B1: the tax figures the pack does not year-switch are named too.
  await expect(professional.getByTestId('rule-tax-not-modelled')).toContainText('GST/HST credit')
  await expect(professional.getByTestId('rule-tax-not-modelled')).toContainText('low-income tax reductions')

  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  const guided = page.getByTestId('rule-assumptions')
  await expect(guided).toContainText('CA-BC-tax-2026-legacy-v1')
  await expect(guided).toContainText('CA-CCB-2026-07-v1')
  // The pack that priced the numbers, stated in both modes.
  await expect(guided).toContainText('Selected tax rule year: 2026')
  // BE-38 B3: the panel states the current coverage position rather than the
  // placeholder the earlier slices carried.
  await expect(guided).toContainText('per-jurisdiction coverage list')
  expect(await guided.getByTestId('rule-sources').locator('a')
    .evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))).toEqual(links)
  expect(text).toBe(await guided.innerText())

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await page.getByLabel('Province').selectOption('MB')
  await expect(professional).toContainText('Manitoba\'s dedicated 2026 CRA guide')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  await expect(guided).toContainText('Manitoba\'s dedicated 2026 CRA guide')
  await expect(guided.getByTestId('rule-sources').locator('a')).toHaveCount(11)

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await page.getByLabel('Province').selectOption('NL')
  const nlLinks = await professional.getByTestId('rule-sources').locator('a').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))
  expect(nlLinks[3]).toContain('t4008nl-july')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  expect(await guided.getByTestId('rule-sources').locator('a').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))).toEqual(nlLinks)

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  await page.getByLabel('Province').selectOption('PE')
  // BE-38 B3 resolved the PE conflict against the dedicated July 2026 guide:
  // the retained $142,250 is gone and the resolution is what the panel states.
  await expect(professional).toContainText('Resolved 2026-09-15')
  await expect(professional).toContainText('$142,520')
  await expect(professional).toContainText('$3.726')
  // The old value may appear only inside the resolution sentence that says it
  // was replaced, never as a live threshold.
  await expect(professional).toContainText("replacing January's $142,250")
  const peLinks = await professional.getByTestId('rule-sources').locator('a').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))
  expect(peLinks[2]).toContain('/2026/t4032-pe-7-26e.pdf')
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  await expect(guided).toContainText('$142,520')
  expect(await guided.getByTestId('rule-sources').locator('a').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))).toEqual(peLinks)
})

test('the credit coverage matrix is visible in both modes and claims no completeness', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.getByRole('button', { name: 'Professional', exact: true }).click()
  const professional = page.getByTestId('rule-assumptions')
  const coverage = professional.getByTestId('rule-coverage')
  await expect(coverage).toBeVisible()
  // The matrix names the rows that are inside the numbers and the rows that are
  // not, and it never asserts a complete return.
  await expect(coverage).toHaveAttribute('data-coverage-jurisdiction', 'ON')
  await expect(professional.getByTestId('rule-coverage-implemented-federal-income-tax-brackets')).toBeVisible()
  await expect(professional.getByTestId('rule-coverage-implemented-ontario-health-premium')).toBeVisible()
  await expect(professional.getByTestId('rule-coverage-implemented-ontario-surtax')).toBeVisible()
  await expect(professional.getByTestId('rule-coverage-unsupported-provincial-low-income-reduction')).toBeVisible()
  await expect(professional.getByTestId('rule-coverage-unsupported-provincial-refundable-benefits')).toContainText('GST/HST')
  // The negative statement travels with the matrix rather than being implied by
  // a summary label.
  await expect(professional.getByTestId('rule-coverage-caveat'))
    .toContainText('does not model the GST/HST credit')

  // BE-38 B3 review (BL2 / round 3): the panel tells the reader that each
  // implemented entry links its cited authority and states its own limit. Tie
  // that claim to the DOM: every implemented row must render its `sourceURL`
  // *and* every `additionalSourceURLs` entry, in that order, and a row that
  // declares a limitation must render it.
  const implementedOn = coverageFor('ON').implemented
  expect(Object.keys(implementedOn).length).toBeGreaterThan(5)
  expect(await coverage.locator('ul').first().locator('li').count())
    .toBe(Object.keys(implementedOn).length)
  for (const [id, credit] of Object.entries(implementedOn)) {
    const row = professional.getByTestId(`rule-coverage-implemented-${id}`)
    const hrefs = await row.locator('a').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')))
    // The whole cited set is rendered, primary first, so a reader never has to
    // follow only the one link the assertion used to check.
    expect(hrefs, id).toEqual([credit.sourceURL, ...(credit.additionalSourceURLs ?? [])])
    expect(hrefs.every(href => href?.startsWith('https://')), id).toBe(true)
    if (credit.limitationId) {
      await expect(professional.getByTestId(`rule-coverage-limitation-${id}`), id).toBeVisible()
      await expect(row, id).toHaveAttribute('data-limited', 'true')
    }
    // BE-38 B3 review (round 4): every authority states which case it is in —
    // the figures a person content-checked against it and the date, or the plain
    // statement that it is listed only. The two are read from the registry, so
    // the DOM claim cannot outrun `CONTENT_VERIFIED_AUTHORITIES`.
    const statuses = await row.locator('.rule-coverage-authority-status')
      .evaluateAll(nodes => nodes.map(node => node.textContent ?? ''))
    expect(statuses.length, id).toBe(hrefs.length)
    const checked = rowAuthorities(credit).filter(authority => authority.checkedFigures)
    statuses.forEach((status, index) => {
      if (checked.some(authority => authority.url === hrefs[index])) {
        expect(status, `${id} ${hrefs[index]}`).toContain('content-checked')
        expect(status, `${id} ${hrefs[index]}`).toContain(credit.verifiedAt)
      } else {
        expect(status, `${id} ${hrefs[index]}`).toContain('listed only — content not checked')
      }
    })
    await expect(row, id).toHaveAttribute('data-content-checked', String(credit.contentChecked === true))
  }

  // BE-38 B3 review (round 3, B1/B2): the two blocking rows' qualifications are
  // rendered next to their links, including the words that make the citation
  // honest — the RAMQ derivation pending the 2026 Schedule K, and the bot gate
  // on the Revenu Québec rates page.
  await page.getByLabel('Province').selectOption('QC')
  await expect(professional.getByTestId('rule-coverage-implemented-quebec-ramq-premium')
    .locator('a').first()).toHaveAttribute('href',
    coverageFor('QC').implemented['quebec-ramq-premium'].sourceURL)
  await expect(professional.getByTestId('rule-coverage-limitation-quebec-ramq-premium'))
    .toContainText('Schedule K')
  await expect(professional.getByTestId('rule-coverage-limitation-quebec-income-tax-brackets'))
    .toContainText('403')
  await expect(professional.getByTestId('rule-coverage-implemented-quebec-income-tax-brackets'))
    .toContainText('Ministry of Finance')
  await page.getByLabel('Province').selectOption('ON')

  // Every province must render the matrix with both directions populated.
  for (const province of ['BC', 'MB', 'PE', 'QC', 'NL', 'NU']) {
    await page.getByLabel('Province').selectOption(province)
    await expect(coverage, province).toHaveAttribute('data-coverage-jurisdiction', province)
    expect(Number(await coverage.getAttribute('data-coverage-implemented')), `${province} implemented`).toBeGreaterThan(5)
    expect(Number(await coverage.getAttribute('data-coverage-unsupported')), `${province} unsupported`).toBeGreaterThan(3)
    await expect(professional.getByTestId('rule-coverage-unsupported-provincial-refundable-benefits'), province).toBeVisible()
  }

  // BE-38 B3 review (round 4, B2): no recorded-blocked URL may render
  // unqualified, in any province, in either the coverage list or the sources
  // block. This is generic over `BLOCKED_SOURCES`, so the next gate recorded for
  // any jurisdiction is covered without editing this test.
  //
  // BE-38 B4 follow-up: NT and NU joined the loop. Nunavut's own regulation is
  // now recorded in `BLOCKED_SOURCES` (HTTP 403 and Cloudflare's challenge to
  // curl, to an API request context and to headless Chromium), and it is that
  // row's *primary* source, so the rendered row must carry the gate and the
  // qualification. Without NT/NU in this loop the guard could not reach the one
  // recorded block the territory slice left behind.
  for (const province of ['ON', 'QC', 'PE', 'BC', 'NL', 'MB', 'NT', 'NU']) {
    await page.getByLabel('Province').selectOption(province)
    for (const authority of renderedAuthorities(province)) {
      if (!BLOCKED_SOURCES[authority.url]) continue
      const link = professional.locator(`a[href="${authority.url}"]`)
      expect(await link.count(), `${province} ${authority.url} is rendered`).toBeGreaterThan(0)
      const marker = BLOCKED_SOURCES[authority.url].gateMarker
      const rowText = authority.rowId
        ? await professional.getByTestId(`rule-coverage-implemented-${authority.rowId}`).innerText()
        : await professional.getByTestId('rule-sources').innerText()
      expect(rowText, `${province} ${authority.url} must name its gate ${marker}`).toContain(marker)
      if (authority.rowId)
        await expect(professional.getByTestId(`rule-coverage-limitation-${authority.rowId}`),
          `${province} ${authority.rowId} must render its qualification`).toBeVisible()
    }
  }
  await page.getByLabel('Province').selectOption('ON')

  // Same matrix, same caveat, in guided mode.
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
  await page.goto('/#/guided/review')
  const guided = page.getByTestId('rule-assumptions')
  const guidedCoverage = guided.getByTestId('rule-coverage')
  await expect(guidedCoverage).toBeVisible()
  await expect(guided.getByTestId('rule-coverage-caveat')).toContainText('does not model the GST/HST credit')
  await expect(guided.getByTestId('rule-coverage-unsupported-provincial-low-income-reduction')).toBeVisible()
  expect(await guidedCoverage.getAttribute('data-coverage-implemented'))
    .toBe(await coverage.getAttribute('data-coverage-implemented'))
})

test('the coverage caveat and the QC qualifications are native in French and Chinese', async ({ page }) => {
  // BE-38 B3 review (NB4 + round 3): the panel rendered the English artifact
  // string in every language. It now reads the catalogue, so each language must
  // render its own copy of the caveat — and of the two qualifications this
  // round added, which are the disclosure the blocking findings turned on.
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.locator('.entry-mode button').nth(1).click()
  // The Province field's label is translated, so select by the option value,
  // which is the jurisdiction code in every language.
  const provinceSelect = page.locator('select:has(option[value="QC"])')
  await provinceSelect.selectOption('QC')
  const caveatEn = await page.getByTestId('rule-coverage-caveat').innerText()
  const ramqEn = await page.getByTestId('rule-coverage-limitation-quebec-ramq-premium').innerText()
  const bracketsEn = await page.getByTestId('rule-coverage-limitation-quebec-income-tax-brackets').innerText()
  expect(caveatEn).toContain('does not model the GST/HST credit')
  expect(ramqEn).toContain('Schedule K')
  expect(bracketsEn).toContain('403')
  for (const [lang, marker, ramqMarker] of [
    ['fr', 'TPS/TVH', 'annexe K'], ['zh', 'GST/HST', '\u9644\u8868 K'],
  ] as const) {
    await page.evaluate(l => localStorage.setItem('fire-lang', l), lang)
    await page.reload()
    await page.locator('.entry-mode button').nth(1).click()
    await page.locator('select:has(option[value="QC"])').selectOption('QC')
    const caveat = page.getByTestId('rule-coverage-caveat')
    await expect(caveat, lang).toContainText(marker)
    await expect(caveat, lang).not.toHaveText(caveatEn)
    const ramq = page.getByTestId('rule-coverage-limitation-quebec-ramq-premium')
    await expect(ramq, lang).toContainText(ramqMarker)
    await expect(ramq, `${lang} RAMQ qualification is an English placeholder`).not.toHaveText(ramqEn)
    // 403 is the same number in every language; the sentence around it is not.
    const brackets = page.getByTestId('rule-coverage-limitation-quebec-income-tax-brackets')
    await expect(brackets, lang).toContainText('403')
    await expect(brackets, `${lang} bracket qualification is an English placeholder`).not.toHaveText(bracketsEn)
  }
})

test('the two authority states and the gate label render natively in all three languages', async ({ page }) => {
  // BE-38 B3 review (round 4): the panel now says which authorities a person
  // content-checked and which are merely listed, and names the gate on a blocked
  // link. Those labels are the disclosure this round added, so they may not be
  // English placeholders in fr/zh — the round-3 defect shape exactly.
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.locator('.entry-mode button').nth(1).click()
  // Ontario's probate row is the content-checked one: both of its authorities
  // are in `CONTENT_VERIFIED_AUTHORITIES`, so both statuses carry the date and
  // the figures a person read. The federal brackets row is the merely-listed
  // case, so the two labels are both observable on one surface.
  await page.locator('select:has(option[value="ON"])').selectOption('ON')
  const probateRow = page.getByTestId('rule-coverage-implemented-probate-and-estate-fees')
  const en = await probateRow.innerText()
  expect(en, 'ON probate must render its checked citation').toContain('content-checked 2026-09-17')
  expect(en).toContain('$15 for each $1,000')
  const bracketsRow = page.getByTestId('rule-coverage-implemented-federal-income-tax-brackets')
  const bracketsEn = await bracketsRow.innerText()
  expect(bracketsEn).toContain('listed only — content not checked')
  expect(bracketsEn, 'a merely-listed row may not claim checked figures').not.toContain('content-checked')
  // PE's own page is the round-4 blocked authority; a real navigation is the
  // only way to see its gate, and the panel must name it there.
  await page.locator('select:has(option[value="PE"])').selectOption('PE')
  const peRow = page.getByTestId('rule-coverage-implemented-provincial-income-tax-brackets')
  const peEn = await peRow.innerText()
  expect(peEn).toContain('CAPTCHA')
  expect(peEn).toContain('listed only — content not checked')
  expect(peEn).toContain('142,520')
  const peSources = await page.getByTestId('rule-sources').innerText()
  expect(peSources, 'the sources block must name the gate on the PE government link').toContain('CAPTCHA')
  for (const [lang, checked, listed, gate] of [
    ['fr', 'contenu vérifié', 'seulement citée', 'CAPTCHA'],
    ['zh', '逐项核对内容', '仅列出', 'CAPTCHA'],
  ] as const) {
    await page.evaluate(l => localStorage.setItem('fire-lang', l), lang)
    await page.reload()
    await page.locator('.entry-mode button').nth(1).click()
    await page.locator('select:has(option[value="ON"])').selectOption('ON')
    const frText = await page.getByTestId('rule-coverage-implemented-probate-and-estate-fees').innerText()
    expect(frText, `${lang} checked label`).toContain(checked)
    expect(frText, `${lang} probate row is not an English placeholder`).not.toBe(en)
    const listedText = await page.getByTestId('rule-coverage-implemented-federal-income-tax-brackets').innerText()
    expect(listedText, `${lang} listed label`).toContain(listed)
    expect(listedText, `${lang} listed row is not an English placeholder`).not.toBe(bracketsEn)
    await page.locator('select:has(option[value="PE"])').selectOption('PE')
    const peText = await page.getByTestId('rule-coverage-implemented-provincial-income-tax-brackets').innerText()
    expect(peText, `${lang} gate label`).toContain(gate)
    expect(peText, `${lang} PE row is not an English placeholder`).not.toBe(peEn)
  }
})

test('the recorded PE gate is a 200-answering URL, so the guard cannot be a status sweep', async ({ page }) => {
  // BE-38 B3 review (round 4, B2): the recorded PE authority answers 200 to
  // `curl` and to an API request context; only a real Chromium navigation is
  // redirected to the Radware CAPTCHA (verified by hand when the entry was
  // recorded, and the navigation is what the entry's reason states). A
  // status-code sweep therefore cannot see it, which is why the guard keys off
  // `BLOCKED_SOURCES` and why the panel must *render* the gate rather than
  // trusting a link check. The rendered marker itself is asserted in the test
  // above, from the live DOM.
  const gated = Object.entries(BLOCKED_SOURCES).find(([url]) => url.includes('princeedwardisland'))
  expect(gated, 'the PE entry must still be recorded').toBeDefined()
  const [url, blocked] = gated!
  expect(blocked.reason, 'the recorded reason is the 200-vs-navigation discrepancy').toMatch(/200/)
  expect(blocked.reason, 'the recorded gate is the CAPTCHA the navigation shows').toMatch(/CAPTCHA/)
  expect(blocked.gateMarker, 'the marker is what every language must render').toBe('CAPTCHA')
  expect(url.startsWith('https://')).toBe(true)
})
