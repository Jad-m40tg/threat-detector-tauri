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
    navStyle: {
      store: "td.navStyle",
      values: ["ring", "invert"],
      attr: "data-nav-style",
      def: "ring"
    }
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

  function isValid(key, value) {
    var def = KEY_DEFS[key];
    return !!def && typeof value === "string" && def.values.indexOf(value) !== -1;
  }

  /* Validated current value; never throws, never returns raw corrupt data. */
  function current(key) {
    var def = KEY_DEFS[key];
    if (!def) { return undefined; /* unknown key: no default exists */ }
    var raw = readRaw(def.store);
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
    if (!isValid(key, value)) { return false; /* no writes on invalid input */ }
    var def = KEY_DEFS[key];
    writeRaw(def.store, value);
    applyAttr(key, value);
    fire(key, value); /* exactly one event per successful set */
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
