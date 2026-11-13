//! Engine tests: batch completeness, throttled progress, and cancellation.
//!
//! Uses a RecordingSink (a vector-backed EventSink) per the contract, so no
//! Tauri or UI code is needed to verify streaming behavior.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use threat_core::csv_parser::CsvRowItem;
use threat_core::engine::run_batch;
use threat_core::models::{InputType, IpcAnalysisResult, NotVerifiedReason, Verdict};
use threat_core::EventSink;
use tokio_util::sync::CancellationToken;

/// Vector-backed EventSink test double (allowed to unwrap: it is test code).
#[derive(Default)]
struct RecordingSink {
    starts: Mutex<Vec<String>>,
    results: Mutex<Vec<IpcAnalysisResult>>,
    progress: Mutex<Vec<(usize, usize)>>,
    batches: Mutex<Vec<usize>>,
}

impl EventSink for RecordingSink {
    fn on_item_start(&self, item_id: &str, _content: &str) {
        self.starts.lock().unwrap().push(item_id.to_string());
    }
    fn on_item_done(&self, result: &IpcAnalysisResult) {
        self.results.lock().unwrap().push(result.clone());
    }
    fn on_progress(&self, done: usize, total: usize) {
        self.progress.lock().unwrap().push((done, total));
    }
    fn on_batch_done(&self, count: usize, _results: &[IpcAnalysisResult]) {
        self.batches.lock().unwrap().push(count);
    }
}

fn make_items(n: usize) -> Vec<CsvRowItem> {
    (1..=n)
        .map(|i| CsvRowItem {
            id: i.to_string(),
            input_type: InputType::Url,
            content: format!("https://example.com/page/{}", i),
            row_index: i + 1,
            parse_error: None,
        })
        .collect()
}

#[tokio::test]
async fn batch_delivers_every_item_and_final_progress() {
    let sink = Arc::new(RecordingSink::default());
    let items = make_items(200);
    let total = items.len();

    let results = run_batch(items, sink.clone(), CancellationToken::new(), 8, 0)
        .await
        .expect("batch must succeed");

    // Every item produced exactly one result, no drops, no duplicates.
    assert_eq!(results.len(), total, "run_batch must return all results");
    assert_eq!(
        sink.results.lock().unwrap().len(),
        total,
        "on_item_done must fire once per item"
    );
    let ids: HashSet<String> = results.iter().map(|r| r.id.clone()).collect();
    assert_eq!(ids.len(), total, "result ids must be unique and complete");

    // Every processed item announced its start.
    assert_eq!(sink.starts.lock().unwrap().len(), total);

    // Batch end: exactly one call, carrying the delivered count.
    assert_eq!(*sink.batches.lock().unwrap(), vec![total]);

    // Progress: strictly non-decreasing, final update reports done == total.
    let progress = sink.progress.lock().unwrap();
    let mut last_done = 0;
    for (done, t) in progress.iter() {
        assert_eq!(*t, total);
        assert!(*done >= last_done, "progress done must be non-decreasing");
        last_done = *done;
    }
    let (final_done, final_total) = *progress.last().expect("at least final progress");
    assert_eq!(final_done, total);
    assert_eq!(final_total, total);
}

#[tokio::test]
async fn pre_cancelled_batch_starts_nothing() {
    let sink = Arc::new(RecordingSink::default());
    let token = CancellationToken::new();
    token.cancel();

    let results = run_batch(make_items(50), sink.clone(), token, 8, 0)
        .await
        .expect("cancelled batch must still return Ok");

    assert!(results.is_empty(), "no item may run after cancellation");
    assert!(sink.results.lock().unwrap().is_empty());
    assert_eq!(*sink.batches.lock().unwrap(), vec![0]);
}

#[tokio::test]
async fn cancel_mid_batch_stops_early_and_closes_cleanly() {
    let sink = Arc::new(RecordingSink::default());
    let token = CancellationToken::new();
    let items = make_items(100);
    let total = items.len();

    // Demo knob 50 ms/item with 8 workers: the batch needs ~700 ms, so a
    // cancel at 100 ms reliably leaves work undone.
    let handle = tokio::spawn(run_batch(items, sink.clone(), token.clone(), 8, 50));
    tokio::time::sleep(Duration::from_millis(100)).await;
    token.cancel();

    let results = handle
        .await
        .expect("run_batch task must not panic")
        .expect("cancelled batch must still return Ok");

    assert!(results.len() < total, "cancelled batch must finish early");
    assert_eq!(
        *sink.batches.lock().unwrap(),
        vec![results.len()],
        "batch-done count must equal delivered results"
    );

    // A cancelled batch must never fabricate scores: every delivered result is
    // either fully assessed, or explicitly BatchCancelled.
    for r in &results {
        assert!(
            matches!(
                r.verdict,
                Verdict::Assessed { .. }
                    | Verdict::NotVerified {
                        reason: NotVerifiedReason::BatchCancelled
                    }
            ),
            "item {} delivered an unexpected verdict {:?}",
            r.id,
            r.verdict
        );
    }
}

#[tokio::test]
async fn rapid_cancel_then_fresh_batch_is_independent() {
    // Batch 1: cancelled mid-flight...
    let sink1 = Arc::new(RecordingSink::default());
    let token1 = CancellationToken::new();
    let h1 = tokio::spawn(run_batch(
        make_items(100),
        sink1.clone(),
        token1.clone(),
        8,
        50,
    ));
    tokio::time::sleep(Duration::from_millis(60)).await;
    token1.cancel();

    // ...batch 2 starts immediately with its own token and must complete fully.
    let sink2 = Arc::new(RecordingSink::default());
    let results2 = run_batch(
        make_items(20),
        sink2.clone(),
        CancellationToken::new(),
        8,
        0,
    )
    .await
    .expect("fresh batch must succeed");

    let r1 = h1
        .await
        .expect("cancelled batch task must not panic")
        .expect("ok");
    assert!(r1.len() < 100);
    assert_eq!(
        *sink1.batches.lock().unwrap(),
        vec![r1.len()],
        "cancelled batch must close with an honest count"
    );
    assert_eq!(results2.len(), 20);
    assert_eq!(*sink2.batches.lock().unwrap(), vec![20]);
}
