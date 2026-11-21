//! Provider adapters: Groq and generic OpenAI-compatible chat completions,
//! plus Google Gemini `generateContent`.

use std::time::Duration;

use serde_json::{json, Value};

use super::config::ProviderConfig;
use super::prompt::SYSTEM_PROMPT;
use super::transport::{HttpTransport, Method, TransportError};
use super::types::{PROVIDER_GEMINI, PROVIDER_GROQ};

pub const GROQ_BASE: &str = "https://api.groq.com/openai/v1";
pub const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttemptError {
    Unauthorized,
    RateLimited(Option<u64>),
    Overloaded,
    Server,
    Timeout,
    Network,
    BadResponse,
}

pub fn default_model(id: &str) -> &'static str {
    match id {
        PROVIDER_GROQ => "llama-3.3-70b-versatile",
        PROVIDER_GEMINI => "gemini-3.1-flash-lite",
        _ => "",
    }
}

pub fn preferred_models(id: &str) -> &'static [&'static str] {
    match id {
        PROVIDER_GROQ => &[
            "llama-3.3-70b-versatile",
            "openai/gpt-oss-120b",
            "openai/gpt-oss-20b",
            "llama-3.1-8b-instant",
        ],
        PROVIDER_GEMINI => &[
            "gemini-3.1-flash-lite",
            "gemini-2.5-flash-lite",
            "gemini-2.0-flash-lite",
            "gemini-flash-lite-latest",
        ],
        _ => &[],
    }
}

pub fn base_url(id: &str, cfg: &ProviderConfig) -> String {
    match id {
        PROVIDER_GROQ => GROQ_BASE.to_string(),
        PROVIDER_GEMINI => GEMINI_BASE.to_string(),
        _ => cfg
            .base_url
            .as_deref()
            .unwrap_or("")
            .trim()
            .trim_end_matches('/')
            .to_string(),
    }
}

fn api_key(cfg: &ProviderConfig) -> &str {
    cfg.api_key.as_deref().unwrap_or("").trim()
}

fn map_transport(err: TransportError) -> AttemptError {
    match err {
        TransportError::Timeout => AttemptError::Timeout,
        TransportError::Network => AttemptError::Network,
    }
}

fn status_error(status: u16, retry_after: Option<u64>) -> Option<AttemptError> {
    match status {
        200..=299 => None,
        401 | 403 => Some(AttemptError::Unauthorized),
        429 => Some(AttemptError::RateLimited(retry_after)),
        503 | 529 => Some(AttemptError::Overloaded),
        500..=599 => Some(AttemptError::Server),
        _ => Some(AttemptError::BadResponse),
    }
}

fn choose_model(id: &str, models: &[String]) -> Option<String> {
    for wanted in preferred_models(id) {
        if models.iter().any(|m| m == wanted) {
            return Some((*wanted).to_string());
        }
    }
    models
        .iter()
        .find(|m| match id {
            PROVIDER_GEMINI => m.contains("flash-lite"),
            PROVIDER_GROQ => {
                (m.contains("llama") || m.contains("gpt-oss"))
                    && !m.contains("guard")
                    && !m.contains("whisper")
                    && !m.contains("tts")
            }
            _ => true,
        })
        .cloned()
}

fn parse_openai_models(body: &Value) -> Vec<String> {
    body.get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str))
                .map(|id| id.to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn parse_gemini_models(body: &Value) -> Vec<String> {
    body.get("models")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| {
                    item.get("supportedGenerationMethods")
                        .and_then(Value::as_array)
                        .map(|methods| {
                            methods
                                .iter()
                                .any(|m| m.as_str() == Some("generateContent"))
                        })
                        .unwrap_or(false)
                })
                .filter_map(|item| item.get("name").and_then(Value::as_str))
                .map(|name| name.trim_start_matches("models/").to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn parse_openai_text(body: &Value) -> Option<String> {
    body.get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .map(|text| text.to_string())
}

fn parse_gemini_text(body: &Value) -> Option<String> {
    let parts = body
        .get("candidates")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|candidate| candidate.get("content"))
        .and_then(|content| content.get("parts"))
        .and_then(Value::as_array)?;
    let mut text = String::new();
    for part in parts {
        if let Some(chunk) = part.get("text").and_then(Value::as_str) {
            text.push_str(chunk);
        }
    }
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn request_urls(
    id: &str,
    cfg: &ProviderConfig,
    model: &str,
) -> Result<(String, Vec<(String, String)>), AttemptError> {
    let key = api_key(cfg);
    match id {
        PROVIDER_GROQ => Ok((
            format!("{}/chat/completions", GROQ_BASE),
            vec![
                ("Authorization".into(), format!("Bearer {key}")),
                ("Content-Type".into(), "application/json".into()),
            ],
        )),
        PROVIDER_GEMINI => Ok((
            format!("{GEMINI_BASE}/models/{model}:generateContent"),
            vec![
                ("x-goog-api-key".into(), key.to_string()),
                ("Content-Type".into(), "application/json".into()),
            ],
        )),
        _ => {
            let base = base_url(id, cfg);
            if base.is_empty() {
                return Err(AttemptError::BadResponse);
            }
            Ok((
                format!("{base}/chat/completions"),
                vec![
                    ("Authorization".into(), format!("Bearer {key}")),
                    ("Content-Type".into(), "application/json".into()),
                ],
            ))
        }
    }
}

fn chat_body(id: &str, model: &str, user_prompt: &str) -> Value {
    if id == PROVIDER_GEMINI {
        json!({
            "systemInstruction": { "parts": [{ "text": SYSTEM_PROMPT }] },
            "contents": [{ "role": "user", "parts": [{ "text": user_prompt }] }],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 400,
                "responseMimeType": "application/json",
                "thinkingConfig": { "thinkingBudget": 0 }
            }
        })
    } else {
        json!({
            "model": model,
            "messages": [
                { "role": "system", "content": SYSTEM_PROMPT },
                { "role": "user", "content": user_prompt }
            ],
            "temperature": 0.2,
            "max_tokens": 400,
            "response_format": { "type": "json_object" }
        })
    }
}

pub async fn chat(
    transport: &dyn HttpTransport,
    id: &str,
    cfg: &ProviderConfig,
    model: &str,
    user_prompt: &str,
    timeout: Duration,
) -> Result<String, AttemptError> {
    let (url, headers) = request_urls(id, cfg, model)?;
    let response = transport
        .request(
            Method::Post,
            &url,
            headers,
            Some(chat_body(id, model, user_prompt)),
            timeout,
        )
        .await
        .map_err(map_transport)?;
    if let Some(err) = status_error(response.status, response.retry_after) {
        return Err(err);
    }
    let text = if id == PROVIDER_GEMINI {
        parse_gemini_text(&response.body)
    } else {
        parse_openai_text(&response.body)
    };
    text.ok_or(AttemptError::BadResponse)
}

pub async fn list_models(
    transport: &dyn HttpTransport,
    id: &str,
    cfg: &ProviderConfig,
    timeout: Duration,
) -> Result<Vec<String>, AttemptError> {
    let base = base_url(id, cfg);
    if base.is_empty() {
        return Err(AttemptError::BadResponse);
    }
    let headers = if id == PROVIDER_GEMINI {
        vec![("x-goog-api-key".into(), api_key(cfg).to_string())]
    } else {
        vec![("Authorization".into(), format!("Bearer {}", api_key(cfg)))]
    };
    let response = transport
        .request(
            Method::Get,
            &format!("{base}/models"),
            headers,
            None,
            timeout,
        )
        .await
        .map_err(map_transport)?;
    if let Some(err) = status_error(response.status, response.retry_after) {
        return Err(err);
    }
    Ok(if id == PROVIDER_GEMINI {
        parse_gemini_models(&response.body)
    } else {
        parse_openai_models(&response.body)
    })
}

pub fn pick_model(id: &str, models: &[String]) -> Option<String> {
    choose_model(id, models)
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::services::ai::transport::HttpResponse;

    #[derive(Default)]
    struct Fake {
        status: u16,
        retry_after: Option<u64>,
        body: Value,
        error: Option<TransportError>,
        last_url: Mutex<String>,
        last_headers: Mutex<Vec<(String, String)>>,
        last_body: Mutex<Option<Value>>,
    }

    #[async_trait::async_trait]
    impl HttpTransport for Fake {
        async fn request(
            &self,
            _method: Method,
            url: &str,
            headers: Vec<(String, String)>,
            body: Option<Value>,
            _timeout: Duration,
        ) -> Result<HttpResponse, TransportError> {
            *self.last_url.lock().expect("lock") = url.to_string();
            *self.last_headers.lock().expect("lock") = headers;
            *self.last_body.lock().expect("lock") = body;
            if let Some(err) = self.error {
                return Err(err);
            }
            Ok(HttpResponse {
                status: self.status,
                retry_after: self.retry_after,
                body: self.body.clone(),
            })
        }
    }

    fn cfg() -> ProviderConfig {
        ProviderConfig {
            api_key: Some("test-key".into()),
            model: None,
            base_url: None,
        }
    }

    async fn chat_error(status: u16, retry: Option<u64>) -> AttemptError {
        let fake = Fake {
            status,
            retry_after: retry,
            body: json!({}),
            ..Fake::default()
        };
        chat(
            &fake,
            PROVIDER_GROQ,
            &cfg(),
            "m",
            "prompt",
            Duration::from_secs(1),
        )
        .await
        .expect_err("must fail")
    }

    #[tokio::test]
    async fn maps_429_with_retry_after() {
        assert_eq!(
            chat_error(429, Some(45)).await,
            AttemptError::RateLimited(Some(45))
        );
        assert_eq!(chat_error(429, None).await, AttemptError::RateLimited(None));
    }

    #[tokio::test]
    async fn maps_401_503_500_and_timeout() {
        assert_eq!(chat_error(401, None).await, AttemptError::Unauthorized);
        assert_eq!(chat_error(503, None).await, AttemptError::Overloaded);
        assert_eq!(chat_error(529, None).await, AttemptError::Overloaded);
        assert_eq!(chat_error(500, None).await, AttemptError::Server);
        let fake = Fake {
            error: Some(TransportError::Timeout),
            ..Fake::default()
        };
        let err = chat(
            &fake,
            PROVIDER_GROQ,
            &cfg(),
            "m",
            "p",
            Duration::from_secs(1),
        )
        .await
        .expect_err("timeout");
        assert_eq!(err, AttemptError::Timeout);
    }

    #[tokio::test]
    async fn groq_request_shape() {
        let fake = Fake {
            status: 200,
            body: json!({ "choices": [{ "message": { "content": "{\"ok\":1}" } }] }),
            ..Fake::default()
        };
        let text = chat(
            &fake,
            PROVIDER_GROQ,
            &cfg(),
            "model-x",
            "hello",
            Duration::from_secs(1),
        )
        .await
        .expect("ok");
        assert_eq!(text, "{\"ok\":1}");
        assert_eq!(
            fake.last_url.lock().expect("lock").as_str(),
            "https://api.groq.com/openai/v1/chat/completions"
        );
        let headers = fake.last_headers.lock().expect("lock");
        assert!(headers
            .iter()
            .any(|(k, v)| k == "Authorization" && v == "Bearer test-key"));
    }

    #[tokio::test]
    async fn gemini_request_shape() {
        let fake = Fake {
            status: 200,
            body: json!({ "candidates": [{ "content": { "parts": [{ "text": "{}" }] } }] }),
            ..Fake::default()
        };
        let text = chat(
            &fake,
            PROVIDER_GEMINI,
            &cfg(),
            "gemini-x",
            "hello",
            Duration::from_secs(1),
        )
        .await
        .expect("ok");
        assert_eq!(text, "{}");
        let url = fake.last_url.lock().expect("lock").clone();
        assert!(url
            .contains("generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent"));
        let headers = fake.last_headers.lock().expect("lock");
        assert!(headers
            .iter()
            .any(|(k, v)| k == "x-goog-api-key" && v == "test-key"));
    }

    #[test]
    fn picks_preferred_and_flash_lite_models() {
        let groq = vec![
            "whisper-large-v3".to_string(),
            "llama-3.1-8b-instant".to_string(),
        ];
        assert_eq!(
            pick_model(PROVIDER_GROQ, &groq).as_deref(),
            Some("llama-3.1-8b-instant")
        );
        let gemini = vec![
            "gemini-3-pro".to_string(),
            "gemini-3.1-flash-lite".to_string(),
        ];
        assert_eq!(
            pick_model(PROVIDER_GEMINI, &gemini).as_deref(),
            Some("gemini-3.1-flash-lite")
        );
    }
}
