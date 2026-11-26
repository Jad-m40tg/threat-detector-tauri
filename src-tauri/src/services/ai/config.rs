//! Provider settings persisted in the Tauri app config directory.
//!
//! The config file lives outside the repository and is written as plain JSON.
//! It contains API keys in plain text (the profile directory is user-scoped);
//! a future improvement is to move keys into the OS credential store. Keys are
//! never logged and never returned to the front-end (only the last four
//! characters as a hint).

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::types::{PROVIDER_CUSTOM, PROVIDER_GEMINI, PROVIDER_GROQ};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProviderConfig {
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
}

impl ProviderConfig {
    pub fn has_key(&self) -> bool {
        self.api_key
            .as_deref()
            .map(|k| !k.trim().is_empty())
            .unwrap_or(false)
    }

    pub fn key_hint(&self) -> String {
        let key = self.api_key.as_deref().unwrap_or("").trim();
        let tail: String = key
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        tail
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProvidersConfig {
    pub groq: ProviderConfig,
    pub gemini: ProviderConfig,
    pub custom: ProviderConfig,
}

impl ProvidersConfig {
    pub fn get(&self, id: &str) -> Option<&ProviderConfig> {
        match id {
            PROVIDER_GROQ => Some(&self.groq),
            PROVIDER_GEMINI => Some(&self.gemini),
            PROVIDER_CUSTOM => Some(&self.custom),
            _ => None,
        }
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut ProviderConfig> {
        match id {
            PROVIDER_GROQ => Some(&mut self.groq),
            PROVIDER_GEMINI => Some(&mut self.gemini),
            PROVIDER_CUSTOM => Some(&mut self.custom),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub consent: bool,
    pub providers: ProvidersConfig,
}

impl Config {
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let bytes = serde_json::to_vec_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        fs::write(path, bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_no_key_in_status_hint() {
        let dir = std::env::temp_dir().join(format!("td-ai-cfg-{}", std::process::id()));
        let path = dir.join("ai.json");
        let mut cfg = Config {
            consent: true,
            ..Config::default()
        };
        cfg.providers.groq.api_key = Some("secret-value-1234".into());
        cfg.providers.groq.model = Some("llama-x".into());
        cfg.save(&path).expect("save");

        let loaded = Config::load(&path);
        assert!(loaded.consent);
        assert_eq!(loaded.providers.groq.key_hint(), "1234");
        assert_eq!(loaded.providers.groq.model.as_deref(), Some("llama-x"));

        let _ = fs::remove_dir_all(&dir);
    }
}
