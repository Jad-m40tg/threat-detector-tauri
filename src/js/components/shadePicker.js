/* ===== TD.components.shadePicker — 2D shade square + hex input (verdict colors P2) ===== */
/* Owner: Verdict colors phase 2 agent. Depends on: none. Exposes: TD.components.shadePicker. */
/* No libraries, no <input type="color">, no canvas: the square is CSS gradients only.
   State is HSV; hue is locked while dragging. A grey (s=0) keeps the previous hue.
   Every listener is attached to nodes this component owns; destroy() removes both. */
(function () {
  "use strict";
  window.TD = window.TD || {};
  TD.components = TD.components || {};

  var HEX_RE = /^[0-9a-f]{6}$/i; /* linear pattern, no backtracking risk */

  function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }

  /** "#RGB"/"#RRGGBB", "#" optional, trimmed → lowercase "#rrggbb", or null. */
  function normalizeHex(str) {
    if (typeof str !== "string") return null;
    var s = str.trim();
    if (s.charAt(0) === "#") s = s.slice(1);
    if (s.length === 3) {
      s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    }
    if (!HEX_RE.test(s)) return null;
    return "#" + s.toLowerCase();
  }

  /** hex → { h: 0..360, s: 0..1, v: 0..1 }, or null when not a valid hex. */
  function hexToHsv(hex) {
    var n = normalizeHex(hex);
    if (!n) return null;
    var r = parseInt(n.slice(1, 3), 16) / 255;
    var g = parseInt(n.slice(3, 5), 16) / 255;
    var b = parseInt(n.slice(5, 7), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var h = 0;
    if (d) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
      if (h < 0) h += 360;
    }
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
  }

  /** h (deg), s, v → lowercase "#rrggbb". */
  function hsvToHex(h, s, v) {
    h = ((h % 360) + 360) % 360;
    s = clamp01(s);
    v = clamp01(v);
    var c = v * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = v - c;
    var r = 0, g = 0, b = 0;
    if (h < 60)       { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else              { r = c; b = x; }
    var parts = [r + m, g + m, b + m];
    var out = "#", i, t;
    for (i = 0; i < 3; i++) {
      t = Math.round(clamp01(parts[i]) * 255).toString(16);
      out += t.length < 2 ? "0" + t : t;
    }
    return out;
  }

  /**
   * create(host, opts) -> { get(), set(hex, { silent }), destroy() }
   * opts: color "#rrggbb", maxSat (0..1, caps the x axis), label, onChange(hex).
   */
  function create(host, opts) {
    opts = opts || {};
    if (!host || typeof host.appendChild !== "function") return null;
    var onChange = typeof opts.onChange === "function" ? opts.onChange : function () {};
    var maxSat = (typeof opts.maxSat === "number" && opts.maxSat > 0) ? Math.min(opts.maxSat, 1) : 1;

    var start = hexToHsv(opts.color) || { h: 0, s: 0, v: 1 };
    var hue = start.h, sat = start.s, val = start.v;
    var dead = false;

    var root = document.createElement("div");
    root.className = "shade-picker";

    var square = document.createElement("div");
    square.className = "shade-picker__square";
    square.setAttribute("role", "slider");
    square.setAttribute("tabindex", "0");
    square.setAttribute("aria-label", typeof opts.label === "string" ? opts.label : "Shade");
    square.setAttribute("aria-valuemin", "0");
    square.setAttribute("aria-valuemax", "100");

    var handle = document.createElement("span");
    handle.className = "shade-picker__handle";
    handle.setAttribute("aria-hidden", "true");
    square.appendChild(handle);

    var hexInput = document.createElement("input");
    hexInput.type = "text";
    hexInput.className = "input shade-picker__hex";
    hexInput.setAttribute("aria-label", "Hex color");
    hexInput.setAttribute("spellcheck", "false");
    hexInput.setAttribute("autocomplete", "off");
    hexInput.placeholder = "#rrggbb";

    root.appendChild(square);
    root.appendChild(hexInput);
    host.appendChild(root);

    function renderSquare() {
      var edge = hsvToHex(hue, maxSat, 1); /* right edge = saturation cap */
      square.style.background =
        "linear-gradient(to top, #000, rgba(0, 0, 0, 0)), linear-gradient(to right, #fff, " + edge + ")";
    }

    function updateVisual() {
      handle.style.left = (clamp01(sat / maxSat) * 100) + "%";
      handle.style.top = ((1 - clamp01(val)) * 100) + "%";
      square.setAttribute("aria-valuenow", String(Math.round(clamp01(sat / maxSat) * 100)));
      square.setAttribute("aria-valuetext",
        "saturation " + Math.round(sat * 100) + "%, brightness " + Math.round(val * 100) + "%");
    }

    function get() { return hsvToHex(hue, sat, val); }

    /* onChange is throttled to one call per animation frame */
    var rafPending = false;
    function scheduleChange() {
      if (dead || rafPending) return;
      rafPending = true;
      window.requestAnimationFrame(function () {
        rafPending = false;
        if (!dead) onChange(get());
      });
    }

    /**
     * Apply a normalized hex. fromOutside=true also syncs the hex input
     * (never used while the user is typing). Grey keeps the previous hue.
     */
    function applyHex(hex, silent, fromOutside) {
      var hsv = hexToHsv(hex);
      if (!hsv) return false;
      if (hsv.s === 0) {
        sat = 0;
        val = hsv.v;
      } else {
        var hueChanged = Math.abs(hsv.h - hue) > 0.5;
        hue = hsv.h;
        sat = hsv.s;
        val = hsv.v;
        if (hueChanged) renderSquare();
      }
      updateVisual();
      if (fromOutside) {
        hexInput.value = get();
        hexInput.removeAttribute("aria-invalid");
      }
      if (!silent) scheduleChange();
      return true;
    }

    function posFromEvent(e) {
      var rect = square.getBoundingClientRect();
      return {
        s: clamp01((e.clientX - rect.left) / rect.width) * maxSat,
        v: 1 - clamp01((e.clientY - rect.top) / rect.height)
      };
    }

    function onPointerDown(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      try { square.setPointerCapture(e.pointerId); } catch (_) { /* already released */ }
      var p = posFromEvent(e);
      sat = p.s; /* hue stays locked while dragging */
      val = p.v;
      updateVisual();
      scheduleChange();
      square.focus();
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (square.hasPointerCapture && !square.hasPointerCapture(e.pointerId)) return;
      var p = posFromEvent(e);
      sat = p.s;
      val = p.v;
      updateVisual();
      scheduleChange();
    }

    function onPointerEnd() { /* hue lock is implicit; nothing to reset */ }

    function onKeyDown(e) {
      var step = e.shiftKey ? 0.1 : 0.01;
      var k = e.key;
      var used = true;
      if (k === "ArrowLeft") sat = clamp01(sat - step);
      else if (k === "ArrowRight") sat = clamp01(sat + step);
      else if (k === "ArrowUp") val = clamp01(val + step);
      else if (k === "ArrowDown") val = clamp01(val - step);
      else used = false;
      if (!used) return;
      e.preventDefault();
      updateVisual();
      scheduleChange();
    }

    function onInput() {
      var norm = normalizeHex(hexInput.value);
      if (!norm) {
        hexInput.setAttribute("aria-invalid", "true"); /* state unchanged */
        return;
      }
      hexInput.removeAttribute("aria-invalid");
      applyHex(norm, false, false);
    }

    function onBlur() {
      hexInput.value = get(); /* revert to the last valid value */
      hexInput.removeAttribute("aria-invalid");
    }

    square.addEventListener("pointerdown", onPointerDown);
    square.addEventListener("pointermove", onPointerMove);
    square.addEventListener("pointerup", onPointerEnd);
    square.addEventListener("pointercancel", onPointerEnd);
    square.addEventListener("lostpointercapture", onPointerEnd);
    square.addEventListener("keydown", onKeyDown);
    hexInput.addEventListener("input", onInput);
    hexInput.addEventListener("blur", onBlur);

    renderSquare();
    updateVisual();
    hexInput.value = get();

    function destroy() {
      dead = true;
      square.removeEventListener("pointerdown", onPointerDown);
      square.removeEventListener("pointermove", onPointerMove);
      square.removeEventListener("pointerup", onPointerEnd);
      square.removeEventListener("pointercancel", onPointerEnd);
      square.removeEventListener("lostpointercapture", onPointerEnd);
      square.removeEventListener("keydown", onKeyDown);
      hexInput.removeEventListener("input", onInput);
      hexInput.removeEventListener("blur", onBlur);
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    return {
      get: get,
      set: function (hex, o) {
        var norm = normalizeHex(hex);
        if (!norm) return false;
        return applyHex(norm, !!(o && o.silent), true);
      },
      destroy: destroy
    };
  }

  TD.components.shadePicker = {
    create: create,
    util: { hexToHsv: hexToHsv, hsvToHex: hsvToHex, normalizeHex: normalizeHex }
  };
})();
