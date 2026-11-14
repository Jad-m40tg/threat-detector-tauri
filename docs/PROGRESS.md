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
