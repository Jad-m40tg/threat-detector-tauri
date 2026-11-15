/* ===== PAGE: history ===== */
    (function () {
      'use strict';

      /* Guard: requires the shared core (dev open without _src siblings is a no-op) */
      var dac = window.DAC;
      if (!dac || !dac.ui || typeof dac.ui.boot !== 'function') { return; }
      dac.ui.boot({ page: 'history' });

      var ui = dac.ui, hist = dac.history, utils = dac.utils, vis = dac.visuals;
      var $ = function (id) { return document.getElementById(id); };
      var esc = function (s) { return utils.escapeHtml(String(s == null ? '' : s)); };

      /* ---------- icons (inline SVG, outline, stroke currentColor; no emoji) ---------- */
      function svgIcon(paths) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + paths + '</svg>';
      }
      var ICON_GLOBE = svgIcon('<circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8"/><path d="M12 3.6c2.6 2.3 3.9 5.1 3.9 8.4s-1.3 6.1-3.9 8.4c-2.6-2.3-3.9-5.1-3.9-8.4S9.4 5.9 12 3.6Z"/>');
      var ICON_MAIL = svgIcon('<rect x="3.2" y="5.4" width="17.6" height="13.2" rx="2"/><path d="m4.6 7.4 7.4 5.5 7.4-5.5"/>');
      var ICON_CHECK = svgIcon('<path d="m5.5 12.5 4 4 9-9.5"/>');
      var ICON_WARN = svgIcon('<path d="M12 4.2 20.6 19H3.4L12 4.2Z"/><path d="M12 9.8v3.8"/><path d="M12 16.4h.01"/>');
      var ICON_X = svgIcon('<circle cx="12" cy="12" r="8.4"/><path d="m9.2 9.2 5.6 5.6"/><path d="m14.8 9.2-5.6 5.6"/>');

      /* ---------- copy/label maps (CONTRACT §7 + copy deck §13) ---------- */
      var RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk', unverified: 'Not verified', error: 'Error' };
      var RISK_CLS = { low: 'risk-low', medium: 'risk-medium', high: 'risk-high', unverified: 'risk-na', error: 'risk-na' };
      var SHIELD_STATE = { low: 'secure', medium: 'caution', high: 'threat' };
      var STATUS = { verified: { txt: 'Verified', cls: 'is-ok', icon: ICON_CHECK }, not_verified: { txt: 'Not Verified', cls: 'is-warn', icon: ICON_WARN }, error: { txt: 'Error', cls: 'is-error', icon: ICON_X } };
      var RANK_RISK = { error: 0, unverified: 1, low: 2, medium: 3, high: 4 };
      var RANK_STATUS = { error: 1, not_verified: 2, verified: 3 };
      var DEFAULT_DIR = { input: 'asc', risk: 'desc', score: 'desc', status: 'desc', details: 'asc', time: 'desc' };
      var HEAD_IDS = { input: 'th-input', risk: 'th-risk', score: 'th-score', status: 'th-status', details: 'th-details', time: 'th-time' };

      /* ---------- state + elements ---------- */
      var state = { q: '', risk: 'all', type: 'all', range: 'all', sort: { key: 'time', dir: 'desc' }, page: 1, per: 10 };
      var el = {
        search: $('history-search'), selType: $('sel-type'), selRange: $('sel-range'),
        chips: $('chips-risk'), perPage: $('row-perpage'), prev: $('btn-prev'), next: $('btn-next'),
        pageNumbers: $('page-numbers'), meta: $('results-meta'), pagination: $('pagination'),
        tbody: $('table-history-body'), tableWrap: $('table-wrap'), table: $('table-history'),
        empty: $('empty-state'), emptyMsg: $('empty-message'), emptyActions: $('empty-actions'),
        restore: $('btn-restore'), reset: $('btn-reset-filters'), resetSlot: $('reset-slot'),
        exportBtn: $('btn-export'), clearBtn: $('btn-clear-history'),
        tiles: { total: $('t-total'), high: $('t-high'), medium: $('t-medium'), low: $('t-low'), na: $('t-na') }
      };
      var pageRows = [];       /* rows on the current page (modal lookup) */
      var viewRows = [];       /* fully filtered+sorted list (export lookup) */
      var modalVis = [];       /* destroy() handles for the modal's ring/shield */

      /* ---------- small builders ---------- */
      function statusHtml(status) {
        var s = STATUS[status] || STATUS.error;
        return '<span class="status-line ' + s.cls + '">' + s.icon + '<span>' + s.txt + '</span></span>';
      }
      function scoreText(r) {
        if (r.risk === 'unverified' || r.risk === 'error') { return '<span class="score-na">&mdash;</span>'; }
        var n = String(r.score);
        return (n.length < 2 ? '0' + n : n) + '/100';
      }
      function rowHtml(r) {
        var shown = utils.mask(r.input);
        var shownOut = shown.length > 120 ? shown.slice(0, 120) : shown; /* title attr kept readable */
        return '<tr data-id="' + esc(r.id) + '">' +
          '<td data-label="Input" class="cell-input">' +
            '<span class="type-icon" aria-hidden="true">' + (r.type === 'message' ? ICON_MAIL : ICON_GLOBE) + '</span>' +
            '<button type="button" class="input-open text-truncate" title="' + esc(shownOut) + '">' + esc(shown) + '</button>' +
          '</td>' +
          '<td data-label="Risk Level">' + ui.riskTagHtml(r.risk) + '</td>' +
          '<td data-label="Score" class="cell-score">' + scoreText(r) + '</td>' +
          '<td data-label="Status">' + statusHtml(r.status) + '</td>' +
          '<td data-label="Details"><span class="details-text text-truncate" title="' + esc(r.details) + '">' + esc(r.details) + '</span></td>' +
          '<td data-label="Time"><span class="history-time" title="' + esc(dac.time.exact(r.ts)) + '">' + esc(dac.time.format(r.ts)) + '</span></td>' +
        '</tr>';
      }

      /* ---------- filters (search OR-match, risk chip, type, day-boundary range) ---------- */
      function rangeStartTs() {
        if (state.range === 'today') { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
        if (state.range === '7d') { return Date.now() - 7 * 86400000; }
        if (state.range === '30d') { return Date.now() - 30 * 86400000; }
        return null;
      }
      function applyFilters(rows) {
        var q = state.q.trim().toLowerCase();
        var start = rangeStartTs();
        return rows.filter(function (r) {
          if (state.risk !== 'all') {
            if (state.risk === 'unverified') { /* Not Verified chip matches unverified OR error rows */
              if (r.risk !== 'unverified' && r.risk !== 'error') { return false; }
            } else if (r.risk !== state.risk) { return false; }
          }
          if (state.type !== 'all' && r.type !== state.type) { return false; }
          if (start !== null && !(r.ts >= start)) { return false; }
          if (q) {
            var a = String(r.input).toLowerCase().indexOf(q);
            var b = String(r.details).toLowerCase().indexOf(q);
            if (a === -1 && b === -1) { return false; }
          }
          return true;
        });
      }

      /* ---------- sorting (single active key; default direction per column) ---------- */
      function sortRows(rows) {
        var key = state.sort.key, dir = state.sort.dir === 'asc' ? 1 : -1;
        rows.sort(function (a, b) {
          var c = 0;
          if (key === 'score') { c = (a.score || 0) - (b.score || 0); }
          else if (key === 'time') { c = a.ts - b.ts; }
          else if (key === 'risk') { c = (RANK_RISK[a.risk] || 0) - (RANK_RISK[b.risk] || 0); }
          else if (key === 'status') { c = (RANK_STATUS[a.status] || 0) - (RANK_STATUS[b.status] || 0); }
          else { c = String(a[key] || '').localeCompare(String(b[key] || ''), 'en', { sensitivity: 'base', numeric: true }); }
          if (c === 0) { c = b.ts - a.ts; }          /* stable fallback: newest first */
          if (c === 0) { c = String(a.id).localeCompare(String(b.id)); }
          return c * dir;
        });
        return rows;
      }
      function hasActiveFilters() {
        return state.q.trim() !== '' || state.risk !== 'all' || state.type !== 'all' || state.range !== 'all';
      }

      /* ---------- render: single pipeline — tiles -> filters -> list -> page ---------- */
      var hasCountUp = function () { return vis && typeof vis.countUp === 'function'; };
      function setTile(node, n) {
        if (node.__val === n) { return; }           /* re-animate only when the real count changes */
        node.__val = n;
        if (hasCountUp()) { vis.countUp(node, n); } else { node.textContent = String(n); }
      }
      function renderTiles(all) {
        var counts = { total: all.length, high: 0, medium: 0, low: 0, na: 0 };
        all.forEach(function (r) {
          if (r.risk === 'high') { counts.high++; }
          else if (r.risk === 'medium') { counts.medium++; }
          else if (r.risk === 'low') { counts.low++; }
          else { counts.na++; }                     /* unverified + error -> the tiles stay summing to Total */
        });
        setTile(el.tiles.total, counts.total); setTile(el.tiles.high, counts.high);
        setTile(el.tiles.medium, counts.medium); setTile(el.tiles.low, counts.low);
        setTile(el.tiles.na, counts.na);
      }
      function renderHeaders() {
        for (var key in HEAD_IDS) {
          if (!Object.prototype.hasOwnProperty.call(HEAD_IDS, key)) { continue; }
          var th = $(HEAD_IDS[key]);
          var btn = th ? th.querySelector('.th-btn') : null;
          if (!th || !btn) { continue; }
          var active = state.sort.key === key;
          th.setAttribute('aria-sort', active ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
          btn.classList.toggle('is-sorted', active);
          btn.classList.toggle('is-desc', active && state.sort.dir === 'desc');
        }
      }
      function renderChips() {
        var chips = el.chips.querySelectorAll('.chip');
        Array.prototype.forEach.call(chips, function (c) {
          var on = c.getAttribute('data-chip') === state.risk;
          c.classList.toggle('is-active', on);
          c.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }
      function pageListFor(cur, pages) {
        if (pages <= 7) { var out = [], i; for (i = 1; i <= pages; i++) { out.push(i); } return out; }
        var list = [1];
        var left = Math.max(2, cur - 1), right = Math.min(pages - 1, cur + 1);
        if (left > 2) { list.push('\u2026'); }
        var n; for (n = left; n <= right; n++) { list.push(n); }
        if (right < pages - 1) { list.push('\u2026'); }
        list.push(pages);
        return list;
      }
      function renderPager(total, pages) {
        el.prev.disabled = state.page <= 1;
        el.next.disabled = state.page >= pages;
        var parts = pageListFor(state.page, pages).map(function (p) {
          if (p === '\u2026') { return '<span class="page-ellipsis" aria-hidden="true">\u2026</span>'; }
          var mine = p === state.page;
          return '<button type="button" class="page-btn' + (mine ? ' is-current' : '') + '" data-page="' + p + '"' + (mine ? ' aria-current="page"' : '') + '>' + p + '</button>';
        });
        /* keep keyboard context: restore focus to the same page button after rebuild */
        var refocus = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-page');
        el.pageNumbers.innerHTML = parts.join('');
        if (refocus !== undefined && refocus !== null) {
          var again = el.pageNumbers.querySelector('[data-page="' + refocus.replace(/"/g, '') + '"]');
          if (again) { again.focus(); }
        }
        var startIdx = (state.page - 1) * state.per + 1;
        var endIdx = startIdx + pageRows.length - 1;
        el.meta.textContent = 'Showing ' + startIdx + '\u2013' + endIdx + ' of ' + total;
      }
      /* ---------- empty state (filtered-empty message exact per copy deck) ---------- */
      function renderEmpty(cleared, filteredEmpty) {
        if (cleared || filteredEmpty) {
          el.empty.hidden = false;
          el.tableWrap.hidden = true;
          el.pagination.hidden = true;
          /* Single #btn-reset-filters element: relocate into the empty state when the
             filtered list is empty (empty-state requirement) so the id stays unique. */
          if (filteredEmpty && el.reset.parentNode !== el.emptyActions) {
            el.emptyActions.insertBefore(el.reset, el.restore);
          }
          el.reset.hidden = !filteredEmpty || !hasActiveFilters();
          el.restore.hidden = !cleared;          /* restore offer belongs to the cleared list only */
          el.emptyMsg.textContent = cleared ? 'History has been cleared.' : 'No results match your filters.';
        } else {
          el.empty.hidden = true;
          el.tableWrap.hidden = false;
          el.pagination.hidden = false;
          if (el.reset.parentNode !== el.resetSlot) { el.resetSlot.appendChild(el.reset); }
          el.reset.hidden = !hasActiveFilters(); /* task choice: visible only while a filter is active */
        }
      }

      /* ---------- the one render(): filters -> list -> page -> DOM ---------- */
      function render() {
        var all = hist.all();
        renderTiles(all);                        /* tiles always reflect the UNFILTERED list */
        var filtered = sortRows(applyFilters(all));
        viewRows = filtered;

        var total = filtered.length;
        var pages = Math.max(1, Math.ceil(total / state.per));
        if (state.page > pages) { state.page = pages; }
        if (state.page < 1) { state.page = 1; }
        var start = (state.page - 1) * state.per;
        pageRows = filtered.slice(start, start + state.per);

        var cleared = all.length === 0;
        var filteredEmpty = !cleared && total === 0;

        el.exportBtn.disabled = total === 0;
        el.clearBtn.disabled = all.length === 0;

        el.tbody.innerHTML = pageRows.map(rowHtml).join('');
        renderChips();
        renderHeaders();
        renderPager(total, pages);
        renderEmpty(cleared, filteredEmpty);
      }

      /* ---------- row details modal (focus trap/restore handled by DAC.ui.modal) ---------- */
      function destroyModalVis() {
        modalVis.forEach(function (h) { if (h && typeof h.destroy === 'function') { h.destroy(); } });
        modalVis = [];
      }
      function findRecord(id) {
        var i, list;
        for (i = 0; i < pageRows.length; i++) { if (pageRows[i].id === id) { return pageRows[i]; } }
        list = viewRows;
        for (i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
        list = hist.all();
        for (i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
        return null;
      }
      function openDetails(id) {
        var r = findRecord(id);
        if (!r) { return; }
        destroyModalVis();

        /* Shared builder (core.js): identical classes + shell for the history
           modal and the dashboard batch "view details" modal. Per-type visuals
           (check circle for Low, dashed ring for Not Verified …) live there. */
        var h = ui.detailsCard(r);
        var card = h.card;

        /* footer action: Copy input -> clipboard fallback inside utils, always acknowledge */
        var foot = card.querySelector('.modal-foot');
        var copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.id = 'btn-copy-input';
        copyBtn.className = 'btn btn-secondary';
        copyBtn.textContent = 'Copy input';
        copyBtn.addEventListener('click', function () {
          utils.clipboardCopy(r.input).then(function (ok) {
            if (ok) { ui.toast('Copied to clipboard', { type: 'success', key: 'copy' }); }
            else { ui.toast('Copy failed', { type: 'warn', key: 'copy' }); }
          });
        });
        foot.appendChild(copyBtn);

        /* animated visuals (CONTRACT §11) attach via the shared helper; every
           handle is collected in modalVis and destroyed on close */
        ui.attachDetailVisuals(h, r, function (handle) { modalVis.push(handle); });

        ui.modal.open({ title: 'Analysis details \u2014 ' + RISK_LABEL[r.risk], body: card, onClose: destroyModalVis });
      }

      /* ---------- actions: export / clear / restore / reset ---------- */
      function buildCsvLocal(rows) { /* fallback only, used if engine's buildCsv expects a different row shape */
        return rows.map(function (row) {
          return row.map(function (cell) {
            var s = String(cell == null ? '' : cell);
            return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
          }).join(',');
        }).join('\r\n');
      }
      function exportCsv() { /* exports the CURRENT filtered+sorted view (all pages) */
        var rows = [['Input', 'Type', 'Risk', 'Score', 'Status', 'Details', 'Time']];
        viewRows.forEach(function (r) {
          rows.push([
            utils.mask(r.input),
            r.type === 'message' ? 'Message' : 'URL',
            RISK_LABEL[r.risk],
            (r.risk === 'unverified' || r.risk === 'error') ? '' : String(r.score),
            (STATUS[r.status] || STATUS.error).txt,
            r.details,
            dac.time.exact(r.ts)
          ]);
        });
        var csv = (typeof dac.csv.buildCsv === 'function') ? dac.csv.buildCsv(rows) : buildCsvLocal(rows);
        var stamp = new Date().toISOString().slice(0, 10);
        dac.csv.exportDownload(csv, 'scan-history-' + stamp + '.csv');
        ui.toast('History exported (' + viewRows.length + ' rows)', { type: 'success', key: 'export' });
      }
      function resetFilters() {
        state.q = ''; state.risk = 'all'; state.type = 'all'; state.range = 'all'; state.page = 1;
        el.search.value = ''; el.selType.value = 'all'; el.selRange.value = 'all';
        render();
      }
      function clearAll() {
        ui.confirm.open({
          title: 'Clear history',
          message: 'This removes all scans from the demo history. Demo results are fictional and the demo data can be restored afterwards.',
          confirmLabel: 'Clear history',
          cancelLabel: 'Cancel',
          danger: true
        }).then(function (ok) {
          if (!ok) { return; }
          hist.clear();
          resetFilters();               /* avoid "No results match your filters." after a clear */
          ui.toast('History cleared', 'success');
        });
      }
      function restoreDemo() {
        hist.restoreDemo();
        render();
        ui.toast('Demo data restored', 'success');
      }

      /* ---------- events (wired once; rows/pagination use delegation) ---------- */
      el.search.addEventListener('input', utils.debounce(function () {
        var v = el.search.value;
        if (v === state.q) { return; }
        state.q = v; state.page = 1;
        render();
      }, 220));

      el.chips.addEventListener('click', function (e) {
        var chip = e.target && e.target.closest ? e.target.closest('.chip') : null;
        if (!chip) { return; }
        var next = chip.getAttribute('data-chip');
        if (next === state.risk) { return; }
        state.risk = next; state.page = 1;
        render();
      });

      el.selType.addEventListener('change', function () { state.type = el.selType.value; state.page = 1; render(); });
      el.selRange.addEventListener('change', function () { state.range = el.selRange.value; state.page = 1; render(); });
      el.perPage.addEventListener('change', function () { state.per = parseInt(el.perPage.value, 10) || 10; state.page = 1; render(); });

      el.prev.addEventListener('click', function () { state.page = Math.max(1, state.page - 1); render(); });
      el.next.addEventListener('click', function () { state.page = state.page + 1; render(); });
      el.pageNumbers.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('.page-btn') : null;
        if (!b) { return; }
        state.page = parseInt(b.getAttribute('data-page'), 10) || 1;
        render();
      });

      /* sortable headers: same key toggles direction, new key starts at its default direction */
      el.table.querySelector('thead').addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('.th-btn') : null;
        if (!b) { return; }
        var key = b.getAttribute('data-key');
        if (state.sort.key === key) {
          state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sort.key = key;
          state.sort.dir = DEFAULT_DIR[key] || 'asc';
        }
        render();
      });

      /* row click/Enter opens the details modal (buttons inside rows give native keyboard) */
      el.tbody.addEventListener('click', function (e) {
        var tr = e.target && e.target.closest ? e.target.closest('tr[data-id]') : null;
        if (!tr) { return; }
        openDetails(tr.getAttribute('data-id'));
      });

      el.exportBtn.addEventListener('click', exportCsv);
      el.clearBtn.addEventListener('click', clearAll);
      el.restore.addEventListener('click', restoreDemo);
      el.reset.addEventListener('click', resetFilters);

      /* settings (mask/time format/theme data) can change anywhere -> re-derive display */
      dac.settings.onChange(function () { render(); });

      /* ---------- #risk=<level> prefilter from dashboard Review links (silent, then cleared) ---------- */
      (function initFromHash() {
        var m = /^#risk=(low|medium|high)$/i.exec(window.location.hash || '');
        if (m) {
          state.risk = m[1].toLowerCase();
          try {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
          } catch (err) {
            try { window.location.hash = ''; } catch (err2) { /* file:// edge: hash validation stays */ }
          }
        }
      })();

      /* a11y (2.4.7 Focus Visible): below 640px the sortable headers are visually
         hidden (clipped thead) while their buttons would still take tab stops —
         focus would disappear onto invisible controls in stacked-card view.
         Drop those stops only inside the stacked breakpoint; desktop keyboard
         sorting keeps its normal order. */
      var headBtns = Array.prototype.slice.call(el.table.querySelectorAll('.th-btn'));
      function syncHeadTabbable() {
        var stacked = false;
        try { stacked = window.matchMedia('(max-width: 639px)').matches === true; } catch (e) { /* no matchMedia: keep default tabbing */ }
        for (var i = 0; i < headBtns.length; i++) {
          if (stacked) { headBtns[i].setAttribute('tabindex', '-1'); }
          else { headBtns[i].removeAttribute('tabindex'); }
        }
      }
      syncHeadTabbable();
      if (window.matchMedia) {
        var mqStack = window.matchMedia('(max-width: 639px)');
        if (typeof mqStack.addEventListener === 'function') { mqStack.addEventListener('change', syncHeadTabbable); }
        else if (typeof mqStack.addListener === 'function') { mqStack.addListener(syncHeadTabbable); }
      }

      render();
    })();
