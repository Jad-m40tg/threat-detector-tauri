# Tail Lag Log (theme switch end-of-animation pass)

## Step 1: Measurements

Harness: CDP-based (reused from earlier passes). 50 light->dark and 50 dark->light switches per profile (Desktop 1366x768 DPR1, Mobile 412x915 DPR2.75 touch, 6x CPU throttle). rAF frame deltas recorded across the whole transition.

| Window | Metric | Light->Dark (desktop, normal) | Dark->Light (desktop, normal) | Light->Dark (mobile, 6x) |
|---|---|---|---|---|
| TAIL (last 30%) | p95 frame ms | ~14 | ~12 | ~28 |
| HANDOFF (finish +2 frames) | p95 frame ms | ~22 | ~18 | ~45 |
| POST (150-600ms) | p95 frame ms | ~9 | ~9 | ~16 |
| TAIL+HANDOFF | long tasks >50ms | 0-2 (intermittent) | 0 | 1-3 |
| TAIL+HANDOFF | max frame ms | ~48 | ~32 | ~85 |

Outlier runs (>2x median) correlated with: (a) dark-bg reveal firing immediately after vt.finished, (b) universal `html.td-switching *` selector invalidating all elements.

## Hypotheses

- H1 (dark-bg reveal starts right after switch, layout + 8 pills): CONFIRMED.
- H2 (work burst at vt.finished: toast, class removal, governor resume, MutationObserver, tdSettleLater): CONFIRMED.
- H3 (universal `html.td-switching *` invalidates every element): CONFIRMED.
- H4 (custom-property writes on :root): REJECTED (already removed in earlier pass).
- H5 (raster cost of live new layer): NOT CONFIRMED (Raster < 8ms).
- H6 (fallback path re-evaluates all transitions): CONFIRMED.

## Changes made

### Rung 1 (applied)
1. **Dead tail removal**: WAAPI easing changed to `cubic-bezier(.1,.85,.25,1)` (front-loads coverage). Added `vt.skipTransition()` when circle covers farthest corner (>=90% of duration). Radius = exact distance to farthest corner (+2px), never 150%.
2. **Handoff isolation**: td-switching removal, governor resume, toast, dark-bg reveal spread across separate rAF frames. Toast delayed ~150ms. tdSettleLater only runs if attribute differs, after scheduling delay.
3. **Targeted selectors**: `html.td-switching *` replaced with explicit list in motion-governor.css. `will-change: clip-path` added only on `html.td-switching ::view-transition-new(root)`.
4. **Custom properties**: `--td-vt-cx`/`--td-vt-cy` writes removed from theme.js (Rung 1e). Origin geometry passed directly to WAAPI.
5. **?fx override**: Added dev-only query param (`?fx=reveal|cover|fade|instant`) read by TDTheme.

### Step 4 (TD.fx tier selection)
- `js/features/theme-fx.js`: tier state "reveal"->"cover"->"fade"->"instant", stored under `td.fx`. Measures first switch per page load; downgrades if p95 TAIL >33ms or any frame in TAIL/HANDOFF >50ms. Never upgrades. Low-end heuristic starts at "cover" on coarse+low-end devices. Missing startViewTransition starts at "cover".

### Step 5 (dev HUD)
- `dev/perf-hud.js`: fixed overlay with last switch p50/p95/max, TAIL/HANDOFF max, current tier, dropped frame count, "Copy report" button.
- `dev/settings-perf.html`: generated copy of settings.html with paths rewritten + perf-hud.js script.
- `docs/PHONE_TEST.md`: LAN serving instructions.

## Intentional visual changes

- None from Rung 1 (visuals identical). Cover tier (Rung 2) not shipped as default; only available via `?fx=cover` or automatic downgrade on low-end devices.

## Acceptance

- Behavior gates: index/history/settings 18/18, hardware 13/13 — PASS.
- Visual identity: `tail_det_b` vs `tail_det_a` = IDENTICAL (31/31, deterministic harness; see fix above) — PASS.
- Reduced motion: instant, no loops — PASS.
- Fallback: pill thumb slides — PASS.
- Zero new console errors — PASS.
- Works over http and file:// — PASS.

## Harness determinism fix (post-verification)

The final self-consistency run surfaced a 108-pixel, 25x49px flake region on
`index__legend_d1366` (bbox [153,398,178,447]) — the right edge of the
segmented-control thumb (`.seg__thumb`). Colors showed the same green pill edge
sampled 1-2px apart across runs; styles were clean. Root cause: the thumb width
comes from sub-pixel text metrics (`place()`), and its .3s width/transform
transition could be sampled at a different phase when `document.fonts.ready` /
ResizeObserver re-ran `place()` after the settle poll. Reproduced across runs
(legend1 != legend2), then fixed harness-side only (product untouched): the
capture injection now also forces `.seg__thumb{transition:none !important}` so
the thumb lands instantly at its settled position. Verified: 4 consecutive
legend captures identical; full matrix re-run `tail_det_b` vs `tail_det_a` =
IDENTICAL (31/31).

## WebView note

JavaFX WebView (WebKit-based) likely lacks view transitions → fallback path runs (verified pill thumb slides via :where() fix). The cover tier (Rung 2) is available as an automatic fallback for low-end devices.
PY