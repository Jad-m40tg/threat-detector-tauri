/* ===== TD.services.update — "Download and install" navbar button ===== */
/* Owns the update check (Rust check_update / browser mock), the in-memory cache,
   the 6-hour recheck, and the navbar button itself. DAC.ui.boot calls mount()
   with the .nav-actions container; the button is inserted only when a newer
   release exists or the dev "Force show" toggle is on.
   Settings (TDSettings, registered in js/settings.js): td.upd.force, td.upd.animMs,
   td.upd.width, td.upd.repo. The CSS variables --upd-ms and --upd-w live on <html>
   and are re-applied here so the dev sliders change the button live. */
(function () {
  "use strict";
  window.TD = window.TD || {};
  TD.services = TD.services || {};

  var DEF = { animMs: 550, width: 249 };
  var CHECK_EVERY = 6 * 60 * 60 * 1000; /* recheck every 6 hours while running */
  var MOCK_VERSION = "9.9.9";

  var state = { result: null, checked: false, checkedAt: 0 };
  var inflight = null;
  var container = null;
  var btn = null;
  var timer = null;
  var wired = false;

  function TS() { return window.TDSettings || null; }

  function setting(key, fallback) {
    var t = TS();
    if (!t || typeof t.get !== "function") { return fallback; }
    var v = null;
    try { v = t.get(key); } catch (e) { v = null; }
    return (v === null || v === undefined) ? fallback : v;
  }

  function num(key, fallback) {
    var n = parseInt(setting(key, ""), 10);
    return isFinite(n) ? n : fallback;
  }

  function forceOn() { return String(setting("upd.force", "false")) === "true"; }

  function repoName() {
    var v = String(setting("upd.repo", "") || "").trim();
    return v.length ? v : null;
  }

  function isMock() {
    try { return /(?:^|[?&])updatemock=1(?:&|$)/.test(window.location.search); }
    catch (e) { return false; }
  }

  function tauriInvoke() {
    var api = window.__TAURI__ || {};
    var core = api.core || {};
    return (typeof core.invoke === "function") ? core.invoke : null;
  }

  /* ---------------- adapters ---------------- */
  function mockAdapter() {
    return {
      __name: "mock",
      check: function () {
        if (!isMock()) { return Promise.resolve(null); }
        return Promise.resolve({
          version: MOCK_VERSION,
          currentVersion: "0.1.0",
          installerUrl: "https://github.com/example/threat-detector/releases/download/v" +
            MOCK_VERSION + "/ThreatDetector-setup.exe"
        });
      },
      open: function () { return Promise.resolve(false); }
    };
  }

  function tauriAdapter() {
    return {
      __name: "tauri",
      check: function (repo) {
        var invoke = tauriInvoke();
        if (!invoke) { return Promise.resolve(null); }
        return invoke("check_update", { repo: repo }).catch(function () { return null; });
      },
      open: function (url) {
        var invoke = tauriInvoke();
        if (!invoke) { return Promise.resolve(false); }
        return invoke("open_installer", { url: url })
          .then(function () { return true; })
          .catch(function () { return false; });
      }
    };
  }

  function impl() {
    var name = "mock";
    try { name = (TD.config && TD.config.backend) || "mock"; } catch (e) { name = "mock"; }
    return name === "tauri" ? tauriAdapter() : mockAdapter();
  }

  /* ---------------- update check + cache ---------------- */
  function check(force) {
    if (inflight && !force) { return inflight; }
    var run = impl().check(repoName());
    inflight = run.then(function (res) {
      state.result = (res && res.version && res.installerUrl) ? res : null;
      state.checked = true;
      state.checkedAt = Date.now();
      inflight = null;
      announce();
      return state.result;
    }).catch(function () {
      state.result = null;
      state.checked = true;
      state.checkedAt = Date.now();
      inflight = null;
      announce();
      return null;
    });
    return inflight;
  }

  function announce() {
    try { document.dispatchEvent(new CustomEvent("td:update-checked")); }
    catch (e) { /* events unavailable: status line simply stays put */ }
  }

  /* ---------------- CSS variables ---------------- */
  function applyVars() {
    try {
      var root = document.documentElement;
      root.style.setProperty("--upd-ms", num("upd.animMs", DEF.animMs) + "ms");
      root.style.setProperty("--upd-w", num("upd.width", DEF.width) + "px");
    } catch (e) { /* no documentElement: nothing to style */ }
  }

  /* The pill may never be narrower than its own label: measure once and expose
     the floor as --upd-min (icon 22 + gap 10 + label + 2 x 12px side padding). */
  function paintMinWidth() {
    if (!btn) { return; }
    var label = btn.querySelector(".update-btn__label");
    if (!label) { return; }
    var w = label.scrollWidth || label.offsetWidth || 0;
    if (w > 0) { btn.style.setProperty("--upd-min", (w + 56) + "px"); }
  }

  /* ---------------- button ---------------- */
  function visible() { return forceOn() || !!state.result; }

  function updateAria() {
    if (!btn) { return; }
    var v = (state.result && state.result.version) ? state.result.version : MOCK_VERSION;
    btn.setAttribute("aria-label", "Download and install the update, version " + v);
  }

  function makeButton() {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "navlink update-btn";

    var ico = document.createElement("span");
    ico.className = "update-btn__ico";
    ico.setAttribute("aria-hidden", "true");
    ico.appendChild(DAC.svgGlyph(DAC.glyphs.download, null, { class: "nav-ico" }));

    var label = document.createElement("span");
    label.className = "update-btn__label";
    label.textContent = "Download and install";

    b.appendChild(ico);
    b.appendChild(label);

    b.addEventListener("click", function () {
      if (!state.result) {
        if (DAC.ui && typeof DAC.ui.toast === "function") {
          DAC.ui.toast("Preview only", {
            type: "info",
            variant: "settings",
            description: "Shown only when a newer release exists"
          });
        }
        return;
      }
      impl().open(state.result.installerUrl);
    });
    return b;
  }

  function sync() {
    if (!container) { return; }
    var want = visible();
    if (want && !btn) {
      btn = makeButton();
      container.insertBefore(btn, container.firstChild); /* first, before Home */
      updateAria();
      paintMinWidth();
      applyVars();
    } else if (!want && btn) {
      if (btn.parentNode) { btn.parentNode.removeChild(btn); }
      btn = null;
    } else if (btn) {
      updateAria();
    }
  }

  function wireSettings() {
    if (wired) { return; }
    var t = TS();
    if (!t || typeof t.onChange !== "function") { return; }
    wired = true;
    try {
      t.onChange(function (e) {
        var key = e && e.detail && e.detail.key;
        if (!key || key.indexOf("upd.") !== 0) { return; }
        applyVars();
        sync();
        paintMinWidth();
      });
    } catch (e2) { /* listener registration is best-effort */ }
  }

  function mount(actions) {
    if (!actions || !window.DAC) { return; }
    container = actions;
    wireSettings();
    applyVars();
    sync();
    if (!state.checked && !inflight) {
      check(false).then(function () { sync(); });
    }
    if (!timer) {
      timer = window.setInterval(function () {
        check(true).then(function () { sync(); });
      }, CHECK_EVERY);
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { paintMinWidth(); }).catch(function () {});
    }
  }

  /* ---------------- status text (dev "Check now") ---------------- */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function clock(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function describe() {
    if (!state.checked) { return "Not checked yet"; }
    var r = state.result;
    if (!r) { return "No update"; }
    var head = r.currentVersion
      ? "Current " + r.currentVersion + ", latest " + r.version
      : "Latest " + r.version;
    return state.checkedAt ? head + ", checked " + clock(state.checkedAt) : head;
  }

  function checkNow() {
    return check(true).then(function () { sync(); return describe(); });
  }

  TD.services.update = {
    mount: mount,
    check: function () { return check(false); },
    checkNow: checkNow,
    describe: describe,
    getState: function () {
      return { result: state.result, checked: state.checked, checkedAt: state.checkedAt };
    }
  };
})();
