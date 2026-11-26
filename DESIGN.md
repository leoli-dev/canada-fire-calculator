# Canada FIRE Calculator UI contract

The authoritative design is `/Users/leo/Code/project-devlog/projects/canada-fire-calculator/notes/ui-unify-2026-11-design-report.md`, sections 4–8. Its companion handover defines the PR boundaries. Reference screens and the screen manifest are in that project's `assets/design/ui-unify-2026-11/` directory.

`src/styles/tokens.css` contains the reference light and dormant dark tokens. Dark mode is not enabled automatically. Use `--surface`, `--surface-2`, `--ink`, `--ink-2`, `--ink-3`, one `--accent`, and the positive, caution and critical semantic families. Chart colors are resolved from these CSS tokens by `src/chartColors.ts`; account colors must agree between charts. No color literals belong in component styles.

Typography uses Inter and the display, title, heading, body, ui, meta, caption and micro steps. Display becomes 24px on phones; micro is reserved for status sublines in table cells. Spacing uses 4, 8, 12, 16, 24, 32 and 48px. Controls use 6px radii, panels 10px, sheets 16px and chips full rounding. Static panels have borders; only floating surfaces use the floating shadow. Focus uses `--focus-ring`; state transitions use the duration and easing tokens and respect reduced motion.

Shared primitives live in `src/ui/index.tsx`, with styles in `src/ui/ui.css`:

- `Button`: primary, secondary, ghost, danger and link; md and sm; disabled and width-preserving loading states; forwards refs and native button attributes.
- `Segmented`: equal-width button or tab mode. Button mode exposes `aria-pressed`; tab mode exposes `aria-selected` and roving focus with arrows, Home and End. Existing caller keyboard handlers take precedence when they prevent the event.
- `Field`: preserves a wrapping label or an explicit `htmlFor`, with `as="div"` for separately labelled controls. Validation and source text retain their existing associations.
- `ChoiceCard`: native radio or checkbox label, or pressed button. Selection uses the full border and an inset ring, with a tinted background.
- `StatusChip`: ok, est, unknown, bad and info. Keep localized status text; ok and bad also include an icon hidden from assistive technology.
- `Callout`: info, warn and example, full border and a decorative icon. The `as` prop preserves existing paragraph, fieldset or section semantics.
- `Disclosure`: native details/summary semantics, including existing controlled open state and onToggle handlers.
- `Sheet`: named modal dialog, scrim and Escape dismissal, trapped focus, scroll locking and trigger focus restoration; a desktop drawer and mobile bottom sheet.

Responsive widths are phone ≤640px, tablet 641–1099px and desktop ≥1100px. A later guided layout may add its help rail at ≥1280px. Container queries remain appropriate for narrow result and tax-facts columns. The annual table also retains its short-window height query so browser zoom cannot hide the table.

Compatibility class names and `data-testid` attributes remain on their original DOM elements. Calculations, capability gates, stored plan semantics, question order, reset confirmation, analytics events and annual-table accessibility names are unchanged. The foundation change applies tokens and control styling without introducing the later screen layouts.

Existing screen rules live in the `legacy` CSS layer. The default button display lives in the lower `primitives` layer, so screen visibility and directory row grids take precedence; shared visual styles remain unlayered. Keyboard focus paints a 2px accent ring above a 4px tint halo, with a system Highlight outline in forced colors. Disclosure headers use the 14px UI step from the fixed type scale; section 5's illustrative 15px value is outside that scale. Chart legend and tooltip labels use neutral text because some prescribed series colors meet the graphic contrast requirement but not the text requirement; their swatches retain the series colors.

Validation: shared component Vitest tests exercise state, native labels and keyboard behavior, and modal dismissal and focus return. `tests/e2e/ui-contract.spec.ts` checks styled buttons, computed text contrast and horizontal overflow in all three languages. Existing feature E2E assertions remain authoritative.
