/**
 * The tax year whose published pack prices the projection.
 *
 * This lives in its own module because it is read by two modules that must not
 * import each other: `tax.ts` (which selects the pack) and
 * `rules/coverageMatrix.ts` (which publishes what the pack covers). Importing
 * it from `tax.ts` would make the coverage matrix depend on the tax engine,
 * which depends on the rules index, which publishes the matrix.
 */
export const PLAN_TAX_YEAR = 2026
