# AGENT_CONTRACT — Threat Detector front-end

Rules every agent working in `Desktop\DAC_Tauri\src` must follow. If a prompt conflicts with this file, stop and report.

## Scope
- Work only inside `src`. Never touch `Desktop\DAC_Frontend` or any Rust code (`src-tauri`, `crates`).
- No new libraries, no CDNs, no build tools. Vanilla HTML/CSS/JS only.
- Minimal diffs: edit files in place; never rewrite whole files.

## Namespaces
- `DAC` — shared core runtime, defined in `js/core/core.js` (e.g. `DAC.ui`, `DAC.visuals`, `DAC.verdictShade`). Attach new shared helpers to `DAC`, never create new globals.
- `TD` — components and page state, defined in `js/components/*` and `js/pages/*` (e.g. `TD.components.sparkline`).
- `TDSettings` — the only way to read or write settings whose keys start with `td.`. Register new keys in `js/settings.js`. Never read `localStorage` directly for these.

## Script load order (identical on every page; do not reorder)
In `<head>`: `js/core/theme-init.js`, then `js/settings.js`, then `js/features/theme-fx.js`, then `js/theme.js`.
At end of `<body>`: `js/core/core.js`, `js/core/td-config.js`, `js/core/events.js`, `js/services/bridge.js`, `js/services/analysisService.js`, `js/features/motion-governor.js`, then `js/pages/<page>.js`.
A new component script slots after `analysisService.js` and before the page script, on every page that uses it.

## CSS
- Per-page rules live in `css/pages/<page>.css` and are loaded only by that page.
- Shared rules live in `css/core.css` (tokens: colors, borders, radius, spacing, focus ring, input styling) or a topic file (e.g. `css/risk-glow.css`, `css/analysis-card.css`).
- Colors come from `css/core.css` custom properties (`--low`, `--medium`, `--high`, `--unverified`, theme-scoped `--vs-*` where defined). Never hardcode a raw hex where a token exists.
- Every theme-sensitive style must work in both light and dark themes.

## Verification
- After changes: confirm every page that loads the modified files still opens with a clean console.
- Report honestly: state what you verified and what you did not.
