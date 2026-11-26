import { Button, Field } from '../ui'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useCad } from '../format'
import { annualSheetCellStatus, annualSheetDisplayValue, annualSheetText, type AnnualSheetCell, type AnnualSheetModel, type AnnualSheetRow, type AnnualSheetUnit } from '../annualSheet'
import { annualSheetCopy } from './annualSheetCopy'
import './AnnualSheetDialog.css'

export interface AnnualSheetDialogProps {
  open: boolean
  model: AnnualSheetModel
  moneyMode: 'real' | 'nominal'
  onClose: () => void
}

/** Callers own the current scenario, revision and money mode. */
export function AnnualSheetDialog(props: AnnualSheetDialogProps) {
  // Revision keys also discard expanded rows and selected explanations on updated results.
  return props.open ? <AnnualSheetSession key={`${props.model.scenarioId}:${props.model.revision}`} {...props} /> : null
}

function AnnualSheetSession({ model, moneyMode, onClose }: AnnualSheetDialogProps) {
  const { i18n } = useTranslation()
  const language = i18n.resolvedLanguage || i18n.language
  const copy = annualSheetCopy[language.startsWith('fr') ? 'fr' : language.startsWith('zh') ? 'zh' : 'en']
  const text = (value: Parameters<typeof annualSheetText>[0]) => annualSheetText(value, language)
  const cad = useCad()
  const fullCad = useCad(2)
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const detail = useRef<HTMLElement>(null)
  const detailTrigger = useRef<HTMLElement | null>(null)
  const yearHeaders = useRef(new Map<number, HTMLTableCellElement>())
  const rowHeaders = useRef(new Map<string, HTMLTableCellElement>())
  const [year, setYear] = useState(model.years[0]?.year ?? model.baseYear)
  const [selection, setSelection] = useState<{ row: AnnualSheetRow; year: number } | null>(null)
  const [jumpReason, setJumpReason] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const result = new Set<string>()
    const visit = (rows: AnnualSheetRow[]) => rows.forEach(row => {
      if (row.initiallyExpanded === false) result.add(row.id)
      if (row.children) visit(row.children)
    })
    visit(model.rows)
    return result
  })

  useEffect(() => {
    const node = dialog.current!
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    const scrollX = window.scrollX
    const scrollY = window.scrollY
    document.body.style.overflow = 'hidden'
    node.showModal()
    // React autoFocus runs while the dialog is still closed. Once modal,
    // Chromium can instead choose a scrollable header as its first target
    // on narrow screens; explicitly focus the persistent close control.
    closeButton.current?.focus({ preventScroll: true })
    return () => {
      node.close()
      document.body.style.overflow = overflow
      trigger?.focus({ preventScroll: true })
      window.scrollTo(scrollX, scrollY)
    }
  }, [])

  const format = (value: number, unit: AnnualSheetUnit, full = false) => {
    if (unit === 'CAD') return (full ? fullCad : cad)(value)
    return new Intl.NumberFormat(language, unit === 'percent' ? { style: 'percent', maximumFractionDigits: full ? 4 : 1 } : { maximumFractionDigits: full ? 8 : 2 }).format(value)
  }
  const cellValue = (cell: AnnualSheetCell | undefined, selectedYear: number, full = false) => {
    if (!cell) return copy['not-computed']
    const column = model.years.find(column => column.year === selectedYear)
    const value = column ? annualSheetDisplayValue(cell, column, moneyMode) : null
    return value === null ? copy[annualSheetCellStatus(cell, column, moneyMode)] : `${cell.status === 'estimated' ? '≈ ' : ''}${format(value, cell.unit, full)}`
  }
  const jump = (target: number, rowId?: string) => {
    setYear(target)
    const port = scroller.current
    const header = yearHeaders.current.get(target)
    if (port && header) port.scrollLeft = Math.max(0, header.offsetLeft - (rowHeaders.current.values().next().value?.offsetWidth ?? 144))
    if (port && rowId) {
      // Reveal the target's ancestors before scrolling on the next paint.
      const path = (rows: AnnualSheetRow[], parents: string[]): string[] | undefined => {
        for (const row of rows) {
          if (row.id === rowId) return parents
          const found = row.children && path(row.children, [...parents, row.id])
          if (found) return found
        }
      }
      const parents = path(model.rows, []) ?? []
      setCollapsed(current => new Set([...current].filter(key => !parents.includes(key))))
      requestAnimationFrame(() => {
        const row = rowHeaders.current.get(rowId)
        if (row) port.scrollTop = Math.max(0, row.offsetTop - (port.querySelector('thead')?.clientHeight ?? 44))
      })
    }
  }
  const inspect = (row: AnnualSheetRow, selectedYear: number, trigger: HTMLElement) => {
    // Pointer cells are deliberately outside the Tab order. Return to the
    // equivalent native row button, which remains focusable inside the modal.
    detailTrigger.current = trigger instanceof HTMLButtonElement
      ? trigger
      : rowHeaders.current.get(row.id)?.querySelector<HTMLButtonElement>('.annual-sheet-inspect') ?? null
    setYear(selectedYear)
    setSelection({ row, year: selectedYear })
    requestAnimationFrame(() => detail.current?.focus())
  }
  const renderRows = (rows: AnnualSheetRow[], depth = 0): React.ReactNode => rows.map(row => {
    const hasChildren = !!row.children?.length
    const expanded = !collapsed.has(row.id)
    return <tbody key={row.id}>
      <tr className={hasChildren || row.kind === 'group' ? 'annual-sheet-group' : undefined}>
        <th scope="row" aria-label={text(row.label)} id={`${id}-row-${row.id}`} ref={node => { if (node) rowHeaders.current.set(row.id, node); else rowHeaders.current.delete(row.id) }}>
          <div style={{ paddingInlineStart: depth * 10 }}>
            {hasChildren && <Button type="button" aria-expanded={expanded} aria-label={text(row.label)} onClick={() => setCollapsed(current => {
              const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next
            })}>{expanded ? '−' : '+'}</Button>}
            <span>{text(row.label)}</span>
            {(row.kind !== 'group' || row.cells) && <Button type="button" className="annual-sheet-inspect" aria-label={`${copy.inspect}: ${text(row.label)}, ${year}`} onClick={event => inspect(row, year, event.currentTarget)}>{copy.details}</Button>}
          </div>
        </th>
        {model.years.map(column => <td key={column.year} headers={`${id}-row-${row.id} ${id}-year-${column.year}`} onClick={row.kind === 'group' && !row.cells ? undefined : event => inspect(row, column.year, event.currentTarget)}>
          {row.kind === 'group' && !row.cells ? '' : <><span>{cellValue(row.cells?.[column.year], column.year)}</span><span className="annual-sheet-status">{copy[annualSheetCellStatus(row.cells?.[column.year], column, moneyMode)]}</span></>}
        </td>)}
      </tr>
    </tbody>
  }).flatMap((body, index) => {
    const row = rows[index]
    return <Fragment key={row.id}>{body}{row.children && !collapsed.has(row.id) ? renderRows(row.children, depth + 1) : null}</Fragment>
  })
  const selectedCell = selection?.row.cells?.[selection.year]
  const selectedColumn = model.years.find(column => column.year === selection?.year)
  const selectedStatus = annualSheetCellStatus(selectedCell, selectedColumn, moneyMode)
  const selectedAvailable = selectedStatus === 'calculated' || selectedStatus === 'estimated'
  // A failed display conversion does not invalidate the normalized source ledger.
  // Unavailable source statuses still suppress any stale numeric payload.
  const selectedSourceAvailable = !!selectedCell
    && (selectedCell.status === 'calculated' || selectedCell.status === 'estimated')
    && selectedCell.value !== null && Number.isFinite(selectedCell.value)
  const explanations = selection && selectedCell?.explanationRefs?.map(reference => ({ reference, explanation: model.resolveExplanation?.(reference) }))

  return createPortal(<dialog ref={dialog} className="annual-sheet-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-scope`} onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="annual-sheet-layout">
      <header className="annual-sheet-header">
        <div><h2 id={`${id}-title`}>{text(model.title) || copy.title}</h2><p id={`${id}-scope`}>{text(model.scope)} · {copy.deterministic} · {moneyMode === 'real' ? `${copy.real} (${model.baseYear})` : copy.nominal}</p></div>
        <Button ref={closeButton} type="button" onClick={onClose}>{copy.close}</Button>
      </header>
      <div className="annual-sheet-tools"><div className="annual-sheet-controls">
        <Field>{copy.jump} <select value={year} onChange={event => { jump(Number(event.target.value)); setJumpReason('') }}>{model.years.map(column => <option key={column.year} value={column.year}>{column.year}</option>)}</select></Field>
        {model.jumps?.map(target => <Button type="button" key={target.id} disabled={!model.years.some(column => column.year === target.year)} onClick={() => { jump(target.year, target.rowId); setJumpReason(`${text(target.label)}: ${target.year}${target.reason ? ` — ${text(target.reason)}` : ''}`) }}>{text(target.label)} ({target.year})</Button>)}
      </div>
      <p className="annual-sheet-help">{copy.choose}</p>
      <span className="annual-sheet-announcement" role="status">{jumpReason}</span>
      </div>
      {selection && <aside ref={detail} tabIndex={-1} className="annual-sheet-detail" aria-label={copy.details}>
        <Button type="button" onClick={() => { setSelection(null); if (detailTrigger.current?.isConnected) detailTrigger.current.focus({ preventScroll: true }); else dialog.current?.querySelector('button')?.focus() }}>{copy.hide}</Button>
        <h3>{text(selection.row.label)} · {selection.year}: {cellValue(selectedCell, selection.year, true)}</h3>
        <dl>
          <dt>{copy.status}</dt><dd>{copy[selectedStatus]}</dd>
          {selectedSourceAvailable && selectedCell?.unit === 'CAD' && selectedCell.value !== null && <><dt>{copy.normalized}</dt><dd>{fullCad(selectedCell.value)}</dd></>}
          {selectedCell && <><dt>{copy.timing}</dt><dd>{copy[selectedCell.timing]}</dd><dt>{copy.native}</dt><dd>{selectedCell.nativeBasis ? text(selectedCell.nativeBasis) : selectedCell.unit === "CAD" ? copy.normalized : copy.unitValue}</dd><dt>{copy.conversion}</dt><dd>{selectedAvailable && selectedCell.conversion && <>{text(selectedCell.conversion)} · </>}{!selectedAvailable ? copy[selectedStatus] : selectedCell.basis === 'nominal-tax-basis' ? copy.taxBasis : selectedCell.unit === 'CAD' && moneyMode === 'real' ? selectedCell.realValue !== undefined ? copy.realBridge : `${copy.factor}: ${selectedCell.realFactor ?? (selectedCell.timing === 'opening' ? selectedColumn?.openingRealFactor ?? selectedColumn?.realFactor : selectedColumn?.realFactor)} (${copy.base}: ${model.baseYear})` : copy.unchanged}</dd>{selectedCell.reason && <><dt>{copy.reason}</dt><dd>{text(selectedCell.reason)}</dd></>}</>}
        </dl>
        {explanations?.map(({ reference, explanation }) => <section key={reference}>
          {!explanation ? <p>{copy.missingExplanation}</p> : <>
            {explanation.summary && <p>{text(explanation.summary)}</p>}
            {explanation.sources && <p>{copy.sources}: {explanation.sources.map(source => `${text(source.label)} (${copy[source.granularity]}${source.displayReference ? `: ${text(source.displayReference)}` : ''})`).join('; ')}</p>}
            {explanation.formulaBasis && <p>{text(explanation.formulaBasis)}</p>}
            {selectedSourceAvailable && explanation.formula && <p>{copy.formula}: {explanation.formula.map(part => `${part.direction === 'add' ? '+' : '−'} ${text(part.label)} ${Number.isFinite(part.value) ? format(part.value, part.unit, true) : copy.unknown}${part.unit === "CAD" ? ` (${part.basis === "nominal-tax-basis" ? copy.taxBasis : copy.normalized})` : ""}`).join('; ')}</p>}
            {explanation.rulePackage && <p>{copy.rule}: {explanation.rulePackage}</p>}{explanation.taxYear && <p>{copy.taxYear}: {explanation.taxYear}</p>}{explanation.projectionYear && <p>{copy.projectionYear}: {explanation.projectionYear}</p>}
            {explanation.forwardAssumption && <p>{copy.assumption}: {text(explanation.forwardAssumption)}</p>}
            {explanation.limitations?.map((limit, index) => <p key={index}>{copy.limits}: {text(limit)}</p>)}
          </>}
        </section>)}
      </aside>}
      <div ref={scroller} className="annual-sheet-scroll" tabIndex={0} role="region" aria-label={copy.title}>
        {model.years.length && model.rows.length ? <table className="annual-sheet-table"><caption className="annual-sheet-sr">{copy.title}: {text(model.title)}</caption><thead><tr><th scope="col">{copy.item}</th>{model.years.map(column => <th key={column.year} scope="col" id={`${id}-year-${column.year}`} ref={node => { if (node) yearHeaders.current.set(column.year, node); else yearHeaders.current.delete(column.year) }}>{column.year}</th>)}</tr></thead>{renderRows(model.rows)}</table> : <p>{copy.empty}</p>}
      </div>
    </div>
  </dialog>, document.body)
}
