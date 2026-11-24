import { StrictMode, useEffect, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AnnualSheetCell, AnnualSheetModel, AnnualSheetRow, AnnualSheetText } from '../../../src/annualSheet'
import { AnnualSheetDialog } from '../../../src/components/AnnualSheetDialog'
import { annualProjectionHousehold as fixture } from '../../../src/__tests__/fixtures/annualProjectionHousehold'
import { i18nReady, setLanguage } from '../../../src/i18n'
import '../../../src/styles.css'

type Year = (typeof fixture.years)[number]

function cash(value: number, timing: AnnualSheetCell['timing'] = 'during-year'): AnnualSheetCell {
  return { value: value / 100, unit: 'CAD', status: 'calculated', timing }
}

function row(id: string, label: AnnualSheetText, cell: (year: Year) => AnnualSheetCell | undefined): AnnualSheetRow {
  const cells: NonNullable<AnnualSheetRow['cells']> = {}
  for (const year of fixture.years) {
    const value = cell(year)
    if (value) cells[year.year] = value
  }
  return { id, label, cells }
}

const accountFlows = [
  ['opening', 'Opening', 'opening'], ['contribution', 'Contribution', 'during-year'],
  ['gain', 'Gain', 'during-year'], ['withdrawal', 'Withdrawal', 'during-year'],
  ['directTax', 'Direct tax', 'during-year'], ['closing', 'Closing', 'closing'],
] as const

const accountRows = (Object.keys(fixture.accounts) as Array<keyof typeof fixture.accounts>).map(id => {
  const { owner, type } = fixture.accounts[id]
  const label = `${owner === 'alex' ? 'Alex' : 'Sam'} ${type}`
  return {
    id, label, kind: 'group', initiallyExpanded: false, entity: { kind: 'account', id },
    children: accountFlows.map(([key, flowLabel, timing]) => row(`${id}-${key}`, `${label} ${flowLabel}`, year => cash(year.accounts[id][key], timing))),
  } satisfies AnnualSheetRow
})

const model: AnnualSheetModel = {
  scenarioId: 'hand-calculated-household', revision: 1,
  title: { en: 'Household ledger', fr: 'Registre du ménage', zh: '家庭账本' },
  scope: 'Alex + Sam', baseYear: fixture.years[0].year,
  years: fixture.years.map(({ year, inflationFactor }) => ({ year, realFactor: 1 / inflationFactor })),
  rows: [
    row('alex-pension', 'Alex pension', year => cash(year.people.alex.pension)),
    row('sam-pension', 'Sam pension', year => cash(year.people.sam.pension)),
    row('alex-age', 'Alex age', year => ({ value: year.people.alex.age, unit: 'years', status: 'calculated', timing: 'opening', explanationRefs: year.year === 2031 ? ['alex-age-2031'] : undefined })),
    ...accountRows,
    row('mortgage', 'Mortgage closing', year => cash(year.mortgage.closing, 'closing')),
    row('living-gap', 'Living expense gap', year => cash(year.living.gap)),
    row('event-gap', 'Event funding gap', year => {
      if (year.event) return { ...cash(year.event.gap), explanationRefs: [year.event.id] }
      return { ...cash(0), value: null, status: 'not-applicable', reason: 'No event is due in this year' }
    }),
    row('appraisal', 'Property appraisal', year => year.year === fixture.appraisal.year ? { ...cash(fixture.appraisal.value, 'closing'), status: fixture.appraisal.status } : undefined),
    row('tax-basis', 'Property tax basis', year => year.year === fixture.nominalTaxBasis.year ? { ...cash(fixture.nominalTaxBasis.value, 'closing'), basis: 'nominal-tax-basis', explanationRefs: ['tax-basis'] } : undefined),
    // A stale raw value must stay hidden when the capability status says it is unknown.
    row('payroll', 'Payroll tax breakdown', year => year.year === fixture.payrollTaxBreakdown.year ? { ...cash(99_999_999), status: fixture.payrollTaxBreakdown.status, reason: fixture.payrollTaxBreakdown.reason } : undefined),
    row('survivor', 'Survivor income', year => year.year === fixture.survivorIncome.year ? { ...cash(0), value: null, status: fixture.survivorIncome.status, reason: fixture.survivorIncome.reason } : undefined),
    row('net-worth', 'Net worth', year => cash(year.netWorth, 'closing')),
    row('estate', { en: 'Net estate', fr: 'Succession nette', zh: '净遗产' }, year => {
      if (year.year === fixture.estate.year) return cash(fixture.estate.netEstate, 'terminal')
      return { ...cash(0, 'terminal'), value: null, status: fixture.preTerminalEstate.status, reason: fixture.preTerminalEstate.reason }
    }),
  ],
  jumps: [
    { id: 'alex-retirement', label: 'Alex retirement', year: 2031, kind: 'retirement' },
    { id: 'sam-retirement', label: 'Sam retirement', year: 2032, kind: 'retirement' },
    { id: 'living-gap', label: 'First living expense gap', year: fixture.firstLivingGap.year, kind: 'living-shortfall', rowId: 'living-gap', reason: 'Unpaid living costs' },
    { id: 'event-gap', label: 'First event funding gap', year: fixture.firstEventGap.year, kind: 'event-shortfall', rowId: 'event-gap', reason: 'Roof repair', entityId: fixture.firstEventGap.eventId },
    { id: 'estate', label: { en: 'Terminal year', fr: 'Dernière année', zh: '终年' }, year: fixture.estate.year, kind: 'terminal', rowId: 'estate' },
  ],
  resolveExplanation: id => {
    switch (id) {
      case fixture.firstEventGap.eventId:
        return {
          sources: [{ label: 'Roof repair', id, granularity: 'event' }],
          formula: [
            { direction: 'add', label: 'Repair due', value: 3_000, unit: 'CAD' },
            { direction: 'subtract', label: 'Repair paid', value: 1_660, unit: 'CAD' },
          ],
        }
      case 'tax-basis':
        return { formula: [{ direction: 'add', label: 'Adjusted cost', value: 150_250.50, unit: 'CAD', basis: 'nominal-tax-basis' }] }
      case 'alex-age-2031':
        return { formula: [{ direction: 'add', label: 'Previous age', value: 64, unit: 'years' }, { direction: 'add', label: 'Elapsed years', value: 1, unit: 'years' }] }
    }
  },
}

const params = new URLSearchParams(location.search)

function pressureModel(yearCount: number): AnnualSheetModel {
  const years = Array.from({ length: yearCount }, (_, index) => ({ year: 2030 + index, realFactor: 1 }))
  return {
    ...model, years,
    rows: Array.from({ length: 120 }, (_, index) => ({
      id: `pressure-${index + 1}`,
      label: `Pressure row ${index + 1}`,
      cells: Object.fromEntries(years.map(({ year }) => [year, cash(10_000 * (index + 1) + year - 2030)])),
    })),
    jumps: [{ id: 'last', label: 'Pressure terminal year', year: years[yearCount - 1].year, rowId: 'pressure-120', kind: 'terminal' }],
  }
}

const testModel = params.has('pressure') ? pressureModel(Number(params.get('pressure'))) : {
  ...model,
  years: params.has('bad-factor') ? model.years.map(year => year.year === 2031 ? { ...year, realFactor: NaN } : year) : model.years,
  jumps: params.has('wrapped-jumps') ? [
    ...model.jumps ?? [],
    ...Array.from({ length: 18 }, (_, index) => ({ id: `milestone-${index + 1}`, label: `Household milestone ${index + 1}`, year: 2030 + index % 4, kind: 'other' as const })),
  ] : model.jumps,
}

function Harness() {
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(1)
  const [hasOpener, setHasOpener] = useState(true)
  useEffect(() => {
    const revise = () => setRevision(current => current + 1)
    const removeOpener = () => setHasOpener(false)
    window.addEventListener('fixture:revise', revise)
    window.addEventListener('fixture:remove-opener', removeOpener)
    return () => {
      window.removeEventListener('fixture:revise', revise)
      window.removeEventListener('fixture:remove-opener', removeOpener)
    }
  }, [])
  useLayoutEffect(() => {
    if (!open || !params.has('pressure')) return
    let nextFrame = 0
    const frame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => {
        performance.measure('sheet-open-to-painted-frame', 'sheet-open')
      })
    })
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame) }
  }, [open])
  return <>
    <main style={{ minHeight: '2200px', paddingTop: '810px' }}>
      {hasOpener && <button onClick={() => { performance.mark('sheet-open'); setOpen(true) }}>Open fixture</button>}
      <button>Background control</button>
    </main>
    <AnnualSheetDialog open={open} model={{ ...testModel, revision }} onClose={() => setOpen(false)} moneyMode={params.get('mode') === 'real' ? 'real' : 'nominal'} />
  </>
}

await i18nReady
const language = params.get('lang')
if (language) await setLanguage(language)
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
