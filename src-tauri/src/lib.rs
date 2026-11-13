mod commands;
mod sink;
mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .manage(state::BatchRegistry::default())
        .invoke_handler(tauri::generate_handler![
            commands::analyze_item,
            commands::analyze_csv,
            commands::analyze_csv_content,
            commands::cancel_batch,
            commands::pick_csv,
        ])
        .run(tauri::generate_context!())
        .map_err(Into::into)
}
