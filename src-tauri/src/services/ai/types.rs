//! Shared types for the AI overview feature.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROVIDER_GROQ: &str = "groq";
pub const PROVIDER_GEMINI: &str = "gemini";
pub const PROVIDER_CUSTOM: &str = "custom";
pub const PROVIDER_IDS: [&str; 3] = [PROVIDER_GROQ, PROVIDER_GEMINI, PROVIDER_CUSTOM];

pub fn provider_name(id: &str) -> &'static str {
    match id {
        PROVIDER_GROQ => "Groq",
        PROVIDER_GEMINI => "Google Gemini",
        PROVIDER_CUSTOM => "Custom OpenAI-compatible",
        _ => "AI provider",
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_seconds: Option<u64>,
}

impl AiError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            retry_after_seconds: None,
        }
    }

    pub fn with_retry(mut self, seconds: u64) -> Self {
        self.retry_after_seconds = Some(seconds);
        self
    }

    pub fn consent() -> Self {
        Self::new("NoConsent", "AI overview needs your consent in Settings.")
    }

    pub fn no_key() -> Self {
        Self::new(
            "NoKey",
            "Add a provider key in Settings to use the AI overview.",
        )
    }

    pub fn all_failed(seconds: Option<u64>) -> Self {
        let err = Self::new(
            "AllProvidersFailed",
            "All AI providers are unavailable right now.",
        );
        match seconds {
            Some(s) => err.with_retry(s),
            None => err,
        }
    }
}

impl std::fmt::Display for AiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AiError {}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub id: String,
    pub name: String,
    pub has_key: bool,
    pub key_hint: String,
    pub model: String,
    pub base_url: String,
    /// ready | no_key | cooling | invalid_key | daily_cap
    pub state: String,
    /// Epoch milliseconds; null when not cooling.
    pub cooldown_until: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub providers: Vec<ProviderStatus>,
    pub consent_given: bool,
    pub available: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewRequest {
    pub scope: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    /// high | medium | low | unverified
    pub level: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub headline: String,
    pub summary: String,
    pub findings: Vec<Finding>,
    pub explanation: String,
    pub tips: Vec<String>,
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub provider: Option<String>,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub consent: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    pub message: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelList {
    pub models: Vec<String>,
}
