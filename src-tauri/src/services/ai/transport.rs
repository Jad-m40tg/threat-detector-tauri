//! Tiny HTTP abstraction so the AI service can be tested without a network.
//!
//! No request or response body is ever logged: request bodies contain the
//! scanned text and responses contain AI-generated text.

use std::time::Duration;

use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
}

#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub retry_after: Option<u64>,
    pub body: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportError {
    Timeout,
    Network,
}

#[async_trait::async_trait]
pub trait HttpTransport: Send + Sync {
    async fn request(
        &self,
        method: Method,
        url: &str,
        headers: Vec<(String, String)>,
        body: Option<Value>,
        timeout: Duration,
    ) -> Result<HttpResponse, TransportError>;
}

pub struct ReqwestTransport {
    client: reqwest::Client,
}

impl ReqwestTransport {
    pub fn new() -> Result<Self, reqwest::Error> {
        let client = reqwest::Client::builder()
            .user_agent("ThreatDetector/0.1 (desktop; offline scanner)")
            .build()?;
        Ok(Self { client })
    }
}

#[async_trait::async_trait]
impl HttpTransport for ReqwestTransport {
    async fn request(
        &self,
        method: Method,
        url: &str,
        headers: Vec<(String, String)>,
        body: Option<Value>,
        timeout: Duration,
    ) -> Result<HttpResponse, TransportError> {
        let mut builder = match method {
            Method::Get => self.client.get(url),
            Method::Post => self.client.post(url),
        }
        .timeout(timeout);
        for (name, value) in headers {
            builder = builder.header(name, value);
        }
        if let Some(json) = body {
            builder = builder.json(&json);
        }

        let response = builder.send().await.map_err(|err| {
            if err.is_timeout() {
                TransportError::Timeout
            } else {
                TransportError::Network
            }
        })?;

        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok());
        let text = response.text().await.map_err(|err| {
            if err.is_timeout() {
                TransportError::Timeout
            } else {
                TransportError::Network
            }
        })?;
        let body = serde_json::from_str(&text).unwrap_or_else(|_| {
            let clipped: String = text.chars().take(2_000).collect();
            Value::String(clipped)
        });

        Ok(HttpResponse {
            status,
            retry_after,
            body,
        })
    }
}
