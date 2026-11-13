#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    threat_detector_lib::run();
}
