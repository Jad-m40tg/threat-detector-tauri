/* ===== TD.config — backend selector (Backend agent, Wave 2) ===== */
/* Single source of truth for which adapter the TD.services.* use.
   Default "mock". Override via localStorage "td_backend" or set TD.config.backend
   before the service modules load. Values: "mock" | "bridge" | "http". */
(function () {
  "use strict";
  window.TD = window.TD || {};
  var cfg = { backend: "mock", httpEndpoint: "/api/analyze" };
  try {
    var stored = null;
    try { stored = localStorage.getItem("td_backend"); } catch (e) { stored = null; }
    if (stored === "mock" || stored === "bridge" || stored === "http") {
      cfg.backend = stored;
    }
  } catch (e) { /* storage unavailable */ }
  TD.config = cfg;
})();