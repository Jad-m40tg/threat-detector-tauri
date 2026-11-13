/* ===== TD.components.sparkline — single-path SVG sparkline (Hardware Monitor) ===== */
/* Owner: Monitor agent. Depends on: none. Exposes: TD.components.sparkline.create(el, opts). */
/* No libraries. The <path> "d" attribute is rewritten once per push() (brief perf rule).
   Stroke/glow colors come from CSS custom properties so themes apply automatically. */
(function () {
  "use strict";
  window.TD = window.TD || {};
  TD.components = TD.components || {};

  /**
   * create(el, opts) -> { push(value), reset(), destroy() }
   * el: container (an empty <div> or the svg host). opts:
   *   samples  - history length (default 60)
   *   min/max  - value range (default 0..100)
   *   label    - <title> for a11y
   * Height/width come from CSS; viewBox is fixed and scales.
   */
  function create(el, opts) {
    opts = opts || {};
    var N = opts.samples || 60;
    var MIN = (opts.min === undefined ? 0 : opts.min);
    var MAX = (opts.max === undefined ? 100 : opts.max);
    var W = 240, H = 56, PAD = 2;

    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "sparkline");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");

    var area = document.createElementNS(NS, "path");
    area.setAttribute("class", "sparkline__area");
    var line = document.createElementNS(NS, "path");
    line.setAttribute("class", "sparkline__line");
    svg.appendChild(area);
    svg.appendChild(line);
    if (opts.label) {
      var t = document.createElementNS(NS, "title");
      t.textContent = opts.label;
      svg.appendChild(t);
    }
    el.appendChild(svg);

    var vals = [];

    function yFor(v) {
      var frac = (v - MIN) / (MAX - MIN || 1);
      if (frac < 0) frac = 0; if (frac > 1) frac = 1;
      return H - PAD - frac * (H - PAD * 2);
    }

    function render() {
      var i, n = vals.length;
      if (!n) { line.setAttribute("d", ""); area.setAttribute("d", ""); return; }
      var step = W / (N - 1);
      var start = W - (n - 1) * step; /* right-anchored: newest at the right edge */
      var d = "M" + start.toFixed(2) + " " + yFor(vals[0]).toFixed(2);
      for (i = 1; i < n; i++) {
        d += " L" + (start + i * step).toFixed(2) + " " + yFor(vals[i]).toFixed(2);
      }
      line.setAttribute("d", d);
      area.setAttribute("d", d + " L" + W + " " + H + " L" + start + " " + H + " Z");
    }

    return {
      push: function (v) {
        vals.push(typeof v === "number" && isFinite(v) ? v : MIN);
        if (vals.length > N) vals = vals.slice(vals.length - N);
        render();
      },
      reset: function () { vals = []; render(); },
      destroy: function () { if (svg.parentNode) svg.parentNode.removeChild(svg); }
    };
  }

  TD.components.sparkline = { create: create };
})();
