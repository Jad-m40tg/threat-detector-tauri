//! Error types for threat detection and input validation.
//!
//! Guarantees that all failures and parsing errors convert strictly into
//! `NotVerifiedReason`, preventing any failure from defaulting to a safe/low score.

use crate::models::NotVerifiedReason;
use thiserror::Error;

/// Crate-level error types.
#[derive(Debug, Error)]
pub enum ThreatError {
    #[error("Input text is empty")]
    EmptyInput,

    #[error("Input text contains only whitespace")]
    WhitespaceOnly,

    #[error("Input exceeds maximum allowed length: length={length}, max={max}")]
    OversizedInput { length: usize, max: usize },

    #[error("Malformed URL: {0}")]
    MalformedUrl(String),

    #[error("CSV parsing error on row {row}: {details}")]
    CsvRowError { row: usize, details: String },

    #[error("CSV file error: {0}")]
    CsvFileError(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Operation cancelled by user or timeout")]
    Cancelled,

    #[error("Task panicked during execution: {0}")]
    TaskPanicked(String),

    #[error("General error: {0}")]
    Other(String),
}

impl From<ThreatError> for NotVerifiedReason {
    fn from(err: ThreatError) -> Self {
        match err {
            ThreatError::EmptyInput => NotVerifiedReason::EmptyInput,
            ThreatError::WhitespaceOnly => NotVerifiedReason::WhitespaceOnly,
            ThreatError::OversizedInput { length, max } => {
                NotVerifiedReason::OversizedInput { length, max }
            }
            ThreatError::MalformedUrl(details) => NotVerifiedReason::MalformedUrl(details),
            ThreatError::CsvRowError { row, details } => {
                NotVerifiedReason::InvalidCsvRow { row, details }
            }
            ThreatError::CsvFileError(msg) => NotVerifiedReason::IoError(msg),
            ThreatError::Io(e) => NotVerifiedReason::IoError(e.to_string()),
            ThreatError::Cancelled => NotVerifiedReason::BatchCancelled,
            ThreatError::TaskPanicked(msg) => NotVerifiedReason::ExecutionPanicked(msg),
            ThreatError::Other(msg) => NotVerifiedReason::Other(msg),
        }
    }
}
