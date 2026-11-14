/* ===== PAGE: settings ===== */
(function () {
  'use strict';

  /* Boot the shared shell FIRST (CONTRACT §6): navbar, legend, toasts, footer. */
  DAC.ui.boot({ page: 'settings' });

  var S = DAC.settings;

  function $(id) { return document.getElementById(id); }

  /* ---------- commit + save toast (user actions only; onChange never toasts) ----------
     [E] informative copy + ONE shared dedupe key ("settings"): rapid changes update a
     single toast in place (x-counter + timer reset) instead of stacking duplicates. */

  var SET_LABEL = {
    theme: 'Theme', darkBg: 'Background', accent: 'Accent', textSize: 'Text size',
    density: 'Density', sensitivity: 'Sensitivity', defaultInputMode: 'Default input',
    scanSpeed: 'Scan speed', resultTiming: 'Result timing', maxCsvEntries: 'CSV limit', autoDeleteDays: 'Auto-delete',
    timeFormat: 'Time format'
  };
  var SET_VALUE_TXT = {
    oled: 'OLED black', grey: 'Dark grey', small: 'Small', medium: 'Medium', large: 'Large',
    comfortable: 'Comfortable', compact: 'Compact', relaxed: 'Relaxed', balanced: 'Balanced',
    strict: 'Strict', single: 'Single URL', csv: 'CSV', fast: 'Fast', normal: 'Normal',
    slow: 'Slow', fixed: 'After animation', instant: 'Instant',
    never: 'Never', '12h': '12-hour', '24h': '24-hour'
  };
  var SWITCH_TXT = {
    reduceAnimations: 'Reduce animations', showHero: 'Hero banner', autoOpenDetails: 'Auto-open details',
    saveHistory: 'Save history', maskSensitive: 'Mask sensitive data', notifyHighRisk: 'High-risk alerts',
    soundAlert: 'Sound alerts', dailySummary: 'Daily summary'
  };
  var DETECTOR_TXT = {
    httpInsecure: 'Insecure HTTP links', urgentLanguage: 'Urgent language',
    credentialRequests: 'Credential requests', ipHostname: 'IP hostnames',
    shorteners: 'URL shorteners', lookalikes: 'Lookalike domains'
  };

  function capFirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function saveMessage(key, value) {
    if (SWITCH_TXT[key]) return SWITCH_TXT[key] + ' turned ' + (value ? 'on' : 'off');
    if (key === 'theme') return 'Theme set to ' + capFirst(String(value));
    if (key === 'accent') return 'Accent set to ' + capFirst(String(value));
    if (key === 'sensitivity') return 'Sensitivity: ' + capFirst(String(value));
    if (key === 'defaultInputMode') return 'Default input: ' + (value === 'csv' ? 'CSV' : value === 'single' ? 'Single URL' : capFirst(String(value)));
    if (key === 'maxCsvEntries') return 'CSV limit: ' + String(value) + ' rows';
    if (key === 'autoDeleteDays') return 'Auto-delete: ' + (value === 'never' ? 'Never' : String(value) + ' days');
    var val = SET_VALUE_TXT[String(value)] || capFirst(String(value));
    return (SET_LABEL[key] || key) + ' set to ' + val;
  }

  /* ---------- Task 3 (C↔G): theme + dark-bg morphs through TDTheme ----------
     Persistence stays exactly as today: commit() → S.set applies the attribute
     directly. When TDTheme is present, the attribute is then briefly restored to
     its previous value so the view transition captures the correct OLD frame, and
     TDTheme.apply/applyBackground animates to the settled value (TDTheme never
     persists). Without TDTheme the flow is byte-for-byte today's behaviour. The
     restore is required: a same-task re-assert leaves old===new and the circular
     reveal renders nothing (verified with slowed-reveal screenshots). */
  var lastPickPoint = null; /* capture-phase click point → reveal origin; null (keyboard) → center */
  var tdSettled = Object.create(null); /* attr name → value the store expects live */
  var tdSettleTimer = 0;
  var tdSettleRetries = 0; /* bounded retry while td-switching is set */

  document.addEventListener('click', function (e) {
    lastPickPoint = e.detail === 0 ? null : { clientX: e.clientX, clientY: e.clientY };
  }, true);
  document.addEventListener('keydown', function () {
    lastPickPoint = null; /* keyboard activation → viewport-center reveal */
  }, true);

  /* One-shot reconciliation: a skipped view transition from a very fast toggle can
     still run its update callback and write a stale value; 80ms later the settled
     value is re-asserted (live DOM only — storage/listeners were already exact). */
  function tdSettleLater() {
    try {
      if (tdSettleTimer) { window.clearTimeout(tdSettleTimer); }
      tdSettleTimer = window.setTimeout(function () {
        tdSettleTimer = 0;
        try {
          var root = document.documentElement;
          /* Snap fix 2.4: never reconcile while a theme switch is animating
             (an attribute write mid-reveal re-renders the new snapshot layer);
             retry once the switch ends. Also: this path only setAttribute —
             it never calls TDTheme.apply or skipTransition. */
          if (root.classList && root.classList.contains("td-switching")) {
            if (tdSettleRetries < 10) { tdSettleRetries += 1; tdSettleLater(); }
            return;
          }
          tdSettleRetries = 0;
          for (var name in tdSettled) {
            if (Object.prototype.hasOwnProperty.call(tdSettled, name) &&
                root.getAttribute(name) !== tdSettled[name]) {
              root.setAttribute(name, tdSettled[name]);
            }
          }
        } catch (e2) { /* reconciliation is cosmetic only */ }
      }, 80);
    } catch (e3) { /* timers unavailable: nothing to reconcile */ }
  }

  function tdMorph(key, value, name, prev) {
    try {
      var root = document.documentElement;
      var settled = root.getAttribute(name); /* what S.set just applied */
      if (settled === null) return;
      tdSettled[name] = settled;
      if (prev !== null && prev !== settled) {
        root.setAttribute(name, prev); /* OLD frame for the transition */
        var p = (key === 'theme')
          ? window.TDTheme.apply(value, lastPickPoint)
          : window.TDTheme.applyBackground(value, lastPickPoint);
        tdSettleLater();
        return (p && typeof p.then === 'function') ? p : Promise.resolve();
      }
      tdSettleLater();
      return Promise.resolve();
    } catch (e) { /* the animation layer must never block persistence */ }
  }

  function commit(key, value, opts) {
    var morphName = null;
    var morphPrev = null;
    if (window.TDTheme && (key === 'theme' || key === 'darkBg')) {
      morphName = key === 'theme' ? 'data-theme' : 'data-bg';
      try { morphPrev = document.documentElement.getAttribute(morphName); } catch (eM) { morphPrev = null; }
    }

    S.set(key, value);

    function showToast() {
      DAC.ui.toast((opts && opts.toastText) || saveMessage(key, value),
        { type: 'success', key: 'settings', timeout: 4000 });
    }

    if (morphName !== null) {
      var p = tdMorph(key, value, morphName, morphPrev);
      if (p && typeof p.then === 'function') {
        p.then(showToast, showToast);
      } else {
        showToast();
      }
    } else {
      showToast();
    }
  }

  /* ---------- segmented groups (role=radiogroup + role=radio, roving tabindex) ---------- */

  function initRadioGroup(el, onPick) {
    var radios = Array.prototype.slice.call(el.querySelectorAll('[data-value]'));

    function paint(target) {
      radios.forEach(function (r) {
        var on = r === target;
        r.classList.toggle('is-active', on);
        r.setAttribute('aria-checked', on ? 'true' : 'false');
        r.tabIndex = on ? 0 : -1;
      });
    }

    function pick(target, moveFocus) {
      if (!target) return;
      paint(target);
      if (moveFocus) target.focus();
      onPick(target.getAttribute('data-value'));
    }

    el.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-value]') : null;
      if (btn && el.contains(btn)) pick(btn, false);
    });

    el.addEventListener('keydown', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-value]') : null;
      if (!btn) return;
      var i = radios.indexOf(btn);
      var n = radios.length;
      var j = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + n) % n;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = n - 1;
      if (j !== null) { e.preventDefault(); pick(radios[j], true); }
    });

    return {
      sync: function (value) {
        var want = String(value);
        var hit = null;
        radios.forEach(function (r) { if (r.getAttribute('data-value') === want) hit = r; });
        if (hit) { paint(hit); return; }
        /* Unknown/absent value: keep the group keyboard-reachable via the first radio */
        radios.forEach(function (r, idx) { r.tabIndex = idx === 0 ? 0 : -1; });
      }
    };
  }

  /* [elementId, settingsKey, value parser?] */
  var SEGS = [
    ['set-theme', 'theme', null],
    ['set-darkbg', 'darkBg', null],
    ['set-accent', 'accent', null],
    ['set-textsize', 'textSize', null],
    ['set-density', 'density', null],
    ['set-sensitivity', 'sensitivity', null],
    ['set-defaultmode', 'defaultInputMode', null],
    ['set-scanspeed', 'scanSpeed', null],
    ['set-resulttiming', 'resultTiming', null],
    ['set-maxcsv', 'maxCsvEntries', function (v) { return parseInt(v, 10); }],
    ['set-autodelete', 'autoDeleteDays', null],
    ['set-timeformat', 'timeFormat', null]
  ];

  var segSync = {};
  SEGS.forEach(function (def) {
    var el = $(def[0]);
    if (!el) return;
    if (el.classList.contains('seg') && typeof el._segSet === 'function') {
      /* [B] thumb segmented control: clicks arrive via seg-change (initSeg owns
         aria/tabindex/thumb); external updates (load, Reset, saved settings)
         re-place the thumb via _segSet — the control is never re-rendered. */
      el.addEventListener('seg-change', function (e) {
        var val = e && e.detail ? e.detail.value : null;
        if (val === null || val === undefined) return;
        commit(def[1], def[2] ? def[2](val) : val);
      });
      segSync[def[0]] = { sync: function (value) { el._segSet(String(value)); } };
    } else {
      segSync[def[0]] = initRadioGroup(el, function (val) {
        commit(def[1], def[2] ? def[2](val) : val);
      });
    }
  });

  /* ---------- Task 3: Progress speed + Navbar selected style (TDSettings, td.* keys) ----------
     Deliberately NOT in the SEGS/dac_ table (CONTRACT §2.1): the source of truth is
     window.TDSettings. Without the module these controls are a safe no-op. */
  var TD = window.TDSettings || null;

  function initTdSeg(segId, key, label) {
    var el = $(segId);
    if (!el || typeof el._segSet !== 'function') return;
    el.addEventListener('seg-change', function (e) {
      var val = e && e.detail ? e.detail.value : null;
      if (val === null || val === undefined) return;
      if (!TD) return; /* safe no-op when js/settings.js is absent */
      var ok = false;
      try { ok = TD.set(key, val) === true; } catch (e2) { ok = false; }
      if (ok) {
        DAC.ui.toast(label + ' set to ' + capFirst(String(val)),
          { type: 'success', key: 'settings', timeout: 4000 });
      } else {
        el._segSet(String(TD.get(key))); /* snap the UI back to the stored value */
      }
    });
    var current = TD ? TD.get(key) : null;
    if (current !== null && current !== undefined) { el._segSet(String(current)); }
  }

  /* External td.* updates (any future writer): UI-only re-sync, never a toast. */
  if (TD && typeof TD.onChange === 'function') {
    TD.onChange(function (e) {
      var d = e && e.detail ? e.detail : null;
      if (!d) return;
      var el = d.key === 'progressSpeed' ? $('set-speed')
        : d.key === 'navStyle' ? $('set-navstyle') : null;
      if (el && typeof el._segSet === 'function') { el._segSet(String(d.value)); }
    });
  }

  initTdSeg('set-speed', 'progressSpeed', 'Progress speed');
  initTdSeg('set-navstyle', 'navStyle', 'Navbar selected style');

  /* ---------- Task 4: navbar-style preview icons ----------
     The five .nav-preview__btn spans mirror the real navbar links in real order
     (Dashboard, Settings, Hardware, History, Info — Settings shown as current).
     Icons are built at runtime from DAC.glyphs via DAC.svgGlyph — the same
     source DAC.ui.boot injects into the real navbar — so the preview can never
     drift from it. Purely decorative: the container is aria-hidden with
     pointer-events none, so nothing here is focusable. Guard: without core
     (dev preview) the spans stay empty instead of throwing. */
  var PREVIEW_GLYPHS = ['home', 'gear', 'chip', 'clock', 'info'];

  function buildNavPreviewIcons() {
    if (typeof DAC === 'undefined' || !DAC.glyphs || typeof DAC.svgGlyph !== 'function') return;
    var preview = $('nav-preview');
    if (!preview) return;
    var spans = preview.querySelectorAll('.nav-preview__btn');
    for (var i = 0; i < PREVIEW_GLYPHS.length; i++) {
      var glyph = DAC.glyphs[PREVIEW_GLYPHS[i]];
      var span = spans[i];
      if (glyph && span && !span.firstChild) {
        span.appendChild(DAC.svgGlyph(glyph, null, null));
      }
    }
  }

  buildNavPreviewIcons();

  /* ---------- simple switches (role=switch buttons) ---------- */

  var SWITCHES = [
    ['set-reduce', 'reduceAnimations'],
    ['set-hero', 'showHero'],
    ['set-autoopen', 'autoOpenDetails'],
    ['set-savehistory', 'saveHistory'],
    ['set-mask', 'maskSensitive'],
    ['set-notify', 'notifyHighRisk'],
    ['set-sound', 'soundAlert'],
    ['set-daily', 'dailySummary']
  ];

  SWITCHES.forEach(function (def) {
    var btn = $(def[0]);
    if (!btn) return;
    btn.addEventListener('click', function () {
      commit(def[1], !S.get(def[1]));
    });
  });

  /* ---------- detector switches (nested object) ---------- */

  var DETECTORS = [
    ['det-http', 'httpInsecure'],
    ['det-urgent', 'urgentLanguage'],
    ['det-cred', 'credentialRequests'],
    ['det-ip', 'ipHostname'],
    ['det-short', 'shorteners'],
    ['det-look', 'lookalikes']
  ];

  DETECTORS.forEach(function (def) {
    var btn = $(def[0]);
    if (!btn) return;
    btn.addEventListener('click', function () {
      var cur = S.get('detectors') || {};
      var next = Object.assign({}, cur);
      next[def[1]] = !next[def[1]];
      commit('detectors', next, {
        toastText: DETECTOR_TXT[def[1]] + ' turned ' + (next[def[1]] ? 'on' : 'off')
      });
    });
  });

  /* ---------- trusted / blocked domain list editors ---------- */

  /* spec-pinned validation: domain-ish tokens only, case-insensitive */
  var DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

  function renderChips(ul, items, scope) {
    if (!ul) return;
    ul.textContent = '';
    items.forEach(function (d) {
      var li = document.createElement('li');
      li.className = 'chip';
      li.setAttribute('data-val', d);
      var name = document.createElement('span');
      name.textContent = d;
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'chip-x';
      x.setAttribute('aria-label', 'Remove ' + d + ' from ' + scope + ' domains');
      x.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/></svg>';
      li.appendChild(name);
      li.appendChild(x);
      ul.appendChild(li);
    });
    if (!items.length) {
      var li = document.createElement('li');
      li.className = 'chip-empty';
      li.textContent = 'None yet';
      ul.appendChild(li);
    }
  }

  function initListEditor(cfg) {
    var form = $(cfg.form);
    var input = $(cfg.input);
    var err = $(cfg.err);
    var chips = $(cfg.chips);
    if (!form || !input || !err || !chips) return null;

    function showError(msg) {
      err.textContent = msg;
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
    }

    function clearError() {
      if (!err.hidden) { err.hidden = true; err.textContent = ''; }
      input.removeAttribute('aria-invalid');
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var val = input.value.trim().toLowerCase().replace(/\s+/g, '');
      if (!val || !DOMAIN_RE.test(val)) {
        showError('Enter a valid domain e.g. example.com');
        input.focus();
        return;
      }
      var list = (S.get(cfg.key) || []).slice();
      var dupe = list.some(function (d) { return String(d).toLowerCase() === val; });
      if (dupe) {
        showError('Already in the list');
        input.focus();
        return;
      }
      list.push(val);
      commit(cfg.key, list);
      input.value = '';
      clearError();
      input.focus();
    });

    input.addEventListener('input', clearError);

    chips.addEventListener('click', function (ev) {
      var x = ev.target && ev.target.closest ? ev.target.closest('.chip-x') : null;
      if (!x) return;
      var li = x.closest('[data-val]');
      if (!li) return;
      var val = li.getAttribute('data-val');
      var list = (S.get(cfg.key) || []).slice();
      var i = list.indexOf(val);
      if (i > -1) list.splice(i, 1);
      commit(cfg.key, list);
      input.focus();  /* keep keyboard flow after the removed chip loses focus */
    });

    return function (all) {
      renderChips(chips, all[cfg.key] || [], cfg.scope);
    };
  }

  var listSync = [];
  listSync.push(initListEditor({
    key: 'trustedDomains', scope: 'trusted',
    form: 'form-trusted', input: 'trusted-input', err: 'err-trusted', chips: 'trusted-chips'
  }));
  listSync.push(initListEditor({
    key: 'blockedDomains', scope: 'blocked',
    form: 'form-blocked', input: 'blocked-input', err: 'err-blocked', chips: 'blocked-chips'
  }));

  /* ---------- history & privacy actions ---------- */

  $('btn-export-history').addEventListener('click', function () {
    var csv = DAC.csv.buildCsv(DAC.history.all());
    DAC.csv.exportDownload(csv, 'threat_history.csv');
    DAC.ui.toast('History exported (' + DAC.history.all().length + ' rows)', { type: 'success', key: 'export' });
  });

  $('btn-clear-history2').addEventListener('click', function () {
    DAC.ui.confirm.open({
      title: 'Clear history',
      message: 'Remove every scan record from history? This action cannot be undone.',
      confirmLabel: 'Clear history',
      cancelLabel: 'Cancel',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      DAC.history.clear();
      DAC.ui.toast('History cleared', 'success');
    });
  });

  /* ---------- reset all (guarded; also robust to either reset() semantics) ---------- */

  function valuesDiffer(a, b) {
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      return JSON.stringify(a) !== JSON.stringify(b);
    }
    return a !== b;
  }

  $('btn-reset-all').addEventListener('click', function () {
    DAC.ui.confirm.open({
      title: 'Reset all settings',
      message: 'Every setting returns to its default. This action cannot be undone.',
      confirmLabel: 'Reset settings',
      cancelLabel: 'Cancel',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      var defaults = DAC.settings.reset();
      /* If reset() only returns the default object without persisting, apply the
         changed keys via set() — no-op keys stay untouched. */
      if (defaults && typeof defaults === 'object') {
        var cur = S.all();
        for (var k in defaults) {
          if (Object.prototype.hasOwnProperty.call(defaults, k) && valuesDiffer(cur[k], defaults[k])) {
            S.set(k, defaults[k]);
          }
        }
      }
      DAC.ui.toast('Settings reset to defaults', 'success');
    });
  });

  /* ---------- full UI sync (no toasts, no writes — reads settings only) ---------- */

  function syncEverything() {
    var all = S.all();
    SEGS.forEach(function (def) {
      var s = segSync[def[0]];
      if (s) s.sync(all[def[1]]);
    });
    SWITCHES.forEach(function (def) {
      var b = $(def[0]);
      if (b) b.setAttribute('aria-checked', all[def[1]] ? 'true' : 'false');
    });
    var dets = all.detectors || {};
    DETECTORS.forEach(function (def) {
      var b = $(def[0]);
      if (b) b.setAttribute('aria-checked', dets[def[1]] ? 'true' : 'false');
    });
    listSync.forEach(function (fn) { if (fn) fn(all); });
    syncThemeHint(all.theme);
  }

  /* Theme hint: "System" always shows the currently resolved theme. */
  function syncThemeHint(theme) {
    var hint = $('hint-theme');
    if (!hint) return;
    var resolved = document.documentElement.getAttribute('data-theme');
    if (theme === 'system') {
      hint.textContent = 'System — follows your device setting (currently ' + (resolved === 'dark' ? 'Dark' : 'Light') + ').';
    } else if (theme === 'dark') {
      hint.textContent = 'Applies the dark theme across pages.';
    } else {
      hint.textContent = 'Applies the light theme across pages.';
    }
  }

  /* Dark-background reveal state: inert + aria-hidden while the wrapper is collapsed,
     aria-expanded mirrored onto the theme segment's "Dark" option (CSS animates the
     rest from data-theme, so System resolving to dark is handled identically). */
  function syncDarkReveal() {
    var wrap = $('darkbg-reveal');
    if (!wrap) return;
    var expanded = document.documentElement.getAttribute('data-theme') === 'dark';
    if (expanded) {
      wrap.setAttribute('data-open', 'true');
      wrap.removeAttribute('inert');
      wrap.removeAttribute('aria-hidden');
    } else {
      wrap.setAttribute('data-open', 'false');
      wrap.setAttribute('inert', '');
      wrap.setAttribute('aria-hidden', 'true');
      /* Collapsing under the user's focus: hand it back to the theme control. */
      if (document.activeElement && wrap.contains(document.activeElement)) {
        var checked = document.querySelector('#set-theme [data-value][aria-checked="true"]');
        if (checked) { checked.focus(); }
      }
    }
    var darkOpt = document.querySelector('#set-theme [data-value="dark"]');
    if (darkOpt) { darkOpt.setAttribute('aria-expanded', expanded ? 'true' : 'false'); }
  }

  /* Set data-open only after the theme switch ended (promise/event driven). */
  document.addEventListener('td:theme-switch-end', function (e) {
    var d = (e && e.detail) || {};
    if (d.attr === 'data-theme') { syncDarkReveal(); }
  });

  /* OS-driven (System) changes: hint only. */
  if (typeof MutationObserver === 'function' && document.documentElement) {
    new MutationObserver(function () { syncThemeHint(S.get('theme')); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* Re-sync only the control that matches the changed key (per-key updates,
     not a full syncEverything). Rebuild chip lists only when trusted/blocked
     domains changed; syncEverything runs on initial render + full reset.
     Follow-up fix: DAC.settings.onChange calls listeners fn(key, value) —
     the old e.detail.key read was ALWAYS undefined, so this whole handler
     (chip re-sync, hint, switch repaint) never ran. That is why switch
     knobs looked frozen after load: segs paint themselves on click, but a
     switch's knob/aria relied on this handler and never updated. */
  S.onChange(function (key, value) {
    var all = S.all();
    if (key === 'trustedDomains' || key === 'blockedDomains') {
      listSync.forEach(function (fn) { if (fn) fn(all); });
    }
    if (key === 'theme') { syncThemeHint(S.get('theme')); }
    /* Paint the matching switch (and detectors) from the NEW state so the
       200ms knob slide runs and aria-checked stays truthful. */
    SWITCHES.forEach(function (def) {
      if (def[1] !== key) return;
      var b = $(def[0]);
      if (b) b.setAttribute('aria-checked', value ? 'true' : 'false');
    });
    if (key === 'detectors') {
      var dets = all.detectors || {};
      DETECTORS.forEach(function (def) {
        var b = $(def[0]);
        if (b) b.setAttribute('aria-checked', dets[def[1]] ? 'true' : 'false');
      });
    }
    syncDarkReveal();
  });

  /* ---------- initial render from persisted settings ---------- */
  syncEverything();
  syncDarkReveal();
})();
