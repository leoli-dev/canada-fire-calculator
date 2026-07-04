// RRIF mandatory minimum withdrawal factors. RRSP must convert to a RRIF by
// the end of the year the holder turns 71; minimums apply from the following
// year. Factors from CRA prescribed table.
const FACTORS: Record<number, number> = {
  72: 0.054, 73: 0.0553, 74: 0.0567, 75: 0.0582, 76: 0.0598,
  77: 0.0617, 78: 0.0636, 79: 0.0658, 80: 0.0682, 81: 0.0708,
  82: 0.0738, 83: 0.0771, 84: 0.0808, 85: 0.0851, 86: 0.0899,
  87: 0.0955, 88: 0.1021, 89: 0.1099, 90: 0.1192, 91: 0.1306,
  92: 0.1449, 93: 0.1634, 94: 0.1879,
}

export function rrifMinFactor(age: number): number {
  if (age < 72) return 0
  if (age >= 95) return 0.2
  return FACTORS[age]
}
