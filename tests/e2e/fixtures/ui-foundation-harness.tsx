import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../../src/styles.css'
import { Button, Field, Segmented, Sheet } from '../../../src/ui'

function Example() {
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const params = new URLSearchParams(location.search)
  const radioPosition = params.get('radios')
  const radioTabIndex = params.get('interleaved') === 'prefix' ? 1 : undefined
  const radioOptions = <>
    <Button>First action</Button>
    <fieldset><legend>Options</legend>
      <label><input type="radio" name="example" value="one" tabIndex={radioTabIndex} defaultChecked={params.get('selected') === 'one'} />One</label>
      {params.has('interleaved') && <Button tabIndex={radioTabIndex}>Between options</Button>}
      <label><input type="radio" name="example" value="two" tabIndex={radioTabIndex} defaultChecked={params.get('selected') === 'two'} />Two</label>
    </fieldset>
    {radioPosition === 'middle' && <Button>Final action</Button>}
  </>
  if (params.has('native')) return <main style={{ display: 'block', padding: 24 }}>
    <Button>Before fixture</Button>{radioOptions}<Button>After fixture</Button>
  </main>
  return <main style={{ display: 'block', padding: 24 }}>
    <Button id="calculate" loading={loading}>Calculate</Button>
    <Button onClick={() => setLoading(true)}>Start calculation</Button>
    <Button aria-busy="true">Caller busy</Button>
    <Segmented aria-label="Example options"><Button aria-pressed>Selected option</Button><Button>Other option</Button></Segmented>
    <Field>Amount<input /></Field>
    <Field>Warning<input className="invalid-warning" /></Field>
    <Button onClick={() => setOpen(true)}>Open sheet</Button>
    <Sheet open={open} onClose={() => setOpen(false)} title="Mixed content" closeLabel="Close sheet">
      {radioPosition ? radioOptions : <>
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
      </>}
    </Sheet>
  </main>
}
createRoot(document.getElementById('root')!).render(<Example />)
