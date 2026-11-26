import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../../src/styles.css'
import { Button, Field, Segmented, Sheet } from '../../../src/ui'

function Example() {
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  return <main style={{ display: 'block', padding: 24 }}>
    <Button id="calculate" loading={loading}>Calculate</Button>
    <Button onClick={() => setLoading(true)}>Start calculation</Button>
    <Button aria-busy="true">Caller busy</Button>
    <Segmented aria-label="Example options"><Button aria-pressed>Selected option</Button><Button>Other option</Button></Segmented>
    <Field>Amount<input /></Field>
    <Field>Warning<input className="invalid-warning" /></Field>
    <Button onClick={() => setOpen(true)}>Open sheet</Button>
    <Sheet open={open} onClose={() => setOpen(false)} title="Mixed content" closeLabel="Close sheet">
      <Button>Visible action</Button>
      <details><summary>Closed details</summary><Button>Conditional action</Button></details>
      <details open><summary>Open details</summary><Button>Last visible action</Button></details>
      <fieldset disabled><Button>Disabled by fieldset</Button></fieldset>
      <Button disabled>Disabled action</Button>
      <Button tabIndex={-1}>Programmatic only</Button>
      <div style={{ display: 'none' }}><Button>CSS hidden action</Button></div>
      <div style={{ visibility: 'hidden' }}><Button>Invisible action</Button></div>
      <div inert=""><Button>Inert action</Button></div>
      <Button hidden>Hidden action</Button>
    </Sheet>
  </main>
}
createRoot(document.getElementById('root')!).render(<Example />)
