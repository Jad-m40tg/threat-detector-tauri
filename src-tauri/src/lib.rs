mod commands;
mod services;
mod sink;
mod state;

use std::sync::Arc;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .manage(state::BatchRegistry::default())
        .setup(|app| {
            let mut config_path = app.path().app_config_dir()?;
            config_path.push("ai-overview.json");
            let transport = Arc::new(services::ai::transport::ReqwestTransport::new()?);
            app.manage(services::ai::AiService::new(transport, config_path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::analyze_item,
            commands::analyze_csv,
            commands::analyze_csv_content,
            commands::cancel_batch,
            commands::pick_csv,
            services::ai::commands::ai_get_status,
            services::ai::commands::ai_save_settings,
            services::ai::commands::ai_clear_key,
            services::ai::commands::ai_test_connection,
            services::ai::commands::ai_list_models,
            services::ai::commands::ai_overview,
        ])
        .run(tauri::generate_context!())
        .map_err(Into::into)
}
