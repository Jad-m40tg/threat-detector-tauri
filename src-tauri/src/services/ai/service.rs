//! Orchestration: settings, provider failover, cooldowns, daily caps, model
//! discovery, spacing between calls, and a small result cache.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tokio::sync::Mutex;

use super::config::{Config, ProviderConfig};
use super::parser::{enforce_consistency, parse_overview, ParsedOverview};
use super::prompt::build_user_prompt;
use super::providers::{self, AttemptError};
use super::transport::HttpTransport;
use super::types::{
    provider_name, AiError, AiStatus, Overview, OverviewRequest, ProviderStatus, SettingsPatch,
    TestResult, PROVIDER_CUSTOM, PROVIDER_IDS,
};

const CACHE_MAX: usize = 100;

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub attempt_timeout: Duration,
    pub total_budget: Duration,
    pub spacing: Duration,
    pub daily_cap: u32,
    pub max_providers: usize,
    pub cooldown_base_secs: u64,
    pub cooldown_max_secs: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            attempt_timeout: Duration::from_secs(8),
            total_budget: Duration::from_secs(15),
            spacing: Duration::from_secs(4),
            daily_cap: 100,
            max_providers: 2,
            cooldown_base_secs: 30,
            cooldown_max_secs: 300,
        }
    }
}

struct Inner {
    config: Config,
    invalid: HashSet<&'static str>,
    cooldown_until: HashMap<&'static str, Instant>,
    cooldown_secs: HashMap<&'static str, u64>,
    day: u64,
    counts: HashMap<&'static str, u32>,
    models: HashMap<&'static str, String>,
    bad_models: HashSet<&'static str>,
    last_attempt: Option<Instant>,
    cache: VecDeque<(u64, Overview)>,
}

impl Inner {
    fn new(config: Config) -> Self {
        Self {
            config,
            invalid: HashSet::new(),
            cooldown_until: HashMap::new(),
            cooldown_secs: HashMap::new(),
            day: today(),
            counts: HashMap::new(),
            models: HashMap::new(),
            bad_models: HashSet::new(),
            last_attempt: None,
            cache: VecDeque::new(),
        }
    }
}

pub struct AiService {
    transport: Arc<dyn HttpTransport>,
    config_path: PathBuf,
    limits: Limits,
    inner: Mutex<Inner>,
    call_lock: Mutex<()>,
}

impl AiService {
    pub fn new(transport: Arc<dyn HttpTransport>, config_path: PathBuf) -> Self {
        let config = Config::load(&config_path);
        Self {
            transport,
            config_path,
            limits: Limits::default(),
            inner: Mutex::new(Inner::new(config)),
            call_lock: Mutex::new(()),
        }
    }

    pub async fn get_status(&self) -> AiStatus {
        let mut inner = self.inner.lock().await;
        roll_day(&mut inner);
        build_status(&inner, self.limits.daily_cap)
    }

    pub async fn save_settings(&self, patch: SettingsPatch) -> Result<AiStatus, AiError> {
        {
            let mut guard = self.inner.lock().await;
            let inner = &mut *guard;
            if let Some(consent) = patch.consent {
                inner.config.consent = consent;
            }
            if let Some(provider) = patch.provider.as_deref() {
                let Inner {
                    config,
                    invalid,
                    cooldown_until,
                    cooldown_secs,
                    models,
                    bad_models,
                    cache,
                    ..
                } = inner;
                let cfg = config
                    .providers
                    .get_mut(provider)
                    .ok_or_else(|| AiError::new("BadResponse", "Unknown provider."))?;
                if let Some(key) = patch.api_key.as_deref() {
                    let key = key.trim();
                    cfg.api_key = if key.is_empty() {
                        None
                    } else {
                        Some(key.to_string())
                    };
                    invalid.remove(provider);
                    cooldown_until.remove(provider);
                    cooldown_secs.remove(provider);
                    models.remove(provider);
                    bad_models.remove(provider);
                    cache.clear();
                }
                if let Some(model) = patch.model.as_deref() {
                    let model = model.trim();
                    cfg.model = if model.is_empty() {
                        None
                    } else {
                        Some(model.to_string())
                    };
                    models.remove(provider);
                    bad_models.remove(provider);
                    cache.clear();
                }
                if let Some(base) = patch.base_url.as_deref() {
                    let base = base.trim().trim_end_matches('/');
                    cfg.base_url = if base.is_empty() {
                        None
                    } else {
                        Some(base.to_string())
                    };
                    cache.clear();
                }
            }
            inner
                .config
                .save(&self.config_path)
                .map_err(|_| AiError::new("Disabled", "Could not save AI settings."))?;
        }
        Ok(self.get_status().await)
    }

    pub async fn clear_key(&self, provider: &str) -> Result<(), AiError> {
        {
            let mut inner = self.inner.lock().await;
            let cfg = inner
                .config
                .providers
                .get_mut(provider)
                .ok_or_else(|| AiError::new("BadResponse", "Unknown provider."))?;
            cfg.api_key = None;
            inner.invalid.remove(provider);
            inner.cooldown_until.remove(provider);
            inner.cooldown_secs.remove(provider);
            inner.models.remove(provider);
            inner.bad_models.remove(provider);
            inner.cache.clear();
            inner
                .config
                .save(&self.config_path)
                .map_err(|_| AiError::new("Disabled", "Could not save AI settings."))?;
        }
        Ok(())
    }

    pub async fn test_connection(&self, provider: &str) -> TestResult {
        let cfg = {
            let inner = self.inner.lock().await;
            match inner.config.providers.get(provider) {
                Some(cfg) => cfg.clone(),
                None => return failed_test("Unknown provider."),
            }
        };
        if !cfg.has_key() {
            return failed_test("No key saved for this provider.");
        }
        if provider == PROVIDER_CUSTOM && providers::base_url(provider, &cfg).is_empty() {
            return failed_test("Set a base URL first.");
        }

        match providers::list_models(
            self.transport.as_ref(),
            provider,
            &cfg,
            self.limits.attempt_timeout,
        )
        .await
        {
            Ok(models) => {
                let usable: Vec<String> = models
                    .into_iter()
                    .filter(|model| providers::chat_capable(provider, model))
                    .collect();
                let saved = cfg
                    .model
                    .as_deref()
                    .map(str::trim)
                    .filter(|model| !model.is_empty());
                let model = match saved {
                    Some(model) if usable.iter().any(|item| item == model) => model.to_string(),
                    _ => providers::pick_model(provider, &usable)
                        .unwrap_or_else(|| providers::default_model(provider).to_string()),
                };
                if !model.is_empty() {
                    let mut inner = self.inner.lock().await;
                    inner.models.insert(provider_id(provider), model.clone());
                }
                if model.is_empty() {
                    return failed_test("No usable model was found.");
                }
                TestResult {
                    ok: true,
                    message: "Key accepted.".to_string(),
                    model,
                }
            }
            Err(AttemptError::Unauthorized) => {
                self.inner
                    .lock()
                    .await
                    .invalid
                    .insert(provider_id(provider));
                failed_test("The key was rejected by the provider.")
            }
            Err(AttemptError::RateLimited(_)) => {
                failed_test("The provider is busy. Try again later.")
            }
            Err(AttemptError::Timeout) | Err(AttemptError::Network) => {
                failed_test("Could not reach the provider.")
            }
            Err(_) => failed_test("The provider did not answer correctly."),
        }
    }

    /// Lists the chat-capable models this provider key can use.
    pub async fn list_models_for(&self, provider: &str) -> Result<Vec<String>, AiError> {
        let cfg = {
            let inner = self.inner.lock().await;
            inner
                .config
                .providers
                .get(provider)
                .cloned()
                .ok_or_else(|| AiError::new("BadResponse", "Unknown provider."))?
        };
        if !cfg.has_key() {
            return Err(AiError::no_key());
        }
        if provider == PROVIDER_CUSTOM && providers::base_url(provider, &cfg).is_empty() {
            return Err(AiError::new("BadResponse", "Set a base URL first."));
        }
        match providers::list_models(
            self.transport.as_ref(),
            provider,
            &cfg,
            self.limits.attempt_timeout,
        )
        .await
        {
            Ok(models) => {
                let usable: Vec<String> = models
                    .into_iter()
                    .filter(|model| providers::chat_capable(provider, model))
                    .collect();
                if usable.is_empty() {
                    return Err(AiError::new(
                        "BadResponse",
                        "No usable models were returned.",
                    ));
                }
                Ok(usable)
            }
            Err(AttemptError::Unauthorized) => {
                self.inner
                    .lock()
                    .await
                    .invalid
                    .insert(provider_id(provider));
                Err(AiError::new(
                    "Unauthorized",
                    "The key was rejected by the provider.",
                ))
            }
            Err(AttemptError::RateLimited(retry_after)) => {
                Err(AiError::all_failed(Some(retry_after.unwrap_or(60))))
            }
            Err(AttemptError::Timeout) => Err(AiError::new(
                "Timeout",
                "The provider did not answer in time.",
            )),
            Err(AttemptError::Network) => {
                Err(AiError::new("Network", "Could not reach the provider."))
            }
            Err(_) => Err(AiError::all_failed(None)),
        }
    }

    pub async fn overview(&self, request: OverviewRequest) -> Result<Overview, AiError> {
        if request.scope != "item" && request.scope != "batch" {
            return Err(AiError::new("BadResponse", "Unknown overview scope."));
        }
        if !request.payload.is_object() {
            return Err(AiError::new("BadResponse", "Missing overview payload."));
        }

        let cache_key = payload_hash(&request.scope, &request.payload);

        let candidates = {
            let mut inner = self.inner.lock().await;
            roll_day(&mut inner);
            if !inner.config.consent {
                return Err(AiError::consent());
            }
            let config = inner.config.clone();
            let mut candidates = Vec::new();
            let mut any_key = false;
            let mut states: Vec<SkipReason> = Vec::new();
            let now = Instant::now();
            for id in PROVIDER_IDS {
                let Some(cfg) = config.providers.get(id) else {
                    continue;
                };
                if !cfg.has_key() {
                    continue;
                }
                if id == PROVIDER_CUSTOM && providers::base_url(id, cfg).is_empty() {
                    continue;
                }
                any_key = true;
                if inner.invalid.contains(id) {
                    states.push(SkipReason::Invalid);
                    continue;
                }
                if inner.counts.get(id).copied().unwrap_or(0) >= self.limits.daily_cap {
                    states.push(SkipReason::Capped);
                    continue;
                }
                if let Some(until) = inner.cooldown_until.get(id) {
                    if *until > now {
                        states.push(SkipReason::Cooling(
                            until.saturating_duration_since(now).as_secs() + 1,
                        ));
                        continue;
                    }
                }
                candidates.push((id, cfg.clone()));
            }
            if !any_key {
                return Err(AiError::no_key());
            }
            if let Some((_, cached)) = inner.cache.iter().find(|(key, _)| *key == cache_key) {
                return Ok(cached.clone());
            }
            if candidates.is_empty() {
                return Err(classify_skips(&states));
            }
            candidates
        };

        let _call_guard = self.call_lock.lock().await;
        let wait = {
            let inner = self.inner.lock().await;
            inner
                .last_attempt
                .and_then(|last| self.limits.spacing.checked_sub(last.elapsed()))
        };
        if let Some(wait) = wait {
            tokio::time::sleep(wait).await;
        }

        let prompt = build_user_prompt(&request.scope, &request.payload);
        let risk = text_of(&request.payload, "riskLevel").unwrap_or("not_verified");
        let verdict = text_of(&request.payload, "status").unwrap_or("not_verified");
        let deadline = Instant::now() + self.limits.total_budget;
        let mut attempted = 0usize;
        let mut failures: Vec<AttemptError> = Vec::new();
        let mut budget_exhausted = false;

        for (id, cfg) in candidates {
            if attempted >= self.limits.max_providers || Instant::now() >= deadline {
                budget_exhausted = Instant::now() >= deadline;
                break;
            }
            if !self.provider_available(id).await {
                continue;
            }

            let mut model = match self.model_for(id, &cfg).await {
                Ok(model) => model,
                Err(AttemptError::Unauthorized) => {
                    self.inner.lock().await.invalid.insert(id);
                    failures.push(AttemptError::Unauthorized);
                    attempted += 1;
                    continue;
                }
                Err(err) => {
                    failures.push(err);
                    attempted += 1;
                    continue;
                }
            };

            if Instant::now() >= deadline {
                break;
            }
            {
                let mut inner = self.inner.lock().await;
                *inner.counts.entry(id).or_insert(0) += 1;
                inner.last_attempt = Some(Instant::now());
            }

            let mut retried = false;
            let mut model_retried = false;
            let outcome = loop {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    budget_exhausted = true;
                    break Err(AttemptError::Timeout);
                }
                let timeout = self.limits.attempt_timeout.min(remaining);
                let result =
                    providers::chat(self.transport.as_ref(), id, &cfg, &model, &prompt, timeout)
                        .await;
                match result {
                    Ok(text) => break Ok(text),
                    Err(AttemptError::ModelNotFound) if !model_retried => {
                        model_retried = true;
                        self.inner.lock().await.bad_models.insert(id);
                        match self.discover_model(id, &cfg).await {
                            Ok(fresh) => {
                                model = fresh;
                                continue;
                            }
                            Err(err) => break Err(err),
                        }
                    }
                    Err(err) if !retried && retryable(err) && Instant::now() < deadline => {
                        retried = true;
                        tokio::time::sleep(random_delay()).await;
                    }
                    Err(err) => break Err(err),
                }
            };

            match outcome {
                Ok(text) => {
                    let parsed = match parse_overview(&text) {
                        Ok(parsed) => parsed,
                        Err(_) => {
                            failures.push(AttemptError::BadResponse);
                            attempted += 1;
                            continue;
                        }
                    };
                    enforce_consistency(&parsed, risk, verdict)?;
                    let overview = into_overview(parsed, id, model);
                    let mut inner = self.inner.lock().await;
                    inner.cooldown_secs.remove(id);
                    inner.cooldown_until.remove(id);
                    cache_put(&mut inner, cache_key, overview.clone());
                    return Ok(overview);
                }
                Err(err) => {
                    attempted += 1;
                    self.record_failure(id, err).await;
                    failures.push(err);
                }
            }
        }

        let inner = self.inner.lock().await;
        if budget_exhausted {
            return Err(AiError::all_failed(None));
        }
        Err(classify_failures(&failures, &inner))
    }

    async fn provider_available(&self, id: &'static str) -> bool {
        let mut inner = self.inner.lock().await;
        roll_day(&mut inner);
        if inner.invalid.contains(id) {
            return false;
        }
        if inner.counts.get(id).copied().unwrap_or(0) >= self.limits.daily_cap {
            return false;
        }
        if let Some(until) = inner.cooldown_until.get(id) {
            if *until > Instant::now() {
                return false;
            }
        }
        true
    }

    async fn model_for(
        &self,
        id: &'static str,
        cfg: &ProviderConfig,
    ) -> Result<String, AttemptError> {
        let (override_bad, cached) = {
            let inner = self.inner.lock().await;
            (inner.bad_models.contains(id), inner.models.get(id).cloned())
        };
        if !override_bad {
            if let Some(model) = cfg
                .model
                .as_deref()
                .map(str::trim)
                .filter(|m| !m.is_empty())
            {
                return Ok(model.to_string());
            }
        }
        if let Some(model) = cached {
            return Ok(model);
        }
        self.discover_model(id, cfg).await
    }

    async fn discover_model(
        &self,
        id: &'static str,
        cfg: &ProviderConfig,
    ) -> Result<String, AttemptError> {
        match providers::list_models(
            self.transport.as_ref(),
            id,
            cfg,
            self.limits.attempt_timeout,
        )
        .await
        {
            Ok(models) => {
                let usable: Vec<String> = models
                    .into_iter()
                    .filter(|model| providers::chat_capable(id, model))
                    .collect();
                let chosen = providers::pick_model(id, &usable).or_else(|| {
                    providers::preferred_models(id)
                        .first()
                        .map(|model| (*model).to_string())
                });
                match chosen {
                    Some(model) => {
                        self.inner.lock().await.models.insert(id, model.clone());
                        Ok(model)
                    }
                    None => fallback_model(id),
                }
            }
            Err(AttemptError::Unauthorized) => Err(AttemptError::Unauthorized),
            Err(_) => fallback_model(id),
        }
    }

    async fn record_failure(&self, id: &'static str, err: AttemptError) {
        match err {
            AttemptError::Unauthorized => {
                self.inner.lock().await.invalid.insert(id);
            }
            AttemptError::RateLimited(retry_after) => {
                let secs = retry_after.unwrap_or(60).max(1);
                let mut inner = self.inner.lock().await;
                inner
                    .cooldown_until
                    .insert(id, Instant::now() + Duration::from_secs(secs));
            }
            AttemptError::Overloaded => {
                let mut inner = self.inner.lock().await;
                bump_cooldown(&mut inner, id, &self.limits);
            }
            AttemptError::Server
            | AttemptError::Timeout
            | AttemptError::Network
            | AttemptError::BadResponse
            | AttemptError::ModelNotFound => {}
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum SkipReason {
    Invalid,
    Capped,
    Cooling(u64),
}

fn classify_skips(states: &[SkipReason]) -> AiError {
    if states.is_empty() {
        return AiError::all_failed(None);
    }
    if states.iter().all(|s| matches!(s, SkipReason::Invalid)) {
        return AiError::new(
            "Unauthorized",
            "The saved provider key was rejected. Update it in Settings.",
        );
    }
    if states.iter().all(|s| matches!(s, SkipReason::Capped)) {
        return AiError::new(
            "DailyCap",
            "The local daily AI limit was reached. Try again tomorrow.",
        );
    }
    let mut cooling: Option<u64> = None;
    for state in states {
        if let SkipReason::Cooling(secs) = state {
            cooling = Some(cooling.map_or(*secs, |current| current.min(*secs)));
        }
    }
    AiError::all_failed(cooling)
}

fn classify_failures(failures: &[AttemptError], inner: &Inner) -> AiError {
    if failures.is_empty() {
        return AiError::all_failed(None);
    }
    if failures
        .iter()
        .all(|f| matches!(f, AttemptError::Unauthorized))
    {
        return AiError::new(
            "Unauthorized",
            "The saved provider key was rejected. Update it in Settings.",
        );
    }
    if failures.iter().all(|f| matches!(f, AttemptError::Timeout)) {
        return AiError::new("Timeout", "The AI provider did not answer in time.");
    }
    if failures.iter().all(|f| matches!(f, AttemptError::Network)) {
        return AiError::new("Network", "Could not reach the AI provider.");
    }
    if failures
        .iter()
        .all(|f| matches!(f, AttemptError::BadResponse | AttemptError::ModelNotFound))
    {
        return AiError::new(
            "BadResponse",
            "The AI provider returned an unusable answer. Check the model in Settings.",
        );
    }
    let mut retry: Option<u64> = None;
    for failure in failures {
        if let AttemptError::RateLimited(Some(secs)) = failure {
            retry = Some(retry.map_or(*secs, |current: u64| current.min(*secs)));
        }
    }
    for id in PROVIDER_IDS {
        if let Some(until) = inner.cooldown_until.get(id) {
            let secs = until.saturating_duration_since(Instant::now()).as_secs() + 1;
            retry = Some(retry.map_or(secs, |current| current.min(secs)));
        }
    }
    AiError::all_failed(retry)
}

fn retryable(err: AttemptError) -> bool {
    matches!(
        err,
        AttemptError::Timeout | AttemptError::Network | AttemptError::Server
    )
}

fn fallback_model(id: &str) -> Result<String, AttemptError> {
    let model = providers::default_model(id);
    if model.is_empty() {
        Err(AttemptError::BadResponse)
    } else {
        Ok(model.to_string())
    }
}

fn bump_cooldown(inner: &mut Inner, id: &'static str, limits: &Limits) -> u64 {
    let current = inner.cooldown_secs.get(id).copied().unwrap_or(0);
    let secs = if current == 0 {
        limits.cooldown_base_secs
    } else {
        (current.saturating_mul(2)).min(limits.cooldown_max_secs)
    };
    inner.cooldown_secs.insert(id, secs);
    inner
        .cooldown_until
        .insert(id, Instant::now() + Duration::from_secs(secs));
    secs
}

fn build_status(inner: &Inner, daily_cap: u32) -> AiStatus {
    let now = Instant::now();
    let mut providers = Vec::new();
    let mut any_key = false;
    for id in PROVIDER_IDS {
        let Some(cfg) = inner.config.providers.get(id) else {
            continue;
        };
        let has_key = cfg.has_key();
        any_key |= has_key;
        let state = if !has_key {
            "no_key"
        } else if inner.invalid.contains(id) {
            "invalid_key"
        } else if inner.counts.get(id).copied().unwrap_or(0) >= daily_cap {
            "daily_cap"
        } else if inner
            .cooldown_until
            .get(id)
            .map(|u| *u > now)
            .unwrap_or(false)
        {
            "cooling"
        } else {
            "ready"
        };
        let cooldown_until = inner.cooldown_until.get(id).and_then(|until| {
            if *until > now {
                Some(now_ms() + until.saturating_duration_since(now).as_millis() as u64)
            } else {
                None
            }
        });
        let model = if inner.bad_models.contains(id) {
            inner
                .models
                .get(id)
                .cloned()
                .unwrap_or_else(|| providers::default_model(id).to_string())
        } else {
            cfg.model
                .as_deref()
                .map(str::trim)
                .filter(|m| !m.is_empty())
                .map(str::to_string)
                .or_else(|| inner.models.get(id).cloned())
                .unwrap_or_else(|| providers::default_model(id).to_string())
        };
        let base_url = if id == PROVIDER_CUSTOM {
            providers::base_url(id, cfg)
        } else {
            String::new()
        };
        providers.push(ProviderStatus {
            id: id.to_string(),
            name: provider_name(id).to_string(),
            has_key,
            key_hint: if has_key {
                cfg.key_hint()
            } else {
                String::new()
            },
            model,
            base_url,
            state: state.to_string(),
            cooldown_until,
        });
    }
    AiStatus {
        providers,
        consent_given: inner.config.consent,
        available: inner.config.consent && any_key,
    }
}

fn into_overview(parsed: ParsedOverview, provider: &str, model: String) -> Overview {
    Overview {
        headline: parsed.headline,
        summary: parsed.summary,
        findings: parsed.findings,
        explanation: parsed.explanation,
        tips: parsed.tips,
        provider: provider.to_string(),
        model,
    }
}

fn cache_put(inner: &mut Inner, key: u64, overview: Overview) {
    inner.cache.retain(|(existing, _)| *existing != key);
    inner.cache.push_front((key, overview));
    while inner.cache.len() > CACHE_MAX {
        inner.cache.pop_back();
    }
}

fn failed_test(message: &str) -> TestResult {
    TestResult {
        ok: false,
        message: message.to_string(),
        model: String::new(),
    }
}

fn provider_id(provider: &str) -> &'static str {
    match provider {
        super::types::PROVIDER_GROQ => super::types::PROVIDER_GROQ,
        super::types::PROVIDER_GEMINI => super::types::PROVIDER_GEMINI,
        _ => super::types::PROVIDER_CUSTOM,
    }
}

fn text_of<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn roll_day(inner: &mut Inner) {
    let today = today();
    if inner.day != today {
        inner.day = today;
        inner.counts.clear();
    }
}

fn today() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn random_delay() -> Duration {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    Duration::from_millis(100 + u64::from(nanos % 200))
}

fn payload_hash(scope: &str, payload: &Value) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let body = payload.to_string();
    for byte in scope
        .bytes()
        .chain(std::iter::once(0u8))
        .chain(body.bytes())
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex as StdMutex;

    use serde_json::json;

    use super::*;
    use crate::services::ai::transport::{HttpResponse, Method, TransportError};
    use crate::services::ai::types::{
        PROVIDER_CUSTOM as CUSTOM, PROVIDER_GEMINI as GEMINI, PROVIDER_GROQ as GROQ,
    };

    #[derive(Clone)]
    enum Reply {
        Status {
            status: u16,
            retry_after: Option<u64>,
            body: Value,
        },
        Slow {
            millis: u64,
            status: u16,
        },
    }

    #[derive(Default)]
    struct Fake {
        script: StdMutex<VecDeque<Reply>>,
        calls: StdMutex<Vec<String>>,
        count: AtomicUsize,
    }

    impl Fake {
        fn with(script: Vec<Reply>) -> Self {
            Self {
                script: StdMutex::new(script.into()),
                ..Self::default()
            }
        }
    }

    fn ok_body(url: &str) -> Value {
        let content = r#"{"headline":"h","summary":"s","explanation":"e","tips":["t"]}"#;
        if url.contains("generativelanguage") {
            json!({ "candidates": [{ "content": { "parts": [{ "text": content }] } }] })
        } else {
            json!({ "choices": [{ "message": { "content": content } }] })
        }
    }

    #[async_trait::async_trait]
    impl HttpTransport for Fake {
        async fn request(
            &self,
            _method: Method,
            url: &str,
            _headers: Vec<(String, String)>,
            _body: Option<Value>,
            _timeout: Duration,
        ) -> Result<HttpResponse, TransportError> {
            self.count.fetch_add(1, Ordering::SeqCst);
            self.calls.lock().expect("lock").push(url.to_string());
            let reply = self.script.lock().expect("lock").pop_front();
            match reply {
                Some(Reply::Status {
                    status,
                    retry_after,
                    body,
                }) => Ok(HttpResponse {
                    status,
                    retry_after,
                    body,
                }),
                Some(Reply::Slow { millis, status }) => {
                    tokio::time::sleep(Duration::from_millis(millis)).await;
                    Ok(HttpResponse {
                        status,
                        retry_after: None,
                        body: json!({}),
                    })
                }
                None => Ok(HttpResponse {
                    status: 200,
                    retry_after: None,
                    body: ok_body(url),
                }),
            }
        }
    }

    fn cfg_with(ids: &[&str]) -> Config {
        let mut config = Config {
            consent: true,
            ..Config::default()
        };
        for id in ids {
            if let Some(cfg) = config.providers.get_mut(id) {
                cfg.api_key = Some(format!("key-{id}"));
                cfg.model = Some("test-model".into());
                if *id == CUSTOM {
                    cfg.base_url = Some("https://custom.example/v1".into());
                }
            }
        }
        config
    }

    fn test_service(fake: Arc<Fake>, config: Config, limits: Limits) -> AiService {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let id = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path =
            std::env::temp_dir().join(format!("td-ai-service-{}-{}.json", std::process::id(), id));
        let _ = std::fs::remove_file(&path);
        AiService {
            transport: fake,
            config_path: path,
            limits,
            inner: Mutex::new(Inner::new(config)),
            call_lock: Mutex::new(()),
        }
    }

    fn fast_limits() -> Limits {
        Limits {
            attempt_timeout: Duration::from_millis(500),
            total_budget: Duration::from_secs(2),
            spacing: Duration::ZERO,
            daily_cap: 100,
            max_providers: 2,
            cooldown_base_secs: 30,
            cooldown_max_secs: 300,
        }
    }

    fn item_payload(content: &str) -> Value {
        json!({
            "type": "url",
            "content": content,
            "riskLevel": "high",
            "status": "verified",
            "score": 80,
            "statusReason": "test",
            "rules": []
        })
    }

    fn request(content: &str) -> OverviewRequest {
        OverviewRequest {
            scope: "item".into(),
            payload: item_payload(content),
        }
    }

    #[tokio::test]
    async fn failover_moves_to_gemini_on_503() {
        let fake = Arc::new(Fake::with(vec![Reply::Status {
            status: 503,
            retry_after: None,
            body: json!({}),
        }]));
        let service = test_service(fake.clone(), cfg_with(&[GROQ, GEMINI]), fast_limits());
        let result = service
            .overview(request("https://evil.example"))
            .await
            .expect("gemini works");
        assert_eq!(result.provider, GEMINI);
        assert_eq!(result.model, "test-model");
        assert_eq!(fake.calls.lock().expect("lock").len(), 2);
        let status = service.get_status().await;
        let groq = status
            .providers
            .iter()
            .find(|p| p.id == GROQ)
            .expect("groq");
        assert_eq!(groq.state, "cooling");
    }

    #[tokio::test]
    async fn skips_without_key_and_without_consent() {
        let fake = Arc::new(Fake::default());
        let service = test_service(fake.clone(), cfg_with(&[]), fast_limits());
        assert_eq!(
            service
                .overview(request("x"))
                .await
                .expect_err("no key")
                .code,
            "NoKey"
        );

        let mut config = cfg_with(&[GROQ]);
        config.consent = false;
        let service = test_service(fake.clone(), config, fast_limits());
        assert_eq!(
            service
                .overview(request("x"))
                .await
                .expect_err("no consent")
                .code,
            "NoConsent"
        );
        assert_eq!(fake.calls.lock().expect("lock").len(), 0);
    }

    #[tokio::test]
    async fn stops_after_two_providers() {
        let fake = Arc::new(Fake::with(vec![
            Reply::Status {
                status: 500,
                retry_after: None,
                body: json!({}),
            },
            Reply::Status {
                status: 500,
                retry_after: None,
                body: json!({}),
            },
            Reply::Status {
                status: 500,
                retry_after: None,
                body: json!({}),
            },
            Reply::Status {
                status: 500,
                retry_after: None,
                body: json!({}),
            },
        ]));
        let service = test_service(
            fake.clone(),
            cfg_with(&[GROQ, GEMINI, CUSTOM]),
            fast_limits(),
        );
        let err = service.overview(request("x")).await.expect_err("all fail");
        assert_eq!(err.code, "AllProvidersFailed");
        let calls = fake.calls.lock().expect("lock");
        assert_eq!(calls.len(), 4);
        assert!(calls.iter().all(|url| !url.contains("custom.example")));
    }

    #[tokio::test]
    async fn total_budget_stops_the_chain() {
        let fake = Arc::new(Fake::with(vec![Reply::Slow {
            millis: 100,
            status: 500,
        }]));
        let limits = Limits {
            attempt_timeout: Duration::from_millis(200),
            total_budget: Duration::from_millis(120),
            spacing: Duration::ZERO,
            daily_cap: 100,
            max_providers: 3,
            cooldown_base_secs: 30,
            cooldown_max_secs: 300,
        };
        let service = test_service(fake.clone(), cfg_with(&[GROQ, GEMINI, CUSTOM]), limits);
        let err = service.overview(request("x")).await.expect_err("budget");
        assert_eq!(err.code, "AllProvidersFailed");
        assert_eq!(fake.calls.lock().expect("lock").len(), 1);
    }

    #[tokio::test]
    async fn caches_identical_payloads() {
        let fake = Arc::new(Fake::default());
        let service = test_service(fake.clone(), cfg_with(&[GROQ]), fast_limits());
        let first = service.overview(request("same")).await.expect("first");
        let second = service.overview(request("same")).await.expect("cached");
        assert_eq!(first.headline, second.headline);
        assert_eq!(fake.count.load(Ordering::SeqCst), 1);
        service
            .overview(request("different"))
            .await
            .expect("second call");
        assert_eq!(fake.count.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn daily_cap_is_reported() {
        let fake = Arc::new(Fake::default());
        let limits = Limits {
            daily_cap: 1,
            ..fast_limits()
        };
        let service = test_service(fake.clone(), cfg_with(&[GROQ]), limits);
        service.overview(request("one")).await.expect("first");
        let err = service.overview(request("two")).await.expect_err("cap");
        assert_eq!(err.code, "DailyCap");
    }

    #[tokio::test]
    async fn ratelimit_reports_retry_after() {
        let fake = Arc::new(Fake::with(vec![Reply::Status {
            status: 429,
            retry_after: Some(45),
            body: json!({}),
        }]));
        let service = test_service(fake.clone(), cfg_with(&[GROQ]), fast_limits());
        let err = service.overview(request("x")).await.expect_err("429");
        assert_eq!(err.code, "AllProvidersFailed");
        assert!(err.retry_after_seconds.unwrap_or(0) >= 44);
        let status = service.get_status().await;
        assert_eq!(status.providers[0].state, "cooling");
    }

    #[tokio::test]
    async fn unauthorized_marks_the_key_invalid() {
        let fake = Arc::new(Fake::with(vec![Reply::Status {
            status: 401,
            retry_after: None,
            body: json!({}),
        }]));
        let service = test_service(fake.clone(), cfg_with(&[GROQ]), fast_limits());
        let err = service.overview(request("x")).await.expect_err("401");
        assert_eq!(err.code, "Unauthorized");
        let status = service.get_status().await;
        assert_eq!(status.providers[0].state, "invalid_key");
    }

    #[tokio::test]
    async fn guard_rejects_safe_language_for_high() {
        let content =
            r#"{"headline":"Looks safe","summary":"No risk here.","explanation":"e","tips":["t"]}"#;
        let fake = Arc::new(Fake::with(vec![Reply::Status {
            status: 200,
            retry_after: None,
            body: json!({ "choices": [{ "message": { "content": content } }] }),
        }]));
        let service = test_service(fake.clone(), cfg_with(&[GROQ]), fast_limits());
        let err = service.overview(request("x")).await.expect_err("guard");
        assert_eq!(err.code, "Rejected");
    }

    #[test]
    fn cooldown_doubles_up_to_the_cap() {
        let mut inner = Inner::new(cfg_with(&[GROQ]));
        let limits = Limits::default();
        assert_eq!(bump_cooldown(&mut inner, GROQ, &limits), 30);
        assert_eq!(bump_cooldown(&mut inner, GROQ, &limits), 60);
        assert_eq!(bump_cooldown(&mut inner, GROQ, &limits), 120);
        assert_eq!(bump_cooldown(&mut inner, GROQ, &limits), 240);
        assert_eq!(bump_cooldown(&mut inner, GROQ, &limits), 300);
        assert_eq!(bump_cooldown(&mut inner, GROQ, &limits), 300);
    }

    #[tokio::test]
    async fn settings_persist_but_status_never_exposes_the_key() {
        let fake = Arc::new(Fake::default());
        let config = Config {
            consent: true,
            ..Config::default()
        };
        let service = test_service(fake, config, fast_limits());
        service
            .save_settings(SettingsPatch {
                provider: Some(GROQ.into()),
                api_key: Some("sk-secret-value-9876".into()),
                base_url: None,
                model: Some("llama-test".into()),
                consent: None,
            })
            .await
            .expect("save");

        let status = service.get_status().await;
        let serialized = serde_json::to_string(&status).expect("json");
        assert!(!serialized.contains("sk-secret-value-9876"));
        assert!(serialized.contains("9876"));
        let groq = status
            .providers
            .iter()
            .find(|p| p.id == GROQ)
            .expect("groq");
        assert_eq!(groq.model, "llama-test");
        assert!(groq.has_key);

        let reloaded = Config::load(&service.config_path);
        assert_eq!(
            reloaded.providers.groq.api_key.as_deref(),
            Some("sk-secret-value-9876")
        );
        let _ = std::fs::remove_file(&service.config_path);
    }

    #[tokio::test]
    async fn stale_model_rediscovers_and_retries_once() {
        let fake = Arc::new(Fake::with(vec![
            Reply::Status {
                status: 404,
                retry_after: None,
                body: json!({ "error": { "message": "model not found" } }),
            },
            Reply::Status {
                status: 200,
                retry_after: None,
                body: json!({
                    "data": [
                        { "id": "openai/gpt-oss-120b" },
                        { "id": "whisper-large-v3" }
                    ]
                }),
            },
        ]));
        let service = test_service(fake.clone(), cfg_with(&[GROQ]), fast_limits());
        let result = service
            .overview(request("https://evil.example"))
            .await
            .expect("rediscovered model works");
        assert_eq!(result.provider, GROQ);
        assert_eq!(result.model, "openai/gpt-oss-120b");
        {
            let calls = fake.calls.lock().expect("lock");
            assert_eq!(calls.len(), 3);
            assert!(calls[1].ends_with("/models"));
            assert!(calls[2].ends_with("/chat/completions"));
        }

        let status = service.get_status().await;
        let groq = status
            .providers
            .iter()
            .find(|p| p.id == GROQ)
            .expect("groq");
        assert_eq!(groq.model, "openai/gpt-oss-120b");
    }

    #[tokio::test]
    async fn list_models_keeps_only_chat_capable_entries() {
        let fake = Arc::new(Fake::with(vec![Reply::Status {
            status: 200,
            retry_after: None,
            body: json!({
                "data": [
                    { "id": "openai/gpt-oss-120b" },
                    { "id": "whisper-large-v3" },
                    { "id": "llama-3.1-8b-instant" }
                ]
            }),
        }]));
        let service = test_service(fake.clone(), cfg_with(&[GROQ]), fast_limits());
        let models = service.list_models_for(GROQ).await.expect("list");
        assert_eq!(models, vec!["openai/gpt-oss-120b", "llama-3.1-8b-instant"]);

        let no_key = test_service(fake, Config::default(), fast_limits());
        assert_eq!(
            no_key.list_models_for(GROQ).await.expect_err("no key").code,
            "NoKey"
        );
    }
}
