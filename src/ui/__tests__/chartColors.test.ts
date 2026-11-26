import { expect, it } from 'vitest'
import tokens from '../../styles/tokens.css?raw'
import { readChartColors } from '../../chartColors'

it('resolves every series through the reference CSS token map', () => {
  const css = tokens.split(':root[data-theme=')[0]
  const declarations = Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]))
  const resolve = (key: string): string => declarations[key]?.replace(/var\((--[\w-]+)\)/g, (_, token) => resolve(token)) ?? ''
  const colors = readChartColors({ getPropertyValue: resolve })
  expect(Object.values(colors).every(Boolean)).toBe(true)
  expect(colors.tfsa).toBe(resolve('--c-tfsa'))
  expect(colors.rrsp).toBe(colors.mcBand)
  expect(colors.oas).not.toBe(colors.ccb)
  expect(colors.mcMedian).toBe(resolve('--accent'))
  expect(colors.fire).toBe(resolve('--ink-2'))
})
