/* ===== TD.components.usageBar — transform-only usage bar (Hardware Monitor) ===== */
/* Owner: Monitor agent. Depends on: none. Exposes: TD.components.usageBar.create(el). */
/* Fill animates with transform: scaleX only (brief perf rule); width is static 100%. */
(function () {
  "use strict";
  window.TD = window.TD || {};
  TD.components = TD.components || {};

  /**
   * create(el) -> { set(frac), destroy() }
   * el: the track element (.hbar). Builds one .hbar__fill child.
   * frac: 0..1 (clamped). The track carries role="meter" styling via the page.
   */
  function create(el) {
    var fill = document.createElement("span");
    fill.className = "hbar__fill";
    fill.style.transform = "scaleX(0)";
    el.appendChild(fill);
    return {
      set: function (frac) {
        var f = typeof frac === "number" && isFinite(frac) ? frac : 0;
        if (f < 0) f = 0; if (f > 1) f = 1;
        fill.style.transform = "scaleX(" + f.toFixed(4) + ")";
      },
      destroy: function () { if (fill.parentNode) fill.parentNode.removeChild(fill); }
    };
  }

  TD.components.usageBar = { create: create };
})();
