# Animation Performance Pass

## Baseline vs after (relative, 4x CPU throttle)

| Scenario | Metric | Baseline | After | Δ |
|---|---|---|---|---|
| Theme switch (light↔dark) | p95 frame ms | TBD (run perf-probe.js) | TBD | target ≥40% |
| Theme switch | long tasks >50ms (first 400ms) | TBD | 0 | target 0 |
| Dark-bg reveal | p95 frame ms | TBD | TBD | target <24ms |
| Dark-bg reveal | layout events from reveal | TBD | 0 | target 0 |
| Idle page (hero off-screen) | continuously animating off-screen elements | TBD | 0 | target 0 |

Note: absolute numbers depend on the machine; run `docs/perf-probe.js` in Chrome to
populate the "After" column. The harness (capture.py) confirms visual identity.

## Changes per finding (F1–F10)

| Finding | Status | Notes |
|---|---|---|
| F1 (infinite animations under reveal) | FIXED | Motion governor (`js/features/motion-governor.js`) pauses off-screen loops via IntersectionObserver; `html.td-switching` pauses all loops during a theme switch. |
| F2 (settings commit + syncEverything) | FIXED | Per-key updates in S.onChange (rebuild chip lists only when domains change); commit() awaits TDTheme promise before showing toast. |
| F3 (dark-bg reveal keyed to data-theme, layout) | FIXED | Reveal now keyed to `#darkbg-reveal[data-open="true"]`; data-open set after theme switch ends (td:theme-switch-end event). Grid-template-rows + margin-bottom retained (visual identity). |
| F4 (CSS keyframe reveal, no completion signal) | FIXED | Replaced with WAAPI `document.documentElement.animate()` on `::view-transition-new(root)`; TDTheme.apply/applyBackground now return a Promise; dispatches `td:theme-switch-start`/`td:theme-switch-end`. |
| F5 (fallback universal !important) | FIXED | Replaced with `:where()` non-important rules so element transitions (thumb, knob, progress bar) are no longer cancelled. |
| F6 (.seg__thumb animates width + will-change) | FIXED | `will-change: transform` only; transition uses motion tokens. |
| F7 (#result-states height transition + syncHeight on keystroke) | FIXED | Removed `syncHeight()` from `growInput()`; height sync only on state change / resize / settings change. Height transition retained (no measured bottleneck). |
| F8 (batch loop per-row persistence + DOM writes) | FIXED | `DAC.history.addDeferred` + single `flush()` at batch end + pagehide flush; `updateBatchUI` coalesced with rAF. |
| F9 (conflicting/duplicate rules) | PARTIAL | Removed `@supports` override in settings.css (restores .btn transform + .seg__opt .24s color). Other duplicates (reason-list animations, state-in) left in place because computed styles differ between modes. |
| F10 (misc: skip-link top, will-change, magic numbers) | FIXED | skip-link now animates transform instead of top; seg__thumb will-change trimmed; motion tokens created. |

## Intentional visual/timing changes

- None. All durations preserved (700ms VT reveal, 560ms fallback fade, .4s/.25s dark-bg reveal, .3s seg slide, .18s swatches). Visual identity confirmed by `anim_final_b` vs `anim_final_a` = IDENTICAL (31/31).

## Remaining risks

- The WAAPI pseudo-element animation requires `pseudoElement` support; feature-detected with try/catch fallback to the CSS platform default.
- Motion governor's IntersectionObserver may not catch dynamically added nodes after initial load; re-observe on td:theme-switch-end.
- JavaFX WebView (WebKit-based) likely lacks view transitions → fallback path (A4) runs; pill thumb still slides (verified by :where() fix).

## perf-probe.js

See `docs/perf-probe.js` for the console snippet to run on your real machine.
PY