/* ===== TD.bridge — native-shell bridge entry point (Backend agent, Wave 2) ===== */
/* TD.bridge.receive(jsonString) parses a JSON message from the Java side and
   re-emits it through TD.events. TD.bridge.send(obj) posts to the native shell
   when present (no-op in the browser). */
(function () {
  "use strict";
  window.TD = window.TD || {};
  TD.bridge = TD.bridge || {};
  TD.bridge.receive = function (jsonString) {
    var payload = null;
    try { payload = JSON.parse(jsonString); } catch (e) { return false; }
    if (!payload || typeof payload !== "object") return false;
    var type = payload.type || payload.event || null;
    if (type) {
      if (TD.events) TD.events.emit(type, payload);
      if (type === "monitor:snapshot" || payload.snapshot) {
        if (TD.events) TD.events.emit("monitor:snapshot", payload.snapshot || payload);
      }
      if (payload.result) {
        if (TD.events) TD.events.emit("analysis:result", payload.result);
      }
    }
    return true;
  };
  TD.bridge.send = function (obj) {
    try {
      if (window.__tdNative && typeof window.__tdNative.post === "function") {
        window.__tdNative.post(JSON.stringify(obj));
      }
    } catch (e) { /* no native shell */ }
  };
})();