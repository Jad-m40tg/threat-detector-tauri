/* TDSettings — Threat Detector settings core (Task 3, contract §2.1). Agent A.
   Classic script (no modules, no defer/async), IIFE-wrapped: only window.TDSettings leaks.
   file://-safe: every localStorage access is try/caught with an in-memory Map fallback
   (privacy mode). Uses the literal td.* keys only — never touches the pre-existing dac_* keys. */
(function () {
  "use strict";

  var KEY_DEFS = {
    progressSpeed: {
      store: "td.progressSpeed",
      values: ["fast", "normal", "slow"],
      attr: "data-progress-speed",
      def: "normal"
    },
    /* navStyle canonical values: "ring" | "contrast". The second option was
       formerly labelled and stored as "invert"; stored "invert" values are still
       accepted and normalized on read (see LEGACY below), while writes always
       store the canonical value. */
    navStyle: {
      store: "td.navStyle",
      values: ["ring", "contrast"],
      attr: "data-nav-style",
      def: "ring"
    },
    aiMode: {
      store: "td.ai.mode",
      values: ["off", "click", "auto"],
      attr: "data-ai-mode",
      def: "auto"
    },
    /* Verdict shade overrides (Phase 1 — docs/VERDICT_COLORS.md). hex: true keys
       store a lowercase "#rrggbb" (or "" meaning "unset / back to default");
       def: null (absent key = default tint). Input normalization and validation
       happen in DAC.verdictShade (js/core/core.js) before set() is called. */
    "vs.light.high":       { store: "td.vs.light.high",       hex: true, def: null },
    "vs.light.medium":     { store: "td.vs.light.medium",     hex: true, def: null },
    "vs.light.low":        { store: "td.vs.light.low",        hex: true, def: null },
    "vs.light.unverified": { store: "td.vs.light.unverified", hex: true, def: null },
    "vs.dark.high":        { store: "td.vs.dark.high",        hex: true, def: null },
    "vs.dark.medium":      { store: "td.vs.dark.medium",      hex: true, def: null },
    "vs.dark.low":         { store: "td.vs.dark.low",         hex: true, def: null },
    "vs.dark.unverified":  { store: "td.vs.dark.unverified",  hex: true, def: null },
    /* Update button (dev "Update button" group). force: "true" | "false";
       animMs / width: integer strings within range; repo: "owner/name" or ""
       (empty = backend default). Read by js/services/updateService.js. */
    "upd.force":  { store: "td.upd.force",  bool: true, def: "false" },
    "upd.animMs": { store: "td.upd.animMs", num: { min: 150, max: 1500 }, def: "550" },
    "upd.width":  { store: "td.upd.width",  num: { min: 150, max: 320 }, def: "249" },
    "upd.repo":   { store: "td.upd.repo",   text: true, def: "" }
  };
  /* Higher multiplier = slower progress animation. Exact decimals. */
  var MULTIPLIER = { fast: 1.0, normal: 1.4, slow: 2.2 };
  var EVENT = "td:settings-change";

  var memStore = null;
  function mem() {
    if (!memStore) { memStore = new Map(); }
    return memStore;
  }

  function readRaw(storeKey) {
    var v = null;
    try {
      v = window.localStorage.getItem(storeKey);
      if (v !== null && typeof v !== "undefined") { return v; }
    } catch (e) { /* storage unavailable */ }
    try {
      return mem().has(storeKey) ? mem().get(storeKey) : null;
    } catch (e2) { return null; }
  }

  function writeRaw(storeKey, value) {
    try {
      window.localStorage.setItem(storeKey, value);
    } catch (e) { /* storage unavailable or quota */ }
    try {
      mem().set(storeKey, value);
    } catch (e2) { /* Map fallback unreachable */ }
  }

  var HEX_RE = /^#?[0-9a-f]{6}$/i;
  var INT_RE = /^\d+$/;
  function isValid(key, value) {
    var def = KEY_DEFS[key];
    if (!def || typeof value !== "string") { return false; }
    if (def.bool) { return value === "true" || value === "false"; }
    if (def.num) {
      if (!INT_RE.test(value)) { return false; }
      var n = parseInt(value, 10);
      return n >= def.num.min && n <= def.num.max;
    }
    if (def.text) { return value.length <= 120 && value.indexOf("\n") === -1; }
    if (def.hex) { return value === "" || HEX_RE.test(value); } /* "" = unset */
    return def.values.indexOf(value) !== -1;
  }

  /* Legacy stored values, mapped to their canonical replacement: pre-rename
     installs hold "invert" for navStyle (the option was then labelled Invert),
     so reads normalize it to "contrast" and writes store "contrast". Values not
     listed pass through untouched. */
  var LEGACY = {
    navStyle: { invert: "contrast" }
  };

  function normalize(key, value) {
    if (typeof value !== "string") { return value; }
    var map = LEGACY[key];
    return map && Object.prototype.hasOwnProperty.call(map, value) ? map[value] : value;
  }

  /* Validated current value; never throws, never returns raw corrupt data.
     A stored legacy value ("invert") reads back as its canonical replacement. */
  function current(key) {
    var def = KEY_DEFS[key];
    if (!def) { return undefined; /* unknown key: no default exists */ }
    var raw = normalize(key, readRaw(def.store));
    return isValid(key, raw) ? raw : def.def;
  }

  function applyAttr(key, value) {
    var def = KEY_DEFS[key];
    if (def && def.attr && document.documentElement) {
      document.documentElement.setAttribute(def.attr, value);
    }
  }

  function fire(key, value) {
    try {
      document.dispatchEvent(
        new CustomEvent(EVENT, { detail: { key: key, value: value }, bubbles: true }));
    } catch (e) {
      try {
        var ev = document.createEvent("CustomEvent");
        ev.initCustomEvent(EVENT, true, false, { key: key, value: value });
        document.dispatchEvent(ev);
      } catch (e2) { /* events unavailable */ }
    }
  }

  function get(key) {
    return current(key);
  }

  function set(key, value) {
    var def = KEY_DEFS[key];
    if (def && def.bool && typeof value === "boolean") { value = value ? "true" : "false"; }
    else if (def && def.num && typeof value === "number") { value = String(Math.round(value)); }
    var v = normalize(key, value); /* a legacy alias in → canonical value stored */
    if (!isValid(key, v)) { return false; /* no writes on invalid input */ }
    writeRaw(def.store, v);
    applyAttr(key, v);
    fire(key, v); /* exactly one event per successful set */
    return true;
  }

  function onChange(fn) {
    if (typeof fn !== "function") { return function () {}; }
    document.addEventListener(EVENT, fn);
    return function () { document.removeEventListener(EVENT, fn); };
  }

  function progressMultiplier() {
    var m = MULTIPLIER[current("progressSpeed")];
    return typeof m === "number" ? m : 1.4;
  }

  /* Initial load (script runs synchronously in <head>, before paint): apply stored
     values — or defaults when unset — to <html> data-* attributes. NO dispatch here:
     onChange subscribers attach later and must never observe initial-load application. */
  (function applyInitial() {
    for (var key in KEY_DEFS) {
      if (Object.prototype.hasOwnProperty.call(KEY_DEFS, key)) {
        applyAttr(key, current(key));
      }
    }
  })();

  window.TDSettings = {
    get: get,
    set: set,
    onChange: onChange,
    progressMultiplier: progressMultiplier
  };
})();
