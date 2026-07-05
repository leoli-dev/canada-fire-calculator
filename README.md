# 🇨🇦 Canada FIRE Calculator

**English** · [Français](README_FR.md) · [中文](README_CN.md)

A FIRE (Financial Independence, Retire Early) calculator built **specifically for
Canadians**. Generic 4%-rule tools ignore everything that actually decides a Canadian
early retirement: account tax treatment (TFSA / RRSP / non-registered), CPP/QPP and
OAS timing, RRIF forced minimums, the OAS clawback, withdrawal-order strategy, and
what happens to an RRSP at death. This calculator models all of it.

**Live demo: <https://leoli-dev.github.io/canada-fire-calculator/>**

**Privacy-first: a pure frontend app.** No backend, no account, no AI — your numbers
never leave the browser (they persist to `localStorage`). English / Français / 中文.

![Overview](docs/screenshots/hero.png)

## Quick start

```sh
npm install
npm run dev      # local dev server
npm test         # 48 engine unit tests (vitest)
npm run build    # type-check + production build
```

The calculation engine (`src/engine/`) is a pure, UI-free TypeScript module — every
number in the UI comes from a deterministic, unit-tested year-by-year simulation.

## What it calculates

**A three-phase, year-by-year simulation** in real (inflation-adjusted) dollars:

1. **Accumulation** (now → FIRE): after-tax savings flow into TFSA / RRSP /
   non-registered by your allocation.
2. **Bridge** (FIRE → CPP/OAS): the low-income window. Spending is funded by account
   withdrawals following your strategy; each year the engine solves (binary search)
   for the gross withdrawal that nets your after-tax spending target.
3. **Pension** (CPP/OAS → life expectancy): government benefits arrive; from age 72
   RRIF minimum withdrawals are forced whether you need them or not.

**The tax engine** applies real federal + provincial marginal brackets (all 13
provinces and territories, 2026 figures, data-driven and updated yearly), the basic
personal amounts (with the federal, Manitoba and Yukon high-income phase-outs),
Quebec's federal abatement, Ontario's surtax and health premium, Quebec's RAMQ
prescription-drug premium and FSS contribution, the age amount and pension income
credit from 65 (including Saskatchewan's senior supplement), 50% capital-gains
inclusion tracked against your ACB, annual tax drag on non-registered distributions,
per-person OAS clawback (75+ rates included), GIS for low-taxable-income retirees
(with the employment-income exemption), and — for couples — income splitting
across two returns.

**Withdrawal strategies**, compared side by side with your own numbers:

- **Bracket-capped RRSP meltdown** (default): the RRSP funds spending first, but only
  up to a chosen ceiling's room left after CPP/OAS (one ceiling per spouse) —
  the lowest tax bracket by default, or the second bracket / OAS clawback
  threshold for large RRSPs where staying in bracket 1 forever just strands
  money into RRIF-forced withdrawals and a fully-taxable estate. The remainder
  rides past 71 and exits via RRIF minimums. Nothing is withdrawn just to
  prepay tax.
- Aggressive RRSP-first, non-registered-first, TFSA-first — so you can see exactly
  what each choice costs.

**Estate honesty**: at death the remaining RRSP/RRIF is fully taxable in the final
year and half of unrealized gains is taxed (TFSA and the principal residence pass
free). Strategies are therefore ranked by **after-tax estate value** — or, under the
**Die-with-Zero** goal, by the maximum sustainable annual spending.

**Also modelled**: principal-residence sale (tax-free, e.g. downsizing at a chosen
age), any number of investment properties — each sellable at its own age (gain
taxed) or kept for **net rental income** (taxed as ordinary income, visible to the
OAS clawback and GIS), **debts** (mortgage / car loan / other: the engine
back-solves each loan's implied rate and lets inflation erode the fixed nominal
payments — payments join retirement spending until paid off, balances reduce net
worth and the estate), **Barista-FIRE side income** over a chosen age range (with
the official GIS work exemption), CPP/QPP estimation from work history
(best-39-years rule with the claim-age dropout divisor — early retirement dilutes
your average, and claiming early dilutes it less than you'd think), OAS from
residence years and its automatic +10% at 75, CPP 60–70 (QPP to 72) / OAS 65–70
timing tables, investment fees (MER), and a Monte Carlo simulation (1,000
randomized-return runs in a web worker, one shared market shock per year across
accounts) with a failure-anatomy readout. Inputs are validated as you type —
impossible age orderings, negative amounts, out-of-window claim ages and
never-amortizing loans are flagged inline.

## How to fill in the inputs

Work down the left column; every underlined term opens a plain-language explanation
(see the glossary drawer below).

- **Profile** — ages, province, after-tax annual savings, desired after-tax annual
  spending in retirement (today's purchasing power; a spending worksheet helps you
  build it from categories). Pick an **optimization goal**: maximize the after-tax
  estate, or **Die with Zero** (maximize stable spending, end near zero). The
  inflation assumption and Real/Nominal toggle only change how amounts are
  *displayed* — the math always runs in real dollars.
- **Household** — couple mode treats accounts and spending as household totals and
  taxes the income split across both spouses (two personal amounts, two runs up the
  low brackets). Each partner has their own CPP/OAS timeline.
- **Accounts** — current balances per wrapper. For the non-registered account also
  enter the **ACB** (your broker calls it *book cost*): tax applies only to the gain
  above it, so leaving it at 0 badly overstates tax. Asset-mix presets set realistic
  real returns and volatilities per account.
- **Real estate** — optional principal residence plus any number of investment
  properties, each with an optional sale age and an optional net annual rent
  (rent minus operating costs; it stops the year the property sells). A
  principal-residence sale is tax-free and becomes investable capital the same year.
- **Debts** — mortgage, car loan or other, each as (balance, annual payment, years
  remaining). Enter your annual savings as what you actually save *after* debt
  payments; the engine adds the payments to retirement spending until each loan
  is gone.
- **Side income** — optional post-FIRE income (Barista FIRE) with an age range;
  don't subtract it from retirement spending yourself.
- **Government benefits** — CPP/QPP and OAS start ages and age-65 amounts, per
  spouse. Not sure of the amounts? Use the built-in estimators (work history for
  CPP, residence years for OAS) or copy the exact figures from My Service Canada
  Account.

## How to read the outputs

**The four question tabs** at the top answer, with method notes under each answer:
*Will my money last?* · *When can I retire (earliest feasible age)?* · *What's my
FIRE number (assets needed at FIRE, vs what you're projected to have)?* · *Will I
hit my asset target (and at what age)?*

**Account balances by age** — stacked wealth by wrapper. Dashed lines mark FIRE, the
first government benefit, and any planned property sale; the tinted region is the
bridge period. Watch the blue RRSP melt away during the bridge while the green TFSA
compounds untouched — that is the withdrawal strategy at work.

![Balances](docs/screenshots/balances-chart.png)

**Retirement income by source** — where each year's cash comes from (stacked) and
the tax paid (dashed line). The handoff pattern — RRSP first, then non-registered,
TFSA last, benefits layering in on top — is the plan's story in one picture.

![Income](docs/screenshots/income-chart.png)

**Year-by-year detail** (collapsed by default) — the audit table: every retirement
year's withdrawals per account, benefits, gross, tax, after-tax cash, taxable income
per person and the marginal bracket it lands in.

![Year table](docs/screenshots/year-table.png)

**Withdrawal-order comparison** — all four strategies on your numbers: total tax
(including estate tax), tax paid on RRSP/RRIF money specifically, and the ranking
metric for your goal. One click applies any row.

![Strategies](docs/screenshots/strategy-comparison.png)

**CPP/OAS timing** — full tables for every start age (CPP 60–70, OAS 65–70): the
adjusted annual benefit, the plan outcome, and the delta versus your current choice.

**Monte Carlo** — randomizes each year's returns and reruns the whole plan 1,000
times. The success rate is the share of runs that last to life expectancy; the
failure-anatomy panel shows how the unlucky runs actually fail (almost always: a bear
market in the first five years after FIRE — sequence-of-returns risk).

![Monte Carlo](docs/screenshots/monte-carlo.png)

**The glossary drawer** — every underlined term on the page (RRSP, ACB, meltdown,
clawback, marginal rate, …) opens a plain-language explanation; terms inside
explanations are clickable too. 33 entries in all three languages.

![Glossary](docs/screenshots/glossary-drawer.png)

## Assumptions and limitations

- All amounts are **today's purchasing power**; returns are real (net of inflation).
  Tax brackets are held in real terms.
- Tax data: 2026 federal + all-province/territory tables (verified against CRA /
  provincial budgets / TaxTips), updated manually each year.
- Couple taxation assumes ideal 50/50 income splitting for CPP/RRSP/rental/investment
  income. In reality, pre-65 RRSP withdrawals are taxed to the account owner — an
  even split during the bridge requires comparable RRSP balances (plan ahead with a
  spousal RRSP). Barista-FIRE side income is the exception: it's taxed entirely on
  you, since employment-type income can't legally be split with a spouse.
- Non-registered distributions and net rent are taxed yearly as ordinary income (a
  deliberate simplification: no dividend gross-up/credit, no rental CCA); GIS uses a
  linear approximation of the official tables; enter your annual savings **after
  tax and after debt payments** — the RRSP refund is not recycled automatically.
- Debt payments are treated as fixed in nominal dollars (no refinancing or variable
  rates); the interest rate is implied from balance / payment / years.
- Not yet modelled: dividend tax credits, TFSA/RRSP contribution-room caps, the CPP
  enhancement (post-2019 contributions — estimates lean conservative for younger
  users), long-term-care cost shocks.
- Monte Carlo draws one market shock per year shared by all accounts (accounts are
  fully correlated; what differs is each account's volatility). Success rates are
  sensitive to the return assumption — read them as "odds of never needing to
  adjust", not precise probabilities.

**Educational estimate only — not financial advice.**

## License & contributions

Personal project, provided as-is. Issues and PRs welcome.
