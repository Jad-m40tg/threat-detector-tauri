//! Core domain models for threat detection.
//!
//! Enforces Invariant 1: `RiskLevel` has NO `NotVerified` variant.
//! A `Verdict` is either `Assessed { level, score, hits }` or `NotVerified { reason }`.
//! Conversion to IPC representation happens in `to_ipc_shape()`, guaranteeing that
//! an unverified input can never yield a Low or Safe result.

use serde::{Deserialize, Serialize};

/// Input classification for analysis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InputType {
    Url,
    Message,
}

impl std::fmt::Display for InputType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InputType::Url => write!(f, "url"),
            InputType::Message => write!(f, "message"),
        }
    }
}

/// Risk level assessed from local heuristic rules.
///
/// NOTE: Deliberately does NOT contain a `NotVerified` or `Unknown` variant!
/// A `RiskLevel` can ONLY be instantiated when rules were successfully evaluated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
}

impl RiskLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            RiskLevel::Low => "Low",
            RiskLevel::Medium => "Medium",
            RiskLevel::High => "High",
        }
    }

    pub fn to_lowercase_str(&self) -> &'static str {
        match self {
            RiskLevel::Low => "low",
            RiskLevel::Medium => "medium",
            RiskLevel::High => "high",
        }
    }
}

/// A specific rule that fired during analysis.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleHit {
    pub id: String,
    pub description: String,
    pub points: u32,
}

impl RuleHit {
    pub fn new(id: impl Into<String>, description: impl Into<String>, points: u32) -> Self {
        Self {
            id: id.into(),
            description: description.into(),
            points,
        }
    }
}

/// Reason why an input could not be verified.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum NotVerifiedReason {
    EmptyInput,
    WhitespaceOnly,
    MalformedUrl(String),
    OversizedInput { length: usize, max: usize },
    InvalidCsvRow { row: usize, details: String },
    IoError(String),
    BatchCancelled,
    ExecutionPanicked(String),
    Other(String),
}

impl std::fmt::Display for NotVerifiedReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NotVerifiedReason::EmptyInput => write!(f, "Input is empty"),
            NotVerifiedReason::WhitespaceOnly => write!(f, "Input contains only whitespace"),
            NotVerifiedReason::MalformedUrl(details) => {
                write!(f, "Malformed URL format: {}", details)
            }
            NotVerifiedReason::OversizedInput { length, max } => {
                write!(
                    f,
                    "Input size ({} chars) exceeds limit ({} chars)",
                    length, max
                )
            }
            NotVerifiedReason::InvalidCsvRow { row, details } => {
                write!(f, "CSV row {} invalid: {}", row, details)
            }
            NotVerifiedReason::IoError(msg) => write!(f, "I/O error: {}", msg),
            NotVerifiedReason::BatchCancelled => write!(f, "Batch processing was cancelled"),
            NotVerifiedReason::ExecutionPanicked(err) => {
                write!(f, "Analysis task panicked: {}", err)
            }
            NotVerifiedReason::Other(msg) => write!(f, "{}", msg),
        }
    }
}

/// Primary analysis verdict.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// Fully evaluated against detection rules.
    Assessed {
        level: RiskLevel,
        score: u32,
        hits: Vec<RuleHit>,
    },
    /// Could not be evaluated. Carries the explicit reason.
    NotVerified { reason: NotVerifiedReason },
}

/// Analysis item input request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisRequest {
    pub id: Option<String>,
    pub input_type: Option<InputType>,
    pub content: String,
}

/// Core domain item result.
#[derive(Debug, Clone, PartialEq)]
pub struct ItemResult {
    pub id: String,
    pub input_type: InputType,
    pub content: String,
    pub verdict: Verdict,
    pub duration_ms: u64,
}

/// Serialized IPC error representation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IpcError {
    pub kind: String,
    pub message: String,
}

/// Detailed rule hit in camelCase for IPC.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IpcRuleHit {
    pub id: String,
    pub description: String,
    pub points: u32,
}

/// Final camelCase JSON payload delivered across the Tauri IPC boundary to the UI.
///
/// Ensures full compatibility with existing `index.js`, `history.js`, and `analysisService.js`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IpcAnalysisResult {
    pub id: String,
    pub input_type: String,
    pub input: String,
    pub risk_level: String,
    pub risk: String,
    pub state: String,
    pub score: Option<u32>,
    pub status: String,
    pub category: String,
    pub details: String,
    pub reasons: Vec<String>,
    pub triggered_rules: Vec<IpcRuleHit>,
    pub recommendation: String,
    pub error: Option<IpcError>,
    pub duration_ms: u64,
    pub ts: u64,
}

impl ItemResult {
    /// Canonical conversion function from core `ItemResult` to `IpcAnalysisResult`.
    ///
    /// This is the SINGLE place where the IPC shape is constructed.
    /// Invariant: Under NO circumstances will an unverified result map to "Low", "low", "SAFE",
    /// or a valid numerical score.
    pub fn to_ipc_shape(&self, current_ts: u64) -> IpcAnalysisResult {
        let type_str = self.input_type.to_string();
        match &self.verdict {
            Verdict::Assessed { level, score, hits } => {
                let risk_level_str = level.as_str().to_string();
                let risk_str = level.to_lowercase_str().to_string();
                let state_str = if *level == RiskLevel::Low {
                    "SAFE".to_string()
                } else {
                    "THREAT".to_string()
                };
                let status_str = "verified".to_string();

                let reasons: Vec<String> = if hits.is_empty() {
                    vec!["No suspicious heuristic patterns detected.".to_string()]
                } else {
                    hits.iter().map(|h| h.description.clone()).collect()
                };

                let triggered_rules = hits
                    .iter()
                    .map(|h| IpcRuleHit {
                        id: h.id.clone(),
                        description: h.description.clone(),
                        points: h.points,
                    })
                    .collect();

                let category = match level {
                    RiskLevel::Low => {
                        if self.input_type == InputType::Url {
                            "Legitimate URL".to_string()
                        } else {
                            "Legitimate Message".to_string()
                        }
                    }
                    RiskLevel::Medium => "Medium Risk Suspicious Pattern".to_string(),
                    RiskLevel::High => "High Risk Threat Detected".to_string(),
                };

                let details = if hits.is_empty() {
                    "Valid protocol and standard structure; clean inspection.".to_string()
                } else {
                    reasons.join("; ")
                };

                let recommendation = match level {
                    RiskLevel::Low => "Standard precautions apply. No immediate risk indicators found.".to_string(),
                    RiskLevel::Medium => "Exercise caution. Verify source before proceeding or sharing credentials.".to_string(),
                    RiskLevel::High => "Do not open, click, or interact with this content. Severe risk indicators identified.".to_string(),
                };

                IpcAnalysisResult {
                    id: self.id.clone(),
                    input_type: type_str,
                    input: self.content.clone(),
                    risk_level: risk_level_str,
                    risk: risk_str,
                    state: state_str,
                    score: Some(*score),
                    status: status_str,
                    category,
                    details,
                    reasons,
                    triggered_rules,
                    recommendation,
                    error: None,
                    duration_ms: self.duration_ms,
                    ts: current_ts,
                }
            }
            Verdict::NotVerified { reason } => {
                let reason_str = reason.to_string();
                IpcAnalysisResult {
                    id: self.id.clone(),
                    input_type: type_str,
                    input: self.content.clone(),
                    risk_level: "NotVerified".to_string(),
                    risk: "unverified".to_string(),
                    state: "NOT_VERIFIED".to_string(),
                    score: None,
                    status: "not_verified".to_string(),
                    category: "Not Verified".to_string(),
                    details: reason_str.clone(),
                    reasons: vec![reason_str.clone()],
                    triggered_rules: Vec::new(),
                    recommendation: "Unable to complete inspection safely. Treat as untrusted and do not proceed.".to_string(),
                    error: Some(IpcError {
                        kind: format!("{:?}", reason),
                        message: reason_str,
                    }),
                    duration_ms: self.duration_ms,
                    ts: current_ts,
                }
            }
        }
    }
}
