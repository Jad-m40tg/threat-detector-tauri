/* ===== TD.events — pub/sub event channel (Backend agent, Wave 2) ===== */
/* Events used: analysis:item-start, analysis:item-done, analysis:batch-start,
   analysis:batch-done, analysis:result, monitor:snapshot. */
(function () {
  "use strict";
  window.TD = window.TD || {};
  var listeners = Object.create(null);
  function on(name, cb) {
    if (typeof cb !== "function") return function () {};
    (listeners[name] = listeners[name] || []).push(cb);
    return function off() {
      var arr = listeners[name];
      if (!arr) return;
      var i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    };
  }
  function emit(name, payload) {
    var arr = listeners[name];
    if (!arr || !arr.length) return;
    var copy = arr.slice();
    for (var i = 0; i < copy.length; i++) {
      try { copy[i](payload); } catch (e) { /* isolate listener errors */ }
    }
  }
  function off(name, cb) {
    if (!name) { listeners = Object.create(null); return; }
    if (cb) {
      var arr = listeners[name];
      if (arr) {
        var i = arr.indexOf(cb);
        if (i >= 0) arr.splice(i, 1);
      }
    } else {
      delete listeners[name];
    }
  }
  TD.events = { on: on, emit: emit, off: off };
})();