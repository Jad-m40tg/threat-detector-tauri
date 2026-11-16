/* ===== TD.components.verdictCard — the standard verdict result card ===== */
/* Owner: shared component (dashboard result panel + Settings preview).
   Depends on: DAC.utils.mask. Exposes: TD.components.verdictCard.render(host, verdict, data, opts).
   One markup source for the dashboard's result card and the Settings
   "Preview" modal: the dashboard mounts this markup into its static
   .result-state shells at boot and fills it per scan (js/pages/index.js);
   the Settings preview renders the same markup inside its own container.
   Look/tint: css/components/verdict-card.css. verdict is one of the exact
   data-risk values the engine uses: high|medium (Analysis details state),
   low (safe state), unverified (dashed state). */
(function () {
  'use strict';
  window.TD = window.TD || {};
  TD.components = TD.components || {};

  var LABELS = { low: 'Low risk', medium: 'Medium risk', high: 'High risk', unverified: 'Not verified' };
  var STATE_OF = { high: 'threat', medium: 'threat', low: 'safe', unverified: 'unverified' };
  var clampN = function (n, d) { return n < d ? n : d; };

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  /* build(verdict, ids, compact) → refs for one verdict's card content.
     The markup mirrors the dashboard's static states (index.html) exactly.
     ids: the dashboard keeps the real ids (other code targets them); preview
     copies pass ids:false because several cards coexist in one document.
     compact: short card for the Settings preview (sketch round 2) — only the
     prominent label + Selected input + Risk score + ring; drops the muted
     "Analysis details" heading and the reasons/action rows. The thumbs still
     render the FULL card (compact stays falsy there). */
  function build(verdict, ids, compact) {
    var refs = { ringHost: null, checkHost: null, label: null, input: null, score: null,
                 reasons: null, action: null, unvReason: null, unvAction: null };
    var wrap;
    if (verdict === 'high' || verdict === 'medium') {
      wrap = el('div', 'dash-threat-inner');
      var head = el('div', 'panel-heading');
      if (!compact) {
        var h = el('h3');
        h.textContent = 'Analysis details';
        head.appendChild(h);
      }
      var lbl = el('span', 'risk-label');
      if (ids) lbl.id = 'threat-risk-label';
      lbl.setAttribute('data-risk', verdict);
      lbl.textContent = LABELS[verdict];
      head.appendChild(lbl);
      var ring = el('div', 'ring-wrap ring-float result-ring-float');
      if (ids) ring.id = 'vis-ring-threat';
      var dl = el('dl', 'detail-rows');
      var dt1 = el('dt', 'detail-dt'); dt1.textContent = 'Selected input';
      var dd1 = el('dd', 'detail-dd dash-prewrap'); if (ids) dd1.id = 'detail-input';
      var dt2 = el('dt', 'detail-dt'); dt2.textContent = 'Risk score:';
      var dd2 = el('dd', 'detail-dd');
      var num = el('span'); if (ids) num.id = 'detail-score'; num.textContent = '0';
      dd2.appendChild(num);
      dd2.appendChild(document.createTextNode('/100'));
      dl.appendChild(dt1); dl.appendChild(dd1);
      dl.appendChild(dt2); dl.appendChild(dd2);
      if (!compact) {
        var dt3 = el('dt', 'detail-dt'); dt3.textContent = 'Detection reasons';
        var dd3 = el('dd', 'detail-dd');
        var ul = el('ul', 'reason-list'); if (ids) ul.id = 'detail-reasons';
        dd3.appendChild(ul);
        var dt4 = el('dt', 'detail-dt'); dt4.textContent = 'Recommended action';
        var dd4 = el('dd', 'detail-dd'); if (ids) dd4.id = 'detail-action';
        dl.appendChild(dt3); dl.appendChild(dd3);
        dl.appendChild(dt4); dl.appendChild(dd4);
        refs.reasons = ul; refs.action = dd4;
      }
      wrap.appendChild(head);
      wrap.appendChild(ring);
      wrap.appendChild(dl);
      refs.inner = wrap; refs.ringHost = ring; refs.label = lbl;
      refs.input = dd1; refs.score = num;
      return refs;
    }
    if (verdict === 'low') {
      wrap = el('div', 'dash-safe-wrap');
      var check = el('div', 'ring-safe-wrap'); if (ids) check.id = 'vis-check';
      var h2 = el('h3'); h2.textContent = 'No issues detected';
      var p = el('p'); p.textContent = 'No risk indicators found';
      wrap.appendChild(check);
      wrap.appendChild(h2);
      wrap.appendChild(p);
      refs.inner = wrap; refs.checkHost = check;
      return refs;
    }
    /* unverified */
    wrap = el('div', 'dash-unv-inner');
    var ringU = el('div', 'ring-wrap ring-float result-ring-float');
    if (ids) ringU.id = 'vis-ring-unv';
    var headU = el('div', 'panel-heading');
    var h3u = el('h3'); h3u.textContent = 'Unable to verify';
    headU.appendChild(h3u);
    var dlu = el('dl', 'detail-rows');
    var dtR = el('dt', 'detail-dt'); dtR.textContent = 'Reason';
    var ddR = el('dd', 'detail-dd'); if (ids) ddR.id = 'unv-reason';
    dlu.appendChild(dtR); dlu.appendChild(ddR);
    if (!compact) {
      var dtA = el('dt', 'detail-dt'); dtA.textContent = 'Recommended action';
      var ddA = el('dd', 'detail-dd'); if (ids) ddA.id = 'unv-action';
      dlu.appendChild(dtA); dlu.appendChild(ddA);
      refs.unvAction = ddA;
    }
    wrap.appendChild(ringU);
    wrap.appendChild(headU);
    wrap.appendChild(dlu);
    refs.inner = wrap; refs.ringHost = ringU;
    refs.unvReason = ddR;
    return refs;
  }

  /* fill(refs, verdict, data) — moved from js/pages/index.js presentResult
     (the by-id fill blocks); same texts and fallbacks. */
  function fill(refs, verdict, data) {
    var d = data || {};
    var utils = (window.DAC && window.DAC.utils) || {};
    if (verdict === 'high' || verdict === 'medium') {
      if (refs.label) {
        refs.label.textContent = LABELS[verdict];
        refs.label.setAttribute('data-risk', verdict);
      }
      if (refs.input) {
        var raw = d.input == null ? '' : d.input;
        refs.input.textContent = typeof utils.mask === 'function' ? utils.mask(raw) : String(raw);
      }
      if (refs.score) {
        var n = typeof d.score === 'number' && isFinite(d.score) ? d.score : 0;
        refs.score.textContent = String(clampN(n, 99));
      }
      if (refs.reasons) {
        refs.reasons.textContent = '';
        var rs = d.reasons || [];
        for (var j = 0; j < rs.length; j++) {
          var li = document.createElement('li');
          li.textContent = rs[j];
          refs.reasons.appendChild(li);
        }
      }
      if (refs.action) refs.action.textContent = d.recommendation || '';
    } else if (verdict === 'unverified') {
      if (refs.unvReason) refs.unvReason.textContent = d.details || 'Connection timeout.';
      if (refs.unvAction) refs.unvAction.textContent = d.recommendation || 'Unable to verify. Treat as untrusted and try again later.';
    }
    /* low: the safe state is fully static ("No issues detected" /
       "No risk indicators found" live in the markup). */
  }

  /* Refs for an inner wrapper this component built earlier (dashboard fill
     path): ids exist because the dashboard renders with ids on. */
  function collect(inner, verdict) {
    var q = function (sel) { return inner.querySelector(sel); };
    var refs = { inner: inner, ringHost: null, checkHost: null, label: q('.risk-label'),
                 input: null, score: null, reasons: null, action: null,
                 unvReason: null, unvAction: null };
    if (verdict === 'high' || verdict === 'medium') {
      refs.ringHost = q('.result-ring-float');
      refs.input = q('.dash-prewrap');
      refs.score = q('.detail-rows span');
      refs.reasons = q('.reason-list');
      refs.action = q('#detail-action') || q('.detail-dd:last-child');
    } else if (verdict === 'low') {
      refs.checkHost = q('.ring-safe-wrap');
    } else {
      refs.ringHost = q('.result-ring-float');
      refs.unvReason = q('#unv-reason') || q('.detail-dd:first-of-type');
      refs.unvAction = q('#unv-action') || q('.detail-dd:last-of-type');
    }
    return refs;
  }

  /* render(host, verdict, data, opts) → refs { inner, state, wrap, ringHost,
     checkHost, label, ... }.
     host = a .result-state div (dashboard shell): builds the inner wrapper
     once (replacing the static markup — the builder is then the single
     markup source) and fills it per scan.
     host = an empty container (Settings preview): builds the stacked-state
     layers (result-states > result-state.is-active) with the same markup.
     opts.ids=false omits element ids (preview copies coexist with the
     dashboard's ids in one document). */
  function render(host, verdict, data, opts) {
    opts = opts || {};
    var ids = opts.ids !== false;
    var compact = opts.compact === true;
    if (!host || !STATE_OF[verdict]) return null;
    if (host.classList && host.classList.contains('result-state')) {
      var found = host.querySelector('.dash-threat-inner,.dash-safe-wrap,.dash-unv-inner');
      var refs;
      if (!found || found.getAttribute('data-vs') !== '1') {
        host.textContent = '';
        refs = build(verdict, ids, compact);
        refs.inner.setAttribute('data-vs', '1');
        host.appendChild(refs.inner);
      } else {
        refs = collect(found, verdict);
      }
      fill(refs, verdict, data);
      refs.state = host;
      return refs;
    }
    /* Container mode: the stacked-state layers, exactly like the dashboard. */
    host.textContent = '';
    var wrap = el('div', 'result-states');
    var state = el('div', 'result-state is-active state-' + STATE_OF[verdict]);
    state.setAttribute('data-state', STATE_OF[verdict]);
    var crefs = build(verdict, ids, compact);
    crefs.inner.setAttribute('data-vs', '1');
    state.appendChild(crefs.inner);
    wrap.appendChild(state);
    host.appendChild(wrap);
    fill(crefs, verdict, data);
    crefs.state = state;
    crefs.wrap = wrap;
    return crefs;
  }

  TD.components.verdictCard = {
    render: render,
    build: build,
    LABELS: LABELS
  };
})();
