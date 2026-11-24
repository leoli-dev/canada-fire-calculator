// Hand-set nominal CAD cents. Income, gains, tax, and appraisal values are scenario
// assumptions. Close balances, shortfalls, and estate values are worked out below.
type AccountYear = {
  opening: number
  contribution: number
  gain: number
  withdrawal: number
  directTax: number
  closing: number
}

type PersonYear = { age: number; working: boolean; salary: number; pension: number }

type HouseholdYear = {
  year: number
  inflationFactor: number
  people: Record<'alex' | 'sam', PersonYear>
  accounts: Record<keyof typeof accounts, AccountYear>
  cash: { opening: number; tax: number; closing: number }
  living: { due: number; paid: number; gap: number }
  mortgage: { opening: number; principal: number; interest: number; closing: number }
  event: { id: string; due: number; paid: number; gap: number } | null
  property: number
  investments: number
  netWorth: number
}

const accounts = {
  alexTfsa: { owner: 'alex', type: 'TFSA' },
  alexRrsp: { owner: 'alex', type: 'RRSP' },
  samTfsa: { owner: 'sam', type: 'TFSA' },
  samRrsp: { owner: 'sam', type: 'RRSP' },
} as const

const years: readonly HouseholdYear[] = [
  {
    year: 2030,
    inflationFactor: 1,
    people: {
      alex: { age: 64, working: true, salary: 4_000_000, pension: 0 },
      sam: { age: 62, working: true, salary: 3_000_000, pension: 0 },
    },
    accounts: {
      alexTfsa: { opening: 700_000, contribution: 400_000, gain: 100_050, withdrawal: 0, directTax: 0, closing: 1_200_050 },
      alexRrsp: { opening: 2_100_000, contribution: 300_000, gain: 210_000, withdrawal: 0, directTax: 0, closing: 2_610_000 },
      samTfsa: { opening: 500_000, contribution: 200_000, gain: 50_000, withdrawal: 0, directTax: 0, closing: 750_000 },
      samRrsp: { opening: 1_200_000, contribution: 100_000, gain: 120_000, withdrawal: 0, directTax: 0, closing: 1_420_000 },
    },
    // $500 + $70,000 - $9,000 - $48,000 - $2,100 - $10,000 = $1,400.
    cash: { opening: 50_000, tax: 900_000, closing: 140_000 },
    living: { due: 4_800_000, paid: 4_800_000, gap: 0 },
    mortgage: { opening: 1_000_000, principal: 200_000, interest: 10_000, closing: 800_000 },
    event: null,
    property: 20_000_000,
    investments: 5_980_050,
    netWorth: 25_320_050,
  },
  {
    year: 2031,
    inflationFactor: 1.02,
    people: {
      alex: { age: 65, working: false, salary: 0, pension: 800_000 },
      sam: { age: 63, working: true, salary: 3_000_000, pension: 0 },
    },
    accounts: {
      alexTfsa: { opening: 1_200_050, contribution: 0, gain: 60_000, withdrawal: 520_000, directTax: 0, closing: 740_050 },
      alexRrsp: { opening: 2_610_000, contribution: 0, gain: 120_000, withdrawal: 0, directTax: 0, closing: 2_730_000 },
      samTfsa: { opening: 750_000, contribution: 50_000, gain: 30_000, withdrawal: 0, directTax: 0, closing: 830_000 },
      samRrsp: { opening: 1_420_000, contribution: 0, gain: 60_000, withdrawal: 100_000, directTax: 20_000, closing: 1_360_000 },
    },
    // $1,400 + $38,000 + $6,200 - $39,500 - $3,000 - $2,080 - $500 = $520.
    // Sam's RRSP sends $1,000 to household cash and separately pays $200 of tax.
    cash: { opening: 140_000, tax: 300_000, closing: 52_000 },
    living: { due: 3_950_000, paid: 3_950_000, gap: 0 },
    mortgage: { opening: 800_000, principal: 200_000, interest: 8_000, closing: 600_000 },
    event: null,
    property: 20_000_000,
    investments: 5_660_050,
    netWorth: 25_112_050,
  },
  {
    year: 2032,
    inflationFactor: 1.0404,
    people: {
      alex: { age: 66, working: false, salary: 0, pension: 800_000 },
      sam: { age: 64, working: false, salary: 0, pension: 0 },
    },
    accounts: {
      alexTfsa: { opening: 740_050, contribution: 0, gain: 0, withdrawal: 740_050, directTax: 0, closing: 0 },
      alexRrsp: { opening: 2_730_000, contribution: 0, gain: 0, withdrawal: 2_730_000, directTax: 0, closing: 0 },
      samTfsa: { opening: 830_000, contribution: 0, gain: 0, withdrawal: 830_000, directTax: 0, closing: 0 },
      samRrsp: { opening: 1_360_000, contribution: 0, gain: 0, withdrawal: 1_360_000, directTax: 0, closing: 0 },
    },
    // $520 + $8,000 + $56,600.50 - $7,000 - $2,060 leaves $56,060.50 for living costs.
    cash: { opening: 52_000, tax: 700_000, closing: 0 },
    living: { due: 6_000_000, paid: 5_606_050, gap: 393_950 },
    mortgage: { opening: 600_000, principal: 200_000, interest: 6_000, closing: 400_000 },
    event: null,
    property: 20_000_000,
    investments: 0,
    netWorth: 19_600_000,
  },
  {
    year: 2033,
    inflationFactor: 1.061208,
    people: {
      alex: { age: 67, working: false, salary: 0, pension: 800_000 },
      sam: { age: 65, working: false, salary: 0, pension: 650_000 },
    },
    accounts: {
      alexTfsa: { opening: 0, contribution: 0, gain: 0, withdrawal: 0, directTax: 0, closing: 0 },
      alexRrsp: { opening: 0, contribution: 0, gain: 0, withdrawal: 0, directTax: 0, closing: 0 },
      samTfsa: { opening: 0, contribution: 0, gain: 0, withdrawal: 0, directTax: 0, closing: 0 },
      samRrsp: { opening: 0, contribution: 0, gain: 0, withdrawal: 0, directTax: 0, closing: 0 },
    },
    // $14,500 - $800 - $2,040 - $10,000 leaves $1,660 for a non-capital repair.
    cash: { opening: 0, tax: 80_000, closing: 0 },
    living: { due: 1_000_000, paid: 1_000_000, gap: 0 },
    mortgage: { opening: 400_000, principal: 200_000, interest: 4_000, closing: 200_000 },
    event: { id: 'roof-repair', due: 300_000, paid: 166_000, gap: 134_000 },
    property: 20_000_000,
    investments: 0,
    netWorth: 19_800_000,
  },
]

export const annualProjectionHousehold = {
  accounts,
  years,
  firstLivingGap: { year: 2032, amount: 393_950 },
  firstEventGap: { year: 2033, eventId: 'roof-repair', amount: 134_000 },
  // $200,000 property - $2,000 mortgage - $1,200 terminal tax - $1,800 fees.
  estate: { year: 2033, terminalTax: 120_000, administrationFees: 180_000, netEstate: 19_500_000 },
  // Supplemental facts for display-state checks when adapting to the sheet.
  appraisal: { year: 2033, status: 'estimated', value: 20_000_000 },
  nominalTaxBasis: { year: 2033, status: 'calculated', value: 15_025_050 },
  payrollTaxBreakdown: { year: 2031, status: 'unknown', reason: 'Only aggregate cash tax was supplied' },
  survivorIncome: { year: 2033, status: 'not-computed', reason: 'The survivor projection was not run' },
  preTerminalEstate: { year: 2030, status: 'not-applicable', reason: 'Estate is settled in the terminal year' },
} as const
