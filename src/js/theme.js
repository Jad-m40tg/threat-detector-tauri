/* ===== TDTheme — theme & background switch animation (Agent G) ===== */
/* CONTRACT §2.4: DOM mutation + animation ONLY. This module NEVER touches
   storage — the caller (settings page JS) keeps its own persistence flow
   (S.set / DAC.settings.set first, then calls TDTheme to animate).

   window.TDTheme = {
     apply(themeName, originEvent, opts?),      // <html data-theme>
     applyBackground(bgName, originEvent)       // <html data-bg>
   };

   Valid themes: "light" | "dark" | "system" (values match the pre-paint
   theme bootstrap + DAC.applyAppearance: the ATTRIBUTE always ends up as
   a resolved "dark" or "light"; "system" resolves once per call via
   matchMedia, falling back to "light" if matchMedia is unavailable — same
   convention as the bootstrap).
   Valid backgrounds: "oled" | "grey" (data-bg values defined by tokens).
   Unknown names are a silent no-op. When the resolved target equals the
   current <html> attribute the call is a cheap no-op (attr kept, no
   animation, no error).

   Three execution paths, chosen per call:
   1. document.startViewTransition + motion allowed → circular reveal
      (td-vt-reveal keyframes, ~700ms cubic-bezier(.2,.7,.2,1), defined in
      css/theme-transition.css) expanding from the origin event's clientX/
      clientY. Pointer events supply those coords; keyboard activation or
      a null/undefined origin resolves to the viewport center. The point is
      published as inline style vars --td-vt-cx/--td-vt-cy on <html> before
      the transition starts so the ::view-transition pseudo tree inherits
      them. color-scheme is NOT set here — CSS already drives it from the
      [data-theme] selectors; this module only flips the attribute.
   2. No startViewTransition → attribute set immediately + class
      td-theme-fading added on <html> for ~560ms (CSS transitions ONLY
      background-color, color, border-color, fill, stroke — never
      transform/opacity/width/height, so progress bars, rings and pills
      cannot jitter). A single persistent timer is reused; a re-entry
      clears it first, so rapid toggling cannot stack the class or leave
      a stale removal timer mid-flight.
   3. Reduced motion (prefers-reduced-motion: reduce, or html
      data-motion="reduced") → instant attribute set, no wrapper, no class.

   Rapid toggling on the view-transition path: the newest in-flight target
   per attribute is tracked (pendingAttr) so a call made while an earlier
   one is still pending compares against that in-flight target and starts
   its own transition, while the platform skips the older one — the LAST
   call wins even for back-to-back synchronous calls. Skipped transitions
   reject their ready/updateCallbackDone promises (pre- and post-capture);
   both are pre-handled here so rapid toggling never leaks unhandled
   AbortErrors. The attr is re-asserted directly if the live (newest)
   transition's update callback errors, and a synchronous constructor
   failure falls back to the class fade — the transition can never wedge
   the page. */
(function () {
  "use strict";

  var FADE_MS = (function () {
    try {
      var raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--td-fade-duration");
      var n = parseInt(String(raw || "").trim(), 10);
      return (isFinite(n) && n > 0) ? n : 560;
    } catch (e) { return 560; }
  })();

  /* --- module state (closure-local; only window.TDTheme is exported) --- */
  var fadeTimer = 0; /* persistent fallback timer, cleared + re-armed */
  var activeVT = 0;  /* in-flight view transitions; origin vars clear at 0 */
  var pendingAttr = Object.create(null); /* name -> newest in-flight VT target */

  function docRoot() {
    return document.documentElement;
  }

  /* Reduced motion: the codebase gates animations on prefers-reduced-motion
     and on html[data-motion="reduced"] (in-appearance reduce toggle). */
  function reducedMotion() {
    try {
      if (window.matchMedia &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return true;
      }
    } catch (e) { /* matchMedia unavailable */ }
    try {
      if (docRoot().getAttribute("data-motion") === "reduced") return true;
    } catch (e2) { /* detached test environments */ }
    return false;
  }

  /* "system": resolve exactly like the pre-paint bootstrap does. */
  function resolveSystem() {
    try {
      if (window.matchMedia &&
          window.matchMedia("(prefers-color-scheme: dark)").matches) {
        return "dark";
      }
      return "light";
    } catch (e) { return "light"; }
  }

  /* --- reveal origin centrism ------------------------------------------------ */

  function viewportCenter() {
    try {
      var w = window.innerWidth || docRoot().clientWidth || 0;
      var h = window.innerHeight || docRoot().clientHeight || 0;
      return { x: Math.round(w / 2), y: Math.round(h / 2) };
    } catch (e) { return { x: 0, y: 0 }; }
  }

  /* Pointer events → client coordinates; keyboard activation or a null/
     undefined origin → viewport center. clientX/clientY of 0 are valid. */
  function originPoint(originEvent) {
    try {
      if (typeof originEvent === "object" && originEvent !== null &&
          typeof originEvent.clientX === "number" && isFinite(originEvent.clientX) &&
          typeof originEvent.clientY === "number" && isFinite(originEvent.clientY)) {
        return {
          x: Math.round(originEvent.clientX),
          y: Math.round(originEvent.clientY)
        };
      }
    } catch (e) { /* malformed origin: fall through to center */ }
    return viewportCenter();
  }

  /* --- robust snapshot size (snap fix 2.1): never smaller than the real need --- */
  function snapshotSize() {
    var w = 0, h = 0, pw = 0, ph = 0;
    try {
      var ps = getComputedStyle(docRoot(), "::view-transition");
      pw = parseFloat(ps.width) || 0;
      ph = parseFloat(ps.height) || 0;
      w = pw; h = ph;
    } catch (e) { /* pseudo style unavailable */ }
    var vv = window.visualViewport;
    var coarse = false;
    try { coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches; } catch (e2) {}
    var W = Math.max(w, window.innerWidth || 0, docRoot().clientWidth || 0,
                     vv ? (vv.width + vv.offsetLeft) : 0);
    var H = Math.max(h, window.innerHeight || 0, docRoot().clientHeight || 0,
                     vv ? (vv.height + vv.offsetTop) : 0);
    if (coarse) {
      /* mobile: the dynamic toolbar can change the real snapshot area */
      W = Math.max(W, (window.screen && screen.width) || 0);
      H = Math.max(H, (window.screen && screen.height) || 0);
    }
    W = Math.min(W, 10000); H = Math.min(H, 10000);
    return { W: W, H: H, pw: pw, ph: ph };
  }

  /* --- viewport diagnostics for the dev HUD (cheap; read by dev/perf-hud.js) --- */
  function viewportInfo() {
    var vv = window.visualViewport;
    return {
      iw: window.innerWidth || 0, ih: window.innerHeight || 0,
      cw: docRoot().clientWidth || 0, ch: docRoot().clientHeight || 0,
      vvw: vv ? vv.width : 0, vvh: vv ? vv.height : 0,
      vvx: vv ? vv.offsetLeft : 0, vvy: vv ? vv.offsetTop : 0,
      vvs: vv ? vv.scale : 1,
      sw: (window.screen && screen.width) || 0, sh: (window.screen && screen.height) || 0,
      dpr: window.devicePixelRatio || 1,
      sx: window.scrollX || 0, sy: window.scrollY || 0
    };
  }

  var lastSwitch = Object.create(null); /* name -> {value, time, promise} idempotency */
  var activeCover = null; /* {cover, anims} — snap fix 2.3c rapid-toggle cleanup */

  /* --- snap-fix diagnostics (read by dev/perf-hud.js; never product logic) --- */
  var switchDebug = null;
  var vvListener = null;
  var activeByAttr = Object.create(null); /* attr -> in-flight debug record */

  function nowMs() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function debugBegin(name, value, tier) {
    /* Follow-up fix: a newer switch SUPERSEDES an in-flight one. That is a
       user action, not a platform failure — the old record is marked so its
       reject handler never downgrades the tier (rapid toggling must not
       burn reveal->cover->fade->instant in one burst). */
    try {
      var prev = activeByAttr[name];
      if (prev && !prev.ended) prev.superseded = true;
    } catch (e0) { /* diagnostics only */ }
    switchDebug = {
      attr: name, value: value, tier: tier, t0: nowMs(),
      start: viewportInfo(), snapshotAtReady: null, snapshotAtFinish: null,
      origin: null, R_true: null, R_safe: null, duration: null,
      progressAtFinish: null, readyRejected: null, earlyEnd: null,
      superseded: false, ended: false,
      events: []
    };
    activeByAttr[name] = switchDebug;
    debugEvents(true);
  }

  function debugEvents(on) {
    try {
      var vv = window.visualViewport;
      if (on) {
        vvListener = function (e) {
          try {
            if (switchDebug) switchDebug.events.push({
              t: Math.round(nowMs() - switchDebug.t0), type: e.type
            });
          } catch (eEvt) { /* diagnostics only */ }
        };
        if (vv) {
          vv.addEventListener("resize", vvListener);
          vv.addEventListener("scroll", vvListener);
        }
        window.addEventListener("resize", vvListener);
        window.addEventListener("scroll", vvListener, { passive: true });
        window.addEventListener("focusin", vvListener, { passive: true });
      } else if (vvListener) {
        if (vv) {
          vv.removeEventListener("resize", vvListener);
          vv.removeEventListener("scroll", vvListener);
        }
        window.removeEventListener("resize", vvListener);
        window.removeEventListener("scroll", vvListener);
        window.removeEventListener("focusin", vvListener);
        vvListener = null;
      }
    } catch (e) { /* diagnostics only */ }
  }

  var navT0 = nowMs(); /* warmup guard: first 2.5s after load is always heavy */

  function noteEarlyEnd(dbg, reason) {
    try {
      /* Follow-up fix: `dbg` is the record of the switch that failed, NOT
         the module-level switchDebug (a newer switch may have replaced it
         before this handler ran). Superseded switches are user-driven,
         not platform failures — never downgrade for them. */
      if (dbg && dbg.superseded) {
        dbg.earlyEnd = reason + " [superseded: no downgrade]";
        return;
      }
      var warmup = (nowMs() - navT0) < 2500;
      if (dbg) dbg.earlyEnd = warmup ? (reason + " [warmup: no downgrade]") : reason;
      if (/[?&]perf/.test(location.search || "")) {
        console.log("[TDTheme] EARLY_END:", reason, warmup ? "(warmup — no downgrade)" : "-> downgrading tier");
      }
      if (!warmup && window.TD && window.TD.fx &&
          typeof window.TD.fx.downgrade === "function") {
        window.TD.fx.downgrade(); /* snap fix 2.6: early end == failure */
      }
    } catch (e) { /* diagnostics only */ }
  }

  function remember(name, value, promise) {
    try {
      lastSwitch[name] = { value: value, time: nowMs(), promise: promise };
    } catch (e) { /* diagnostics only */ }
    return promise;
  }

  /* --- origin vars removed (Rung 1e): WAAPI uses x/y directly --- */

  /* --- fallback fade (no view transitions available) --- */

  function fallbackFade() {
    try {
      var r = docRoot();
      if (fadeTimer) {
        window.clearTimeout(fadeTimer);
        fadeTimer = 0;
      }
      r.classList.add("td-theme-fading");
      fadeTimer = window.setTimeout(function () {
        fadeTimer = 0;
        r.classList.remove("td-theme-fading");
      }, FADE_MS);
    } catch (e) { /* classList/timeout unavailable: attr already applied */ }
  }

  /* --- view-transition lifecycle bookkeeping --- */

  function currentAttr(name) {
    try { return docRoot().getAttribute(name); } catch (e) { return null; }
  }

  function vtDone(failed, name, value) {
    activeVT = Math.max(0, activeVT - 1);
    if (activeVT === 0) /* origin vars removed */
    /* This request landed (or was superseded): drop the pending marker so
       comparisons fall back to the real attribute. */
    if (pendingAttr[name] === value) delete pendingAttr[name];
    if (failed) {
      /* Update callback errored → re-assert the target so the change always
         lands (last call wins), but ONLY while no newer request is still in
         flight — otherwise the newer call owns the attribute. */
      try {
        if (pendingAttr[name] === undefined && currentAttr(name) !== value) {
          docRoot().setAttribute(name, value);
          fallbackFade();
        }
      } catch (e) { /* nothing further to fall back to */ }
    }
  }

  function watchTransition(vt, name, value) {
    try {
      /* A transition skipped by a newer one rejects its ready and
         updateCallbackDone promises; pre-handle both so rapid toggling
         never leaks an unhandled AbortError. */
      if (vt.ready && typeof vt.ready.then === "function") {
        vt.ready.then(null, function () {});
      }
      if (vt.updateCallbackDone && typeof vt.updateCallbackDone.then === "function") {
        vt.updateCallbackDone.then(null, function () {});
      }
      if (!vt.finished || typeof vt.finished.then !== "function") return;
      vt.finished.then(
        function () { vtDone(false, name, value); },
        function () { vtDone(true, name, value); }
      );
    } catch (e) { /* promise plumbing missing: transition still ran */ }
  }

  /* --- event dispatch helpers (contract for animation perf pass) --- */
  function dispatchStart(name, value) {
    try {
      document.dispatchEvent(new CustomEvent("td:theme-switch-start",
        { detail: { attr: name, value: value } }));
    } catch (e) { /* CustomEvent unavailable */ }
  }
  function dispatchEnd(name, value, dbg) {
    try {
      /* Follow-up fix: prefer the caller's own record (rapid toggling —
         a stale handler must never mark a newer switch's record ended,
         or the newer switch can never be marked superseded). */
      var rec = (dbg && dbg.attr === name) ? dbg : activeByAttr[name];
      if (rec && rec.value === value) rec.ended = true;
    } catch (eRec) { /* diagnostics only */ }
    try {
      document.dispatchEvent(new CustomEvent("td:theme-switch-end",
        { detail: { attr: name, value: value } }));
    } catch (e) { /* CustomEvent unavailable */ }
  }
  function FADE_MS_VT() {
    try {
      var raw = getComputedStyle(document.documentElement).getPropertyValue("--td-vt-duration");
      var n = parseInt(String(raw || "").trim(), 10);
      return (isFinite(n) && n > 0) ? n : 700;
    } catch (e) { return 700; }
  }

  /* --- cover tier (Rung 2): solid-color wipe --- */
  function runCover(name, value, originEvent) {
    docRoot().classList.add("td-switching");
    /* Snap fix 2.3c: a newer cover cancels the previous one (rapid toggling
       must leave no leftover element, timer or class). */
    try {
      if (activeCover) {
        var oldCover = activeCover.cover, oldAnims = activeCover.anims || [];
        for (var ai = 0; ai < oldAnims.length; ai++) { try { oldAnims[ai].cancel(); } catch (eC) {} }
        if (oldCover.parentNode) oldCover.parentNode.removeChild(oldCover);
        activeCover = null;
      }
    } catch (ePrev) { /* best effort */ }
    var cover = document.createElement("div");
    cover.id = "td-theme-cover";
    cover.setAttribute("aria-hidden", "true");
    /* 100lvw/100lvh (large viewport) where supported so a mobile toolbar
       change mid-animation can never expose an uncovered strip. */
    cover.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict;"
      + "width:100vw;height:100vh;width:100lvw;height:100lvh;";
    var circle = document.createElement("div");
    circle.style.cssText = "position:absolute;width:0;height:0;border-radius:50%;transform:translate(-50%,-50%) scale(0);";
    cover.appendChild(circle);
    document.body.appendChild(cover);
    /* Target color from tokens: flip ONLY the attribute being switched
       (synchronous read+restore, no paint in between, no VT snapshot yet),
       then read --td-cover-bg (duplicates --bg; documented in the log). */
    var targetBg = "#000";
    try {
      var prev = docRoot().getAttribute(name);
      docRoot().setAttribute(name, value);
      var cs = getComputedStyle(docRoot());
      var cov = (cs.getPropertyValue("--td-cover-bg") || "").trim();
      if (!cov) cov = (cs.getPropertyValue("--bg") || "").trim();
      if (cov) targetBg = cov;
      if (prev === null) docRoot().removeAttribute(name); else docRoot().setAttribute(name, prev);
    } catch (eTok) { /* keep the fallback color */ }
    circle.style.background = targetBg;
    /* Radius via the SAME robust size source as the reveal (2.1), plus the
       same safety margin, so a mid-animation toolbar change cannot expose
       an uncovered corner. Origin = click point (viewport center if none). */
    var pt = originPoint(originEvent);
    var x = pt.x, y = pt.y;
    var sz = snapshotSize();
    var R_safe = Math.hypot(Math.max(x, sz.W - x), Math.max(y, sz.H - y)) * 1.08 + 48;
    circle.style.left = x + "px";
    circle.style.top = y + "px";
    circle.style.width = (R_safe * 2) + "px";
    circle.style.height = (R_safe * 2) + "px";
    /* animate scale 0->1 (transform/opacity only) */
    var anim1 = circle.animate(
      { transform: ["translate(-50%,-50%) scale(0)", "translate(-50%,-50%) scale(1)"] },
      { duration: 360, easing: "cubic-bezier(.2,.7,.2,1)", fill: "forwards" }
    );
    activeCover = { cover: cover, anims: [anim1] };
    return anim1.finished.then(function () {
      /* flip theme behind cover */
      try { docRoot().setAttribute(name, value); } catch (e) {}
      /* wait 2 rAFs */
      return new Promise(function (res) {
        requestAnimationFrame(function () { requestAnimationFrame(res); });
      });
    }).then(function () {
      /* fade out cover */
      var anim2 = cover.animate({ opacity: [1, 0] }, { duration: 280, easing: "ease", fill: "forwards" });
      if (activeCover && activeCover.cover === cover) activeCover.anims.push(anim2);
      return anim2.finished;
    }).then(function () {
      if (activeCover && activeCover.cover === cover) activeCover = null;
      if (cover.parentNode) cover.parentNode.removeChild(cover);
      docRoot().classList.remove("td-switching");
      debugEvents(false);
      dispatchEnd(name, value);
    }).catch(function () {
      if (activeCover && activeCover.cover === cover) activeCover = null;
      if (cover.parentNode) cover.parentNode.removeChild(cover);
      docRoot().classList.remove("td-switching");
      debugEvents(false);
      dispatchEnd(name, value);
    });
  }

  /* --- core switcher (used by apply + applyBackground) --- */

  function switchAttr(name, value, originEvent) {
    /* Compare against the newest in-flight target when one exists (an
       earlier transition may not have applied its attribute yet), so
       back-to-back calls still honor the LAST requested value. */
    var current = (pendingAttr[name] !== undefined) ? pendingAttr[name] : currentAttr(name);
    if (current === value) {
      dispatchEnd(name, value);
      return Promise.resolve();
    }

    /* Snap fix 2.4: a second call with the SAME target within 300ms
       (click + change double-fire) must not start a second switch.
       Alternating targets (rapid toggling) never hit this guard. */
    try {
      var lastT = lastSwitch[name];
      if (lastT && lastT.value === value && (nowMs() - lastT.time) < 300 &&
          lastT.promise && typeof lastT.promise.then === "function") {
        return lastT.promise;
      }
    } catch (eIdem) { /* diagnostics only */ }

    /* Tier selection (TD.fx). */
    var fxTier = (window.TD && window.TD.fx && typeof window.TD.fx.tier === "function") ? window.TD.fx.tier() : "reveal";
    try {
      var m = /[?&]fx=(reveal|cover|fade|instant)/.exec(location.search || "");
      if (m) fxTier = m[1];
    } catch (e) {}

    /* Instant tier or reduced motion: no animation. */
    if (fxTier === "instant" || reducedMotion()) {
      try { docRoot().setAttribute(name, value); } catch (eSet) { /* keep going */ }
      dispatchEnd(name, value);
      return remember(name, value, Promise.resolve());
    }

    dispatchStart(name, value);
    debugBegin(name, value, fxTier);
    /* Follow-up fix: capture THIS switch's debug record — the module-level
       switchDebug will be reassigned if a newer switch starts before this
       one's promise handlers run (rapid toggling). */
    var dbg = switchDebug;

    /* Fade tier: use the fallback (no view transition). */
    if (fxTier === "fade") {
      try { docRoot().setAttribute(name, value); } catch (eSet3) { /* keep going */ }
      docRoot().classList.add("td-switching");
      fallbackFade();
      var pFade = new Promise(function (res) { window.setTimeout(res, FADE_MS); });
      window.setTimeout(function () {
        if (!(dbg && dbg.superseded)) {
          docRoot().classList.remove("td-switching");
          debugEvents(false);
        }
        dispatchEnd(name, value, dbg);
      }, FADE_MS);
      return remember(name, value, pFade);
    }

    /* Cover tier: solid-color wipe (Rung 2). */
    if (fxTier === "cover") {
      return remember(name, value, runCover(name, value, originEvent));
    }

    /* Reveal tier: view transition + WAAPI (default). */
    if (typeof document.startViewTransition !== "function") {
      try { docRoot().setAttribute(name, value); } catch (eSet4) { /* keep going */ }
      docRoot().classList.add("td-switching");
      fallbackFade();
      var pNoVT = new Promise(function (res) { window.setTimeout(res, FADE_MS); });
      window.setTimeout(function () {
        if (!(dbg && dbg.superseded)) {
          docRoot().classList.remove("td-switching");
          debugEvents(false);
        }
        dispatchEnd(name, value, dbg);
      }, FADE_MS);
      return remember(name, value, pNoVT);
    }

    /* Origin vars no longer needed (Rung 1e). */

    var vt = null;
      try {
        activeVT += 1;
        pendingAttr[name] = value;
        docRoot().classList.add("td-switching");
        vt = document.startViewTransition(function () {
          /* Let update-callback errors reach the platform: the transition
             skips, .finished rejects and vtDone() re-asserts the attr. */
          docRoot().setAttribute(name, value);
        });
      } catch (eVT) {
        /* Contrast: startViewTransition threw before applying anything →
           no-VT fallback (immediate mutation + paint-property fade). */
        activeVT = Math.max(0, activeVT - 1);
        if (pendingAttr[name] === value) delete pendingAttr[name];
        /* origin vars removed */
        docRoot().classList.remove("td-switching");
        try {
          if (currentAttr(name) !== value) {
            docRoot().setAttribute(name, value);
            fallbackFade();
          }
        } catch (eSet2) { /* nothing further to fall back to */ }
        dispatchEnd(name, value);
        return Promise.resolve();
      }
      watchTransition(vt, name, value);
      /* WAAPI reveal on the pseudo-element (A1). */
      var vtPromise = (vt.finished && typeof vt.finished.then === "function")
        ? vt.finished : Promise.resolve();
      var revealAnim = null;
      try {
        vt.ready.then(function () {
          try {
            var pt = originPoint(originEvent);
            var x = pt.x, y = pt.y;
            /* Snap fix 2.1: radius from the REAL snapshot area (dynamic
               toolbars / visualViewport can exceed innerWidth/innerHeight),
               with a safety margin, animated in two segments so the edge
               reaches the farthest real corner at ~92% and can never leave
               an uncovered corner before the end. */
            var sz = snapshotSize();
            var W = sz.W, H = sz.H;
            var R_true = Math.hypot(Math.max(x, W - x), Math.max(y, H - y));
            var R_safe = R_true * 1.08 + 48;
            if (dbg) {
              dbg.origin = { x: x, y: y };
              dbg.R_true = Math.round(R_true * 100) / 100;
              dbg.R_safe = Math.round(R_safe * 100) / 100;
              dbg.snapshotAtReady = sz;
              dbg.duration = FADE_MS_VT();
            }
            try {
              var anim = document.documentElement.animate(
                [
                  { clipPath: "circle(0px at " + x + "px " + y + "px)",
                    easing: "cubic-bezier(.1,.85,.25,1)", offset: 0 },
                  { clipPath: "circle(" + R_true.toFixed(2) + "px at " + x + "px " + y + "px)",
                    easing: "linear", offset: 0.92 },
                  { clipPath: "circle(" + R_safe.toFixed(2) + "px at " + x + "px " + y + "px)",
                    offset: 1 }
                ],
                { duration: FADE_MS_VT(),
                  pseudoElement: "::view-transition-new(root)", fill: "both" }
              );
              revealAnim = anim;
              /* Snap fix 2.2: the old "skipTransition once covered" shortcut
                 is GONE (it was the mobile snap: skip = uncovered area jumps
                 to the new theme). The animation always runs to its end. */
            } catch (eAnim) { /* pseudoElement unsupported: platform default runs */ }
          } catch (eReady) { /* cosmetic */ }
        }).catch(function (err) {
          /* Superseded by a newer switch OR cancelled by a viewport change
             (H2). Either way: record it and downgrade (snap fix 2.6). */
          if (dbg) dbg.readyRejected = (err && err.name) || "AbortError";
        });
      } catch (eReadyOuter) { /* vt.ready unavailable */ }
      vtPromise.then(function () {
        if (!(dbg && dbg.superseded)) docRoot().classList.remove("td-switching");
        /* origin vars removed */
        /* Snap fix 2.6: verify the reveal actually completed. */
        try {
          if (revealAnim && revealAnim.currentTime != null) {
            var prog = revealAnim.currentTime / FADE_MS_VT();
            if (dbg) {
              dbg.progressAtFinish = Math.round(prog * 1000) / 1000;
              dbg.snapshotAtFinish = snapshotSize();
            }
            if (prog < 0.98) {
              noteEarlyEnd(dbg, "animation at " + Math.round(prog * 100) + "% when finished resolved");
            }
          }
        } catch (eProg) { /* diagnostics only */ }
        if (!(dbg && dbg.superseded)) debugEvents(false);
        dispatchEnd(name, value, dbg);
      }, function (err) {
        if (!(dbg && dbg.superseded)) docRoot().classList.remove("td-switching");
        /* origin vars removed */
        /* Rejected finished = cancelled/skipped: the new theme is already
           live via the update callback; make sure nothing is left over and
           downgrade the tier so this device stops using reveal.
           Follow-up fix: EXCEPT when this switch was superseded by a newer
           user action — rapid toggling must never downgrade the tier. */
        noteEarlyEnd(dbg, "vt.finished rejected: " + ((err && err.name) || "unknown"));
        if (!(dbg && dbg.superseded)) debugEvents(false);
        dispatchEnd(name, value, dbg);
      });
      return remember(name, value, vtPromise);
    }

    /* No view transitions: handled above. */

  /* --- public API (only global added: window.TDTheme) --- */

  function apply(themeName, originEvent, opts) {
    var t = themeName;
    if (t !== "light" && t !== "dark" && t !== "system") return; /* unknown → no-op */
    if (t === "system") t = resolveSystem();
    return switchAttr("data-theme", t, originEvent);
    /* opts accepted for form only, persisted by the CALLER, never here. */
  }

  function applyBackground(bgName, originEvent) {
    if (bgName !== "oled" && bgName !== "grey") return; /* unknown → no-op */
    return switchAttr("data-bg", bgName, originEvent);
  }

  window.TDTheme = {
    apply: apply,
    applyBackground: applyBackground,
    /* Diagnostics for dev/perf-hud.js ONLY (never referenced by product logic). */
    _diag: {
      lastSwitch: function () { return switchDebug; },
      viewport: viewportInfo,
      snapshotSize: snapshotSize
    }
  };
})();
