/** Guided choice cards, the same look as every other guided choice. */
export function CardChoices<T extends string>({ name, value, options, testId, label, onChange }: {
  name: string
  value: T | undefined
  options: { value: T; label: string; detail?: string }[]
  testId: string
  label?: string
  onChange: (value: T) => void
}) {
  return <div className="choice-group compact" role="radiogroup" aria-label={label} data-testid={testId}>
    {options.map(option => <label key={option.value} className={value === option.value ? 'selected' : ''}>
      <input type="radio" name={name} value={option.value} checked={value === option.value}
        data-testid={`${testId}-${option.value}`} onChange={() => onChange(option.value)} />
      <span><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span>
    </label>)}
  </div>
}
