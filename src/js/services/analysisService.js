/* ===== TD.services.analysis — analysis backend (mock/bridge/http/tauri) ===== */
/* Backend agent, Wave 2. Exposes TD.services.analysis with normalizeResult,
   AbortController + 429/5xx -> NOT_VERIFIED in the http adapter, and lifecycle
   events via TD.events (analysis:item-start/done, analysis:batch-start/done). */
(function () {
  "use strict";
  window.TD = window.TD || {};
  TD.services = TD.services || {};

  /* --- normalizeResult: failure/timeout/unknown -> NOT_VERIFIED, never LOW/"safe" --- */
  function normalizeResult(raw) {
    var r = (raw && typeof raw === "object") ? raw : {};
    var state = String(r.state || r.risk || r.verdict || "").toUpperCase();
    if (state === "LOW" || state === "SAFE" || state === "OK" || state === "CLEAN") state = "SAFE";
    else if (state === "HIGH" || state === "MEDIUM" || state === "THREAT" || state === "DANGER") state = "THREAT";
    else if (state === "UNVERIFIED" || state === "UNKNOWN") state = "NOT_VERIFIED";
    else if (state === "ERROR" || state === "TIMEOUT" || state === "FAILED" ||
             state === "ABORTED" || state === "CANCELLED") state = "NOT_VERIFIED";
    else if (state !== "THREAT" && state !== "SAFE" && state !== "NOT_VERIFIED") state = "NOT_VERIFIED";
    /* hard guard: never collapse unknown into SAFE */
    if (state === "LOW") state = "NOT_VERIFIED";
    return {
      id: (r.id != null) ? r.id : null,
      input: (r.input != null) ? r.input : (r.url || r.text || null),
      state: state,
      risk: (state === "THREAT") ? (r.risk || "high")
            : (state === "SAFE" ? "low" : "na"),
      score: (typeof r.score === "number") ? r.score : null,
      reasons: Array.isArray(r.reasons) ? r.reasons : [],
      action: r.action || null,
      error: r.error || null,
      timestamp: r.timestamp || Date.now()
    };
  }

  function backendName() {
    try { return (TD.config && TD.config.backend) || "mock"; } catch (e) { return "mock"; }
  }

  /* --- mock adapter --- */
  function mockAdapter() {
    return {
      __name: "mock",
      analyze: function (input, opts) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            var low = /safe|example\.com/i.test(String(input || ""));
            resolve(normalizeResult({
              input: input, state: low ? "SAFE" : "THREAT",
              risk: low ? "low" : "high", score: low ? 12 : 88,
              reasons: low ? ["No heuristic hits"] : ["Heuristic hit"],
              action: low ? "No action needed" : "Do not interact",
              timestamp: Date.now()
            }));
          }, 40);
        });
      },
      analyzeBatch: function (inputs, opts) {
        var self = this;
        return Promise.all((inputs || []).map(function (x) { return self.analyze(x, opts); }));
      },
      abort: function () {}
    };
  }

  /* --- bridge adapter (Java side via TD.bridge.receive) --- */
  function bridgeAdapter() {
    var pending = Object.create(null);
    var counter = 0;
    if (TD.events && typeof TD.events.on === "function") {
      TD.events.on("analysis:result", function (res) {
        var n = normalizeResult(res);
        var key = (res && (res.requestId != null ? res.requestId : res.id));
        var cb = pending[key];
        if (typeof cb === "function") { cb(n); delete pending[key]; }
      });
    }
    return {
      __name: "bridge",
      analyze: function (input, opts) {
        return new Promise(function (resolve) {
          var rid = "req-" + (++counter);
          pending[rid] = resolve;
          TD.bridge.send({ type: "analysis:request", requestId: rid, input: input, opts: opts || {} });
          var timeoutMs = (opts && opts.timeoutMs) || 15000;
          setTimeout(function () {
            if (pending[rid]) { delete pending[rid]; resolve(normalizeResult({ input: input, state: "TIMEOUT" })); }
          }, timeoutMs);
        });
      },
      analyzeBatch: function (inputs, opts) {
        var self = this;
        return Promise.all((inputs || []).map(function (x) { return self.analyze(x, opts); }));
      },
      abort: function () {}
    };
  }

  /* --- http adapter (AbortController + 429/5xx -> NOT_VERIFIED) --- */
  function httpAdapter() {
    var controllers = [];
    function fetchOne(input, opts) {
      opts = opts || {};
      var ctrl = (typeof AbortController === "function") ? new AbortController() : null;
      if (ctrl) controllers.push(ctrl);
      var url = (TD.config && TD.config.httpEndpoint) || "/api/analyze";
      var timeoutMs = opts.timeoutMs || 15000;
      var timer = null;
      return new Promise(function (resolve) {
        function finish(res) { if (timer) clearTimeout(timer); resolve(normalizeResult(res)); }
        if (ctrl) {
          timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} finish({ input: input, state: "TIMEOUT" }); }, timeoutMs);
        }
        var fetchFn = (typeof fetch === "function") ? fetch : null;
        if (!fetchFn) { finish({ input: input, state: "ERROR", error: "no fetch" }); return; }
        fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: input }),
          signal: ctrl ? ctrl.signal : undefined
        }).then(function (resp) {
          if (resp.status === 429 || resp.status >= 500) {
            finish({ input: input, state: "NOT_VERIFIED", error: "HTTP " + resp.status });
            return null;
          }
          if (!resp.ok) {
            finish({ input: input, state: "NOT_VERIFIED", error: "HTTP " + resp.status });
            return null;
          }
          return resp.json();
        }).then(function (data) {
          if (data) finish(data);
        }).catch(function (err) {
          var msg = (err && err.name === "AbortError") ? "TIMEOUT" : "ERROR";
          finish({ input: input, state: msg, error: String(err && err.message || err) });
        });
      });
    }
    return {
      __name: "http",
      analyze: fetchOne,
      analyzeBatch: function (inputs, opts) {
        var self = this;
        return Promise.all((inputs || []).map(function (x) { return self.analyze(x, opts); }));
      },
      abort: function () {
        controllers.forEach(function (c) { try { c.abort(); } catch (e) {} });
        controllers = [];
      }
    };
  }

  /* --- tauri adapter (Rust backend via window.__TAURI__) ---
     The backend already delivers the frozen IPC shape (docs/IPC_CONTRACT.md),
     including the NotVerified invariants, so results pass through WITHOUT the
     lossy normalizeResult pass. Batch lifecycle arrives as backend events,
     republished here onto TD.events for the pages. */
  function tauriAdapter() {
    var api = window.__TAURI__ || {};
    var core = api.core || {};
    var evt = api.event || {};
    var invoke = (typeof core.invoke === "function") ? core.invoke : null;
    var listen = (typeof evt.listen === "function") ? evt.listen : null;
    var currentBatchId = null;

    function republish(name) {
      listen(name, function (e) {
        if (name === "analysis:batch-done") currentBatchId = null;
        if (TD.events) TD.events.emit(name, e && e.payload);
      });
    }
    if (listen) {
      republish("analysis:item-start");
      republish("analysis:item-done");
      republish("analysis:progress");
      republish("analysis:batch-done");
    }

    function call(cmd, args) {
      if (!invoke) return Promise.reject(new Error("Tauri IPC is unavailable"));
      return invoke(cmd, args);
    }
    function rememberBatch(info) {
      currentBatchId = (info && info.batchId) ? info.batchId : null;
      return info;
    }

    return {
      __name: "tauri",
      analyze: function (input, opts) {
        return call("analyze_item", {
          request: {
            id: (opts && opts.id) || null,
            inputType: (opts && opts.inputType) || null,
            content: String(input == null ? "" : input)
          }
        });
      },
      analyzeBatch: function (inputs, opts) {
        var self = this;
        return Promise.all((inputs || []).map(function (x) { return self.analyze(x, opts); }));
      },
      pickCsvFile: function () { return call("pick_csv", {}); },
      analyzeCsvFile: function (path, options) {
        return call("analyze_csv", { path: path, options: options || null }).then(rememberBatch);
      },
      analyzeCsvContent: function (name, content, options) {
        return call("analyze_csv_content", { name: name, content: content, options: options || null }).then(rememberBatch);
      },
      cancelBatch: function () {
        if (!currentBatchId) return Promise.resolve(false);
        return call("cancel_batch", { batchId: currentBatchId });
      },
      abort: function () {}
    };
  }

  function getImpl() {
    var name = backendName();
    if (impl && impl.__name === name) return impl;
    if (name === "bridge") impl = bridgeAdapter();
    else if (name === "http") impl = httpAdapter();
    else if (name === "tauri") impl = tauriAdapter();
    else impl = mockAdapter();
    impl.__name = name;
    return impl;
  }
  var impl = null;

  function withEvents(fnName) {
    return function (input, opts) {
      var i = getImpl();
      if (TD.events) TD.events.emit("analysis:item-start", { input: input });
      return i[fnName](input, opts).then(function (res) {
        if (TD.events) TD.events.emit("analysis:item-done", { input: input, result: res });
        return res;
      });
    };
  }

  TD.services.analysis = {
    analyze: withEvents("analyze"),
    analyzeBatch: function (inputs, opts) {
      if (TD.events) TD.events.emit("analysis:batch-start", { count: (inputs || []).length });
      var i = getImpl();
      return i.analyzeBatch(inputs, opts).then(function (results) {
        if (TD.events) TD.events.emit("analysis:batch-done", { count: results.length, results: results });
        return results;
      });
    },
    abort: function () { var i = getImpl(); if (i.abort) i.abort(); },
    /* Tauri-only streaming CSV API (decision D7); safe no-ops elsewhere. */
    pickCsvFile: function () {
      var i = getImpl();
      return i.pickCsvFile ? i.pickCsvFile() : Promise.resolve(null);
    },
    analyzeCsvFile: function (path, options) {
      var i = getImpl();
      return i.analyzeCsvFile ? i.analyzeCsvFile(path, options)
        : Promise.reject(new Error("CSV batch requires the Tauri backend"));
    },
    analyzeCsvContent: function (name, content, options) {
      var i = getImpl();
      return i.analyzeCsvContent ? i.analyzeCsvContent(name, content, options)
        : Promise.reject(new Error("CSV batch requires the Tauri backend"));
    },
    cancelBatch: function () {
      var i = getImpl();
      return i.cancelBatch ? i.cancelBatch() : Promise.resolve(false);
    },
    get backend() { return backendName(); }
  };

  TD.utils = TD.utils || {};
  TD.utils.normalizeResult = normalizeResult;
})();