# QA-30 regression activation map

This is the A slice only. `households.json` is executable now; `pending-audit.json` carries complete old-schema inputs and independent correct expectations for the six priority reproductions. Every pending row must become a failing assertion against the pre-fix baseline, then pass in its named fix PR. Status here denotes coverage in this PR, not business-code completion. Source for P IDs: fire-model-reassessment-2026-09 §3 and its diagnostics.json (2026-09-13). Source for T IDs: household-tax-plan-2026-09 §test matrix. Both are planning provenance; legal-rate assertions still need official source metadata beside their future fixtures.

| Audit | Correct assertion / activation point | Status here |
|---|---|---|
| P01 | Year-start sale 500k less opening 400k debt = 100k; BE-31 | Active property-sales fixture and debt test |
| P02 | 500k purchase with 100k cash and zero valid loan has 400k unfunded; BE-30 | Correct pending fixture |
| P03 | 100k down payment cannot use next year's income; BE-30 | Correct pending fixture |
| P04 | 10k savings cannot pay 8k FHSA + 8k employee DC; BE-30 | Correct pending fixture |
| P05 | Existing RRIF owner 72, elected spouse opening age 61: 1m / 29; BE-10/11 | Mapped pending |
| P06 | Real zero return with 2% inflation requires nominal ACB gain; BE-23 | Mapped pending |
| P07 | Terminal tax is tax(total income) minus already paid tax; BE-33 | Mapped pending |
| P08a/b | Locked initial 0/100k plus 2 × (3k employee + 2k employer) reconciles retirement snapshot; BE-14 | Mapped pending, both variants |
| P09 | 100k cash spent on 100k home leaves zero liquid FIRE assets; BE-14 | Mapped pending |
| P10 | Child 10 at main age 40 is 20 at FIRE 50, CCB 0, 12k two-year TFSA requirement; BE-14 | Correct pending fixture |
| P11 | Zero-volatility MC includes 100k locked + 40k FHSA; BE-14 | Mapped pending |
| P12 | FHSA normal single-person lifetime 40k cap; BE-36 | Mapped pending |
| P13 | Target reached after age-50 work year does not mean available at age-50 start; BE-14 | Mapped pending |
| P14 | Owner 80/20 ordinary RRSP is taxed by owner, not 50/50; BE-10/11 | Mapped pending |
| P15 | 2026 Q3 GIS + Allowance category-specific published monthly amounts; BE-26 | Mapped pending |
| P16 | QC 2026 senior credit uses household net-income test; BE-35 | Mapped pending |
| P17 | 70/70 has a 10k shortfall at age 62 and cannot rank as feasible; independent full-life candidate feasibility schedule still needed in BE-34 | Negative path and early bridge active in candidate-ranking.test.ts; full-life independent positive schedule pending BE-34 B |
| P18 | FIRE number includes planned 100k cash purchase; BE-14 | Mapped pending |

| Household tax test | Fixture/contract to activate | Status here |
|---|---|---|
| T01 | Legacy single/couple, Scenario A, corruption, repeat migration preserves totals and IDs | Mapped pending BE-10 |
| T02 | ON/QC 160k+0 versus 80k+80k independent tax | Mapped pending BE-11 |
| T03 | Prior-year RRSP room and zero/high current salary | Mapped pending BE-12 |
| T04 | 20k deduction limit, 5k unused, 16k proposed yields 15k room + 1k excess | Mapped pending BE-12 |
| T05 | Self/spousal 10k contribution: same contributor deduction, different ownership | Mapped pending BE-12 |
| T06 | 2026 spousal contribution versus 2028/2029 withdrawal window | Mapped pending BE-12 |
| T07 | T2205 multi-account and RRIF minimum exceptions | Mapped pending BE-12 |
| T08 | Seven-year age gap and staggered retirement, per-person earnings stop | Mapped pending BE-13 |
| T09 | Age 64/65 DB, RRSP and RRIF eligibility differs by tax regime | Mapped pending BE-11 |
| T10 | Multiple RRIFs, younger-spouse election, conversion year and 71/72 boundary | Mapped pending BE-11 |
| T11 | OAS recovery and CCB/GIS near threshold by owner | Mapped pending BE-26/11 |
| T12 | Savings and income budgets prevent doubled wages/refunds; cash identity | Mapped pending BE-13; simple identity executable |
| T13 | Property 80/20, FHSA, locked ownership and debt | Mapped pending BE-10/30 |
| T14 | Seed, zero volatility, account split, side assets | Mapped pending BE-14; simple zero-volatility executable |
| T15 | Shared snapshot for target and FIRE asset solvers | Mapped pending BE-14; simple boundary executable |
| T16 | No improvement/unknown room/unknown ownership suppresses definitive advice | Mapped pending BE-37/15 |
| T17 | Exchange all self/partner references: household aggregate stable | Mapped pending BE-10/11; only same-age nonzero CPP source swap executable |
| T18 | Thirteen jurisdictions, spouse-credit edges, official tax vectors | Mapped pending BE-11/35 |

The bounded deterministic generator (0–3 accounts, age gap, part retirement, purchases/sales, fees and room boundaries) belongs after the corresponding annual state and room fields exist. A generator against today's shared-bucket schema would certify missing concepts as zeros. The independent small-search enumerator also activates with typed feasible candidates in BE-40/37.

DM01: submit the same simple household through guided and professional forms and compare canonical values and projection. DM02: submit the owner/room/child/housing/locked household through both forms and compare per-person tax and yearly state. DM03: edit each direction and verify amounts, units, owner and source metadata survive. DM11: trigger the same unfunded/unsupported case from each form and compare capability messages. These require real UI entry in Chromium at desktop and mobile-320; no localStorage preload is qualifying evidence. This pure-test slice changes neither input UI and does not claim any DM case passed.

The existing projection test named “couple mode pays less tax than single” encodes automatic 50/50 taxable splitting and must be removed or rewritten with an owner-specific fixture in BE-10/11. Its current pass is not a tax-law endorsement. The old spousal RRIF minimum test only samples elected spouses aged 72+ and must be extended with P05's under-72 election when RRIF state exists. This slice does not delete either legacy test because the production contracts are not yet fixed.
