# PR-2 implementation evidence

Branch: `codex/ui-unify-02-shell-questionnaire`. Base: `origin/main` at `4dee3a46973c4aef7a95839e263c0b4ae2b4f980`. Scope: FE-56, FE-57 and FE-59, authoritative design report sections 6.1 and 6.2.

## Implementation

`AppBar` replaces the large heading/tagline and moves the existing entry-mode actions into the shell. Desktop controls include result-only Real/Nominal, language, glossary and GitHub. Phone language and menu controls open the existing shared modal Sheet, including mode, glossary, GitHub, privacy actions and the compact disclaimer. The fixed GitHub corner component and styles are removed. The tagline is in the metadata and README. The existing consent prompt now appears in the footer; the same consent actions are also reachable from the phone menu, with no changes to consent state, events or storage.

The desktop questionnaire uses `248px | minmax(0,640px) | 300px` and 40px gaps. The help rail appears at 1280px; at 1100px there are two columns, and tablet is a single column using the existing directory toggle. Directory labels have new EN/FR/ZH short strings, including couple-total variants following `asksCoupleTotal`. Category status, counts, current page, total progress, category progress and the next short label are present. All original question help, examples and source facts remain reachable. Question/review/result heading focus is preserved; a programmatic focus session suppresses the heading ring, while keyboard control focus remains visible.

Canonical evidence entry is rendered only in guided review and Professional mode. Existing test IDs, actions, flags and store commands are preserved. Return-budget choices use Segmented buttons with `aria-pressed`, retaining click and Space activation, revision checks and idempotence. No calculation, eligibility, gating, question order, persisted-plan format or reset behavior changed.

## Measurements and screenshots

Captured by `scripts/capture-shell-pr2.mjs` using only `/Applications/Thorium.app/Contents/MacOS/Thorium`, actual version `Thorium 156.0.8078.28`. `metrics.json` records rectangles and raw visible target measurements. Screenshots wait for the selected language and translated radio labels before capture.

| Screen | Viewport | App bar height | First question title top | Document width |
| --- | --- | --- | --- | --- |
| desktop.png | 1440 × 844 | 56px | 148.5px | 1440px |
| desktop-1280.png | 1280 × 844 | 56px | 148.5px | 1280px |
| mobile.png | 390 × 844 | 52px | 155.5px | 390px |
| fr320.png | 320 × 844 | 52px | 163.1px | 320px |
| zh390.png | 390 × 844 | 52px | 155.5px | 390px |

The 390px target of ≤200px is met. French at 320px and Chinese at 390px are readable, with no page overflow or one-character Chinese columns. Raw phone measurements still count two small radio inputs inside full-size labels and the footer credit link as under 44px. PR-3 owns its requested zero-small-target audit and phone progress/pager layout. These captures follow Thorium's default privacy signals; the E2E privacy cases separately exercise absent signals, consent and GPC refusal.

## Design decisions and boundaries

- At 1280px the middle column is 604px, since the specified fixed side rails and gaps must fit within the 24px page gutters. It reaches 640px at 1440px. This follows `minmax(0,640px)` in the report rather than forcing a horizontal overflow.
- The full inline help disclosure remains below the question even when the desktop rail is visible. The rail repeats the existing Why/Where text; examples and detailed source facts remain in the disclosure so the original help action remains available at every breakpoint.
- Phone Contents/progress and the pager retain PR-1's wrapping, test hook and non-fixed layout. PR-3 owns the sticky progress row, Contents Sheet and fixed pager. Desktop Next uses the specified short action; phone Next category wording is retained.
- Professional/results widths and review width are preserved within the wider shell. Their layout redesigns belong to later PRs. Existing Professional and canonical result display-basis controls remain alongside the added desktop app-bar control so their phone actions and existing disclosures stay available until those surfaces are redesigned.
- Tablet app-bar controls may wrap to preserve readable labels. Desktop ≥1100px uses the specified 56px bar; phone ≤640px uses 52px.

## Assertion and selector adjustments

No test was deleted, skipped or relaxed for this change. Existing skip conditions remain unchanged.

1. `ui-foundation-regressions.spec.ts`: directory width changes from 240px to the specified 248px; its offset to the question changes from 296px to 288px (248 + 40). The question-width formula changes from max 720px to max 640px and explicitly subtracts the 300px help rail plus 40px gap at ≥1280px. Row alignment, row grids, bounds, directory visibility, keyboard focus, forced colors, inputs and errors remain checked.
2. `pager-readability.spec.ts`: desktop pager width changes from 720px to 640px. Measurements inspect the visible next-label text on desktop and the original category-progress text on phones, while rectangle assertions still inspect the complete `guided-progress` wrapper. Every word-splitting, line count, overflow, target-size, alignment and mobile full-width assertion remains.
3. `pager-readability.spec.ts`: the next action now checks its accessible name at each tested width: desktop Next and phone Next category. This follows the desktop design while retaining PR-1 phone wording.
4. `canonical-budget-roundtrip-thorium.spec.ts`: canonical return-choice selected/unselected assertions change from native `checked` state to `aria-pressed=true/false` because the requested Segmented uses buttons. Existing names, keyboard Space, click, revision increments, no-op repeat activation and persisted budget assertions remain.
5. `guided-flow.spec.ts`: initial mode checks use the current mode's `aria-pressed` state rather than an `.active` class. Language hit-testing still covers all original widths and edge-position clicks, now opening the phone language picker as required and asserting `aria-pressed` rather than `.active`.
6. Mode/language clicks throughout affected suites use `fixtures/app-bar.ts`. It opens the phone menu or language picker, selects the same existing action, and waits for the requested document language. Desktop actions still use the visible `.entry-mode` and `.langs` controls. No downstream calculation or state assertions change. `.entry-mode`, `.langs`, `.question-pager`, `.category-navigation`, `.directory-shell`, `.question-page`, `guided-progress` and all canonical test IDs remain available.
7. `ui-contract.spec.ts` checks selected-language state and its white selected background inside the visible picker, closing it before continuing the original complete contrast and overflow audits. `performance.spec.ts` opens the phone menu to inspect the same translated mode label; lazy-download assertions remain unchanged.
8. `privacy-robustness.spec.ts` explicitly arranges DNT/GPC absence for opt-in and blocked-storage cases, and DNT absence/GPC presence for the refusal case. Thorium defaults both signals on; without explicit setup, the original opt-in test cannot render its prompt. The behavior and all original consent/storage assertions are retained.

New hooks: `app-menu` and `app-language`. New tests cover result-only shell controls, store-backed mode/display actions, modal keyboard dismissal and focus return, first-question position, programmatic heading focus, keyboard rings, ledger entry surfaces, localized labels and rail breakpoints. The catalog test checks all three locales and couple variants.

## Validation

Node `v20.20.2`. CI configuration is unchanged. Local browser configuration is `playwright.thorium.config.ts`, extending the normal suite with the required executable path and four workers.

Final test results are recorded in `validation.txt`.
