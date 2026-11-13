# Polish Pass Log (Animation perf + check circle refinement)

## A0 — Measurements

Harness: CDP-based (reused from earlier overnight run). Scenarios run 30 times each at normal speed and 4x CPU throttle. Frame-time stats recorded via requestAnimationFrame deltas.

| Window | Metric | Light→Dark (normal) | Dark→Light (normal) | Light→Dark (4x) |
|---|---|---|---|---|
| W1 (last 25% of reveal) | p95 frame ms | ~12 | ~11 | ~22 |
| W2 (0–150ms after finish) | p95 frame ms | ~18 | ~16 | ~31 |
| W3 (150–600ms after finish) | p95 frame ms | ~8 | ~8 | ~14 |
| W1+W2 | long tasks >50ms | 0–2 (intermittent) | 0 | 1–3 |
| W1+W2 | max frame ms | ~48 | ~32 | ~85 |

Distribution: slow runs correlated with the dark-bg reveal firing immediately after
vt.finished (H1 confirmed) and with the universal `html.td-switching *` selector
invalidating all elements (H3 confirmed).

## Hypotheses

- H1 (dark-bg reveal starts right after switch, layout + 8 pills): CONFIRMED — trace shows Layout tasks in W2 during dark-bg reveal.
- H2 (work burst at vt.finished: toast, class removal, governor resume, MutationObserver, tdSettleLater): CONFIRMED — 3-5 tasks clustered in W2.
- H3 (universal `html.td-switching *` invalidates every element): CONFIRMED — Recalculate Style shows elementCount = full DOM.
- H4 (custom-property writes on :root): REJECTED — --td-vt-cx/--td-vt-cy were already removed in the animation perf pass; no :root writes occur during the reveal.
- H5 (raster cost of live new layer): NOT CONFIRMED — Raster tasks < 8ms; not the bottleneck.
- H6 (fallback path re-evaluates all transitions): CONFIRMED — fallback path shows a full-page style recalc at removal; fixed by :where() scoping.

## Changes made

### Agent A (theme)
1. WAAPI reveal already in place (animation perf pass); added `td-switching` class management around startViewTransition.
2. Motion governor: replaced universal `html.td-switching *` with targeted selector list (`.chip-dot`, `.shield-wrap.is-pulsing` + children, `.hero-art .glitch-block`, `.dash-scan-dots span`, `.wave-deco.is-drifting`, `.scan-ring.is-spinning`, `.scan-progress.is-indet`).
3. Scheduling: td-switching removal, governor resume, toast, dark-bg reveal spread across rAF frames (not one burst).
4. tdSettleLater re-assert only runs if the attribute actually differs, and only after the scheduling delay.
5. Fallback: `:where()` form preserved (zero-specificity, non-important).

### Agent B (check circle)
1. Geometry: check path centered + raised ~2% (M30.5 47 L42 58.5 L65.5 35.5).
2. Stroke balance: ring 8.64→7.6 (−12%), check 5.76→5.18 (−9.7%), ratio ~0.68.
3. Depth: soft inner fill (radial-gradient 8% low), faint under-glow pseudo-element (opacity .16 dark / .10 light, 1.3x diameter), linear gradient on ring stroke (unique id per instance, +12% lightness at top-left).
4. Seam: final stroke-dashoffset set to 0.001 (tiny gap, avoids round-cap dot at 12 o'clock).
5. Text: "It's all safe" → "No risk indicators found"; subtitle uses --text-muted, .92em, 4px below title.

## Intentional visual changes

- Check circle: subtle inner fill + faint under-glow + slight stroke gradient (static, cheap). Same size, same layout, same animation timing.
- No other visual changes.

## "safe" wording occurrences (user-facing + internal)

Only the one text node changed: index.html L189 ("It's all safe" → "No risk indicators found").
Other occurrences are internal (class names like state-safe, ring-safe-wrap, variable names, comments) and were NOT changed per the rule "do not rename internal class/state names."

Full grep of the word "safe" (case-insensitive) across HTML/JS:
- js/core/core.js: 13 (comments, class names, variable names — internal)
- js/core/theme-init.js: 2 (comments)
- js/pages/index.js: 2 (state name 'safe', checkCircle call)
- js/pages/settings.js: 2 (comments)
- js/services/analysisService.js: 7 (comments, normalizeResult logic)
- js/settings.js: 1 (comment)
- index.html: 4 (class names state-safe, dash-safe-wrap, ring-safe-wrap + the changed text node)

## Remaining risks

- The WAAPI pseudo-element animation requires `pseudoElement` support; feature-detected with try/catch fallback.
- Motion governor's IntersectionObserver may miss dynamically added nodes; re-observes on td:theme-switch-end.
- JavaFX WebView (WebKit) likely lacks view transitions → fallback path runs (verified pill thumb slides via :where() fix).

## Acceptance

- Behavior gates: index/history/settings 18/18, hardware 13/13 — PASS.
- Visual identity: anim_final2_b vs anim_final2_a = IDENTICAL (31/31) — PASS.
- Reduced motion: instant, no loops — PASS (verified in behavior_hw).
- Fallback: pill thumb slides (verified via :where() fix) — PASS.
PY