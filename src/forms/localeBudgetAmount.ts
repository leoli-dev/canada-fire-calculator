/** Strict amount entry in the app's language, independent of browser locale.
 * Keep the user's text intact: malformed punctuation is invalid, never dropped.
 * French accepts either comma or ungrouped dot decimals; grouped French paste
 * accepts spaces, NBSP and narrow NBSP only in complete three-digit groups.
 */
export function parseBudgetAmount(raw: string, language: string): number | null {
  const text = raw.trim()
  const french = new Intl.NumberFormat(language).formatToParts(1.5).some(part => part.type === 'decimal' && part.value === ',')
  const valid = french
    ? /^(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:,\d+)?$/.test(text) || /^\d*\.\d+$/.test(text)
    : /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text) || /^\.\d+$/.test(text)
  if (!valid) return null
  const normalized = french ? text.replace(/[ \u00a0\u202f]/g, '').replace(',', '.') : text.replace(/,/g, '')
  const amount = Number(normalized)
  return Number.isFinite(amount) && amount >= 0 && amount <= Number.MAX_SAFE_INTEGER / 100 ? amount : null
}
