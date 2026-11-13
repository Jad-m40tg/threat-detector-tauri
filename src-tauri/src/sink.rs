//! Tauri event sink: bridges `threat_core::EventSink` to the frontend's
//! `analysis:*` events, exactly as frozen in docs/IPC_CONTRACT.md.

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use threat_core::{EventSink, IpcAnalysisResult};

/// `analysis:item-start` payload.
#[derive(Debug, Clone, Serialize)]
pub struct ItemStartEvent {
    pub id: String,
    pub input: String,
}

/// `analysis:item-done` payload.
#[derive(Debug, Clone, Serialize)]
pub struct ItemDoneEvent {
    pub input: String,
    pub result: IpcAnalysisResult,
}

/// `analysis:progress` payload (camelCase per contract).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub batch_id: String,
    pub done: usize,
    pub total: usize,
    pub pct: u32,
}

/// `analysis:batch-done` payload.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchDoneEvent {
    pub batch_id: String,
    pub count: usize,
    pub results: Vec<IpcAnalysisResult>,
}

/// Emits one event on the main window. A failed delivery is logged, never
/// unwrapped or panicked across the IPC boundary.
fn emit(app: &AppHandle, name: &str, payload: &impl Serialize) {
    if let Err(err) = app.emit(name, payload) {
        eprintln!("event emit failed ({}): {}", name, err);
    }
}

/// `EventSink` implementation bound to one running batch.
pub struct TauriSink {
    app: AppHandle,
    batch_id: String,
}

impl TauriSink {
    pub fn new(app: AppHandle, batch_id: String) -> Self {
        Self { app, batch_id }
    }
}

impl EventSink for TauriSink {
    fn on_item_start(&self, item_id: &str, content: &str) {
        emit(
            &self.app,
            "analysis:item-start",
            &ItemStartEvent {
                id: item_id.to_string(),
                input: content.to_string(),
            },
        );
    }

    fn on_item_done(&self, result: &IpcAnalysisResult) {
        emit(
            &self.app,
            "analysis:item-done",
            &ItemDoneEvent {
                input: result.input.clone(),
                result: result.clone(),
            },
        );
    }

    fn on_progress(&self, done: usize, total: usize) {
        let pct = done
            .checked_mul(100)
            .and_then(|n| n.checked_div(total))
            .unwrap_or(0) as u32;
        emit(
            &self.app,
            "analysis:progress",
            &ProgressEvent {
                batch_id: self.batch_id.clone(),
                done,
                total,
                pct,
            },
        );
    }

    fn on_batch_done(&self, count: usize, results: &[IpcAnalysisResult]) {
        emit(
            &self.app,
            "analysis:batch-done",
            &BatchDoneEvent {
                batch_id: self.batch_id.clone(),
                count,
                results: results.to_vec(),
            },
        );
    }
}
