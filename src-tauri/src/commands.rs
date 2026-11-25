//! Tauri IPC commands, implementing docs/IPC_CONTRACT.md exactly.
//!
//! Every failure path returns a descriptive error string; nothing panics
//! across the IPC boundary and no failure ever defaults to Low or Safe.

use crate::sink::TauriSink;
use crate::state::BatchRegistry;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
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

// ---------------------------------------------------------------------------
// Update check (notify only — the app never installs anything itself).
// ---------------------------------------------------------------------------

/// Fallback repository ("owner/name"). The frontend may override it through the
/// dev setting `td.upd.repo`; empty/invalid input falls back to this constant.
const DEFAULT_REPO: &str = "jad/threat-detector";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(6);
const USER_AGENT: &str = "ThreatDetector-UpdateCheck";

/// A newer release with a Windows installer, as returned to the frontend.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub installer_url: String,
    pub current_version: String,
}

fn version_parts(raw: &str) -> Vec<u64> {
    let trimmed = raw.trim().trim_start_matches(['v', 'V']);
    let core = trimmed.split(['-', '+']).next().unwrap_or("");
    core.split('.')
        .map(|part| {
            part.chars()
                .take_while(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse::<u64>()
                .unwrap_or(0)
        })
        .collect()
}

/// True when `latest` is strictly newer than `current`. Semver-ish: a leading
/// `v` and pre-release/build suffixes are ignored, missing parts count as 0.
pub fn is_newer(latest: &str, current: &str) -> bool {
    let a = version_parts(latest);
    let b = version_parts(current);
    for index in 0..3 {
        let x = a.get(index).copied().unwrap_or(0);
        let y = b.get(index).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

/// "owner/name" only; empty means "use the default". Anything malformed is
/// rejected (returns None) so it can never be spliced into the API URL.
fn sanitize_repo(raw: &str) -> Option<String> {
    let value = raw.trim();
    if value.is_empty() {
        return Some(DEFAULT_REPO.to_string());
    }
    let mut parts = value.split('/');
    let owner = parts.next().unwrap_or("");
    let name = parts.next().unwrap_or("");
    if parts.next().is_some() {
        return None;
    }
    let valid = |part: &str| {
        !part.is_empty()
            && part.len() <= 100
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    };
    if valid(owner) && valid(name) {
        Some(format!("{}/{}", owner, name))
    } else {
        None
    }
}

/// Installer links must be plain https GitHub URLs; nothing else is opened.
pub fn is_allowed_installer_url(url: &str) -> bool {
    const PREFIX: &str = "https://github.com/";
    let value = url.trim();
    if !value.starts_with(PREFIX) {
        return false;
    }
    let rest = &value[PREFIX.len()..];
    !rest.is_empty()
        && !rest.starts_with('/')
        && !rest
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '\\' || c == '"' || c == '\'')
}

/// Prefers a `.exe` asset, falls back to `.msi`. Only allowlisted asset URLs
/// are considered.
fn pick_installer(assets: &[serde_json::Value]) -> Option<String> {
    let mut exe: Option<String> = None;
    let mut msi: Option<String> = None;
    for asset in assets {
        let name = asset
            .get("name")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        let url = asset
            .get("browser_download_url")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        if url.is_empty() || !is_allowed_installer_url(url) {
            continue;
        }
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".exe") && exe.is_none() {
            exe = Some(url.to_string());
        } else if lower.ends_with(".msi") && msi.is_none() {
            msi = Some(url.to_string());
        }
    }
    exe.or(msi)
}

/// Returns `Some(UpdateInfo)` only when the latest published (non-draft,
/// non-prerelease) release is newer than the app and ships a Windows installer.
/// Any error, timeout or unexpected shape is reported as `None` (no UI).
#[tauri::command]
pub async fn check_update(app: AppHandle, repo: Option<String>) -> Option<UpdateInfo> {
    let current = app.package_info().version.to_string();
    let slug = sanitize_repo(repo.as_deref().unwrap_or(""))?;
    let endpoint = format!("https://api.github.com/repos/{}/releases/latest", slug);
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .ok()?;
    let response = client
        .get(endpoint)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let body: serde_json::Value = response.json().await.ok()?;
    if body.get("draft").and_then(serde_json::Value::as_bool) == Some(true) {
        return None;
    }
    if body.get("prerelease").and_then(serde_json::Value::as_bool) == Some(true) {
        return None;
    }
    let tag = body.get("tag_name").and_then(serde_json::Value::as_str)?;
    if !is_newer(tag, &current) {
        return None;
    }
    let assets = body.get("assets").and_then(serde_json::Value::as_array)?;
    let installer_url = pick_installer(assets)?;
    Some(UpdateInfo {
        version: tag.trim().trim_start_matches(['v', 'V']).to_string(),
        installer_url,
        current_version: current,
    })
}

/// Opens an installer link in the default browser. Only allowlisted GitHub
/// https URLs are accepted; everything else is rejected.
#[tauri::command]
pub fn open_installer(url: String) -> Result<(), String> {
    if !is_allowed_installer_url(&url) {
        return Err("Only https://github.com installer links can be opened.".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not open the browser: {}", e))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = url;
        Err("Opening installer links is not supported on this platform.".to_string())
    }
}

#[cfg(test)]
mod update_tests {
    use super::*;

    #[test]
    fn newer_versions_are_detected() {
        assert!(is_newer("v1.2.0", "1.1.0"));
        assert!(is_newer("2.0.0", "1.9.9"));
        assert!(is_newer("1.1.10", "1.1.9"));
        assert!(is_newer("v9.9.9", "0.1.0"));
    }

    #[test]
    fn equal_or_older_versions_are_not() {
        assert!(!is_newer("1.1.0", "1.1.0"));
        assert!(!is_newer("v1.0.9", "1.1.0"));
        assert!(!is_newer("1.2", "1.2.0"));
    }

    #[test]
    fn installer_allowlist_only_accepts_github_https() {
        assert!(is_allowed_installer_url(
            "https://github.com/o/r/releases/download/v1/App.exe"
        ));
        assert!(!is_allowed_installer_url("http://github.com/o/r/App.exe"));
        assert!(!is_allowed_installer_url("https://evil.example/github.com/x.exe"));
        assert!(!is_allowed_installer_url("https://github.com/"));
        assert!(!is_allowed_installer_url("javascript:alert(1)"));
        assert!(!is_allowed_installer_url("https://github.com/ /x"));
    }

    #[test]
    fn repo_falls_back_and_rejects_bad_shapes() {
        assert_eq!(sanitize_repo(""), Some(DEFAULT_REPO.to_string()));
        assert_eq!(sanitize_repo("jad/app").as_deref(), Some("jad/app"));
        assert_eq!(sanitize_repo("a/b/c"), None);
        assert_eq!(sanitize_repo("jad/../x"), None);
        assert_eq!(sanitize_repo("jad/"), None);
    }
}
