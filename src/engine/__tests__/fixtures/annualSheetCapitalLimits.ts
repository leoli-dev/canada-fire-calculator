import type { Inputs } from '../../types'
import households from './households.json'

const retired: Inputs = {
  ...households.households[1].inputs as Inputs,
  currentAge: 60,
  fireAge: 60,
  lifeExpectancy: 66,
  annualSavings: 0,
  retirementSpending: 40_000,
  balances: { tfsa: 0, rrsp: 200_000, nonReg: 0 },
  strategy: 'rrspFirst',
}

export const annualSheetLossWithdrawal: Inputs = {
  ...retired,
  balances: { ...retired.balances, nonReg: 200_000 },
  nonRegBook: 300_000,
  strategy: 'nonRegFirst',
}

export const annualSheetLossPurchase: Inputs = {
  ...retired,
  lifeExpectancy: 62,
  retirementSpending: 0,
  balances: { ...retired.balances, nonReg: 100_000 },
  nonRegBook: 150_000,
  principalResidence: {
    mode: 'planned', buyAtAge: 61, price: 100_000, downPayment: 100_000,
    appreciation: 0, netHoldingCostChange: 0, sellAtAge: null, hbp: false,
  },
}

export const annualSheetZeroGainPropertySale: Inputs = {
  ...retired,
  lifeExpectancy: 62,
  investmentProperties: [
    { value: 200_000, acb: 300_000, appreciation: 0, annualRent: 0, sellAtAge: 61 },
  ],
}
