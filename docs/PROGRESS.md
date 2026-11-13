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
  - [ ] **Worker D scope NOT STARTED:** frontend is still byte-identical to the
        original. No `tauri` adapter, `index.js` still calls `DAC.analyze` with a
        simulated batch loop.

- [ ] **Phase 4: Tauri Shell & Quick Binary (CP2 & CP3)** — NOT STARTED
  - `src-tauri/src/lib.rs` is still the vanilla scaffold (no `commands.rs`,
    `state.rs`, `sink.rs`, no `invoke_handler`). `rfd` is already a dependency
    for the future `pick_csv` file dialog.

- [ ] **Phase 5b/6/6b/9** — not started. `docs/MANUAL_TEST.md` already written and
      corrected this session (rule listings now match the code; new-rule tests added).

---

## Verification Log

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

## Open Questions for Jad

1. **File picking:** contract has `pick_csv` (native dialog from Rust), but the UI
   also supports drag-and-drop, which gives the WebView a `File` object with no path.
   Options: (a) native dialog only, (b) add `analyze_csv_content` command for
   dropped content (contract deviation), (c) both.
2. **CSV entry limit:** UI setting `maxCsvEntries` defaults to 100; backend allows
   5,000. `stress_500.csv` would be rejected by the current frontend guard.
3. Single-scan animation: keep the fixed `scanSpeed` animation duration and swap in
   the real result when it arrives (recommended), or drive duration from actual
   backend latency?
