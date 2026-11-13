# Concurrency Architecture — Threat Detector

This document explains every concurrency choice, primitive, and synchronization mechanism used in the Threat Detector Rust backend. It is written in plain language with Java analogies for students studying concurrent systems.

---

## 1. Concurrency Model Overview

When scanning a large CSV batch (e.g. 500 to 5,000 items), two extremes must be avoided:
1. **Unbounded spawning:** Spawning 5,000 threads or tasks simultaneously would exhaust system sockets, thread stacks, or OS handles and freeze the UI.
2. **Sequential execution:** Processing items one-by-one leaves multi-core CPUs idle and produces sluggish progress.

Our solution is an **asynchronous worker pool with a bounded semaphore, cooperative cancellation, and a single-owner aggregator**.

```
CSV File
   │
   ▼
[ parse_csv_file ] -> Vec<CsvRowItem>
   │
   ├─► Task 1 ──(Semaphore permit)──► analyze_item ──┐
   ├─► Task 2 ──(Semaphore permit)──► analyze_item ──┤
   ├─► Task 3 ──(Semaphore permit)──► analyze_item ──┼─► [ mpsc::channel ]
   │      ...                                        │          │
   └─► Task N ──(Semaphore permit)──► analyze_item ──┘          ▼
                                                       [ Aggregator Task ]
                                                       (owns counts, no Mutex!)
                                                                │
                                                         timer flush (40ms)
                                                                │
                                                                ▼
                                                        [ EventSink / UI ]
```

---

## 2. Concurrency Primitives & Java Analogies

### A. Bounded Worker Pool: `tokio::sync::Semaphore`
- **What it does:** Limits the number of concurrent item tasks running at any given moment (default: 8 tasks).
- **How it works:** Each spawned item task must asynchronously acquire a permit (`semaphore.acquire().await`). Once the item finishes analysis, the permit drops automatically.
- **Java Analogy:** Exactly like `java.util.concurrent.Semaphore(8)`.

### B. Cooperative Cancellation: `tokio_util::sync::CancellationToken`
- **What it does:** Allows the user to click "Cancel" at any time to immediately halt the batch without killing the thread pool or crashing the app.
- **How it works:** When the user calls `cancel_batch()`, the backend calls `token.cancel()`. Each item task checks `token.is_cancelled()` before starting and between stages (after its wait). Cancelled items produce a typed `NotVerified { reason: BatchCancelled }` verdict. Items that were never started at all are simply not reported — batch-done then carries fewer results than the total.
- **Java Analogy:** Similar to checking `Thread.currentThread().isInterrupted()` or sharing an `AtomicBoolean cancelled` flag across worker tasks.

### C. Channel Streaming: `tokio::sync::mpsc::channel`
- **What it does:** Transports completed analysis results from independent worker tasks to the aggregator.
- **How it works:** `mpsc` stands for **Multi-Producer, Single-Consumer**. Every worker holds a clone of the sender (`tx`), while the single aggregator holds the receiver (`rx`). The channel is bounded (buffer size: 128) to provide natural backpressure.
- **Java Analogy:** Similar to a `java.util.concurrent.ArrayBlockingQueue<ItemResult>`, but asynchronous and non-blocking.

### D. Single-Owner Aggregator (No Mutex on Batch Counts!)
- **Why it matters:** In traditional multithreading, multiple threads increment shared counters (e.g. `doneCount++`, `highCount++`) by locking a `Mutex` or `synchronized` block. Under high contention, threads spend all their time waiting on the lock.
- **Our design:** Only the single aggregator task reads from `rx` and updates batch counters. Because only one task ever touches the counts, **no `Mutex` or atomic operations are needed on batch totals**.
- **Java Analogy:** Similar to the Actor model or submitting results to a dedicated single-thread consumer (`Executors.newSingleThreadExecutor()`).

### E. Throttled UI Flushes: Timer Interval (~40 ms)
- **Why it matters:** If 500 items complete rapidly, firing 500 individual UI update events would flood the WebView's JavaScript event loop, causing severe frame drops and jank.
- **Our design:** The aggregator emits a progress update when items complete, but never more often than every ~40 ms — a plain elapsed-time check against the last flush (`last_flush.elapsed() >= 40 ms`), so there is no timer task and no extra thread. A final progress update is always emitted when the last item lands, so the final state of every item and of the batch is always delivered. Per-item `item-done` results are sent individually and are never dropped; the JS adapter re-batches them with `requestAnimationFrame`.
- **Java Analogy:** Similar to a Swing/JavaFX `Timer` that batches model changes before calling `Platform.runLater()`.

---

## 3. Failure Isolation
- If a single CSV row contains invalid characters, an unknown type, or a malformed URL, that item independently yields `Verdict::NotVerified`.
- If an item task panics, the panic is caught **inside the task** with `std::panic::catch_unwind` and converted into `Verdict::NotVerified { reason: ExecutionPanicked }` for that item only. The task never unwinds through the runtime, the channel still closes normally, and the batch continues.
- **An individual row failure NEVER terminates or invalidates the batch.**
