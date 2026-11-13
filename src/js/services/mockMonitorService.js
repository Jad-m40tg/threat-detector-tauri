/* ===== TD.services.mockMonitorService — simulated hardware metrics ===== */
/* Owner: Monitor agent. Depends on: window.TD. Exposes: TD.services.mockMonitorService. */
/* All data is SIMULATED. Smooth random walks only (each value eases toward a drifting
   target), 1 Hz tick, paused while document.hidden, timers cleaned up on pagehide. */
(function () {
  "use strict";
  window.TD = window.TD || {};
  TD.services = TD.services || {};

  var TICK_MS = 1000;

  function coreCount() {
    var n = 8;
    try {
      if (navigator.hardwareConcurrency && isFinite(navigator.hardwareConcurrency)) {
        n = Math.max(2, Math.min(16, navigator.hardwareConcurrency | 0));
      }
    } catch (e) { /* keep fallback */ }
    return n;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* Random-walk channel: eases toward a slowly drifting target with small noise. */
  function walker(lo, hi, drift, noise) {
    var v = lo + (hi - lo) * 0.3;
    var target = lo + (hi - lo) * 0.4;
    return function step() {
      target += drift * (Math.random() * 2 - 1);
      target = clamp(target, lo, hi);
      v += (target - v) * 0.18 + noise * (Math.random() * 2 - 1);
      v = clamp(v, lo, hi);
      return v;
    };
  }

  function createService() {
    var N_CORES = coreCount();
    var N_WORKERS = N_CORES;

    var cpuTotal = walker(8, 70, 6, 2.5);
    var cpuCores = [];
    var memUsed = walker(2100, 6200, 240, 90);
    var heapUsed = walker(160, 780, 40, 25);

    var workers = [];
    var i;
    for (i = 0; i < N_WORKERS; i++) {
      workers.push({
        id: i + 1,
        name: "Worker-" + (i + 1),
        state: i < 2 ? "RUNNING" : (i % 3 === 0 ? "WAITING" : "IDLE"),
        taskId: null,
        progress: 0,
        elapsedMs: 0
      });
    }

    var queue = [];
    var completed = 0;
    var taskSeq = 0;
    var listeners = [];
    var timer = null;
    var running = false;
    var last = null;
    var demoUntil = 0;

    function runningCount() {
      var n = 0;
      for (var j = 0; j < workers.length; j++) if (workers[j].state === "RUNNING") n++;
      return n;
    }

    function tick() {
      var t = Date.now();
      var dt = last ? (t - last) : TICK_MS;
      last = t;

      /* Worker state machine: RUNNING workers advance progress; finished tasks
         complete and (during demo) pull the next queued task. */
      for (var j = 0; j < workers.length; j++) {
        var w = workers[j];
        if (w.state === "RUNNING") {
          var rate = 100 / (18 + (w.id % 5) * 9); /* 18..54 s per task */
          w.progress += rate * (dt / TICK_MS);
          w.elapsedMs += dt;
          if (w.progress >= 100) {
            completed++;
            w.progress = 0;
            w.elapsedMs = 0;
            if (queue.length) {
              w.taskId = "task-" + String(++taskSeq).padStart(4, "0");
              queue.shift();
            } else if (t >= demoUntil) {
              w.taskId = null;
              w.state = "IDLE";
            } else {
              w.taskId = "task-" + String(++taskSeq).padStart(4, "0");
            }
          }
        } else if (queue.length && (w.state === "IDLE" || w.state === "WAITING")) {
          w.state = "RUNNING";
          w.taskId = "task-" + String(++taskSeq).padStart(4, "0");
          w.progress = 0;
          w.elapsedMs = 0;
          queue.shift();
        } else if (w.state === "IDLE" && Math.random() < 0.02) {
          w.state = "WAITING";
        } else if (w.state === "WAITING" && Math.random() < 0.05) {
          w.state = "IDLE";
        }
      }

      var perCore = [];
      for (var c = 0; c < cpuCores.length; c++) perCore.push(Math.round(cpuCores[c]()));

      var memTotal = 16384;
      var used = Math.round(memUsed());
      var heapMax = 1024;

      var snap = {
        timestamp: t,
        cpu: { total: Math.round(cpuTotal()), perCore: perCore },
        memory: { usedMB: used, totalMB: memTotal, heapUsedMB: Math.round(heapUsed()), heapMaxMB: heapMax },
        threadPool: {
          size: N_WORKERS,
          active: runningCount(),
          queued: queue.length,
          completed: completed,
          workers: workers.map(function (w) {
            return { id: w.id, name: w.name, state: w.state, taskId: w.taskId,
                     progress: Math.min(100, w.progress), elapsedMs: w.elapsedMs };
          })
        }
      };
      for (var k = 0; k < listeners.length; k++) {
        try { listeners[k](snap); } catch (e) { /* listener error must not stop the loop */ }
      }
      return snap;
    }

    function start() {
      if (running) return;
      running = true;
      timer = window.setInterval(function () {
        if (document.hidden) return; /* pause while hidden (brief perf rule) */
        tick();
      }, TICK_MS);
    }
    function stop() {
      running = false;
      if (timer !== null) { window.clearInterval(timer); timer = null; }
    }

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && running) { last = Date.now(); tick(); }
    });
    window.addEventListener("pagehide", stop, { once: true });

    /* first walk: warm the walks so the first paint is not flat */
    cpuCores = [];
    for (i = 0; i < N_CORES; i++) cpuCores.push(walker(5, 85, 9, 4));

    return {
      subscribe: function (cb) {
        if (typeof cb !== "function") return function () {};
        listeners.push(cb);
        start();
        return function () {
          var idx = listeners.indexOf(cb);
          if (idx !== -1) listeners.splice(idx, 1);
          if (!listeners.length) stop(); /* no page listening -> no timer */
        };
      },
      getSnapshot: function () { return tick(); },
      startDemoWorkload: function (taskCount) {
        var n = Math.max(1, Math.min(64, taskCount | 0 || 20));
        demoUntil = Date.now() + 5 * 60000; /* demo mode active >= 5 min */
        for (var q = 0; q < n; q++) queue.push("task-" + String(++taskSeq).padStart(4, "0"));
        start();
      },
      __name: "mock"
    };
  }

  TD.services.mockMonitorService = createService();
})();
