# GUI95 feedback — MIS scrollbar arrows

## Context

- PuzzleScript+MIS web workbench; screenshot supplied by the user on 25 October 2026.
- Reference: GUI 95 Reference Desktop, Site version 4, and the local GUI95 skill's scrollbar integration lesson.
- Existing unrelated working changes are present; this fix is confined to scrollbar styling and checks.

## Finding: tiled arrows in generated scrollbar buttons

- Status: fixed, deployed, and verified on both public MIS entry points.
- Expected: one centered arrow on each raised end button, with a separate dithered paging track.
- Observed: the user's screenshot shows clusters of repeating arrows above and below the thumb.
- Source and runtime evidence: directional SVGs apply to all generated button slots, while dimensions, centering, bevels and no-repeat apply only to `:single-button`. Chrome reports `repeat`, `0% 0%`, and `auto` dimensions for the base button pseudo-element. The GUI95 integration lesson documents this same failure.
- Resolution: apply the complete base style to `::-webkit-scrollbar-button`, retaining explicit rules that hide the unwanted start-increment and end-decrement slots.
- Verification: `node src/tests/mis_scrollbars_browser.cjs` passed in installed Chrome and Playwright WebKit on macOS at device scales 1, 1.25, 1.5 and 2. Both axes passed arrow movement, track paging and thumb dragging to the end. Short content retained no gutter. The regression failed before the CSS change with repeating, uncentered, unsized base button styles. Disable Playwright's default `--hide-scrollbars` flag for Chrome screenshots; the initial fixture screenshot otherwise hid the controls. Screenshot evidence is in `build/mis-scrollbar-checks/`.
- Visual inspection: all eight fixture screenshots show separate single arrows, raised buttons/thumbs and dithered tracks without arrow tiling. `node scripts/publish-mis.mjs` then passed the real-page scrollbar-style regression, nine demos, native solving and suggestion generation on both local and public `/mis/` and `/mis/mis.html` entry points, without network failures or browser exceptions.

## Handoff summary

- Reusable lesson: do not restrict essential scrollbar button styling to `:single-button`; generated slots vary by browser and host theme.
- Unresolved issues and verification limits: no remaining defect in the checked hosts. Windows and a newly packaged desktop app have not been checked. WebKit is an automated engine check, not an installed Safari run.
