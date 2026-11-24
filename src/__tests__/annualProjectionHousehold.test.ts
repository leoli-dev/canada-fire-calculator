import { describe, expect, it } from 'vitest'
import { annualProjectionHousehold as fixture } from './fixtures/annualProjectionHousehold'

function sum(values: number[]) {
  return values.reduce((total, amount) => total + amount, 0)
}

describe('FE-53 hand-calculated household ledger', () => {
  it.each(fixture.years)('reconciles nominal cents in $year', (row) => {
    const accounts = Object.values(row.accounts)
    for (const [id, account] of Object.entries(row.accounts)) {
      expect(account.closing, id).toBe(
        account.opening + account.contribution + account.gain - account.withdrawal - account.directTax,
      )
    }
    expect(row.mortgage.closing).toBe(row.mortgage.opening - row.mortgage.principal)
    expect(row.mortgage.interest).toBe(row.mortgage.opening / 100)

    const income = sum(Object.values(row.people).map(({ salary, pension }) => salary + pension))
    const contributions = sum(accounts.map(({ contribution }) => contribution))
    const withdrawals = sum(accounts.map(({ withdrawal }) => withdrawal))
    const eventPaid = row.event?.paid ?? 0
    const cashAvailable = row.cash.opening + income + withdrawals
    const cashUsed = contributions + row.cash.tax + row.living.paid + row.mortgage.principal + row.mortgage.interest + eventPaid
    expect(row.cash.closing).toBe(cashAvailable - cashUsed)

    expect(row.living.paid + row.living.gap).toBe(row.living.due)
    if (row.event) expect(row.event.paid + row.event.gap).toBe(row.event.due)
    expect(row.investments).toBe(sum(accounts.map(({ closing }) => closing)))
    expect(row.netWorth).toBe(row.property + row.investments + row.cash.closing - row.mortgage.closing)

    // Contributions, withdrawals, and principal move value inside the household.
    const openingNetWorth = row.property + sum(accounts.map(({ opening }) => opening)) + row.cash.opening - row.mortgage.opening
    const investmentGains = sum(accounts.map(({ gain }) => gain))
    const allTaxes = row.cash.tax + sum(accounts.map(({ directTax }) => directTax))
    expect(row.netWorth - openingNetWorth).toBe(
      income + investmentGains - allTaxes - row.living.paid - row.mortgage.interest - eventPaid,
    )
  })

  it('carries balances across calendar years for each owner and distinguishes retirement from pension starts', () => {
    for (const [index, row] of fixture.years.slice(1).entries()) {
      const previous = fixture.years[index]
      expect(row.year).toBe(previous.year + 1)
      expect(row.cash.opening).toBe(previous.cash.closing)
      expect(row.mortgage.opening).toBe(previous.mortgage.closing)
      expect(row.property).toBe(previous.property)
      for (const id of Object.keys(fixture.accounts) as Array<keyof typeof fixture.accounts>) {
        expect(row.accounts[id].opening, `${row.year} ${id}`).toBe(previous.accounts[id].closing)
      }
      expect(row.people.alex.age).toBe(previous.people.alex.age + 1)
      expect(row.people.sam.age).toBe(previous.people.sam.age + 1)
    }

    expect(Object.values(fixture.accounts)).toEqual([
      { owner: 'alex', type: 'TFSA' }, { owner: 'alex', type: 'RRSP' },
      { owner: 'sam', type: 'TFSA' }, { owner: 'sam', type: 'RRSP' },
    ])
    expect(fixture.years.find(({ people }) => !people.alex.working)?.year).toBe(2031)
    expect(fixture.years.find(({ people }) => !people.sam.working)?.year).toBe(2032)
    expect(fixture.years.find(({ people }) => people.alex.pension > 0)?.year).toBe(2031)
    expect(fixture.years.find(({ people }) => people.sam.pension > 0)?.year).toBe(2033)
  })

  it('finds the first gaps independently and bridges terminal net worth to estate', () => {
    const living = fixture.years.find(({ living }) => living.gap > 0)
    expect({ year: living?.year, amount: living?.living.gap }).toEqual(fixture.firstLivingGap)
    const event = fixture.years.find(({ event }) => event && event.gap > 0)
    expect({ year: event?.year, eventId: event?.event?.id, amount: event?.event?.gap }).toEqual(fixture.firstEventGap)

    const terminal = fixture.years[fixture.years.length - 1]
    expect(terminal.year).toBe(fixture.estate.year)
    expect(terminal.netWorth - fixture.estate.terminalTax - fixture.estate.administrationFees).toBe(fixture.estate.netEstate)
  })
})
