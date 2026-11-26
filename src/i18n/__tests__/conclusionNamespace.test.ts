import { expect, it } from 'vitest'
import en from '../en.json'
import fr from '../fr.json'
import zh from '../zh.json'

it('keeps conclusion UI strings in ui with the same complete key set in every locale', () => {
  for (const locale of [en, fr, zh]) {
    expect(locale).not.toHaveProperty('conclusion')
    expect(Object.keys(locale.ui.conclusion).sort()).toEqual(Object.keys(en.ui.conclusion).sort())
    expect(Object.values(locale.ui.conclusion).every(value => value.length > 0)).toBe(true)
  }
})
