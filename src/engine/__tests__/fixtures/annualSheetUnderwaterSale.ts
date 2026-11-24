import type { Inputs } from '../../types'
import propertySales from './property-sales.json'

const existingHomeSale = propertySales.cases[0].inputs as Inputs

export const annualSheetUnderwaterSale: Inputs = {
  ...existingHomeSale,
  currentAge: 60,
  fireAge: 60,
  lifeExpectancy: 62,
  retirementSpending: 50_000,
  balances: { tfsa: 0, rrsp: 600_000, nonReg: 0 },
  strategy: 'rrspFirst',
  principalResidence: {
    value: 300_000,
    appreciation: 0,
    sellAtAge: 60,
    mortgage: { balance: 400_000, annualPayment: 40_000, yearsRemaining: 10 },
  },
}
