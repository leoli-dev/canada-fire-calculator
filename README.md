# Canada FIRE Calculator

A FIRE (Financial Independence, Retire Early) calculator built specifically for
Canadians: TFSA / RRSP / non-registered tax treatment, CPP-QPP and OAS timing,
RRIF forced minimums, and withdrawal-order strategy — modelled properly instead
of a generic 4% rule.

Pure frontend SPA. No backend, no account, no AI — your data never leaves the
browser (persisted to localStorage). English / Français / 中文.

## Develop

```sh
npm install
npm run dev      # local dev server
npm test         # engine unit tests (vitest)
npm run build    # type-check + production build
```

The calculation engine lives in `src/engine/` as a pure, UI-free TypeScript
module — a deterministic three-phase (accumulation → bridge → pension)
year-by-year projection.

Educational estimate only, today's dollars, simplified tax rules — not
financial advice.
