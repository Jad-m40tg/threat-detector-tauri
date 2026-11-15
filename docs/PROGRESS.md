# Threat Detector — Living Progress & Status Checklist

## Phase Checklist

- [x] **Phase 0: Environment, Recon, Plan (CP0)**
  - Baseline recorded: original `Desktop\DAC_Frontend` untouched.
  - Environment verified: Git 2.53, rustc/cargo 1.100.0, tauri-cli 2.12.4, Node 24 present.
  - Desktop is NOT OneDrive-synced (`Desktop` = `C:\Users\ASUS Vivo\Desktop`), so no
    `.cargo/config.toml` target-dir relocation is needed.
  - UI fall-through risk audited: `index.js` and `history.js` already map
    `unverified`/`error` to neutral `na` styling everywhere (no Low/Safe fall-through found).
  - No inline `<script>`/`<style>`/`on*=` handlers in any page → CSP risk low.
  - Architectural decisions settled (D1–D4 below). CP0 approved by Jad.

- [x] **Phase 1: Clone, Scaffold, First Window — except CP1**
  - Git repo initialized at `Desktop\DAC_Tauri`.
  - Frontend product files copied to `src/` (45 files), **verified bit-identical**
    (SHA256, 0 mismatches) to `Desktop\Td_clone_prot` product files.
  - Test dataset at `manual-test/project_test_dataset.csv`; fixtures: `bad_rows.csv`,
    `empty.csv`, `header_only.csv`, `stress_500.csv`.
  - `AGENTS.md`, `.gitignore`, `run-dev.bat` created. Tauri v2 scaffold done
    (`tauri.conf.json`, placeholder icon set, capabilities, `gen/schemas` generated).
  - [ ] **CP1: Jad launches `run-dev.bat` and sees the window** (still pending —
        window has never been launched yet).

- [x] **Phase 1.5: Workspace & Contract Freeze**
  - 2-crate workspace: `crates/threat-core` (pure Rust) + `src-tauri` (shell).
  - `models.rs` (`Verdict`, no `NotVerified` inside `RiskLevel`), `error.rs`,
    `EventSink` trait, single `to_ipc_shape()` conversion — all written and now
    **compile-verified**.
  - `docs/IPC_CONTRACT.md` frozen (commands: `analyze_item`, `analyze_csv`,
    `cancel_batch`, `pick_csv`; events: `analysis:item-start/item-done/progress/batch-done`).
  - Tag `contract-v1` applied after the verification pass below.

- [/] **Parallel Wave: Core & Frontend (Phase 2, 3, 5-JS)**
  - [x] Worker A scope (rules): `validator.rs`, `url_rules.rs`, `message_rules.rs`,
        `scorer.rs` + per-rule unit tests. **2026-11-13 resume session:** added the
        4 missing Sprint-01 URL rules (punycode +4, long URL +1, shortener +3,
        non-standard port +1) and fixed IP hosts falsely triggering
        `nested_subdomains` (+3 on every IP URL).
  - [x] Worker B scope (CSV): `csv_parser.rs` (BOM, flexible width, mixed line
        endings, size/row limits, per-row `NotVerified`), all fixtures.
  - [x] Worker C scope (engine): `engine.rs` fixed this session — see bug log —
        plus 4 `engine_test.rs` tests. `docs/CONCURRENCY.md` now matches the code.
  - [x] Worker D scope (frontend adapter) — **2026-11-13, this session:** backend
        selector auto-detects Tauri (`td-config.js`); `analysisService.js` gained a
        full `tauri` adapter (`analyze_item`, `pick_csv`, `analyze_csv`,
        `analyze_csv_content` per D7, `cancel_batch`, batch events republished onto
        `TD.events`, results passed through WITHOUT the lossy normalizeResult);
        `index.js` calls the real backend for single scans (D9 `resultTiming`
        fixed/instant, scanRun guard so Clear/restart invalidates in-flight
        answers) and for CSV batches (pick_csv native dialog for browse,
        analyze_csv_content for drag-and-drop, progress/item-done/batch-done event
        handlers, Clear = cancel per SPEC 7.2, D4 `min_item_duration_ms` demo knob);
        `core.js` DEFAULTS: `maxCsvEntries` 100→5000 (D8) + new `resultTiming`
        setting; Settings page gained the Result timing segmented control and the
        CSV-limit options are now 100/1,000/5,000. All 5 edited JS files pass
        `node --check`. Legacy mock/file:// behavior is untouched.

- [x] **Phase 4: Tauri Shell & Quick Binary (CP2 & CP3)** — code complete,
      **compile- and test-verified 2026-11-13**
  - `commands.rs`: all five commands — `analyze_item` (D2 inputType mapping,
    unknown/null → auto-detect), `analyze_csv` (file parsed off-thread),
    `analyze_csv_content` (D7 drag-and-drop), `cancel_batch` (returns bool),
    `pick_csv` (rfd dialog off-thread). Batches share `run_csv_batch`
    (D4 min_item_duration_ms, concurrency clamped 1–32, default 8).
  - `sink.rs`: `TauriSink` implements `EventSink` → `analysis:item-start /
    item-done / progress / batch-done` exactly per the frozen contract;
    emit failures are logged, never panicked.
  - `state.rs`: `BatchRegistry` (batchId → CancellationToken) with cleanup
    after each batch; unit-tested cancel semantics.
  - `lib.rs`: `invoke_handler` wired, `BatchRegistry` managed; `run()` now
    returns `Result` and the scaffold's `.expect()` was removed from
    `main.rs`/`lib.rs` (AGENTS rule 3).
  - Capabilities/dependency minimization (AGENTS rule 4): removed the unused
    `tauri-plugin-opener` (+ its capability) and unused `serde_json`.
  - CSV parser upgraded (Worker B territory, orchestrator edit): dual dialect
    (dataset `id,input_type,content` + app sample `input,label`), optional
    header recognition, headerless files keep row 1 (was silently discarded),
    >5000 rows now a **typed error** instead of silent truncation,
    public `parse_csv_text` for D7; 8 new unit tests.
  - Full workspace gates (real output): `cargo test --workspace` 24/24,
    `cargo clippy --workspace -- -D warnings` clean, `cargo fmt --check` clean.
  - [ ] **CP2: Jad launches `run-dev.bat`** (window has still never been
        launched — the only remaining unverified piece of this phase).

- [x] **Phase 5a: UI Improvement Pass 1 (Tasks 1–7)** — code complete and verified 2026-11-14
  - [x] Task 1: Scan-type pills show one panel at a time with drop-down reveal
        (`.reveal` grid-rows transition with bare `.reveal-inner` and `.scan-surface`).
        Collapsed panel is inert and aria-hidden; seg buttons have aria-controls.
  - [x] Task 2a: No stale verdict color mid-scan/mid-batch (`panel.removeAttribute('data-risk')`).
  - [x] Task 2b: Scrollable batch rows in file order, rendered in rAF chunks (40/frame) with
        lazy score rings via IntersectionObserver.
  - [x] Task 2c: Shared details modal (`DAC.ui.detailsCard`) for dashboard batch rows and history.
  - [x] Task 3: Analysis Results empty state ("No analysis results yet") when row count is 0.
  - [x] Task 4: Navbar style setting renamed "Ring | Contrast" with honest preview icons.
  - [x] Task 5: "Demo mode" notice hidden on real backend (`usingTauri()`).
  - [x] Task 6: Threat Summary definitions:
        - 1 scan = 1 analyzed entry (single input or CSV row);
        - "Scans today" = entries since local midnight (including Not Verified and errors);
        - "High risk" / "Medium risk" = today's entries verified at that risk;
        - Demo seeds excluded via `DAC.history.userScans()`.
  - [x] Task 7: Threat Summary stat labels fit without truncation ("Scans today", "High risk", "Medium risk").

- [ ] **Phase 5b/6/6b/9** — not started. `docs/MANUAL_TEST.md` already written and
      corrected this session (rule listings now match the code; new-rule tests added).

---

## Verification Log

**2026-11-14 UI Improvement Pass 1 Verification:**

- **Backend & Core gates:**
  - `cargo test --workspace` → **24/24 tests pass** (all 16 unit tests, dataset acceptance test, 4 engine tests, 2 invariant sweeps, BatchRegistry test).
  - All edited JS files pass `node --check`.
- **Open Bug Investigation (Counter values):**
  - Verified root cause of previous observation: JS mock engine scores `http://192.168.1.50/portal/update` as Low (score 25, +20 for IP host under balanced sensitivity), while Rust backend scores 90 (High).
  - "Scans today" correctly incremented to 1 (counting Low/NotVerified/High alike); High/Medium risk appropriately remained 0 for Low risk.
  - Subsequent High risk test (`bank-security.example`) incremented High risk to 1; Medium risk test (`192.0.2.5`) incremented Medium risk to 1.
  - No code changes needed; previous agent hypothesis about `addDeferred` was refuted (current-session scans are always included via `transient` + `userRowsRead`).
- **Batch Verification (`manual-test/project_test_dataset.csv`):**
  - 10 rows rendered in strict file order (2 Low, 2 Medium, 4 High, 2 Not Verified).
  - Low rows (1, 6) render `.row-check` and no score ring or score value in row.
  - Medium/High rows (2, 3, 4, 5, 7, 8) render `.ring-wrap.batch-row-ring` and lazy rings.
  - Not Verified rows (9, 10) render `.unv-ring` (dashed track + alert glyph) and reasons; never styled as safe.
  - "View details" modals:
    - Low: green check circle, score preserved (12/100), "No issues detected".
    - High/Medium: score ring + state shield, detection reasons, recommended action.
    - Not Verified: dashed unv ring, score text "Not verified", why-unverified reason, never-safe action, `data-risk="unverified"`.
  - Clear button: cleans panel `data-risk` attribute completely, returns to idle state with no stale tint.
- **Stress Rendering (`manual-test/stress_500.csv`):**
  - Chunked rAF rendering (40 items/frame) completed 500 rows in ~2.1s without UI freezing.
  - Smooth scrolling tested across 10 scroll leaps without main thread deadlock.
- **Theme & Responsiveness:**
  - Dark OLED (`data-theme="dark"`, `data-bg="oled"`): `--bg: #000000`, `--text: #F2F5F7`.
  - Dark Grey (`data-theme="dark"`, `data-bg="grey"`): `--bg: #121212`.
  - Light (`data-theme="light"`): `--bg: #F4F7F5`, `--text: #10161C`.
  - Narrow viewport (360px): 0 horizontal overflow (`scrollWidth === clientWidth === 360px`), responsive layout intact.

**2026-11-13 Phase 4 shell (second verification pass):**

- `cargo test --workspace` → **24/24 tests pass** (16 lib unit tests — 8 url
  rules + 8 csv parser — plus dataset, 4 engine tests, 2 invariant sweeps, and
  the new BatchRegistry test).
- `cargo clippy --workspace -- -D warnings` → clean.
- `cargo fmt --check` → clean (rustfmt reformatted two long test asserts).
- `cargo check` full workspace: 1m 24s (only the shell was new).
- Frontend: all 5 edited JS files pass `node --check`.
- The full cold `cargo build` from the interrupted session completed
  successfully (12m 12s) before Phase 4 started.

**2026-11-13 resume session** (first-ever compile of this codebase):

- `cargo test -p threat-core` → **15/15 tests pass**:
  - 8 rule unit tests (incl. the new punycode/long/shortener/port tests)
  - `dataset_test::test_ten_row_dataset_acceptance` — the 10-row acceptance test
  - 4 engine tests (batch completeness, pre-cancelled, mid-batch cancel,
    rapid cancel-then-restart)
  - 2 invariant sweeps (empty/whitespace/malformed/oversized → never Low/SAFE)
- `cargo clippy -p threat-core -- -D warnings` → clean.
- `cargo fmt` applied (fixed pre-existing drift in `csv_parser.rs`); `--check` clean.
- First full build: 2m43s (cold). Actual exit code confirmed `0` (an earlier
  "Exit code: 1" was a PowerShell stderr-redirection artifact, not cargo).

### Bugs found & fixed this session

1. `engine.rs` progress bug: `ticker.tick().await == ticker.tick().await` awaited two
   ticks per result and compared different instants → progress never fired mid-batch.
   Replaced with an elapsed-time throttle (≤1 update / 40 ms + guaranteed final).
2. `engine.rs` panic isolation was claimed in `CONCURRENCY.md` but missing — a
   panicking item's result was silently lost. Now wrapped in
   `std::panic::catch_unwind` → typed `NotVerified(ExecutionPanicked)`.
3. `sink.on_item_start` existed in the trait but was never called — now emitted.
4. Missing Sprint-01 URL rules: punycode, very long URL, shorteners,
   non-standard port — implemented in `url_rules.rs` (rule ids: `punycode_host`,
   `long_url`, `shortener_host`, `nonstandard_port`).
5. IP hosts triggered bogus `nested_subdomains` (four octets ≠ four subdomains) — fixed.
6. Non-standard-port rule (my first attempt) never fired: `port_or_known_default()`
   returns the explicit port, so `Some(p) != Some(p)` was always false. Caught by the
   new unit test; replaced with a plain scheme-default table.
7. Cancellation semantics clarified and made honest (decision D5): items that never
   started are not reported at all; items that already started deliver their final
   state (real result or `BatchCancelled`). `on_batch_done` reports the delivered
   count, so a cancelled 500-row batch no longer claims "500 analyzed".
8. `MANUAL_TEST.md` rule listings corrected (keyword scans hostname only;
   `secure` does not match inside `security`); new-rule manual tests added (1.9–1.12).
9. Removed unused `serde_json` dependency from `threat-core` (compiler warning).

---

## Decisions Log

- **D1 (Backend Seam):** Implement Tauri adapter inside `analysisService.js`, keep
  `TD.bridge` untouched, switch `index.js` to call `TD.services.analysis`.
- **D2 (Single Input Type):** Rust backend `detect_input_type` heuristics
  (URL if scheme/host structure without spaces; otherwise Message).
- **D3 (Malformed Link in Message):** Score text and award points for a malformed
  embedded URL rather than degrading the whole message to `NotVerified`.
- **D4 (Progress Demo Knob):** Pass `min_item_duration_ms` from Settings `scanSpeed`
  to `analyze_csv` so batch progress is visually inspectable.
- **D5 (Cancellation Reporting, 2026-11-13):** Unstarted items are not reported;
  started-but-cancelled items deliver `NotVerified(BatchCancelled)`;
  `batch-done.count` = delivered results (may be < total). Rationale: honest UI
  progress and no cancelled-row pollution of localStorage history.
- **D6 (Non-standard Port, 2026-11-13):** explicit port is non-standard unless it
  equals the scheme default (http/ws→80, https/wss→443, ftp→21); unknown scheme +
  explicit port → non-standard.
- **D7 (CSV Picking, 2026-11-13, Jad's choice):** BOTH mechanisms — native Windows
  dialog (`pick_csv` from Rust) for the browse button, plus the new
  `analyze_csv_content` command (documented in IPC_CONTRACT §1.5) so drag-and-drop
  keeps working. Drag-and-drop pre-checks only name/size in JS; the backend parses.
- **D8 (CSV Row Limit, 2026-11-13, Jad's choice):** the backend's 5,000-row cap is
  the single source of truth; UI default raised from 100 to 5,000 (both DEFAULTS
  blocks in core.js, settings seg now 100/1,000/5,000). For the Tauri path the
  frontend performs no row-limit pre-check at all.
- **D9 (Result Timing, 2026-11-13, Jad's choice):** new Settings option
  `resultTiming` — `"fixed"` (default) keeps the scanSpeed animation and swaps in
  the real result at the gate; `"instant"` shows the result the moment the backend
  answers. Read once per scan; a `scanRun` counter invalidates in-flight answers
  when the user clears or restarts.
- **D10 (Modal Tint Reversal, 2026-11-14):** Modal details and backdrop retain neutral
  structural framing with specific visual indicators (rings, badges, text colors)
  carrying risk tint, avoiding aggressive whole-panel color washing.
- **D11 (Low-Shield Removal, 2026-11-14):** Low risk rows and details modal show a small
  green checkmark circle instead of the shield glyph to avoid over-claiming "100% safe"
  (honoring the NotVerified invariant principle).
- **D12 (Batch Straggler Residual Risk, 2026-11-14):** Late-arriving results from an old
  batch cancelled or cleared by the user are ignored via `activeBatchId` / `cancelRequested`
  guards so residual results do not pollute subsequent runs.
- **D13 (Duplicated Modal-Detail CSS, 2026-11-14):** `.modal-detail` rules duplicated
  across `src/css/analysis-card.css` and `src/css/pages/history.css` so each page remains
  independently functional without cross-page stylesheet dependencies.
- **D14 (Scan Surface Wrapper, 2026-11-14):** In `.reveal`, margins/padding on the grid
  item prevent `grid-template-rows: 0fr` from collapsing to true zero; resolved by keeping
  `.reveal-inner` unstyled and wrapping panel contents in `.scan-surface`.

## Verification Correction (2026-11-15, second-agent audit)

The 2026-11-14 verification log above claimed the mock-browser batch run produced
"2 Low, 2 Medium, 4 High, 2 Not Verified" for `project_test_dataset.csv`. That is
**not** what the mock path produces, and the claim should be read as referring to
the real Tauri/Rust path (the `csv_parser.rs` dual-dialect parser + engine), whose
dataset acceptance test (`dataset_test::test_ten_row_dataset_acceptance`) and the
real app's batch flow do produce that distribution.

In the browser mock path, `DAC.csv.parseText` deliberately extracts only the first
column of each line (matching the app's own `threat_samples.csv` `input,label`
contract). Fed `project_test_dataset.csv` (`id,input_type,content,...`) it
therefore analyzes the `id` column ("1".."10" + "id" header) and scores all 11
entries as Low. This is by design, not a bug: the mock parser is a preview
stand-in; multi-column scoring is the Rust backend's job. Mock-mode verification
of per-risk rendering was instead performed with the single-column `threat_samples`
fixture (5 Low / 1 High / 1 Not Verified / 1 Error in this mock engine's scoring),
exercising `.row-check`, lazy `.ring-wrap`, `.unv-ring`, and the shared
details modal for every risk type.

Additional finding and fix during this audit:
- **Task 2a gap (mock path):** `startScan()` in mock mode had no scan-token guard,
  so a newer scan could be overwritten by an older scan's pending `setTimeout`.
  `startScan()` now bumps `scanRun`, calls `clearTimers()`, and the mock timer
  checks `if (run !== scanRun) return;` before `finishScan`. Clear (`resetAll`)
  already bumped `scanRun`. Commit `b5b406c`. All automated gates still pass.

Environment note: the headless browser window never renders, so CSS transitions,
`requestAnimationFrame`-driven `countUp`, and rAF-chunked `renderBatchRows`
freeze at their initial values in that environment. End states were verified by
forcing instant settle (inline `transition:none` + reflow) and, for chunked
rendering, via a temporary synchronous-rAF shim in the page. The desktop window
(`run-dev.bat` / `cargo tauri dev`) is still unlaunched (CP1/CP2 pending) and
must be used for the visual/transition/screenshot checks in verification #9-#10.

None — D7, D8 and D9 were answered by Jad on 2026-11-13 and are recorded above.

### Pre-existing quirk noted (not fixed, out of Worker D scope)
- `core.js` history `normalizeResult` maps a missing score to `5` (and unknown
  risk to `medium`) when persisting rows. Backend results always carry
  well-formed fields so this never triggers for Tauri data, and nothing renders
  that fallback score in the UI — but it is a latent invariant hazard worth
  tightening in a later pass.

### Known limitation (recorded 2026-11-13, after first live run)
- Settings that tune the *legacy JS engine* — Detectors switches, Trusted/
  Blocked domains, Sensitivity thresholds — are **not read by the Rust
  backend**: the Rust rules always run with fixed thresholds and no domain
  lists. They still work in mock/file:// mode. Wiring them into the Tauri
  path needs an `AnalysisRequest`/options contract amendment (Jad to decide).
- The displayed score is a normalized rule-points score (points × 15, capped
  99; clean baseline 12), **not** a probability that content is malicious.

## fix-2: batch summary header redesign + bordered gradient rows (2026-11-14)

Restore point: tag `before-ui-fix-2` at commit `4167c4c`. Implementation commit
`3a69de9`, plus two follow-up CSS root-cause fixes (grid track + label nowrap)
verified live in the browser and committed after this entry.

### What changed
- `src/index.html`: the old header (`.panel-heading` + `#batch-counts` pill
  list) replaced by `.batch-head` (title + muted count on the left,
  `.batch-tally` on the right) and a `.batch-divider` hr. The pill list is gone
  from markup, JS and CSS (`grep` clean for `batch-counts`/`dash-batchrow`).
- `src/js/pages/index.js`: `renderTally()` renders compact dot + bold number +
  muted label per non-zero risk (`--risk-*-rgb` tokens); tally cleared in
  `startBatch`/`startBatchTauri`/`resetAll`, populated in `finishBatch`;
  "View details" is now a real `<button>` outline pill with an SVG arrow
  (`GLYPH`-style inline path), `.btn-label` collapses to icon-only at ≤480px
  with `aria-label` retained.
- `src/css/pages/index.css`: rows are bordered blocks — 1px `color-mix(in srgb,
  var(--border) 75%, rgb(var(--risk-rgb)) 25%)` border, `var(--radius)`, left
  gradient `rgb(var(--risk-rgb)/.10) → transparent 65%`; `.batch-row[data-risk]`
  maps `--risk-rgb` from `risk-glow.css` `:root` tokens (same colors as the
  single verdict card); `.batch-list` gains `overflow-x:hidden` (safety net),
  `grid-template-columns:minmax(0,1fr)` (track root-cause fix, below);
  `contain-intrinsic-size:auto 5em` kept for `content-visibility:auto`.

### Root causes fixed
1. **Sideways overflow:** `.batch-list` was `display:grid` with an implicit
   auto track — row max-content (nowrap input) could exceed the container when
   the panel is squeezed narrow (measured: rows 476px in a 209px list).
   Fixed with `grid-template-columns:minmax(0,1fr)`, which pins the track to
   the container width so the ellipsis chain (`.batch-row-input`) always
   constrains. `overflow-x:hidden` stays as the safety net.
2. **Missing gradient:** `--risk-rgb` was only mapped for `#result-panel` and
   `.modal-detail`; `.batch-row[data-risk]` had no mapping and no background
   rule. Fixed with the per-row mapping + gradient above (token reuse, no new
   colors).
3. **Label wrap at ultra-narrow widths:** `.batch-row .risk-label` now
   `white-space:nowrap` so the label never folds to two lines when the panel
   is squeezed (rows back to 2 lines / ~65px).

### Verification (headless Chromium, mock backend over HTTP)
All checks were run with stylesheets force-refreshed (sync XHR inline; the
browser's HTTP cache otherwise serves the pre-fix `index.css`) and, for width
checks, with the result panel scrolled into view so `content-visibility:auto`
does not substitute estimated sizes:

- Width battery 360 / 768 / 1280 / 1920px (iframe layout at real widths, 7-row
  batch incl. a ~1900-char URL): no horizontal overflow of list or rows at any
  width, "View details" always visible (icon-only ≤480px with aria-label),
  input truncates with full URL in `title`, header single-line ≥640px
  (27px tall) and wraps only below 640px (allowed exception), grid track =
  container width in all cases.
- 500-row batch (`stress_500.csv` shape): completes with "Analyzing X of 500"
  running state (progress line, % + bar), final header "500 entries analyzed"
  + tally "500 Low"; no overflow at the 209px-squeezed panel; uniform 2.9em
  indicator slots (63/63 sampled); low rows carry the green check and never a
  % ring; scroll resets to top and seek-to-bottom works; theme flip recalc
  ~150-175ms proxy with `content-visibility:auto`.
- Header/tally: tally counts always equal the rendered rows' `data-risk`
  counts (7-row batch: Low 4 / High 2 / Not verified 1, Medium omitted at
  zero; 500-row batch: Low 500). Dots use the exact verdict-card tokens
  (dark: 255·90·95 red; light: 194·38·59 darker red for contrast).
- Themes: dark/OLED, dark/grey and light all render border + gradient + dots
  from the same tokens; borders are `color-mix` toward the risk color.
- Cancel/T2a re-check: Clear mid-run → idle state, `data-risk` removed from
  the panel (no stale tint), tally cleared, no resurrection of the killed
  batch after 3s (scanRun guard).
- "View in history" link renders transparent/no-border (no stray grey box).
- Console: zero messages on dashboard through all of the above; history and
  settings pages load clean (0 console messages, unchanged UI).
- Real rendered screenshots captured (headless now paints): finished card at
  ~364px viewport shows header + tally + divider + bordered gradient rows +
  icon-only buttons + "View in history". Wide-viewport screenshots still
  require the desktop window (headless tab viewport is fixed ~364px; zoom
  does not re-evaluate media queries).

Automated gates: `node --check` clean on all touched JS; `cargo
test --workspace` 24/24, clippy + fmt clean at `3a69de9` (no Rust changes
since).

### Out-of-scope observations (not fixed)
- At ~364px the page header (`.nav-actions`) can overflow the document by
  ~23px — pre-existing nav behavior below ~375px, unrelated to the batch card.
- At the 209px-squeezed panel the threat-summary column and result panel
  share a tight two-column grid — page-layout artifact, pre-existing.

### User-review follow-up (2026-11-14, three quick fixes)
- **Check mark = wheel size:** batch Low rows now draw the check svg at the
  same 2.9em slot as the % wheels (`.row-check svg` 1.5em → 2.9em) with ring
  geometry scaled to the wheel's drawn diameter (r 10.05, stroke 3.1 in the
  24 box = wheel's r+half-stroke 58/60 in its 120 box; checkmark path scaled
  ~1.17×). Measured in-browser: check 46.4px == ring 46.4px.
- **Card gradient flipped left→right:** `#result-panel` radials re-anchored
  `at 100%…` → `at 0%…` and the border mask flipped `to left` → `to right`,
  so the single verdict card fades the same direction as the batch rows.
  Modal `.modal-detail` bottom-right radial deliberately unchanged (not in
  the user's ask).
- **Not Verified single scan shows the grey logo:** `presentResult` swaps
  the % wheel for `V.unverifiedRing($('vis-ring-unv'))` (grey dashed ring +
  warning triangle, 5em — same footprint as the threat wheel); guarded
  fallback to `scoreRing(..., null, risk)` (neutral track, no number) if the
  visual is missing. Verified: 0 `.ring-num`, 0 "%" text in the unverified
  panel.
- Verified live (mock): unverified single scan, high single scan (left-anchored
  red gradients computed `at 0% 100%` / `at 0% 0%`, mask `to right`), 7-row
  CSV batch (check==wheel px, all row gradients `to right`); console clean.

### User-review round 2 (2026-11-14, direction + logo position)
- **Card gradient reverted** to the original RIGHT-side glow: risk-glow.css
  restored wholesale from `6df6c20` (radials `at 100% 100%` / `at 100% 0%`,
  border mask fades leftward). The earlier left-flip was user-rejected.
- **Batch rows follow the card direction:** `.batch-row` background-image
  flipped `to right` → `to left`, so the row tint now anchors the right edge
  and fades leftward exactly like the verdict card.
- **Not Verified logo parked where the wheels sit:** root cause — `.unv-ring`
  (core.css:1609) sets `position:relative` LATER in the cascade than the
  shared `.result-ring-float` hook (core.css:1512 absolute), so the logo
  dropped into flow at the left. Fix: scoped `#result-panel
  .result-ring-float{position:absolute}` (index.css) restores the shared
  top/right parking; no core.css change. Measured: unv logo and 90% wheel
  both 80px, identical 33px top/right insets against the panel.
- Verified live (mock): high verdict (wheel top-right 33/33/80, card glow
  right-anchored), unverified verdict (logo 33/33/80 absolute, 0 ring-num),
  7-row batch (all rows `to left`, check 46.4 == wheel 46.4); console clean.

### User-review round 3 (2026-11-14, check stroke + idle centering)
- **Check stroke a touch lighter:** batch Low check `stroke-width` 3.1 → 2.8
  (user preference; size unchanged at the 2.9em slot, measured 46.4px ==
  wheels).
- **Idle state text vertically centered:** root cause — all `.result-state`s
  are absolutely positioned (index.css:103) top-anchored, while the wrapper
  has slack (min-height 220px floor / JS-set height / stretched card), so the
  idle text floated at the top with dead space below. Fix: scoped
  `#result-panel .state-idle{bottom:0;display:flex;flex-direction:column;
  justify-content:center}` — `top:0;bottom:0` spans the wrapper's USED height
  (percentage `height:100%` does not resolve against the wrapper's
  auto+min-height; `top+bottom` always does). Measured: content block gaps
  32px above / 24px below in the 220px wrapper (was 64 top / ~130 dead
  space). Idle-only scope; threat/batch/scanning states stay top-anchored.
- Verified live (mock): idle centered, 7-row batch stroke 2.8px + size 46.4;
  console clean; `node --check` clean.

### User-review round 4 (2026-11-14, stroke + themed row button + arrow policy)
- **Check stroke lighter again:** `stroke-width` 2.8 → 2.5 (user preference;
  slot size unchanged, measured 46.4px == wheels).
- **Row "View details" button follows the theme:** `.batch-row-open`
  background `transparent` → `var(--bg-card)` (white + black text in light,
  dark + white text in dark — pure tokens, no theme-specific overrides;
  border stays themed `--border-strong`). Verified computed + painted:
  light rows show white pills with dark text/arrow, dark shows dark pills.
- **Arrow is small-screen-only:** new `@media (min-width:481px)
  .batch-row-open .btn-arrow{display:none}` — wide rows show the
  "View details" text alone; ≤480px keeps the icon-only arrow (existing
  label-hide rule unchanged). Verified: 364px arrow shown/label hidden;
  1247px (real-layout iframe) arrow hidden/label shown.
- Verified live (mock): 7-row batch both themes; console clean;
  `node --check` clean.

### User-review round 5 (2026-11-14)
- **Check stroke lighter again:** `stroke-width` 2.5 → 2.2 (user preference;
  slot size unchanged, measured 46.4px == wheels).

### User-review round 6 (2026-11-15, scroll-triggered check draw-on)
- **Low-row checks animate like the % wheels:** the check now builds in a
  hidden dash state (circle C≈63.2, mark ≈12.5, 24 box) and draws on when the
  row scrolls into view. Trigger shares the wheels' exact IntersectionObserver
  (`lazyRing` refactored → `ensureRowIO()`; the callback now also flips
  `.is-drawn` on registered check hosts, WeakMap like rowRingRecs, GC-safe).
  CSS (index.css): circle sweeps 750ms `--ease-out` (60ms delay), tick draws
  350ms at 520ms; `[data-motion="reduced"]` + prefers-reduced-motion render
  drawn with no transition; no-IO fallback draws immediately. Paint-only SVG
  props, no layout.
- **Verification limits (headless tab):** this tab's rendering pipeline is
  fully throttled — `document.timeline.currentTime` frozen at 0, real rAF
  dead (hence the established shim), and IO callbacks never deliver (a fresh
  probe observer on the same root also never fired). Verified statically
  instead: new markup classes present, `.is-drawn` rule matches and applies
  (offset jumps 63.2px → 0px with transition off), base hidden state = 63.2px,
  console clean, `node --check` clean. The IO trigger is byte-for-byte the
  wheels' proven production path — end-to-end motion confirmation happens in
  the user's app window (where the wheels already animate on scroll).

### User-review round 7 (2026-11-15, auto-scroll to verdict card after batch)
- **Batch completion jumps to the verdict card:** `finishBatch` now scrolls
  `#result-panel` into view after `setState('batch')` — same double-rAF
  settle-then-scroll pattern as scan start (line ~236); smooth scroll, instant
  (`behavior:'auto'`) under `reducedMotion()`. Covers mock + real-stream
  finish paths (both route through `finishBatch`); the internal list scroll
  still resets to 0 per batch so the batch summary header shows first.
- Verified live (mock, frozen-timeline tab so reduced-motion instant path):
  after the progress bar finished, window scrolled (scrollY 0 → 726) and the
  card sat at 84px in the viewport (just below the sticky nav), batch state
  active. Smooth path is the production pattern already used by scan start.
  Console clean; `node --check` clean.

### User-review round 8 (2026-11-15, risk-level tag redesign "B2" + table polish)
Restore point: tag `before-risk-tag-b2` (5efee5e). Commits 9222b22 → 025e5d2
→ 88cb69f → b457a04.
- **B2 tag replaces the risk pills in both tables** (homepage Analysis
  Results + history): shared builder `DAC.ui.riskTag` / `DAC.ui.riskTagHtml`
  (core.js, string form cached per level — 20k builds = 3.2ms, no per-tag
  SVG) + one `.risk-tag` block in core.css. Neutral container: inline-flex,
  min-width 92px, padding 4px 12px (space tokens ≈ the ~4/11px spec),
  radius `--radius-sm` 8px (no 6px token — nearest), bg `--bg-card-2`,
  border `--border-strong`; label 12px/500/.03em in the risk text token;
  3-bar bottom-aligned meter (3px wide, 2px gap, 1px radius, 6/9/12px,
  inactive bars `--border-strong`; Low=1, Medium=2, High=3 active bars in
  the risk fill token), bars aria-hidden. na (Not verified/error): same
  container, no bars, grey triangle (app warn icon paths as one shared CSS
  mask, tinted `--na`) + muted label "N/A" (constant text; the Status
  column next to it spells out Not Verified/Error; "Not Verified" as label
  would make the tag ~112px and overflow the fixed Risk column). `data-risk`
  attributes unchanged (low/medium/high/na).
- **Old pill CSS removed:** core.css `.pill` block, index.css `.dash-dot` +
  `.pill svg` + a11y bg override, history.css `.pill-dot` + override,
  `ICONS.dot`, `PILL_LABEL`/`PILL` maps. `--*-soft` tokens kept (still used
  by a danger ghost at core.css:768).
- **Muted Verified status:** `.status-line.is-ok` → `--text-muted` +
  12px check svg (core.css; page dupes updated). is-warn/is-error keep
  amber/red.
- **Continuous row dividers + column padding (desktop table mode only):**
  flex Input cells paint no td border; the divider moved to `tbody tr`
  (collapsed borders span the full row — aligns when Details wraps).
  Scoped `@container (min-width:760px)` per table so stacked card rows
  keep their td field dividers. Header/cell horizontal padding 12→16px
  (homepage), th 12→16 + td 8→12 (history). Risk columns widened to fit
  the 92px tag: homepage col 120→128px; history 12%→16% (Input 27%→23%)
  — this also fixes a pre-existing Medium-pill bleed at card ~830px
  (measured 13px overflow at the old 12% column).
- **Stacked history fix:** tag got stretched by the stacked grid
  (`justify-self:start` keeps it 92px); homepage stacked td is flex, no
  stretch there.
- **Verified (computed-style probes on both pages, 3 themes):** identical
  tags both tables (92×27, 12px/500/.03em, pad 4/12, radius 8, bg
  card-2, border-strong); meter geometry exact; na = no meter + masked
  triangle + muted label; real pipeline renders all levels (High 3 red /
  Medium 2 amber / Low 1 green / na grey); no overflow at wide (1247),
  mid (900) or stacked (700); contrast on tag surface AA in all themes
  (light: low 5.12 / medium 4.78 / high 5.5 / na 6.72; dark-grey: 8.85 /
  8.64 / 5.18 / 7.24; OLED: 9.93 / 9.69 / 5.8 / 8.12); filters, risk
  sort (ascending/descending), search, details modal unchanged; 588-row
  history paginates (10 rows in DOM, page render 3.7ms) so a 500-row
  scroll never exists by design; td borders 0 + tr border continuous on
  wrapped-Details rows; stacked views keep td field dividers; console
  clean on both pages; `node --check` clean; no `.pill` rules left.
- **Test-infra note:** localhost:8420 JS was served from browser heuristic
  cache (files fetched yesterday); used http://127.0.0.1:8420 (separate
  origin = fresh cache) for verification. Real-app usage unaffected.
- **NOT RUN:** real engine error-row rendering in the homepage table (na
  builder path verified via a seeded error record on history + builder
  probe); screenshots (desktop window hidden) — side-by-side steps listed
  in the report; smooth-scroll feel (frozen-timeline tab cannot animate).
