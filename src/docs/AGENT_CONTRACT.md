# AGENT_CONTRACT — overnight run (adapted to the REAL tree)

Read together with `docs/OVERNIGHT_LOG.md` (decisions D1–D5). User asleep; no questions; conservative option + log when uncertain.

## Verified environment

- Project: `C:\Users\ASUS Vivo\Desktop\DAC_Frontend` — 3 pages + `css/{nav,risk-glow,analysis-card,theme-transition}.css` + `js/{settings,theme}.js`.
- Backups (never delete): `Desktop\DAC_Frontend_backup_2026-11-04_0124`, earlier `Desktop\DAC_Frontend_backup`; checkpoints: `Desktop\DAC_Frontend_checkpoints\` (`wave0` = pre-work).
- Server: `http://127.0.0.1:8724` (`python -m http.server 8724 --bind 127.0.0.1 --directory <project>`).
- Dev harness (outside project): `C:\Users\ASUS Vivo\AppData\Local\Temp\opencode\dac-overnight\`.
- Shared core: the HTML inline blocks marked "DAC SHARED CORE" are byte-identical ×3 (verified). SACRED: any edit stays identical ×3 until consolidated; after consolidation the shared file(s) are the single source.

## Ownership map (real paths)

| Owner | Owns (read/write) | Creates |
|---|---|---|
| Extractor: index | `index.html`; `css/pages/index.inline.css` → `css/pages/index.css`; `js/pages/index.inline.js` → `js/pages/index.js` | the page css/js files |
| Extractor: history | `history.html`; `css/pages/history.inline.css` → `css/pages/history.css`; `js/pages/history.inline.js` → `js/pages/history.js` | idem |
| Extractor: settings | `settings.html`; `css/pages/settings.inline.css` → `css/pages/settings.css`; `js/pages/settings.inline.js` → `js/pages/settings.js`; the head theme bootstrap → `js/core/theme-init.js` (sync, before stylesheets) | idem |
| Monitor | NEW ONLY: `hardware.html`, `css/pages/hardware.css`, `js/pages/hardware.js`, `js/services/monitorService.js`, `js/services/mockMonitorService.js`, `js/components/sparkline.js`, `js/components/usageBar.js` | all |
| Glow | `css/risk-glow.css` ONLY | — |
| Theme | `js/theme.js` + `css/theme-transition.css` | — |
| Button | the "Download sample CSV" rule (lives in index page css after Wave 1) + that one element's class in `index.html` (Wave 2+, post-extraction) | — |
| Backend | `js/services/*`, `js/core/events.js`, `docs/BACKEND_INTEGRATION.md` | idem |
| Nav | the shared nav-builder JS section + `css/nav.css` (nav sizing rules); the Hardware navlink entry | — |
| Consolidator | shared CSS/JS dedupe (merge page duplicates of the shared core into shared files) | `css/core.css` / `js/core*.js` (final shape decided in Wave 3, order-safe) |

## Special facts (Wave 0 verified)

- Navbar is JS-BUILT (shared core: `svgGlyph`, links list, `PAGE_MAP`, `aria-current`). No static per-page header markup exists (D4).
- Cascade today: [head theme-init inline script (settings; verify per page)] → giant inline `<style>` → `script settings.js` → `link nav.css` → `link risk-glow.css` → `link analysis-card.css` → `script theme.js` → `link theme-transition.css`. Execution: theme-init (sync, head) → settings.js → theme.js → body: inline shared-core JS → inline page JS (parse-time, end of body).
- Existing external paths are frozen (no file moves). New modules attach to `window.TD`; `window.DAC` untouched.
- "Inline" files (`*.inline.css/js`) are TEMPORARY verbatim carriers owned by their extractor until the Consolidator absorbs/renames them.

## Handoff rules

- Requests to other owners go to `docs/AGENT_HANDOFF.md` (append-only, format: `- [wave N | HH:MM] To: <owner> — <request> — status`).
- Never edit outside ownership. Only the Consolidator reshuffles cross-file content, and only with a green harness before and after each batch.

## Gates (every wave)

- G1 statics — at wave exit: zero `<style>` / inline `<script>` / inline `on*` handlers in the wave's HTML scope; every `link/src` resolves (relative paths only); no ES modules; no fetch of local files.
- G2 harness — computed-styles diff + screenshot diff vs baseline show ONLY allowlist changes; behavior smoke identical; zero new console errors.
- G3 render — http:// and file:// both load; no horizontal scroll at 320px; themes/animations behave as baseline.
- G4 process — checkpoint copied at wave boundary (and before risky batches); `OVERNIGHT_LOG.md` appended after each unit.

Failure protocol: 3 attempts → restore that unit from last checkpoint → fallback ladder (smallest/rung logged) → continue. Project must be working at every wave boundary.
