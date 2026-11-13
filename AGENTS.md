# AGENTS.md — Threat Detector (Tauri v2 + Rust)

This file sets the universal laws, conventions, and file ownership boundaries for all agents working on this codebase. Every worker inherits these rules unconditionally.

---

## 1. Non-Negotiables (Core Invariants)

1. **The `NotVerified` Invariant:** Anything that could not be verified is `NotVerified`, never Low or Safe. "Low" means "assessed, and few rules fired", and the UI wording must never call it safe.
2. **Offline Only (No Visiting):** The backend never visits, fetches, resolves, or pings an analyzed URL (Option A). Analysis is string and structure inspection only. Suspicious links are never opened.
3. **Safety & Robustness:**
   - No `unsafe` code.
   - No `unwrap()` or `expect()` outside unit/integration tests.
   - No panics across the IPC boundary.
   - No macro-heavy abstractions. Generics only where they remove real duplication.
4. **Minimal Capabilities & CSP:** Capabilities and CSP stay minimal — only what the app actually uses. No broad shell or filesystem permissions.
5. **Strict Input Limits:**
   - Max CSV size: 1 MB, max CSV rows: 5,000.
   - Max URL length: 2,048 chars; max message length: 4,096 chars.
   - No regular expressions with catastrophic backtracking risk (prefer string slices, tokenizers, and the `url` crate).
   - Any over-limit input becomes a typed `NotVerified` or typed file error.
6. **Operating System Safety:** Never disable antivirus or Windows security features. Never install system software without explicit authorization.

---

## 2. Architecture & File Ownership

### Two-Crate Workspace
- `crates/threat-core`: Pure Rust, 0 Tauri dependencies. Fast compile, comprehensive unit & integration tests.
- `src-tauri`: Thin Tauri v2 desktop shell. Command handlers, IPC channel streaming, OS file dialog.

### Ownership Matrix
| File / Directory | Exclusive Owner | Notes |
|---|---|---|
| `Cargo.toml` (root), `src-tauri/Cargo.toml` | Orchestrator Only | Workers do not touch workspace config |
| `crates/threat-core/src/models.rs`, `error.rs` | Orchestrator Only | Contract types frozen in Phase 1.5 |
| `crates/threat-core/src/validator.rs`, `url_rules.rs`, `message_rules.rs`, `scorer.rs` | Worker A (Rules) | Rule implementations and rule unit tests |
| `crates/threat-core/src/csv_parser.rs`, `manual-test/*` | Worker B (CSV & Fixtures) | CSV parser, limits, fixture files |
| `crates/threat-core/src/engine.rs` | Worker C (Engine) | Semaphore concurrency, cancellation, aggregator |
| `src/js/services/analysisService.js`, `src/js/pages/index.js` | Worker D (Frontend Adapter) | Tauri IPC adapter, `NotVerified` UI guards |
| `src-tauri/src/*`, `tauri.conf.json`, `capabilities/*` | Orchestrator (Phase 4) | Shell, commands, state, capabilities |
| `docs/PROGRESS.md`, `docs/IPC_CONTRACT.md` | Orchestrator | Living project memory |

---

## 3. Concurrency Conventions

- **Worker Pool:** `tokio::sync::Semaphore` bounds concurrency (default 8 concurrent item workers).
- **Cancellation:** `CancellationToken` (from `tokio-util`) per batch. Tasks check token before execution and between stages.
- **Aggregator & Channels:** Items stream over a bounded `tokio::sync::mpsc` channel. A dedicated aggregator task owns batch counts — **no Mutex on batch counters**.
- **UI Flush Throttling:** Flush to UI via timer (~40ms). Within each flush, progress keeps the latest item state; final state is guaranteed.
- **Decoupled Sink:** Engine talks only through the `EventSink` trait in `threat-core`.

---

## 4. Coding & Verification Standards

- All code must pass:
  1. `cargo check`
  2. `cargo clippy -- -D warnings`
  3. `cargo fmt --check`
  4. `cargo test`
- Readable, idiomatic, simple Rust over clever Rust.
- Extension points marked with `// TODO(learn):`.
- Any error must convert to a typed `NotVerified` with a descriptive reason, never defaulting to Low or Safe.
