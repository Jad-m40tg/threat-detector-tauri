//! Multi-threaded threat detection concurrency engine.
//!
//! Uses a bounded semaphore worker pool, CancellationToken for cancellation,
//! and an aggregator task to stream results safely without mutex contention.

use crate::error::ThreatError;
use crate::message_rules::evaluate_message_rules;
use crate::models::{AnalysisRequest, InputType, ItemResult, NotVerifiedReason, Verdict};
use crate::scorer::score_hits;
use crate::url_rules::evaluate_url_rules;
use crate::validator::{detect_input_type, validate_input};
use crate::EventSink;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Semaphore};
use tokio_util::sync::CancellationToken;
use url::Url;

/// Minimum interval between progress updates sent to the UI (throttle).
const PROGRESS_FLUSH_MS: u64 = 40;

/// Analyzes a single item synchronously.
pub fn analyze_item(request: &AnalysisRequest) -> ItemResult {
    let start = Instant::now();
    let id = request
        .id
        .clone()
        .unwrap_or_else(|| format!("req-{}", uuid_simple()));
    let input_type = request
        .input_type
        .unwrap_or_else(|| detect_input_type(&request.content));

    let clean = match validate_input(&request.content, input_type) {
        Ok(c) => c,
        Err(e) => {
            return ItemResult {
                id,
                input_type,
                content: request.content.clone(),
                verdict: Verdict::NotVerified { reason: e.into() },
                duration_ms: start.elapsed().as_millis() as u64,
            };
        }
    };

    let verdict = match input_type {
        InputType::Url => match Url::parse(&clean) {
            Ok(parsed) => {
                let hits = evaluate_url_rules(&parsed);
                score_hits(hits)
            }
            Err(e) => Verdict::NotVerified {
                reason: NotVerifiedReason::MalformedUrl(e.to_string()),
            },
        },
        InputType::Message => {
            let hits = evaluate_message_rules(&clean);
            score_hits(hits)
        }
    };

    ItemResult {
        id,
        input_type,
        content: request.content.clone(),
        verdict,
        duration_ms: start.elapsed().as_millis() as u64,
    }
}

/// Runs a concurrent batch of items bounded by a Semaphore, streaming results through EventSink.
pub async fn run_batch<S: EventSink>(
    items: Vec<crate::csv_parser::CsvRowItem>,
    sink: Arc<S>,
    cancel_token: CancellationToken,
    concurrency_limit: usize,
    min_item_duration_ms: u64,
) -> Result<Vec<ItemResult>, ThreatError> {
    let total = items.len();
    let semaphore = Arc::new(Semaphore::new(concurrency_limit.max(1)));
    let (tx, mut rx) = mpsc::channel::<ItemResult>(128);

    // Spawn worker tasks
    for item in items {
        if cancel_token.is_cancelled() {
            break;
        }

        let sem = semaphore.clone();
        let token = cancel_token.clone();
        let tx_item = tx.clone();
        let sink_item = sink.clone();

        tokio::spawn(async move {
            let _permit = match sem.acquire().await {
                Ok(p) => p,
                Err(_) => return,
            };

            // Cancellation check 1: before doing any work. The item never
            // started, so it is not reported at all — the batch simply ends
            // early and batch-done carries fewer results than the total.
            if token.is_cancelled() {
                return;
            }

            sink_item.on_item_start(&item.id, &item.content);

            // Demo knob: minimum per-item duration so batch progress stays
            // visible even though the rules themselves run instantly.
            if min_item_duration_ms > 0 {
                tokio::time::sleep(Duration::from_millis(min_item_duration_ms)).await;
            }

            // Cancellation check 2: between stages (after the wait)
            if token.is_cancelled() {
                let _ = tx_item.send(cancelled_result(item)).await;
                return;
            }

            let result = match item.parse_error {
                Some(err) => ItemResult {
                    id: item.id.clone(),
                    input_type: item.input_type,
                    content: item.content.clone(),
                    verdict: Verdict::NotVerified { reason: err },
                    duration_ms: 0,
                },
                None => {
                    let request = AnalysisRequest {
                        id: Some(item.id.clone()),
                        input_type: Some(item.input_type),
                        content: item.content.clone(),
                    };
                    // Panic isolation: a bug inside analysis must cost one item
                    // its result, never the whole batch. catch_unwind catches the
                    // panic inside this task and turns it into a typed
                    // NotVerified (see docs/CONCURRENCY.md §3).
                    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        analyze_item(&request)
                    })) {
                        Ok(res) => res,
                        Err(payload) => ItemResult {
                            id: item.id.clone(),
                            input_type: item.input_type,
                            content: item.content.clone(),
                            verdict: Verdict::NotVerified {
                                reason: NotVerifiedReason::ExecutionPanicked(panic_message(
                                    payload,
                                )),
                            },
                            duration_ms: 0,
                        },
                    }
                }
            };

            let _ = tx_item.send(result).await;
        });
    }

    drop(tx); // Drop sender so aggregator completes when all workers finish

    // Aggregator: this single loop owns all batch counters (no Mutex needed).
    let mut all_results = Vec::with_capacity(total);
    let mut done_count: usize = 0;
    let mut last_flush = Instant::now();

    while let Some(res) = rx.recv().await {
        done_count += 1;
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let ipc = res.to_ipc_shape(ts);
        sink.on_item_done(&ipc);
        all_results.push(res);

        // Progress is throttled: at most one update per PROGRESS_FLUSH_MS,
        // plus a guaranteed final update when the last item lands.
        if done_count == total || last_flush.elapsed() >= Duration::from_millis(PROGRESS_FLUSH_MS) {
            sink.on_progress(done_count, total);
            last_flush = Instant::now();
        }
    }

    let final_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let final_ipcs: Vec<_> = all_results
        .iter()
        .map(|r| r.to_ipc_shape(final_ts))
        .collect();
    // Count = results actually delivered (smaller than `total` when cancelled).
    sink.on_batch_done(all_results.len(), &final_ipcs);

    Ok(all_results)
}

/// Builds the typed result for an item that was cancelled before analysis ran.
fn cancelled_result(item: crate::csv_parser::CsvRowItem) -> ItemResult {
    ItemResult {
        id: item.id,
        input_type: item.input_type,
        content: item.content,
        verdict: Verdict::NotVerified {
            reason: NotVerifiedReason::BatchCancelled,
        },
        duration_ms: 0,
    }
}

/// Extracts a readable message from a caught panic payload (no unwrap).
fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(msg) = payload.downcast_ref::<&str>() {
        (*msg).to_string()
    } else if let Some(msg) = payload.downcast_ref::<String>() {
        msg.clone()
    } else {
        "unknown panic payload".to_string()
    }
}

fn uuid_simple() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", now)
}
