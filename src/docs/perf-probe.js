/* docs/perf-probe.js — copy-paste into Chrome/Opera DevTools console.
   Records frame-time stats (p50, p95, max, count >20ms) for 5 seconds.
   Usage: paste, then run perfProbe.start("theme-switch"); perform the action;
   perfProbe.stop() prints the report. */
(function () {
  "use strict";
  var frames = [];
  var running = false;
  var rafId = 0;
  var last = 0;
  function tick(t) {
    if (!running) return;
    if (last) frames.push(t - last);
    last = t;
    rafId = requestAnimationFrame(tick);
  }
  window.perfProbe = {
    start: function (label) {
      frames = []; last = 0; running = true;
      this.label = label || "probe";
      rafId = requestAnimationFrame(tick);
      console.log("[perfProbe] started:", this.label);
    },
    stop: function () {
      running = false;
      cancelAnimationFrame(rafId);
      var sorted = frames.slice().sort(function (a, b) { return a - b; });
      var p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
      var p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
      var max = sorted.length ? sorted[sorted.length - 1] : 0;
      var over20 = frames.filter(function (f) { return f > 20; }).length;
      var report = {
        label: this.label, frames: frames.length,
        p50: p50.toFixed(2), p95: p95.toFixed(2), max: max.toFixed(2),
        over20ms: over20
      };
      console.table(report);
      return report;
    }
  };
  console.log("perfProbe ready. Use perfProbe.start('label') / perfProbe.stop().");
})();