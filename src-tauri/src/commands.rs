//! Tauri IPC commands, implementing docs/IPC_CONTRACT.md exactly.
//!
//! Every failure path returns a descriptive error string; nothing panics
//! across the IPC boundary and no failure ever defaults to Low or Safe.

use crate::sink::TauriSink;
use crate::state::BatchRegistry;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use threat_core::csv_parser::{parse_csv_file, parse_csv_text};
use threat_core::models::{AnalysisRequest, InputType, IpcAnalysisResult};
use threat_core::{analyze_item as core_analyze_item, run_batch};
use tokio_util::sync::CancellationToken;

/// Request body for `analyze_item` (camelCase per contract).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemRequest {
    pub id: Option<String>,
    pub input_type: Option<String>,
    pub content: String,
}

/// Optional tuning knobs for the batch commands (camelCase per contract).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchOptions {
    pub min_item_duration_ms: Option<u64>,
    pub concurrency: Option<usize>,
}

/// Response of the batch commands: batch identity plus the number of queued items.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchStartInfo {
    pub batch_id: String,
    pub total: usize,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// `null` or unknown `inputType` values fall back to backend auto-detection
/// (decision D2).
fn parse_input_type(raw: Option<String>) -> Option<InputType> {
    match raw.as_deref() {
        Some("url") => Some(InputType::Url),
        Some("message") => Some(InputType::Message),
        _ => None,
    }
}

/// Starts one batch and returns its identity before any item runs. The batch
/// itself is spawned on the async runtime so the invoke reply (batch id and
/// total) reaches the frontend while progress events are still streaming.
fn run_csv_batch(
    app: AppHandle,
    items: Vec<threat_core::csv_parser::CsvRowItem>,
    options: Option<BatchOptions>,
) -> Result<BatchStartInfo, String> {
    let total = items.len();
    let batch_id = format!("batch-{}", now_ms());
    let token = CancellationToken::new();
    app.state::<BatchRegistry>()
        .insert(batch_id.clone(), token.clone());

    // Demo knob (decision D4): keeps batch progress visually inspectable.
    let min_item_duration_ms = options
        .as_ref()
        .and_then(|o| o.min_item_duration_ms)
        .unwrap_or(0);
    let concurrency = options
        .as_ref()
        .and_then(|o| o.concurrency)
        .filter(|c| *c >= 1)
        .map(|c| c.min(32))
        .unwrap_or(8);

    let sink = Arc::new(TauriSink::new(app.clone(), batch_id.clone()));
    let done_id = batch_id.clone();
    tauri::async_runtime::spawn(async move {
        let _ = run_batch(items, sink, token, concurrency, min_item_duration_ms).await;
        app.state::<BatchRegistry>().remove(&done_id);
    });

    Ok(BatchStartInfo { batch_id, total })
}

/// 1.1 `analyze_item` — analyzes a single URL or message. Analysis errors are
/// delivered as a valid `IpcAnalysisResult` with `riskLevel: "NotVerified"`.
#[tauri::command]
pub async fn analyze_item(request: ItemRequest) -> IpcAnalysisResult {
    let core_request = AnalysisRequest {
        id: request.id,
        input_type: parse_input_type(request.input_type),
        content: request.content,
    };
    core_analyze_item(&core_request).to_ipc_shape(now_ms())
}

/// 1.2 `analyze_csv` — parses the file off-thread, then streams the batch.
#[tauri::command]
pub async fn analyze_csv(
    app: AppHandle,
    path: String,
    options: Option<BatchOptions>,
) -> Result<BatchStartInfo, String> {
    let parsed = tokio::task::spawn_blocking(move || parse_csv_file(&path))
        .await
        .map_err(|e| format!("Analysis task failed: {}", e))?;
    let items = parsed.map_err(|e| e.to_string())?;
    run_csv_batch(app, items, options)
}

/// 1.5 `analyze_csv_content` — drag-and-drop path (decision D7): the bytes are
/// read in the WebView and sent as text; the backend parses and enforces the
/// same limits as `analyze_csv`.
#[tauri::command]
pub async fn analyze_csv_content(
    app: AppHandle,
    name: String,
    content: String,
    options: Option<BatchOptions>,
) -> Result<BatchStartInfo, String> {
    let parsed = tokio::task::spawn_blocking(move || parse_csv_text(&name, &content))
        .await
        .map_err(|e| format!("Analysis task failed: {}", e))?;
    let items = parsed.map_err(|e| e.to_string())?;
    run_csv_batch(app, items, options)
}

/// 1.3 `cancel_batch` — cooperative cancellation signal for an in-flight batch.
#[tauri::command]
pub fn cancel_batch(registry: State<'_, BatchRegistry>, batch_id: String) -> bool {
    registry.cancel(&batch_id)
}

/// 1.4 `pick_csv` — native Windows file dialog from Rust, so the frontend
/// needs zero file-system permissions. Runs off-thread (dialogs block).
#[tauri::command]
pub async fn pick_csv() -> Option<String> {
    tokio::task::spawn_blocking(|| {
        rfd::FileDialog::new()
            .add_filter("CSV files", &["csv"])
            .set_title("Select a CSV file to analyze")
            .pick_file()
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .ok()
    .flatten()
}
