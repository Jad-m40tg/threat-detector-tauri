/* ===== TD page: Hardware Monitor (hardware.html) ===== */
/* Owner: Monitor agent. Depends on: shared core (DAC), TD.services.monitor,
   TD.components.sparkline, TD.components.usageBar, DAC.visuals.scoreRing.
   Exposes: nothing new on window (page wiring only). All data is simulated. */
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  /* Shell first (same guard pattern as the other pages): builds header/footer.
     PAGE_MAP has no "hardware" entry until Wave 3 -> no aria-current marker yet. */
  var DAC0 = window.DAC;
  if (!DAC0 || !DAC0.ui || typeof DAC0.ui.boot !== "function") return;
  DAC0.ui.boot({ page: "hardware" });

  var svc = (window.TD && TD.services && TD.services.monitor) || null;
  var spark = (window.TD && TD.components && TD.components.sparkline) || null;
  var bar = (window.TD && TD.components && TD.components.usageBar) || null;
  var ringFn = (window.DAC && DAC.visuals && typeof DAC.visuals.scoreRing === "function")
    ? DAC.visuals.scoreRing : null;

  var paused = false;
  var unsub = null;
  var rings = {};          /* element-id -> { destroy() } */
  var coreBars = [];       /* [{ set(frac), pctEl }] */
  var cpuSpark = null, memSpark = null;
  var workerEls = [];      /* [{ fill, stateEl, taskEl, timeEl, cardEl }] */

  function reducedMotion() {
    return document.documentElement.getAttribute("data-motion") === "reduced";
  }

  function fmtMB(v) { return v.toLocaleString("en-US"); }

  function fmtElapsed(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    return (m ? m + "m " : "") + (s % 60) + "s";
  }

  /* usage->risk mapping for the shared score ring (existing visual language:
     green < 50, amber < 80, red >= 80). Worker pills use --state-* tokens instead. */
  function usageRisk(u) { return u < 50 ? "low" : (u < 80 ? "medium" : "high"); }

  function setRing(id, score, risk) {
    if (!rings[id] && ringFn) rings[id] = ringFn($(id), score, risk);
  }

  /* ---------- build static structure ---------- */
  function buildCores(n) {
    var host = $("hw-cores");
    if (!host) return;
    host.innerHTML = "";
    coreBars = [];
    for (var i = 0; i < n; i++) {
      var row = document.createElement("div");
      row.className = "hw-core";

      var name = document.createElement("span");
      name.className = "hw-core__name";
      name.textContent = "Core " + (i + 1);

      var track = document.createElement("div");
      track.className = "hbar hw-core__bar";
      track.setAttribute("role", "meter");
      track.setAttribute("aria-label", "Core " + (i + 1) + " usage");
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
      track.setAttribute("aria-valuenow", "0");

      var pct = document.createElement("span");
      pct.className = "hw-core__pct";
      pct.textContent = "0%";

      row.appendChild(name);
      row.appendChild(track);
      row.appendChild(pct);
      host.appendChild(row);

      var b = bar ? bar.create(track) : null;
      coreBars.push({ set: b ? b.set : function () {}, pct: pct, meter: track });
    }
  }

  function buildWorkers(n) {
    var host = $("hw-workers");
    if (!host) return;
    host.innerHTML = "";
    workerEls = [];
    for (var i = 0; i < n; i++) {
      var card = document.createElement("div");
      card.className = "hw-worker";

      var head = document.createElement("div");
      head.className = "hw-worker__head";
      var name = document.createElement("span");
      name.className = "hw-worker__name";
      name.textContent = "Worker-" + (i + 1);
      var pill = document.createElement("span");
      pill.className = "hw-pill";
      pill.setAttribute("data-state", "IDLE");
      pill.textContent = "IDLE";
      head.appendChild(name);
      head.appendChild(pill);

      var task = document.createElement("div");
      task.className = "hw-worker__task";
      task.textContent = "Idle";

      var track = document.createElement("div");
      track.className = "hbar hw-worker__bar";
      track.setAttribute("role", "meter");
      track.setAttribute("aria-label", "Worker " + (i + 1) + " task progress");
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
      track.setAttribute("aria-valuenow", "0");

      var time = document.createElement("div");
      time.className = "hw-worker__time";
      time.textContent = "0s";

      card.appendChild(head);
      card.appendChild(task);
      card.appendChild(track);
      card.appendChild(time);
      host.appendChild(card);

      var b = bar ? bar.create(track) : null;
      workerEls.push({ card: card, state: pill, task: task, meter: track,
                       set: b ? b.set : function () {}, time: time });
    }
  }

  /* ---------- render ---------- */
  function render(snap) {
    if (!snap) return;

    /* stat cards */
    var cpu = snap.cpu.total;
    var memPct = Math.round((snap.memory.usedMB / snap.memory.totalMB) * 100);
    setRing("hw-ring-cpu", cpu, usageRisk(cpu));
    setRing("hw-ring-mem", memPct, usageRisk(memPct));
    if ($("hw-cpu-val")) $("hw-cpu-val").textContent = cpu + "%";
    if ($("hw-mem-val")) $("hw-mem-val").textContent = fmtMB(snap.memory.usedMB) + " / " + fmtMB(snap.memory.totalMB) + " MB";
    if ($("hw-threads-val")) $("hw-threads-val").textContent = snap.threadPool.active + " / " + snap.threadPool.size;
    if ($("hw-queue-val")) $("hw-queue-val").textContent = String(snap.threadPool.queued);

    /* sparklines */
    if (cpuSpark) cpuSpark.push(cpu);
    if (memSpark) memSpark.push(memPct);

    /* core bars */
    var i, c;
    for (i = 0; i < coreBars.length && i < snap.cpu.perCore.length; i++) {
      c = snap.cpu.perCore[i];
      coreBars[i].set(c / 100);
      coreBars[i].pct.textContent = c + "%";
      coreBars[i].meter.setAttribute("aria-valuenow", String(c));
    }

    /* workers */
    for (i = 0; i < workerEls.length && i < snap.threadPool.workers.length; i++) {
      var w = snap.threadPool.workers[i], el = workerEls[i];
      el.state.setAttribute("data-state", w.state);
      el.state.textContent = w.state;
      el.task.textContent = w.taskId ? ("Task " + w.taskId) : "Idle";
      el.set(w.progress / 100);
      el.meter.setAttribute("aria-valuenow", String(Math.round(w.progress)));
      el.time.textContent = w.state === "RUNNING" ? fmtElapsed(w.elapsedMs) : "\u2014";
    }
  }

  /* ---------- controls ---------- */
  function bindControls() {
    var btnPause = $("hw-pause");
    if (btnPause) {
      btnPause.addEventListener("click", function () {
        paused = !paused;
        btnPause.setAttribute("aria-pressed", paused ? "true" : "false");
        btnPause.textContent = paused ? "Resume" : "Pause";
        if (paused) {
          if (unsub) { unsub(); unsub = null; }
        } else if (svc) {
          unsub = svc.subscribe(render);
        }
      });
    }
    var btnDemo = $("hw-demo");
    if (btnDemo) {
      btnDemo.addEventListener("click", function () {
        if (!svc) return;
        svc.startDemoWorkload(20);
        if (paused) { btnPause.click(); } /* resume to show it */
      });
    }
  }

  function init() {
    if (!svc) return;
    var snap = svc.getSnapshot();
    buildCores(snap.cpu.perCore.length);
    buildWorkers(snap.threadPool.workers.length);
    if (spark) {
      cpuSpark = spark.create($("hw-cpu-spark"), { label: "Total CPU, last 60 samples" });
      memSpark = spark.create($("hw-mem-spark"), { label: "Memory usage, last 60 samples" });
    }
    bindControls();
    render(snap);
    unsub = svc.subscribe(render);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
