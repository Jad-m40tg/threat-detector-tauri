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
      counts = null, activeMode = 'single', lastRes = null;

  var subMsgs = ['Checking URL structure...', 'Analyzing language...', 'Comparing known patterns...'];
  var RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk', unverified: 'Not verified', error: 'Error' };
  var PILL_LABEL = { low: 'Low', medium: 'Medium', high: 'High', unverified: 'N/A', error: 'N/A' };
  var STATUS_LABEL = { verified: 'Verified', not_verified: 'Not Verified', error: 'Error' };
  var SPEED_MS = { fast: 1000, normal: 2000, slow: 3500 };

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
    if (res.risk === 'medium' || res.risk === 'high') {
      var lbl = $('threat-risk-label');
      lbl.textContent = RISK_LABEL[res.risk];
      lbl.setAttribute('data-risk', res.risk);
      setPanelRisk(res.risk);
      $('detail-input').textContent = money.mask ? money.mask(res.input) : res.input;
      $('detail-score').textContent = String(clampN(res.score, 99));
      var ul = $('detail-reasons');
      ul.textContent = '';
      var rs = res.reasons || [];
      for (var j = 0; j < rs.length; j++) {
        var li = document.createElement('li');
        li.textContent = rs[j];
        ul.appendChild(li);
      }
      $('detail-action').textContent = res.recommendation || '';
      setState('threat');
      if (typeof V.scoreRing === 'function') {
        ringT = V.scoreRing($('vis-ring-threat'), clampN(res.score, 99), res.risk);
      }
    } else if (res.risk === 'unverified') {
      setPanelRisk('unverified');
      $('unv-reason').textContent = 'Connection timeout.';
      $('unv-action').textContent = res.recommendation || 'Unable to verify. Treat as untrusted and try again later.';
      setState('unverified');
      if (typeof V.scoreRing === 'function') {
        ringU = V.scoreRing($('vis-ring-unv'), res.score, res.risk);
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
    var res = analyzeSafe(text);
    /* capture ONCE per run — settings flips mid-run must not change this run (CONTRACT §2.1) */
    var tdMult = (window.TDSettings && typeof TDSettings.progressMultiplier === "function") ? TDSettings.progressMultiplier() : 1.4;

    setBusy(true);
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
    scanTimer = window.setTimeout(function () { finishScan(res); }, dur);
  }
  function finishScan(res) {
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
    err: [{ t: 'circle', a: { cx: '12', cy: '12', r: '8.2' } }, { t: 'path', a: { d: 'M12 8v4.8' } }, { t: 'path', a: { d: 'M12 16.4h.01' } }],
    dot: [{ t: 'circle', a: { cx: '12', cy: '12', r: '5', fill: 'currentColor', stroke: 'none' } }]
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
    var pillRisk = (res.risk === 'unverified' || res.risk === 'error') ? 'na' : res.risk;
    var pill = document.createElement('span');
    pill.className = 'pill';
    pill.setAttribute('data-risk', pillRisk);
    pill.appendChild(icon('dot'));
    pill.appendChild(document.createTextNode(PILL_LABEL[res.risk]));
    td2.appendChild(pill);

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
  }
  function rebuildTable() {
    while (tableBody.firstChild) tableBody.removeChild(tableBody.firstChild);
    var all = DAC.history && typeof DAC.history.all === 'function' ? DAC.history.all() : [];
    var n = clampN(all.length, 5);
    for (var j = 0; j < n; j++) tableBody.appendChild(rowDom(all[j]));
  }
  function pushRow(res) {
    if (DAC.history && typeof DAC.history.add === 'function') DAC.history.add(res);
    tableBody.insertBefore(rowDom(res), tableBody.firstChild);
    trimTo(5);
  }

  /* ============ THREAT SUMMARY (SPEC 7.5) ============ */
  function countUpEl(el, n) {
    if (typeof V.countUp === 'function') { V.countUp(el, n, { duration: 700 }); return; }
    el.textContent = String(n);
  }
  function updateSummary() {
    var all = DAC.history && typeof DAC.history.all === 'function' ? DAC.history.all() : [];
    var recent = all.slice(0, 10); /* last 10 scans per SPEC */
    var high = 0, med = 0, today = 0;
    var midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    var mt = midnight.getTime();
    for (var j = 0; j < recent.length; j++) {
      var r = recent[j];
      if (r.risk === 'high') high++;
      else if (r.risk === 'medium') med++;
      if (r.ts >= mt) today++;
    }
    var state, title, desc, href;
    if (high > 0) { state = 'threat'; title = 'Threat detected'; desc = high + ' high-risk results in recent scans'; href = 'history.html#risk=high'; }
    else if (med > 0) { state = 'caution'; title = 'Use caution'; desc = med + ' medium-risk results in recent scans'; href = 'history.html#risk=medium'; }
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
    var max = S.get('maxCsvEntries') || 100;
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
    scanCount.textContent = done + ' of ' + total;
  }
  function scheduleRow(i, total, mult) {
    batchTimer = window.setTimeout(function () { batchTimer = null; processRow(i, total, mult); }, Math.max(1, Math.round((80 + ((i * 37) % 66)) * mult)));
  }
  function processRow(i, total, mult) {
    if (!batchActive) { resetCsvUi(); setState('idle'); return; } /* cleared mid-run */
    var entry = String(batchEntries[i]).trim();
    var res = analyzeSafe(entry);
    pushRow(res);
    if (DAC.history && typeof DAC.history.addDeferred === 'function') DAC.history.addDeferred(res);
    else if (DAC.history && typeof DAC.history.add === 'function') DAC.history.add(res);
    counts[res.risk]++;
    var done = i + 1;
    window.requestAnimationFrame(function () { updateBatchUI(done, total); });
    if (done < total) scheduleRow(done, total, mult);
    else finishBatch(total);
  }
  function startBatch(name, entries) {
    /* capture ONCE per run — settings flips mid-run must not change this run (CONTRACT §2.1) */
    var tdMult = (window.TDSettings && typeof TDSettings.progressMultiplier === "function") ? TDSettings.progressMultiplier() : 1.4;
    batchActive = true;
    batchEntries = entries;
    counts = { low: 0, medium: 0, high: 0, unverified: 0, error: 0 };
    setBusy(true);
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
    var list = $('batch-list');
    list.textContent = '';
    var NAMES = { low: 'Low', medium: 'Medium', high: 'High', unverified: 'Not verified', error: 'Error' };
    var order = ['low', 'medium', 'high', 'unverified', 'error'];
    for (var j = 0; j < order.length; j++) {
      var k = order[j];
      if (!counts[k]) continue;
      var li = document.createElement('li');
      li.className = 'dash-batchrow';
      var pill = document.createElement('span');
      pill.className = 'pill';
      pill.setAttribute('data-risk', (k === 'unverified' || k === 'error') ? 'na' : k);
      pill.appendChild(icon('dot'));
      pill.appendChild(document.createTextNode(NAMES[k]));
      var num = document.createElement('strong');
      num.textContent = String(counts[k]);
      li.appendChild(pill); li.appendChild(num);
      list.appendChild(li);
    }
    $('batch-meta').textContent = total + ' entries analyzed';
    setState('batch');
    announce('Batch complete — ' + counts.high + ' high risk, ' + counts.medium + ' medium risk results found');
  }

  /* ============ MODE TOGGLE + BLOCKS ============ */
  function setBlock(block, active, dimLabel) {
    block.classList.toggle('is-active', active);
    block.classList.toggle('block--dimmed', !active);
    if (active) {
      block.removeAttribute('role');
      block.removeAttribute('aria-label');
      block.removeAttribute('tabindex');
    } else {
      block.setAttribute('role', 'button');
      block.setAttribute('tabindex', '0');
      block.setAttribute('aria-label', dimLabel);
    }
    var fs = block.querySelectorAll('button, input, textarea, a');
    for (var j = 0; j < fs.length; j++) {
      if (fs[j] === fileInput) { fs[j].setAttribute('tabindex', '-1'); continue; }
      if (active) fs[j].removeAttribute('tabindex');
      else fs[j].setAttribute('tabindex', '-1');
    }
  }
  function setMode(mode, fromUser) {
    activeMode = (mode === 'csv') ? 'csv' : 'single';
    if (seg._segSet) { seg._segSet(activeMode); } /* [B] thumb owns pill state; blocks follow */
    setBlock(blocks.single, activeMode === 'single', 'Switch to single input (URL or message)');
    setBlock(blocks.csv, activeMode === 'csv', 'Switch to CSV batch input');
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
    clearTimers();
    batchActive = false;
    batchEntries = null;
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
  /* Dimmed block click/keys switch the mode (SPEC 7.2) */
  function blockSwitch(block, other) {
    block.addEventListener('click', function (e) {
      if (!block.classList.contains('block--dimmed')) return;
      e.preventDefault();
      setMode(other, true);
    });
    block.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && block.classList.contains('block--dimmed')) {
        e.preventDefault();
        setMode(other, true);
      }
    });
  }
  blockSwitch(blocks.single, 'csv');
  blockSwitch(blocks.csv, 'single');

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
  setState('idle');
})();
