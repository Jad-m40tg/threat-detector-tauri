//! `threat-core`: Decoupled, pure Rust engine for threat detection.
//!
//! Provides rule-based heuristic scoring, CSV parsing, and multi-threaded
//! batch processing without any desktop/GUI dependencies.

pub mod csv_parser;
pub mod engine;
pub mod error;
pub mod message_rules;
pub mod models;
pub mod scorer;
pub mod url_rules;
pub mod validator;

pub use engine::{analyze_item, run_batch};
pub use error::ThreatError;
pub use models::{
    AnalysisRequest, InputType, IpcAnalysisResult, ItemResult, NotVerifiedReason, RiskLevel,
    RuleHit, Verdict,
};

/// Decoupled event sink trait for reporting real-time analysis progress.
pub trait EventSink: Send + Sync + 'static {
    fn on_item_start(&self, item_id: &str, content: &str);
    fn on_item_done(&self, result: &IpcAnalysisResult);
    fn on_progress(&self, done: usize, total: usize);
    fn on_batch_done(&self, total: usize, results: &[IpcAnalysisResult]);
}
