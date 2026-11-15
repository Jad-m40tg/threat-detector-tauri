
/* ===== DAC SHARED CORE (JS) 1/3 — namespace, storage, settings, shell, ui — identical on all pages ===== */
/* OWNER: Agent A (Core). window.DAC per CONTRACT §6/§14. Single IIFE, ES2019,
   no cross-file top-level calls (engine.js/visuals.js call DAC.* only in functions). */
(function () {
  "use strict";

  var DAC = {};

  /* ======================= storage (namespaced, safe) ======================= */
  /* All app keys pass through addPrefix ("settings" -> "dac_settings").
     try/catch everywhere; failures fall back to an in-memory map (private
     modes, file:// restrictions, quota errors). */
  var MEM = {};

  function addPrefix(key) { return "dac_" + String(key); }

  function clone(value) {
    return value === null || value === undefined
      ? value
      : JSON.parse(JSON.stringify(value));
  }

  DAC.storage = {
    get: function (key, fallback) {
      var pk = addPrefix(key);
      var raw = null;
      try { raw = window.localStorage.getItem(pk); } catch (e) { raw = null; }
      if (raw === null || raw === undefined) {
        return Object.prototype.hasOwnProperty.call(MEM, pk) ? clone(MEM[pk]) : fallback;
      }
      try { return JSON.parse(raw); } catch (e2) { return raw; }
    },
    set: function (key, value) {
      var pk = addPrefix(key);
      try {
        window.localStorage.setItem(pk, JSON.stringify(value));
        delete MEM[pk];
      } catch (e) { MEM[pk] = clone(value); }
      return value;
    },
    remove: function (key) {
      var pk = addPrefix(key);
      try { window.localStorage.removeItem(pk); } catch (e) { /* ignore */ }
      delete MEM[pk];
    }
  };

  /* ============================ settings ============================ */
  /* Identifier values only; defaults per CONTRACT §8. */
  var DEFAULTS = {
    theme: "system",
    darkBg: "oled",
    accent: "green",
    textSize: "medium",
    density: "comfortable",
    reduceAnimations: false,
    showHero: true,
    sensitivity: "balanced",
    detectors: {
      httpInsecure: true,
      urgentLanguage: true,
      credentialRequests: true,
      ipHostname: true,
      shorteners: true,
      lookalikes: true
    },
    trustedDomains: ["google.com", "developer.mozilla.org", "github.com"],
    blockedDomains: ["bank-security.example", "prize-claim.example", "secure-login.example"],
    defaultInputMode: "single",
    scanSpeed: "normal",
    autoOpenDetails: true,
    maxCsvEntries: 5000,
    resultTiming: "fixed",
    saveHistory: true,
    autoDeleteDays: "never",
    maskSensitive: false,
    notifyHighRisk: true,
    soundAlert: true,      /* stored only (SPEC §9) */
    dailySummary: false,   /* stored only */
    timeFormat: "12h"
  };

  function isObject(v) {
    return v !== null && typeof v === "object" && !(v instanceof Array);
  }

  function deepMerge(base, patch) {
    var out = base === undefined ? undefined : clone(base);
    if (!isObject(patch)) return out === undefined ? clone(patch) : out;
    var merged = isObject(out) ? out : {};
    for (var k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      if (isObject(patch[k])) {
        merged[k] = isObject(merged[k]) ? deepMerge(merged[k], patch[k]) : deepMerge({}, patch[k]);
      } else {
        merged[k] = clone(patch[k]);
      }
    }
    return merged;
  }

  var state = (function () {
    var stored = DAC.storage.get("settings", null);
    if (isObject(stored)) return deepMerge(DEFAULTS, stored);
    return clone(DEFAULTS);
  })();

  var listeners = [];
  var APPEARANCE_KEYS = {
    theme: 1, darkBg: 1, accent: 1, textSize: 1, density: 1, reduceAnimations: 1
  };

  function notify(key, value) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](key, value); } catch (e) { /* listener errors are isolated */ }
    }
  }

  DAC.settings = {
    get: function (key) {
      if (!Object.prototype.hasOwnProperty.call(state, key)) return undefined;
      return clone(state[key]);
    },
    all: function () { return clone(state); },
    set: function (key, value) {
      if (key === null || key === undefined) return clone(state);
      if (isObject(value) && isObject(state[key])) {
        state[key] = deepMerge(state[key], value); /* e.g. detectors:{httpInsecure:false} keeps siblings */
      } else {
        state[key] = clone(value);
      }
      DAC.storage.set("settings", clone(state));
      if (Object.prototype.hasOwnProperty.call(APPEARANCE_KEYS, key)) {
        /* theme only re-resolves live when 'system'; explicit values set attrs directly */
        DAC.applyAppearance();
      }
      notify(key, clone(state[key]));
      return clone(state[key]);
    },
    onChange: function (fn) {
      if (typeof fn !== "function") return function () {};
      listeners.push(fn);
      return function () {
        for (var i = 0; i < listeners.length; i++) {
          if (listeners[i] === fn) { listeners.splice(i, 1); break; }
        }
      };
    },
    reset: function () {
      state = clone(DEFAULTS);           /* history is NOT part of settings */
      DAC.storage.set("settings", clone(state));
      DAC.applyAppearance();
      notify("*", clone(state));
      return clone(state);
    }
  };

  /* ======================= appearance sync ======================= */
  /* Applies resolved appearance to <html> in one pass; keeps a live
     prefers-color-scheme listener only while theme === 'system'. */
  var MQ = null;
  var mqBound = false;
  var mqHandler = function () { DAC.applyAppearance(); };

  function currentTheme() {
    var t = state.theme;
    if (t === "dark" || t === "light") return t;
    try {
      return MQ && MQ.matches ? "dark" : "light";
    } catch (e) { return "light"; }
  }

  DAC.applyAppearance = function () {
    try {
      if (!MQ && window.matchMedia) MQ = window.matchMedia("(prefers-color-scheme: dark)");
    } catch (e0) { MQ = null; }

    var theme = currentTheme();
    var attrs = {
      "data-theme": theme,
      "data-bg": state.darkBg === "grey" ? "grey" : "oled",
      "data-accent": ["green", "blue", "white", "violet", "amber"].indexOf(state.accent) > -1 ? state.accent : "green",
      "data-text": ["small", "medium", "large"].indexOf(state.textSize) > -1 ? state.textSize : "medium",
      "data-density": state.density === "compact" ? "compact" : "comfortable",
      "data-motion": state.reduceAnimations ? "reduced" : "full"
    };
    try {
      var r = document.documentElement;
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) r.setAttribute(k, attrs[k]);
      }
    } catch (e1) { /* headless/private environments: attributes fall back to theme-boot's set */ }

    /* Live OS theme following (SPEC §5 Theme=System reacts to device changes). */
    if (MQ && state.theme === "system" && !mqBound) {
      mqBound = true;
      try {
        if (typeof MQ.addEventListener === "function") MQ.addEventListener("change", mqHandler, false);
        else if (typeof MQ.addListener === "function") MQ.addListener(mqHandler);
        else mqBound = false; /* very old Safari: polling not worth it for a demo */
      } catch (e2) { mqBound = false; }
    }
  };

  /* =============================== time =============================== */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function timeStr(d) {
    var h = d.getHours();
    var mm = pad2(d.getMinutes());
    if (state.timeFormat === "24h") return pad2(h) + ":" + mm;
    var ampm = h < 12 ? "AM" : "PM";
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ":" + mm + " " + ampm;
  }

  /* "Just now" | "4:32 PM Today" | "4:32 PM Yesterday" | "N days ago" */
  DAC.time = {
    format: function (ts) {
      var d = new Date(Number(ts));
      if (isNaN(d.getTime())) return "";
      var diff = Date.now() - d.getTime();
      if (diff < 60000) return "Just now";

      var startDay = new Date(d.getTime());
      startDay.setHours(0, 0, 0, 0);
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      var dayDiff = Math.round((today.getTime() - startDay.getTime()) / 86400000);

      if (dayDiff <= 0) return timeStr(d) + " Today";
      if (dayDiff === 1) return timeStr(d) + " Yesterday";
      return dayDiff + " days ago";
    },
    /* exact: "2026-11-01 14:32" — always 24h, local time */
    exact: function (ts) {
      var d = new Date(Number(ts));
      if (isNaN(d.getTime())) return "";
      return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
        " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    },
    /* Internal helper: no scheme marks + whitespace -> message (CONTRACT §9). */
    isMessage: function (input) {
      var s = String(input == null ? "" : input);
      if (!/\S/.test(s)) return false;
      return s.indexOf("://") < 0 && !/^www\./i.test(s) && /\s/.test(s);
    }
  };

  /* =============================== utils =============================== */
  DAC.utils = {
    escapeHtml: function (s) {
      return String(s === null || s === undefined ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },

    debounce: function (fn, ms) {
      var t = null;
      return function () {
        var args = arguments, self = this;
        if (t) { clearTimeout(t); t = null; }
        t = setTimeout(function () {
          t = null;
          fn.apply(self, args);
        }, ms === 0 ? 0 : (ms || 200));
      };
    },

    uuid: function () {
      try {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
          return window.crypto.randomUUID();
        }
      } catch (e) { /* fall through */ }
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
        .replace(/[xy]/g, function (c) {
          var r = (Date.now() + Math.random() * 16) % 16 | 0;
          var v = c === "x" ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
    },

    /* Promise<boolean>; navigator.clipboard -> textarea+execCommand fallback. */
    clipboardCopy: function (text) {
      var s = String(text === null || text === undefined ? "" : text);
      return new Promise(function (resolve) {
        var done = function (v) { resolve(v === true); };
        var finish = function () {
          /* fallback for file:// and permission denials */
          try {
            var ta = document.createElement("textarea");
            ta.value = s;
            ta.setAttribute("readonly", "readonly");
            ta.className = "sr-only";
            document.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange(0, s.length);
            var ok = false;
            try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
            document.body.removeChild(ta);
            done(ok);
          } catch (e2) { done(false); }
        };
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          navigator.clipboard.writeText(s).then(function () { done(true); }, finish);
        } else {
          finish();
        }
      });
    },

    /* mask(text): no-op unless settings.maskSensitive; then digits runs >= 3
       become "•••" and URL paths are hidden after the host. */
    mask: function (text) {
      var raw = String(text === null || text === undefined ? "" : text);
      if (!state.maskSensitive) return raw;
      var out = raw.replace(/(https?:\/\/[^\s\/?#]+)([\/?#][^\s]*)?/gi, function (m, host) {
        return host + "/\u2026";
      });
      out = out.replace(/\d{3,}/g, "\u2022\u2022\u2022");
      return out;
    }
  };

  /* ================================ ui ================================ */
  function svgGlyph(paths, cls, attr) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "1.7");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("focusable", "false");
    if (attr) for (var k in attr) s.setAttribute(k, attr[k]);
    for (var i = 0; i < paths.length; i++) {
      var p = document.createElementNS("http://www.w3.org/2000/svg", paths[i].tag || "path");
      for (var a in paths[i]) {
        if (a === "tag") continue;
        p.setAttribute(a, paths[i][a]);
      }
      s.appendChild(p);
    }
    return s;
  }

  var GLYPH = {
    home: [{ d: "M4.5 10.6 12 4.2l7.5 6.4V20a1 1 0 0 1-1 1h-4.6v-5.4h-3.8V21H5.5a1 1 0 0 1-1-1Z" }],
    gear: [
      { tag: "circle", "cx": "12", "cy": "12", "r": "3" },
      { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" }
    ],
    clock: [
      { tag: "circle", "cx": "12", "cy": "12", "r": "8.2" },
      { d: "M12 7.4V12l3.1 1.9" }
    ],
    info: [
      { tag: "circle", "cx": "12", "cy": "12", "r": "8.2" },
      { d: "M12 11.2v4.6" },
      { d: "M12 8h.01" }
    ],
    close: [{ d: "M6 6l12 12M18 6L6 18" }],
    shield: [
      { d: "M12 2.2 20 5.1v5.4c0 4.7-3.2 8.5-8 9.8-4.8-1.3-8-5.1-8-9.8V5.1Z" },
      { tag: "rect", "x": "9.4", "y": "10.5", "width": "5.2", "height": "4.6", "rx": "1" },
      { d: "M10.5 10.5V9.4a1.5 1.5 0 0 1 3 0v1.1" }
    ],
    check: [{ d: "M20 6.6 9.7 17 4.2 11.5" }],
    alert: [
      { d: "M12 3.8 21 19.4H3Z" },
      { d: "M12 9.4v4.4" },
      { d: "M12 16.6h.01" }
    ],
    alertCircle: [
      { tag: "circle", "cx": "12", "cy": "12", "r": "8.2" },
      { d: "M12 7.4v5.6" },
      { d: "M12 16.2h.01" }
    ],
      chip: [
        { d: "M7 7h10v10H7Z" },
        { d: "M9 7V4" }, { d: "M12 7V4" }, { d: "M15 7V4" },
        { d: "M9 17v3" }, { d: "M12 17v3" }, { d: "M15 17v3" },
        { d: "M7 9H4" }, { d: "M7 12H4" }, { d: "M7 15H4" },
        { d: "M17 9h3" }, { d: "M17 12h3" }, { d: "M17 15h3" }
      ]
  };

  /* Exposed for reuse (e.g. the settings-page navbar-style preview) so any page
     drawing a nav icon uses the same source as the navbar builder itself. */
  DAC.glyphs = GLYPH;
  DAC.svgGlyph = svgGlyph;

  var PAGE_MAP = { index: "nav-dashboard", history: "nav-history", settings: "nav-settings", hardware: "nav-hardware" };

  /* ---------------- toast [E]: bottom-right stack, ≤3 visible, key-dedupe ----------------
     Signature (legacy-compatible):
       DAC.ui.toast(message, typeString)                     e.g. "success" | "error"
       DAC.ui.toast(message, { type, key, description, action: { label, onClick }, timeout })
     A toast created with the same key replaces a still-visible sibling in place: the
     message refreshes, a "x2" counter bumps, and the timer resets. At most 3 toasts are
     visible at once (the oldest is dismissed first). Countdown timers: success/info 4s,
     warn 6s, error stays until dismissed; hover, focus or a hidden document tab pauses.
     Escape dismisses the currently focused toast. */
  DAC.ui = {};
  DAC.ui._toasts = [];

  DAC.ui.toast = function (message, second) {
    var opts = {};
    if (second && typeof second === "object") {
      for (var pk in second) {
        if (Object.prototype.hasOwnProperty.call(second, pk)) opts[pk] = second[pk];
      }
    } else if (typeof second === "string") {
      opts.type = second; /* legacy callers: toast(msg, "success") */
    }
    var valid = { success: 1, warn: 1, error: 1, info: 1 };
    var t = valid[opts.type] ? opts.type : "info";
    var region = document.getElementById("toast-region");
    if (!region || !message) return null;

    var msgStr = String(message);
    var key = opts.key ? String(opts.key) : "";

    /* dedupe: same key -> refresh the existing toast in place */
    if (key) {
      for (var di = 0; di < DAC.ui._toasts.length; di++) {
        var twin = DAC.ui._toasts[di];
        if (twin.key === key && !twin.closing && twin.el && twin.el.parentNode) {
          twin.count = twin.count + 1;
          var twinTitle = twin.el.querySelector(".toast-title");
          if (twinTitle) twinTitle.textContent = msgStr;
          var twinCount = twin.el.querySelector(".toast-count");
          if (twinCount) twinCount.textContent = "x" + twin.count;
          if (twin.desc) {
            twin.desc.textContent = opts.description ? String(opts.description) : "";
            twin.desc.hidden = !opts.description;
          }
          if (opts.timeout !== undefined && opts.timeout !== null && Number(opts.timeout) >= 0) {
            twin.base = Number(opts.timeout);
            twin.applyBar();
          }
          twin.refresh();
          return twin.el;
        }
      }
    }

    var el = document.createElement("div");
    el.className = "toast toast--" + t;
    el.setAttribute("role", (t === "error" || t === "warn") ? "alert" : "status"); /* info+success=polite status; failures alert */

    var ico = document.createElement("span");
    ico.className = "toast-ico";
    ico.setAttribute("aria-hidden", "true");
    var glyphKind = t === "success" ? "check" : (t === "warn" || t === "error") ? "alert" : "info";
    ico.appendChild(svgGlyph(GLYPH[glyphKind], null));

    var body = document.createElement("div");
    body.className = "toast-body";
    var titleEl = document.createElement("span");
    titleEl.className = "toast-title";
    titleEl.textContent = msgStr; /* textContent = no injection path */
    var desc = document.createElement("span");
    desc.className = "toast-desc";
    desc.hidden = true;
    if (opts.description) desc.textContent = String(opts.description);
    body.appendChild(titleEl);
    body.appendChild(desc);
    if (opts.action && opts.action.label) {
      var act = document.createElement("button");
      act.type = "button";
      act.className = "toast-action";
      act.textContent = String(opts.action.label);
      act.addEventListener("click", function () {
        dismiss();
        if (typeof opts.action.onClick === "function") opts.action.onClick();
      });
      body.appendChild(act);
    }

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "toast-close";
    closeBtn.setAttribute("aria-label", "Dismiss notification");
    closeBtn.appendChild(svgGlyph(GLYPH.close, null));

    var bar = document.createElement("span");
    bar.className = "toast-bar";
    bar.setAttribute("aria-hidden", "true");

    el.appendChild(ico);
    el.appendChild(body);
    el.appendChild(closeBtn);
    el.appendChild(bar);
    region.appendChild(el);

    var rec = {
      key: key,
      count: 1,
      el: el,
      desc: desc,
      bar: bar,
      closing: false,
      paused: false,
      timer: null,
      base: opts.timeout === undefined || opts.timeout === null
        ? (t === "warn" ? 6000 : t === "error" ? 0 : 4000)
        : Number(opts.timeout),
    };

    var dismiss = function () {
      if (rec.closing || !el.parentNode) return;
      rec.closing = true;
      if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
      var idx = DAC.ui._toasts.indexOf(rec);
      if (idx >= 0) DAC.ui._toasts.splice(idx, 1);
      document.removeEventListener("keydown", escDismiss, true);
      document.removeEventListener("visibilitychange", onVis, false);
      el.classList.add("is-out");
      /* fallback timer covers transition:none (reduced motion) */
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 140);
    };
    var escDismiss = function (ev) {
      if (ev.key === "Escape" && el.contains(document.activeElement)) dismiss();
    };
    var startTimer = function () {
      if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
      if (rec.base > 0 && !rec.paused && !document.hidden) rec.timer = setTimeout(dismiss, rec.base);
    };
    var pause = function () {
      if (rec.paused) return;
      rec.paused = true;
      if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
      el.classList.add("is-paused");
    };
    var resume = function () {
      if (!el.parentNode) return;
      rec.paused = false;
      el.classList.remove("is-paused");
      if (rec.base > 0) { applyBar(); startTimer(); }
    };
    var onVis = function () {
      if (document.hidden) pause();
      else if (!el.contains(document.activeElement)) resume();
    };
    var applyBar = function () {
      if (rec.base > 0) {
        el.style.setProperty("--toast-dur", rec.base + "ms");
        bar.style.display = "";
      } else {
        bar.style.display = "none";
      }
    };
    var restartackBar = function () {
      bar.style.animation = "none";
      void bar.offsetWidth; /* restart the CSS animation deterministically */
      bar.style.animation = "";
    };
    rec.applyBar = applyBar;
    rec.refresh = function () { restartackBar(); startTimer(); };
    rec.dismiss = dismiss;

    closeBtn.addEventListener("click", dismiss);
    document.addEventListener("keydown", escDismiss, true);
    document.addEventListener("visibilitychange", onVis, false);
    el.addEventListener("mouseenter", pause);
    el.addEventListener("mouseleave", resume);
    el.addEventListener("focusin", pause);
    el.addEventListener("focusout", resume);

    applyBar();
    startTimer();

    /* cap: at most 3 visible — dismiss the oldest first */
    DAC.ui._toasts.push(rec);
    var others = DAC.ui._toasts.filter(function (o) {
      return o !== rec && !o.closing && o.el && o.el.parentNode;
    });
    while (others.length >= 3) others.shift().dismiss();

    return el;
  };

  /* ---- [A] callouts: inject status icons; a data-type change repaints the icon only ---- */
  DAC.ui.callouts = (function () {
    var ICON = { info: GLYPH.info, success: GLYPH.check, warning: GLYPH.alert, danger: GLYPH.alertCircle };
    function paint(box) {
      var t = box.getAttribute("data-type") || "info";
      if (!ICON[t]) { t = "info"; }
      var span = box.querySelector(".callout__icon");
      if (!span) {
        span = document.createElement("span");
        span.className = "callout__icon";
        span.setAttribute("aria-hidden", "true");
        box.insertBefore(span, box.firstChild);
      }
      if (span.getAttribute("data-icon") !== t) {
        span.textContent = "";
        span.appendChild(svgGlyph(ICON[t], null));
        span.setAttribute("data-icon", t);
      }
    }
    function upgrade(root) {
      var list = (root || document).querySelectorAll(".callout");
      for (var i = 0; i < list.length; i++) { paint(list[i]); }
    }
    if (typeof MutationObserver === "function") {
      new MutationObserver(function (muts) {
        for (var k = 0; k < muts.length; k++) {
          var el = muts[k].target;
          if (el && el.classList && el.classList.contains("callout")) { paint(el); }
        }
      }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-type"], subtree: true });
    }
    upgrade();
    return { upgrade: upgrade, paint: paint };
  })();

  /* ---- [B/C] segmented: one thumb slides and resizes; aria-checked/tabindex only,
     never re-rendered. Emits seg-change on user selection (click/keys). ---- */
  function initSeg(root) {
    if (root.dataset.segInit) { return; }
    root.dataset.segInit = "1";
    const opts = [...root.querySelectorAll('[role="radio"]')];
    const place = () => {
      const a = opts.find(o => o.getAttribute('aria-checked') === 'true') || opts[0];
      if (!a) { return; }
      const rr = root.getBoundingClientRect(), ar = a.getBoundingClientRect();
      root.style.setProperty('--seg-x', (ar.left - rr.left - root.clientLeft) + 'px');
      root.style.setProperty('--seg-w', ar.width + 'px');
    };
    const select = (o, { focus = false, emit = true } = {}) => {
      opts.forEach(x => {
        const on = x === o;
        x.setAttribute('aria-checked', String(on));
        x.tabIndex = on ? 0 : -1;
      });
      place();
      if (focus) { o.focus(); }
      if (emit) {
        root.dispatchEvent(new CustomEvent('seg-change', { bubbles: true, detail: { value: o.dataset.value } }));
      }
    };
    root.addEventListener('click', e => {
      const o = e.target.closest('[role="radio"]');
      if (o && root.contains(o)) { select(o); }
    });
    root.addEventListener('keydown', e => {
      const i = opts.indexOf(document.activeElement);
      if (i < 0) { return; }
      let n = i;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { n = (i + 1) % opts.length; }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { n = (i - 1 + opts.length) % opts.length; }
      else if (e.key === 'Home') { n = 0; }
      else if (e.key === 'End') { n = opts.length - 1; }
      else { return; }
      e.preventDefault();
      select(opts[n], { focus: true });
    });
    if (typeof ResizeObserver === 'function') { new ResizeObserver(place).observe(root); }
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(place); }
    place();
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('is-ready')));
    root._segSet = value => {
      const o = opts.find(x => x.dataset.value === value);
      if (o) { select(o, { emit: false }); }
    };
  }
  DAC.seg = { init: initSeg };
  (function () {
    const roots = document.querySelectorAll('[data-seg]');
    for (let i = 0; i < roots.length; i++) { initSeg(roots[i]); }
  })();

  /* ---------------- modal ---------------- */
  var modalState = null;

  DAC.ui.modal = {
    open: function (opts) {
      opts = opts || {};
      if (modalState) DAC.ui.modal.close(true); /* replace silently */

      var backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";

      var modal = document.createElement("div");
      modal.className = "modal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      var titleId = "modal-title-" + DAC.utils.uuid();
      modal.setAttribute("aria-labelledby", titleId);

      var head = document.createElement("div");
      head.className = "modal-head";
      var h = document.createElement("h2");
      h.className = "modal-title";
      h.id = titleId;
      h.textContent = opts.title === undefined || opts.title === null ? "" : String(opts.title);
      head.appendChild(h);

      var closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "modal-close";
      closeBtn.setAttribute("aria-label", "Close");
      closeBtn.appendChild(svgGlyph(GLYPH.close, null));
      head.appendChild(closeBtn);

      var body = document.createElement("div");
      body.className = "modal-body";
      var content = opts.body;
      if (content && typeof content.nodeType === "number") {
        /* Node/Fragment is appended intact (classes + ids survive) */
        body.appendChild(content);
      } else if (content !== undefined && content !== null) {
        /* string bodies are trusted markup passed by page agents */
        body.innerHTML = String(content);
      }

      modal.appendChild(head);
      modal.appendChild(body);
      if (opts.foot && typeof opts.foot.nodeType === "number" && opts.foot.firstChild) {
        modal.appendChild(opts.foot);
      }
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      document.body.setAttribute("data-modal-open", "true");

      var prevFocus = document.activeElement;
      try {
        var first = body.querySelector(
          "a[href], button:not([disabled]), input:not([disabled]):not([type=\"hidden\"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])"
        );
        /* preventScroll: focusing the first control (often the foot button) must not
           auto-scroll the body — the content starts at its top when a modal opens */
        (first || closeBtn).focus({ preventScroll: true });
      } catch (e) { closeBtn.focus({ preventScroll: true }); }

      var keyHandler = function (ev) {
        if (ev.key === "Escape") {
          ev.preventDefault();
          DAC.ui.modal.close();
          return;
        }
        if (ev.key !== "Tab") return;
        var f = modal.querySelectorAll(
          "a[href], button:not([disabled]), input:not([disabled]):not([type=\"hidden\"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])"
        );
        var visible = [];
        for (var i = 0; i < f.length; i++) {
          if (f[i].offsetParent !== null) visible.push(f[i]);
        }
        if (!visible.length) { ev.preventDefault(); closeBtn.focus(); return; }
        var firstV = visible[0], lastV = visible[visible.length - 1];
        if (ev.shiftKey && document.activeElement === firstV) {
          ev.preventDefault(); lastV.focus();
        } else if (!ev.shiftKey && document.activeElement === lastV) {
          ev.preventDefault(); firstV.focus();
        }
      };
      document.addEventListener("keydown", keyHandler, true);
      backdrop.addEventListener("mousedown", function (ev) {
        if (ev.target === backdrop) DAC.ui.modal.close();
      });
      closeBtn.addEventListener("click", function () { DAC.ui.modal.close(); });

      modalState = {
        backdrop: backdrop,
        modal: modal,
        keyHandler: keyHandler,
        prevFocus: prevFocus && prevFocus.focus ? prevFocus : null,
        onClose: typeof opts.onClose === "function" ? opts.onClose : null,
        instant: false
      };
      return modal;
    },

    close: function (instant) {
      var st = modalState;
      if (!st) return;
      modalState = null;
      document.removeEventListener("keydown", st.keyHandler, true);
      document.body.removeAttribute("data-modal-open");

      var backdrop = st.backdrop;
      var finish = function () {
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      };
      if (instant === true) finish();
      else {
        st.modal.classList.add("is-closing");
        backdrop.style.animation = "none";
        /* dur-out (160ms) + fallback in case transitions are disabled */
        setTimeout(finish, 180);
      }

      if (st.prevFocus) {
        try { st.prevFocus.focus(); } catch (e1) { /* element may be gone */ }
      }
      if (st.onClose) {
        try { st.onClose(); } catch (e2) { /* callback errors isolated */ }
      }
    }
  };

  /* ---------------- confirm (Promise<boolean>) ---------------- */
  DAC.ui.confirm = {
    open: function (opts) {
      opts = opts || {};
      return new Promise(function (resolve) {
        var settled = false;
        var settle = function (v) { if (!settled) { settled = true; resolve(v); } };

        var body = document.createElement("div");
        var p = document.createElement("p");
        p.textContent = opts.message === undefined || opts.message === null ? "" : String(opts.message);
        body.appendChild(p);

        var foot = document.createElement("div");
        foot.className = "modal-foot";

        var cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "btn btn-secondary";
        cancel.textContent = opts.cancelLabel === undefined || opts.cancelLabel === null ? "Cancel" : String(opts.cancelLabel);
        cancel.addEventListener("click", function () { settle(false); DAC.ui.modal.close(true); });

        var danger = opts.danger === undefined ? true : opts.danger !== false;
        var ok = document.createElement("button");
        ok.type = "button";
        ok.className = danger ? "btn btn-danger" : "btn btn-primary";
        ok.textContent = opts.confirmLabel === undefined || opts.confirmLabel === null ? "Confirm" : String(opts.confirmLabel);
        ok.addEventListener("click", function () { settle(true); DAC.ui.modal.close(true); });

        foot.appendChild(cancel);
        foot.appendChild(ok);

        DAC.ui.modal.open({
          title: opts.title || "Confirm",
          body: body,
          foot: foot,
          onClose: function () { settle(false); }
        });
        ok.focus();
      });
    }
  };

  /* ---------------- legend (D4 drop-up) ---------------- */
  var LEG = { btn: null, panel: null, open: false, timer: null, listeners: false };

  function legendCloseVia(_why) {
    if (!LEG.open) return;
    LEG.open = false;
    if (LEG.timer) { clearTimeout(LEG.timer); LEG.timer = null; }
    LEG.btn.setAttribute("aria-expanded", "false");
    LEG.panel.classList.remove("is-open");
    /* hidden goes back on AFTER the 160ms drop-down finishes (D4 close) */
    LEG.timer = setTimeout(function () {
      if (!LEG.open) LEG.panel.hidden = true;
    }, 160);
    if (LEG.listeners) {
      document.removeEventListener("click", LEG.outside, true);
      document.removeEventListener("keydown", LEG.esc, true);
      LEG.listeners = false;
    }
  }

  DAC.ui.legendToggle = function (force) {
    LEG.btn = document.getElementById("nav-legend");
    LEG.panel = document.getElementById("risk-legend");
    if (!LEG.btn || !LEG.panel) return;

    var want = force === undefined || force === null ? !LEG.open : force === true;

    if (want) {
      LEG.outside = function (ev) {
        if (!LEG.panel.contains(ev.target) && !LEG.btn.contains(ev.target)) {
          var focusInside = LEG.panel.contains(document.activeElement);
          legendCloseVia("outside");
          if (focusInside) LEG.btn.focus();
        }
      };
      LEG.esc = function (ev) {
        if (ev.key === "Escape" && LEG.open) {
          legendCloseVia("esc");
          LEG.btn.focus();
          ev.preventDefault();
        }
      };
      clearTimeout(LEG.timer);
      LEG.timer = null;
      LEG.panel.hidden = false;                          /* 1: remove hidden     */
      void LEG.panel.offsetWidth;                         /* 2: force reflow so   */
      LEG.panel.classList.add("is-open");                 /* the 220ms transition runs */
      LEG.btn.setAttribute("aria-expanded", "true");
      LEG.open = true;
      if (!LEG.listeners) {
        document.addEventListener("click", LEG.outside, true);
        document.addEventListener("keydown", LEG.esc, true);
        LEG.listeners = true;
      }
    } else {
      legendCloseVia("toggle");
      LEG.btn.focus(); /* "i" pressed again: focus returns to "i" (SPEC §5) */
    }
  };

  /* ---------------- shared details card (modal body) ----------------
     One builder for the history page's row-details modal AND the dashboard
     batch rows' "view details" modal — same classes (.modal-detail …), same
     shell (DAC.ui.modal), so both look and animate identically. The caller
     opens the modal and registers visuals via attachDetailVisuals so every
     handle is destroyed on close. Per entry type (UI pass 1):
       low        → green check circle, "No issues detected" reasons, score kept
       medium/high→ scored ring + shield, reasons, action
       unverified → dashed grey unverified ring, "Not verified" instead of a
                    score, "Why it could not be verified" reason, and an action
                    saying the item must not be treated as safe (contract §3)
       error      → plain grey ring, no score pair, no data-risk attribute */
  var DETAIL_RISK_LABEL = { low: "Low risk", medium: "Medium risk", high: "High risk", unverified: "Not verified", error: "Error" };
  var DETAIL_RISK_CLS = { low: "risk-low", medium: "risk-medium", high: "risk-high", unverified: "risk-na", error: "risk-na" };
  var DETAIL_SHIELD = { low: "secure", medium: "caution", high: "threat" };

  function detailPair(dt, ddNode) {
    var pair = document.createElement("div");
    pair.className = "detail-pair";
    var t = document.createElement("dt");
    t.className = "detail-dt";
    t.textContent = dt;
    pair.appendChild(t);
    pair.appendChild(ddNode);
    return pair;
  }

  /* ===== Risk tag [B2] — shared by the homepage + history tables =====
     One neutral container for every level; the 3-bar severity meter and the
     label color carry the risk. riskTag builds DOM (homepage rows),
     riskTagHtml feeds the history row pipeline (string rows, can hold
     thousands — the markup is constant per level, so the string is cached;
     no per-tag SVG: the warning triangle is a CSS mask). Bars and triangle
     are aria-hidden; the text label is the accessible name, so a level
     never depends on color alone. na = Not verified / error (grey, no bars,
     never styled as Low). */
  var RISK_TAG_LABEL = { low: "Low", medium: "Medium", high: "High" };
  var riskTagHtmlCache = {};
  function riskTagKey(risk) {
    return (risk === "low" || risk === "medium" || risk === "high") ? risk : "na";
  }
  DAC.ui.riskTag = function (risk) {
    var key = riskTagKey(risk);
    var tag = document.createElement("span");
    tag.className = "risk-tag";
    tag.setAttribute("data-risk", key);
    if (key === "na") {
      var warn = document.createElement("span");
      warn.className = "risk-warn";
      warn.setAttribute("aria-hidden", "true");
      tag.appendChild(warn);
      tag.appendChild(document.createTextNode("N/A"));
      return tag;
    }
    var meter = document.createElement("span");
    meter.className = "risk-meter";
    meter.setAttribute("aria-hidden", "true");
    for (var b = 1; b <= 3; b++) {
      var bar = document.createElement("span");
      bar.className = "risk-bar risk-bar-" + b;
      meter.appendChild(bar);
    }
    tag.appendChild(meter);
    tag.appendChild(document.createTextNode(RISK_TAG_LABEL[key]));
    return tag;
  };
  DAC.ui.riskTagHtml = function (risk) {
    var key = riskTagKey(risk);
    if (!riskTagHtmlCache[key]) riskTagHtmlCache[key] = DAC.ui.riskTag(key).outerHTML;
    return riskTagHtmlCache[key];
  };

  DAC.ui.detailsCard = function (rec) {
    var r = rec || {};
    var risk = r.risk || "unverified";
    var plain = risk === "low" || risk === "medium" || risk === "high";
    var utils = DAC.utils || {};
    var shown = typeof utils.mask === "function"
      ? utils.mask(r.input)
      : String(r.input == null ? "" : r.input);
    var sN = String(typeof r.score === "number" && isFinite(r.score) ? Math.max(0, Math.min(99, Math.round(r.score))) : 0);
    var sPadded = sN.length < 2 ? "0" + sN : sN;

    var card = document.createElement("div"); /* plain body wrapper: columns + footer row */
    var detail = document.createElement("div");
    detail.className = "modal-detail";
    /* [F] contract §2.2: error rows carry NO data-risk attribute */
    if (plain || risk === "unverified") { detail.setAttribute("data-risk", risk); }

    var main = document.createElement("div");
    main.className = "detail-main";
    var lbl = document.createElement("p");
    lbl.className = "risk-label " + (DETAIL_RISK_CLS[risk] || "risk-na");
    /* data-risk drives core.css colors on BOTH pages (unverified/error → na) */
    lbl.setAttribute("data-risk", (risk === "unverified" || risk === "error") ? "na" : risk);
    lbl.textContent = DETAIL_RISK_LABEL[risk] || "Not verified";
    main.appendChild(lbl);

    var list = document.createElement("dl");
    list.className = "detail-list";

    /* Selected input — masked for display (never raw untrusted HTML) */
    var selDd = document.createElement("dd");
    selDd.className = "detail-dd";
    var sel = document.createElement("span");
    sel.className = "sel-input";
    sel.textContent = shown;
    sel.title = shown;
    selDd.appendChild(sel);
    list.appendChild(detailPair("Selected input", selDd));

    /* Risk score: verified rows → NN/100; unverified → "Not verified"; error → none */
    if (plain) {
      var scoreDd = document.createElement("dd");
      scoreDd.className = "detail-dd";
      scoreDd.textContent = sPadded + "/100";
      list.appendChild(detailPair("Risk score:", scoreDd));
    } else if (risk === "unverified") {
      var nvDd = document.createElement("dd");
      nvDd.className = "detail-dd";
      nvDd.textContent = "Not verified";
      list.appendChild(detailPair("Risk score:", nvDd));
    }

    /* Reasons / why-not-verified */
    var reasons = Array.isArray(r.reasons) ? r.reasons : [];
    if (risk === "unverified") {
      var whyDd = document.createElement("dd");
      whyDd.className = "detail-dd";
      whyDd.textContent = r.details || "The input could not be checked.";
      list.appendChild(detailPair("Why it could not be verified", whyDd));
    } else if (plain && reasons.length === 0) {
      var okDd = document.createElement("dd");
      okDd.className = "detail-dd";
      okDd.textContent = risk === "low" ? "No issues detected" : "No risk indicators triggered.";
      list.appendChild(detailPair("Detection reasons", okDd));
    } else if (reasons.length) {
      var rd = document.createElement("dd");
      rd.className = "detail-dd";
      var ul = document.createElement("ul");
      ul.className = "reason-list";
      for (var i = 0; i < reasons.length; i++) {
        var li = document.createElement("li");
        li.textContent = reasons[i];
        ul.appendChild(li);
      }
      rd.appendChild(ul);
      list.appendChild(detailPair("Detection reasons", rd));
    }

    /* Recommended action */
    var actText = r.recommendation;
    if (risk === "unverified" && !actText) {
      actText = "This item could not be verified. It must not be treated as safe — re-check the input or try again later.";
    }
    var actDd = document.createElement("dd");
    actDd.className = "detail-dd";
    actDd.textContent = actText || "";
    list.appendChild(detailPair("Recommended action", actDd));

    main.appendChild(list);

    var aside = document.createElement("aside");
    aside.className = "modal-visual";
    var shield = document.createElement("span");
    shield.className = "modal-shield";
    shield.hidden = !(risk === "medium" || risk === "high"); /* low: the check circle carries "all clear" */
    var ring = document.createElement("span");
    ring.className = "modal-ring";
    var note = document.createElement("p");
    note.className = "vis-note";
    if (!plain) { note.textContent = r.details || ""; }
    aside.appendChild(shield);
    aside.appendChild(ring);
    aside.appendChild(note);

    detail.appendChild(main);
    detail.appendChild(aside);
    card.appendChild(detail);
    var foot = document.createElement("div");
    foot.className = "modal-foot";
    card.appendChild(foot);

    return {
      card: card,
      detail: detail,
      ringHost: ring,
      shieldHost: (risk === "medium" || risk === "high") ? shield : null,
      note: note,
      plainRisk: plain,
      risk: risk,
      scorePadded: sPadded
    };
  };

  /* Attaches the animated visuals to a detailsCard. register(handle) collects
     destroy handles (caller clears them onClose). Degrades to sr-only text when
     the visuals peer is unavailable (dev preview without the core visuals). */
  DAC.ui.attachDetailVisuals = function (h, rec, register) {
    var vis = DAC.visuals || {};
    if (!h || typeof register !== "function") { return; }
    var drewRing = false;
    if (h.ringHost) {
      if (h.risk === "low" && typeof vis.checkCircle === "function") {
        register(vis.checkCircle(h.ringHost));
        drewRing = true;
      } else if (h.risk === "unverified" && typeof vis.unverifiedRing === "function") {
        register(vis.unverifiedRing(h.ringHost));
        drewRing = true;
      } else if (typeof vis.scoreRing === "function") {
        register(vis.scoreRing(h.ringHost, h.plainRisk ? (rec && rec.score) : null, h.risk));
        drewRing = true;
      }
      if (!drewRing) {
        var t = document.createElement("span");
        t.className = "sr-only";
        t.textContent = h.plainRisk ? ("Risk score " + h.scorePadded + " out of 100") : "Not verified";
        h.ringHost.appendChild(t);
      }
    }
    if (h.shieldHost && typeof vis.shield === "function") {
      var st = DETAIL_SHIELD[h.risk] || "caution";
      h.shieldHost.classList.add("state-" + st);
      register(vis.shield(h.shieldHost, st));
    }
  };

  /* ======================= verdict shade (Phase 1) ======================= */
  /* Per-theme gradient tint overrides for the 4 verdict states (docs/VERDICT_COLORS.md).
     Storage goes through TDSettings (keys td.vs.<theme>.<verdict>, registered in
     settings.js); only overrides are stored — absent or "" means default. The CSS
     side (risk-glow.css, css/pages/index.css) reads --vs-<verdict>, whose fallback
     chain --vs-<verdict>-<theme>-o → default lets overrides apply with no JS in
     the style rules. Defaults mirror risk-glow.css (kept in sync by hand). */
  (function () {
    var THEMES = ["light", "dark"];
    var VERDICTS = ["high", "medium", "low", "unverified"];
    var DEF = {
      light: { high: "#c2263b", medium: "#b45309", low: "#127a48", unverified: "#55606a" },
      dark:  { high: "#ff5a5f", medium: "#ffb020", low: "#3ddc84", unverified: "#8a93a0" }
    };
    var HEX6 = /^#?[0-9a-f]{6}$/i;
    var HEX3 = /^#?[0-9a-f]{3}$/i;
    var listeners = [];

    function validTheme(t) { return THEMES.indexOf(t) !== -1; }
    function validVerdict(v) { return VERDICTS.indexOf(v) !== -1; }
    function storeKey(theme, verdict) { return "vs." + theme + "." + verdict; }
    function ovVar(theme, verdict) { return "--vs-" + verdict + "-" + theme + "-o"; }

    /* "#RGB"/"#RRGGBB" (case-insensitive, "#" optional) → lowercase "#rrggbb";
       anything else → null (no throw). */
    function normalizeHex(input) {
      if (typeof input !== "string") return null;
      var s = input.trim();
      var m = HEX6.exec(s) || HEX3.exec(s);
      if (!m) return null;
      s = s.replace(/^#/, "").toLowerCase();
      if (s.length === 3) {
        s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
      }
      return "#" + s;
    }

    function storedRaw(theme, verdict) {
      var v = null;
      try {
        if (window.TDSettings && typeof window.TDSettings.get === "function") {
          v = window.TDSettings.get(storeKey(theme, verdict));
        }
      } catch (e) { v = null; }
      return v === null || v === undefined || v === "" ? null : String(v);
    }

    function effective(theme, verdict) {
      var norm = normalizeHex(storedRaw(theme, verdict));
      return norm || DEF[theme][verdict];
    }

    function applyOne(theme, verdict, hex) {
      try { document.documentElement.style.setProperty(ovVar(theme, verdict), hex); }
      catch (e) { /* no documentElement (tests): nothing to apply */ }
    }
    function removeOne(theme, verdict) {
      try { document.documentElement.style.removeProperty(ovVar(theme, verdict)); }
      catch (e) { /* nothing to apply */ }
    }
    function notify(theme, verdict, value) {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i]({ theme: theme, verdict: verdict, value: value }); }
        catch (e) { /* listener errors are isolated */ }
      }
    }

    function tdSet(theme, verdict, value) {
      try {
        if (window.TDSettings && typeof window.TDSettings.set === "function") {
          return window.TDSettings.set(storeKey(theme, verdict), value) !== false;
        }
      } catch (e) { /* storage unavailable */ }
      return false;
    }

    /* Initial apply: stored overrides → --vs-<verdict>-<theme>-o on <html>.
       Runs here (end-of-body core.js) — the earliest the contract allows, since
       theme-init.js must not read td.* keys (TDSettings loads after it). */
    (function applyStored() {
      for (var t = 0; t < THEMES.length; t++) {
        for (var v = 0; v < VERDICTS.length; v++) {
          var norm = normalizeHex(storedRaw(THEMES[t], VERDICTS[v]));
          if (norm) applyOne(THEMES[t], VERDICTS[v], norm);
        }
      }
    })();

    DAC.verdictShade = {
      /* Effective hex: stored override if valid, else the default. */
      get: function (theme, verdict) {
        if (!validTheme(theme) || !validVerdict(verdict)) return null;
        return effective(theme, verdict);
      },
      defaults: function (theme, verdict) {
        if (!validTheme(theme) || !validVerdict(verdict)) return null;
        return DEF[theme][verdict];
      },
      /* True only when a stored override differs from the default. */
      isCustom: function (theme, verdict) {
        if (!validTheme(theme) || !validVerdict(verdict)) return false;
        var norm = normalizeHex(storedRaw(theme, verdict));
        return !!norm && norm !== DEF[theme][verdict];
      },
      /* Returns true on success; invalid input is rejected without throwing. */
      set: function (theme, verdict, hex) {
        if (!validTheme(theme) || !validVerdict(verdict)) return false;
        var norm = normalizeHex(hex);
        if (!norm) return false;
        tdSet(theme, verdict, norm);
        applyOne(theme, verdict, norm); /* live apply even if storage is off */
        notify(theme, verdict, norm);
        return true;
      },
      /* "" at the store level = unset (default tint again). */
      reset: function (theme, verdict) {
        if (!validTheme(theme) || !validVerdict(verdict)) return false;
        tdSet(theme, verdict, "");
        removeOne(theme, verdict);
        notify(theme, verdict, DEF[theme][verdict]);
        return true;
      },
      resetAll: function () {
        for (var t = 0; t < THEMES.length; t++) {
          for (var v = 0; v < VERDICTS.length; v++) {
            DAC.verdictShade.reset(THEMES[t], VERDICTS[v]);
          }
        }
        return true;
      },
      /* fn({ theme, verdict, value }); returns an unsubscribe function. */
      onChange: function (fn) {
        if (typeof fn !== "function") return function () {};
        listeners.push(fn);
        return function () {
          for (var i = 0; i < listeners.length; i++) {
            if (listeners[i] === fn) { listeners.splice(i, 1); break; }
          }
        };
      }
    };
  })();

  /* -------------------------------- boot -------------------------------- */
  /* Injects the CONTRACT §14 shell before <main> and the footer after it.
     Idempotent via [data-shell-ready]. */
  DAC.ui.boot = function (opts) {
    opts = opts || {};
    var page = opts.page || "index";
    if (document.querySelector(".app-header[data-shell-ready]")) return;
    var main = document.querySelector("main");

    var header = document.createElement("header");
    header.className = "app-header";
    header.setAttribute("data-shell-ready", "");

    var nav = document.createElement("nav");
    nav.className = "navbar";
    nav.setAttribute("aria-label", "Main");

    var brand = document.createElement("a");
    brand.className = "brand";
    brand.href = "index.html";
    brand.setAttribute("aria-label", "Threat Detector — Dashboard");
    brand.appendChild(svgGlyph(GLYPH.shield, null, { class: "brand-logo" }));
    var brandName = document.createElement("span");
    brandName.className = "brand-name";
    brandName.textContent = "Threat Detector";
    brand.appendChild(brandName);
    nav.appendChild(brand);

    var actions = document.createElement("div");
    actions.className = "nav-actions";

    var defs = [
      { id: "nav-dashboard", href: "index.html", tip: "Dashboard", glyph: "home", sr: "Dashboard" },
      { id: "nav-settings", href: "settings.html", tip: "Settings", glyph: "gear", sr: "Settings" },
      { id: "nav-hardware", href: "hardware.html", tip: "Hardware monitor", glyph: "chip", sr: "Hardware" },
      { id: "nav-history", href: "history.html", tip: "History", glyph: "clock", sr: "History" }
    ];
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var a = document.createElement("a");
      a.id = d.id;
      a.className = "navlink";
      a.href = d.href;
      a.setAttribute("aria-label", d.tip);
      a.setAttribute("data-tip", d.tip);
      a.appendChild(svgGlyph(GLYPH[d.glyph], null, { class: "nav-ico" }));
      var sr = document.createElement("span");
      sr.className = "sr-only";
      sr.textContent = d.sr;
      a.appendChild(sr);
      actions.appendChild(a);
    }

    var info = document.createElement("button");
    info.id = "nav-legend";
    info.className = "navlink";
    info.type = "button";
    info.setAttribute("aria-expanded", "false");
    info.setAttribute("aria-controls", "risk-legend");
    info.setAttribute("aria-label", "Risk Levels legend");
    info.setAttribute("data-tip", "Risk Levels");
    info.appendChild(svgGlyph(GLYPH.info, null, { class: "nav-ico" }));
    var srInfo = document.createElement("span");
    srInfo.className = "sr-only";
    srInfo.textContent = "Risk Levels";
    info.appendChild(srInfo);
    actions.appendChild(info);
    nav.appendChild(actions);

    /* --- Risk Levels legend panel (D4) --- */
    var legend = document.createElement("div");
    legend.id = "risk-legend";
    legend.className = "legend";
    legend.setAttribute("role", "region");
    legend.setAttribute("aria-label", "Risk Levels");
    legend.hidden = true;

    var lt = document.createElement("h2");
    lt.className = "legend-title";
    lt.textContent = "Risk Levels";
    legend.appendChild(lt);

    var rows = [
      ["dot-low", "Low Risk", "Likely safe"],
      ["dot-medium", "Medium Risk", "Use caution"],
      ["dot-high", "High Risk", "Potential threat"],
      ["dot-na", "Not Verified", "Unable to verify"]
    ];
    var ul = document.createElement("ul");
    ul.className = "legend-list";
    for (var r = 0; r < rows.length; r++) {
      var li = document.createElement("li");
      li.className = "legend-item";
      var dotEl = document.createElement("span");
      dotEl.className = "legend-dot " + rows[r][0];
      dotEl.setAttribute("aria-hidden", "true");
      var term = document.createElement("span");
      term.className = "legend-term";
      term.textContent = rows[r][1];
      var desc = document.createElement("span");
      desc.className = "legend-desc";
      desc.textContent = rows[r][2];
      li.appendChild(dotEl);
      li.appendChild(term);
      li.appendChild(desc);
      ul.appendChild(li);
    }
    legend.appendChild(ul);

    var note = document.createElement("p");
    note.className = "legend-note";
    note.textContent = "Low risk does not guarantee safety.";
    legend.appendChild(note);

    /* --- toast region --- */
    var region = document.createElement("div");
    region.id = "toast-region";
    region.className = "toast-region";
    region.setAttribute("role", "region");
    region.setAttribute("aria-label", "Notifications");
    region.setAttribute("aria-live", "polite");

    header.appendChild(nav);
    header.appendChild(legend);
    header.appendChild(region);

    if (main) main.parentNode.insertBefore(header, main);
    else document.body.insertBefore(header, document.body.firstChild);

    /* --- footer --- */
    var footer = document.createElement("footer");
    footer.className = "app-footer";
    var fNote = document.createElement("p");
    fNote.className = "footer-note";
    fNote.textContent = "Heuristic analysis. Low risk does not guarantee safety. All results on this page are fictional demonstration data.";
    var chip = document.createElement("span");
    chip.className = "status-chip";
    var chipDot = document.createElement("span");
    chipDot.className = "chip-dot";
    chipDot.setAttribute("aria-hidden", "true");
    chip.appendChild(chipDot);
    chip.appendChild(document.createTextNode("System Ready · All systems operational"));
    footer.appendChild(fNote);
    footer.appendChild(chip);
    if (main) main.parentNode.insertBefore(footer, main.nextSibling);
    else document.body.appendChild(footer);

    /* current page marker */
    var currentId = PAGE_MAP[page] || null;
    if (currentId) {
      var cur = document.getElementById(currentId);
      if (cur) {
        cur.setAttribute("aria-current", "page");
        cur.classList.add("is-current");
      }
    }

    /* legend wiring ("i" toggles; outside/Esc handled inside legendToggle) */
    info.addEventListener("click", function () { DAC.ui.legendToggle(); });

    /* theme/accent/density/text resolution + live system-theme listener */
    DAC.applyAppearance();
  };

  /* Expose the single global (CONTRACT §16). */
  window.DAC = DAC;
})();


/* ===== DAC SHARED CORE (JS) 2/3 — analysis engine, history, seed data, CSV — identical on all pages ===== */
/* OWNER: Agent B (Engine). Implements CONTRACT §6 (analyze/history/csv API), §7 (Result schema),
   §8 (read-only settings access), §9 (deterministic engine rules) and §10 (seed data).
   Vanilla ES2019, one IIFE, zero DOM access (only the CSV download anchor). No network, no console. */

(function () {
  'use strict';

  /* Attach to (or create) the single shared namespace created by shared.js. */
  var ns = (typeof window !== 'undefined' && window.DAC) ? window.DAC : {};
  if (typeof window !== 'undefined') { window.DAC = ns; }

  /* ------------------------------------------------------------------ *
   * Internal fallbacks — used only if shared.js is not present (so the
   * engine stays testable standalone). Production pages always have     *
   * shared.js loaded first, so these paths stay dormant.                *
   * ------------------------------------------------------------------ */

  var mem = {}; /* in-memory fallback store for this session */

  function storageGet(key, fallback) {
    if (ns.storage && typeof ns.storage.get === 'function') {
      var v;
      try { v = ns.storage.get(key, fallback); } catch (err) { v = undefined; }
      return (v === null || v === undefined) ? fallback : v;
    }
    return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : fallback;
  }

  function storageSet(key, value) {
    if (ns.storage && typeof ns.storage.set === 'function') {
      try { ns.storage.set(key, value); return; } catch (err) { /* fall through to memory */ }
    }
    mem[key] = value;
  }

  function uuid() {
    if (ns.utils && typeof ns.utils.uuid === 'function') {
      try { return ns.utils.uuid(); } catch (err) { /* use local generator */ }
    }
    /* RFC 4122-ish v4 fallback, sufficient for demo ids */
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /* ------------------------------------------------------------------ *
   * Settings (CONTRACT §8). Read-only — this file never writes settings.*
   * ------------------------------------------------------------------ */

  var DEFAULTS = {
    sensitivity: 'balanced',
    detectors: { httpInsecure: true, urgentLanguage: true, credentialRequests: true, ipHostname: true, shorteners: true, lookalikes: true },
    trustedDomains: ['google.com', 'developer.mozilla.org', 'github.com'],
    blockedDomains: ['bank-security.example', 'prize-claim.example', 'secure-login.example'],
    maxCsvEntries: 5000,
    saveHistory: true,
    autoDeleteDays: 'never'
  };

  function setting(key, fallback) {
    var v;
    try {
      if (ns.settings && typeof ns.settings.get === 'function') { v = ns.settings.get(key); }
    } catch (err) { v = undefined; }
    if (v === null || v === undefined) { return fallback; }
    return v;
  }

  function detectorOn(name) {
    var d = setting('detectors', DEFAULTS.detectors) || {};
    var v = d[name];
    return v === undefined ? true : !!v; /* absent key defaults to enabled */
  }

  /* Threshold band edges, current upper bound per band:
     relaxed 40/80, balanced 30/70, strict 20/60 (score >= high bound => high). */
  var THRESHOLDS = {
    relaxed: { low: 40, med: 80 },
    balanced: { low: 30, med: 70 },
    strict: { low: 20, med: 60 }
  };

  function bandEdges() {
    var t = THRESHOLDS[setting('sensitivity', DEFAULTS.sensitivity)];
    /* unknown sensitivity value falls back to balanced */
    t = t || THRESHOLDS.balanced;
    return { low: t.low, med: t.med, high: 99 };
  }

  /* ------------------------------------------------------------------ *
   * Engine vocabulary (CONTRACT §9 — exact reason strings).             *
   * ------------------------------------------------------------------ */

  var RE_HTTP_INSECURE = 'Contains an HTTP link with security-related wording.';
  var RE_URGENT = 'Urgent language pressures the recipient to act quickly.';
  var RE_CRED = 'Requests sensitive account or password information.';
  var RE_IP = 'Uses an IP address instead of a domain name.';
  var RE_SHORT = 'Routes through a URL shortener that can hide the real destination.';
  var RE_ODD = 'Address structure looks unusual (uncommon TLD, excess hyphens/subdomains, or \'@\').';
  var RE_LOOK = 'Domain may imitate a familiar brand (character substitution).';
  var RE_TRUSTED = 'Domain is on the trusted list.';
  var RE_BLOCKED = 'Domain is on the blocked list.';
  var RE_CLEAN = 'No suspicious activity detected.';
  var RE_TIMEOUT = 'Connection timeout.';
  var RE_MALFORMED = 'Malformed URL syntax.';
  var DETAILS_MALFORMED = 'The input does not look like a valid URL or a readable message.';

  var RECOMMENDATIONS = {
    low: 'No action needed. Stay alert for unexpected requests.',
    medium: 'Use caution. Verify the sender through an official channel before interacting.',
    high: 'Do not follow the link or provide credentials.',
    unverified: 'Unable to verify. Treat as untrusted and try again later.',
    error: 'Check the text and enter a full URL (e.g. https://example.com) or a plain message.'
  };

  /* Detector word lists ( CONTRACT §9 ). Urgent + credential run against the
     prose (input minus URL tokens); the HTTP-link wording list runs against the
     whole input, per the pinned arithmetic in the build brief. */
  var RE_URGENT_WORDS = /\b(urgent|immediately|locked|suspend|verify|act now|expires|winner|congratulations|free|click here|gift|prize)\b/i;
  var RE_CRED_WORDS = /\b(password|otp|pin|credit card|bank|ssn|sort code|iban|2fa|login)\b/i;
  var RE_SECURITY_WORDS = /(login|verify|secure|signin|password|account)/i; /* substring scan, per contract */
  var RE_HTTP_LINK = /\bhttp:\/\//i; /* plain http:// only — https:// does not match */
  var RE_IP_HOST = /(\d{1,3}\.){3}\d{1,3}(:\d+)?([\/?#]|$)/i;
  var RE_LOOKALIKE = /[a-z]+[0-9]+[a-z]*/i; /* letter run followed by digit run in the host */

  var SHORTENERS = ['bit.ly', 'tinyurl', 'tinyurl.com', 'goo.gl', 't.co', 'is.gd', 'cutt.ly', 'rb.gy'];
  var ODD_TLDS = ['xyz', 'top', 'info', 'biz', 'ru', 'click', 'link', 'cf', 'tk'];

  /* URL-likeness (CONTRACT §9 isUrlLike). */
  var RE_BARE_DOMAIN = /\b[a-z0-9][\w.-]*\.(com|net|org|edu|gov|io|co|xyz|info|biz|top|ru|link|click|app|dev|test|example|invalid)([\/:?#]|$)/i;

  function isUrlLike(s) {
    if (typeof s !== 'string') { return false; }
    var t = s.trim();
    if (!t) { return false; }
    if (t.indexOf('://') > 0) { return true; }
    if (/^(https?:\/\/|www\.|ftp:\/\/)/i.test(t)) { return true; }
    return RE_BARE_DOMAIN.test(t);
  }

  /* Keyword used to build the short human details summary. */
  var KEYWORDS = {
    insecureHttp: 'insecure HTTP link',
    urgent: 'urgent language',
    credential: 'credential request',
    ip: 'IP-address host',
    shortener: 'URL shortener',
    odd: 'unusual address structure',
    lookalike: 'brand lookalike domain',
    blocked: 'blocked domain'
  };

  function composeDetails(cats) {
    if (!cats.length) { return 'No suspicious activity detected.'; }
    var s = cats.join(', ');
    s = s.charAt(0).toUpperCase() + s.slice(1);
    return s + '.';
  }

  /* ------------------------------------------------------------------ *
   * Token/host helpers.                                                 *
   * ------------------------------------------------------------------ */

  function tokenIsUrl(tok) {
    return tok.indexOf('://') !== -1 || /^www\./i.test(tok) || RE_BARE_DOMAIN.test(tok);
  }

  function hostOf(tok) {
    /* strip scheme:// (when present) and a leading www., keep up to /?# or : (port) */
    var m = /^[a-z][a-z0-9+.\-]*:\/\//i.exec(tok);
    var rest = m ? tok.slice(m[0].length) : tok.replace(/^www\./i, '');
    var hit = rest.match(/^[^\/?#:\s]+/);
    return (hit ? hit[0] : '').toLowerCase();
  }

  function splitsIntoTokens(t) {
    return t.split(/\s+/);
  }

  /* Malformed-URL check for URL-like inputs (CONTRACT §9):
     1. invalid scheme (anything other than http/https/ftp), e.g. "ht!tp://"
     2. whitespace torn through the scheme://host head ("https://bad host.example")
     3. empty host after "://"
     4. invalid host characters */
  function malformedCheck(t, tokens) {
    var idx = t.indexOf('://');
    var i;
    var tok;
    var host;
    if (idx > -1) {
      var scheme = t.slice(0, idx).split(/\s+/).pop();
      if (!/^(https?|ftp)$/i.test(scheme)) { return true; } /* rule 1 */
    }
    for (i = 0; i < tokens.length; i++) {
      tok = tokens[i];
      if (tok.indexOf('://') === -1) { continue; }
      var rest = tok.replace(/^[a-z0-9+.\-]+:\/\//i, '');
      host = (rest.match(/^[^\/?#:\s]+/) || [''])[0];
      if (!host) { return true; } /* rule 3 — "http://" with no host */
      if (host.indexOf('.') === -1 && i + 1 < tokens.length && tokenIsUrl(tokens[i + 1])) {
        return true; /* rule 2 — host torn by whitespace, next token continues the URL */
      }
      if (/[^a-z0-9.\-_~%]/i.test(host)) { return true; } /* rule 4 */
    }
    return false;
  }

  function oddHost(host) {
    if (!host) { return false; }
    var parts = host.split('.');
    if (ODD_TLDS.indexOf(parts[parts.length - 1]) !== -1) { return true; }
    if ((host.match(/-/g) || []).length >= 3) { return true; }
    if ((host.match(/\./g) || []).length >= 4) { return true; } /* subdomain stuffing */
    return false;
  }

  function shortenerHost(host) {
    for (var i = 0; i < SHORTENERS.length; i++) {
      var e = SHORTENERS[i];
      if (host === e || host.slice(-e.length - 1) === '.' + e) { return true; }
    }
    return false;
  }

  function listMatches(hosts, list) {
    for (var i = 0; i < hosts.length; i++) {
      var h = hosts[i];
      if (!h) { continue; }
      for (var j = 0; j < list.length; j++) {
        var entry = String(list[j] || '').toLowerCase();
        if (!entry) { continue; }
        if (h === entry || h.slice(-entry.length - 1) === '.' + entry) { return true; }
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * DAC.analyze (CONTRACT §9 flow).                                     *
   * ------------------------------------------------------------------ */

  function makeResult(input, type, risk, score, status, details, reasons, ts) {
    return {
      id: 'u' + uuid(),
      input: input,
      type: type,
      risk: risk,
      score: score,
      status: status,
      details: details,
      reasons: reasons,
      recommendation: RECOMMENDATIONS[risk],
      ts: ts
    };
  }

  function errorResult(input, type) {
    return makeResult(input, type, 'error', 0, 'error', DETAILS_MALFORMED, [RE_MALFORMED], Date.now());
  }

  function analyze(raw) {
    var t = (typeof raw === 'string') ? raw.replace(/^\uFEFF/, '').trim() : '';
    if (!t) {
      /* empty input: not reachable from the page (inline validation), but keeps
         analyze() total — typed as message (no URL marks present). */
      return errorResult(t, 'message');
    }

    var tokens = splitsIntoTokens(t);
    if (isUrlLike(t) && malformedCheck(t, tokens)) {
      return errorResult(t, 'url'); /* URL-like input that never reached "malformed" falls through */
    }
    return scanResult(t, tokens);
  }

  function scanResult(t, tokens) {
    var now = Date.now();
    var urlTokens = [];
    var proseTokens = [];
    for (var i = 0; i < tokens.length; i++) {
      if (tokenIsUrl(tokens[i])) { urlTokens.push(tokens[i]); } else { proseTokens.push(tokens[i]); }
    }
    var prose = proseTokens.join(' ');

    /* Type: whitespace outside URL marks => message; bare/URL-only input => url. */
    var hasSpace = /\s/.test(t);
    var allUrlish = proseTokens.length === 0;
    var type = (!hasSpace || (hasSpace && allUrlish)) ? 'url' : 'message';

    var hosts = [];
    for (var k = 0; k < urlTokens.length; k++) {
      var h = hostOf(urlTokens[k]);
      if (h) { hosts.push(h); }
    }

    var hits = []; /* ordered by CONTRACT §9 detector order */
    var weights = [];
    var cats = [];
    function hit(name, weight, reason) {
      hits.push(reason);
      weights.push(weight);
      cats.push(KEYWORDS[name]);
    }

    /* insecure HTTP link with security-related wording (whole-input wording scan) */
    if (detectorOn('httpInsecure') && RE_HTTP_LINK.test(t) && RE_SECURITY_WORDS.test(t)) {
      hit('insecureHttp', 30, RE_HTTP_INSECURE);
    }
    if (detectorOn('urgentLanguage') && RE_URGENT_WORDS.test(prose)) {
      hit('urgent', 25, RE_URGENT);
    }
    if (detectorOn('credentialRequests') && RE_CRED_WORDS.test(prose)) {
      hit('credential', 25, RE_CRED);
    }
    if (detectorOn('ipHostname') && RE_IP_HOST.test(t)) {
      hit('ip', 20, RE_IP);
    }
    var isShort = detectorOn('shorteners') && hosts.some(shortenerHost);
    if (isShort) { hit('shortener', 15, RE_SHORT); }

    /* odd structure — not toggleable (no settings key exists for it) */
    var oddHit = hosts.some(oddHost);
    var atHit = urlTokens.some(function (tk) { return tk.indexOf('@') !== -1; });
    if (oddHit || atHit) { hit('odd', 15, RE_ODD); }

    if (detectorOn('lookalikes') && hosts.some(function (hh) { return RE_LOOKALIKE.test(hh); })) {
      hit('lookalike', 15, RE_LOOK);
    }

    var score = 5;
    for (var w = 0; w < weights.length; w++) { score += weights[w]; }
    if (score > 99) { score = 99; }

    /* list checks (suffix host match against settings lists) */
    var trustedOn = listMatches(hosts, setting('trustedDomains', DEFAULTS.trustedDomains) || []);
    var blockedOn = listMatches(hosts, setting('blockedDomains', DEFAULTS.blockedDomains) || []);

    var reasons = hits.slice();
    var details;
    var risk;
    var status = 'verified';

    if (hosts.some(function (hh) { return hh.indexOf('unknown') !== -1; })) {
      /* hostname containing "unknown": verification failed — report score as-is. */
      return makeResult(t, type, 'unverified', score, 'not_verified', 'Connection timeout.', [RE_TIMEOUT], now);
    }

    if (blockedOn) {
      reasons = [RE_BLOCKED].concat(reasons);
      cats = ['blocked'].concat(cats);
      score = score >= 90 ? score : 90; /* blocklist forces high (score >= 90) */
      risk = 'high';
      details = composeDetails(cats);
    } else if (trustedOn) {
      reasons = [RE_TRUSTED].concat(reasons);
      if (score > 29) { score = 29; } /* allowlist caps at low band */
      risk = 'low';
      details = composeDetails(cats); /* zero detector hits => the clean summary */
    } else {
      var edges = bandEdges();
      if (score < edges.low) { risk = 'low'; }
      else if (score < edges.med) { risk = 'medium'; }
      else { risk = 'high'; }
      details = composeDetails(cats);
    }

    if (!hits.length && !trustedOn && !blockedOn) {
      reasons = [RE_CLEAN]; /* zero hits: single neutral reason */
      details = 'No suspicious activity detected.';
    }

    return makeResult(t, type, risk, score, status, details, reasons, now);
  }

  /* ------------------------------------------------------------------ *
   * SEED DATA (CONTRACT §10). Times are offsets in minutes, converted   *
   * to timestamps at runtime so the demo history always looks fresh.    *
   * Safety rule: all malicious-looking samples use reserved domains     *
   * (.example/.test/.invalid) or documentation-only IPs.                *
   * Reason registry keeps the table compact: r lists indices into R.    *
   * ------------------------------------------------------------------ */

  var R = [
    RE_CLEAN,        /* 0 */
    RE_HTTP_INSECURE,/* 1 */
    RE_URGENT,       /* 2 */
    RE_CRED,         /* 3 */
    RE_IP,           /* 4 */
    RE_SHORT,        /* 5 */
    RE_ODD,          /* 6 */
    RE_LOOK,         /* 7 */
    RE_TRUSTED,      /* 8 */
    RE_BLOCKED,      /* 9 */
    RE_TIMEOUT,      /* 10 */
    RE_MALFORMED     /* 11 */
  ];

  /* Columns: id, minutesAgo, input, type, risk, score, details, reason indices. */
  var SEEDS = [
    ['s01', 2, 'https://google.com', 'url', 'low', 5, 'No suspicious activity detected.', [0]],
    ['s02', 5, 'Your account is locked! Verify your password now at http://bank-security.example/login', 'message', 'high', 94, 'Urgent language, suspicious link.', [1, 2, 3]],
    ['s03', 10, 'http://192.168.1.1/login', 'url', 'medium', 55, 'IP address hostname.', [4]],
    ['s04', 16, 'https://unknown-site.xyz', 'url', 'unverified', 20, 'Connection timeout.', [10]],
    ['s05', 22, 'ht!tp://bad url', 'url', 'error', 0, DETAILS_MALFORMED, [11]],
    ['s06', 35, 'https://unknown-check.example', 'url', 'unverified', 5, 'Connection timeout.', [10]],
    ['s07', 50, 'Your package is delayed. Confirm your delivery address at https://parcel-track.example/update', 'message', 'medium', 55, 'Delivery-update language with a link.', [2]],
    ['s08', 65, 'https://developer.mozilla.org', 'url', 'low', 6, 'No suspicious activity detected.', [8]],
    ['s09', 85, 'You won a free gift! Click here to claim your reward now at https://prize-draw.example/claim', 'message', 'high', 88, 'Free-reward lure, urgent link.', [2]],
    ['s10', 140, 'http://192.0.2.5/login', 'url', 'medium', 55, 'Insecure HTTP link, IP-address host.', [1, 4]],
    ['s11', 160, 'Your account is locked! Confirm your password now at http://secure-alert.example/idcheck', 'message', 'high', 85, 'Insecure HTTP link, urgent language, credential request.', [1, 2, 3]],
    ['s12', 190, 'Final warning: your cloud storage quota expires tomorrow.', 'message', 'medium', 30, 'Urgent language.', [2]],
    ['s13', 260, 'https://unknown-service.example/status', 'url', 'unverified', 5, 'Connection timeout.', [10]],
    ['s14', 330, 'https://en.wikipedia.org/wiki/Cybersecurity', 'url', 'low', 5, 'No suspicious activity detected.', [0]],
    ['s15', 430, 'https://secure-login.example/session', 'url', 'high', 90, 'Blocked domain.', [9]],
    ['s16', 520, 'https://github.com/security/advisories', 'url', 'low', 5, 'No suspicious activity detected.', [8]],
    ['s17', 600, 'http://203.0.113.7/signin', 'url', 'medium', 55, 'Insecure HTTP link, IP-address host.', [1, 4]],
    ['s18', 700, 'Team calendar is updated for next week; the all-hands moves to Thursday.', 'message', 'low', 5, 'No suspicious activity detected.', [0]],
    ['s19', 800, 'Your streaming subscription expires this weekend; renew to avoid interruption.', 'message', 'medium', 30, 'Urgent language.', [2]],
    ['s20', 900, 'https://bad host.example/path', 'url', 'error', 0, DETAILS_MALFORMED, [11]],
    ['s21', 1100, 'URGENT: your mailbox is full! Sign in with your password here: http://mail-quota.example/confirm', 'message', 'high', 85, 'Insecure HTTP link, urgent language, credential request.', [1, 2, 3]],
    ['s22', 1400, 'https://www.bbc.co.uk/weather', 'url', 'low', 5, 'No suspicious activity detected.', [0]],
    ['s23', 1700, 'https://unknown-relay.test/ping', 'url', 'unverified', 5, 'Connection timeout.', [10]],
    ['s24', 2100, 'Your trial expires in 24 hours; setup help is available in the app.', 'message', 'medium', 30, 'Urgent language.', [2]],
    ['s25', 2500, 'Update your recovery record: enter your OTP from the app to finish.', 'message', 'medium', 30, 'Credential request.', [3]],
    ['s26', 3000, 'https://paypa1-support.info/refund', 'url', 'medium', 35, 'Unusual address structure, brand lookalike domain.', [6, 7]],
    ['s27', 3600, 'Enter your password at http://paypa1-help.top/signin', 'message', 'high', 90, 'Insecure HTTP link, credential request, unusual address structure, brand lookalike domain.', [1, 3, 6, 7]],
    ['s28', 4300, 'https://ieee.org/standards', 'url', 'low', 5, 'No suspicious activity detected.', [0]],
    ['s29', 5000, 'https://in valid.example/login', 'url', 'error', 0, DETAILS_MALFORMED, [11]],
    ['s30', 5800, 'Confirm your delivery time slot — click here to pick a window before Friday.', 'message', 'medium', 30, 'Urgent language.', [2]],
    ['s31', 6600, 'http://prize-claim.example/step2', 'url', 'high', 90, 'Blocked domain.', [9]],
    ['s32', 7600, 'https://developer.mozilla.org/en-US/docs/Web/API', 'url', 'low', 5, 'No suspicious activity detected.', [8]],
    ['s33', 8600, 'Update your credit card details within 24 hours; your order stays on hold until then.', 'message', 'medium', 30, 'Credential request.', [3]],
    ['s34', 9800, 'https://unknown-node.example/health', 'url', 'unverified', 5, 'Connection timeout.', [10]],
    ['s35', 11000, 'We could not process your sort code change; resubmit your request in the banking app.', 'message', 'medium', 30, 'Credential request.', [3]],
    ['s36', 12500, 'ht!tps://split url.test', 'url', 'error', 0, DETAILS_MALFORMED, [11]],
    ['s37', 14000, 'Free credit! Click here to activate your bonus card: enter your password at http://bonus-card.example/secure', 'message', 'high', 85, 'Insecure HTTP link, urgent language, credential request.', [1, 2, 3]],
    ['s38', 16000, 'https://www.wikipedia.org/portal', 'url', 'low', 5, 'No suspicious activity detected.', [0]],
    ['s39', 18500, 'Your verification code for the shared drive expires in 30 minutes: retrieve it from the admin desk.', 'message', 'medium', 30, 'Urgent language.', [2]],
    ['s40', 21000, 'https://team roster.example', 'url', 'error', 0, DETAILS_MALFORMED, [11]],
    ['s41', 23500, 'http://192.0.2.9/account', 'url', 'medium', 55, 'Insecure HTTP link, IP-address host.', [1, 4]],
    ['s42', 26500, 'https://unknown-gw.invalid/probe', 'url', 'unverified', 5, 'Connection timeout.', [10]],
    ['s43', 30000, 'https://secure-login.example/sessions', 'url', 'high', 90, 'Blocked domain.', [9]],
    ['s44', 33500, 'https://github.com/community/discussions', 'url', 'low', 5, 'No suspicious activity detected.', [8]],
    ['s45', 37000, 'Payment reminder: your card ending 1186 expires soon — update it in the app to keep coverage.', 'message', 'medium', 30, 'Urgent language.', [2]],
    ['s46', 40500, 'http://slides deck.example/key', 'url', 'error', 0, DETAILS_MALFORMED, [11]],
    ['s47', 45000, 'Someone tried to open your inbox with your password — act now to protect your bank transfers: http://mail-shield.example/check', 'message', 'high', 85, 'Insecure HTTP link, urgent language, credential request.', [1, 2, 3]],
    ['s48', 50000, 'Insurance cover expires on the 30th; sign the renewal in the member center.', 'message', 'medium', 30, 'Urgent language.', [2]],
    ['s49', 55000, 'https://unknown-queue.test/queue/len', 'url', 'unverified', 5, 'Connection timeout.', [10]],
    ['s50', 60000, 'URGENT refill: your prescription pin expires today — confirm at http://refill-zone.example/secure.', 'message', 'high', 85, 'Insecure HTTP link, urgent language, credential request.', [1, 2, 3]],
    ['s51', 65000, 'https://ieee.org/about', 'url', 'low', 5, 'No suspicious activity detected.', [0]],
    ['s52', 70000, 'https://www.google.com/maps', 'url', 'low', 5, 'No suspicious activity detected.', [8]],
    ['s53', 75000, 'https://unknown-cache.example/purge', 'url', 'unverified', 5, 'Connection timeout.', [10]],
    ['s54', 79000, 'http://bank-security.example/update-cards', 'url', 'high', 90, 'Blocked domain.', [9]]
  ];

  function seedStatusFor(risk) {
    if (risk === 'unverified') { return 'not_verified'; }
    if (risk === 'error') { return 'error'; }
    return 'verified';
  }

  function seedRows() {
    var now = Date.now();
    var rows = [];
    for (var i = 0; i < SEEDS.length; i++) {
      var s = SEEDS[i];
      rows.push({
        id: s[0],
        input: s[2],
        type: s[3],
        risk: s[4],
        score: s[5],
        status: seedStatusFor(s[4]),
        details: s[6],
        reasons: s[7].map(function (n) { return R[n]; }),
        recommendation: RECOMMENDATIONS[s[4]] || RECOMMENDATIONS.low,
        ts: now - s[1] * 60000
      });
    }
    return rows;
  }

  function seedIds() {
    var ids = {};
    for (var i = 0; i < SEEDS.length; i++) { ids[SEEDS[i][0]] = true; }
    return ids;
  }

  /* ------------------------------------------------------------------ *
   * DAC.history (CONTRACT §6). Storage keys: 'dac_history' (user rows), *
   * 'dac_history_state' (seedsEnabled flag + excluded seed ids).        *
   * ------------------------------------------------------------------ */

  var KEY_HISTORY = 'history';
  var KEY_STATE = 'history_state';

  var transient = []; /* scans kept in this session when saveHistory is off */

  function stateRead() {
    var st = storageGet(KEY_STATE, null);
    if (!st || typeof st !== 'object') { st = {}; }
    if (typeof st.seedsEnabled !== 'boolean') { st.seedsEnabled = true; }
    if (!Array.isArray(st.excluded)) { st.excluded = []; }
    return st;
  }

  function userRowsRead() {
    var arr = storageGet(KEY_HISTORY, []);
    return Array.isArray(arr) ? arr.filter(function (r) { return r && typeof r === 'object'; }) : [];
  }

  function autoDeleteFilter(rows) {
    var days = setting('autoDeleteDays', DEFAULTS.autoDeleteDays);
    if (days === 'never' || !days) { return rows; }
    var n = parseInt(days, 10);
    if (!isFinite(n) || n <= 0) { return rows; }
    var cutoff = Date.now() - n * 86400000;
    return rows.filter(function (r) { return r.ts >= cutoff; });
  }

  function sortNewestFirst(rows) {
    /* deterministic: ts descending, then id ascending (plain string compare) */
    return rows.slice(0).sort(function (a, b) {
      if (a.ts !== b.ts) { return b.ts - a.ts; }
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
  }

  function normalizeResult(result) {
    var r = (result && typeof result === 'object') ? result : {};
    var out = {
      id: typeof r.id === 'string' && r.id ? r.id : 'u' + uuid(),
      input: typeof r.input === 'string' ? r.input : '',
      type: r.type === 'message' ? 'message' : 'url',
      risk: ['low', 'medium', 'high', 'unverified', 'error'].indexOf(r.risk) !== -1 ? r.risk : 'medium',
      score: typeof r.score === 'number' && isFinite(r.score) ? Math.max(0, Math.min(99, Math.round(r.score))) : 5,
      status: r.status === 'not_verified' || r.status === 'error' ? r.status : 'verified',
      details: typeof r.details === 'string' ? r.details : '',
      reasons: Array.isArray(r.reasons) ? r.reasons.filter(function (x) { return typeof x === 'string'; }).slice(0) : [],
      recommendation: typeof r.recommendation === 'string' ? r.recommendation : RECOMMENDATIONS.low,
      ts: typeof r.ts === 'number' && isFinite(r.ts) ? r.ts : Date.now()
    };
    return out;
  }

  function add(result) {
    var r = normalizeResult(result);
    if (!setting('saveHistory', DEFAULTS.saveHistory)) {
      transient.unshift(r); /* not persisted; still returned to the caller */
      return r;
    }
    var rows = userRowsRead();
    rows.unshift(r);
    storageSet(KEY_HISTORY, rows);
    return r;
  }

function addDeferred(result) {
    var r = normalizeResult(result);
    transient.unshift(r);
    return r;
  }

  function flush() {
    if (!setting('saveHistory', DEFAULTS.saveHistory)) { return; }
    if (transient.length === 0) { return; }
    var rows = userRowsRead();
    rows = transient.slice(0).concat(rows);
    storageSet(KEY_HISTORY, rows);
    transient = [];
  }

  try { window.addEventListener('pagehide', flush); } catch (e) { /* no window */ }

  function clear() {
    storageSet(KEY_HISTORY, []);
    storageSet(KEY_STATE, { seedsEnabled: false, excluded: [] });
    transient = [];
  }

  function restoreDemo() {
    storageSet(KEY_STATE, { seedsEnabled: true, excluded: [] });
    storageSet(KEY_HISTORY, []);
    transient = [];
  }

  function remove(id) {
    var removed = false;
    var rows = userRowsRead();
    var filtered = rows.filter(function (r) { return r.id !== id; });
    if (filtered.length !== rows.length) {
      storageSet(KEY_HISTORY, filtered);
      removed = true;
    }
    var before = transient.length;
    transient = transient.filter(function (r) { return r.id !== id; });
    if (transient.length !== before) { removed = true; }
    if (seedIds()[id]) {
      var st = stateRead();
      if (st.excluded.indexOf(id) === -1) { st.excluded = st.excluded.concat([id]); }
      storageSet(KEY_STATE, { seedsEnabled: st.seedsEnabled, excluded: st.excluded });
      removed = true;
    }
    return removed;
  }

  function activeSeeds() {
    var st = stateRead();
    if (!st.seedsEnabled) { return []; }
    var skip = {};
    for (var i = 0; i < st.excluded.length; i++) { skip[st.excluded[i]] = true; }
    return seedRows().filter(function (r) { return !skip[r.id]; });
  }

  function combined() {
    var rows = transient.slice(0).concat(autoDeleteFilter(userRowsRead()));
    rows = rows.concat(activeSeeds());
    return sortNewestFirst(rows);
  }

  function userScans() {
    return sortNewestFirst(transient.slice(0).concat(autoDeleteFilter(userRowsRead())));
  }

  ns.analyze = analyze;

  ns.history = {
    all: function () { return combined(); },
    userScans: function () { return userScans(); },
    add: add,
    addDeferred: addDeferred,
    flush: flush,
    clear: clear,
    restoreDemo: restoreDemo,
    remove: remove,
    length: function () { return combined().length; }
  };

  /* ------------------------------------------------------------------ *
   * DAC.csv (CONTRACT §6/§10C). Only DOM touch in this file: the        *
   * download anchor in exportDownload().                                *
   * ------------------------------------------------------------------ */

  function csvField(v) {
    var s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function parseText(text, opts) {
    var o = (opts && typeof opts === 'object') ? opts : {};
    var max = o.maxEntries;
    if (typeof max !== 'number' || !isFinite(max) || max <= 0) {
      max = parseInt(setting('maxCsvEntries', DEFAULTS.maxCsvEntries), 10) || DEFAULTS.maxCsvEntries;
    }

    if (typeof text !== 'string') {
      return { ok: false, error: 'empty', message: 'The file is empty or could not be read.', count: 0 };
    }
    var s = text.replace(/^\uFEFF/, ''); /* strip BOM */
    if (!s.trim()) {
      return { ok: false, error: 'empty', message: 'The file is empty or could not be read.', count: 0 };
    }

    /* keep permissive (CONTRACT §9 style): 'malformed' only when the file has
       neither commas nor newlines — i.e. it cannot be CSV-shaped at all */
    if (s.indexOf(',') === -1 && !/[\r\n]/.test(s)) {
      return {
        ok: false,
        error: 'malformed',
        message: 'The file does not look like a CSV file. Use one input per line; a header row is optional.',
        count: 0
      };
    }

    var lines = s.split(/\r\n|\r|\n/);
    var entries = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) { continue; } /* skip blank rows */
      var field = line.indexOf(',') === -1 ? line : line.slice(0, line.indexOf(','));
      field = field.trim();
      if (field.length >= 2 && field.charAt(0) === '"' && field.charAt(field.length - 1) === '"') {
        field = field.slice(1, -1); /* strip surrounding quotes */
      }
      field = field.trim();
      if (!field) { continue; }
      if (entries.length === 0 && field.toLowerCase() === 'input') { continue; } /* optional header row */
      entries.push(field);
    }

    if (!entries.length) {
      return { ok: false, error: 'empty', message: 'No entries were found in the file.', count: 0 };
    }
    if (entries.length > max) {
      return {
        ok: false,
        error: 'too_big',
        message: 'The file contains ' + entries.length + ' entries and the limit is ' + max +
          '. Split the file or raise the entry cap in Settings.',
        count: entries.length
      };
    }
    return { ok: true, entries: entries };
  }

  function buildCsv(rows) {
    /* Accepts Result objects (CONTRACT §6) or pre-built rows as arrays;
       when arrays are passed, the first array row is treated as the header. */
    var arr = Array.isArray(rows) ? rows : [];
    var lines = (arr.length > 0 && !Array.isArray(arr[0])) ? ['input,type,risk,score,status,details,ts'] : [];
    for (var i = 0; i < arr.length; i++) {
      var r = arr[i];
      if (Array.isArray(r)) { lines.push(r.map(csvField).join(',')); continue; }
      if (!r || typeof r !== 'object') { continue; }
      var ts = typeof r.ts === 'number' && isFinite(r.ts) ? new Date(r.ts).toISOString() : '';
      lines.push([
        csvField(r.input || ''),
        csvField(r.type || ''),
        csvField(r.risk || ''),
        csvField(typeof r.score === 'number' ? r.score : ''),
        csvField(r.status || ''),
        csvField(r.details || ''),
        csvField(ts)
      ].join(','));
    }
    return lines.join('\r\n');
  }

  function exportDownload(csvString, filename) {
    if (typeof document === 'undefined') { return false; }
    try {
      var blob = new Blob([String(csvString)], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename || 'threat_detector_export.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (err) {
      return false;
    }
  }

  /* 9-row sample (CONTRACT §10C): first column = input, second = risk label
     (decorative; ingest reads the first column only). */
  var SAMPLE_CSV = [
    'input,label',
    'https://payments-secure.example/verify-account,High risk',
    'Your account is locked! Verify your password now at http://bank-security.example/login,High risk',
    'https://unknown-check.example,Not verified',
    'https://developer.mozilla.org,Low risk',
    'http://192.0.2.5/admin,Medium risk',
    'Your package is delayed. Confirm your delivery address at https://parcel-track.example/update,Medium risk',
    'You won a free gift! Click here to claim your reward now at https://prize-draw.example/claim,High risk',
    'https://google.com,Low risk',
    'ht!tp://bad url,Error'
  ].join('\r\n');

  ns.csv = {
    parseText: parseText,
    buildCsv: buildCsv,
    exportDownload: exportDownload,
    downloadSample: function () { return exportDownload(SAMPLE_CSV, 'threat_samples.csv'); }
  };

  /* Small helper namespace used by pages and tests. */
  ns.engine = {
    thresholds: function () {
      var e = bandEdges();
      return { low: e.low, med: e.med, high: e.high };
    },
    isUrlLike: isUrlLike
  };
}());


/* ===== DAC SHARED CORE (JS) 3/3 — animated rings/shields/counters — identical on all pages ===== */
/* OWNER: Agent C (Visuals). DAC.visuals per CONTRACT §11; animation style per SPEC §12:
   transform / opacity / stroke-dashoffset ONLY. Vanilla ES2019, 'use strict', no libs,
   no console output, no network. Colors come from CSS tokens via inline style / currentColor
   only — never literal colors. Calls into DAC.* only inside functions (load-time safe). */
(function () {
  'use strict';

  /* ---------- namespace ---------- */
  window.DAC = window.DAC || {};
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---------- shared helpers ---------- */

  /* One active visual per container: re-calling a builder on the same container
     destroys the previous handle first, so double calls stay idempotent. */
  var claims = typeof WeakMap === 'function' ? new WeakMap() : null;

  function noop() {}

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (var key in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, key)) node.setAttribute(key, attrs[key]);
      }
    }
    return node;
  }

  function clearNode(node) {
    if (!node) return node;
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function resolveHost(container) {
    if (typeof container === 'string') return document.querySelector(container);
    return container && container.nodeType ? container : null;
  }

  /* Destroy whatever visual is currently registered on this node (safe/idempotent).
     The claim is deleted BEFORE invoking destroy so a handle whose destroy()/stop()
     calls unclaim() again cannot recurse. */
  function unclaim(host) {
    if (!claims || !host) return null;
    var prev = claims.get(host);
    if (!prev) return null;
    claims.delete(host);
    try { (prev.destroy || prev.stop || prev.cancel || noop).call(prev); } catch (err) { /* keep going */ }
    return prev;
  }

  function claim(host, handle) {
    if (claims && host) {
      unclaim(host);
      claims.set(host, handle);
    }
  }

  /* Read a --duration token off :root with units; fall back to a fixed ms value. */
  function tokenMs(name, fallbackMs) {
    var raw = '';
    try { raw = getComputedStyle(document.documentElement).getPropertyValue(name) || ''; } catch (err) { /* keep default */ }
    raw = raw.trim();
    var value = parseFloat(raw);
    if (!isFinite(value) || value < 0) return fallbackMs;
    if (raw.slice(-2) === 'ms') return value;
    if (raw.slice(-1) === 's') return value * 1000;
    return value;
  }

  function easeOutCubic(t) {
    var inv = 1 - t;
    return 1 - inv * inv * inv;
  }

  /* ---------- reduced motion ---------- */
  /* Settings toggle OR OS preference; DAC.settings is read inside the call only. */
  function reduceMotion() {
    var reduced = false;
    try {
      if (window.DAC && window.DAC.settings && typeof window.DAC.settings.get === 'function') {
        var pref = window.DAC.settings.get('reduceAnimations');
        reduced = pref === true || pref === 'reduced'; // local stubs may use strings; core uses boolean
      }
    } catch (err) { /* storage off — fall through to media query */ }
    if (!reduced) {
      try {
        reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      } catch (err) { /* matchMedia unavailable */ }
    }
    return !!reduced;
  }

  /* ============================================================
     SCORE RING — scoreRing(container, score, risk) → { destroy() }
     SVG donut: track + progress arc (stroke-dashoffset) drawn 0→score over ~1000ms
     ease-out, .ring-num counts up in sync. risk low/medium/high picks the risk token;
     anything else (incl. unverified/error) falls back to --na. Reduced motion → static.
     Edge case: score 0 renders a full track (arc hidden) instead of an empty box.
     ============================================================ */
  var RING_R = 52; /* viewBox 0 0 120 120 */

  function riskColor(risk) {
    var name = String(risk || '').toLowerCase();
    if (name === 'low') return 'var(--low)';
    if (name === 'medium') return 'var(--medium)';
    if (name === 'high') return 'var(--high)';
    return 'var(--na)'; /* unverified | error | missing */
  }

  function scoreRing(container, score, risk) {
    var host = resolveHost(container);
    var handle = { destroy: noop };

    if (!host) return handle;

    unclaim(host);
    clearNode(host);

    var s = Math.round(Number(score) || 0);
    s = Math.max(0, Math.min(100, s));
    var color = riskColor(risk);

    var reuseWrap = host.nodeType === 1 && host.classList.contains('ring-wrap');
    var owner = reuseWrap ? host : document.createElement('div');
    if (!reuseWrap) {
      owner.className = 'ring-wrap';
      host.appendChild(owner);
    }

    var svg = svgEl('svg', {
      'class': 'ring-svg',
      viewBox: '0 0 120 120',
      role: 'img',
      'aria-label': 'Risk score ' + s + ' out of 100',
      focusable: 'false'
    });
    var track = svgEl('circle', {
      'class': 'ring-track',
      cx: '60', cy: '60', r: String(RING_R),
      style: 'stroke: var(--border-strong)'
    });
    var arc = svgEl('circle', {
      'class': 'ring-arc',
      cx: '60', cy: '60', r: String(RING_R),
      pathLength: '1',
      'stroke-dasharray': '1',
      'stroke-dashoffset': '1',
      'stroke-linecap': 'round',
      transform: 'rotate(-90 60 60)',
      style: 'stroke: ' + color
    });
    var num = document.createElement('span');
    num.className = 'ring-num';
    num.setAttribute('aria-hidden', 'true');
    num.textContent = '0%';

    svg.appendChild(track);
    svg.appendChild(arc);
    owner.appendChild(svg);
    owner.appendChild(num);

    var cancelled = false;
    var raf = 0;
    var bail = 0;
    var dur = reduceMotion() ? 0 : tokenMs('--dur-draw', 1000);
    var end = s / 100; /* final arc fraction — the ring shows the score, not 100% */

    function paint(progress) {
      arc.setAttribute('stroke-dashoffset', String(1 - progress * end));
      num.textContent = Math.round(progress * s) + '%';
    }

    function settle() {
      paint(1);
      num.textContent = s + '%'; /* exact final value */
    }

    function finish() {
      cancelled = true;
      if (bail) { clearTimeout(bail); bail = 0; }
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    if (dur <= 0) {
      /* Reduced motion: land on the exact final state immediately. */
      settle();
    } else {
      var started = 0;
      function tick(now) {
        if (cancelled) return;
        if (!started) started = now;
        var t = Math.min(1, (now - started) / dur);
        paint(easeOutCubic(t));
        if (t >= 1) {
          settle();
          finish();
          return;
        }
        raf = requestAnimationFrame(tick);
      }
      /* Settle even if frames stop (background tab, occluded window). */
      bail = window.setTimeout(function () {
        if (cancelled) return;
        settle();
        finish();
      }, dur + 60);
      raf = requestAnimationFrame(tick);
    }

    handle = {
      destroy: function () {
        finish(); /* leaves the current (final) state visible; safe to call twice */
      }
    };
    claim(host, handle);
    return handle;
  }

  /* ============================================================
     CHECK CIRCLE — checkCircle(container) → { destroy() }
     Circle stroke draws (0 → closed, ~700ms ease-out, clockwise from 12 o'clock via
     rotate(-90)), then the check path draws (~350ms) with a subtle scale pop (.is-pop).
     The draw starts only once the visual is actually on screen (IntersectionObserver
     gate, immediate fallback) and replays on every fresh mount. Dash math uses
     pathLength="1" so values stay scale-independent. Reduced motion → instant final
     state, no pop.
     ============================================================ */
  var SAFE_R = 34; /* viewBox 0 0 96 96 */
  var safeGradCounter = 0;
  var CHECK_D = 'M30.5 47 L42 58.5 L65.5 35.5'; /* centered + raised ~2% of ring diameter */

  function checkCircle(container) {
    var host = resolveHost(container);
    var handle = { destroy: noop };

    if (!host) return handle;

    unclaim(host);
    clearNode(host);

    var wrap = document.createElement('div');
    wrap.className = 'ring-safe-wrap';

    var svg = svgEl('svg', { 'class': 'safe-svg', viewBox: '0 0 96 96', 'aria-hidden': 'true', focusable: 'false' });

    var gradId = 'safe-grad-' + (++safeGradCounter);
    var defs = svgEl('defs', {});
    var grad = svgEl('linearGradient', { id: gradId, x1: '0%', y1: '0%', x2: '100%', y2: '100%' });
    var stop1 = svgEl('stop', { offset: '0%', 'stop-color': 'color-mix(in srgb, var(--low) 88%, white)' });
    var stop2 = svgEl('stop', { offset: '100%', 'stop-color': 'var(--low)' });
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);
    svg.appendChild(defs);

    var track = svgEl('circle', {
      'class': 'safe-track',
      cx: '48', cy: '48', r: String(SAFE_R)
    });

    var circle = svgEl('circle', {
      'class': 'safe-circle',
      cx: '48', cy: '48', r: String(SAFE_R),
      pathLength: '1',
      'stroke-dasharray': '1',
      'stroke-dashoffset': '1',
      transform: 'rotate(-90 48 48)',
      'data-anim-draw': 'circle',
      stroke: 'url(#' + gradId + ')'
    });

    var check = svgEl('path', {
      'class': 'safe-check',
      d: CHECK_D,
      pathLength: '1',
      'stroke-dasharray': '1',
      'stroke-dashoffset': '1',
      'data-anim-draw': 'check'
    });

    svg.appendChild(track);
    svg.appendChild(circle);
    svg.appendChild(check);
    wrap.appendChild(svg);
    host.appendChild(wrap);

    var cancelled = false;
    var started = false;
    var raf = 0;
    var bail = 0;
    var io = null;

    function finish() {
      cancelled = true;
      if (io) { io.disconnect(); io = null; }
      if (bail) { clearTimeout(bail); bail = 0; }
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    function draw(el, duration, settle) {
      var began = 0;
      var done = false;
      function complete() {
        if (done || cancelled) return;
        done = true;
        if (bail) { clearTimeout(bail); bail = 0; }
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        el.setAttribute('stroke-dashoffset', '0.001');
        settle();
      }
      function tick(now) {
        if (cancelled || done) return;
        if (!began) began = now;
        var t = (now - began) / duration;
        if (t >= 1) { complete(); return; }
        el.setAttribute('stroke-dashoffset', String(1 - easeOutCubic(t)));
        raf = requestAnimationFrame(tick);
      }
      /* End the draw even if frames stop (background tab, occluded window). */
      bail = window.setTimeout(function () {
        if (cancelled) return;
        complete();
      }, duration + 60);
      raf = requestAnimationFrame(tick);
    }

    function begin() {
      if (started || cancelled) return;
      started = true;
      if (io) { io.disconnect(); io = null; }
      if (reduceMotion()) {
        /* Reduced motion: land on the exact final state immediately. */
        circle.setAttribute('stroke-dashoffset', '0');
        check.setAttribute('stroke-dashoffset', '0');
        return;
      }
      wrap.classList.add('is-pop'); /* scale pop rides along with the draw */
      draw(circle, 700, function () {
        if (cancelled) return;
        draw(check, 350, finish);
      });
    }

    /* Start the draw only when the card is actually visible, so the animation is
       never spent off-screen and every fresh mount replays in full. */
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver(function (entries) {
        for (var j = 0; j < entries.length; j++) {
          if (entries[j].isIntersecting) { begin(); return; }
        }
      });
      io.observe(wrap);
    } else {
      begin();
    }

    handle = {
      destroy: function () {
        finish(); /* keeps whatever was reached; safe to call twice */
      }
    };
    claim(host, handle);
    return handle;
  }

  /* ============================================================
     SCANNER — scanner(container) → { stop(), destroy() }
     Spinning arc, 1s linear infinite, driven purely by CSS: JS adds .is-spinning when
     motion is allowed and toggles nothing else. Reduced motion → static ring.
     destroy() removes the rendered node; stop aliases destroy per contract.
     ============================================================ */
  var SCAN_R = 40; /* viewBox 0 0 96 96 */
  var SCAN_CIRC = 2 * Math.PI * SCAN_R;
  var SCAN_DASH = SCAN_CIRC * 0.72; /* arc sweep ~72% */

  function scanner(container) {
    var host = resolveHost(container);
    var api = { stop: noop, destroy: noop };

    if (!host) return api;

    unclaim(host);
    clearNode(host);

    var el = document.createElement('div');
    el.className = 'scan-ring';

    var svg = svgEl('svg', { viewBox: '0 0 96 96', 'aria-hidden': 'true', focusable: 'false' });
    svg.appendChild(svgEl('circle', {
      'class': 'scan-track',
      cx: '48', cy: '48', r: String(SCAN_R),
      style: 'stroke: var(--border-strong)'
    }));
    svg.appendChild(svgEl('circle', {
      'class': 'scan-arc',
      cx: '48', cy: '48', r: String(SCAN_R),
      'stroke-dasharray': SCAN_DASH + ' ' + (SCAN_CIRC - SCAN_DASH),
      style: 'stroke: var(--accent)'
    }));

    el.appendChild(svg);
    host.appendChild(el);

    /* CSS-driven: class only added when animating is allowed. */
    if (!reduceMotion()) el.classList.add('is-spinning');

    function stop() {
      unclaim(host); /* registration removed first (no recursion) */
      if (el.parentNode) el.parentNode.removeChild(el); /* spinning arc removed on destroy */
    }

    api = { stop: stop, destroy: stop };
    claim(host, api);
    return api;
  }

  /* ============================================================
     SHIELD — shield(container, state) → { destroy() }
     state 'secure'|'caution'|'threat' → shield outline SVG inside a pulsing glow ring,
     colored green/amber/red via tokens. Glyphs keep the brand outline style
     (stroke currentColor 1.7, round caps, 24 viewBox, shield path per CONTRACT §12).
     'secure' shows the check; caution/threat show a warning mark inside the shield so
     state remains icon+color+page-text (see report note). Reduced motion → static ring.
     ============================================================ */
  var SHIELD_BODY = 'M12 2.2 20 5.1v5.4c0 4.7-3.2 8.5-8 9.8-4.8-1.3-8-5.1-8-9.8V5.1Z';
  var SHIELD_CHECK = 'M8 12.2 10.7 14.9 16 9.1';

  function shield(container, state) {
    var host = resolveHost(container);
    var api = { destroy: noop };

    if (!host) return api;

    unclaim(host);
    clearNode(host);

    var name = String(state || 'secure').toLowerCase();
    if (name !== 'secure' && name !== 'caution' && name !== 'threat') name = 'caution';

    var colorFor = { secure: 'var(--low)', caution: 'var(--medium)', threat: 'var(--high)' };

    var wrap = document.createElement('div');
    wrap.className = 'shield-wrap';
    wrap.setAttribute('data-state', name);
    wrap.setAttribute('style', 'color: ' + colorFor[name]);

    var glow = document.createElement('div');
    glow.className = 'shield-glow';
    glow.setAttribute('aria-hidden', 'true');

    var pulse = document.createElement('div');
    pulse.className = 'pulse-ring';
    pulse.setAttribute('aria-hidden', 'true');

    var svg = svgEl('svg', { 'class': 'shield-svg', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });

    svg.appendChild(svgEl('path', {
      'class': 'shield-outline',
      d: SHIELD_BODY,
      stroke: 'currentColor',
      'stroke-width': '1.7',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    }));

    if (name === 'secure') {
      svg.appendChild(svgEl('path', {
        'class': 'shield-check',
        d: SHIELD_CHECK,
        stroke: 'currentColor',
        'stroke-width': '1.7',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      }));
    } else {
      /* warning mark: line + dot, same outline language as the nav info glyph */
      svg.appendChild(svgEl('path', {
        'class': 'shield-alert',
        d: 'M12 8.6v4.2M12 15.4h.01',
        stroke: 'currentColor',
        'stroke-width': '1.7',
        'stroke-linecap': 'round'
      }));
    }

    wrap.appendChild(glow);
    wrap.appendChild(svg);
    wrap.appendChild(pulse);
    host.appendChild(wrap);

    /* CSS-driven pulse loop; static soft ring when motion is reduced. */
    if (!reduceMotion()) wrap.classList.add('is-pulsing');

    api = {
      destroy: function () {
        unclaim(host);
      }
    };
    claim(host, api);
    return api;
  }

  /* ============================================================
     NOT-VERIFIED RING — unverifiedRing(container) → { destroy() }
     Static dashed ring in the neutral --na tone with a warning-triangle glyph
     inside (the same GLYPH.alert the status lines use). Used wherever a result
     could not be verified: no percentage, no green — never reads as "safe".
     ============================================================ */
  function unverifiedRing(container) {
    var host = resolveHost(container);
    var handle = { destroy: noop };

    if (!host) return handle;

    unclaim(host);
    clearNode(host);

    host.classList.add("unv-ring");
    var glyphs = window.DAC && window.DAC.glyphs;
    var svg = svgEl("svg", { "class": "unv-svg", viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" });
    svg.appendChild(svgEl("circle", { "class": "unv-track", cx: "12", cy: "12", r: "9.4" }));
    if (glyphs && Array.isArray(glyphs.alert)) {
      /* GLYPH.alert specs are trusted constants; scaled to sit inside the ring */
      var g = svgEl("g", { transform: "translate(5.4 5.4) scale(0.55)" });
      for (var i = 0; i < glyphs.alert.length; i++) {
        var spec = glyphs.alert[i];
        var p = svgEl(spec.tag || "path", {});
        for (var a in spec) { if (a !== "tag") { p.setAttribute(a, spec[a]); } }
        g.appendChild(p);
      }
      svg.appendChild(g);
    }
    host.appendChild(svg);

    handle = {
      destroy: function () {
        if (host) { clearNode(host); host.classList.remove("unv-ring"); }
      }
    };
    claim(host, handle);
    return handle;
  }

  /* ============================================================
     COUNT UP — countUp(el, n, options) → { cancel() }
     rAF count with integer display; pad>0 zero-pads ("05"). Reduced motion → instant.
     cancel freezes the current value; safe to call twice.
     ============================================================ */
  function countUp(el, n, options) {
    var node = resolveHost(el);
    var handle = { cancel: noop };

    if (!node) return handle;

    unclaim(node);

    var opts = options || {};
    var target = Math.round(Number(n) || 0);
    var duration = opts.duration == null ? 800 : Math.max(0, Number(opts.duration) || 0);
    var pad = Math.max(0, Number(opts.pad) || 0);

    function paint(value) {
      node.textContent = pad > 0 ? String(value).padStart(pad, '0') : String(value);
    }

    if (duration <= 0 || reduceMotion()) {
      paint(target); /* instant final */
    } else {
      var cancelled = false;
      var started = 0;
      var raf = 0;

      function finish() {
        cancelled = true;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      }

      function tick(now) {
        if (cancelled) return;
        if (!started) started = now;
        var t = Math.min(1, (now - started) / duration);
        paint(Math.round(easeOutCubic(t) * target));
        if (t >= 1) {
          paint(target); /* exact final value */
          finish();
          return;
        }
        raf = requestAnimationFrame(tick);
      }
      raf = requestAnimationFrame(tick);

      handle = {
        cancel: function () {
          finish(); /* keeps the number reached; safe to call twice */
        }
      };
    }

    claim(node, handle);
    return handle;
  }

  /* ---------- public API (CONTRACT §11, exact names) ---------- */
  window.DAC.visuals = {
    reduceMotion: reduceMotion,
    scoreRing: scoreRing,
    checkCircle: checkCircle,
    unverifiedRing: unverifiedRing,
    scanner: scanner,
    shield: shield,
    countUp: countUp
  };
}());

/* ===== /DAC SHARED CORE (JS) ===== */

