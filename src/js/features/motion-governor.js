/* ===== TD.motion — motion governor (animation perf pass) ===== */
/* Pauses off-screen infinite animations (chip-pulse, dac-pulse, dac-glow,
   dac-flicker, dashDot, scan-sweep, dac-spin) via IntersectionObserver.
   No visual change when visible. Pauses everything on theme-switch events. */
(function () {
  "use strict";
  window.TD = window.TD || {};
  var paused = new WeakSet();
  var targets = [
    ".chip-dot", ".pulse-ring", ".shield-glow", ".glitch-block",
    ".dash-scan-dots span", ".scan-ring", ".scan-progress.is-indet"
  ];
  function collect() {
    var out = [];
    for (var i = 0; i < targets.length; i++) {
      var nodes = document.querySelectorAll(targets[i]);
      for (var j = 0; j < nodes.length; j++) out.push(nodes[j]);
    }
    return out;
  }
  function pause(el) { if (!paused.has(el)) { el.setAttribute("data-motion-paused", ""); paused.add(el); } }
  function resume(el) { if (paused.has(el)) { el.removeAttribute("data-motion-paused"); paused.delete(el); } }
  var io = null;
  function setup() {
    if (typeof IntersectionObserver !== "function") return;
    io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.isIntersecting) resume(e.target); else pause(e.target);
      }
    }, { rootMargin: "0px" });
    var nodes = collect();
    for (var i = 0; i < nodes.length; i++) io.observe(nodes[i]);
  }
  /* pause everything on theme switch, resume after */
  function pauseAll() {
    var nodes = collect();
    for (var i = 0; i < nodes.length; i++) pause(nodes[i]);
  }
  function resumeAll() {
    var nodes = collect();
    for (var i = 0; i < nodes.length; i++) resume(nodes[i]);
  }
  /* wire after DOM ready */
  function init() {
    setup();
    document.addEventListener("td:theme-switch-start", pauseAll);
    document.addEventListener("td:theme-switch-end", function () {
      /* resume only visible ones via IO; re-observe new nodes */
      if (io) {
        var nodes = collect();
        for (var i = 0; i < nodes.length; i++) io.observe(nodes[i]);
      }
      resumeAll();
    });
    document.addEventListener("pagehide", function () {
      if (io) io.disconnect();
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  TD.motion = { pause: pauseAll, resume: resumeAll, collect: collect };
})();