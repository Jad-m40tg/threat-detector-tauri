/* ===== TD.fx — automatic tier selection for theme switching ===== */
/* Rungs: reveal (Rung 1) -> cover (Rung 2) -> fade (Rung 3) -> instant. */
(function () {
  "use strict";
  window.TD = window.TD || {};
  var TIERS = ["reveal", "cover", "fade", "instant"];
  var KEY = "td.fx";
  var MAX_AGE = 2 * 60 * 60 * 1000; /* a stored downgrade expires after 2h */
  var tier = null;

  /* Follow-up fix: a stored downgrade used to stick FOREVER, so one bad
     burst (or one debugging session with forced tiers) left a device on
     instant switches permanently. Stored tiers now carry a timestamp and
     expire; a legacy plain-string entry (no timestamp) is a permanently
     stuck downgrade from the old format — ignore it and clean it up so
     affected devices self-heal on the first load after this update. */
  function readStored() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      if (raw.charAt(0) !== "{") { /* legacy format */
        localStorage.removeItem(KEY);
        return null;
      }
      var rec = JSON.parse(raw);
      if (!rec || TIERS.indexOf(rec.v) < 0 || typeof rec.t !== "string") {
        localStorage.removeItem(KEY);
        return null;
      }
      var age = Date.now() - parseInt(rec.t, 10);
      if (!(age >= 0) || age > MAX_AGE) {
        localStorage.removeItem(KEY);
        return null;
      }
      return rec.v;
    } catch (e) { return null; }
  }
  function writeStored(v) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: v, t: String(Date.now()) }));
    } catch (e) { /* in-memory only */ }
  }

  function fromQuery() {
    try {
      var m = /[?&]fx=(reveal|cover|fade|instant)/.exec(location.search || "");
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  function initialTier() {
    var q = fromQuery();
    if (q) return q;
    var stored = readStored();
    if (stored && TIERS.indexOf(stored) >= 0) return stored;
    /* low-end heuristic */
    var coarse = false;
    try { coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches; } catch (e) {}
    var lowEnd = false;
    try {
      if (navigator.deviceMemory && navigator.deviceMemory <= 4) lowEnd = true;
      if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) lowEnd = true;
    } catch (e) {}
    if (typeof document.startViewTransition !== "function") return "cover";
    if (coarse && lowEnd) return "cover";
    return "reveal";
  }

  tier = initialTier();

  function current() { return tier; }

  function downgrade() {
    var idx = TIERS.indexOf(tier);
    if (idx >= 0 && idx < TIERS.length - 1) {
      tier = TIERS[idx + 1];
      writeStored(tier);
      if (/[?&]perf/.test(location.search || "")) {
        console.log("[TD.fx] downgraded to", tier);
      }
    }
  }

  /* Measure a switch: returns {p95, max, tailP95, handoffMax} */
  function measure(frames, tailStart) {
    var sorted = frames.slice().sort(function (a, b) { return a - b; });
    var p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    var max = sorted.length ? sorted[sorted.length - 1] : 0;
    var tail = frames.slice(tailStart);
    var tailSorted = tail.slice().sort(function (a, b) { return a - b; });
    var tailP95 = tailSorted[Math.floor(tailSorted.length * 0.95)] || 0;
    var handoffMax = 0;
    /* handoff = last 3 frames of tail */
    for (var i = Math.max(0, frames.length - 3); i < frames.length; i++) {
      if (frames[i] > handoffMax) handoffMax = frames[i];
    }
    return { p95: p95, max: max, tailP95: tailP95, handoffMax: handoffMax };
  }

  function shouldDowngrade(m) {
    if (m.tailP95 > 33) return true;
    if (m.handoffMax > 50) return true;
    if (m.max > 50) return true;
    return false;
  }

  TD.fx = {
    tier: current,
    setTier: function (t) { if (TIERS.indexOf(t) >= 0) { tier = t; writeStored(tier); } },
    measure: measure,
    shouldDowngrade: shouldDowngrade,
    downgrade: downgrade,
    TIERS: TIERS
  };
})();