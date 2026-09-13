import { useTranslation } from 'react-i18next'
import { contentGuidance, type FieldContent } from '../content/fieldContent'

export function FieldContentFacts({ content }: { content: FieldContent }) {
  const { t } = useTranslation()
  return <p className="field-content-facts" data-content-field={content.fieldId}>
    {t(content.unitKey)} · {t(content.applicabilityKey)} · {t(content.capabilityKey)} {t(content.unknownKey)}
  </p>
}

export function ProfessionalFieldHelp({ content }: { content: FieldContent }) {
  const { i18n, t } = useTranslation()
  const guidance = contentGuidance(content, i18n.resolvedLanguage ?? i18n.language)
  return <details className="professional-field-help" data-testid={`professional-help-${content.fieldId}`}>
    <summary>{t('fieldContent.helpTitle')}</summary>
    <p>{guidance.why}</p>
    <p>{guidance.find}</p>
    <FieldContentFacts content={content} />
  </details>
}
