/* ===== TD.services.ai — AI overview service (mock | tauri) =====
   Never stores an API key in the front-end. Keys live only in the Rust
   backend config file; the mock adapter keeps fake key state in memory.
   Every failure is a typed {code, message, retryAfterSeconds} rejection. */
(function () {
  "use strict";
  window.TD = window.TD || {};
  TD.services = TD.services || {};

  var PROVIDER_LABEL = { groq: "Groq", gemini: "Google Gemini", custom: "Custom OpenAI-compatible" };
  var CACHE_MAX = 100;
  var cache = new Map();      /* cacheKey -> overview */
  var inflight = Object.create(null);
  var statusPromise = null;

  function makeError(code, message, retryAfterSeconds) {
    var err = new Error(message || "AI overview is unavailable.");
    err.code = code || "AllProvidersFailed";
    if (typeof retryAfterSeconds === "number") err.retryAfterSeconds = retryAfterSeconds;
    return err;
  }
  function normalizeError(raw) {
    var src = raw;
    if (typeof src === "string") {
      try { src = JSON.parse(src); } catch (e) { src = { message: raw }; }
    }
    if (src && typeof src === "object") {
      if (src.code) {
        return makeError(src.code, src.message, src.retryAfterSeconds);
      }
      return makeError("AllProvidersFailed", String(src.message || src || "AI overview is unavailable."));
    }
    return makeError("AllProvidersFailed", String(raw || "AI overview is unavailable."));
  }

  function backendName() {
    try { return (TD.config && TD.config.backend) || "mock"; } catch (e) { return "mock"; }
  }
  function mockMode() {
    try {
      var p = new URLSearchParams(window.location.search).get("aimock");
      return p || "ok";
    } catch (e) { return "ok"; }
  }

  /* ---------------- mock adapter ---------------- */
  function mockAdapter() {
    var mode = mockMode();
    var cfg = {
      consent: mode !== "nokey",
      providers: {
        groq: { hasKey: mode !== "nokey", keyHint: "Y9k2", model: "openai/gpt-oss-120b", baseUrl: "" },
        gemini: { hasKey: mode === "failover", keyHint: "m4Qa", model: "gemini-3.1-flash-lite", baseUrl: "" },
        custom: { hasKey: false, keyHint: "", model: "", baseUrl: "" }
      }
    };
    function providerStatus(id) {
      var p = cfg.providers[id];
      return {
        id: id,
        name: PROVIDER_LABEL[id],
        hasKey: p.hasKey,
        keyHint: p.keyHint,
        model: p.model,
        baseUrl: p.baseUrl,
        state: p.hasKey ? "ready" : "no_key",
        cooldownUntil: null
      };
    }
    function status() {
      var providers = [providerStatus("groq"), providerStatus("gemini"), providerStatus("custom")];
      var anyKey = providers.some(function (p) { return p.hasKey; });
      return {
        providers: providers,
        consentGiven: cfg.consent,
        available: cfg.consent && anyKey,
        mock: true
      };
    }
    function finding(level, text) { return { level: level, text: text }; }
    function fixture(payload) {
      payload = payload || {};
      if (payload.counts && typeof payload.counts === "object") {
        var c = payload.counts;
        var batchFindings = [];
        if ((c.high || 0) > 0) batchFindings.push(finding("high", "Most items match known phishing structure and should not be trusted."));
        if ((c.medium || 0) > 0) batchFindings.push(finding("medium", "Some items use wording or domains that deserve a closer look."));
        if ((c.notVerified || 0) > 0) batchFindings.push(finding("unverified", "Several items could not be fully assessed by the rules."));
        if ((c.low || 0) > 0) batchFindings.push(finding("low", "The remaining items fired few risk rules."));
        return {
          headline: "Batch scan overview",
          summary: "Counts and the strongest signals across the batch.",
          findings: batchFindings,
          explanation: "The batch was scanned with the same local rules as a single scan. The counts show how many items reached each risk level after the rules ran. Items that could not be verified are not safe; they simply reached no verdict. Use the per-item results when you need the exact reasons.",
          tips: ["Start with the high-risk items and do not open them.", "Retry unverified items with a full URL or plain message.", "Continue with medium items once the high ones are handled."]
        };
      }
      var risk = String(payload.riskLevel || "not_verified").toLowerCase();
      var verified = payload.status === "verified" || payload.verified === true;
      var score = (typeof payload.score === "number") ? payload.score : null;
      if (risk === "high") {
        return {
          headline: "High-risk indicators found",
          summary: "Several strong phishing patterns are present.",
          findings: [
            finding("high", "The destination and wording match common credential phishing."),
            finding("high", "Multiple independent rule signals fired on this item.")
          ],
          explanation: "The rule-based scanner rated this item High" + (score != null ? " with a score of " + score : "") +
            ". Its strongest signals are the ones listed in the result card. Treat the item as hostile and avoid interacting with it. This overview only explains the scanner result and cannot change it.",
          tips: ["Do not open the link or reply to the message.", "Report and delete it, then verify through an official channel."]
        };
      }
      if (risk === "medium") {
        return {
          headline: "Some risk signals found",
          summary: "A few suspicious patterns were detected.",
          findings: [finding("medium", "Some structure or wording resembles known phishing.")],
          explanation: "The scanner rated this item Medium" + (score != null ? " with a score of " + score : "") +
            ". Some structure or wording resembles known phishing. Check the sender and destination independently before you trust it. The scanner verdict remains final.",
          tips: ["Verify the sender through a separate channel.", "Avoid entering credentials from a link in this item."]
        };
      }
      if (risk === "low" && verified) {
        return {
          headline: "No major indicators detected",
          summary: "The scanner rated this item Low risk and verified it.",
          findings: [finding("low", "Few risk rules fired on the address or wording.")],
          explanation: "The rule-based scanner assessed this item and found few risk indicators" +
            (score != null ? " (score " + score + ")" : "") + ". That is not a guarantee: stay alert for unusual requests and check unexpected links before opening them.",
          tips: ["Confirm unexpected requests through a known contact.", "Keep the scanner verdict as the final decision."]
        };
      }
      return {
        headline: "This item could not be verified",
        summary: "The scanner did not reach a risk assessment.",
        findings: [finding("unverified", "No risk level was reached, so the item needs a manual check.")],
        explanation: "The item was Not Verified, so no Low or High judgement exists. This overview cannot fill that gap. Open the item only if you trust where it came from, and prefer a manual check over guessing.",
        tips: ["Treat an unverified item with caution.", "Use a full URL or a plain message when you retry."]
      };
    }
    function providerForMode() {
      if (mode === "failover") return { id: "gemini", label: PROVIDER_LABEL.gemini, model: cfg.providers.gemini.model };
      return { id: "groq", label: PROVIDER_LABEL.groq, model: cfg.providers.groq.model };
    }
    return {
      __name: "mock",
      status: function () { return Promise.resolve(status()); },
      saveSettings: function (opts) {
        opts = opts || {};
        if (opts.provider && cfg.providers[opts.provider]) {
          var p = cfg.providers[opts.provider];
          if (typeof opts.apiKey === "string" && opts.apiKey !== "") {
            p.hasKey = true;
            p.keyHint = opts.apiKey.slice(-4);
          }
          if (typeof opts.model === "string") p.model = opts.model;
          if (typeof opts.baseUrl === "string") p.baseUrl = opts.baseUrl;
        }
        if (typeof opts.consent === "boolean") cfg.consent = opts.consent;
        return Promise.resolve({ ok: true });
      },
      clearKey: function (provider) {
        if (cfg.providers[provider]) { cfg.providers[provider].hasKey = false; cfg.providers[provider].keyHint = ""; }
        return Promise.resolve({ ok: true });
      },
      testConnection: function (provider) {
        var p = cfg.providers[provider];
        return new Promise(function (resolve) {
          setTimeout(function () {
            if (!p || !p.hasKey) { resolve({ ok: false, message: "No key saved for this provider.", model: "" }); return; }
            var model = provider === "gemini" ? (p.model || "gemini-3.1-flash-lite") : (p.model || "openai/gpt-oss-120b");
            if (mode === "error") { resolve({ ok: false, message: "The provider is busy. Try again later.", model: model }); return; }
            resolve({ ok: true, message: "Connection simulated in mock mode.", model: model });
          }, 700);
        });
      },
      listModels: function (provider) {
        var p = cfg.providers[provider];
        if (!p || !p.hasKey) {
          return Promise.reject(makeError("NoKey", "No key saved for this provider."));
        }
        var lists = {
          groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "allam-2-7b", "llama-3.1-8b-instant"],
          gemini: ["gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-2.0-flash-lite"],
          custom: ["openai/gpt-4o-mini", "openai/gpt-4o", "llama-3.3-70b-versatile"]
        };
        var models = (lists[provider] || []).slice();
        if (p.model && models.indexOf(p.model) < 0) models.unshift(p.model);
        return Promise.resolve(models);
      },
      overview: function (request) {
        request = request || {};
        var delay = mode === "slow" ? 4200 : 900;
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            if (mode === "error") { reject(makeError("AllProvidersFailed", "AI overview is unavailable right now.")); return; }
            if (mode === "ratelimit") { reject(makeError("AllProvidersFailed", "All providers are busy. Try again in 45 s.", 45)); return; }
            if (mode === "nokey") { reject(makeError("NoKey", "Add a provider key in Settings to use the AI overview.")); return; }
            var chosen = providerForMode();
            var f = fixture(request.payload);
            if (mode === "longtext") {
              f.explanation = "The scanner reached its verdict by combining several independent string and structure checks. " +
                "The first checks look at the address or sender shape and compare it with patterns that commonly appear in phishing campaigns. " +
                "The next checks look at wording choices, urgency cues, and mismatched destinations that often signal an attempt to move you somewhere unexpected. " +
                "None of this changes the scanner verdict, which stays final no matter what this explanation says. " +
                "Treat the explanation as context for the verdict, not as a second opinion that can override it.";
              f.tips = [
                "Do not open the link or reply to the message.",
                "Report and delete it, then verify through an official channel.",
                "Check the sender address separately before you trust any request.",
                "Keep the scanner verdict as the final decision."
              ];
            }
            resolve({
              headline: f.headline,
              summary: f.summary,
              findings: f.findings,
              explanation: f.explanation,
              tips: f.tips,
              provider: chosen.id,
              providerName: chosen.label,
              model: chosen.model
            });
          }, delay);
        });
      }
    };
  }

  /* ---------------- tauri adapter ---------------- */
  function tauriAdapter() {
    var api = window.__TAURI__ || {};
    var core = api.core || {};
    var invoke = (typeof core.invoke === "function") ? core.invoke : null;
    function call(cmd, args) {
      if (!invoke) return Promise.reject(makeError("Disabled", "The AI backend is unavailable."));
      return invoke(cmd, args || {}).catch(function (err) { throw normalizeError(err); });
    }
    return {
      __name: "tauri",
      status: function () { return call("ai_get_status"); },
      saveSettings: function (opts) {
        return call("ai_save_settings", {
          patch: {
            provider: opts.provider || null,
            apiKey: opts.apiKey || null,
            baseUrl: (typeof opts.baseUrl === "string") ? opts.baseUrl : null,
            model: (typeof opts.model === "string") ? opts.model : null,
            consent: (typeof opts.consent === "boolean") ? opts.consent : null
          }
        });
      },
      clearKey: function (provider) { return call("ai_clear_key", { provider: provider }); },
      testConnection: function (provider) { return call("ai_test_connection", { provider: provider }); },
      listModels: function (provider) {
        return call("ai_list_models", { provider: provider }).then(function (res) {
          return (res && res.models) || [];
        });
      },
      overview: function (request) {
        return call("ai_overview", {
          request: { scope: request.scope, payload: request.payload }
        }).then(function (res) {
          res.providerName = PROVIDER_LABEL[res.provider] || res.provider;
          return res;
        });
      }
    };
  }

  var impl = null;
  function getImpl() {
    var name = backendName();
    if (impl && impl.__name === name) return impl;
    impl = (name === "tauri") ? tauriAdapter() : mockAdapter();
    return impl;
  }

  function getStatus(force) {
    if (force || !statusPromise) {
      statusPromise = getImpl().status().catch(function (err) {
        statusPromise = null;
        throw normalizeError(err);
      });
    }
    return statusPromise;
  }

  function cachePut(key, value) {
    if (!key) return;
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }

  function overview(request) {
    request = request || {};
    var key = request.cacheKey || null;
    if (key && cache.has(key)) return Promise.resolve(cache.get(key));
    if (key && inflight[key]) return inflight[key];
    var p = getImpl().overview(request).then(function (res) {
      cachePut(key, res);
      if (key) delete inflight[key];
      return res;
    }, function (err) {
      if (key) delete inflight[key];
      throw normalizeError(err);
    });
    if (key) inflight[key] = p;
    return p;
  }

  TD.services.ai = {
    getStatus: function () { return getStatus(false); },
    refreshStatus: function () { return getStatus(true); },
    saveSettings: function (opts) {
      return getImpl().saveSettings(opts || {}).then(function (res) {
        statusPromise = null;
        return res;
      });
    },
    clearKey: function (provider) {
      return getImpl().clearKey(provider).then(function (res) {
        statusPromise = null;
        return res;
      });
    },
    testConnection: function (provider) { return getImpl().testConnection(provider); },
    listModels: function (provider) {
      return getImpl().listModels(provider).catch(function (err) { throw normalizeError(err); });
    },
    overview: overview,
    providerLabel: function (id) { return PROVIDER_LABEL[id] || id; },
    clearCache: function () { cache.clear(); },
    get backend() { return backendName(); }
  };
})();
