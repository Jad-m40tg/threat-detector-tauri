/* ===== PAGE: dashboard ===== */
(function () {
  'use strict';

  /* Guards: dev preview without the shared core (files opened one-by-one) */
  var DAC = window.DAC;
  if (!DAC || !DAC.ui || typeof DAC.ui.boot !== 'function') return;
  DAC.ui.boot({ page: 'index' }); /* CONTRACT §14 — shell first, before any DOM logic */

  var S = DAC.settings || { get: function () { return undefined; } };
  var V = DAC.visuals || {};
  var money = DAC.utils || {};

  var $ = function (id) { return document.getElementById(id); };
  var clampN = function (n, d) { return n < d ? n : d; };

  /* ---- DOM cache ---- */
  var heroEl = $('hero'),
      scanCardEl = $('scan-card'),
      btnScroll = $('btn-scroll-scan'),
      scanForm = $('scan-form'),
      inputEl = $('scan-input'),
      btnAnalyze = $('btn-analyze'),
      btnClear = $('btn-clear'),
      inputError = $('input-error'),
      seg = $('seg-mode'),
      blocks = {
        single: document.querySelector('[data-block="single"]'),
        csv: document.querySelector('[data-block="csv"]')
      },
      dropZone = $('csv-drop'),
      fileInput = $('csv-file-input'),
      csvError = $('csv-error'),
      csvSummary = $('csv-summary'),
      csvName = $('csv-summary-name'),
      csvLine = $('csv-summary-line'),
      progressBar = $('csv-progress-bar'),
      progressPct = $('csv-progress-pct'),
      progressBox = document.querySelector('#csv-summary .progress'),
      panel = $('result-panel'),
      statesWrap = panel.querySelector('.result-states'),
      live = $('scan-live'),
      subEl = $('scan-substatus'),
      scanZone = $('scan-progress-zone'),
      scanProgress = $('scan-progress'),
      scanBar = $('scan-progress-bar'),
      scanCount = $('scan-progress-count'),
      tableBody = $('table-results-body'),
      summaryCard = $('summary-card'),
      reviewLink = $('summary-review');

  var stateEls = {};
  var stateDivs = statesWrap.querySelectorAll('.result-state');
  for (var i = 0; i < stateDivs.length; i++) stateEls[stateDivs[i].getAttribute('data-state')] = stateDivs[i];

  /* ---- module state ---- */
  var curState = null,
      scanTimer = null, subTimer = null, batchTimer = null,
      scannerH = null, ringT = null, ringU = null, checkH = null,
      shieldH = null,
      batchActive = false, batchEntries = null,
      counts = null, activeMode = 'single', lastRes = null, scanRun = 0,
      /* Batch identity (T2a staleness guards): batchId from the backend's start
         reply filters progress/done events of an OLD batch; cancelRequested lets
         the current batch's own NotVerified(BatchCancelled) rows through while
         dropping stragglers from a previous, already-cleared run. */
      activeBatchId = null, cancelRequested = false,
      /* [T2b] batch rows: results stream into batchRows during the run (both the
         mock and the Tauri path) and render as a scrollable verdict list when the
         batch closes. batchRenderOrder mirrors the rendered sort (file order);
         rowRingIO builds each row's score ring lazily when it scrolls into view. */
      batchRows = [], batchRenderOrder = [], rowRingIO = null;

  var subMsgs = ['Checking URL structure...', 'Analyzing language...', 'Comparing known patterns...'];
  var RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk', unverified: 'Not verified', error: 'Error' };
  var STATUS_LABEL = { verified: 'Verified', not_verified: 'Not Verified', error: 'Error' };
  var SPEED_MS = { fast: 1000, normal: 2000, slow: 3500 };
  /* D4: per-item demo delay (ms) passed to the Rust engine so batch progress
     stays visually inspectable even though the rules themselves run instantly. */
  var BATCH_ITEM_MS = { fast: 15, normal: 60, slow: 150 };

  /* Tauri backend: TD.services.analysis only exposes the streaming CSV commands
     when the Rust backend is active (auto-detected in td-config.js). */
  var A = (window.TD && TD.services && TD.services.analysis) || null;
  function usingTauri() { return !!(A && A.backend === 'tauri'); }

  /* Task 5: the "Demo mode" callout is only truthful in browser mode — the Rust
     backend performs real analysis. The callout ships hidden in the HTML and is
     shown here only when the mock backend is active. */
  var demoNotice = $('demo-notice');
  if (demoNotice) demoNotice.hidden = usingTauri();

  /* Backend IPC result (docs/IPC_CONTRACT.md) → UI result shape. Pure field
     rename: the backend owns the NotVerified invariants, no re-scoring here. */
  function ipcToUi(r) {
    return {
      id: r.id,
      input: r.input,
      type: r.inputType,
      risk: r.risk,
      score: r.score,
      status: r.status,
      details: r.details,
      reasons: r.reasons,
      recommendation: r.recommendation,
      ts: r.ts
    };
  }
  /* IPC/transport failure → typed error result (never Low, never "safe"). */
  function ipcFailure(text, err) {
    var msg = String((err && err.message) || err || 'Analysis failed');
    return { id: 'local', input: text, type: 'url', risk: 'error', score: 0, status: 'error',
      details: 'The analysis service reported an error.',
      reasons: [msg], recommendation: 'Check the input and try again. If it persists, restart the app.', ts: Date.now() };
  }
  function readableErr(err) {
    return String((err && err.message) || err || 'The file could not be analyzed.');
  }

  function reducedMotion() {
    if (typeof V.reduceMotion === 'function') return V.reduceMotion();
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function setBusy(on) {
    /* Analyze (and the zone) lock during scan/batch — Clear intentionally stays live as a cancel (SPEC 7.2) */
    btnAnalyze.disabled = on;
    btnAnalyze.setAttribute('aria-disabled', on ? 'true' : 'false');
    dropZone.setAttribute('aria-disabled', on ? 'true' : 'false');
  }
  function announce(msg) { live.textContent = msg; }
  function clearTimers() {
    if (scanTimer) { window.clearTimeout(scanTimer); scanTimer = null; }
    if (subTimer) { window.clearInterval(subTimer); subTimer = null; }
    if (batchTimer) { window.clearTimeout(batchTimer); batchTimer = null; }
  }
  function destroyVisual(h) { if (h && typeof h.destroy === 'function') h.destroy(); return null; }
  /* [F] data-risk on the result-panel root (contract §2.2): set per engine risk,
     removed for 'error' and whenever the panel returns to idle */
  function setPanelRisk(risk) {
    if (risk) panel.setAttribute('data-risk', risk);
    else panel.removeAttribute('data-risk');
  }

  /* ============ RESULT PANEL state machine ============ */
  function syncHeight() {
    var el = stateEls[curState];
    if (el) statesWrap.style.height = el.offsetHeight + 'px';
  }
  function setState(name) {
    if (curState && stateEls[curState]) stateEls[curState].classList.remove('is-active');
    curState = name;
    for (var k in stateEls) stateEls[k].classList.toggle('is-active', k === name);
    /* unmount all visuals, then mount what this state needs */
    scannerH = destroyVisual(scannerH); ringT = destroyVisual(ringT);
    ringU = destroyVisual(ringU); checkH = destroyVisual(checkH);
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(syncHeight);
      if (name === 'scanning' && typeof V.scanner === 'function') scannerH = V.scanner($('vis-scan'));
      if (name === 'safe' && typeof V.checkCircle === 'function') checkH = V.checkCircle($('vis-check'));
    });
  }

  function presentResult(res) {
    lastRes = res;
    var card = TD.components.verdictCard;
    if (res.risk === 'medium' || res.risk === 'high') {
      setPanelRisk(res.risk);
      /* Fill via the shared builder (markup source for dashboard + preview). */
      if (card && typeof card.render === 'function') card.render(stateEls.threat, res.risk, res);
      setState('threat');
      if (typeof V.scoreRing === 'function') {
        ringT = V.scoreRing($('vis-ring-threat'), clampN(res.score, 99), res.risk);
      }
    } else if (res.risk === 'unverified') {
      setPanelRisk('unverified');
      if (card && typeof card.render === 'function') card.render(stateEls.unverified, 'unverified', res);
      setState('unverified');
      /* Single-scan Not Verified shows the grey dashed unverified ring — the
         same glyph batch rows use. Never a % wheel: an unverifiable link gets
         no number. Fallback (visual missing): neutral scoreRing with no score. */
      if (typeof V.unverifiedRing === 'function') {
        ringU = V.unverifiedRing($('vis-ring-unv'));
      } else if (typeof V.scoreRing === 'function') {
        ringU = V.scoreRing($('vis-ring-unv'), null, res.risk);
      }
    } else if (res.risk === 'error') {
      setPanelRisk(null); /* contract §2.2: error rows carry NO data-risk */
      setState('error');
    } else { /* low */
      setPanelRisk('low');
      setState('safe');
    }
  }

  /* ============ SINGLE SCAN ============ */
  function startScan() {
    if (btnAnalyze.disabled) return;
    var text = String(inputEl.value).trim();
    if (!text) {
      inputError.hidden = false; /* role=status region announces itself */
      inputEl.focus();
      return;
    }
    inputError.hidden = true;
    var tauri = usingTauri();
    var res = tauri ? null : analyzeSafe(text);
    /* capture ONCE per run — settings flips mid-run must not change this run (CONTRACT §2.1) */
    var tdMult = (window.TDSettings && typeof TDSettings.progressMultiplier === "function") ? TDSettings.progressMultiplier() : 1.4;
    /* [T2a] invalidate any in-flight scan: bump the token and cancel its timers so a
       stale result cannot overwrite a newer one (mock path had no guard before). */
    var run = ++scanRun;
    clearTimers();

    setBusy(true);
    setPanelRisk(null); /* T2a: no stale verdict tint while the new scan runs */
    announce('Scanning started');
    scanProgress.classList.add('is-indet'); /* single run = indeterminate sweep */
    scanProgress.removeAttribute('aria-valuenow');
    scanCount.textContent = 'Working…'; /* clears any leftover batch "X of N" */
    setState('scanning'); /* reveal the progress card, then bring it into view */
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        panel.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
        if (scanZone) {
          try { scanZone.focus({ preventScroll: true }); } catch (err) { scanZone.focus(); }
        }
      });
    });
    if (!reducedMotion()) { /* rotate sub-status every 600ms base (SPEC 7.3), scaled by tdMult */
      var si = 0;
      subEl.textContent = subMsgs[0];
      subTimer = window.setInterval(function () {
        si = (si + 1) % subMsgs.length;
        subEl.textContent = subMsgs[si];
      }, Math.max(1, Math.round(600 * tdMult)));
    }
    var dur = Math.max(1, Math.round((SPEED_MS[S.get('scanSpeed') || 'normal'] || 2000) * tdMult));
    if (!tauri) {
      scanTimer = window.setTimeout(function () { if (run !== scanRun) return; finishScan(res); }, dur);
      return;
    }
    /* Real backend (D9): wait for BOTH the animation gate and the backend answer.
       'fixed' shows the result when the animation completes (or later, if the
       backend is slower); 'instant' shows it the moment the answer arrives.
       scanRun invalidates the answer if the user clears or restarts mid-run. */
    var gateDone = (S.get('resultTiming') === 'instant');
    /* reuse the token bumped above instead of incrementing a second time */
    var pending = null;
    var maybeFinish = function () { if (gateDone && pending) finishScan(pending); };
    if (!gateDone) {
      scanTimer = window.setTimeout(function () { scanTimer = null; gateDone = true; maybeFinish(); }, dur);
    }
    A.analyze(text).then(function (ipc) {
      if (run !== scanRun) return; /* cleared or replaced mid-run */
      pending = ipcToUi(ipc);
      maybeFinish();
    }, function (err) {
      if (run !== scanRun) return;
      pending = ipcFailure(text, err);
      maybeFinish();
    });
  }
  function finishScan(res) {
    /* The real backend can answer before the animation gate: clear the pending
       timer so finishScan runs exactly once per scan. */
    if (scanTimer) { window.clearTimeout(scanTimer); }
    scanTimer = null;
    if (subTimer) { window.clearInterval(subTimer); subTimer = null; }
    setBusy(false);
    presentResult(res);
    pushRow(res);
    updateSummary();
    announce('Analysis complete — ' + (res.risk === 'low' ? 'no issues detected' : RISK_LABEL[res.risk]));
    if ((res.risk === 'medium' || res.risk === 'high') && S.get('autoOpenDetails') !== false && !reducedMotion()) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (res.risk === 'high' && S.get('notifyHighRisk') !== false && DAC.ui && typeof DAC.ui.toast === 'function') {
      DAC.ui.toast('High-risk result detected', { type: 'error', key: 'highrisk',
        action: { label: 'View', onClick: function () { window.location.href = 'history.html#risk=high'; } } });
    }
  }

  /* ============ ICONS (inline SVG builder; outline style per CONTRACT §12) ============ */
  var NSVG = 'http://www.w3.org/2000/svg';
  var ICONS = {
    globe: [{ t: 'circle', a: { cx: '12', cy: '12', r: '8.2' } }, { t: 'path', a: { d: 'M3.8 12h16.4' } }, { t: 'path', a: { d: 'M12 3.8c2.5 2.3 3.9 5 3.9 8.2s-1.4 5.9-3.9 8.2c-2.5-2.3-3.9-5-3.9-8.2s1.4-5.9 3.9-8.2Z' } }],
    envelope: [{ t: 'rect', a: { x: '3.6', y: '5.8', width: '16.8', height: '12.4', rx: '2.2' } }, { t: 'path', a: { d: 'M4.4 7.4 12 13l7.6-5.6' } }],
    check: [{ t: 'path', a: { d: 'M5.5 12.6l4.2 4.2 8.6-9' } }],
    warn: [{ t: 'path', a: { d: 'M12 4.2 3.4 19.8h17.2Z' } }, { t: 'path', a: { d: 'M12 10.2v4.6' } }, { t: 'path', a: { d: 'M12 17.4h.01' } }],
    err: [{ t: 'circle', a: { cx: '12', cy: '12', r: '8.2' } }, { t: 'path', a: { d: 'M12 8v4.8' } }, { t: 'path', a: { d: 'M12 16.4h.01' } }]
  };
  function icon(kind, cls) {
    var svg = document.createElementNS(NSVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    if (cls) svg.setAttribute('class', cls);
    var ops = ICONS[kind];
    for (var j = 0; ops && j < ops.length; j++) {
      var el = document.createElementNS(NSVG, ops[j].t);
      for (var k in ops[j].a) el.setAttribute(k, ops[j].a[k]);
      svg.appendChild(el);
    }
    return svg;
  }
  function mask(t) { return money.mask ? money.mask(t) : t; }

  /* ============ TABLE (SPEC 7.4) ============ */
  function statusKind(status) {
    if (status === 'verified') return ['is-ok', 'check'];
    if (status === 'error') return ['is-error', 'err'];
    return ['is-warn', 'warn']; /* not_verified */
  }
  function rowDom(res) {
    var tr = document.createElement('tr');
    tr.tabIndex = 0;

    var td1 = document.createElement('td');
    td1.setAttribute('data-label', 'Input');
    td1.className = 'dash-td-input';
    td1.appendChild(icon(res.type === 'message' ? 'envelope' : 'globe', 'type-icon'));
    var span1 = document.createElement('span');
    span1.className = 'ellipsis text-truncate';
    span1.textContent = mask(res.input);
    span1.title = res.input;
    td1.appendChild(span1);

    var td2 = document.createElement('td');
    td2.setAttribute('data-label', 'Risk Level');
    td2.appendChild(DAC.ui.riskTag(res.risk)); /* [B2] shared tag builder */

    var td3 = document.createElement('td');
    td3.setAttribute('data-label', 'Status');
    var sk = statusKind(res.status);
    var sl = document.createElement('span');
    sl.className = 'status-line ' + sk[0];
    sl.appendChild(icon(sk[1]));
    sl.appendChild(document.createTextNode(STATUS_LABEL[res.status] || 'Verified'));
    td3.appendChild(sl);

    var td4 = document.createElement('td');
    td4.setAttribute('data-label', 'Details');
    var span4 = document.createElement('span');
    span4.className = 'text-clamp-2'; /* [B] 2-line clamp; tooltip keeps the full text */
    span4.textContent = res.details || '';
    span4.title = res.details || '';
    td4.appendChild(span4);

    var td5 = document.createElement('td');
    td5.setAttribute('data-label', 'Time');
    td5.className = 'time-cell';
    if (DAC.time) {
      td5.textContent = DAC.time.format(res.ts);
      td5.title = DAC.time.exact ? DAC.time.exact(res.ts) : String(res.ts);
    } else td5.textContent = String(res.ts);

    function loadRow() {
      presentResult(res);
      var rows = tableBody.children;
      for (var j = 0; j < rows.length; j++) rows[j].classList.toggle('is-highlight', rows[j] === tr);
      announce('Showing ' + RISK_LABEL[res.risk] + ' result');
      if (!reducedMotion()) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else panel.scrollIntoView();
    }
    tr.addEventListener('click', loadRow);
    tr.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadRow(); }
    });

    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4); tr.appendChild(td5);
    return tr;
  }
  function trimTo(keep) {
    while (tableBody.children.length > keep) tableBody.removeChild(tableBody.children[tableBody.children.length - 1]);
    syncResultsEmpty();
  }
  function rebuildTable() {
    while (tableBody.firstChild) tableBody.removeChild(tableBody.firstChild);
    var all = DAC.history && typeof DAC.history.all === 'function' ? DAC.history.all() : [];
    var n = clampN(all.length, 5);
    for (var j = 0; j < n; j++) tableBody.appendChild(rowDom(all[j]));
    syncResultsEmpty();
  }
  /* [T3] Analysis Results empty state: hidden↔visible strictly follows the rows
     the table draws from. Fade-out runs mounted (is-leaving → hidden after the
     transition); fade-in is a CSS animation on unhide (and on the table). */
  var resultsEmpty = $('results-empty'),
      resultsTable = $('table-results'),
      emptyHideTimer = null;
  function syncResultsEmpty() {
    if (!resultsEmpty || !resultsTable) return;
    var isEmpty = tableBody.children.length === 0;
    if (isEmpty) {
      if (emptyHideTimer) { window.clearTimeout(emptyHideTimer); emptyHideTimer = null; }
      resultsEmpty.classList.remove('is-leaving');
      resultsTable.hidden = true;
      resultsEmpty.hidden = false;
    } else {
      resultsTable.hidden = false;
      if (!resultsEmpty.hidden) {
        resultsEmpty.classList.add('is-leaving');
        if (emptyHideTimer) window.clearTimeout(emptyHideTimer);
        emptyHideTimer = window.setTimeout(function () {
          resultsEmpty.hidden = true;
          resultsEmpty.classList.remove('is-leaving');
          emptyHideTimer = null;
        }, reducedMotion() ? 0 : 180);
      }
      /* replay the table's fade-in for the empty → results transition */
      resultsTable.classList.remove('is-entering');
      void resultsTable.offsetWidth;
      resultsTable.classList.add('is-entering');
    }
  }
  function pushRow(res, deferHistory) {
    /* Batch items are stored ONCE via addDeferred + finishBatch's flush (each
       item used to be written twice — the Threat Summary double-count root).
       Single scans persist immediately via add. */
    if (DAC.history) {
      if (deferHistory && typeof DAC.history.addDeferred === 'function') DAC.history.addDeferred(res);
      else if (typeof DAC.history.add === 'function') DAC.history.add(res);
    }
    tableBody.insertBefore(rowDom(res), tableBody.firstChild);
    trimTo(5);
  }

  /* ============ THREAT SUMMARY (SPEC 7.5) ============ */
  function countUpEl(el, n) {
    if (typeof V.countUp === 'function') { V.countUp(el, n, { duration: 700 }); return; }
    el.textContent = String(n);
  }
  function updateSummary() {
    /* Definitions (kept in sync with docs/PROGRESS.md):
       - one "scan" = one analyzed entry (a single input, or one CSV row);
       - "Scans today" counts every entry analyzed since local midnight —
         Not Verified and errored entries included, they were still analyzed;
       - High/Medium risk count today's entries that were verified at that
         risk level (Not Verified is neither — it was never risk-assessed);
       - the window is "today" everywhere (the old last-10 slice under-counted
         long batches); demo seed rows are excluded via history.userScans(). */
    var src = (DAC.history && typeof DAC.history.userScans === 'function') ? DAC.history.userScans()
            : (DAC.history && typeof DAC.history.all === 'function' ? DAC.history.all() : []);
    var high = 0, med = 0, today = 0;
    var midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    var mt = midnight.getTime();
    for (var j = 0; j < src.length; j++) {
      var r = src[j];
      if (r.ts >= mt) {
        today++;
        if (r.risk === 'high') high++;
        else if (r.risk === 'medium') med++;
      }
    }
    var state, title, desc, href;
    if (high > 0) { state = 'threat'; title = 'Threat detected'; desc = high + ' high-risk results today'; href = 'history.html#risk=high'; }
    else if (med > 0) { state = 'caution'; title = 'Use caution'; desc = med + ' medium-risk results today'; href = 'history.html#risk=medium'; }
    else { state = 'secure'; title = 'Your system is secure'; desc = 'No active threats detected'; href = 'history.html#risk=low'; }
    var tEl = $('summary-state-title');
    tEl.textContent = title;
    tEl.setAttribute('data-state', state);
    $('summary-state-desc').textContent = desc;
    reviewLink.setAttribute('href', href);
    shieldH = destroyVisual(shieldH);
    if (typeof V.shield === 'function') shieldH = V.shield($('vis-shield-summary'), state);
    countUpEl($('stat-today'), today);
    countUpEl($('stat-high'), high);
    countUpEl($('stat-medium'), med);
  }
  summaryCard.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('a')) return; /* link clicks navigate natively */
    var href = reviewLink.getAttribute('href');
    if (href) window.location.href = href;
  });

  /* ============ CSV BATCH (SPEC 7.2) ============ */
  function analyzeSafe(text) {
    try { return DAC.analyze(text); }
    catch (e) {
      return { id: 'local', input: text, type: 'url', risk: 'error', score: 0, status: 'error',
        details: 'The input does not look like a valid URL or a readable message.',
        reasons: ['Input rejected.'], recommendation: 'Check the text and enter a full URL (e.g. https://example.com) or a plain message.', ts: Date.now() };
    }
  }
  function showCsvError(msg) { csvError.textContent = msg; csvError.hidden = false; }
  function openPicker() {
    if (batchActive || btnAnalyze.disabled) return; /* re-entry guard */
    if (usingTauri()) {
      /* D7: native Windows dialog opened by the Rust backend (pick_csv). */
      A.pickCsvFile().then(function (path) {
        if (!path) return; /* dialog cancelled */
        startBatchTauri(String(path).split(/[\\/]/).pop() || 'selected.csv');
        A.analyzeCsvFile(path, csvBatchOptions()).then(function (info) {
          rememberBatch(info);
        }, batchStartFailed);
      }).catch(function (err) { showCsvError(readableErr(err)); });
      return;
    }
    fileInput.click();
  }
  function handleFile(file) {
    if (!file || batchActive || btnAnalyze.disabled) return;
    csvError.hidden = true;
    csvError.textContent = '';
    var name = String(file.name || '');
    var isCsv = /\.csv$/i.test(name) || file.type === 'text/csv' || file.type === 'application/vnd.ms-excel';
    if (!isCsv) { showCsvError('Unsupported file type — choose a .csv file.'); return; }
    if (file.size === 0) { showCsvError('The file is empty.'); return; }
    if (file.size > 1024 * 1024) { showCsvError('The file is larger than 1 MB.'); return; }
    if (usingTauri()) {
      /* D7/D8: the Rust backend parses the content and enforces the row limit
         (5,000) itself — the frontend only pre-checks the cheap failure modes. */
      var tfr = new FileReader();
      tfr.onerror = function () { showCsvError('The file could not be read. Try again.'); };
      tfr.onload = function () {
        startBatchTauri(name);
        A.analyzeCsvContent(name, String(tfr.result || ''), csvBatchOptions()).then(function (info) {
          rememberBatch(info);
        }, batchStartFailed);
      };
      tfr.readAsText(file, 'utf-8');
      return;
    }
    var max = S.get('maxCsvEntries') || 5000;
    var fr = new FileReader();
    fr.onerror = function () { showCsvError('The file could not be read. Try again.'); };
    fr.onload = function () {
      var text = String(fr.result || '');
      if (!DAC.csv || typeof DAC.csv.parseText !== 'function') { showCsvError('CSV support is unavailable.'); return; }
      var parsed = DAC.csv.parseText(text, { maxEntries: max });
      if (parsed && parsed.ok === false) { showCsvError(parsed.message || 'The file could not be read as CSV.'); return; }
      var entries = (parsed && parsed.entries || []).filter(function (s) { return String(s).trim() !== ''; });
      if (entries.length === 0) { showCsvError('The file is empty.'); return; }
      startBatch(name, entries);
    };
    fr.readAsText(file, 'utf-8');
  }
  function updateBatchUI(done, total) {
    var pending = total - done;
    csvLine.textContent = total + ' entries detected · ' + done + ' processed · ' + pending + ' pending';
    var pct = total ? Math.round((done / total) * 100) : 0;
    progressBar.style.setProperty('--fill', String(pct / 100));
    progressPct.textContent = pct + '% complete';
    if (progressBox) progressBox.setAttribute('aria-valuenow', String(pct));
    scanBar.style.setProperty('--fill', String(pct / 100));
    scanProgress.setAttribute('aria-valuenow', String(pct));
    /* [T2b] batch runs speak in entries: "Analyzing X of Y" (single scans show
       "Working…"; this line is only driven by updateBatchUI for batches) */
    scanCount.textContent = 'Analyzing ' + done + ' of ' + total;
  }
  function scheduleRow(i, total, mult) {
    batchTimer = window.setTimeout(function () { batchTimer = null; processRow(i, total, mult); }, Math.max(1, Math.round((80 + ((i * 37) % 66)) * mult)));
  }
  function processRow(i, total, mult) {
    if (!batchActive) { resetCsvUi(); setState('idle'); return; } /* cleared mid-run */
    var entry = String(batchEntries[i]).trim();
    var res = analyzeSafe(entry);
    batchRows.push(res); /* [T2b] rendered as a verdict row when the batch closes */
    pushRow(res, true);
    counts[res.risk]++;
    var done = i + 1;
    window.requestAnimationFrame(function () { updateBatchUI(done, total); });
    if (done < total) scheduleRow(done, total, mult);
    else finishBatch(total);
  }
  /* D4: per-item demo delay passed to the Rust engine with every batch. */
  function csvBatchOptions() {
    var speed = S.get('scanSpeed') || 'normal';
    return { minItemDurationMs: BATCH_ITEM_MS[speed] || 60 };
  }
  /* The start reply carries the batchId (+total); remembering it lets the event
     handlers below reject progress/done events that belong to an older batch. */
  function rememberBatch(info) {
    if (!batchActive || !info) return;
    if (info.batchId) activeBatchId = String(info.batchId);
    if (typeof info.total === 'number') updateBatchUI(0, info.total);
  }
  function isStaleBatchEvent(p) {
    return !!(p && p.batchId && activeBatchId && String(p.batchId) !== activeBatchId);
  }
  function batchStartFailed(err) {
    batchActive = false;
    batchEntries = null;
    setBusy(false);
    resetCsvUi();
    setState('idle');
    showCsvError(readableErr(err));
    announce('Batch failed');
  }
  /* Tauri batch: the total is unknown until the backend reports it, so the UI
     opens in a "reading" state and the progress events drive every number. */
  function startBatchTauri(name) {
    batchActive = true;
    cancelRequested = false; /* this run has not been asked to cancel */
    counts = { low: 0, medium: 0, high: 0, unverified: 0, error: 0 };
    batchRows = []; /* [T2b] fresh verdict list per batch */
    setBusy(true);
    setPanelRisk(null); /* T2a: no stale verdict tint while the batch runs */
    if (batchTallyEl) batchTallyEl.textContent = '';
    csvError.hidden = true;
    csvError.textContent = '';
    csvSummary.hidden = false;
    csvName.textContent = name;
    csvName.title = name;
    csvLine.textContent = 'Reading file…';
    progressBar.style.setProperty('--fill', '0');
    progressPct.textContent = 'Reading…';
    if (progressBox) progressBox.setAttribute('aria-valuenow', '0');
    scanBar.style.setProperty('--fill', '0');
    scanProgress.classList.remove('is-indet'); /* batch run = determinate "X of N" */
    scanProgress.setAttribute('aria-valuenow', '0');
    scanCount.textContent = '…';
    setState('scanning');
    announce('Batch scanning started — reading file');
  }
  function startBatch(name, entries) {
    /* capture ONCE per run — settings flips mid-run must not change this run (CONTRACT §2.1) */
    var tdMult = (window.TDSettings && typeof TDSettings.progressMultiplier === "function") ? TDSettings.progressMultiplier() : 1.4;
    batchActive = true;
    batchEntries = entries;
    cancelRequested = false; /* this run has not been asked to cancel */
    counts = { low: 0, medium: 0, high: 0, unverified: 0, error: 0 };
    batchRows = []; /* [T2b] fresh verdict list per batch */
    setBusy(true);
    setPanelRisk(null); /* T2a: no stale verdict tint while the batch runs */
    if (batchTallyEl) batchTallyEl.textContent = '';
    csvSummary.hidden = false;
    csvName.textContent = name;
    csvName.title = name;
    scanProgress.classList.remove('is-indet'); /* batch run = determinate "X of N" */
    updateBatchUI(0, entries.length);
    setState('scanning');
    announce('Batch scanning started — ' + entries.length + ' entries queued');
    scheduleRow(0, entries.length, tdMult);
  }
  function finishBatch(total) {
    if (DAC.history && typeof DAC.history.flush === 'function') DAC.history.flush();
    batchActive = false;
    batchEntries = null;
    setBusy(false);
    updateSummary();
    /* compact risk tally (replaces the old count-pill list) */
    if (batchTallyEl) { batchTallyEl.textContent = ''; }
    renderTally(counts);
    $('batch-meta').textContent = total + ' entries analyzed';
    renderBatchRows(); /* [T2b] scrollable per-row verdicts, file order */
    setState('batch');
    /* progress bar hit 100%: bring the verdict card into view (same double-rAF
       settle-then-scroll pattern the scan start uses; reduced motion = instant) */
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        panel.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      });
    });
    announce('Batch complete — ' + counts.high + ' high risk, ' + counts.medium + ' medium risk results found');
  }

  /* ============ BATCH ROWS (T2b): one compact verdict per CSV row ============
     Results stream into batchRows during the run and render here in file order
     (numeric result id; the mock engine's ids are not numeric, and its arrival
     order is already file order — a stable sort keeps both correct). Rendering
     is chunked through rAF (40 rows per frame) so a 5,000-row batch never
     blocks the frame; each scored row's ring is built lazily by an
     IntersectionObserver only when the row scrolls into view. The list scrolls
     internally (max-height) so the result panel keeps a bounded height. */
  var batchListEl = $('batch-list');
  var batchTallyEl = $('batch-tally');

  /* compact risk tally for the batch header (replaces the old count-pill list) */
  function renderTally(c) {
    if (!batchTallyEl) return;
    batchTallyEl.textContent = '';
    var items = [
      { key: 'low', label: 'Low' },
      { key: 'medium', label: 'Medium' },
      { key: 'high', label: 'High' },
      { key: 'unverified', label: 'Not verified' }
    ];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var n = (c && c[it.key]) || 0;
      if (!n) continue;
      var span = document.createElement('span');
      span.className = 'batch-tally-item';
      var dot = document.createElement('span');
      dot.className = 'batch-tally-dot';
      dot.setAttribute('data-risk', it.key);
      var num = document.createElement('strong');
      num.textContent = String(n);
      var lbl = document.createElement('span');
      lbl.className = 'batch-tally-label';
      lbl.textContent = it.label;
      span.appendChild(dot);
      span.appendChild(num);
      span.appendChild(lbl);
      batchTallyEl.appendChild(span);
    }
  }
  var rowRingRecs = new WeakMap(); /* ring host → record, consumed by the IO */
  var rowCheckRecs = new WeakMap(); /* row-check host → pending draw-on, consumed by the IO */

  function rowNum(r) {
    var n = parseInt(r && r.id, 10);
    return isFinite(n) ? n : 0;
  }
  function rowInputShown(rec) {
    var t = String(rec.input == null ? '' : rec.input);
    if (t.replace(/\s/g, '') === '') return '(empty input)';
    return mask(t);
  }
  function rowSub(rec) {
    var r = rec.risk;
    if (r === 'low') return 'No issues detected';
    if (r === 'unverified' || r === 'error') return String(rec.details || 'This item could not be analyzed.');
    var reasons = Array.isArray(rec.reasons) ? rec.reasons : [];
    return reasons.length ? reasons[0] : 'No risk indicators triggered.';
  }
  /* static dashed neutral ring for errored rows — no glyph, no claim, no color */
  function naRingSvg() {
    var svg = document.createElementNS(NSVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'unv-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var c = document.createElementNS(NSVG, 'circle');
    c.setAttribute('class', 'unv-track');
    c.setAttribute('cx', '12');
    c.setAttribute('cy', '12');
    c.setAttribute('r', '9.4');
    svg.appendChild(c);
    return svg;
  }
  function ensureRowIO() {
    if (!rowRingIO && typeof IntersectionObserver === 'function') {
      rowRingIO = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var en = entries[i];
          if (!en.isIntersecting) continue;
          rowRingIO.unobserve(en.target);
          var r = rowRingRecs.get(en.target) || null;
          rowRingRecs.delete(en.target);
          if (r && typeof V.scoreRing === 'function') V.scoreRing(en.target, r.score, r.risk);
          if (rowCheckRecs.has(en.target)) { /* low row scrolled in: draw the check on */
            rowCheckRecs.delete(en.target);
            en.target.classList.add('is-drawn');
          }
        }
      }, { root: batchListEl, rootMargin: '90px 0px' });
    }
    return rowRingIO;
  }
  function lazyRing(host, rec) {
    rowRingRecs.set(host, rec);
    var io = ensureRowIO();
    if (io) io.observe(host);
    else if (typeof V.scoreRing === 'function') V.scoreRing(host, rec.score, rec.risk); /* no IO support: draw now */
  }
  function batchRowDom(rec, i) {
    var risk = rec.risk;
    var rowRisk = (risk === 'unverified' || risk === 'error') ? 'na' : risk;
    var li = document.createElement('li');
    li.className = 'batch-row';
    li.setAttribute('data-risk', rowRisk);
    li.style.setProperty('--row-i', String(i < 20 ? i : 20)); /* capped stagger */

    var main = document.createElement('div');
    main.className = 'batch-row-main';
    var top = document.createElement('div');
    top.className = 'batch-row-top';
    var lbl = document.createElement('span');
    lbl.className = 'risk-label';
    lbl.setAttribute('data-risk', rowRisk);
    lbl.textContent = RISK_LABEL[risk] || 'Not verified';
    var input = document.createElement('span');
    input.className = 'batch-row-input ellipsis text-truncate';
    var shown = rowInputShown(rec);
    input.textContent = shown;
    if (shown !== '(empty input)') input.title = String(rec.input); /* hover shows the full input, like the table */
    top.appendChild(lbl);
    top.appendChild(input);
    var sub = document.createElement('p');
    sub.className = 'batch-row-sub';
    sub.textContent = rowSub(rec);
    main.appendChild(top);
    main.appendChild(sub);

    var ind = document.createElement('span');
    ind.className = 'batch-row-ind';
    ind.setAttribute('aria-hidden', 'true');
    if (risk === 'medium' || risk === 'high') {
      var ringHost = document.createElement('span');
      ringHost.className = 'ring-wrap batch-row-ring';
      ind.appendChild(ringHost);
      lazyRing(ringHost, rec);
    } else if (risk === 'unverified') {
      var unv = document.createElement('span');
      if (typeof V.unverifiedRing === 'function') V.unverifiedRing(unv);
      else { unv.className = 'unv-ring'; unv.appendChild(naRingSvg()); }
      ind.appendChild(unv);
    } else if (risk === 'error') {
      var errRing = document.createElement('span');
      errRing.className = 'unv-ring';
      errRing.appendChild(naRingSvg());
      ind.appendChild(errRing);
    } else { /* low: static check — no ring, no score, no glow. Scaled to the
                same drawn size as the batch % wheels (r+half-stroke = 11.6/24
                ≈ the wheel's 58/60 in its 120 box); stroke a touch lighter
                than the wheel's arc weight (user preference). Draw-on matches
                the wheels: hidden dash state until the shared row IO fires. */
      ind.classList.add('row-check');
      var chk = document.createElementNS(NSVG, 'svg');
      chk.setAttribute('viewBox', '0 0 24 24');
      chk.setAttribute('aria-hidden', 'true');
      chk.setAttribute('focusable', 'false');
      chk.setAttribute('fill', 'none');
      chk.setAttribute('stroke', 'currentColor');
      chk.setAttribute('stroke-width', '2.2');
      chk.setAttribute('stroke-linecap', 'round');
      chk.setAttribute('stroke-linejoin', 'round');
      var cc = document.createElementNS(NSVG, 'circle');
      cc.setAttribute('class', 'chk-circle');
      cc.setAttribute('cx', '12');
      cc.setAttribute('cy', '12');
      cc.setAttribute('r', '10.05');
      var cp = document.createElementNS(NSVG, 'path');
      cp.setAttribute('class', 'chk-mark');
      cp.setAttribute('d', 'M7.7 12.4l2.9 2.9 5.7-6.1');
      chk.appendChild(cc);
      chk.appendChild(cp);
      ind.appendChild(chk);
      var io = ensureRowIO();
      if (io) { rowCheckRecs.set(ind, ind); io.observe(ind); } /* draw-on when scrolled into view */
      else ind.classList.add('is-drawn'); /* no IO support: draw immediately */
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost batch-row-open';
    btn.setAttribute('data-idx', String(i));
    btn.setAttribute('aria-label', 'View details');
    var btnLbl = document.createElement('span');
    btnLbl.className = 'btn-label';
    btnLbl.textContent = 'View details';
    btn.appendChild(btnLbl);
    var btnArrow = document.createElementNS(NSVG, 'svg');
    btnArrow.setAttribute('viewBox', '0 0 24 24');
    btnArrow.setAttribute('aria-hidden', 'true');
    btnArrow.setAttribute('focusable', 'false');
    btnArrow.setAttribute('fill', 'none');
    btnArrow.setAttribute('stroke', 'currentColor');
    btnArrow.setAttribute('stroke-width', '1.7');
    btnArrow.setAttribute('stroke-linecap', 'round');
    btnArrow.setAttribute('stroke-linejoin', 'round');
    btnArrow.setAttribute('class', 'btn-arrow');
    var btnArrowPath = document.createElementNS(NSVG, 'path');
    btnArrowPath.setAttribute('d', 'M5 12h13M12.6 6.6 18 12l-5.4 5.4');
    btnArrow.appendChild(btnArrowPath);
    btn.appendChild(btnArrow);

    li.appendChild(main);
    li.appendChild(ind);
    li.appendChild(btn);
    return li;
  }
  function renderBatchRows() {
    if (!batchListEl) return;
    batchListEl.textContent = '';
    batchListEl.scrollTop = 0; /* scroll resets per batch */
    var rows = batchRows.slice(0).sort(function (a, b) { return rowNum(a) - rowNum(b); });
    batchRenderOrder = rows;
    var CH = 40, done = 0;
    function chunk() {
      var frag = document.createDocumentFragment();
      var end = Math.min(done + CH, rows.length);
      for (var j = done; j < end; j++) frag.appendChild(batchRowDom(rows[j], j));
      batchListEl.appendChild(frag);
      done = end;
      syncHeight(); /* the panel height follows the list until it hits max-height */
      if (done < rows.length) window.requestAnimationFrame(chunk);
    }
    if (rows.length) window.requestAnimationFrame(chunk);
  }
  /* one delegated listener opens the shared details modal for any row */
  if (batchListEl) {
    batchListEl.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.batch-row-open') : null;
      if (!btn || !batchListEl.contains(btn)) return;
      openBatchDetail(batchRenderOrder[parseInt(btn.getAttribute('data-idx'), 10)]);
    });
  }
  function openBatchDetail(rec) {
    if (!rec || !DAC.ui || typeof DAC.ui.detailsCard !== 'function') return;
    var h = DAC.ui.detailsCard(rec);
    var vis = [];
    var foot = h.card.querySelector('.modal-foot');
    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-secondary';
    copyBtn.textContent = 'Copy input';
    copyBtn.addEventListener('click', function () {
      money.clipboardCopy(rec.input).then(function (ok) {
        if (DAC.ui && typeof DAC.ui.toast === 'function') {
          DAC.ui.toast(ok ? 'Copied to clipboard' : 'Copy failed', { type: ok ? 'success' : 'warn', key: 'copy' });
        }
      });
    });
    foot.appendChild(copyBtn);
    DAC.ui.attachDetailVisuals(h, rec, function (handle) { if (handle) vis.push(handle); });
    DAC.ui.modal.open({
      title: 'Analysis details \u2014 ' + (RISK_LABEL[rec.risk] || 'Not verified'),
      body: h.card,
      onClose: function () {
        for (var i = 0; i < vis.length; i++) {
          if (vis[i] && typeof vis[i].destroy === 'function') vis[i].destroy();
        }
      }
    });
  }

  /* ============ MODE TOGGLE + PANELS (T1) ============
     One panel visible at a time: each .scan-block is the shared .reveal
     component (core.css grid-rows height reveal, data-open="true" = expanded).
     The collapsed panel gets inert + aria-hidden — it leaves the tab order and
     the a11y tree entirely (replaces the old dimmed-block tabindex juggling;
     the static tabindex="-1" on #csv-file-input keeps the programmatic picker
     out of tab order even when its panel is open). The seg radios'
     aria-controls point at the panel ids (same pattern as settings.html). */
  function setPanel(block, open) {
    block.classList.toggle('is-active', open);
    if (open) {
      block.setAttribute('data-open', 'true');
      block.removeAttribute('inert');
      block.removeAttribute('aria-hidden');
    } else {
      block.setAttribute('data-open', 'false');
      block.setAttribute('inert', '');
      block.setAttribute('aria-hidden', 'true');
    }
  }
  function setMode(mode, fromUser) {
    activeMode = (mode === 'csv') ? 'csv' : 'single';
    if (seg._segSet) { seg._segSet(activeMode); } /* [B] thumb owns pill state; panels follow */
    setPanel(blocks.single, activeMode === 'single');
    setPanel(blocks.csv, activeMode === 'csv');
    if (fromUser) {
      if (activeMode === 'single') inputEl.focus();
      else dropZone.focus();
    }
  }

  /* ============ CLEAR ============ */
  function resetCsvUi() {
    csvSummary.hidden = true;
    csvLine.textContent = '';
    csvName.textContent = '';
    csvName.title = '';
    progressBar.style.setProperty('--fill', '0');
    progressPct.textContent = '0% complete';
    if (progressBox) progressBox.setAttribute('aria-valuenow', '0');
    fileInput.value = '';
  }
  function resetAll() {
    if (batchActive && usingTauri()) {
      cancelRequested = true; /* this run's own BatchCancelled rows may still be delivered */
      A.cancelBatch().catch(function () {}); /* SPEC 7.2: Clear = cancel (best effort) */
    }
    scanRun++; /* invalidate any in-flight single-scan answer */
    activeBatchId = null; /* events of the cleared batch can no longer match */
    clearTimers();
    batchActive = false;
    batchEntries = null;
    batchRows = []; batchRenderOrder = []; /* [T2b] drop the cleared batch's verdict list */
    if (batchTallyEl) batchTallyEl.textContent = '';
    scannerH = destroyVisual(scannerH);
    setBusy(false);
    inputEl.value = '';
    growInput();
    inputError.hidden = true;
    csvError.hidden = true;
    csvError.textContent = '';
    resetCsvUi();
    setPanelRisk(null); /* panel returns to idle: no data-risk (contract §2.2) */
    setState('idle');
    announce('Cleared');
  }

  /* ============ WIRING ============ */
  scanForm.addEventListener('submit', function (e) { e.preventDefault(); startScan(); });
  btnClear.addEventListener('click', resetAll);
  btnAnalyze.addEventListener('click', function () { startScan(); });
  inputEl.addEventListener('input', function () { inputError.hidden = true; growInput(); });
  inputEl.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); startScan(); }
  });

  seg.addEventListener('seg-change', function (e) {
    setMode(e && e.detail ? e.detail.value : 'single', true);
  });
  /* [T1] the old dimmed-block click/keys-to-switch wiring is gone: the seg
     radios are the only switcher, and a collapsed panel is inert (not clickable
     at all) — rapid clicks can never leave a half-open state because both panels
     are driven from one setMode call (data-open mirrors is-active). */

  /* Drop zone interactions */
  dropZone.addEventListener('click', openPicker);
  dropZone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); }
  });
  function dragOver(e) { e.preventDefault(); dropZone.classList.add('is-dragover'); }
  function dragOut(e) { e.preventDefault(); dropZone.classList.remove('is-dragover'); }
  dropZone.addEventListener('dragenter', dragOver);
  dropZone.addEventListener('dragover', dragOver);
  dropZone.addEventListener('dragleave', dragOut);
  dropZone.addEventListener('drop', function (e) {
    dragOut(e);
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', function () {
    handleFile(fileInput.files && fileInput.files[0]);
    fileInput.value = ''; /* allows re-selecting the same file */
  });

  /* Dropping a file outside the CSV zone must never navigate the window to
     that file (default WebView/browser behavior would) — swallow it instead. */
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) { e.preventDefault(); });

  /* ===== TAURI BATCH EVENTS (Rust → TD.events, republished by the adapter) =====
     Every handler is guarded by batchActive: after Clear the UI stays reset even
     though the backend may still deliver a few in-flight results (decision D5). */
  if (window.TD && TD.events) {
    TD.events.on('analysis:progress', function (p) {
      if (!batchActive || !p || isStaleBatchEvent(p)) return;
      updateBatchUI(p.done, p.total);
    });
    TD.events.on('analysis:item-done', function (p) {
      if (!batchActive || !p || !p.result) return;
      /* A result cancelled by the CURRENT run is delivered on purpose (D5);
         the same marker arriving with no cancel request is a straggler from an
         older, already-cleared batch — drop it. */
      if (p.result.error && p.result.error.kind === 'BatchCancelled' && !cancelRequested) return;
      var ui = ipcToUi(p.result);
      if (!(ui.risk in counts)) ui.risk = 'unverified'; /* contract-violation guard */
      batchRows.push(ui); /* [T2b] rendered as a verdict row when the batch closes */
      pushRow(ui, true);
      counts[ui.risk]++;
    });
    TD.events.on('analysis:batch-done', function (p) {
      if (!batchActive || !p || isStaleBatchEvent(p)) return;
      /* Count = results actually delivered (D5): smaller than the total after a
         cancel; rows were already streamed via item-done, so this only closes. */
      var delivered = (typeof p.count === 'number') ? p.count
        : counts.low + counts.medium + counts.high + counts.unverified + counts.error;
      finishBatch(delivered);
    });
  }

  $('btn-download-sample').addEventListener('click', function () {
    if (DAC.csv && typeof DAC.csv.downloadSample === 'function') DAC.csv.downloadSample();
  });
  btnScroll.addEventListener('click', function () {
    scanCardEl.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  });

  function growInput() {
    window.requestAnimationFrame(function () {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(Math.max(inputEl.scrollHeight, 44), 160) + 'px';
    });
  }

  /* Debounced height re-sync on resize */
  var debounced = money.debounce ? money.debounce(syncHeight, 120) : syncHeight;
  window.addEventListener('resize', debounced);

  /* ============ SETTINGS RE-APPLY (parent-wide sync) ============ */
  if (typeof S.onChange === 'function') {
    S.onChange(function (key) {
      if (key === 'showHero') heroEl.hidden = !S.get('showHero');
      else if (key === 'defaultInputMode') setMode(S.get('defaultInputMode') || 'single', false);
      else if (key === 'timeFormat' || key === 'maskSensitive') {
        if (!batchActive) { rebuildTable(); updateSummary(); }
      } else if (key === 'reduceAnimations' || key === 'accent' || key === 'textSize' || key === 'density') {
        window.requestAnimationFrame(syncHeight);
      }
      /* scanSpeed / maxCsvEntries / notifyHighRisk … are read fresh at use time */
    });
  }

  /* ============ INIT (first render: idle; hero/mode from settings) ============ */
  heroEl.hidden = !S.get('showHero');
  setMode(S.get('defaultInputMode') || 'single', false);
  rebuildTable();
  updateSummary();
  growInput();
  /* Adopt the shared verdict-card builder as the single markup source for the
     three verdict states: replaces the static shells with identical builder
     markup (same classes/ids). Visuals still mount per result in setState. */
  (function () {
    var card = TD.components.verdictCard;
    if (!card || typeof card.render !== 'function') return;
    card.render(stateEls.threat, 'medium');   /* placeholder matches the static shell */
    card.render(stateEls.safe, 'low');
    card.render(stateEls.unverified, 'unverified');
  })();
  setState('idle');
})();
