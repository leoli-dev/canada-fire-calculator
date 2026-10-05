# Quarterly OAS/GIS refresh

OAS, GIS and the Allowance are indexed every quarter. The engine prices with the
latest published quarter (`PLAN_GIS_PERIOD` in `src/engine/rules/index.ts`) and
keeps earlier quarters selectable, each tested against its own tables.

Each quarter (January, April, July, October):

1. Open ESDC's quarterly page ("Maximum benefit amounts and related figures")
   and copy Table 5: monthly maximums, annual income cut-offs and top-up
   cut-offs for every household shape, and the OAS 65-74 rate.
2. Download tables 1-4 for the quarter from the open-data dataset
   https://open.canada.ca/data/en/dataset/dfa4daf1-669e-4514-82cd-982f27707ed0
3. Run `python3 scripts/gis-refit.py <dir> <month><year>`. It prints the
   breakpoints, each category's worst monthly deviation (must stay within
   `DEVIATION_TOLERANCE`, 3.25) and the value at the Allowance hand-off, which
   must equal the Allowance row's GIS plateau so the household amount never rises.
4. Add a new `CA-OAS-GIS-<year>-Q<n>-v1` pack with those figures and sources,
   point `PLAN_GIS_PERIOD` at it, and update `OAS_FULL_AT_65` (OAS 65-74 × 12)
   in `src/engine/benefits.ts`.
5. Add `benefitsQ<n>.test.ts` with Table 5 literals and rows transcribed from
   the CSVs (first and last brackets, a 960-dollar sweep, a window around every
   breakpoint, and the worst-fit bracket). Keep earlier quarters' tests pinned to
   their own packs.
6. Run `npm test` and the E2E suite; projection-level tests use the latest
   quarter's figures.
