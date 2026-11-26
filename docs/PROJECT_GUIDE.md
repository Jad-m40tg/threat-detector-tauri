# Threat Detector — Complete Project Guide

> Read-only reference. Generated for Jad (Concurrency Programming, Sprint 01).
> Code wins over docs where they disagree — see section 15 for known mismatches.

## Table of contents

1. Summary
2. Tech stack and libraries
3. Project structure
4. Architecture overview
5. Front-end / backend link (IPC)
6. The scan process, end to end
7. Backend, file by file
8. Concurrency design
9. The "never safe if unverified" guarantee
10. Front-end, file by file
11. How the main UI components are built
12. Data and storage
13. How to run, test and release
14. Sprint 01 checklist
15. Honest assessment
16. Where to learn next
17. Glossary
18. Teacher Q&A

---

## 1. Summary

Threat Detector is a desktop application (Tauri v2) that heuristically checks URLs and text messages for phishing/threat indicators. It has two scan modes: a **single input** (one URL or message) and a **CSV batch** (up to 5,000 rows) with per-item progress, cancellation, and a results table. Results are risk levels **Low / Medium / High**, plus an explicit **Not Verified** state for anything that could not be assessed — the app never calls an unverified item "safe". Detection is offline only: the backend never visits or fetches a URL; it inspects strings and structure (Option A). The backend is pure Rust (`crates/threat-core`, zero Tauri dependencies) behind a thin Tauri shell (`src-tauri`) that exposes IPC commands. The front-end is vanilla HTML/CSS/JS (no framework, no build step) with a mock adapter so it also runs in a browser. Concurrency: a bounded worker pool (`tokio::sync::Semaphore`, default 8), `CancellationToken` per batch, a single aggregator task over an `mpsc` channel, and a 40 ms progress throttle. Current state: core + shell compile and all 24 Rust tests pass; the desktop window has never been launched yet (CP1/CP2 pending) — verification so far is headless-browser + Rust tests.

## 2. Tech stack and libraries

### Rust crates

| Crate | Version | Purpose | Used in |
|---|---|---|---|
| tauri | 2 | Desktop app framework (commands, events, windows) | `src-tauri` |
| tauri-build | 2 | Build-time codegen | `src-tauri/build.rs` |
| serde | 1.0 (derive) | (De)serialization for IPC | both crates |
| tokio | 1.38 (full in shell; sync/rt/macros/time in core) | async runtime, semaphore, sleep | `engine.rs`, commands |
| tokio-util | 0.7 | `CancellationToken` | `engine.rs`, `commands.rs`, `state.rs` |
| url | 2.5 | URL parsing (offline only) | `url_rules.rs`, `message_rules.rs`, `engine.rs` |
| csv | 1.3 | CSV record parsing | `csv_parser.rs` |
| thiserror | 1.0 | Ergonomic error enums | `error.rs` |
| rfd | 0.15 | Native file dialog (no FS permissions) | `commands.rs::pick_csv` |

### JavaScript libraries

None. The front-end is vanilla HTML/CSS/JS. The only runtime dependency is the Tauri global injected by `withGlobalTauri: true`.

### Build tools and scripts

- `run-dev.bat` — launches `cargo tauri dev`.
- `build-release.bat` — release build + installer (bundle targets "all").
- `cargo test`, `cargo check`, `cargo clippy -- -D warnings`, `cargo fmt --check` — quality gates.
- Front-end: no build; `python -m http.server 8420 --directory src` serves it for browser testing.

### Key `tauri.conf.json` settings

- `productName`: "Threat Detector", version 0.1.0, identifier `com.threatdetector.app`.
- `build.frontendDist`: `../src` (the src folder IS the bundle).
- `app.withGlobalTauri: true` — exposes `window.__TAURI__` to the pages.
- Window: 1200x800, min 800x600, resizable.
- `dragDropEnabled: false` (drag-drop handled in JS only).
- CSP: `default-src 'self'; img-src 'self' data: asset:; style-src 'self' 'unsafe-inline'; script-src 'self'`.
- Bundle targets: "all" (MSI/NSIS/etc.), icons set.

### Capabilities (`src-tauri/capabilities/default.json`)

Only `core:default` for window "main". No shell or filesystem permissions — file picking is delegated to Rust (`rfd`).

## 3. Project structure

```
DAC_Tauri/                              (repo root)
├── Cargo.toml                          [config] workspace (2 members)
├── run-dev.bat                         [script]
├── build-release.bat                   [script] (if present)
├── crates/threat-core/                 [backend] pure Rust engine
│   ├── Cargo.toml                      [config]
│   ├── src/                            [backend] 9 modules (see §7)
│   └── tests/                          [test] engine, invariants, dataset, fixtures
├── src-tauri/                          [backend] Tauri shell
│   ├── Cargo.toml                      [config]
│   ├── tauri.conf.json                 [config]
│   ├── build.rs                        [config]
│   ├── capabilities/default.json       [config]
│   ├── src/                            [backend] main.rs, lib.rs, commands, sink, state
│   └── icons/                          [asset]
├── src/                                [front-end] shipped bundle
│   ├── *.html                          [front-end] 4 pages
│   ├── css/                            [front-end] core.css, nav.css, risk-glow.css, analysis-card.css, theme-transition.css, base/, components/, pages/
│   ├── js/core/                        [front-end] core.js, events.js, theme-init.js, td-config.js
│   ├── js/services/                    [front-end] analysisService.js, bridge.js, monitorService.js, mockMonitorService.js
│   ├── js/features/                    [front-end] motion-governor.js, theme-fx.js
│   ├── js/components/                  [front-end] verdictCard.js, shadePicker.js, sparkline.js, usageBar.js
│   ├── js/pages/                       [front-end] index.js, settings.js, history.js, hardware.js
│   └── js/settings.js                  [front-end] (legacy IIFE-local settings helpers)
├── docs/                               [documentation]
│   ├── AGENTS.md, AGENT_CONTRACT.md    [docs] ownership/conventions
│   ├── IPC_CONTRACT.md, CONCURRENCY.md [docs] frozen contracts
│   ├── PROGRESS.md                     [docs] living log
│   ├── VERDICT_COLORS.md               [docs] verdict color feature
│   ├── MANUAL_TEST.md                  [docs]
│   └── PROJECT_GUIDE.md                [docs] this file
└── manual-test/                        [test fixtures] CSV samples
```

(Generated folders `target/`, `_restore/`, `dev/`, `manual-test/` data are excluded; `manual-test/` holds CSV fixtures only.)

## 4. Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  HTML pages (index/settings/history/hardware)  +  CSS           │  front-end
├─────────────────────────────────────────────────────────────────┤
│  JS services: TD.services.analysis (adapter), TD.events, TD.settings│
│  Adapter chosen by TD.config.backend: tauri | mock | bridge | http │
├─────────────────────────────────────────────────────────────────┤
│  Tauri IPC boundary: window.__TAURI__.core.invoke / event.listen  │
├─────────────────────────────────────────────────────────────────┤
│  src-tauri commands: analyze_item, analyze_csv, analyze_csv_content,│
│  cancel_batch, pick_csv  +  BatchRegistry state  +  TauriSink       │
├─────────────────────────────────────────────────────────────────┤
│  threat-core: validator, url_rules, message_rules, scorer,          │
│  csv_parser, engine (Semaphore pool, aggregator, EventSink trait)   │
└─────────────────────────────────────────────────────────────────┘
```

- HTML/CSS/JS: rendering, forms, history table, settings, animations.
- JS services/adapters: decouple pages from the backend; mock adapter makes browser testing possible.
- Tauri IPC: `invoke` (request/response) and `emit`/`listen` (streaming events).
- Rust commands: thin handlers; parse CSV off-thread; spawn the batch; emit events.
- Engine: concurrent, bounded, cancellable batch processing with a sink trait (decoupled from Tauri).
- Services: URL/message rules, scorer, CSV parser, validator — pure functions, unit-tested.

## 5. Front-end / backend link (IPC)

Mechanism: `tauri.conf.json` sets `withGlobalTauri: true`, so pages use `window.__TAURI__.core.invoke(cmd, args)` and `window.__TAURI__.event.listen(name, cb)`. Capabilities grant only `core:default` — no FS/shell permissions; file picking is done in Rust via `rfd`.

Adapter selection (`src/js/services/analysisService.js` `backendName()` reads `TD.config.backend` from `src/js/core/td-config.js`): `tauri` when `window.__TAURI__` exists, else `mock` (default for browser). `bridge`/`http` adapters also exist.

Events (contract in `docs/IPC_CONTRACT.md`): `analysis:item-start`, `analysis:item-done`, `analysis:progress`, `analysis:batch-done`. The Tauri sink republishes them onto `TD.events`.

Request shape (analyze_item):
```json
{ "request": { "id": null, "inputType": null, "content": "https://..." } }
```
`inputType` may be `"url"`/`"message"` or null (backend auto-detects per `validator::detect_input_type`).

Result shape (`IpcAnalysisResult`, camelCase):
```json
{ "id":"req-...", "inputType":"url", "input":"https://...", "riskLevel":"High",
  "risk":"high", "state":"THREAT", "score":90, "status":"verified",
  "category":"High Risk Threat Detected", "details":"...", "reasons":["..."],
  "triggeredRules":[{"id":"http_protocol","description":"...","points":2}],
  "recommendation":"...", "error":null, "durationMs":0, "ts":1700000000000 }
```
Not-verified result: `riskLevel:"NotVerified"`, `risk:"unverified"`, `state:"NOT_VERIFIED"`, `score:null`, `error:{kind,message}`.

Event payloads: item-start `{id, input}`; item-done `{input, result}`; progress `{batchId, done, total, pct}`; batch-done `{batchId, count, results}`.

## 6. The scan process, end to end

### (a) Single input
Tauri path: user submits form in `index.html` → `index.js` reads `#scan-input`, calls `TD.services.analysis.analyze(text)` (withEvents wraps and emits item-start/item-done) → `tauriAdapter().analyze` → `invoke("analyze_item", {request})` → Rust `commands::analyze_item` builds `AnalysisRequest`, calls `core_analyze_item` (threat-core) → `validator::validate_input` (empty/whitespace/oversize → NotVerified) → if URL: `url::Url::parse` (malformed → NotVerified) → `evaluate_url_rules` → `score_hits` (thresholds 0-1 Low, 2-4 Medium, 5+ High; display score = raw*15 capped 99, 0 → 12 baseline) → `ItemResult` → `.to_ipc_shape(ts)` → JSON returned → JS receives, `presentResult` fills `#result-panel` verdict card (states: idle/scanning/threat/safe/unverified/error/batch) → history saved to localStorage (if saveHistory) → Threat Summary + results table updated.

Mock path: `mockAdapter().analyze` resolves after 40ms with `normalizeResult` (regex `/safe|example\.com/` → SAFE else THREAT) — same UI path, fictional.

Error→NotVerified points: empty/whitespace input, oversized (>2048 URL / >4096 msg), malformed URL. Never defaults to Low/Safe. `normalizeResult` (JS) also forces any unknown state to NOT_VERIFIED.

Detection rules (URL): http_protocol +2; ip_host +4; authority_userinfo +4; nested_subdomains +3 (≥4 parts, not for IPs); suspicious_keyword +1..+3 (keywords: portal, login, account, verify, secure, update, bank; capped 3); punycode_host +4; long_url +1 (>100 chars); shortener_host +3; nonstandard_port +1. Message rules reuse URL rules on embedded URLs plus: urgency_language +2, suspension_threat +3, action_request +1, account_reference +1, embedded_malformed_link +3.

### (b) CSV batch
Tauri path: user drops/selects CSV → `index.js` either `pickCsvFile` (native dialog) or reads file text → `analyzeCsvFile(path, opts)` / `analyzeCsvContent(name, content, opts)` → Rust parses off-thread (`spawn_blocking` `parse_csv_file`/`parse_csv_text`) → two dialects (Typed `id,input_type,content` and Plain first-column input) with optional header detection; bad rows become typed NotVerified items, not file errors; size/row limits (1MB, 5000 rows) are typed errors → `run_csv_batch` creates `BatchStartInfo{batchId,total}` and spawns `run_batch`: Semaphore-bounded workers (default 8, clamped 1-32), per-item `on_item_start`, optional `min_item_duration_ms` sleep, cancel checks, panic isolation via `catch_unwind`, results sent over `mpsc::channel(128)` → aggregator loop calls `on_item_done` per result, throttled progress every 40ms + guaranteed final, then `on_batch_done(count, results)`. `cancel_batch` sets the `CancellationToken`. Front-end listens to `analysis:item-start/done/progress/batch-done`, renders batch rows (chunked rAF, 40/frame, lazy score rings via IntersectionObserver), tally, progress bar. End-of-batch scrolls to the result card.

Mock path: `mockAdapter().analyzeBatch` = `Promise.all` of `analyze` (40ms each) — no streaming, but same render path.

## 7. Backend, file by file

- `crates/threat-core/src/lib.rs` — crate root: declares modules, re-exports (`analyze_item`, `run_batch`, models, `ThreatError`), defines the `EventSink` trait (4 methods: on_item_start, on_item_done, on_progress, on_batch_done). Java analogy: an interface.
- `models.rs` — domain types: `InputType` (Url/Message), `RiskLevel` (Low/Medium/High, deliberately NO NotVerified), `Verdict` enum (`Assessed{level,score,hits}` or `NotVerified{reason}`), `NotVerifiedReason`, `AnalysisRequest`, `ItemResult`, IPC structs (`IpcAnalysisResult` camelCase, `IpcRuleHit`, `IpcError`), and `to_ipc_shape()` — the single conversion point enforcing the invariant. Rust enums with data = tagged union (no Java equivalent; closest is sealed class).
- `error.rs` — `ThreatError` enum via `thiserror`; `From<ThreatError> for NotVerifiedReason` maps every error to a NotVerified reason. Never defaults to safe.
- `validator.rs` — `MAX_URL_LENGTH=2048`, `MAX_MESSAGE_LENGTH=4096`, `detect_input_type` (URL if scheme/host without spaces else Message), `validate_input` (trim BOM, empty/whitespace/oversize checks).
- `url_rules.rs` — `evaluate_url_rules(&Url) -> Vec<RuleHit>`: 9 rules listed above. `is_shortener_host` exact/subdomain match (not suffix lookalike).
- `message_rules.rs` — `evaluate_message_rules`: 4 text rules + embedded URL reuse + malformed-link rule.
- `scorer.rs` — `score_hits`: raw sum → level thresholds → display score.
- `csv_parser.rs` — constants `MAX_CSV_SIZE=1MB`, `MAX_CSV_ROWS=5000`; `parse_csv_file`, `parse_csv_text`; two dialects with optional header; malformed rows → typed NotVerified items; row-limit is a typed error.
- `engine.rs` — `analyze_item` (single, sync), `run_batch` (async, concurrent). Semaphore pool, cancellation, panic isolation, aggregator, 40ms throttle. Helpers `cancelled_result`, `panic_message`, `uuid_simple`.
- `src-tauri/src/main.rs` — calls `threat_detector_lib::run()`, exits on error.
- `src-tauri/src/lib.rs` — registers `BatchRegistry` state, invoke handler (5 commands), runs app.
- `src-tauri/src/commands.rs` — `ItemRequest`, `BatchOptions`, `BatchStartInfo`; `parse_input_type`; `run_csv_batch` shared; commands `analyze_item`, `analyze_csv`, `analyze_csv_content`, `cancel_batch`, `pick_csv`. CSV parsing via `spawn_blocking`.
- `src-tauri/src/sink.rs` — `TauriSink` implements `EventSink`; emits `analysis:*` events; `emit` logs failures, never panics.
- `src-tauri/src/state.rs` — `BatchRegistry` (Mutex<HashMap<String,CancellationToken>>) + unit test `cancel_semantics`.

Tests: 16 unit (csv/url) + 1 dataset acceptance + 4 engine + 2 invariants + 1 state = 24, all passing. `engine_test.rs` uses a `RecordingSink` (vector-backed EventSink) to verify streaming without Tauri.

Extension idea: wire settings (detectors, trusted/blocked domains, sensitivity) into the Rust request via an options contract (currently Rust uses fixed thresholds).

## 8. Concurrency design

- Bounded pool: `Arc<Semaphore::new(concurrency_limit.max(1))>` (default 8, clamped 1-32 in commands). Each item acquires a permit; `acquire().await` queues. Java analogy: `ExecutorService` with a fixed thread pool, but async (no OS thread per task).
- Tasks: `tokio::spawn` per item; permits released when the task ends (RAII guard `_permit`).
- Cancellation: one `CancellationToken` per batch (cloned into each task). Checked before work (item not reported at all) and between stages (item becomes `BatchCancelled` NotVerified). `cancel_batch` calls `token.cancel()` on the registry's token.
- Channels: `mpsc::channel::<ItemResult>(128)`; workers `send`; aggregator `recv` loop owns all counters (`done_count`, `all_results`) — no Mutex on batch counters. `drop(tx)` closes the stream when all workers done.
- Progress throttle: `PROGRESS_FLUSH_MS=40`; emit if `done==total` or elapsed ≥ 40ms; final guaranteed.
- Panic isolation: `std::panic::catch_unwind(AssertUnwindSafe(|| analyze_item(...)))` → `ExecutionPanicked` NotVerified; one item's failure costs one result, never the batch.
- Shared state: only `BatchRegistry` (Mutex map) and the Semaphore; batch counters live in the single aggregator task (no lock).
- Decoupled sink: engine depends on `EventSink` trait, not Tauri — tests use `RecordingSink`.

## 9. The "never safe if unverified" guarantee

- Type system: `RiskLevel` has only Low/Medium/High — no NotVerified variant, so a NotVerified can never become a RiskLevel.
- `Verdict` is an enum: `Assessed{level,score,hits}` OR `NotVerified{reason}`. Every analysis path returns one of these; there is no "default Low".
- `to_ipc_shape()` maps NotVerified → `riskLevel:"NotVerified"`, `risk:"unverified"`, `state:"NOT_VERIFIED"`, `score:None`, `error:Some(...)`. The Assessed branch is the only place that sets Low/Medium/High and a score.
- Error mapping: `ThreatError` → `NotVerifiedReason` covers all failure modes; oversized input is a typed error, never truncation.
- Tests: `invariants_test.rs` (empty/whitespace/malformed/oversized → NotVerified, checks risk_level/risk/state/score invariants, asserts not "Low"/"SAFE"); `dataset_test.rs` rows 9,10 must be NotVerified. If someone broke the invariant, `test_not_verified_invariants_sweep` fails.

## 10. Front-end, file by file

Core: `js/core/core.js` (DAC namespace: storage, settings, appearance, time, utils, glyphs, ui, seg, verdictShade, visuals), `events.js` (TD.events pub/sub), `theme-init.js` (early theme attrs), `td-config.js` (backend selection). `js/settings.js` (legacy IIFE-local settings helpers used by the Settings page).

Services: `analysisService.js` (adapters mock/bridge/http/tauri + normalizeResult), `bridge.js` (native shell bridge), `monitorService.js`/`mockMonitorService.js` (hardware metrics).

Features: `motion-governor.js`, `theme-fx.js`.

Components: `verdictCard.js` (shared verdict card builder), `shadePicker.js` (2D shade square), `sparkline.js`, `usageBar.js`.

Pages: `index.js` (dashboard scan/batch), `settings.js` (settings UI incl. verdict colors modal), `history.js` (history table/filters/pagination), `hardware.js` (hardware monitor).

CSS: `core.css` (tokens, base components, buttons, tables, modals), `nav.css`, `risk-glow.css` (verdict tint alphas + --vs-* defaults), `analysis-card.css`, `components/verdict-card.css` (single tint block), `components/shade-picker.css`, `components/motion-governor.css`, `pages/*.css`, `base/motion-tokens.css`, `theme-transition.css`.

HTML: `index.html`, `settings.html`, `history.html`, `hardware.html` (script load order at end of body: core.js, td-config.js, events.js, bridge.js, analysisService.js, then components, then page).

Namespaces: `DAC` (core: storage/settings/appearance/ui/glyphs/utils/time/verdictShade/visuals), `TD` (services/events/components/pages), `TDSettings` (legacy), `TDTheme`. `TD.config.backend` chooses the adapter. Pages talk to services via `TD.services.analysis` and listen via `TD.events`.

Motion: `motion-governor.js` + `motion-tokens.css` + `data-motion` attribute; reduced-motion kills transitions.

## 11. How the main UI components are built

- Verdict card (`verdictCard.js` + `verdict-card.css`): four states (threat/safe/unverified, plus batch/idle/scanning in index.html shells). Single markup source; dashboard mounts it into static shells at boot; preview uses `{ids:false}`. Compact mode for Settings preview drops heading/reasons/action. Tint via `--vs-*` + `--risk-edge-a/corner/border-a`.
- Score ring: SVG ring (visuals). Low uses a green check circle instead of a shield.
- Batch rows: bordered blocks, left gradient, lazy score rings via IntersectionObserver, risk tags (B2: neutral container + 3-bar meter), "View details" opens shared details modal.
- Details modal: `DAC.ui.detailsCard` / `modal-detail`, shade-immune (engine `--risk-rgb` radial).
- Navbar: style setting (Ring/Contrast) with live preview.
- Risk tags: `DAC.ui.riskTag` / `riskTagHtml`, 92×27 neutral container + 3-bar meter.
- Threat Summary card: counts today's scans; High/Medium risk counts.
- Empty states: "No analysis results yet".
- Reveal animation: `.reveal` grid-rows transition.
- Verdict colors: storage keys `td.vs.<theme>.<verdict>` (8 keys, "" = unset); CSS vars `--vs-*` and `--vs-<verdict>-<theme>-o` overrides on `<html>`; alphas dark .22/.10/.35, light .50/.30/.55 (raised for visibility); applied to `.verdict-card` and batch rows (color only; batch rows use engine colors).

## 12. Data and storage

Front-end (localStorage, `dac_` prefix): `dac_settings` (all settings including verdict shades under `td.vs.*`), scan history (per-scan records with result, ts). Backend remembers nothing persistent — it's stateless per request; `BatchRegistry` holds only in-flight cancellation tokens. History is front-end only (mock or Tauri path both save via index.js). `theme-init.js` sets initial theme attrs before paint.

## 13. How to run, test and release

- Dev: `run-dev.bat` → `cargo tauri dev` (window 1200x800). Browser-only testing: `python -m http.server 8420 --directory src`.
- Tests: `$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"; cargo test` (24 tests). `cargo check`, `cargo clippy -- -D warnings`, `cargo fmt --check`.
- Release: `build-release.bat` → `cargo tauri build` (bundle targets "all") → installer in `target/release/bundle/`.
- Outputs: `target/debug/threat-detector.exe`, `target/release/`.

## 14. Sprint 01 checklist

| Requirement | Implementation | Status |
|---|---|---|
| GUI (dashboard, settings, history, hardware) | index/settings/history/hardware.html | Done |
| Load single inputs | index.js scan form + analyze_item | Done |
| Load CSV files | pick_csv / analyze_csv / drag-drop | Done |
| Decoupled services | TD.services.analysis adapters | Done |
| Results with risk levels + status indicators | verdict card 4 states, risk tags | Done |
| Progress indicators | progress bar, per-item item-start/done | Done |
| Responsiveness | media queries, 360px tested | Done |
| Input & error handling | validator, NotVerified, invariants tests | Done |
| Detection Option A (offline, no fetch) | url_rules/message_rules, no network | Done |
| Option B / AI bonus | Not implemented | Missing |

## 15. Honest assessment

- Rust core is solid and well-tested; front-end is large (~thousands of lines of CSS/JS) with duplicated rules (e.g. `.modal-detail` duplicated across analysis-card.css and history.css by design D13) and many "round 2/3/4/5" CSS hacks layered in settings.css.
- `settings.js` has a legacy IIFE-local `var TD = window.TDSettings` shadowing — builder calls must use `window.TD.components` (noted in code).
- Verdict colors are "dev mode only" (callout says so); shades target only the verdict card, batch rows follow engine colors.
- Hardware page uses simulated data; `monitorService` is not wired to Rust.
- Detection settings (detectors, trusted/blocked domains, sensitivity) are NOT read by the Rust backend — fixed thresholds (documented limitation).
- Desktop window never launched (CP1/CP2); visual/transition behavior verified only in headless browser.
- Docs vs code: PROGRESS.md's older entries cite stale alphas (.28/.14/.40) while risk-glow.css now has .50/.30/.55 — the living docs lag the code.
- Score is a normalized rule-points score, not a probability.

## 16. Where to learn next (Rust concepts, in order)

1. Ownership & borrowing — `engine.rs` (passing `&AnalysisRequest`, `Arc<S>`).
2. Enums with data + match — `models.rs` (`Verdict`, `NotVerifiedReason`).
3. `Result` and `?` — `validator.rs`, `csv_parser.rs`.
4. Traits as interfaces — `EventSink` in `lib.rs` and `TauriSink`.
5. `Arc`/`Mutex` — `state.rs`, `engine.rs` Semaphore.
6. async/await + tokio — `run_batch`, `spawn_blocking` in commands.
7. `catch_unwind` — panic isolation in engine.
8. Serde derive — `models.rs` IPC structs.

## 17. Glossary

- **Crate**: a Rust package/library (like a Java jar/module). `threat-core` is a crate.
- **Trait**: Rust's interface (methods a type must implement). Java analogy: interface.
- **Struct**: Rust's class-like data holder (no inheritance). Java analogy: POJO/record.
- **Enum with data**: variant can carry fields (tagged union). Java analogy: sealed class hierarchy.
- **Result<T,E>**: success or error value returned, not thrown. Java analogy: checked exception as a value.
- **Option<T>**: Some/None (nullable made explicit). Java analogy: `Optional<T>`.
- **Ownership/borrowing**: each value has one owner; references borrow. Java analogy: no GC; compiler tracks lifetimes.
- **Arc**: atomic reference-counted shared pointer. Java analogy: shared reference, but explicit.
- **Mutex**: mutual exclusion lock. Java analogy: `synchronized`/`ReentrantLock`.
- **Semaphore**: permit counter bounding concurrency. Java analogy: `java.util.concurrent.Semaphore`.
- **CancellationToken**: cooperative cancel signal. Java analogy: `Thread.interrupt()` (but cooperative).
- **mpsc channel**: multi-producer single-consumer queue. Java analogy: `BlockingQueue`.
- **async/await**: cooperative multitasking on a runtime (tokio). Java analogy: virtual threads / CompletableFuture.
- **spawn_blocking**: run sync work on a blocking thread pool. Java analogy: `CompletableFuture.supplyAsync` on a separate executor.
- **Serde**: (de)serialization framework. Java analogy: Jackson.
- **Tauri command**: Rust function callable from JS via `invoke`. Java analogy: RMI/IPC stub.
- **Event emit/listen**: async pub/sub between Rust and JS. Java analogy: EventBus.
- **withGlobalTauri**: injects `window.__TAURI__`. 
- **Capability**: permission set for a window (minimal here: `core:default` only).
- **CSP**: Content Security Policy (script/style sources).
- **NotVerified**: explicit "could not assess" state, never Low/Safe.

## 18. Teacher Q&A

1. **How is concurrency bounded?** `Semaphore::new(8)` (clamped 1-32); `acquire().await` queues extra tasks. See `engine.rs:80`.
2. **How do results stream to the UI?** Workers send `ItemResult` over `mpsc::channel(128)`; a single aggregator loop calls `on_item_done` and throttled `on_progress`. See `engine.rs:81,169-186`.
3. **How does cancellation work?** Per-batch `CancellationToken`; checked before work (item not reported) and between stages (item becomes `BatchCancelled`). `cancel_batch` sets the token. See `engine.rs:85-87,100-119`, `commands.rs:139-141`.
4. **How is a panicking item isolated?** `catch_unwind(AssertUnwindSafe(...))` turns a panic into `ExecutionPanicked` NotVerified; the batch continues. See `engine.rs:135-156`.
5. **Why no Mutex on batch counters?** One aggregator task owns them; channels serialize delivery. See `engine.rs:164` comment.
6. **How is "never safe if unverified" enforced?** `RiskLevel` lacks a NotVerified variant; `Verdict` enum; `to_ipc_shape` single conversion; invariants tests. See `models.rs`, `invariants_test.rs`.
7. **What does the backend remember?** Nothing persistent — only in-flight cancellation tokens in `BatchRegistry`. History/settings are front-end localStorage.
8. **How does the front-end switch backends?** `TD.config.backend` selects mock/bridge/http/tauri; `tauriAdapter` uses `window.__TAURI__`. See `analysisService.js`.
9. **What happens on oversized input?** `ThreatError::OversizedInput` → `NotVerifiedReason::OversizedInput` → NotVerified result (never truncation). See `validator.rs`, `error.rs`.
10. **What is Option A (no visiting)?** The backend never fetches/resolves/pings URLs; analysis is string/structure inspection only (`url` crate parsing + rules). See `url_rules.rs` doc comment.

---

_End of guide._
