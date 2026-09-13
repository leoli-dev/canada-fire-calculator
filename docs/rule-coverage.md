# BE-38 A rule coverage (2026-09-13)

The dated selector lives in `src/engine/rules`. Amounts are nominal and pinned in source control. It does not consult the network, system date or current remote tables. A published pack wins; an unpublished future year requires an explicit annual-rate argument, records `assumedFutureRule`, and applies rounding once to the pinned base for the requested year. Missing past years fail closed. The projection engine has **not** yet switched to per-year packs; it still uses its existing 2026 constants in every projected year. The disclosure in both input modes states this limitation.

| Rule family | 2025 | 2026 | Unpublished future | Current calculation coverage |
| --- | --- | --- | --- | --- |
| Federal tax brackets/BPA | Pinned published 2025 | Pinned legacy 2026 | Explicit CPI assumption | Estimated: selected pack is not wired into annual tax calculation |
| Ontario brackets/BPA | Pinned published 2025 | Pinned legacy 2026; $150k/$220k frozen | Explicit CPI assumption except frozen thresholds | Estimated: other Ontario credits/reduction still incomplete |
| Other provinces/territories | Unsupported 2025 | Pinned **legacy** 2026 snapshot for AB, BC, MB, NB, NL, NS, NT, NU, PE, QC, SK, YT | Explicit assumption from pinned 2026; MB provincial thresholds frozen pending review | Estimated: BE-38 B must reconcile official discrepancies and credits |
| Federal CCB | July 2025–June 2026, 2024 AFNI base | July 2026–June 2027, 2025 AFNI base | Explicit CPI assumption by payment period | Estimated: same-year AFNI approximation, no provincial top-ups |
| OAS/GIS/Allowance | No dated pack | Existing 2026/Q3 constants | No dated projection policy yet | Estimated; payment quarters and income-base lag remain for BE-38 B |
| Quebec RAMQ | No dated insurance-year pack | Existing approximate constant | None | Estimated; insurance year/eligibility remains for BE-38 B |
| GST/HST and provincial cash benefits | Unsupported | Unsupported | Unsupported | Excluded |
| Full tax return including spouse/low-income credits | Unsupported | Unsupported | Unsupported | Excluded |

The 2026 snapshot deliberately preserves existing values, including known PE/MB discrepancies, rather than silently changing results in this foundation slice. The authoritative [CRA 2026 table](https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/current-year.html) lists PE's fourth threshold as $142,520 and MB's first two thresholds as $47,564/$101,200; the legacy engine holds $142,250 and $47,000/$100,000. BE-38 B owns the legal review and a new rule version before calculation changes.

Primary sources: [CRA 2025 rates](https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/last-year.html), [CRA 2026 rates](https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/current-year.html), [CRA basic personal amount](https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-30000-basic-personal-amount.html), [Ontario 2025 BPA](https://budget.ontario.ca/2025/fallstatement/provisions.html), [Finance Canada 2025–26 CCB](https://www.canada.ca/en/department-finance/services/publications/federal-tax-expenditures/2026/part-9.html), [CRA 2026–27 CCB](https://www.canada.ca/en/revenue-agency/services/child-family-benefits/canada-child-benefit/how-much.html).
