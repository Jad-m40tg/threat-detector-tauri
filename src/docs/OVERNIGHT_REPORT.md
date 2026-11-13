# Overnight Upgrade Report — DAC Frontend

**Date:** 2026-11-04
**Project:** `Desktop/DAC_Frontend/`
**Harness:** `AppData\Local\Temp\opencode\dac-overnight\harness\` (single source of truth)

## 1. Summary

All four waves completed. Every identity gate (pixels + computed styles) and every
behavior gate (18/18 on index/history/settings, 13/13 on hardware) is green. The
final state is fully deterministic (`final_b` vs `final_a` = IDENTICAL, 31/31
captures, 0 errors). No regressions outside the allowlist A–F.

## 2. Allowlist changes (the only permitted diffs)

| ID | Change | Verified by |
|---|---|---|
| A | Theme transition ~40% slower (500→700ms VT reveal, 400→560ms fallback fade) | `probe_theme.py` (vars resolve, reduced-motion flattens to 0s) |
| B | Index Analysis-details glow: right-side-only (right-anchored gradients, no inset shadow, masked `::after` border overlay fading by 52% width), light theme softer | `probe_glow_index.py` (computed styles) |
| C | Glow REMOVED from history modal entirely (mapping + glow block + reduced-motion refs deleted) | `w2_glow_history` vs baseline: 4 modal scenes FAIL confined to `.modal-detail` subtree; `modal_row4` IDENTICAL |
| D | "Download sample CSV" restyled as visible outlined secondary button (`--border-strong` border, `--text` color, 44px touch target, hover state) | `w2_btn_index` vs baseline: 12 scenes FAIL confined to button + SVG child |
| E | New `hardware.html` + Hardware navlink (between Settings and History, chip glyph, aria-label "Hardware monitor", aria-current on hardware page) | `behavior_hw.py` 13/13; nav fit probe (5 links, no h-scroll at 360) |
| F | All inline CSS/JS extracted (zero inline blocks/handlers); zero visual change | Wave 1 gates 12/12, 11/11, 7/7 IDENTICAL |

## 3. Wave-by-wave gates

- **Wave 0 (recon + harness):** baselines `baseline_a`/`baseline_b` (26 scenes / 31 captures), noise floor `flaky.json` (empty after D12 normalization), behavior reference `behavior_a` (18/18). G2 formal compare: IDENTICAL 30/30.
- **Wave 1 (extraction + monitor):** Phase A (verbatim moves) + Phase B (shared/page split) — all pages IDENTICAL 12/12, 11/11, 7/7; behavior IDENTICAL 18/18 each. Hardware Monitor: `behavior_hw.py` 13/13 (file:// + http://, navlinks=4→5, snapshot shape, cores clamp 2–16, pills, scaleX bars, pause/resume, demo workload 8 running/14 queued, reduced-motion, no h-scroll 360, zero console errors). Light + dark screenshots reviewed.
- **Wave 2 (glow/theme/button/backend):**
  - Glow: reshape B + removal C verified (see §2).
  - Theme: +40% durations verified (probe).
  - Button: outlined secondary verified (probe + diff).
  - Backend: `TD.events`, `TD.bridge.receive`, `TD.config`, `TD.services.analysis` with `normalizeResult` + mock/bridge/http adapters (AbortController, 429/5xx→NOT_VERIFIED), `docs/BACKEND_INTEGRATION.md`. Behavior IDENTICAL 18/18 ×3.
- **Wave 3 (nav + consolidation):**
  - Nav: 5 navlinks, no h-scroll at 360 (behavior_hw 13/13).
  - Consolidation: `css/core.css` + `js/core/core.js` created; 6 `*.inline.*` files deleted. `postcons2` vs `precons2` = IDENTICAL (31/31) — lossless.
- **Wave 4 (final QA):**
  - `final_a` / `final_b`: 26 scenes / 31 captures each, 0 errors, wall ~180s. `final_b` vs `final_a` = IDENTICAL (31/31).
  - Behavior: index/history/settings 18/18 IDENTICAL vs `behavior_a`; hardware 13/13.
  - Determinism: final state fully reproducible.

## 4. Files added

- `hardware.html`
- `css/core.css`, `css/pages/hardware.css`
- `js/core/core.js`, `js/core/td-config.js`, `js/core/events.js`
- `js/services/bridge.js`, `js/services/analysisService.js`
- `js/components/sparkline.js`, `js/components/usageBar.js` (moved from staging)
- `js/pages/hardware.js`
- `docs/BACKEND_INTEGRATION.md`

## 5. Files removed (consolidation)

- `css/pages/index.inline.css`, `history.inline.css`, `settings.inline.css`
- `js/pages/index.inline.js`, `history.inline.js`, `settings.inline.js`

## 6. Backups (never deleted)

- `Desktop/DAC_Frontend_backup_2026-11-04_0124/`
- `Desktop/DAC_Frontend_checkpoints/wave0/`, `wave1/`
- Harness backups: `harness/backups/` (pre-extract + pre-phaseb restore points)

## 7. Backend switch guide (quick)

```js
localStorage.setItem("td_backend", "bridge"); // or "http"
location.reload();
```

See `docs/BACKEND_INTEGRATION.md` for contracts, JSON examples, mermaid sequence
diagrams, threading notes, and the mock-references audit.

## 8. Next steps

1. Wire `TD.services.analysis` into the dashboard scan flow (currently uses the
   in-page `DAC` engine; backend service is available but not yet called).
2. Implement the Java side of `TD.bridge.receive` and switch `td_backend` to
   `"bridge"`.
3. Add a CI step that runs `capture.py` + `diff.py compare` against a stored
   baseline to catch visual regressions.
4. Remove `mockMonitorService.js` from `hardware.html` once the real backend is
   verified (it is harmless but unused in non-mock mode).

## 9. Harness re-run instructions

```powershell
cd "C:\Users\ASUS Vivo\AppData\Local\Temp\opencode\dac-overnight\harness"
python capture.py <runname>          # full matrix (all pages/scenes)
python diff.py compare <runX> <base>  # identity gate
python behavior.py <runname>         # 18 behavioral checks
python behavior_hw.py <runname>       # 13 hardware checks
```

The HTTP server on port 8724 (`python -m http.server 8724 --bind 127.0.0.1
--directory "...\DAC_Frontend"`) must be running for the `http://` smoke checks.