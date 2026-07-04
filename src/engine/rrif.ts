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

export function rrifMinFactor(age: number): number {
  if (age < 72) return 0
  if (age >= 96) return 0.2
  return FACTORS[age]
}
