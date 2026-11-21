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
        groq: { hasKey: mode !== "nokey", keyHint: "Y9k2", model: "llama-3.3-70b-versatile", baseUrl: "" },
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
    function fixture(payload) {
      payload = payload || {};
      var risk = String(payload.riskLevel || "not_verified").toLowerCase();
      var verified = payload.status === "verified" || payload.verified === true;
      var score = (typeof payload.score === "number") ? payload.score : null;
      if (risk === "high") {
        return {
          headline: "High-risk indicators found",
          summary: "Several strong phishing patterns are present.",
          explanation: "The rule-based scanner rated this item High" + (score != null ? " with a score of " + score : "") +
            ". Its strongest signals are the ones listed in the result card. Treat the item as hostile and avoid interacting with it. This overview only explains the scanner result and cannot change it.",
          tips: ["Do not open the link or reply to the message.", "Report and delete it, then verify through an official channel."]
        };
      }
      if (risk === "medium") {
        return {
          headline: "Some risk signals found",
          summary: "A few suspicious patterns were detected.",
          explanation: "The scanner rated this item Medium" + (score != null ? " with a score of " + score : "") +
            ". Some structure or wording resembles known phishing. Check the sender and destination independently before you trust it. The scanner verdict remains final.",
          tips: ["Verify the sender through a separate channel.", "Avoid entering credentials from a link in this item."]
        };
      }
      if (risk === "low" && verified) {
        return {
          headline: "No major indicators detected",
          summary: "The scanner rated this item Low risk and verified it.",
          explanation: "The rule-based scanner assessed this item and found few risk indicators" +
            (score != null ? " (score " + score + ")" : "") + ". That is not a guarantee: stay alert for unusual requests and check unexpected links before opening them.",
          tips: ["Confirm unexpected requests through a known contact.", "Keep the scanner verdict as the final decision."]
        };
      }
      return {
        headline: "This item could not be verified",
        summary: "The scanner did not reach a risk assessment.",
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
            var model = provider === "gemini" ? (p.model || "gemini-3.1-flash-lite") : (p.model || "llama-3.3-70b-versatile");
            if (mode === "error") { resolve({ ok: false, message: "The provider is busy. Try again later.", model: model }); return; }
            resolve({ ok: true, message: "Connection simulated in mock mode.", model: model });
          }, 700);
        });
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
            resolve({
              headline: fixture(request.payload).headline,
              summary: fixture(request.payload).summary,
              explanation: fixture(request.payload).explanation,
              tips: fixture(request.payload).tips,
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
    overview: overview,
    providerLabel: function (id) { return PROVIDER_LABEL[id] || id; },
    clearCache: function () { cache.clear(); },
    get backend() { return backendName(); }
  };
})();
