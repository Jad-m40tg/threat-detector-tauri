/* ===== DAC THEME BOOTSTRAP — pre-paint, identical on all pages ===== */
/* Runs synchronously at top of <head>, BEFORE paint: applies saved appearance as
   <html> data-attributes so there is never a wrong-theme flash (SPEC §10).
   Scope is intentionally minimal: documentElement only, no DOM traversal. */
(function () {
  "use strict";

  /* Defaults mirror DAC.settings (CONTRACT §8); kept in sync by hand. */
  var DEF = {
    theme: "system",        /* light | dark | system */
    darkBg: "oled",         /* oled | grey */
    accent: "green",        /* green | blue | white | violet | amber */
    textSize: "medium",     /* small | medium | large */
    density: "comfortable", /* comfortable | compact */
    reduceAnimations: false /* true -> data-motion="reduced" */
  };

  var s = DEF;

  /* Safe-read dac_settings; private modes / file:// may throw — stay on defaults. */
  try {
    var raw = window.localStorage.getItem("dac_settings");
    if (raw) {
      var p = JSON.parse(raw);
      if (p && typeof p === "object" && !p.length) {
        for (var k in DEF) {
          if (Object.prototype.hasOwnProperty.call(p, k) && p[k] !== null && p[k] !== "") {
            s[k] = p[k];
          }
        }
      }
    }
  } catch (e) { /* unreadable storage: defaults are safe */ }

  /* Resolve theme; 'system' follows the OS live later via DAC.applyAppearance(). */
  var theme = s.theme === "light" || s.theme === "dark" ? s.theme : "system";
  if (theme === "system") {
    try {
      theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    } catch (e2) {
      theme = "light";
    }
  }

  /* ONE quick pass: set all appearance attributes on <html>. */
  try {
    var r = document.documentElement;
    var attrs = {
      "data-theme": theme,
      "data-bg": s.darkBg === "grey" ? "grey" : "oled",
      "data-accent": s.accent === "blue" || s.accent === "white" || s.accent === "violet" || s.accent === "amber" ? s.accent : "green",
      "data-text": s.textSize === "small" || s.textSize === "large" ? s.textSize : "medium",
      "data-density": s.density === "compact" ? "compact" : "comfortable",
      "data-motion": s.reduceAnimations ? "reduced" : "full"
    };
    for (var key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        r.setAttribute(key, attrs[key]);
      }
    }
  } catch (e3) { /* no documentElement (tests): CSS fallback stays default */ }
})();
