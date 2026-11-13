#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(err) = threat_detector_lib::run() {
        eprintln!("error while running tauri application: {}", err);
        std::process::exit(1);
    }
}
