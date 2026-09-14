import { describe, expect, it } from 'vitest'
import en from '../../i18n/en.json'
import fr from '../../i18n/fr.json'
import zh from '../../i18n/zh.json'
import { DEFAULT_INPUTS } from '../../store'
import { requiredFireAssets } from '../../engine'
import { fieldRegistry, parseField } from '../../forms/fieldRegistry'
import { fieldState } from '../../forms/fieldState'
import { pageById } from '../../guided/questionCatalog'
import { guidanceForPage, hasLocalizedGuidance } from '../../guided/pageGuidance'
import { FIELD_CONTENT_VERSION, FIELD_CONTENT, contentForField, contentForPage, contentGuidance, guidedContentApplies, professionalContentApplies } from '../fieldContent'

describe('FE-13 A shared field content contract', () => {
  it('covers each real FE-14 shared field exactly once with a real guided and professional binding', () => {
    expect(FIELD_CONTENT_VERSION).toBe(2)
    expect(FIELD_CONTENT.map(content => content.fieldId).sort()).toEqual(Object.keys(fieldRegistry).sort())
    expect(new Set(FIELD_CONTENT.map(content => content.fieldId)).size).toBe(FIELD_CONTENT.length)
    for (const content of FIELD_CONTENT) {
      const page = pageById(content.guidedPageId)
      expect(page?.fieldBindings, content.fieldId).toContain(content.fieldId)
      expect(fieldRegistry[content.fieldId].guidedBinding).toBe(content.fieldId)
      expect(fieldRegistry[content.fieldId].professionalBinding).toBe(content.fieldId)
      expect(fieldRegistry[content.fieldId].capability).toBe('supported')
      expect(contentForField(content.fieldId)).toBe(content)
      expect(contentForPage(content.guidedPageId)?.guidedPageId).toBe(content.guidedPageId)
      expect(content.unknownKey).toBe('fieldContent.unknownBlocksResults')
      expect(content.unitKey).toBe(`fieldContent.unit${fieldRegistry[content.fieldId].unit === 'years' ? 'Years' : fieldRegistry[content.fieldId].unit === 'cad' ? 'Cad' : 'AnnualCad'}`)
      expect(parseField(content.fieldId, '')).toEqual({ status: 'draft', reason: 'empty' })
      expect(fieldState({ inputs: DEFAULT_INPUTS, draftByField: { [content.fieldId]: '' }, answerMeta: {} }, content.fieldId).usable).toBe(false)
    }
  })

  it('has source-backed guidance and every metadata key in EN/FR/ZH', () => {
    for (const content of FIELD_CONTENT) {
      for (const [language, translations] of [['en', en], ['fr', fr], ['zh', zh]] as const) {
        expect(hasLocalizedGuidance(content.guidedPageId, language)).toBe(true)
        expect(contentGuidance(content, language)).toEqual(guidanceForPage(content.guidedPageId, language))
        for (const key of [content.unitKey, content.unknownKey, content.applicabilityKey, content.capabilityKey, 'fieldContent.helpTitle']) {
          const localized = translations.fieldContent[key.slice('fieldContent.'.length) as keyof typeof translations.fieldContent]
          expect(localized?.trim().length, `${language} ${content.fieldId} ${key}`).toBeGreaterThan(2)
        }
      }
    }
  })

  it('follows actual account and planned-home applicability without changing professional field visibility', () => {
    const tfsa = contentForField('balances.tfsa')!
    expect(guidedContentApplies(tfsa, DEFAULT_INPUTS, {})).toBe(false)
    expect(guidedContentApplies(tfsa, DEFAULT_INPUTS, { 'assets.identify': ['tfsa'] })).toBe(true)
    expect(professionalContentApplies(tfsa, DEFAULT_INPUTS)).toBe(true)
    const mortgage = contentForField('principalResidence.annualMortgagePayment')!
    expect(guidedContentApplies(mortgage, DEFAULT_INPUTS, {})).toBe(false)
    expect(professionalContentApplies(mortgage, DEFAULT_INPUTS)).toBe(false)
    const planned = { ...DEFAULT_INPUTS, principalResidence: { mode: 'planned' as const, buyAtAge: 40, price: 800000, downPayment: 200000, appreciation: .02, annualMortgagePayment: 42000, mortgageYears: 25, netHoldingCostChange: 0, sellAtAge: null } }
    expect(guidedContentApplies(mortgage, planned, {})).toBe(true)
    expect(professionalContentApplies(mortgage, planned)).toBe(true)
    expect(mortgage.capabilityMeaning).toBe('plannedMortgage')
    expect(requiredFireAssets(planned).status).toBe('unsupported')
  })
})
