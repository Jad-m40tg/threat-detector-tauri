/* ===== TD.config — backend selector (Backend agent, Wave 2) ===== */
/* Single source of truth for which adapter the TD.services.* use.
   Auto-detects the Tauri backend when window.__TAURI__ is present (desktop app);
   defaults to "mock" otherwise (browser/file:// preview). An explicit override
   always wins: localStorage "td_backend" or set TD.config.backend before the
   service modules load. Values: "mock" | "bridge" | "http" | "tauri". */
(function () {
  "use strict";
  window.TD = window.TD || {};
  var cfg = { backend: "mock", httpEndpoint: "/api/analyze" };
  var tauri = window.__TAURI__;
  if (tauri && tauri.core && typeof tauri.core.invoke === "function") {
    cfg.backend = "tauri";
  }
  try {
    var stored = null;
    try { stored = localStorage.getItem("td_backend"); } catch (e) { stored = null; }
    if (stored === "mock" || stored === "bridge" || stored === "http" || stored === "tauri") {
      cfg.backend = stored;
    }
  } catch (e) { /* storage unavailable */ }
  TD.config = cfg;
})();
