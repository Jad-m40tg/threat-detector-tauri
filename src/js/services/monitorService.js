/* ===== TD.services.monitor — Hardware Monitor service (adapter selector) ===== */
/* Owner: Monitor agent. Depends on: window.TD. Exposes: TD.services.monitor. */
/* Service contract (JSDoc, per brief):
   TD.services.monitor = {
     subscribe(callback) -> unsubscribe   // callback(snapshot), pushes ~1 Hz while visible
     getSnapshot() -> Snapshot
     startDemoWorkload(taskCount)          // simulated worker load for the thread panel
   }
   Snapshot shape: {
     timestamp: number,
     cpu:     { total: number, perCore: number[] },
     memory:  { usedMB, totalMB, heapUsedMB, heapMaxMB },
     threadPool: { size, active, queued, completed,
                   workers: [{ id, name, state: "RUNNING"|"IDLE"|"WAITING",
                               taskId, progress, elapsedMs }] }
   }
   TD.config.backend picks the adapter ("mock" | "bridge" | "http"); default "mock".
   The bridge/http adapters are intentionally inactive stubs — see the comment blocks
   and docs/BACKEND_INTEGRATION.md (Backend agent, Wave 2). */
(function () {
  "use strict";
  window.TD = window.TD || {};
  TD.services = TD.services || {};

  function backendName() {
    try {
      var c = (window.TD && TD.config && TD.config.backend) || "mock";
      return c;
    } catch (e) { return "mock"; }
  }

  /* ---- bridge adapter (INACTIVE stub): real values would arrive from the Java
     side via TD.bridge.receive(jsonString) -> TD.events "monitor:snapshot".
     When the native shell exists, replace this body with a subscriber that
     caches the latest pushed snapshot; subscribe() forwards to TD.events. */
  function bridgeAdapter() {
    return {
      subscribe: function (cb) {
        /* TODO(Backend agent): wire to TD.events.on("monitor:snapshot", cb) */
        if (TD.events && typeof TD.events.on === "function") {
          return TD.events.on("monitor:snapshot", cb);
        }
        return function () {};
      },
      getSnapshot: function () { return null; }, /* last pushed snapshot */
      startDemoWorkload: function () { /* no demo in bridge mode */ }
    };
  }

  /* ---- http adapter (INACTIVE stub): would poll a local REST endpoint with
     AbortController + timeout and map 429/5xx/network errors to NOT_VERIFIED-
     style degraded snapshots. No network call is made unless selected. */
  function httpAdapter() {
    return {
      subscribe: function (cb) {
        /* TODO(Backend agent): fetch loop, AbortController, backoff on 429/5xx */
        return function () {};
      },
      getSnapshot: function () { return null; },
      startDemoWorkload: function () { /* no demo in http mode */ }
    };
  }

  var impl = null;
  Object.defineProperty(TD.services, "monitor", {
    get: function () {
      if (!impl || impl.__name !== backendName()) {
        var name = backendName();
        if (name === "bridge") { impl = bridgeAdapter(); }
        else if (name === "http") { impl = httpAdapter(); }
        else { impl = TD.services.mockMonitorService; }
        impl.__name = name;
      }
      return impl;
    },
    configurable: true
  });
})();
