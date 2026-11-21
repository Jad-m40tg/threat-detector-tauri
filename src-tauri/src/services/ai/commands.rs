//! Tauri command surface for the AI overview. Keys are write-only: no command
//! returns a key or writes one to a log.

use tauri::State;

use super::service::AiService;
use super::types::{
    AiError, AiStatus, ModelList, Overview, OverviewRequest, SettingsPatch, TestResult,
};

#[tauri::command]
pub async fn ai_get_status(state: State<'_, AiService>) -> Result<AiStatus, AiError> {
    Ok(state.get_status().await)
}

#[tauri::command]
pub async fn ai_save_settings(
    state: State<'_, AiService>,
    patch: SettingsPatch,
) -> Result<AiStatus, AiError> {
    state.save_settings(patch).await
}

#[tauri::command]
pub async fn ai_clear_key(state: State<'_, AiService>, provider: String) -> Result<(), AiError> {
    state.clear_key(&provider).await
}

#[tauri::command]
pub async fn ai_test_connection(
    state: State<'_, AiService>,
    provider: String,
) -> Result<TestResult, AiError> {
    Ok(state.test_connection(&provider).await)
}

#[tauri::command]
pub async fn ai_list_models(
    state: State<'_, AiService>,
    provider: String,
) -> Result<ModelList, AiError> {
    let models = state.list_models_for(&provider).await?;
    Ok(ModelList { models })
}

#[tauri::command]
pub async fn ai_overview(
    state: State<'_, AiService>,
    request: OverviewRequest,
) -> Result<Overview, AiError> {
    state.overview(request).await
}
