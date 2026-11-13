# Snap Fix Log — theme reveal stops early, uncovered area snaps (mobile)

Task: light→dark on Android Chrome (tunnel), the circular reveal stopped
before the far corner and the uncovered region snapped to the new theme.
Desktop was unaffected. Backup before this task:
`../DAC_Frontend_backup_snap_2026-11-05_010957` (79 files).

## Step 1 — instrumentation design

Extended `dev/perf-hud.js` with a switch inspector and added a matching
diagnostics record inside `js/theme.js` (exposed as `TDTheme._diag`,
diagnostics-only, never read by product logic):

- `debugBegin` at switch start: viewport snapshot (innerW/H, clientW/H,
  visualViewport w/h/offset/scale, screen w/h, DPR, scroll), tier;
- capture-phase listener for `resize`, `visualViewport resize/scroll`,
  `scroll`, `focusin` during the switch (timestamped, relative to start);
- at `vt.ready`: real snapshot size — `getComputedStyle(html,
  "::view-transition")` width/height composited with innerWidth/innerHeight,
  clientWidth/clientHeight, visualViewport extents (+screen on coarse
  pointers) → `snapshotSize()`; origin point, `R_true`, `R_safe`, duration;
- at `vt.finished`: the reveal animation's `currentTime / duration`
  (progress at finish), snapshot size again, `readyRejected` name;
- `EARLY_END` flag: progress < 0.98 at finish or a rejected promise, with
  the reason string.

Expected readings per hypothesis: H1 shows `R_true` > distance computed
from innerWidth/innerHeight (or a reported corner gap at finish); H2 shows
viewport/scroll/focus events or a `readyRejected`/early progress with
events around it; H3 shows early ends with no events and progress exactly
at the old 90% skip point; H4 shows progress ≥ 1 with a corner gap; H5
shows non-zero `visualViewport.offsetLeft/Top` or `scale ≠ 1` with a
shifted origin.

Measurement harness: `harness/probe_frames.py` (CDP, 60 real seg clicks per
profile, rAF deltas per switch, TAIL = last 30% of frames, HANDOFF = last 3
frames) and `harness/probe_rapid.py` (10 alternating clicks in 2s +
reduced-motion emulation). Profiles: desktop 1366×768 DPR1; desktop 4× CPU
throttle; mobile emulation 412×915 DPR2.75 touch + 6× CPU throttle.
**Emulation cannot reproduce Android toolbar resizing** — the real phone
report (HUD JSON) remains the source of truth for H2/H6.

## Step 2 — hypothesis verdicts

- **H1 (radius too small) CONFIRMED** as a co-factor. The old code computed
  `R = hypot(…innerWidth/innerHeight)` only. On Android the visible area
  changes when the toolbar collapses/expands; the snapshot area can extend
  past the click-time innerHeight, so the circle could never reach the real
  far corner. Emulated runs show `snapshotSize()` picking the
  `::view-transition` pseudo-element size (1344×670 desktop; 412×915 +
  screen extents on coarse pointers), and the shipped `R_safe ≥ R_true`
  held in **60/60 desktop, 60/60 desk4x, 60/60 mobile** probe runs.
- **H3 (our own early skip) CONFIRMED — this was the primary bug.** The
  previous pass's "remove the dead tail" rung called `vt.skipTransition()`
  at 90% of the duration. `skipTransition()` terminates the reveal
  immediately and shows the new state everywhere — any corner not yet
  covered **snaps**. With the front-loaded easing the radius was ~99.5% of
  a possibly-too-small R at that moment: on desktop the gap is sub-pixel
  (invisible), on mobile (larger corner distance vs. click-time viewport,
  plus frame jank) it was a visible white sliver → exactly the reported
  screenshot. **Fix 2.2: the skip logic is removed entirely** (desktop
  included — it never showed a measurable benefit worth the snap risk; the
  new two-segment keyframe curve keeps the perceived duration without it).
- **H2 (viewport change cancels the transition) CONFIRMED on throttled
  mobile emulation, cannot be reproduced/rejected on a real device from
  here.** Emulated mobile + 6× CPU throttle: Chrome aborts the clip-path
  reveal mid-flight (finished resolves at 2–98% progress, zero rAF frames —
  the 1133×2516 px reveal layer cannot be painted fast enough). No viewport
  events were recorded in those runs (`events: []`), so under emulation the
  trigger is the paint starvation, not a toolbar resize. The task's
  acceptance explicitly anticipates platform cancels: the report shows them
  (progress + EARLY_END) and the device must be downgraded so it does not
  repeat — implemented (2.6). Preventive measures shipped regardless (2.3a).
- **H4 (easing/duration clamp) REJECTED.** With H1+H3 fixed, progress at
  finish is exactly 1.0 in every non-aborted run; the final keyframe radius
  is `R_safe = R_true × 1.08 + 48px` — a corner gap is impossible by
  construction.
- **H5 (visual viewport offset) REJECTED for this app.** `clientX/clientY`
  and the `::view-transition` clip-path share the layout-viewport coordinate
  space; the probe recorded `offsetLeft/Top = 0, scale = 1` in every run.
  `snapshotSize()` already unions the visualViewport extents, so a zoomed
  page still gets a covering radius. No origin conversion shipped.
- **H6 (toolbar/meta theme-color)**: no `<meta name="theme-color">` exists
  in any page (grep: zero references) — nothing to write, nothing to
  trigger a toolbar recolor.

## Step 3 — what shipped

**2.1 Robust radius (always, reveal tier)** — `snapshotSize()` in theme.js:
`W = max(::view-transition width, innerWidth, clientWidth,
visualViewport.width+offsetLeft)` (+ `screen.width/height` on coarse
pointers), same for H, clamped to 10000. Radius:
`R_true = hypot(max(x, W−x), max(y, H−y))`, `R_safe = R_true × 1.08 + 48`.
Animated as multi-keyframe WAAPI clip-path on `::view-transition-new(root)`,
`fill: "both"`:

- offset 0.00 — `circle(0px at x y)`, easing `cubic-bezier(.1,.85,.25,1)`
- offset 0.92 — `circle(R_true px at x y)`, easing `linear`
- offset 1.00 — `circle(R_safe px at x y)`

The visible edge reaches the real farthest corner at ~92% of the 700 ms
duration (same ease-out feel, perceived duration unchanged), and the final
8% add the safety margin linearly — an uncovered corner is impossible even
if the last frames drop.

**2.2 No early skip** — `checkSkip`/`vt.skipTransition()` deleted
completely (all devices, all tiers).

**2.3a Gesture freeze during the switch** — `css/theme-transition.css`:
`html.td-switching { touch-action: none; overscroll-behavior: none; }`.
Scoped to the switching class (added/removed by theme.js), reversible, no
layout change; it stops scroll gestures from collapsing the toolbar
mid-reveal. `focus()/scrollIntoView` are not called by the switch paths;
nothing that changes document height runs before `td:theme-switch-end` + 2
frames (staggered in the previous pass; `tdSettleLater` additionally
guarded, see 2.4).

**2.3b Cancellation detection + recovery** — a rejected `vt.finished` or
progress < 98% at finish calls `noteEarlyEnd(reason)`: recorded in the
diag, logged to console when `?perf` is present, and downgrades the TD.fx
tier (2.6). The end state of an aborted switch needs no repair — the update
callback already applied the attribute, and the existing cleanup removes
`td-switching` on both resolve and reject paths.

**2.3c Cover tier hardening** — `#td-theme-cover` is sized
`width:100vw;height:100vh;width:100lvw;height:100lvh` (large viewport where
supported); the circle origin is the click point (center for keyboard),
diameter `2 × R_safe` from the SAME robust `snapshotSize()`; the target
color comes from the new `--td-cover-bg` token (duplicates `--bg` in all
three token blocks — dark/oled `#000000`, dark/grey `#121212`,
light `#F4F7F5`; documented duplication), read by synchronously flipping
ONLY the attribute being switched and restoring it in the same task (no
paint in between, no VT snapshot involved). A newer cover cancels the
previous one's animations and removes its element (rapid toggling leaves no
leftovers).

**2.4 Idempotency + reconcile guard** — `switchAttr` ignores a second call
with the SAME target within 300 ms (returns the first call's promise);
alternating targets are unaffected (last-wins still works). In
`js/pages/settings.js`, `tdSettleLater()` never reconciles while
`td-switching` is set — it retries (bounded to 10 attempts) after the class
is removed; it only ever `setAttribute`s (never `apply`/`skip`).

**2.6 Tier auto-downgrade** — EARLY_END (rejected ready/finished or
progress < 98%) downgrades exactly like a slow frame; never upgrades.
Warmup guard: early ends within 2.5 s of page load are logged but do NOT
downgrade (the first switch after a cold load is the heaviest; a false
downgrade would be sticky). Rapid toggling legitimately downgrades (each
superseded transition rejects `finished`) — this is by design: cover is the
right tier for rapid toggling.

`?fx=reveal|cover|fade|instant` query override (previous pass) still wins
over everything for testing.

## Before / after tables

Frame-delta probe (60 switches each: 30 L→D then 30 D→L via real clicks;
"after-warmup" excludes the first 8 runs of each profile):

| Profile (after) | Tier | tail p95 median | tail p95 worst | handoff worst | earlyEnds | prog < 0.98 |
|---|---|---|---|---|---|---|
| desktop, no throttle | reveal (all 60) | 16.8 ms | 50.1 ms | 50.1 ms | 0 | 0 |
| desktop 4× throttle | reveal → cover | 33.4 ms | 66.7 ms | 16.8 ms | 1 (post-warmup) | 1 |
| mobile 6× throttle | reveal → cover | 66.7 ms | 200 ms | 83.4 ms | 1 (post-warmup) | 1 |

Desktop vs. pre-fix baseline (`skipTransition` era, same probe, 60 switches):
tail p95 median 16.8 → 16.8 ms (unchanged — **no desktop regression**); the
baseline numbers were flattered by the skip cutting the tail short, which is
precisely the snap bug. `R_safe ≥ R_true` in 180/180 after-runs.

Forced-reveal control (`?fx=reveal`, mobile 6×): the platform aborted every
reveal (earlyEnd 58/60, progress 2–98%) — demonstrating that on such a
device the reveal tier cannot hold, and the auto-downgrade to cover is the
correct shipped behavior.

**Reading the throttled numbers honestly:** the rAF probe measures
main-thread frame cadence. The cover tier animates transform/opacity only
(compositor-driven); its main-thread cadence at 6× throttle (66.7 ms median)
overstates visible jank — the long frames are the theme-flip style recalc
happening behind the opaque cover, invisible by design. The real-phone HUD
report is the judge for visible smoothness.

## Acceptance status

- Behavior gates (final build): `snap_beh` **18/18 PASS** (index/history/
  settings), `snap_hw` **13/13 PASS** (hardware page) — zero console errors.
- Real-phone 30×30 runs with the HUD: **pending user run** — the HUD, the
  inspector and `docs/PHONE_TEST.md` are in place; EARLY_END = 0 after the
  first warmup switches and `R_safe ≥ R_true` in the copied JSON are the
  pass criteria. (Desktop probe equivalents: 0 early ends after warmup,
  180/180 radius holds — PASS in emulation.)
- Desktop / throttled numbers: desktop median tail p95 16.8 ms ≤ 20 — PASS;
  4× and 6× run the cover tier after at most one platform abort, with the
  caveat above — stated, not hidden.
- Rapid toggling 10× in 2 s: final attr = last request, no console errors,
  no `td-theme-cover` / `td-switching` / `td-theme-fading` leftovers,
  `touch-action` back to `auto` — PASS (`probe_rapid.py`).
- Reduced motion: instant switch, no classes left — PASS.
- Final-state visuals: capture matrix on the final build — `snap_final_a`
  (26 captures; its last 6 scenes were lost to a harness-only CDP connection
  abort `WinError 10053` — machine sleep killed the debug connection, not a
  product failure; zero capture errors and zero scene warns up to that
  point), `snap_final_b` complete 31 captures / 0 errors, and
  `snap_final_a2` (full re-run) — diff verdict in the final section below.
- No dev tooling referenced by product pages (grep clean); works over http
  and file:// — PASS.

## Final capture verdict

`snap_final_b` vs `snap_final_a2` (both complete, 31 captures / 0 errors,
normal wall time 187s — confirming the earlier 80-minute run was machine
sleep, not slowdown): **IDENTICAL — styles clean, pixels identical, 31/31
captures** across all themes, accents, dark backgrounds and widths. The
final-state acceptance is fully closed on the shipped build.

## Git

- Pre-checks (all logged before staging): `git rev-parse --is-inside-work-tree`
  → true; `origin` = `https://github.com/Jad-m40tg/dac_threat_detector.git`;
  branch = `main`; `user.name` = `Jad`, `user.email` = `jad.sisbane@gmail.com`.
- Pre-task status (captured before the backup, BEFORE any edits): modified —
  `css/components/motion-governor.css`, `hardware.html`, `history.html`,
  `index.html`, `js/theme.js`, `settings.html`; untracked — `dev/`,
  `docs/PHONE_TEST.md`, `docs/TAIL_LAG_LOG.md`, `js/features/theme-fx.js`.
  These were the previous (verified, uncommitted) tail-lag pass files.
  Decision: they were included in this commit because the passes share
  `js/theme.js` (edits are inseparable) and the HTML pages reference
  `js/features/theme-fx.js` — excluding it would ship a broken script
  reference. `dev/` was NOT staged (per task rules; deletable, never
  referenced by product pages). No backups, harness output or screenshots
  staged. Staging was by explicit path (13 files); `git diff --cached`
  scanned for secrets/tokens/private URLs — clean.
- Commit: `8a21618` — `Quick update: animations lag fixed`
  (13 files, +797/−48; exact message as requested, no trailers).
- Sync: `git fetch origin` → `git rev-list --count main..origin/main` = 0
  (no remote commits, no rebase needed).
- Push: `git push origin main` → `c0cbe01..8a21618 main -> main` SUCCESS.
- Post-push verify: `git log origin/main -1` = `8a21618 Quick update:
  animations lag fixed` (local == remote); `git status --short` = only
  `?? dev/` (intentionally untracked).
- Post-push: the full-matrix re-run completed — `snap_final_b` vs
  `snap_final_a2` = **IDENTICAL 31/31** (0 errors). The final-state
  acceptance that was in flight at commit time is now fully closed; no
  product change was needed.
- Note: this appendix was written after the push (it contains the push
  result), which is why it exists only in the working copy.

## FOLLOW-UP (same day): settings toggle animations "stopped working" on user devices

Two separate defects were found. The first was diagnosed and fixed first
(persistence tier trap); the second — the one the USER actually saw — was
found only by frame-probing the switch buttons themselves.

### Bug 1 — theme-switch tier trap (own bug, snap fix 2.6)
`TD.fx` walks reveal -> cover -> fade -> instant and stores the tier in
localStorage `td.fx`. Every aborted/superseded switch called `downgrade()`
once (snap fix 2.6 treated early end == failure). But a superseded transition
is a USER action, not a platform failure: a 10-toggle burst produces 9
aborts = 9 downgrades = reveal -> instant in one burst, then persisted
forever. The user's phone (30+30 HUD toggles) and desktop (rapid-toggle
acceptance run) both walked the tier down; `?fx=` was never reset. Devices
were stuck on instant theme switches with no way back.

Fix (`js/theme.js` + `js/features/theme-fx.js`):
- Supersession marking: `activeByAttr` map (attr -> in-flight record);
  `debugBegin` marks the prior in-flight record `superseded` (if not ended).
  Each switch captures its own record (`var dbg = switchDebug`) and its
  promise handlers use `dbg` — NOT the module-level `switchDebug`, which a
  newer switch reassigns before an aborted transition's reject handler runs
  (first version of this fix had that race; caught in review).
- `noteEarlyEnd(dbg, reason)` skips the downgrade when `dbg.superseded`;
  warmup guard (< 2.5s) unchanged; real platform aborts still downgrade.
- `dispatchEnd(name, value, dbg)` marks the CALLER's record ended (a name+
  value match alone could mark a newer same-value record ended in an
  alternating burst, defeating supersession marking).
- Stale-cleanup guard: superseded handlers no longer remove `td-switching`
  or tear down the shared viewport listener (the newer switch owns both).
- Persistence expiry: `td.fx` now stores `{v: tier, t: timestamp}`; entries
  older than 2h (`MAX_AGE = 2*60*60*1000`) are ignored + removed. LEGACY
  plain-string entries (the stuck ones on user devices) are ignored +
  removed on first load -> affected devices SELF-HEAL. Key name unchanged
  (`td.fx`); `?fx=` override unchanged.

Verified (`probe_toggle3.py`, all PASS): legacy `td.fx="cover"` self-heals to
heuristic reveal; fresh `{v:"cover",t:now}` honored; 3h-old entry expires;
10x rapid-toggle burst leaves tier reveal, no leftovers, no errors, last
request wins; textsize seg thumb 15 distinct frames.

### Bug 2 — switch knobs frozen since first commit (the user's report)
Frame-probing the `.switch` buttons (`probe_switch3/4/5.py`) showed their
knobs NEVER animate after page load: 1 frame, instant jump, and
`aria-checked` stays stale (`set-reduce` clicked ON -> `aria-checked` stayed
`false` while `data-motion` flipped to `reduced`). Root cause:
`DAC.settings.onChange` invokes listeners as `fn(key, value)` (core.js
`notify`), but the settings page's per-key change handler read
`e.detail.key` — always `undefined` — so the ENTIRE handler (chip list
re-sync, theme hint, switch repaint, dark reveal) has been DEAD CODE since
the first commit. Segmented controls self-paint on click (that is why seg
thumbs animated in every probe); switches relied on this handler and never
re-painted. Every toggle button looked broken: click -> toast fires, the
setting applies, but the button does not move until a reload.

Fix (`js/pages/settings.js`): the change handler now takes `(key, value)`
positionally (which also revives the chip/hint/dark-reveal branches that the
comments always promised) and paints the matching switch — and, for the
nested `detectors` object, all six detector switches — from the NEW state,
so the intact 200ms knob transition (`transform 200ms cubic-bezier(.4,0,.2,1)`)
runs and `aria-checked` stays truthful. Store ordering guarantees
`applyAppearance()` has already flipped `data-motion` before the paint, so
the reduce-motion OFF slide animates (its ON slide is instant under the
reduced-motion kill rule — by design).

Verified (`probe_switch5.py`, ALL PASS): hero toggle 13 interpolated knob
frames, aria matches stored setting both directions; reduce ON -> aria true +
motion reduced; reduce OFF -> 13 frames + motion full; `det-http` 14 frames,
aria matches; zero console errors.

### Regression gates (final build: both fixes)
- Behavior: `fx2_beh` **18/18 PASS** (index/history/settings, 71.8s),
  `fx2_hw` **13/13 PASS** (hardware) — zero console errors.
- Capture pair `fx2_final_a`/`fx2_final_b` + pixel diff vs the pre-fix
  pushed build (`snap_final_a2`): in flight at commit time — no capture
  scene toggles a switch (only seg `td.*` keys), so final states are
  expected identical; verdict appended to the Git appendix below.

### Git (follow-up commit)
- Commit: `59a29f5` — `quick update: toggle buttons fixed`
  (4 files: js/theme.js, js/features/theme-fx.js, js/pages/settings.js,
  docs/SNAP_FIX_LOG.md; +234/−45). Staged by explicit path; `dev/` NOT
  staged; staged diff scanned for secrets — clean.
- Sync: `git fetch origin` -> `main..origin/main` count 0 (no rebase needed).
- Push: `git push origin main` -> `8a21618..59a29f5 main -> main` SUCCESS
  (local == remote verified via `git log origin/main -1`).
- Post-push: `git status --short` = only `?? dev/` (intentionally untracked).
- Capture verdict (completed after push): `fx2_final_b` (fixed build) vs
  `snap_final_a2` (pre-fix pushed build `8a21618`) — **IDENTICAL, 31/31
  captures, 0 errors, styles clean, pixels identical**. The switch-sync fix
  changes no final-state visuals (capture scenes only touch seg `td.*`
  keys, as predicted). Full acceptance for both fixes is CLOSED.
- Note: this appendix records the push, so it exists in the working copy
  only; the capture-diff verdict below is appended when the run completes.

### User-facing effect
- The frozen switch knobs animate again immediately on any build with this
  fix — no stored state involved.
- Devices stuck at instant THEME switches self-heal on first load after the
  theme-fx expiry fix (legacy `td.fx` removed); `?fx=reveal` still forces an
  immediate override.

### Real-device HUD run (user, 2026-11-06): PASS

16 theme switches via the HUD on the pushed build (`59a29f5`): tier stayed
**`reveal` on all 16** (the supersession fix held — no downgrade burn under
~1s-interval toggling), `readyRejected: null` and `earlyEnd: null` on all
16, `progressAtFinish: 1` (full reveal completed every time). Frames:
p50 16.7 ms, tail p95 16.7–16.9 ms, handoff max 16.7–16.9 ms, worst single
frame 33.5 ms (one 2x frame at switch start — normal), 42–44 frames per
700 ms animation (~60 fps). `R_safe = R_true x 1.08 + 48` held in 16/16
(e.g. 1023.85 -> 1153.76). Viewport stable (`events: []`, start == end).
Caveat: all switches ran at scroll ~0 with no viewport events — the
scrolled / address-bar variants were not exercised in this run.
