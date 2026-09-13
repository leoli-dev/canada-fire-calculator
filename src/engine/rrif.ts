import type { Account, Person } from './model'

// RRIF mandatory minimum withdrawal factors. RRSP must convert to a RRIF by
// the end of the year the holder turns 71; minimums apply from the following
// year. CRA computes each year's minimum from the age at January 1st, so the
// year the holder turns N uses the prescribed factor for age N-1 — the table
// below is already shifted to be keyed by the age reached during the year.
const FACTORS: Record<number, number> = {
  72: 0.0528, 73: 0.054, 74: 0.0553, 75: 0.0567, 76: 0.0582,
  77: 0.0598, 78: 0.0617, 79: 0.0636, 80: 0.0658, 81: 0.0682,
  82: 0.0708, 83: 0.0738, 84: 0.0771, 85: 0.0808, 86: 0.0851,
  87: 0.0899, 88: 0.0955, 89: 0.1021, 90: 0.1099, 91: 0.1192,
  92: 0.1306, 93: 0.1449, 94: 0.1634, 95: 0.1879,
}

/** CRA ordinary RRIF factors are keyed to age on January 1, not age reached during the year. */
export function prescribedRrifFactor(ageAtYearStart: number): number {
  if (!Number.isInteger(ageAtYearStart) || ageAtYearStart < 0) return Number.NaN
  if (ageAtYearStart <= 70) return 1 / (90 - ageAtYearStart)
  if (ageAtYearStart >= 95) return 0.2
  return FACTORS[ageAtYearStart + 1]
}

export type RrifMinimum =
  | { status: 'ok'; amount: number; factor: number; agePersonId: string }
  | { status: 'invalid' | 'unsupported'; reason: string }

/** Existing RRIF minimums apply while the annuitant works; opening year has no minimum. */
export function minimumForRrif(account: Account, people: Person[], baseYear: number, year: number, openingBalance = account.balance): RrifMinimum {
  if (account.kind !== 'rrif') return { status: 'invalid', reason: 'not a RRIF account' }
  if (!Number.isFinite(openingBalance) || openingBalance < 0 || !Number.isInteger(year)) return { status: 'invalid', reason: 'invalid RRIF balance or year' }
  if (account.ownerId === null || !people.some(person => person.id === account.ownerId)) return { status: 'unsupported', reason: 'RRIF owner unknown' }
  if (openingBalance === 0) return { status: 'ok', amount: 0, factor: 0, agePersonId: account.ownerId }
  if (account.openedYear.status === 'unknown') return { status: 'unsupported', reason: 'RRIF opening year unknown' }
  if (!Number.isInteger(account.openedYear.value)) return { status: 'invalid', reason: 'invalid RRIF opening year' }
  // CRA's prescribed-factor chart has a separate pre-March-1986 column;
  // amendment/revision and later annuity holdings determine whether it still
  // applies. Opening year alone cannot select a lawful factor.
  if (account.openedYear.value < 1987)
    return { status: 'unsupported', reason: 'pre-1987 RRIF factor qualification or revision unconfirmed' }
  if (year < account.openedYear.value) return { status: 'invalid', reason: 'RRIF exists before opening year' }
  if (year === account.openedYear.value) return { status: 'ok', amount: 0, factor: 0, agePersonId: account.ownerId }
  const agePersonId = account.rrifAgeElection?.electedAtOpening ? account.rrifAgeElection.personId : account.ownerId
  const agePerson = people.find(person => person.id === agePersonId)
  if (!agePerson) return { status: 'invalid', reason: 'RRIF age election person missing' }
  const factor = prescribedRrifFactor(agePerson.ageInBaseYear + year - baseYear - 1)
  if (!Number.isFinite(factor)) return { status: 'invalid', reason: 'invalid RRIF factor age' }
  return { status: 'ok', amount: openingBalance * factor, factor, agePersonId }
}

export function rrifMinFactor(age: number): number {
  // floor: fractional ages from transient input states must not return
  // undefined (a NaN here silently poisons the whole projection)
  const a = Math.floor(age)
  if (a < 72) return 0
  if (a >= 96) return 0.2
  return FACTORS[a]
}
